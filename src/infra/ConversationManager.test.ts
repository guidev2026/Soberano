/**
 * @file ConversationManager.test.ts
 * @description Testes unitários para o ConversationManager com foco no ReAct/Tool Calling Loop.
 *              Utiliza node:test com classes mock concretas para garantir isolamento e determinismo.
 *              Zero dependências externas.
 *
 * Cobertura:
 * - Fluxo sem tool calling (resposta direta)
 * - Fluxo com tool calling bem-sucedido (1 iteração)
 * - Tool calling com ferramenta não encontrada
 * - Tool calling que atinge maxToolIterations (fallback)
 * - Tool calling com ToolRegistry ausente
 * - Cancelamento via AbortSignal
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

import { ConversationManager } from './ConversationManager.ts';
import { IMotorCognitivo, type ChatMessage, type IToolDefinition } from '../core/IMotorCognitivo.ts';
import { ISessionManager } from '../core/ISessionManager.ts';
import { ILogger } from '../core/ILogger.ts';
import { IToolRegistry } from '../core/IToolRegistry.ts';
import { ITool } from '../core/ITool.ts';

// ---------- Mocks concretos (classes que estendem as abstratas) ----------

class MockLogger extends ILogger {
  info = mock.fn();
  warn = mock.fn();
  error = mock.fn();
  debug = mock.fn();
}

class MockSessionManager extends ISessionManager {
  private historico: ChatMessage[] = [];

  adicionarMensagem = mock.fn(async (_sessionId: string, mensagem: ChatMessage): Promise<void> => {
    this.historico.push(mensagem);
  });

  obterHistorico = mock.fn(async (_sessionId: string): Promise<ReadonlyArray<ChatMessage>> => {
    return [...this.historico];
  });

  limparSessao = mock.fn(async (_sessionId: string): Promise<void> => {
    this.historico = [];
  });
}

class MockMotor extends IMotorCognitivo {
  private callIndex = 0;

  constructor(private readonly respostas: ChatMessage[]) {
    super();
  }

  setAbortSignal = mock.fn();

  gerarResposta = mock.fn(async (_mensagens: ChatMessage[], _tools?: IToolDefinition[]): Promise<ChatMessage> => {
    const r = this.respostas[this.callIndex];
    if (!r) throw new Error('[MockMotor] No more responses configured');
    this.callIndex++;
    return r;
  });

  gerarRespostaStream = mock.fn(async function* (..._args: any[]): AsyncIterable<string> {
    yield '';
  });
}

class MockToolRegistry extends IToolRegistry {
  private readonly map: Map<string, ITool>;

  constructor(tools: ITool[]) {
    super();
    this.map = new Map(tools.map(t => [t.name, t]));
  }

  registrar = mock.fn();
  obter = mock.fn((nome: string): ITool | undefined => this.map.get(nome));
  obterTodas = mock.fn((): ITool[] => [...this.map.values()]);
}

/** Cria uma tool fake concreta que estende ITool */
function criaToolFake(nome: string, resultado: any): ITool & { executeMock: ReturnType<typeof mock.fn> } {
  const executeMock = mock.fn(async (_args: Record<string, any>) => resultado);
  const tool = new (class extends ITool {
    get name() { return nome; }
    get description() { return `Ferramenta fake ${nome}`; }
    get parametersSchema() { return { type: 'object' as const, properties: {} }; }
    execute = executeMock;
  })();
  return Object.assign(tool, { executeMock });
}

// ---------- Testes ----------

describe('ConversationManager - ReAct Loop', () => {
  describe('fluxo sem tool calling', () => {
    it('deve retornar resposta direta do assistant quando não há tool_calls', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const motor = new MockMotor([
        { role: 'assistant', content: 'Resposta final.' },
      ]);

      const cm = new ConversationManager({ logger, motor, sessionManager });
      const resposta = await cm.conversar('sessao-1', 'Olá');

      assert.strictEqual(resposta, 'Resposta final.');
      assert.strictEqual(sessionManager.adicionarMensagem.mock.callCount(), 2); // user + assistant
      assert.strictEqual(motor.gerarResposta.mock.callCount(), 1);
    });
  });

  describe('fluxo com tool calling bem-sucedido', () => {
    it('deve executar tool, salvar resultado e retornar resposta final', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const toolCalc = criaToolFake('calculadora', { resultado: 42 });
      const toolRegistry = new MockToolRegistry([toolCalc]);

      const motor = new MockMotor([
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_abc123', function: { name: 'calculadora', arguments: { a: 1, b: 2 } } }],
        },
        { role: 'assistant', content: 'Resultado é 42.' },
      ]);

      const cm = new ConversationManager({ logger, motor, sessionManager, toolRegistry });
      const resposta = await cm.conversar('sessao-2', 'Quanto é 1+2?');

      assert.strictEqual(resposta, 'Resultado é 42.');
      assert.strictEqual(motor.gerarResposta.mock.callCount(), 2); // 1ª com tools, 2ª sem
      assert.strictEqual(toolCalc.executeMock.mock.callCount(), 1);

      // Verifica que o tool_call_id real foi usado na mensagem tool
      const historico = await sessionManager.obterHistorico('sessao-2');
      const toolMessages = historico.filter(m => m.role === 'tool');
      assert.ok(toolMessages.some(m => m.tool_call_id === 'call_abc123'));
    });
  });

  describe('tool calling com ferramenta não encontrada', () => {
    it('deve retornar erro simulado quando ferramenta não existe no registry', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const toolRegistry = new MockToolRegistry([]);

      const motor = new MockMotor([
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_xyz', function: { name: 'toolInexistente', arguments: {} } }],
        },
        { role: 'assistant', content: 'Ferramenta não encontrada.' },
      ]);

      const cm = new ConversationManager({ logger, motor, sessionManager, toolRegistry });
      const resposta = await cm.conversar('sessao-3', 'Execute toolInexistente');

      assert.strictEqual(resposta, 'Ferramenta não encontrada.');
      assert.strictEqual(motor.gerarResposta.mock.callCount(), 2);
    });
  });

  describe('maxToolIterations atingido', () => {
    it('deve retornar fallback seguro quando excede o limite de iterações', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const toolCalc = criaToolFake('loopTool', { ok: true });
      const toolRegistry = new MockToolRegistry([toolCalc]);

      // Cada resposta pede tool novamente — simula loop infinito
      const motor = new MockMotor([
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'loopTool', arguments: {} } }] },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_2', function: { name: 'loopTool', arguments: {} } }] },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_3', function: { name: 'loopTool', arguments: {} } }] },
        // depth 3 >= maxToolIterations(3) — deve cair no fallback antes da 4ª chamada
        { role: 'assistant', content: 'Nunca vou ser chamado.' },
      ]);

      const cm = new ConversationManager({ logger, motor, sessionManager, toolRegistry, maxToolIterations: 3 });
      const resposta = await cm.conversar('sessao-4', 'Loop infinito');

      // Deve ter chamado o motor 3 vezes (depth 0, 1, 2) e parado no fallback
      assert.strictEqual(motor.gerarResposta.mock.callCount(), 3);
      // A resposta é do tipo string (fallback seguro)
      assert.strictEqual(typeof resposta, 'string');
    });

    it('deve retornar mensagem de corte quando fallback não encontra assistant com conteúdo', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const toolCalc = criaToolFake('loopTool', { ok: true });
      const toolRegistry = new MockToolRegistry([toolCalc]);

      // Apenas 1 resposta com tool_call (content vazio)
      const motor = new MockMotor([
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'loopTool', arguments: {} } }] },
      ]);

      const cm = new ConversationManager({ logger, motor, sessionManager, toolRegistry, maxToolIterations: 1 });
      const resposta = await cm.conversar('sessao-5', 'Loop');

      // maxToolIterations=1, depth 0 < 1, depth 1 >= 1 — 1 chamada, fallback
      assert.strictEqual(motor.gerarResposta.mock.callCount(), 1);
      assert.strictEqual(
        resposta,
        '[SOBERANO] Limite de iterações de ferramentas atingido. A execução foi interrompida para garantir estabilidade.'
      );
    });
  });

  describe('ToolRegistry ausente', () => {
    it('deve funcionar quando tool_calls são recebidas sem ToolRegistry', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();

      const motor = new MockMotor([
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_noop', function: { name: 'semRegistry', arguments: {} } }],
        },
        { role: 'assistant', content: 'ToolRegistry não configurado, mas segui em frente.' },
      ]);

      const cm = new ConversationManager({ logger, motor, sessionManager });
      const resposta = await cm.conversar('sessao-6', 'Teste sem registry');

      assert.strictEqual(resposta, 'ToolRegistry não configurado, mas segui em frente.');
      assert.strictEqual(motor.gerarResposta.mock.callCount(), 2);
    });
  });

  describe('cancelamento via AbortSignal', () => {
    it('deve propagar o signal para o motor cognitivo', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const motor = new MockMotor([
        { role: 'assistant', content: 'Resposta antes do abort.' },
      ]);

      const ac = new AbortController();
      const cm = new ConversationManager({ logger, motor, sessionManager });
      const resposta = await cm.conversar('sessao-7', 'Mensagem normal', ac.signal);

      assert.strictEqual(resposta, 'Resposta antes do abort.');
      assert.strictEqual(motor.setAbortSignal.mock.callCount(), 1);
    });

    it('deve propagar o signal na recursão do tool loop', async () => {
      const logger = new MockLogger();
      const sessionManager = new MockSessionManager();
      const toolCalc = criaToolFake('calc', { resultado: 10 });
      const toolRegistry = new MockToolRegistry([toolCalc]);

      const motor = new MockMotor([
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', function: { name: 'calc', arguments: {} } }],
        },
        { role: 'assistant', content: 'Recursão concluída.' },
      ]);

      const ac = new AbortController();
      const cm = new ConversationManager({ logger, motor, sessionManager, toolRegistry });
      const resposta = await cm.conversar('sessao-8', 'Teste com signal', ac.signal);

      assert.strictEqual(resposta, 'Recursão concluída.');
      // setAbortSignal foi chamado em cada depth (2 vezes)
      assert.strictEqual(motor.setAbortSignal.mock.callCount(), 2);
    });
  });
});