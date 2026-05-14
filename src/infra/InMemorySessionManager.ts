/**
 * @file InMemorySessionManager.ts
 * @description Implementação concreta de ISessionManager utilizando
 *              armazenamento em memória (Map<string, ChatMessage[]>).
 *              - Depende da abstração ISessionManager, não o contrário (DIP).
 *              - Logger injetado via construtor (Options Object).
 *              - Suporta limite máximo de mensagens por sessão.
 *              - Quando o limite é excedido, a mensagem não-system mais antiga é removida.
 */

import { ISessionManager } from '../core/ISessionManager.ts';
import type { ChatMessage } from '../core/IMotorCognitivo.ts';
import { ILogger } from '../core/ILogger.ts';

export interface InMemorySessionManagerOptions {
  /** Instância obrigatória de ILogger para logging */
  logger: ILogger;
  /** Número máximo de mensagens por sessão. Quando excedido,
   *  a mensagem não-system mais antiga é removida. Opcional. */
  maxMessagesPerSession?: number;
}

export class InMemorySessionManager extends ISessionManager {
  private readonly sessions: Map<string, ChatMessage[]>;
  private readonly logger: ILogger;
  private readonly maxMessagesPerSession: number;

  /**
   * @param options - Objeto de configuração (InMemorySessionManagerOptions).
   *                  Apenas `logger` é obrigatório.
   */
  constructor(options: InMemorySessionManagerOptions) {
    super();
    this.logger = options.logger;
    this.sessions = new Map();
    this.maxMessagesPerSession = options.maxMessagesPerSession ?? 50;
  }

  /**
   * Adiciona uma mensagem ao histórico de uma sessão.
   * Se a sessão não existir, ela é criada automaticamente.
   * Se o limite maxMessagesPerSession for excedido, a mensagem
   * não-system mais antiga é removida antes da inserção.
   *
   * @param sessionId - Identificador único da sessão.
   * @param mensagem  - Mensagem no formato ChatMessage a ser adicionada.
   */
  async adicionarMensagem(sessionId: string, mensagem: ChatMessage): Promise<void> {
    const historico = this.sessions.get(sessionId) ?? [];

    // Se atingiu o limite, remove a mensagem não-system mais antiga
    if (historico.length >= this.maxMessagesPerSession) {
      const indexToRemove = historico.findIndex((m) => m.role !== 'system');
      if (indexToRemove !== -1) {
        historico.splice(indexToRemove, 1);
        this.logger.debug(
          `[InMemorySessionManager] Session "${sessionId}" reached max limit. ` +
          `Removed oldest non-system message.`
        );
      }
    }

    historico.push(mensagem);
    this.sessions.set(sessionId, historico);

    this.logger.debug(
      `[InMemorySessionManager] Mensagem adicionada à sessão "${sessionId}". ` +
      `Role: ${mensagem.role}, total messages: ${historico.length}`
    );
  }

  /**
   * Recupera o histórico completo de mensagens de uma sessão,
   * na ordem em que foram adicionadas (da mais antiga para a mais recente).
   *
   * @param sessionId - Identificador único da sessão.
   * @returns Array de mensagens no formato ChatMessage[].
   */
  async obterHistorico(sessionId: string): Promise<ChatMessage[]> {
    const historico = this.sessions.get(sessionId);
    if (!historico) {
      this.logger.debug(
        `[InMemorySessionManager] Session "${sessionId}" not found. Returning empty array.`
      );
      return [];
    }
    return [...historico]; // retorna uma cópia para evitar mutação externa
  }

  /**
   * Remove todo o histórico de uma sessão, liberando a memória.
   *
   * @param sessionId - Identificador único da sessão a ser limpa.
   */
  async limparSessao(sessionId: string): Promise<void> {
    const existed = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);

    if (existed) {
      this.logger.debug(
        `[InMemorySessionManager] Session "${sessionId}" cleared.`
      );
    } else {
      this.logger.debug(
        `[InMemorySessionManager] Session "${sessionId}" not found for clearing (no-op).`
      );
    }
  }
}