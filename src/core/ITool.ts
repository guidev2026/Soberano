/**
 * @file ITool.ts
 * @description Contrato abstrato para uma Ferramenta (Tool) que pode ser
 *              exposta ao motor cognitivo para Tool Calling.
 *              Segue o DIP: módulos de alto nível dependem desta abstração.
 */

import type { IToolDefinition } from './IMotorCognitivo.ts';

/**
 * Interface abstrata genérica para uma ferramenta executável.
 * Define o contrato que toda ferramenta concreta deve implementar.
 */
export abstract class ITool {
  /**
   * Nome único da ferramenta.
   */
  abstract get name(): string;

  /**
   * Descrição legível para o modelo LLM entender quando usar esta ferramenta.
   */
  abstract get description(): string;

  /**
   * Schema JSON dos parâmetros esperados pelo método execute().
   */
  abstract get parametersSchema(): Record<string, any>;

  /**
   * Executa a ferramenta com os argumentos fornecidos.
   * @param args - Argumentos no formato definido por parametersSchema.
   * @returns Resultado da execução.
   */
  abstract execute(args: Record<string, any>): Promise<any>;

  /**
   * Retorna a definição da ferramenta no formato IToolDefinition,
   * compatível com o protocolo de Tool Calling do Ollama/OpenAI.
   */
  getDefinition(): IToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parametersSchema,
      },
    };
  }
}