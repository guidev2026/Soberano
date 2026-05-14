/**
 * @file main.ts
 * @description Ponto de entrada do sistema SOBERANO - Fase 2 (Sensores).
 *              Realiza o wiring manual (Injeção de Dependência) seguindo o DIP:
 *              - Instancia ConsoleLogger para logging estruturado
 *              - Instancia OllamaProvider com Logger injetado via construtor
 *              - Cria AbortController global para graceful shutdown
 *              - Injeta AbortSignal no OllamaProvider para cancelar fetch em andamento
 *              - Trata sinais do sistema (SIGINT/SIGTERM) para encerramento limpo
 *              - Inicializa NativeHttpServer para servir rota /healthz
 *              - Executa o teste inicial de comunicação com o motor cognitivo
 *              - Executa o teste do FileSensor (leitura de arquivo local)
 */

import { OllamaProvider } from './infra/OllamaProvider.ts';
import { IMotorCognitivo } from './core/IMotorCognitivo.ts';
import { ConsoleLogger } from './infra/ConsoleLogger.ts';
import { ILogger } from './core/ILogger.ts';
import { CircuitBreaker } from './infra/CircuitBreaker.ts';
import { NativeHttpServer } from './infra/NativeHttpServer.ts';
import { IHttpServer } from './core/IHttpServer.ts';
import { FileSensor } from './infra/FileSensor.ts';
import { ISensor } from './core/ISensor.ts';

/**
 * Sinalizador de encerramento usado pelas rotinas de graceful shutdown.
 * Quando true, o processo deve abortar qualquer operação em andamento
 * e finalizar o mais rápido possível.
 */
let isShuttingDown = false;

/**
 * Registra os handlers para sinais do sistema operacional.
 * SIGINT  -> Ctrl+C no terminal
 * SIGTERM -> kill padrão do sistema
 *
 * O encerramento é feito de forma limpa: aborta operações em andamento,
 * mensagem de log, sinalizador ligado e processo finalizado com código 0.
 *
 * @param logger            - Instância de ILogger para logging
 * @param shutdownController - AbortController global para cancelar operações
 */
function registerShutdownHandlers(
  logger: ILogger,
  shutdownController: AbortController
): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`[main] Signal ${signal} received again. Forcing exit.`);
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`[main] Signal ${signal} received. Initiating graceful shutdown...`);

    // Timeout to prevent the process from hanging
    const forceExitTimer = setTimeout(() => {
      logger.error('[main] Shutdown timeout exceeded. Forcing exit.');
      process.exit(1);
    }, 5_000);

    // Remove handlers to prevent loop
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    // Abort all in-flight operations (OllamaProvider fetch)
    shutdownController.abort();

    // 5s timer stays active during cleanup.
    // If future async cleanup operations lock up,
    // the timer fires and forces process.exit(1).

    clearTimeout(forceExitTimer);
    logger.info('[main] Resources released. Goodbye, SOBERANO.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('[main] Graceful shutdown handlers registered (SIGINT/SIGTERM).');
}

async function bootstrap(): Promise<void> {
  // --- LOGGING ESTRUTURADO ---
  const logger: ILogger = new ConsoleLogger('SOBERANO');

  logger.info(
    '╔══════════════════════════════════════════════════╗\n' +
    '║       SOBERANO - Fase 2 (Sensores)               ║\n' +
    '║       Inicializando sistemas...                  ║\n' +
    '╚══════════════════════════════════════════════════╝'
  );

  // --- ABORT CONTROLLER GLOBAL PARA GRACEFUL SHUTDOWN ---
  const shutdownController = new AbortController();

  // --- GRACEFUL SHUTDOWN ---
  registerShutdownHandlers(logger, shutdownController);

  // --- CIRCUIT BREAKER ---
  const circuitBreaker = new CircuitBreaker({ logger });

  // --- HTTP SERVER (Fase 3 - Comunicação) ---
  const httpServer: IHttpServer = new NativeHttpServer({
    logger,
    abortSignal: shutdownController.signal,
  });

  // --- GLOBAL TIMEOUT (fallback para evitar travamento silencioso) ---
  const globalTimeoutSignal = AbortSignal.timeout(120_000);
  const combinedSignal = AbortSignal.any([shutdownController.signal, globalTimeoutSignal]);

  // --- WIRING MANUAL (Injeção de Dependência) ---
  // A variável "motor" é tipada como IMotorCognitivo (abstração).
  // O módulo de alto nível (main.ts) depende da abstração, não da implementação concreta.
  // O Logger é injetado via construtor em ambas as dependências.
  const provider = new OllamaProvider({ logger, circuitBreaker });

  // Injeta o sinal combinado (shutdown + timeout global) para abort automático
  provider.setAbortSignal(combinedSignal);

  // A partir daqui, usa-se a abstração IMotorCognitivo
  const motor: IMotorCognitivo = provider;

  // --- INICIALIZAÇÃO DO SERVIDOR HTTP ---
  // Aceita porta via 3º argumento da CLI: npm start -- <caminho> <porta>
  const HTTP_PORT = Number(process.argv[3]) || 3000;
  await httpServer.start(HTTP_PORT);

  const promptTeste = 'Olá, Soberano. Confirme que seus sistemas base estão online.';

  logger.info(`[main] Sending prompt to cognitive engine...`);
  logger.info(`[main] Prompt: "${promptTeste}"`);

  try {
    const resposta = await motor.gerarResposta(promptTeste);

    logger.info(
      '╔══════════════════════════════════════════════════╗\n' +
      '║       RESPOSTA DO MOTOR COGNITIVO               ║\n' +
      '╚══════════════════════════════════════════════════╝'
    );
    logger.info(resposta);
    logger.info('[main] Test completed successfully.');

    // --- TESTE DO FILE SENSOR (Fase 2) ---
    // Aceita caminho de arquivo via argumento de linha de comando.
    // Uso: npm start -- <caminho> [porta]
    const filePath = process.argv[2];

    if (filePath) {
      logger.info(
        '╔══════════════════════════════════════════════════╗\n' +
        '║       FILE SENSOR - Demonstração                 ║\n' +
        '╚══════════════════════════════════════════════════╝'
      );

      const fileSensor: ISensor<string> = new FileSensor({ logger });

      try {
        const conteudo = await fileSensor.ler(filePath, combinedSignal);
        logger.info(`[main] Conteúdo do arquivo "${filePath}":`);
        logger.info(conteudo);
        logger.info('[main] FileSensor test completed successfully.');
      } catch (sensorError) {
        logger.error(`[main] FileSensor: Erro ao ler o arquivo "${filePath}".`);
        if (sensorError instanceof Error) {
          logger.error(sensorError.message);
        } else {
          logger.error(`[main] Unknown error: ${String(sensorError)}`);
        }
      }
    } else {
      logger.info('[main] Nenhum caminho de arquivo fornecido. Uso: npm start -- <caminho-do-arquivo> [porta]');
    }
  } catch (error) {
    // Se o erro foi causado pelo shutdown, não é uma falha real
    if (shutdownController.signal.aborted) {
      logger.info('[main] Operation cancelled due to system shutdown.');
      return;
    }

    logger.error(
      '╔══════════════════════════════════════════════════╗\n' +
      '║       ERRO NA COMUNICAÇÃO COM O MOTOR           ║\n' +
      '╚══════════════════════════════════════════════════╝'
    );

    if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error(`[main] Unknown error: ${String(error)}`);
    }

    logger.error('[main] O sistema não pôde se comunicar com o motor cognitivo.');
    logger.error('[main] Verifique se o servidor Ollama está em execução: ollama serve');

    // Exit with code 1 (error) without depending on @types/node
    process.exit(1);
  } finally {
    // Garante que o servidor HTTP seja parado ao finalizar (sucesso, erro ou shutdown)
    await httpServer.stop().catch((err) => {
      logger.error(`[main] Error stopping HTTP server: ${err}`);
    });
  }
}

bootstrap();