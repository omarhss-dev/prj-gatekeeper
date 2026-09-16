/**
 * Motif accepté pour un X-Correlation-Id fourni par le client.
 *
 * Volontairement strict : cette valeur vient d'Internet et finit dans les
 * logs et dans un en-tête de réponse. Une chaîne arbitraire permettrait
 * d'injecter des caractères de contrôle ou de gonfler le coût d'ingestion.
 * Couvre les UUID (36) et les ULID (26) sans les imposer.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
}
