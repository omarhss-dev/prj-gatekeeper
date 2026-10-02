const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$fake';

async function insertReturningId(pool, sql, params) {
  const { rows } = await pool.query(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error('INSERT returned no row');
  }
  return row.id;
}

export function insertUser(pool, email = 'orga@x.com') {
  return insertReturningId(
    pool,
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, 'Test user')
     RETURNING id`,
    [email, PASSWORD_HASH],
  );
}

export function insertEvent(pool, organizerId, name = 'Concert') {
  return insertReturningId(
    pool,
    `INSERT INTO events (organizer_id, name, city, venue, starts_at, sales_open_at)
     VALUES ($1, $2, 'Fes', 'Salle A', now() + interval '30 days', now() + interval '7 days')
     RETURNING id`,
    [organizerId, name],
  );
}

export function insertSection(pool, eventId, name = 'Fosse') {
  return insertReturningId(
    pool,
    `INSERT INTO event_sections (event_id, name, price_cents, rows_count, seats_per_row)
     VALUES ($1, $2, 5000, 2, 10)
     RETURNING id`,
    [eventId, name],
  );
}

export function insertSeat(pool, eventId, sectionId, label = 'A-1') {
  return insertReturningId(
    pool,
    `INSERT INTO event_seats (event_id, section_id, seat_label)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [eventId, sectionId, label],
  );
}

export function insertReservation(pool, userId, eventId) {
  return insertReturningId(
    pool,
    `INSERT INTO reservations (user_id, event_id, total_cents)
     VALUES ($1, $2, 5000)
     RETURNING id`,
    [userId, eventId],
  );
}

export function insertTicket(pool, reservationId, seatId, code) {
  return insertReturningId(
    pool,
    `INSERT INTO tickets (reservation_id, event_seat_id, code, price_cents)
     VALUES ($1, $2, $3, 5000)
     RETURNING id`,
    [reservationId, seatId, code],
  );
}
