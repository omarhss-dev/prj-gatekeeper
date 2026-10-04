import { DomainError } from '../../common/errors/domain-error.js';
import { AuthService } from './auth.service.js';
import { hashPassword } from './password.js';
import { TokenService } from './token.service.js';

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

const tokens = new TokenService({ secret: 'x'.repeat(32), ttlSeconds: 3600 });
const passwordHash = await hashPassword('correct horse battery');
const credentials = { id: 'u1', role: 'customer', passwordHash };

function fakeCredentialsRepository(found) {
  return { findCredentialsByEmail: async () => found };
}

describe('AuthService.login', () => {
  it('renvoie un token vérifiable pour le bon mot de passe', async () => {
    const service = new AuthService(
      fakeCredentialsRepository(credentials),
      tokens,
    );
    const result = await service.login({
      email: 'omar@example.com',
      password: 'correct horse battery',
    });
    await expect(tokens.verify(result.accessToken)).resolves.toEqual({
      userId: 'u1',
      role: 'customer',
    });
  });

  it('renvoie null pour un mauvais mot de passe', async () => {
    const service = new AuthService(
      fakeCredentialsRepository(credentials),
      tokens,
    );
    await expect(
      service.login({
        email: 'omar@example.com',
        password: 'correct horse batterY',
      }),
    ).resolves.toBeNull();
  });

  it('renvoie null pour un email inconnu', async () => {
    const service = new AuthService(fakeCredentialsRepository(null), tokens);
    await expect(
      service.login({
        email: 'inconnu@example.com',
        password: 'correct horse battery',
      }),
    ).resolves.toBeNull();
  });

  it('laisse remonter une erreur du repository, sans la transformer en null', async () => {
    const users = {
      findCredentialsByEmail: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    };
    await expect(
      new AuthService(users, tokens).login({
        email: 'omar@example.com',
        password: 'x',
      }),
    ).rejects.toThrow('connect ECONNREFUSED');
  });
});

describe('AuthService.getProfile', () => {
  it('renvoie le profil trouvé par le repository', async () => {
    const users = { findById: async (id) => (id === 'u1' ? user : null) };
    await expect(new AuthService(users).getProfile('u1')).resolves.toBe(user);
  });

  it("renvoie null si le compte n'existe plus", async () => {
    const users = { findById: async () => null };
    await expect(new AuthService(users).getProfile('u1')).resolves.toBeNull();
  });
});
