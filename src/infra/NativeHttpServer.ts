/**
 * @file NativeHttpServer.ts
 * @description Implementação concreta do servidor HTTP utilizando exclusivamente
 *              o módulo nativo node:http. Zero dependências externas.
 *
 *              A Fase 7 (Tauri) adiciona:
 *              - POST /chat: recebe JSON { message, sessionId } e responde em SSE
 *              - Servir arquivos estáticos do frontend renderer (src/renderer/)
 *              - GET /chat-history?sessionId=... : retorna histórico da sessão
 *
 *              Rotas:
 *              - GET /healthz              → { status: "ok" }
 *              - POST /chat                → SSE com chunks do LLM
 *              - GET /chat-history         → { messages: [...] }
 *              - GET /                     → index.html (frontend)
 *              - GET /* (arquivo estático) → serve do src/renderer/
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IHttpServer } from '../core/IHttpServer.ts';
import { ILogger } from '../core/ILogger.ts';
import { IConversationManager } from '../core/IConversationManager.ts';
import { ISessionManager } from '../core/ISessionManager.ts';

export interface NativeHttpServerOptions {
  logger: ILogger;
  conversationManager: IConversationManager;
  sessionManager: ISessionManager;
  /** Caminho absoluto para a pasta do frontend renderer (src/renderer/) */
  rendererDir: string;
  /**
   * Sinal de aborto global. Quando disparado, o servidor executa stop()
   * automaticamente. Use o shutdownController.signal do bootstrap.
   */
  abortSignal?: AbortSignal;
}

/** Mapa de extensões para Content-Type */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

export class NativeHttpServer extends IHttpServer {
  private server: Server | null = null;
  private readonly logger: ILogger;
  private readonly conversationManager: IConversationManager;
  private readonly sessionManager: ISessionManager;
  private readonly rendererDir: string;
  private readonly abortSignal?: AbortSignal;
  private abortListener: (() => void) | null = null;
  private actualPort: number | null = null;
  /** Flag de idempotência para stop(). Evita múltiplas chamadas simultâneas a close(). */
  private stopping: boolean = false;
  /** Flag que indica se a Promise de start() já foi resolvida. */
  private startResolved: boolean = false;

  constructor(options: NativeHttpServerOptions) {
    super();
    this.logger = options.logger;
    this.conversationManager = options.conversationManager;
    this.sessionManager = options.sessionManager;
    this.rendererDir = options.rendererDir;
    this.abortSignal = options.abortSignal;
  }

  /**
   * Retorna a porta real em que o servidor está escutando,
   * ou null se o servidor não foi iniciado.
   */
  get port(): number | null {
    return this.actualPort;
  }

  async start(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.startResolved = false;

      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(`[NativeHttpServer] Unhandled error: ${err}`);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
          }
        });
      });

      // --- Integração com AbortSignal (graceful shutdown automático) ---
      if (this.abortSignal && !this.abortSignal.aborted) {
        this.abortListener = () => {
          this.logger.info('[NativeHttpServer] AbortSignal received. Stopping server...');
          this.stop().catch((err) => {
            this.logger.error(`[NativeHttpServer] Error during abort-driven stop: ${err}`);
          });
        };
        this.abortSignal.addEventListener('abort', this.abortListener);
      }

      // Listener de erro do server
      this.server.on('error', (err: unknown) => {
        if (!this.startResolved) {
          reject(err);
        } else {
          this.logger.error(`[NativeHttpServer] Runtime error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      this.server.listen(port, () => {
        const addr = this.server!.address();
        this.actualPort = typeof addr === 'object' && addr ? (addr as { port: number }).port : port;
        this.logger.info(`[NativeHttpServer] HTTP server listening on port ${this.actualPort}`);
        this.startResolved = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.stopping || !this.server) {
      return;
    }

    this.stopping = true;

    if (this.abortSignal && this.abortListener) {
      this.abortSignal.removeEventListener('abort', this.abortListener);
      this.abortListener = null;
    }

    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          if ((err as Error & { code?: string }).code === 'ENOTCONN') {
            this.logger.info('[NativeHttpServer] Server was already not listening.');
            this.server = null;
            this.actualPort = null;
            this.stopping = false;
            resolve();
            return;
          }
          this.logger.error(`[NativeHttpServer] Error closing server: ${err.message}`);
          this.stopping = false;
          reject(err);
          return;
        }
        this.logger.info('[NativeHttpServer] Server closed successfully.');
        this.server = null;
        this.actualPort = null;
        this.stopping = false;
        resolve();
      });
    });
  }

  /**
   * Define os headers CORS para permitir requisições de origens externas
   * (ex: Tauri WebView que acessa de tauri://localhost).
   */
  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  /**
   * Roteador principal de requisições HTTP.
   * Decide qual handler chamar com base no método e path.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { method, url } = req;
    const pathname = url ? new URL(url, `http://${req.headers.host || 'localhost'}`).pathname : '/';

    // Aplica CORS em todas as respostas
    this.setCorsHeaders(res);

    // Preflight OPTIONS — responde imediatamente
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Rota: GET /healthz
      if (pathname === '/healthz' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'SOBERANO' }));
        return;
      }

      // Rota: POST /chat (SSE)
      if (pathname === '/chat' && method === 'POST') {
        await this.handleChatSSE(req, res);
        return;
      }

      // Rota: GET /chat-history?sessionId=xxx
      if (pathname === '/chat-history' && method === 'GET') {
        await this.handleChatHistory(req, res);
        return;
      }

      // Rota: GET / (servir arquivos estáticos do renderer)
      if (method === 'GET') {
        await this.serveStatic(pathname, res);
        return;
      }

      // Qualquer outra rota → 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      this.logger.error(`[NativeHttpServer] Error handling ${method} ${pathname}: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  }

  /**
   * Handles POST /chat com Server-Sent Events.
   *
   * Request body: JSON { message: string }
   *
   * Response:
   *   Content-Type: text/event-stream
   *   data: {"chunk": "...", "done": false}
   *   data: {"chunk": "", "done": true}
   *
   * Se o header X-Session-Id for fornecido, reusa a sessão;
   * caso contrário, cria uma nova.
   */
  private async handleChatSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Lê o body
    const body = await this.readBody(req);

    let parsed: { message?: string };
    try {
      parsed = JSON.parse(body) as { message?: string };
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const userMessage = parsed.message;
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Campo "message" é obrigatório e não pode ser vazio' }));
      return;
    }

    // Obtém ou cria sessionId
    const sessionId = this.getOrCreateSession(req);

    // Configura headers SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId,
    });

    // Envia o sessionId como primeiro evento (cliente pode armazenar)
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`);

    // Consome o stream e envia chunks como eventos SSE
    const signal = AbortSignal.timeout(120_000); // Timeout de 2 minutos

    try {
      for await (const chunk of this.conversationManager.conversarStream(sessionId, userMessage.trim(), signal)) {
        // Escapa \n para não quebrar o formato SSE
        const escapedChunk = chunk.replace(/\n/g, '\\n');
        res.write(`data: ${JSON.stringify({ chunk: escapedChunk, done: false })}\n\n`);
      }

      // Sinaliza fim do stream
      res.write(`data: ${JSON.stringify({ chunk: '', done: true })}\n\n`);
      res.end();
      this.logger.info(`[NativeHttpServer] SSE stream completed for session "${sessionId}".`);
    } catch (err) {
      if (signal.aborted) {
        this.logger.info(`[NativeHttpServer] SSE stream timed out for session "${sessionId}".`);
        res.write(`data: ${JSON.stringify({ error: 'Timeout', done: true })}\n\n`);
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[NativeHttpServer] SSE stream error for session "${sessionId}": ${errorMsg}`);
        res.write(`data: ${JSON.stringify({ error: errorMsg, done: true })}\n\n`);
      }
      res.end();
    }
  }

  /**
   * Handles GET /chat-history?sessionId=xxx
   * Retorna o histórico de mensagens da sessão.
   */
  private async handleChatHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Parâmetro "sessionId" é obrigatório' }));
      return;
    }

    try {
      const messages = await this.sessionManager.obterHistorico(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId, messages }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[NativeHttpServer] Error fetching history for session "${sessionId}": ${errorMsg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Erro ao buscar histórico' }));
    }
  }

  /**
   * Serve arquivos estáticos da pasta renderer.
   * Se o path for '/', serve index.html.
   */
  private async serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    // Se rendererDir não foi configurado, retorna 404
    if (!this.rendererDir) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Normaliza o path: '/' → '/index.html'
    const normalizedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = join(this.rendererDir, normalizedPath);

    try {
      // Verifica se o arquivo existe e é um arquivo regular
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        throw new Error('Not a file');
      }

      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      const content = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
      });
      res.end(content);
    } catch {
      // Arquivo não encontrado → 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  /**
   * Lê o corpo completo de uma requisição HTTP.
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', (err) => reject(err));
    });
  }

  /**
   * Obtém o sessionId do header X-Session-Id, ou cria um novo.
   */
  private getOrCreateSession(req: IncomingMessage): string {
    const existingSessionId = req.headers['x-session-id'];
    if (existingSessionId && typeof existingSessionId === 'string' && existingSessionId.length > 0) {
      return existingSessionId;
    }
    return randomUUID();
  }
}