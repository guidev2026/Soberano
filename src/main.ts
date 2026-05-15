/**
 * @file main.ts
 * @description Ponto de entrada do SOBERANO — Servidor HTTP puro (Node.js nativo).
 *
 *              A Fase 7 substitui o Electron pelo Tauri como shell desktop.
 *              O backend Node.js funciona como microsserviço local na porta 3000,
 *              servindo:
 *              - API REST em /chat (SSE) e /chat-history
 *              - Frontend estático (vanilla HTML/JS) em src/renderer/
 *
 *              Graceful Shutdown: SIGINT/SIGTERM disparam abortSignal global,
 *              que é propagado para o servidor HTTP e operações em andamento.
 *
 *              Dependências: exclusivamente módulos nativos Node.js.
 *              Nenhuma dependência externa (zero npm além de typescript e tauri-cli).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConsoleLogger } from './infra/ConsoleLogger.ts';
import { CircuitBreaker } from './infra/CircuitBreaker.ts';
import { ToolRegistry } from './infra/ToolRegistry.ts';
import { CalculatorTool } from './infra/tools/CalculatorTool.ts';
import { SystemTimeTool } from './infra/tools/SystemTimeTool.ts';
import { ReadFileTool } from './infra/tools/ReadFileTool.ts';
import { FileSensor } from './infra/FileSensor.ts';
import { NativeHttpServer } from './infra/NativeHttpServer.ts';
import type { NativeHttpServerOptions } from './infra/NativeHttpServer.ts';
import { OllamaProvider } from './infra/OllamaProvider.ts';
import { InMemorySessionManager } from './infra/InMemorySessionManager.ts';
import { ConversationManager } from './infra/ConversationManager.ts';
import { MockVectorStore } from './infra/MockVectorStore.ts';
import { ILogger } from './core/ILogger.ts';
import { ITool } from './core/ITool.ts';

// ─── Caminho absoluto da pasta src (ESM-compatível) ─────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = dirname(__dirname); // sobe de src/ para raiz

// ─── AbortController global para graceful shutdown ─────────────────────────
const shutdownController = new AbortController();

function setupProcessHandlers(logger: ILogger): void {
  const handleSignal = (signal: string) => {
    logger.info(`[main] ${signal} received. Initiating graceful shutdown...`);
    if (!shutdownController.signal.aborted) {
      shutdownController.abort();
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // Previne crash em unhandled rejections — loga e continua
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`[main] Unhandled Rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  process.on('uncaughtException', (err: Error) => {
    logger.error(`[main] Uncaught Exception: ${err.message}`);
    logger.error(err.stack ?? '');
    process.exit(1); // Estado inconsistente — encerra
  });
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const logger = new ConsoleLogger();

  logger.info('=== SOBERANO v0.7.0 — Container Tauri (HTTP/SSE) ===');

  setupProcessHandlers(logger);

  // ─── 1. Infraestrutura ─────────────────────────────────────────────────
  const toolRegistry = new ToolRegistry({ logger });
  const tools: ITool[] = [new CalculatorTool(), new SystemTimeTool(), new ReadFileTool()];
  for (const tool of tools) {
    toolRegistry.registrar(tool);
  }
  logger.info(`[main] ${tools.length} tool(s) registered.`);

  const sensor = new FileSensor({ logger });

  const circuitBreaker = new CircuitBreaker({ logger });

  const provider = new OllamaProvider({ logger, model: 'llama3.2:1b', baseUrl: 'http://localhost:11434', circuitBreaker });

  const sessionManager = new InMemorySessionManager({ logger });

  const vectorStore = new MockVectorStore({ logger });

  const conversationManager = new ConversationManager({
    logger,
    motor: provider,
    sessionManager,
    toolRegistry,
    vectorStore,
  });

  // ─── 2. Servidor HTTP ──────────────────────────────────────────────────
  const port = parseInt((process as any).env?.PORT ?? '3000', 10);
  const rendererDir = join(PROJECT_ROOT, 'renderer');

  const serverOptions: NativeHttpServerOptions = {
    logger,
    conversationManager,
    sessionManager,
    rendererDir,
    abortSignal: shutdownController.signal,
  };

  const httpServer = new NativeHttpServer(serverOptions);

  try {
    await httpServer.start(port);
    logger.info(`[main] SOBERANO HTTP server running on http://localhost:${httpServer.port}`);
    logger.info(`[main] Frontend disponível em http://localhost:${httpServer.port}`);
    logger.info('[main] Pressione Ctrl+C para encerrar.');
  } catch (err) {
    logger.error(`[main] Failed to start HTTP server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // ─── 3. Graceful Shutdown ──────────────────────────────────────────────
  shutdownController.signal.addEventListener('abort', async () => {
    logger.info('[main] Shutting down SOBERANO...');
    try {
      await httpServer.stop();
      logger.info('[main] HTTP server stopped.');
    } catch (err) {
      logger.error(`[main] Error stopping HTTP server: ${err instanceof Error ? err.message : String(err)}`);
    }
    logger.info('[main] SOBERANO encerrado. Até logo!');
    process.exit(0);
  });
}

// ─── Start ──────────────────────────────────────────────────────────────────
main().catch((err: unknown) => {
  console.error('[main] Fatal error during bootstrap:', err);
  process.exit(1);
});