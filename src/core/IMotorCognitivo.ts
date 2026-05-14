/**
 * @file IMotorCognitivo.ts
 * @description Contrato de abstração para o motor cognitivo (LLM).
 *              Módulos de alto nível dependem desta abstração,
 *              não de implementações concretas (DIP).
 *              Classe abstrata em vez de interface para preservar
 *              a estrutura em runtime com --experimental-transform-types.
 */

export abstract class IMotorCognitivo {
  /**
   * Envia um prompt ao motor cognitivo e retorna a resposta gerada.
   * @param prompt - O texto de entrada para o modelo de linguagem.
   * @returns A resposta gerada pelo modelo.
   */
  abstract gerarResposta(prompt: string): Promise<string>;
}