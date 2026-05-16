/**
 * @file SoberanoAgent.test.ts
 * @description Testes unitários para SoberanoAgent.
 *              Mocka o IMotorCognitivo para verificar o gerenciamento do histórico.
 *              Utiliza node:test e node:assert/strict.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SoberanoAgent } from './SoberanoAgent.ts';
import { ContextManager } from './ContextManager.ts';
import { IMotorCognitivo } from './IMotorCognitivo.ts';
import type { ILogger } from './ILogger.ts';

// --- Logger mock silencioso ---
const loggerSilencioso: ILogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};

describe('SoberanoAgent', () => {
    describe('constructor', () => {
        it('deve definir o system prompt padrão quando não houver histórico', () => {
            const motorMock = mock.fn();
            // Usamos um objeto como IMotorCognitivo com method mocking
            const motor = {
                gerarResposta: motorMock,
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            const cm = new ContextManager();
            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            const historico = cm.obterHistorico();
            assert.strictEqual(historico.length, 1);
            assert.strictEqual(historico[0]?.role, 'system');
            assert.ok(historico[0]?.content.includes('SOBERANO'));
        });

        it('não deve sobrescrever system prompt existente', () => {
            const motor = {
                gerarResposta: mock.fn(),
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            const cm = new ContextManager();
            cm.definirSistema('Meu prompt customizado');

            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            const historico = cm.obterHistorico();
            assert.strictEqual(historico.length, 1);
            assert.strictEqual(historico[0]?.content, 'Meu prompt customizado');
        });
    });

    describe('interagir', () => {
        it('deve adicionar mensagens do usuário e do assistente ao contexto', async () => {
            const motor = {
                gerarResposta: mock.fn(async () => ({
                    role: 'assistant' as const,
                    content: 'Resposta do assistente.',
                })),
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            const cm = new ContextManager();
            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            const resposta = await agent.interagir('Olá!');
            assert.strictEqual(resposta, 'Resposta do assistente.');

            // Histórico: system + user + assistant = 3
            const historico = cm.obterHistorico();
            assert.strictEqual(historico.length, 3);
            assert.strictEqual(historico[0]?.role, 'system');
            assert.strictEqual(historico[1]?.role, 'user');
            assert.strictEqual(historico[1]?.content, 'Olá!');
            assert.strictEqual(historico[2]?.role, 'assistant');
            assert.strictEqual(historico[2]?.content, 'Resposta do assistente.');
        });

        it('deve passar o histórico completo ao motor cognitivo', async () => {
            const gerarRespostaMock = mock.fn(async () => ({
                role: 'assistant' as const,
                content: 'Resposta.',
            }));

            const motor = {
                gerarResposta: gerarRespostaMock,
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            const cm = new ContextManager();
            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            await agent.interagir('Primeira pergunta.');
            // Verifica quantas mensagens foram enviadas na primeira chamada
            const primeiraChamadaArgs = gerarRespostaMock.mock.calls[0]?.arguments;
            assert.ok(primeiraChamadaArgs);
            const mensagensEnviadas = primeiraChamadaArgs[0] as unknown as Array<{ role: string; content: string }>;
            assert.strictEqual(mensagensEnviadas.length, 2); // system + user
            assert.strictEqual(mensagensEnviadas[1]?.content, 'Primeira pergunta.');

            await agent.interagir('Segunda pergunta.');
            // Segunda chamada deve ter 4 mensagens: system + user1 + assistant1 + user2
            const segundaChamadaArgs = gerarRespostaMock.mock.calls[1]?.arguments;
            assert.ok(segundaChamadaArgs);
            const mensagensEnviadas2 = segundaChamadaArgs[0] as unknown as Array<{ role: string; content: string }>;
            assert.strictEqual(mensagensEnviadas2.length, 4);
            assert.strictEqual(mensagensEnviadas2[3]?.content, 'Segunda pergunta.');
        });

        it('deve manter o contexto ao longo de várias interações', async () => {
            const motor = {
                gerarResposta: mock.fn(async (_mensagens: Array<{ role: string; content: string }>) => {
                    return { role: 'assistant' as const, content: 'ok' };
                }),
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            const cm = new ContextManager();
            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            await agent.interagir('Msg 1');
            await agent.interagir('Msg 2');
            await agent.interagir('Msg 3');

            const historico = cm.obterHistorico();
            assert.strictEqual(historico.length, 7); // system + 3 pares (user+assistant)
            // Verifica a ordem: system, user1, asst1, user2, asst2, user3, asst3
            assert.strictEqual(historico[1]?.content, 'Msg 1');
            assert.strictEqual(historico[3]?.content, 'Msg 2');
            assert.strictEqual(historico[5]?.content, 'Msg 3');
        });

        it('deve respeitar o limite de mensagens do ContextManager', async () => {
            const motor = {
                gerarResposta: mock.fn(async () => ({
                    role: 'assistant' as const,
                    content: 'resposta',
                })),
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            // Limite pequeno: sistema + 3 mensagens não-system
            const cm = new ContextManager({ maxMensagens: 4 });
            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            // 4 interações = system + 4 user + 4 assistant = 9, mas max=4 => mantém só 4
            await agent.interagir('A');
            await agent.interagir('B');
            await agent.interagir('C');
            await agent.interagir('D');

            const historico = cm.obterHistorico();
            assert.ok(historico.length <= 4); // maxMensagens = 4
            // Deve conter o system
            assert.strictEqual(historico[0]?.role, 'system');
            // Deve conter a última interação (D + resposta)
            assert.strictEqual(historico[historico.length - 2]?.content, 'D');
            assert.strictEqual(historico[historico.length - 1]?.content, 'resposta');
        });

        it('deve lançar erro quando o motor cognitivo falha', async () => {
            const motor = {
                gerarResposta: mock.fn(async () => {
                    throw new Error('Falha no motor cognitivo');
                }),
                model: 'test-model',
                provider: 'test',
            } as unknown as IMotorCognitivo;

            const cm = new ContextManager();
            const agent = new SoberanoAgent({
                motor,
                contextManager: cm,
                logger: loggerSilencioso,
            });

            await assert.rejects(
                () => agent.interagir('teste'),
                /Falha no motor cognitivo/
            );

            // A mensagem do usuário deve ter sido adicionada, mas a resposta não
            const historico = cm.obterHistorico();
            assert.strictEqual(historico.length, 2); // system + user
            assert.strictEqual(historico[1]?.role, 'user');
        });
    });
});