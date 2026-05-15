/**
 * @file CalculatorTool.test.ts
 * @description Testes unitários para CalculatorTool utilizando node:test e node:assert.
 *
 * Como executar:
 *   node --experimental-transform-types --test src/infra/tools/CalculatorTool.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CalculatorTool } from './CalculatorTool.ts';

describe('CalculatorTool', () => {
  const tool = new CalculatorTool();

  describe('Metadados da ferramenta', () => {
    it('deve ter o nome "calculator"', () => {
      assert.strictEqual(tool.name, 'calculator');
    });

    it('deve ter uma descrição não vazia', () => {
      assert.ok(tool.description.length > 0);
    });

    it('deve ter um parametersSchema com operacao, a, b como required', () => {
      const schema = tool.parametersSchema;
      assert.strictEqual(schema.type, 'object');
      assert.ok(Array.isArray(schema.required));
      assert.ok(schema.required.includes('operacao'));
      assert.ok(schema.required.includes('a'));
      assert.ok(schema.required.includes('b'));
    });
  });

  describe('Operação: soma', () => {
    it('deve somar 2 + 3 e retornar 5', async () => {
      const result = await tool.execute({ operacao: 'soma', a: 2, b: 3 });
      assert.strictEqual(result.operacao, 'soma');
      assert.strictEqual(result.a, 2);
      assert.strictEqual(result.b, 3);
      assert.strictEqual(result.resultado, 5);
    });

    it('deve somar números negativos', async () => {
      const result = await tool.execute({ operacao: 'soma', a: -10, b: 5 });
      assert.strictEqual(result.resultado, -5);
    });
  });

  describe('Operação: subtracao', () => {
    it('deve subtrair 10 - 3 e retornar 7', async () => {
      const result = await tool.execute({ operacao: 'subtracao', a: 10, b: 3 });
      assert.strictEqual(result.resultado, 7);
    });

    it('deve subtrair resultando negativo', async () => {
      const result = await tool.execute({ operacao: 'subtracao', a: 3, b: 10 });
      assert.strictEqual(result.resultado, -7);
    });
  });

  describe('Operação: multiplicacao', () => {
    it('deve multiplicar 4 * 5 e retornar 20', async () => {
      const result = await tool.execute({ operacao: 'multiplicacao', a: 4, b: 5 });
      assert.strictEqual(result.resultado, 20);
    });

    it('deve multiplicar por zero', async () => {
      const result = await tool.execute({ operacao: 'multiplicacao', a: 9, b: 0 });
      assert.strictEqual(result.resultado, 0);
    });
  });

  describe('Operação: divisao', () => {
    it('deve dividir 10 / 2 e retornar 5', async () => {
      const result = await tool.execute({ operacao: 'divisao', a: 10, b: 2 });
      assert.strictEqual(result.resultado, 5);
    });

    it('deve retornar erro ao dividir por zero', async () => {
      const result = await tool.execute({ operacao: 'divisao', a: 10, b: 0 });
      assert.ok(result.error);
      assert.ok(result.error.includes('zero'));
    });

    it('deve retornar resultado decimal para divisão não exata', async () => {
      const result = await tool.execute({ operacao: 'divisao', a: 7, b: 3 });
      assert.ok(typeof result.resultado === 'number');
      assert.ok(result.resultado > 0);
    });
  });

  describe('Operação inválida', () => {
    it('deve retornar erro para operação desconhecida', async () => {
      const result = await tool.execute({ operacao: 'potencia', a: 2, b: 3 });
      assert.ok(result.error);
      assert.ok(result.error.includes('inválida'));
    });
  });

  describe('Validação de tipos', () => {
    it('deve retornar erro se "a" não for número', async () => {
      const result = await tool.execute({ operacao: 'soma', a: 'dois', b: 3 });
      assert.ok(result.error);
      assert.ok(result.error.includes('número'));
    });

    it('deve retornar erro se "operacao" não for string', async () => {
      const result = await tool.execute({ operacao: 123, a: 2, b: 3 });
      assert.ok(result.error);
      assert.ok(result.error.includes('string'));
    });
  });
});