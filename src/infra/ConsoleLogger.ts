/**
 * @file ConsoleLogger.ts
 * @description Implementação concreta de ILogger utilizando console do Node.js.
 *              Depende da abstração ILogger, não o contrário.
 */

import { ILogger, LogLevel } from '../core/ILogger.ts';

export class ConsoleLogger extends ILogger {
  private readonly prefix: string;
  private readonly level: LogLevel;

  constructor(prefix: string = 'SOBERANO', minLevel: LogLevel = LogLevel.INFO) {
    super();
    this.prefix = prefix;
    this.level = minLevel;
  }

  get minLevel(): LogLevel {
    return this.level;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${this.prefix}] [${level}] ${message}`;
  }

  info(message: string): void {
    if (this.level <= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message));
    }
  }

  warn(message: string): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message));
    }
  }

  error(message: string): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message));
    }
  }

  debug(message: string): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', message));
    }
  }
}
