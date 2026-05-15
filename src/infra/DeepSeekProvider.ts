/**
 * @file DeepSeekProvider.ts
 * @description Implementação concreta de IMotorCognitivo que se comunica
 *              com a API do DeepSeek via HTTP (fetch nativo).
 *              - Depende da abstração IMotorCognitivo (DIP).
 *              - Retry automático com maxRetries e delayBase configuráveis.
 *              - Timeout configurável via AbortController.
 *              - Aceita AbortSignal externo para graceful shutdown.
 *              - Validação de schema da resposta.
 *              - Logger injetado via construtor.
 */

import { IMotorCognitivo } from '../core/IMotorCognitivo.ts';
import type { ChatMessage, IToolDefinition } from '../core/IMotorCognitivo.ts';
import { ILogger } from '../core/ILogger.ts';
import { ICircuitBreaker } from '../core/ICircuitBreaker.ts';

export interface DeepSeekConfig {
  logger: ILogger;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  delayBase?: number;
  timeoutMs?: number;
  circuitBreaker?: ICircuitBreaker;
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface DeepSeekChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: DeepSeekMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Valida em runtime se um valor desconhecido é um DeepSeekChatResponse válido.
 * Lança erro descritivo se algum campo obrigatório estiver ausente.
 */
export function validateDeepSeekResponse(data: unknown): DeepSeekChatResponse {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error(`[DeepSeekProvider] Invalid response: expected object`);
  }

  const record = data as Record<string, unknown>;

  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    throw new Error(`[DeepSeekProvider] Field "choices" missing, empty, or invalid`);
  }

  const choice = record.choices[0] as Record<string, unknown>;
  
  if (choice.message === null || choice.message === undefined || typeof choice.message !== 'object') {
    throw new Error(`[DeepSeekProvider] Field "choices[0].message" missing or invalid`);
  }

  const messageRecord = choice.message as Record<string, unknown>;

  if (typeof messageRecord.role !== 'string' || messageRecord.role !== 'assistant') {
    throw new Error(`[DeepSeekProvider] Field "choices[0].message.role" missing or invalid`);
  }

  if (messageRecord.content !== null && typeof messageRecord.content !== 'string') {
    throw new Error(`[DeepSeekProvider] Field "choices[0].message.content" invalid`);
  }

  const hasToolCalls = Array.isArray(messageRecord.tool_calls) && messageRecord.tool_calls.length > 0;
  
  if (!messageRecord.content && !hasToolCalls) {
    throw new Error(`[DeepSeekProvider] Field "choices[0].message.content" is empty and no tool_calls provided`);
  }

  return data as DeepSeekChatResponse;
}

export class DeepSeekProvider extends IMotorCognitivo {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly logger: ILogger;
  private readonly maxRetries: number;
  private readonly delayBase: number;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: ICircuitBreaker;
  private externalSignal: AbortSignal | null = null;

  constructor(config: DeepSeekConfig) {
    super();
    this.logger = config.logger;
    this.apiKey = config.apiKey;
    
    if (!this.apiKey) {
      throw new Error('[DeepSeekProvider] API Key is required.');
    }

    this.baseUrl = config.baseUrl ?? 'https://api.deepseek.com';
    this.model = config.model ?? 'deepseek-chat';
    this.maxRetries = config.maxRetries ?? 3;
    this.delayBase = config.delayBase ?? 1_000;
    this.timeoutMs = config.timeoutMs ?? 30_000;

    if (!config.circuitBreaker) {
      throw new Error(
        '[DeepSeekProvider] CircuitBreaker is required for DIP compliance. ' +
        'Provide an instance of ICircuitBreaker in the configuration.'
      );
    }
    this.circuitBreaker = config.circuitBreaker;
  }

  setAbortSignal(signal: AbortSignal): void {
    this.externalSignal = signal;
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(() => {
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }
    });
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('econnrefused') ||
        msg.includes('socket hang up') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('fetch failed') ||
        msg.includes('http error 429') || // Rate limit
        msg.includes('http error 500') ||
        msg.includes('http error 502') ||
        msg.includes('http error 503') ||
        msg.includes('http error 504')
      );
    }
    return false;
  }

  private formatMessages(mensagens: ChatMessage[]): any[] {
    return mensagens.map(msg => {
      const formatted: any = {
        role: msg.role,
        content: msg.content,
      };

      // Se for tool call result
      if (msg.role === 'tool' && msg.tool_call_id) {
        formatted.tool_call_id = msg.tool_call_id;
      }

      // Se assistant chamou tools
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        formatted.tool_calls = msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: JSON.stringify(tc.function.arguments),
          }
        }));
      }

      return formatted;
    });
  }

  async gerarResposta(mensagens: ChatMessage[], tools?: IToolDefinition[]): Promise<ChatMessage> {
    const url = `${this.baseUrl}/chat/completions`;

    const payload: Record<string, any> = {
      model: this.model,
      messages: this.formatMessages(mensagens),
      stream: false,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        }
      }));
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const attemptController = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let removeExternalListener: (() => void) | null = null;

      try {
        this.logger.info(
          `[DeepSeekProvider] Attempt ${attempt}/${this.maxRetries} - Sending messages to model "${this.model}"` +
          (tools ? ` with ${tools.length} tool(s) defined` : '')
        );

        timeoutHandle = setTimeout(() => {
          attemptController.abort();
        }, this.timeoutMs);

        if (this.externalSignal) {
          const onAbort = () => {
            attemptController.abort();
          };
          this.externalSignal.addEventListener('abort', onAbort);
          removeExternalListener = () => {
            this.externalSignal!.removeEventListener('abort', onAbort);
          };

          if (this.externalSignal.aborted) {
            attemptController.abort();
          }
        }

        const executeFetch = async (): Promise<DeepSeekChatResponse> => {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: attemptController.signal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => 'No error body available');
            throw new Error(
              `[DeepSeekProvider] HTTP error ${response.status} communicating with the cognitive engine.\n` +
              `  URL: ${url}\n` +
              `  Model: ${this.model}\n` +
              `  Details: ${errorBody}`
            );
          }

          const rawData: unknown = await response.json();
          const validated = validateDeepSeekResponse(rawData);

          const contentLength = validated.choices[0]?.message.content?.length ?? 0;
          this.logger.info(
            `[DeepSeekProvider] Attempt ${attempt} succeeded. Response received (${contentLength} chars).`
          );

          return validated;
        };

        const data: DeepSeekChatResponse = await this.circuitBreaker.execute(executeFetch);
        const choice = data.choices[0];
        if (!choice) throw new Error('[DeepSeekProvider] Empty choices array');
        const msg = choice.message;

        const resposta: ChatMessage = {
          role: 'assistant',
          content: msg.content ?? '',
        };

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          resposta.tool_calls = msg.tool_calls.map(tc => {
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments);
            } catch (e) {
              this.logger.warn(`[DeepSeekProvider] Failed to parse tool call arguments: ${tc.function.arguments}`);
            }
            return {
              id: tc.id,
              function: {
                name: tc.function.name,
                arguments: parsedArgs,
              }
            };
          });
        }

        return resposta;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Erros HTTP 4xx (exceto 429) são irrecuperáveis
        if (error instanceof Error && /HTTP error [4][0-9]{2}/.test(error.message) && !error.message.includes('429')) {
          this.logger.error(
            `[DeepSeekProvider] Non-retryable HTTP error in attempt ${attempt}/${this.maxRetries}. ` +
            `Breaking immediately.\n  Error: ${lastError.message}`
          );
          break;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          this.logger.error(
            `[DeepSeekProvider] Operation aborted in attempt ${attempt}/${this.maxRetries}. ` +
            `Breaking immediately.\n  Error: ${lastError.message}`
          );
          break;
        }

        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const delayMs = this.delayBase * attempt;
          this.logger.warn(
            `[DeepSeekProvider] Attempt ${attempt} failed (connection error). ` +
            `Retrying in ${delayMs}ms...\n` +
            `  Error: ${lastError.message}`
          );
          if (this.externalSignal?.aborted) {
            break;
          }
          try {
            await this.delay(delayMs, this.externalSignal ?? undefined);
          } catch (delayError) {
            break;
          }
          continue;
        }

        this.logger.error(
          `[DeepSeekProvider] Unrecoverable error in attempt ${attempt}/${this.maxRetries}. ` +
          `Breaking.\n  Error: ${lastError.message}`
        );

        break;
      } finally {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }
        if (removeExternalListener) {
          removeExternalListener();
        }
      }
    }

    throw lastError ?? new Error('[DeepSeekProvider] Unknown failure after retry');
  }

  async *gerarRespostaStream(
    mensagens: ChatMessage[],
    tools?: IToolDefinition[],
    signal?: AbortSignal
  ): AsyncIterable<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const payload: Record<string, any> = {
      model: this.model,
      messages: this.formatMessages(mensagens),
      stream: true,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        }
      }));
    }

    const controller = new AbortController();

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    if (this.externalSignal) {
      this.externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    this.logger.info(
      `[DeepSeekProvider] Starting stream for model "${this.model}"` +
      (tools ? ` with ${tools.length} tool(s) defined` : '')
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'No error body available');
      throw new Error(
        `[DeepSeekProvider] HTTP error ${response.status} during stream.\n` +
        `  URL: ${url}\n  Model: ${this.model}\n  Details: ${errorBody}`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('[DeepSeekProvider] Response body is not readable for streaming');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; 

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6);
            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                yield chunk.choices[0].delta.content;
              }
            } catch {
              // Silently skip malformed JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.logger.info(`[DeepSeekProvider] Stream completed for model "${this.model}"`);
    }
  }
}
