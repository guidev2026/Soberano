/**
 * @file DeepSeekProvider.test.ts
 * @description Testes unitários para DeepSeekProvider
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekProvider } from './DeepSeekProvider.ts';
import { ConsoleLogger } from './ConsoleLogger.ts';
import { CircuitBreaker } from './CircuitBreaker.ts';
import type { ChatMessage } from '../core/IMotorCognitivo.ts';

describe('DeepSeekProvider', () => {
  let logger: ConsoleLogger;
  let circuitBreaker: CircuitBreaker;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    logger = new ConsoleLogger();
    // Silencia o logger para testes
    logger.info = () => {};
    logger.warn = () => {};
    logger.error = () => {};
    logger.debug = () => {};

    circuitBreaker = new CircuitBreaker({ logger, failureThreshold: 3, openTimeoutMs: 1000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  });

  it('deve lançar erro se não passar apiKey', () => {
    assert.throws(
      () => new DeepSeekProvider({ logger, apiKey: '', circuitBreaker }),
      /API Key is required/
    );
  });

  it('deve lançar erro se não passar circuitBreaker', () => {
    assert.throws(
      () => new DeepSeekProvider({ logger, apiKey: 'fake', circuitBreaker: undefined as any }),
      /CircuitBreaker is required/
    );
  });

  it('deve retornar mensagem correta em caso de sucesso', async () => {
    const provider = new DeepSeekProvider({
      logger,
      apiKey: 'fake-key',
      circuitBreaker,
    });

    const mockResponse = {
      id: 'test-id',
      object: 'chat.completion',
      created: 12345,
      model: 'deepseek-chat',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Olá do DeepSeek!'
        },
        finish_reason: 'stop'
      }]
    };

    globalThis.fetch = mock.fn(async () => {
      return {
        ok: true,
        json: async () => mockResponse
      } as Response;
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'Oi' }];
    const response = await provider.gerarResposta(messages);

    assert.equal(response.role, 'assistant');
    assert.equal(response.content, 'Olá do DeepSeek!');
  });

  it('deve lidar corretamente com tool_calls', async () => {
    const provider = new DeepSeekProvider({
      logger,
      apiKey: 'fake-key',
      circuitBreaker,
    });

    const mockResponse = {
      id: 'test-id',
      object: 'chat.completion',
      created: 12345,
      model: 'deepseek-chat',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {
              name: 'getWeather',
              arguments: '{"city":"São Paulo"}'
            }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    };

    globalThis.fetch = mock.fn(async () => {
      return {
        ok: true,
        json: async () => mockResponse
      } as Response;
    });

    const response = await provider.gerarResposta([{ role: 'user', content: 'Qual o clima?' }]);

    assert.equal(response.role, 'assistant');
    assert.ok(response.tool_calls);
    assert.equal(response.tool_calls!.length, 1);
    assert.equal(response.tool_calls![0]!.id, 'call_123');
    assert.equal(response.tool_calls![0]!.function.name, 'getWeather');
    assert.deepEqual(response.tool_calls![0]!.function.arguments, { city: 'São Paulo' });
  });

  it('deve falhar após retries em caso de erro 500', async () => {
    const provider = new DeepSeekProvider({
      logger,
      apiKey: 'fake-key',
      maxRetries: 2,
      delayBase: 10,
      circuitBreaker,
    });

    globalThis.fetch = mock.fn(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      } as Response;
    });

    await assert.rejects(
      async () => provider.gerarResposta([{ role: 'user', content: 'Oi' }]),
      /HTTP error 500/
    );

    // O fetch deve ser chamado maxRetries vezes (2 vezes)
    assert.equal((globalThis.fetch as any).mock.callCount(), 2);
  });

  it('não deve fazer retry em erro 401', async () => {
    const provider = new DeepSeekProvider({
      logger,
      apiKey: 'fake-key',
      maxRetries: 3,
      circuitBreaker,
    });

    globalThis.fetch = mock.fn(async () => {
      return {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      } as Response;
    });

    await assert.rejects(
      async () => provider.gerarResposta([{ role: 'user', content: 'Oi' }]),
      /HTTP error 401/
    );

    // Deve ser chamado apenas uma vez, pois 401 é irrecuperável
    assert.equal((globalThis.fetch as any).mock.callCount(), 1);
  });

  it('deve fazer retry em erro 429', async () => {
    const provider = new DeepSeekProvider({
      logger,
      apiKey: 'fake-key',
      maxRetries: 2,
      delayBase: 10,
      circuitBreaker,
    });

    globalThis.fetch = mock.fn(async () => {
      return {
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests'
      } as Response;
    });

    await assert.rejects(
      async () => provider.gerarResposta([{ role: 'user', content: 'Oi' }]),
      /HTTP error 429/
    );

    assert.equal((globalThis.fetch as any).mock.callCount(), 2);
  });
});
