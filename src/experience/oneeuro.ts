// One-Euro filter (Casiez et al. 2012): low-pass whose cutoff rises with signal speed,
// so slow movement is smooth and fast movement has little lag. Pure, no DOM.

export interface P {
  x: number;
  y: number;
  z: number;
}

function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(
    public minCutoff = 1,
    public beta = 0,
    public dCutoff = 1,
  ) {}

  /** `t` in seconds, must be non-decreasing. */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      this.dx = 0;
      return value;
    }
    const dt = Math.max(t - this.t, 1e-3);
    const rawD = (value - this.x) / dt;
    const aD = smoothingFactor(this.dCutoff, dt);
    this.dx = this.dx + aD * (rawD - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = smoothingFactor(cutoff, dt);
    this.x = this.x + a * (value - this.x);
    this.t = t;
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/**
 * One-Euro filter bank for a whole hand (21 landmarks x 3 axes). Coordinates are divided by
 * `scale` first so `beta` is expressed in "frame widths per second" regardless of resolution.
 */
export class LandmarkFilter {
  private bank: OneEuro[][];

  constructor(
    private scale: number,
    minCutoff = 1.2,
    beta = 25,
    count = 21,
  ) {
    this.bank = Array.from({ length: count }, () => [
      new OneEuro(minCutoff, beta),
      new OneEuro(minCutoff, beta),
      new OneEuro(minCutoff, beta),
    ]);
  }

  filter(lm: readonly P[], t: number): P[] {
    const s = this.scale;
    return lm.map((p, i) => {
      const f = this.bank[i];
      if (!f) return p;
      return {
        x: f[0]!.filter(p.x / s, t) * s,
        y: f[1]!.filter(p.y / s, t) * s,
        z: f[2]!.filter(p.z / s, t) * s,
      };
    });
  }

  reset(): void {
    for (const f of this.bank) for (const o of f) o.reset();
  }
}
