/**
 * @file OllamaEmbeddingProvider.ts
 * @description Implementação do gerador de embeddings utilizando a API do Ollama.
 *              Faz a chamada HTTP via fetch nativo do Node.js.
 */

import { IEmbeddingProvider } from '../core/IEmbeddingProvider.ts';
import { ILogger } from '../core/ILogger.ts';

export interface OllamaEmbeddingProviderOptions {
  /** Instância do logger */
  logger: ILogger;
  /** Modelo de embeddings no Ollama (Padrão: nomic-embed-text) */
  model?: string;
  /** URL base do Ollama (Padrão: http://localhost:11434) */
  baseUrl?: string;
}

export class OllamaEmbeddingProvider extends IEmbeddingProvider {
  private readonly logger: ILogger;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OllamaEmbeddingProviderOptions) {
    super();
    this.logger = options.logger;
    this.model = options.model ?? 'nomic-embed-text';
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';
  }

  async gerarEmbedding(texto: string): Promise<number[]> {
    const url = `${this.baseUrl}/api/embeddings`;
    
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: texto
          })
        });

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { embedding: number[] };
        
        if (!data.embedding || !Array.isArray(data.embedding)) {
          throw new Error('Formato de resposta inválido do Ollama: embedding não encontrado.');
        }

        return data.embedding;
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error(`[OllamaEmbeddingProvider] Falha ao gerar embedding após ${maxRetries} tentativas: ${error}`);
          throw error;
        }
        this.logger.warn(`[OllamaEmbeddingProvider] Falha na tentativa ${attempt}. Tentando novamente...`);
        // Pequeno delay
        await new Promise(res => setTimeout(res, 500 * attempt));
      }
    }
    
    throw new Error('Falha inesperada ao gerar embedding');
  }
}
