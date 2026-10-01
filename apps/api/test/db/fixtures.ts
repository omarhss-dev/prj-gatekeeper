import pg from 'pg';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$fake';

async function insertReturningId(
  pool: pg.Pool,
  sql: string,
  params: unknown[],
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error('INSERT returned no row');
  }
  return row.id;
}

export function insertUser(
  pool: pg.Pool,
  email = 'orga@x.com',
): Promise<string> {
  return insertReturningId(
    pool,
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, 'Test user')
     RETURNING id`,
    [email, PASSWORD_HASH],
  );
}

export function insertEvent(
  pool: pg.Pool,
  organizerId: string,
  name = 'Concert',
): Promise<string> {
  return insertReturningId(
    pool,
    `INSERT INTO events (organizer_id, name, city, venue, starts_at, sales_open_at)
     VALUES ($1, $2, 'Fes', 'Salle A', now() + interval '30 days', now() + interval '7 days')
     RETURNING id`,
    [organizerId, name],
  );
}

export function insertSection(
  pool: pg.Pool,
  eventId: string,
  name = 'Fosse',
): Promise<string> {
  return insertReturningId(
    pool,
    `INSERT INTO event_sections (event_id, name, price_cents, rows_count, seats_per_row)
     VALUES ($1, $2, 5000, 2, 10)
     RETURNING id`,
    [eventId, name],
  );
}

export function insertSeat(
  pool: pg.Pool,
  eventId: string,
  sectionId: string,
  label = 'A-1',
): Promise<string> {
  return insertReturningId(
    pool,
    `INSERT INTO event_seats (event_id, section_id, seat_label)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [eventId, sectionId, label],
  );
}

export function insertReservation(
  pool: pg.Pool,
  userId: string,
  eventId: string,
): Promise<string> {
  return insertReturningId(
    pool,
    `INSERT INTO reservations (user_id, event_id, total_cents)
     VALUES ($1, $2, 5000)
     RETURNING id`,
    [userId, eventId],
  );
}

export function insertTicket(
  pool: pg.Pool,
  reservationId: string,
  seatId: string,
  code: string,
): Promise<string> {
  return insertReturningId(
    pool,
    `INSERT INTO tickets (reservation_id, event_seat_id, code, price_cents)
     VALUES ($1, $2, $3, 5000)
     RETURNING id`,
    [reservationId, seatId, code],
  );
}
