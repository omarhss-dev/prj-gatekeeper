import { SignJWT, UnsecuredJWT } from 'jose';
import { TokenService } from './token.service.js';

const SECRET = 'x'.repeat(32);
const tokens = new TokenService({ secret: SECRET, ttlSeconds: 3600 });
const key = new TextEncoder().encode(SECRET);
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

describe('TokenService', () => {
  it("vérifie un token qu'il a signé et en extrait l'identité", async () => {
    const token = await tokens.sign({ id: 'u1', role: 'customer' });
    await expect(tokens.verify(token)).resolves.toEqual({
      userId: 'u1',
      role: 'customer',
    });
  });

  it('signe des tokens qui expirent après ttlSeconds', async () => {
    const shortLived = new TokenService({ secret: SECRET, ttlSeconds: 900 });
    const token = await shortLived.sign({ id: 'u1', role: 'customer' });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    );
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('refuse un token signé avec un autre secret', async () => {
    const forged = await new TokenService({
      secret: 'y'.repeat(32),
      ttlSeconds: 3600,
    }).sign({ id: 'u1', role: 'organizer' });
    await expect(tokens.verify(forged)).resolves.toBeNull();
  });

  it('refuse un token expiré', async () => {
    const token = await new SignJWT({ role: 'customer' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('refuse un token sans exp, qui serait valable pour toujours', async () => {
    const token = await new SignJWT({ role: 'customer' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .sign(key);
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('refuse un autre algorithme, même signé avec le bon secret', async () => {
    const token = await new SignJWT({ role: 'customer' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('u1')
      .setExpirationTime(inOneHour())
      .sign(key);
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('refuse un token non signé (alg: none)', async () => {
    const token = new UnsecuredJWT({
      sub: 'u1',
      role: 'organizer',
      exp: inOneHour(),
    }).encode();
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it("refuse une chaîne qui n'est pas un JWT", async () => {
    await expect(tokens.verify('pas-un-jwt')).resolves.toBeNull();
  });
});
