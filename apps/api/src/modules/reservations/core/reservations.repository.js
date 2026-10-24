import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../../../database/database.tokens.js';
import { withTransaction } from '../../../database/transaction.js';

/**
 * Erreur privée au module : elle ne sert qu'à déclencher le ROLLBACK de
 * withTransaction, qui n'annule que sur une exception. Elle est rattrapée
 * dans ce fichier et ne sort jamais du repository (choix D1-b).
 */
class SeatsUnavailable extends Error {
  name = 'SeatsUnavailable';

  constructor(seatIds) {
    super('Sièges indisponibles');
    this.seatIds = seatIds;
  }
}

/** Seul endroit du module où reservations et tickets sont écrits. */
@Injectable()
export class ReservationsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Ce que le service doit savoir d'un événement avant de réserver.
   * null s'il n'existe pas.
   *
   * Lu ici plutôt que par EventsRepository : quatre colonnes ne justifient pas
   * une dépendance de ReservationsModule envers EventsModule (option B).
   */
  async findEventForReservation(eventId) {
    const { rows } = await this.pool.query(
      `SELECT status, starts_at, sales_open_at, max_seats_per_reservation
       FROM events
       WHERE id = $1`,
      [eventId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      status: row.status,
      startsAt: row.starts_at,
      salesOpenAt: row.sales_open_at,
      maxSeatsPerReservation: row.max_seats_per_reservation,
    };
  }

  /**
   * Crée la réservation et un billet par siège, ou rien.
   *
   * Renvoie { reservation } en cas de succès, ou { unavailableSeatIds } si au
   * moins un siège n'a pas pu être pris : déjà pris, inexistant, ou d'un autre
   * événement. Le repository rapporte le fait, le service choisit le refus.
   */
  async reserve(userId, eventId, seatIds) {
    try {
      return await withTransaction(this.pool, async (client) => {
        // Le total est calculé par la base, à partir des sièges de CET
        // événement. sum() sans GROUP BY renvoie toujours une ligne, NULL si
        // aucun siège ne correspond, d'où le COALESCE. Si un siège est filtré,
        // le total est faux, mais il manquera aussi un billet : tout sera
        // annulé plus bas.
        const { rows: reservationRows } = await client.query(
          `INSERT INTO reservations (user_id, event_id, total_cents)
           SELECT $1, $2, COALESCE(sum(sec.price_cents), 0)
           FROM event_seats s
           JOIN event_sections sec ON sec.id = s.section_id
           WHERE s.id = ANY($3::uuid[]) AND s.event_id = $2
           RETURNING id, event_id, status, total_cents, created_at`,
          [userId, eventId, seatIds],
        );
        const reservation = reservationRows[0];

        // L'invariant du projet (ADR-003) :
        // - s.event_id = $3 : un siège d'un autre événement n'est jamais
        //   inséré (ADR-024) ;
        // - ORDER BY s.id : toutes les transactions prennent les sièges dans
        //   le même ordre, aucun deadlock possible ;
        // - ON CONFLICT avec cible : seul un conflit sur le siège actif est
        //   ignoré. Toute autre violation (uq_tickets_code) remonte en 500.
        //   On ne peut pas écrire ON CONSTRAINT : uq_tickets_active_seat est
        //   un index unique partiel, pas une contrainte.
        // - code aléatoire : il ne dépend ni du siège ni de l'événement, il
        //   ne peut ni entrer en collision ni être deviné.
        const { rows: ticketRows } = await client.query(
          `INSERT INTO tickets (reservation_id, event_seat_id, code, price_cents)
           SELECT $1, s.id, gen_random_uuid()::text, sec.price_cents
           FROM event_seats s
           JOIN event_sections sec ON sec.id = s.section_id
           WHERE s.id = ANY($2::uuid[]) AND s.event_id = $3
           ORDER BY s.id
           ON CONFLICT (event_seat_id) WHERE status = 'active' DO NOTHING
           RETURNING event_seat_id, code, price_cents`,
          [reservation.id, seatIds, eventId],
        );

        // Tout ou rien : donner 2 places à qui en demandait 3 est un bug.
        if (ticketRows.length < seatIds.length) {
          const inserted = new Set(ticketRows.map((row) => row.event_seat_id));
          throw new SeatsUnavailable(seatIds.filter((id) => !inserted.has(id)));
        }

        return { reservation: toReservation(reservation, ticketRows) };
      });
    } catch (error) {
      // withTransaction a déjà fait le ROLLBACK et rendu la connexion.
      if (error instanceof SeatsUnavailable) {
        return { unavailableSeatIds: error.seatIds };
      }
      throw error;
    }
  }

  /**
   * Annule la réservation et libère ses sièges, ou ne fait rien.
   * Renvoie true si elle a été annulée, false sinon : inexistante, d'un autre
   * acheteur, déjà annulée, ou événement commencé. Le service relit pour
   * savoir laquelle (findForCancellation).
   *
   * Même principe que publishDraft (ADR-032) : aucune lecture avant
   * l'écriture, toutes les règles sont dans le WHERE. Un DELETE concurrent
   * attend le verrou de ligne, puis réévalue son WHERE et ne modifie rien.
   * « Pas encore commencé » est jugé avec now() : une seule horloge, celle de
   * la base.
   *
   * Les billets passent en cancelled dans la même transaction : ils sortent
   * de l'index partiel uq_tickets_active_seat, et les sièges redeviennent
   * réservables au COMMIT. Rien n'est supprimé : l'historique reste.
   */
  async cancel(reservationId, userId) {
    return withTransaction(this.pool, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE reservations r
         SET status = 'cancelled', cancelled_at = now()
         FROM events e
         WHERE r.id = $1 AND r.user_id = $2 AND r.status = 'confirmed'
           AND e.id = r.event_id AND e.starts_at > now()`,
        [reservationId, userId],
      );
      if (rowCount === 0) return false;

      await client.query(
        `UPDATE tickets SET status = 'cancelled'
        WHERE reservation_id = $1 AND status = 'active'`,
        [reservationId],
      );
      return true;
    });
  }

  /**
   * Relecture de suivi, quand cancel n'a rien modifié : à qui est la
   * réservation, et dans quel état. null si elle n'existe pas.
   */
  async findForCancellation(reservationId) {
    const { rows } = await this.pool.query(
      `SELECT user_id, status FROM  reservations WHERE id = $1`,
      [reservationId],
    );
    const row = rows[0];
    return row ? { userId: row.user_id, status: row.status } : null;
  }
}

/** Ligne SQL (snake_case) → objet de l'app (camelCase). */
function toReservation(row, ticketRows) {
  return {
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    tickets: ticketRows.map((ticket) => ({
      seatId: ticket.event_seat_id,
      code: ticket.code,
      priceCents: ticket.price_cents,
    })),
  };
}

Inject(PG_POOL)(ReservationsRepository, undefined, 0);
