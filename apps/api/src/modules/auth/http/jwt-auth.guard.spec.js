import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const identity = { userId: 'u1', role: 'customer' };

/** Faux TokenService : seul le token 'valid' est accepté. */
const fakeTokens = {
  verify: async (token) => (token === 'valid' ? identity : null),
};

/** Faux ExecutionContext HTTP, avec un req et un res minimaux. */
function httpContext(authorization) {
  const req = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const responseHeaders = {};
  const res = {
    setHeader: (name, value) => {
      responseHeaders[name] = value;
    },
  };
  return {
    req,
    responseHeaders,
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    },
  };
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(fakeTokens);

  it("laisse passer un token valide et range l'identité dans req.user", async () => {
    const { req, context } = httpContext('Bearer valid');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual(identity);
  });

  it('accepte le schéma sans tenir compte de la casse (RFC 7235)', async () => {
    const { context } = httpContext('bearer valid');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([
    ['sans en-tête Authorization', undefined],
    ['avec un autre schéma', 'Basic dXNlcjpwYXNz'],
    ['avec Bearer sans token', 'Bearer'],
    ['avec un token refusé', 'Bearer invalid'],
    ['avec un en-tête mal formé', 'Bearer valid extra'],
  ])('lève un 401 %s, avec WWW-Authenticate', async (_label, authorization) => {
    const { context, responseHeaders } = httpContext(authorization);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(responseHeaders['WWW-Authenticate']).toBe('Bearer');
  });
});
