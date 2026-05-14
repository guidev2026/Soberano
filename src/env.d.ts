/**
 * @file env.d.ts
 * @description Declarações de tipos mínimas para APIs nativas do Node.js.
 *              Necessário porque não podemos instalar @types/node (zero dependências externas).
 *              Apenas o essencial para eliminar erros de TypeScript no VS Code.
 */

// Process global
declare var process: {
  argv: string[];
  exit(code?: number): never;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(event?: string): void;
};

// AbortController e AbortSignal (API nativa global)
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare class AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
  static timeout(ms: number): AbortSignal;
  static any(signals: AbortSignal[]): AbortSignal;
}

// setTimeout e clearTimeout
declare function setTimeout(
  callback: (...args: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): ReturnType<typeof setTimeout>;
declare function clearTimeout(timeoutId: ReturnType<typeof setTimeout> | undefined): void;

// node:test
declare module 'node:test' {
  interface TestContext {
    diagnostic(message: string): void;
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: (t: TestContext) => void | Promise<void>): void;
  interface MockFunction<T extends (...args: unknown[]) => unknown> {
    (...args: Parameters<T>): ReturnType<T>;
  }
  interface MockMethod<T, K extends keyof T> {
    mock: {
      restore: () => void;
    };
  }
  export const mock: {
    fn: typeof Function;
    method<T, K extends keyof T>(object: T, method: K, implementation?: (...args: any[]) => any): MockMethod<T, K>;
  };
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

// node:fs/promises
declare module 'node:fs/promises' {
  export function readFile(path: string, options?: { encoding?: string; signal?: AbortSignal }): Promise<string>;
  export function readFile(path: string, options: { encoding: null; signal?: AbortSignal }): Promise<Buffer>;
}

// node:assert
declare module 'node:assert' {
  interface Assert {
    ok(value: unknown, message?: string): void;
    strictEqual<T>(actual: T, expected: T, message?: string): void;
    rejects(
      block: (() => Promise<unknown>) | Promise<unknown>,
      error?: RegExp | Function | Object | Error,
      message?: string
    ): Promise<void>;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}