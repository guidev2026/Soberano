/**
 * @file InMemorySessionManager.test.ts
 * @description Testes unitários para InMemorySessionManager utilizando
 *              node:test e node:assert (zero dependências externas).
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/InMemorySessionManager.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { InMemorySessionManager } from './InMemorySessionManager.ts';
import { ILogger } from '../core/ILogger.ts';
import type { ChatMessage } from '../core/IMotorCognitivo.ts';

/**
 * Logger fictício (mock) que estende ILogger sem efeitos colaterais.
 * Usado para isolar os testes do sistema de logging real.
 */
class MockLogger extends ILogger {
  public logs: string[] = [];

  info(message: string): void {
    this.logs.push(`INFO: ${message}`);
  }
  warn(message: string): void {
    this.logs.push(`WARN: ${message}`);
  }
  error(message: string): void {
    this.logs.push(`ERROR: ${message}`);
  }
  debug(message: string): void {
    this.logs.push(`DEBUG: ${message}`);
  }
}

describe('InMemorySessionManager', () => {
  describe('adicionarMensagem e obterHistorico', () => {
    it('deve adicionar mensagens a uma sessão e recuperá-las na ordem correta', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      const msg1: ChatMessage = { role: 'system', content: 'You are a helpful assistant.' };
      const msg2: ChatMessage = { role: 'user', content: 'Olá!' };
      const msg3: ChatMessage = { role: 'assistant', content: 'Olá! Como posso ajudar?' };

      await manager.adicionarMensagem('sessao-1', msg1);
      await manager.adicionarMensagem('sessao-1', msg2);
      await manager.adicionarMensagem('sessao-1', msg3);

      const historico = await manager.obterHistorico('sessao-1');

      assert.strictEqual(historico.length, 3, 'Deve haver 3 mensagens no histórico');
      assert.deepStrictEqual(historico[0], msg1, 'Primeira mensagem deve ser system');
      assert.deepStrictEqual(historico[1], msg2, 'Segunda mensagem deve ser user');
      assert.deepStrictEqual(historico[2], msg3, 'Terceira mensagem deve ser assistant');
    });

    it('deve criar sessão automaticamente ao adicionar primeira mensagem', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      const msg: ChatMessage = { role: 'user', content: 'teste' };
      await manager.adicionarMensagem('nova-sessao', msg);

      const historico = await manager.obterHistorico('nova-sessao');
      assert.strictEqual(historico.length, 1);
      assert.deepStrictEqual(historico[0], msg);
    });

    it('deve retornar array vazio para sessão inexistente', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      const historico = await manager.obterHistorico('sessao-inexistente');
      assert.ok(Array.isArray(historico), 'Deve retornar um array');
      assert.strictEqual(historico.length, 0, 'Array deve estar vazio');
    });
  });

  describe('limparSessao', () => {
    it('deve limpar o histórico de uma sessão existente', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg1' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg2' });

      let historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 2);

      await manager.limparSessao('sessao-1');

      historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 0, 'Histórico deve estar vazio após limpeza');
    });

    it('não deve falhar ao limpar sessão inexistente', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      // Não deve lançar exceção
      await manager.limparSessao('sessao-inexistente');

      // O logger deve ter registrado a operação
      assert.ok(
        logger.logs.some((log) => log.includes('not found for clearing')),
        'Logger deve registrar que sessão não foi encontrada'
      );
    });

    it('deve permitir reuso da sessão após limpeza', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg1' });
      await manager.limparSessao('sessao-1');
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg2' });

      const historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 1, 'Deve conter apenas a nova mensagem');
      assert.strictEqual(historico[0]!.content, 'msg2');
    });
  });

  describe('Limite máximo de mensagens (maxMessagesPerSession)', () => {
    it('deve remover mensagem não-system mais antiga quando o limite é excedido', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger, maxMessagesPerSession: 3 });

      // Adiciona 3 mensagens (atinge o limite)
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg1' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg2' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg3' });

      // Adiciona a 4ª mensagem — deve remover a msg1 (não-system mais antiga)
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg4' });

      const historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 3, 'Deve manter no máximo 3 mensagens');
      assert.strictEqual(historico[0]!.content, 'msg2', 'msg1 deve ter sido removida');
      assert.strictEqual(historico[1]!.content, 'msg3');
      assert.strictEqual(historico[2]!.content, 'msg4');
    });

    it('deve preservar mensagens system ao remover as mais antigas', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger, maxMessagesPerSession: 4 });

      // Adiciona mensagem system primeiro
      await manager.adicionarMensagem('sessao-1', { role: 'system', content: 'Instrução do sistema' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg1' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg2' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg3' });

      // Atingiu o limite (4). Adiciona 5ª — deve remover msg1 (primeira não-system)
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'msg4' });

      const historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 4, 'Deve manter 4 mensagens');

      // system deve permanecer intacta
      assert.strictEqual(historico[0]!.role, 'system');
      assert.strictEqual(historico[0]!.content, 'Instrução do sistema');

      // msg1 foi removida, as demais estão na ordem
      assert.strictEqual(historico[1]!.content, 'msg2');
      assert.strictEqual(historico[2]!.content, 'msg3');
      assert.strictEqual(historico[3]!.content, 'msg4');
    });

    it('deve remover apenas mensagens não-system quando múltiplas system existem', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger, maxMessagesPerSession: 3 });

      await manager.adicionarMensagem('sessao-1', { role: 'system', content: 'sys1' });
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'user1' });
      await manager.adicionarMensagem('sessao-1', { role: 'assistant', content: 'assist1' });

      // Limite atingido (3). O array é: [system, user, assistant]
      // Adiciona mais um — deve remover user (primeiro não-system)
      await manager.adicionarMensagem('sessao-1', { role: 'user', content: 'user2' });

      const historico = await manager.obterHistorico('sessao-1');
      assert.strictEqual(historico.length, 3);
      assert.strictEqual(historico[0]!.role, 'system');
      assert.strictEqual(historico[0]!.content, 'sys1');
      assert.strictEqual(historico[1]!.role, 'assistant');
      assert.strictEqual(historico[1]!.content, 'assist1');
      assert.strictEqual(historico[2]!.role, 'user');
      assert.strictEqual(historico[2]!.content, 'user2');
    });
  });

  describe('Isolamento entre sessões', () => {
    it('deve manter históricos independentes para diferentes sessionIds', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      await manager.adicionarMensagem('sessao-A', { role: 'user', content: 'msg-A' });
      await manager.adicionarMensagem('sessao-B', { role: 'user', content: 'msg-B' });

      const historicoA = await manager.obterHistorico('sessao-A');
      const historicoB = await manager.obterHistorico('sessao-B');

      assert.strictEqual(historicoA.length, 1);
      assert.strictEqual(historicoA[0]!.content, 'msg-A');
      assert.strictEqual(historicoB.length, 1);
      assert.strictEqual(historicoB[0]!.content, 'msg-B');
    });
  });

  describe('Logging (DEBUG)', () => {
    it('deve registrar DEBUG ao adicionar mensagem', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      await manager.adicionarMensagem('sessao-log', { role: 'user', content: 'teste' });

      assert.ok(
        logger.logs.some((log) => log.includes('Mensagem adicionada à sessão')),
        'Logger deve registrar a adição de mensagem'
      );
    });

    it('deve registrar DEBUG ao limpar sessão', async () => {
      const logger = new MockLogger();
      const manager = new InMemorySessionManager({ logger });

      await manager.adicionarMensagem('sessao-log', { role: 'user', content: 'teste' });
      await manager.limparSessao('sessao-log');

      assert.ok(
        logger.logs.some((log) => log.includes('cleared')),
        'Logger deve registrar que sessão foi limpa'
      );
    });
  });
});