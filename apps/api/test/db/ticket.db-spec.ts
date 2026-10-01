import pg from 'pg';
import { createTestPool, resetDatabase } from './database.js';
import {
  insertEvent,
  insertReservation,
  insertSeat,
  insertSection,
  insertTicket,
  insertUser,
} from './fixtures.js';

describe('tickets schema', () => {
  let pool: pg.Pool;
  let sectionId: string;
  let seatId: string;
  let reservationId: string;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    const userId = await insertUser(pool);
    const eventId = await insertEvent(pool, userId);
    sectionId = await insertSection(pool, eventId);
    seatId = await insertSeat(pool, eventId, sectionId);
    reservationId = await insertReservation(pool, userId, eventId);
  });

  it('rejects a second active ticket on the same seat', async () => {
    await insertTicket(pool, reservationId, seatId, 'T-001');

    await expect(
      insertTicket(pool, reservationId, seatId, 'T-002'),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'uq_tickets_active_seat',
    });
  });

  it('frees the seat once its ticket is cancelled', async () => {
    await insertTicket(pool, reservationId, seatId, 'T-001');
    await pool.query(
      `UPDATE tickets SET status = 'cancelled' WHERE code = 'T-001'`,
    );

    await expect(
      insertTicket(pool, reservationId, seatId, 'T-002'),
    ).resolves.toEqual(expect.any(String));
  });

  it('prevents deleting a section whose seat carries a ticket', async () => {
    await insertTicket(pool, reservationId, seatId, 'T-001');

    await expect(
      pool.query('DELETE FROM event_sections WHERE id = $1', [sectionId]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'fk_tickets_seat' });
  });
});
