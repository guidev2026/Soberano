/**
 * @file ingest.ts
 * @description Script utilitário para ingerir arquivos de texto no banco de dados vetorial.
 *              Exemplo de uso: node --experimental-transform-types src/scripts/ingest.ts caminho/do/arquivo.txt
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ConsoleLogger } from '../infra/ConsoleLogger.ts';
import { OllamaEmbeddingProvider } from '../infra/OllamaEmbeddingProvider.ts';
import { SqliteVectorStore } from '../infra/SqliteVectorStore.ts';

async function main() {
  const logger = new ConsoleLogger();
  const filePath = process.argv[2];

  if (!filePath) {
    logger.error('Uso: node --experimental-transform-types src/scripts/ingest.ts <caminho-do-arquivo>');
    process.exit(1);
  }

  const embeddingProvider = new OllamaEmbeddingProvider({ logger });
  const vectorStore = new SqliteVectorStore({ logger, dbPath: 'nexus_knowledge.db' });

  try {
    logger.info(`Lendo arquivo: ${filePath}`);
    const conteudo = readFileSync(filePath, 'utf-8');

    // Chunking ultra-básico (divide por parágrafos)
    const chunks = conteudo.split(/\n\s*\n/).filter(c => c.trim().length > 0);
    logger.info(`Arquivo dividido em ${chunks.length} chunks.`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as string;
      const id = randomUUID();
      
      logger.info(`Gerando embedding para chunk ${i + 1}/${chunks.length}...`);
      const vetor = await embeddingProvider.gerarEmbedding(chunk);
      
      await vectorStore.adicionar(id, vetor, { texto: chunk, fonte: filePath });
    }

    logger.info('Ingestão concluída com sucesso!');
  } catch (err) {
    logger.error(`Falha durante a ingestão: ${err}`);
  } finally {
    vectorStore.close();
  }
}

main();
