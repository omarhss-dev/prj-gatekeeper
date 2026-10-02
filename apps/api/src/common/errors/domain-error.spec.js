import { DOMAIN_ERROR_CODES, DomainError } from './domain-error.js';

describe('DomainError', () => {
  it('accepte un code du contrat et garde son detail', () => {
    const error = new DomainError('EMAIL_ALREADY_REGISTERED', 'Déjà pris.');
    expect(error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(error.message).toBe('Déjà pris.');
  });

  it('refuse un code absent du contrat', () => {
    expect(() => new DomainError('EMAIL_TAKEN', 'x')).toThrow(TypeError);
  });

  it('ne laisse pas modifier la liste des codes', () => {
    expect(Object.isFrozen(DOMAIN_ERROR_CODES)).toBe(true);
  });
});
