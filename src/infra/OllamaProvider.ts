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
      `[OllamaProvider] Resposta inválida: esperado objeto, recebido ${typeof data}`
    );
  }

  const record = data as Record<string, unknown>;

  if (typeof record.model !== 'string') {
    throw new Error(
      `[OllamaProvider] Campo "model" ausente ou inválido: esperado string, recebido ${typeof record.model}`
    );
  }

  if (typeof record.response !== 'string') {
    throw new Error(
      `[OllamaProvider] Campo "response" ausente ou inválido: esperado string, recebido ${typeof record.response}`
    );
  }

  if (typeof record.done !== 'boolean') {
    throw new Error(
      `[OllamaProvider] Campo "done" ausente ou inválido: esperado boolean, recebido ${typeof record.done}`
    );
  }

  // created_at é obrigatório na especificação da API Ollama
  if (typeof record.created_at !== 'string') {
    throw new Error(
      `[OllamaProvider] Campo "created_at" ausente ou inválido: esperado string, recebido ${typeof record.created_at}`
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
  private externalSignal: AbortSignal | null = null;

  /**
   * @param logger     - Instância de ILogger para logging estruturado
   * @param baseUrl    - URL base do servidor Ollama (padrão: http://localhost:11434)
   * @param model      - Nome do modelo a ser utilizado (padrão: qwen2.5-coder:3b)
   * @param maxRetries - Número máximo de tentativas em caso de erro retryable (padrão: 3)
   * @param delayBase  - Base do delay entre tentativas em ms (padrão: 1000)
   * @param timeoutMs  - Timeout em ms para cada requisição fetch (padrão: 30000)
   */
  constructor(
    logger: ILogger,
    baseUrl: string = 'http://localhost:11434',
    model: string = 'qwen2.5-coder:3b',
    maxRetries: number = 3,
    delayBase: number = 1_000,
    timeoutMs: number = 30_000
  ) {
    super();
    this.logger = logger;
    this.baseUrl = baseUrl;
    this.model = model;
    this.maxRetries = maxRetries;
    this.delayBase = delayBase;
    this.timeoutMs = timeoutMs;
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
        msg.includes('fetch failed') ||
        msg.includes('aborted') ||
        msg.includes('abort')
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
          `[OllamaProvider] Tentativa ${attempt}/${this.maxRetries} - Enviando prompt ao modelo "${this.model}"`
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

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: attemptController.signal,
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

        const rawData: unknown = await response.json();

        // Validação rigorosa de schema em runtime
        const data = validateOllamaResponse(rawData);

        this.logger.info(
          `[OllamaProvider] Tentativa ${attempt} bem-sucedida. Resposta recebida (${data.response.length} caracteres).`
        );

        return data.response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const delayMs = this.delayBase * attempt; // backoff: 1x, 2x, 3x
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
      } finally {
        clearTimeout(timeoutHandle);
        if (removeExternalListener) {
          removeExternalListener();
        }
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    throw lastError ?? new Error('[OllamaProvider] Falha desconhecida após retry');
  }
}