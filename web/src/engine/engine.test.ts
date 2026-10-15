import { describe, expect, it } from "vitest";
import { HoldTracker, RepTracker } from "./counter";
import { EXERCISES, type HoldExercise, type RepExercise } from "./exercises";
import { summarizeSet } from "./summary";
import { frontStand, play, sideFloor, sideStand } from "./synth";
import type { PoseFrame, RepRecord } from "./types";

const squat = EXERCISES.squat as RepExercise;
const pushup = EXERCISES.pushup as RepExercise;
const curl = EXERCISES.curl as RepExercise;
const jack = EXERCISES.jack as RepExercise;
const lunge = EXERCISES.lunge as RepExercise;
const plank = EXERCISES.plank as HoldExercise;

function run(ex: RepExercise, frames: [number, PoseFrame | null][]): RepRecord[] {
  const tr = new RepTracker(ex);
  const reps: RepRecord[] = [];
  for (const [t, f] of frames) reps.push(...tr.update(f, t).reps);
  return [...reps, ...tr.drain()];
}

/** n reps of [stand, down, hold, up]; angles in degrees. */
function cycles(n: number, top: number, bottom: number, down = 1.2, hold = 0.3, up = 1.0): [number, number, number][] {
  const legs: [number, number, number][] = [[0.6, top, top]];
  for (let i = 0; i < n; i++) legs.push([down, top, bottom], [hold, bottom, bottom], [up, bottom, top], [0.5, top, top]);
  return legs;
}

describe("squat", () => {
  it("counts clean reps and measures their tempo", () => {
    const reps = run(squat, play(cycles(5, 178, 88), (t, k) => sideStand(t, { knee: k })));
    expect(reps).toHaveLength(5);
    for (const r of reps) {
      expect(r.quality).toBe("good");
      expect(r.faults).toEqual([]);
      expect(r.score).toBeGreaterThanOrEqual(95);
      expect(r.depth).toBeGreaterThanOrEqual(100);
      // true movement: 1.2 s down, 0.3 s hold, 1.0 s up (eased, so the very ends are slow)
      expect(r.toGoal).toBeGreaterThan(0.85);
      expect(r.toGoal).toBeLessThan(1.3);
      expect(r.atGoal).toBeGreaterThan(0.25);
      expect(r.atGoal).toBeLessThan(0.65);
      expect(r.toStart).toBeGreaterThan(0.7);
      expect(r.toStart).toBeLessThan(1.1);
      expect(r.total).toBeGreaterThan(2.1);
      expect(r.total).toBeLessThan(2.6);
    }
  });

  it("counts half squats but marks them not deep enough", () => {
    const reps = run(squat, play(cycles(3, 178, 125), (t, k) => sideStand(t, { knee: k })));
    expect(reps).toHaveLength(3);
    expect(reps.every((r) => r.quality === "bad" && r.faults.includes("shallow"))).toBe(true);
    expect(reps[0].score).toBeLessThan(80);
  });

  it("ignores small knee bends", () => {
    expect(run(squat, play(cycles(4, 178, 150), (t, k) => sideStand(t, { knee: k })))).toHaveLength(0);
  });

  it("flags a rushed descent", () => {
    const reps = run(squat, play(cycles(2, 178, 90, 0.3), (t, k) => sideStand(t, { knee: k })));
    expect(reps).toHaveLength(2);
    expect(reps[0].faults).toContain("rushed_down");
    expect(reps[0].quality).toBe("good"); // a minor fault
  });

  it("flags the chest falling forward at the bottom", () => {
    const reps = run(squat, play(cycles(2, 178, 90), (t, k) => sideStand(t, { knee: k, lean: 5 + ((178 - k) / 88) * 65 })));
    expect(reps[0].faults).toContain("chest_up");
  });

  it("does not count a rep that started before the person was standing", () => {
    const legs: [number, number, number][] = [[0.5, 100, 100], [1, 100, 178], ...cycles(1, 178, 90).slice(1)];
    expect(run(squat, play(legs, (t, k) => sideStand(t, { knee: k })))).toHaveLength(1);
  });

  it("drops a rep when the person leaves the frame mid-rep", () => {
    const legs: [number, number, number][] = [[0.6, 178, 178], [1.2, 178, 90], [2, 0, 0], [1, 90, 178], [0.6, 178, 178]];
    let i = 0;
    const frames = play(legs, (t, k) => {
      i++;
      return t >= 1800 && t < 3800 ? null : sideStand(t, { knee: k || 90 });
    });
    expect(i).toBeGreaterThan(0);
    expect(run(squat, frames)).toHaveLength(0);
  });

  it("does not count squats while lying in a plank", () => {
    expect(run(squat, play(cycles(3, 170, 100), (t, e) => sideFloor(t, { elbow: e })))).toHaveLength(0);
  });
});

describe("push-up", () => {
  it("counts reps and catches sagging hips", () => {
    const good = run(pushup, play(cycles(3, 172, 85), (t, e) => sideFloor(t, { elbow: e })));
    expect(good).toHaveLength(3);
    expect(good.every((r) => r.quality === "good")).toBe(true);

    const sag = run(pushup, play(cycles(3, 172, 85), (t, e) => sideFloor(t, { elbow: e, sag: 0.2 })));
    expect(sag).toHaveLength(3);
    expect(sag.every((r) => r.faults.includes("hips_sag") && r.quality === "bad")).toBe(true);

    const pike = run(pushup, play(cycles(2, 172, 85), (t, e) => sideFloor(t, { elbow: e, sag: -0.2 })));
    expect(pike[0].faults).toContain("hips_pike");
  });

  it("counts a hand-release push-up once, not again when the arms stretch out on the floor", () => {
    const legs: [number, number, number][] = [[0.6, 172, 172]];
    for (let i = 0; i < 3; i++) legs.push([1, 172, 80], [0.6, 80, 80], [0.6, 80, 172], [0.6, 172, 80], [0.8, 80, 172], [0.5, 172, 172]);
    // pattern per rep: top → bottom → (on the floor) arms stretch out straight → back to bottom → push up to the top
    let leg = 0;
    const frames = play(legs, (t, e) => {
      leg = Math.min(legs.length - 1, legs.findIndex((_, k) => legs.slice(0, k + 1).reduce((a, l) => a + l[0], 0) * 1000 > t));
      const onFloor = leg > 0 && (leg - 1) % 6 >= 2 && (leg - 1) % 6 <= 3;
      return onFloor ? sideFloor(t, { lyingFlat: true }) : sideFloor(t, { elbow: e });
    });
    expect(run(pushup, frames)).toHaveLength(3);
  });

  it("works from the knees when the feet are out of frame", () => {
    expect(run(pushup, play(cycles(2, 172, 85), (t, e) => sideFloor(t, { elbow: e, hideFeet: true })))).toHaveLength(2);
  });

  it("does not count arm bends while standing", () => {
    expect(run(pushup, play(cycles(3, 172, 85), (t, e) => sideStand(t, { elbow: e })))).toHaveLength(0);
  });
});

describe("bicep curl", () => {
  it("counts both arms together as one rep each", () => {
    const reps = run(curl, play(cycles(4, 170, 45), (t, e) => frontStand(t, { elbowL: e, elbowR: e })));
    expect(reps).toHaveLength(4);
    expect(reps.every((r) => r.side === "both")).toBe(true);
  });

  it("counts alternating arms separately", () => {
    const legs: [number, number, number][] = [[0.6, 0, 0]];
    for (let i = 0; i < 6; i++) legs.push([2.4, i % 2 ? -1 : 1, i % 2 ? -1 : 1], [0.5, 0, 0]);
    const frames = play(legs, (t, v) => {
      // v = +1: left arm curls, -1: right arm curls; the curl itself is a sine over the 2.4 s leg
      const phase = ((t / 1000 - 0.6) % 2.9) / 2.4;
      const bend = v === 0 || phase > 1 ? 0 : Math.sin(Math.PI * phase);
      const e = 170 - 125 * bend;
      return frontStand(t, { elbowL: v > 0 ? e : 170, elbowR: v < 0 ? e : 170 });
    });
    const reps = run(curl, frames);
    expect(reps).toHaveLength(6);
    expect(reps.filter((r) => r.side === "left")).toHaveLength(3);
  });

  it("catches swinging the body", () => {
    const reps = run(curl, play(cycles(2, 170, 45), (t, e) => frontStand(t, { elbowL: e, elbowR: e, lean: ((170 - e) / 125) * 25 })));
    expect(reps[0].faults).toContain("swinging");
    expect(reps[0].quality).toBe("bad");
  });
});

describe("lunge and jumping jack", () => {
  it("counts lunges", () => {
    const reps = run(lunge, play(cycles(3, 178, 92), (t, k) => sideStand(t, { knee: k, kneeR: k + 5 })));
    expect(reps).toHaveLength(3);
    expect(reps[0].quality).toBe("good");
  });

  it("flags a straight back leg in a lunge", () => {
    const reps = run(lunge, play(cycles(2, 178, 92), (t, k) => sideStand(t, { knee: k, kneeR: 175 })));
    expect(reps[0].faults).toContain("back_knee");
  });

  it("counts full jacks and marks small ones", () => {
    const full = run(jack, play(cycles(5, 0, 1, 0.35, 0.1, 0.35), (t, k) => frontStand(t, { arms: 10 + 160 * k, feet: 0.55 * k })));
    expect(full).toHaveLength(5);
    expect(full.every((r) => r.quality === "good")).toBe(true);
    const small = run(jack, play(cycles(3, 0, 1, 0.35, 0.1, 0.35), (t, k) => frontStand(t, { arms: 10 + 80 * k, feet: 0.3 * k })));
    expect(small.length).toBeGreaterThan(0);
    expect(small[0].faults).toContain("arms_low");
  });
});

describe("plank", () => {
  it("times good form only and ends when the person gets up", () => {
    const tr = new HoldTracker(plank);
    const frames = [
      ...play([[6, 0, 0]], (t) => sideFloor(t, { elbow: 172 })),
      ...play([[2, 0, 0]], (t) => sideFloor(t + 6000, { elbow: 172, sag: 0.18 })).map(([t, f]) => [t + 6000, f] as const),
      ...play([[3, 0, 0]], (t) => sideStand(t + 8000)).map(([t, f]) => [t + 8000, f] as const),
    ];
    let ended = false;
    for (const [t, f] of frames) ended ||= !!tr.update(f, t).holdEnded;
    const r = tr.result();
    expect(ended).toBe(true);
    expect(r.holdS).toBeGreaterThan(6.5);
    expect(r.holdS).toBeLessThan(7.5);
    expect(r.goodS).toBeGreaterThan(4.5);
    expect(r.goodS).toBeLessThan(5.3);
    expect(r.faults.hips_sag).toBe(1);
  });
});

describe("set summary", () => {
  it("notices the lift slowing down as the set goes on", () => {
    const legs: [number, number, number][] = [[0.6, 178, 178]];
    for (let i = 0; i < 9; i++) legs.push([1.1, 178, 88], [0.2, 88, 88], [0.7 + i * 0.12, 88, 178], [0.4, 178, 178]);
    const reps = run(squat, play(legs, (t, k) => sideStand(t, { knee: k })));
    expect(reps).toHaveLength(9);
    const s = summarizeSet(squat, reps, 30);
    expect(s.good).toBe(9);
    expect(s.slowdownPct).toBeGreaterThan(25);
    expect(s.tutS).toBeGreaterThan(15);
  });
});
