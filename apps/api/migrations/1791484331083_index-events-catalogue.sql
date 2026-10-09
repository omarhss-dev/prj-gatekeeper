-- Up Migration

-- Catalogue (GET /events) : WHERE status = 'published' AND starts_at > now()
-- ORDER BY starts_at, id LIMIT n. Mesuré sur 100 000 événements : 23 ms
-- (Seq Scan + tri) → 0,08 ms (Index Scan, arrêt après n lignes).
--
-- Partiel : seuls les événements publiés y entrent. Les brouillons ne sont
-- jamais lus par le catalogue, et ne coûtent rien à l'index.
-- (starts_at, id) : le même ordre que l'ORDER BY, tie-breaker compris, donc
-- aucun tri après la lecture de l'index.
--
-- Sans CONCURRENTLY : node-pg-migrate exécute chaque migration dans une
-- transaction, où CONCURRENTLY est interdit. Sur une grosse table en
-- production, le CREATE INDEX simple bloquerait les écritures pendant sa
-- construction : il faudrait alors une migration hors transaction.
CREATE INDEX idx_events_catalogue
    ON events (starts_at, id)
    WHERE status = 'published';

-- Down Migration

DO $$
BEGIN
    RAISE EXCEPTION 'Irreversible migration: this project is forward-only';
END
$$;