import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';

/* Baseball — pseudo-3D. View is from behind the batter looking at the pitcher.
 * World: X = sideways (px at plate depth), hp = height above ground (px at plate depth), z = depth (0 = plate, 1 = mound).
 * Perspective: s(z) = 1 / (1 + 3 z); screen x = cx + X*s ; screen y = horizon + (groundY - hp - horizon)*s */

const INNINGS = 3;
const PITCH_TIME = [1.8, 1.6, 1.4];
const SWING_V = 1.5;           // bat-tip / hand speed (short screen sides per second) that counts as a swing
const WIN0 = .78, WIN1 = 1.02; // hit window (ball progress 0 = mound, 1 = plate)
const MAX_TILT = 70 * Math.PI / 180;   // bat always within ±70° of vertical
const HOLD_FLIP = 110 * Math.PI / 180; // fingers pointing down past this: keep previous angle (never flip)
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const sOf = (z) => 1 / (1 + 3 * z);

export class BaseballGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.runs = 0; this.inning = 1; this.strikes = 0; this.bases = [false, false, false]; this.hits = 0; this.hrs = 0; this.longest = 0;
    this.fx = new Particles(); this.pop = new Popups(); this.over = false; this.flash = 0;
    this.state = 'intro'; this.t = 2.2; this.ball = null; this.flight = null; this.miss = null; this.maxSpeed = new Map();
    this.bat = { ang: 0, handId: null, valid: false, tx: 0, ty: 0, ax: 0, ay: 0, tipSpeed: 0, tipPrev: null, len: 100 };
    this.swingSfxT = 0;
    this.crowd = new Crowd();
    a.sfx.crowdStart(); a.sfx.crowdLevel(.35, 1);
    a.setScoreLabel('Runs'); this.hud();
    a.hint('Swing your hand FAST through the box when the ring closes on the ball! ⚾');
  }
  hud() {
    const a = this.app;
    a.setLeft(`Inning ${this.inning}/${INNINGS}`);
    a.setRight('Strikes ' + '●'.repeat(this.strikes) + '○'.repeat(3 - this.strikes));
  }

  /* ---------- 3D view helpers ---------- */
  view() {
    const { W, H, min } = this.app;
    const zw = Math.min(W * .9, min * .9), zh = Math.min(min * .55, H * .4), zcy = H * .56, zy = zcy - zh / 2;
    const v = { W, H, min, zw, zh, cx: W / 2, hy: H * .22, zy, zcy, yG: zy + zh + zh * .3 };
    v.hb = v.yG - (zy + zh); v.br = zw * .08;
    return v;
  }
  zone() { const v = this.view(); return { x: v.cx - v.zw / 2, y: v.zy, w: v.zw, h: v.zh, cx: v.cx, cy: v.zcy }; }
  proj(v, X, hp, z) { const s = sOf(z); return { x: v.cx + X * s, y: v.hy + (v.yG - hp - v.hy) * s, s }; }
  ballWorld(b) { const p = Math.min(b.p, 1.12); return { X: lerp(b.X0, b.Xt, p), hp: lerp(b.h0, b.ht, p), z: 1 - p }; }
  ballScreen(v, b) { const w = this.ballWorld(b), q = this.proj(v, w.X, w.hp, w.z); return { x: q.x, y: q.y, r: v.br * q.s, s: q.s, w }; }

  startPitch() {
    const v = this.view(), a = this.app;
    const T = PITCH_TIME[Math.min(this.inning - 1, INNINGS - 1)] * rand(.92, 1.08);
    this.ball = { p: 0, T, X0: v.zw * .06, h0: v.zh * 1.7, Xt: rand(-.3, .3) * v.zw, ht: v.hb + v.zh * rand(.2, .8), resolved: false, spin: 0 };
    this.state = 'pitch'; a.sfx.pitch(); a.hint(null);
  }

  /* ---------- bat: anchored to palm, angle from smoothed wrist->middle-MCP, low-passed, clamped, never flips ---------- */
  updateBat(dt, hands) {
    const a = this.app, b = this.bat; b.len = a.min * .34;
    let h = hands.find(x => x.id === b.handId);
    if (!h) { h = hands[0]; b.handId = h ? h.id : null; b.tipPrev = null; }
    if (!h) { b.valid = false; return; }
    b.valid = true;
    let th = null;
    if (h.dpts && h.dpts.length === 21 && !h.pointer) {
      const w = h.dpts[0], m = h.dpts[9], dx = m.x - w.x, dy = m.y - w.y;
      if (Math.hypot(dx, dy) > 4) th = Math.atan2(dx, -dy);          // 0 = pointing straight up, + = leaning right
    } else th = clamp(h.vel.x * .45, -1.2, 1.2);                       // touch mode: lean into the swing
    let target = b.ang;
    if (th !== null) { th = wrapPi(th); if (Math.abs(th) <= HOLD_FLIP) target = clamp(th, -MAX_TILT, MAX_TILT); }
    b.ang += wrapPi(target - b.ang) * (1 - Math.exp(-dt * 14));       // shortest-angle low-pass
    b.ang = clamp(b.ang, -MAX_TILT, MAX_TILT);
    b.ax = h.palm.x; b.ay = h.palm.y;
    b.tx = b.ax + Math.sin(b.ang) * b.len; b.ty = b.ay - Math.cos(b.ang) * b.len;
    if (b.tipPrev && dt > 0) {
      const sp = Math.hypot(b.tx - b.tipPrev.x, b.ty - b.tipPrev.y) / dt / a.min;
      b.tipSpeed += (Math.min(sp, 8) - b.tipSpeed) * (1 - Math.exp(-dt * 25));
    } else b.tipSpeed = 0;
    b.tipPrev = { x: b.tx, y: b.ty };
  }

  destroy() { this.app.sfx.crowdStop(); }
  update(dt, hands) {
    const a = this.app; this.crowd.update(dt);
    this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2);
    for (const h of hands) { const m = this.maxSpeed.get(h.id) || 0; this.maxSpeed.set(h.id, Math.max(h.speed, m - dt * 6)); }
    this.updateBat(dt, hands);
    if (this.over) return;
    if (this.state === 'intro') { this.t -= dt; if (this.t <= 0) this.startPitch(); return; }
    if (this.state === 'wait') { this.t -= dt; if (this.t <= 0) { if (this.strikes >= 3) this.endInning(); else this.windup(); } return; }
    if (this.state === 'windup') { this.t -= dt; if (this.t <= 0) this.startPitch(); return; }
    if (this.state === 'inningBreak') { this.t -= dt; if (this.t <= 0) { this.strikes = 0; this.bases = [false, false, false]; this.hud(); this.windup(); } return; }
    if (this.state === 'pitch') {
      const b = this.ball; b.p += dt / b.T; b.spin += dt * 12;
      const v = this.view(), z = { x: v.cx - v.zw / 2, y: v.zy, w: v.zw, h: v.zh };
      if (!b.resolved && b.p >= WIN0 && b.p <= WIN1) {
        for (const h of hands) {
          const isBat = this.bat.valid && h.id === this.bat.handId;
          const sp = Math.max(h.speed, this.maxSpeed.get(h.id) || 0, isBat ? this.bat.tipSpeed * .75 : 0);
          const inBox = (x, y) => x > z.x - z.w * .15 && x < z.x + z.w * 1.15 && y > z.y - z.h * .3 && y < z.y + z.h * 1.25;
          const inZone = inBox(h.palm.x, h.palm.y) || (isBat && inBox(this.bat.tx, this.bat.ty));
          if (sp > SWING_V && inZone) { this.hit(h, sp); break; }
        }
      }
      if (!b.resolved && b.p > WIN1 + .04) this.strike();
      if (!b.resolved && this.state === 'pitch') {
        this.swingSfxT -= dt;
        for (const h of hands) if (h.speed > SWING_V && this.swingSfxT <= 0) { a.sfx.swing(); this.swingSfxT = .5; }
      }
    }
    if (this.state === 'flight') {
      const f = this.flight; f.u += dt / f.dur;
      if (f.u >= 1) { this.state = 'wait'; this.t = 1.1; this.flight = null; }
    }
    if (this.miss) { this.miss.age += dt; if (this.miss.age > .6) this.miss = null; }
  }
  windup() { this.state = 'windup'; this.t = .75; this.miss = null; this.ball = null; }
  hit(h, speed) {
    const a = this.app, b = this.ball, v = this.view(); b.resolved = true;
    const quality = clamp(1 - Math.abs(b.p - .92) / .16, 0, 1), power = clamp(speed / 3.2, .4, 1);
    let d = Math.round(70 + 340 * (.5 * quality + .5 * power) + rand(0, 25)); d = Math.min(d, 480);
    const w = this.ballWorld(b), sc = this.ballScreen(v, b);
    const bases = d >= 300 ? 4 : d >= 210 ? 3 : d >= 130 ? 2 : 1;
    const names = ['', 'Single!', 'Double!', 'Triple!', 'HOME RUN!'];
    const scored = this.advance(bases);
    this.runs += scored; this.hits++; if (bases === 4) this.hrs++; this.longest = Math.max(this.longest, d);
    a.setScore(this.runs); a.sfx.hit(); this.flash = 1;
    this.crowd.sad = 0; this.crowd.excite = bases === 4 ? 1 : .5 + .12 * bases; if (bases === 4) this.crowd.wave = 3.5;
    setTimeout(() => { if (a.game === this) a.sfx.crowdCheer(bases === 4 ? 1 : .35 + .17 * bases); }, 120);
    const dirX = clamp(h.vel.x / Math.max(.5, h.speed), -1, 1) * .6 + rand(-.25, .25);
    this.flight = { u: 0, dur: 1.2 + d / 480 * .8, X0: w.X, h0: w.hp, z0: Math.max(0, w.z), dirX, zmax: .5 + d / 480 * 3, peak: v.zh * (.6 + d / 480 * 2.4), bases, d };
    this.state = 'flight';
    this.fx.burst(sc.x, sc.y, 50, 20, 450, 8);
    a.banner(`${names[bases]}<small>${d} ft${scored ? ` • +${scored} run${scored > 1 ? 's' : ''}` : ''}</small>`, 1500);
    if (bases === 4) { setTimeout(() => { if (a.game === this) { this.fx.confetti(a.W * .3, a.H * .5, 50); this.fx.confetti(a.W * .7, a.H * .5, 50); a.sfx.cheer(); } }, 500); }
    else if (bases >= 2) setTimeout(() => { if (a.game === this) a.sfx.cheer(); }, 500);
  }
  advance(n) {
    let runs = 0; const nb = [false, false, false];
    for (let i = 2; i >= 0; i--) if (this.bases[i]) { const to = i + 1 + n; if (to >= 4) runs++; else nb[to - 1] = true; }
    if (n >= 4) runs++; else nb[n - 1] = true;
    this.bases = nb; return runs;
  }
  strike() {
    const a = this.app, b = this.ball, v = this.view(); b.resolved = true; this.strikes++; this.hud(); a.sfx.strike(); this.crowd.excite = 0; this.crowd.sad = 1.7; a.sfx.crowdGroan();
    const sc = this.ballScreen(v, b); this.miss = { age: 0, x: sc.x, y: sc.y, r: sc.r };
    a.banner(this.strikes >= 3 ? 'STRIKE 3!<small>Inning over</small>' : `STRIKE ${this.strikes}!`, 1100);
    this.state = 'wait'; this.t = 1.3;
  }
  endInning() {
    const a = this.app;
    if (this.inning >= INNINGS) { this.over = true; a.banner('Game over!', 1300); a.sfx.crowdCheer(.8); setTimeout(() => a.sfx.crowdStop(), 2600); setTimeout(() => { if (a.game === this) a.showResult({ title: this.runs >= 8 ? 'Slugger!' : 'Good game!', emoji: this.runs >= 8 ? '🏆' : '⚾', score: this.runs, stats: [['Hits', this.hits], ['Home runs', this.hrs], ['Longest', this.longest + ' ft']] }); }, 1400); return; }
    this.inning++; this.state = 'inningBreak'; this.t = 1.8; a.banner(`Inning ${this.inning}!<small>Runs so far: ${this.runs}</small>`, 1600); a.sfx.cheer(); a.sfx.crowdCheer(.4);
  }

  /* ---------- drawing ---------- */
  poly(ctx, v, pts) { ctx.beginPath(); pts.forEach(([X, z], i) => { const q = this.proj(v, X, 0, z); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); }
  drawField(ctx, v, inWin) {
    const { W, H } = v, zw = v.zw, gy = (z) => v.hy + (v.yG - v.hy) * sOf(z);
    // mowed grass bands (semi-transparent so you can still see yourself through the camera)
    const zs = [-0.08, .08, .22, .4, .62, .9, 1.3, 1.9, 2.7, 4, 7], cols = ['rgba(70,175,85,.55)', 'rgba(52,152,72,.55)'];
    for (let i = 0; i < zs.length; i++) { const y0 = i === 0 ? H : gy(zs[i]), y1 = i + 1 < zs.length ? gy(zs[i + 1]) : v.hy; ctx.fillStyle = cols[i % 2]; ctx.fillRect(0, y1, W, Math.max(0, Math.min(H, y0) - y1) + 1); }
    // infield dirt (fan around home plate)
    const pts = [[0, -.06]]; for (let a = -45; a <= 45; a += 9) { const r = a * Math.PI / 180; pts.push([zw * 1.9 * Math.sin(r), 1.25 * Math.cos(r) - .04]); }
    ctx.fillStyle = 'rgba(205,150,100,.62)'; this.poly(ctx, v, pts); ctx.fill();
    // foul lines
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3; ctx.beginPath();
    for (const sg of [-1, 1]) { const a = this.proj(v, 0, 0, -.05), b = this.proj(v, sg * zw * 1.6 * 6.04, 0, 6); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke();
    // pitching lane + HIT WINDOW highlight on the ground (z from plate to 0.22 = swing window)
    const lane = (z0, z1, w) => [[-w, z0], [w, z0], [w, z1], [-w, z1]];
    ctx.fillStyle = 'rgba(255,255,255,.10)'; this.poly(ctx, v, lane(0, 1, zw * .3)); ctx.fill();
    ctx.fillStyle = inWin ? 'rgba(125,255,176,.55)' : 'rgba(125,255,176,.22)'; this.poly(ctx, v, lane(0, 1 - WIN0, zw * .3)); ctx.fill();
    // mound + rubber
    const m = this.proj(v, 0, 0, 1);
    ctx.fillStyle = 'rgba(222,170,120,.9)'; ctx.beginPath(); ctx.ellipse(m.x, m.y, zw * .75 * m.s, zw * .75 * m.s * .3, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(m.x - zw * .12 * m.s, m.y - zw * .02 * m.s, zw * .24 * m.s, Math.max(2, zw * .035 * m.s));
    // home plate
    ctx.fillStyle = '#fff'; this.poly(ctx, v, [[-zw * .17, .02], [zw * .17, .02], [zw * .17, -.015], [0, -.05], [-zw * .17, -.015]]); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
  }

  drawBallSprite(ctx, x, y, r, rot = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r); g.addColorStop(0, '#fff'); g.addColorStop(1, '#d6dbe4');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#e63946'; ctx.lineWidth = Math.max(1.2, r * .09);
    ctx.beginPath(); ctx.arc(-r * 1.15, 0, r * .8, -.8, .8); ctx.stroke(); ctx.beginPath(); ctx.arc(r * 1.15, 0, r * .8, Math.PI - .8, Math.PI + .8); ctx.stroke();
    ctx.restore();
  }
  shadow(ctx, v, X, z, r) { const q = this.proj(v, X, 0, z); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 1.1, r * .38, 0, 0, 6.3); ctx.fill(); }
  drawPitcher(ctx, v) {
    const m = this.proj(v, 0, 0, 1), s = v.zh * .19; let arm = -.4;
    if (this.state === 'windup') { const k = 1 - Math.max(0, this.t) / .75; arm = -.4 - Math.sin(k * Math.PI) * 2.2 + k * 1.6; }
    else if (this.state === 'pitch' && this.ball && this.ball.p < .12) arm = 1.2;
    ctx.save(); ctx.translate(m.x, m.y - 1.8 * s);
    ctx.strokeStyle = '#1d3b8b'; ctx.lineCap = 'round'; ctx.lineWidth = s * .28;
    ctx.beginPath(); ctx.moveTo(-s * .18, s * .9); ctx.lineTo(-s * .3, s * 1.8); ctx.moveTo(s * .18, s * .9); ctx.lineTo(s * .3, s * 1.8); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.lineWidth = s * .08;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-s * .4, -s * .35, s * .8, s * 1.3, s * .25) : ctx.rect(-s * .4, -s * .35, s * .8, s * 1.3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f2b38b'; ctx.lineWidth = s * .22; ctx.beginPath(); ctx.moveTo(s * .3, -s * .2); ctx.lineTo(s * .3 + Math.sin(arm) * s * .9, -s * .2 - Math.cos(arm) * s * .9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * .3, -s * .2); ctx.lineTo(-s * .6, s * .4); ctx.stroke();
    ctx.fillStyle = '#f2b38b'; ctx.beginPath(); ctx.arc(0, -s * .7, s * .38, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(0, -s * .78, s * .4, Math.PI, 0); ctx.fill(); ctx.fillRect(-s * .4, -s * .8, s * .95, s * .1);
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * .13, -s * .68, s * .04, 0, 6.3); ctx.arc(s * .13, -s * .68, s * .04, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  drawMeter(ctx, v) {
    const b = this.ball, x = Math.max(22, v.W * .035), y0 = v.H * .3, y1 = v.H * .66, h = y1 - y0, w = 12;
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,80,.55)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2 - 4, y0 - 24, w + 8, h + 48, 12) : ctx.rect(x - w / 2 - 4, y0 - 24, w + 8, h + 48); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x - w / 2, y0, w, h);
    ctx.fillStyle = 'rgba(125,255,176,.9)'; ctx.fillRect(x - w / 2, y0 + h * WIN0, w, h * (Math.min(1, WIN1) - WIN0));
    ctx.font = '700 14px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('⚾', x, y0 - 8); ctx.fillText('🏏', x, y1 + 20);
    if (b && this.state === 'pitch') { const yy = y0 + h * clamp(b.p, 0, 1); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b2bb5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, yy, 9, 0, 6.3); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  drawDiamond(ctx) {
    const a = this.app, cx = a.W - 70, cy = 120, d = 26;
    const pts = [[cx + d, cy], [cx, cy - d], [cx - d, cy]];
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy + d); ctx.lineTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.closePath(); ctx.fillStyle = 'rgba(20,10,80,.5)'; ctx.fill(); ctx.stroke();
    pts.forEach((p, i) => { ctx.fillStyle = this.bases[i] ? '#ffe45e' : 'rgba(255,255,255,.4)'; ctx.fillRect(p[0] - 9, p[1] - 9, 18, 18); });
    ctx.restore();
  }
  drawBat(ctx, v) {
    const b = this.bat; if (!b.valid || this.over) return;
    const a = this.app, hw = a.min * .03;
    ctx.save(); ctx.translate(b.ax, b.ay); ctx.rotate(b.ang); // local +y is down, bat points toward -y (up)
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = hw; ctx.beginPath(); ctx.moveTo(4, hw * .6); ctx.lineTo(4, -b.len + 4); ctx.stroke();
    const g = ctx.createLinearGradient(-hw, 0, hw, 0); g.addColorStop(0, '#9b6a35'); g.addColorStop(1, '#e0ae6a');
    ctx.strokeStyle = g; ctx.lineWidth = hw * .8; ctx.beginPath(); ctx.moveTo(0, hw * .5); ctx.lineTo(0, -b.len * .55); ctx.stroke();           // handle
    ctx.lineWidth = hw * 1.7; ctx.beginPath(); ctx.moveTo(0, -b.len * .5); ctx.lineTo(0, -b.len); ctx.stroke();                                      // barrel
    ctx.fillStyle = '#7a4d22'; ctx.beginPath(); ctx.arc(0, hw * .6, hw * .6, 0, 6.3); ctx.fill();                                                    // knob
    ctx.restore();
  }
  draw(ctx) {
    const a = this.app, { W, H } = a, v = this.view();
    const b = this.ball, pitching = this.state === 'pitch' && b;
    const inWin = !!(pitching && b.p >= WIN0 && b.p <= WIN1);
    this.crowd.draw(ctx, v);
    this.drawField(ctx, v, inWin);
    // strike zone (plate plane) + closing ring = distance cue
    ctx.save(); ctx.lineWidth = inWin ? 7 : 4; ctx.strokeStyle = inWin ? '#7dffb0' : 'rgba(255,255,255,.85)'; ctx.setLineDash([16, 10]);
    if (inWin) { ctx.shadowColor = '#7dffb0'; ctx.shadowBlur = 22; ctx.fillStyle = 'rgba(125,255,176,.12)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(v.cx - v.zw / 2, v.zy, v.zw, v.zh, 24) : ctx.rect(v.cx - v.zw / 2, v.zy, v.zw, v.zh); ctx.fill(); }
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(v.cx - v.zw / 2, v.zy, v.zw, v.zh, 24) : ctx.rect(v.cx - v.zw / 2, v.zy, v.zw, v.zh); ctx.stroke(); ctx.restore();
    if (pitching && b.p < 1.05) {
      const tgt = this.proj(v, b.Xt, b.ht, 0), k = clamp(1 - b.p, 0, 1), R = v.br * (1 + 2.6 * k);
      ctx.save(); ctx.lineWidth = inWin ? 6 : 3.5; ctx.strokeStyle = inWin ? '#7dffb0' : `rgba(255,255,255,${.35 + .5 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(tgt.x, tgt.y, R, 0, 6.3); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(tgt.x, tgt.y, v.br, 0, 6.3); ctx.stroke(); ctx.restore();
    }
    this.drawPitcher(ctx, v);
    if (pitching) {
      const sc = this.ballScreen(v, b), w = sc.w;
      this.shadow(ctx, v, w.X, w.z, sc.r);
      for (let i = 3; i >= 1; i--) { const q = this.ballScreen(v, { ...b, p: Math.max(0, b.p - i * .03) }); ctx.globalAlpha = .12 * (4 - i); this.drawBallSprite(ctx, q.x, q.y, q.r, b.spin); }
      ctx.globalAlpha = 1; this.drawBallSprite(ctx, sc.x, sc.y, sc.r, b.spin);
    }
    if (this.miss) { const m = this.miss, k = m.age / .6; ctx.globalAlpha = 1 - k; this.drawBallSprite(ctx, m.x, m.y + k * a.min * .25, m.r * (1 + k * .5), k * 8); ctx.globalAlpha = 1; }
    if (this.flight) {
      const f = this.flight, u = f.u, z = f.z0 + (f.zmax - f.z0) * u, X = f.X0 + f.dirX * v.zw * 2.2 * (z - f.z0);
      let hp = f.h0 * (1 - u) + 4 * f.peak * u * (1 - u); if (f.bases === 4) hp += u * u * v.zh * 1.2;
      const q = this.proj(v, X, hp, z);
      this.shadow(ctx, v, X, z, Math.max(3, v.br * q.s));
      this.drawBallSprite(ctx, q.x, q.y, Math.max(3, v.br * q.s), u * 20);
      if (u > .75 && f.bases === 4) { ctx.globalAlpha = clamp((u - .75) * 4, 0, 1); bigText(ctx, '🎆', q.x, Math.max(60, q.y), a.min * .2); ctx.globalAlpha = 1; }
    }
    if (inWin) bigText(ctx, 'SWING!', W / 2, v.zy - a.min * .07, a.min * .1, '#7dffb0');
    if (pitching) this.drawMeter(ctx, v);
    this.drawBat(ctx, v);
    this.fx.draw(ctx); this.pop.draw(ctx); this.drawDiamond(ctx);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .5})`; ctx.fillRect(0, 0, W, H); }
  }
}
