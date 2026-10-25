import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { EventsRepository } from '../../src/modules/events/core/events.repository.js';
import { ReservationsRepository } from '../../src/modules/reservations/core/reservations.repository.js';
import { createTestPool, resetDatabase } from './database.js';
import { insertUser } from './fixtures.js';

/** 12 places par rangée : A-10 et A-11 existent, pour vérifier le tri naturel. */
const newEvent = {
  name: 'Concert',
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: new Date('2099-06-01T19:00:00Z'),
  salesOpenAt: new Date('2000-01-01T00:00:00Z'),
  maxSeatsPerReservation: 4,
  sections: [
    { name: 'Balcon', priceCents: 3000, rowsCount: 1, seatsPerRow: 12 },
    { name: 'Fosse', priceCents: 5000, rowsCount: 1, seatsPerRow: 12 },
  ],
};

describe('Plan de salle, annulation et liste (vrai Postgres)', () => {
  let pool;
  let events;
  let reservations;
  let organizerId;
  let buyerId;
  let otherId;
  let eventId;

  beforeAll(() => {
    pool = createTestPool();
    events = new EventsRepository(pool);
    reservations = new ReservationsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    organizerId = await insertUser(pool, 'orga@x.com');
    buyerId = await insertUser(pool, 'client@x.com');
    otherId = await insertUser(pool, 'autre@x.com');
    ({ id: eventId } = await events.createWithSections(organizerId, newEvent));
    await events.publishDraft(eventId, organizerId);
  });

  async function seat(section, label) {
    const { rows } = await pool.query(
      `SELECT s.id FROM event_seats s
       JOIN event_sections sec ON sec.id = s.section_id
       WHERE s.event_id = $1 AND sec.name = $2 AND s.seat_label = $3`,
      [eventId, section, label],
    );
    return rows[0].id;
  }

  async function reserve(userId, seats) {
    const { reservation } = await reservations.reserve(userId, eventId, seats);
    return reservation;
  }

  const activeTickets = async (seatId) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM tickets
       WHERE event_seat_id = $1 AND status = 'active'`,
      [seatId],
    );
    return rows[0].n;
  };

  /** Fait commencer l'événement : les deux dates dans le passé (CHECK). */
  async function startEvent() {
    await pool.query(
      `UPDATE events SET sales_open_at = now() - interval '2 days',
                         starts_at = now() - interval '1 hour'
       WHERE id = $1`,
      [eventId],
    );
  }

  describe('EventsRepository.findSeatMap', () => {
    it('null pour un brouillon : il n’a pas de plan de salle public', async () => {
      const { id } = await events.createWithSections(organizerId, newEvent);
      await expect(events.findSeatMap(id)).resolves.toBeNull();
    });

    it('groupe par section, de la plus chère à la moins chère, en tri naturel', async () => {
      const map = await events.findSeatMap(eventId);

      expect(map.sections.map((s) => s.name)).toEqual(['Fosse', 'Balcon']);
      expect(map.sections[0].seats.map((s) => s.label)).toEqual([
        'A-1',
        'A-2',
        'A-3',
        'A-4',
        'A-5',
        'A-6',
        'A-7',
        'A-8',
        'A-9',
        'A-10',
        'A-11',
        'A-12',
      ]);
      expect(Object.keys(map.sections[0].seats[0])).toEqual([
        'id',
        'label',
        'available',
      ]);
    });

    it('un siège vendu est indisponible, puis disponible après annulation', async () => {
      const seatId = await seat('Fosse', 'A-2');
      const reservation = await reserve(buyerId, [seatId]);
      const availability = async () =>
        (await events.findSeatMap(eventId)).sections[0].seats.find(
          (s) => s.id === seatId,
        ).available;

      expect(await availability()).toBe(false);
      await reservations.cancel(reservation.id, buyerId);
      expect(await availability()).toBe(true);
    });
  });

  describe('ReservationsRepository.cancel', () => {
    it('annule la réservation et ses billets, et date l’annulation', async () => {
      const seats = [await seat('Fosse', 'A-1'), await seat('Fosse', 'A-2')];
      const reservation = await reserve(buyerId, seats);

      await expect(reservations.cancel(reservation.id, buyerId)).resolves.toBe(
        true,
      );

      const { rows } = await pool.query(
        `SELECT r.status, r.cancelled_at,
                array_agg(t.status ORDER BY t.status) AS tickets
         FROM reservations r JOIN tickets t ON t.reservation_id = r.id
         WHERE r.id = $1 GROUP BY r.id`,
        [reservation.id],
      );
      expect(rows[0]).toEqual({
        status: 'cancelled',
        cancelled_at: expect.any(Date),
        tickets: ['cancelled', 'cancelled'],
      });
    });

    it('index partiel : le siège libéré se réserve à nouveau, l’historique reste', async () => {
      const seatId = await seat('Fosse', 'A-1');
      const first = await reserve(buyerId, [seatId]);
      await reservations.cancel(first.id, buyerId);

      await expect(reserve(otherId, [seatId])).resolves.toHaveProperty('id');
      const { rows } = await pool.query(
        `SELECT status FROM tickets WHERE event_seat_id = $1 ORDER BY status`,
        [seatId],
      );
      expect(rows.map((r) => r.status)).toEqual(['active', 'cancelled']);
    });

    it("false pour la réservation d'un autre, qui reste intacte", async () => {
      const seatId = await seat('Fosse', 'A-1');
      const reservation = await reserve(buyerId, [seatId]);

      await expect(reservations.cancel(reservation.id, otherId)).resolves.toBe(
        false,
      );
      expect(await activeTickets(seatId)).toBe(1);
    });

    it('false une fois l’événement commencé, et rien ne change', async () => {
      const seatId = await seat('Fosse', 'A-1');
      const reservation = await reserve(buyerId, [seatId]);
      await startEvent();

      await expect(reservations.cancel(reservation.id, buyerId)).resolves.toBe(
        false,
      );
      await expect(
        reservations.findForCancellation(reservation.id),
      ).resolves.toEqual({ userId: buyerId, status: 'confirmed' });
    });

    it('findForCancellation : null pour une réservation inconnue', async () => {
      await expect(
        reservations.findForCancellation(randomUUID()),
      ).resolves.toBeNull();
    });

    it('deux annulations simultanées : une seule modifie, sans exception', async () => {
      const reservation = await reserve(buyerId, [await seat('Fosse', 'A-1')]);

      // La seconde attend le verrou de ligne posé par la première, puis
      // réévalue son WHERE : status = 'cancelled', 0 ligne (ADR-032).
      const results = await Promise.all([
        reservations.cancel(reservation.id, buyerId),
        reservations.cancel(reservation.id, buyerId),
      ]);

      expect(results.sort()).toEqual([false, true]);
    });

    it('annulation et réservation simultanées du même siège : jamais deux billets actifs', async () => {
      const seatId = await seat('Fosse', 'A-1');

      for (let n = 0; n < 10; n += 1) {
        await pool.query('DELETE FROM tickets');
        await pool.query('DELETE FROM reservations');
        const reservation = await reserve(buyerId, [seatId]);

        // L'ordre d'arrivée décide : si l'annulation touche le billet avant,
        // la réservation attend son COMMIT puis réussit ; sinon, elle voit un
        // billet actif et reçoit un refus. Les deux issues sont correctes.
        const [cancelled, result] = await Promise.all([
          reservations.cancel(reservation.id, buyerId),
          reservations.reserve(otherId, eventId, [seatId]),
        ]);

        expect(cancelled).toBe(true);
        expect(
          result.reservation !== undefined ||
            result.unavailableSeatIds !== undefined,
        ).toBe(true);
        expect(await activeTickets(seatId)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('ReservationsRepository.findByUser', () => {
    it('ne renvoie que les siennes, la plus récente d’abord, annulées comprises', async () => {
      const first = await reserve(buyerId, [await seat('Balcon', 'A-1')]);
      const second = await reserve(buyerId, [await seat('Balcon', 'A-2')]);
      await reserve(otherId, [await seat('Balcon', 'A-3')]);
      await reservations.cancel(first.id, buyerId);

      const list = await reservations.findByUser(buyerId);

      expect(list.map((r) => [r.id, r.status])).toEqual([
        [second.id, 'confirmed'],
        [first.id, 'cancelled'],
      ]);
      expect(list[1].cancelledAt).toEqual(expect.any(Date));
      expect(list[1].tickets[0].status).toBe('cancelled');
    });

    it('donne l’événement et les billets lisibles, dans l’ordre du plan de salle', async () => {
      await reserve(buyerId, [
        await seat('Balcon', 'A-1'),
        await seat('Fosse', 'A-10'),
        await seat('Fosse', 'A-2'),
      ]);

      const [reservation] = await reservations.findByUser(buyerId);

      expect(reservation).toMatchObject({
        status: 'confirmed',
        totalCents: 13000,
        cancelledAt: null,
        event: { id: eventId, name: 'Concert', city: 'Fès' },
      });
      expect(reservation.tickets.map((t) => `${t.section} ${t.seat}`)).toEqual([
        'Fosse A-2',
        'Fosse A-10',
        'Balcon A-1',
      ]);
      expect(reservation.tickets[0]).toEqual({
        code: expect.any(String),
        status: 'active',
        priceCents: 5000,
        section: 'Fosse',
        seat: 'A-2',
      });
    });

    it('un tableau vide pour un acheteur sans réservation', async () => {
      await expect(reservations.findByUser(buyerId)).resolves.toEqual([]);
    });

    it('US-7 : une seule requête, quel que soit le nombre de réservations', async () => {
      await reserve(buyerId, [await seat('Balcon', 'A-1')]);
      for (const label of ['A-1', 'A-2', 'A-3', 'A-4', 'A-5']) {
        await reserve(otherId, [await seat('Fosse', label)]);
      }

      // On compte les appels à pool.query : un N+1 en ferait 1 + N.
      const spy = jest.spyOn(pool, 'query');
      try {
        await reservations.findByUser(buyerId);
        const forOne = spy.mock.calls.length;
        spy.mockClear();
        await reservations.findByUser(otherId);
        const forFive = spy.mock.calls.length;

        expect([forOne, forFive]).toEqual([1, 1]);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
