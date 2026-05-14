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

import http from 'node:http';
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
  private server: http.Server | null = null;
  private readonly logger: ILogger;
  private readonly abortSignal?: AbortSignal;
  private abortListener: (() => void) | null = null;

  constructor(options: NativeHttpServerOptions) {
    super();
    this.logger = options.logger;
    this.abortSignal = options.abortSignal;
  }

  async start(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
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

      this.server.listen(port, () => {
        this.logger.info(`[NativeHttpServer] HTTP server listening on port ${port}`);
        resolve();
      });

      // Se o listen falhar (porta ocupada, etc.), rejeita a promise
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Remove o listener de abort para não causar loop
      if (this.abortSignal && this.abortListener) {
        this.abortSignal.removeEventListener('abort', this.abortListener);
        this.abortListener = null;
      }

      this.server.close((err) => {
        if (err) {
          this.logger.error(`[NativeHttpServer] Error closing server: ${err.message}`);
          reject(err);
          return;
        }
        this.logger.info('[NativeHttpServer] Server closed successfully.');
        this.server = null;
        resolve();
      });
    });
  }
}