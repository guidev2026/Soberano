/**
 * @file IEmbeddingProvider.ts
 * @description Contrato de abstração para o gerador de embeddings semânticos.
 *              Converte texto natural em um array numérico contínuo (vetor).
 */

export abstract class IEmbeddingProvider {
  /**
   * Converte um texto em um vetor de embeddings numérico.
   * @param texto - Texto a ser vetorizado.
   * @returns Array de números (vetor).
   */
  abstract gerarEmbedding(texto: string): Promise<number[]>;
}
