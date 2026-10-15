/**
 * Synthetic people for tests: builds BlazePose-shaped frames from joint angles, so the engine can be
 * checked against known movements (a 1.2 s descent, a 10 cm hip sag) without a camera.
 */
import { LM } from "./geometry";
import type { P, PoseFrame } from "./types";

type V = [number, number, number];
const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

function frame(t: number, pts: Partial<Record<keyof typeof LM, V>>, hide: number[] = []): PoseFrame {
  const hip = pts.lHip && pts.rHip ? ([(pts.lHip[0] + pts.rHip[0]) / 2, (pts.lHip[1] + pts.rHip[1]) / 2, 0] as V) : [0, 0, 0];
  const world: P[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.1 }));
  const image: P[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  for (const [name, v] of Object.entries(pts) as [keyof typeof LM, V][]) {
    const i = LM[name];
    const visibility = hide.includes(i) ? 0.1 : 0.98;
    world[i] = { x: v[0] - hip[0], y: v[1] - hip[1], z: v[2], visibility };
    image[i] = { x: 0.5 + v[0] * 0.35, y: 0.45 + v[1] * 0.35, z: 0, visibility };
  }
  return { t, world, image, aspect: 1 };
}

/** Side view, facing +x. knee = hip-knee-ankle angle, lean = torso degrees forward of vertical. */
export function sideStand(t: number, o: { knee?: number; kneeR?: number; lean?: number; elbow?: number } = {}): PoseFrame {
  const pts: Partial<Record<keyof typeof LM, V>> = {};
  for (const s of ["l", "r"] as const) {
    const z = s === "l" ? 0.1 : -0.1;
    const k = rad(s === "r" ? (o.kneeR ?? o.knee ?? 178) : (o.knee ?? 178));
    const ankle: V = [0, 1, z];
    const knee = add(ankle, [0, -1, 0], 0.45);
    const hip = add(knee, [-Math.sin(k), Math.cos(k), 0], 0.45);
    const lean = rad(o.lean ?? 5);
    const shoulder = add(hip, [Math.sin(lean), -Math.cos(lean), 0], 0.5);
    const elbow = add(shoulder, [0, 1, 0], 0.3);
    const e = rad(o.elbow ?? 175);
    const wrist = add(elbow, [Math.sin(e), -Math.cos(e), 0], 0.27);
    Object.assign(pts, { [`${s}Ankle`]: ankle, [`${s}Knee`]: knee, [`${s}Hip`]: hip, [`${s}Shoulder`]: shoulder, [`${s}Elbow`]: elbow, [`${s}Wrist`]: wrist });
  }
  pts.nose = add(pts.lShoulder!, [0.05, -0.25, 0]);
  return frame(t, pts);
}

/** Front view, facing the camera. elbowL/R = curl angle (forearm comes toward the camera), arms = abduction, feet = ankle spread. */
export function frontStand(t: number, o: { elbowL?: number; elbowR?: number; arms?: number; feet?: number; lean?: number } = {}): PoseFrame {
  const pts: Partial<Record<keyof typeof LM, V>> = {};
  const lean = rad(o.lean ?? 0);
  for (const s of ["l", "r"] as const) {
    const x = s === "l" ? 1 : -1; // the person's left is the camera's right
    const ankle: V = [x * (0.12 + (o.feet ?? 0) / 2), 1, 0];
    const hip: V = [x * 0.13, 0.1, 0];
    const knee: V = [(ankle[0] + hip[0]) / 2, 0.55, 0];
    const shoulder = add(hip, [Math.sin(lean) + x * 0.07, -Math.cos(lean), 0], 0.55);
    const a = rad(o.arms ?? 10);
    let elbow: V, wrist: V;
    if (o.arms !== undefined) {
      elbow = add(shoulder, [x * Math.sin(a), Math.cos(a), 0], 0.3);
      wrist = add(elbow, [x * Math.sin(a), Math.cos(a), 0], 0.27);
    } else {
      const e = rad(s === "l" ? (o.elbowL ?? 175) : (o.elbowR ?? 175));
      elbow = add(shoulder, [0, 1, 0], 0.3);
      wrist = add(elbow, [0, -Math.cos(e), -Math.sin(e)], 0.27);
    }
    Object.assign(pts, { [`${s}Ankle`]: ankle, [`${s}Knee`]: knee, [`${s}Hip`]: hip, [`${s}Shoulder`]: shoulder, [`${s}Elbow`]: elbow, [`${s}Wrist`]: wrist });
  }
  pts.nose = add(pts.lShoulder!, [-0.07, -0.25, 0]);
  return frame(t, pts);
}

/** Side view push-up / plank on the toes. elbow = elbow angle, sag = metres the hips drop below the line (negative = pike). */
export function sideFloor(t: number, o: { elbow?: number; sag?: number; hideFeet?: boolean; lyingFlat?: boolean } = {}): PoseFrame {
  const pts: Partial<Record<keyof typeof LM, V>> = {};
  const a = 0.3, b = 0.28, e = rad(o.elbow ?? 172);
  const d = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(e)); // wrist to shoulder
  const l = (b * b - a * a + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, b * b - l * l));
  for (const s of ["l", "r"] as const) {
    const z = s === "l" ? 0.1 : -0.1;
    const wrist: V = [0, 1, z];
    const shoulder: V = [0, 1 - d, z];
    const elbow: V = [-h, 1 - l, z];
    const ankle: V = [-1.3, 0.97, z];
    const hip: V = [(shoulder[0] + ankle[0]) / 2, (shoulder[1] + ankle[1]) / 2 + (o.sag ?? 0), z];
    const knee: V = [(hip[0] + ankle[0]) / 2, (hip[1] + ankle[1]) / 2, z];
    Object.assign(pts, { [`${s}Ankle`]: ankle, [`${s}Knee`]: knee, [`${s}Hip`]: hip, [`${s}Shoulder`]: shoulder, [`${s}Elbow`]: elbow, [`${s}Wrist`]: wrist });
  }
  if (o.lyingFlat) {
    for (const s of ["l", "r"] as const) {
      const z = s === "l" ? 0.1 : -0.1;
      const shoulder: V = [0, 0.93, z];
      Object.assign(pts, {
        [`${s}Shoulder`]: shoulder,
        [`${s}Elbow`]: add(shoulder, [1, 0, 0], 0.3),
        [`${s}Wrist`]: add(shoulder, [1, 0.01, 0], 0.58),
        [`${s}Hip`]: [-0.65, 0.95, z] as V,
        [`${s}Knee`]: [-1.0, 0.96, z] as V,
      });
    }
  }
  pts.nose = add(pts.lShoulder!, [0.2, 0.05, 0]);
  const hidden = o.hideFeet ? [LM.lAnkle, LM.rAnkle] : [];
  return frame(t, pts, hidden);
}

export const ease = (a: number, b: number, k: number) => a + (b - a) * (0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, k))) / 2);

/** A movement script: [seconds, from, to] legs played back at 30 fps into `make`. Returns [ms, frame] pairs. */
export function play(legs: [number, number, number][], make: (t: number, v: number) => PoseFrame | null, fps = 30): [number, PoseFrame | null][] {
  const out: [number, PoseFrame | null][] = [];
  let t0 = 0;
  for (const [dur, from, to] of legs) {
    const n = Math.max(1, Math.round(dur * fps));
    for (let i = 0; i < n; i++) {
      const t = t0 + (i * 1000) / fps;
      out.push([t, make(t, ease(from, to, i / n))]);
    }
    t0 += dur * 1000;
  }
  out.push([t0, make(t0, legs[legs.length - 1][2])]);
  return out;
}
