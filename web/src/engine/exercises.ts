import {
  LM,
  angle3,
  angleImg,
  bilateral,
  bodyLine,
  clamp,
  facingCamera,
  flat,
  minVis,
  torsoTilt,
} from "./geometry";
import type { ExerciseId, PoseFrame, Severity, Side } from "./types";

export interface Fault {
  label: string; // what went wrong, for summaries
  cue: string; // what to say mid-set, 1 to 3 words
  severity: Severity; // major faults make a rep "bad"
}

export interface CheckCtx {
  start: PoseFrame; // the frame the rep started from
  side?: Side;
}

/**
 * A form check. `rep` runs on every frame of a rep, `goal` only near the far end (bottom of a squat),
 * `peak` once on the deepest frame. A check that returns true marks the fault.
 */
export interface Check {
  id: string;
  window: "rep" | "goal" | "peak";
  test(f: PoseFrame, ctx: CheckCtx): boolean;
}

export interface Measure {
  value: number;
  vis: number;
  side?: Side;
}

interface Base {
  id: ExerciseId;
  name: string;
  view: "side" | "front";
  framing: string; // shown when the body parts it needs are not visible
  howTo: string[];
  checks: Check[];
  faults: Record<string, Fault>;
  /** Returns a message when the person is not in this exercise's position at all. */
  gate?(f: PoseFrame): string | null;
}

export interface RepExercise extends Base {
  kind: "reps";
  /** One measurement per independently moving limb (curls track each arm). */
  channels: ((f: PoseFrame) => Measure | null)[];
  start: number; // measured value at the resting position
  goal: number; // value at a full-range rep
  startHint: string;
  /** Extra condition for the start position, when the joint angle alone is ambiguous. */
  atStart?(f: PoseFrame): boolean;
  phases: { toGoal: string; atGoal: string; toStart: string };
  /** The lifting half of the rep; it slows down first when the muscles tire. */
  concentric: "toGoal" | "toStart";
  tempo?: { toGoalMin?: [number, string]; toStartMin?: [number, string] };
}

export interface HoldExercise extends Base {
  kind: "hold";
  gate(f: PoseFrame): string | null;
}

export type Exercise = RepExercise | HoldExercise;

const knees = (f: PoseFrame) =>
  bilateral(f, [LM.lHip, LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee, LM.rAnkle]);

function arm(side: "left" | "right") {
  const [s, e, w] = side === "left" ? [LM.lShoulder, LM.lElbow, LM.lWrist] : [LM.rShoulder, LM.rElbow, LM.rWrist];
  return (f: PoseFrame): Measure | null => {
    const v = minVis(f, [s, e, w]);
    if (v < 0.5) return null;
    return { value: angle3(f.world[s], f.world[e], f.world[w]), vis: v, side };
  };
}

const lineFault = (limit: number, low: boolean) => (f: PoseFrame) => {
  const b = bodyLine(f);
  return !!b && b.angle < limit && b.hipsLow === low;
};

const SAG = { label: "Hips sagging", cue: "Squeeze your glutes", severity: "major" } as const;
const PIKE = { label: "Hips piking up", cue: "Hips down", severity: "minor" } as const;

const squat: RepExercise = {
  id: "squat",
  name: "Squat",
  kind: "reps",
  view: "side",
  framing: "Step back so your hips, knees and ankles are in view. Side-on works best.",
  howTo: ["Stand side-on to the camera, feet shoulder width.", "Sit back and down until thighs are parallel.", "Drive up through your heels."],
  startHint: "Stand tall to start",
  channels: [(f) => {
    const k = knees(f);
    return k && { value: k.angle, vis: k.vis, side: k.side };
  }],
  start: 165,
  goal: 100,
  phases: { toGoal: "down", atGoal: "bottom", toStart: "up" },
  concentric: "toStart",
  tempo: { toGoalMin: [0.6, "rushed_down"] },
  gate: (f) => (torsoTilt(f) > 75 ? "Stand up to squat" : null),
  checks: [
    { id: "chest_up", window: "goal", test: (f) => torsoTilt(f) > 55 },
    {
      id: "knees_in",
      window: "goal",
      test: (f) => {
        if (!facingCamera(f) || minVis(f, [LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle]) < 0.6) return false;
        const k = Math.abs(flat(f.image[LM.lKnee], f.aspect).x - flat(f.image[LM.rKnee], f.aspect).x);
        const a = Math.abs(flat(f.image[LM.lAnkle], f.aspect).x - flat(f.image[LM.rAnkle], f.aspect).x);
        return a > 0 && k < 0.8 * a;
      },
    },
  ],
  faults: {
    shallow: { label: "Not deep enough", cue: "Sit deeper", severity: "major" },
    chest_up: { label: "Chest falling forward", cue: "Chest up", severity: "minor" },
    knees_in: { label: "Knees caving in", cue: "Knees out", severity: "major" },
    rushed_down: { label: "Dropping too fast", cue: "Control the descent", severity: "minor" },
  },
};

const pushup: RepExercise = {
  id: "pushup",
  name: "Push-up",
  kind: "reps",
  view: "side",
  framing: "Turn side-on and move back until your shoulders, hips and feet are all in view.",
  howTo: ["Set up side-on to the camera.", "Lower until your elbows reach about 90°.", "Keep one straight line from head to heels."],
  startHint: "Straighten your arms to start",
  channels: [(f) => {
    const e = bilateral(f, [LM.lShoulder, LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow, LM.rWrist]);
    return e && { value: e.angle, vis: e.vis, side: e.side };
  }],
  start: 155,
  goal: 95,
  // Straight elbows only mean "top" when the arms hold the body up (wrists well below the shoulders),
  // not when lying flat with the arms stretched out (hand-release push-ups).
  atStart: (f) => {
    const l = minVis(f, [LM.lShoulder, LM.lElbow, LM.lWrist]) >= minVis(f, [LM.rShoulder, LM.rElbow, LM.rWrist]);
    const [s, e, w] = (l ? [LM.lShoulder, LM.lElbow, LM.lWrist] : [LM.rShoulder, LM.rElbow, LM.rWrist]).map((i) => flat(f.image[i], f.aspect));
    const arm = Math.hypot(s.x - e.x, s.y - e.y) + Math.hypot(e.x - w.x, e.y - w.y);
    return w.y - s.y > 0.6 * arm;
  },
  phases: { toGoal: "down", atGoal: "bottom", toStart: "up" },
  concentric: "toStart",
  tempo: { toGoalMin: [0.5, "rushed_down"] },
  gate: (f) => (torsoTilt(f) < 45 ? "Get into a push-up position, side-on to the camera" : null),
  checks: [
    { id: "hips_sag", window: "rep", test: lineFault(155, true) },
    { id: "hips_pike", window: "rep", test: lineFault(155, false) },
  ],
  faults: {
    shallow: { label: "Not low enough", cue: "Chest lower", severity: "major" },
    hips_sag: SAG,
    hips_pike: PIKE,
    rushed_down: { label: "Dropping too fast", cue: "Lower with control", severity: "minor" },
  },
};

const curl: RepExercise = {
  id: "curl",
  name: "Bicep curl",
  kind: "reps",
  view: "side",
  framing: "Turn side-on (or at an angle) with your shoulder, elbow and hand in view.",
  howTo: ["Stand side-on or at 45° to the camera; facing it hides how far the forearm travels.", "Curl all the way up, elbows pinned.", "Lower slowly to straight arms. One or both arms."],
  startHint: "Straighten your arms to start",
  channels: [arm("left"), arm("right")],
  start: 145,
  // A full curl is about 45° side-on, but facing the camera the forearm points at it and the 3D
  // estimate reads wider, so 70° counts as the top; a half curl (90°) still shows as short.
  goal: 70,
  phases: { toGoal: "up", atGoal: "squeeze", toStart: "down" },
  concentric: "toGoal",
  tempo: { toGoalMin: [0.35, "rushed_up"], toStartMin: [0.5, "dropped"] },
  gate: (f) => (torsoTilt(f) > 40 ? "Stand tall to curl" : null),
  checks: [
    {
      id: "elbow_drift",
      window: "goal",
      test: (f, ctx) => {
        const [s, e, h] = ctx.side === "right" ? [LM.rShoulder, LM.rElbow, LM.rHip] : [LM.lShoulder, LM.lElbow, LM.lHip];
        return minVis(f, [s, e, h]) >= 0.5 && angle3(f.world[e], f.world[s], f.world[h]) > 35;
      },
    },
    { id: "swinging", window: "rep", test: (f, ctx) => Math.abs(torsoTilt(f) - torsoTilt(ctx.start)) > 12 },
  ],
  faults: {
    shallow: { label: "Not curling all the way", cue: "All the way up", severity: "major" },
    elbow_drift: { label: "Elbows drifting forward", cue: "Pin your elbows", severity: "minor" },
    swinging: { label: "Swinging the body", cue: "No swinging", severity: "major" },
    rushed_up: { label: "Jerking the weight up", cue: "Smooth lift", severity: "minor" },
    dropped: { label: "Dropping the weight", cue: "Lower slowly", severity: "minor" },
  },
};

const lunge: RepExercise = {
  id: "lunge",
  name: "Lunge",
  kind: "reps",
  view: "side",
  framing: "Step back so both legs, from hips to ankles, are in view. Side-on works best.",
  howTo: ["Stand side-on to the camera.", "Step forward and lower until both knees bend to about 90°.", "Push back up and switch legs."],
  startHint: "Stand tall to start",
  channels: [(f) => {
    const lv = minVis(f, [LM.lHip, LM.lKnee, LM.lAnkle]), rv = minVis(f, [LM.rHip, LM.rKnee, LM.rAnkle]);
    if (Math.max(lv, rv) < 0.45) return null;
    const k = knees(f);
    if (!k) return null;
    const both = lv >= 0.45 && rv >= 0.45;
    return { value: both ? Math.min(k.l, k.r) : k.angle, vis: Math.max(lv, rv) };
  }],
  start: 160,
  goal: 100,
  phases: { toGoal: "down", atGoal: "bottom", toStart: "up" },
  concentric: "toStart",
  tempo: { toGoalMin: [0.5, "rushed_down"] },
  gate: (f) => (torsoTilt(f) > 60 ? "Stand up to lunge" : null),
  checks: [
    { id: "torso_lean", window: "goal", test: (f) => torsoTilt(f) > 35 },
    {
      id: "back_knee",
      window: "peak",
      test: (f) => {
        const k = knees(f);
        return !!k && minVis(f, [LM.lKnee, LM.rKnee]) >= 0.45 && Math.max(k.l, k.r) > 140;
      },
    },
  ],
  faults: {
    shallow: { label: "Not low enough", cue: "Drop lower", severity: "major" },
    torso_lean: { label: "Leaning forward", cue: "Stay tall", severity: "minor" },
    back_knee: { label: "Back leg straight", cue: "Bend both knees", severity: "minor" },
    rushed_down: { label: "Dropping too fast", cue: "Control it", severity: "minor" },
  },
};

const jackParts = (f: PoseFrame) => {
  const arms = (angleImg(f, LM.lHip, LM.lShoulder, LM.lWrist) + angleImg(f, LM.rHip, LM.rShoulder, LM.rWrist)) / 2;
  const hipW = Math.abs(flat(f.image[LM.lHip], f.aspect).x - flat(f.image[LM.rHip], f.aspect).x);
  const feet = Math.abs(flat(f.image[LM.lAnkle], f.aspect).x - flat(f.image[LM.rAnkle], f.aspect).x);
  const ratio = hipW > 0 ? feet / hipW : 0;
  return { arms: clamp((arms - 35) / (150 - 35), 0, 1.2), legs: clamp((ratio - 1.3) / (2.4 - 1.3), 0, 1.2) };
};

const jack: RepExercise = {
  id: "jack",
  name: "Jumping jack",
  kind: "reps",
  view: "front",
  framing: "Face the camera and step back until you are fully in view, hands to feet.",
  howTo: ["Face the camera with room to spread out.", "Jump feet wide while your hands meet overhead.", "Jump back in. Keep a steady rhythm."],
  startHint: "Stand with feet together, arms down",
  channels: [(f) => {
    const v = minVis(f, [LM.lShoulder, LM.rShoulder, LM.lWrist, LM.rWrist, LM.lHip, LM.rHip, LM.lAnkle, LM.rAnkle]);
    if (v < 0.45) return null;
    const j = jackParts(f);
    return { value: (j.arms + j.legs) / 2, vis: v };
  }],
  start: 0,
  goal: 1,
  phases: { toGoal: "out", atGoal: "out", toStart: "in" },
  concentric: "toGoal",
  gate: (f) => (facingCamera(f) ? null : "Face the camera for jumping jacks"),
  checks: [
    { id: "arms_low", window: "peak", test: (f) => jackParts(f).arms < 0.8 },
    { id: "feet_narrow", window: "peak", test: (f) => jackParts(f).legs < 0.7 },
  ],
  faults: {
    shallow: { label: "Small jacks", cue: "Bigger jacks", severity: "major" },
    arms_low: { label: "Arms not overhead", cue: "Arms all the way up", severity: "minor" },
    feet_narrow: { label: "Feet not wide", cue: "Jump wider", severity: "minor" },
  },
};

const plank: HoldExercise = {
  id: "plank",
  name: "Plank",
  kind: "hold",
  view: "side",
  framing: "Turn side-on and move back until your shoulders, hips and feet are in view.",
  howTo: ["Set up side-on to the camera on forearms or hands.", "Hold one straight line from head to heels.", "The timer only counts while your form holds."],
  gate: (f) => {
    if (!bodyLine(f)) return "Turn side-on so your shoulders, hips and feet are in view";
    return torsoTilt(f) < 45 ? "Get down into a plank" : null;
  },
  checks: [
    { id: "hips_sag", window: "rep", test: lineFault(160, true) },
    { id: "hips_pike", window: "rep", test: lineFault(160, false) },
  ],
  faults: { hips_sag: SAG, hips_pike: PIKE },
};

export const EXERCISES: Record<ExerciseId, Exercise> = { squat, pushup, curl, lunge, jack, plank };
export const EXERCISE_LIST: Exercise[] = [squat, pushup, lunge, curl, jack, plank];

export function faultInfo(ex: Exercise, id: string): Fault {
  return ex.faults[id] ?? { label: id.replace(/_/g, " "), cue: id.replace(/_/g, " "), severity: "minor" };
}
