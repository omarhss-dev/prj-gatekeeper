import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/http/jwt-auth.guard.js';
import { ReservationsService } from '../core/reservations.service.js';
import { createReservationSchema } from './reservations.schemas.js';

@Controller('reservations')
export class ReservationsController {
  constructor(reservations) {
    this.reservations = reservations;
  }

  /**
   * Tout compte connecté peut réserver, organisateur compris : pas de
   * RolesGuard, réserver n'est pas une action réservée à un rôle.
   * L'acheteur vient du token (req.user), jamais du corps.
   * 201, le défaut de Nest pour un POST : une réservation est créée.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  create(req, body) {
    return this.reservations.reserve(req.user.userId, body);
  }
}

Inject(ReservationsService)(ReservationsController, undefined, 0);
// Équivalents de @Req() et @Body(pipe) : Babel ne lit pas les décorateurs de
// paramètre (ADR-025).
Req()(ReservationsController.prototype, 'create', 0);
Body(new ZodValidationPipe(createReservationSchema))(
  ReservationsController.prototype,
  'create',
  1,
);
