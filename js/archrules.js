import { clamp } from './util.js?v=23';
/* Archery maths + draw/release gesture (pure; unit-tested). Screen px, y down. */
export const TARGET_R = .61, G = 9.8;
export const flightV = (p) => 25 + 35 * clamp(p, .15, 1);
export const flightT = (D, p) => D / flightV(p);
const drop = (D, p) => .35 * .5 * G * flightT(D, p) ** 2;
export const IDEAL = .85;
/** Where an arrow lands relative to the bullseye, in metres. aimPx = crosshair minus target centre in px; ppm = px per metre at the target. */
export function impact(aimPx, ppm, D, power, wind) {
  return { dx: aimPx.x / ppm + wind * flightT(D, power) * .35, dy: aimPx.y / ppm + drop(D, power) - drop(D, IDEAL) };
}
/** 10 = bullseye ring ... 1 outer ring, 0 miss. Returns {pts, x:isX} */
export function ringScore(dx, dy) { const r = Math.hypot(dx, dy); if (r > TARGET_R) return { pts: 0, x: false }; return { pts: Math.max(1, 10 - Math.floor(r / (TARGET_R / 10))), x: r < TARGET_R / 20 }; }

/** Pull-back-and-release (one hand: hold to aim, pull DOWN fast then back UP; two hands: spread apart to draw, bring together to release). */
export class ArcheryInput {
  constructor() { this.reset(); }
  reset() { this.state = 'aim'; this.anchor = null; this.start = null; this.peakY = 0; this.t0 = 0; this.peakD = 0; this.lastD = null; this.cool = 0; this.draw = 0; this.hist = []; }
  update(t, dt, hands, min) {
    const hs = hands.filter(h => !h.pointer); const out = { aim: this.anchor, draw: this.draw, release: null, mode: hs.length >= 2 ? 'two' : 'one', seen: hs.length > 0 };
    if (!hs.length) { this.draw = 0; if (this.state === 'draw') this.reset(); out.draw = 0; return out; }
    if (this.cool > 0) { this.cool -= dt; }
    if (hs.length >= 2) {
      hs.sort((a, b) => a.palm.x - b.palm.x); const bow = hs[0], str = hs[1], D = Math.hypot(str.palm.x - bow.palm.x, str.palm.y - bow.palm.y) / min;
      if (!this.anchor) this.anchor = { x: bow.palm.x, y: bow.palm.y };
      if (this.state !== 'draw') { const k = 1 - Math.exp(-dt / .25); this.anchor.x += (bow.palm.x - this.anchor.x) * k; this.anchor.y += (bow.palm.y - this.anchor.y) * k; }
      const d = clamp((D - .2) / .3, 0, 1), dD = this.lastD === null ? 0 : (D - this.lastD) / Math.max(dt, 1e-3); this.lastD = D;
      if (this.state === 'aim' && d > .3 && this.cool <= 0) { this.state = 'draw'; this.peakD = d; this.t0 = t; }
      else if (this.state === 'draw') {
        this.peakD = Math.max(this.peakD, d);
        if (this.peakD > .35 && (d < this.peakD - .22 || dD < -.9)) { out.release = { power: clamp(.2 + this.peakD * .8, .2, 1) }; this.state = 'aim'; this.cool = .7; this.peakD = 0; }
        else if (d < .12 || t - this.t0 > 4) { this.state = 'aim'; }
      }
      this.draw = this.state === 'draw' ? d : 0; out.draw = this.draw; out.aim = this.anchor; return out;
    }
    const h = hs[0], p = h.palm; this.lastD = null;
    if (!this.anchor) this.anchor = { x: p.x, y: p.y };
    if (this.state === 'aim') {
      this.hist.push({ t, x: p.x, y: p.y }); while (this.hist.length && t - this.hist[0].t > .6) this.hist.shift();
      const k = 1 - Math.exp(-dt / .3); this.anchor.x += (p.x - this.anchor.x) * k; this.anchor.y += (p.y - this.anchor.y) * k;
      if (this.cool <= 0 && p.y - this.anchor.y > .07 * min && h.vel.y > .25) { this.state = 'draw'; const o = this.hist.find(e => t - e.t <= .45) || this.hist[0]; this.start = { x: o.x, y: o.y }; this.peakY = p.y; this.t0 = t; }
    } else {
      this.peakY = Math.max(this.peakY, p.y); const depth = (this.peakY - this.start.y) / min;
      this.draw = clamp(depth / .22, 0, 1);
      if (depth > .07 && (this.peakY - p.y > .04 * min || h.vel.y < -.35)) { out.release = { power: clamp(.2 + .8 * depth / .22, .2, 1) }; this.anchor = { ...this.start }; this.state = 'aim'; this.cool = .8; this.draw = 0; }
      else if (t - this.t0 > 2.6) { this.state = 'aim'; this.anchor = { x: p.x, y: p.y }; this.draw = 0; this.cool = .5; }
      out.aim = this.start || this.anchor;
    }
    if (this.state === 'aim') this.draw = 0; out.draw = this.draw; if (!out.release || !out.aim) out.aim = this.state === 'draw' ? this.start : this.anchor; if (out.release) out.aim = this.anchor;
    return out;
  }
}
