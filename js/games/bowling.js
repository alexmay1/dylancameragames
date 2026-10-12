import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { ReleaseDetector } from '../gestures.js?v=23';
import { bowlState, bowlScore, bowlTotal } from '../bowlrules.js?v=23';

/* Bowling — swing your arm and let go. Metres: X sideways, Z down the lane (0 = foul line, PZ = head pin). */
const FRAMES = 5, LW = .6, GUT = .78, PZ = 8.5, BR = .15, PR = .09, D0 = 1.5;

export class BowlingGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.rolls = []; this.det = {}; this.over = false; this.ballX = 0; this.ball = null; this.shown = 0; this.lastHand = null; this.flash = 0;
    this.setupPins(); this.standingBefore = 10; this.lastGut = 0; this.toReady(1.1);
    a.sfx.crowdStart(); a.sfx.crowdLevel(.3, 1);
    a.setScoreLabel('Score'); a.setScore(0); this.hud();
  }
  destroy() { this.app.sfx.crowdStop(); }
  setupPins() {
    this.pins = []; let id = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) this.pins.push({ id: id++, x: (c - r / 2) * .3, z: PZ + r * .26, vx: 0, vz: 0, fallen: false, k: 0, ang: 0, gone: false });
  }
  hud() { const st = bowlState(this.rolls, FRAMES); this.app.setLeft(`Frame ${Math.min(st.frame + 1, FRAMES)}/${FRAMES}`); this.app.setRight(`Ball ${st.ball + 1}`); this.app.setScore(bowlTotal(this.rolls.concat([0, 0, 0]), FRAMES)); }
  toReady(delay = .6) {
    const a = this.app; this.state = 'ready'; this.t = delay; this.ball = null; this.shot = null; Object.values(this.det).forEach(d => d.reset());
    a.hint(a.touchMode && !a.cameraOn ? '🎳 Swipe your finger FAST, then let go! Where you swipe sets the aim.' : '🎳 Swing your arm like you’re rolling a ball, then let go! Hand position = aim.');
    this.hud();
  }
  view() {
    const { W, H } = this.app, port = W < H;
    return { W, H, cx: W / 2, hy: H * .3, K: W * (port ? 1.1 : .75), camH: port ? 1.6 : 1 };
  }
  P(v, X, Z, h = 0) { const s = v.K / (Z + D0); return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s }; }

  update(dt, hands) {
    const a = this.app, min = a.min, now = performance.now() / 1000;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5);
    const hand = hands.find(h => !h.pointer) || hands[0]; if (hand) this.lastHand = hand;
    if (this.state === 'ready') {
      this.t -= dt;
      const h = hand || (this.lastHand && this.lastHand.pointer ? this.lastHand : null);
      if (h) this.ballX = lerp(this.ballX, clamp((h.palm.x - a.W / 2) / (a.W * .35), -1, 1) * .5, .3);
      for (const hh of hands) {
        const d = this.det[hh.id] || (this.det[hh.id] = new ReleaseDetector({ hi: 1.25, cool: .8 }));
        const r = d.push(now, { speed: hh.speed, vx: hh.vel.x, vy: hh.vel.y, x: hh.palm.x, y: hh.palm.y });
        if (r && this.t <= 0) { this.release(r); break; }
      }
    } else if (this.state === 'roll') this.simulate(dt);
    else if (this.state === 'settle') { this.simulate(dt); this.t -= dt; if (this.t <= 0) this.score(); }
    else if (this.state === 'between') { this.t -= dt; if (this.t <= 0) { if (this.over) return; this.toReady(.4); } }
  }
  release(r) {
    const a = this.app, v = this.speedOf(r);
    const X0 = clamp((r.x - a.W / 2) / (a.W * .35), -1, 1) * .5, lat = clamp(r.dir, -1, 1) * .12 * v;
    this.ball = { X: X0, Z: 0, vx: lat, vz: v, gut: 0, spin: 0 }; this.state = 'roll'; this.rollT = 0; a.hint(null);
    a.sfx.whoosh(); a.sfx.roll(Math.min(1.6, PZ / v));
  }
  speedOf(r) { return 4.5 + r.power * 6.5; }
  simulate(dt) {
    const a = this.app, b = this.ball, n = 3, h = dt / n; let hits = 0;
    for (let s = 0; s < n; s++) {
      if (b) {
        b.Z += b.vz * h; b.X += b.vx * h; b.spin += h * 14;
        if (!b.gut) {
          if (b.Z > 1 && Math.abs(b.X) > .42) b.vx -= Math.sign(b.X) * 1.4 * h;              // gentle pull back to the middle
          if (Math.abs(b.X) > LW + .1) { b.gut = Math.sign(b.X); b.vx = 0; a.sfx.bounce(); }
        } else { b.X = lerp(b.X, b.gut * (GUT - .06), .15); }
      }
      for (const p of this.pins) {
        if (p.gone) continue;
        if (b && !b.gut && Math.hypot(p.x - b.X, p.z - b.Z) < BR + PR + .05) {
          const dx = p.x - b.X, dz = p.z - b.Z, l = Math.hypot(dx, dz) || 1;
          if (!p.fallen) { p.fallen = true; hits++; }
          p.vx = b.vx * .9 + dx / l * 2.6 + rand(-.5, .5); p.vz = b.vz * .85 + dz / l * 1.8; p.dir = Math.sign(dx) || 1;
          b.vz *= 1 - .03; b.vx = lerp(b.vx, b.vx - dx / l * .5, .1);
        }
        if (p.fallen) {
          p.x += p.vx * h; p.z += p.vz * h; const f = Math.max(0, 1 - 1.9 * h); p.vx *= f; p.vz *= f; p.k = Math.min(1, p.k + h * 2.4);
          if (Math.hypot(p.vx, p.vz) > .5) for (const q of this.pins) if (q !== p && !q.fallen && !q.gone && Math.hypot(q.x - p.x, q.z - p.z) < .2) { q.fallen = true; q.dir = Math.sign(q.x - p.x) || 1; q.vx = p.vx * .75 + (q.x - p.x) * 3; q.vz = p.vz * .75; p.vx *= .85; p.vz *= .85; hits++; }
          if (p.z > PZ + 1.2 || Math.abs(p.x) > GUT) { p.gone = true; }
        }
      }
    }
    if (hits) { a.sfx.pins(hits + 1); this.crowd.excite = Math.min(1, this.crowd.excite + .15 * hits); }
    if (this.state === 'roll' && b && b.Z > PZ + 1.7) { this.lastGut = b.gut; this.ball = null; this.state = 'settle'; this.t = 1.1; }
    else if (this.state === 'roll' && !b) { this.state = 'settle'; this.t = 1; }
  }
  score() {
    const a = this.app, down = this.pins.filter(p => p.fallen || p.gone).length;
    const sb = this.standingBefore, knocked = Math.max(0, sb - (10 - down));
    this.rolls.push(knocked);
    const st = bowlState(this.rolls, FRAMES), k = knocked, strike = sb === 10 && k === 10, spare = !strike && down === 10 && sb < 10;
    this.hud(); this.state = 'between'; this.t = 1.6;
    const msg = strike ? 'STRIKE! 🎳' : spare ? 'SPARE! 😎' : k === 0 ? (this.lastGut ? 'GUTTER 😬' : 'No pins… 😮') : `${k} pin${k > 1 ? 's' : ''}!`;
    a.banner(msg, 1300);
    if (strike) { a.sfx.crowdCheer(1); this.fx.confetti(a.W / 2, a.H * .4, 70); this.flash = 1; a.sfx.cheer(); }
    else if (spare) { a.sfx.crowdCheer(.7); this.fx.confetti(a.W / 2, a.H * .4, 40); }
    else if (k >= 6) a.sfx.crowdCheer(.5); else if (k === 0) a.sfx.crowdGroan();
    // reset pins when needed
    const allDown = down === 10;
    if (st.done) { this.over = true; setTimeout(() => this.finish(), 1500); return; }
    if (allDown || st.ball === 0) { setTimeout(() => { if (this.app.game === this) this.setupPins(); }, 900); this.standingBefore = 10; }
    else this.standingBefore = 10 - down;
    // knocked-over pins stay down for the second ball: remove them
    if (!allDown && st.ball !== 0) for (const p of this.pins) if (p.fallen || p.gone) p.gone = true;
  }
  finish() {
    const a = this.app, tot = bowlTotal(this.rolls, FRAMES), strikes = this.rolls.filter(r => r === 10).length;
    a.sfx.crowdCheer(.8); setTimeout(() => a.sfx.crowdStop(), 2400);
    a.showResult({ title: tot >= 90 ? 'Bowling champ!' : tot >= 50 ? 'Nice rolling!' : 'Good try!', emoji: tot >= 90 ? '🏆' : '🎳', score: tot, stats: [['Strikes', strikes], ['Rolls', this.rolls.length]] });
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H } = a, v = this.view(), now = performance.now() / 1000;
    // back wall / ceiling
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#1a0f3d'); g.addColorStop(1, '#3b2a7a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    // floor + lane
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#2a1a4a'); g.addColorStop(1, '#4b2f7a'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const q = (X, Z) => this.P(v, X, Z), L = PZ + 1.6;
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([X, Z], i) => { const p = q(X, Z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    const zNear = -D0 + .25;
    poly([[-GUT - .1, zNear], [GUT + .1, zNear], [GUT + .1, L], [-GUT - .1, L]], '#1b1030');                // gutters / pit
    poly([[-LW, zNear], [LW, zNear], [LW, PZ + 1.0], [-LW, PZ + 1.0]], '#d9a15a');                          // lane wood
    ctx.strokeStyle = 'rgba(120,70,20,.28)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = -5; i <= 5; i++) { const x = i * LW / 5.5, p0 = q(x, zNear), p1 = q(x, PZ + 1); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); } ctx.stroke();
    poly([[-LW, zNear], [LW, zNear], [LW, 0], [-LW, 0]], '#c68944');                                         // approach
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, this.P(v, 0, 0).s * .03); ctx.beginPath(); const f0 = q(-LW, 0), f1 = q(LW, 0); ctx.moveTo(f0.x, f0.y); ctx.lineTo(f1.x, f1.y); ctx.stroke();
    ctx.fillStyle = 'rgba(120,40,20,.55)'; for (let i = -2; i <= 2; i++) { const p = q(i * .22, 3.4), s = p.s; ctx.beginPath(); ctx.moveTo(p.x, p.y - .16 * s); ctx.lineTo(p.x - .05 * s, p.y + .02 * s); ctx.lineTo(p.x + .05 * s, p.y + .02 * s); ctx.fill(); }
    for (const sg of [-1, 1]) poly([[sg * LW, zNear], [sg * (LW + .03), zNear], [sg * (LW + .03), PZ + 1], [sg * LW, PZ + 1]], 'rgba(70,40,10,.7)');
    // pins (back to front), then ball
    const items = this.pins.filter(p => !p.gone || p.k < 1).map(p => ({ z: p.z, f: () => this.drawPin(ctx, v, p) }));
    if (this.state === 'ready' || this.ball) { const b = this.ball || { X: this.ballX, Z: 0, spin: now * 0, vz: 0 }; items.push({ z: b.Z, f: () => this.drawBall(ctx, v, b) }); }
    items.sort((A, B) => B.z - A.z).forEach(it => it.f());
    if (this.state === 'ready') { // aim guide
      const p0 = q(this.ballX, 0), p1 = q(this.ballX * .9, PZ); ctx.save(); ctx.setLineDash([10, 12]); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.restore();
    }
    this.drawScoreboard(ctx, v);
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .4})`; ctx.fillRect(0, 0, W, H); }
  }
  drawPin(ctx, v, p) {
    const base = this.P(v, p.x, p.z, 0), s = base.s, h = .8 * s, w = .19 * s;
    ctx.save(); ctx.translate(base.x, base.y);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 0, w * .9, w * .3, 0, 0, 6.3); ctx.fill();
    if (p.fallen) { ctx.rotate(p.dir * p.k * 1.45); ctx.globalAlpha = p.gone ? 1 - p.k * .0 : 1; }
    const g = ctx.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, '#d8d8e0'); g.addColorStop(.4, '#fff'); g.addColorStop(1, '#b8bac8'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-w * .62, 0); ctx.bezierCurveTo(-w * 1.15, -h * .22, -w * .75, -h * .5, -w * .32, -h * .64); ctx.bezierCurveTo(-w * .26, -h * .78, -w * .38, -h * .84, -w * .36, -h * .92);
    ctx.bezierCurveTo(-w * .3, -h * 1.02, w * .3, -h * 1.02, w * .36, -h * .92); ctx.bezierCurveTo(w * .38, -h * .84, w * .26, -h * .78, w * .32, -h * .64); ctx.bezierCurveTo(w * .75, -h * .5, w * 1.15, -h * .22, w * .62, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e63946'; ctx.fillRect(-w * .4, -h * .73, w * .8, h * .05); ctx.fillRect(-w * .38, -h * .67, w * .76, h * .035);
    ctx.restore();
  }
  drawBall(ctx, v, b) {
    const c = this.P(v, b.X, b.Z, BR), r = BR * c.s;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; const gp = this.P(v, b.X, b.Z, 0); ctx.beginPath(); ctx.ellipse(gp.x, gp.y, r * 1.05, r * .35, 0, 0, 6.3); ctx.fill();
    const g = ctx.createRadialGradient(c.x - r * .35, c.y - r * .4, r * .1, c.x, c.y, r); g.addColorStop(0, '#8a8cff'); g.addColorStop(.5, '#3a2db0'); g.addColorStop(1, '#150f50'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,10,.75)'; const a = b.spin || 0; for (const [ox, oy] of [[-.25, -.25], [.05, -.35], [-.1, -.02]]) { const x = ox * Math.cos(a) - oy * Math.sin(a), y = ox * Math.sin(a) + oy * Math.cos(a); ctx.beginPath(); ctx.arc(c.x + x * r, c.y + y * r, r * .1, 0, 6.3); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(c.x - r * .38, c.y - r * .42, r * .2, r * .11, -.8, 0, 6.3); ctx.fill();
  }
  drawScoreboard(ctx, v) {
    const { W, H } = v, port = W < H, bw = Math.min(W * .17, port ? 70 : 84), pw = bw * FRAMES, ph = bw * .78, x = port ? (W - pw) / 2 : W - pw - 8, y = port ? 142 : 66, fr = bowlScore(this.rolls, FRAMES), st = bowlState(this.rolls, FRAMES);
    ctx.save(); ctx.fillStyle = 'rgba(15,10,50,.92)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 4, y - 4, pw + 8, ph + 8, 10) : ctx.rect(x - 4, y - 4, pw + 8, ph + 8); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let f = 0; f < FRAMES; f++) {
      const bx = x + f * bw, cur = f === st.frame && !st.done; ctx.strokeStyle = cur ? '#ffe45e' : 'rgba(255,255,255,.35)'; ctx.lineWidth = cur ? 3 : 1.5; ctx.strokeRect(bx + 1, y, bw - 2, ph);
      ctx.fillStyle = '#fff'; ctx.font = `800 ${bw * .22}px system-ui`; const rr = fr[f].r, cells = f === FRAMES - 1 ? 3 : 2, cw = (bw - 2) / cells;
      for (let k = 0; k < rr.length; k++) ctx.fillText(rr[k], bx + 1 + cw * (k + .5) + (f < FRAMES - 1 && rr[0] === 'X' ? cw : 0) * (k === 0 ? 1 : 0), y + ph * .25);
      ctx.fillStyle = '#ffe45e'; ctx.font = `900 ${bw * .32}px system-ui`; if (fr[f].cum !== null) ctx.fillText(fr[f].cum, bx + bw / 2, y + ph * .68);
    }
    ctx.restore();
  }
}
