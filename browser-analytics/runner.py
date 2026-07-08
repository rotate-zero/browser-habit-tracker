"""Entry points. Two of them, sharing the same per-session pipeline:

    python runner.py                 # classify new sessions
    python -c "import runner; runner.reprocess_needs_review()"   # retry Unclassified ones
"""

from db import get_connection, fetch_unclassified, fetch_needs_review, load_taxonomy, store_analysis
from classify import classify_batch, MODEL_NAME, PROMPT_VERSION
from validate import validate_result
from candidates import upsert_candidate
from domains import normalize_domain
import settings as settings_module

DEFAULT_BATCH_SIZE = 15  # fallback only -- real value now lives in app_settings,
                          # editable from the dashboard
DEFAULT_REPROCESS_BATCH_SIZE = 5

def process_sessions(conn, sessions, category_lookup, unclassified_id):
    results = classify_batch(sessions, category_lookup)  # raises ValueError on bad output
    for session, result in zip(sessions, results):
        validated = validate_result(result, category_lookup, unclassified_id)
        normalized = normalize_domain(session.get("url"))

        candidate_id = None
        if validated["needs_review"]:
            candidate_id = upsert_candidate(conn, validated["limiting_factor"], session["duration_seconds"] or 0)

        store_analysis(
            conn,
            session_id=session["id"],
            category_id=validated["category_id"],
            needs_review=validated["needs_review"],
            category_candidate_id=candidate_id,
            normalized_domain=normalized,
            confidence=validated["confidence"],
            model_name=MODEL_NAME,
            prompt_version=PROMPT_VERSION,
        )
    return len(sessions)


def _run(fetch_fn, verb, past_tense):
    conn = get_connection()
    try:
        batch_size = settings_module.get_settings(conn).get("batch_size", DEFAULT_BATCH_SIZE)
        sessions = fetch_fn(conn, batch_size)
        if not sessions:
            print(f"Nothing to {verb}.")
            return
        category_lookup, unclassified_id = load_taxonomy(conn)
        try:
            n = process_sessions(conn, sessions, category_lookup, unclassified_id)
        except (ValueError, RuntimeError, ConnectionError, TimeoutError) as e:
            conn.rollback()
            print(f"Batch failed, nothing written: {e}")
            return
        conn.commit()
        print(f"{past_tense} {n} sessions.")
    finally:
        conn.close()


def run_once():
    """Classifies sessions that have never been analyzed."""
    _run(fetch_unclassified, "classify", "Classified")


def reprocess_needs_review():
    """Retries sessions currently marked Unclassified -- run by hand after
    approving a new category."""
    _run(fetch_needs_review, "reprocess", "Reprocessed")


if __name__ == "__main__":
    run_once()
