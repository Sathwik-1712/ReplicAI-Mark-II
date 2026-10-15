import type { P, PoseFrame } from "./types";

/** BlazePose landmark indices used here. */
export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
} as const;

const DEG = 180 / Math.PI;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Angle at b (degrees) between b→a and b→c, in 3D. */
export function angle3(a: P, b: P, c: P): number {
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const n = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  if (n === 0) return NaN;
  return Math.acos(clamp((ux * vx + uy * vy + uz * vz) / n, -1, 1)) * DEG;
}

/** The same landmark in image space with the aspect ratio undone, so angles are true on screen. */
export const flat = (p: P, aspect: number): P => ({ x: p.x * aspect, y: p.y, z: 0 });

export function angleImg(f: PoseFrame, a: number, b: number, c: number): number {
  return angle3(flat(f.image[a], f.aspect), flat(f.image[b], f.aspect), flat(f.image[c], f.aspect));
}

/** Degrees between the line bottom→top and straight up on screen (0 = upright, 90 = horizontal). */
export function tiltFromVertical(top: P, bottom: P, aspect: number): number {
  const dx = (top.x - bottom.x) * aspect;
  const dy = top.y - bottom.y; // image y grows downward
  return Math.atan2(Math.abs(dx), -dy) * DEG;
}

export const mid = (a: P, b: P): P => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
  visibility: Math.min(a.visibility ?? 0, b.visibility ?? 0),
});

export const vis = (f: PoseFrame, i: number) => f.image[i]?.visibility ?? 0;

export function minVis(f: PoseFrame, idx: readonly number[]): number {
  let m = 1;
  for (const i of idx) m = Math.min(m, vis(f, i));
  return m;
}

/** Torso tilt on screen: shoulders' midpoint over hips' midpoint. */
export function torsoTilt(f: PoseFrame): number {
  const s = mid(f.image[LM.lShoulder], f.image[LM.rShoulder]);
  const h = mid(f.image[LM.lHip], f.image[LM.rHip]);
  return tiltFromVertical(s, h, f.aspect);
}

/**
 * A joint angle measured on both sides of the body. Uses the average when both sides are clearly
 * seen (facing the camera), otherwise the better-seen side (side-on, the far limb is hidden).
 */
export function bilateral(
  f: PoseFrame,
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): { angle: number; side: "left" | "right" | "both"; vis: number; l: number; r: number } | null {
  const lv = minVis(f, left), rv = minVis(f, right);
  const l = angle3(f.world[left[0]], f.world[left[1]], f.world[left[2]]);
  const r = angle3(f.world[right[0]], f.world[right[1]], f.world[right[2]]);
  if (lv >= 0.65 && rv >= 0.65) return { angle: (l + r) / 2, side: "both", vis: Math.min(lv, rv), l, r };
  if (Math.max(lv, rv) < 0.45) return null;
  return lv >= rv ? { angle: l, side: "left", vis: lv, l, r } : { angle: r, side: "right", vis: rv, l, r };
}

/** Is the person facing the camera (shoulders spread wide on screen) rather than side-on? */
export function facingCamera(f: PoseFrame): boolean {
  const ls = flat(f.image[LM.lShoulder], f.aspect), rs = flat(f.image[LM.rShoulder], f.aspect);
  const s = mid(f.image[LM.lShoulder], f.image[LM.rShoulder]);
  const h = mid(f.image[LM.lHip], f.image[LM.rHip]);
  const torso = Math.hypot((s.x - h.x) * f.aspect, s.y - h.y);
  return torso > 0 && Math.hypot(ls.x - rs.x, ls.y - rs.y) / torso > 0.55;
}

/**
 * Body line for push-ups and planks: the angle at the hips between shoulders and ankles (knees
 * when ankles are hidden), and whether the hips sit below (sag) or above (pike) that line on screen.
 */
export function bodyLine(f: PoseFrame): { angle: number; hipsLow: boolean } | null {
  const side = vis(f, LM.lHip) + vis(f, LM.lShoulder) >= vis(f, LM.rHip) + vis(f, LM.rShoulder) ? "l" : "r";
  const sh = side === "l" ? LM.lShoulder : LM.rShoulder;
  const hip = side === "l" ? LM.lHip : LM.rHip;
  const ankle = side === "l" ? LM.lAnkle : LM.rAnkle;
  const knee = side === "l" ? LM.lKnee : LM.rKnee;
  const foot = vis(f, ankle) >= 0.5 ? ankle : knee;
  if (minVis(f, [sh, hip, foot]) < 0.45) return null;
  const angle = angle3(f.world[sh], f.world[hip], f.world[foot]);
  const a = flat(f.image[sh], f.aspect), b = flat(f.image[foot], f.aspect), h = flat(f.image[hip], f.aspect);
  const k = b.x === a.x ? 0.5 : clamp((h.x - a.x) / (b.x - a.x));
  const lineY = a.y + (b.y - a.y) * k;
  return { angle, hipsLow: h.y > lineY };
}
