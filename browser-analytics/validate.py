"""Defensive re-validation of the agent's classification output. The
prompt instructs the agent to only choose from the existing list and to
stay under 200 characters on its reason, but free-text models drift on
both -- this is the backstop for each.
"""

MAX_REASON_LENGTH = 200


def _normalize(text):
    return (text or "").strip().lower()


def _truncate(text, length=MAX_REASON_LENGTH):
    text = (text or "").strip()
    if len(text) <= length:
        return text
    # cut at the last word boundary rather than mid-word, and mark that
    # it was cut, so a reviewer doesn't mistake it for the full thought
    return text[:length].rsplit(" ", 1)[0] + "..."


def _clean_confidence(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, value))


def validate_result(result, category_lookup, unclassified_id):
    raw_name = result.get("category")
    limiting_factor = result.get("reason")
    confidence = _clean_confidence(result.get("confidence"))

    match = category_lookup.get(_normalize(raw_name))
    if match:
        category_id, _ = match
    else:
        # unknown/missing name -- fall back to Unclassified rather than
        # writing a dangling reference or leaving the session unresolved
        category_id = unclassified_id
        limiting_factor = limiting_factor or f"Agent proposed an unknown category: {raw_name}"

    needs_review = category_id == unclassified_id
    limiting_factor = _truncate(limiting_factor) if needs_review else None

    return {
        "category_id": category_id,
        "needs_review": needs_review,
        "limiting_factor": limiting_factor,
        "confidence": confidence,
    }
