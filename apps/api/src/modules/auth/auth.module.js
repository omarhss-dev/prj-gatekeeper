import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService, MeController } from './auth.service.js';
import { TokenService } from './token.service.js';
import { UsersRepository } from './users.repository.js';

@Module({})
export class AuthModule {
  /**
   * Module dynamique, comme DatabaseModule : TokenService a besoin de
   * JWT_SECRET, qui n'existe qu'après loadConfig, donc pas à l'import.
   */
  static forRoot(config) {
    return {
      module: AuthModule,
      controllers: [AuthController, MeController],
      providers: [
        AuthService,
        UsersRepository,
        {
          provide: TokenService,
          useFactory: () =>
            new TokenService({
              secret: config.JWT_SECRET,
              ttlSeconds: config.JWT_TTL_SECONDS,
            }),
        },
      ],
    };
  }
}
