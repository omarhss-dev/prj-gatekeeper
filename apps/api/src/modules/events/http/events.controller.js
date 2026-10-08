import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/http/jwt-auth.guard.js';
import { Roles } from '../../auth/http/roles.decorator.js';
import { RolesGuard } from '../../auth/http/roles.guard.js';
import { EventsService } from '../core/events.service.js';
import { createEventSchema } from './events.schemas.js';

@Controller('events')
export class EventsController {
  constructor(events) {
    this.events = events;
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
}

Inject(EventsService)(EventsController, undefined, 0);

Req()(EventsController.prototype, 'create', 0);
Body(new ZodValidationPipe(createEventSchema))(
  EventsController.prototype,
  'create',
  1,
);
