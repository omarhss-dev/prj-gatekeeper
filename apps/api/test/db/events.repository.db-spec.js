import pg from 'pg';
import { EventsRepository } from '../../src/modules/events/core/events.repository.js';
import { createTestPool, resetDatabase } from './database.js';
import { insertUser } from './fixtures.js';

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
