import { loadConfig, ConfigValidationError } from './load-config.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://gatekeeper:s3cr3t@localhost:5432/gatekeeper',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('accepte une configuration valide et applique le défaut de PORT et LOG_LEVEL', () => {
    expect(loadConfig(valid)).toEqual({
      ...valid,
      PORT: 3000,
      LOG_LEVEL: 'info',
      JWT_TTL_SECONDS: 3600,
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
    expect.assertions(1);
    try {
      loadConfig({});
    } catch (error) {
      expect(error.issues).toHaveLength(3);
    }
  });

  it('rejette un JWT_SECRET de moins de 32 caractères', () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'x'.repeat(31) })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('ne fait jamais fuiter le JWT_SECRET refusé dans le message', () => {
    expect.assertions(1);
    try {
      loadConfig({ ...valid, JWT_SECRET: 'tooShortS3cr3t' });
    } catch (error) {
      expect(error.message).not.toContain('tooShortS3cr3t');
    }
  });

  it('ne fait jamais fuiter la valeur reçue dans le message', () => {
    expect.assertions(1);
    try {
      loadConfig({
        ...valid,
        DATABASE_URL: 'redis://user:s3cr3t@localhost:6379',
      });
    } catch (error) {
      expect(error.message).not.toContain('s3cr3t');
    }
  });
  it('lit JWT_TTL_SECONDS et le convertit en nombre', () => {
    expect(
      loadConfig({ ...valid, JWT_TTL_SECONDS: '900' }).JWT_TTL_SECONDS,
    ).toBe(900);
  });

  it('refuse un JWT_TTL_SECONDS de moins de 60 secondes', () => {
    expect(() => loadConfig({ ...valid, JWT_TTL_SECONDS: '30' })).toThrow(
      /JWT_TTL_SECONDS/,
    );
  });
});
