import { readdir, readFile } from 'node:fs/promises';
import { runner } from 'node-pg-migrate';
import { createTestPool, single } from './database.js';

const MIGRATIONS_DIR = 'migrations';

async function migrationFiles() {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((file) => file.endsWith('.sql')).sort();
}

describe('migrations', () => {
  let pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function appliedCount() {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM pgmigrations',
    );
    return single(rows).n;
  }

  it('records every migration file as applied', async () => {
    expect(await appliedCount()).toBe((await migrationFiles()).length);
  });

  it('refuses to run a down migration and keeps the history intact', async () => {
    await expect(
      runner({
        databaseUrl: process.env.DATABASE_URL,
        dir: MIGRATIONS_DIR,
        direction: 'down',
        count: 1,
        migrationsTable: 'pgmigrations',
        log: () => {},
      }),
    ).rejects.toThrow('forward-only');

    expect(await appliedCount()).toBe((await migrationFiles()).length);
  });

  it('guards the down section of every migration', async () => {
    for (const file of await migrationFiles()) {
      const content = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
      const downSection = content.split('-- Down Migration')[1] ?? '';
      expect({
        file,
        guarded: downSection.includes('RAISE EXCEPTION'),
      }).toEqual({
        file,
        guarded: true,
      });
    }
  });
});
