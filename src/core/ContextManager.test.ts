/**
 * @file ContextManager.test.ts
 * @description Testes unitários para ContextManager.
 *              Utiliza node:test e node:assert/strict (zero dependências externas).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from './ContextManager.ts';

describe('ContextManager', () => {
    describe('histórico vazio', () => {
        it('deve iniciar com histórico vazio', () => {
            const cm = new ContextManager();
            assert.strictEqual(cm.tamanho, 0);
            assert.deepStrictEqual(cm.obterHistorico(), []);
        });
    });

    describe('adicionarMensagem', () => {
        it('deve adicionar mensagens ao histórico', () => {
            const cm = new ContextManager();
            cm.adicionarMensagem({ role: 'user', content: 'Olá' });
            cm.adicionarMensagem({ role: 'assistant', content: 'Oi!' });
            assert.strictEqual(cm.tamanho, 2);
            assert.strictEqual(cm.obterHistorico()[0]?.content, 'Olá');
            assert.strictEqual(cm.obterHistorico()[1]?.content, 'Oi!');
        });

        it('deve preservar a imutabilidade do histórico retornado', () => {
            const cm = new ContextManager();
            cm.adicionarMensagem({ role: 'user', content: 'test' });
            const historico = cm.obterHistorico();
            historico.push({ role: 'assistant', content: 'fake' });
            assert.strictEqual(cm.tamanho, 1); // original não foi alterado
        });
    });

    describe('definirSistema', () => {
        it('deve adicionar mensagem system no início do histórico', () => {
            const cm = new ContextManager();
            cm.definirSistema('Você é um assistente.');
            assert.strictEqual(cm.tamanho, 1);
            assert.strictEqual(cm.obterHistorico()[0]?.role, 'system');
            assert.strictEqual(cm.obterHistorico()[0]?.content, 'Você é um assistente.');
        });

        it('deve substituir mensagem system existente', () => {
            const cm = new ContextManager();
            cm.definirSistema('Versão 1');
            cm.adicionarMensagem({ role: 'user', content: 'Oi' });
            cm.definirSistema('Versão 2');
            assert.strictEqual(cm.tamanho, 2);
            assert.strictEqual(cm.obterHistorico()[0]?.content, 'Versão 2');
        });

        it('deve manter a mensagem system sempre no índice 0', () => {
            const cm = new ContextManager();
            cm.adicionarMensagem({ role: 'user', content: 'msg1' });
            cm.adicionarMensagem({ role: 'user', content: 'msg2' });
            cm.definirSistema('system prompt');
            assert.strictEqual(cm.obterHistorico()[0]?.role, 'system');
            assert.strictEqual(cm.tamanho, 3);
        });
    });

    describe('limpar', () => {
        it('deve limpar todo o histórico quando manterSistema=false', () => {
            const cm = new ContextManager();
            cm.definirSistema('sistema');
            cm.adicionarMensagem({ role: 'user', content: 'msg' });
            cm.limpar(false);
            assert.strictEqual(cm.tamanho, 0);
        });

        it('deve limpar mantendo a mensagem system por padrão', () => {
            const cm = new ContextManager();
            cm.definirSistema('sistema');
            cm.adicionarMensagem({ role: 'user', content: 'msg1' });
            cm.adicionarMensagem({ role: 'assistant', content: 'msg2' });
            cm.limpar();
            assert.strictEqual(cm.tamanho, 1);
            assert.strictEqual(cm.obterHistorico()[0]?.role, 'system');
        });

        it('deve ser seguro chamar limpar com histórico vazio', () => {
            const cm = new ContextManager();
            cm.limpar();
            assert.strictEqual(cm.tamanho, 0);
            cm.limpar(false);
            assert.strictEqual(cm.tamanho, 0);
        });
    });

    describe('limite de mensagens', () => {
        it('deve remover mensagens mais antigas quando o limite é excedido (sem system)', () => {
            const cm = new ContextManager({ maxMensagens: 3 });
            cm.adicionarMensagem({ role: 'user', content: 'A' });
            cm.adicionarMensagem({ role: 'user', content: 'B' });
            cm.adicionarMensagem({ role: 'user', content: 'C' });
            cm.adicionarMensagem({ role: 'user', content: 'D' }); // excede
            assert.strictEqual(cm.tamanho, 3);
            assert.strictEqual(cm.obterHistorico()[0]?.content, 'B');
            assert.strictEqual(cm.obterHistorico()[1]?.content, 'C');
            assert.strictEqual(cm.obterHistorico()[2]?.content, 'D');
        });

        it('deve preservar a mensagem system ao aplicar o limite', () => {
            const cm = new ContextManager({ maxMensagens: 3 });
            cm.definirSistema('sys');
            cm.adicionarMensagem({ role: 'user', content: 'A' });
            cm.adicionarMensagem({ role: 'user', content: 'B' });
            cm.adicionarMensagem({ role: 'user', content: 'C' }); // excede (system + 3 > 3)
            assert.strictEqual(cm.tamanho, 3);
            assert.strictEqual(cm.obterHistorico()[0]?.role, 'system');
            assert.strictEqual(cm.obterHistorico()[1]?.content, 'B');
            assert.strictEqual(cm.obterHistorico()[2]?.content, 'C');
        });

        it('deve respeitar o limite com maxMensagens=1 e sem system', () => {
            const cm = new ContextManager({ maxMensagens: 1 });
            cm.adicionarMensagem({ role: 'user', content: 'A' });
            cm.adicionarMensagem({ role: 'user', content: 'B' });
            // max=1, 2 mensagens => mantém só a última
            assert.strictEqual(cm.tamanho, 1);
            assert.strictEqual(cm.obterHistorico()[0]?.content, 'B');
        });

        it('deve respeitar o limite com maxMensagens=1 e system presente', () => {
            const cm = new ContextManager({ maxMensagens: 1 });
            cm.definirSistema('sys');
            cm.adicionarMensagem({ role: 'user', content: 'A' });
            cm.adicionarMensagem({ role: 'user', content: 'B' });
            // max=1, system ocupa a única vaga => mensagens não-system são removidas
            assert.strictEqual(cm.tamanho, 1);
            assert.strictEqual(cm.obterHistorico()[0]?.role, 'system');
            assert.strictEqual(cm.obterHistorico()[0]?.content, 'sys');
        });

        it('não deve remover mensagens quando abaixo do limite', () => {
            const cm = new ContextManager({ maxMensagens: 10 });
            cm.adicionarMensagem({ role: 'user', content: 'A' });
            cm.adicionarMensagem({ role: 'user', content: 'B' });
            assert.strictEqual(cm.tamanho, 2);
        });
    });

    describe('definirSistema com limite ativo', () => {
        it('deve funcionar corretamente com system e limite restrito', () => {
            const cm = new ContextManager({ maxMensagens: 2 });
            cm.definirSistema('sys');
            cm.adicionarMensagem({ role: 'user', content: 'A' });
            cm.adicionarMensagem({ role: 'user', content: 'B' });
            // system + 2 user = 3 > max=2, deve remover 1 user
            assert.strictEqual(cm.tamanho, 2);
            assert.strictEqual(cm.obterHistorico()[0]?.role, 'system');
            assert.strictEqual(cm.obterHistorico()[1]?.content, 'B');
        });
    });
});