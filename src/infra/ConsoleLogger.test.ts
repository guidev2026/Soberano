/**
 * @file ConsoleLogger.test.ts
 * @description Testes unitários para ConsoleLogger utilizando mock.method
 *              do node:test para capturar chamadas a console.log, console.warn
 *              e console.error.
 *
 * Como executar:
 *   node --experimental-transform-types --test src/infra/ConsoleLogger.test.ts
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { ConsoleLogger } from './ConsoleLogger.ts';
import { LogLevel } from '../core/ILogger.ts';

describe('ConsoleLogger', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('Filtragem por nível mínimo (minLevel)', () => {
    it('não deve chamar console.log para DEBUG quando minLevel é INFO', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.INFO);

      logger.debug('mensagem debug');

      assert.strictEqual(logMock.mock.calls.length, 0, 'console.log não deve ser chamado para DEBUG com minLevel INFO');
    });

    it('deve chamar console.log para INFO quando minLevel é INFO', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.INFO);

      logger.info('mensagem info');

      assert.strictEqual(logMock.mock.calls.length, 1, 'console.log deve ser chamado para INFO');
    });

    it('deve chamar console.log para DEBUG quando minLevel é DEBUG', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.DEBUG);

      logger.debug('mensagem debug');

      assert.strictEqual(logMock.mock.calls.length, 1, 'console.log deve ser chamado para DEBUG com minLevel DEBUG');
    });

    it('não deve chamar console.log para INFO quando minLevel é ERROR', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.ERROR);

      logger.info('mensagem info');

      assert.strictEqual(logMock.mock.calls.length, 0, 'console.log não deve ser chamado para INFO com minLevel ERROR');
    });
  });

  describe('Métodos de saída corretos', () => {
    it('deve chamar console.warn para warn()', () => {
      const warnMock = mock.method(console, 'warn', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.WARN);

      logger.warn('aviso');

      assert.strictEqual(warnMock.mock.calls.length, 1, 'console.warn deve ser chamado para WARN');
    });

    it('deve chamar console.error para error()', () => {
      const errorMock = mock.method(console, 'error', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.ERROR);

      logger.error('falha crítica');

      assert.strictEqual(errorMock.mock.calls.length, 1, 'console.error deve ser chamado para ERROR');
    });
  });

  describe('Formato da mensagem', () => {
    it('deve conter o prefixo [SOBERANO] na mensagem logada', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.INFO);

      logger.info('teste de formato');

      assert.strictEqual(logMock.mock.calls.length, 1);
      const loggedMessage = logMock.mock.calls[0]?.arguments[0] as string;
      assert.ok(loggedMessage.includes('[SOBERANO]'), `Mensagem deve conter [SOBERANO], recebido: ${loggedMessage}`);
    });

    it('deve conter o nível [INFO] na mensagem logada', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.INFO);

      logger.info('teste de nível');

      assert.strictEqual(logMock.mock.calls.length, 1);
      const loggedMessage = logMock.mock.calls[0]?.arguments[0] as string;
      assert.ok(loggedMessage.includes('[INFO]'), `Mensagem deve conter [INFO], recebido: ${loggedMessage}`);
    });

    it('deve conter um timestamp ISO 8601 na mensagem logada', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.INFO);

      logger.info('teste de timestamp');

      assert.strictEqual(logMock.mock.calls.length, 1);
      const loggedMessage = logMock.mock.calls[0]?.arguments[0] as string;
      // Timestamp ISO: YYYY-MM-DDTHH:mm:ss.sssZ
      const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      assert.ok(isoRegex.test(loggedMessage), `Mensagem deve conter timestamp ISO, recebido: ${loggedMessage}`);
    });

    it('deve conter o nível [ERROR] ao logar um erro', () => {
      const errorMock = mock.method(console, 'error', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.ERROR);

      logger.error('erro grave');

      assert.strictEqual(errorMock.mock.calls.length, 1);
      const loggedMessage = errorMock.mock.calls[0]?.arguments[0] as string;
      assert.ok(loggedMessage.includes('[ERROR]'), `Mensagem deve conter [ERROR], recebido: ${loggedMessage}`);
    });

    it('deve conter o nível [WARN] ao logar um aviso', () => {
      const warnMock = mock.method(console, 'warn', () => {});
      const logger = new ConsoleLogger('SOBERANO', LogLevel.WARN);

      logger.warn('cuidado');

      assert.strictEqual(warnMock.mock.calls.length, 1);
      const loggedMessage = warnMock.mock.calls[0]?.arguments[0] as string;
      assert.ok(loggedMessage.includes('[WARN]'), `Mensagem deve conter [WARN], recebido: ${loggedMessage}`);
    });

    it('deve conter o prefixo personalizado passado no construtor', () => {
      const logMock = mock.method(console, 'log', () => {});
      const logger = new ConsoleLogger('CUSTOM', LogLevel.INFO);

      logger.info('prefixo custom');

      assert.strictEqual(logMock.mock.calls.length, 1);
      const loggedMessage = logMock.mock.calls[0]?.arguments[0] as string;
      assert.ok(loggedMessage.includes('[CUSTOM]'), `Mensagem deve conter [CUSTOM], recebido: ${loggedMessage}`);
    });
  });
});