/**
 * @file SqliteSessionManager.ts
 * @description Implementação do motor de persistência nativo utilizando `node:sqlite`.
 *              Garante a persistência local (Single-Tenant) do histórico sem
 *              dependências externas de pacotes NPM.
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
}

export class SqliteSessionManager extends ISessionManager {
  private readonly db: DatabaseSync;
  private readonly logger: ILogger;

  constructor(options: SqliteSessionManagerOptions) {
    super();
    this.logger = options.logger;
    const dbPath = options.dbPath ?? 'nexus_core.db';

    this.logger.info(`[SqliteSessionManager] Inicializando banco de dados em: ${dbPath}`);
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
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Serializar o array de tool_calls para JSON se estiver presente
    const toolCallsJson = mensagem.tool_calls ? JSON.stringify(mensagem.tool_calls) : null;
    const toolCallId = mensagem.tool_call_id ?? null;

    stmt.run(
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

    const historico = rows.map(row => {
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
    const result = stmt.run(sessionId) as any;

    if (result && result.changes && result.changes > 0) {
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
