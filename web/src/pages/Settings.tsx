import { useEffect, useRef, useState } from "react";
import { Button, Spark, cx } from "../components/ui";
import { say } from "../lib/speech";
import { clearAll, exportJson, importJson, updateSettings, useSessions, useSettings, type CoachStyle, type Goal } from "../lib/store";

const STYLES: { id: CoachStyle; name: string; line: string }[] = [
  { id: "calm", name: "Calm", line: "Nice and steady. Let's keep that chest proud next set." },
  { id: "hype", name: "Hype", line: "That's what I'm talking about! Two more next time!" },
  { id: "drill", name: "Drill sergeant", line: "Rep nine was sloppy. You're better than that. Again." },
  { id: "science", name: "Sports scientist", line: "Your lift slowed 28%: close to failure, so rest longer." },
];
const GOALS: { id: Goal; name: string; hint: string }[] = [
  { id: "general", name: "General fitness", hint: "balanced reps and rest" },
  { id: "strength", name: "Strength", hint: "fewer reps, longer rest" },
  { id: "endurance", name: "Endurance", hint: "more reps, short rest" },
  { id: "technique", name: "Technique", hint: "slow, perfect reps" },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx("relative h-7 w-12 rounded-full transition", on ? "bg-volt" : "bg-raise border border-line")}>
      <span className={cx("absolute top-0.5 h-6 w-6 rounded-full bg-ink transition-all", on ? "left-[22px]" : "left-0.5 bg-mute")} />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-4 first:border-t-0">
      <div>
        <div className="font-semibold">{title}</div>
        {hint && <div className="text-sm text-mute">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const s = useSettings();
  const sessions = useSessions();
  const [ai, setAi] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { ai?: boolean }) => setAi(!!d.ai))
      .catch(() => setAi(false));
  }, []);

  function download() {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `replicai-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(f: File) {
    try {
      const n = importJson(await f.text());
      setMsg(`Imported ${n} workout${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That file could not be read.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="label">Settings</div>
        <h1 className="display mt-1 text-5xl font-extrabold">Your coach</h1>
      </div>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="display text-2xl font-bold">Personality</h2>
          <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", ai ? "bg-sky/15 text-sky" : "bg-raise text-mute")}>
            <Spark /> {ai === null ? "Checking coach…" : ai ? "AI coach online" : "AI coach offline: rule-based tips"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {STYLES.map((st) => (
            <button key={st.id} onClick={() => updateSettings({ style: st.id })} aria-pressed={s.style === st.id} className={cx("rounded-xl border p-4 text-left transition", s.style === st.id ? "border-sky bg-sky/10" : "border-line hover:border-mute")}>
              <div className="font-semibold">{st.name}</div>
              <div className="mt-1 text-sm italic text-mute">“{st.line}”</div>
            </button>
          ))}
        </div>
        <h2 className="display mt-6 text-2xl font-bold">Goal</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GOALS.map((g) => (
            <button key={g.id} onClick={() => updateSettings({ goal: g.id })} aria-pressed={s.goal === g.id} className={cx("rounded-xl border p-3 text-left", s.goal === g.id ? "border-volt bg-volt/10" : "border-line hover:border-mute")}>
              <div className="font-semibold">{g.name}</div>
              <div className="text-xs text-mute">{g.hint}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card px-5 py-1">
        <Row title="Your name" hint="Used in greetings only">
          <input value={s.name} onChange={(e) => updateSettings({ name: e.target.value.slice(0, 30) })} placeholder="Optional" className="h-10 w-48 rounded-lg border border-line bg-raise px-3 outline-none focus:border-volt" aria-label="Your name" />
        </Row>
        <Row title="Voice cues" hint="Counts reps out loud and calls form fixes">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="quiet" onClick={() => say("Seven. Chest up!", { urgent: true })} disabled={!s.voice}>Test</Button>
            <Toggle label="Voice cues" on={s.voice} onChange={(v) => updateSettings({ voice: v })} />
          </div>
        </Row>
        <Row title="End a set automatically" hint={`After ${s.autoEndS} seconds without a rep`}>
          <input type="range" min={4} max={20} value={s.autoEndS} onChange={(e) => updateSettings({ autoEndS: Number(e.target.value) })} className="w-48 accent-[var(--color-volt)]" aria-label="Seconds before a set ends" />
        </Row>
        <Row title="Tracking accuracy" hint="Full is more precise; Lite is faster on older phones">
          <div className="flex rounded-lg border border-line p-1">
            {(["full", "lite"] as const).map((q) => (
              <button key={q} onClick={() => updateSettings({ quality: q })} aria-pressed={s.quality === q} className={cx("rounded-md px-3 py-1.5 text-sm font-semibold capitalize", s.quality === q ? "bg-raise text-chalk" : "text-mute")}>
                {q}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Mirror camera" hint="Show yourself like a mirror">
          <Toggle label="Mirror camera" on={s.mirror} onChange={(v) => updateSettings({ mirror: v })} />
        </Row>
      </section>

      <section className="card p-5">
        <h2 className="display text-2xl font-bold">Your data</h2>
        <p className="mt-1 text-sm text-mute">
          {sessions.length} workout{sessions.length === 1 ? "" : "s"} saved in this browser. Video is processed on this device and never uploaded; only the measured numbers of a set are sent to the coach.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="ghost" onClick={download} disabled={!sessions.length}>Export backup</Button>
          <Button variant="ghost" onClick={() => file.current?.click()}>Import backup</Button>
          <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {wipe ? (
            <span className="flex items-center gap-2 text-sm">
              Delete every workout?
              <Button size="sm" variant="danger" onClick={() => { clearAll(); setWipe(false); setMsg("All workouts deleted."); }}>Delete all</Button>
              <Button size="sm" variant="quiet" onClick={() => setWipe(false)}>Cancel</Button>
            </span>
          ) : (
            <Button variant="danger" onClick={() => setWipe(true)} disabled={!sessions.length}>Delete all workouts</Button>
          )}
        </div>
        {msg && <p className="mt-3 text-sm text-volt" role="status">{msg}</p>}
      </section>

      <p className="text-xs text-mute">
        ReplicAI gives training feedback, not medical advice. Stop if anything hurts. Pose tracking uses Google MediaPipe on your device; MediaPipe may send anonymous performance metrics to Google.
      </p>
    </div>
  );
}
