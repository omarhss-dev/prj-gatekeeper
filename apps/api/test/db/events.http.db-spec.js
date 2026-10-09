import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { loadConfig } from '../../src/config/load-config.js';
import { createTestPool, resetDatabase } from './database.js';

const account = {
  email: 'orga@example.com',
  password: '0123456789',
  displayName: 'Orga',
};

const newEvent = {
  name: 'Concert',
  city: 'Fès',
  venue: 'Palais des congrès',
  startsAt: '2099-06-01T20:00:00+01:00',
  salesOpenAt: '2099-05-01T10:00:00Z',
  sections: [
    { name: 'Orchestre', priceCents: 8000, rowsCount: 10, seatsPerRow: 20 },
    { name: 'Balcon', priceCents: 4000, rowsCount: 5, seatsPerRow: 30 },
  ],
};

describe('POST /api/v1/events (AppModule, vrai Postgres)', () => {
  let app;
  let server;
  let pool;

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

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  async function register(who = account) {
    const res = await request(server).post('/api/v1/auth/register').send(who);
    return res.body.id;
  }

  async function login(who = account) {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: who.email, password: who.password });
    return res.body.accessToken;
  }

  /** Décision 1 de la branche : la promotion se fait en SQL, hors de l'API. */
  async function promoteToOrganizer(userId) {
    await pool.query(`UPDATE users SET role = 'organizer' WHERE id = $1`, [
      userId,
    ]);
  }

  async function customerToken() {
    const userId = await register();
    return { userId, token: await login() };
  }

  async function organizerToken(who = account) {
    const userId = await register(who);
    await promoteToOrganizer(userId);
    return { userId, token: await login(who) };
  }

  const createEvent = (token, body = newEvent) => {
    const req = request(server).post('/api/v1/events').send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('crée un brouillon et ses sections pour un organisateur', async () => {
    const { userId, token } = await organizerToken();
    const res = await createEvent(token);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organizerId: userId,
      status: 'draft',
      publishedAt: null,
      startsAt: '2099-06-01T19:00:00.000Z',
      maxSeatsPerReservation: 4,
    });
    expect(res.body.sections.map((section) => section.name)).toEqual([
      'Orchestre',
      'Balcon',
    ]);
  });

  it("prend l'organisateur dans le token, jamais dans le corps", async () => {
    const { userId, token } = await organizerToken();
    const res = await createEvent(token, {
      ...newEvent,
      organizerId: '00000000-0000-0000-0000-000000000000',
      status: 'published',
    });

    expect(res.status).toBe(201);
    expect(res.body.organizerId).toBe(userId);
    expect(res.body.status).toBe('draft');
  });

  it('répond 401 sans token, avant toute validation du corps', async () => {
    const res = await createEvent(undefined, {});
    expect(res.status).toBe(401);
    expect(res.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('répond 403 à un client, sans code métier', async () => {
    const { token } = await customerToken();
    const res = await createEvent(token);

    expect(res.status).toBe(403);
    expect(res.body.type).toBe('about:blank');
    expect(res.body).not.toHaveProperty('code');
  });

  it('garde le rôle du token jusqu’à la reconnexion (ADR-004)', async () => {
    const { userId, token: oldToken } = await customerToken();
    await promoteToOrganizer(userId);

    // L'ancien token porte encore role = customer.
    expect((await createEvent(oldToken)).status).toBe(403);
    // Un nouveau login émet un token avec le rôle à jour.
    expect((await createEvent(await login())).status).toBe(201);
  });

  it('répond 422 avec le champ fautif à un corps invalide', async () => {
    const { token } = await organizerToken();
    const res = await createEvent(token, { ...newEvent, sections: [] });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { path: ['sections'], code: 'too_small' },
    ]);
  });

  describe('POST /api/v1/events/:id/publish', () => {
    const otherAccount = { ...account, email: 'autre@example.com' };

    const publish = (token, id) =>
      request(server)
        .post(`/api/v1/events/${id}/publish`)
        .set('Authorization', `Bearer ${token}`);

    async function draftOf(token) {
      return (await createEvent(token)).body.id;
    }

    it('publie son brouillon : 200, statut published, sièges générés', async () => {
      const { token } = await organizerToken();
      const res = await publish(token, await draftOf(token));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'published', seatCount: 350 });
    });

    it('répond 409 EVENT_ALREADY_PUBLISHED à une seconde publication', async () => {
      const { token } = await organizerToken();
      const id = await draftOf(token);
      await publish(token, id);

      const res = await publish(token, id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EVENT_ALREADY_PUBLISHED');
    });

    it("répond 404 au brouillon d'un autre organisateur, comme s'il n'existait pas", async () => {
      const { token: ownerToken } = await organizerToken();
      const id = await draftOf(ownerToken);
      const { token: otherToken } = await organizerToken(otherAccount);

      const res = await publish(otherToken, id);
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('code');
    });

    it("répond 403 à l'événement publié d'un autre organisateur", async () => {
      const { token: ownerToken } = await organizerToken();
      const id = await draftOf(ownerToken);
      await publish(ownerToken, id);
      const { token: otherToken } = await organizerToken(otherAccount);

      expect((await publish(otherToken, id)).status).toBe(403);
    });

    it.each([
      ['un identifiant qui n’est pas un UUID', 'abc'],
      ['un UUID inconnu', '00000000-0000-0000-0000-000000000000'],
    ])('répond 404 RFC 7807 pour %s, jamais 500', async (_label, id) => {
      const { token } = await organizerToken();
      const res = await publish(token, id);

      expect(res.status).toBe(404);
      expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
    });
  });

  describe('GET /api/v1/events et /api/v1/events/:id (publics)', () => {
    async function publishedEvent() {
      const { token } = await organizerToken();
      const { id } = (await createEvent(token)).body;
      await request(server)
        .post(`/api/v1/events/${id}/publish`)
        .set('Authorization', `Bearer ${token}`);
      return { id, token };
    }

    it('sert le catalogue sans token, sans les brouillons', async () => {
      const { id, token } = await publishedEvent();
      await createEvent(token, { ...newEvent, name: 'Brouillon' });

      const res = await request(server).get('/api/v1/events');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, hasNext: false });
      expect(res.body.items.map((item) => item.id)).toEqual([id]);
      expect(res.body.items[0]).not.toHaveProperty('organizerId');
    });

    it('répond 422 avec le paramètre fautif', async () => {
      const res = await request(server).get('/api/v1/events?limit=101');
      expect(res.status).toBe(422);
      expect(res.body.errors).toEqual([{ path: ['limit'], code: 'too_big' }]);
    });

    it('sert le détail d’un événement publié, avec ses sections', async () => {
      const { id } = await publishedEvent();
      const res = await request(server).get(`/api/v1/events/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.sections).toHaveLength(2);
      expect(res.body).not.toHaveProperty('organizerId');
    });

    it('répond 404 pour un brouillon, même à son organisateur', async () => {
      const { token } = await organizerToken();
      const { id } = (await createEvent(token)).body;

      const res = await request(server)
        .get(`/api/v1/events/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('répond 404 pour un identifiant qui n’est pas un UUID', async () => {
      expect((await request(server).get('/api/v1/events/abc')).status).toBe(
        404,
      );
    });
  });
});
