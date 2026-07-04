"""Data access layer. Reads sessions, loads the taxonomy, stores
classification output. If your Bridge API already has a connection
helper, swap this out for that instead of duplicating it.
"""

import os
import psycopg2
import psycopg2.extras

DB_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/browser_habit_tracker"
)


def get_connection():
    conn = psycopg2.connect(DB_DSN)
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def fetch_unclassified(conn, limit=50):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.title, s.domain, s.url, s.duration_seconds
            FROM activity_sessions s
            LEFT JOIN session_analysis sa ON sa.session_id = s.id
            WHERE sa.session_id IS NULL
              AND s.end_time IS NOT NULL
              AND s.duration_seconds IS NOT NULL
            ORDER BY s.start_time ASC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


def fetch_needs_review(conn, limit=50):
    """Sessions currently classified as Unclassified. Run this after
    approving a new category to give them another chance."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.title, s.domain, s.url, s.duration_seconds
            FROM activity_sessions s
            JOIN session_analysis sa ON sa.session_id = s.id
            WHERE sa.needs_review = true
            ORDER BY sa.classified_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


def load_taxonomy(conn):
    """Returns (category_lookup, unclassified_id). category_lookup is
    keyed by normalized (lowercased, trimmed) name so matching survives
    minor casing drift from the agent; values carry the canonical name.
    The partial unique index on categories.is_default guarantees there's
    never more than one default row to pick between here.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, is_default FROM categories ORDER BY name")
        rows = cur.fetchall()

    lookup = {r["name"].strip().lower(): (r["id"], r["name"]) for r in rows}
    unclassified_id = next((r["id"] for r in rows if r["is_default"]), None)
    if unclassified_id is None:
        raise RuntimeError("No default category found -- seed an is_default=true row before running.")
    return lookup, unclassified_id


def store_analysis(conn, session_id, category_id, needs_review, category_candidate_id,
                    normalized_domain, confidence, model_name, prompt_version):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO session_analysis
                (session_id, category_id, needs_review, category_candidate_id,
                 normalized_domain, confidence, model_name, prompt_version)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (session_id) DO UPDATE SET
                category_id = EXCLUDED.category_id,
                needs_review = EXCLUDED.needs_review,
                category_candidate_id = EXCLUDED.category_candidate_id,
                normalized_domain = EXCLUDED.normalized_domain,
                confidence = EXCLUDED.confidence,
                model_name = EXCLUDED.model_name,
                prompt_version = EXCLUDED.prompt_version,
                classified_at = now()
            """,
            (
                session_id, category_id, needs_review, category_candidate_id,
                normalized_domain, confidence, model_name, prompt_version,
            ),
        )
