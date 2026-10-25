import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/http/jwt-auth.guard.js';
import { Roles } from '../../auth/http/roles.decorator.js';
import { RolesGuard } from '../../auth/http/roles.guard.js';
import { EventsService } from '../core/events.service.js';
import {
  catalogueQuerySchema,
  createEventSchema,
  updateEventSchema,
} from './events.schemas.js';

/**
 * Un :id qui n'est pas un UUID ne désigne aucun événement : 404, comme un
 * UUID inconnu. Sans ce pipe, Postgres lèverait 22P02 (syntaxe uuid
 * invalide), soit un 500 pour une simple faute de frappe dans l'URL.
 */
const eventIdPipe = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('events')
export class EventsController {
  constructor(events) {
    this.events = events;
  }

  /**
   * Catalogue public : aucun guard. Un brouillon n'y apparaît jamais (US-2),
   * c'est le WHERE de la requête qui le garantit.
   */
  @Get()
  list(query) {
    return this.events.listCatalogue(query);
  }

  /** Détail public d'un événement publié. Un brouillon répond 404. */
  @Get(':id')
  findOne(id) {
    return this.events.getPublished(id);
  }

  /**
   * Plan de salle public : chaque siège et sa disponibilité, sans dire qui
   * détient un billet (US-4). Jamais mis en cache : c'est la donnée qui
   * change le plus vite. Un brouillon répond 404.
   */
  @Get(':id/seats')
  findSeats(id) {
    return this.events.getSeatMap(id);
  }

  /**
   * Guards avant pipes, dans le cycle de vie Nest : un anonyme reçoit 401 et
   * un client 403 sans que leur corps soit jamais validé.
   * L'organisateur vient du token (req.user), jamais du corps.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(['organizer'])
  create(req, body) {
    return this.events.create(req.user.userId, body);
  }

  /**
   * Modifie un brouillon de l'organisateur. Les sections ne se modifient pas,
   * et un événement publié non plus (409) : c'est un engagement envers les
   * acheteurs.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(['organizer'])
  update(req, id, body) {
    return this.events.update(id, body, req.user.userId);
  }

  /**
   * 200 et non 201 (défaut de Nest pour un POST) : la publication ne crée pas
   * de ressource adressable, elle change l'état d'une ressource existante.
   */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(['organizer'])
  publish(req, id) {
    return this.events.publish(id, req.user.userId);
  }
}

Inject(EventsService)(EventsController, undefined, 0);
// Équivalents de @Req(), @Body(pipe), @Query(pipe) et @Param('id', pipe) : Babel ne lit
// pas les décorateurs de paramètre (ADR-025).
Req()(EventsController.prototype, 'create', 0);
Body(new ZodValidationPipe(createEventSchema))(
  EventsController.prototype,
  'create',
  1,
);
Req()(EventsController.prototype, 'publish', 0);
Query(new ZodValidationPipe(catalogueQuerySchema))(
  EventsController.prototype,
  'list',
  0,
);
Param('id', eventIdPipe)(EventsController.prototype, 'findOne', 0);
Param('id', eventIdPipe)(EventsController.prototype, 'publish', 1);
Req()(EventsController.prototype, 'update', 0);
Param('id', eventIdPipe)(EventsController.prototype, 'update', 1);
Param('id', eventIdPipe)(EventsController.prototype, 'findSeats', 0);
Body(new ZodValidationPipe(updateEventSchema))(
  EventsController.prototype,
  'update',
  2,
);
