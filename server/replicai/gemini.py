"""Minimal Gemini client (REST, standard library only).

Tries each model in GEMINI_MODELS in order: the free tier has a small daily quota per model, and
any model can be busy (429/503) at a given moment.
"""

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODELS = "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3-flash-preview"
RETRYABLE = {404, 408, 429, 500, 502, 503, 504}


class GeminiError(Exception):
    pass


def configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def models() -> list[str]:
    return [m.strip() for m in os.environ.get("GEMINI_MODELS", DEFAULT_MODELS).split(",") if m.strip()]


def _post(model: str, body: dict, key: str, timeout: float) -> dict:
    req = urllib.request.Request(
        URL.format(model=model),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _text(resp: dict) -> str:
    parts = (resp.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


def generate_json(system: str, user: str, schema: dict, *, temperature: float = 1.0, timeout: float = 25) -> tuple[dict, str]:
    """Returns (parsed JSON, model name). Raises GeminiError when every model fails."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise GeminiError("no GEMINI_API_KEY")
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": temperature,
            "topP": 0.95,
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    problems = []
    for model in models():
        try:
            text = _text(_post(model, body, key, timeout))
            return json.loads(text), model
        except urllib.error.HTTPError as e:
            problems.append(f"{model}: HTTP {e.code}")
            if e.code not in RETRYABLE:
                detail = e.read()[:300].decode(errors="replace")
                log.warning("Gemini %s refused the request: %s", model, detail)
        except (urllib.error.URLError, TimeoutError) as e:
            problems.append(f"{model}: {type(e).__name__}")
        except (json.JSONDecodeError, KeyError, IndexError) as e:
            problems.append(f"{model}: unusable reply ({type(e).__name__})")
    raise GeminiError("; ".join(problems) or "no models configured")
