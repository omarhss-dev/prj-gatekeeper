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

  async function register() {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send(account);
    return res.body.id;
  }

  async function login() {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: account.password });
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

  async function organizerToken() {
    const userId = await register();
    await promoteToOrganizer(userId);
    return { userId, token: await login() };
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
});
