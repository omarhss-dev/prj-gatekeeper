-- Mesure du plan de salle (GET /api/v1/events/:id/seats), pour INCIDENTS.md
-- et la décision D6 de feat/p2-reservations : faut-il un index ?
--
-- Usage, depuis la racine du dépôt, base migrée :
--   psql "$DATABASE_URL" -f apps/api/scripts/seats-explain.sql
--   psql "$DATABASE_URL" -v n=40 -f apps/api/scripts/seats-explain.sql
--
-- n événements publiés de 31 200 sièges chacun (20 sections × 26 × 60, le
-- maximum autorisé), la moitié des sièges vendus. On mesure UN événement.
-- Tout se passe dans UNE transaction annulée à la fin : rien ne reste en base.

\set ON_ERROR_STOP on
\if :{?n}
\else
  \set n 10
\endif
BEGIN;

INSERT INTO users (email, password_hash, display_name)
VALUES ('explain-seed@example.invalid', '$argon2id$v=19$seed', 'Seed');

INSERT INTO events (organizer_id, name, city, venue, status,
                    starts_at, sales_open_at, published_at)
SELECT u.id, 'Explain ' || lpad(g::text, 3, '0'), 'Fès', 'Salle', 'published',
       now() + interval '30 days', now() - interval '1 day', now()
FROM generate_series(1, :n) AS g
CROSS JOIN (SELECT id FROM users
            WHERE email = 'explain-seed@example.invalid') AS u;

INSERT INTO event_sections (event_id, name, price_cents, rows_count, seats_per_row)
SELECT e.id, 'Section ' || i, 1000 * i, 26, 60
FROM events e, generate_series(1, 20) AS i
WHERE e.name LIKE 'Explain %';

-- Même génération que publishDraft.
INSERT INTO event_seats (event_id, section_id, seat_label)
SELECT s.event_id, s.id, chr(64 + r) || '-' || n
FROM event_sections s
JOIN events e ON e.id = s.event_id AND e.name LIKE 'Explain %'
CROSS JOIN LATERAL generate_series(1, s.rows_count) AS r
CROSS JOIN LATERAL generate_series(1, s.seats_per_row) AS n;

-- Une réservation par événement, un billet sur un siège sur deux.
INSERT INTO reservations (user_id, event_id, total_cents)
SELECT e.organizer_id, e.id, 0 FROM events e WHERE e.name LIKE 'Explain %';
INSERT INTO tickets (reservation_id, event_seat_id, code, price_cents)
SELECT r.id, s.id, gen_random_uuid()::text, 1000
FROM event_seats s
JOIN reservations r ON r.event_id = s.event_id
JOIN events e ON e.id = s.event_id AND e.name LIKE 'Explain %'
WHERE random() < 0.5;

ANALYZE;

SELECT id AS target FROM events WHERE name = 'Explain 001' \gset
SELECT count(*) AS total_tickets FROM tickets \gset
\echo '=== ' :n ' événements de 31 200 sièges, ' :total_tickets ' billets en base'

\echo '=== A. Requête du plan de salle, sans index supplémentaire ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT sec.id AS section_id, sec.name, sec.price_cents,
       s.id AS seat_id, s.seat_label, (t.id IS NULL) AS available
FROM event_seats s
JOIN events e ON e.id = s.event_id AND e.status = 'published'
JOIN event_sections sec ON sec.id = s.section_id
LEFT JOIN tickets t ON t.event_seat_id = s.id AND t.status = 'active'
WHERE s.event_id = :'target'
ORDER BY sec.price_cents DESC, sec.name,
         split_part(s.seat_label, '-', 1),
         split_part(s.seat_label, '-', 2)::int;

\echo '=== B. Même requête, avec un index sur event_seats (event_id) ==='
CREATE INDEX idx_explain_seats_event ON event_seats (event_id);
ANALYZE event_seats;
EXPLAIN (ANALYZE, BUFFERS)
SELECT sec.id AS section_id, sec.name, sec.price_cents,
       s.id AS seat_id, s.seat_label, (t.id IS NULL) AS available
FROM event_seats s
JOIN events e ON e.id = s.event_id AND e.status = 'published'
JOIN event_sections sec ON sec.id = s.section_id
LEFT JOIN tickets t ON t.event_seat_id = s.id AND t.status = 'active'
WHERE s.event_id = :'target'
ORDER BY sec.price_cents DESC, sec.name,
         split_part(s.seat_label, '-', 1),
         split_part(s.seat_label, '-', 2)::int;

ROLLBACK;