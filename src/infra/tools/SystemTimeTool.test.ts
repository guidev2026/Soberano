/**
 * @file SystemTimeTool.test.ts
 * @description Testes unitários para SystemTimeTool utilizando node:test e node:assert.
 *              Verifica o contrato da ferramenta de sistema (data/hora ISO 8601).
 *
 * Como executar:
 *   node --experimental-transform-types --test src/infra/tools/SystemTimeTool.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SystemTimeTool } from './SystemTimeTool.ts';

describe('SystemTimeTool', () => {
  const tool = new SystemTimeTool();

  describe('Metadados da ferramenta', () => {
    it('deve ter o nome "get_system_time"', () => {
      assert.strictEqual(tool.name, 'get_system_time');
    });

    it('deve ter uma descrição não vazia', () => {
      assert.ok(tool.description.length > 0);
      assert.strictEqual(typeof tool.description, 'string');
    });

    it('deve ter um parametersSchema vazio (object sem propriedades required)', () => {
      const schema = tool.parametersSchema;
      assert.strictEqual(schema.type, 'object');
      assert.deepStrictEqual(schema.properties, {});
      assert.ok(Array.isArray(schema.required));
      assert.strictEqual(schema.required.length, 0);
    });

    it('getDefinition() deve retornar a definição compatível com IToolDefinition', () => {
      const def = tool.getDefinition();
      assert.strictEqual(def.type, 'function');
      assert.strictEqual(def.function.name, 'get_system_time');
      assert.ok(def.function.description.length > 0);
      assert.strictEqual(def.function.parameters.type, 'object');
    });
  });

  describe('Execução', () => {
    it('execute({}) deve retornar uma string ISO 8601 válida', async () => {
      const result = await tool.execute({});
      assert.strictEqual(typeof result, 'string');

      // Valida formato ISO 8601: "2026-05-15T03:00:00.000Z"
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      assert.ok(isoRegex.test(result), `Result "${result}" does not match ISO 8601 format`);
    });

    it('deve retornar uma data válida (new Date não retorna Invalid Date)', async () => {
      const result = await tool.execute({});
      const date = new Date(result);
      assert.ok(date instanceof Date);
      assert.ok(!isNaN(date.getTime()));
    });

    it('deve ser executado sem argumentos e sem lançar erro', async () => {
      // A ferramenta não requer parâmetros, então qualquer args vazio deve funcionar
      const result1 = await tool.execute({});
      const result2 = await tool.execute(undefined as any);
      const result3 = await tool.execute(null as any);

      assert.strictEqual(typeof result1, 'string');
      assert.strictEqual(typeof result2, 'string');
      assert.strictEqual(typeof result3, 'string');
    });

    it('deve retornar tempos diferentes em chamadas consecutivas (não é cacheado)', async () => {
      const result1 = await tool.execute({});
      // Pequena pausa forçada para garantir timestamp diferente
      await new Promise(resolve => setTimeout(resolve, 5));
      const result2 = await tool.execute({});

      assert.ok(result1 !== result2);
    });
  });
});