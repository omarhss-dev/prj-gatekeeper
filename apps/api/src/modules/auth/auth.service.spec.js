import { DomainError } from '../../common/errors/domain-error.js';
import { AuthService } from './auth.service.js';

const input = {
  email: 'omar@example.com',
  password: 'correct horse battery',
  displayName: 'Omar',
};
const user = {
  id: 'u1',
  email: 'omar@example.com',
  displayName: 'Omar',
  role: 'customer',
  createdAt: new Date(),
};

/** Faux repository : renvoie `result` et garde la trace de ce qu'il a reçu. */
function fakeUsersRepository(result) {
  const calls = [];
  return {
    calls,
    create: async (data) => {
      calls.push(data);
      return result;
    },
  };
}

describe('AuthService.register', () => {
  it('transmet un hash Argon2id au repository, jamais le mot de passe en clair', async () => {
    const users = fakeUsersRepository(user);
    await new AuthService(users).register(input);
    expect(users.calls[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(users.calls[0])).not.toContain(input.password);
  });

  it("renvoie l'utilisateur créé par le repository", async () => {
    await expect(
      new AuthService(fakeUsersRepository(user)).register(input),
    ).resolves.toBe(user);
  });

  it('lève EMAIL_ALREADY_REGISTERED quand le repository ne crée rien', async () => {
    const promise = new AuthService(fakeUsersRepository(null)).register(input);
    await expect(promise).rejects.toBeInstanceOf(DomainError);
    await expect(promise).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  });

  it('laisse remonter une erreur du repository, sans la transformer en 409', async () => {
    const users = {
      create: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    };
    await expect(new AuthService(users).register(input)).rejects.toThrow(
      'connect ECONNREFUSED',
    );
  });
});
