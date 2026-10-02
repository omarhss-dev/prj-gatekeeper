import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error.js';
import { hashPassword } from './password.js';
import { UsersRepository } from './users.repository.js';

/** Règles métier de l'authentification. Ne connaît ni HTTP ni SQL (ADR-002). */
@Injectable()
export class AuthService {
  constructor(users) {
    this.users = users;
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
}

Inject(UsersRepository)(AuthService, undefined, 0);
