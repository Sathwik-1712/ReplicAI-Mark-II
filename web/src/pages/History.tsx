import { useState } from "react";
import { go } from "../App";
import { CoachSetCard, DebriefCard, SetReport, sessionTotals } from "../components/Reports";
import { AiBadge, Button, Glyph, fmtClock, fmtDay } from "../components/ui";
import { EXERCISES } from "../engine/exercises";
import { deleteSession, useSessions, type Session } from "../lib/store";

export default function History() {
  const sessions = useSessions();
  const [open, setOpen] = useState<string | null>(sessions[0]?.id ?? null);

  if (!sessions.length) {
    return (
      <div className="card p-8 text-center">
        <h1 className="display text-4xl font-bold">No workouts yet</h1>
        <p className="mt-2 text-mute">Finished sets are saved here, in this browser.</p>
        <Button className="mt-5" onClick={() => go("train")}>Start a workout</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="label">History</div>
        <h1 className="display mt-1 text-5xl font-extrabold">{sessions.length} workout{sessions.length === 1 ? "" : "s"}</h1>
      </div>
      {sessions.map((s) => (
        <Item key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
      ))}
    </div>
  );
}

function Item({ s, open, onToggle }: { s: Session; open: boolean; onToggle: () => void }) {
  const t = sessionTotals(s);
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="card overflow-hidden">
      <button className="flex w-full flex-wrap items-center gap-4 p-4 text-left hover:bg-raise/50" onClick={onToggle} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="label">
            {fmtDay(s.startedAt)} · {new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {fmtClock(t.durationS)}
            {!s.endedAt && " · not finished"}
          </div>
          <div className="mt-1 truncate text-lg font-semibold">{s.debrief?.coach.title ?? t.exercises.map((e) => EXERCISES[e].name).join(", ")}</div>
        </div>
        <div className="flex items-center gap-1.5 text-mute">
          {t.exercises.map((e) => <Glyph key={e} id={e} className="h-7 w-7" />)}
        </div>
        <div className="tabular text-right text-sm">
          <div><span className="font-bold text-volt">{t.good}</span> good reps</div>
          <div className="text-mute">{s.sets.length} sets{t.avg ? ` · form ${t.avg}` : ""}</div>
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {s.debrief && <DebriefCard reply={s.debrief} />}
          {s.sets.map((rec, i) => (
            <div key={rec.id} className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <SetReport rec={rec} index={i + 1} />
              {rec.coach ? <CoachSetCard reply={rec.coach} /> : <div className="card p-5 text-sm text-mute">No coaching saved for this set.</div>}
            </div>
          ))}
          <div className="flex items-center justify-between">
            {s.debrief ? <AiBadge reply={s.debrief} /> : <span />}
            {confirm ? (
              <span className="flex items-center gap-2 text-sm">
                Delete this workout for good?
                <Button size="sm" variant="danger" onClick={() => deleteSession(s.id)}>Delete</Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirm(false)}>Keep</Button>
              </span>
            ) : (
              <Button size="sm" variant="quiet" onClick={() => setConfirm(true)}>Delete workout</Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
