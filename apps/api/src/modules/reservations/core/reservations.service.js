import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error.js';
import { NotFoundError } from '../../../common/errors/not-found-error.js';
import { ReservationsRepository } from './reservations.repository.js';

/** Règles métier des réservations. Ne connaît ni HTTP ni SQL (ADR-002). */
@Injectable()
export class ReservationsService {
  constructor(reservations) {
    this.reservations = reservations;
  }

  /**
   * Étape 1, hors transaction : l'événement permet-il cette réservation ?
   * Sûr parce qu'un événement publié ne change plus (PATCH ne touche que les
   * brouillons, aucune route n'annule). À revoir le jour où l'annulation d'un
   * événement existera.
   *
   * Étape 2, dans une transaction (repository) : la réservation et ses
   * billets, ou rien.
   */
  async reserve(userId, { eventId, seatIds }) {
    const event = await this.reservations.findEventForReservation(eventId);
    const refusal = reservationRefusal(event, seatIds.length, new Date());
    if (refusal) throw refusal;

    const result = await this.reservations.reserve(userId, eventId, seatIds);
    if (result.unavailableSeatIds) {
      throw new DomainError(
        'SEAT_UNAVAILABLE',
        `Sièges indisponibles : ${result.unavailableSeatIds.length} sur ${seatIds.length}.`,
        { seatIds: result.unavailableSeatIds },
      );
    }
    return result.reservation;
  }

  listMine(userId) {
    return this.reservations.findByUser(userId);
  }

  /**
   * Annule la réservation de cet acheteur. Ne renvoie rien : le controller
   * répond 204. Si rien n'a été annulé, la relecture choisit la réponse,
   * sans jamais rien défaire : l'UPDATE a déjà tranché.
   */
  async cancel(reservationId, userId) {
    if (await this.reservations.cancel(reservationId, userId)) return;
    const refusal = cancellationRefusal(
      await this.reservations.findForCancellation(reservationId),
      userId,
    );
    if (refusal) throw refusal;
  }
}

/**
 * Pourquoi cet événement refuse la réservation, ou null s'il l'accepte.
 * Fonction pure, testée sans base : même séparation que draftRefusal.
 *
 * L'ordre compte : on ne parle de l'ouverture des ventes ou du nombre de
 * sièges que d'un événement qu'on peut réserver un jour.
 *
 * @param now Passé en paramètre pour que les tests fixent l'instant.
 */
export function reservationRefusal(event, seatCount, now) {
  // Règle de visibilité (ADR-031) : un brouillon n'existe pas pour le public.
  if (!event || event.status === 'draft') return new NotFoundError();

  if (event.status !== 'published' || event.startsAt <= now) {
    return new DomainError(
      'EVENT_NOT_AVAILABLE',
      "Cet événement n'est plus disponible à la réservation.",
    );
  }

  if (event.salesOpenAt > now) {
    return new DomainError(
      'SALES_NOT_OPEN',
      "La vente n'est pas encore ouverte.",
      { salesOpenAt: event.salesOpenAt },
    );
  }

  if (seatCount > event.maxSeatsPerReservation) {
    return new DomainError(
      'MAX_SEATS_EXCEEDED',
      `Au plus ${event.maxSeatsPerReservation} sièges par réservation.`,
    );
  }

  return null;
}

export function cancellationRefusal(reservation, userId) {
  if (!reservation || reservation.userId !== userId) return new NotFoundError();

  // Déjà annulée : DELETE est idempotent. Un client qui réessaie après un
  // timeout ne doit pas croire que son annulation a échoué (D5-a).
  if (reservation.status === 'cancelled') return null;

  return new DomainError(
    'RESERVATION_NOT_CANCELLABLE',
    "l'evenement a deja commence : la reservation me peux plus etre annulee.",
  );
}

Inject(ReservationsRepository)(ReservationsService, undefined, 0);
