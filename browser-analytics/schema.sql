-- Single-level taxonomy. "Unclassified" is a permanent, mandatory row
-- (is_default = true) rather than a special-cased null value -- every
-- session always gets a real category_id, even when that category is
-- Unclassified.
CREATE TABLE categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL UNIQUE,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Guarantees at most one category can ever be the default. Without this,
-- load_taxonomy()'s pick-the-first-match logic would have no way to know
-- which row was "the" default if two ever got marked is_default = true.
CREATE UNIQUE INDEX idx_categories_single_default
    ON categories (is_default) WHERE is_default = true;

-- Raw missing-concept log. Exact-text dedup only -- a second agent will
-- later cluster similar descriptions together. Created before
-- session_analysis since that table now references this one.
CREATE TABLE category_candidates (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    description           text NOT NULL,
    occurrence_count      integer NOT NULL DEFAULT 1,
    total_seconds         integer NOT NULL DEFAULT 0,
    first_seen            timestamptz NOT NULL DEFAULT now(),
    last_seen             timestamptz NOT NULL DEFAULT now(),
    status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
    merged_into_id         uuid REFERENCES category_candidates(id),
    resulting_category_id  uuid REFERENCES categories(id)
);

-- Classification output, kept separate from the extension's raw session
-- data -- nothing here touches activity_sessions. "Why" for a
-- needs_review session is recovered by joining to
-- category_candidates.description through category_candidate_id, rather
-- than storing the reason text in two places.
CREATE TABLE session_analysis (
    session_id             uuid PRIMARY KEY REFERENCES activity_sessions(id),
    category_id              uuid NOT NULL REFERENCES categories(id),
    needs_review             boolean NOT NULL DEFAULT false,
    category_candidate_id     uuid REFERENCES category_candidates(id),
    normalized_domain         text,
    confidence                numeric(4,3),
    model_name                text,
    prompt_version            text,
    classified_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_analysis_needs_review
    ON session_analysis (needs_review) WHERE needs_review = true;

CREATE INDEX idx_session_analysis_domain
    ON session_analysis (normalized_domain);
