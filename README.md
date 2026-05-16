# SOBERANO — Microsserviço Local de IA Generativa (Tauri + Node.js HTTP/SSE)

**Versão:** 0.9.0

## Stack

| Requisito | Tecnologia |
|-----------|-----------|
| Linguagem | TypeScript (Node.js nativo) |
| Testes | `node:test`, `node:assert`, `node:readline/promises` |
| Dependências | **Mínimas** — `@tauri-apps/cli`, `@types/node`, `typescript`, `tsx` |
| HTTP | `node:http` servidor + `fetch` global nativo |
| Streaming | SSE (Server-Sent Events) via `node:http` |
| Shell Desktop | Tauri (aponta para `dist/renderer/`) |

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
│  │  src/infra/ConversationManager.ts  (IConversationManager)│  │
│  │  - conversarStream(sessionId, input, signal) → SSE      │  │
│  │  - ReAct Tool Loop (até 3 iterações)                    │  │
│  │  - RAG com MockVectorStore                              │  │
│  └──────────┬───────────────────────────────────────────────┘  │
│             │                                                  │
│  ┌──────────▼───────────────────────────────────────────────┐  │
│  │  src/infra/OllamaProvider.ts  (IMotorCognitivo)          │  │
│  │  - fetch para http://localhost:11434/api/chat            │  │
│  │  - Retry com backoff + Circuit Breaker                   │  │
│  │  - Tool Calling (Fase 6)                                │  │
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
│   ├── IVectorStore.ts                             # Contrato para armazenamento e busca vetorial
│   ├── ISessionManager.ts                          # Contrato para gestão de sessões de conversa
│   ├── IConversationManager.ts                     # Contrato do Maestro (orquestração multi-turno)
│   ├── ITool.ts                                    # Contrato genérico de ferramenta (Tool Calling)
│   ├── ContextManager.ts                           # Gerenciador de contexto/memória (histórico limitado)
│   └── SoberanoAgent.ts                            # Agente orquestrador (motor + memória)
├── infra/                            # Implementações técnicas ("Os Músculos")
│   ├── ConsoleLogger.ts                            # Logger concreto (stdout)
│   ├── ConsoleLogger.test.ts
│   ├── OllamaProvider.ts                           # Provider Ollama via fetch nativo
│   ├── OllamaProvider.test.ts
│   ├── validateOllamaResponse.test.ts             # Testes de validação de schema da API
│   ├── CircuitBreaker.ts                           # Circuit Breaker (3 estados)
│   ├── CircuitBreaker.test.ts
│   ├── FileSensor.ts                               # Sensor de arquivo (ISensor<string>)
│   ├── FileSensor.test.ts
│   ├── NativeHttpServer.ts                         # Servidor HTTP nativo (IHttpServer) c/ SSE
│   ├── NativeHttpServer.test.ts
│   ├── MockVectorStore.ts                          # Vector Store mock
│   ├── InMemorySessionManager.ts                   # Gestão de sessões em memória
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

## Como Executar

### Pré-requisitos

- Node.js >= 20 (fetch nativo, `node:test`)
- Servidor Ollama em execução (`ollama serve`)
- Modelo Ollama disponível (padrão: `llama3.2:1b`)
- **Tauri CLI** (opcional, para build desktop)

### Scripts do `package.json`

| Comando | Descrição |
|---------|-----------|
| `npm run start:server` | Inicia o servidor HTTP SOBERANO na porta 3000 |
| `npm run start:server:dev` | Inicia com `--watch` para recarregar automático em desenvolvimento |
| `npm run tauri:dev` | Inicia o Tauri em modo dev (abre janela desktop apontando para `http://localhost:3000`) |
| `npm run tauri:build` | Compila o binário desktop Tauri |
| `npm run tauri:init` | Inicializa a configuração do Tauri no projeto |
| `npm test` | Roda **todos** os testes unitários (`src/infra/*.test.ts`, `src/infra/tools/*.test.ts`, `src/core/*.test.ts`) |
| `npm run test:ollama` | Testes do OllamaProvider isoladamente |
| `npm run test:circuit` | Testes do CircuitBreaker isoladamente |
| `npm run test:file` | Testes do FileSensor isoladamente |
| `npm run test:http` | Testes do NativeHttpServer isoladamente |
| `npm run typecheck` | TypeScript type-check sem executar (`tsc --noEmit`) |

### Fluxo de Desenvolvimento

```bash
# Terminal 1: Iniciar servidor backend
npm run start:server

# Terminal 2: Iniciar Tauri (opcional — ou acessar http://localhost:3000 no navegador)
npm run tauri:dev

# Terminal 3: CLI interativa (Fase 8)
npx tsx src/cli.ts

# Testes
npm test
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
| **6.4** | Red Team Fixes (bugs críticos no loop ReAct) + Electron Prep (streaming, cancelamento) | ✅ **Concluída** |
| **6.5** | Blindagem Final — Degradação Graciosa RAG, Defensive Copy SessionManager, Shutdown Determinístico, Fallback ReAct Edge Case | ✅ **Concluída** |
| **7** | **Pivot: Microsserviço Local (HTTP/SSE + Tauri)** <br><br> • Electron removido (incompatível com Ubuntu 22.04 — SIGSEGV Chromium)<br> • Backend Node.js como servidor HTTP puro na porta 3000<br> • Rota POST /chat com SSE streaming (conversarStream)<br> • Frontend Vanilla (renderer/) — fetch + getReader para SSE<br> • Tauri como shell desktop (aponta para dist/renderer/)<br> • Graceful shutdown com AbortController global<br> • `@tauri-apps/cli` + `@types/node` | ✅ **Concluída** |
| **8** | **Núcleo de Interação — Gerenciador de Contexto + Agente + CLI** <br><br> • ContextManager — histórico com limite configurável de mensagens<br> • SoberanoAgent — agente que integra IMotorCognitivo + ContextManager via DI<br> • CLI interativa (node:readline/promises) com comandos /sair, /limpar, /ajuda<br> • 22 testes unitários (15 ContextManager + 7 SoberanoAgent) | ✅ **Concluída** |
| **9** | **Motor de Persistência e RAG Local (Zero Deps)** <br><br> • Banco relacional `node:sqlite` para persistência das sessões (Local-First).<br> • Gerador de Embeddings apontando via Fetch para a API do Ollama (`nomic-embed-text`).<br> • Banco Vetorial com SQLite executando matemática de similaridade nativa em memória JS.<br> • Script dedicado de ingestão de documentos para RAG de forma isolada. | ✅ **Concluída** |