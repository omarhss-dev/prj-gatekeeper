import type { AppConfig } from '../config/config.schema';
import { createPool } from './pool';

const config: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/test',
};

describe('createPool', () => {
  it('ne fait pas tomber le processus quand une connexion inactive est perdue', async () => {
    const warn = jest.fn();
    const pool = createPool(config, { warn });

    // new Pool() n'ouvre aucune connexion : pas besoin de Postgres ici.
    expect(() =>
      pool.emit('error', new Error('terminating connection')),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);

    await pool.end();
  });
});
