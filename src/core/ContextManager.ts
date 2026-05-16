/**
 * @file ContextManager.ts
 * @description Gerenciador de Contexto (Memória de Curto Prazo) para o agente SOBERANO.
 *
 *              Armazena o histórico de mensagens da conversa com limite configurável
 *              para evitar estouro de tokens na API do motor cognitivo.
 *
 *              Lógica pura de domínio — zero dependências de infraestrutura.
 *              Pode ser testado sem mocks.
 */

import type { ChatMessage } from './IMotorCognitivo.ts';

export interface ContextManagerOptions {
    /**
     * Número máximo de mensagens no histórico (excluindo a mensagem system).
     * Quando o limite é excedido, as mensagens mais antigas (role !== 'system')
     * são removidas para abrir espaço para as novas.
     * @default 50
     */
    maxMensagens?: number;
}

/**
 * Gerencia o histórico de mensagens do agente SOBERANO.
 * Preserva a mensagem `system` (sempre no índice 0 se existir) e aplica
 * um limite FIFO sobre as demais mensagens.
 */
export class ContextManager {
    private readonly historico: ChatMessage[] = [];
    private readonly maxMensagens: number;

    constructor(options?: ContextManagerOptions) {
        this.maxMensagens = options?.maxMensagens ?? 50;
    }

    /**
     * Define ou substitui a mensagem de sistema (role: 'system').
     * A mensagem system é sempre mantida no início do histórico.
     * @param prompt - O conteúdo da mensagem de sistema.
     */
    definirSistema(prompt: string): void {
        const systemIndex = this.historico.findIndex((m) => m.role === 'system');
        const systemMessage: ChatMessage = { role: 'system', content: prompt };

        if (systemIndex >= 0) {
            this.historico[systemIndex] = systemMessage;
        } else {
            this.historico.unshift(systemMessage);
        }
    }

    /**
     * Adiciona uma mensagem ao histórico.
     * Se o limite for excedido, remove as mensagens mais antigas
     * (preservando a mensagem system).
     * @param msg - Mensagem a ser adicionada.
     */
    adicionarMensagem(msg: ChatMessage): void {
        this.historico.push(msg);
        this.aplicarLimite();
    }

    /**
     * Retorna uma cópia do histórico completo de mensagens.
     */
    obterHistorico(): ChatMessage[] {
        return [...this.historico];
    }

    /**
     * Retorna o número atual de mensagens no histórico.
     */
    get tamanho(): number {
        return this.historico.length;
    }

    /**
     * Limpa o histórico, opcionalmente mantendo a mensagem system.
     * @param manterSistema - Se `true` (padrão), preserva a mensagem system.
     */
    limpar(manterSistema: boolean = true): void {
        if (manterSistema) {
            const system = this.historico.find((m) => m.role === 'system');
            this.historico.length = 0;
            if (system) {
                this.historico.push(system);
            }
        } else {
            this.historico.length = 0;
        }
    }

    /**
     * Aplica o limite de mensagens FIFO, preservando a mensagem system.
     * Remove as mensagens não-system mais antigas até que o tamanho
     * fique dentro do limite.
     */
    private aplicarLimite(): void {
        if (this.historico.length <= this.maxMensagens) {
            return;
        }

        // Separa system das demais
        const system = this.historico.find((m) => m.role === 'system');
        const naoSystem = this.historico.filter((m) => m.role !== 'system');

        // Quantos remover
        const excesso = naoSystem.length - (this.maxMensagens - (system ? 1 : 0));
        if (excesso <= 0) {
            return;
        }

        const mantidas = naoSystem.slice(excesso);
        this.historico.length = 0;
        if (system) {
            this.historico.push(system);
        }
        this.historico.push(...mantidas);
    }
}