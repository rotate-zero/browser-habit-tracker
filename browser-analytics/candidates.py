"""Aggregates the reasons the agent reports for choosing Unclassified, and
the human actions that resolve them.

No semantic merging yet -- candidates are deduplicated by exact
(normalized) text match only. A second agent will later cluster similar
descriptions together; this file's job for now is just to count.
"""

OCCURRENCE_THRESHOLD = 20
DURATION_THRESHOLD = 14400  # 4 hours, in seconds


def _normalize(text):
    return " ".join((text or "").strip().lower().split())


def upsert_candidate(conn, description, seconds):
    """Returns the candidate's id, whether it was just created or already
    existed, so the caller can link the originating session to it."""
    norm = _normalize(description)
    if not norm:
        return None
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM category_candidates WHERE lower(trim(description)) = %s AND status = 'pending'",
            (norm,),
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                """
                UPDATE category_candidates
                SET occurrence_count = occurrence_count + 1,
                    total_seconds = total_seconds + %s,
                    last_seen = now()
                WHERE id = %s
                RETURNING id
                """,
                (seconds, row["id"]),
            )
        else:
            cur.execute(
                "INSERT INTO category_candidates (description, total_seconds) VALUES (%s, %s) RETURNING id",
                (description.strip(), seconds),
            )
        return cur.fetchone()["id"]


def get_due_for_review(conn, occurrence_threshold=OCCURRENCE_THRESHOLD, duration_threshold=DURATION_THRESHOLD):
    """Candidates crossing either threshold -- frequent-but-short gaps and
    rare-but-heavy ones both deserve a look, for different reasons. Both
    numbers are parameters specifically so a reviewer can loosen or
    tighten them without a code change."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM category_candidates
            WHERE status = 'pending'
              AND (occurrence_count >= %s OR total_seconds >= %s)
            ORDER BY occurrence_count DESC
            """,
            (occurrence_threshold, duration_threshold),
        )
        return cur.fetchall()


def approve_candidate(conn, candidate_id, category_name):
    """Creates a brand new category from this candidate."""
    with conn.cursor() as cur:
        cur.execute("INSERT INTO categories (name) VALUES (%s) RETURNING id", (category_name,))
        new_id = cur.fetchone()["id"]
        cur.execute(
            "UPDATE category_candidates SET status = 'approved', resulting_category_id = %s WHERE id = %s",
            (new_id, candidate_id),
        )
    return new_id


def reject_candidate(conn, candidate_id):
    with conn.cursor() as cur:
        cur.execute("UPDATE category_candidates SET status = 'rejected' WHERE id = %s", (candidate_id,))


def merge_into_category(conn, candidate_id, existing_category_id):
    """'Merge a candidate into an existing category' -- doesn't create
    anything new, just records that this gap turned out to already be
    covered."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE category_candidates SET status = 'merged', resulting_category_id = %s WHERE id = %s",
            (existing_category_id, candidate_id),
        )


def merge_candidates(conn, primary_id, other_ids):
    """'Merge multiple candidates together' -- folds counts/durations
    from other_ids into primary_id and marks the rest as merged."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE category_candidates SET
                occurrence_count = occurrence_count + (
                    SELECT coalesce(sum(occurrence_count), 0) FROM category_candidates WHERE id = ANY(%s)
                ),
                total_seconds = total_seconds + (
                    SELECT coalesce(sum(total_seconds), 0) FROM category_candidates WHERE id = ANY(%s)
                ),
                last_seen = now()
            WHERE id = %s
            """,
            (other_ids, other_ids, primary_id),
        )
        cur.execute(
            "UPDATE category_candidates SET status = 'merged', merged_into_id = %s WHERE id = ANY(%s)",
            (primary_id, other_ids),
        )
