/**
 * @file OllamaProvider.ts
 * @description Implementação concreta de IMotorCognitivo que se comunica
 *              com o servidor local Ollama via API REST (fetch nativo).
 *              - Depende da abstração IMotorCognitivo, não o contrário (DIP).
 *              - Retry automático com maxRetries e delayBase configuráveis.
 *              - Timeout configurável via AbortController.
 *              - Aceita AbortSignal externo para graceful shutdown.
 *              - Validação rigorosa de schema da resposta.
 *              - Logger injetado via construtor.
 */

import { IMotorCognitivo } from '../core/IMotorCognitivo.ts';
import { ILogger } from '../core/ILogger.ts';
import { ICircuitBreaker } from '../core/ICircuitBreaker.ts';

export interface OllamaConfig {
  logger: ILogger;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  delayBase?: number;
  timeoutMs?: number;
  circuitBreaker?: ICircuitBreaker;
}

export interface OllamaGenerateResponse {
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

/**
 * Valida em runtime se um valor desconhecido é um OllamaGenerateResponse válido.
 * Lança erro descritivo se algum campo obrigatório estiver ausente ou com tipo incorreto.
 *
 * @param data - Dado desconhecido a ser validado
 * @returns O dado tipado como OllamaGenerateResponse
 * @throws {Error} Se a validação falhar
 */
export function validateOllamaResponse(data: unknown): OllamaGenerateResponse {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error(
      `[OllamaProvider] Invalid response: expected object, received ${typeof data}`
    );
  }

  const record = data as Record<string, unknown>;

  if (typeof record.model !== 'string') {
    throw new Error(
      `[OllamaProvider] Field "model" missing or invalid: expected string, received ${typeof record.model}`
    );
  }

  if (typeof record.response !== 'string') {
    throw new Error(
      `[OllamaProvider] Field "response" missing or invalid: expected string, received ${typeof record.response}`
    );
  }

  if (typeof record.done !== 'boolean') {
    throw new Error(
      `[OllamaProvider] Field "done" missing or invalid: expected boolean, received ${typeof record.done}`
    );
  }

  // created_at is required by the Ollama API specification
  if (typeof record.created_at !== 'string') {
    throw new Error(
      `[OllamaProvider] Field "created_at" missing or invalid: expected string, received ${typeof record.created_at}`
    );
  }

  return {
    model: record.model,
    created_at: record.created_at,
    response: record.response,
    done: record.done,
    context: Array.isArray(record.context) ? (record.context as number[]) : undefined,
    total_duration: typeof record.total_duration === 'number' ? record.total_duration : undefined,
    load_duration: typeof record.load_duration === 'number' ? record.load_duration : undefined,
    prompt_eval_count: typeof record.prompt_eval_count === 'number' ? record.prompt_eval_count : undefined,
    prompt_eval_duration: typeof record.prompt_eval_duration === 'number' ? record.prompt_eval_duration : undefined,
    eval_count: typeof record.eval_count === 'number' ? record.eval_count : undefined,
    eval_duration: typeof record.eval_duration === 'number' ? record.eval_duration : undefined,
  };
}

export class OllamaProvider extends IMotorCognitivo {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger: ILogger;
  private readonly maxRetries: number;
  private readonly delayBase: number;
  private readonly timeoutMs: number;
  private readonly circuitBreaker?: ICircuitBreaker;
  private externalSignal: AbortSignal | null = null;

  /**
   * @param config - Objeto de configuração (OllamaConfig). Apenas `logger` é obrigatório.
   */
  constructor(config: OllamaConfig) {
    super();
    this.logger = config.logger;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'qwen2.5-coder:3b';
    this.maxRetries = config.maxRetries ?? 3;
    this.delayBase = config.delayBase ?? 1_000;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.circuitBreaker = config.circuitBreaker;
  }

  /**
   * Injeta um AbortSignal externo para graceful shutdown.
   * Quando este sinal for abortado, todas as requisições em andamento
   * serão canceladas.
   */
  setAbortSignal(signal: AbortSignal): void {
    this.externalSignal = signal;
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
   * Implementa retry automático (máximo configurável) para erros de conexão.
   * Implementa timeout via AbortController em cada tentativa.
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
      const attemptController = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout>;

      // Função de cleanup que remove o listener externo e limpa o timeout
      let removeExternalListener: (() => void) | null = null;

      try {
        this.logger.info(
          `[OllamaProvider] Attempt ${attempt}/${this.maxRetries} - Sending prompt to model "${this.model}"`
        );

        // Configura timeout para esta tentativa
        timeoutHandle = setTimeout(() => {
          attemptController.abort();
        }, this.timeoutMs);

        // Se há um sinal externo (shutdown), escuta para propagar o abort
        if (this.externalSignal) {
          const onAbort = () => {
            attemptController.abort();
          };
          this.externalSignal.addEventListener('abort', onAbort);
          removeExternalListener = () => {
            this.externalSignal!.removeEventListener('abort', onAbort);
          };

          // Se o sinal externo já está abortado, aborta imediatamente
          if (this.externalSignal.aborted) {
            attemptController.abort();
          }
        }

        const executeFetch = async (): Promise<OllamaGenerateResponse> => {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: attemptController.signal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No error body available');
            throw new Error(
              `[OllamaProvider] HTTP error ${response.status} communicating with the cognitive engine.\n` +
              `  URL: ${url}\n` +
              `  Model: ${this.model}\n` +
              `  Details: ${errorBody}`
            );
          }

          const rawData: unknown = await response.json();

          // Validação rigorosa de schema em runtime
          const validated = validateOllamaResponse(rawData);

          this.logger.info(
            `[OllamaProvider] Attempt ${attempt} succeeded. Response received (${validated.response.length} chars).`
          );

          return validated;
        };

        const data: OllamaGenerateResponse = this.circuitBreaker
          ? await this.circuitBreaker.execute(executeFetch)
          : await executeFetch();

        return data.response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const delayMs = this.delayBase * attempt; // backoff: 1x, 2x, 3x
          this.logger.warn(
            `[OllamaProvider] Attempt ${attempt} failed (connection error). ` +
            `Retrying in ${delayMs}ms...\n` +
            `  Error: ${lastError.message}`
          );
          if (this.externalSignal?.aborted) {
            break;
          }
          await this.delay(delayMs);
          continue;
        }

        // Se não for retryável ou acabaram as tentativas, propaga o erro
        if (attempt >= this.maxRetries) {
          this.logger.error(
            `[OllamaProvider] All ${this.maxRetries} attempts failed. ` +
            `Giving up.\n  Last error: ${lastError.message}`
          );
        }
        break;
      } finally {
        clearTimeout(timeoutHandle);
        if (removeExternalListener) {
          removeExternalListener();
        }
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    throw lastError ?? new Error('[OllamaProvider] Unknown failure after retry');
  }
}