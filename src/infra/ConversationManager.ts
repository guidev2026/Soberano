/**
 * @file ConversationManager.ts
 * @description Implementação do Maestro — orquestrador central que concretiza
 *              a Sprint 5.3 (Fusão de Contexto). Une a Memória Vetorial (RAG)
 *              e a Memória de Curto Prazo (Sessões) em um único fluxo.
 *
 *              Depende de abstrações (DIP): ILogger, IMotorCognitivo,
 *              ISessionManager e opcionalmente IVectorStore.
 *
 *              Fluxo do método conversar():
 *              1. Guarda inputUsuario no SessionManager (role: user).
 *              2. Se IVectorStore existir, gera um embedding heurístico simples
 *                 (baseado no comprimento do texto) para buscar contextos similares.
 *              3. Obtém o histórico atualizado do SessionManager.
 *              4. Constrói mensagem system fundindo regras do SOBERANO
 *                 com os documentos recuperados do VectorStore (Context Fusion).
 *              5. Envia [SystemMessage, ...Historico] para IMotorCognitivo.gerarResposta().
 *              6. Guarda resposta (role: assistant) no SessionManager.
 *              7. Retorna resposta ao chamador.
 */

import { IConversationManager } from '../core/IConversationManager.ts';
import type { ChatMessage } from '../core/IMotorCognitivo.ts';
import { IMotorCognitivo } from '../core/IMotorCognitivo.ts';
import { ISessionManager } from '../core/ISessionManager.ts';
import { IVectorStore } from '../core/IVectorStore.ts';
import { ILogger } from '../core/ILogger.ts';

export interface ConversationManagerOptions {
  /** Instância obrigatória de ILogger para logging estruturado */
  logger: ILogger;
  /** Instância obrigatória do motor cognitivo (LLM) */
  motor: IMotorCognitivo;
  /** Instância obrigatória do gerenciador de sessões */
  sessionManager: ISessionManager;
  /** Instância opcional do Vector Store para RAG (Memória Vetorial).
   *  Se não fornecida, o RAG é desabilitado. */
  vectorStore?: IVectorStore;
  /** Nome do sistema SOBERANO para a mensagem de system prompt */
  systemName?: string;
}

export class ConversationManager extends IConversationManager {
  private readonly logger: ILogger;
  private readonly motor: IMotorCognitivo;
  private readonly sessionManager: ISessionManager;
  private readonly vectorStore?: IVectorStore;
  private readonly systemName: string;

  /**
   * @param options - Options Object (ConversationManagerOptions).
   *                  Apenas `logger`, `motor` e `sessionManager` são obrigatórios.
   */
  constructor(options: ConversationManagerOptions) {
    super();
    this.logger = options.logger;
    this.motor = options.motor;
    this.sessionManager = options.sessionManager;
    this.vectorStore = options.vectorStore;
    this.systemName = options.systemName ?? 'SOBERANO';
  }

  /**
   * Gera um embedding heurístico simples a partir de um texto.
   * Cada palavra contribui com uma dimensão baseada no hash do caractere.
   * Isso permite buscas no VectorStore mesmo sem um provedor de embeddings real.
   *
   * @param text - Texto a ser convertido em vetor
   * @returns Vetor numérico de 10 dimensões
   */
  private gerarEmbeddingHeuristico(text: string): number[] {
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
    const dimensions = 10;
    const vector = new Array(dimensions).fill(0);

    for (let i = 0; i < words.length; i++) {
      const word = words[i] as string;
      for (let j = 0; j < word.length; j++) {
        const dim = j % dimensions;
        vector[dim] = (vector[dim] as number) + (word.charCodeAt(j) % 10) + 1;
      }
    }

    // Normaliza para evitar valores muito grandes
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] = (vector[i] as number) / magnitude;
      }
    }

    return vector;
  }

  /**
   * Processa uma interação completa de conversa multi-turno com RAG.
   *
   * @param sessionId    - Identificador único da sessão.
   * @param inputUsuario - Texto de entrada do usuário.
   * @returns A resposta gerada pelo motor cognitivo.
   */
  async conversar(sessionId: string, inputUsuario: string): Promise<string> {
    this.logger.info(
      `[ConversationManager] Processing turn for session "${sessionId}". Input: "${inputUsuario}"`
    );

    // --- Passo 1: Guarda o input do usuário na sessão ---
    const mensagemUsuario: ChatMessage = { role: 'user', content: inputUsuario };
    await this.sessionManager.adicionarMensagem(sessionId, mensagemUsuario);
    this.logger.debug('[ConversationManager] User message saved to session.');

    // --- Passo 2: RAG — busca contextos similares no VectorStore (se disponível) ---
    let documentosRecuperados: string[] = [];
    if (this.vectorStore) {
      try {
        // Gera embedding heurístico para a consulta do usuário
        const queryVector = this.gerarEmbeddingHeuristico(inputUsuario);
        this.logger.debug(
          `[ConversationManager] Generated heuristic embedding for RAG query (${queryVector.length} dims).`
        );

        // Busca os 3 documentos mais similares
        const resultados = await this.vectorStore.buscarSimilares(queryVector, 3);

        if (resultados.length > 0) {
          documentosRecuperados = resultados.map((r) => {
            const metadata = r.metadata as Record<string, unknown>;
            return String(metadata.texto ?? metadata.content ?? JSON.stringify(metadata));
          });
          this.logger.info(
            `[ConversationManager] RAG: ${resultados.length} relevant documents retrieved.`
          );
        } else {
          this.logger.debug('[ConversationManager] RAG: No similar documents found.');
        }
      } catch (ragError) {
        this.logger.warn(
          `[ConversationManager] RAG query failed (non-fatal): ${ragError}`
        );
      }
    } else {
      this.logger.debug('[ConversationManager] No VectorStore configured. RAG disabled.');
    }

    // --- Passo 3: Obtém o histórico completo da sessão ---
    const historico = await this.sessionManager.obterHistorico(sessionId);
    this.logger.debug(
      `[ConversationManager] Session history retrieved: ${historico.length} messages.`
    );

    // --- Passo 4: Constrói a mensagem system (Context Fusion) ---
    let systemContent =
      `Você é o ${this.systemName}, um assistente de IA de alta robustez. ` +
      `Responda em Português do Brasil de forma clara e objetiva. ` +
      `Mantenha o contexto da conversa ao responder.`;

    if (documentosRecuperados.length > 0) {
      const contextoRAG = documentosRecuperados.map((doc, idx) => `[${idx + 1}] ${doc}`).join('\n');
      systemContent +=
        `\n\nDocumentos de contexto recuperados:\n${contextoRAG}\n\n` +
        `Utilize as informações dos documentos acima para enriquecer sua resposta, ` +
        `mas não invente informações que não estejam presentes.`;
    }

    const systemMessage: ChatMessage = { role: 'system', content: systemContent };

    // --- Passo 5: Monta array final e envia ao motor cognitivo ---
    const mensagensParaMotor: ChatMessage[] = [systemMessage, ...historico];

    this.logger.info(
      `[ConversationManager] Sending ${mensagensParaMotor.length} messages to cognitive engine ` +
      `(${documentosRecuperados.length > 0 ? 'with RAG context' : 'without RAG'}).`
    );

    const resposta = await this.motor.gerarResposta(mensagensParaMotor);

    // --- Passo 6: Guarda a resposta (assistant) na sessão ---
    const mensagemAssistant: ChatMessage = { role: 'assistant', content: resposta };
    await this.sessionManager.adicionarMensagem(sessionId, mensagemAssistant);

    this.logger.info(
      `[ConversationManager] Assistant response saved to session "${sessionId}". ` +
      `Response length: ${resposta.length} chars.`
    );

    // --- Passo 7: Retorna a resposta ---
    return resposta;
  }
}