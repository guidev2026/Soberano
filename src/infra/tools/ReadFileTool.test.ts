/**
 * @file ReadFileTool.test.ts
 * @description Testes unitários para ReadFileTool utilizando node:test e node:assert.
 *
 * Como executar:
 *   node --experimental-transform-types --test src/infra/tools/ReadFileTool.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadFileTool } from './ReadFileTool.ts';

describe('ReadFileTool', () => {
  const tool = new ReadFileTool();
  let tempDir: string;
  let tempFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'readfile-test-'));
    tempFilePath = join(tempDir, 'teste.txt');
    writeFileSync(tempFilePath, 'Conteudo de teste do arquivo.', 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Metadados da ferramenta', () => {
    it('deve ter o nome "read_file"', () => {
      assert.strictEqual(tool.name, 'read_file');
    });

    it('deve ter uma descrição não vazia', () => {
      assert.ok(tool.description.length > 0);
    });

    it('deve ter um parametersSchema com caminho como required', () => {
      const schema = tool.parametersSchema;
      assert.strictEqual(schema.type, 'object');
      assert.ok(Array.isArray(schema.required));
      assert.ok(schema.required.includes('caminho'));
    });
  });

  describe('Leitura bem-sucedida', () => {
    it('deve ler o conteúdo de um arquivo existente', async () => {
      const result = await tool.execute({ caminho: tempFilePath });
      assert.strictEqual(result.caminho, tempFilePath);
      assert.strictEqual(result.conteudo, 'Conteudo de teste do arquivo.');
      assert.strictEqual(result.tamanho, result.conteudo.length);
    });

    it('deve retornar o tamanho correto em bytes', async () => {
      const content = 'Hello, World!';
      const filePath = join(tempDir, 'hello.txt');
      writeFileSync(filePath, content, 'utf-8');
      const result = await tool.execute({ caminho: filePath });
      assert.strictEqual(result.tamanho, content.length);
    });
  });

  describe('Tratamento de erros (fail-safe)', () => {
    it('deve retornar erro para arquivo inexistente', async () => {
      const result = await tool.execute({ caminho: join(tempDir, 'nao-existe.txt') });
      assert.ok(result.error);
      assert.ok(result.error.includes('não encontrado'));
    });

    it('deve retornar erro para caminho vazio', async () => {
      const result = await tool.execute({ caminho: '' });
      assert.ok(result.error);
    });

    it('deve retornar erro para caminho que é um diretório', async () => {
      const result = await tool.execute({ caminho: tempDir });
      assert.ok(result.error);
      // Pode ser "é um diretório" ou "permissão negada" dependendo do SO
      assert.ok(result.error);
    });
  });
});