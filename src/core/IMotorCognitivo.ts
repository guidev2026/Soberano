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
 * assistant (modelo).
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
   * @returns A resposta gerada pelo modelo (content da mensagem assistant).
   */
  abstract gerarResposta(mensagens: ChatMessage[]): Promise<string>;
}