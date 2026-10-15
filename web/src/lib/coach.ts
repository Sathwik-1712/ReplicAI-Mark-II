/** Builds what the coach sees (measurements only, never video) and asks the server. */
import { EXERCISES, type Exercise } from "../engine/exercises";
import type { CoachReply, CoachSession, CoachSet, Session, SetRecord, Settings } from "./store";

function exerciseInfo(ex: Exercise) {
  const faults = Object.fromEntries(Object.entries(ex.faults).map(([k, f]) => [k, { label: f.label, cue: f.cue }]));
  return ex.kind === "reps" ? { id: ex.id, name: ex.name, kind: ex.kind, phases: ex.phases, faults } : { id: ex.id, name: ex.name, kind: ex.kind, faults };
}

/** Rep times under the exercise's own phase names, e.g. down_s / bottom_s / up_s for a squat. */
function repRows(ex: Exercise, set: SetRecord) {
  if (ex.kind !== "reps") return [];
  const ph = ex.phases;
  const name = (p: string) => `${p.replace(/\s+/g, "_")}_s`;
  return set.reps.slice(0, 60).map((r) => {
    const row: Record<string, unknown> = { n: r.n, score: r.score, depth: r.depth, quality: r.quality, faults: r.faults };
    row[name(ph.toGoal)] = r.toGoal;
    row[ph.atGoal === ph.toGoal ? "pause_s" : name(ph.atGoal)] = r.atGoal;
    row[name(ph.toStart)] = r.toStart;
    if (r.side && r.side !== "both") row.side = r.side;
    return row;
  });
}

const compact = (s: SetRecord) => {
  const m = s.summary;
  return m.kind === "hold"
    ? { exercise: s.exercise, kind: m.kind, hold: m.hold }
    : { exercise: s.exercise, kind: m.kind, reps: m.reps, good: m.good, avgScore: m.avgScore, avgDepth: m.avgDepth, slowdownPct: m.slowdownPct };
};

export function setPayload(set: SetRecord, session: Session, history: Session[]) {
  const ex = EXERCISES[set.exercise];
  const same = session.sets.filter((s) => s.exercise === set.exercise && s.id !== set.id);
  const before = history
    .filter((h) => h.id !== session.id)
    .flatMap((h) => h.sets.filter((s) => s.exercise === set.exercise).map((s) => ({ date: new Date(h.startedAt).toISOString().slice(0, 10), ...compact(s) })))
    .slice(0, 5);
  const { hold, ...summary } = set.summary;
  return {
    exercise: exerciseInfo(ex),
    set_number: same.length + 1,
    target: set.target ?? null,
    set: hold ? { ...summary, hold } : summary,
    reps: repRows(ex, set),
    previous_sets: same.map((s, i) => ({ set: i + 1, ...compact(s) })),
    earlier_workouts: before,
  };
}

export function sessionPayload(session: Session, history: Session[]) {
  const durationMin = Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 60000);
  const last30 = history.filter((h) => h.id !== session.id && Date.now() - h.startedAt < 30 * 86400000);
  return {
    duration_min: durationMin,
    sets: session.sets.map((s, i) => ({ set: i + 1, ...compact(s), faults: s.summary.faults, coach_target: s.coach?.coach.next_target })),
    workouts_last_30_days: last30.length,
    exercises_available: Object.keys(EXERCISES),
  };
}

async function post<T>(kind: "set" | "session", data: unknown, settings: Settings): Promise<CoachReply<T>> {
  const r = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, style: settings.style, goal: settings.goal, data }),
  });
  if (!r.ok) throw new Error(`coach answered ${r.status}`);
  return (await r.json()) as CoachReply<T>;
}

export async function coachSet(set: SetRecord, session: Session, history: Session[], settings: Settings): Promise<CoachReply<CoachSet>> {
  try {
    return await post<CoachSet>("set", setPayload(set, session, history), settings);
  } catch {
    return localSet(set);
  }
}

export async function coachSession(session: Session, history: Session[], settings: Settings): Promise<CoachReply<CoachSession>> {
  try {
    return await post<CoachSession>("session", sessionPayload(session, history), settings);
  } catch {
    return {
      source: "offline",
      reason: "coach server unreachable",
      coach: { title: "Session complete", summary: `${session.sets.length} sets logged.`, wins: [], work_on: [], next_session: { when: "in 2 days", plan: [], note: "" } },
    };
  }
}

/** Last resort when the server itself cannot be reached. */
function localSet(set: SetRecord): CoachReply<CoachSet> {
  const ex = EXERCISES[set.exercise];
  const top = Object.entries(set.summary.faults).sort((a, b) => b[1] - a[1])[0];
  const f = top ? ex.faults[top[0]] : undefined;
  const hold = set.summary.hold;
  return {
    source: "offline",
    reason: "coach server unreachable",
    coach: {
      headline: f ? `Work on: ${f.label.toLowerCase()}` : "Clean set",
      feedback: hold ? `${hold.goodS} s of good form.` : `${set.summary.good} of ${set.summary.reps} reps were clean.`,
      fixes: f ? [{ issue: f.label, cue: f.cue }] : [],
      next_target: hold ? Math.max(10, Math.round(hold.goodS)) : Math.max(1, set.summary.good),
      unit: hold ? "seconds" : "reps",
      rest_seconds: 90,
      focus: f?.cue ?? "Same again",
    },
  };
}
