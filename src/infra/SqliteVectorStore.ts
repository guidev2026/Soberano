/**
 * @file SqliteVectorStore.ts
 * @description Implementação real de IVectorStore utilizando node:sqlite.
 *              Armazena vetores no banco e realiza a matemática de similaridade
 *              em JavaScript nativo para preservar o design de zero dependências (C++ libs).
 *
 * ============================================================================
 * LIMITAÇÕES ARQUITETURAIS (ABORDAGEM PURAMENTE JS)
 * ============================================================================
 *
 * 1. Cálculo de similaridade em JavaScript puro:
 *    - Para bases com dezenas de milhares de registros, o custo O(n*d) de percorrer
 *      todos os vetores em JS se torna proibitivo (centenas de ms a segundos).
 *    - Solução ideal futura: migrar para um banco vetorial dedicado (pgvector,
 *      ChromaDB, Qdrant, etc.) que realiza ANN (Approximate Nearest Neighbors)
 *      com índices como HNSW ou IVF, reduzindo a complexidade para O(log n).
 *
 * 2. Chunking como paliativo (implementado abaixo):
 *    - A paginação com LIMIT/OFFSET reduz o pico de memória, mas não reduz
 *      o custo computacional total — apenas distribui a carga.
 *    - O gargalo de CPU permanece. O chunking é uma medida de contenção de
 *      memória RAM, não de desempenho.
 *
 * 3. Quando considerar reestruturação:
 *    - Se logs WARNING de tempo > 500ms aparecerem com frequência.
 *    - Se a base exceder ~50.000 vetores (chunks de 1.000 linhas).
 *    - Se o NEXUS crescer para múltiplos tenants ou usuários simultâneos.
 * ============================================================================
 */

import { DatabaseSync } from 'node:sqlite';
import { IVectorStore } from '../core/IVectorStore.ts';
import { ILogger } from '../core/ILogger.ts';

export interface SqliteVectorStoreOptions {
  /** Logger para diagnóstico */
  logger: ILogger;
  /** Caminho para o banco de dados de vetores. Padrão: 'nexus_knowledge.db' */
  dbPath?: string;
  /**
   * Tamanho do lote (chunk) para paginação na busca de similaridade.
   * Controla quantas linhas são carregadas por vez do SQLite para a RAM.
   * Padrão: 1000. Reduza para sistemas com pouca memória.
   */
  chunkSize?: number;
}

export class SqliteVectorStore<M = any> extends IVectorStore<M> {
  private readonly db: DatabaseSync;
  private readonly logger: ILogger;
  private readonly chunkSize: number;

  constructor(options: SqliteVectorStoreOptions) {
    super();
    this.logger = options.logger;
    this.chunkSize = options.chunkSize ?? 1000;
    const dbPath = options.dbPath ?? 'nexus_knowledge.db';

    this.logger.info(`[SqliteVectorStore] Inicializando banco de vetores em: ${dbPath} (chunkSize=${this.chunkSize})`);
    this.db = new DatabaseSync(dbPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    // Cria a tabela de vetores (vector armazenado como JSON)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.logger.debug('[SqliteVectorStore] Tabela "vectors" pronta.');
  }

  async adicionar(id: string, vector: number[], metadata: M): Promise<void> {
    const checkStmt = this.db.prepare('SELECT id FROM vectors WHERE id = ?');
    const existing = checkStmt.get(id);

    if (existing) {
      throw new Error(`[SqliteVectorStore] Vector with id '${id}' already exists.`);
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO vectors (id, vector, metadata, created_at)
      VALUES (?, ?, ?, ?)
    `);

    insertStmt.run(
      id,
      JSON.stringify(vector),
      JSON.stringify(metadata),
      Date.now()
    );

    this.logger.debug(`[SqliteVectorStore] Vetor '${id}' (dimensão: ${vector.length}) salvo no banco.`);
  }

  async buscarSimilares(vector: number[], limit: number): Promise<{ id: string; metadata: M; score: number }[]> {
    const startTime = performance.now();

    // ------------------------------------------------------------------
    // 1. Contagem total de registros para decidir estratégia de chunking
    // ------------------------------------------------------------------
    const countStmt = this.db.prepare('SELECT COUNT(*) AS total FROM vectors');
    const { total: totalRows } = countStmt.get() as { total: number };

    if (totalRows === 0) {
      this.logger.debug('[SqliteVectorStore] Nenhum vetor encontrado. Retornando vazio.');
      return [];
    }

    // ---------------------------------------------------------------
    // 2. Estratégia de busca: query única ou paginada (chunking)
    // ---------------------------------------------------------------
    // Nota arquitetural: O chunking com LIMIT/OFFSET reduz o pico de
    // consumo de RAM, mas não reduz o custo computacional total do
    // cálculo de similaridade em JS. Para bases muito grandes, isso
    // ainda será lento. A solução definitiva é um banco vetorial com
    // índices ANN (HNSW/IVF).
    // ---------------------------------------------------------------

    // Heap-like array: mantém apenas os top 'limit' resultados
    // para não acumular a base inteira em memória.
    const topResults: { id: string; metadata: M; score: number }[] = [];

    const selectStmt = this.db.prepare('SELECT id, vector, metadata FROM vectors LIMIT ? OFFSET ?');

    // Se a base cabe em um único chunk, otimiza para evitar múltiplas queries
    if (totalRows <= this.chunkSize) {
      const rows = selectStmt.all(this.chunkSize, 0) as Array<{ id: string; vector: string; metadata: string }>;
      for (const row of rows) {
        this.processRow(row, vector, topResults, limit);
      }
    } else {
      // Paginação incremental: busca em lotes de chunkSize
      let offset = 0;
      while (offset < totalRows) {
        const rows = selectStmt.all(this.chunkSize, offset) as Array<{ id: string; vector: string; metadata: string }>;

        for (const row of rows) {
          this.processRow(row, vector, topResults, limit);
        }

        offset += this.chunkSize;

        this.logger.debug(
          `[SqliteVectorStore] Chunk processado: offset=${offset - this.chunkSize}, ` +
          `linhas=${rows.length}, topResults=${topResults.length}`
        );
      }
    }

    // Ordena final (do mais similar para o menos similar)
    topResults.sort((a, b) => b.score - a.score);

    // ---------------------------------------------------------------
    // 3. Monitoramento de performance — alerta se > 500ms
    // ---------------------------------------------------------------
    // Esta é uma métrica paliativa. Se o tempo ultrapassar 500ms
    // consistentemente, indica que a base cresceu além do ponto onde
    // o cálculo em JS puro é viável. Ações recomendadas:
    //   - Migrar para pgvector, ChromaDB ou Qdrant
    //   - Implementar cache de resultados frequentes
    //   - Reduzir chunkSize para mitigar pico de memória
    // ---------------------------------------------------------------
    const elapsed = performance.now() - startTime;
    if (elapsed > 500) {
      this.logger.warn(
        `[SqliteVectorStore] A busca por similaridade levou ${elapsed.toFixed(0)}ms ` +
        `(${totalRows} vetores processados em chunks de ${this.chunkSize}). ` +
        `⚠️  ATENÇÃO: O banco vetorial precisa ser reestruturado. ` +
        `Considere migrar para um banco vetorial dedicado (pgvector, ChromaDB, Qdrant) ` +
        `com índices ANN (HNSW/IVF) para manter a performance em escala.`
      );
    } else {
      this.logger.debug(
        `[SqliteVectorStore] Busca concluída em ${elapsed.toFixed(1)}ms ` +
        `(${totalRows} vetores, retornou ${topResults.length})`
      );
    }

    return topResults.slice(0, limit);
  }

  /**
   * Processa uma linha do banco: calcula similaridade e mantém o heap
   * incremental dos top N resultados para não acumular a base inteira.
   */
  private processRow(
    row: { id: string; vector: string; metadata: string },
    queryVector: number[],
    topResults: { id: string; metadata: M; score: number }[],
    limit: number
  ): void {
    try {
      const storedVector = JSON.parse(row.vector) as number[];
      const metadata = JSON.parse(row.metadata) as M;
      const score = this.cosineSimilarity(queryVector, storedVector);

      // Mantém apenas os top 'limit' resultados (heap-like simplificado)
      if (topResults.length < limit) {
        topResults.push({ id: row.id, metadata, score });
      } else {
        // Encontra o menor score atual
        let minIdx = 0;
        let minScore = topResults[0]!.score;
        for (let i = 1; i < topResults.length; i++) {
          const s = topResults[i]!.score;
          if (s < minScore) {
            minScore = s;
            minIdx = i;
          }
        }
        // Substitui apenas se o novo score for maior que o pior do top
        if (score > minScore) {
          topResults[minIdx] = { id: row.id, metadata, score };
        }
      }
    } catch (e) {
      this.logger.error(`[SqliteVectorStore] Erro ao parsear vetor ${row.id}: ${e}`);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      // Retorna 0 para não crashear, mas loga.
      this.logger.warn(`Dimension mismatch: ${a.length} vs ${b.length}`);
      return 0; 
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
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  close(): void {
    try {
      this.db.close();
      this.logger.info('[SqliteVectorStore] Conexão encerrada.');
    } catch(e) {}
  }
}
