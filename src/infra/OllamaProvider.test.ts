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
import { ICircuitBreaker, CircuitState } from '../core/ICircuitBreaker.ts';
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

/**
 * Mock de CircuitBreaker que sempre permite a execução (estado CLOSED).
 * Usado para satisfazer o requisito DIP nos testes do OllamaProvider.
 */
class MockCircuitBreaker extends ICircuitBreaker {
  get state(): CircuitState {
    return CircuitState.CLOSED;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  recordFailure(): void {
    // no-op
  }

  reset(): void {
    // no-op
  }
}

describe('OllamaProvider', () => {
  let fetchMock: ReturnType<typeof mock.method<typeof globalThis, 'fetch'>>;

  afterEach(() => {
    fetchMock?.mock.restore();
  });

  describe('Chamada fetch - gerarResposta', () => {
    it('deve chamar fetch com a URL e payload corretos (endpoint /api/chat)', async () => {
      const mockLogger = new MockLogger();

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;

      fetchMock = mock.method(globalThis, 'fetch', (url: RequestInfo | URL, options?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        capturedOptions = options;

        return new Response(JSON.stringify({
          model: 'test-model',
          created_at: new Date().toISOString(),
          message: {
            role: 'assistant',
            content: 'Resposta de teste do SOBERANO.',
          },
          done: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const mockCB = new MockCircuitBreaker();
      const provider = new OllamaProvider({ logger: mockLogger, baseUrl: 'http://localhost:11434', model: 'test-model', circuitBreaker: mockCB });

      const mensagens: ChatMessage[] = [{ role: 'user', content: 'Prompt de teste' }];
      const resposta = await provider.gerarResposta(mensagens);

      // Valida que fetch foi chamado na URL correta (/api/chat)
      assert.strictEqual(capturedUrl, 'http://localhost:11434/api/chat');

      // Valida que o payload foi enviado corretamente
      assert.ok(capturedOptions, 'fetch deve ter sido chamado com options');
      assert.strictEqual(capturedOptions!.method, 'POST');
      assert.strictEqual((capturedOptions!.headers as Record<string, string>)?.['Content-Type'], 'application/json');

      const sentBody = JSON.parse(capturedOptions!.body as string);
      assert.strictEqual(sentBody.model, 'test-model');
      assert.deepStrictEqual(sentBody.messages, [{ role: 'user', content: 'Prompt de teste' }]);
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

      const mockCB = new MockCircuitBreaker();
      const provider = new OllamaProvider({ logger: mockLogger, circuitBreaker: mockCB });
      await assert.rejects(
        () => provider.gerarResposta([{ role: 'user', content: 'teste' }]),
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

      const mockCB = new MockCircuitBreaker();
      const provider = new OllamaProvider({ logger: mockLogger, baseUrl: 'http://localhost:99999', model: 'test-model', delayBase: 1, circuitBreaker: mockCB });
      await assert.rejects(
        () => provider.gerarResposta([{ role: 'user', content: 'teste' }]),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('fetch failed'));
          }
          return true;
        }
      );

      // Valida o fluxo exato do loop de retry:
      // Tentativa 1 → falha → log WARN com retry
      // Tentativa 2 → falha → log WARN com retry
      // Tentativa 3 → falha → log ERROR de "All attempts failed"

      // Logs de retry: WARN com "Attempt X failed" e "Retrying"
      const retryLogs = mockLogger.logs.filter(
        (log) => log.startsWith('WARN:') && log.includes('failed') && log.includes('Retrying')
      );
      assert.strictEqual(retryLogs.length, 2, 'Deve haver 2 logs WARN de retry (Tentativa 1 e 2)');
      assert.ok(retryLogs[0]!.includes('Attempt 1'), 'Primeiro retry deve ser da Tentativa 1');
      assert.ok(retryLogs[1]!.includes('Attempt 2'), 'Segundo retry deve ser da Tentativa 2');

      // Log final de falha: ERROR com "All" e "attempts failed"
      const finalFailLog = mockLogger.logs.filter(
        (log) => log.startsWith('ERROR:') && log.includes('All') && log.includes('attempts failed')
      );
      assert.strictEqual(finalFailLog.length, 1, 'Deve haver exatamente 1 log de falha final');
      assert.ok(finalFailLog[0]!.includes('3 attempts failed'), 'Deve mencionar 3 tentativas falhas');
    });

    it('NÃO deve fazer retry para erros HTTP 4xx (não recuperáveis)', async () => {
      const mockLogger = new MockLogger();

      let callCount = 0;

      fetchMock = mock.method(globalThis, 'fetch', () => {
        callCount++;
        return new Response('Bad Request', { status: 400 });
      });

      const mockCB = new MockCircuitBreaker();
      const provider = new OllamaProvider({ logger: mockLogger, circuitBreaker: mockCB });
      await assert.rejects(() => provider.gerarResposta([{ role: 'user', content: 'teste' }]));
      // Deve ter chamado fetch apenas 1 vez (sem retry para 4xx)
      assert.strictEqual(callCount, 1, 'Não deve haver retry para erro HTTP 4xx');
    });
  });
});