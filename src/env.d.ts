/**
 * @file env.d.ts
 * @description Declarações de tipos mínimas suplementares para o SOBERANO.
 *              Apenas o que o @types/node não cobre.
 */

// node:test (ainda não coberto pelo @types/node oficial)
declare module 'node:test' {
  interface TestContext {
    diagnostic(message: string): void;
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: (t: TestContext) => void | Promise<void>): void;
  interface MockCall {
    arguments: unknown[];
    result: unknown;
    error: unknown | undefined;
  }
  interface MockMethodObject {
    calls: MockCall[];
    callCount(): number;
    restore: () => void;
  }
  interface MockFunction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T>;
    mock: MockMethodObject;
  }
  export const mock: {
    fn<T extends (...args: any[]) => any>(implementation?: T): MockFunction<T>;
    method<T, K extends keyof T>(object: T, method: K, implementation?: ((...args: any[]) => any) | undefined): T[K] & { mock: MockMethodObject };
    restoreAll(): void;
  };
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}