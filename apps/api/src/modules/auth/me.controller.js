import {
  Controller,
  Get,
  Inject,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/** Ressources de l'utilisateur connecté : /api/v1/me. */
@Controller('me')
export class MeController {
  constructor(auth) {
    this.auth = auth;
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async me(req) {
    const user = await this.auth.getProfile(req.user.userId);
    // Token valide, mais compte supprimé depuis son émission (jusqu'à 60 min) :
    // l'identité du token ne désigne plus personne.
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

Inject(AuthService)(MeController, undefined, 0);
// Équivalent de @Req() sur le paramètre 0 : Babel ne lit pas les décorateurs
// de paramètre (ADR-025).
Req()(MeController.prototype, 'me', 0);
