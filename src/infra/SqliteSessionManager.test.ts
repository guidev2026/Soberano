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
  
  describe('Pruning (limite de contexto)', () => {
    it('deve limitar o histórico a maxMessagesPerSession mensagens (padrão 50)', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:' });

      // Adiciona 1 system + 55 mensagens não-system = 56 total
      await manager.adicionarMensagem('sessao-limit', { role: 'system', content: 'Você é um assistente.' });
      for (let i = 1; i <= 55; i++) {
        await manager.adicionarMensagem('sessao-limit', { role: 'user', content: `Mensagem ${i}` });
      }

      const historico = await manager.obterHistorico('sessao-limit');
      
      // Deve ter 1 system + 49 não-system = 50 (maxMessagesPerSession = 50)
      assert.strictEqual(historico.length, 50, 'Deve retornar no máximo 50 mensagens');
      assert.strictEqual(historico[0].role, 'system', 'Primeira mensagem deve ser system');
      assert.strictEqual(historico[0].content, 'Você é um assistente.', 'System message intacta');
      // Verifica que as últimas mensagens são as mais recentes (49..55 mas só cabem 49 não-system)
      assert.strictEqual(historico[historico.length - 1].content, 'Mensagem 55', 'Última deve ser a mais recente');
      
      manager.close();
    });

    it('deve preservar a mensagem system mesmo quando o limite é excedido', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:', maxMessagesPerSession: 3 });

      // 1 system + 5 mensagens não-system = 6 total, limite é 3
      await manager.adicionarMensagem('sessao-system', { role: 'system', content: 'System prompt.' });
      await manager.adicionarMensagem('sessao-system', { role: 'user', content: 'msg1' });
      await manager.adicionarMensagem('sessao-system', { role: 'assistant', content: 'resp1' });
      await manager.adicionarMensagem('sessao-system', { role: 'user', content: 'msg2' });
      await manager.adicionarMensagem('sessao-system', { role: 'assistant', content: 'resp2' });
      await manager.adicionarMensagem('sessao-system', { role: 'user', content: 'msg3' });

      const historico = await manager.obterHistorico('sessao-system');
      
      // Sistema (1) + 2 não-system mais recentes = 3
      assert.strictEqual(historico.length, 3, 'Deve ter 3 mensagens (1 system + 2 não-system)');
      assert.strictEqual(historico[0].role, 'system', 'Primeira mensagem sempre é system');
      assert.strictEqual(historico[0].content, 'System prompt.', 'System message intacta');
      
      // As 2 mensagens não-system mais recentes devem ser 'resp2' e 'msg3'
      const nonSystemContents = historico.filter(m => m.role !== 'system').map(m => m.content);
      assert.deepStrictEqual(nonSystemContents, ['resp2', 'msg3'], 'Deve manter apenas as 2 mensagens não-system mais recentes');
      
      manager.close();
    });

    it('deve funcionar com várias mensagens system e limite customizado', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:', maxMessagesPerSession: 5 });

      // 2 system + 10 não-system = 12 total, limite 5
      await manager.adicionarMensagem('sessao-multi-system', { role: 'system', content: 'System 1' });
      await manager.adicionarMensagem('sessao-multi-system', { role: 'user', content: 'user1' });
      await manager.adicionarMensagem('sessao-multi-system', { role: 'system', content: 'System 2' });
      for (let i = 2; i <= 10; i++) {
        await manager.adicionarMensagem('sessao-multi-system', { role: 'user', content: `user${i}` });
      }

      const historico = await manager.obterHistorico('sessao-multi-system');
      
      // 2 system + 3 não-system mais recentes = 5
      assert.strictEqual(historico.length, 5, 'Deve ter 5 mensagens (2 system + 3 não-system)');
      
      const systemMessages = historico.filter(m => m.role === 'system');
      assert.strictEqual(systemMessages.length, 2, 'Deve preservar ambas as system messages');
      assert.strictEqual(systemMessages[0].content, 'System 1');
      assert.strictEqual(systemMessages[1].content, 'System 2');
      
      const nonSystemMessages = historico.filter(m => m.role !== 'system');
      assert.strictEqual(nonSystemMessages.length, 3, 'Deve ter 3 mensagens não-system');
      assert.strictEqual(nonSystemMessages[0].content, 'user8');
      assert.strictEqual(nonSystemMessages[1].content, 'user9');
      assert.strictEqual(nonSystemMessages[2].content, 'user10');
      
      manager.close();
    });

    it('deve retornar menos mensagens que o limite quando o histórico é menor', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:', maxMessagesPerSession: 100 });

      await manager.adicionarMensagem('sessao-pequena', { role: 'system', content: 'Sys' });
      await manager.adicionarMensagem('sessao-pequena', { role: 'user', content: 'Hi' });

      const historico = await manager.obterHistorico('sessao-pequena');
      assert.strictEqual(historico.length, 2, 'Deve retornar todas as mensagens quando abaixo do limite');
      assert.strictEqual(historico[0].content, 'Sys');
      assert.strictEqual(historico[1].content, 'Hi');
      
      manager.close();
    });

    it('deve aplicar pruning ativo no INSERT (mensagens antigas removidas do banco)', async () => {
      const logger = new MockLogger();
      const manager = new SqliteSessionManager({ logger, dbPath: ':memory:', maxMessagesPerSession: 3 });

      // Adiciona 1 system + 10 usuário = 11 mensagens
      await manager.adicionarMensagem('sessao-prune', { role: 'system', content: 'Sys.' });
      for (let i = 1; i <= 10; i++) {
        await manager.adicionarMensagem('sessao-prune', { role: 'user', content: `msg${i}` });
      }

      const historico = await manager.obterHistorico('sessao-prune');
      assert.strictEqual(historico.length, 3, 'Deve ter 3 mensagens (1 system + 2 user mais recentes)');
      assert.strictEqual(historico[0].content, 'Sys.', 'System intacta');
      assert.strictEqual(historico[1].content, 'msg9');
      assert.strictEqual(historico[2].content, 'msg10');
      
      manager.close();
    });
  });
});
