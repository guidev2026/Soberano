/**
 * @file IVectorStore.ts
 * @description Contrato de abstração para o armazenamento e busca de vetores
 *              (Vector Store / Memória Vetorial). Permite adicionar vetores
 *              com metadados associados e realizar buscas por similaridade.
 *
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas (MockVectorStore, ChromaDB, etc.).
 */

export abstract class IVectorStore<M = any> {
  /**
   * Adiciona um vetor ao armazenamento com seu ID e metadados associados.
   *
   * @param id       - Identificador único do vetor (ex: hash do documento)
   * @param vector   - Vetor numérico representando o embedding semântico
   * @param metadata - Metadados associados ao vetor (ex: texto original, fonte)
   * @throws {Error} Se o ID já existir (fail-fast) ou se houver falha no armazenamento
   */
  abstract adicionar(id: string, vector: number[], metadata: M): Promise<void>;

  /**
   * Busca os N vetores mais similares ao vetor de consulta fornecido,
   * utilizando similaridade cosseno ou métrica equivalente.
   *
   * @param vector - Vetor de consulta para busca por similaridade
   * @param limit  - Número máximo de resultados a retornar
   * @returns Promise com array de objetos contendo id, metadata e score de similaridade
   * @throws {Error} Se não houver vetores armazenados
   */
  abstract buscarSimilares(vector: number[], limit: number): Promise<
    { id: string; metadata: M; score: number }[]
  >;
}
