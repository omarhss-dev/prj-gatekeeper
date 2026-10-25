-- Mesure de GET /api/v1/me/reservations et de l'UPDATE des billets de
-- DELETE /api/v1/reservations/:id, avant et après les index de la migration
-- index-reservations-lookups (pour INCIDENTS.md).
--
-- Usage, depuis la racine du dépôt, base migrée :
--   psql "$DATABASE_URL" -f apps/api/scripts/reservations-explain.sql
--
-- 20 000 comptes, 500 événements de 1 200 sièges, 200 000 réservations de
-- 3 billets (600 000 billets). Tout se passe dans UNE transaction annulée à
-- la fin : les données, les index retirés puis recréés, rien ne reste en base.
-- À lancer sur une base de dev uniquement : DROP INDEX verrouille les tables
-- jusqu'à la fin de la transaction.

\set ON_ERROR_STOP on
BEGIN;

-- Les index existent si la migration est appliquée : on mesure d'abord sans.
DROP INDEX IF EXISTS idx_tickets_reservation;
DROP INDEX IF EXISTS idx_reservations_user;

INSERT INTO users (email, password_hash, display_name)
SELECT 'explain-' || g || '@example.invalid', '$argon2id$v=19$seed', 'Seed'
FROM generate_series(1, 20000) AS g;

INSERT INTO events (organizer_id, name, city, venue, status,
                    starts_at, sales_open_at, published_at)
SELECT u.id, 'Explain ' || g, 'Fès', 'Salle', 'published',
       now() + interval '30 days', now() - interval '1 day', now()
FROM generate_series(1, 500) AS g
CROSS JOIN (SELECT id FROM users
            WHERE email = 'explain-1@example.invalid') AS u;

INSERT INTO event_sections (event_id, name, price_cents, rows_count, seats_per_row)
SELECT id, 'Salle', 5000, 20, 60 FROM events WHERE name LIKE 'Explain %';

INSERT INTO event_seats (event_id, section_id, seat_label)
SELECT s.event_id, s.id, chr(64 + r) || '-' || n
FROM event_sections s
JOIN events e ON e.id = s.event_id AND e.name LIKE 'Explain %'
CROSS JOIN LATERAL generate_series(1, s.rows_count) AS r
CROSS JOIN LATERAL generate_series(1, s.seats_per_row) AS n;

-- Les sièges de chaque événement, par paquets de 3 : un paquet = une
-- réservation, attribuée à un compte tiré au hasard. Un siège n'appartient
-- qu'à un paquet, donc uq_tickets_active_seat est respecté.
CREATE TEMP TABLE explain_pack AS
SELECT s.id AS seat_id, s.event_id,
       (row_number() OVER (PARTITION BY s.event_id ORDER BY s.id) - 1) / 3 AS pack
FROM event_seats s
JOIN events e ON e.id = s.event_id AND e.name LIKE 'Explain %';

CREATE TEMP TABLE explain_user AS
SELECT id, row_number() OVER (ORDER BY id) AS n
FROM users WHERE email LIKE 'explain-%@example.invalid';

CREATE TEMP TABLE explain_reservation AS
SELECT p.event_id, p.pack, gen_random_uuid() AS id, u.id AS user_id
FROM (SELECT event_id, pack, 1 + floor(random() * 20000)::int AS n
      FROM explain_pack GROUP BY event_id, pack) AS p
JOIN explain_user u ON u.n = p.n;

INSERT INTO reservations (id, user_id, event_id, total_cents)
SELECT id, user_id, event_id, 15000 FROM explain_reservation;

INSERT INTO tickets (reservation_id, event_seat_id, code, price_cents)
SELECT r.id, p.seat_id, gen_random_uuid()::text, 5000
FROM explain_pack p JOIN explain_reservation r USING (event_id, pack);

ANALYZE;

-- Le compte qui a le plus de réservations : le cas le plus défavorable.
SELECT user_id AS target, count(*) AS n
FROM explain_reservation GROUP BY user_id ORDER BY n DESC LIMIT 1 \gset
SELECT id AS target_reservation FROM explain_reservation
WHERE user_id = :'target' LIMIT 1 \gset
\echo '=== Compte mesuré : ' :n ' réservations'

\echo '=== A. Mes réservations, sans index ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.status, r.total_cents, r.created_at, r.cancelled_at,
       e.id AS event_id, e.name, e.city, e.venue, e.starts_at,
       t.code, t.status AS ticket_status, t.price_cents,
       sec.name AS section, s.seat_label
FROM reservations r
JOIN events e ON e.id = r.event_id
JOIN tickets t ON t.reservation_id = r.id
JOIN event_seats s ON s.id = t.event_seat_id
JOIN event_sections sec ON sec.id = s.section_id
WHERE r.user_id = :'target'
ORDER BY r.created_at DESC, r.id, sec.price_cents DESC, sec.name,
         split_part(s.seat_label, '-', 1),
         split_part(s.seat_label, '-', 2)::int;

\echo '=== B. Annulation : UPDATE des billets, sans index ==='
EXPLAIN (ANALYZE, BUFFERS)
UPDATE tickets SET status = 'cancelled'
WHERE reservation_id = :'target_reservation' AND status = 'active';

CREATE INDEX idx_tickets_reservation ON tickets (reservation_id);
CREATE INDEX idx_reservations_user ON reservations (user_id);
ANALYZE tickets;
ANALYZE reservations;

\echo '=== C. Mes réservations, avec les deux index ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.status, r.total_cents, r.created_at, r.cancelled_at,
       e.id AS event_id, e.name, e.city, e.venue, e.starts_at,
       t.code, t.status AS ticket_status, t.price_cents,
       sec.name AS section, s.seat_label
FROM reservations r
JOIN events e ON e.id = r.event_id
JOIN tickets t ON t.reservation_id = r.id
JOIN event_seats s ON s.id = t.event_seat_id
JOIN event_sections sec ON sec.id = s.section_id
WHERE r.user_id = :'target'
ORDER BY r.created_at DESC, r.id, sec.price_cents DESC, sec.name,
         split_part(s.seat_label, '-', 1),
         split_part(s.seat_label, '-', 2)::int;

\echo '=== D. Annulation : UPDATE des billets, avec l index ==='
EXPLAIN (ANALYZE, BUFFERS)
UPDATE tickets SET status = 'cancelled'
WHERE reservation_id = :'target_reservation' AND status = 'active';

SELECT pg_size_pretty(pg_relation_size('idx_tickets_reservation')) AS tickets_index,
       pg_size_pretty(pg_relation_size('idx_reservations_user')) AS reservations_index;

ROLLBACK;