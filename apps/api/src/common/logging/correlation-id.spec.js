import { randomUUID } from 'node:crypto';
import { isValidCorrelationId } from './correlation-id.js';

describe('isValidCorrelationId', () => {
  it('accepte un UUID', () => {
    expect(isValidCorrelationId(randomUUID())).toBe(true);
  });

  it('accepte un ULID', () => {
    expect(isValidCorrelationId('01J9ZQK8F7Y3M2N5P6R4S8T0VW')).toBe(true);
  });

  it("rejette l'absence d'en-tête", () => {
    expect(isValidCorrelationId(undefined)).toBe(false);
  });

  it('rejette un en-tête envoyé deux fois', () => {
    expect(isValidCorrelationId(['abc12345', 'def67890'])).toBe(false);
  });

  it('rejette une valeur trop longue', () => {
    expect(isValidCorrelationId('a'.repeat(65))).toBe(false);
  });

  it('rejette une injection de saut de ligne', () => {
    expect(isValidCorrelationId('abc12345\ninjected')).toBe(false);
  });

  it('rejette une chaîne vide', () => {
    expect(isValidCorrelationId('')).toBe(false);
  });
});
