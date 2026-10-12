import { clamp } from './util.js?v=23';
/* Skiing steering from body lean (pure; unit-tested). x = shoulder-mid x (px), sw = shoulder width (px). Returns steer in -1..1 (+ = right on screen). */
export class SteerCal {
  constructor(calT = .8) { this.calT = calT; this.reset(); }
  reset() { this.base = null; this.sum = 0; this.n = 0; this.cal = 0; this.locked = false; this.steer = 0; }
  get ready() { return this.locked; }
  update(dt, x, sw) {
    sw = Math.max(30, sw);
    if (!this.locked) { this.sum += x; this.n++; this.base = this.sum / this.n; this.cal += dt; if (this.cal >= this.calT) this.locked = true; this.steer = 0; return 0; }
    const raw = (x - this.base) / (sw * .45);
    if (Math.abs(raw) < .3) this.base += (x - this.base) * Math.min(1, dt / 12);      // drift back only when near centre, so a held lean keeps steering
    const dz = .1, v = Math.abs(raw) < dz ? 0 : Math.sign(raw) * (Math.abs(raw) - dz) / (1 - dz);
    const target = clamp(v * 1.15, -1, 1); this.steer += (target - this.steer) * Math.min(1, dt * 14); return this.steer;
  }
}
/** Touch steering: finger x across the screen. */
export const pointerSteer = (x, W) => clamp((x - W / 2) / (W * .35), -1, 1);
