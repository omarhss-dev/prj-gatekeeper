import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error.js';
import { ForbiddenError } from '../../../common/errors/forbidden-error.js';
import { NotFoundError } from '../../../common/errors/not-found-error.js';
import { EventsRepository } from './events.repository.js';

/** Règles métier des événements. Ne connaît ni HTTP ni SQL (ADR-002). */
@Injectable()
export class EventsService {
  constructor(events) {
    this.events = events;
  }

  /**
   * Une simple délégation : la création n'a aucune règle que le schéma Zod et
   * la base ne portent pas déjà.
   */
  create(organizerId, input) {
    return this.events.createWithSections(organizerId, input);
  }

  /**
   * Publie l'événement si c'est un brouillon de cet organisateur. Sinon, lève
   * le refus qui correspond à ce que l'appelant a le droit de savoir.
   */
  async publish(eventId, userId) {
    const published = await this.events.publishDraft(eventId, userId);
    if (published) return published;

    // Lecture de suivi : elle ne sert qu'à choisir le refus. L'UPDATE a déjà
    // tranché, et rien de ce qu'elle lit ne peut le défaire.
    throw draftRefusal(await this.events.findById(eventId), userId);
  }

  /**
   * Modifie l'événement si c'est un brouillon de cet organisateur. Mêmes
   * refus que la publication : les deux sont des écritures sur un brouillon.
   */
  async update(eventId, input, userId) {
    const updated = await this.events.updateDraft(eventId, userId, input);
    if (updated) return updated;
    throw draftRefusal(await this.events.findById(eventId), userId);
  }

  /** Un événement publié et ses sections. 404 pour tout le reste. */
  async getPublished(eventId) {
    const event = await this.events.findPublishedById(eventId);
    if (!event) throw new NotFoundError();
    return event;
  }

  /**
   * Une page du catalogue, avec hasNext plutôt qu'un total.
   *
   * On demande limit + 1 lignes : la ligne en trop dit s'il existe une page
   * suivante, puis elle est retirée. Un total exigerait un COUNT(*) sur tous
   * les événements correspondants, à chaque page, quand l'index permet
   * justement de s'arrêter après limit + 1 lignes.
   * Prix : le client sait s'il y a une suite, pas combien de pages.
   */
  async listCatalogue({ page, limit, city, from, to }) {
    const rows = await this.events.findCatalogue({
      city,
      from,
      to,
      limit: limit + 1,
      offset: (page - 1) * limit,
    });
    return {
      items: rows.slice(0, limit),
      page,
      limit,
      hasNext: rows.length > limit,
    };
  }

  /** Le plan de salle d'un événement publié. 404 pour tout le reste. */
  async getSeatMap(eventId) {
    const seatMap = await this.events.findSeatMap(eventId);
    if (!seatMap) throw new NotFoundError();
    return seatMap;
  }
}

/**
 * Pourquoi une écriture sur un brouillon (publication, modification) n'a rien
 * modifié. Fonction pure, testable sans base : même séparation que toProblem
 * et loadConfig.
 *
 * Règle de visibilité : ce qui est invisible pour l'appelant répond 404, même
 * s'il existe. Un 403 sur le brouillon d'un autre révélerait son existence,
 * que GET /events/:id cache.
 */
export function draftRefusal(event, userId) {
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

  // Reste : un événement annulé. Aucune route ne l'annule aujourd'hui, mais
  // le statut existe en base, et « déjà publié » serait faux.
  return new DomainError(
    'EVENT_NOT_AVAILABLE',
    "Cet événement n'est plus disponible.",
  );
}

Inject(EventsRepository)(EventsService, undefined, 0);
