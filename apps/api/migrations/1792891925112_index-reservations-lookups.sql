-- Up Migration

-- Deux clés étrangères que Postgres n'indexe pas de lui-même, et que deux
-- chemins lisent par leur valeur. Mesuré avec scripts/reservations-explain.sql
-- (200 000 réservations, 600 000 billets) :
--
-- GET /me/reservations (WHERE r.user_id = $1, JOIN tickets ON reservation_id) :
--   aucun index 60 ms · user_id seul 53 ms · reservation_id seul 14 ms ·
--   les deux 0,7 ms. Sans eux, Postgres lit toute la table tickets.
--
-- DELETE /reservations/:id (UPDATE tickets WHERE reservation_id = $1) :
--   lecture complète de tickets, pendant que la transaction tient le verrou
--   de la réservation. Avec l'index : quelques lignes.
--
-- idx_tickets_reservation est sur le chemin d'écriture le plus sollicité
-- (ADR-024). Il est ordinaire, pas unique : une écriture d'index de plus par
-- billet, mais aucune attente entre transactions, contrairement à un index
-- unique comme uq_tickets_active_seat.
--
-- Sans CONCURRENTLY, comme idx_events_catalogue : node-pg-migrate exécute
-- chaque migration dans une transaction, où CONCURRENTLY est interdit.
CREATE INDEX idx_tickets_reservation
    ON tickets (reservation_id);

CREATE INDEX idx_reservations_user
    ON reservations (user_id);

-- Down Migration

DO $$
BEGIN
    RAISE EXCEPTION 'Irreversible migration: this project is forward-only';
END
$$;