"""The coach: measured set (or session) in, coaching out.

The camera and the rep engine measure; the model only interprets the numbers it is given and
decides the next target. Its reply is checked and clamped here, and when no model can answer the
offline coach below answers instead (labelled as such).
"""

import json
import random

from . import gemini

STYLES = {
    "calm": "a calm, encouraging coach who sounds like a good physio",
    "hype": "a high-energy hype coach: upbeat, punchy, short sentences",
    "drill": "a tough drill sergeant: blunt and demanding, never insulting",
    "science": "a sports scientist who adds the reason behind each cue in a few words",
}
GOALS = {
    "strength": "build strength: lower reps, full range, longer rests (90-180 s)",
    "endurance": "build endurance: more reps, shorter rests (30-75 s)",
    "technique": "clean technique first: fewer, slower, perfect reps",
    "general": "general fitness: moderate reps and rests",
}

RULES = """Rules:
- You coach from measurements a pose-tracking camera took. Use only the numbers you are given; never
  invent weight, heart rate, calories or anything not measured.
- Speak to the athlete as "you". Plain words, short sentences, no emojis, no markdown.
- Tempo fields are seconds per phase; the phase names say what each one is for this exercise.
- depth is the % of the full range reached (100 = full depth, such as thighs parallel in a squat). Below
  about 90 means the rep stopped short of full depth; over 100 means deeper than required.
- score is 0-100 per rep: depth plus form faults. quality "bad" means a serious fault.
- slowdown_pct is how much slower the lifting half got from the first to the last third of the set.
  Over about 20% means they were close to failure; under 5% means there was more in the tank.
- uncertain reps were not judged because the camera could not see the body well; if there are
  several, tell them how to position the camera instead of guessing about form.
- Never diagnose pain or injury. If form broke down badly, lower the target and focus on technique.
How to coach well:
- Read the per-rep list. If quality fell apart, name the rep where it started ("from rep 8 your depth
  dropped below parallel") and treat the reps before it as the real working set.
- Compare with previous_sets when given (better, worse, same) using their numbers.
- Speak fully in your persona's voice. The headline must be about THIS set (a number or a moment
  from it), never generic like "Set complete".
- Fixes come from the faults listed, most frequent or most serious first; cues are what you would
  shout mid-rep."""

SET_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline": {"type": "STRING", "description": "under 60 characters"},
        "feedback": {"type": "STRING", "description": "2 or 3 sentences about this set, citing its numbers"},
        "fixes": {
            "type": "ARRAY",
            "maxItems": 2,
            "items": {
                "type": "OBJECT",
                "properties": {"issue": {"type": "STRING"}, "cue": {"type": "STRING", "description": "a cue to think about mid-rep, under 6 words"}},
                "required": ["issue", "cue"],
            },
        },
        "next_target": {"type": "INTEGER", "description": "reps for the next set (seconds for a hold)"},
        "rest_seconds": {"type": "INTEGER"},
        "focus": {"type": "STRING", "description": "one thing to focus on next set, under 8 words"},
    },
    "required": ["headline", "feedback", "fixes", "next_target", "rest_seconds", "focus"],
}

SESSION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING", "description": "under 50 characters"},
        "summary": {"type": "STRING", "description": "2 or 3 sentences"},
        "wins": {"type": "ARRAY", "maxItems": 3, "items": {"type": "STRING"}},
        "work_on": {"type": "ARRAY", "maxItems": 2, "items": {"type": "STRING"}},
        "next_session": {
            "type": "OBJECT",
            "properties": {
                "when": {"type": "STRING", "description": "e.g. 'in 2 days'"},
                "plan": {
                    "type": "ARRAY",
                    "maxItems": 5,
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "exercise": {"type": "STRING"},
                            "sets": {"type": "INTEGER"},
                            "target": {"type": "INTEGER"},
                        },
                        "required": ["exercise", "sets", "target"],
                    },
                },
                "note": {"type": "STRING"},
            },
            "required": ["when", "plan", "note"],
        },
    },
    "required": ["title", "summary", "wins", "work_on", "next_session"],
}

EXERCISE_IDS = {"squat", "pushup", "curl", "lunge", "jack", "plank"}


class BadRequest(ValueError):
    pass


def _clip(s: object, n: int) -> str:
    return " ".join(str(s or "").split())[:n]


def _int(v: object, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _system(style: str, goal: str, task: str) -> str:
    return f"You are ReplicAI, the athlete's personal coach. You are {STYLES[style]}. Their goal: {GOALS[goal]}.\n{RULES}\n{task}"


def _check(body: object) -> tuple[str, str, str, dict]:
    if not isinstance(body, dict):
        raise BadRequest("send a JSON object")
    kind, style, goal, data = body.get("kind"), body.get("style", "calm"), body.get("goal", "general"), body.get("data")
    if kind not in ("set", "session"):
        raise BadRequest("kind must be 'set' or 'session'")
    if style not in STYLES:
        raise BadRequest(f"style must be one of {sorted(STYLES)}")
    if goal not in GOALS:
        raise BadRequest(f"goal must be one of {sorted(GOALS)}")
    if not isinstance(data, dict):
        raise BadRequest("data must be an object")
    return kind, style, goal, data


# ---- set ---------------------------------------------------------------------------------------

def _set_unit(data: dict) -> str:
    return "seconds" if (data.get("set") or {}).get("kind") == "hold" else "reps"


def _clean_set(raw: dict, data: dict) -> dict:
    unit = _set_unit(data)
    fixes = [
        {"issue": _clip(f.get("issue"), 80), "cue": _clip(f.get("cue"), 40)}
        for f in (raw.get("fixes") or [])[:2]
        if isinstance(f, dict) and f.get("cue")
    ]
    return {
        "headline": _clip(raw.get("headline"), 70) or "Set logged",
        "feedback": _clip(raw.get("feedback"), 420),
        "fixes": fixes,
        "next_target": _int(raw.get("next_target"), 5 if unit == "seconds" else 1, 600 if unit == "seconds" else 100, 10),
        "unit": unit,
        "rest_seconds": _int(raw.get("rest_seconds"), 15, 300, 90),
        "focus": _clip(raw.get("focus"), 60),
    }


def offline_set(data: dict, goal: str) -> dict:
    """Rule-based coaching from the same numbers, for when no model is reachable."""
    s = data.get("set") or {}
    ex = data.get("exercise") or {}
    faults = sorted((s.get("faults") or {}).items(), key=lambda kv: -kv[1])
    labels = ex.get("faults") or {}
    unit = _set_unit(data)
    rest = {"strength": 120, "endurance": 45, "technique": 90, "general": 75}[goal]
    if unit == "seconds":
        hold = s.get("hold") or {}
        good = float(hold.get("goodS") or 0)
        pct = int(hold.get("goodPct") or 0)
        target = round(good * (1.1 if pct >= 85 else 1.0 if pct >= 60 else 0.8)) or 20
        feedback = f"You held for {hold.get('holdS', 0)} s and {good} s of it was in good form ({pct}%)."
    else:
        reps, good, score = int(s.get("reps") or 0), int(s.get("good") or 0), int(s.get("avgScore") or 0)
        slow = s.get("slowdownPct")
        target = max(1, good + (2 if score >= 85 and (slow is None or slow < 10) else -2 if score < 60 or (slow or 0) > 25 else 0))
        feedback = f"{reps} reps, {good} with clean form, average form score {score}."
        if slow is not None:
            feedback += f" Your lifting speed slowed by {slow}% from the first reps to the last."
    fixes = [{"issue": (labels.get(k) or {}).get("label", k.replace("_", " ")), "cue": (labels.get(k) or {}).get("cue", "")} for k, _ in faults[:2]]
    return {
        "headline": "Clean set" if not faults else f"Work on: {fixes[0]['issue'].lower()}",
        "feedback": feedback,
        "fixes": [f for f in fixes if f["cue"]],
        "next_target": target,
        "unit": unit,
        "rest_seconds": rest,
        "focus": fixes[0]["cue"] if fixes else "Same quality, same tempo",
    }


# ---- session -----------------------------------------------------------------------------------

def _clean_session(raw: dict) -> dict:
    nxt = raw.get("next_session") or {}
    plan = []
    for p in (nxt.get("plan") or [])[:5]:
        if not isinstance(p, dict):
            continue
        ex = str(p.get("exercise", "")).lower().strip()
        if ex not in EXERCISE_IDS:
            continue
        plan.append({"exercise": ex, "sets": _int(p.get("sets"), 1, 8, 3), "target": _int(p.get("target"), 1, 600, 10)})
    return {
        "title": _clip(raw.get("title"), 60) or "Session complete",
        "summary": _clip(raw.get("summary"), 500),
        "wins": [_clip(w, 120) for w in (raw.get("wins") or [])[:3] if w],
        "work_on": [_clip(w, 120) for w in (raw.get("work_on") or [])[:2] if w],
        "next_session": {"when": _clip(nxt.get("when"), 30) or "in 2 days", "plan": plan, "note": _clip(nxt.get("note"), 200)},
    }


def offline_session(data: dict) -> dict:
    sets = data.get("sets") or []
    by_ex: dict[str, list[dict]] = {}
    for s in sets:
        by_ex.setdefault(s.get("exercise", "?"), []).append(s)
    total = sum(int(s.get("good") or 0) for s in sets)
    plan = []
    for ex, ss in by_ex.items():
        if ex not in EXERCISE_IDS:
            continue
        best = max(int(s.get("good") or 0) if s.get("kind") != "hold" else int((s.get("hold") or {}).get("goodS") or 0) for s in ss)
        plan.append({"exercise": ex, "sets": min(5, len(ss) + 1), "target": max(1, best + 1)})
    return {
        "title": "Session complete",
        "summary": f"{len(sets)} sets across {len(by_ex)} exercises, {total} clean reps.",
        "wins": [f"{len(sets)} sets done"],
        "work_on": [],
        "next_session": {"when": "in 2 days", "plan": plan, "note": "Add one rep to your best set of each exercise."},
    }


# ---- entry point -------------------------------------------------------------------------------

def coach(body: object) -> dict:
    kind, style, goal, data = _check(body)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(payload) > 60_000:
        raise BadRequest("data too large")
    if kind == "set":
        system = _system(style, goal, "Coach the set the athlete just finished and set the next set's target.")
        schema, clean, offline = SET_SCHEMA, (lambda r: _clean_set(r, data)), (lambda: offline_set(data, goal))
    else:
        system = _system(style, goal, "Debrief the whole session and plan the next one. Use exercise ids exactly as given.")
        schema, clean, offline = SESSION_SCHEMA, _clean_session, (lambda: offline_session(data))

    if not gemini.configured():
        return {"source": "offline", "reason": "no AI key on the server", "coach": offline()}
    try:
        # A different seed each call keeps two identical sets from getting word-for-word the same advice.
        user = f"Measurements (JSON):\n{payload}\nVariation seed: {random.randint(1, 10**6)}"
        raw, model = gemini.generate_json(system, user, schema, temperature=1.0)
        return {"source": "ai", "model": model, "coach": clean(raw)}
    except gemini.GeminiError as e:
        return {"source": "offline", "reason": f"AI coach unavailable ({e})"[:200], "coach": offline()}
