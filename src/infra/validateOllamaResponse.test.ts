/**
 * @file validateOllamaResponse.test.ts
 * @description Testes unitários isolados para a função pura validateOllamaResponse.
 *              A função está exportada em OllamaProvider.ts e valida o schema
 *              de respostas da API Ollama /api/chat em runtime.
 *
 *              Como executar:
 *   node --experimental-transform-types --test src/infra/validateOllamaResponse.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateOllamaResponse } from './OllamaProvider.ts';

describe('validateOllamaResponse (função pura) - /api/chat', () => {
  describe('casos de erro — entrada nula/indefinida/não-objeto', () => {
    it('deve lançar erro para null', () => {
      assert.throws(
        () => validateOllamaResponse(null),
        /expected object/
      );
    });

    it('deve lançar erro para undefined', () => {
      assert.throws(
        () => validateOllamaResponse(undefined),
        /expected object/
      );
    });

    it('deve lançar erro para número (não-objeto)', () => {
      assert.throws(
        () => validateOllamaResponse(42),
        /expected object/
      );
    });

    it('deve lançar erro para string (não-objeto)', () => {
      assert.throws(
        () => validateOllamaResponse('string'),
        /expected object/
      );
    });
  });

  describe('casos de erro — objeto vazio', () => {
    it('deve lançar erro para objeto vazio {}', () => {
      assert.throws(
        () => validateOllamaResponse({}),
        /Field "model" missing or invalid/
      );
    });
  });

  describe('casos de erro — campos obrigatórios ausentes', () => {
    const validBase = {
      model: 'qwen2.5-coder:3b',
      message: { role: 'assistant', content: 'some text' },
      done: true,
      created_at: '2024-01-01T00:00:00Z',
    };

    it('deve lançar erro quando message está ausente', () => {
      const { message: _, ...withoutMessage } = validBase;
      assert.throws(
        () => validateOllamaResponse(withoutMessage),
        /Field "message" missing or invalid/
      );
    });

    it('deve lançar erro quando done está ausente', () => {
      const { done: _, ...withoutDone } = validBase;
      assert.throws(
        () => validateOllamaResponse(withoutDone),
        /Field "done" missing or invalid/
      );
    });

    it('deve lançar erro quando model está ausente', () => {
      const { model: _, ...withoutModel } = validBase;
      assert.throws(
        () => validateOllamaResponse(withoutModel),
        /Field "model" missing or invalid/
      );
    });

    it('deve lançar erro quando created_at está ausente', () => {
      const { created_at: _, ...withoutCreatedAt } = validBase;
      assert.throws(
        () => validateOllamaResponse(withoutCreatedAt),
        /Field "created_at" missing or invalid/
      );
    });

    it('deve lançar erro quando message.role está ausente', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 'x',
          message: { content: 'text' },
          done: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "message.role" missing or invalid/
      );
    });

    it('deve lançar erro quando message.content está ausente', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 'x',
          message: { role: 'assistant' },
          done: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "message.content" missing or invalid/
      );
    });
  });

  describe('casos de erro — campos obrigatórios com tipos errados', () => {
    it('deve lançar erro quando model não é string (number)', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 123,
          message: { role: 'assistant', content: 'ok' },
          done: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "model" missing or invalid/
      );
    });

    it('deve lançar erro quando message não é objeto (boolean)', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 'x',
          message: true,
          done: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "message" missing or invalid/
      );
    });

    it('deve lançar erro quando done não é boolean (string)', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 'x',
          message: { role: 'assistant', content: 'ok' },
          done: 'yes',
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "done" missing or invalid/
      );
    });

    it('deve lançar erro quando created_at não é string (number)', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 'x',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          created_at: 12345,
        }),
        /Field "created_at" missing or invalid/
      );
    });

    it('deve lançar erro quando model é null', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: null,
          message: { role: 'assistant', content: 'ok' },
          done: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "model" missing or invalid/
      );
    });

    it('deve lançar erro quando message.content não é string (objeto vazio)', () => {
      assert.throws(
        () => validateOllamaResponse({
          model: 'x',
          message: { role: 'assistant', content: {} },
          done: true,
          created_at: '2024-01-01T00:00:00Z',
        }),
        /Field "message.content" missing or invalid/
      );
    });
  });

  describe('casos de sucesso', () => {
    it('deve retornar o objeto validado para dados completos e corretos', () => {
      const input = {
        model: 'qwen2.5-coder:3b',
        created_at: '2024-05-14T16:00:00Z',
        message: {
          role: 'assistant',
          content: 'Resposta válida do modelo.',
        },
        done: true,
      };

      const result = validateOllamaResponse(input);

      assert.strictEqual(result.model, input.model);
      assert.strictEqual(result.created_at, input.created_at);
      assert.strictEqual(result.message.role, input.message.role);
      assert.strictEqual(result.message.content, input.message.content);
      assert.strictEqual(result.done, input.done);
    });

    it('deve preservar campos opcionais (total_duration, etc.)', () => {
      const input = {
        model: 'qwen2.5-coder:3b',
        created_at: '2024-05-14T16:00:00Z',
        message: {
          role: 'assistant',
          content: 'Resposta.',
        },
        done: true,
        total_duration: 1_234_567_890,
        load_duration: 100_000,
        prompt_eval_count: 42,
        prompt_eval_duration: 500_000,
        eval_count: 128,
        eval_duration: 2_000_000,
      };

      const result = validateOllamaResponse(input);

      assert.strictEqual(result.total_duration, input.total_duration);
      assert.strictEqual(result.load_duration, input.load_duration);
      assert.strictEqual(result.prompt_eval_count, input.prompt_eval_count);
      assert.strictEqual(result.prompt_eval_duration, input.prompt_eval_duration);
      assert.strictEqual(result.eval_count, input.eval_count);
      assert.strictEqual(result.eval_duration, input.eval_duration);
    });

    it('deve ignorar campos opcionais ausentes (undefined)', () => {
      const input = {
        model: 'qwen2.5-coder:3b',
        created_at: '2024-05-14T16:00:00Z',
        message: {
          role: 'assistant',
          content: 'Resposta.',
        },
        done: true,
        // total_duration, eval_duration etc. ausentes
      };

      const result = validateOllamaResponse(input);

      assert.strictEqual(result.total_duration, undefined);
      assert.strictEqual(result.eval_duration, undefined);
    });

    it('deve ignorar campos opcionais com tipos errados', () => {
      const input = {
        model: 'qwen2.5-coder:3b',
        created_at: '2024-05-14T16:00:00Z',
        message: {
          role: 'assistant',
          content: 'Resposta.',
        },
        done: true,
        total_duration: 'não-número', // tipo errado
      };

      const result = validateOllamaResponse(input);

      assert.strictEqual(result.total_duration, undefined);
    });

    it('deve preservar message.images quando presente', () => {
      const input = {
        model: 'qwen2.5-coder:3b',
        created_at: '2024-05-14T16:00:00Z',
        message: {
          role: 'assistant',
          content: 'Resposta com imagem.',
          images: ['base64data'],
        },
        done: true,
      };

      const result = validateOllamaResponse(input);

      assert.deepStrictEqual(result.message.images, ['base64data']);
    });
  });
});