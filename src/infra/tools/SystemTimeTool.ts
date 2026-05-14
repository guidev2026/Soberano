/**
 * @file SystemTimeTool.ts
 * @description Implementação concreta de ITool que retorna a data e hora atual
 *              do sistema no formato ISO 8601.
 *              Serve como ferramenta real de teste para o Tool Calling Loop.
 */

import { ITool } from '../../core/ITool.ts';

export class SystemTimeTool extends ITool {
  get name(): string {
    return 'get_system_time';
  }

  get description(): string {
    return 'Retorna a data e hora atual do sistema no formato ISO 8601.';
  }

  get parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(_args: Record<string, any>): Promise<any> {
    const now = new Date().toISOString();
    return now;
  }
}