/**
 * @file env.d.ts
 * @description Declarações de tipos mínimas para APIs nativas do Node.js.
 *              Necessário porque não podemos instalar @types/node (zero dependências externas).
 *              Apenas o essencial para eliminar erros de TypeScript no VS Code.
 */

// Process global
declare var process: {
  exit(code?: number): never;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(event?: string): void;
};

// node:test
declare module 'node:test' {
  interface TestContext {
    diagnostic(message: string): void;
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: (t: TestContext) => void | Promise<void>): void;
  export const mock: {
    fn: typeof Function;
  };
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
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