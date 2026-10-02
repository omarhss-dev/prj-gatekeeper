import { createTestPool, resetDatabase, single } from './database.js';
import {
  insertEvent,
  insertSeat,
  insertSection,
  insertUser,
} from './fixtures.js';

describe('events schema', () => {
  let pool;
  let organizerId;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    organizerId = await insertUser(pool);
  });

  async function publish(eventId) {
    await pool.query(
      `UPDATE events SET status = 'published', published_at = now() WHERE id = $1`,
      [eventId],
    );
  }

  describe('publication status', () => {
    it('lets a published event be cancelled and keeps its publication date', async () => {
      const eventId = await insertEvent(pool, organizerId);
      await publish(eventId);

      const { rows } = await pool.query(
        `UPDATE events SET status = 'cancelled' WHERE id = $1
         RETURNING status, published_at`,
        [eventId],
      );
      const event = single(rows);

      expect(event.status).toBe('cancelled');
      expect(event.published_at).toBeInstanceOf(Date);
    });

    it('rejects a published event without a publication date', async () => {
      const eventId = await insertEvent(pool, organizerId);

      await expect(
        pool.query(`UPDATE events SET status = 'published' WHERE id = $1`, [
          eventId,
        ]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_events_published_has_date',
      });
    });

    it('rejects a draft with a publication date', async () => {
      const eventId = await insertEvent(pool, organizerId);

      await expect(
        pool.query(`UPDATE events SET published_at = now() WHERE id = $1`, [
          eventId,
        ]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_events_draft_has_no_date',
      });
    });
  });

  describe('seat consistency', () => {
    it('accepts a seat whose section belongs to its event', async () => {
      const eventId = await insertEvent(pool, organizerId);
      const sectionId = await insertSection(pool, eventId);

      await expect(insertSeat(pool, eventId, sectionId)).resolves.toEqual(
        expect.any(String),
      );
    });

    it('rejects a seat whose section belongs to another event', async () => {
      const concertId = await insertEvent(pool, organizerId, 'Concert');
      const festivalId = await insertEvent(pool, organizerId, 'Festival');
      const concertSectionId = await insertSection(pool, concertId);

      await expect(
        insertSeat(pool, festivalId, concertSectionId),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'fk_seats_section_event',
      });
    });
  });

  describe('updated_at trigger', () => {
    it('refreshes updated_at on every update', async () => {
      const { rows: inserted } = await pool.query(
        `INSERT INTO events (organizer_id, name, city, venue, starts_at, sales_open_at, updated_at)
         VALUES ($1, 'Concert', 'Fes', 'Salle A',
                 now() + interval '30 days', now() + interval '7 days',
                 now() - interval '1 hour')
         RETURNING id, updated_at`,
        [organizerId],
      );
      const created = single(inserted);

      const { rows: updated } = await pool.query(
        `UPDATE events SET name = 'Concert renamed' WHERE id = $1 RETURNING updated_at`,
        [created.id],
      );

      expect(single(updated).updated_at.getTime()).toBeGreaterThan(
        created.updated_at.getTime(),
      );
    });
  });
});
