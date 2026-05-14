/**
 * @file ILogger.ts
 * @description Contrato de abstração para o sistema de logging.
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas.
 */

export abstract class ILogger {
  /** Mensagem informativa padrão */
  abstract info(message: string): void;
  /** Aviso que não impede a execução mas merece atenção */
  abstract warn(message: string): void;
  /** Erro operacional recuperável ou crítico */
  abstract error(message: string): void;
  /** Mensagem de depuração (desenvolvimento) */
  abstract debug(message: string): void;
}
