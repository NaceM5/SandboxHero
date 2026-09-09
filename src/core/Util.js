export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, t) => a + (b - a) * (1 - Math.pow(0.0001, t)); // frame-rate independent
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
/** Shortest signed angle from a to b. */
export function angleDelta (a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function approachAngle (cur, target, rate, dt) {
  return cur + angleDelta(cur, target) * (1 - Math.exp(-rate * dt));
}

/** Deterministic value noise — used for crime density and city variation. */
export class Noise {
  constructor (seed = 1337) { this.seed = seed; }
  /**
   * 32-bit integer hash.
   *
   * Must stay inside int32 the whole way: the obvious float version
   * (`x * A + y * B + seed * C`) silently collapses to a constant, because
   * adding a ~1e8 term to a ~1e25 one is a no-op in float64 — which makes the
   * whole noise field flat. Math.imul keeps the multiplies exact and XOR
   * mixes without the magnitude blow-up.
   */
  hash (x, y) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(this.seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  value (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi), b = this.hash(xi + 1, yi);
    const c = this.hash(xi, yi + 1), d = this.hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  fbm (x, y, oct = 4) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += this.value(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  }
}

/**
 * Seeded PRNG (mulberry32). World generation runs entirely off one of these so
 * the city is byte-identical every load — same skyline, same river, same
 * bridge — while gameplay randomness still uses Math.random.
 */
export class Rng {
  constructor (seed = 1) { this.s = seed >>> 0; }
  next () {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range (a, b) { return a + this.next() * (b - a); }
  int (a, b) { return Math.floor(this.range(a, b + 1)); }
  pick (arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance (p) { return this.next() < p; }
}
