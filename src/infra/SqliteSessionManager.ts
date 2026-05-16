/**
 * @file SqliteSessionManager.ts
 * @description Implementação do motor de persistência nativo utilizando `node:sqlite`.
 *              Garante a persistência local (Single-Tenant) do histórico sem
 *              dependências externas de pacotes NPM.
 * 
 *              Gerencia limite de contexto (pruning):
 *              - No INSERT: apaga mensagens não-system antigas do banco (pruning ativo).
 *              - No SELECT: retorna no máximo `maxMessagesPerSession` mensagens,
 *                sempre preservando a(s) mensagem(ns) `system` original(is).
 */

import { DatabaseSync } from 'node:sqlite';
import { ISessionManager } from '../core/ISessionManager.ts';
import type { ChatMessage } from '../core/IMotorCognitivo.ts';
import { ILogger } from '../core/ILogger.ts';

export interface SqliteSessionManagerOptions {
  /** Instância obrigatória de ILogger para logging */
  logger: ILogger;
  /** Caminho do arquivo de banco de dados SQLite. Padrão: 'nexus_core.db' */
  dbPath?: string;
  /**
   * Número máximo de mensagens retornadas no histórico por sessão.
   * A(s) mensagem(ns) `system` são SEMPRE preservadas.
   * Mensagens não-system mais antigas são descartadas (pruning ativo no INSERT).
   * Padrão: 50.
   */
  maxMessagesPerSession?: number;
}

export class SqliteSessionManager extends ISessionManager {
  private readonly db: DatabaseSync;
  private readonly logger: ILogger;
  private readonly maxMessagesPerSession: number;

  constructor(options: SqliteSessionManagerOptions) {
    super();
    this.logger = options.logger;
    this.maxMessagesPerSession = options.maxMessagesPerSession ?? 50;
    const dbPath = options.dbPath ?? 'nexus_core.db';

    this.logger.info(`[SqliteSessionManager] Inicializando banco de dados em: ${dbPath}`);
    this.logger.debug(
      `[SqliteSessionManager] maxMessagesPerSession configurado para: ${this.maxMessagesPerSession}`
    );
    this.db = new DatabaseSync(dbPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    // Cria a tabela local-first single-tenant
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_calls TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // Índice para otimizar busca por session_id
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    `);

    this.logger.debug('[SqliteSessionManager] Banco de dados preparado (Tabela: messages).');
  }

  async adicionarMensagem(sessionId: string, mensagem: ChatMessage): Promise<void> {
    // 1. Insere a nova mensagem
    const insertStmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const toolCallsJson = mensagem.tool_calls ? JSON.stringify(mensagem.tool_calls) : null;
    const toolCallId = mensagem.tool_call_id ?? null;

    insertStmt.run(
      sessionId,
      mensagem.role,
      mensagem.content,
      toolCallId,
      toolCallsJson,
      Date.now()
    );

    this.logger.debug(
      `[SqliteSessionManager] Mensagem adicionada à sessão "${sessionId}" (role: ${mensagem.role}).`
    );

    // 2. Pruning ativo: remove mensagens não-system mais antigas que excedam o limite
    // Subquery dupla necessária porque SQLite não aceita LIMIT dentro de IN subquery diretamente
    const pruneStmt = this.db.prepare(`
      DELETE FROM messages
      WHERE id IN (
        SELECT id FROM (
          SELECT id FROM messages
          WHERE session_id = ? AND role != 'system'
          ORDER BY id ASC
          LIMIT MAX(0, (
            (SELECT COUNT(*) FROM messages WHERE session_id = ? AND role != 'system') -
            MAX(0, ? - (SELECT COUNT(*) FROM messages WHERE session_id = ? AND role = 'system'))
          ))
        )
      )
    `);

    const result = pruneStmt.run(
      sessionId,
      sessionId,
      this.maxMessagesPerSession,
      sessionId
    ) as { changes: number };

    if (result.changes > 0) {
      this.logger.debug(
        `[SqliteSessionManager] Pruning: ${result.changes} mensagem(ns) antiga(s) removida(s) da sessão "${sessionId}".`
      );
    }
  }

  async obterHistorico(sessionId: string): Promise<ReadonlyArray<ChatMessage>> {
    const stmt = this.db.prepare(`
      SELECT role, content, tool_call_id, tool_calls
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `);

    const rows = stmt.all(sessionId) as Array<{
      role: string;
      content: string;
      tool_call_id: string | null;
      tool_calls: string | null;
    }>;

    // Separa mensagens system das demais
    const systemMessages = rows.filter(r => r.role === 'system');
    const nonSystemMessages = rows.filter(r => r.role !== 'system');

    // Aplica o limite de contexto: mantém as N mais recentes mensagens não-system
    const maxNonSystem = Math.max(0, this.maxMessagesPerSession - systemMessages.length);
    const trimmedNonSystem = nonSystemMessages.slice(-maxNonSystem);

    const combinedMessages = [...systemMessages, ...trimmedNonSystem];

    const historico = combinedMessages.map(row => {
      const msg: ChatMessage = {
        role: row.role as ChatMessage['role'],
        content: row.content,
      };

      if (row.tool_call_id) {
        msg.tool_call_id = row.tool_call_id;
      }

      if (row.tool_calls) {
        try {
          msg.tool_calls = JSON.parse(row.tool_calls);
        } catch (e) {
          this.logger.error(`[SqliteSessionManager] Falha ao parsear tool_calls JSON: ${e}`);
        }
      }

      return msg;
    });

    return historico;
  }

  async limparSessao(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM messages WHERE session_id = ?`);
    const result = stmt.run(sessionId) as { changes: number };

    if (result.changes > 0) {
      this.logger.debug(
        `[SqliteSessionManager] Sessão "${sessionId}" limpa. ${result.changes} mensagens removidas.`
      );
    } else {
      this.logger.debug(
        `[SqliteSessionManager] Sessão "${sessionId}" não encontrada para limpeza (no-op).`
      );
    }
  }

  /**
   * Encerra a conexão com o banco de dados de forma segura.
   */
  close(): void {
    try {
      this.db.close();
      this.logger.info(`[SqliteSessionManager] Conexão com banco de dados encerrada.`);
    } catch (e) {
      this.logger.error(`[SqliteSessionManager] Erro ao fechar DB: ${e}`);
    }
  }
}