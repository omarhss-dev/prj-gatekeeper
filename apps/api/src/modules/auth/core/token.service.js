import { errors, jwtVerify, SignJWT } from 'jose';

const ALGORITHM = 'HS256';
export class TokenService {
  constructor({ secret, ttlSeconds }) {
    this.key = new TextEncoder().encode(secret);
    this.ttlSeconds = ttlSeconds;
  }

  sign({ id, role }) {
    return new SignJWT({ role })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(id)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  async verify(token) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        requiredClaims: ['sub', 'exp'],
      });
      return { userId: payload.sub, role: payload.role };
    } catch (error) {
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
  }
}
