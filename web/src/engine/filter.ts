/**
 * One Euro filter (Casiez et al. 2012): smooths jitter when a joint is still, follows quickly when
 * it moves. Used on joint angles so camera noise does not count as reps.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(
    private minCutoff = 1.5,
    private beta = 0.02,
    private dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.x = null;
  }

  filter(value: number, tMs: number): number {
    if (this.x === null || tMs <= this.t) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = (tMs - this.t) / 1000;
    this.t = tMs;
    const dxRaw = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
