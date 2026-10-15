import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ExerciseId, RepRecord } from "../engine/types";
import type { CoachReply } from "../lib/store";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "quiet"; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-5 text-[15px]",
        size === "lg" && "h-14 px-7 text-lg",
        variant === "primary" && "bg-volt text-ink hover:brightness-110",
        variant === "ghost" && "border border-line bg-raise text-chalk hover:border-mute",
        variant === "danger" && "border border-flare/50 text-flare hover:bg-flare/10",
        variant === "quiet" && "text-mute hover:text-chalk",
        className,
      )}
    />
  );
}

export function Stat({ label, value, unit, tone, big }: { label: string; value: ReactNode; unit?: string; tone?: "volt" | "flare" | "amber" | "sky"; big?: boolean }) {
  const color = tone ? { volt: "text-volt", flare: "text-flare", amber: "text-amber", sky: "text-sky" }[tone] : "text-chalk";
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={cx("display tabular mt-1 font-bold", big ? "text-5xl" : "text-3xl", color)}>
        {value}
        {unit && <span className="ml-1 text-base font-semibold text-mute">{unit}</span>}
      </div>
    </div>
  );
}

/** Marks text the AI wrote, so it is never mistaken for a measurement. */
export function AiBadge({ reply }: { reply?: CoachReply<unknown> }) {
  if (!reply) return null;
  return reply.source === "ai" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky/15 px-2.5 py-1 text-xs font-semibold text-sky" title={`Written by ${reply.model ?? "Gemini"} from your measured numbers`}>
      <Spark /> AI coach
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-raise px-2.5 py-1 text-xs font-semibold text-mute" title={reply.reason}>
      Offline coach
    </span>
  );
}

export function Spark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0l1.8 5.2L15 7l-5.2 1.8L8 14l-1.8-5.2L1 7l5.2-1.8z" />
    </svg>
  );
}

export const fmtS = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;

export function fmtClock(totalS: number) {
  const s = Math.max(0, Math.floor(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtDay(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** The three parts of a rep (e.g. down, bottom, up) as one bar, widths in proportion to seconds. */
export function TempoBar({ parts }: { parts: { label: string; s: number }[] }) {
  const total = parts.reduce((a, p) => a + p.s, 0) || 1;
  const tones = ["bg-chalk/80", "bg-amber", "bg-volt"];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-raise">
        {parts.map((p, i) => (
          <div key={p.label} className={tones[i]} style={{ width: `${(p.s / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-xs text-mute">
        {parts.map((p, i) => (
          <span key={p.label} className="tabular">
            <span className={cx("mr-1 inline-block h-2 w-2 rounded-full", tones[i])} />
            {p.label} {fmtS(p.s)}
          </span>
        ))}
      </div>
    </div>
  );
}

export const QUALITY_COLOR = { good: "bg-volt", bad: "bg-flare", uncertain: "bg-amber" } as const;

/** One bar per rep: height = form score, colour = verdict. */
export function RepStrip({ reps, height = 72 }: { reps: RepRecord[]; height?: number }) {
  if (!reps.length) return <div className="text-sm text-mute">No reps counted.</div>;
  return (
    <div className="flex items-end gap-1" style={{ height }} role="img" aria-label={`Form score per rep: ${reps.map((r) => r.score).join(", ")}`}>
      {reps.map((r) => (
        <div key={r.n} className="group relative flex h-full flex-1 items-end" style={{ maxWidth: 28 }}>
          <div className={cx("w-full rounded-t-sm", QUALITY_COLOR[r.quality])} style={{ height: `${Math.max(6, r.score)}%` }} />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-raise px-2 py-1 text-xs group-hover:block">
            Rep {r.n}: {r.score}/100
          </div>
        </div>
      ))}
    </div>
  );
}

/** A small line chart in plain SVG. */
export function LineChart({ points, color = "var(--color-volt)", unit = "", height = 160 }: { points: { label: string; y: number }[]; color?: string; unit?: string; height?: number }) {
  if (points.length === 0) return <div className="py-10 text-center text-sm text-mute">Nothing logged yet.</div>;
  const W = 480, H = height, P = { l: 40, r: 14, t: 12, b: 28 };
  const ys = points.map((p) => p.y);
  const max = Math.max(...ys), min = Math.min(0, ...ys);
  const span = max - min || 1;
  const x = (i: number) => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i / (points.length - 1)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const ticks = [min, min + span / 2, max];
  const every = Math.ceil(points.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={points.map((p) => `${p.label}: ${p.y}${unit}`).join(", ")}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
          <text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="14" fill="var(--color-mute)">
            {Math.round(v)}
          </text>
        </g>
      ))}
      <path d={`${d} L${x(points.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.y)} r="4" fill={color}>
            <title>{`${p.label}: ${p.y}${unit}`}</title>
          </circle>
          {i % every === 0 && (
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="14" fill="var(--color-mute)">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Simple stick figures so each exercise is recognisable at a glance. */
export function Glyph({ id, className = "h-10 w-10" }: { id: ExerciseId; className?: string }) {
  // 54×54 stick figures: head circle + limbs.
  const paths: Record<ExerciseId, string> = {
    squat: "M30 9a4 4 0 1 1-.1 0M28 16l-6 13M22 29h11M33 29l-2 14M31 43h5M26 18h12",
    pushup: "M10 27a4 4 0 1 1-.1 0M14 30l29 7M43 37l6 1M18 31v10M18 41h-4",
    curl: "M27 7a4 4 0 1 1-.1 0M27 14v17M27 31l-5 15M27 31l5 15M27 17l-6 9 3-9M27 17l6 9-2-9",
    lunge: "M27 7a4 4 0 1 1-.1 0M27 14v16M27 30l9 2v13M27 30l-8 8-5 7M27 18l-4 9M27 18l4 9",
    jack: "M27 8a4 4 0 1 1-.1 0M27 15v15M27 30l-9 16M27 30l9 16M27 18l-11-9M27 18l11-9",
    plank: "M9 26a4 4 0 1 1-.1 0M13 29l32 7M45 36l4 2M15 30l2 8h-6",
  };
  return (
    <svg viewBox="0 0 54 54" className={className} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[id]} />
    </svg>
  );
}
