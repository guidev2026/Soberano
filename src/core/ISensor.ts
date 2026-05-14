/**
 * @file ISensor.ts
 * @description Contrato de abstração genérico para sensores do sistema SOBERANO.
 *              Segue o DIP: módulos de alto nível dependem desta abstração,
 *              não de implementações concretas.
 *
 *              O tipo genérico T representa o tipo de dado retornado pelo sensor
 *              (ex: string para leitura de arquivos, Buffer para binários, etc.).
 */

export abstract class ISensor<T> {
  /**
   * Lê dados de uma origem identificada por `target`.
   * @param target - Identificador da origem (ex: caminho de arquivo, URL, etc.)
   * @param signal - Opcional. AbortSignal para cancelamento da operação.
   * @returns Promise com o dado lido, tipado como T
   */
  abstract ler(target: string, signal?: AbortSignal): Promise<T>;
}
