import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error.js';
import {
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from './password.js';
import { UsersRepository } from './users.repository.js';
import { TokenService } from './token.service.js';

/** Règles métier de l'authentification. Ne connaît ni HTTP ni SQL (ADR-002). */
@Injectable()
export class AuthService {
  constructor(users, tokens) {
    this.users = users;
    this.tokens = tokens;
  }

  async register({ email, password, displayName }) {
    const passwordHash = await hashPassword(password);
    const user = await this.users.create({ email, passwordHash, displayName });
    if (!user) {
      throw new DomainError(
        'EMAIL_ALREADY_REGISTERED',
        'Un compte existe déjà avec cet email.',
      );
    }
    return user;
  }

  async login({ email, password }) {
    const credentials = await this.users.findCredentialsByEmail(email);
    if (!credentials) {
      // Même coût qu'un mauvais mot de passe : le temps de réponse
      // ne doit pas révéler quels emails ont un compte.
      await verifyDummyPassword(password);
      return null;
    }
    if (!(await verifyPassword(credentials.passwordHash, password))) {
      return null;
    }
    return { accessToken: await this.tokens.sign(credentials) };
  }

  getProfile(userId) {
    return this.users.findById(userId);
  }
}

Inject(UsersRepository)(AuthService, undefined, 0);
Inject(TokenService)(AuthService, undefined, 1);
