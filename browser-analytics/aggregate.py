"""Aggregation job. Populates analysis_metrics for the current day, week,
and month. Safe to re-run -- upserts mean re-running just refreshes the
numbers with the latest classified data.

Run manually:  python aggregate.py
Cron (2am):    0 2 * * * cd /path && venv/bin/python aggregate.py >> aggregate.log 2>&1
"""

from datetime import date, timedelta
from db import get_connection

TOP_N = 4  # top domains and categories to store per period


# ---------------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------------

def _period_start(period_type: str, ref: date) -> date:
    if period_type == 'day':
        return ref
    elif period_type == 'week':
        return ref - timedelta(days=ref.weekday())   # Monday
    elif period_type == 'month':
        return ref.replace(day=1)
    raise ValueError(f"Unknown period_type: {period_type}")


def _period_end(period_type: str, start: date) -> date:
    """Exclusive upper bound for the period."""
    if period_type == 'day':
        return start + timedelta(days=1)
    elif period_type == 'week':
        return start + timedelta(weeks=1)
    elif period_type == 'month':
        if start.month == 12:
            return date(start.year + 1, 1, 1)
        return date(start.year, start.month + 1, 1)
    raise ValueError(f"Unknown period_type: {period_type}")


# ---------------------------------------------------------------------------
# Core aggregation
# ---------------------------------------------------------------------------

def _upsert(conn, period_type, period_start, metric_type, dimension, value_seconds, rank):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO analysis_metrics
                (period_type, period_start, metric_type, dimension, value_seconds, rank)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (period_type, period_start, metric_type, dimension)
            DO UPDATE SET
                value_seconds = EXCLUDED.value_seconds,
                rank = EXCLUDED.rank
            """,
            (period_type, period_start, metric_type, dimension, value_seconds, rank),
        )


def aggregate_period(conn, period_type: str, period_start: date):
    period_end = _period_end(period_type, period_start)

    with conn.cursor() as cur:
        # Total usage
        cur.execute(
            """
            SELECT coalesce(sum(s.duration_seconds), 0) AS total
            FROM session_analysis sa
            JOIN activity_sessions s ON s.id = sa.session_id
            WHERE s.start_time >= %s AND s.start_time < %s
            """,
            (period_start, period_end),
        )
        total_seconds = cur.fetchone()["total"]
    _upsert(conn, period_type, period_start, "total_usage", None, total_seconds, None)

    with conn.cursor() as cur:
        # Top N domains
        cur.execute(
            """
            SELECT sa.normalized_domain AS dimension,
                   sum(s.duration_seconds)::int AS value_seconds,
                   row_number() OVER (ORDER BY sum(s.duration_seconds) DESC)::smallint AS rank
            FROM session_analysis sa
            JOIN activity_sessions s ON s.id = sa.session_id
            WHERE s.start_time >= %s AND s.start_time < %s
              AND sa.normalized_domain IS NOT NULL
            GROUP BY sa.normalized_domain
            ORDER BY value_seconds DESC
            LIMIT %s
            """,
            (period_start, period_end, TOP_N),
        )
        for row in cur.fetchall():
            _upsert(conn, period_type, period_start, "domain_usage",
                    row["dimension"], row["value_seconds"], row["rank"])

    with conn.cursor() as cur:
        # Top N categories (excluding Unclassified)
        cur.execute(
            """
            SELECT c.name AS dimension,
                   sum(s.duration_seconds)::int AS value_seconds,
                   row_number() OVER (ORDER BY sum(s.duration_seconds) DESC)::smallint AS rank
            FROM session_analysis sa
            JOIN activity_sessions s ON s.id = sa.session_id
            JOIN categories c ON c.id = sa.category_id
            WHERE s.start_time >= %s AND s.start_time < %s
              AND c.is_default = false
            GROUP BY c.name
            ORDER BY value_seconds DESC
            LIMIT %s
            """,
            (period_start, period_end, TOP_N),
        )
        for row in cur.fetchall():
            _upsert(conn, period_type, period_start, "category_usage",
                    row["dimension"], row["value_seconds"], row["rank"])


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_aggregation(ref_date: date = None):
    if ref_date is None:
        ref_date = date.today()

    conn = get_connection()
    try:
        for period_type in ("day", "week", "month"):
            start = _period_start(period_type, ref_date)
            aggregate_period(conn, period_type, start)
            print(f"  {period_type}: {start}")
        conn.commit()
        print("Aggregation complete.")
    except Exception as e:
        conn.rollback()
        print(f"Aggregation failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--date", type=str, default=None,
        help="Recompute day/week/month metrics as of this date (YYYY-MM-DD) instead "
             "of today. Useful for refreshing a stale historical snapshot -- e.g. a "
             "month whose analysis_metrics row was written before backlog "
             "classification caught up, and never got a later run to overwrite it.",
    )
    args = parser.parse_args()
    ref = date.fromisoformat(args.date) if args.date else None
    run_aggregation(ref_date=ref)
