/**
 * @file IToolRegistry.ts
 * @description Contrato abstrato para o registro central de ferramentas (Tool Registry).
 *              Segue o DIP: módulos de alto nível dependem desta abstração.
 */

import { ITool } from './ITool.ts';

export abstract class IToolRegistry {
  /**
   * Registra uma ferramenta no registry.
   * @param tool - Instância concreta de ITool a ser registrada.
   */
  abstract registrar(tool: ITool): void;

  /**
   * Obtém uma ferramenta pelo nome único.
   * @param nome - Nome único da ferramenta (case-sensitive).
   * @returns A instância de ITool ou undefined se não encontrada.
   */
  abstract obter(nome: string): ITool | undefined;

  /**
   * Retorna todas as ferramentas registradas.
   * @returns Array de ITool.
   */
  abstract obterTodas(): ITool[];
}