import { Module } from '@nestjs/common';
import { EventsRepository } from './core/events.repository.js';
import { EventsService } from './core/events.service.js';
import { EventsController } from './http/events.controller.js';

/**
 * Reçoit l'instance d'AuthModule créée par AppModule, au lieu d'appeler
 * AuthModule.forRoot(config) une seconde fois.
 *
 * Nest identifie un module dynamique par la référence de l'objet, pas par
 * son contenu (mesuré sur NestJS 12) : un second forRoot créerait un second
 * AuthModule, donc un second TokenService, et enregistrerait les routes
 * /auth/* deux fois. Importer la classe AuthModule nue échoue au démarrage :
 * elle n'a ni provider ni export.
 *
 * Seul TokenService est nécessaire ici : JwtAuthGuard en dépend, et Nest
 * résout les dépendances d'un guard dans le module qui l'utilise.
 * RolesGuard ne dépend que de Reflector, fourni partout par Nest.
 */
@Module({})
export class EventsModule {
  static forRoot(authModule) {
    return {
      module: EventsModule,
      imports: [authModule],
      controllers: [EventsController],
      providers: [EventsService, EventsRepository],
    };
  }
}
