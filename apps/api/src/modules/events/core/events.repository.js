import { Inject, Injectable } from '@nestjs/common';
import { PG_POOL } from '../../../database/database.tokens.js';
import { withTransaction } from '../../../database/transaction.js';

/** Colonnes renvoyées pour un événement : listées, jamais SELECT *. */
const EVENT_COLUMNS = `id, organizer_id, name, description, city, venue, status,
  starts_at, sales_open_at, max_seats_per_reservation, published_at,
  created_at, updated_at`;

/** Colonnes de la vue publique d'un événement (toPublicEvent). */
const PUBLIC_EVENT_COLUMNS = `id, name, description, city, venue,
  starts_at, sales_open_at, max_seats_per_reservation`;

/** Colonnes d'une ligne du catalogue (toSummary). */
const SUMMARY_COLUMNS = 'id, name, city, venue, starts_at, sales_open_at';

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

  /**
   * Publie un brouillon et matérialise ses sièges, ou rien.
   * Renvoie l'événement publié et le nombre de sièges, ou null si aucune ligne
   * n'a été modifiée : événement inexistant, d'un autre organisateur, ou déjà
   * publié. Le service lit ensuite l'événement pour savoir lequel.
   *
   * Pas de lecture préalable du statut : c'est le WHERE de l'UPDATE qui
   * décide. Une publication concurrente attend le verrou de ligne posé ici,
   * puis réévalue son WHERE sur la ligne commitée (READ COMMITTED), trouve
   * status = 'published' et ne modifie rien. Aucune course possible.
   */
  async publishDraft(eventId, organizerId) {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE events
         SET status = 'published', published_at = now()
         WHERE id = $1 AND organizer_id = $2 AND status = 'draft'
         RETURNING ${EVENT_COLUMNS}`,
        [eventId, organizerId],
      );
      if (!rows[0]) return null;

      // Tous les sièges en UNE instruction : une ligne par (section, rangée,
      // siège). chr(64 + 1) = 'A' : la borne de 26 rangées (ck_sections_rows)
      // garantit des lettres de A à Z. Libellés uniques par section
      // (uq_seats_section_label) : A-1 existe dans chaque section.
      const { rowCount } = await client.query(
        `INSERT INTO event_seats (event_id, section_id, seat_label)
         SELECT s.event_id, s.id, chr(64 + r) || '-' || n
         FROM event_sections s
         CROSS JOIN LATERAL generate_series(1, s.rows_count) AS r
         CROSS JOIN LATERAL generate_series(1, s.seats_per_row) AS n
         WHERE s.event_id = $1`,
        [eventId],
      );

      // Un événement publié sans siège violerait un invariant que la base ne
      // vérifie pas. Impossible par l'API (au moins une section, garantie par
      // le schéma de création) : si c'arrive, c'est un bug, donc ROLLBACK.
      if (rowCount === 0) {
        throw new Error(`Publication sans aucun siège : événement ${eventId}`);
      }

      return { ...toEvent(rows[0]), seatCount: rowCount };
    });
  }

  /** Un événement quel que soit son statut, sans ses sections. null s'il n'existe pas. */
  async findById(eventId) {
    const { rows } = await this.pool.query(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
      [eventId],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  /**
   * Un événement PUBLIÉ et ses sections, pour la lecture publique.
   * null pour un brouillon comme pour un id inconnu : un brouillon n'existe
   * pas pour le public (US-2).
   *
   * Deux requêtes, toujours deux quel que soit le nombre de sections : ce
   * n'est pas un N+1. Sans transaction : les sections ne changent plus après
   * la création, il n'y a rien d'incohérent à lire entre les deux.
   */
  async findPublishedById(eventId) {
    const { rows } = await this.pool.query(
      `SELECT ${PUBLIC_EVENT_COLUMNS} FROM events
       WHERE id = $1 AND status = 'published'`,
      [eventId],
    );
    if (!rows[0]) return null;

    // Aucune colonne ne garde l'ordre de création des sections : on choisit
    // un ordre stable et utile, de la plus chère à la moins chère.
    const { rows: sectionRows } = await this.pool.query(
      `SELECT id, name, price_cents, rows_count, seats_per_row
       FROM event_sections
       WHERE event_id = $1
       ORDER BY price_cents DESC, name`,
      [eventId],
    );
    return { ...toPublicEvent(rows[0]), sections: sectionRows.map(toSection) };
  }

  /**
   * Une page du catalogue : événements publiés, à venir, triés par date.
   *
   * Filtres facultatifs en `($n IS NULL OR …)` : un seul texte SQL, sans
   * concaténation. pg envoie une requête préparée sans nom, planifiée avec les
   * valeurs réelles : Postgres élimine les conditions dont le paramètre est
   * NULL (vérifié : Index Scan sur idx_events_catalogue).
   *
   * ORDER BY starts_at, id : sans le tie-breaker, deux événements à la même
   * heure pourraient changer d'ordre d'une page à l'autre, et l'un d'eux
   * apparaître deux fois ou jamais.
   *
   * Ville : sans tenir compte de la casse (lower des deux côtés). Les accents
   * restent distincts (« Fès » ≠ « Fes ») : unaccent est une extension, à
   * justifier et à autoriser sur Azure.
   */
  async findCatalogue({ city, from, to, limit, offset }) {
    const { rows } = await this.pool.query(
      `SELECT ${SUMMARY_COLUMNS}
       FROM events
       WHERE status = 'published'
         AND starts_at > now()
         AND ($1::text IS NULL OR lower(city) = lower($1))
         AND ($2::timestamptz IS NULL OR starts_at >= $2)
         AND ($3::timestamptz IS NULL OR starts_at < $3)
       ORDER BY starts_at, id
       LIMIT $4 OFFSET $5`,
      [city ?? null, from ?? null, to ?? null, limit, offset],
    );
    return rows.map(toSummary);
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

/**
 * Vue publique d'un événement : ni organisateur, ni statut (toujours
 * « published » ici), ni horodatages internes.
 */
function toPublicEvent(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    city: row.city,
    venue: row.venue,
    startsAt: row.starts_at,
    salesOpenAt: row.sales_open_at,
    maxSeatsPerReservation: row.max_seats_per_reservation,
  };
}

/** Une ligne du catalogue : ce qu'une liste affiche, sans description. */
function toSummary(row) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    venue: row.venue,
    startsAt: row.starts_at,
    salesOpenAt: row.sales_open_at,
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
