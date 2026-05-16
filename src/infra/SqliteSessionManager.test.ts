/**
 * @file SqliteSessionManager.test.ts
 * @description Testes unitários para SqliteSessionManager utilizando
 *              node:test, node:assert e banco de dados em memória (:memory:).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SqliteSessionManager } from './SqliteSessionManager.ts';
import { ILogger } from '../core/ILogger.ts';
import type { ChatMessage } from '../core/IMotorCognitivo.ts';

class MockLogger extends ILogger {
  public logs: string[] = [];
  info(message: string): void { this.logs.push(`INFO: ${message}`); }
  warn(message: string): void { this.logs.push(`WARN: ${message}`); }
  error(message: string): void { this.logs.push(`ERROR: ${message}`); }
  debug(message: string): void { this.logs.push(`DEBUG: ${message}`); }
}

describe('SqliteSessionManager', () => {
  describe('adicionarMensagem e obterHistorico', () => {
    it('deve adicionar mensagens a uma sessão e recuperá-las na ordem correta', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:' });

      const msg1: ChatMessage = { role: 'system', content: 'You are a helpful assistant.' };
      const msg2: ChatMessage = { role: 'user', content: 'Olá!' };
      const msg3: ChatMessage = { role: 'assistant', content: 'Olá! Como posso ajudar?' };

      await manager.adicionarMensagem('sessao-1', msg1);
      await manager.adicionarMensagem('sessao-1', msg2);
      await manager.adicionarMensagem('sessao-1', msg3);

      const historico = await manager.obterHistorico('sessao-1');

      assert.strictEqual(historico.length, 3, 'Deve haver 3 mensagens no histórico');
      assert.strictEqual(historico[0].content, msg1.content, 'Primeira mensagem deve ser system');
      assert.strictEqual(historico[1].content, msg2.content, 'Segunda mensagem deve ser user');
      assert.strictEqual(historico[2].content, msg3.content, 'Terceira mensagem deve ser assistant');
      
      manager.close();
    });

    it('deve retornar array vazio para sessão inexistente', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:' });

      const historico = await manager.obterHistorico('sessao-inexistente');
      assert.ok(Array.isArray(historico), 'Deve retornar um array');
      assert.strictEqual(historico.length, 0, 'Array deve estar vazio');
      
      manager.close();
    });
    
    it('deve armazenar e recuperar tool_calls corretamente', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:' });

      const msg: ChatMessage = { 
        role: 'assistant', 
        content: '', 
        tool_calls: [{ id: 'call_123', function: { name: 'calc', arguments: { a: 1 } } }] 
      };
      
      await manager.adicionarMensagem('sessao-tool', msg);
      
      const historico = await manager.obterHistorico('sessao-tool');
      assert.strictEqual(historico.length, 1);
      assert.deepStrictEqual(historico[0].tool_calls, msg.tool_calls);
      
      manager.close();
    });
  });

  describe('limparSessao', () => {
    it('deve limpar o histórico de uma sessão existente', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:' });

      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg1' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg2' });

      let historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 2);

      await manager.limparSessao('sessao-1');

      historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 0, 'Histórico deve estar vazio após limpeza');
      
      manager.close();
    });
  });
  
  describe('Isolamento entre sessões', () => {
    it('deve manter históricos independentes para diferentes sessionIds', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:' });

      await manager.adicionarMensagem('sessao-A', { role: 'user', content: 'msg-A' });
      await manager.adicionarMensagem('sessao-B', { role: 'user', content: 'msg-B' });

      const historicoA = await manager.obterHistorico('sessao-A');
      const historicoB = await manager.obterHistorico('sessao-B');

      assert.strictEqual(historicoA.length, 1);
      assert.strictEqual(historicoA[0]!.content, 'msg-A');
      assert.strictEqual(historicoB.length, 1);
      assert.strictEqual(historicoB[0]!.content, 'msg-B');
      
      manager.close();
    });
  });
});
