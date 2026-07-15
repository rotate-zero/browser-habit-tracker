"""Read-only (and a couple of small write) HTTP endpoints backing the
dashboard. This is a thin wrapper -- all the real query and business
logic stays in db.py / candidates.py / settings.py, imported directly
rather than reimplemented here or in the Next.js side.

Run with: uvicorn dashboard_api:app --reload --port 8001
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from db import get_connection
from candidates import approve_candidate, reject_candidate
from periods import resolve_period, describe_period
import settings as settings_module

app = FastAPI(title="Hermes dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)


@app.get("/summary")
def summary(period_type: str = "all", offset: int = 0):
    start, end = resolve_period(period_type, offset)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT coalesce(sum(s.duration_seconds), 0) AS total_seconds
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                WHERE s.start_time >= %s AND s.start_time < %s
                """,
                (start, end),
            )
            total_seconds = cur.fetchone()["total_seconds"]

            cur.execute(
                """
                SELECT c.name, sum(s.duration_seconds) AS seconds
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                JOIN categories c ON c.id = sa.category_id
                WHERE s.start_time >= %s AND s.start_time < %s
                  AND c.is_default = false
                GROUP BY c.name
                ORDER BY seconds DESC
                LIMIT 1
                """,
                (start, end),
            )
            top = cur.fetchone()

            cur.execute("SELECT count(*) AS n FROM activity_sessions WHERE start_time::date = current_date")
            sessions_today = cur.fetchone()["n"]

            settings_row = settings_module.get_settings(conn)
            cur.execute(
                """
                SELECT count(*) AS n FROM category_candidates
                WHERE status = 'pending'
                  AND (occurrence_count >= %s OR total_seconds >= %s)
                """,
                (settings_row["occurrence_threshold"], settings_row["duration_threshold_seconds"]),
            )
            pending_review = cur.fetchone()["n"]

        return {
            "tracked_hours": round(total_seconds / 3600, 1),
            "top_category": top["name"] if top else None,
            "sessions_today": sessions_today,
            "pending_review": pending_review,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "period_label": describe_period(period_type, start, end),
            "has_next": offset > 0 and period_type != "all",
        }
    finally:
        conn.close()


@app.get("/categories")
def categories(period_type: str = "all", offset: int = 0):
    start, end = resolve_period(period_type, offset)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.name, round(sum(s.duration_seconds) / 3600.0, 2) AS hours
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                JOIN categories c ON c.id = sa.category_id
                WHERE s.start_time >= %s AND s.start_time < %s
                GROUP BY c.name
                ORDER BY hours DESC
                """,
                (start, end),
            )
            return cur.fetchall()
    finally:
        conn.close()


@app.get("/domains")
def domains(period_type: str = "all", offset: int = 0):
    start, end = resolve_period(period_type, offset)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sa.normalized_domain AS domain,
                       round(sum(s.duration_seconds) / 3600.0, 2) AS hours,
                       count(*) AS sessions
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                WHERE s.start_time >= %s AND s.start_time < %s
                  AND sa.normalized_domain IS NOT NULL
                GROUP BY sa.normalized_domain
                ORDER BY hours DESC
                LIMIT 10
                """,
                (start, end),
            )
            return cur.fetchall()
    finally:
        conn.close()


@app.get("/domain-timeline")
def domain_timeline(period_type: str = "all", offset: int = 0):
    """Returns hourly activity breakdown for the top 10 domains by time.
    Hours are in Asia/Dhaka time (UTC+6). Change the AT TIME ZONE value
    if you move or want UTC instead.
    """
    start, end = resolve_period(period_type, offset)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # Step 1: identify the top 10 domains for the period
            cur.execute(
                """
                SELECT sa.normalized_domain AS domain
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                WHERE s.start_time >= %s AND s.start_time < %s
                  AND sa.normalized_domain IS NOT NULL
                GROUP BY sa.normalized_domain
                ORDER BY sum(s.duration_seconds) DESC
                LIMIT 10
                """,
                (start, end),
            )
            top_domains = [r["domain"] for r in cur.fetchall()]

            if not top_domains:
                return {"domains": [], "data": []}

            # Step 2: hourly breakdown for those domains
            cur.execute(
                """
                SELECT sa.normalized_domain AS domain,
                       EXTRACT(HOUR FROM s.start_time AT TIME ZONE 'Asia/Dhaka')::int AS hour,
                       round(sum(s.duration_seconds) / 60.0, 1) AS minutes
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                WHERE s.start_time >= %s AND s.start_time < %s
                  AND sa.normalized_domain = ANY(%s)
                GROUP BY sa.normalized_domain, hour
                ORDER BY domain, hour
                """,
                (start, end, top_domains),
            )
            data = cur.fetchall()

        return {"domains": top_domains, "data": data}
    finally:
        conn.close()


@app.get("/category-trend")
def category_trend(period_type: str = "week", offset: int = 0):
    """Top 8 categories (ranked by the current single period only, same
    window /summary and /categories use) shown across the current period
    plus N-1 prior periods, where N is the configurable lookback for
    this period_type (app_settings.trend_lookback_<period_type>, 1-5).

    Not available for 'all' -- there's no coherent set of "prior all
    times" to tile.
    """
    if period_type not in ("day", "week", "month", "quarter", "year"):
        raise HTTPException(
            status_code=400,
            detail=f"category-trend is not available for period_type={period_type!r}",
        )

    conn = get_connection()
    try:
        settings_row = settings_module.get_settings(conn)
        lookback = settings_row[f"trend_lookback_{period_type}"]

        current_start, current_end = resolve_period(period_type, offset)

        with conn.cursor() as cur:
            # Rank by the current period alone, per the product decision here:
            # a category that spiked in the last few days but is quiet today
            # should still show up on the Week tab even if it wouldn't top
            # today's own ranking.
            cur.execute(
                """
                SELECT c.name, sum(s.duration_seconds) AS seconds
                FROM session_analysis sa
                JOIN activity_sessions s ON s.id = sa.session_id
                JOIN categories c ON c.id = sa.category_id
                WHERE s.start_time >= %s AND s.start_time < %s
                  AND c.is_default = false
                GROUP BY c.name
                ORDER BY seconds DESC
                LIMIT 8
                """,
                (current_start, current_end),
            )
            top_categories = [r["name"] for r in cur.fetchall()]

            if not top_categories:
                return {"period_type": period_type, "categories": [], "periods": []}

            periods = []
            for i in range(lookback):
                o = offset + i
                p_start, p_end = resolve_period(period_type, o)
                cur.execute(
                    """
                    SELECT c.name, round(sum(s.duration_seconds) / 3600.0, 2) AS hours
                    FROM session_analysis sa
                    JOIN activity_sessions s ON s.id = sa.session_id
                    JOIN categories c ON c.id = sa.category_id
                    WHERE s.start_time >= %s AND s.start_time < %s
                      AND c.name = ANY(%s)
                    GROUP BY c.name
                    """,
                    (p_start, p_end, top_categories),
                )
                values = {r["name"]: r["hours"] for r in cur.fetchall()}
                periods.append({
                    "offset": o,
                    "label": describe_period(period_type, p_start, p_end),
                    "values": values,
                })

        periods.reverse()  # oldest -> newest, left-to-right chart reading
        return {"period_type": period_type, "categories": top_categories, "periods": periods}
    finally:
        conn.close()


@app.get("/candidates")
def candidates(status: str = "pending"):
    conn = get_connection()
    try:
        settings_row = settings_module.get_settings(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM category_candidates WHERE status = %s ORDER BY occurrence_count DESC",
                (status,),
            )
            rows = cur.fetchall()
        for row in rows:
            row["due_for_review"] = (
                row["occurrence_count"] >= settings_row["occurrence_threshold"]
                or row["total_seconds"] >= settings_row["duration_threshold_seconds"]
            )
        return rows
    finally:
        conn.close()


class ApproveBody(BaseModel):
    category_name: str


@app.post("/candidates/{candidate_id}/approve")
def approve(candidate_id: str, body: ApproveBody):
    conn = get_connection()
    try:
        new_id = approve_candidate(conn, candidate_id, body.category_name)
        conn.commit()
        return {"category_id": new_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.post("/candidates/{candidate_id}/reject")
def reject(candidate_id: str):
    conn = get_connection()
    try:
        reject_candidate(conn, candidate_id)
        conn.commit()
        return {"status": "rejected"}
    finally:
        conn.close()


class SettingsBody(BaseModel):
    batch_size: Optional[int] = None
    occurrence_threshold: Optional[int] = None
    duration_threshold_hours: Optional[float] = None
    max_reason_length: Optional[int] = None
    trend_lookback_day: Optional[int] = Field(default=None, ge=1, le=5)
    trend_lookback_week: Optional[int] = Field(default=None, ge=1, le=5)
    trend_lookback_month: Optional[int] = Field(default=None, ge=1, le=5)
    trend_lookback_quarter: Optional[int] = Field(default=None, ge=1, le=5)
    trend_lookback_year: Optional[int] = Field(default=None, ge=1, le=5)


@app.get("/settings")
def get_settings_route():
    conn = get_connection()
    try:
        s = settings_module.get_settings(conn)
        return {
            "batch_size": s["batch_size"],
            "occurrence_threshold": s["occurrence_threshold"],
            "duration_threshold_hours": round(s["duration_threshold_seconds"] / 3600, 1),
            "max_reason_length": s["max_reason_length"],
            "trend_lookback_day": s["trend_lookback_day"],
            "trend_lookback_week": s["trend_lookback_week"],
            "trend_lookback_month": s["trend_lookback_month"],
            "trend_lookback_quarter": s["trend_lookback_quarter"],
            "trend_lookback_year": s["trend_lookback_year"],
        }
    finally:
        conn.close()


@app.put("/settings")
def update_settings_route(body: SettingsBody):
    conn = get_connection()
    try:
        kwargs = {
            "batch_size": body.batch_size,
            "occurrence_threshold": body.occurrence_threshold,
            "max_reason_length": body.max_reason_length,
            "trend_lookback_day": body.trend_lookback_day,
            "trend_lookback_week": body.trend_lookback_week,
            "trend_lookback_month": body.trend_lookback_month,
            "trend_lookback_quarter": body.trend_lookback_quarter,
            "trend_lookback_year": body.trend_lookback_year,
        }
        if body.duration_threshold_hours is not None:
            kwargs["duration_threshold_seconds"] = int(body.duration_threshold_hours * 3600)
        s = settings_module.update_settings(conn, **kwargs)
        conn.commit()
        return {
            "batch_size": s["batch_size"],
            "occurrence_threshold": s["occurrence_threshold"],
            "duration_threshold_hours": round(s["duration_threshold_seconds"] / 3600, 1),
            "max_reason_length": s["max_reason_length"],
            "trend_lookback_day": s["trend_lookback_day"],
            "trend_lookback_week": s["trend_lookback_week"],
            "trend_lookback_month": s["trend_lookback_month"],
            "trend_lookback_quarter": s["trend_lookback_quarter"],
            "trend_lookback_year": s["trend_lookback_year"],
        }
    finally:
        conn.close()


def _period_start(period_type: str, ref: date) -> date:
    if period_type == "day":
        return ref
    elif period_type == "week":
        return ref - timedelta(days=ref.weekday())
    elif period_type == "month":
        return ref.replace(day=1)
    raise ValueError(f"Unknown period_type: {period_type}")


def _prev_period_start(period_type: str, current: date) -> date:
    if period_type == "day":
        return current - timedelta(days=1)
    elif period_type == "week":
        return current - timedelta(weeks=1)
    elif period_type == "month":
        if current.month == 1:
            return date(current.year - 1, 12, 1)
        return date(current.year, current.month - 1, 1)
    raise ValueError(f"Unknown period_type: {period_type}")


@app.get("/insights")
def insights(period_type: str = "day"):
    """Returns current and previous period metrics for comparison.
    period_type: 'day' | 'week' | 'month'
    """
    today = date.today()
    current_start = _period_start(period_type, today)
    prev_start = _prev_period_start(period_type, current_start)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT period_start, metric_type, dimension, value_seconds, rank
                FROM analysis_metrics
                WHERE period_type = %s
                  AND period_start IN (%s, %s)
                ORDER BY period_start DESC, metric_type, rank NULLS LAST
                """,
                (period_type, current_start, prev_start),
            )
            rows = [dict(r) for r in cur.fetchall()]

        # psycopg2 returns period_start as datetime.date -- compare directly
        current = [r for r in rows if r["period_start"] == current_start]
        previous = [r for r in rows if r["period_start"] == prev_start]

        # Serialise dates to strings for JSON
        for r in current + previous:
            r["period_start"] = r["period_start"].isoformat()

        return {
            "period_type": period_type,
            "current_period_start": current_start.isoformat(),
            "previous_period_start": prev_start.isoformat(),
            "current": current,
            "previous": previous,
        }
    finally:
        conn.close()


@app.get("/clusters")
def clusters():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT cl.id, cl.label, cl.total_occurrence_count,
                       cl.total_seconds, cl.status, cl.created_at,
                       json_agg(json_build_object(
                           'id', c.id,
                           'description', c.description,
                           'occurrence_count', c.occurrence_count,
                           'total_seconds', c.total_seconds
                       ) ORDER BY c.total_seconds DESC) AS members
                FROM candidate_clusters cl
                JOIN candidate_cluster_members m ON m.cluster_id = cl.id
                JOIN category_candidates c ON c.id = m.candidate_id
                WHERE cl.status = 'pending'
                GROUP BY cl.id
                ORDER BY cl.total_seconds DESC
                """
            )
            return cur.fetchall()
    finally:
        conn.close()


@app.post("/clusters/{cluster_id}/approve")
def approve_cluster(cluster_id: str, body: ApproveBody):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO categories (name) VALUES (%s) RETURNING id",
                (body.category_name,),
            )
            new_cat_id = cur.fetchone()["id"]
            cur.execute(
                """
                UPDATE category_candidates SET
                    status = 'approved',
                    resulting_category_id = %s
                WHERE id IN (
                    SELECT candidate_id FROM candidate_cluster_members
                    WHERE cluster_id = %s
                )
                """,
                (new_cat_id, cluster_id),
            )
            cur.execute(
                "UPDATE candidate_clusters SET status = 'approved' WHERE id = %s",
                (cluster_id,),
            )
        conn.commit()
        return {"category_id": new_cat_id}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.post("/clusters/{cluster_id}/reject")
def reject_cluster(cluster_id: str):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE category_candidates SET status = 'rejected'
                WHERE id IN (
                    SELECT candidate_id FROM candidate_cluster_members
                    WHERE cluster_id = %s
                )
                """,
                (cluster_id,),
            )
            cur.execute(
                "UPDATE candidate_clusters SET status = 'rejected' WHERE id = %s",
                (cluster_id,),
            )
        conn.commit()
        return {"status": "rejected"}
    finally:
        conn.close()
