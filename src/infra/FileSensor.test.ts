/**
 * @file FileSensor.test.ts
 * @description Testes unitários para FileSensor utilizando node:test e node:assert.
 *              Utiliza injeção de readFile mock via Options Object para simular
 *              o sistema de arquivos sem depender de arquivos reais em disco.
 *
 * Como executar:
 *   node --experimental-transform-types src/infra/FileSensor.test.ts
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { FileSensor } from './FileSensor.ts';
import { ILogger } from '../core/ILogger.ts';

class MockLogger extends ILogger {
  public logs: string[] = [];
  public errorMessages: string[] = [];

  info(message: string): void {
    this.logs.push(`INFO: ${message}`);
  }
  warn(message: string): void {
    this.logs.push(`WARN: ${message}`);
  }
  error(message: string): void {
    this.errorMessages.push(message);
    this.logs.push(`ERROR: ${message}`);
  }
  debug(message: string): void {
    this.logs.push(`DEBUG: ${message}`);
  }
}

describe('FileSensor', () => {
  describe('Leitura bem-sucedida', () => {
    it('deve retornar o conteúdo do arquivo quando a leitura é bem-sucedida', async () => {
      const logger = new MockLogger();
      const fakeContent = 'conteúdo simulado do arquivo';
      const mockReadFile = async () => fakeContent;

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });
      const result = await sensor.ler('/fake/path/file.txt');

      assert.strictEqual(result, fakeContent);
    });
  });

  describe('Erro: arquivo não encontrado (ENOENT)', () => {
    it('deve registrar erro e propagar exceção quando o arquivo não existe', async () => {
      const logger = new MockLogger();
      const enoentError = new Error('ENOENT: no such file or directory');
      (enoentError as Error & { code: string }).code = 'ENOENT';
      const mockReadFile = async () => { throw enoentError; };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });

      await assert.rejects(() => sensor.ler('/not/found.txt'));

      assert.ok(
        logger.errorMessages.some((msg) => msg.includes('File not found')),
        'Deve registrar erro de arquivo não encontrado'
      );
    });
  });

  describe('Erro: permissão negada (EACCES)', () => {
    it('deve registrar erro e propagar exceção quando a permissão é negada', async () => {
      const logger = new MockLogger();
      const eaccesError = new Error('EACCES: permission denied');
      (eaccesError as Error & { code: string }).code = 'EACCES';
      const mockReadFile = async () => { throw eaccesError; };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });

      await assert.rejects(() => sensor.ler('/no/perm.txt'));

      assert.ok(
        logger.errorMessages.some((msg) => msg.includes('Permission denied')),
        'Deve registrar erro de permissão negada'
      );
    });
  });

  describe('Erro: caminho é diretório (EISDIR)', () => {
    it('deve registrar erro e propagar exceção quando o caminho é um diretório', async () => {
      const logger = new MockLogger();
      const eisdirError = new Error('EISDIR: illegal operation on a directory');
      (eisdirError as Error & { code: string }).code = 'EISDIR';
      const mockReadFile = async () => { throw eisdirError; };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });

      await assert.rejects(() => sensor.ler('/path/to/dir'));

      assert.ok(
        logger.errorMessages.some((msg) => msg.includes('Path is a directory')),
        'Deve registrar erro de caminho é diretório'
      );
    });
  });

  describe('Erro genérico de I/O', () => {
    it('deve registrar erro genérico e propagar exceção para outros erros', async () => {
      const logger = new MockLogger();
      const genericError = new Error('EREMOTE: some I/O error');
      (genericError as Error & { code: string }).code = 'EREMOTE';
      const mockReadFile = async () => { throw genericError; };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });

      await assert.rejects(() => sensor.ler('/some/file.bin'));

      assert.ok(
        logger.errorMessages.some((msg) => msg.includes('Error reading file')),
        'Deve registrar erro genérico de I/O'
      );
    });
  });

  describe('Erro não-Error (tipo inesperado)', () => {
    it('deve registrar erro desconhecido quando o erro não é uma instância de Error', async () => {
      const logger = new MockLogger();
      const mockReadFile = async () => { throw 'string error'; };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });

      await assert.rejects(() => sensor.ler('/weird.txt'));

      assert.ok(
        logger.errorMessages.some((msg) => msg.includes('Unknown error')),
        'Deve registrar erro desconhecido'
      );
    });
  });

  describe('Cancelamento via AbortSignal', () => {
    it('deve propagar exceção e registrar aviso quando o sinal é abortado', async () => {
      const logger = new MockLogger();
      const abortError = new Error('ABORT_ERR: the operation was aborted');
      (abortError as Error & { code: string }).code = 'ABORT_ERR';
      const mockReadFile = async (_path: string, _options?: { encoding?: string; signal?: AbortSignal }) => { throw abortError; };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });

      await assert.rejects(() => sensor.ler('/aborted.txt'));

      assert.ok(
        logger.logs.some((msg) => msg.includes('WARN') && msg.includes('aborted')),
        'Deve registrar aviso de operação abortada'
      );
    });

    it('deve repassar o AbortSignal para a função readFile subjacente', async () => {
      const logger = new MockLogger();
      const fakeContent = 'conteúdo simulado';
      let capturedOptions: { encoding?: string; signal?: AbortSignal } | undefined;

      const mockReadFile = async (_path: string, options?: { encoding?: string; signal?: AbortSignal }): Promise<string> => {
        capturedOptions = options;
        return fakeContent;
      };

      const sensor = new FileSensor({ logger, readFile: mockReadFile as any });
      const controller = new AbortController();
      const signal = controller.signal;

      await sensor.ler('/test.txt', signal);

      assert.ok(capturedOptions !== undefined, 'readFile deve receber um objeto de opções');
      assert.strictEqual(capturedOptions!.encoding, 'utf-8', 'deve solicitar encoding utf-8');
      assert.strictEqual(capturedOptions!.signal, signal, 'o signal recebido deve ser repassado para readFile');
    });

    it('deve repassar o AbortSignal para readFile (verificado com mock.fn)', async () => {
      const logger = new MockLogger();
      const fakeContent = 'conteúdo simulado';

      const mockReadFile = async (_path: string, _options?: { encoding?: string; signal?: AbortSignal }): Promise<string> => {
        return fakeContent;
      };

      const mockFn = mock.fn(mockReadFile);
      const sensor = new FileSensor({ logger, readFile: mockFn as any });
      const controller = new AbortController();
      const signal = controller.signal;

      await sensor.ler('/mock-fn-test.txt', signal);

      // Verifica que mock.fn foi chamado exatamente uma vez
      assert.strictEqual(mockFn.mock.callCount(), 1, 'readFile deve ser chamado exatamente uma vez');

      const firstCall = mockFn.mock.calls[0];
      assert.ok(firstCall !== undefined, 'Deve haver ao menos uma chamada registrada');
      const callArgs = firstCall!.arguments;
      assert.ok(callArgs.length >= 2, 'readFile deve receber path e options');
      assert.strictEqual(callArgs[0], '/mock-fn-test.txt', 'path deve ser o esperado');

      const options = callArgs[1] as { encoding?: string; signal?: AbortSignal };
      assert.ok(options !== undefined, 'deve receber objeto de opções');
      assert.strictEqual(options.encoding, 'utf-8', 'encoding deve ser utf-8');
      assert.strictEqual(options.signal, signal, 'o AbortSignal deve ser repassado para readFile');
    });
  });
});
