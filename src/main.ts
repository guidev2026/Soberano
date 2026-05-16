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
 *              Bootstrap unificado: as dependências são construídas via
 *              buildDependencies() em src/bootstrap.ts, eliminando duplicação
 *              de wiring com main-cli.ts (princípio DRY).
 *
 *              Graceful Shutdown: SIGINT/SIGTERM disparam abortSignal global,
 *              que é propagado para o servidor HTTP e operações em andamento.
 *
 *              Dependências: exclusivamente módulos nativos Node.js.
 *              Nenhuma dependência externa (zero npm além de typescript e tauri-cli).
 */

import { join } from 'node:path';
import { buildDependencies, resolveProjectRoot, resolveRendererDir } from './bootstrap.ts';
import { NativeHttpServer } from './infra/NativeHttpServer.ts';
import type { NativeHttpServerOptions } from './infra/NativeHttpServer.ts';

// ─── Bootstrap ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { logger, shutdownController, sessionManager, conversationManager } =
    await buildDependencies({ loggerTag: 'SOBERANO' });

  logger.info('=== SOBERANO v0.7.0 — Container Tauri (HTTP/SSE) ===');

  // ─── 1. Servidor HTTP ──────────────────────────────────────────────────
  const port = parseInt((process as any).env?.PORT ?? '3000', 10);
  const projectRoot = resolveProjectRoot();
  const rendererDir = join(projectRoot, 'src', 'renderer');

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

  // ─── 2. Graceful Shutdown ──────────────────────────────────────────────
  shutdownController.signal.addEventListener('abort', async () => {
    logger.info('[main] Shutting down SOBERANO...');
    try {
      await httpServer.stop();
      logger.info('[main] HTTP server stopped.');
    } catch (err) {
      logger.error(`[main] Error stopping HTTP server: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Conexões com banco são fechadas pelo bootstrap.ts via shutdownController.signal
    logger.info('[main] SOBERANO encerrado. Até logo!');
    process.exit(0);
  });
}

// ─── Start ──────────────────────────────────────────────────────────────────
main().catch((err: unknown) => {
  console.error('[main] Fatal error during bootstrap:', err);
  process.exit(1);
});