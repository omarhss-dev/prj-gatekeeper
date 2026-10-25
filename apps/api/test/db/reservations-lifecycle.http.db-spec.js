import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { loadConfig } from '../../src/config/load-config.js';
import { createTestPool, resetDatabase } from './database.js';

const PASSWORD = '0123456789';
const accounts = {
  organizer: {
    email: 'orga@example.com',
    password: PASSWORD,
    displayName: 'Orga',
  },
  buyer: {
    email: 'client@example.com',
    password: PASSWORD,
    displayName: 'Client',
  },
  other: {
    email: 'autre@example.com',
    password: PASSWORD,
    displayName: 'Autre',
  },
};

const newEvent = {
  name: 'Concert',
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: '2099-06-01T20:00:00Z',
  salesOpenAt: '2000-01-01T00:00:00Z',
  sections: [
    { name: 'Balcon', priceCents: 3000, rowsCount: 1, seatsPerRow: 10 },
    { name: 'Fosse', priceCents: 5000, rowsCount: 1, seatsPerRow: 10 },
  ],
};

/**
 * Les routes du plan de salle, de l'annulation et de la liste, sur
 * AppModule : ce sont ces tests qui attrapent un @Param oublié, un
 * HttpStatus mal orthographié ou un controller absent du module.
 */
describe('Plan de salle, annulation et liste (AppModule, vrai Postgres)', () => {
  let app;
  let server;
  let pool;
  let tokens;
  let eventId;

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

  const api = (method, path, token) => {
    const req = request(server)[method](`/api/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  async function login(who) {
    await api('post', '/auth/register').send(who);
    const res = await api('post', '/auth/login').send({
      email: who.email,
      password: who.password,
    });
    return res.body.accessToken;
  }

  beforeEach(async () => {
    await resetDatabase(pool);
    await api('post', '/auth/register').send(accounts.organizer);
    await pool.query(`UPDATE users SET role = 'organizer' WHERE email = $1`, [
      accounts.organizer.email,
    ]);
    tokens = {
      organizer: await login(accounts.organizer),
      buyer: await login(accounts.buyer),
      other: await login(accounts.other),
    };
    ({ id: eventId } = (
      await api('post', '/events', tokens.organizer).send(newEvent)
    ).body);
    await api('post', `/events/${eventId}/publish`, tokens.organizer);
  });

  async function seatIds() {
    const res = await api('get', `/events/${eventId}/seats`);
    return res.body.sections.flatMap((section) =>
      section.seats.map((seat) => seat.id),
    );
  }

  async function reserve(token, seats) {
    const res = await api('post', '/reservations', token).send({
      eventId,
      seatIds: seats,
    });
    return res.body;
  }

  describe('GET /api/v1/events/:id/seats', () => {
    it('200, public, groupé par section, sans dire qui détient un billet', async () => {
      const res = await api('get', `/events/${eventId}/seats`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['eventId', 'sections']);
      expect(res.body.sections.map((s) => s.name)).toEqual(['Fosse', 'Balcon']);
      expect(res.body.sections[0].seats[0]).toEqual({
        id: expect.any(String),
        label: 'A-1',
        available: true,
      });
    });

    it('404 pour un brouillon, un id inconnu ou un id mal formé', async () => {
      const { body: draft } = await api(
        'post',
        '/events',
        tokens.organizer,
      ).send(newEvent);

      for (const id of [draft.id, randomUUID(), 'abc']) {
        expect((await api('get', `/events/${id}/seats`)).status).toBe(404);
      }
    });
  });

  describe('DELETE /api/v1/reservations/:id', () => {
    it('204 sans corps, puis 204 encore : DELETE est idempotent', async () => {
      const [seat] = await seatIds();
      const { id } = await reserve(tokens.buyer, [seat]);

      const first = await api('delete', `/reservations/${id}`, tokens.buyer);
      const second = await api('delete', `/reservations/${id}`, tokens.buyer);

      expect([first.status, second.status]).toEqual([204, 204]);
      expect(first.text).toBe('');
    });

    it('libère le siège : le plan de salle et une nouvelle réservation le voient', async () => {
      const [seat] = await seatIds();
      const { id } = await reserve(tokens.buyer, [seat]);
      await api('delete', `/reservations/${id}`, tokens.buyer);

      const map = await api('get', `/events/${eventId}/seats`);
      const again = await api('post', '/reservations', tokens.other).send({
        eventId,
        seatIds: [seat],
      });

      expect(map.body.sections[0].seats[0].available).toBe(true);
      expect(again.status).toBe(201);
    });

    it("404 pour la réservation d'un autre, qui reste confirmée (écart avec US-6)", async () => {
      const [seat] = await seatIds();
      const { id } = await reserve(tokens.buyer, [seat]);

      const res = await api('delete', `/reservations/${id}`, tokens.other);

      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('code');
      const { rows } = await pool.query(
        'SELECT status FROM reservations WHERE id = $1',
        [id],
      );
      expect(rows[0].status).toBe('confirmed');
    });

    it('409 RESERVATION_NOT_CANCELLABLE une fois l’événement commencé', async () => {
      const [seat] = await seatIds();
      const { id } = await reserve(tokens.buyer, [seat]);
      await pool.query(
        `UPDATE events SET sales_open_at = now() - interval '2 days',
                           starts_at = now() - interval '1 hour'
         WHERE id = $1`,
        [eventId],
      );

      const res = await api('delete', `/reservations/${id}`, tokens.buyer);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESERVATION_NOT_CANCELLABLE');
    });

    it('401 sans token, avant même la validation de l’id', async () => {
      const res = await api('delete', '/reservations/abc');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/me/reservations', () => {
    it('401 sans token', async () => {
      expect((await api('get', '/me/reservations')).status).toBe(401);
    });

    it('200 avec ses seules réservations, annulées comprises', async () => {
      const [a, b, c] = await seatIds();
      const kept = await reserve(tokens.buyer, [a]);
      const cancelled = await reserve(tokens.buyer, [b]);
      await reserve(tokens.other, [c]);
      await api('delete', `/reservations/${cancelled.id}`, tokens.buyer);

      const res = await api('get', '/me/reservations', tokens.buyer);

      expect(res.status).toBe(200);
      expect(res.body.map((r) => [r.id, r.status])).toEqual([
        [cancelled.id, 'cancelled'],
        [kept.id, 'confirmed'],
      ]);
      expect(res.body[1].tickets[0]).toEqual({
        code: expect.any(String),
        status: 'active',
        priceCents: 5000,
        section: 'Fosse',
        seat: 'A-1',
      });
    });
  });
});
