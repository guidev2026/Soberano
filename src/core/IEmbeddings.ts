/**
 * @file IEmbeddings.ts
 * @description Contrato de abstração para o serviço de embeddings vetoriais.
 *              Responsável por transformar texto em vetores numéricos (embeddings)
 *              que representam o significado semântico do conteúdo.
 *
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas (OllamaEmbeddings, OpenAI, etc.).
 */

export abstract class IEmbeddings {
  /**
   * Gera um vetor de números (embedding) a partir de um texto de entrada.
   * O vetor resultante pode ser usado para busca semântica, similaridade,
   * classificação ou clustering.
   *
   * @param text - Texto a ser convertido em embedding
   * @returns Promise com um array de números representando o embedding
   * @throws {Error} Se o serviço de embeddings falhar ou retornar dados inválidos
   */
  abstract gerarVector(text: string): Promise<number[]>;
}