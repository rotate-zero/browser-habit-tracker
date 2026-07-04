"""cluster_agent : semantic clustering of candidate descriptions.
Same call pattern as classify.py -- one function that takes a prompt
and returns raw text. Python does everything else.
"""

import json
import re
import subprocess

AGENT_MODEL = "poolside/laguna-m.1:free"
AGENT_PROVIDER = "openrouter"
AGENT_TOOLSETS = "hermes-cli"
AGENT_TIMEOUT_SECONDS = 400

PROMPT_TEMPLATE = """Group the following browsing gap descriptions by
semantic similarity. Each entry represents sessions that a classifier
could not categorize -- the descriptions explain why.

Your job is ONLY to group similar concepts together. Do not approve,
reject, or suggest new categories. A group can have one member if it
is genuinely distinct from all others.

Descriptions:
{items}

Return ONLY a JSON array, no other text:
[
  {{
    "label": "<short descriptive label for this group, 3-6 words>",
    "member_indices": [<1-based indices of members>]
  }}
]
"""


def build_cluster_prompt(candidates):
    items = "\n".join(
        f"{i + 1}. \"{c['description']}\" "
        f"({c['occurrence_count']} sessions, "
        f"{round(c['total_seconds'] / 60)}m)"
        for i, c in enumerate(candidates)
    )
    return PROMPT_TEMPLATE.format(items=items)


def call_cluster_agent(prompt):
    try:
        result = subprocess.run(
            [
                "hermes", "-z", prompt,
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
        raise RuntimeError(f"cluster_agent timed out after {AGENT_TIMEOUT_SECONDS}s") from e

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or
                           f"cluster_agent exited with code {result.returncode}")
    return result.stdout


def _clean_json(raw):
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1]
    return text


def cluster_candidates(candidates):
    """candidates: list of dicts with id, description,
    occurrence_count, total_seconds. Returns list of
    {label, member_ids} dicts."""
    if not candidates:
        return []

    prompt = build_cluster_prompt(candidates)
    raw = call_cluster_agent(prompt)

    try:
        results = json.loads(_clean_json(raw))
    except json.JSONDecodeError as e:
        raise ValueError(f"Agent 2 returned invalid JSON: {e}") from e

    clusters = []
    for group in results:
        member_ids = []
        for idx in group.get("member_indices", []):
            if 1 <= idx <= len(candidates):
                member_ids.append(candidates[idx - 1]["id"])
        if member_ids:
            clusters.append({
                "label": group.get("label", "Unlabeled group"),
                "member_ids": member_ids,
            })
    return clusters
