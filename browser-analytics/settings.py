"""Reads and writes the single-row app_settings table. Shared by runner.py
(reads batch_size before each run) and dashboard_api.py (exposes all
values to the dashboard's Settings page).
"""

DEFAULTS = {
    "batch_size": 25,
    "occurrence_threshold": 20,
    "duration_threshold_seconds": 14400,
    "max_reason_length": 200,
    # How many periods back the category-trend chart looks, per period
    # type. User-configurable 1-5 (enforced by a DB check constraint and
    # by the API layer) -- kept deliberately capped so the chart never
    # gets crowded with too many bars per category.
    "trend_lookback_day": 5,
    "trend_lookback_week": 4,
    "trend_lookback_month": 3,
    "trend_lookback_quarter": 3,
    "trend_lookback_year": 2,
}

_COLUMNS = ", ".join(DEFAULTS.keys())


def get_settings(conn):
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_COLUMNS} FROM app_settings LIMIT 1")
        row = cur.fetchone()
    return dict(row) if row else dict(DEFAULTS)


def update_settings(conn, **kwargs):
    allowed = {
        "batch_size", "occurrence_threshold", "duration_threshold_seconds",
        "trend_lookback_day", "trend_lookback_week", "trend_lookback_month",
        "trend_lookback_quarter", "trend_lookback_year",
    }
    fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not fields:
        return get_settings(conn)
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with conn.cursor() as cur:
        cur.execute(f"UPDATE app_settings SET {set_clause}, updated_at = now()", list(fields.values()))
    return get_settings(conn)
