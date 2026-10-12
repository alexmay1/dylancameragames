import { clamp } from './util.js?v=23';
/* Pure gesture helpers (unit-tested). Speeds are in "short screen sides per second" like the hand tracker. */

/** Swing-and-release: fires when the hand has swung fast (peak >= hi) and then slows down (release). */
export class ReleaseDetector {
  constructor(o = {}) { this.hi = o.hi ?? 1.3; this.drop = o.drop ?? .55; this.win = o.win ?? .45; this.cool = o.cool ?? 1; this.max = o.max ?? 3.5; this.hist = []; this.last = -9; }
  reset() { this.hist.length = 0; }
  /** h = {speed, vx, vy, x, y} (x,y in px or 0..1, caller's choice) */
  push(t, h) {
    const H = this.hist; H.push({ t, s: h.speed, vx: h.vx, vy: h.vy, x: h.x, y: h.y }); while (H.length && t - H[0].t > this.win) H.shift();
    if (t - this.last < this.cool) return null;
    let pk = H[0]; for (const e of H) if (e.s > pk.s) pk = e;
    if (pk.s >= this.hi && h.speed < pk.s * this.drop && t - pk.t > .02) {
      this.last = t; H.length = 0;
      return { peak: pk.s, power: .25 + .75 * clamp((pk.s - this.hi) / (this.max - this.hi), 0, 1), x: pk.x, y: pk.y, vx: pk.vx, vy: pk.vy, dir: pk.vx / (pk.s || 1) };
    }
    return null;
  }
}

/** Upward flick (basketball shot): fast and mostly upward. */
export class FlickDetector {
  constructor(o = {}) { this.thr = o.thr ?? 1.5; this.up = o.up ?? .55; this.cool = o.cool ?? .55; this.last = -9; }
  push(t, h) {
    if (t - this.last < this.cool || h.speed < this.thr || h.vy > -this.up * h.speed) return null;
    this.last = t; return { speed: h.speed, vx: h.vx, vy: h.vy, dir: h.vx / h.speed, power: clamp((h.speed - this.thr) / 2.2, 0, 1), x: h.x, y: h.y };
  }
}

/** Punch from a wrist track. p = {x, y, z, sx, sy, sw} (px, wrist + same-side shoulder, sw = shoulder width in px; z in the same px scale, smaller = nearer the camera). */
export class PunchDetector {
  constructor(o = {}) { this.thr = o.thr ?? 3.4; this.cool = o.cool ?? .32; this.gain = o.gain ?? .1; this.hist = []; this.last = -9; }
  push(t, p) {
    const H = this.hist, sw = Math.max(20, p.sw), e = Math.hypot(p.x - p.sx, p.y - p.sy, ((p.z ?? 0) - (p.sz ?? 0))) / sw;
    H.push({ t, x: p.x, y: p.y, z: p.z ?? 0, e }); while (H.length && t - H[0].t > .3) H.shift();
    if (t - this.last < this.cool) return null;
    const o = H.find(q => t - q.t <= .16 && t - q.t >= .03); if (!o) return null;
    const dt = t - o.t, speed = Math.hypot(p.x - o.x, p.y - o.y, (p.z ?? 0) - o.z) / sw / dt, gain = e - o.e, toward = (o.z - (p.z ?? 0)) / sw;
    if (speed > this.thr && (gain > this.gain || toward > .2)) { this.last = t; return { speed, power: clamp((speed - this.thr) / 5, 0, 1), dx: (p.x - o.x) / sw / dt, dy: (p.y - o.y) / sw / dt }; }
    return null;
  }
}

/** Head-based lean / duck, in shoulder widths, relative to a slowly adapting baseline. */
export class BodyMotion {
  constructor() { this.bx = null; this.by = null; this.t = null; }
  update(t, x, y, sw) {
    sw = Math.max(20, sw); const dt = this.t === null ? .05 : Math.min(.3, t - this.t); this.t = t;
    if (this.bx === null) { this.bx = x; this.by = y; }
    this.bx += (x - this.bx) * Math.min(1, dt / 3);
    if (y < this.by) this.by += (y - this.by) * Math.min(1, dt * 6); else this.by += (y - this.by) * Math.min(1, dt * .12);
    return { lean: (x - this.bx) / sw, duck: (y - this.by) / sw };
  }
}
