import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { EventsRepository } from '../../src/modules/events/core/events.repository.js';
import { ReservationsRepository } from '../../src/modules/reservations/core/reservations.repository.js';
import { createTestPool, resetDatabase } from './database.js';
import { insertUser } from './fixtures.js';

/**
 * Deux sections qui ont chacune un siège A-1 : c'est le cas qui a révélé la
 * collision des codes quand le code dépendait du libellé du siège.
 */
const newEvent = (name = 'Concert') => ({
  name,
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: new Date('2099-06-01T19:00:00Z'),
  salesOpenAt: new Date('2000-01-01T00:00:00Z'),
  maxSeatsPerReservation: 4,
  sections: [
    { name: 'Fosse', priceCents: 5000, rowsCount: 2, seatsPerRow: 10 },
    { name: 'Balcon', priceCents: 3000, rowsCount: 2, seatsPerRow: 10 },
  ],
});

describe('ReservationsRepository (vrai Postgres)', () => {
  let pool;
  let reservations;
  let events;
  let organizerId;
  let buyerId;
  let eventId;

  beforeAll(() => {
    pool = createTestPool();
    reservations = new ReservationsRepository(pool);
    events = new EventsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Un événement publié, par le vrai chemin : création puis publication. */
  async function publishedEvent(name) {
    const { id } = await events.createWithSections(organizerId, newEvent(name));
    await events.publishDraft(id, organizerId);
    return id;
  }

  beforeEach(async () => {
    await resetDatabase(pool);
    organizerId = await insertUser(pool, 'orga@x.com');
    buyerId = await insertUser(pool, 'client@x.com');
    eventId = await publishedEvent('Concert');
  });

  async function seatId(section, label, event = eventId) {
    const { rows } = await pool.query(
      `SELECT s.id FROM event_seats s
       JOIN event_sections sec ON sec.id = s.section_id
       WHERE s.event_id = $1 AND sec.name = $2 AND s.seat_label = $3`,
      [event, section, label],
    );
    return rows[0].id;
  }

  async function count(sql, params = []) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n ${sql}`,
      params,
    );
    return rows[0].n;
  }

  const activeTickets = (seat) =>
    count(`FROM tickets WHERE event_seat_id = $1 AND status = 'active'`, [
      seat,
    ]);

  it('findEventForReservation lit les quatre champs, et null pour un id inconnu', async () => {
    await expect(
      reservations.findEventForReservation(eventId),
    ).resolves.toEqual({
      status: 'published',
      startsAt: new Date('2099-06-01T19:00:00Z'),
      salesOpenAt: new Date('2000-01-01T00:00:00Z'),
      maxSeatsPerReservation: 4,
    });
    await expect(
      reservations.findEventForReservation(randomUUID()),
    ).resolves.toBeNull();
  });

  it('réserve Fosse A-1 et Balcon A-1 : deux billets, deux codes, total calculé par la base', async () => {
    const seats = [await seatId('Fosse', 'A-1'), await seatId('Balcon', 'A-1')];

    const { reservation } = await reservations.reserve(buyerId, eventId, seats);

    expect(reservation).toMatchObject({
      id: expect.any(String),
      eventId,
      status: 'confirmed',
      totalCents: 8000,
      createdAt: expect.any(Date),
    });
    expect(reservation.tickets.map((t) => t.seatId).sort()).toEqual(
      [...seats].sort(),
    );
    expect(new Set(reservation.tickets.map((t) => t.code)).size).toBe(2);
    expect(await count(`FROM reservations`)).toBe(1);
  });

  it('tout ou rien : un siège déjà pris fait tout annuler, et le désigne', async () => {
    const taken = await seatId('Fosse', 'A-1');
    const free = await seatId('Fosse', 'A-2');
    await reservations.reserve(buyerId, eventId, [taken]);

    await expect(
      reservations.reserve(buyerId, eventId, [free, taken]),
    ).resolves.toEqual({ unavailableSeatIds: [taken] });

    // Ni seconde réservation, ni billet sur le siège libre.
    expect(await count(`FROM reservations`)).toBe(1);
    expect(await activeTickets(free)).toBe(0);
  });

  it("ADR-024 : un siège d'un autre événement n'est jamais lié à la réservation", async () => {
    const festivalId = await publishedEvent('Festival');
    const foreign = await seatId('Fosse', 'A-1', festivalId);
    const own = await seatId('Fosse', 'A-1');

    await expect(
      reservations.reserve(buyerId, eventId, [own, foreign]),
    ).resolves.toEqual({ unavailableSeatIds: [foreign] });

    expect(await count(`FROM reservations`)).toBe(0);
    expect(await count(`FROM tickets`)).toBe(0);
  });

  it('un identifiant de siège inconnu est indisponible', async () => {
    const unknown = randomUUID();
    await expect(
      reservations.reserve(buyerId, eventId, [unknown]),
    ).resolves.toEqual({ unavailableSeatIds: [unknown] });
  });

  it('rend la connexion au pool après un refus', async () => {
    // Pool d'UNE connexion : si le refus ne l'avait pas rendue, la
    // réservation suivante attendrait un slot libre jusqu'au timeout.
    const tinyPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    const repository = new ReservationsRepository(tinyPool);
    const unknown = randomUUID();
    const free = await seatId('Fosse', 'A-3');

    try {
      await expect(
        repository.reserve(buyerId, eventId, [unknown]),
      ).resolves.toEqual({ unavailableSeatIds: [unknown] });
      await expect(
        repository.reserve(buyerId, eventId, [free]),
      ).resolves.toHaveProperty('reservation');
    } finally {
      await tinyPool.end();
    }
  });

  it('deux réservations simultanées du même siège : une seule réussit, sans exception', async () => {
    const seat = await seatId('Balcon', 'B-5');
    const otherBuyer = await insertUser(pool, 'autre@x.com');

    // Deux transactions sur deux connexions. La seconde attend le COMMIT de
    // la première sur l'index uq_tickets_active_seat, puis ON CONFLICT saute
    // la ligne : 0 billet, donc ROLLBACK et un refus. Jamais une 23505.
    const results = await Promise.all([
      reservations.reserve(buyerId, eventId, [seat]),
      reservations.reserve(otherBuyer, eventId, [seat]),
    ]);

    expect(results.filter((r) => r.reservation)).toHaveLength(1);
    expect(results.filter((r) => r.unavailableSeatIds)).toEqual([
      { unavailableSeatIds: [seat] },
    ]);
    expect(await activeTickets(seat)).toBe(1);
    expect(await count(`FROM reservations`)).toBe(1);
  });

  it('[A, B] contre [B, A], vingt fois : toujours un gagnant, jamais une exception', async () => {
    // Ce test prouve l'issue (1 réservation, 1 refus, 0 deadlock), pas la
    // nécessité de ORDER BY : sans lui, les deux transactions suivent
    // aujourd'hui l'ordre du plan, le même pour les deux. ORDER BY rend cet
    // ordre indépendant du plan (voir l'addendum à ADR-003).
    const otherBuyer = await insertUser(pool, 'autre@x.com');

    for (let n = 1; n <= 20; n += 1) {
      const a = await seatId('Fosse', `B-${(n % 10) + 1}`);
      const b = await seatId('Balcon', `B-${(n % 10) + 1}`);
      await pool.query('DELETE FROM tickets');
      await pool.query('DELETE FROM reservations');

      const results = await Promise.all([
        reservations.reserve(buyerId, eventId, [a, b]),
        reservations.reserve(otherBuyer, eventId, [b, a]),
      ]);

      expect(results.filter((r) => r.reservation)).toHaveLength(1);
      expect(await activeTickets(a)).toBe(1);
      expect(await activeTickets(b)).toBe(1);
    }
  });
});
