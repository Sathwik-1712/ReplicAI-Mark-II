import { go } from "../App";
import { NextPlan, sessionTotals } from "../components/Reports";
import { Button, Glyph, Stat, fmtClock, fmtDay } from "../components/ui";
import { EXERCISE_LIST, EXERCISES } from "../engine/exercises";
import { useSessions, useSettings, type Session } from "../lib/store";

const DAY = 86400000;
const dayKey = (ms: number) => new Date(ms).toDateString();

export function streak(sessions: Session[]): number {
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  let n = 0;
  let d = Date.now();
  if (!days.has(dayKey(d))) d -= DAY; // a streak survives until the end of today
  while (days.has(dayKey(d))) {
    n++;
    d -= DAY;
  }
  return n;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Late session" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const sessions = useSessions();
  const settings = useSettings();
  const week = sessions.filter((s) => Date.now() - s.startedAt < 7 * DAY);
  const weekGood = week.reduce((a, s) => a + sessionTotals(s).good, 0);
  const scored = week.flatMap((s) => s.sets.filter((x) => x.summary.kind === "reps" && x.summary.reps > 0));
  const weekForm = scored.length ? Math.round(scored.reduce((a, x) => a + x.summary.avgScore, 0) / scored.length) : null;
  const plan = sessions.find((s) => s.debrief?.coach.next_session.plan.length)?.debrief;
  const open = sessions[0] && !sessions[0].endedAt && Date.now() - sessions[0].startedAt < 3 * 3600_000 ? sessions[0] : null;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-panel p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-volt/10 blur-3xl" aria-hidden />
        <div className="label">{greeting()}{settings.name ? `, ${settings.name}` : ""}</div>
        <h1 className="display mt-2 max-w-2xl text-5xl font-extrabold sm:text-6xl">
          Every rep <span className="text-volt">counted</span>, checked and timed.
        </h1>
        <p className="mt-3 max-w-xl text-chalk/80">
          Your camera tracks your body as you train. ReplicAI counts reps, scores your form, times each rep, and its AI coach sets your next target from what it measured.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {open ? (
            <Button size="lg" onClick={() => go("train")}>Continue workout · {open.sets.length} sets</Button>
          ) : (
            <Button size="lg" onClick={() => go("train")}>Start a workout</Button>
          )}
          {sessions.length > 0 && <Button size="lg" variant="ghost" onClick={() => go("progress")}>See progress</Button>}
        </div>
      </section>

      {sessions.length > 0 && (
        <section className="card grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
          <Stat label="Streak" value={streak(sessions)} unit="days" tone="volt" big />
          <Stat label="This week" value={week.length} unit="workouts" big />
          <Stat label="Good reps · 7 days" value={weekGood} big />
          <Stat label="Avg form · 7 days" value={weekForm ?? "–"} unit={weekForm ? "/100" : undefined} big />
        </section>
      )}

      {plan && (
        <section className="card border-sky/30 p-5">
          <div className="label text-sky">Your coach's plan</div>
          <h2 className="display mt-1 text-3xl font-bold">{plan.coach.title}</h2>
          <NextPlan plan={plan.coach.next_session} onStart={(id) => go("train", id)} />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="display text-3xl font-bold">Quick start</h2>
          <span className="text-sm text-mute">opens the camera</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {EXERCISE_LIST.map((e) => (
            <button key={e.id} onClick={() => go("train", e.id)} className="card group flex flex-col items-center gap-2 p-4 transition hover:border-volt">
              <Glyph id={e.id} className="h-12 w-12 text-chalk group-hover:text-volt" />
              <span className="font-semibold">{e.name}</span>
            </button>
          ))}
        </div>
      </section>

      {sessions.length > 0 ? (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="display text-3xl font-bold">Recent</h2>
            <a href="#/history" className="text-sm font-semibold text-mute hover:text-chalk">All history →</a>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {sessions.slice(0, 3).map((s) => {
              const t = sessionTotals(s);
              return (
                <a key={s.id} href="#/history" className="card block p-4 hover:border-mute">
                  <div className="label">{fmtDay(s.startedAt)} · {fmtClock(t.durationS)}</div>
                  <div className="mt-1 font-semibold">{s.debrief?.coach.title ?? t.exercises.map((e) => EXERCISES[e].name).join(", ")}</div>
                  <div className="mt-2 flex items-center gap-2 text-mute">
                    {t.exercises.map((e) => <Glyph key={e} id={e} className="h-6 w-6" />)}
                    <span className="ml-auto tabular text-sm">{s.sets.length} sets · {t.good} good</span>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-3">
          {[
            ["1", "Set up the camera", "Prop your phone or laptop 2 to 3 m away. Side-on for most exercises; facing it for jumping jacks."],
            ["2", "Train", "Reps are counted live with a voice count. A red cue appears the moment your form slips."],
            ["3", "Get coached", "After each set your AI coach reads the numbers (never the video) and sets your next target."],
          ].map(([n, h, p]) => (
            <div key={n} className="card p-5">
              <div className="display text-5xl font-extrabold text-volt">{n}</div>
              <div className="mt-2 font-semibold">{h}</div>
              <p className="mt-1 text-sm text-mute">{p}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
