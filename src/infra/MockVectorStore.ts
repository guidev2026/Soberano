/**
 * @file MockVectorStore.ts
 * @description Implementação mock do Vector Store (Memória Vetorial) para validação
 *              da lógica de armazenamento e busca por similaridade sem dependências externas.
 *
 *              Armazena vetores em memória (Map) e utiliza similaridade cosseno
 *              para ordenação dos resultados de busca.
 *
 *              Depende da abstração IVectorStore e injeta ILogger via construtor.
 */

import { IVectorStore } from '../core/IVectorStore.ts';
import { ILogger } from '../core/ILogger.ts';

export interface MockVectorStoreOptions {
  /** Instância de ILogger para logging estruturado */
  logger: ILogger;
}

interface VectorEntry {
  vector: number[];
  metadata: any;
}

export class MockVectorStore extends IVectorStore {
  private readonly store: Map<string, VectorEntry> = new Map();
  private readonly logger: ILogger;

  /**
   * @param options - Objeto de configuração seguindo o padrão Options Object.
   */
  constructor(options: MockVectorStoreOptions) {
    super();
    this.logger = options.logger;
  }

  /**
   * Adiciona um vetor ao armazenamento em memória.
   * Loga em DEBUG a operação para fins de rastreabilidade.
   *
   * @param id       - Identificador único do vetor
   * @param vector   - Vetor numérico representando o embedding
   * @param metadata - Metadados associados ao vetor
   * @throws {Error} Se o ID já existir no armazenamento
   */
  async adicionar(id: string, vector: number[], metadata: any): Promise<void> {
    if (this.store.has(id)) {
      throw new Error(`[MockVectorStore] Vector with id '${id}' already exists.`);
    }

    this.store.set(id, { vector, metadata });

    this.logger.debug(
      `[MockVectorStore] Vector added. id="${id}", vectorLength=${vector.length}, metadataKeys=${Object.keys(metadata).join(',')}`
    );
  }

  /**
   * Busca os N vetores mais similares usando similaridade cosseno.
   * Retorna array vazio se o armazenamento estiver vazio.
   *
   * @param vector - Vetor de consulta
   * @param limit  - Número máximo de resultados
   * @returns Array de resultados ordenados por score decrescente
   */
  async buscarSimilares(
    vector: number[],
    limit: number
  ): Promise<{ id: string; metadata: any; score: number }[]> {
    if (this.store.size === 0) {
      this.logger.debug('[MockVectorStore] No vectors stored. Returning empty result.');
      return [];
    }

    const entries = Array.from(this.store.entries());
    const scored: { id: string; metadata: any; score: number }[] = [];

    for (const [id, entry] of entries) {
      if (!entry) continue;
      const score = this.cosineSimilarity(vector, entry.vector);
      scored.push({ id, metadata: entry.metadata, score });
    }

    // Ordena por score decrescente (mais similar primeiro)
    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, limit);

    this.logger.debug(
      `[MockVectorStore] Similarity search completed. totalEntries=${entries.length}, returned=${results.length}`
    );

    return results;
  }

  /**
   * Calcula a similaridade cosseno entre dois vetores.
   *
   * similarity = (A · B) / (||A|| * ||B||)
   *
   * @param a - Primeiro vetor
   * @param b - Segundo vetor
   * @returns Valor entre -1 e 1 (1 = idênticos, 0 = ortogonais, -1 = opostos)
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(
        `[MockVectorStore] Vector dimension mismatch: a.length=${a.length}, b.length=${b.length}`
      );
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const ai = a[i] as number;
      const bi = b[i] as number;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    const magnitudeA = Math.sqrt(normA);
    const magnitudeB = Math.sqrt(normB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0; // Vetores nulos têm similaridade zero
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }
}