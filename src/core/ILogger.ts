/**
 * @file ILogger.ts
 * @description Contrato de abstração para o sistema de logging.
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export abstract class ILogger {
  /** Informational message */
  abstract info(message: string): void;
  /** Warning that does not halt execution */
  abstract warn(message: string): void;
  /** Operational or critical error */
  abstract error(message: string): void;
  /** Debug message (development only) */
  abstract debug(message: string): void;
}
