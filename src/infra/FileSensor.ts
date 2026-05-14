/**
 * @file FileSensor.ts
 * @description Implementação concreta de ISensor<string> para leitura de arquivos
 *              locais utilizando o módulo nativo node:fs/promises.
 *
 *              Segue o DIP: a classe depende da abstração ILogger para logging,
 *              e implementa a abstração ISensor<string>.
 *
 *              A função readFile é injetável via Options Object para permitir
 *              mocking nos testes sem depender de arquivos reais em disco.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { ISensor } from '../core/ISensor.ts';
import { ILogger } from '../core/ILogger.ts';

export interface FileSensorOptions {
  /** Instância de ILogger para logging estruturado */
  logger: ILogger;
  /**
   * Função de leitura de arquivos injetável.
   * Padrão: readFile nativo de node:fs/promises.
   * Útil para testes com mock.
   */
  readFile?: (path: string, options?: { encoding?: string }) => Promise<string>;
}

export class FileSensor extends ISensor<string> {
  private readonly logger: ILogger;
  private readonly readFile: (path: string, options?: { encoding?: string }) => Promise<string>;

  /**
   * @param options - Objeto de configuração seguindo o padrão Options Object.
   */
  constructor(options: FileSensorOptions) {
    super();
    this.logger = options.logger;
    this.readFile = options.readFile ?? fsReadFile;
  }

  /**
   * Lê o conteúdo de um arquivo local como string UTF-8.
   *
   * @param target - Caminho absoluto ou relativo do arquivo a ser lido
   * @returns Conteúdo do arquivo em formato string
   * @throws {Error} Se o arquivo não existir, não puder ser lido, ou outro erro de I/O
   */
  async ler(target: string): Promise<string> {
    this.logger.debug(`[FileSensor] Attempting to read file: "${target}"`);

    try {
      const content = await this.readFile(target, { encoding: 'utf-8' });
      this.logger.debug(`[FileSensor] Successfully read file: "${target}" (${content.length} bytes)`);
      return content;
    } catch (error) {
      if (error instanceof Error) {
        const err = error as Error & { code?: string };

        switch (err.code) {
          case 'ENOENT':
            this.logger.error(`[FileSensor] File not found: "${target}"`);
            break;
          case 'EACCES':
            this.logger.error(`[FileSensor] Permission denied when reading file: "${target}"`);
            break;
          case 'EISDIR':
            this.logger.error(`[FileSensor] Path is a directory, not a file: "${target}"`);
            break;
          default:
            this.logger.error(`[FileSensor] Error reading file "${target}": ${err.message}`);
        }
      } else {
        this.logger.error(`[FileSensor] Unknown error reading file "${target}": ${String(error)}`);
      }

      throw error;
    }
  }
}
