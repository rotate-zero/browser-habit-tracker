"""
Drains the classification backlog (activity_sessions rows with no matching
session_analysis row) completely, looping runner.process_sessions() batch by
batch until the queue is empty.

Robust to transient agent failures (rate limits, "out of free tokens",
hermes CLI timeouts/crashes) -- these raise RuntimeError or ValueError from
classify.py/runner.py. Instead of crashing, this catches them, rolls back,
and retries with exponential backoff (30s -> 60s -> ... -> capped at 15min).
A hard failure never loses data: nothing is written to session_analysis
until a batch fully succeeds and commits.

Usage:
    python drain_backlog.py                 # run until backlog is empty
    python drain_backlog.py --max-hours 4    # safety cap on total runtime
    python drain_backlog.py --batch-size 40  # override app_settings for this run

Run it somewhere that survives you closing the terminal, e.g.:
    nohup python drain_backlog.py > drain.log 2>&1 &
    tail -f drain.log
or inside a tmux/screen session.
"""

from __future__ import annotations

import argparse
import time
from datetime import datetime, timedelta

from db import get_connection, fetch_unclassified, load_taxonomy
from runner import process_sessions
import settings as settings_module

MIN_BACKOFF_SEC = 30
MAX_BACKOFF_SEC = 900   # 15 minutes
BACKOFF_MULTIPLIER = 2
COURTESY_PAUSE_SEC = 1  # small pause between successful batches

MIN_EFFECTIVE_BATCH = 5     # floor when shrinking
SHRINK_AFTER_FAILURES = 2   # consecutive failures on the same batch before shrinking


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def remaining_backlog(conn) -> int:
    """Count of sessions still waiting on classification."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM activity_sessions s
            LEFT JOIN session_analysis sa ON sa.session_id = s.id
            WHERE sa.session_id IS NULL
              AND s.end_time IS NOT NULL
              AND s.duration_seconds IS NOT NULL
            """
        )
        return cur.fetchone()["n"]


def run_one_batch(conn, batch_size: int) -> int | None:
    """Classifies one batch. Returns sessions processed, or None if the
    queue is already empty. Raises on agent/parsing failure -- caller
    decides how to handle that."""
    sessions = fetch_unclassified(conn, batch_size)
    if not sessions:
        return None

    category_lookup, unclassified_id = load_taxonomy(conn)
    n = process_sessions(conn, sessions, category_lookup, unclassified_id)
    conn.commit()
    return n


def drain(max_hours: float | None = None, batch_size_override: int | None = None) -> None:
    deadline = datetime.now() + timedelta(hours=max_hours) if max_hours else None
    backoff = MIN_BACKOFF_SEC
    total_done = 0
    started = datetime.now()
    consecutive_failures = 0
    effective_batch_size = None  # resolved from settings/override on first loop

    log(f"[drain] Starting{f', capped at {max_hours}h' if max_hours else ''}.")

    while True:
        if deadline and datetime.now() >= deadline:
            log(f"[drain] Hit --max-hours cap. Processed {total_done} sessions this run. "
                f"Re-run the script to continue draining the rest.")
            return

        conn = get_connection()
        try:
            base_batch_size = batch_size_override or settings_module.get_settings(conn).get("batch_size", 25)
            if effective_batch_size is None:
                effective_batch_size = base_batch_size

            n = run_one_batch(conn, effective_batch_size)

            if n is None:
                left = remaining_backlog(conn)
                elapsed = datetime.now() - started
                log(f"[drain] Queue empty. Processed {total_done} sessions in {elapsed}. "
                    f"Backlog remaining: {left}. Done.")
                return

            total_done += n
            backoff = MIN_BACKOFF_SEC  # reset backoff after any success
            consecutive_failures = 0
            effective_batch_size = base_batch_size  # recover to configured size after a success
            left = remaining_backlog(conn)
            log(f"[drain] classified {n} ({total_done} total this run), ~{left} left.")

        except Exception as e:
            conn.rollback()
            consecutive_failures += 1
            log(f"[drain] Batch failed ({type(e).__name__}: {e}). "
                f"Retrying in {backoff}s.")

            # fetch_unclassified() deterministically re-fetches the same
            # oldest rows every retry. If the *size* of the batch is the
            # real problem (too much for the model to return complete,
            # valid JSON for) rather than a transient blip, backoff alone
            # just waits longer before failing the same way again. Shrink
            # instead of only waiting once failures repeat on this batch.
            if consecutive_failures >= SHRINK_AFTER_FAILURES and effective_batch_size > MIN_EFFECTIVE_BATCH:
                effective_batch_size = max(MIN_EFFECTIVE_BATCH, effective_batch_size // 2)
                log(f"[drain] {consecutive_failures} failures in a row on this batch -- "
                    f"shrinking to {effective_batch_size} for the next attempt.")

            conn.close()
            time.sleep(backoff)
            backoff = min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_SEC)
            continue
        finally:
            conn.close()

        time.sleep(COURTESY_PAUSE_SEC)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-hours", type=float, default=None,
        help="Stop after this many hours even if backlog remains (safety cap). "
             "Default: run until the queue is fully drained.",
    )
    parser.add_argument(
        "--batch-size", type=int, default=None,
        help="Override app_settings batch_size for this run only.",
    )
    args = parser.parse_args()
    drain(max_hours=args.max_hours, batch_size_override=args.batch_size)
