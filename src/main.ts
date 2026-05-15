/**
 * @file main.ts
 * @description Ponto de entrada do sistema SOBERANO - Sprint 6.3 (Expansao do Arsenal).
 *              Realiza o wiring manual (Injecao de Dependencia) seguindo o DIP:
 *              - Instancia ConsoleLogger para logging estruturado
 *              - Instancia OllamaProvider com Logger injetado via construtor
 *              - Cria AbortController global para graceful shutdown
 *              - Injeta AbortSignal no OllamaProvider para cancelar fetch em andamento
 *              - Trata sinais do sistema (SIGINT/SIGTERM) para encerramento limpo
 *              - Inicializa NativeHttpServer para servir rota /healthz
 *              - Executa o teste de comunicacao com o motor cognitivo
 *              - Executa o teste do FileSensor (leitura de arquivo local)
 *              - Demonstra o MockVectorStore (Memoria Vetorial - Fase 3)
 *              - Instancia InMemorySessionManager para gestao de sessoes (Fase 5)
 *              - Instancia ConversationManager para orquestracao multi-turno com RAG (Fase 5)
 *              - Simula 2 turnos de conversa para provar a retencao de memoria de sessao
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
import { InMemorySessionManager } from './infra/InMemorySessionManager.ts';
import { ISessionManager } from './core/ISessionManager.ts';
import { ConversationManager } from './infra/ConversationManager.ts';
import { IConversationManager } from './core/IConversationManager.ts';
import { ToolRegistry } from './infra/ToolRegistry.ts';
import { IToolRegistry } from './core/IToolRegistry.ts';
import { SystemTimeTool } from './infra/tools/SystemTimeTool.ts';
import { CalculatorTool } from './infra/tools/CalculatorTool.ts';
import { ReadFileTool } from './infra/tools/ReadFileTool.ts';

let isShuttingDown = false;

function registerShutdownHandlers(
  logger: ILogger,
  shutdownController: AbortController,
  httpServer: IHttpServer
): void {
    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        logger.warn('[main] Signal ' + signal + ' received again. Forcing exit.');
        process.exit(1);
      }

      isShuttingDown = true;
      logger.info('[main] Signal ' + signal + ' received. Initiating graceful shutdown...');

      const forceExitTimer = setTimeout(() => {
        logger.error('[main] Shutdown timeout exceeded. Forcing exit.');
        process.exit(1);
      }, 5_000);

      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');

      shutdownController.abort();

      clearTimeout(forceExitTimer);
      logger.info('[main] Shutdown signalled. Resources will be released in finally block.');
    };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('[main] Graceful shutdown handlers registered (SIGINT/SIGTERM).');
}

async function bootstrap(): Promise<void> {
  const logger: ILogger = new ConsoleLogger('SOBERANO');
  const shutdownController = new AbortController();
  const circuitBreaker = new CircuitBreaker({ logger });

  const httpServer: IHttpServer = new NativeHttpServer({
    logger,
    abortSignal: shutdownController.signal,
  });

  registerShutdownHandlers(logger, shutdownController, httpServer);

  const globalTimeoutSignal = AbortSignal.timeout(120_000);
  const combinedSignal = AbortSignal.any([shutdownController.signal, globalTimeoutSignal]);

  const provider = new OllamaProvider({ logger, circuitBreaker });
  provider.setAbortSignal(combinedSignal);
  const motor: IMotorCognitivo = provider;

  const portArg = process.argv[3];
  let HTTP_PORT = 3000;
  if (portArg !== undefined) {
    HTTP_PORT = parseInt(portArg, 10);
    if (Number.isNaN(HTTP_PORT)) {
      logger.error('[main] Invalid port argument "' + portArg + '". Porta invalida. Encerrando.');
      process.exit(1);
    }
  }
  await httpServer.start(HTTP_PORT);

  try {
    // TESTE 1: MOTOR COGNITIVO
    logger.info('[main] === TESTE 1: MOTOR COGNITIVO ===');

    const promptTeste = 'Ola, Soberano. Confirme que seus sistemas base estao online.';
    const mensagens = [{ role: 'user' as const, content: promptTeste }];

    logger.info('[main] Sending messages to cognitive engine...');
    logger.info('[main] Messages: ' + JSON.stringify(mensagens));

    const respostaMessage = await motor.gerarResposta(mensagens);

    logger.info('[main] === RESPOSTA DO MOTOR COGNITIVO ===');
    logger.info(respostaMessage.content);
    logger.info('[main] Test completed successfully.');

    // TESTE DO FILE SENSOR (Fase 2)
    const filePath = process.argv[2];

    if (filePath) {
      logger.info('[main] === FILE SENSOR - Demonstracao ===');

      const fileSensor: ISensor<string> = new FileSensor({ logger });

      try {
        const conteudo = await fileSensor.ler(filePath, combinedSignal);
        logger.info('[main] Conteudo do arquivo "' + filePath + '":');
        logger.info(conteudo);
        logger.info('[main] FileSensor test completed successfully.');
      } catch (sensorError) {
        logger.error('[main] FileSensor: Erro ao ler o arquivo "' + filePath + '".');
        if (sensorError instanceof Error) {
          logger.error(sensorError.message);
        } else {
          logger.error('[main] Unknown error: ' + String(sensorError));
        }
      }
    } else {
      logger.info('[main] Nenhum caminho de arquivo fornecido. Uso: npm start -- <caminho-do-arquivo> [porta]');
    }

    // DEMONSTRACAO DO MOCK VECTOR STORE (Fase 3)
    logger.info('[main] === MOCK VECTOR STORE - Demonstracao ===');

    const vectorStore: IVectorStore = new MockVectorStore({ logger });

    await vectorStore.adicionar('doc-1', [0.1, 0.2, 0.3], { texto: 'Gato felino mamifero', fonte: 'enciclopedia' });
    await vectorStore.adicionar('doc-2', [0.4, 0.5, 0.6], { texto: 'Cachorro canino mamifero', fonte: 'enciclopedia' });
    await vectorStore.adicionar('doc-3', [0.7, 0.8, 0.9], { texto: 'Aguia ave rapina', fonte: 'enciclopedia' });

    logger.info('[main] 3 vectors added to MockVectorStore.');

    const queryVector = [0.35, 0.45, 0.55];
    const similar = await vectorStore.buscarSimilares(queryVector, 2);

    logger.info('[main] Top ' + similar.length + ' similar vectors to query [0.35, 0.45, 0.55]:');
    for (const result of similar) {
      logger.info('  -> id="' + result.id + '", score=' + result.score.toFixed(4) + ', texto="' + result.metadata.texto + '"');
    }

    logger.info('[main] MockVectorStore demonstration completed successfully.');

    // TESTE DO CONVERSATION MANAGER (Fase 5)
    logger.info('[main] === CONVERSATION MANAGER - Demonstracao: Sessoes + RAG (Fase 5) ===');

    const sessionManager: ISessionManager = new InMemorySessionManager({
      logger,
      maxMessagesPerSession: 20,
    });

    // --- Tool Registry (Fase 6) ---
    const toolRegistry: IToolRegistry = new ToolRegistry({ logger });
    const systemTimeTool = new SystemTimeTool();
    toolRegistry.registrar(systemTimeTool);
    logger.info('[main] SystemTimeTool registered in ToolRegistry.');

    const calculatorTool = new CalculatorTool();
    toolRegistry.registrar(calculatorTool);
    logger.info('[main] CalculatorTool registered in ToolRegistry.');

    const readFileTool = new ReadFileTool();
    toolRegistry.registrar(readFileTool);
    logger.info('[main] ReadFileTool registered in ToolRegistry.');

    const conversationManager: IConversationManager = new ConversationManager({
      logger,
      motor,
      sessionManager,
      vectorStore,
      toolRegistry,
    });

    const sessionId = 'demo-sprint-5.3';

    // Turno 1
    const input1 = 'Ola, quem es tu?';
    logger.info('[main] CONVERSATION - Turno 1/2: "' + input1 + '"');
    const resposta1 = await conversationManager.conversar(sessionId, input1);
    logger.info('[main] === CONVERSATION MANAGER - Resposta Turno 1 ===');
    logger.info(resposta1);

    // Turno 2
    const input2 = 'Qual foi a minha primeira pergunta?';
    logger.info('[main] CONVERSATION - Turno 2/2: "' + input2 + '"');
    const resposta2 = await conversationManager.conversar(sessionId, input2);
    logger.info('[main] === CONVERSATION MANAGER - Resposta Turno 2 ===');
    logger.info(resposta2);

    // Turno 3 - Força o uso da ferramenta get_system_time
    const input3 = 'Que horas sao exatamente agora?';
    logger.info('[main] CONVERSATION - Turno 3/4 (Tool Calling): "' + input3 + '"');
    const resposta3 = await conversationManager.conversar(sessionId, input3);
    logger.info('[main] === CONVERSATION MANAGER - Resposta Turno 3 (Tool Calling) ===');
    logger.info(resposta3);
    logger.info('[main] === Tool Call test completed successfully. ===');

    // Turno 4 - Uso multiplo de ferramentas (calculator + get_system_time)
    const input4 = 'Soberano, calcule quanto e 1450 dividido por 5 e depois me diga que horas sao';
    logger.info('[main] CONVERSATION - Turno 4/4 (Multi-tool): "' + input4 + '"');
    const resposta4 = await conversationManager.conversar(sessionId, input4);
    logger.info('[main] === CONVERSATION MANAGER - Resposta Turno 4 (Multi-tool) ===');
    logger.info(resposta4);
    logger.info('[main] === Sprint 6.3 - Expansao do Arsenal test completed successfully. ===');

    // Verificacao da memoria de sessao
    const historicoFinal = await sessionManager.obterHistorico(sessionId);
    logger.info('[main] === SESSAO "' + sessionId + '" — ' + historicoFinal.length + ' mensagens ===');
    logger.info('[main] Session history (' + historicoFinal.length + ' messages):');
    for (const msg of historicoFinal) {
      const truncatedContent = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');
      logger.info('  [' + msg.role + '] ' + truncatedContent);
    }

    logger.info('[main] === FASE 5 COMPLETA - Todos os testes OK ===');
  } catch (error) {
    if (shutdownController.signal.aborted) {
      logger.info('[main] Operation cancelled due to system shutdown.');
      return;
    }

    logger.error('[main] === ERRO NA COMUNICACAO COM O MOTOR ===');

    if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error('[main] Unknown error: ' + String(error));
    }

    logger.error('[main] O sistema nao pode se comunicar com o motor cognitivo.');
    logger.error('[main] Verifique se o servidor Ollama esta em execucao: ollama serve');

    process.exit(1);
  } finally {
    await httpServer.stop().catch((err) => {
      logger.error('[main] Error stopping HTTP server: ' + err);
    });

    if (isShuttingDown) {
      logger.info('[main] Resources released. Goodbye, SOBERANO.');
      process.exit(0);
    }
  }
}

bootstrap();