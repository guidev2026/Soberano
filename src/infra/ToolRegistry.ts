/**
 * @file ToolRegistry.ts
 * @description Implementação concreta de IToolRegistry.
 *              Gerencia o registro e consulta de ferramentas (ITool) em memória.
 *              Segue o padrão Options Object para injeção de dependências.
 *
 *              Depende de abstrações (DIP): ILogger.
 */

import { IToolRegistry } from '../core/IToolRegistry.ts';
import { ITool } from '../core/ITool.ts';
import { ILogger } from '../core/ILogger.ts';

export interface ToolRegistryOptions {
  /** Instância obrigatória de ILogger para logging estruturado */
  logger: ILogger;
}

export class ToolRegistry extends IToolRegistry {
  private readonly tools: Map<string, ITool>;
  private readonly logger: ILogger;

  /**
   * @param options - Options Object (ToolRegistryOptions).
   *                  Apenas `logger` é obrigatório.
   */
  constructor(options: ToolRegistryOptions) {
    super();
    this.logger = options.logger;
    this.tools = new Map();
  }

  /**
   * Registra uma ferramenta no registry.
   * Se uma ferramenta com o mesmo nome já existir, emite um aviso e sobrescreve.
   *
   * @param tool - Instância concreta de ITool a ser registrada.
   */
  registrar(tool: ITool): void {
    const nome = tool.name;

    if (this.tools.has(nome)) {
      this.logger.warn(
        `[ToolRegistry] Tool "${nome}" is already registered. Overwriting previous registration.`
      );
    }

    this.tools.set(nome, tool);
    this.logger.info(`[ToolRegistry] Tool registered: "${nome}"`);
  }

  /**
   * Obtém uma ferramenta pelo nome único.
   *
   * @param nome - Nome único da ferramenta (case-sensitive).
   * @returns A instância de ITool ou undefined se não encontrada.
   */
  obter(nome: string): ITool | undefined {
    const tool = this.tools.get(nome);
    if (!tool) {
      this.logger.debug(`[ToolRegistry] Tool "${nome}" not found.`);
    }
    return tool;
  }

  /**
   * Retorna todas as ferramentas registradas.
   *
   * @returns Array de ITool.
   */
  obterTodas(): ITool[] {
    return Array.from(this.tools.values());
  }
}