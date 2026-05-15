/**
 * @file ReadFileTool.ts
 * @description Implementação concreta de ITool que lê o conteúdo de um arquivo
 *              local no sistema utilizando node:fs/promises.
 *              É fail-safe: retorna objeto de erro em vez de lançar exceção.
 */

import { ITool } from '../../core/ITool.ts';
import { readFile } from 'node:fs/promises';

export class ReadFileTool extends ITool {
  get name(): string {
    return 'read_file';
  }

  get description(): string {
    return 'Lê o conteúdo de um arquivo local no sistema.';
  }

  get parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        caminho: {
          type: 'string',
          description: 'Caminho absoluto ou relativo do arquivo a ser lido.',
        },
      },
      required: ['caminho'],
    };
  }

  async execute(args: Record<string, any>): Promise<any> {
    const { caminho } = args;

    if (typeof caminho !== 'string' || caminho.trim() === '') {
      return { error: 'O parâmetro "caminho" deve ser uma string não vazia.' };
    }

    try {
      const conteudo = await readFile(caminho, { encoding: 'utf-8' });
      return { caminho, conteudo, tamanho: conteudo.length };
    } catch (err: any) {
      let mensagem: string;
      if (err && typeof err === 'object') {
        if (err.code === 'ENOENT') {
          mensagem = `Arquivo não encontrado: "${caminho}".`;
        } else if (err.code === 'EACCES') {
          mensagem = `Permissão negada para ler o arquivo: "${caminho}".`;
        } else if (err.code === 'EISDIR') {
          mensagem = `"${caminho}" é um diretório, não um arquivo.`;
        } else {
          mensagem = err.message ?? `Erro desconhecido ao ler arquivo "${caminho}".`;
        }
      } else {
        mensagem = `Erro ao ler arquivo: "${caminho}".`;
      }
      return { error: mensagem };
    }
  }
}