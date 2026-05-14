/**
 * @file ICircuitBreaker.ts
 * @description Contrato de abstração para o padrão Circuit Breaker.
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas.
 *
 *              Estados: CLOSED (normal), OPEN (falhando), HALF_OPEN (teste).
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export abstract class ICircuitBreaker {
  /** Estado atual do circuit breaker */
  abstract get state(): CircuitState;

  /**
   * Executa uma operação respeitando o estado do circuit breaker.
   * - CLOSED: executa normalmente, registra sucesso/falha
   * - OPEN: lança erro imediatamente (a menos que o timeout tenha expirado para HALF_OPEN)
   * - HALF_OPEN: permite 1 chamada de teste; sucesso volta para CLOSED, falha volta para OPEN
   *
   * @param fn - Função assíncrona a ser protegida
   * @returns O resultado da função
   * @throws {Error} Se o circuit breaker estiver OPEN e o timeout não tiver expirado
   */
  abstract execute<T>(fn: () => Promise<T>): Promise<T>;

  /** Registra uma falha manualmente (para uso externo) */
  abstract recordFailure(): void;

  /** Reseta o circuit breaker para o estado CLOSED */
  abstract reset(): void;
}