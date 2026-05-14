/**
 * @file main.ts
 * @description Ponto de entrada do sistema SOBERANO - Fase 1 (CLI MVP).
 *              Realiza o wiring manual (Injeção de Dependência) seguindo o DIP:
 *              - Instancia ConsoleLogger para logging estruturado
 *              - Instancia OllamaProvider com Logger injetado via construtor
 *              - Cria AbortController global para graceful shutdown
 *              - Injeta AbortSignal no OllamaProvider para cancelar fetch em andamento
 *              - Trata sinais do sistema (SIGINT/SIGTERM) para encerramento limpo
 *              - Executa o teste inicial de comunicação com o motor cognitivo
 */

import { OllamaProvider } from './infra/OllamaProvider.ts';
import { IMotorCognitivo } from './core/IMotorCognitivo.ts';
import { ConsoleLogger } from './infra/ConsoleLogger.ts';
import { ILogger } from './core/ILogger.ts';
import { CircuitBreaker } from './infra/CircuitBreaker.ts';

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
    '║       SOBERANO - Fase 1 (CLI MVP)               ║\n' +
    '║       Inicializando sistemas...                  ║\n' +
    '╚══════════════════════════════════════════════════╝'
  );

  // --- ABORT CONTROLLER GLOBAL PARA GRACEFUL SHUTDOWN ---
  const shutdownController = new AbortController();

  // --- GRACEFUL SHUTDOWN ---
  registerShutdownHandlers(logger, shutdownController);

  // --- CIRCUIT BREAKER ---
  const circuitBreaker = new CircuitBreaker(logger);

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
  }
}

bootstrap();