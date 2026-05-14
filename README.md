# SOBERANO — Sistema de Orquestração com Engenharia de Software de Alta Robustez

**Versão:** 0.6.0 — Fase 6 (Sistema de Agentes e Ferramentas)

## Stack

| Requisito | Tecnologia |
|-----------|-----------|
| Linguagem | TypeScript (Node.js nativo) |
| Testes | `node:test`, `node:assert` |
| Dependências | **Zero** — PROIBIDO bibliotecas externas |
| HTTP | `fetch` global nativo |

> **Nota sobre `src/env.d.ts`:** Para manter o compromisso de dependência externa zero, este projeto não utiliza `@types/node`. Em vez disso, o arquivo `src/env.d.ts` declara manualmente apenas os tipos necessários das APIs nativas (HTTP, filesystem, AbortSignal, etc.). Isso elimina a necessidade de instalar um pacote de tipos externo, mantendo o projeto autocontido e leve. Sempre que um novo módulo nativo for utilizado, seus tipos devem ser adicionados a este arquivo.

## Arquitetura (DIP + SOLID)

```
src/
├── core/              # Contratos e lógica de negócio pura ("A Alma")
│   ├── ILogger.ts             # Abstração de logging + LogLevel enum
│   ├── IMotorCognitivo.ts     # Abstração do motor cognitivo (LLM) + ChatMessage + IToolDefinition
│   ├── ICircuitBreaker.ts     # Abstração do Circuit Breaker
│   ├── IHttpServer.ts         # Abstração do servidor HTTP
│   ├── ISensor.ts             # Abstração genérica de sensor (T)
│   ├── IEmbeddings.ts         # Contrato para geração de embeddings vetoriais
│   ├── IVectorStore.ts        # Contrato para armazenamento e busca vetorial
│   ├── ISessionManager.ts     # Contrato para gestão de sessões de conversa
│   ├── IConversationManager.ts # Contrato do Maestro (orquestração multi-turno)
│   └── ITool.ts                # Contrato genérico de ferramenta (Tool Calling)
├── infra/             # Implementações técnicas ("Os Músculos")
│   ├── ConsoleLogger.ts            # Logger concreto (stdout)
│   ├── ConsoleLogger.test.ts
│   ├── OllamaProvider.ts           # Provider Ollama via fetch nativo (endpoint /api/chat)
│   ├── OllamaProvider.test.ts
│   ├── validateOllamaResponse.test.ts # Testes de validação de schema da API
│   ├── CircuitBreaker.ts           # Circuit Breaker (3 estados)
│   ├── CircuitBreaker.test.ts
│   ├── FileSensor.ts               # Sensor de arquivo (ISensor<string>)
│   ├── FileSensor.test.ts
│   ├── NativeHttpServer.ts         # Servidor HTTP nativo (IHttpServer)
│   ├── NativeHttpServer.test.ts
│   ├── MockVectorStore.ts          # Vector Store mock (validação sem dependências externas)
│   ├── InMemorySessionManager.ts   # Gestão de sessões em memória (ISessionManager)
│   ├── InMemorySessionManager.test.ts
│   ├── ConversationManager.ts      # Maestro: orquestra sessão + RAG + motor cognitivo
│   └── ConversationManager.test.ts
├── env.d.ts           # Tipos manuais para APIs nativas do Node
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
| Comunicação com Ollama via REST (fetch nativo) — endpoint /api/chat | ✅ |
| Interface ChatMessage (role: system/user/assistant/tool, content, tool_calls, tool_call_id) | ✅ |
| Retry automático com backoff progressivo | ✅ |
| Circuit Breaker (CLOSED / OPEN / HALF_OPEN) | ✅ |
| Timeout global (120s) via `AbortSignal.timeout` | ✅ |
| Graceful shutdown (SIGINT/SIGTERM) | ✅ |
| Validação de schema em runtime da resposta da API (incluindo tool_calls) | ✅ |
| Testes unitários com `node:test` e `mock.method` | ✅ |
| Sensor de arquivo (FileSensor) com `node:fs/promises` | ✅ Estabilizada |
| Contrato genérico ISensor\<T\> (preparação para novos sensores) | ✅ |
| Servidor HTTP nativo (IHttpServer) com rota /healthz | ✅ |
| Contrato IEmbeddings para geração de vetores | ✅ |
| Contrato IVectorStore para armazenamento e busca vetorial | ✅ |
| MockVectorStore — implementação em memória com similaridade cosseno | ✅ |
| Contrato ISessionManager — gestão de sessões de conversa | ✅ |
| InMemorySessionManager — implementação em memória com limite de mensagens | ✅ |
| Contrato IConversationManager — Maestro de orquestração multi-turno | ✅ |
| ConversationManager — pipeline: salva → RAG → funde contexto → envia → salva resposta | ✅ |
| Embedding Heurístico — vetor de 10 dimensões sem dependência externa | ✅ |
| Demonstração integrada no main.ts (2 turnos de conversa com sessão) | ✅ |
| Interface IToolDefinition para definição de ferramentas no request /api/chat | ✅ |
| Contrato ITool — interface genérica para ferramentas executáveis (getDefinition, execute) | ✅ |
| OllamaProvider envia tools[] no payload de /api/chat quando fornecido | ✅ |
| Retorno de ChatMessage completo de gerarResposta (permite processar tool_calls) | ✅ |
| validação de respostas com tool_calls (content vazio permitido se houver tool_calls) | ✅ |

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

# Typecheck sem executar
npm run typecheck
```

## Roadmap

| Fase | Descrição | Status |
|------|-----------|--------|
| **1** | CLI MVP — comunicação básica com Ollama + Circuit Breaker | ✅ **Concluída** |
| **2** | Sensores — FileSensor (leitura de arquivos locais) | ✅ **Concluída** |
| **3** | Memória — Embeddings + Vector Store (RAG Tradicional) | ✅ **Concluída** |
| **4** | Qualidade de Teste e Determinismo — timeouts mínimos, mock.fn, assertions de retry | ✅ **Concluída** |
| **5** | Gerenciamento de contexto e sessões multi-turno | ✅ **Concluída** |
| **6** | Sistema de agentes e ferramentas (tool use) | ✅ **Concluída** |
| **7** | Web UI (React) + WebSocket | ⏳ Planejada |

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
interface IToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, any> };
  }>;
  tool_call_id?: string;
}

abstract class IMotorCognitivo {
  abstract setAbortSignal(signal: AbortSignal): void;
  abstract gerarResposta(mensagens: ChatMessage[], tools?: IToolDefinition[]): Promise<ChatMessage>;
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

### `ITool`

```typescript
abstract class ITool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parametersSchema: Record<string, any>;
  abstract execute(args: Record<string, any>): Promise<any>;
  abstract getDefinition(): IToolDefinition;
}
```

### `IEmbeddings`

```typescript
abstract class IEmbeddings {
  abstract gerarVector(text: string): Promise<number[]>;
}
```

### `IVectorStore<M>`

```typescript
abstract class IVectorStore<M = any> {
  abstract adicionar(id: string, vector: number[], metadata: M): Promise<void>;
  abstract buscarSimilares(vector: number[], limit: number): Promise<
    { id: string; metadata: M; score: number }[]
  >;
}
```

### `ISessionManager`

```typescript
abstract class ISessionManager {
  abstract adicionarMensagem(sessionId: string, message: ChatMessage): Promise<void>;
  abstract obterHistorico(sessionId: string): Promise<ChatMessage[]>;
  abstract limparSessao(sessionId: string): Promise<void>;
}
```

### `IConversationManager`

```typescript
abstract class IConversationManager {
  abstract conversar(sessionId: string, input: string): Promise<string>;
}
```

## Convenções

- **Código e logs internos:** Inglês
- **Mensagens para o usuário:** PT-BR
- **Testes:** `node:test` nativo com `mock.method()` para isolamento
- **Commits:** Descritivos em inglês, seguindo conventional commits