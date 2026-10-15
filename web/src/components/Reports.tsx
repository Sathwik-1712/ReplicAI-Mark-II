import { useState } from "react";
import { EXERCISES, faultInfo } from "../engine/exercises";
import type { CoachReply, CoachSession, CoachSet, Session, SetRecord } from "../lib/store";
import { AiBadge, Glyph, RepStrip, Spark, Stat, TempoBar, cx, fmtClock, fmtS } from "./ui";

export function phaseParts(rec: SetRecord, t: { toGoal: number; atGoal: number; toStart: number }) {
  const ex = EXERCISES[rec.exercise];
  if (ex.kind !== "reps") return [];
  return [
    { label: ex.phases.toGoal, s: t.toGoal },
    { label: ex.phases.atGoal === ex.phases.toGoal ? "pause" : ex.phases.atGoal, s: t.atGoal },
    { label: ex.phases.toStart, s: t.toStart },
  ];
}

function fatigueNote(rec: SetRecord): string | null {
  const s = rec.summary;
  if (s.slowdownPct === null) return null;
  const v = s.slowdownPct;
  const lead = v > 0 ? `Your lifting speed slowed ${v}% from the first reps to the last` : `Your lifting speed held steady (${v >= -3 ? "no slowdown" : `${-v}% faster at the end`})`;
  const tail = v > 25 ? ", so you were close to failure." : v > 10 ? ": a hard set with a little left." : ": there was more in the tank.";
  const depth = s.depthDropPct !== null && s.depthDropPct > 5 ? ` Depth dropped ${s.depthDropPct}% as you tired.` : "";
  return lead + tail + depth;
}

/** Everything measured in one set. */
export function SetReport({ rec, index }: { rec: SetRecord; index?: number }) {
  const ex = EXERCISES[rec.exercise];
  const s = rec.summary;
  const [table, setTable] = useState(false);
  const faults = Object.entries(s.faults).sort((a, b) => b[1] - a[1]);
  const fatigue = fatigueNote(rec);

  return (
    <section className="card p-5" aria-label={`${ex.name} set report`}>
      <div className="flex items-center gap-3">
        <Glyph id={ex.id} className="h-9 w-9 text-volt" />
        <div>
          <div className="label">{index ? `Set ${index}` : "Set"} · {fmtClock(s.durationS)}</div>
          <h3 className="display text-3xl font-bold">{ex.name}</h3>
        </div>
      </div>

      {s.kind === "hold" && s.hold ? (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Good form" value={Math.round(s.hold.goodS)} unit="s" tone="volt" big />
          <Stat label="Held" value={Math.round(s.hold.holdS)} unit="s" />
          <Stat label="In form" value={s.hold.goodPct} unit="%" />
          <Stat label="Best streak" value={Math.round(s.hold.longestGoodS)} unit="s" />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-6">
            <Stat label="Good" value={s.good} tone="volt" big />
            <Stat label="Bad" value={s.bad} tone={s.bad ? "flare" : undefined} big />
            <Stat label="Unclear" value={s.uncertain} tone={s.uncertain ? "amber" : undefined} big />
            <Stat label="Form" value={s.avgScore} unit="/100" />
            <Stat label="Depth" value={s.avgDepth} unit="%" />
            <Stat label="Under tension" value={Math.round(s.tutS)} unit="s" />
          </div>
          <div className="mt-5">
            <div className="label mb-2">Average rep tempo</div>
            <TempoBar parts={phaseParts(rec, s.tempo)} />
          </div>
          <div className="mt-5">
            <div className="label mb-2">Form score per rep</div>
            <RepStrip reps={rec.reps} />
          </div>
        </>
      )}

      {fatigue && <p className="mt-4 text-[15px] text-chalk/90">{fatigue}</p>}

      {faults.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {faults.map(([id, n]) => {
            const f = faultInfo(ex, id);
            return (
              <span key={id} className={cx("rounded-full border px-3 py-1 text-sm", f.severity === "major" ? "border-flare/50 text-flare" : "border-amber/40 text-amber")}>
                {f.label} · {n}×
              </span>
            );
          })}
        </div>
      )}

      {s.kind === "reps" && rec.reps.length > 0 && (
        <div className="mt-4">
          <button className="text-sm font-semibold text-mute hover:text-chalk" onClick={() => setTable(!table)} aria-expanded={table}>
            {table ? "Hide" : "Show"} every rep
          </button>
          {table && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm tabular">
                <thead className="text-mute">
                  <tr>
                    <th className="py-1.5 pr-3 font-semibold">#</th>
                    <th className="pr-3 font-semibold">Score</th>
                    <th className="pr-3 font-semibold">Depth</th>
                    {phaseParts(rec, { toGoal: 0, atGoal: 0, toStart: 0 }).map((p) => (
                      <th key={p.label} className="pr-3 font-semibold capitalize">{p.label}</th>
                    ))}
                    <th className="font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.reps.map((r) => (
                    <tr key={r.n} className="border-t border-line">
                      <td className="py-1.5 pr-3">{r.n}</td>
                      <td className={cx("pr-3 font-semibold", r.quality === "good" ? "text-volt" : r.quality === "bad" ? "text-flare" : "text-amber")}>{r.score}</td>
                      <td className="pr-3">{r.depth}%</td>
                      <td className="pr-3">{fmtS(r.toGoal)}</td>
                      <td className="pr-3">{fmtS(r.atGoal)}</td>
                      <td className="pr-3">{fmtS(r.toStart)}</td>
                      <td className="text-mute">
                        {r.quality === "uncertain" ? "Camera could not see you clearly. " : ""}
                        {r.faults.map((id) => faultInfo(ex, id).label).join(", ")}
                        {r.side && r.side !== "both" ? ` (${r.side})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function CoachSetCard({ reply, loading }: { reply?: CoachReply<CoachSet>; loading?: boolean }) {
  if (loading && !reply) {
    return (
      <section className="card border-sky/30 p-5" aria-busy="true" aria-label="Coach is reading your set">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky">
          <Spark className="h-4 w-4 animate-pulse" /> Your coach is reading the set…
        </div>
        <div className="shimmer mt-4 h-7 w-3/4" />
        <div className="shimmer mt-3 h-4 w-full" />
        <div className="shimmer mt-2 h-4 w-5/6" />
      </section>
    );
  }
  if (!reply) return null;
  const c = reply.coach;
  return (
    <section className="card border-sky/30 p-5" aria-label="Coach feedback">
      <AiBadge reply={reply} />
      <h3 className="display mt-3 text-3xl font-bold text-sky">{c.headline}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-chalk/90">{c.feedback}</p>
      {c.fixes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {c.fixes.map((f, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <span className="rounded-md bg-sky/15 px-2 py-0.5 text-sm font-bold text-sky">“{f.cue}”</span>
              <span className="text-sm text-mute">{f.issue}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
        <Stat label="Next set" value={c.next_target} unit={c.unit === "seconds" ? "s" : "reps"} tone="sky" />
        <Stat label="Rest" value={c.rest_seconds} unit="s" />
        <div className="min-w-0">
          <div className="label">Focus</div>
          <div className="mt-1 text-[15px] font-semibold leading-snug">{c.focus}</div>
        </div>
      </div>
    </section>
  );
}

export function sessionTotals(s: Session) {
  const reps = s.sets.reduce((a, x) => a + x.summary.reps, 0);
  const good = s.sets.reduce((a, x) => a + x.summary.good, 0);
  const scored = s.sets.filter((x) => x.summary.kind === "reps" && x.summary.reps > 0);
  const avg = scored.length ? Math.round(scored.reduce((a, x) => a + x.summary.avgScore, 0) / scored.length) : 0;
  const holdS = s.sets.reduce((a, x) => a + (x.summary.hold?.goodS ?? 0), 0);
  const durationS = ((s.endedAt ?? s.sets.at(-1)?.endedAt ?? s.startedAt) - s.startedAt) / 1000;
  return { reps, good, avg, holdS: Math.round(holdS), durationS, exercises: [...new Set(s.sets.map((x) => x.exercise))] };
}

export function DebriefCard({ reply, loading }: { reply?: CoachReply<CoachSession>; loading?: boolean }) {
  if (loading && !reply) {
    return (
      <section className="card border-sky/30 p-5" aria-busy="true">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky">
          <Spark className="h-4 w-4 animate-pulse" /> Your coach is reviewing the workout…
        </div>
        <div className="shimmer mt-4 h-8 w-2/3" />
        <div className="shimmer mt-3 h-4 w-full" />
        <div className="shimmer mt-2 h-4 w-4/5" />
      </section>
    );
  }
  if (!reply) return null;
  const c = reply.coach;
  return (
    <section className="card border-sky/30 p-5" aria-label="Coach debrief">
      <AiBadge reply={reply} />
      <h3 className="display mt-3 text-4xl font-bold text-sky">{c.title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-chalk/90">{c.summary}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {c.wins.length > 0 && (
          <div>
            <div className="label mb-2">Wins</div>
            <ul className="space-y-1.5 text-[15px]">
              {c.wins.map((w, i) => (
                <li key={i} className="flex gap-2"><span className="text-volt">✓</span>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {c.work_on.length > 0 && (
          <div>
            <div className="label mb-2">Work on</div>
            <ul className="space-y-1.5 text-[15px]">
              {c.work_on.map((w, i) => (
                <li key={i} className="flex gap-2"><span className="text-amber">→</span>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {c.next_session.plan.length > 0 && <NextPlan plan={c.next_session} />}
    </section>
  );
}

export function NextPlan({ plan, onStart }: { plan: CoachSession["next_session"]; onStart?: (id: SetRecord["exercise"]) => void }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="label mb-2">Next workout · {plan.when}</div>
      <div className="flex flex-wrap gap-2">
        {plan.plan.map((p, i) => {
          const ex = EXERCISES[p.exercise];
          const body = (
            <>
              <Glyph id={p.exercise} className="h-6 w-6 text-sky" />
              <span className="font-semibold">{ex.name}</span>
              <span className="tabular text-mute">
                {p.sets} × {p.target}
                {ex.kind === "hold" ? " s" : ""}
              </span>
            </>
          );
          return onStart ? (
            <button key={i} onClick={() => onStart(p.exercise)} className="flex items-center gap-2 rounded-xl border border-line bg-raise px-3 py-2 text-sm hover:border-sky">
              {body}
            </button>
          ) : (
            <span key={i} className="flex items-center gap-2 rounded-xl border border-line bg-raise px-3 py-2 text-sm">{body}</span>
          );
        })}
      </div>
      {plan.note && <p className="mt-3 text-sm text-mute">{plan.note}</p>}
    </div>
  );
}
