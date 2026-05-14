/**
 * @file OllamaProvider.test.ts
 * @description Testes unitários para OllamaProvider utilizando
 *              node:test e node:assert (zero dependências externas).
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/OllamaProvider.test.ts
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { OllamaProvider } from './OllamaProvider.ts';
import { ILogger } from '../core/ILogger.ts';

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

describe('OllamaProvider', () => {
  let fetchMock: ReturnType<typeof mock.method<typeof globalThis, 'fetch'>>;

  afterEach(() => {
    fetchMock?.mock.restore();
  });

  describe('Chamada fetch - gerarResposta', () => {
    it('deve chamar fetch com a URL e payload corretos', async () => {
      const mockLogger = new MockLogger();

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;

      fetchMock = mock.method(globalThis, 'fetch', (url: RequestInfo | URL, options?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        capturedOptions = options;

        return new Response(JSON.stringify({
          model: 'test-model',
          created_at: new Date().toISOString(),
          response: 'Resposta de teste do SOBERANO.',
          done: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new OllamaProvider({ logger: mockLogger, baseUrl: 'http://localhost:11434', model: 'test-model' });
      const resposta = await provider.gerarResposta('Prompt de teste');

      // Valida que fetch foi chamado na URL correta
      assert.strictEqual(capturedUrl, 'http://localhost:11434/api/generate');

      // Valida que o payload foi enviado corretamente
      assert.ok(capturedOptions, 'fetch deve ter sido chamado com options');
      assert.strictEqual(capturedOptions!.method, 'POST');
      assert.strictEqual((capturedOptions!.headers as Record<string, string>)?.['Content-Type'], 'application/json');

      const sentBody = JSON.parse(capturedOptions!.body as string);
      assert.strictEqual(sentBody.model, 'test-model');
      assert.strictEqual(sentBody.prompt, 'Prompt de teste');
      assert.strictEqual(sentBody.stream, false);

      // Valida que a resposta foi processada corretamente
      assert.strictEqual(resposta, 'Resposta de teste do SOBERANO.');

      // Valida que o logger registrou a operação
      assert.ok(
        mockLogger.logs.some((log) => log.includes('Attempt 1/3')),
        'Logger deve registrar a tentativa de envio'
      );
      assert.ok(
        mockLogger.logs.some((log) => log.includes('succeeded')),
        'Logger deve registrar sucesso'
      );
    });

    it('deve lançar erro HTTP quando resposta não for ok', async () => {
      const mockLogger = new MockLogger();

      fetchMock = mock.method(globalThis, 'fetch', () => {
        return new Response(JSON.stringify({ error: 'Model not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new OllamaProvider({ logger: mockLogger });
      await assert.rejects(
        () => provider.gerarResposta('teste'),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('HTTP error 404'));
          }
          return true;
        }
      );
    });

    it('deve fazer retry em caso de erro de conexão e falhar após 3 tentativas', async () => {
      const mockLogger = new MockLogger();

      // Fetch que sempre falha com TypeError (erro de conexão)
      fetchMock = mock.method(globalThis, 'fetch', () => {
        throw new TypeError('fetch failed: connection refused');
      });

      const provider = new OllamaProvider({ logger: mockLogger, baseUrl: 'http://localhost:99999', model: 'test-model' });
      await assert.rejects(
        () => provider.gerarResposta('teste'),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('fetch failed'));
          }
          return true;
        }
      );

      // Valida que o logger registrou 3 tentativas
      const retryLogs = mockLogger.logs.filter(
        (log) => log.includes('Attempt') && log.includes('failed')
      );
      assert.strictEqual(retryLogs.length, 2, 'Deve haver 2 logs de falha com retry');

      const errorLog = mockLogger.logs.find((log) => log.includes('All'));
      assert.ok(errorLog, 'Deve haver log informando que todas as tentativas falharam');
      assert.ok(errorLog!.includes('3 attempts failed'));
    });

    it('NÃO deve fazer retry para erros HTTP 4xx (não recuperáveis)', async () => {
      const mockLogger = new MockLogger();

      let callCount = 0;

      fetchMock = mock.method(globalThis, 'fetch', () => {
        callCount++;
        return new Response('Bad Request', { status: 400 });
      });

      const provider = new OllamaProvider({ logger: mockLogger });
      await assert.rejects(() => provider.gerarResposta('teste'));
      // Deve ter chamado fetch apenas 1 vez (sem retry para 4xx)
      assert.strictEqual(callCount, 1, 'Não deve haver retry para erro HTTP 4xx');
    });
  });
});
