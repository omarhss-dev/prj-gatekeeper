import { loadConfig, ConfigValidationError } from './load-config';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://gatekeeper:s3cr3t@localhost:5432/gatekeeper',
};

describe('loadConfig', () => {
  it('accepte une configuration valide et applique le défaut de PORT et LOG_LEVEL', () => {
    expect(loadConfig(valid)).toEqual({
      ...valid,
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('lit LOG_LEVEL quand il est fourni', () => {
    expect(loadConfig({ ...valid, LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe(
      'debug',
    );
  });

  it('rejette un niveau inconnu de pino', () => {
    expect(() => loadConfig({ ...valid, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('rejette une chaîne vide, que le défaut ne protège pas', () => {
    expect(() => loadConfig({ ...valid, PORT: '' })).toThrow(
      ConfigValidationError,
    );
  });

  it('nomme la variable fautive', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('signale TOUTES les variables fautives en une fois', () => {
    try {
      loadConfig({});
      fail('aurait dû lever');
    } catch (error) {
      expect((error as ConfigValidationError).issues).toHaveLength(2);
    }
  });

  it('ne fait jamais fuiter la valeur reçue dans le message', () => {
    try {
      loadConfig({
        ...valid,
        DATABASE_URL: 'redis://user:s3cr3t@localhost:6379',
      });
      fail('aurait dû lever');
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cr3t');
    }
  });
});
