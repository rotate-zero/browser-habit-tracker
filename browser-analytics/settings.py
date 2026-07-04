"""Reads and writes the single-row app_settings table. Shared by runner.py
(reads batch_size before each run) and dashboard_api.py (exposes all
three values to the dashboard's Settings page).
"""

DEFAULTS = {"batch_size": 25, "occurrence_threshold": 20, "duration_threshold_seconds": 14400,
    "max_reason_length": 200}


def get_settings(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT batch_size, occurrence_threshold, duration_threshold_seconds, max_reason_length FROM app_settings LIMIT 1")
        row = cur.fetchone()
    return dict(row) if row else dict(DEFAULTS)


def update_settings(conn, **kwargs):
    allowed = {"batch_size", "occurrence_threshold", "duration_threshold_seconds"}
    fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not fields:
        return get_settings(conn)
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with conn.cursor() as cur:
        cur.execute(f"UPDATE app_settings SET {set_clause}, updated_at = now()", list(fields.values()))
    return get_settings(conn)
