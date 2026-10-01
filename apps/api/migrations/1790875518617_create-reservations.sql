-- Up Migration

CREATE TABLE reservations (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL,
    event_id     uuid        NOT NULL,
    status       text        NOT NULL DEFAULT 'confirmed',
    total_cents  integer     NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,

    CONSTRAINT fk_reservations_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_reservations_event
        FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE RESTRICT,
    CONSTRAINT ck_reservations_status
        CHECK (status IN ('confirmed', 'cancelled')),
    CONSTRAINT ck_reservations_total
        CHECK (total_cents >= 0),
    CONSTRAINT ck_reservations_cancelled_at
        CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE TABLE tickets (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id uuid        NOT NULL,
    event_seat_id  uuid        NOT NULL,
    code           text        NOT NULL,
    price_cents    integer     NOT NULL,
    status         text        NOT NULL DEFAULT 'active',
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_tickets_reservation
        FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON DELETE CASCADE,
    CONSTRAINT fk_tickets_seat
        FOREIGN KEY (event_seat_id) REFERENCES event_seats (id) ON DELETE RESTRICT,
    CONSTRAINT uq_tickets_code
        UNIQUE (code),
    CONSTRAINT ck_tickets_status
        CHECK (status IN ('active', 'cancelled')),
    CONSTRAINT ck_tickets_price
        CHECK (price_cents >= 0)
);

CREATE UNIQUE INDEX uq_tickets_active_seat
    ON tickets (event_seat_id)
    WHERE status = 'active';

-- Down Migration
DO $$
BEGIN
    RAISE EXCEPTION 'Irreversible migration: this project is forward-only';
END
$$;
