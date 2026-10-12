/* Tennis maths. Metres: X sideways, Z from your baseline (0) to the CPU's baseline (LZ); net at Z = NET. */
export const G = 6, COURT = { HW: 4.1, LZ: 22, NET: 11, NETH: .95 };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function launch(from, to, T, g = G) { return { vx: (to.X - from.X) / T, vz: (to.Z - from.Z) / T, vh: (.5 * g * T * T - from.h) / T }; }
export const inCourtFar = (X, Z) => Math.abs(X) <= COURT.HW && Z >= COURT.NET && Z <= COURT.LZ;
export const inCourtNear = (X, Z) => Math.abs(X) <= COURT.HW && Z >= 0 && Z <= COURT.NET;
/** Where your return is aimed: hand x (screen) -> sideways, swing direction adds a bit, swing power -> depth. */
export function aimTarget({ x, W, dir = 0, power }) {
  return { X: clamp((x - W / 2) / (W * .3), -1, 1) * 3.4 + clamp(dir, -1, 1) * 1.4, Z: 12.5 + clamp(power, 0, 1) * 7.7 };
}
const shortest = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
/** Racket tilt (radians from straight up, + = right): low-pass, clamped, shortest-angle, and ignores 180° flips. */
export class RacketAngle {
  constructor() { this.a = 0; }
  update(raw, dt) {
    if (raw === null || raw === undefined || !isFinite(raw)) { this.a *= Math.exp(-dt * 2); return this.a; }
    raw = clamp(raw, -1.2, 1.2); const d = shortest(raw - this.a);
    if (Math.abs(d) < 2.2) this.a += d * (1 - Math.exp(-dt * 10));
    return this.a;
  }
}
/** Points to 4 wins a game; first to `toWin` games wins the match. */
export class Score {
  constructor(toWin = 3) { this.pp = 0; this.ap = 0; this.pg = 0; this.ag = 0; this.toWin = toWin; this.totalP = 0; }
  point(who) {
    if (who === 'p') { this.pp++; this.totalP++; } else this.ap++;
    if (this.pp >= 4 || this.ap >= 4) { const w = this.pp >= 4 ? 'p' : 'a'; if (w === 'p') this.pg++; else this.ag++; this.pp = this.ap = 0; return { game: w, match: this.pg >= this.toWin ? 'p' : this.ag >= this.toWin ? 'a' : null }; }
    return { game: null, match: null };
  }
  leader() { return this.pg !== this.ag ? (this.pg > this.ag ? 'p' : 'a') : this.pp !== this.ap ? (this.pp > this.ap ? 'p' : 'a') : null; }
}
