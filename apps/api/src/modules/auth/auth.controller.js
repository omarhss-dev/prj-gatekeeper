import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { registerSchema } from './auth.schemas.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(auth) {
    this.auth = auth;
  }

  @Post('register')
  register(body) {
    return this.auth.register(body);
  }
}

Inject(AuthService)(AuthController, undefined, 0);
// Équivalent de @Body(new ZodValidationPipe(registerSchema)) sur le paramètre 0.
Body(new ZodValidationPipe(registerSchema))(
  AuthController.prototype,
  'register',
  0,
);
