"""Builds the classification prompt and hands it to your existing agent.
This is the only file that touches the agent -- everything else in the
pipeline is plain, deterministic Python.
"""

import json
import re
import subprocess

# From ~/.hermes/profiles/browser_agent/config.yaml. There's no per-invocation
# --profile flag exposed by -z, so these are reproduced explicitly instead
# of relying on the browser_agent profile being active.
AGENT_MODEL = "poolside/laguna-m.1:free"
AGENT_PROVIDER = "openrouter"
AGENT_TOOLSETS = "hermes-cli"

MODEL_NAME = AGENT_MODEL
PROMPT_VERSION = "v2"

AGENT_TIMEOUT_SECONDS = 400

PROMPT_TEMPLATE = """Classify each browsing session below into exactly one
category from the list given. Do not invent, rename, or modify categories
-- that is a human decision, not yours.

A category only counts as a match if the session's actual subject matter
is genuinely related to it. Do NOT choose a category by process of
elimination -- "it isn't clearly any of the others" is not the same as
"it belongs here." If a session's topic doesn't fit any category in
spirit, it belongs in "Unclassified", even if you're not sure what
category it would eventually need.

Example: a YouTube video titled "earthquake live" is about a natural
disaster -- not entertainment, learning, finance, work, or communication
-- even though YouTube is a site often associated with entertainment.
Domain alone is not a reliable signal of category. This session should be
"Unclassified", with a reason like "Breaking news / disaster coverage not
represented in current categories."

For every session, report your confidence as a number between 0 and 1,
reflecting how well the category genuinely fits -- not how sure you are
that you picked the best available option among a weak set of choices.

Prefer an imperfect existing category over "Unclassified" only when the
session is still clearly within that category's subject matter, just not
its sharpest example. When nothing in the list is topically related,
choose "Unclassified" and explain what's missing in under 200 characters.

Categories: {categories}

Sessions (index, title, domain, url, duration):
{items}

Return ONLY a JSON array, no other text, one object per session in the
same order as given:
[
  {{
    "category": "<exact name from the list>",
    "confidence": <number between 0 and 1>,
    "reason": "<only if category is Unclassified, else null>"
  }}
]
"""


def _truncate_url(url, length=100):
    if not url:
        return "unknown"
    return url if len(url) <= length else url[:length] + "..."


def build_prompt(sessions, category_lookup):
    category_names = ", ".join(sorted(name for _, name in category_lookup.values()))
    items = "\n".join(
        f"{i + 1}. \"{s['title'] or '(untitled)'}\" | {s['domain'] or 'unknown domain'} | "
        f"{_truncate_url(s.get('url'))} | {s['duration_seconds']}s"
        for i, s in enumerate(sessions)
    )
    return PROMPT_TEMPLATE.format(categories=category_names, items=items)


def call_agent(prompt: str) -> str:
    """Invokes Hermes in one-shot mode against the browser_agent profile's
    model/provider/toolset, reproduced explicitly since -z has no
    --profile flag of its own. The prompt is passed as the value of -z
    directly (not via stdin) -- the CLI's argument parser requires it
    that way. At the current batch size the full prompt is only a few KB,
    well under any practical argv length limit, so this is safe; it's
    worth revisiting only if batch size or prompt content grows a lot.
    """
    try:

        HERMES_BIN = "/home/rotate_zero/.local/bin/hermes"

        result = subprocess.run(
            [
                HERMES_BIN,
                "-z", prompt,
                "-m", AGENT_MODEL,
                "--provider", AGENT_PROVIDER,
                "-t", AGENT_TOOLSETS,
                "--ignore-rules",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=AGENT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"hermes timed out after {AGENT_TIMEOUT_SECONDS}s") from e

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"hermes exited with code {result.returncode}")

    return result.stdout


def _clean_json_text(raw: str) -> str:
    """Strips markdown code fences and surrounding chatter a model may add
    despite being told to return only JSON. Looks for the outermost [...]
    span rather than assuming the whole string is clean JSON.
    """
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]
    return text


def classify_batch(sessions, category_lookup):
    prompt = build_prompt(sessions, category_lookup)
    raw = call_agent(prompt)

    try:
        results = json.loads(_clean_json_text(raw))
    except json.JSONDecodeError as e:
        preview = raw.strip()[:300] or "(empty response)"
        raise ValueError(
            f"Agent returned invalid JSON: {e}. Raw response preview: {preview!r}"
        ) from e

    if not isinstance(results, list) or len(results) != len(sessions):
        got = len(results) if isinstance(results, list) else type(results).__name__
        preview = raw.strip()[:300] or "(empty response)"
        raise ValueError(
            f"Expected {len(sessions)} results, got {got}. Raw response preview: {preview!r}"
        )

    return results
