import { createTestPool, resetDatabase, single } from './database.js';
const validUser = {
  email: 'omar@x.com',
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fake',
  displayName: 'Omar',
};

describe('users schema', () => {
  let pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  function insertUser(overrides = {}) {
    const user = { ...validUser, ...overrides };
    return pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, role`,
      [user.email, user.passwordHash, user.displayName],
    );
  }

  it('assigns the customer role by default', async () => {
    const { rows } = await insertUser();
    expect(single(rows).role).toBe('customer');
  });

  it.each([
    [
      'an uppercase email',
      { email: 'Omar@x.com' },
      'ck_users_email_normalized',
    ],
    [
      'an email with a leading space',
      { email: ' omar@x.com' },
      'ck_users_email_normalized',
    ],
    [
      'a blank display name',
      { displayName: '   ' },
      'ck_users_display_name_not_blank',
    ],
    [
      'a plaintext password',
      { passwordHash: 'motdepasse123' },
      'ck_users_password_hashed',
    ],
  ])('rejects %s', async (_label, overrides, constraint) => {
    await expect(insertUser(overrides)).rejects.toMatchObject({
      code: '23514',
      constraint,
    });
  });

  it('rejects a duplicate email', async () => {
    await insertUser();
    await expect(insertUser()).rejects.toMatchObject({
      code: '23505',
      constraint: 'uq_users_email',
    });
  });

  it('rejects an unknown role', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (email, password_hash, display_name, role)
         VALUES ($1, $2, $3, 'admin')`,
        [validUser.email, validUser.passwordHash, validUser.displayName],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'ck_users_role' });
  });
});
