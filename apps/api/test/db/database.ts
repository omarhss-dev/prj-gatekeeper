import pg from 'pg';

export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

export async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE users, events, event_sections, event_seats, reservations, tickets',
  );
}

export function single<T>(rows: T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`Expected exactly one row, got ${rows.length}`);
  }
  return row;
}
