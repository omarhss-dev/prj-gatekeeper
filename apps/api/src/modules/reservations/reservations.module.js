import { Module } from '@nestjs/common';
import { ReservationsRepository } from './core/reservations.repository.js';
import { ReservationsService } from './core/reservations.service.js';
import { ReservationsController } from './http/reservations.controller.js';

/**
 * Reçoit l'instance d'AuthModule créée par AppModule, comme EventsModule
 * (ADR-033) : JwtAuthGuard dépend de TokenService, qu'AuthModule exporte.
 * Aucune dépendance envers EventsModule : l'événement est lu par
 * ReservationsRepository.
 */
@Module({})
export class ReservationsModule {
  static forRoot(authModule) {
    return {
      module: ReservationsModule,
      imports: [authModule],
      controllers: [ReservationsController],
      providers: [ReservationsService, ReservationsRepository],
    };
  }
}
