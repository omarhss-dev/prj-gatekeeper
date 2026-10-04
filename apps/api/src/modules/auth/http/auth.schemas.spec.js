import { registerSchema } from './auth.schemas.js';

const valid = {
  email: 'omar@example.com',
  password: '0123456789',
  displayName: 'Omar',
};

describe('registerSchema', () => {
  it("normalise l'email : espaces retirés, minuscules", () => {
    expect(
      registerSchema.parse({ ...valid, email: '  Omar@Example.COM ' }).email,
    ).toBe('omar@example.com');
  });

  it('ne modifie jamais le mot de passe', () => {
    expect(
      registerSchema.parse({ ...valid, password: '  Pass Word 1  ' }).password,
    ).toBe('  Pass Word 1  ');
  });

  it('refuse un mot de passe de moins de 10 caractères', () => {
    expect(
      registerSchema.safeParse({ ...valid, password: '012345678' }).success,
    ).toBe(false);
  });

  it("refuse un nom affiché fait uniquement d'espaces", () => {
    expect(
      registerSchema.safeParse({ ...valid, displayName: '   ' }).success,
    ).toBe(false);
  });

  it('accepte un email de 254 caractères et refuse 255', () => {
    const email254 = 'a@' + 'b'.repeat(248) + '.com';
    const email255 = 'a@' + 'b'.repeat(249) + '.com';
    expect(
      registerSchema.safeParse({ ...valid, email: email254 }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({ ...valid, email: email255 }).success,
    ).toBe(false);
  });

  it('retire les clés inconnues, dont role', () => {
    expect(
      registerSchema.parse({ ...valid, role: 'organizer' }),
    ).not.toHaveProperty('role');
  });
});
