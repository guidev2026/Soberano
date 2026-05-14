/**
 * @file OllamaProvider.ts
 * @description Implementação concreta de IMotorCognitivo que se comunica
 *              com o servidor local Ollama via API REST (fetch nativo).
 *              - Depende da abstração IMotorCognitivo, não o contrário (DIP).
 *              - Retry automático (3 tentativas) para erros de conexão.
 *              - Logger injetado via construtor.
 */

import { IMotorCognitivo } from '../core/IMotorCognitivo.ts';
import { ILogger } from '../core/ILogger.ts';

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaProvider extends IMotorCognitivo {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger: ILogger;
  private readonly maxRetries: number = 3;

  /**
   * @param logger  - Instância de ILogger para logging estruturado
   * @param baseUrl - URL base do servidor Ollama (padrão: http://localhost:11434)
   * @param model   - Nome do modelo a ser utilizado (padrão: qwen2.5-coder:3b)
   */
  constructor(
    logger: ILogger,
    baseUrl: string = 'http://localhost:11434',
    model: string = 'qwen2.5-coder:3b'
  ) {
    super();
    this.logger = logger;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  /**
   * Aguarda um tempo determinado (ms) usando setTimeout encapsulado em Promise.
   * Usado entre tentativas de retry.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Determina se um erro é recuperável (conexão/temporário) para retry.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }
    if (error instanceof Error) {
      // Erros de rede/DNS/ECONNREFUSED geralmente disparam TypeError no fetch
      const msg = error.message.toLowerCase();
      return (
        msg.includes('econnrefused') ||
        msg.includes('socket hang up') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('fetch failed')
      );
    }
    return false;
  }

  /**
   * Envia um prompt ao modelo Ollama e retorna a resposta gerada.
   * Utiliza exclusivamente o fetch nativo do Node.js (sem dependências externas).
   * Implementa retry automático (máximo de 3 tentativas) para erros de conexão.
   *
   * @param prompt - O texto de entrada para o modelo.
   * @returns A resposta gerada pelo modelo.
   * @throws {Error} Se após todas as tentativas a comunicação falhar.
   */
  async gerarResposta(prompt: string): Promise<string> {
    const url = `${this.baseUrl}/api/generate`;

    const payload = {
      model: this.model,
      prompt,
      stream: false,
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.info(
          `[OllamaProvider] Tentativa ${attempt}/${this.maxRetries} - Enviando prompt ao modelo "${this.model}"`
        );

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Sem corpo de erro disponível');
          throw new Error(
            `[OllamaProvider] Erro HTTP ${response.status} ao comunicar com o motor cognitivo.\n` +
            `  URL: ${url}\n` +
            `  Modelo: ${this.model}\n` +
            `  Detalhes: ${errorBody}`
          );
        }

        const data = (await response.json()) as OllamaGenerateResponse;

        if (data.response === undefined || data.response === null) {
          throw new Error(
            `[OllamaProvider] Resposta inesperada do motor cognitivo: campo "response" ausente.\n` +
            `  Corpo recebido: ${JSON.stringify(data)}`
          );
        }

        this.logger.info(
          `[OllamaProvider] Tentativa ${attempt} bem-sucedida. Resposta recebida (${data.response.length} caracteres).`
        );

        return data.response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const delayMs = 1000 * attempt; // backoff: 1s, 2s, 3s
          this.logger.warn(
            `[OllamaProvider] Tentativa ${attempt} falhou (erro de conexão). ` +
            `Nova tentativa em ${delayMs}ms...\n` +
            `  Erro: ${lastError.message}`
          );
          await this.delay(delayMs);
          continue;
        }

        // Se não for retryável ou acabaram as tentativas, propaga o erro
        if (attempt >= this.maxRetries) {
          this.logger.error(
            `[OllamaProvider] Todas as ${this.maxRetries} tentativas falharam. ` +
            `Desistindo.\n  Último erro: ${lastError.message}`
          );
        }
        break;
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    throw lastError ?? new Error('[OllamaProvider] Falha desconhecida após retry');
  }
}