export type ExerciseId = "squat" | "pushup" | "curl" | "lunge" | "jack" | "plank";
export type Side = "left" | "right" | "both";
export type Severity = "major" | "minor";

/** One landmark. World landmarks are metres around the hips; image landmarks are 0..1 of the frame. */
export interface P {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** One camera frame's pose. `aspect` = frame width / height, used to undo the 0..1 squash of image coords. */
export interface PoseFrame {
  t: number; // ms
  world: P[];
  image: P[];
  aspect: number;
}

/**
 * Where a rep is. "start" is the resting position (standing, arms straight), "goal" the far end
 * (bottom of a squat, top of a curl). Each exercise names these for people (down / hold / up).
 */
export type Phase = "start" | "toGoal" | "atGoal" | "toStart";

export interface RepRecord {
  n: number;
  t: number; // ms, when the rep finished
  side?: Side;
  score: number; // 0..100
  depth: number; // % of the target range reached (100 = full)
  toGoal: number; // seconds
  atGoal: number;
  toStart: number;
  total: number;
  faults: string[];
  quality: "good" | "bad" | "uncertain";
  vis: number; // mean landmark visibility during the rep, 0..1
}

export interface HoldRecord {
  holdS: number;
  goodS: number;
  goodPct: number;
  longestGoodS: number;
  faults: Record<string, number>;
}

export interface LiveState {
  status: "loading" | "no_person" | "adjust" | "ready" | "moving";
  message: string;
  progress: number; // 0 at start, 1 at the goal
  phase: Phase;
  faults: string[];
  holdS?: number; // plank: seconds held so far
  goodS?: number;
}
