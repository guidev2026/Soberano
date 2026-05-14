/**
 * @file NativeHttpServer.test.ts
 * @description Testes unitários para NativeHttpServer utilizando
 *              node:test e node:assert (zero dependências externas).
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/NativeHttpServer.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NativeHttpServer } from './NativeHttpServer.ts';
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

describe('NativeHttpServer', () => {
  describe('Contrato (interface)', () => {
    it('deve ser instanciável com logger e sem abortSignal', () => {
      const logger = new MockLogger();
      const server = new NativeHttpServer({ logger });
      assert.ok(server instanceof NativeHttpServer);
    });

    it('deve ser instanciável com abortSignal', () => {
      const logger = new MockLogger();
      const controller = new AbortController();
      const server = new NativeHttpServer({ logger, abortSignal: controller.signal });
      assert.ok(server instanceof NativeHttpServer);
    });
  });

  describe('Ciclo de vida (start/stop)', () => {
    it('deve iniciar e parar o servidor na porta especificada', async () => {
      const logger = new MockLogger();
      const server = new NativeHttpServer({ logger });

      await server.start(0); // porta 0 = SO atribui porta aleatória
      assert.ok(logger.logs.some((log) => log.includes('listening')), 'Deve logar que está ouvindo');

      await server.stop();
      assert.ok(logger.logs.some((log) => log.includes('closed')), 'Deve logar que fechou');
    });

    it('deve chamar stop sem erro mesmo se nunca foi iniciado', async () => {
      const logger = new MockLogger();
      const server = new NativeHttpServer({ logger });

      // stop() sem start() não deve lançar
      await server.stop();
      assert.ok(true, 'stop() sem start() não lançou exceção');
    });
  });

  describe('Integração com AbortSignal', () => {
    it('deve parar o servidor quando o AbortSignal é disparado', async () => {
      const logger = new MockLogger();
      const controller = new AbortController();
      const server = new NativeHttpServer({ logger, abortSignal: controller.signal });

      await server.start(0);
      assert.ok(logger.logs.some((log) => log.includes('listening')));

      // Dispara o sinal de aborto
      controller.abort();

      // Aguarda um tick para o listener processar
      await new Promise((resolve) => setTimeout(resolve, 50));

      // O servidor deve ter sido fechado (stop chamado internamente)
      assert.ok(
        logger.logs.some((log) => log.includes('closed') || log.includes('AbortSignal')),
        'Deve registrar que o AbortSignal foi recebido'
      );
    });
  });
});