/**
 * @file ConsoleLogger.ts
 * @description Implementação concreta de ILogger utilizando console do Node.js.
 *              Depende da abstração ILogger, não o contrário.
 */

import { ILogger } from '../core/ILogger.ts';

export class ConsoleLogger extends ILogger {
  private readonly prefix: string;

  constructor(prefix: string = 'SOBERANO') {
    super();
    this.prefix = prefix;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${this.prefix}] [${level}] ${message}`;
  }

  info(message: string): void {
    console.log(this.formatMessage('INFO', message));
  }

  warn(message: string): void {
    console.warn(this.formatMessage('WARN', message));
  }

  error(message: string): void {
    console.error(this.formatMessage('ERROR', message));
  }

  debug(message: string): void {
    console.log(this.formatMessage('DEBUG', message));
  }
}