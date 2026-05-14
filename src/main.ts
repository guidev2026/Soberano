/**
 * @file main.ts
 * @description Ponto de entrada do sistema SOBERANO - Fase 1 (CLI MVP).
 *              Realiza o wiring manual (Injeção de Dependência) seguindo o DIP:
 *              - Instancia ConsoleLogger para logging estruturado
 *              - Instancia OllamaProvider com Logger injetado via construtor
 *              - Trata sinais do sistema (SIGINT/SIGTERM) para encerramento limpo
 *              - Executa o teste inicial de comunicação com o motor cognitivo
 */

import { OllamaProvider } from './infra/OllamaProvider.ts';
import { IMotorCognitivo } from './core/IMotorCognitivo.ts';
import { ConsoleLogger } from './infra/ConsoleLogger.ts';
import { ILogger } from './core/ILogger.ts';

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
 * O encerramento é feito de forma limpa: mensagem de log,
 * sinalizador ligado e processo finalizado com código 0.
 */
function registerShutdownHandlers(logger: ILogger): void {
  const shutdown = (signal: string) => {
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

    // Operações de limpeza podem ser adicionadas aqui no futuro
    // (ex: fechar conexões HTTP, liberar recursos, etc.)

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

  // --- GRACEFUL SHUTDOWN ---
  registerShutdownHandlers(logger);

  // --- WIRING MANUAL (Injeção de Dependência) ---
  // A variável "motor" é tipada como IMotorCognitivo (abstração).
  // O módulo de alto nível (main.ts) depende da abstração, não da implementação concreta.
  // O Logger é injetado via construtor em ambas as dependências.
  const motor: IMotorCognitivo = new OllamaProvider(logger);

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