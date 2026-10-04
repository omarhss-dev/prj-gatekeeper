/**
 * Les codes métier du contrat d'API (cahier des charges §6).
 * Côté domaine : cette liste ne sait rien de HTTP. Les status vivent dans la
 * table du filtre (ADR-015).
 */
export const DOMAIN_ERROR_CODES = Object.freeze([
  'SEAT_UNAVAILABLE',
  'SALES_NOT_OPEN',
  'EVENT_NOT_AVAILABLE',
  'EVENT_ALREADY_PUBLISHED',
  'MAX_SEATS_EXCEEDED',
  'RESERVATION_NOT_CANCELLABLE',
  'EMAIL_ALREADY_REGISTERED',
]);

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

    if (!DOMAIN_ERROR_CODES.includes(code)) {
      throw new TypeError(`Code métier inconnu : ${code}`);
    }

    this.code = code;
  }
}
