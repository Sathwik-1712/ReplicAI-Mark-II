import type { Exercise } from "./exercises";
import type { ExerciseId, HoldRecord, RepRecord } from "./types";

export interface SetSummary {
  exercise: ExerciseId;
  kind: "reps" | "hold";
  durationS: number;
  reps: number;
  good: number;
  bad: number;
  uncertain: number;
  avgScore: number;
  avgDepth: number;
  tempo: { toGoal: number; atGoal: number; toStart: number }; // average seconds per phase
  tutS: number; // time under tension: seconds spent inside reps
  faults: Record<string, number>; // how many reps showed each fault
  /** How much slower the lifting half got from the first third of the set to the last (+ = slower). */
  slowdownPct: number | null;
  /** How much shallower the last third was than the first (+ = shallower). */
  depthDropPct: number | null;
  scoreTrend: number | null; // last third minus first third average score
  hold?: HoldRecord;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** First and last third of a set; null when the set is too short to say anything about trends. */
function thirds<T>(xs: T[]): [T[], T[]] | null {
  if (xs.length < 6) return null;
  const k = Math.max(2, Math.floor(xs.length / 3));
  return [xs.slice(0, k), xs.slice(-k)];
}

export function summarizeSet(ex: Exercise, reps: RepRecord[], durationS: number, hold?: HoldRecord): SetSummary {
  const counted = reps.filter((r) => r.quality !== "uncertain");
  const faults: Record<string, number> = {};
  for (const r of reps) for (const f of r.faults) faults[f] = (faults[f] ?? 0) + 1;
  if (hold) Object.assign(faults, hold.faults);

  let slowdownPct: number | null = null, depthDropPct: number | null = null, scoreTrend: number | null = null;
  const t = thirds(counted);
  if (t && ex.kind === "reps") {
    const lift = (r: RepRecord) => (ex.concentric === "toGoal" ? r.toGoal : r.toStart);
    const [a, b] = t;
    const la = avg(a.map(lift)), lb = avg(b.map(lift));
    slowdownPct = la > 0 ? Math.round(((lb - la) / la) * 100) : null;
    const da = avg(a.map((r) => r.depth)), db = avg(b.map((r) => r.depth));
    depthDropPct = da > 0 ? Math.round(((da - db) / da) * 100) : null;
    scoreTrend = Math.round(avg(b.map((r) => r.score)) - avg(a.map((r) => r.score)));
  }

  return {
    exercise: ex.id,
    kind: ex.kind,
    durationS: Math.round(durationS),
    reps: reps.length,
    good: reps.filter((r) => r.quality === "good").length,
    bad: reps.filter((r) => r.quality === "bad").length,
    uncertain: reps.length - counted.length,
    avgScore: Math.round(avg(counted.map((r) => r.score))),
    avgDepth: Math.round(avg(counted.map((r) => r.depth))),
    tempo: {
      toGoal: r2(avg(counted.map((r) => r.toGoal))),
      atGoal: r2(avg(counted.map((r) => r.atGoal))),
      toStart: r2(avg(counted.map((r) => r.toStart))),
    },
    tutS: r1(hold ? hold.holdS : reps.reduce((s, r) => s + r.total, 0)),
    faults,
    slowdownPct,
    depthDropPct,
    scoreTrend,
    hold,
  };
}
