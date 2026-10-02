/** Refus métier prévu (vente fermée, siège pris) : pas un incident. */
export class DomainError extends Error {
  name = 'DomainError';

  /**
   * @param code Un des codes métier du contrat d'API (cahier des charges §6).
   *             Leur status HTTP vit dans la table du filtre, pas ici :
   *             le domaine ne connaît pas HTTP.
   * @param detail Renvoyé tel quel au client.
   *               Jamais de SQL, de nom de table ni de message technique.
   */
  constructor(code, detail) {
    super(detail);
    this.code = code;
  }
}
