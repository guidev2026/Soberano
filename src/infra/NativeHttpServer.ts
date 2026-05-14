/**
 * @file NativeHttpServer.ts
 * @description Implementação concreta do servidor HTTP utilizando exclusivamente
 *              o módulo nativo node:http. Zero dependências externas.
 *
 *              - start(port): cria server, registra rota health-check, escuta na porta
 *              - stop(): encerra o servidor de forma limpa (close + removeAllListeners)
 *              - Responde a GET /healthz com JSON { status: "ok" } e status 200
 *              - Responde a qualquer outra rota com 404
 *              - Integra-se ao AbortSignal global para graceful shutdown
 */

import { createServer, Server } from 'node:http';
import { IHttpServer } from '../core/IHttpServer.ts';
import { ILogger } from '../core/ILogger.ts';

export interface NativeHttpServerOptions {
  logger: ILogger;
  /**
   * Sinal de aborto global. Quando disparado, o servidor executa stop()
   * automaticamente. Use o shutdownController.signal do bootstrap.
   */
  abortSignal?: AbortSignal;
}

export class NativeHttpServer extends IHttpServer {
  private server: Server | null = null;
  private readonly logger: ILogger;
  private readonly abortSignal?: AbortSignal;
  private abortListener: (() => void) | null = null;
  private actualPort: number | null = null;
  /** Flag de idempotência para stop(). Evita múltiplas chamadas simultâneas a close(). */
  private stopping: boolean = false;
  /** Flag que indica se a Promise de start() já foi resolvida.
   *  Quando false, erros do server rejeitam a Promise.
   *  Quando true, erros são apenas logados (runtime errors). */
  private startResolved: boolean = false;

  constructor(options: NativeHttpServerOptions) {
    super();
    this.logger = options.logger;
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
        // Rota de health-check
        if (req.url === '/healthz' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', service: 'SOBERANO' }));
          return;
        }

        // Qualquer outra rota → 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
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

      // Listener de erro do server.
      // Se a Promise ainda não foi resolvida, rejeita (erro de start).
      // Se já foi resolvida, apenas loga (erro de runtime).
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
    // Idempotente: se já está parando ou servidor é null, resolve imediatamente
    if (this.stopping || !this.server) {
      return;
    }

    this.stopping = true;

    // Remove o listener de abort para não causar loop
    if (this.abortSignal && this.abortListener) {
      this.abortSignal.removeEventListener('abort', this.abortListener);
      this.abortListener = null;
    }

    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          // Se o servidor já não estava ouvindo (ENOTCONN), trata como sucesso
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
}