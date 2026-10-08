import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../../../database/database.tokens.js';
import { withTransaction } from '../../../database/transaction.js';

/** Colonnes renvoyées pour un événement : listées, jamais SELECT *. */
const EVENT_COLUMNS = `id, organizer_id, name, description, city, venue, status,
  starts_at, sales_open_at, max_seats_per_reservation, published_at,
  created_at, updated_at`;

/** Seul endroit du module où events et event_sections sont lus ou écrits. */
@Injectable()
export class EventsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Crée un événement en brouillon et ses sections, ou rien.
   * Deux instructions, donc une transaction : sans elle, une section refusée
   * (nom en double, CHECK) laisserait un événement sans section en base.
   *
   * @param organizerId Vient du token, jamais du corps de la requête.
   * @param event Le corps validé par createEventSchema (dates en Date).
   */
  async createWithSections(organizerId, event) {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO events (organizer_id, name, description, city, venue,
                             starts_at, sales_open_at, max_seats_per_reservation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${EVENT_COLUMNS}`,
        [
          organizerId,
          event.name,
          event.description ?? null,
          event.city,
          event.venue,
          event.startsAt,
          event.salesOpenAt,
          event.maxSeatsPerReservation,
        ],
      );
      const created = rows[0];

      // Toutes les sections en UNE instruction : unnest déplie des tableaux
      // parallèles en lignes. Le texte SQL est fixe quel que soit le nombre de
      // sections, et chaque valeur reste un paramètre.
      const { rows: sectionRows } = await client.query(
        `INSERT INTO event_sections (event_id, name, price_cents, rows_count, seats_per_row)
         SELECT $1, s.name, s.price_cents, s.rows_count, s.seats_per_row
         FROM unnest($2::text[], $3::integer[], $4::smallint[], $5::smallint[])
              AS s(name, price_cents, rows_count, seats_per_row)
         RETURNING id, name, price_cents, rows_count, seats_per_row`,
        [
          created.id,
          event.sections.map((section) => section.name),
          event.sections.map((section) => section.priceCents),
          event.sections.map((section) => section.rowsCount),
          event.sections.map((section) => section.seatsPerRow),
        ],
      );

      // RETURNING ne garantit aucun ordre. On rend les sections dans l'ordre
      // de la requête, en s'appuyant sur l'unicité du nom (uq_sections_event_name).
      const byName = new Map(sectionRows.map((row) => [row.name, row]));
      const sections = event.sections.map((section) =>
        toSection(byName.get(section.name)),
      );

      return { ...toEvent(created), sections };
    });
  }
}

/** Ligne SQL (snake_case) → objet de l'app (camelCase). */
function toEvent(row) {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    description: row.description,
    city: row.city,
    venue: row.venue,
    status: row.status,
    startsAt: row.starts_at,
    salesOpenAt: row.sales_open_at,
    maxSeatsPerReservation: row.max_seats_per_reservation,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSection(row) {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    rowsCount: row.rows_count,
    seatsPerRow: row.seats_per_row,
  };
}

Inject(PG_POOL)(EventsRepository, undefined, 0);
