import pytest

from replicai import coach, create_app, gemini

SET = {
    "kind": "set",
    "style": "hype",
    "goal": "strength",
    "data": {
        "exercise": {"id": "squat", "name": "Squat", "phases": {"toGoal": "down", "atGoal": "bottom", "toStart": "up"},
                     "faults": {"chest_up": {"label": "Chest falling forward", "cue": "Chest up"}}},
        "set": {"kind": "reps", "reps": 10, "good": 8, "bad": 2, "uncertain": 0, "avgScore": 84, "slowdownPct": 22,
                "faults": {"chest_up": 2}, "tempo": {"toGoal": 1.1, "atGoal": 0.3, "toStart": 0.9}},
    },
}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    app = create_app()
    app.testing = True
    return app.test_client()


def test_ai_reply_is_cleaned_and_clamped(client, monkeypatch):
    seen = {}

    def fake(system, user, schema, **kw):
        seen.update(system=system, user=user)
        return {"headline": "x" * 200, "feedback": "Good set.", "fixes": [{"issue": "chest", "cue": "Chest up"}] * 4,
                "next_target": 900, "rest_seconds": 2, "focus": "Chest up"}, "gemini-test"

    monkeypatch.setattr(gemini, "generate_json", fake)
    r = client.post("/api/coach", json=SET).get_json()
    assert r["source"] == "ai" and r["model"] == "gemini-test"
    c = r["coach"]
    assert len(c["headline"]) <= 70 and len(c["fixes"]) == 2
    assert c["next_target"] == 100 and c["rest_seconds"] == 15 and c["unit"] == "reps"
    assert "hype coach" in seen["system"] and "build strength" in seen["system"]
    assert '"slowdownPct":22' in seen["user"]


def test_falls_back_to_offline_coach_when_models_fail(client, monkeypatch):
    def broken(*a, **kw):
        raise gemini.GeminiError("gemini-x: HTTP 429")

    monkeypatch.setattr(gemini, "generate_json", broken)
    r = client.post("/api/coach", json=SET).get_json()
    assert r["source"] == "offline" and "429" in r["reason"]
    assert r["coach"]["fixes"][0]["cue"] == "Chest up"
    assert r["coach"]["next_target"] == 8  # slowed down more than 25%? no (22) and score < 85: keep the clean reps


def test_offline_hold_targets_seconds():
    data = {"exercise": {"id": "plank"}, "set": {"kind": "hold", "hold": {"holdS": 40, "goodS": 38, "goodPct": 95}}}
    c = coach.offline_set(data, "general")
    assert c["unit"] == "seconds" and c["next_target"] == 42


def test_session_plan_keeps_only_known_exercises(client, monkeypatch):
    def fake(*a, **kw):
        return {"title": "Leg day", "summary": "Solid.", "wins": ["a"], "work_on": ["b"],
                "next_session": {"when": "tomorrow", "note": "n", "plan": [
                    {"exercise": "Squat", "sets": 20, "target": 8}, {"exercise": "deadlift", "sets": 3, "target": 5}]}}, "m"

    monkeypatch.setattr(gemini, "generate_json", fake)
    r = client.post("/api/coach", json={"kind": "session", "data": {"sets": []}}).get_json()
    assert r["coach"]["next_session"]["plan"] == [{"exercise": "squat", "sets": 8, "target": 8}]


def test_without_a_key_answers_offline(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("replicai.load_env", lambda *a, **k: None)
    app = create_app()
    r = app.test_client().post("/api/coach", json=SET).get_json()
    assert r["source"] == "offline" and "no AI key" in r["reason"]


@pytest.mark.parametrize("body", [None, {"kind": "x", "data": {}}, {"kind": "set", "style": "rude", "data": {}}, {"kind": "set", "data": []}])
def test_rejects_bad_requests(client, body):
    assert client.post("/api/coach", json=body).status_code == 400


def test_rate_limit_answers_offline(client, monkeypatch):
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: ({}, "m"))
    import replicai

    monkeypatch.setattr(replicai, "LIMIT", 2)
    app = replicai.create_app()
    c = app.test_client()
    sources = [c.post("/api/coach", json=SET).get_json()["source"] for _ in range(3)]
    assert sources == ["ai", "ai", "offline"]


def test_health_and_unknown_api(client):
    assert client.get("/api/health").get_json() == {"ok": True, "ai": True}
    assert client.get("/api/nope").status_code == 404
