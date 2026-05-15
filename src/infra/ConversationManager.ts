/**
 * @file ConversationManager.ts
 * @description Implementação do Maestro — orquestrador central que concretiza
 *              a Sprint 5.3 (Fusão de Contexto). Une a Memória Vetorial (RAG)
 *              e a Memória de Curto Prazo (Sessões) em um único fluxo.
 *
 *              A partir da Fase 6, implementa o ReAct/Tool Calling Loop:
 *              - Se um ToolRegistry for fornecido, expõe as ferramentas ao LLM.
 *              - Detecta tool_calls na resposta, executa as ferramentas localmente,
 *                realimenta o resultado e repete o ciclo até o LLM gerar a resposta final
 *                (máximo de 3 iterações por segurança).
 *
 *              Depende de abstrações (DIP): ILogger, IMotorCognitivo,
 *              ISessionManager, IToolRegistry (opcional) e IVectorStore (opcional).
 */

import { IConversationManager } from '../core/IConversationManager.ts';
import type { ChatMessage, IToolDefinition } from '../core/IMotorCognitivo.ts';
import { IMotorCognitivo } from '../core/IMotorCognitivo.ts';
import { ISessionManager } from '../core/ISessionManager.ts';
import { IVectorStore } from '../core/IVectorStore.ts';
import { ILogger } from '../core/ILogger.ts';
import { IToolRegistry } from '../core/IToolRegistry.ts';

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
  /** Instância opcional do Tool Registry para Tool Calling.
   *  Se não fornecida, o Tool Calling é desabilitado. */
  toolRegistry?: IToolRegistry;
  /** Nome do sistema SOBERANO para a mensagem de system prompt */
  systemName?: string;
  /** Número máximo de iterações do Tool Calling Loop (segurança anti-loop infinito).
   *  Padrão: 3 */
  maxToolIterations?: number;
}

export class ConversationManager extends IConversationManager {
  private readonly logger: ILogger;
  private readonly motor: IMotorCognitivo;
  private readonly sessionManager: ISessionManager;
  private readonly vectorStore?: IVectorStore;
  private readonly toolRegistry?: IToolRegistry;
  private readonly systemName: string;
  private readonly maxToolIterations: number;

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
    this.toolRegistry = options.toolRegistry;
    this.systemName = options.systemName ?? 'SOBERANO';
    this.maxToolIterations = options.maxToolIterations ?? 3;
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
   * Processa uma interação completa de conversa multi-turno com RAG e Tool Calling.
   *
   * Fluxo:
   * 1. Guarda inputUsuario no SessionManager (role: user).
   * 2. Se IVectorStore existir, gera embedding heurístico e busca contextos similares.
   * 3. Obtém o histórico atualizado do SessionManager.
   * 4. Constrói mensagem system fundindo regras do SOBERANO com documentos recuperados.
   * 5. Se ToolRegistry existir, obtém definições das ferramentas para expor ao LLM.
   * 6. Chama o motor cognitivo com as definições de ferramentas.
   * 7. Executa o ReAct/Tool Calling Loop (se houver tool_calls).
   * 8. Quando não houver mais tool_calls, guarda e retorna a resposta final.
   *
   * @param sessionId    - Identificador único da sessão.
   * @param inputUsuario - Texto de entrada do usuário.
   * @returns A resposta gerada pelo motor cognitivo.
   */
  async conversar(sessionId: string, inputUsuario: string, signal?: AbortSignal): Promise<string> {
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
        const queryVector = this.gerarEmbeddingHeuristico(inputUsuario);
        this.logger.debug(
          `[ConversationManager] Generated heuristic embedding for RAG query (${queryVector.length} dims).`
        );

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
        this.logger.error(
          `[ConversationManager] RAG query failed (infrastructure failure): ${ragError}`
        );
        // RAG failure is non-fatal — conversation continues without retrieved context.
        // The error was already logged above for diagnostics.
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

    // Remove quaisquer mensagens system antigas do histórico para evitar conflito de instruções
    const historicoFiltrado = historico.filter(m => m.role !== 'system');

    // --- Passo 5: Obtém definições das ferramentas se ToolRegistry estiver disponível ---
    let toolDefinitions: IToolDefinition[] | undefined = undefined;
    if (this.toolRegistry) {
      const ferramentas = this.toolRegistry.obterTodas();
      if (ferramentas.length > 0) {
        toolDefinitions = ferramentas.map((f) => f.getDefinition());
        this.logger.info(
          `[ConversationManager] Exposing ${toolDefinitions.length} tool(s) to cognitive engine: ` +
          ferramentas.map((f) => `"${f.name}"`).join(', ')
        );
      } else {
        this.logger.debug('[ConversationManager] ToolRegistry has no tools registered.');
      }
    } else {
      this.logger.debug('[ConversationManager] No ToolRegistry configured. Tool Calling disabled.');
    }

    // Monta array inicial de mensagens para enviar ao motor
    const mensagensParaMotor: ChatMessage[] = [systemMessage, ...historicoFiltrado];

    this.logger.info(
      `[ConversationManager] Sending ${mensagensParaMotor.length} messages to cognitive engine ` +
      `(${documentosRecuperados.length > 0 ? 'with RAG context' : 'without RAG'})` +
      (toolDefinitions ? ` with ${toolDefinitions.length} tool(s)` : '.')
    );

    // --- Passo 6: Executa o ReAct/Tool Calling Loop ---
    const respostaFinal = await this.executarToolLoop(
      sessionId,
      mensagensParaMotor,
      toolDefinitions,
      0,
      signal
    );

    return respostaFinal;
  }

  /**
   * Executa o ReAct/Tool Calling Loop recursivo.
   *
   * 1. Envia as mensagens (com tool definitions, se for a primeira chamada) ao motor.
   * 2. Se a resposta contiver tool_calls:
   *    a. Guarda a mensagem do assistant (com tool_calls) no SessionManager.
   *    b. Itera sobre cada tool_call, executa ou cria erro simulado.
   *    c. Cria mensagens tool com os resultados e guarda no SessionManager.
   *    d. Rechama recursivamente SEM tool definitions para o LLM processar os resultados.
   * 3. Se não houver tool_calls, guarda a resposta final e retorna.
   *
   * @param sessionId      - Identificador da sessão.
   * @param mensagens      - Array de mensagens para enviar ao motor.
   * @param toolDefinitions - Definições de ferramentas (opcional, apenas na 1ª chamada).
   * @param depth          - Profundidade atual do loop (controle anti-loop infinito).
   * @returns O texto da resposta final do assistente.
   */
  private async executarToolLoop(
    sessionId: string,
    mensagens: ChatMessage[],
    toolDefinitions?: IToolDefinition[],
    depth: number = 0,
    signal?: AbortSignal
  ): Promise<string> {
    if (depth >= this.maxToolIterations) {
      this.logger.warn(
        `[ConversationManager] Tool loop reached maximum depth (${this.maxToolIterations}). ` +
        `Returning safe fallback message.`
      );

      // Fallback seguro: busca no histórico a última mensagem assistant com conteúdo
      // textual não vazio (edge case: content pode ser "" quando só há tool_calls)
      const historico = await this.sessionManager.obterHistorico(sessionId);
      const mensagensAssistant = historico.filter(m => m.role === 'assistant');
      for (let i = mensagensAssistant.length - 1; i >= 0; i--) {
        const msg = mensagensAssistant[i]!;
        if (msg.content && msg.content.length > 0) {
          return msg.content;
        }
      }

      // Nenhuma mensagem assistant com conteúdo encontrada — retorna fallback genérico
      const fallbackMsg = '[SOBERANO] Limite de iterações de ferramentas atingido. A execução foi interrompida para garantir estabilidade.';
      const mensagemFallback: ChatMessage = { role: 'assistant', content: fallbackMsg };
      await this.sessionManager.adicionarMensagem(sessionId, mensagemFallback);
      return fallbackMsg;
    }

    // --- Passo A: Envia as mensagens ao motor ---
    // Propaga o AbortSignal externo para o motor cognitivo
    if (signal) {
      this.motor.setAbortSignal(signal);
    }
    const respostaMessage = await this.motor.gerarResposta(mensagens, toolDefinitions);

    // --- Passo B: Verifica se a resposta contém tool_calls ---
    const hasToolCalls = respostaMessage.tool_calls && respostaMessage.tool_calls.length > 0;

    if (!hasToolCalls) {
      // --- Passo E: Sem tool_calls — guarda e retorna resposta final ---
      const respostaContent = respostaMessage.content;
      const mensagemAssistant: ChatMessage = { role: 'assistant', content: respostaContent };
      await this.sessionManager.adicionarMensagem(sessionId, mensagemAssistant);

      this.logger.info(
        `[ConversationManager] Final assistant response (depth ${depth}). ` +
        `Response length: ${respostaContent.length} chars.`
      );

      return respostaContent;
    }

    // --- Passo C: Resposta contém tool_calls — processa ---
    this.logger.info(
      `[ConversationManager] Tool calls detected (depth ${depth}): ` +
      `${respostaMessage.tool_calls!.length} tool call(s).`
    );

    // Guarda a mensagem do assistant contendo o pedido das ferramentas (crucial para contexto da LLM)
    await this.sessionManager.adicionarMensagem(sessionId, respostaMessage);
    this.logger.debug('[ConversationManager] Assistant message with tool_calls saved to session.');

    // Itera sobre cada tool_call
    const toolResultMessages: ChatMessage[] = [];

    for (let i = 0; i < respostaMessage.tool_calls!.length; i++) {
      const toolCall = respostaMessage.tool_calls![i] as {
        id: string;
        function: { name: string; arguments: Record<string, any> };
      };
      const toolName = toolCall.function.name;
      const toolArgs = toolCall.function.arguments;
      // Extrai o tool_call_id real emitido pelo LLM. O campo `id` foi validado
      // e extraído durante o parse da resposta em OllamaProvider.
      const toolCallId = toolCall.id;

      this.logger.info(
        `[ConversationManager] Executing tool "${toolName}" ` +
        `with arguments: ${JSON.stringify(toolArgs)}`
      );

      let resultado: any;

      if (this.toolRegistry) {
        const ferramenta = this.toolRegistry.obter(toolName);

        if (ferramenta) {
          try {
            resultado = await ferramenta.execute(toolArgs);
            this.logger.info(
              `[ConversationManager] Tool "${toolName}" executed successfully. ` +
              `Result: ${JSON.stringify(resultado)}`
            );
          } catch (execError) {
            const errorMsg = execError instanceof Error ? execError.message : String(execError);
            this.logger.error(
              `[ConversationManager] Tool "${toolName}" execution failed: ${errorMsg}`
            );
            resultado = { error: `Tool execution failed: ${errorMsg}` };
          }
        } else {
          // Ferramenta não encontrada no registry
          this.logger.error(
            `[ConversationManager] Tool "${toolName}" not found in registry. ` +
            `Available tools: ${this.toolRegistry.obterTodas().map((t) => `"${t.name}"`).join(', ')}`
          );
          resultado = { error: `Tool "${toolName}" not found. Available tools: ${this.toolRegistry.obterTodas().map((t) => t.name).join(', ')}` };
        }
      } else {
        // ToolRegistry não configurado — cria mensagem de erro simulando a ferramenta
        this.logger.warn(
          `[ConversationManager] Tool "${toolName}" called but no ToolRegistry configured. ` +
          `Returning simulated error.`
        );
        resultado = { error: `Tool "${toolName}" não está disponível porque nenhum ToolRegistry foi configurado.` };
      }

      // Cria uma ChatMessage com role: 'tool' contendo o resultado da execução em JSON
      const toolResultMessage: ChatMessage = {
        role: 'tool',
        content: JSON.stringify(resultado),
        tool_call_id: toolCallId,
      };

      // Adiciona ao array de resultados e guarda na sessão
      toolResultMessages.push(toolResultMessage);
      await this.sessionManager.adicionarMensagem(sessionId, toolResultMessage);
      this.logger.debug(
        `[ConversationManager] Tool result message saved for "${toolName}" (tool_call_id: ${toolCallId}).`
      );
    }

    // --- Passo D: Rechama o motor com o histórico atualizado (sem tool definitions) ---
    // Busca o histórico completo do SessionManager, que já contém a mensagem assistant
    // com tool_calls e os tool results salvos nos passos anteriores (single source of truth).
    // Isso elimina a duplicação: a mensagem NÃO é incluída manualmente no array de recursão.
    const historicoAtualizado = await this.sessionManager.obterHistorico(sessionId);
    const mensagensComResultados: ChatMessage[] = [mensagens[0]!, ...historicoAtualizado.filter(m => m.role !== 'system')];

    this.logger.info(
      `[ConversationManager] Re-invoking cognitive engine (depth ${depth + 1}) with updated context.`
    );

    // Chama recursivamente o loop SEM tool definitions (apenas para processar o resultado da ferramenta)
    return this.executarToolLoop(
      sessionId,
      mensagensComResultados,
      undefined, // Sem tool definitions na recursão
      depth + 1,
      signal
    );
  }
}
