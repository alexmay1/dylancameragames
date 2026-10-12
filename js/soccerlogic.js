/* Soccer: pure logic (no DOM) so kick detection and goalie save zones can be unit-tested on synthetic poses.
 * All coordinates are screen pixels divided by the short screen side ("min"), time in seconds. */

export class KickDetector {
  constructor(o = {}) { this.thr = o.thr ?? 1.3; this.hist = {}; this.sw = null; this.lastFire = -9; this.refractory = o.refractory ?? .8; this.live = 0; }
  /** feet: { id: {x, y} } (min-normalised screen coords). Returns a kick {power, vx, vy, speed, x, y, id} once per swing, else null. */
  push(t, feet) {
    let best = null;
    for (const id in feet) {
      const f = feet[id]; if (!f) continue;
      const h = this.hist[id] || (this.hist[id] = []); h.push({ t, x: f.x, y: f.y }); while (h.length > 10 || (h.length > 2 && t - h[0].t > .5)) h.shift();
      let ref = null; for (let i = h.length - 2; i >= 0; i--) if (t - h[i].t >= .05) { ref = h[i]; break; }       // newest sample at least 50 ms old
      if (!ref) continue;
      const dt = t - ref.t, vx = (f.x - ref.x) / dt, vy = (f.y - ref.y) / dt, sp = Math.hypot(vx, vy);
      if (!best || sp > best.speed) best = { id, speed: sp, vx, vy, x: f.x, y: f.y };
    }
    this.live = best ? best.speed : 0;
    if (t - this.lastFire < this.refractory || !best) return null;
    if (!this.sw) { if (best.speed > this.thr) this.sw = { t0: t, peak: best }; return null; }
    if (best.speed > this.sw.peak.speed) this.sw.peak = best;
    if (best.speed < this.sw.peak.speed * .8 || t - this.sw.t0 > .12) {
      const p = this.sw.peak; this.sw = null; this.lastFire = t;
      return { power: Math.min(1, Math.max(.12, (p.speed - this.thr) / (3.6 - this.thr))), vx: p.vx, vy: p.vy, speed: p.speed, x: p.x, y: p.y, id: p.id };
    }
    return null;
  }
}

/** Turns a kick into a shot at the goal plane: xt metres from centre (goal half-width 3.66), hg metres high (bar = 2.44), ball speed m/s. */
export function shotFromKick(k, off = 0) {
  const sp = Math.max(.01, k.speed ?? Math.hypot(k.vx, k.vy)), ratio = k.vx / sp, up = -k.vy / sp;
  const aim = Math.max(-1.15, Math.min(1.15, ratio * 1.5 + off * .6));
  const loft = Math.max(0, Math.min(1.25, .3 + .5 * up + .25 * k.power));
  return { xt: aim * 3.4, hg: .4 + 2.0 * loft, power: k.power, speed: 10 + 14 * k.power };
}

/** Save zones (circles, in px) from the pose landmarks, hands and (touch) pointer. map(i) -> {x,y} px. */
export function saveZones({ pts, map, hands = [], min, W }) {
  const z = []; const ok = (i) => pts && pts[i] && (pts[i].visibility ?? 1) > .3;
  if (pts) {
    for (const i of [15, 16]) if (ok(i)) z.push({ ...map(i), r: .09 * min, k: 'wrist' });
    for (const i of [27, 28]) if (ok(i)) z.push({ ...map(i), r: .075 * min, k: 'ankle' });
    for (const i of [31, 32]) if (ok(i)) z.push({ ...map(i), r: .06 * min, k: 'foot' });
    for (const i of [25, 26]) if (ok(i)) z.push({ ...map(i), r: .06 * min, k: 'knee' });
    if (ok(0)) z.push({ ...map(0), r: .075 * min, k: 'head' });
    const tor = [11, 12, 23, 24].filter(ok);
    if (tor.length >= 2) {
      const p = tor.map(map), cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length;
      const lean = Math.max(-1, Math.min(1, (cx - W / 2) / (W * .3)));
      z.push({ x: cx, y: cy, r: .13 * min * (1 + .5 * Math.abs(lean)), k: 'torso', lean });
    }
  }
  for (const h of hands) z.push({ x: h.palm.x, y: h.palm.y, r: (h.pointer ? .14 : .1) * min, k: h.pointer ? 'touch' : 'hand' });
  return z;
}
/** hist: [{t, zones}] snapshots from the last ~0.3 s. */
export function ballSaved(bx, by, br, hist) {
  for (const s of hist) for (const z of s.zones) if (Math.hypot(bx - z.x, by - z.y) <= z.r + br * .6) return z;
  return null;
}
