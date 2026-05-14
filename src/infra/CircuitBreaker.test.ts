/**
 * @file CircuitBreaker.test.ts
 * @description Testes unitários para CircuitBreaker utilizando
 *              node:test e node:assert (zero dependências externas).
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/CircuitBreaker.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CircuitBreaker } from './CircuitBreaker.ts';
import { CircuitState } from '../core/ICircuitBreaker.ts';
import { ILogger } from '../core/ILogger.ts';

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

describe('CircuitBreaker', () => {
  describe('Estado inicial', () => {
    it('deve iniciar em CLOSED', () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger });
      assert.strictEqual(cb.state, CircuitState.CLOSED);
    });
  });

  describe('Transição CLOSED -> OPEN', () => {
    it('deve abrir após N falhas consecutivas (padrão: 3)', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 3, openTimeoutMs: 30_000 });

      const failingFn = () => Promise.reject(new Error('Falha simulada'));

      // Primeira falha: ainda CLOSED
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.CLOSED);

      // Segunda falha: ainda CLOSED
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.CLOSED);

      // Terceira falha: deve abrir
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);
    });

    it('deve abrir com threshold customizado', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 30_000 }); // abre na primeira falha

      const failingFn = () => Promise.reject(new Error('Falha simulada'));

      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);
    });
  });

  describe('Estado OPEN', () => {
    it('deve rejeitar chamadas imediatamente com erro', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 30_000 }); // abre na 1ª falha

      const failingFn = () => Promise.reject(new Error('Falha simulada'));
      await assert.rejects(() => cb.execute(failingFn)); // abre

      // Em OPEN, deve rejeitar sem chamar a função
      const successFn = () => Promise.resolve('ok');
      await assert.rejects(
        () => cb.execute(successFn),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('Circuit is open'));
          }
          return true;
        }
      );
    });

    it('deve registrar log de circuito aberto', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 30_000 });

      const failingFn = () => Promise.reject(new Error('Falha'));
      await assert.rejects(() => cb.execute(failingFn));

      // Tenta executar em estado OPEN
      const successFn = () => Promise.resolve('ok');
      await assert.rejects(() => cb.execute(successFn));

      assert.ok(
        logger.logs.some((log) => log.includes('OPEN')),
        'Deve registrar log de circuito aberto'
      );
    });
  });

  describe('Transição OPEN -> HALF_OPEN', () => {
    it('deve transitar para HALF_OPEN após o timeout expirar', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 1 }); // timeout mínimo

      const failingFn = () => Promise.reject(new Error('Falha'));
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);

      // Aguarda o timeout expirar
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Executa uma função de sucesso - isso aciona checkStateTransitions() internamente,
      // que deve transitar de OPEN para HALF_OPEN antes da lógica de decisão.
      const successFn = () => Promise.resolve('recuperado');
      const result = await cb.execute(successFn);
      assert.strictEqual(result, 'recuperado');

      // Após sucesso em HALF_OPEN, deve voltar para CLOSED
      assert.strictEqual(cb.state, CircuitState.CLOSED);
    });
  });

  describe('Transição HALF_OPEN -> CLOSED', () => {
    it('deve retornar para CLOSED após sucesso em HALF_OPEN', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 1 });

      const failingFn = () => Promise.reject(new Error('Falha'));
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);

      // Aguarda timeout para HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Executa com sucesso: checkStateTransitions() transita para HALF_OPEN,
      // depois a função executa com sucesso e volta para CLOSED
      const successFn = () => Promise.resolve('recuperado');
      const result = await cb.execute(successFn);
      assert.strictEqual(result, 'recuperado');
      assert.strictEqual(cb.state, CircuitState.CLOSED);
    });
  });

  describe('Transição HALF_OPEN -> OPEN', () => {
    it('deve voltar para OPEN após falha em HALF_OPEN', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 1 });

      const failingFn = () => Promise.reject(new Error('Falha'));
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);

      // Aguarda timeout para HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Falha em HALF_OPEN: checkStateTransitions() transita para HALF_OPEN,
      // a função falha e volta para OPEN
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);
    });
  });

  describe('Proteção de concorrência em HALF_OPEN', () => {
    it('deve rejeitar chamadas concorrentes quando probe já está em andamento', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 1 });

      // Abre o circuito
      const failingFn = () => Promise.reject(new Error('Falha'));
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);

      // Aguarda timeout para HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Cria uma função que nunca resolve (simula probe em andamento)
      let resolveProbe: (value: string) => void = () => {};
      const probePromise = new Promise<string>((resolve) => {
        resolveProbe = resolve;
      });
      const slowFn = () => probePromise;

      // Inicia a primeira chamada (probe) - não await aqui, queremos concorrência
      const firstCall = cb.execute(slowFn);

      // A segunda chamada concorrente deve ser rejeitada
      const successFn = () => Promise.resolve('ok');
      await assert.rejects(
        () => cb.execute(successFn),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('Circuit is open'));
          }
          return true;
        }
      );

      // Finaliza a probe para evitar hanging
      resolveProbe('done');
      const result = await firstCall;
      assert.strictEqual(result, 'done');

      // Após sucesso, deve estar em CLOSED
      assert.strictEqual(cb.state, CircuitState.CLOSED);
    });
  });

  describe('recordFailure e reset', () => {
    it('recordFailure deve incrementar contagem e abrir ao atingir threshold', () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 2, openTimeoutMs: 30_000 });

      cb.recordFailure();
      assert.strictEqual(cb.state, CircuitState.CLOSED);

      cb.recordFailure();
      assert.strictEqual(cb.state, CircuitState.OPEN);
    });

    it('reset deve voltar ao estado CLOSED', async () => {
      const logger = new MockLogger();
      const cb = new CircuitBreaker({ logger, failureThreshold: 1, openTimeoutMs: 30_000 });

      const failingFn = () => Promise.reject(new Error('Falha'));
      await assert.rejects(() => cb.execute(failingFn));
      assert.strictEqual(cb.state, CircuitState.OPEN);

      cb.reset();
      assert.strictEqual(cb.state, CircuitState.CLOSED);

      // Após reset, deve executar novamente
      const successFn = () => Promise.resolve('ok');
      const result = await cb.execute(successFn);
      assert.strictEqual(result, 'ok');
    });
  });
});