import { needsRehash, verify } from 'argon2';
import { hashPassword, verifyPassword } from './password.js';

describe('hashPassword', () => {
  it('produit un hash Argon2id, compatible avec ck_users_password_hashed', async () => {
    expect(await hashPassword('correct horse battery')).toMatch(
      /^\$argon2id\$/,
    );
  });

  it('applique les paramètres OWASP, pas les défauts de la bibliothèque', async () => {
    const digest = await hashPassword('correct horse battery');
    expect(
      needsRehash(digest, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    ).toBe(false);
  });

  it('sale chaque hash : deux hachages du même mot de passe diffèrent', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same'),
      hashPassword('same'),
    ]);
    expect(a).not.toBe(b);
  });

  it('produit un hash que verify accepte pour le bon mot de passe seulement', async () => {
    const digest = await hashPassword('correct horse battery');
    expect(await verify(digest, 'correct horse battery')).toBe(true);
    expect(await verify(digest, 'correct horse batterY')).toBe(false);
  });

  it('verifyPassword accepte le bon mot de passe et refuse les autres', async () => {
    const digest = await hashPassword('correct horse battery');
    await expect(verifyPassword(digest, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(verifyPassword(digest, 'correct horse batterY')).resolves.toBe(
      false,
    );
  });
});
