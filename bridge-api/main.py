# =============================================================================
#  BROWSER HABIT TRACKER — Bridge API
#
#  Runs inside WSL2 Ubuntu on port 3737.
#  Chrome extension (Windows) reaches it at http://localhost:3737 — WSL2
#  automatically proxies localhost from Windows into the WSL instance.
#
#  Start: uvicorn main:app --host 0.0.0.0 --port 3737 --reload
# =============================================================================

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/browser_habit_tracker",
)

# ── Connection pool ───────────────────────────────────────────────────────────

pool: asyncpg.Pool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(DB_URL, min_size=1, max_size=5, command_timeout=10)
    print(f"[bridge] DB connected. Listening on :3737")
    yield
    await pool.close()
    print("[bridge] Pool closed.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Habit Tracker Bridge API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # extension origin is 'chrome-extension://<id>'
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# ── Pydantic models ───────────────────────────────────────────────────────────

class SessionRecord(BaseModel):
    id:                  str
    start_time:          datetime
    end_time:            Optional[datetime]  = None
    duration_seconds:    Optional[int]       = None
    url:                 str
    domain:              Optional[str]       = None
    title:               Optional[str]       = None
    tab_id:              Optional[int]       = None
    window_id:           Optional[int]       = None
    browser:             Optional[str]       = "Chrome"
    created_at:          Optional[datetime]  = None


class SessionBatch(BaseModel):
    sessions: list[SessionRecord]


class BatchResult(BaseModel):
    inserted: int
    skipped:  int

# ── SQL ───────────────────────────────────────────────────────────────────────

_INSERT = """
    INSERT INTO activity_sessions (
        id, start_time, end_time, duration_seconds,
        url, domain, title, tab_id, window_id, browser,
        created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (id) DO NOTHING
"""

# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/sessions", response_model=BatchResult)
async def receive_sessions(batch: SessionBatch) -> BatchResult:
    """Accept a batch of completed tab sessions from the Chrome extension."""
    if not batch.sessions:
        return BatchResult(inserted=0, skipped=0)

    inserted = skipped = 0
    utcnow = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            for s in batch.sessions:
                tag = await conn.execute(
                    _INSERT,
                    s.id,
                    s.start_time,
                    s.end_time,
                    s.duration_seconds,
                    s.url,
                    s.domain,
                    s.title,
                    s.tab_id,
                    s.window_id,
                    s.browser,
                    s.created_at or utcnow,
                )
                # asyncpg returns "INSERT 0 0" when ON CONFLICT DO NOTHING fires
                if tag == "INSERT 0 0":
                    skipped += 1
                else:
                    inserted += 1

    return BatchResult(inserted=inserted, skipped=skipped)


@app.get("/health")
async def health():
    """Used by the popup to check if the Bridge API is reachable."""
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "ok", "db": "connected"}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database unreachable: {exc}",
        )


@app.get("/stats")
async def stats():
    """Quick sanity-check endpoint — today's top domains by time spent."""
    async with pool.acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM activity_sessions")
        today = await conn.fetchval(
            "SELECT COUNT(*) FROM activity_sessions WHERE start_time >= CURRENT_DATE"
        )
        top = await conn.fetch(
            """
            SELECT domain,
                   COUNT(*)              AS sessions,
                   SUM(duration_seconds) AS total_seconds
            FROM   activity_sessions
            WHERE  start_time >= CURRENT_DATE
              AND  domain IS NOT NULL
              AND  end_time IS NOT NULL
            GROUP  BY domain
            ORDER  BY total_seconds DESC NULLS LAST
            LIMIT  10
            """
        )
    return {
        "total_all_time": total,
        "today":          today,
        "top_domains_today": [dict(r) for r in top],
    }
