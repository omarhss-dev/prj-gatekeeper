import { z } from 'zod';

/**
 * Corps de POST /api/v1/events.
 *
 * Règle du projet : un Zod plus laxiste que la base transforme une saisie
 * invalide en 500 (une contrainte violée est un bug, pas une erreur du client).
 * Chaque borne ci-dessous est donc alignée sur une contrainte de la migration
 * create-events, ou déclarée comme règle de l'app seule.
 */

/**
 * Date ISO 8601 AVEC fuseau (Z ou ±hh:mm), convertie en Date.
 * Sans fuseau, « 2026-12-01T20:00:00 » serait interprété dans le fuseau du
 * serveur Postgres : la même saisie donnerait deux instants selon la machine.
 * Convertie en Date pour comparer des instants, pas des chaînes : en texte,
 * '…20:00:00+01:00' > '…19:30:00Z' alors que c'est le même instant moins 30 min.
 */
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const sectionSchema = z.object({
  // ck_sections_name_not_blank. max(100) : règle de l'app seule.
  name: z.string().trim().min(1).max(100),
  // ck_sections_price (>= 0). max : borne du type integer. Au-delà, Postgres
  // lève 22003 (hors limites), soit un 500.
  priceCents: z.int().min(0).max(2_147_483_647),
  // ck_sections_rows : 26 rangées, de A à Z (le libellé du siège en dépend).
  rowsCount: z.int().min(1).max(26),
  // ck_sections_seats.
  seatsPerRow: z.int().min(1).max(60),
});

/**
 * Champs d'un événement, définis une fois pour la création et la
 * modification : une borne changée ici vaut pour les deux.
 * Un objet de schémas, pas un z.object : la création leur ajoute un défaut et
 * les sections, la modification les rend tous facultatifs.
 */
const eventFields = {
  // ck_events_name_not_blank. max(200) : règle de l'app seule.
  name: z.string().trim().min(1).max(200),
  // Facultative. Une chaîne vide est refusée plutôt que convertie en NULL :
  // aucune transformation cachée.
  description: z.string().trim().min(1).max(2000),
  // Pas de CHECK « non vide » en base sur city et venue : règle de l'app seule.
  city: z.string().trim().min(1).max(100),
  venue: z.string().trim().min(1).max(200),
  // « Dans le futur » est une règle de l'app, jamais un CHECK : la base
  // rejetterait les événements passés à la restauration d'une sauvegarde.
  startsAt: instant.refine((date) => date.getTime() > Date.now()),
  salesOpenAt: instant,
  // ck_events_max_seats.
  maxSeatsPerReservation: z.int().min(1).max(10),
};

/**
 * ck_events_sales_before_start, vérifiée ici pour répondre 422, pas 500.
 * Zod 4 exécute ce refine même si une date a échoué sur son FORMAT (seule
 * une erreur de TYPE l'en empêche) : il recevrait alors la chaîne brute, et
 * Date <= chaîne vaut false, d'où une seconde erreur fausse sur salesOpenAt.
 * On ne compare donc que deux instants ; sinon l'erreur est déjà signalée,
 * ou la date est absente (modification partielle).
 */
const salesBeforeStart = ({ salesOpenAt, startsAt }) =>
  !(salesOpenAt instanceof Date && startsAt instanceof Date) ||
  salesOpenAt <= startsAt;

export const createEventSchema = z
  .object({
    ...eventFields,
    description: eventFields.description.optional(),
    // Le défaut 4 existe aussi en base (DEFAULT 4) : écrit ici pour que
    // l'INSERT liste toujours ses colonnes.
    maxSeatsPerReservation: eventFields.maxSeatsPerReservation.default(4),
    // 1 minimum : un événement sans section se publierait avec zéro siège.
    // 20 maximum : borne le coût de la publication (20 × 26 × 60 = 31 200 sièges).
    // Noms uniques : uq_sections_event_name lèverait 23505, donc un 500.
    sections: z
      .array(sectionSchema)
      .min(1)
      .max(20)
      .refine(
        (sections) =>
          new Set(sections.map((section) => section.name)).size ===
          sections.length,
      ),
  })
  .refine(salesBeforeStart, { path: ['salesOpenAt'] });

/**
 * Corps de PATCH /api/v1/events/:id : tous les champs facultatifs, aucun
 * défaut (un champ absent ne change pas). Les sections ne se modifient pas.
 */
export const updateEventSchema = z
  .object(eventFields)
  .partial()
  // Un corps vide ne modifierait rien. C'est aussi le cas d'un corps qui ne
  // contient que des clés retirées par Zod ({ "status": "published" }) : sans
  // ce refus, il recevrait un 200 qui laisserait croire au succès.
  .refine((patch) => Object.keys(patch).length > 0)
  // Les deux dates se modifient ensemble. Avec une seule, Zod ne pourrait pas
  // la comparer à l'autre, restée en base : ck_events_sales_before_start
  // trancherait, et ce serait un 500.
  .superRefine(({ startsAt, salesOpenAt }, ctx) => {
    if ((startsAt === undefined) !== (salesOpenAt === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [startsAt === undefined ? 'startsAt' : 'salesOpenAt'],
        message: 'startsAt et salesOpenAt se modifient ensemble',
      });
    }
  })
  .refine(salesBeforeStart, { path: ['salesOpenAt'] });

/**
 * Paramètres de GET /api/v1/events (chaînes de l'URL, d'où z.coerce).
 *
 * Attention côté client : dans une URL, « + » se lit comme une espace.
 * from=2099-06-01T20:00:00+01:00 arrive donc sans son signe et échoue en 422 :
 * il faut encoder (%2B) ou écrire l'instant en UTC (…Z).
 */
export const catalogueQuerySchema = z
  .object({
    // max(1000) : OFFSET lit et jette les lignes sautées (ADR-006). Paginer
    // au-delà n'est pas un usage du catalogue, et borne le coût d'une requête.
    page: z.coerce.number().int().min(1).max(1000).default(1),
    // 20 par défaut, 100 au plus : contrat d'API (US-3).
    limit: z.coerce.number().int().min(1).max(100).default(20),
    city: z.string().trim().min(1).max(100).optional(),
    from: instant.optional(),
    to: instant.optional(),
  })
  // Intervalle [from, to) : un intervalle vide ou inversé est une erreur du
  // client, pas une page vide qui le laisserait croire qu'il n'y a rien.
  .refine(
    ({ from, to }) =>
      !(from instanceof Date && to instanceof Date) || from < to,
    { path: ['to'] },
  );
