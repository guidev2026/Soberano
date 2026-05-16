/**
 * @file bootstrap.ts
 * @description Fábrica central de dependências do SOBERANO (Fase 7 - Bootstrap Unificado).
 *
 *              Ambos os entrypoints (main.ts e main-cli.ts) importam este módulo
 *              para construir a stack completa de infraestrutura, eliminando
 *              duplicação de wiring e garantindo que rodem exatamente a mesma
 *              configuração (princípio DRY).
 *
 *              Uso:
 *                const { logger, motor, sessionManager, ... } = await buildDependencies();
 *
 *              Dependências: exclusivamente módulos nativos Node.js.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { DeepSeekProvider } from './infra/DeepSeekProvider.ts';
import { SqliteSessionManager } from './infra/SqliteSessionManager.ts';
import { ConversationManager } from './infra/ConversationManager.ts';
import { SqliteVectorStore } from './infra/SqliteVectorStore.ts';
import { OllamaEmbeddingProvider } from './infra/OllamaEmbeddingProvider.ts';
import { ILogger } from './core/ILogger.ts';
import { ITool } from './core/ITool.ts';
import { IMotorCognitivo } from './core/IMotorCognitivo.ts';
import { IToolRegistry } from './core/IToolRegistry.ts';
import { IConversationManager } from './core/IConversationManager.ts';
import { IEmbeddingProvider } from './core/IEmbeddingProvider.ts';

// ─── Tipos de Retorno ──────────────────────────────────────────────────────

export interface BootstrapResult {
  logger: ILogger;
  shutdownController: AbortController;
  motor: IMotorCognitivo;
  sessionManager: SqliteSessionManager;
  vectorStore: SqliteVectorStore;
  embeddingProvider: IEmbeddingProvider;
  toolRegistry: IToolRegistry;
  conversationManager: IConversationManager;
  circuitBreaker: CircuitBreaker;
}

export interface BootstrapOptions {
  /** Nome para identificação nos logs (ex: "SOBERANO"). Default: "SOBERANO" */
  loggerTag?: string;
  /** Timeout global em ms para operações (fetch etc). Default: 120_000 */
  globalTimeoutMs?: number;
  /** Caminho do banco de dados de sessões. Default: "nexus_core.db" */
  sessionDbPath?: string;
  /** Caminho do banco de dados de vetores. Default: "nexus_knowledge.db" */
  vectorDbPath?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve o diretório raiz do projeto (onde fica package.json).
 * Compatível com ESM (import.meta.url).
 */
export function resolveProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return dirname(__dirname); // sobe de src/ para raiz
}

/**
 * Resolve o caminho absoluto para o diretório renderer (src/renderer/).
 * @param projectRoot - Raiz do projeto (obtida via resolveProjectRoot()).
 */
export function resolveRendererDir(projectRoot: string): string {
  return join(projectRoot, 'src', 'renderer');
}

/**
 * Configura handlers de processo (SIGINT/SIGTERM, unhandledRejection, uncaughtException).
 * Apenas define os listeners — o shutdownController é retornado para o entrypoint.
 */
export function setupProcessHandlers(logger: ILogger, shutdownController: AbortController): void {
  const handleSignal = (signal: string) => {
    logger.info(`[bootstrap] ${signal} received. Initiating graceful shutdown...`);
    if (!shutdownController.signal.aborted) {
      shutdownController.abort();
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // Previne crash em unhandled rejections — loga e continua
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`[bootstrap] Unhandled Rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  process.on('uncaughtException', (err: Error) => {
    logger.error(`[bootstrap] Uncaught Exception: ${err.message}`);
    logger.error(err.stack ?? '');
    process.exit(1); // Estado inconsistente — encerra
  });
}

/**
 * Constrói todos os serviços do SOBERANO e retorna as referências.
 *
 * Inclui:
 * - Logger, CircuitBreaker, Sensor (FileSensor)
 * - Provider (Ollama ou DeepSeek via env PROVIDER/MODEL/DEEPSEEK_API_KEY)
 * - SqliteSessionManager, SqliteVectorStore, OllamaEmbeddingProvider
 * - ToolRegistry (CalculatorTool, SystemTimeTool, ReadFileTool)
 * - ConversationManager
 *
 * @param options - Opções de configuração (sobrescrevem defaults).
 * @returns Todos os serviços instanciados.
 */
export async function buildDependencies(options?: BootstrapOptions): Promise<BootstrapResult> {
  const loggerTag = options?.loggerTag ?? 'SOBERANO';
  const globalTimeoutMs = options?.globalTimeoutMs ?? 120_000;
  const sessionDbPath = options?.sessionDbPath ?? 'nexus_core.db';
  const vectorDbPath = options?.vectorDbPath ?? 'nexus_knowledge.db';

  const logger = new ConsoleLogger(loggerTag);
  const shutdownController = new AbortController();
  const circuitBreaker = new CircuitBreaker({ logger });

  const globalTimeoutSignal = AbortSignal.timeout(globalTimeoutMs);
  const combinedSignal = AbortSignal.any([shutdownController.signal, globalTimeoutSignal]);

  setupProcessHandlers(logger, shutdownController);

  // ─── Provider (Ollama ou DeepSeek) ──────────────────────────────────────
  let motor: IMotorCognitivo;
  const providerName = (process as any).env?.PROVIDER || 'ollama';
  const requestedModel = (process as any).env?.MODEL;

  if (providerName === 'deepseek') {
    const apiKey = (process as any).env?.DEEPSEEK_API_KEY;
    if (!apiKey) {
      logger.error('[bootstrap] DEEPSEEK_API_KEY environment variable is required when using DeepSeek provider.');
      process.exit(1);
    }
    const model = requestedModel || 'deepseek-chat';
    const provider = new DeepSeekProvider({ logger, apiKey, model, circuitBreaker });
    provider.setAbortSignal(combinedSignal);
    motor = provider;
    logger.info(`[bootstrap] Cognitive Engine configured to use DeepSeek API (Model: ${model}).`);
  } else {
    const model = requestedModel || 'qwen2.5-coder:7b';
    const provider = new OllamaProvider({ logger, model, baseUrl: 'http://localhost:11434', circuitBreaker });
    provider.setAbortSignal(combinedSignal);
    motor = provider;
    logger.info(`[bootstrap] Cognitive Engine configured to use Ollama local provider (Model: ${model}).`);
  }

  // ─── Banco de Dados (Sessões) ───────────────────────────────────────────
  const sessionManager = new SqliteSessionManager({ logger, dbPath: sessionDbPath });

  // ─── Vector Store e Embeddings ──────────────────────────────────────────
  const vectorStore = new SqliteVectorStore({ logger, dbPath: vectorDbPath });
  const embeddingProvider = new OllamaEmbeddingProvider({
    logger,
    model: 'nomic-embed-text',
    circuitBreaker,
  });

  // ─── Tool Registry ──────────────────────────────────────────────────────
  const toolRegistry = new ToolRegistry({ logger });
  const tools: ITool[] = [new CalculatorTool(), new SystemTimeTool(), new ReadFileTool()];
  for (const tool of tools) {
    toolRegistry.registrar(tool);
  }
  logger.info(`[bootstrap] ${tools.length} tool(s) registered.`);

  // ─── Conversation Manager ───────────────────────────────────────────────
  const conversationManager = new ConversationManager({
    logger,
    motor,
    sessionManager,
    toolRegistry,
    vectorStore,
    embeddingProvider,
  });

  // ─── Graceful Shutdown: fechar conexões com banco ──────────────────────
  shutdownController.signal.addEventListener('abort', () => {
    logger.info('[Shutdown] Fechando conexões com o banco de dados com segurança...');
    try {
      sessionManager.close();
      logger.info('[bootstrap] SqliteSessionManager connection closed.');
    } catch (err) {
      logger.error(`[bootstrap] Error closing SqliteSessionManager: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      vectorStore.close();
      logger.info('[bootstrap] SqliteVectorStore connection closed.');
    } catch (err) {
      logger.error(`[bootstrap] Error closing SqliteVectorStore: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return {
    logger,
    shutdownController,
    motor,
    sessionManager,
    vectorStore,
    embeddingProvider,
    toolRegistry,
    conversationManager,
    circuitBreaker,
  };
}