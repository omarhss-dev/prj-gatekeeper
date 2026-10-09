import pg from 'pg';
import { EventsRepository } from '../../src/modules/events/core/events.repository.js';
import { createTestPool, resetDatabase } from './database.js';
import { insertSeat, insertUser } from './fixtures.js';

/** Un corps tel que createEventSchema le produit : dates en Date, défaut appliqué. */
const newEvent = {
  name: 'Concert',
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: new Date('2099-06-01T19:00:00Z'),
  salesOpenAt: new Date('2099-05-01T10:00:00Z'),
  maxSeatsPerReservation: 4,
  sections: [
    { name: 'Orchestre', priceCents: 8000, rowsCount: 10, seatsPerRow: 20 },
    { name: 'Balcon', priceCents: 4000, rowsCount: 5, seatsPerRow: 30 },
  ],
};

describe('EventsRepository.createWithSections (vrai Postgres)', () => {
  let pool;
  let events;
  let organizerId;

  beforeAll(() => {
    pool = createTestPool();
    events = new EventsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    organizerId = await insertUser(pool);
  });

  async function count(table) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ${table}`,
    );
    return rows[0].n;
  }

  it('crée un brouillon et ses sections, dans l’ordre de la requête', async () => {
    const event = await events.createWithSections(organizerId, newEvent);

    expect(event).toMatchObject({
      id: expect.any(String),
      organizerId,
      name: 'Concert',
      description: null,
      status: 'draft',
      publishedAt: null,
      startsAt: newEvent.startsAt,
      maxSeatsPerReservation: 4,
    });
    expect(event.sections.map((section) => section.name)).toEqual([
      'Orchestre',
      'Balcon',
    ]);
    expect(event.sections[0]).toEqual({
      id: expect.any(String),
      name: 'Orchestre',
      priceCents: 8000,
      rowsCount: 10,
      seatsPerRow: 20,
    });
    expect(await count('event_sections')).toBe(2);
  });

  it('ne crée rien si une section est refusée : l’événement est annulé avec elle', async () => {
    // Le doublon contourne Zod (le repository reçoit ce qu'on lui donne) et
    // fait échouer la SECONDE instruction, après l'INSERT de l'événement.
    const duplicated = {
      ...newEvent,
      sections: [newEvent.sections[0], newEvent.sections[0]],
    };

    await expect(
      events.createWithSections(organizerId, duplicated),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'uq_sections_event_name',
    });
    expect(await count('events')).toBe(0);
    expect(await count('event_sections')).toBe(0);
  });

  it('rend la connexion au pool après un échec', async () => {
    // Pool d'UNE connexion : si l'échec précédent ne l'avait pas rendue,
    // la création suivante attendrait un slot libre jusqu'au timeout.
    const tinyPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    const repository = new EventsRepository(tinyPool);
    const duplicated = {
      ...newEvent,
      sections: [newEvent.sections[0], newEvent.sections[0]],
    };

    try {
      await expect(
        repository.createWithSections(organizerId, duplicated),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        repository.createWithSections(organizerId, newEvent),
      ).resolves.toMatchObject({ status: 'draft' });
    } finally {
      await tinyPool.end();
    }
  });
});

describe('EventsRepository.publishDraft (vrai Postgres)', () => {
  let pool;
  let events;
  let organizerId;

  beforeAll(() => {
    pool = createTestPool();
    events = new EventsRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    organizerId = await insertUser(pool);
  });

  // 10 × 20 (Orchestre) + 5 × 30 (Balcon).
  const EXPECTED_SEATS = 350;

  async function countSeats() {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM event_seats',
    );
    return rows[0].n;
  }

  it('publie un brouillon et crée un siège par rangée et par place', async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);
    const published = await events.publishDraft(id, organizerId);

    expect(published).toMatchObject({
      id,
      status: 'published',
      publishedAt: expect.any(Date),
      seatCount: EXPECTED_SEATS,
    });
    expect(await countSeats()).toBe(EXPECTED_SEATS);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
       FROM event_seats WHERE seat_label IN ('A-1', 'J-20', 'E-30')`,
    );
    // A-1 dans les deux sections, J-20 (10e rangée) dans l'Orchestre,
    // E-30 (5e rangée, 30e place) dans le Balcon.
    expect(rows[0].n).toBe(4);
  });

  it("renvoie null pour l'événement d'un autre, qui reste un brouillon", async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);
    const otherId = await insertUser(pool, 'autre@x.com');

    await expect(events.publishDraft(id, otherId)).resolves.toBeNull();
    await expect(events.findById(id)).resolves.toMatchObject({
      status: 'draft',
    });
    expect(await countSeats()).toBe(0);
  });

  it('renvoie null à une seconde publication, sans dupliquer les sièges', async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);
    await events.publishDraft(id, organizerId);

    await expect(events.publishDraft(id, organizerId)).resolves.toBeNull();
    expect(await countSeats()).toBe(EXPECTED_SEATS);
  });

  it('ne publie qu’une fois quand deux publications arrivent en même temps', async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);

    // Deux transactions sur deux connexions : la seconde attend le verrou
    // posé par l'UPDATE de la première, puis réévalue son WHERE et trouve
    // status = 'published'. Ni doublon de sièges, ni 23505, ni 500.
    const results = await Promise.all([
      events.publishDraft(id, organizerId),
      events.publishDraft(id, organizerId),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(await countSeats()).toBe(EXPECTED_SEATS);
  });

  it('laisse un brouillon sans siège si la génération échoue en cours de route', async () => {
    const { id, sections } = await events.createWithSections(
      organizerId,
      newEvent,
    );
    // Un siège A-1 déjà présent fait échouer l'INSERT des sièges sur
    // uq_seats_section_label, APRÈS l'UPDATE du statut.
    await insertSeat(pool, id, sections[0].id, 'A-1');

    await expect(events.publishDraft(id, organizerId)).rejects.toMatchObject({
      code: '23505',
      constraint: 'uq_seats_section_label',
    });
    await expect(events.findById(id)).resolves.toMatchObject({
      status: 'draft',
      publishedAt: null,
    });
    expect(await countSeats()).toBe(1);
  });

  it('findById renvoie null pour un événement inconnu', async () => {
    await expect(
      events.findById('00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeNull();
  });
});
