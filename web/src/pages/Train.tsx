import { useEffect, useRef, useState } from "react";
import { go } from "../App";
import { CoachSetCard, DebriefCard, NextPlan, SetReport, phaseParts, sessionTotals } from "../components/Reports";
import { Button, Glyph, RepStrip, Stat, TempoBar, cx, fmtClock } from "../components/ui";
import { HoldTracker, RepTracker, createTracker, type Tracker, type Update } from "../engine/counter";
import { EXERCISES, EXERCISE_LIST, faultInfo, type Exercise } from "../engine/exercises";
import { summarizeSet } from "../engine/summary";
import type { ExerciseId, HoldRecord, LiveState, PoseFrame, RepRecord } from "../engine/types";
import { coachSession, coachSet } from "../lib/coach";
import { say } from "../lib/speech";
import { getSessions, getSettings, newId, saveSession, useSessions, useSettings, type Session, type SetRecord } from "../lib/store";
import { drawPose } from "../pose/draw";
import { detect, getLandmarker, openCamera } from "../pose/landmarker";

type Stage = "pick" | "studio" | "rest" | "debrief";
/** `?debug` in the address exposes the latest pose to the console as window.__replicai (for testing). */
const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");
const OPEN_FOR_MS = 3 * 3600_000; // an unfinished workout can be continued for 3 hours

function openSession(all: Session[]): Session | null {
  const s = all[0];
  return s && !s.endedAt && s.sets.length > 0 && Date.now() - s.startedAt < OPEN_FOR_MS ? s : null;
}

export default function Train({ initial }: { initial?: ExerciseId }) {
  const sessions = useSessions();
  const [stage, setStage] = useState<Stage>(initial ? "studio" : "pick");
  const [exId, setExId] = useState<ExerciseId>(initial ?? "squat");
  const [session, setSession] = useState<Session | null>(() => openSession(getSessions()));
  const [lastSet, setLastSet] = useState<SetRecord | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [coachBusy, setCoachBusy] = useState(false);
  const ex = EXERCISES[exId];

  // Keep the local copy in step when coaching replies are saved.
  const live = session ? (sessions.find((s) => s.id === session.id) ?? session) : null;
  const plan = sessions.find((s) => s.debrief?.coach.next_session.plan.length)?.debrief?.coach.next_session;

  function targetFor(id: ExerciseId): number | undefined {
    const prev = [...(live?.sets ?? [])].reverse().find((s) => s.exercise === id);
    if (prev?.coach) return prev.coach.coach.next_target;
    return plan?.plan.find((p) => p.exercise === id)?.target;
  }

  async function onSetDone(r: { reps: RepRecord[]; hold?: HoldRecord; startedAt: number; endedAt: number; target?: number }) {
    const base: Session = live ?? { id: newId(), startedAt: r.startedAt, sets: [] };
    const rec: SetRecord = {
      id: newId(),
      exercise: exId,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      reps: r.reps,
      target: r.target,
      summary: summarizeSet(ex, r.reps, (r.endedAt - r.startedAt) / 1000, r.hold),
    };
    const next = { ...base, sets: [...base.sets, rec] };
    saveSession(next);
    setSession(next);
    setLastSet(rec);
    setStage("rest");
    setCoachBusy(true);
    const reply = await coachSet(rec, next, getSessions(), getSettings());
    setCoachBusy(false);
    const latest = getSessions().find((s) => s.id === next.id) ?? next;
    const withCoach = { ...rec, coach: reply };
    saveSession({ ...latest, sets: latest.sets.map((s) => (s.id === rec.id ? withCoach : s)) });
    setLastSet(withCoach);
    if (getSettings().voice && reply.source === "ai") say(reply.coach.headline, { gapMs: 0 });
  }

  async function finishWorkout() {
    if (!live) return go("home");
    const ended = { ...live, endedAt: Date.now() };
    saveSession(ended);
    setSession(ended);
    setStage("debrief");
    setCoachBusy(true);
    const reply = await coachSession(ended, getSessions(), getSettings());
    setCoachBusy(false);
    saveSession({ ...ended, debrief: reply });
    setSession({ ...ended, debrief: reply });
  }

  if (stage === "studio") {
    return (
      <Studio
        key={`${exId}-${live?.sets.length ?? 0}`}
        ex={ex}
        target={targetFor(exId)}
        autoStart={autoStart}
        onCancel={() => setStage(live?.sets.length ? (lastSet ? "rest" : "pick") : "pick")}
        onDone={onSetDone}
      />
    );
  }

  if (stage === "rest" && lastSet && live) {
    const idx = live.sets.findIndex((s) => s.id === lastSet.id) + 1;
    const rec = live.sets.find((s) => s.id === lastSet.id) ?? lastSet;
    return (
      <div className="space-y-5">
        <RestTimer endedAt={rec.endedAt} restS={rec.coach?.coach.rest_seconds} />
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <SetReport rec={rec} index={idx} />
          <div className="space-y-5">
            <CoachSetCard reply={rec.coach} loading={coachBusy} />
            <div className="card flex flex-col gap-3 p-5">
              <Button size="lg" onClick={() => { setAutoStart(true); setStage("studio"); }}>
                Next set{rec.coach ? ` · ${rec.coach.coach.next_target}${rec.coach.coach.unit === "seconds" ? " s" : " reps"}` : ""}
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={() => { setAutoStart(false); setStage("pick"); }}>Switch exercise</Button>
                <Button variant="ghost" onClick={finishWorkout}>Finish workout</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "debrief" && session) {
    const s = sessions.find((x) => x.id === session.id) ?? session;
    const t = sessionTotals(s);
    return (
      <div className="space-y-5">
        <div>
          <div className="label">Workout complete</div>
          <h1 className="display mt-1 text-5xl font-extrabold">Nice work{getSettings().name ? `, ${getSettings().name}` : ""}.</h1>
        </div>
        <div className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <Stat label="Sets" value={s.sets.length} big />
          <Stat label="Good reps" value={t.good} tone="volt" big />
          <Stat label="Avg form" value={t.avg || "–"} unit={t.avg ? "/100" : undefined} big />
          <Stat label="Time" value={fmtClock(t.durationS)} big />
        </div>
        <DebriefCard reply={s.debrief} loading={coachBusy} />
        <div className="space-y-4">
          {s.sets.map((rec, i) => (
            <SetReport key={rec.id} rec={rec} index={i + 1} />
          ))}
        </div>
        <Button size="lg" className="w-full sm:w-auto" onClick={() => go("home")}>Done</Button>
      </div>
    );
  }

  return (
    <Picker
      session={live}
      plan={plan}
      onPick={(id) => {
        setExId(id);
        setAutoStart(false);
        setStage("studio");
      }}
      onFinish={finishWorkout}
    />
  );
}

function Picker({ session, plan, onPick, onFinish }: { session: Session | null; plan?: NonNullable<Session["debrief"]>["coach"]["next_session"]; onPick: (id: ExerciseId) => void; onFinish: () => void }) {
  return (
    <div className="space-y-6">
      {session ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-volt/40 p-4">
          <div>
            <div className="label text-volt">Workout in progress</div>
            <div className="mt-0.5 font-semibold">
              {session.sets.length} set{session.sets.length === 1 ? "" : "s"} · {sessionTotals(session).good} good reps. Pick the next exercise.
            </div>
          </div>
          <Button variant="ghost" onClick={onFinish}>Finish workout</Button>
        </div>
      ) : (
        <div>
          <div className="label">Train</div>
          <h1 className="display mt-1 text-5xl font-extrabold">Pick an exercise</h1>
          <p className="mt-2 max-w-xl text-mute">Your camera tracks 33 points on your body in the browser. Reps, depth, tempo and form are measured live; the video never leaves your device.</p>
        </div>
      )}
      {plan && !session && (
        <div className="card p-5">
          <div className="label text-sky">From your coach</div>
          <NextPlan plan={plan} onStart={onPick} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EXERCISE_LIST.map((e) => (
          <button key={e.id} onClick={() => onPick(e.id)} className="card group flex items-center gap-4 p-4 text-left transition hover:border-volt">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-raise text-chalk group-hover:text-volt">
              <Glyph id={e.id} className="h-11 w-11" />
            </div>
            <div className="min-w-0">
              <div className="display text-2xl font-bold">{e.name}</div>
              <div className="text-sm text-mute">
                {e.kind === "hold" ? "Timed hold" : "Reps"} · {e.view === "side" ? "side-on to camera" : "facing camera"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RestTimer({ endedAt, restS }: { endedAt: number; restS?: number }) {
  const [now, setNow] = useState(Date.now());
  const said = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const target = restS ?? 90;
  const left = target - (now - endedAt) / 1000;
  useEffect(() => {
    if (left <= 0 && !said.current && restS) {
      said.current = true;
      say("Rest is over. Let's go.");
    }
  }, [left, restS]);
  return (
    <div className="card flex items-center justify-between gap-4 p-4">
      <div>
        <div className="label">{left > 0 ? "Rest" : "Rested"}</div>
        <div className={cx("display tabular text-5xl font-bold", left > 0 ? "text-chalk" : "text-volt")}>{left > 0 ? fmtClock(left) : `+${fmtClock(-left)}`}</div>
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raise">
        <div className="h-full bg-volt transition-[width]" style={{ width: `${Math.min(100, ((now - endedAt) / 1000 / target) * 100)}%` }} />
      </div>
      <div className="text-right text-sm text-mute">{restS ? "suggested by your coach" : "default rest"}</div>
    </div>
  );
}

// ---- the camera screen -------------------------------------------------------------------------

interface StudioProps {
  ex: Exercise;
  target?: number;
  autoStart: boolean;
  onCancel: () => void;
  onDone: (r: { reps: RepRecord[]; hold?: HoldRecord; startedAt: number; endedAt: number; target?: number }) => void;
}

function Studio({ ex, target: initialTarget, autoStart, onCancel, onDone }: StudioProps) {
  const settings = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState({ camera: false, model: false });
  const [phase, setPhase] = useState<"setup" | "countdown" | "live">("setup");
  const [count, setCount] = useState(3);
  const [live, setLive] = useState<LiveState>({ status: "loading", message: "Starting camera…", progress: 0, phase: "start", faults: [] });
  const [reps, setReps] = useState<RepRecord[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [target, setTarget] = useState<number>(initialTarget ?? (ex.kind === "hold" ? 30 : 10));
  const [note, setNote] = useState<string | null>(null);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const picker = useRef<HTMLInputElement>(null);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const tracker = useRef<Tracker>(createTracker(ex));
  const repsRef = useRef<RepRecord[]>([]);
  const t0 = useRef({ perf: 0, wall: 0 });
  const lastActive = useRef(0);
  const finished = useRef(false);
  const spoken = useRef({ holdTen: 0, fault: "" , faultAt: 0, targetHit: false });
  const onFrame = useRef<(u: Update, now: number) => void>(() => {});

  function finish() {
    if (finished.current || phaseRef.current !== "live") return;
    const tr = tracker.current;
    const all = tr instanceof RepTracker ? [...repsRef.current, ...tr.drain()] : repsRef.current;
    const hold = tr instanceof HoldTracker ? tr.result() : undefined;
    if (!all.length && !(hold && hold.holdS >= 1)) {
      setPhase("setup");
      setNote(ex.kind === "hold" ? "No hold was recorded. Get into position and try again." : "No reps were counted, so nothing was saved. Check the framing and try again.");
      tracker.current = createTracker(ex);
      return;
    }
    finished.current = true;
    videoRef.current?.pause();
    const endedAt = Date.now();
    say("Set done.", { urgent: true });
    onDone({ reps: all, hold, startedAt: t0.current.wall, endedAt, target });
  }

  const finishRef = useRef(finish);
  finishRef.current = finish;

  onFrame.current = (u, now) => {
    if (u.live.status === "moving") lastActive.current = now;
    if (u.reps.length) {
      repsRef.current = [...repsRef.current, ...u.reps];
      setReps(repsRef.current);
      lastActive.current = now;
      const r = u.reps[u.reps.length - 1];
      const good = repsRef.current.filter((x) => x.quality === "good").length;
      const major = r.faults.find((id) => faultInfo(ex, id).severity === "major") ?? r.faults[0];
      let text = String(r.n);
      if (r.quality === "uncertain") text += ". I couldn't see you clearly";
      else if (major) text += `. ${faultInfo(ex, major).cue}`;
      if (!spoken.current.targetHit && good >= target) {
        spoken.current.targetHit = true;
        text += ". Target hit!";
      }
      say(text, { urgent: true });
    } else if (u.live.faults.length) {
      const id = u.live.faults[0];
      if (id !== spoken.current.fault || now - spoken.current.faultAt > 4000) {
        spoken.current.fault = id;
        spoken.current.faultAt = now;
        say(faultInfo(ex, id).cue, { gapMs: 1500 });
      }
    }
    if (ex.kind === "hold") {
      const s = Math.floor(u.live.goodS ?? 0);
      if (s >= spoken.current.holdTen + 10) {
        spoken.current.holdTen = s - (s % 10);
        say(s >= target && !spoken.current.targetHit ? `${s} seconds. Target hit!` : `${s} seconds`, { gapMs: 0 });
        if (s >= target) spoken.current.targetHit = true;
      }
      if (u.holdEnded) finish();
    } else if (!fileRef.current && repsRef.current.length && now - lastActive.current > settings.autoEndS * 1000) {
      finish();
    }
  };

  // Camera, model and the detection loop.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop = false;
    setError(null);
    (async () => {
      try {
        const v = videoRef.current!;
        if (file) {
          v.srcObject = null;
          v.src = file.url;
          v.onended = () => finishRef.current();
          await new Promise((ok, bad) => {
            v.onloadeddata = ok;
            v.onerror = () => bad(new Error("This video could not be opened. Try an MP4 or WebM file."));
          });
        } else {
          stream = await openCamera();
          if (stop) return;
          v.removeAttribute("src");
          v.srcObject = stream;
          await v.play();
        }
        if (stop) return;
        setReady((r) => ({ ...r, camera: true }));
        setLive((l) => ({ ...l, message: "Loading the pose model…" }));
        const lm = await getLandmarker(settings.quality);
        if (stop) return;
        setReady((r) => ({ ...r, model: true }));
        let lastVt = -1, lastUi = 0;
        const loop = () => {
          raf = requestAnimationFrame(loop);
          if (v.readyState < 2 || v.currentTime === lastVt) return;
          lastVt = v.currentTime;
          let f: PoseFrame | null;
          try {
            f = detect(lm, v);
          } catch {
            return;
          }
          // A recorded video is timed by its own clock, so slow processing cannot stretch the reps.
          const now = fileRef.current ? v.currentTime * 1000 : performance.now();
          if (f) f.t = now;
          const u = tracker.current.update(f, now);
          if (DEBUG) (window as unknown as { __replicai: unknown }).__replicai = { t: now, frame: f, live: u.live };
          if (canvasRef.current) drawPose(canvasRef.current, v, f, u.live.faults, "#c6f432");
          if (phaseRef.current === "live") onFrame.current(u, now);
          if (now - lastUi > 90 || u.reps.length) {
            lastUi = now;
            setLive(u.live);
          }
        };
        loop();
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "The camera or pose model could not start.");
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (v) v.onended = v.onloadeddata = v.onerror = null;
    };
  }, [settings.quality, file]);

  useEffect(() => () => {
    if (file) URL.revokeObjectURL(file.url);
  }, [file]);

  const clock = () => (fileRef.current ? (videoRef.current?.currentTime ?? 0) * 1000 : performance.now());

  function begin() {
    tracker.current = createTracker(ex);
    repsRef.current = [];
    setReps([]);
    spoken.current = { holdTen: 0, fault: "", faultAt: 0, targetHit: false };
    finished.current = false;
    t0.current = { perf: clock(), wall: Date.now() };
    lastActive.current = clock();
    setPhase("live");
  }

  function start() {
    setNote(null);
    if (file && videoRef.current) {
      const v = videoRef.current;
      v.currentTime = 0;
      begin();
      void v.play();
      return;
    }
    setPhase("countdown");
    setCount(3);
  }

  useEffect(() => {
    if (autoStart && ready.model && phase === "setup") start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, ready.model]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count === 0) {
      begin();
      say("Go!", { urgent: true });
      return;
    }
    say(String(count), { urgent: true });
    const t = setTimeout(() => setCount((c) => c - 1), 900);
    return () => clearTimeout(t);
  }, [phase, count, ex]);

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((clock() - t0.current.perf) / 1000), 250);
    return () => clearInterval(t);
  }, [phase]);

  const good = reps.filter((r) => r.quality === "good").length;
  const last = reps.at(-1);
  const mirror = settings.mirror && !file ? { transform: "scaleX(-1)" } : undefined;
  const cue = live.faults[0] ? faultInfo(ex, live.faults[0]).cue : null;
  const unit = ex.kind === "hold" ? "s" : "reps";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-black aspect-[3/4] sm:aspect-video">
        <video ref={videoRef} className={cx("absolute inset-0 h-full w-full", file ? "object-contain" : "object-cover")} style={mirror} playsInline muted aria-label={file ? `Video: ${file.name}` : "Your camera"} />
        <canvas ref={canvasRef} className={cx("absolute inset-0 h-full w-full", file ? "object-contain" : "object-cover")} style={mirror} aria-hidden />

        {(!ready.camera || !ready.model) && !error && (
          <div className="absolute inset-0 grid place-items-center bg-ink/70">
            <div className="text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-volt" />
              <p className="mt-3 font-semibold">{ready.camera ? "Loading the pose model…" : file ? "Opening the video…" : "Starting camera…"}</p>
              {ready.camera && <p className="text-sm text-mute">First time only: about {settings.quality === "full" ? 9 : 6} MB</p>}
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-ink/90 p-6 text-center">
            <div>
              <p className="display text-3xl font-bold text-flare">{file ? "Video unavailable" : "Camera unavailable"}</p>
              <p className="mt-2 max-w-md text-chalk/90">{error}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button variant="ghost" onClick={() => location.reload()}>Try again</Button>
                {!file && <Button variant="ghost" onClick={() => picker.current?.click()}>Analyze a video instead</Button>}
              </div>
            </div>
          </div>
        )}

        {ready.model && !error && (
          <div className="absolute left-3 top-3 flex max-w-[75%] items-center gap-2 rounded-full bg-ink/80 px-3 py-1.5 text-sm font-semibold backdrop-blur" role="status" aria-live="polite">
            <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", live.status === "moving" || live.status === "ready" ? "bg-volt" : live.status === "no_person" ? "bg-flare" : "bg-amber")} />
            <span className="truncate">{live.message}</span>
          </div>
        )}

        {ex.kind === "reps" && ready.model && (
          <div className="absolute bottom-4 right-3 top-16 w-3 overflow-hidden rounded-full bg-ink/70" aria-hidden>
            <div className="absolute inset-x-0 border-t-2 border-dashed border-chalk/70" style={{ bottom: `${(1 / 1.2) * 100}%` }} />
            <div className={cx("absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-75", live.progress >= 0.88 ? "bg-volt" : "bg-chalk")} style={{ height: `${(Math.min(live.progress, 1.2) / 1.2) * 100}%` }} />
          </div>
        )}

        {phase === "countdown" && (
          <div className="absolute inset-0 grid place-items-center bg-ink/40">
            <span key={count} className="display pop text-[9rem] font-extrabold text-volt">{count || "GO"}</span>
          </div>
        )}

        {phase === "live" && (
          <>
            <div className="absolute right-6 top-3 rounded-2xl bg-ink/80 px-4 py-2 text-right backdrop-blur lg:hidden">
              <div className="display tabular text-6xl font-extrabold text-volt">{ex.kind === "hold" ? Math.floor(live.goodS ?? 0) : good}</div>
              <div className="text-xs font-semibold text-mute">{ex.kind === "hold" ? "good seconds" : `good of ${reps.length}`}</div>
            </div>
            {cue && (
              <div className="absolute inset-x-0 bottom-4 flex justify-center px-6">
                <span className="display rounded-xl bg-flare px-5 py-2 text-3xl font-bold text-ink">{cue}</span>
              </div>
            )}
          </>
        )}
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <Glyph id={ex.id} className="h-10 w-10 text-volt" />
            <div className="min-w-0 flex-1">
              <div className="label">{phase === "live" ? `Live · ${fmtClock(elapsed)}` : "Get set"}</div>
              <h2 className="display text-3xl font-bold">{ex.name}</h2>
            </div>
            {phase !== "live" && <Button variant="quiet" size="sm" onClick={onCancel}>Back</Button>}
          </div>

          {phase === "live" ? (
            ex.kind === "hold" ? (
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Stat label="Good form" value={Math.floor(live.goodS ?? 0)} unit="s" tone="volt" big />
                <Stat label="Held" value={Math.floor(live.holdS ?? 0)} unit="s" big />
                <div className="col-span-2 text-sm text-mute">Target {target} s. The timer only runs while your body line holds.</div>
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Stat label="Good" value={<span key={good} className="pop inline-block">{good}</span>} tone="volt" big />
                  <Stat label="Total" value={reps.length} big />
                  <Stat label="Target" value={target} big />
                </div>
                <div className="mt-5 min-h-[92px]">
                  {last ? (
                    <>
                      <div className="flex items-baseline justify-between">
                        <div className="label">Rep {last.n}</div>
                        <div className={cx("display tabular text-2xl font-bold", last.quality === "good" ? "text-volt" : last.quality === "bad" ? "text-flare" : "text-amber")}>
                          {last.score}<span className="text-sm text-mute">/100 · depth {last.depth}%</span>
                        </div>
                      </div>
                      <div className="mt-2">
                        <TempoBar parts={phaseParts({ exercise: ex.id } as SetRecord, last)} />
                      </div>
                      {last.faults.length > 0 && <div className="mt-2 text-sm text-flare">{last.faults.map((id) => faultInfo(ex, id).label).join(" · ")}</div>}
                    </>
                  ) : (
                    <p className="text-sm text-mute">Your first rep's score, depth and tempo show here.</p>
                  )}
                </div>
                <div className="mt-4">
                  <RepStrip reps={reps} height={48} />
                </div>
              </>
            )
          ) : (
            <div className="mt-5 space-y-4">
              <ul className="space-y-2 text-[15px]">
                <Check ok={ready.camera} text={file ? "Video loaded" : "Camera on"} />
                <Check ok={ready.model} text="Pose model loaded" />
                <Check ok={ready.model && live.status !== "no_person"} text="You're in the frame" />
                <Check ok={live.status === "ready"} text={live.status === "ready" ? "In start position" : live.message} warn />
              </ul>
              <div className="rounded-xl bg-raise p-3 text-sm text-chalk/90">
                <div className="label mb-1">Camera</div>
                {ex.view === "side" ? "Put the camera side-on to you, 2 to 3 m away at about hip height." : "Face the camera from 2 to 3 m away so your whole body fits."}
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-mute">
                {ex.howTo.map((h) => <li key={h}>{h}</li>)}
              </ol>
              <div className="flex items-center justify-between gap-3">
                <span className="label">Target</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" aria-label="Lower target" onClick={() => setTarget((t) => Math.max(1, t - (ex.kind === "hold" ? 5 : 1)))}>−</Button>
                  <span className="display tabular w-16 text-center text-3xl font-bold">{target}</span>
                  <Button variant="ghost" size="sm" aria-label="Raise target" onClick={() => setTarget((t) => t + (ex.kind === "hold" ? 5 : 1))}>+</Button>
                  <span className="w-8 text-sm text-mute">{unit}</span>
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-line p-3 text-sm">
                {file ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">Analyzing <b>{file.name}</b></span>
                    <Button size="sm" variant="quiet" onClick={() => { setFile(null); setReady({ camera: false, model: false }); }}>Use camera</Button>
                  </div>
                ) : (
                  <button className="w-full text-left text-mute hover:text-chalk" onClick={() => picker.current?.click()}>
                    <b className="text-chalk">Or analyze a recorded video</b> of your set. It stays on this device.
                  </button>
                )}
                <input
                  ref={picker}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  aria-label="Choose a workout video"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setReady({ camera: false, model: false });
                      setFile({ url: URL.createObjectURL(f), name: f.name });
                    }
                    e.target.value = "";
                  }}
                />
              </div>
              {note && <p className="rounded-xl border border-amber/40 p-3 text-sm text-amber" role="alert">{note}</p>}
            </div>
          )}
        </div>

        {phase === "live" ? (
          <Button size="lg" variant="danger" className="w-full" onClick={finish}>
            End set
          </Button>
        ) : (
          <Button size="lg" className="w-full" disabled={!ready.model || phase === "countdown" || !!error} onClick={start}>
            {phase === "countdown" ? "Get ready…" : file ? "Analyze video" : "Start set"}
          </Button>
        )}
        {phase === "live" && ex.kind === "reps" && <p className="text-center text-xs text-mute">{file ? "The set ends when the video does." : `The set ends by itself after ${settings.autoEndS} s without a rep.`}</p>}
      </aside>
    </div>
  );
}

function Check({ ok, text, warn }: { ok: boolean; text: string; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold", ok ? "bg-volt text-ink" : warn ? "bg-amber/20 text-amber" : "bg-raise text-mute")}>
        {ok ? "✓" : warn ? "!" : "·"}
      </span>
      <span className={ok ? "text-chalk" : "text-mute"}>{text}</span>
    </li>
  );
}
