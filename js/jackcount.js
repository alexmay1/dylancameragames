/* Jumping-jack counting: pure logic (no DOM) so it can be unit-tested on synthetic poses. */

/** lm: normalized landmarks {11,12 shoulders; 15,16 wrists; 23,24 hips; 27,28 ankles}; vw/vh: video pixel size. */
export function jackMetrics(lm, vw, vh) {
  const X = (i) => lm[i].x * vw, Y = (i) => lm[i].y * vh;
  const shX = (X(11) + X(12)) / 2, shY = (Y(11) + Y(12)) / 2, hipX = (X(23) + X(24)) / 2, hipY = (Y(23) + Y(24)) / 2;
  const torso = Math.max(10, Math.hypot(shX - hipX, shY - hipY)), sw = Math.max(10, Math.abs(X(11) - X(12)), torso * .45);
  const arm = ((Y(11) - Y(15)) + (Y(12) - Y(16))) / 2 / torso;     // wrists above shoulders: >0, overhead ≈ 1+
  const leg = Math.abs(X(27) - X(28)) / sw;                          // ankle gap relative to shoulder width
  return { arm, leg };
}

export class JackCounter {
  constructor() { this.minRep = .3; this.reset(); }
  reset() {
    this.count = 0; this.phase = 'down'; this.arm = null; this.leg = null; this.lastRep = -9; this.openT = -9;
    this.armsUp = false; this.armsDown = true; this.legsApart = false; this.legsTogether = true; this.upSince = null; this.downSince = null;
  }
  /** m = {arm, leg}; t in seconds. Returns true when a rep was just completed. */
  update(m, t) {
    const k = .6;                                                    // light smoothing on top of the landmark filters
    this.arm = this.arm == null ? m.arm : this.arm + (m.arm - this.arm) * k;
    this.leg = this.leg == null ? m.leg : this.leg + (m.leg - this.leg) * k;
    const a = this.arm, l = this.leg;
    // hysteresis: separate on/off thresholds so noise near a threshold can't flicker
    this.armsUp = this.armsUp ? a > .25 : a > .5;
    this.armsDown = this.armsDown ? a < .05 : a < -.15;
    this.legsApart = this.legsApart ? l > 1.25 : l > 1.5;
    this.legsTogether = this.legsTogether ? l < 1.35 : l < 1.15;
    const upNow = this.armsUp && this.legsApart, downNow = this.armsDown && this.legsTogether;
    this.upSince = upNow ? (this.upSince ?? t) : null; this.downSince = downNow ? (this.downSince ?? t) : null;
    if (this.phase === 'down') {
      if (upNow && t - this.upSince >= .06) { this.phase = 'up'; this.openT = t; }
    } else if (downNow && t - this.downSince >= .06 && t - this.openT >= .15 && t - this.lastRep >= this.minRep) {
      this.phase = 'down'; this.count++; this.lastRep = t; return true;
    }
    return false;
  }
}
