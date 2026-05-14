/**
 * @file CircuitBreaker.ts
 * @description Implementação concreta do padrão Circuit Breaker com 3 estados:
 *              CLOSED, OPEN, HALF_OPEN.
 *              - Abre após N falhas consecutivas (padrão: 3)
 *              - Permanece OPEN por tempo configurável (padrão: 30s)
 *              - Em OPEN, lança erro imediatamente sem tentar a operação
 *              - Injeta ILogger via construtor
 */

import { ICircuitBreaker, CircuitState } from '../core/ICircuitBreaker.ts';
import { ILogger } from '../core/ILogger.ts';

export interface CircuitBreakerOptions {
  /** Instância de ILogger para logging estruturado */
  logger: ILogger;
  /** Número de falhas consecutivas para abrir o circuito (padrão: 3) */
  failureThreshold?: number;
  /** Tempo em ms para permanecer em OPEN antes de HALF_OPEN (padrão: 30000) */
  openTimeoutMs?: number;
}

export class CircuitBreaker extends ICircuitBreaker {
  private _state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly openTimeoutMs: number;
  private readonly logger: ILogger;
  private isProbeInProgress: boolean = false;

  /**
   * @param options - Objeto de configuração seguindo o padrão Options Object.
   */
  constructor(options: CircuitBreakerOptions) {
    super();
    this.logger = options.logger;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.openTimeoutMs = options.openTimeoutMs ?? 30_000;
  }

  get state(): CircuitState {
    // Getter puro: retorna o estado interno sem efeitos colaterais.
    // NÃO realiza transições automáticas aqui.
    return this._state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Verifica transições de estado antes de qualquer lógica de decisão
    this.checkStateTransitions();

    if (this._state === CircuitState.OPEN) {
      this.logger.warn(
        `[CircuitBreaker] Circuit is OPEN. Request rejected immediately.`
      );
      throw new Error(
        '[CircuitBreaker] Circuit is open. Operation not allowed at this time.'
      );
    }

    if (this._state === CircuitState.HALF_OPEN) {
      // Proteção contra concorrência: apenas a primeira chamada em HALF_OPEN é permitida
      if (this.isProbeInProgress) {
        this.logger.warn(
          `[CircuitBreaker] Probe already in progress. Concurrent HALF_OPEN request rejected.`
        );
        throw new Error(
          '[CircuitBreaker] Circuit is open. Operation not allowed at this time.'
        );
      }
      this.isProbeInProgress = true;
      this.logger.info(
        `[CircuitBreaker] Circuit is HALF_OPEN. Allowing test request.`
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn(
      `[CircuitBreaker] Failure recorded (${this.failureCount}/${this.failureThreshold}). Current state: ${this._state}`
    );

    if (
      this._state === CircuitState.CLOSED &&
      this.failureCount >= this.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this._state === CircuitState.HALF_OPEN) {
      // Atualiza lastFailureTime novamente mesmo na transição HALF_OPEN -> OPEN
      // para garantir que a nova janela de timeout seja respeitada integralmente.
      this.lastFailureTime = Date.now();
      this.isProbeInProgress = false;
      this.transitionTo(CircuitState.OPEN);
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.isProbeInProgress = false;
    this.transitionTo(CircuitState.CLOSED);
  }

  private checkStateTransitions(): void {
    // Transição OPEN -> HALF_OPEN se o timeout expirou
    if (this._state === CircuitState.OPEN && this.hasTimeoutElapsed()) {
      this.transitionTo(CircuitState.HALF_OPEN);
    }
  }

  private recordSuccess(): void {
    if (this._state === CircuitState.HALF_OPEN) {
      this.isProbeInProgress = false;
      this.logger.info(
        `[CircuitBreaker] Test request succeeded. Returning to CLOSED state.`
      );
    }

    this.failureCount = 0;
    this.lastFailureTime = 0;

    if (this._state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  private hasTimeoutElapsed(): boolean {
    return Date.now() - this.lastFailureTime >= this.openTimeoutMs;
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this._state;
    this._state = newState;

    this.logger.info(
      `[CircuitBreaker] State transition: ${oldState} -> ${newState}`
    );
  }
}