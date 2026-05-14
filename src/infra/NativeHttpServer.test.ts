/**
 * @file NativeHttpServer.test.ts
 * @description Testes unitários e de integração para NativeHttpServer utilizando
 *              node:test e node:assert (zero dependências externas).
 *
 *              - Testes de contrato (instanciação)
 *              - Testes de ciclo de vida (start/stop)
 *              - Testes de integração com AbortSignal (graceful shutdown)
 *              - Testes de requisições HTTP reais usando fetch nativo
 *
 * Como executar:
 *   node --experimental-transform-types --test src/infra/NativeHttpServer.test.ts
 */

import { describe, it, afterEach } from 'node:test';
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
  /** Lista de servidores para cleanup automático após cada teste */
  const servers: NativeHttpServer[] = [];

  afterEach(async () => {
    for (const server of servers) {
      try { await server.stop(); } catch { /* ignore */ }
    }
    servers.length = 0;
  });

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
      servers.push(server);

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

    it('deve ser idempotente: múltiplas chamadas a stop() resolvem imediatamente', async () => {
      const logger = new MockLogger();
      const server = new NativeHttpServer({ logger });
      servers.push(server);

      await server.start(0);
      assert.ok(logger.logs.some((log) => log.includes('listening')));

      // Primeira chamada: fecha de fato
      await server.stop();
      const closeLogs = logger.logs.filter((log) => log.includes('closed')).length;
      assert.ok(closeLogs >= 1, 'Deve haver ao menos um log de closed');

      // Segunda chamada: deve resolver imediatamente sem lançar
      await server.stop();
      assert.ok(true, 'Segunda chamada a stop() não lançou exceção');

      // Terceira chamada: também deve resolver
      await server.stop();
      assert.ok(true, 'Terceira chamada a stop() não lançou exceção');
    });
  });

  describe('Integração com AbortSignal', () => {
    /**
     * Helper que aguarda até que uma condição seja satisfeita,
     * com polling assíncrono em vez de um timeout fixo.
     */
    async function waitForCondition(condition: () => boolean, timeoutMs = 500): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (condition()) return;
        await new Promise<void>((resolve) => queueMicrotask(resolve));
      }
      throw new Error('Timeout: condição não foi satisfeita dentro do prazo');
    }

    it('deve parar o servidor quando o AbortSignal é disparado', async () => {
      const logger = new MockLogger();
      const controller = new AbortController();
      const server = new NativeHttpServer({ logger, abortSignal: controller.signal });
      servers.push(server);

      await server.start(0);
      assert.ok(logger.logs.some((log) => log.includes('listening')));

      // Dispara o sinal de aborto
      controller.abort();

      // Aguarda até que o servidor tenha sido fechado (baseado em eventos/estados)
      await waitForCondition(() =>
        logger.logs.some((log) => log.includes('closed') || log.includes('AbortSignal'))
      );

      // O servidor deve ter sido fechado (stop chamado internamente)
      assert.ok(
        logger.logs.some((log) => log.includes('closed') || log.includes('AbortSignal')),
        'Deve registrar que o AbortSignal foi recebido'
      );
    });
  });

  describe('Requisições HTTP reais', () => {
    it('GET /healthz deve retornar status 200, Content-Type JSON e corpo exato', async () => {
      const logger = new MockLogger();
      const server = new NativeHttpServer({ logger });
      servers.push(server);

      await server.start(0);
      const port = server.port;
      assert.ok(port !== null && port > 0, 'Porta deve ser atribuída após start(0)');

      const response = await fetch(`http://localhost:${port}/healthz`);

      assert.strictEqual(response.status, 200, 'Status deve ser 200');
      assert.ok(
        response.headers.get('Content-Type')?.includes('application/json'),
        'Content-Type deve conter application/json'
      );

      const body = await response.json();
      assert.deepStrictEqual(body, { status: 'ok', service: 'SOBERANO' });
    });

    it('rota inexistente deve retornar status 404 e corpo "Not Found"', async () => {
      const logger = new MockLogger();
      const server = new NativeHttpServer({ logger });
      servers.push(server);

      await server.start(0);
      const port = server.port;
      assert.ok(port !== null && port > 0, 'Porta deve ser atribuída após start(0)');

      const response = await fetch(`http://localhost:${port}/rota-inexistente`);

      assert.strictEqual(response.status, 404, 'Status deve ser 404');
      assert.ok(
        response.headers.get('Content-Type')?.includes('text/plain'),
        'Content-Type deve conter text/plain'
      );

      const text = await response.text();
      assert.strictEqual(text, 'Not Found');
    });
  });
});
