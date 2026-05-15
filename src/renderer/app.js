/**
 * @file app.js
 * @description Frontend Vanilla do SOBERANO — "A Casca".
 *
 *              Usa a API nativa `fetch` para enviar mensagens e consumir
 *              Server-Sent Events do backend HTTP (POST /chat).
 *
 *              Fluxo:
 *              1. GET /healthz verifica se o servidor está online.
 *              2. POST /chat com { message, sessionId } inicia streaming SSE.
 *              3. Cada evento data: { chunk, done } atualiza o DOM em tempo real.
 *              4. Ao final (done: true), a message box perde a classe .streaming.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  /** @type {string | null} */
  let sessionId = localStorage.getItem('soberano_session_id');

  /** @type {boolean} */
  let isStreaming = false;

  /** @type {AbortController | null} */
  let currentAbortController = null;

  // ─── DOM References ──────────────────────────────────────────────────────
  const chatContainer = document.getElementById('chat-container');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const sessionIdLabel = document.getElementById('session-id-label');

  // ─── Health Check ─────────────────────────────────────────────────────────
  async function checkHealth() {
    try {
      const res = await fetch('/healthz', { method: 'GET' });
      if (res.ok) {
        setStatus(true, 'Online');
        sendButton.disabled = false;
        return true;
      }
    } catch {
      // ignora
    }
    setStatus(false, 'Offline');
    sendButton.disabled = true;
    return false;
  }

  function setStatus(online, text) {
    statusText.textContent = text;
    statusDot.classList.toggle('offline', !online);
    if (online) {
      sessionIdLabel.textContent = `Sessão: ${sessionId ? sessionId.substring(0, 8) + '...' : 'Nova'}`;
    }
  }

  // ─── Session ID ──────────────────────────────────────────────────────────
  function getOrCreateSessionId() {
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem('soberano_session_id', sessionId);
    }
    sessionIdLabel.textContent = `Sessão: ${sessionId.substring(0, 8)}...`;
    return sessionId;
  }

  // ─── UI Helpers ──────────────────────────────────────────────────────────
  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = content;
    chatContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function removeTypingIndicator(indicator) {
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  function getLastAssistantMessage() {
    const messages = chatContainer.querySelectorAll('.message.assistant');
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    if (enabled) {
      messageInput.focus();
    }
  }

  // ─── Auto-resize textarea ────────────────────────────────────────────────
  messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ─── Send message via fetch + SSE ────────────────────────────────────────
  async function sendMessage(userText) {
    if (isStreaming || !userText.trim()) return;

    isStreaming = true;
    setInputEnabled(false);

    // Exibe a mensagem do usuário
    addMessage('user', userText);

    // Indicador de digitação enquanto aguarda o primeiro chunk
    const typingIndicator = addTypingIndicator();

    // Cria (ou reusa) o elemento da mensagem do assistente
    let assistantMessageEl = null;
    let currentText = '';

    currentAbortController = new AbortController();
    const sid = getOrCreateSessionId();

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sid,
        },
        body: JSON.stringify({ message: userText }),
        signal: currentAbortController.signal,
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
      }

      // Lê a resposta como texto SSE usando reader
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Processa linhas SSE completas
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Última linha pode estar incompleta

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            // Evento de sessão (primeiro evento)
            if (event.type === 'session') {
              sessionId = event.sessionId;
              localStorage.setItem('soberano_session_id', sessionId);
              sessionIdLabel.textContent = `Sessão: ${sessionId.substring(0, 8)}...`;
              continue;
            }

            // Erro do servidor
            if (event.error) {
              removeTypingIndicator(typingIndicator);
              addMessage('error', `❌ ${event.error}`);
              continue;
            }

            // Chunk de texto
            if (event.chunk !== undefined) {
              removeTypingIndicator(typingIndicator);

              if (!assistantMessageEl) {
                // Cria elemento da mensagem do assistente
                assistantMessageEl = document.createElement('div');
                assistantMessageEl.className = 'message assistant streaming';
                assistantMessageEl.textContent = '';
                chatContainer.appendChild(assistantMessageEl);
              }

              if (!event.done) {
                // Adiciona chunk
                const chunk = event.chunk.replace(/\\n/g, '\n');
                currentText += chunk;
                assistantMessageEl.textContent = currentText;
                scrollToBottom();
              }

              // Último evento (stream finalizado)
              if (event.done) {
                assistantMessageEl.classList.remove('streaming');
                scrollToBottom();
              }
            }
          } catch (parseErr) {
            // Ignora JSON malformados no SSE
            console.warn('[app.js] SSE parse error:', parseErr, jsonStr);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Requisição cancelada pelo usuário — ignora silenciosamente
        return;
      }
      removeTypingIndicator(typingIndicator);
      addMessage('error', `❌ Erro de conexão: ${err.message}`);
      console.error('[app.js] Fetch error:', err);
    } finally {
      isStreaming = false;
      setInputEnabled(true);
      currentAbortController = null;
      messageInput.value = '';
      messageInput.style.height = 'auto';
    }
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────
  sendButton.addEventListener('click', function () {
    const text = messageInput.value;
    if (text.trim()) {
      sendMessage(text);
    }
  });

  messageInput.addEventListener('keydown', function (e) {
    // Enter envia a mensagem (Shift+Enter = nova linha)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = this.value;
      if (text.trim()) {
        sendMessage(text);
      }
    }
  });

  // ─── Boot ────────────────────────────────────────────────────────────────
  getOrCreateSessionId();
  checkHealth();
  setInterval(checkHealth, 30_000); // Health check a cada 30s

  messageInput.focus();

  console.log('[app.js] SOBERANO frontend initialized.');
  console.log(`[app.js] Session ID: ${sessionId}`);
})();