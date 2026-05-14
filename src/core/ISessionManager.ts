/**
 * @file ISessionManager.ts
 * @description Contrato de abstração para o gerenciador de sessões de chat.
 *              Responsável por armazenar e recuperar o histórico de mensagens
 *              de uma sessão multi-turno. Segue o DIP: módulos de alto nível
 *              dependem desta abstração, não de implementações concretas.
 */

import type { ChatMessage } from './IMotorCognitivo.ts';

export abstract class ISessionManager {
  /**
   * Adiciona uma mensagem ao histórico de uma sessão.
   * Se a sessão não existir, ela é criada automaticamente.
   * @param sessionId - Identificador único da sessão.
   * @param mensagem  - Mensagem no formato ChatMessage a ser adicionada.
   */
  abstract adicionarMensagem(sessionId: string, mensagem: ChatMessage): Promise<void>;

  /**
   * Recupera o histórico completo de mensagens de uma sessão,
   * na ordem em que foram adicionadas (da mais antiga para a mais recente).
   * @param sessionId - Identificador único da sessão.
   * @returns Array de mensagens no formato ChatMessage[].
   */
  abstract obterHistorico(sessionId: string): Promise<ChatMessage[]>;

  /**
   * Remove todo o histórico de uma sessão, liberando a memória.
   * @param sessionId - Identificador único da sessão a ser limpa.
   */
  abstract limparSessao(sessionId: string): Promise<void>;
}