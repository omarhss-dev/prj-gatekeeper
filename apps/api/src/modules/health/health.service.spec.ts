import { jest } from '@jest/globals';
import type { Pool } from 'pg';
import { HealthService } from './health.service.js';

// Faux pool : seul query() est appelé par pingDatabase.
const fakePool = (query: jest.Mock): Pool => ({ query }) as unknown as Pool;

describe('HealthService', () => {
  it('signale la base joignable quand la requête aboutit', async () => {
    const service = new HealthService(
      fakePool(jest.fn().mockResolvedValue({ rows: [] })),
    );
    await expect(service.isDatabaseReachable()).resolves.toBe(true);
  });

  it("ne propage jamais l'erreur pg vers l'appelant", async () => {
    const service = new HealthService(
      fakePool(jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))),
    );
    // Le point du test : false, PAS une exception qui remonterait
    // au controller et produirait un 500 au lieu d'un 503.
    await expect(service.isDatabaseReachable()).resolves.toBe(false);
  });
});
