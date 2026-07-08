"""Period resolution for the Dashboard's sliding timeframe feature.

Given a period_type and an integer offset (0 = current period, 1 = one
period back, 2 = two back, ...), resolves the exact [start, end) date
range to query, plus a human-readable label for it.

Day and Week slide as fixed-size rolling windows anchored to today --
offset=1 on Week means "8-14 days ago", not last calendar week.
Month, Quarter, and Year slide along real calendar boundaries instead --
offset=1 on Month from July 2026 means all of June 2026, not "30 days
before today's date".

All Time never slides -- it always resolves to the same range regardless
of offset, since there's no meaningful "previous all time".

This is intentionally separate from any period logic the Insights tab
uses -- the two features have different slide semantics (rolling vs.
calendar-aligned, offset-based vs. current/previous-only) and keeping
them independent avoids forcing one to bend to the other's shape.
"""

from __future__ import annotations

from datetime import date, timedelta

ALL_TIME_START = date(2000, 1, 1)


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    """month is 1-12. delta can be positive or negative."""
    idx = (year * 12 + (month - 1)) + delta
    return idx // 12, idx % 12 + 1


def resolve_period(period_type: str, offset: int, ref: date | None = None) -> tuple[date, date]:
    """Returns (start, end) as a half-open [start, end) date range."""
    ref = ref or date.today()
    offset = max(0, offset)  # never slide into the future

    if period_type == "day":
        start = ref - timedelta(days=offset)
        return start, start + timedelta(days=1)

    if period_type == "week":
        # rolling 7-day window anchored to today, shifted in 7-day
        # chunks -- not Mon-Sun calendar weeks.
        start = ref - timedelta(days=6 + 7 * offset)
        return start, start + timedelta(days=7)

    if period_type == "month":
        y, m = _shift_month(ref.year, ref.month, -offset)
        start = date(y, m, 1)
        y2, m2 = _shift_month(y, m, 1)
        return start, date(y2, m2, 1)

    if period_type == "quarter":
        q_month = ((ref.month - 1) // 3) * 3 + 1
        y, m = _shift_month(ref.year, q_month, -3 * offset)
        start = date(y, m, 1)
        y2, m2 = _shift_month(y, m, 3)
        return start, date(y2, m2, 1)

    if period_type == "year":
        y = ref.year - offset
        return date(y, 1, 1), date(y + 1, 1, 1)

    if period_type == "all":
        # offset is deliberately ignored -- there's nothing to slide to.
        return ALL_TIME_START, ref + timedelta(days=1)

    raise ValueError(f"Unknown period_type: {period_type}")


def describe_period(period_type: str, start: date, end: date) -> str:
    """Human-readable label for a resolved [start, end) range, e.g.
    'Jun 24-30, 2026', 'June 2026', 'Q2 2026'."""
    last_day = end - timedelta(days=1)

    if period_type == "day":
        return start.strftime("%b %d, %Y")

    if period_type == "week":
        if start.year == last_day.year and start.month == last_day.month:
            return f"{start.strftime('%b %d')}-{last_day.strftime('%d, %Y')}"
        if start.year == last_day.year:
            return f"{start.strftime('%b %d')} - {last_day.strftime('%b %d, %Y')}"
        return f"{start.strftime('%b %d, %Y')} - {last_day.strftime('%b %d, %Y')}"

    if period_type == "month":
        return start.strftime("%B %Y")

    if period_type == "quarter":
        q = (start.month - 1) // 3 + 1
        return f"Q{q} {start.year}"

    if period_type == "year":
        return str(start.year)

    if period_type == "all":
        return "All Time"

    raise ValueError(f"Unknown period_type: {period_type}")
