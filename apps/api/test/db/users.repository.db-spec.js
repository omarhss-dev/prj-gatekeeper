import { UsersRepository } from '../../src/modules/auth/core/users.repository.js';
import { createTestPool, resetDatabase } from './database.js';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$fake';
const newUser = {
  email: 'omar@example.com',
  passwordHash: HASH,
  displayName: 'Omar',
};

describe('UsersRepository (vrai Postgres)', () => {
  let pool;
  let users;

  beforeAll(() => {
    pool = createTestPool();
    users = new UsersRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  async function countUsers() {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    return rows[0].n;
  }

  it('crée un utilisateur et renvoie son profil, sans password_hash', async () => {
    const user = await users.create(newUser);
    expect(user).toEqual({
      id: expect.any(String),
      email: 'omar@example.com',
      displayName: 'Omar',
      role: 'customer',
      createdAt: expect.any(Date),
    });
  });

  it('renvoie null pour un email déjà pris, sans créer de seconde ligne', async () => {
    await users.create(newUser);
    await expect(users.create(newUser)).resolves.toBeNull();
    expect(await countUsers()).toBe(1);
  });

  it('ne crée qu’un compte quand deux inscriptions simultanées visent le même email', async () => {
    const results = await Promise.all([
      users.create(newUser),
      users.create(newUser),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await countUsers()).toBe(1);
  });

  it('laisse remonter une violation de CHECK au lieu de renvoyer null', async () => {
    await expect(
      users.create({ ...newUser, email: 'Omar@Example.com' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'ck_users_email_normalized',
    });
  });

  it('lit les identifiants par email, et null pour un email inconnu', async () => {
    const { id } = await users.create(newUser);
    await expect(
      users.findCredentialsByEmail('omar@example.com'),
    ).resolves.toEqual({ id, role: 'customer', passwordHash: HASH });
    await expect(
      users.findCredentialsByEmail('personne@example.com'),
    ).resolves.toBeNull();
  });

  it('lit le profil par id, sans password_hash, et null pour un id inconnu', async () => {
    const created = await users.create(newUser);
    const profile = await users.findById(created.id);
    expect(profile).toEqual(created);
    expect(JSON.stringify(profile)).not.toContain('$argon2id$');
    await expect(
      users.findById('00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
  });
});
