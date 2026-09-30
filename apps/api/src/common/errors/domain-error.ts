/**
 * Codes métier du contrat d'API (cahier des charges §6).
 * Leur status HTTP vit dans la table du filtre, pas ici : le domaine ne connaît pas HTTP.
 */
export type DomainErrorCode =
  | 'SEAT_UNAVAILABLE'
  | 'SALES_NOT_OPEN'
  | 'EVENT_NOT_AVAILABLE'
  | 'EVENT_ALREADY_PUBLISHED'
  | 'MAX_SEATS_EXCEEDED'
  | 'RESERVATION_NOT_CANCELLABLE';

/** Refus métier prévu (vente fermée, siège pris) : pas un incident. */
export class DomainError extends Error {
  override readonly name = 'DomainError';
  readonly code: DomainErrorCode;

  /**
   * @param detail Renvoyé tel quel au client.
   *               Jamais de SQL, de nom de table ni de message technique.
   */
  constructor(code: DomainErrorCode, detail: string) {
    super(detail);
    this.code = code;
  }
}
