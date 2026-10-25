import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/http/jwt-auth.guard.js';
import { ReservationsService } from '../core/reservations.service.js';

@Controller('me/reservations')
export class MyReservationsController {
  constructor(reservations) {
    this.reservations = reservations;
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(req) {
    return this.reservations.listMine(req.user.userId);
  }
}

Inject(ReservationsService)(MyReservationsController, undefined, 0);
Req()(MyReservationsController.prototype, 'list', 0);
