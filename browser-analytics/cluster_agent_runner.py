"""Entry point for cluster_agent. Run manually or on a separate
(less frequent) cron schedule -- daily is enough.

    python cluster_agent_runner.py
"""

from db import get_connection
from cluster_agent import cluster_candidates


def run_clustering():
    conn = get_connection()
    try:
        # Load all pending candidates not already in a cluster
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.description, c.occurrence_count, c.total_seconds
                FROM category_candidates c
                WHERE c.status = 'pending'
                  AND NOT EXISTS (
                      SELECT 1 FROM candidate_cluster_members m
                      WHERE m.candidate_id = c.id
                  )
                ORDER BY c.total_seconds DESC
                """
            )
            candidates = cur.fetchall()

        if not candidates:
            print("No unclustered candidates.")
            return

        print(f"Clustering {len(candidates)} candidates...")
        clusters = cluster_candidates([dict(c) for c in candidates])

        # Write clusters and their members
        for cluster in clusters:
            # Sum totals from members
            member_rows = [c for c in candidates if c["id"] in cluster["member_ids"]]
            total_occ = sum(r["occurrence_count"] for r in member_rows)
            total_sec = sum(r["total_seconds"] for r in member_rows)

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO candidate_clusters
                        (label, total_occurrence_count, total_seconds)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (cluster["label"], total_occ, total_sec),
                )
                cluster_id = cur.fetchone()["id"]

                for candidate_id in cluster["member_ids"]:
                    cur.execute(
                        """
                        INSERT INTO candidate_cluster_members
                            (cluster_id, candidate_id)
                        VALUES (%s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (cluster_id, candidate_id),
                    )

        conn.commit()
        print(f"Created {len(clusters)} clusters.")
    except Exception as e:
        conn.rollback()
        print(f"Clustering failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run_clustering()
