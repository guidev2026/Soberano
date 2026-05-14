/**
 * @file main.ts
 * @description Ponto de entrada do sistema SOBERANO - Fase 3 (Memória - RAG Tradicional).
 *              Realiza o wiring manual (Injeção de Dependência) seguindo o DIP:
 *              - Instancia ConsoleLogger para logging estruturado
 *              - Instancia OllamaProvider com Logger injetado via construtor
 *              - Cria AbortController global para graceful shutdown
 *              - Injeta AbortSignal no OllamaProvider para cancelar fetch em andamento
 *              - Trata sinais do sistema (SIGINT/SIGTERM) para encerramento limpo
 *              - Inicializa NativeHttpServer para servir rota /healthz
 *              - Executa o teste inicial de comunicação com o motor cognitivo
 *              - Executa o teste do FileSensor (leitura de arquivo local)
 *              - Demonstra o MockVectorStore (Memória Vetorial - Fase 3)
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
import { MockVectorStore } from './infra/MockVectorStore.ts';
import { IVectorStore } from './core/IVectorStore.ts';

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
 * @param httpServer        - Servidor HTTP para parar durante o shutdown
 */
function registerShutdownHandlers(
  logger: ILogger,
  shutdownController: AbortController,
  httpServer: IHttpServer
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

    // 1. Aborta todas as operações em andamento (OllamaProvider fetch)
    shutdownController.abort();

    // 2. Após o abort ter sido propagado, para o servidor HTTP
    try {
      await httpServer.stop();
      logger.info('[main] HTTP server stopped.');
    } catch (err) {
      logger.error(`[main] Error stopping HTTP server: ${err}`);
    }

    // 3. Cleanup concluído
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
    '║       SOBERANO - Fase 3 (Memória & Comunicação)  ║\n' +
    '║       Inicializando sistemas...                  ║\n' +
    '╚══════════════════════════════════════════════════╝'
  );

  // --- ABORT CONTROLLER GLOBAL PARA GRACEFUL SHUTDOWN ---
  const shutdownController = new AbortController();

  // --- CIRCUIT BREAKER ---
  const circuitBreaker = new CircuitBreaker({ logger });

  // --- HTTP SERVER (Fase 3 - Comunicação) ---
  const httpServer: IHttpServer = new NativeHttpServer({
    logger,
    abortSignal: shutdownController.signal,
  });

  // --- GRACEFUL SHUTDOWN (após httpServer criado) ---
  registerShutdownHandlers(logger, shutdownController, httpServer);

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
  // Se nenhum argumento for passado, usa porta padrão 3000
  const portArg = process.argv[3];
  let HTTP_PORT = 3000;
  if (portArg !== undefined) {
    HTTP_PORT = parseInt(portArg, 10);
    if (Number.isNaN(HTTP_PORT)) {
      logger.error(`[main] Invalid port argument "${portArg}". Porta inválida. Encerrando.`);
      process.exit(1);
    }
  }
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

    // --- DEMONSTRAÇÃO DO MOCK VECTOR STORE (Fase 3 - Memória Vetorial) ---
    logger.info(
      '╔══════════════════════════════════════════════════╗\n' +
      '║       MOCK VECTOR STORE - Demonstração           ║\n' +
      '╚══════════════════════════════════════════════════╝'
    );

    const vectorStore: IVectorStore = new MockVectorStore({ logger });

    // Adiciona 3 vetores de exemplo com metadados
    await vectorStore.adicionar('doc-1', [0.1, 0.2, 0.3], { texto: 'Gato felino mamífero', fonte: 'enciclopedia' });
    await vectorStore.adicionar('doc-2', [0.4, 0.5, 0.6], { texto: 'Cachorro canino mamífero', fonte: 'enciclopedia' });
    await vectorStore.adicionar('doc-3', [0.7, 0.8, 0.9], { texto: 'Águia ave rapina', fonte: 'enciclopedia' });

    logger.info('[main] 3 vectors added to MockVectorStore.');

    // Busca similar ao vetor de doc-2
    const queryVector = [0.35, 0.45, 0.55];
    const similar = await vectorStore.buscarSimilares(queryVector, 2);

    logger.info(`[main] Top ${similar.length} similar vectors to query [0.35, 0.45, 0.55]:`);
    for (const result of similar) {
      logger.info(`  -> id="${result.id}", score=${result.score.toFixed(4)}, texto="${result.metadata.texto}"`);
    }

    logger.info('[main] MockVectorStore demonstration completed successfully.');
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