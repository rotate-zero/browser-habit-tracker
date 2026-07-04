-- Single normalised fact table for all aggregated insights.
-- period_type is always 'day', 'week', or 'month'.
-- Weeks start Monday, months start on the 1st.
-- NULLS NOT DISTINCT (Postgres 15+) makes the unique constraint work
-- correctly when dimension is NULL (total_usage rows).
CREATE TABLE analysis_metrics (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    period_type   text NOT NULL CHECK (period_type IN ('day', 'week', 'month')),
    period_start  date NOT NULL,
    metric_type   text NOT NULL CHECK (metric_type IN ('total_usage', 'domain_usage', 'category_usage')),
    dimension     text,          -- NULL for total_usage, name for domain/category rows
    value_seconds integer NOT NULL DEFAULT 0,
    rank          smallint,      -- NULL for total_usage, 1-4 for domain/category rows
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (period_type, period_start, metric_type, dimension)
);

CREATE INDEX idx_analysis_metrics_lookup
    ON analysis_metrics (period_type, period_start DESC, metric_type);
