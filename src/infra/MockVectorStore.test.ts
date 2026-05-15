/**
 * @file MockVectorStore.test.ts
 * @description Testes unitários para MockVectorStore com foco no cosineSimilarity
 *              via método público buscarSimilares.
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/MockVectorStore.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MockVectorStore } from './MockVectorStore.ts';
import { ILogger } from '../core/ILogger.ts';

class MockLogger extends ILogger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}

describe('MockVectorStore', () => {
  describe('cosineSimilarity (via buscarSimilares)', () => {
    it('deve retornar score 1.0 para vetores idênticos', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      const vector = [1, 2, 3, 4, 5];
      await store.adicionar('id1', vector, { text: 'teste' });

      const results = await store.buscarSimilares(vector, 1);
      assert.strictEqual(results.length, 1);
      assert.ok(Math.abs(results[0]!.score - 1.0) < 0.0001, `Expected score ~1.0, got ${results[0]!.score}`);
    });

    it('deve retornar score 0 para vetores ortogonais', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      await store.adicionar('id1', [1, 0, 0], { text: 'eixo x' });

      const results = await store.buscarSimilares([0, 1, 0], 1);
      assert.strictEqual(results.length, 1);
      assert.ok(Math.abs(results[0]!.score - 0.0) < 0.0001, `Expected score ~0.0, got ${results[0]!.score}`);
    });

    it('deve retornar score 0 para vetor nulo', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      await store.adicionar('id1', [0, 0, 0], { text: 'nulo' });

      const results = await store.buscarSimilares([1, 2, 3], 1);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.score, 0, 'Vetor nulo deve ter score 0');
    });

    it('deve retornar scores ordenados do mais similar ao menos similar', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      // Query vector: [1, 0, 0]
      // id1 = [1, 0, 0] → cos = 1.0
      // id2 = [0, 1, 0] → cos = 0.0
      // id3 = [0.5, 0, 0] → cos = 1.0 (magnitude menor, mas dot product = 0.5, cos = 1.0)
      // id4 = [1, 1, 0] → cos ≈ 0.707
      await store.adicionar('id1', [1, 0, 0], { text: 'igual' });
      await store.adicionar('id2', [0, 1, 0], { text: 'ortogonal' });
      await store.adicionar('id4', [1, 1, 0], { text: 'diagonal' });

      const queryVector = [1, 0, 0];
      const results = await store.buscarSimilares(queryVector, 3);

      assert.strictEqual(results.length, 3);
      // Ordenação decrescente de score
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1]!.score >= results[i]!.score,
          `Results should be sorted descending. results[${i - 1}].score=${results[i - 1]!.score} < results[${i}].score=${results[i]!.score}`
        );
      }

      // id1 (identical) should have highest score
      assert.strictEqual(results[0]!.id, 'id1', 'Most similar should be id1');
    });

    it('deve retornar score ~ -1 para vetores opostos', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      await store.adicionar('id1', [1, 2, 3], { text: 'positivo' });

      const results = await store.buscarSimilares([-1, -2, -3], 1);
      assert.strictEqual(results.length, 1);
      assert.ok(Math.abs(results[0]!.score - (-1.0)) < 0.0001,
        `Expected score ~-1.0 for opposite vectors, got ${results[0]!.score}`
      );
    });

    it('deve lançar erro se dimensões forem diferentes entre query e stored', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      await store.adicionar('id1', [1, 2, 3], { text: '3d' });

      await assert.rejects(
        () => store.buscarSimilares([1, 2], 1),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('Vector dimension mismatch'));
          }
          return true;
        }
      );
    });

    it('deve respeitar o parâmetro limit', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      await store.adicionar('id1', [1, 0, 0], { text: 'a' });
      await store.adicionar('id2', [0, 1, 0], { text: 'b' });
      await store.adicionar('id3', [0, 0, 1], { text: 'c' });

      const results = await store.buscarSimilares([1, 0, 0], 2);
      assert.strictEqual(results.length, 2, 'Deve respeitar limit=2');
    });

    it('deve retornar array vazio se não houver vetores armazenados', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      const results = await store.buscarSimilares([1, 2, 3], 5);
      assert.strictEqual(results.length, 0, 'Store vazio deve retornar array vazio');
    });

    it('deve rejeitar ID duplicado no adicionar', async () => {
      const logger = new MockLogger();
      const store = new MockVectorStore<{ text: string }>({ logger });

      await store.adicionar('dup', [1, 2, 3], { text: 'primeiro' });
      await assert.rejects(
        () => store.adicionar('dup', [4, 5, 6], { text: 'segundo' }),
        (err: unknown) => {
          if (err instanceof Error) {
            assert.ok(err.message.includes('already exists'));
          }
          return true;
        }
      );
    });
  });
});