-- Up Migration


CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    display_name  text        NOT NULL,
    role          text        NOT NULL DEFAULT 'customer',
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_users_email
        UNIQUE (email),

    CONSTRAINT ck_users_email_normalized
        CHECK (email = lower(btrim(email))),

    CONSTRAINT ck_users_email_length
        CHECK (length(email) <= 254),

    CONSTRAINT ck_users_display_name_not_blank
        CHECK (length(btrim(display_name)) > 0),

    CONSTRAINT ck_users_role
        CHECK (role IN ('customer', 'organizer')),

    CONSTRAINT ck_users_password_hashed
        CHECK (password_hash LIKE '$argon2id$%')
);
-- Down Migration
DO $$
BEGIN
    RAISE EXCEPTION 'Irreversible migration: this project is forward-only';
END
$$;