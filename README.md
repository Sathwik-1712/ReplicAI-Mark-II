# ReplicAI Mark II

**An AI workout coach that watches you train through your camera.** It counts every rep, scores your form, times each phase of the rep, and after every set an AI coach reads the numbers and sets your next target.

Mark II is a full rebuild of [ReplicAI](https://github.com/Sathwik-1712/ReplicAi-DevHack2.0-project) (DevHack 2.0).

## What it does

| | |
|---|---|
| **Counts reps** | Squat, push-up, lunge, bicep curl, jumping jack, plus a timed plank hold. Each rep has to start from the resting position and reach real range, so fidgeting doesn't count. |
| **Checks form** | Every rep gets a 0–100 score, a depth (% of full range) and named faults: knees caving in, chest falling forward, hips sagging or piking, swinging, elbows drifting, shallow reps, rushed descents. Faulty joints turn red on the live skeleton. |
| **Times every rep** | Seconds for each phase (down / bottom / up for a squat), time under tension, and fatigue: how much the lift slowed and depth dropped from the first reps to the last. |
| **Talks to you** | Spoken rep counts and form cues ("Seven. Chest up!"), a countdown, and a rest timer. |
| **AI coach** *(non-deterministic)* | After each set, Gemini reads that set's measurements and your history. It names where your form broke down, compares with earlier sets, gives up to two cues and sets the next target and rest. At the end of a workout it writes a debrief and plans the next session. There are four personalities (calm, hype, drill sergeant, sports scientist) and four goals. Ask twice and you get different words, but always from the same measured numbers. |
| **Analyzes videos** | Don't want to train live? Pick a recorded video of your set; it is analyzed the same way, timed by the video's own clock. |
| **Tracks progress** | History of every workout, and per-exercise charts: best set, form score, depth, time under tension, longest plank. Data can be exported and imported. |

## How it works

```
camera ──► MediaPipe Pose (in the browser, 33 body points, ~30 fps)
                │
                ▼
        rep engine (TypeScript, unit-tested)
        one-euro smoothing → progress 0..1 → rep state machine
        → depth, phase timings, form checks, score
                │                                   ┌────────────────────────┐
                ├──► live UI, skeleton, voice cues   │ Flask server            │
                ▼                                   │ /api/coach → Gemini     │
        set summary (numbers only) ────────────────►│ checks + clamps reply,  │
                                                    │ offline coach fallback  │
        localStorage: workouts, settings  ◄─────────└────────────────────────┘
```

- **The video never leaves the device.** Pose tracking runs in the browser (WebAssembly + WebGL). The server only ever receives the measured numbers of a finished set.
- **The model interprets; it doesn't measure.** Counting, scoring and timing are deterministic code with tests. The AI only reads those numbers. Its reply is validated and clamped (targets 1–100 reps, rest 15–300 s), and every AI-written text is marked with an "AI coach" badge.
- **It keeps working without AI.** With no key, no quota or no network, a rule-based "offline coach" answers from the same numbers and is labelled as such.
- **No login.** Workouts live in the browser's storage, with export and import for backups.

## Run it

You need Node 20+ and [uv](https://docs.astral.sh/uv/).

```bash
# 1. the AI coach key (free at https://aistudio.google.com/apikey)
cp server/.env.example server/.env      # then put your key after GEMINI_API_KEY=

# 2. build the web app
cd web && npm install && npm run build && cd ..

# 3. run the server (serves the app and the coach API)
cd server && uv run python main.py      # http://127.0.0.1:5001
```

For development with hot reload, run `uv run python main.py` in `server/` and `npm run dev` in `web/` (Vite proxies `/api` to port 5001), then open http://localhost:5173.

The camera needs `localhost` or `https`. Allow camera access when the browser asks.

### Camera tips

- 2–3 m away, whole body in frame, decent light.
- **Side-on** for squats, push-ups, lunges, planks and curls (or at 45°); **facing the camera** for jumping jacks.
- The setup screen tells you when you're in frame and in the start position.

## Tests

```bash
cd web && npm test           # rep engine: 20 tests on synthetic skeletons (timing, faults, edge cases)
cd web && npm run typecheck
cd server && uv run pytest   # coach API: cleaning/clamping AI replies, fallbacks, rate limit, validation
cd server && uv run ruff check .
```

The engine was also checked end to end against real, freely licensed exercise videos from Wikimedia Commons: squats, jumping jacks, Army hand-release push-ups, lunges and bicep curls. Counts and rep timings were compared frame by frame with what the video shows.

## Deploy

One service runs everything. For example, on Render (free plan) as a Python web service:

- **Build:** `pip install uv && cd web && npm ci && npm run build && cd ../server && uv sync --frozen --no-dev`
- **Start:** `cd server && uv run gunicorn -b 0.0.0.0:$PORT 'replicai:create_app()'`
- **Environment:** `GEMINI_API_KEY` (and optionally `GEMINI_MODELS`, a comma-separated list tried in order)

## Project layout

```
web/                 React 19 + TypeScript + Tailwind 4 (Vite)
  src/engine/        rep engine: geometry, smoothing, exercises, counter, summary (+ tests)
  src/pose/          MediaPipe setup, camera, skeleton drawing
  src/lib/           storage, speech, coach client
  src/pages/         Home, Train, History, Progress, Settings
server/              Flask
  replicai/coach.py  prompts, response schemas, validation, offline coach
  replicai/gemini.py Gemini REST client with model fallback
  tests/
```

## Limits worth knowing

- One person at a time. With several people in view, the most prominent one is tracked.
- Depth for curls is most accurate side-on; facing the camera hides how far the forearm travels.
- Squatting down to pick something up looks like a lunge to the tracker, so start a lunge set once you're holding the weights.
- Feedback is for training, not medical advice. Stop if anything hurts.

## Credits

Original ReplicAI (DevHack 2.0): Sathwik A Shetty, Ankith R Rai, Sidvin. Mark II rebuild by Sathwik A Shetty.
Pose tracking: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (Apache 2.0). AI coach: Google Gemini.
