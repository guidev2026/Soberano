/**
 * @file OllamaProvider.ts
 * @description Implementação concreta de IMotorCognitivo que se comunica
 *              com o servidor local Ollama via API REST (fetch nativo).
 *              - Depende da abstração IMotorCognitivo, não o contrário (DIP).
 *              - Retry automático com maxRetries e delayBase configuráveis.
 *              - Timeout configurável via AbortController.
 *              - Aceita AbortSignal externo para graceful shutdown.
 *              - Validação rigorosa de schema da resposta.
 *              - Logger injetado via construtor.
 *              - Suporte a Tool Calling (Fase 6).
 */

import { IMotorCognitivo } from '../core/IMotorCognitivo.ts';
import type { ChatMessage, IToolDefinition } from '../core/IMotorCognitivo.ts';
import { ILogger } from '../core/ILogger.ts';
import { ICircuitBreaker } from '../core/ICircuitBreaker.ts';

export interface OllamaConfig {
  logger: ILogger;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  delayBase?: number;
  timeoutMs?: number;
  circuitBreaker?: ICircuitBreaker;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: Record<string, any> };
  }>;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Valida em runtime se um valor desconhecido é um OllamaChatResponse válido.
 * Lança erro descritivo se algum campo obrigatório estiver ausente ou com tipo incorreto.
 * Agora suporta tool_calls: message.content pode ser string vazia se tool_calls estiver presente.
 *
 * @param data - Dado desconhecido a ser validado
 * @returns O dado tipado como OllamaChatResponse
 * @throws {Error} Se a validação falhar
 */
export function validateOllamaResponse(data: unknown): OllamaChatResponse {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error(
      `[OllamaProvider] Invalid response: expected object, received ${typeof data}`
    );
  }

  const record = data as Record<string, unknown>;

  if (typeof record.model !== 'string') {
    throw new Error(
      `[OllamaProvider] Field "model" missing or invalid: expected string, received ${typeof record.model}`
    );
  }

  if (typeof record.done !== 'boolean') {
    throw new Error(
      `[OllamaProvider] Field "done" missing or invalid: expected boolean, received ${typeof record.done}`
    );
  }

  // created_at is required by the Ollama API specification
  if (typeof record.created_at !== 'string') {
    throw new Error(
      `[OllamaProvider] Field "created_at" missing or invalid: expected string, received ${typeof record.created_at}`
    );
  }

  if (record.message === null || record.message === undefined || typeof record.message !== 'object') {
    throw new Error(
      `[OllamaProvider] Field "message" missing or invalid: expected object, received ${typeof record.message}`
    );
  }

  const messageRecord = record.message as Record<string, unknown>;

  if (typeof messageRecord.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(messageRecord.role as string)) {
    throw new Error(
      `[OllamaProvider] Field "message.role" missing or invalid: expected 'system' | 'user' | 'assistant' | 'tool', received ${typeof messageRecord.role}`
    );
  }

  // content pode ser string vazia desde que tool_calls esteja presente
  const hasToolCalls = Array.isArray(messageRecord.tool_calls);
  if (typeof messageRecord.content !== 'string') {
    throw new Error(
      `[OllamaProvider] Field "message.content" missing or invalid: expected string, received ${typeof messageRecord.content}`
    );
  }

  if (messageRecord.content === '' && !hasToolCalls) {
    throw new Error(
      `[OllamaProvider] Field "message.content" is empty and no tool_calls provided`
    );
  }

  // Valida tool_calls se presente
  let validatedToolCalls: Array<{
    id: string;
    function: { name: string; arguments: Record<string, any> }
  }> | undefined;
  if (hasToolCalls) {
    validatedToolCalls = [];
    for (const tc of messageRecord.tool_calls as Array<unknown>) {
      if (tc === null || tc === undefined || typeof tc !== 'object') {
        throw new Error(`[OllamaProvider] Invalid tool_call entry: expected object`);
      }
      const tcRecord = tc as Record<string, unknown>;
      if (typeof tcRecord.id !== 'string') {
        throw new Error(`[OllamaProvider] Invalid tool_call.id: expected string, received ${typeof tcRecord.id}`);
      }
      if (tcRecord.function === null || tcRecord.function === undefined || typeof tcRecord.function !== 'object') {
        throw new Error(`[OllamaProvider] Invalid tool_call.function: expected object`);
      }
      const fnRecord = tcRecord.function as Record<string, unknown>;
      if (typeof fnRecord.name !== 'string') {
        throw new Error(`[OllamaProvider] Invalid tool_call.function.name: expected string`);
      }
      if (typeof fnRecord.arguments !== 'object' || fnRecord.arguments === null) {
        throw new Error(`[OllamaProvider] Invalid tool_call.function.arguments: expected object`);
      }
      validatedToolCalls.push({
        id: tcRecord.id,
        function: {
          name: fnRecord.name,
          arguments: fnRecord.arguments as Record<string, any>,
        },
      });
    }
  }

  return {
    model: record.model,
    created_at: record.created_at,
    message: {
      role: messageRecord.role as 'system' | 'user' | 'assistant' | 'tool',
      content: messageRecord.content,
      images: Array.isArray(messageRecord.images) ? (messageRecord.images as string[]) : undefined,
      tool_calls: validatedToolCalls,
    },
    done: record.done,
    total_duration: typeof record.total_duration === 'number' ? record.total_duration : undefined,
    load_duration: typeof record.load_duration === 'number' ? record.load_duration : undefined,
    prompt_eval_count: typeof record.prompt_eval_count === 'number' ? record.prompt_eval_count : undefined,
    prompt_eval_duration: typeof record.prompt_eval_duration === 'number' ? record.prompt_eval_duration : undefined,
    eval_count: typeof record.eval_count === 'number' ? record.eval_count : undefined,
    eval_duration: typeof record.eval_duration === 'number' ? record.eval_duration : undefined,
  };
}

export class OllamaProvider extends IMotorCognitivo {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger: ILogger;
  private readonly maxRetries: number;
  private readonly delayBase: number;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: ICircuitBreaker;
  private externalSignal: AbortSignal | null = null;

  /**
   * @param config - Objeto de configuração (OllamaConfig). Apenas `logger` é obrigatório.
   * @throws {Error} Se circuitBreaker não for fornecido (DIP obrigatório).
   */
  constructor(config: OllamaConfig) {
    super();
    this.logger = config.logger;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'qwen2.5-coder:3b';
    this.maxRetries = config.maxRetries ?? 3;
    this.delayBase = config.delayBase ?? 1_000;
    this.timeoutMs = config.timeoutMs ?? 30_000;

    if (!config.circuitBreaker) {
      throw new Error(
        '[OllamaProvider] CircuitBreaker is required for DIP compliance. ' +
        'Provide an instance of ICircuitBreaker in the configuration.'
      );
    }
    this.circuitBreaker = config.circuitBreaker;
  }

  /**
   * Injeta um AbortSignal externo para graceful shutdown.
   * Quando este sinal for abortado, todas as requisições em andamento
   * serão canceladas.
   */
  setAbortSignal(signal: AbortSignal): void {
    this.externalSignal = signal;
  }

  /**
   * Aguarda um tempo determinado (ms) usando setTimeout encapsulado em Promise.
   * Aceita um AbortSignal para permitir cancelamento do delay (ex: shutdown).
   * Rejeita com DOMException('Aborted', 'AbortError') se o sinal for abortado.
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      // Se o sinal já estiver abortado, rejeita imediatamente
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(() => {
        resolve();
      }, ms);

      // Se um sinal for fornecido, escuta o evento 'abort' para cancelar o delay
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  }

  /**
   * Determina se um erro é recuperável (conexão/temporário) para retry.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }
    if (error instanceof Error) {
      // Erros de rede/DNS/ECONNREFUSED geralmente disparam TypeError no fetch
      const msg = error.message.toLowerCase();
      return (
        msg.includes('econnrefused') ||
        msg.includes('socket hang up') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('fetch failed')
      );
    }
    return false;
  }

  /**
   * Envia uma lista de mensagens no formato chat ao modelo Ollama
   * e retorna a resposta gerada.
   * Utiliza exclusivamente o fetch nativo do Node.js (sem dependências externas).
   * Implementa retry automático (máximo configurável) para erros de conexão.
   * Implementa timeout via AbortController em cada tentativa.
   * Suporta Tool Calling opcional (Fase 6).
   *
   * @param mensagens - Array de mensagens no formato ChatMessage[].
   * @param tools - Array opcional de definições de ferramentas para tool calling.
   * @returns A mensagem completa de resposta (ChatMessage).
   * @throws {Error} Se após todas as tentativas a comunicação falhar.
   */
  async gerarResposta(mensagens: ChatMessage[], tools?: IToolDefinition[]): Promise<ChatMessage> {
    const url = `${this.baseUrl}/api/chat`;

    const payload: Record<string, any> = {
      model: this.model,
      messages: mensagens,
      stream: false,
    };

    // Inclui tools no payload se for fornecido
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptController = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      // Função de cleanup que remove o listener externo e limpa o timeout
      let removeExternalListener: (() => void) | null = null;

      try {
        this.logger.info(
          `[OllamaProvider] Attempt ${attempt}/${this.maxRetries} - Sending messages to model "${this.model}"` +
          (tools ? ` with ${tools.length} tool(s) defined` : '')
        );

        // Configura timeout para esta tentativa
        timeoutHandle = setTimeout(() => {
          attemptController.abort();
        }, this.timeoutMs);

        // Se há um sinal externo (shutdown), escuta para propagar o abort
        if (this.externalSignal) {
          const onAbort = () => {
            attemptController.abort();
          };
          this.externalSignal.addEventListener('abort', onAbort);
          removeExternalListener = () => {
            this.externalSignal!.removeEventListener('abort', onAbort);
          };

          // Se o sinal externo já está abortado, aborta imediatamente
          if (this.externalSignal.aborted) {
            attemptController.abort();
          }
        }

        const executeFetch = async (): Promise<OllamaChatResponse> => {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: attemptController.signal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No error body available');
            throw new Error(
              `[OllamaProvider] HTTP error ${response.status} communicating with the cognitive engine.\n` +
              `  URL: ${url}\n` +
              `  Model: ${this.model}\n` +
              `  Details: ${errorBody}`
            );
          }

          const rawData: unknown = await response.json();

          // Validação rigorosa de schema em runtime
          const validated = validateOllamaResponse(rawData);

          this.logger.info(
            `[OllamaProvider] Attempt ${attempt} succeeded. Response received (${validated.message.content.length} chars).`
          );

          return validated;
        };

        const data: OllamaChatResponse = await this.circuitBreaker.execute(executeFetch);

        // Converte a resposta validada para ChatMessage
        const resposta: ChatMessage = {
          role: data.message.role,
          content: data.message.content,
          tool_calls: data.message.tool_calls,
        };

        return resposta;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Verifica se o erro é HTTP 4xx (não recuperável) - gera log claro
        if (error instanceof Error && /HTTP error [4][0-9]{2}/.test(error.message)) {
          this.logger.error(
            `[OllamaProvider] Non-retryable HTTP error in attempt ${attempt}/${this.maxRetries}. ` +
            `Breaking immediately.\n  Error: ${lastError.message}`
          );
          this.logger.error(
            `[OllamaProvider] All ${this.maxRetries} attempts failed. ` +
            `Last error: ${lastError.message}`
          );
          break;
        }

        // Verifica se o erro é de cancelamento (shutdown/timeout)
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.logger.error(
            `[OllamaProvider] Operation aborted in attempt ${attempt}/${this.maxRetries}. ` +
            `Breaking immediately.\n  Error: ${lastError.message}`
          );
          this.logger.error(
            `[OllamaProvider] All ${this.maxRetries} attempts failed. ` +
            `Last error: ${lastError.message}`
          );
          break;
        }

        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const delayMs = this.delayBase * attempt; // backoff: 1x, 2x, 3x
          this.logger.warn(
            `[OllamaProvider] Attempt ${attempt} failed (connection error). ` +
            `Retrying in ${delayMs}ms...\n` +
            `  Error: ${lastError.message}`
          );
          if (this.externalSignal?.aborted) {
            this.logger.error(
              `[OllamaProvider] External signal aborted during retry delay. Breaking.`
            );
            break;
          }
          // Aguarda o delay com suporte a abort signal para interromper imediatamente no shutdown
          try {
            await this.delay(delayMs, this.externalSignal ?? undefined);
          } catch (delayError) {
            this.logger.error(
              `[OllamaProvider] Retry delay aborted by external signal. Breaking.`
            );
            break;
          }
          continue;
        }

        // Erro não recuperável sem ser 4xx (ex: erro interno, falha final)
        this.logger.error(
          `[OllamaProvider] Unrecoverable error in attempt ${attempt}/${this.maxRetries}. ` +
          `Breaking.\n  Error: ${lastError.message}`
        );

        if (attempt >= this.maxRetries) {
          this.logger.error(
            `[OllamaProvider] All ${this.maxRetries} attempts failed. ` +
            `Giving up.\n  Last error: ${lastError.message}`
          );
        }
        break;
      } finally {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }
        if (removeExternalListener) {
          removeExternalListener();
        }
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    throw lastError ?? new Error('[OllamaProvider] Unknown failure after retry');
  }

  /**
   * Envia mensagens ao motor cognitivo e retorna um fluxo de chunks de texto
   * (streaming), útil para enviar tokens progressivamente via IPC no Electron.
   *
   * @param mensagens - Array de mensagens no formato ChatMessage[].
   * @param tools - Array opcional de definições de ferramentas (tool calling).
   * @param signal - Sinal opcional para cancelamento do stream.
   * @returns AsyncIterable<string> — cada chunk é um fragmento de texto da resposta.
   */
  async *gerarRespostaStream(
    mensagens: ChatMessage[],
    tools?: IToolDefinition[],
    signal?: AbortSignal
  ): AsyncIterable<string> {
    const url = `${this.baseUrl}/api/chat`;

    const payload: Record<string, any> = {
      model: this.model,
      messages: mensagens,
      stream: true,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const controller = new AbortController();

    // Propagate external signal if provided
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    if (this.externalSignal) {
      this.externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    this.logger.info(
      `[OllamaProvider] Starting stream for model "${this.model}"` +
      (tools ? ` with ${tools.length} tool(s) defined` : '')
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'No error body available');
      throw new Error(
        `[OllamaProvider] HTTP error ${response.status} during stream.\n` +
        `  URL: ${url}\n  Model: ${this.model}\n  Details: ${errorBody}`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('[OllamaProvider] Response body is not readable for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Ollama NDJSON: each line is a separate JSON object
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { message?: { content?: string } };
            if (chunk.message?.content) {
              yield chunk.message.content;
            }
          } catch {
            // Silently skip malformed JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer) as { message?: { content?: string } };
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch {
          // Silently skip
        }
      }
    } finally {
      reader.releaseLock();
      this.logger.info(`[OllamaProvider] Stream completed for model "${this.model}"`);
    }
  }
}
