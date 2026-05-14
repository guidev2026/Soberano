# SOBERANO — Sistema de Orquestração com Engenharia de Software de Alta Robustez

**Versão:** 0.1.0 — Fase 1 (CLI MVP)

## Stack

| Requisito | Tecnologia |
|-----------|-----------|
| Linguagem | TypeScript (Node.js nativo) |
| Testes | `node:test`, `node:assert` |
| Dependências | **Zero** — PROIBIDO bibliotecas externas |
| HTTP | `fetch` global nativo |

## Arquitetura (DIP + SOLID)

```
src/
├── core/              # Contratos e lógica de negócio pura ("A Alma")
│   ├── ILogger.ts         # Abstração de logging + LogLevel enum
│   ├── IMotorCognitivo.ts # Abstração do motor cognitivo (LLM)
│   └── ICircuitBreaker.ts # Abstração do Circuit Breaker
├── infra/             # Implementações técnicas ("Os Músculos")
│   ├── ConsoleLogger.ts       # Logger concreto (stdout)
│   ├── OllamaProvider.ts      # Provider Ollama via fetch nativo
│   ├── OllamaProvider.test.ts # Testes unitários do provider
│   ├── CircuitBreaker.ts      # Circuit Breaker (3 estados)
│   └── CircuitBreaker.test.ts # Testes unitários do CB
└── main.ts            # Orquestração, wiring manual, ponto de entrada
```

### Princípios

- **Abstração Primeiro:** Interfaces/classes abstratas em `src/core` antes de qualquer implementação
- **Inversão de Dependência:** Módulos de alto nível (`main.ts`) dependem de abstrações, não de implementações
- **Injeção via Construtor:** Dependências são injetadas no construtor (não Service Locator)
- **Options Object:** Classes com múltiplas configurações usam objeto de configuração tipado
- **Desacoplamento:** Detalhes técnicos nunca vazam para `src/core`

## Funcionalidades Implementadas

| Funcionalidade | Status |
|----------------|--------|
| Logging estruturado com níveis (DEBUG, INFO, WARN, ERROR) | ✅ |
| Filtragem por nível mínimo de log | ✅ |
| Comunicação com Ollama via REST (fetch nativo) | ✅ |
| Retry automático com backoff progressivo | ✅ |
| Circuit Breaker (CLOSED / OPEN / HALF_OPEN) | ✅ |
| Timeout global (120s) via `AbortSignal.timeout` | ✅ |
| Graceful shutdown (SIGINT/SIGTERM) | ✅ |
| Validação de schema em runtime da resposta da API | ✅ |
| Testes unitários com `node:test` e `mock.method` | ✅ |

## Como Executar

### Pré-requisitos

- Node.js >= 18 (fetch nativo)
- Servidor Ollama em execução (`ollama serve`)
- Modelo Ollama disponível (padrão: `qwen2.5-coder:3b`)

### Comandos

```bash
# Iniciar o sistema (CLI MVP)
npm start

# Rodar todos os testes
npm test

# Rodar testes específicos
npm run test:ollama
npm run test:circuit

# Typecheck sem executar
npm run typecheck
```

## Roadmap

| Fase | Descrição | Status |
|------|-----------|--------|
| **1** | CLI MVP — comunicação básica com Ollama + Circuit Breaker | ✅ **Concluída** |
| **2** | Servidor HTTP (Express-like nativo) + API REST | ⏳ Planejada |
| **3** | Gerenciamento de contexto e sessões multi-turno | ⏳ Planejada |
| **4** | Sistema de agentes e ferramentas (tool use) | ⏳ Planejada |
| **5** | Web UI (React) + WebSocket | ⏳ Planejada |

## Contratos do Core

### `ILogger`

```typescript
enum LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 }

abstract class ILogger {
  abstract minLevel: LogLevel;
  abstract info(message: string): void;
  abstract warn(message: string): void;
  abstract error(message: string): void;
  abstract debug(message: string): void;
}
```

### `IMotorCognitivo`

```typescript
abstract class IMotorCognitivo {
  abstract setAbortSignal(signal: AbortSignal): void;
  abstract gerarResposta(prompt: string): Promise<string>;
}
```

### `ICircuitBreaker`

```typescript
enum CircuitState { CLOSED, OPEN, HALF_OPEN }

abstract class ICircuitBreaker {
  abstract readonly state: CircuitState;
  abstract execute<T>(fn: () => Promise<T>): Promise<T>;
  abstract recordFailure(): void;
  abstract reset(): void;
}
```

## Convenções

- **Código e logs internos:** Inglês
- **Mensagens para o usuário:** PT-BR
- **Testes:** `node:test` nativo com `mock.method()` para isolamento
- **Commits:** Descritivos em inglês, seguindo conventional commits