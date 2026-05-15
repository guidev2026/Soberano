/**
 * @file IConversationManager.ts
 * @description Contrato do Maestro — orquestrador que une a Memória Vetorial (RAG)
 *              e a Memória de Curto Prazo (Sessões) em um único fluxo de conversação
 *              multi-turno. Segue o DIP: módulos de alto nível dependem desta abstração.
 */

export abstract class IConversationManager {
  /**
   * Processa uma interação completa de conversa:
   * 1. Guarda o input do usuário no SessionManager (role: user).
   * 2. Se um VectorStore estiver disponível, busca contextos similares ao input (RAG).
   * 3. Obtém o histórico completo da sessão.
   * 4. Constrói uma mensagem system fundindo regras do SOBERANO com documentos recuperados.
   * 5. Envia o array de mensagens ao motor cognitivo.
   * 6. Executa o ReAct/Tool Calling Loop se houver tool_calls.
   * 7. Guarda a resposta (role: assistant) no SessionManager.
   * 8. Retorna a resposta ao chamador.
   *
   * @param sessionId    - Identificador único da sessão de conversa.
   * @param inputUsuario - Texto de entrada do usuário.
   * @param signal       - Sinal opcional para abortar a operação (graceful shutdown / cancelamento).
   * @returns A resposta gerada pelo motor cognitivo (role: assistant).
   */
  abstract conversar(sessionId: string, inputUsuario: string, signal?: AbortSignal): Promise<string>;
}
