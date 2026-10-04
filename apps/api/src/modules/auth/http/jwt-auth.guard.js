import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../core/token.service.js';

/**
 * Exige un access token valide : « Authorization: Bearer <jwt> ».
 * En cas de succès, range l'identité du token dans req.user.
 */

@Injectable()
export class JwtAuthGuard {
  constructor(tokens) {
    this.tokens = tokens;
  }

  async canActivate(context) {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const token = extractBearerToken(req.headers.authorization);
    const identity = token ? await this.tokens.verify(token) : null;

    if (!identity) {
      http.getResponse().setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException();
    }

    req.user = identity;
    return true;
  }
}

function extractBearerToken(header) {
  if (typeof header !== 'string') return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    return null;
  }
  return token;
}

Inject(TokenService)(JwtAuthGuard, undefined, 0);
