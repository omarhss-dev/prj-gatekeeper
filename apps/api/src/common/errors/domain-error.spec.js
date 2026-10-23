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

  it("n'a aucune extension par défaut", () => {
    expect(new DomainError('SEAT_UNAVAILABLE', 'x').extensions).toEqual({});
  });

  it('garde une copie gelée des extensions', () => {
    const extensions = { seatIds: ['s1'] };
    const error = new DomainError('SEAT_UNAVAILABLE', 'x', extensions);
    extensions.seatIds = ['autre'];

    expect(error.extensions).toEqual({ seatIds: ['s1'] });
    expect(Object.isFrozen(error.extensions)).toBe(true);
  });
});
