import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { loadConfig } from '../../src/config/load-config.js';
import { createTestPool, resetDatabase } from './database.js';

const organizer = {
  email: 'orga@example.com',
  password: '0123456789',
  displayName: 'Orga',
};
const buyer = {
  email: 'client@example.com',
  password: '0123456789',
  displayName: 'Client',
};
const otherBuyer = {
  email: 'autre@example.com',
  password: '0123456789',
  displayName: 'Autre',
};

/** Vente ouverte depuis toujours, sauf si le test la repousse. */
const newEvent = (overrides = {}) => ({
  name: 'Concert',
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: '2099-06-01T20:00:00Z',
  salesOpenAt: '2000-01-01T00:00:00Z',
  sections: [
    { name: 'Fosse', priceCents: 5000, rowsCount: 1, seatsPerRow: 10 },
    { name: 'Balcon', priceCents: 3000, rowsCount: 1, seatsPerRow: 10 },
  ],
  ...overrides,
});

describe('POST /api/v1/reservations (AppModule, vrai Postgres)', () => {
  let app;
  let server;
  let pool;
  let organizerToken;
  let buyerToken;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_SECRET: 'x'.repeat(32),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    server = app.getHttpServer();
    pool = createTestPool();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function tokenFor(who) {
    await request(server).post('/api/v1/auth/register').send(who);
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: who.email, password: who.password });
    return res.body.accessToken;
  }

  beforeEach(async () => {
    await resetDatabase(pool);
    // Promotion en SQL avant le login : le rôle est lu dans le token.
    await request(server).post('/api/v1/auth/register').send(organizer);
    await pool.query(`UPDATE users SET role = 'organizer' WHERE email = $1`, [
      organizer.email,
    ]);
    organizerToken = await tokenFor(organizer);
    buyerToken = await tokenFor(buyer);
  });

  /** Crée un événement par l'API ; le publie sauf si publish = false. */
  async function createEvent(overrides, { publish = true } = {}) {
    const { body } = await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send(newEvent(overrides));
    if (publish) {
      await request(server)
        .post(`/api/v1/events/${body.id}/publish`)
        .set('Authorization', `Bearer ${organizerToken}`);
    }
    return body.id;
  }

  /** Les identifiants des sièges : l'API ne les expose pas encore (commit 5). */
  async function seatIds(eventId) {
    const { rows } = await pool.query(
      `SELECT s.id FROM event_seats s
       JOIN event_sections sec ON sec.id = s.section_id
       WHERE s.event_id = $1
       ORDER BY sec.name, s.seat_label`,
      [eventId],
    );
    return rows.map((row) => row.id);
  }

  /** Un siège désigné par sa section et son libellé. */
  async function seat(eventId, section, label) {
    const { rows } = await pool.query(
      `SELECT s.id FROM event_seats s
       JOIN event_sections sec ON sec.id = s.section_id
       WHERE s.event_id = $1 AND sec.name = $2 AND s.seat_label = $3`,
      [eventId, section, label],
    );
    return rows[0].id;
  }

  const reserve = (token, body) => {
    const req = request(server).post('/api/v1/reservations').send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('201 avec la réservation et un billet par siège', async () => {
    const eventId = await createEvent();
    const fosse = await seat(eventId, 'Fosse', 'A-1');
    const balcon = await seat(eventId, 'Balcon', 'A-1');

    const res = await reserve(buyerToken, {
      eventId,
      seatIds: [fosse, balcon],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      eventId,
      status: 'confirmed',
      totalCents: 8000,
    });
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.tickets[0]).toEqual({
      seatId: expect.any(String),
      code: expect.any(String),
      priceCents: expect.any(Number),
    });
  });

  it("prend l'acheteur dans le token, jamais dans le corps", async () => {
    const eventId = await createEvent();
    const [seat] = await seatIds(eventId);

    const res = await reserve(buyerToken, {
      eventId,
      seatIds: [seat],
      userId: randomUUID(),
    });

    expect(res.status).toBe(201);
    const { rows } = await pool.query(
      `SELECT u.email FROM reservations r JOIN users u ON u.id = r.user_id`,
    );
    expect(rows).toEqual([{ email: buyer.email }]);
  });

  it('US-5 : deux réservations simultanées du même siège → un 201 et un 409, jamais un 500', async () => {
    const eventId = await createEvent();
    const [seat] = await seatIds(eventId);
    const otherToken = await tokenFor(otherBuyer);

    const responses = await Promise.all([
      reserve(buyerToken, { eventId, seatIds: [seat] }),
      reserve(otherToken, { eventId, seatIds: [seat] }),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    const refused = responses.find((res) => res.status === 409);
    expect(refused.body).toMatchObject({
      code: 'SEAT_UNAVAILABLE',
      seatIds: [seat],
    });
  });

  it('409 SEAT_UNAVAILABLE en RFC 7807, avec les sièges pris et le correlationId', async () => {
    const eventId = await createEvent();
    const [taken, free] = await seatIds(eventId);
    await reserve(buyerToken, { eventId, seatIds: [taken] });

    const res = await reserve(buyerToken, { eventId, seatIds: [free, taken] });

    expect(res.status).toBe(409);
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'https://gatekeeper.dev/errors/seat-unavailable',
      title: 'Seat unavailable',
      status: 409,
      code: 'SEAT_UNAVAILABLE',
      detail: expect.any(String),
      seatIds: [taken],
      correlationId: res.get('X-Correlation-Id'),
    });
  });

  it("409 SEAT_UNAVAILABLE pour un siège d'un autre événement (écart assumé avec US-5)", async () => {
    const concertId = await createEvent();
    const festivalId = await createEvent({ name: 'Festival' });
    const [foreign] = await seatIds(festivalId);

    const res = await reserve(buyerToken, {
      eventId: concertId,
      seatIds: [foreign],
    });

    expect(res.status).toBe(409);
    expect(res.body.seatIds).toEqual([foreign]);
  });

  it("409 SALES_NOT_OPEN avec la date d'ouverture", async () => {
    const eventId = await createEvent({ salesOpenAt: '2099-05-01T10:00:00Z' });
    const [seat] = await seatIds(eventId);

    const res = await reserve(buyerToken, { eventId, seatIds: [seat] });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'SALES_NOT_OPEN',
      salesOpenAt: '2099-05-01T10:00:00.000Z',
    });
  });

  it('422 MAX_SEATS_EXCEEDED au-delà de la limite de l’événement (4 par défaut)', async () => {
    const eventId = await createEvent();
    const seats = (await seatIds(eventId)).slice(0, 5);

    const res = await reserve(buyerToken, { eventId, seatIds: seats });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAX_SEATS_EXCEEDED');
  });

  it("404 pour un brouillon : il n'existe pas pour le public", async () => {
    const eventId = await createEvent({}, { publish: false });

    const res = await reserve(buyerToken, {
      eventId,
      seatIds: [randomUUID()],
    });

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('code');
  });

  it('422 de validation pour un siège demandé deux fois', async () => {
    const eventId = await createEvent();
    const [seat] = await seatIds(eventId);

    const res = await reserve(buyerToken, { eventId, seatIds: [seat, seat] });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([{ path: ['seatIds'], code: 'custom' }]);
  });

  it('401 sans token, avant toute validation du corps', async () => {
    const res = await reserve(undefined, {});
    expect(res.status).toBe(401);
    expect(res.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('un organisateur peut réserver, comme tout compte', async () => {
    const eventId = await createEvent();
    const [seat] = await seatIds(eventId);

    const res = await reserve(organizerToken, { eventId, seatIds: [seat] });

    expect(res.status).toBe(201);
  });
});
