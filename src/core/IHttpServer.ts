/**
 * @file IHttpServer.ts
 * @description Contrato de abstração para servidor HTTP nativo do SOBERANO.
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas.
 *
 *              Suporta start/stop para integração com graceful shutdown.
 */

export abstract class IHttpServer {
  /**
   * Inicia o servidor HTTP na porta especificada.
   * @param port - Número da porta para escutar (ex: 3000)
   */
  abstract start(port: number): Promise<void>;

  /**
   * Para o servidor HTTP de forma limpa.
   * Fecha todas as conexões ativas e libera a porta.
   */
  abstract stop(): Promise<void>;
}