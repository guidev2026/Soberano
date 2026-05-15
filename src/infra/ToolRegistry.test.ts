/**
 * @file ToolRegistry.test.ts
 * @description Testes unitários para ToolRegistry utilizando node:test e node:assert.
 *              Verifica o registro, consulta e o novo comportamento de lançar Error
 *              em caso de nomes duplicados (ao invés de sobrescrever).
 *
 * Como executar:
 *   node --experimental-transform-types --test src/infra/ToolRegistry.test.ts
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

import { ToolRegistry } from './ToolRegistry.ts';
import { ITool } from '../core/ITool.ts';
import { ILogger } from '../core/ILogger.ts';

// ---------- Mocks concretos ----------

class MockLogger extends ILogger {
  info = mock.fn();
  warn = mock.fn();
  error = mock.fn();
  debug = mock.fn();
}

class MockTool extends ITool {
  constructor(
    private readonly _name: string,
    private readonly _description: string = `Tool ${_name}`
  ) {
    super();
  }

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  get parametersSchema(): Record<string, any> {
    return { type: 'object', properties: {}, required: [] };
  }

  async execute(_args: Record<string, any>): Promise<any> {
    return `executed ${this._name}`;
  }
}

// ---------- Helper para criar instância limpa ----------
function criarRegistry(): { logger: MockLogger; registry: ToolRegistry } {
  const logger = new MockLogger();
  const registry = new ToolRegistry({ logger });
  return { logger, registry };
}

// ---------- Testes ----------

describe('ToolRegistry', () => {
  describe('registrar()', () => {
    it('deve registrar uma ferramenta com sucesso', () => {
      const { logger, registry } = criarRegistry();
      const tool = new MockTool('tool_a');
      registry.registrar(tool);

      assert.strictEqual(registry.obter('tool_a'), tool);
      assert.strictEqual(logger.info.mock.calls.length, 1);
    });

    it('deve lançar Error ao registrar nome duplicado', () => {
      const { registry } = criarRegistry();
      const toolA = new MockTool('tool_a');
      const toolADup = new MockTool('tool_a');

      registry.registrar(toolA);

      assert.throws(
        () => registry.registrar(toolADup),
        {
          name: 'Error',
          message: /already registered/i,
        }
      );
    });

    it('deve permitir registrar múltiplas ferramentas com nomes diferentes', () => {
      const { registry } = criarRegistry();
      const toolA = new MockTool('tool_a');
      const toolB = new MockTool('tool_b');

      registry.registrar(toolA);
      registry.registrar(toolB);

      assert.strictEqual(registry.obterTodas().length, 2);
    });
  });

  describe('obter()', () => {
    it('deve retornar a ferramenta quando o nome existe', () => {
      const { registry } = criarRegistry();
      const tool = new MockTool('my_tool');
      registry.registrar(tool);

      const result = registry.obter('my_tool');
      assert.strictEqual(result, tool);
    });

    it('deve retornar undefined quando o nome não existe', () => {
      const { registry } = criarRegistry();
      const result = registry.obter('non_existent');
      assert.strictEqual(result, undefined);
    });

    it('deve ser case-sensitive', () => {
      const { registry } = criarRegistry();
      const tool = new MockTool('CaseSensitive');
      registry.registrar(tool);

      assert.strictEqual(registry.obter('CaseSensitive'), tool);
      assert.strictEqual(registry.obter('casesensitive'), undefined);
    });
  });

  describe('obterTodas()', () => {
    it('deve retornar array vazio quando nenhuma ferramenta foi registrada', () => {
      const { registry } = criarRegistry();
      const todas = registry.obterTodas();
      assert.ok(Array.isArray(todas));
      assert.strictEqual(todas.length, 0);
    });

    it('deve retornar todas as ferramentas registradas', () => {
      const { registry } = criarRegistry();
      const toolA = new MockTool('a');
      const toolB = new MockTool('b');
      const toolC = new MockTool('c');

      registry.registrar(toolA);
      registry.registrar(toolB);
      registry.registrar(toolC);

      const todas = registry.obterTodas();
      assert.strictEqual(todas.length, 3);
      assert.ok(todas.includes(toolA));
      assert.ok(todas.includes(toolB));
      assert.ok(todas.includes(toolC));
    });
  });
});