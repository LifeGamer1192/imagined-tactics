// Deterministic PRNG (Park-Miller minimal standard) so a seed reproduces a world.
// Ported from dunmas-web/src/core/rng.ts. Additions: fork() for independent
// per-subsystem streams, plus a few helpers (range/chance/shuffle/normal).
//
// Rule (DESIGN.md §4): sim/gen code must never call Math.random — always an RNG.

export class RNG {
  private s: number;
  readonly seed0: number;

  constructor(seed: number) {
    this.seed0 = seed;
    this.s = seed % 2147483647;
    if (this.s <= 0) this.s += 2147483646;
  }

  /** raw step, 1..2147483646 */
  next(): number {
    this.s = (this.s * 16807) % 2147483647;
    return this.s;
  }

  /** [0,1) */
  float(): number {
    return (this.next() - 1) / 2147483646;
  }

  /** inclusive integer in [min,max] */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** float in [a,b) */
  range(a: number, b: number): number {
    return a + (b - a) * this.float();
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** standard normal (Box-Muller) */
  normal(): number {
    const u = 1 - this.float();
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Independent stream derived from the original seed and a label.
   *  Adding draws to one subsystem never shifts another subsystem's sequence. */
  fork(label: string): RNG {
    return new RNG(codeToSeed(`${this.seed0}:${label}`));
  }

  /** internal state, for saves */
  get state(): number {
    return this.s;
  }

  static restore(seed0: number, state: number): RNG {
    const r = new RNG(seed0);
    r.s = state;
    return r;
  }

  /** P18: stir a salt into the stream in place (holders of this RNG follow along) */
  reseed(salt: string): void {
    this.s = codeToSeed(`${this.s}:${salt}`);
  }

  /** () => [0,1) closure, for libraries such as simplex-noise */
  fn(): () => number {
    return () => this.float();
  }
}

export function codeToSeed(code: string): number {
  let h = 5381;
  for (let i = 0; i < code.length; i++) {
    h = ((h * 33) ^ code.charCodeAt(i)) >>> 0;
  }
  return h % 2147483647 || 1;
}

// UI-only: picks a fresh seed code. Not used inside gen/sim.
export function randomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += letters[Math.floor(Math.random() * letters.length)];
  }
  return s;
}
