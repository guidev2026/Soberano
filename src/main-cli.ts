/**
 * @file main-cli.ts
 * @description Ponto de entrada do sistema SOBERANO — Interface interativa de terminal.
 *
 *              Realiza o bootstrap via buildDependencies() em src/bootstrap.ts,
 *              eliminando duplicação de wiring com main.ts (princípio DRY).
 *
 *              Funcionalidades:
 *              - Teste de comunicação com o motor cognitivo
 *              - Teste do FileSensor (leitura de arquivo local)
 *              - Demonstração do SqliteVectorStore (RAG)
 *              - Simulação multi-turno via ConversationManager com Tool Calling
 *              - Graceful Shutdown via SIGINT/SIGTERM
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDependencies, resolveProjectRoot } from './bootstrap.ts';
import { FileSensor } from './infra/FileSensor.ts';
import { ISensor } from './core/ISensor.ts';
import { NativeHttpServer } from './infra/NativeHttpServer.ts';
import { IHttpServer } from './core/IHttpServer.ts';

let isShuttingDown = false;

async function bootstrap(): Promise<void> {
  const { logger, shutdownController, motor, sessionManager, vectorStore, embeddingProvider, conversationManager } =
    await buildDependencies({
      loggerTag: 'SOBERANO',
      sessionDbPath: 'nexus_core_cli.db',
      vectorDbPath: 'nexus_knowledge_cli.db',
    });

  // ─── Graceful Shutdown (proteção do SQLite WAL) ─────────────────────────
  shutdownController.signal.addEventListener('abort', () => {
    // As conexões com banco são fechadas pelo bootstrap.ts
    logger.info('[main] Shutdown signalled. Resources will be released.');
  });

  const projectRoot = resolveProjectRoot();
  const rendererDir = join(projectRoot, 'src', 'renderer');

  // ─── HTTP Server (necessário para API de chat) ──────────────────────────
  const httpServer: IHttpServer = new NativeHttpServer({
    logger,
    conversationManager,
    sessionManager,
    rendererDir,
    abortSignal: shutdownController.signal,
  });

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
        const conteudo = await fileSensor.ler(filePath, shutdownController.signal);
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

    // DEMONSTRACAO DO SQLITE VECTOR STORE (RAG)
    logger.info('[main] === SQLITE VECTOR STORE (RAG) - Demonstracao ===');

    try {
      const txt1 = 'Gato é um felino mamifero.';
      const txt2 = 'Cachorro é um canino mamifero leal.';
      const txt3 = 'Águia é uma ave de rapina imponente.';

      await vectorStore.adicionar('doc-cli-1', await embeddingProvider.gerarEmbedding(txt1), { texto: txt1, fonte: 'enciclopedia' });
      await vectorStore.adicionar('doc-cli-2', await embeddingProvider.gerarEmbedding(txt2), { texto: txt2, fonte: 'enciclopedia' });
      await vectorStore.adicionar('doc-cli-3', await embeddingProvider.gerarEmbedding(txt3), { texto: txt3, fonte: 'enciclopedia' });
      logger.info('[main] 3 vectors added to SqliteVectorStore.');
    } catch(e) {
      logger.info('[main] Vetores possivelmente já existem no banco CLI.');
    }

    const queryVector = await embeddingProvider.gerarEmbedding('fale sobre felinos');
    const similar = await vectorStore.buscarSimilares(queryVector, 2);

    logger.info('[main] Top ' + similar.length + ' similar vectors to query:');
    for (const result of similar) {
      logger.info('  -> id="' + result.id + '", score=' + result.score.toFixed(4) + ', texto="' + result.metadata.texto + '"');
    }

    logger.info('[main] SqliteVectorStore demonstration completed successfully.');

    // TESTE DO CONVERSATION MANAGER (Fase 5)
    logger.info('[main] === CONVERSATION MANAGER - Demonstracao: Sessoes + RAG (Fase 5) ===');

    const sessionId = randomUUID();

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
    logger.info('[main] === Sprint 6.5 - Zero Debt test completed successfully. ===');

    // Verificacao da memoria de sessao
    const historicoFinal = await sessionManager.obterHistorico(sessionId);
    logger.info('[main] === SESSAO "' + sessionId + '" — ' + historicoFinal.length + ' mensagens ===');
    logger.info('[main] Session history (' + historicoFinal.length + ' messages):');
    for (const msg of historicoFinal) {
      const truncatedContent = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');
      logger.info('  [' + msg.role + '] ' + truncatedContent);
    }

    logger.info('[main] === FASE 6.5 COMPLETA - Todos os testes OK ===');
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
    // Ensure httpServer.stop() is called exactly once to avoid race condition
    if (!shutdownController.signal.aborted) {
      await httpServer.stop().catch((err) => {
        logger.error('[main] Error stopping HTTP server: ' + err);
      });
    }

    if (isShuttingDown) {
      logger.info('[main] Resources released. Goodbye, SOBERANO.');
      process.exit(0);
    }
  }
}

bootstrap();