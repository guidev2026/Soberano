/**
 * @file env.d.ts
 * @description Declarações de tipos mínimas para APIs nativas do Node.js.
 *              Necessário porque não podemos instalar @types/node (zero dependências externas).
 *              Apenas o essencial para eliminar erros de TypeScript no VS Code.
 */

// Buffer global (necessário para node:fs/promises overloads)
declare class Buffer {
  length: number;
  static from(data: string, encoding?: string): Buffer;
  toString(encoding?: string): string;
}

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

// queueMicrotask
declare function queueMicrotask(callback: () => void): void;

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

// node:http
declare module 'node:http' {
  interface IncomingMessage {
    url?: string | undefined;
    method?: string | undefined;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
  interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(data?: string): void;
  }
  type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;
  interface Server {
    listen(port: number, callback?: () => void): void;
    close(callback?: (err?: Error) => void): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    address(): { port: number; family?: string; address?: string } | string | null;
  }
  export function createServer(requestListener: RequestListener): Server;
}

// node:fs/promises
declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Buffer>;
  export function readFile(path: string, options: { encoding: string; signal?: AbortSignal }): Promise<string>;
  export function readFile(path: string, options?: { encoding?: string; signal?: AbortSignal }): Promise<string | Buffer>;
}

// node:assert
declare module 'node:assert' {
  interface Assert {
    ok(value: unknown, message?: string): void;
    strictEqual<T>(actual: T, expected: T, message?: string): void;
    deepStrictEqual<T>(actual: T, expected: T, message?: string): void;
    throws(
      block: () => unknown,
      error?: RegExp | Function | Object | Error,
      message?: string
    ): void;
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