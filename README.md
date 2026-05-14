# SOBERANO — Sistema de Orquestração com Engenharia de Software de Alta Robustez

**Versão:** 0.2.0 — Fase 2 (Sensores: FileSensor)

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
│   ├── ICircuitBreaker.ts # Abstração do Circuit Breaker
│   └── ISensor.ts         # Abstração genérica de sensor (T)
├── infra/             # Implementações técnicas ("Os Músculos")
│   ├── ConsoleLogger.ts       # Logger concreto (stdout)
│   ├── OllamaProvider.ts      # Provider Ollama via fetch nativo
│   ├── OllamaProvider.test.ts # Testes unitários do provider
│   ├── CircuitBreaker.ts      # Circuit Breaker (3 estados)
│   ├── CircuitBreaker.test.ts # Testes unitários do CB
│   ├── FileSensor.ts          # Sensor de arquivo (ISensor<string>)
│   └── FileSensor.test.ts     # Testes unitários do FileSensor
└── main.ts            # Orquestração, wiring manual, ponto de entrada
```

### Princípios

- **Abstração Primeiro:** Interfaces/classes abstratas em `src/core` antes de qualquer implementação
- **Inversão de Dependência:** Módulos de alto nível (`main.ts`) dependem de abstrações, não de implementações
- **Injeção via Construtor/Options Object:** Dependências são injetadas no construtor (não Service Locator)
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
| Sensor de arquivo (FileSensor) com `node:fs/promises` | ✅ |
| Contrato genérico ISensor\<T\> (preparação para novos sensores) | ✅ |

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
npm run test:file

# Typecheck sem executar
npm run typecheck
```

## Roadmap

| Fase | Descrição | Status |
|------|-----------|--------|
| **1** | CLI MVP — comunicação básica com Ollama + Circuit Breaker | ✅ **Concluída** |
| **2** | Sensores — FileSensor (leitura de arquivos locais) | ✅ **Concluída** |
| **3** | Servidor HTTP (Express-like nativo) + API REST | ⏳ Planejada |
| **4** | Gerenciamento de contexto e sessões multi-turno | ⏳ Planejada |
| **5** | Sistema de agentes e ferramentas (tool use) | ⏳ Planejada |
| **6** | Web UI (React) + WebSocket | ⏳ Planejada |

## Contratos do Core

### `ILogger`

```typescript
enum LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 }

abstract class ILogger {
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

### `ISensor<T>`

```typescript
abstract class ISensor<T> {
  abstract ler(target: string, signal?: AbortSignal): Promise<T>;
}
```

## Convenções

- **Código e logs internos:** Inglês
- **Mensagens para o usuário:** PT-BR
- **Testes:** `node:test` nativo com `mock.method()` para isolamento
- **Commits:** Descritivos em inglês, seguindo conventional commits