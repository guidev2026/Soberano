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
      logger.warn(`[main] Sinal ${signal} recebido novamente. Forçando saída.`);
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`[main] Sinal ${signal} recebido. Iniciando encerramento gracioso...`);

    // Tempo limite para não travar o processo caso algo emperre
    const forceExitTimer = setTimeout(() => {
      logger.error('[main] Tempo limite de encerramento excedido. Forçando saída.');
      process.exit(1);
    }, 5_000);

    // Desregistra os handlers para evitar loop
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    // Aborta todas as operações em andamento (fetch do OllamaProvider)
    shutdownController.abort();

    // Pequena pausa para permitir que as operações abortadas propaguem
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 100);
    });

    // Só cancela o timer se a limpeza terminou dentro do prazo de 5s
    clearTimeout(forceExitTimer);
    logger.info('[main] Recursos liberados. Até logo, SOBERANO.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('[main] Handlers de graceful shutdown registrados (SIGINT/SIGTERM).');
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

  // --- WIRING MANUAL (Injeção de Dependência) ---
  // A variável "motor" é tipada como IMotorCognitivo (abstração).
  // O módulo de alto nível (main.ts) depende da abstração, não da implementação concreta.
  // O Logger é injetado via construtor em ambas as dependências.
  const provider = new OllamaProvider(logger, undefined, undefined, undefined, undefined, undefined, circuitBreaker);

  // Injeta o sinal de abort para graceful shutdown
  provider.setAbortSignal(shutdownController.signal);

  // A partir daqui, usa-se a abstração IMotorCognitivo
  const motor: IMotorCognitivo = provider;

  const promptTeste = 'Olá, Soberano. Confirme que seus sistemas base estão online.';

  logger.info(`[main] Enviando prompt ao motor cognitivo...`);
  logger.info(`[main] Prompt: "${promptTeste}"`);

  try {
    const resposta = await motor.gerarResposta(promptTeste);

    logger.info(
      '╔══════════════════════════════════════════════════╗\n' +
      '║       RESPOSTA DO MOTOR COGNITIVO               ║\n' +
      '╚══════════════════════════════════════════════════╝'
    );
    logger.info(resposta);
    logger.info('[main] Teste concluído com sucesso.');
  } catch (error) {
    // Se o erro foi causado pelo shutdown, não é uma falha real
    if (shutdownController.signal.aborted) {
      logger.info('[main] Operação cancelada devido ao encerramento do sistema.');
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
      logger.error(`[main] Erro desconhecido: ${String(error)}`);
    }

    logger.error('[main] O sistema não pôde se comunicar com o motor cognitivo.');
    logger.error('[main] Verifique se o servidor Ollama está em execução: ollama serve');

    // Encerra o processo com código 1 (erro) sem depender de @types/node
    process.exit(1);
  }
}

bootstrap();