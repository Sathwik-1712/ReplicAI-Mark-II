"""ReplicAI server: the coach API, plus the built web app in production.

Pose tracking, rep counting and workout history all live in the browser; camera frames never reach
this server. It only receives the measured numbers of a finished set when the athlete asks for coaching.
"""

import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from . import coach, gemini

ROOT = Path(__file__).resolve().parents[1]
WEB_DIST = Path(os.environ.get("WEB_DIST", ROOT.parent / "web" / "dist"))
LIMIT, WINDOW_S = 60, 3600  # coach calls per address per hour


def load_env(path: Path = ROOT / ".env") -> None:
    """Reads KEY=value lines into the environment (real environment variables win)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


class RateLimit:
    def __init__(self, limit: int, window_s: int):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


def create_app() -> Flask:
    load_env()
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 128 * 1024
    limiter = RateLimit(LIMIT, WINDOW_S)

    @app.get("/api/health")
    def health():
        return {"ok": True, "ai": gemini.configured()}

    @app.post("/api/coach")
    def coach_route():
        body = request.get_json(silent=True)
        who = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
        try:
            if not limiter.allow(who):
                kind, _, goal, data = coach._check(body)
                result = coach.offline_set(data, goal) if kind == "set" else coach.offline_session(data)
                return {"source": "offline", "reason": "too many coaching requests this hour", "coach": result}
            return coach.coach(body)
        except coach.BadRequest as e:
            return jsonify(error=str(e)), 400

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def web(path: str):
        if path.startswith("api/"):
            return jsonify(error="not found"), 404
        if not (WEB_DIST / "index.html").exists():
            return "Web app not built. Run: cd web && npm run build", 503
        target = WEB_DIST / path
        if path and target.is_file() and target.resolve().is_relative_to(WEB_DIST.resolve()):
            return send_from_directory(WEB_DIST, path, max_age=31536000 if path.startswith("assets/") else 0)
        return send_from_directory(WEB_DIST, "index.html", max_age=0)

    return app
