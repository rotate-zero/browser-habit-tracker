-- Single-row table for thresholds the dashboard can adjust live. The
-- boolean primary key defaulting to true, combined with PK uniqueness,
-- guarantees this table can never hold more than one row.
CREATE TABLE app_settings (
    id                          boolean PRIMARY KEY DEFAULT true CHECK (id),
    batch_size                  integer NOT NULL DEFAULT 25,
    occurrence_threshold        integer NOT NULL DEFAULT 20,
    duration_threshold_seconds  integer NOT NULL DEFAULT 14400,
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (true);
