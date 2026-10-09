import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error.js';
import { ForbiddenError } from '../../../common/errors/forbidden-error.js';
import { NotFoundError } from '../../../common/errors/not-found-error.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(events) {
    this.events = events;
  }
  create(organizerId, input) {
    return this.events.createWithSections(organizerId, input);
  }

  async publish(eventId, userId) {
    const published = await this.events.publishDraft(eventId, userId);
    if (published) return published;

    // Lecture de suivi : elle ne sert qu'à choisir le refus. L'UPDATE a déjà
    // tranché, et rien de ce qu'elle lit ne peut le défaire.
    throw publishRefusal(await this.events.findById(eventId), userId);
  }
}

export function publishRefusal(event, userId) {
  if (!event) return new NotFoundError();

  if (event.organizerId !== userId) {
    return event.status === 'draft'
      ? new NotFoundError()
      : new ForbiddenError();
  }

  if (event.status === 'published') {
    return new DomainError(
      'EVENT_ALREADY_PUBLISHED',
      'Cet événement est déjà publié.',
    );
  }

  //  Reste : un événement annulé. Aucune route ne l'annule aujourd'hui, mais
  // le statut existe en base, et « déjà publié » serait faux.
  return new DomainError(
    'EVENT_NOT_AVAILABLE',
    "Cet événement n'est plus disponible.",
  );
}

Inject(EventsRepository)(EventsService, undefined, 0);
