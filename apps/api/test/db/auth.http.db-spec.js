import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { loadConfig } from '../../src/config/load-config.js';
import { createTestPool, resetDatabase } from './database.js';

const account = {
  email: 'omar@example.com',
  password: '0123456789',
  displayName: 'Omar',
};

describe('Auth — parcours HTTP complet (AppModule, vrai Postgres)', () => {
  let app;
  let server;
  let pool;

  beforeAll(async () => {
    // La configuration passe par loadConfig, comme en production :
    // un défaut oublié (JWT_TTL_SECONDS) ou une valeur invalide échoue ici.
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

  const register = (body = account) =>
    request(server).post('/api/v1/auth/register').send(body);
  const login = (body = account) =>
    request(server).post('/api/v1/auth/login').send(body);

  it('inscription → connexion → profil, sans jamais renvoyer le hash', async () => {
    const registered = await register({
      ...account,
      email: '  Omar@Example.COM ',
    });
    expect(registered.status).toBe(201);
    expect(registered.body.email).toBe('omar@example.com');

    const loggedIn = await login();
    expect(loggedIn.status).toBe(200);

    const me = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${loggedIn.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(registered.body.id);

    for (const res of [registered, me]) {
      expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
    }
  });

  it('ignore un rôle envoyé à l’inscription (mass assignment)', async () => {
    const res = await register({ ...account, role: 'organizer' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('customer');
  });

  it('répond 409 EMAIL_ALREADY_REGISTERED à une seconde inscription', async () => {
    await register();
    const res = await register();
    expect(res.status).toBe(409);
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('répond 401 sans code à un mauvais mot de passe', async () => {
    await register();
    const res = await login({ ...account, password: 'mauvais-mot-de-passe' });
    expect(res.status).toBe(401);
    expect(res.body.type).toBe('about:blank');
    expect(res.body).not.toHaveProperty('code');
  });

  it('protège /api/v1/me : 401 et WWW-Authenticate sans token', async () => {
    const res = await request(server).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.get('WWW-Authenticate')).toBe('Bearer');
    expect(res.body.correlationId).toBe(res.get('X-Correlation-Id'));
  });

  it('ne sert pas les routes métier hors du préfixe /api/v1', async () => {
    const res = await request(server).post('/auth/register').send(account);
    expect(res.status).toBe(404);
    expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
  });
});
