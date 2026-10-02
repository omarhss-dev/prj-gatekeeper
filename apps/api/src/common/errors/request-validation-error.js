/**
 * Corps de requête refusé par la validation Zod : traduit en 422 par le filtre.
 *
 * Ni DomainError : ce n'est pas un refus métier, le contrat reste à 7 codes.
 * Ni HttpException : le filtre ignore leur contenu (ADR-016), et l'ordre de
 * ses instanceof redeviendrait significatif (ADR-015).
 */

export class RequestValidationError extends Error {
  name = 'RequestValidationError';

  /**
   * @param issues Les issues Zod. Seuls path et code sont conservés : ni le
   *               message, ni la valeur reçue, ni les paramètres de la règle.
   */
  constructor(issues) {
    super('Corps de requete invalide');
    this.issues = issues.map(({ path, code }) => ({ path, code }));
  }
}
