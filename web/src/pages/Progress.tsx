import { useMemo, useState } from "react";
import { go } from "../App";
import { Button, Glyph, LineChart, Stat, cx } from "../components/ui";
import { EXERCISES, EXERCISE_LIST } from "../engine/exercises";
import type { ExerciseId } from "../engine/types";
import { useSessions, type Session, type SetRecord } from "../lib/store";

const label = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function perSession(sessions: Session[], id: ExerciseId) {
  return [...sessions]
    .reverse()
    .map((s) => ({ s, sets: s.sets.filter((x) => x.exercise === id) }))
    .filter((x) => x.sets.length > 0);
}

export default function Progress() {
  const sessions = useSessions();
  const done = useMemo(() => EXERCISE_LIST.filter((e) => sessions.some((s) => s.sets.some((x) => x.exercise === e.id))), [sessions]);
  const [pick, setPick] = useState<ExerciseId | null>(null);
  const id = pick ?? done[0]?.id;

  if (!id) {
    return (
      <div className="card p-8 text-center">
        <h1 className="display text-4xl font-bold">Progress shows up after your first set</h1>
        <Button className="mt-5" onClick={() => go("train")}>Start a workout</Button>
      </div>
    );
  }

  const ex = EXERCISES[id];
  const rows = perSession(sessions, id);
  const all: SetRecord[] = rows.flatMap((r) => r.sets);
  // Best average form in a set, preferring real working sets (3+ judged reps) over one-rep tries.
  const judged = all.filter((x) => x.summary.reps - x.summary.uncertain > 0);
  const working = judged.filter((x) => x.summary.reps - x.summary.uncertain >= 3);
  const bestForm = judged.length ? Math.max(...(working.length ? working : judged).map((x) => x.summary.avgScore)) : null;

  return (
    <div className="space-y-5">
      <div>
        <div className="label">Progress</div>
        <h1 className="display mt-1 text-5xl font-extrabold">{ex.name}</h1>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {done.map((e) => (
          <button key={e.id} role="tab" aria-selected={e.id === id} onClick={() => setPick(e.id)} className={cx("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold", e.id === id ? "border-volt text-volt" : "border-line text-mute hover:text-chalk")}>
            <Glyph id={e.id} className="h-5 w-5" />
            {e.name}
          </button>
        ))}
      </div>

      {ex.kind === "hold" ? (
        <>
          <div className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
            <Stat label="Best good-form hold" value={Math.round(Math.max(...all.map((x) => x.summary.hold?.goodS ?? 0)))} unit="s" tone="volt" big />
            <Stat label="Total held" value={Math.round(all.reduce((a, x) => a + (x.summary.hold?.holdS ?? 0), 0))} unit="s" big />
            <Stat label="Sets" value={all.length} big />
          </div>
          <div className="card p-5">
            <div className="label mb-3">Longest good-form hold per workout (seconds)</div>
            <LineChart points={rows.map((r) => ({ label: label(r.s.startedAt), y: Math.round(Math.max(...r.sets.map((x) => x.summary.hold?.goodS ?? 0))) }))} unit=" s" />
          </div>
        </>
      ) : (
        <>
          <div className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <Stat label="Best set" value={Math.max(...all.map((x) => x.summary.good))} unit="good reps" tone="volt" big />
            <Stat label="Best form" value={bestForm ?? "–"} unit={bestForm === null ? undefined : "/100"} big />
            <Stat label="All-time" value={all.reduce((a, x) => a + x.summary.good, 0)} unit="good reps" big />
            <Stat label="Sets" value={all.length} big />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <div className="label mb-3">Good reps in your best set</div>
              <LineChart points={rows.map((r) => ({ label: label(r.s.startedAt), y: Math.max(...r.sets.map((x) => x.summary.good)) }))} />
            </div>
            <div className="card p-5">
              <div className="label mb-3">Average form score</div>
              <LineChart color="var(--color-sky)" points={rows.map((r) => ({ label: label(r.s.startedAt), y: Math.round(avg(r.sets.map((x) => x.summary.avgScore))) }))} unit="/100" />
            </div>
            <div className="card p-5">
              <div className="label mb-3">Average depth (% of full range)</div>
              <LineChart color="var(--color-amber)" points={rows.map((r) => ({ label: label(r.s.startedAt), y: Math.round(avg(r.sets.map((x) => x.summary.avgDepth))) }))} unit="%" />
            </div>
            <div className="card p-5">
              <div className="label mb-3">Time under tension per workout (seconds)</div>
              <LineChart color="var(--color-chalk)" points={rows.map((r) => ({ label: label(r.s.startedAt), y: Math.round(r.sets.reduce((a, x) => a + x.summary.tutS, 0)) }))} unit=" s" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
