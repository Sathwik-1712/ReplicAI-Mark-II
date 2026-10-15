import type { PoseFrame } from "../engine/types";

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

/** Which joints light up red for each fault. */
const FAULT_JOINTS: Record<string, number[]> = {
  shallow: [23, 24, 25, 26],
  chest_up: [11, 12, 23, 24],
  knees_in: [25, 26],
  hips_sag: [23, 24],
  hips_pike: [23, 24],
  elbow_drift: [13, 14],
  swinging: [11, 12, 23, 24],
  torso_lean: [11, 12, 23, 24],
  back_knee: [25, 26],
  arms_low: [15, 16],
  feet_narrow: [27, 28],
};

export function drawPose(canvas: HTMLCanvasElement, video: HTMLVideoElement, f: PoseFrame | null, faults: string[], good: string) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!f) return;

  const bad = new Set(faults.flatMap((id) => FAULT_JOINTS[id] ?? []));
  const pt = (i: number) => f.image[i];
  const seen = (i: number) => (pt(i)?.visibility ?? 0) > 0.5;
  const scale = Math.max(w, h) / 900;

  ctx.lineCap = "round";
  for (const [a, b] of BONES) {
    if (!seen(a) || !seen(b)) continue;
    const isBad = bad.has(a) && bad.has(b);
    ctx.strokeStyle = isBad ? "#ff5d3b" : "rgba(238,242,236,0.85)";
    ctx.lineWidth = (isBad ? 7 : 4) * scale;
    ctx.beginPath();
    ctx.moveTo(pt(a).x * w, pt(a).y * h);
    ctx.lineTo(pt(b).x * w, pt(b).y * h);
    ctx.stroke();
  }
  for (let i = 11; i < 33; i++) {
    if (!seen(i)) continue;
    ctx.fillStyle = bad.has(i) ? "#ff5d3b" : good;
    ctx.beginPath();
    ctx.arc(pt(i).x * w, pt(i).y * h, (bad.has(i) ? 9 : 6) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}
