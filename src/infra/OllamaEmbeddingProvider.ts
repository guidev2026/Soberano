/**
 * @file OllamaEmbeddingProvider.ts
 * @description Implementação do gerador de embeddings utilizando a API do Ollama.
 *              Faz a chamada HTTP via fetch nativo do Node.js.
 */

import { IEmbeddingProvider } from '../core/IEmbeddingProvider.ts';
import { ILogger } from '../core/ILogger.ts';
import { ICircuitBreaker } from '../core/ICircuitBreaker.ts';

export interface OllamaEmbeddingProviderOptions {
  /** Instância do logger */
  logger: ILogger;
  /** Modelo de embeddings no Ollama (Padrão: nomic-embed-text) */
  model?: string;
  /** URL base do Ollama (Padrão: http://localhost:11434) */
  baseUrl?: string;
  /** Instância do CircuitBreaker para proteção contra falhas do servidor de embeddings */
  circuitBreaker: ICircuitBreaker;
}

export class OllamaEmbeddingProvider extends IEmbeddingProvider {
  private readonly logger: ILogger;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly circuitBreaker: ICircuitBreaker;

  /**
   * @param options - Objeto de configuração (OllamaEmbeddingProviderOptions).
   * @throws {Error} Se circuitBreaker não for fornecido (DIP obrigatório).
   */
  constructor(options: OllamaEmbeddingProviderOptions) {
    super();
    this.logger = options.logger;
    this.model = options.model ?? 'nomic-embed-text';
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';

    if (!options.circuitBreaker) {
      throw new Error(
        '[OllamaEmbeddingProvider] CircuitBreaker is required for DIP compliance. ' +
        'Provide an instance of ICircuitBreaker in the configuration.'
      );
    }
    this.circuitBreaker = options.circuitBreaker;
  }

  async gerarEmbedding(texto: string): Promise<number[]> {
    const url = `${this.baseUrl}/api/embeddings`;
    const body = JSON.stringify({
      model: this.model,
      prompt: texto
    });

    const executeFetch = async (): Promise<number[]> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { embedding: number[] };

      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Formato de resposta inválido do Ollama: embedding não encontrado.');
      }

      return data.embedding;
    };

    try {
      return await this.circuitBreaker.execute(executeFetch);
    } catch (error) {
      this.logger.error(`[OllamaEmbeddingProvider] Falha ao gerar embedding: ${error}`);
      throw error;
    }
  }
}
