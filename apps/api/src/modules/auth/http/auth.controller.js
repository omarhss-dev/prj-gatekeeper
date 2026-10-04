import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { registerSchema, loginSchema } from './auth.schemas.js';
import { AuthService } from '../core/auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(auth) {
    this.auth = auth;
  }

  @Post('register')
  register(body) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(body) {
    const result = await this.auth.login(body);
    // Le service répond « refusé » ; c'est la couche HTTP qui en fait un 401,
    // comme /health/ready fait un 503 d'un `false`.
    if (!result) throw new UnauthorizedException();
    return result;
  }
}
Inject(AuthService)(AuthController, undefined, 0);
// Équivalent de @Body(new ZodValidationPipe(registerSchema)) sur le paramètre 0.
Body(new ZodValidationPipe(registerSchema))(
  AuthController.prototype,
  'register',
  0,
);

Body(new ZodValidationPipe(loginSchema))(AuthController.prototype, 'login', 0);
