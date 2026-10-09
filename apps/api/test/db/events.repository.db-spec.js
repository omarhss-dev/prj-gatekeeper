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

describe('EventsRepository — lectures publiques (vrai Postgres)', () => {
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

  /**
   * Insère un événement directement en SQL, au statut et à la date voulus :
   * l'API refuserait un événement passé, que le catalogue doit pourtant exclure.
   * startsAt est une expression d'intervalle relative à now() ('2 days').
   */
  async function insertEvent({
    name,
    status = 'published',
    startsIn = '30 days',
    city = 'Rabat',
  }) {
    const { rows } = await pool.query(
      `INSERT INTO events (organizer_id, name, city, venue, status,
                           starts_at, sales_open_at, published_at)
       VALUES ($1, $2, $3, 'Salle', $4,
               now() + $5::interval, now() + $5::interval - interval '1 day',
               CASE WHEN $4 = 'draft' THEN NULL ELSE now() END)
       RETURNING id`,
      [organizerId, name, city, status, startsIn],
    );
    return rows[0].id;
  }

  const page = (filters = {}) =>
    events.findCatalogue({ limit: 20, offset: 0, ...filters });
  const names = (rows) => rows.map((row) => row.name);

  it('ne liste que les événements publiés et à venir', async () => {
    await insertEvent({ name: 'Publié à venir' });
    await insertEvent({ name: 'Brouillon', status: 'draft' });
    await insertEvent({ name: 'Publié passé', startsIn: '-2 days' });

    expect(names(await page())).toEqual(['Publié à venir']);
  });

  it('trie par date et pagine par LIMIT / OFFSET', async () => {
    await insertEvent({ name: 'C', startsIn: '3 days' });
    await insertEvent({ name: 'A', startsIn: '1 day' });
    await insertEvent({ name: 'B', startsIn: '2 days' });

    expect(names(await page({ limit: 2 }))).toEqual(['A', 'B']);
    expect(names(await page({ limit: 2, offset: 2 }))).toEqual(['C']);
  });

  it('départage deux événements à la même heure par id, de façon stable', async () => {
    const { rows } = await pool.query(
      `INSERT INTO events (organizer_id, name, city, venue, status, starts_at,
                           sales_open_at, published_at)
       SELECT $1, n, 'Rabat', 'Salle', 'published',
              date_trunc('hour', now()) + interval '5 days',
              now(), now()
       FROM unnest(ARRAY['X', 'Y', 'Z']) AS n
       RETURNING id`,
      [organizerId],
    );
    const expected = rows.map((row) => row.id).sort();

    expect((await page()).map((row) => row.id)).toEqual(expected);
  });

  it('filtre la ville sans tenir compte de la casse, mais pas des accents', async () => {
    await insertEvent({ name: 'Rabat', city: 'Rabat' });
    await insertEvent({ name: 'Fès', city: 'Fès' });

    expect(names(await page({ city: 'RABAT' }))).toEqual(['Rabat']);
    // Limite assumée : sans unaccent, « Fes » ne trouve pas « Fès ».
    expect(await page({ city: 'Fes' })).toEqual([]);
  });

  it('applique l’intervalle [from, to)', async () => {
    await insertEvent({ name: 'J+1', startsIn: '1 day' });
    await insertEvent({ name: 'J+5', startsIn: '5 days' });
    await insertEvent({ name: 'J+9', startsIn: '9 days' });
    const day = 24 * 3600 * 1000;

    expect(
      names(
        await page({
          from: new Date(Date.now() + 2 * day),
          to: new Date(Date.now() + 8 * day),
        }),
      ),
    ).toEqual(['J+5']);
  });

  it('ne renvoie ni organisateur ni description dans le catalogue', async () => {
    await insertEvent({ name: 'Concert' });
    const [row] = await page();
    expect(Object.keys(row).sort()).toEqual(
      ['city', 'id', 'name', 'salesOpenAt', 'startsAt', 'venue'].sort(),
    );
  });

  it('findPublishedById : null pour un brouillon, sections de la plus chère à la moins chère', async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);
    await expect(events.findPublishedById(id)).resolves.toBeNull();

    await events.publishDraft(id, organizerId);
    const event = await events.findPublishedById(id);
    expect(event).not.toHaveProperty('organizerId');
    expect(event.sections.map((section) => section.name)).toEqual([
      'Orchestre',
      'Balcon',
    ]);
  });
});

describe('EventsRepository.updateDraft (vrai Postgres)', () => {
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

  it('ne modifie que les champs fournis', async () => {
    const created = await events.createWithSections(organizerId, {
      ...newEvent,
      description: 'Première description',
    });

    const updated = await events.updateDraft(created.id, organizerId, {
      name: 'Nouveau nom',
    });

    expect(updated).toMatchObject({
      name: 'Nouveau nom',
      description: 'Première description',
      city: newEvent.city,
      startsAt: newEvent.startsAt,
      status: 'draft',
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );
  });

  it('renvoie null pour un événement publié, qui reste inchangé', async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);
    await events.publishDraft(id, organizerId);

    await expect(
      events.updateDraft(id, organizerId, { name: 'Trop tard' }),
    ).resolves.toBeNull();
    await expect(events.findById(id)).resolves.toMatchObject({
      name: newEvent.name,
    });
  });

  it("renvoie null pour le brouillon d'un autre", async () => {
    const { id } = await events.createWithSections(organizerId, newEvent);
    const otherId = await insertUser(pool, 'autre@x.com');

    await expect(
      events.updateDraft(id, otherId, { name: 'Pas à moi' }),
    ).resolves.toBeNull();
  });
});
