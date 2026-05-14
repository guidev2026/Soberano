/**
 * @file IMotorCognitivo.ts
 * @description Contrato de abstração para o motor cognitivo (LLM).
 *              Módulos de alto nível dependem desta abstração,
 *              não de implementações concretas (DIP).
 *              Classe abstrata em vez de interface para preservar
 *              a estrutura em runtime com --experimental-transform-types.
 */

/**
 * Representa uma mensagem no formato de chat multi-turno.
 * Suporta os papéis: system (instrução de sistema), user (usuário),
 * assistant (modelo), tool (resultado de ferramenta).
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Chamadas de ferramenta emitidas pelo assistant (tool_calls do Ollama/OpenAI). */
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, any> } }>;
  /** ID de correlação para tool call (formato OpenAI/Ollama compatível). */
  tool_call_id?: string;
}

/**
 * Definição de uma ferramenta (function calling) para envio ao motor cognitivo.
 * Segue o formato esperado pelo Ollama na propriedade `tools` da requisição.
 */
export interface IToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export abstract class IMotorCognitivo {
  /**
   * Define o sinal de aborto para cancelamento de operações pendentes.
   * @param signal - Sinal AbortSignal para cancelamento gracioso.
   */
  abstract setAbortSignal(signal: AbortSignal): void;

  /**
   * Envia uma lista de mensagens no formato chat ao motor cognitivo
   * e retorna a resposta gerada pelo modelo.
   * @param mensagens - Array de mensagens no formato ChatMessage[].
   * @param tools - Array opcional de definições de ferramentas (tool calling).
   * @returns A mensagem completa de resposta (ChatMessage), podendo conter
   *          tool_calls se o modelo decidir chamar uma ferramenta.
   */
  abstract gerarResposta(mensagens: ChatMessage[], tools?: IToolDefinition[]): Promise<ChatMessage>;
}