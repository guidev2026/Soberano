/**
 * @file SoberanoAgent.ts
 * @description Agente SOBERANO — Caso de uso principal de interação via CLI.
 *
 *              Recebe via injeção de dependência:
 *              - IMotorCognitivo (o cérebro)
 *              - ContextManager (a memória de curto prazo)
 *              - ILogger (observabilidade)
 *
 *              O método `interagir(prompt)` orquestra o fluxo:
 *              1. Adiciona o prompt do usuário ao ContextManager
 *              2. Recupera o histórico completo
 *              3. Chama o motor cognitivo
 *              4. Salva a resposta no ContextManager
 *              5. Retorna o conteúdo da resposta
 *
 *              Adere ao DIP: depende de abstrações, não de implementações concretas.
 */

import { IMotorCognitivo } from './IMotorCognitivo.ts';
import { ContextManager } from './ContextManager.ts';
import { ILogger } from './ILogger.ts';

export interface SoberanoAgentOptions {
    /** Instância do motor cognitivo (LLM) */
    motor: IMotorCognitivo;
    /** Instância do gerenciador de contexto (memória) */
    contextManager: ContextManager;
    /** Instância do logger para observabilidade */
    logger: ILogger;
}

const PROMPT_SISTEMA_PADRAO = `Você é o SOBERANO, um assistente de IA autônomo executado localmente no terminal do usuário.

Diretrizes:
- Responda SEMPRE em português do Brasil (pt-BR).
- Suas respostas devem ser claras, diretas e objetivas.
- Mantenha o contexto da conversa — lembre-se das interações anteriores.
- Se precisar de mais informações, pergunte educadamente.
- Seja transparente sobre suas limitações.`;

export class SoberanoAgent {
    private readonly motor: IMotorCognitivo;
    private readonly contextManager: ContextManager;
    private readonly logger: ILogger;

    constructor(options: SoberanoAgentOptions) {
        this.motor = options.motor;
        this.contextManager = options.contextManager;
        this.logger = options.logger;

        // Define o system prompt padrão se ainda não houver um
        const historico = this.contextManager.obterHistorico();
        const temSystem = historico.some((m) => m.role === 'system');
        if (!temSystem) {
            this.contextManager.definirSistema(PROMPT_SISTEMA_PADRAO);
        }
    }

    /**
     * Processa um prompt do usuário e retorna a resposta do assistente.
     *
     * @param prompt - Mensagem de texto do usuário.
     * @returns O conteúdo da resposta gerada pelo motor cognitivo.
     */
    async interagir(prompt: string): Promise<string> {
        this.logger.info(`[SoberanoAgent] Processando prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

        // 1. Adiciona o prompt do usuário ao contexto
        const mensagemUsuario = { role: 'user' as 'user', content: prompt };
        this.contextManager.adicionarMensagem(mensagemUsuario);
        this.logger.debug('[SoberanoAgent] Mensagem do usuário adicionada ao contexto.');

        // 2. Recupera o histórico completo
        const historico = this.contextManager.obterHistorico();
        this.logger.debug(`[SoberanoAgent] Enviando ${historico.length} mensagens ao motor cognitivo.`);

        // 3. Chama o motor cognitivo
        const respostaMessage = await this.motor.gerarResposta(historico);

        // 4. Extrai o conteúdo e salva no contexto
        const conteudo = respostaMessage.content;
        const mensagemAssistant = { role: 'assistant' as 'assistant', content: conteudo };
        this.contextManager.adicionarMensagem(mensagemAssistant);
        this.logger.debug(`[SoberanoAgent] Resposta do assistente salva no contexto (${conteudo.length} caracteres).`);

        // 5. Retorna o conteúdo
        this.logger.info('[SoberanoAgent] Interação concluída com sucesso.');
        return conteudo;
    }
}