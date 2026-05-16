/**
 * @file SqliteVectorStore.ts
 * @description Implementação real de IVectorStore utilizando node:sqlite.
 *              Armazena vetores no banco e realiza a matemática de similaridade
 *              em JavaScript nativo para preservar o design de zero dependências (C++ libs).
 */

import { DatabaseSync } from 'node:sqlite';
import { IVectorStore } from '../core/IVectorStore.ts';
import { ILogger } from '../core/ILogger.ts';

export interface SqliteVectorStoreOptions {
  /** Logger para diagnóstico */
  logger: ILogger;
  /** Caminho para o banco de dados de vetores. Padrão: 'nexus_knowledge.db' */
  dbPath?: string;
}

export class SqliteVectorStore<M = any> extends IVectorStore<M> {
  private readonly db: DatabaseSync;
  private readonly logger: ILogger;

  constructor(options: SqliteVectorStoreOptions) {
    super();
    this.logger = options.logger;
    const dbPath = options.dbPath ?? 'nexus_knowledge.db';

    this.logger.info(`[SqliteVectorStore] Inicializando banco de vetores em: ${dbPath}`);
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
    // Para RAG Pessoal/Single-Tenant, carregar as linhas e fazer o Math na memória 
    // é rápido (milissegundos para poucos milhares de chunks).
    const stmt = this.db.prepare('SELECT id, vector, metadata FROM vectors');
    const rows = stmt.all() as Array<{ id: string; vector: string; metadata: string }>;

    if (rows.length === 0) {
      return [];
    }

    const scored: { id: string; metadata: M; score: number }[] = [];

    for (const row of rows) {
      try {
        const storedVector = JSON.parse(row.vector) as number[];
        const metadata = JSON.parse(row.metadata) as M;
        const score = this.cosineSimilarity(vector, storedVector);
        
        scored.push({ id: row.id, metadata, score });
      } catch (e) {
        this.logger.error(`[SqliteVectorStore] Erro ao parsear vetor ${row.id}: ${e}`);
      }
    }

    // Ordena do mais similar (maior score) para o menos similar
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
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
