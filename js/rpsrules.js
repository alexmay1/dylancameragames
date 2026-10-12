/* Rock-Paper-Scissors hand-shape classifier + helpers (pure, unit-tested). pts = 21 hand landmarks {x,y}. */
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
export const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];   // [tip, pip] for index, middle, ring, pinky
/** Which of index/middle/ring/pinky are extended (tip clearly further from the wrist than the middle joint). */
export function extended(pts) {
  const w = pts[0]; return FINGERS.map(([t, p]) => d(pts[t], w) / Math.max(1e-6, d(pts[p], w)) > 1.12);
}
export function classify(pts) {
  if (!pts || pts.length < 21) return null;
  const [i, m, r, p] = extended(pts), n = +i + +m + +r + +p;
  if (n === 0) return 'rock';
  if (i && m && !r && !p) return 'scissors';
  if (n >= 3 && i && m) return 'paper';
  return null;
}
/** Rolling vote of recent labels (time window, seconds). */
export class Vote {
  constructor(win = .4) { this.win = win; this.h = []; }
  push(t, label) { this.h.push({ t, label }); while (this.h.length && t - this.h[0].t > this.win) this.h.shift(); }
  reset() { this.h.length = 0; }
  /** most common label if it has >= frac of the samples (ignores 'null' samples unless nothing else) */
  top(frac = .5) {
    const c = {}; let n = 0; for (const e of this.h) if (e.label) { c[e.label] = (c[e.label] || 0) + 1; n++; }
    if (!n) return null; const [k, v] = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return v / this.h.length >= frac ? k : null;
  }
}
/** 1 = a beats b, -1 = b beats a, 0 tie */
export function duel(a, b) { if (a === b) return 0; return (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper') ? 1 : -1; }
