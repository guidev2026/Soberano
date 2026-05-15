/**
 * @file CalculatorTool.ts
 * @description Implementação concreta de ITool que realiza operações matemáticas
 *              básicas entre dois números (soma, subtração, multiplicação, divisão).
 *              Trata divisão por zero retornando erro em vez de lançar exceção.
 */

import { ITool } from '../../core/ITool.ts';

export class CalculatorTool extends ITool {
  get name(): string {
    return 'calculator';
  }

  get description(): string {
    return 'Realiza operações matemáticas básicas entre dois números.';
  }

  get parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        operacao: {
          type: 'string',
          enum: ['soma', 'subtracao', 'multiplicacao', 'divisao'],
          description: 'Operação matemática a ser realizada.',
        },
        a: {
          type: 'number',
          description: 'Primeiro número da operação.',
        },
        b: {
          type: 'number',
          description: 'Segundo número da operação.',
        },
      },
      required: ['operacao', 'a', 'b'],
    };
  }

  async execute(args: Record<string, any>): Promise<any> {
    const { operacao, a, b } = args;

    if (typeof a !== 'number' || typeof b !== 'number') {
      return { error: 'Ambos os parâmetros "a" e "b" devem ser números.' };
    }

    if (typeof operacao !== 'string') {
      return { error: 'O parâmetro "operacao" deve ser uma string.' };
    }

    switch (operacao) {
      case 'soma': {
        const resultado = a + b;
        return { operacao, a, b, resultado };
      }
      case 'subtracao': {
        const resultado = a - b;
        return { operacao, a, b, resultado };
      }
      case 'multiplicacao': {
        const resultado = a * b;
        return { operacao, a, b, resultado };
      }
      case 'divisao': {
        if (b === 0) {
          return { error: 'Divisão por zero não é permitida.' };
        }
        const resultado = a / b;
        return { operacao, a, b, resultado };
      }
      default:
        return {
          error: `Operação inválida: "${operacao}". Use uma das: soma, subtracao, multiplicacao, divisao.`,
        };
    }
  }
}