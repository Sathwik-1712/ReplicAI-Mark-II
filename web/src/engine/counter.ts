import type { Exercise, HoldExercise, RepExercise } from "./exercises";
import { OneEuro } from "./filter";
import { clamp } from "./geometry";
import type { HoldRecord, LiveState, Phase, PoseFrame, RepRecord, Side } from "./types";

// Progress thresholds (0 = start position, 1 = full range).
const START = 0.2; // back in the start zone: a rep ends here
const MOVE = 0.3; // left the start zone: a rep begins
const ATTEMPT = 0.45; // smaller movements are fidgeting, not reps
const SHALLOW = 0.88; // below this the rep is counted but marked "not deep enough"
const GOAL_ZONE = 0.7; // "goal" checks run from here
const PEAK_BAND = 0.04; // within this of the deepest point counts as "at the goal" (pause time)
const REST_BAND = 0.04; // within this of the resting position counts as "at rest": rep timing starts and ends here
const SETTLE_MS = 600; // after crossing back into the start zone, wait at most this long for full lockout

const READY_MS = 100; // be in the start position this long before counting (a few frames, so noise does not count)
const LOST_MS = 1500; // a rep without a visible body for this long is dropped
const MERGE_MS = 450; // two arms finishing within this are one rep
const FAULT_FRAMES = 3; // a fault must show on this many frames to count…
const FAULT_SHARE = 0.25; // …and on this share of the frames it was checked on

const WEIGHT = { major: 25, minor: 10 } as const;

interface Sample {
  t: number;
  p: number;
}

interface Active {
  tStart: number;
  baseline: number; // progress at rest before the rep
  tCross: number | null; // when it came back into the start zone
  minAfter: Sample | null; // lowest point since then
  start: PoseFrame;
  samples: Sample[];
  peak: number;
  peakFrame: PoseFrame;
  side?: Side;
  visSum: number;
  frames: number;
  faultFrames: Map<string, number>;
  checkedFrames: Map<string, number>;
}

class Channel {
  // Smooths progress (0..1), so it reacts the same whatever the units of the measurement.
  filter = new OneEuro(1.5, 1.5);
  ready = false;
  inStartSince: number | null = null;
  lastStartT = 0; // last moment at rest
  lastStartFrame: PoseFrame | null = null;
  restMin = Infinity;
  lastSeen = -Infinity;
  p = 0;
  active: Active | null = null;
}

export interface Update {
  live: LiveState;
  reps: RepRecord[];
  holdEnded?: boolean;
}

/** Turns a stream of poses into counted, measured and checked reps. */
export class RepTracker {
  private channels: Channel[];
  private count = 0;
  private pending: { rep: RepRecord; ch: number }[] = [];
  private streaks = new Map<string, number>();

  constructor(private ex: RepExercise) {
    this.channels = ex.channels.map(() => new Channel());
  }

  update(f: PoseFrame | null, t: number): Update {
    const out: RepRecord[] = [];
    const gateMsg = f && this.ex.gate ? this.ex.gate(f) : null;
    let seen = false;

    this.ex.channels.forEach((measure, i) => {
      const c = this.channels[i];
      const m = f && !gateMsg ? measure(f) : null;
      if (!m || !Number.isFinite(m.value) || m.vis < 0.45) {
        if (c.active && t - c.lastSeen > LOST_MS) {
          c.active = null;
          c.ready = false;
        }
        if (t - c.lastSeen > 500) {
          c.filter.reset();
          c.inStartSince = null;
        }
        return;
      }
      seen = true;
      c.lastSeen = t;
      const p = c.filter.filter((m.value - this.ex.start) / (this.ex.goal - this.ex.start), t);
      c.p = p;
      const frame = f!;
      const inStart = p < START && (!this.ex.atStart || this.ex.atStart(frame));

      if (!c.active) {
        if (inStart) {
          if (c.inStartSince === null) {
            c.inStartSince = t;
            c.restMin = p;
          }
          if (t - c.inStartSince >= READY_MS) c.ready = true;
          c.restMin = Math.min(c.restMin, p);
          if (p <= c.restMin + REST_BAND) {
            c.lastStartT = t;
            c.lastStartFrame = frame;
          }
        } else {
          c.inStartSince = null;
          if (c.ready && p >= MOVE) {
            c.active = {
              tStart: c.lastStartT,
              baseline: Number.isFinite(c.restMin) ? c.restMin : 0,
              tCross: null,
              minAfter: null,
              start: c.lastStartFrame ?? frame,
              samples: [{ t, p }],
              peak: p,
              peakFrame: frame,
              side: m.side,
              visSum: m.vis,
              frames: 1,
              faultFrames: new Map(),
              checkedFrames: new Map(),
            };
          }
        }
        return;
      }

      const a = c.active;
      a.samples.push({ t, p });
      a.visSum += m.vis;
      a.frames += 1;
      if (p > a.peak) {
        a.peak = p;
        a.peakFrame = frame;
        if (m.side) a.side = m.side;
      }
      for (const chk of this.ex.checks) {
        if (chk.window === "rep" || (chk.window === "goal" && p >= GOAL_ZONE)) {
          a.checkedFrames.set(chk.id, (a.checkedFrames.get(chk.id) ?? 0) + 1);
          if (chk.test(frame, { start: a.start, side: a.side })) a.faultFrames.set(chk.id, (a.faultFrames.get(chk.id) ?? 0) + 1);
        }
      }
      // Back in the start zone: the rep ends at full lockout, or when the next one begins, or after SETTLE_MS.
      if (inStart) {
        a.tCross ??= t;
        if (!a.minAfter || p < a.minAfter.p) a.minAfter = { t, p };
      }
      if (a.tCross !== null) {
        const locked = inStart && p <= a.baseline + REST_BAND;
        const rising = a.minAfter && p > a.minAfter.p + 0.05;
        if (locked || rising || t - a.tCross >= SETTLE_MS) {
          const tEnd = locked ? t : a.minAfter!.t;
          const rep = this.finish(a, tEnd);
          c.active = null;
          c.lastStartT = tEnd;
          c.lastStartFrame = frame;
          c.inStartSince = inStart ? t : null;
          c.restMin = Math.min(p, a.minAfter!.p);
          if (rep) this.complete(rep, i, out);
        }
      }
    });

    this.flush(t, out);
    return { live: this.live(f, gateMsg, seen), reps: out };
  }

  private finish(a: Active, tEnd: number): RepRecord | null {
    if (a.peak < ATTEMPT) return null;
    const band = a.peak - PEAK_BAND;
    const iA = a.samples.findIndex((s) => s.p >= band);
    let iB = iA;
    for (let i = a.samples.length - 1; i >= 0; i--) {
      if (a.samples[i].p >= band) {
        iB = i;
        break;
      }
    }
    const toGoal = (a.samples[iA].t - a.tStart) / 1000;
    const atGoal = (a.samples[iB].t - a.samples[iA].t) / 1000;
    const toStart = (tEnd - a.samples[iB].t) / 1000;

    const faults: string[] = [];
    if (a.peak < SHALLOW) faults.push("shallow");
    for (const [id, n] of a.faultFrames) if (n >= FAULT_FRAMES && n >= FAULT_SHARE * (a.checkedFrames.get(id) ?? n)) faults.push(id);
    for (const chk of this.ex.checks) {
      if (chk.window === "peak" && chk.test(a.peakFrame, { start: a.start, side: a.side })) faults.push(chk.id);
    }
    const tempo = this.ex.tempo;
    if (tempo?.toGoalMin && toGoal < tempo.toGoalMin[0]) faults.push(tempo.toGoalMin[1]);
    if (tempo?.toStartMin && toStart < tempo.toStartMin[0]) faults.push(tempo.toStartMin[1]);

    const sev = (id: string) => this.ex.faults[id]?.severity ?? "minor";
    let score = 100 - Math.max(0, 1 - a.peak) * 80;
    for (const id of faults) if (id !== "shallow") score -= WEIGHT[sev(id)]; // depth already cost points
    const vis = a.visSum / a.frames;
    return {
      n: 0,
      t: tEnd,
      side: a.side,
      score: Math.round(clamp(score, 0, 100)),
      depth: Math.round(Math.min(a.peak, 1.1) * 100), // deeper than required is reported as 110%
      toGoal: round2(toGoal),
      atGoal: round2(atGoal),
      toStart: round2(toStart),
      total: round2((tEnd - a.tStart) / 1000),
      faults,
      quality: vis < 0.55 ? "uncertain" : faults.some((id) => sev(id) === "major") ? "bad" : "good",
      vis: round2(vis),
    };
  }

  private complete(rep: RepRecord, ch: number, out: RepRecord[]) {
    if (this.channels.length === 1) return this.emit(rep, out);
    const k = this.pending.findIndex((x) => x.ch !== ch && rep.t - x.rep.t <= MERGE_MS);
    if (k >= 0) {
      const [other] = this.pending.splice(k, 1);
      return this.emit(merge(other.rep, rep), out);
    }
    this.pending.push({ rep, ch });
  }

  private flush(t: number, out: RepRecord[]) {
    while (this.pending.length && t - this.pending[0].rep.t > MERGE_MS) this.emit(this.pending.shift()!.rep, out);
  }

  /** Reps still waiting to be paired with the other arm; call when the set ends. */
  drain(): RepRecord[] {
    const out: RepRecord[] = [];
    while (this.pending.length) this.emit(this.pending.shift()!.rep, out);
    return out;
  }

  private emit(rep: RepRecord, out: RepRecord[]) {
    rep.n = ++this.count;
    out.push(rep);
  }

  private live(f: PoseFrame | null, gateMsg: string | null, seen: boolean): LiveState {
    const base = { progress: 0, phase: "start" as Phase, faults: [] as string[] };
    if (!f) return { ...base, status: "no_person", message: "Step into the frame" };
    if (gateMsg) return { ...base, status: "adjust", message: gateMsg };
    if (!seen) return { ...base, status: "adjust", message: this.ex.framing };

    const c = this.channels.reduce((best, ch) => (ch.active && (!best.active || ch.p > best.p) ? ch : best), this.channels[0]);
    const lead = c.active ? c : this.channels.reduce((b, ch) => (ch.lastSeen >= b.lastSeen && ch.p > b.p ? ch : b), this.channels[0]);
    const progress = clamp(lead.p, 0, 1.2);

    const faults: string[] = [];
    for (const chk of this.ex.checks) {
      const a = lead.active;
      const on = !!a && chk.window !== "peak" && (chk.window === "rep" || lead.p >= GOAL_ZONE) && chk.test(f, { start: a.start, side: a.side });
      const s = on ? (this.streaks.get(chk.id) ?? 0) + 1 : 0;
      this.streaks.set(chk.id, s);
      if (s >= FAULT_FRAMES) faults.push(chk.id);
    }

    if (lead.active) {
      const a = lead.active;
      const phase: Phase = lead.p >= a.peak - PEAK_BAND && lead.p >= GOAL_ZONE ? "atGoal" : lead.p < a.peak - 0.1 ? "toStart" : "toGoal";
      return { status: "moving", message: this.ex.phases[phase as "toGoal"], progress, phase, faults };
    }
    if (this.channels.some((ch) => ch.ready)) return { ...base, progress, status: "ready", message: "Go" };
    return { ...base, progress, status: "adjust", message: this.ex.startHint };
  }
}

function merge(a: RepRecord, b: RepRecord): RepRecord {
  const order = { good: 0, uncertain: 1, bad: 2 } as const;
  return {
    ...a,
    t: Math.max(a.t, b.t),
    side: "both",
    score: Math.round((a.score + b.score) / 2),
    depth: Math.round((a.depth + b.depth) / 2),
    toGoal: round2((a.toGoal + b.toGoal) / 2),
    atGoal: round2((a.atGoal + b.atGoal) / 2),
    toStart: round2((a.toStart + b.toStart) / 2),
    total: Math.max(a.total, b.total),
    faults: [...new Set([...a.faults, ...b.faults])],
    quality: order[a.quality] >= order[b.quality] ? a.quality : b.quality,
    vis: Math.min(a.vis, b.vis),
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Times a hold (plank): only seconds in position count, and only good-form seconds count as good. */
export class HoldTracker {
  private state: "waiting" | "holding" | "done" = "waiting";
  private okSince: number | null = null;
  private lostSince: number | null = null;
  private lastT: number | null = null;
  private holdMs = 0;
  private goodMs = 0;
  private streakMs = 0;
  private longestMs = 0;
  private faults: Record<string, number> = {};
  private active = new Set<string>();
  private streaks = new Map<string, number>();

  constructor(private ex: HoldExercise) {}

  update(f: PoseFrame | null, t: number): Update {
    const gate = f ? this.ex.gate(f) : "Step into the frame";
    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, 200);
    this.lastT = t;
    let ended = false;
    let faults: string[] = [];

    if (this.state === "waiting") {
      if (!gate) {
        this.okSince ??= t;
        if (t - this.okSince >= 1000) this.state = "holding";
      } else this.okSince = null;
    } else if (this.state === "holding") {
      if (!gate && f) {
        this.lostSince = null;
        this.holdMs += dt;
        faults = this.ex.checks.filter((chk) => {
          const s = chk.test(f, { start: f }) ? (this.streaks.get(chk.id) ?? 0) + 1 : 0;
          this.streaks.set(chk.id, s);
          return s >= FAULT_FRAMES;
        }).map((chk) => chk.id);
        for (const id of faults) if (!this.active.has(id)) this.faults[id] = (this.faults[id] ?? 0) + 1;
        this.active = new Set(faults);
        if (faults.length === 0) {
          this.goodMs += dt;
          this.streakMs += dt;
          this.longestMs = Math.max(this.longestMs, this.streakMs);
        } else this.streakMs = 0;
      } else {
        this.streakMs = 0;
        this.lostSince ??= t;
        if (t - this.lostSince > 2000) {
          this.state = "done";
          ended = true;
        }
      }
    }

    const holdS = this.holdMs / 1000, goodS = this.goodMs / 1000;
    const live: LiveState =
      this.state === "holding"
        ? { status: gate ? "adjust" : "moving", message: gate ?? (faults.length ? "Fix your line" : "Hold it"), progress: 1, phase: "atGoal", faults, holdS, goodS }
        : this.state === "done"
          ? { status: "ready", message: "Hold finished", progress: 0, phase: "start", faults: [], holdS, goodS }
          : { status: gate ? (f ? "adjust" : "no_person") : "ready", message: gate ?? "Hold still, starting…", progress: 0, phase: "start", faults: [], holdS, goodS };
    return { live, reps: [], holdEnded: ended };
  }

  get started() {
    return this.state !== "waiting";
  }

  result(): HoldRecord {
    const holdS = round2(this.holdMs / 1000), goodS = round2(this.goodMs / 1000);
    return { holdS, goodS, goodPct: holdS ? Math.round((goodS / holdS) * 100) : 0, longestGoodS: round2(this.longestMs / 1000), faults: { ...this.faults } };
  }
}

export type Tracker = RepTracker | HoldTracker;

export function createTracker(ex: Exercise): Tracker {
  return ex.kind === "hold" ? new HoldTracker(ex) : new RepTracker(ex);
}
