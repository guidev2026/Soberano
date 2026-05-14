/**
 * @file OllamaProvider.test.ts
 * @description Testes unitários para OllamaProvider utilizando
 *              node:test e node:assert (zero dependências externas).
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/OllamaProvider.test.ts
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { OllamaProvider } from './OllamaProvider.ts';
import { ILogger } from '../core/ILogger.ts';

/**
 * Logger fictício (mock) que estende ILogger sem efeitos colaterais.
 * Usado para isolar os testes do sistema de logging real.
 */
class MockLogger extends ILogger {
  public logs: string[] = [];

  constructor() {
    super();
  }

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
  describe('Chamada fetch - gerarResposta', () => {
    it('deve chamar fetch com a URL e payload corretos', async () => {
      const mockLogger = new MockLogger();

      // Mock global fetch que captura a chamada e retorna resposta simulada
      const originalFetch = globalThis.fetch;
      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;

      globalThis.fetch = async (url: RequestInfo | URL, options?: RequestInit) => {
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
      };

      try {
        const provider = new OllamaProvider(mockLogger, 'http://localhost:11434', 'test-model');
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
          mockLogger.logs.some((log) => log.includes('Tentativa 1/3')),
          'Logger deve registrar a tentativa de envio'
        );
        assert.ok(
          mockLogger.logs.some((log) => log.includes('bem-sucedida')),
          'Logger deve registrar sucesso'
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve lançar erro HTTP quando resposta não for ok', async () => {
      const mockLogger = new MockLogger();
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ error: 'Model not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      try {
        const provider = new OllamaProvider(mockLogger);
        await assert.rejects(
          () => provider.gerarResposta('teste'),
          (err: unknown) => {
            if (err instanceof Error) {
              assert.ok(err.message.includes('Erro HTTP 404'));
            }
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deve fazer retry em caso de erro de conexão e falhar após 3 tentativas', async () => {
      const mockLogger = new MockLogger();
      const originalFetch = globalThis.fetch;

      // Fetch que sempre falha com TypeError (erro de conexão)
      globalThis.fetch = async () => {
        throw new TypeError('fetch failed: connection refused');
      };

      try {
        const provider = new OllamaProvider(mockLogger, 'http://localhost:99999', 'test-model');
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
          (log) => log.includes('Tentativa') && log.includes('falhou')
        );
        assert.strictEqual(retryLogs.length, 2, 'Deve haver 2 logs de falha com retry');

        const errorLog = mockLogger.logs.find((log) => log.includes('Todas as'));
        assert.ok(errorLog, 'Deve haver log informando que todas as tentativas falharam');
        assert.ok(errorLog!.includes('3 tentativas falharam'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('NÃO deve fazer retry para erros HTTP 4xx (não recuperáveis)', async () => {
      const mockLogger = new MockLogger();
      const originalFetch = globalThis.fetch;

      let callCount = 0;

      globalThis.fetch = async () => {
        callCount++;
        return new Response('Bad Request', { status: 400 });
      };

      try {
        const provider = new OllamaProvider(mockLogger);
        await assert.rejects(() => provider.gerarResposta('teste'));
        // Deve ter chamado fetch apenas 1 vez (sem retry para 4xx)
        assert.strictEqual(callCount, 1, 'Não deve haver retry para erro HTTP 4xx');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});