# SOBERANO — Microsserviço Local de IA Generativa (Tauri + Node.js HTTP/SSE)

**Versão:** 0.9.1

## Stack

| Requisito | Tecnologia |
|-----------|-----------|
| Linguagem | TypeScript (Node.js nativo) |
| Testes | `node:test`, `node:assert`, `node:readline/promises` |
| Dependências | **Mínimas** — `@tauri-apps/cli`, `@types/node`, `typescript`, `tsx` |
| HTTP | `node:http` servidor + `fetch` global nativo |
| Streaming | SSE (Server-Sent Events) via `node:http` |
| Shell Desktop | Tauri (aponta para `dist/renderer/`) |
| Banco de Dados | `node:sqlite` (SQLite nativo — zero dependências NPM) |
| Embeddings | Ollama API (`nomic-embed-text`) via `fetch` nativo |

> **Nota sobre tipos:** Diferentemente da Fase 6, agora utilizamos `@types/node` para tipagem completa dos módulos nativos Node.js. O arquivo `src/env.d.ts` foi simplificado, mantendo apenas declarações específicas do projeto.

## Arquitetura (DIP + SOLID + Microsserviço Local)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Shell                              │
│  (WebView - aponta para dist/renderer/)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Frontend Vanilla (A Casca)                  │   │
│  │  - index.html, app.js, style                            │   │
│  │  - fetch() para POST /chat                              │   │
│  │  - getReader() para SSE streaming                       │   │
│  │  - Atualização do DOM em tempo real                     │   │
│  └──────────────┬──────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────┘
                  │ HTTP (localhost:3000)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              SOBERANO HTTP Server (Node.js nativo)              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  src/main.ts  (Bootstrap / Wiring)                       │  │
│  │  - AbortController global (graceful shutdown)            │  │
│  │  - Injeção de dependências (Options Object)              │  │
│  │  - Registro de ferramentas (ToolRegistry)                │  │
│  │  - Fechamento seguro de conexões DB no shutdown          │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  src/infra/NativeHttpServer.ts   (IHttpServer)           │  │
│  │  - GET  /healthz   → health check                       │  │
│  │  - GET  /chat-history?sessionId → histórico JSON         │  │
│  │  - POST /chat      → SSE streaming (conversarStream)    │  │
│  │  - Servir / (src/renderer/) → arquivos estáticos        │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  src/infra/ConversationManager.ts (IConversationManager) │  │
│  │  - conversarStream(sessionId, input, signal) → SSE      │  │
│  │  - ReAct Tool Loop (até 3 iterações)                    │  │
│  │  - RAG com SqliteVectorStore + OllamaEmbeddingProvider  │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  Providers Cognitivos (IMotorCognitivo)                   │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  OllamaProvider (padrão)                            │  │  │
│  │  │  - fetch para http://localhost:11434/api/chat       │  │  │
│  │  │  - Modelo: qwen2.5-coder:7b                        │  │  │
│  │  │  - Retry + Circuit Breaker + Tool Calling           │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  DeepSeekProvider (alternativo)                     │  │  │
│  │  │  - API nativa via fetch com fallback para Ollama    │  │  │
│  │  │  - Variável de ambiente PROVIDER=deepseek           │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  src/infra/SqliteSessionManager.ts (ISessionManager)     │  │
│  │  - Persistência Local-First com node:sqlite              │  │
│  │  - Pruning ativo no INSERT (remove mensagens antigas)    │  │
│  │  - Limite de contexto configurável (padrão 50 msgs)      │  │
│  │  - Fechamento seguro de conexão no shutdown              │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  src/infra/SqliteVectorStore.ts (IVectorStore)           │  │
│  │  - Banco vetorial real com node:sqlite                   │  │
│  │  - Similaridade Cosseno em JS nativo                     │  │
│  │  - Suporte a metadados (source, timestamp)               │  │
│  │  - Ingestão e busca com limite K configurável            │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  src/infra/OllamaEmbeddingProvider.ts (IEmbeddingProvider)│  │
│  │  - Geração de embeddings via Ollama API                  │  │
│  │  - Circuit Breaker integrado                             │  │
│  │  - Modelo: nomic-embed-text                              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

```
src/
├── core/                            # Contratos e lógica de negócio pura ("A Alma")
│   ├── ILogger.ts                                 # Abstração de logging + LogLevel enum
│   ├── IMotorCognitivo.ts                          # Abstração do motor cognitivo (LLM)
│   ├── ICircuitBreaker.ts                          # Abstração do Circuit Breaker
│   ├── IHttpServer.ts                              # Abstração do servidor HTTP
│   ├── ISensor.ts                                  # Abstração genérica de sensor (T)
│   ├── IEmbeddings.ts                              # Contrato para geração de embeddings vetoriais
│   ├── IEmbeddingProvider.ts                       # Contrato para provedor de embeddings
│   ├── IVectorStore.ts                             # Contrato para armazenamento e busca vetorial
│   ├── ISessionManager.ts                          # Contrato para gestão de sessões de conversa
│   ├── IConversationManager.ts                     # Contrato do Maestro (orquestração multi-turno)
│   ├── ITool.ts                                    # Contrato genérico de ferramenta (Tool Calling)
│   ├── IToolRegistry.ts                            # Contrato do registro de ferramentas
│   ├── ContextManager.ts                           # Gerenciador de contexto/memória (histórico limitado)
│   ├── ContextManager.test.ts
│   ├── SoberanoAgent.ts                            # Agente orquestrador (motor + memória)
│   └── SoberanoAgent.test.ts
├── infra/                            # Implementações técnicas ("Os Músculos")
│   ├── ConsoleLogger.ts                            # Logger concreto (stdout)
│   ├── ConsoleLogger.test.ts
│   ├── OllamaProvider.ts                           # Provider Ollama via fetch nativo
│   ├── OllamaProvider.test.ts
│   ├── DeepSeekProvider.ts                         # Provider DeepSeek via API nativa
│   ├── DeepSeekProvider.test.ts
│   ├── validateOllamaResponse.test.ts             # Testes de validação de schema da API
│   ├── CircuitBreaker.ts                           # Circuit Breaker (3 estados)
│   ├── CircuitBreaker.test.ts
│   ├── FileSensor.ts                               # Sensor de arquivo (ISensor<string>)
│   ├── FileSensor.test.ts
│   ├── NativeHttpServer.ts                         # Servidor HTTP nativo (IHttpServer) c/ SSE
│   ├── NativeHttpServer.test.ts
│   ├── SqliteSessionManager.ts                     # Persistência SQLite nativa (ISessionManager)
│   ├── SqliteSessionManager.test.ts
│   ├── SqliteVectorStore.ts                        # Banco vetorial real com SQLite
│   ├── MockVectorStore.ts                          # Vector Store mock (legado)
│   ├── OllamaEmbeddingProvider.ts                  # Embeddings via Ollama API
│   ├── InMemorySessionManager.ts                   # Gestão de sessões em memória (legado)
│   ├── InMemorySessionManager.test.ts
│   ├── ConversationManager.ts                      # Maestro: orquestra sessão + RAG + motor
│   ├── ConversationManager.test.ts
│   ├── ToolRegistry.ts                             # Registro de ferramentas
│   ├── ToolRegistry.test.ts
│   └── tools/                                      # Arsenal de ferramentas do agente
│       ├── SystemTimeTool.ts
│       ├── SystemTimeTool.test.ts
│       ├── CalculatorTool.ts
│       ├── CalculatorTool.test.ts
│       ├── ReadFileTool.ts
│       └── ReadFileTool.test.ts
├── renderer/                         # Frontend Vanilla ("A Casca" — servido como estático)
│   ├── index.html                    # Interface do chat (dark mode, responsivo)
│   └── app.js                        # Consumidor SSE via fetch/getReader
├── scripts/
│   └── ingest.ts                     # Script de ingestão de documentos para RAG
├── env.d.ts                          # Tipos manuais para APIs nativas do Node
├── main.ts                           # Bootstrap: wiring + servidor HTTP (ponto de entrada)
├── main-cli.ts                       # Ponto de entrada CLI (MVP original, legado)
└── cli.ts                            # CLI interativa com loop readline (Fase 8)
```

### Princípios

- **Abstração Primeiro:** Interfaces/classes abstratas em `src/core` antes de qualquer implementação
- **Inversão de Dependência:** Módulos de alto nível dependem de abstrações, não de implementações
- **Injeção via Options Object:** Dependências são injetadas via objeto de configuração tipado (nunca parâmetros posicionais)
- **Desacoplamento:** Detalhes técnicos nunca vazam para `src/core`
- **Streaming Nativo:** SSE (Server-Sent Events) via `node:http` — sem bibliotecas de terceiros
- **Microsserviço Local:** Backend Node.js puro na porta 3000; Tauri é apenas o shell desktop
- **Local-First:** Persistência com `node:sqlite` — zero dependências NPM para banco de dados
- **RAG Real:** Embeddings via Ollama + busca por similaridade cosseno em JS nativo

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
| POST /chat com SSE streaming — `conversarStream` transmite chunks em tempo real | ✅ **Fase 7** |
| GET /chat-history — retorna histórico JSON de uma sessão | ✅ **Fase 7** |
| Frontend Vanilla (renderer/) — fetch + getReader para SSE | ✅ **Fase 7** |
| Servir arquivos estáticos (src/renderer/) via NativeHttpServer | ✅ **Fase 7** |
| Electron removido — substituído por Tauri como shell desktop | ✅ **Fase 7** |
| Contrato IEmbeddings para geração de vetores | ✅ |
| Contrato IVectorStore para armazenamento e busca vetorial | ✅ |
| MockVectorStore — implementação em memória com similaridade cosseno | ✅ |
| Contrato ISessionManager — gestão de sessões de conversa | ✅ |
| InMemorySessionManager — implementação em memória com limite de mensagens | ✅ |
| Contrato IConversationManager — Maestro de orquestração multi-turno | ✅ |
| ConversationManager — pipeline: salva -> RAG -> funde contexto -> envia -> salva resposta | ✅ |
| Embedding Heurístico — vetor de 10 dimensões sem dependência externa | ✅ |
| Interface IToolDefinition para definição de ferramentas no request /api/chat | ✅ |
| Contrato ITool — interface genérica para ferramentas executáveis | ✅ |
| OllamaProvider envia tools[] no payload de /api/chat | ✅ |
| Retorno de ChatMessage completo de gerarResposta | ✅ |
| Sistema de agentes e ferramentas (tool use) | ✅ |
| ReAct/Tool Calling Loop no ConversationManager (até 3 iterações) | ✅ |
| **ContextManager — gerenciamento de contexto com limite configurável de mensagens** | ✅ **Nova na Fase 8** |
| **SoberanoAgent — agente orquestrador que integra motor cognitivo + memória via DI** | ✅ **Nova na Fase 8** |
| **CLI interativa (src/cli.ts) com loop readline e comandos /sair, /limpar, /ajuda** | ✅ **Nova na Fase 8** |
| **node:readline/promises — loop de terminal sem dependências externas** | ✅ **Nova na Fase 8** |
| **Testes unitários ContextManager.test.ts — 15 cenários (limite, imutabilidade, system prompt)** | ✅ **Nova na Fase 8** |
| **Testes unitários SoberanoAgent.test.ts — 7 cenários (contexto, limite, falha)** | ✅ **Nova na Fase 8** |
| **Persistência Local-First com `node:sqlite` (Zero Dependências NPM)** | ✅ **Nova na Fase 9** |
| **RAG Real com Ollama Embedding Provider (`nomic-embed-text`)** | ✅ **Nova na Fase 9** |
| **Banco Vetorial Nativo via JS e SQLite (`SqliteVectorStore`)** | ✅ **Nova na Fase 9** |
| **DeepSeek Provider — provider alternativo via API nativa com fallback** | ✅ |
| **Circuit Breaker integrado ao OllamaEmbeddingProvider** | ✅ |
| **Fechamento seguro de conexões DB (sessionManager + vectorStore) no shutdown** | ✅ |
| **Pruning ativo no SqliteSessionManager (remove mensagens antigas no INSERT)** | ✅ |
| **Script de ingestão de documentos para RAG (src/scripts/ingest.ts)** | ✅ **Nova na Fase 9** |
| **SqliteVectorStore com suporte a metadados (source, timestamp) e busca por similaridade** | ✅ **Nova na Fase 9** |

## Como Executar

### Pré-requisitos

- Node.js >= 22.12 (suporte a `node:sqlite` nativo)
- Servidor Ollama em execução (`ollama serve`)
- Modelo Ollama disponível (padrão: `qwen2.5-c