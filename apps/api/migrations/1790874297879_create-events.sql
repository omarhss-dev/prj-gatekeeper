-- Up Migration


CREATE TABLE events (
    id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id              uuid        NOT NULL,
    name                      text        NOT NULL,
    description               text,
    city                      text        NOT NULL,
    venue                     text        NOT NULL,
    status                    text        NOT NULL DEFAULT 'draft',
    starts_at                 timestamptz NOT NULL,
    sales_open_at             timestamptz NOT NULL,
    max_seats_per_reservation smallint    NOT NULL DEFAULT 4,
    published_at              timestamptz,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_events_organizer
        FOREIGN KEY (organizer_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_events_status
        CHECK (status IN ('draft', 'published', 'cancelled')),
    CONSTRAINT ck_events_name_not_blank
        CHECK (length(btrim(name)) > 0),
    CONSTRAINT ck_events_sales_before_start
        CHECK (sales_open_at <= starts_at),
    CONSTRAINT ck_events_max_seats
        CHECK (max_seats_per_reservation BETWEEN 1 AND 10),
    CONSTRAINT ck_events_published_has_date
        CHECK (status <> 'published' OR published_at IS NOT NULL),
    CONSTRAINT ck_events_draft_has_no_date
        CHECK (status <> 'draft' OR published_at IS NULL)
);

CREATE TABLE event_sections (
    id            uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      uuid     NOT NULL,
    name          text     NOT NULL,
    price_cents   integer  NOT NULL,
    rows_count    smallint NOT NULL,
    seats_per_row smallint NOT NULL,

    CONSTRAINT fk_sections_event
        FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
    CONSTRAINT uq_sections_event_name
        UNIQUE (event_id, name),
    CONSTRAINT uq_sections_id_event
        UNIQUE (id, event_id),
    CONSTRAINT ck_sections_name_not_blank
        CHECK (length(btrim(name)) > 0),
    CONSTRAINT ck_sections_price
        CHECK (price_cents >= 0),
    CONSTRAINT ck_sections_rows
        CHECK (rows_count BETWEEN 1 AND 26),
    CONSTRAINT ck_sections_seats
        CHECK (seats_per_row BETWEEN 1 AND 60)
);

CREATE TABLE event_seats (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   uuid NOT NULL,
    section_id uuid NOT NULL,
    seat_label text NOT NULL,

    CONSTRAINT fk_seats_section_event
        FOREIGN KEY (section_id, event_id)
        REFERENCES event_sections (id, event_id) ON DELETE CASCADE,
    CONSTRAINT uq_seats_section_label
        UNIQUE (section_id, seat_label)
);

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Down Migration

DO $$
BEGIN
    RAISE EXCEPTION 'Irreversible migration: this project is forward-only';
END
$$;