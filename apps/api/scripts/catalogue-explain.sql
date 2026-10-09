-- Mesure du catalogue avant et après idx_events_catalogue (pour INCIDENTS.md).
--
-- Usage, depuis la racine du dépôt, base migrée :
--   psql "$DATABASE_URL" -f apps/api/scripts/catalogue-explain.sql
--
-- Tout se passe dans UNE transaction annulée à la fin : les 100 000
-- événements, l'index supprimé puis recréé, rien ne reste en base.
-- (ANALYZE est permis dans une transaction, VACUUM ne l'est pas.)

\set ON_ERROR_STOP on
BEGIN;

-- L'index existe si la migration est appliquée : on mesure d'abord sans lui.
DROP INDEX IF EXISTS idx_events_catalogue;

INSERT INTO users (email, password_hash, display_name)
VALUES ('explain-seed@example.invalid', '$argon2id$v=19$seed', 'Seed');

-- 100 000 événements : 80 % publiés, dates de -1 an à +2 ans, 7 villes.
INSERT INTO events (organizer_id, name, city, venue, status,
                    starts_at, sales_open_at, published_at)
SELECT u.id,
       'Event ' || g,
       (ARRAY['Fès', 'Rabat', 'Casablanca', 'Marrakech', 'Tanger', 'Agadir',
              'Meknès'])[1 + g % 7],
       'Salle',
       CASE WHEN g % 5 = 0 THEN 'draft' ELSE 'published' END,
       now() - interval '365 days' + g * interval '15 minutes',
       now() - interval '400 days' + g * interval '15 minutes',
       CASE WHEN g % 5 = 0 THEN NULL ELSE now() END
FROM generate_series(1, 100000) AS g
CROSS JOIN (SELECT id FROM users
            WHERE email = 'explain-seed@example.invalid') AS u;

ANALYZE events;

\echo '=== AVANT : sans idx_events_catalogue ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, city, venue, starts_at, sales_open_at
FROM events
WHERE status = 'published' AND starts_at > now()
ORDER BY starts_at, id
LIMIT 21 OFFSET 0;

CREATE INDEX idx_events_catalogue
    ON events (starts_at, id)
    WHERE status = 'published';
ANALYZE events;

\echo '=== APRÈS : avec idx_events_catalogue ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, city, venue, starts_at, sales_open_at
FROM events
WHERE status = 'published' AND starts_at > now()
ORDER BY starts_at, id
LIMIT 21 OFFSET 0;

ROLLBACK;