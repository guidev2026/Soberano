#!/usr/bin/env node

/**
 * @file cli.ts
 * @description Interface Interativa (CLI) do SOBERANO.
 *
 *              Utiliza node:readline/promises para um loop de chat no terminal.
 *              Comandos especiais:
 *                /sair    → Encerra a sessão
 *                /limpar  → Reseta a memória (mantém system prompt)
 *                /ajuda   → Exibe ajuda
 *
 *              Adere ao DIP: depende de abstrações (IMotorCognitivo, ContextManager, ILogger).
 *
 * Uso: npx tsx src/cli.ts [provedor] [modelo]
 * Ex:  npx tsx src/cli.ts ollama qwen2.5:7b
 *      npx tsx src/cli.ts deepseek deepseek-chat
 */

import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ConsoleLogger } from './infra/ConsoleLogger.js';
import { ContextManager } from './core/ContextManager.js';
import { SoberanoAgent } from './core/SoberanoAgent.js';
import type { IMotorCognitivo } from './core/IMotorCognitivo.js';
import type { ILogger } from './core/ILogger.js';
import { OllamaProvider } from './infra/OllamaProvider.js';
import { DeepSeekProvider } from './infra/DeepSeekProvider.js';

// ==========================================================================
// Constantes
// ==========================================================================

const WELCOME = `
╔══════════════════════════════════════════╗
║         SOBERANO CLI v4.0 🔥            ║
║    Seu terminal, suas regras.           ║
╚══════════════════════════════════════════╝
`;

const HELP = `
  📋 Comandos disponíveis:
    /sair         → Encerrar a sessão
    /limpar       → Limpar histórico da conversa (mantém system prompt)
    /ajuda        → Mostrar esta mensagem

  💡 Dica: Digite qualquer texto para conversar com o SOBERANO.
`;

// ==========================================================================
// Função principal
// ==========================================================================

async function main(): Promise<void> {
    // --- Argumentos de linha de comando ---
    const args = process.argv.slice(2);
    const providerName = args[0] ?? 'ollama';
    const modelName = args[1] ?? (providerName === 'deepseek' ? 'deepseek-chat' : 'qwen2.5:7b');

    // --- Logger ---
    const logger: ILogger = new ConsoleLogger('INFO');

    // --- Motor Cognitivo ---
    let motor: IMotorCognitivo;
    let providerLabel: string;
    let modelLabel: string;

    if (providerName === 'deepseek') {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            console.error('❌ Erro: DEEPSEEK_API_KEY não configurada.');
            console.error('   Exporte a variável: export DEEPSEEK_API_KEY=sua_chave');
            process.exit(1);
        }
        const deepSeekProvider = new DeepSeekProvider({
            apiKey,
            model: modelName,
            logger,
        });
        motor = deepSeekProvider;
        providerLabel = 'DeepSeek';
        modelLabel = modelName;
        logger.info(`Provedor: DeepSeek (modelo: ${modelName})`);
    } else {
        motor = new OllamaProvider({ logger });
        providerLabel = 'Ollama';
        modelLabel = modelName;
        logger.info(`Provedor: Ollama (modelo: ${modelName})`);
    }

    // --- ContextManager (memória de curto prazo) ---
    const contextManager = new ContextManager({
        maxMensagens: 20, // limite para não estourar tokens
    });

    // --- SoberanoAgent (orquestrador) ---
    const agent = new SoberanoAgent({
        motor,
        contextManager,
        logger,
    });

    // --- Interface readline ---
    const rl = readline.createInterface({
        input: stdin,
        output: stdout,
        prompt: '',
    });

    // --- Loop principal ---
    console.log(WELCOME);
    console.log(`🔧 Provedor: ${providerLabel} | Modelo: ${modelLabel}`);
    console.log('📝 Limite de contexto: 20 mensagens');
    console.log('\nDigite seu prompt ou "/ajuda" para comandos.\n');

    // Flag para shutdown
    let isShuttingDown = false;

    rl.on('close', () => {
        if (!isShuttingDown) {
            isShuttingDown = true;
            console.log('\n👋 Até logo, mestre!');
        }
    });

    while (!isShuttingDown) {
        const entrada = await rl.question('👤 Você: ');

        if (isShuttingDown) break;

        const trimmed = entrada.trim();

        // --- Comandos especiais ---
        if (trimmed === '/sair') {
            console.log('\n👋 Encerrando SOBERANO. Até logo!');
            isShuttingDown = true;
            rl.close();
            break;
        }

        if (trimmed === '/limpar') {
            contextManager.limpar(); // mantém system prompt
            console.log('🧹 Memória limpa! O contexto foi resetado (system prompt mantido).\n');
            continue;
        }

        if (trimmed === '/ajuda' || trimmed === '/help') {
            console.log(HELP);
            continue;
        }

        if (trimmed === '') {
            continue; // ignora entradas vazias
        }

        // --- Interação com o Agente ---
        try {
            const resposta = await agent.interagir(trimmed);
            console.log(`\n🤖 SOBERANO: ${resposta}\n`);
        } catch (err) {
            const mensagemErro = err instanceof Error ? err.message : String(err);
            console.error(`\n❌ Erro ao processar mensagem: ${mensagemErro}\n`);
            logger.error(`[CLI] Erro na interação: ${mensagemErro}`);
        }
    }
}

// ==========================================================================
// Ponto de entrada
// ==========================================================================

main().catch((err) => {
    console.error('Erro fatal no CLI:', err instanceof Error ? err.message : String(err));
    process.exit(1);
});