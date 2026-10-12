import { Particles, Popups, bigText, rand, clamp, lerp, pick } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { FlickDetector, BodyMotion } from '../gestures.js?v=23';

/* Dodgeball — sidestep & duck (pose torso/head), catch with your hands, flick to throw back. Court: X in -1..1 across, u = 0 (you) .. 1 (them). */
const LIVES = 3, FAR = 2.5;
const SHIRTS = ['#ff4f5e', '#4f8bff', '#ffd23f', '#52d66b', '#c05cff'];

export class DodgeballGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.sim = !!a.balanceSim || (a.touchMode && !a.cameraOn);
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.score = 0; this.lives = LIVES; this.wave = 0; this.over = false; this.t = 0; this.hurt = 0; this.flash = 0; this.catches = 0; this.outs = 0; this.dodges = 0;
    this.px = a.W / 2; this.ducked = false; this.body = new BodyMotion(); this.pdet = {}; this.pw = {}; this.lastPoseT = -1; this.noBody = 0; this.hands = []; this.balls = []; this.holding = true;
    a.pose.enabled = !this.sim; a.pose.minInterval = 40;
    a.sfx.crowdStart(); a.sfx.crowdLevel(.35, 1); a.setScoreLabel('Points'); a.setScore(0);
    this.newWave(); this.hud();
    a.hint(this.sim ? '🤾 Move your finger left/right to sidestep, hold it low to duck. Touch a ball to catch it, swipe UP to throw!' : '🤾 Sidestep to dodge, duck for high balls, catch with your hands, FLICK up to throw back!');
  }
  destroy() { const a = this.app; a.pose.enabled = false; a.pose.minInterval = 40; a.sfx.crowdStop(); }
  hud() { const a = this.app; a.setLeft(`Wave ${this.wave}`); a.setRight('❤️'.repeat(Math.max(0, this.lives)) + '🖤'.repeat(LIVES - Math.max(0, this.lives)) + (this.holding ? ' 🏐' : '')); a.setScore(this.score); }
  newWave() {
    this.wave++; const n = Math.min(5, 2 + this.wave);
    this.ais = Array.from({ length: n }, (_, i) => ({ X: -.8 + 1.6 * (i + .5) / n, x0: -.8 + 1.6 * (i + .5) / n, alive: true, wind: 0, fall: 0, shirt: SHIRTS[i % 5], dodge: 0 }));
    this.balls = this.balls.filter(b => b.kind === 'in'); this.holding = true; this.next = 2.2; this.state = 'play'; this.waveBreak = 0; this.hud();
    if (this.wave > 1) this.app.banner(`Wave ${this.wave}! 🏐`, 1100);
  }
  view() { const { W, H } = this.app; return { W, H, cx: W / 2, hy: H * .32, half: W * .4 }; }
  pu(u) { return 1 / (1 + FAR * u); }
  scr(v, X, u, hf) { const s = this.pu(u), yF = v.hy + (v.H * .95 - v.hy) * s; return { x: v.cx + X * v.half * s, y: yF - hf * v.H * .8 * s, yF, s }; }

  /* ---------- input ---------- */
  readInput(dt, hands) {
    const a = this.app, now = performance.now() / 1000, s = a.pose.state, hs = hands.slice(); this.noBody = this.noBody;
    if (this.sim) {
      const ptr = hands.find(h => h.pointer);
      if (this.pxOverride !== undefined) this.px = this.pxOverride;
      else if (ptr) { this.px = lerp(this.px, ptr.palm.x, .45); this.ducked = ptr.palm.y > a.H * .8; }
    } else if (now - s.t < 1 && s.pts) {
      const P = s.pts, vis = (i) => P[i] && (P[i].visibility ?? 1) > .3, m = (i) => a.mapPoint(P[i].x, P[i].y);
      if (vis(11) && vis(12)) {
        this.noBody = 0; const l = m(11), r = m(12), sw = Math.max(30, Math.hypot(l.x - r.x, l.y - r.y)); this.px = lerp(this.px, (l.x + r.x) / 2, .6);
        if (vis(0) && s.t !== this.lastPoseT) { const n = m(0), b = this.body.update(s.t, n.x, n.y, sw); this.ducked = b.duck > .38; }
      } else this.noBody += dt;
      for (const i of [15, 16]) if (vis(i)) {
        const w = m(i), o = this.pw[i]; let vx = 0, vy = 0;
        if (o && s.t > o.t) { const d = s.t - o.t; vx = (w.x - o.x) / d / a.min; vy = (w.y - o.y) / d / a.min; if (s.t === this.lastPoseT) { vx = o.vx; vy = o.vy; } }
        this.pw[i] = { x: w.x, y: w.y, t: s.t === this.lastPoseT && o ? o.t : s.t, vx, vy };
        hs.push({ id: 'pw' + i, palm: { x: w.x, y: w.y }, vel: { x: vx, y: vy }, speed: Math.hypot(vx, vy), pose: true });
      }
      this.lastPoseT = s.t;
    } else this.noBody += dt;
    this.hands = hs;
  }

  /* ---------- update ---------- */
  update(dt, hands) {
    const a = this.app, v = this.view(), now = performance.now() / 1000; this.t += dt;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.hurt = Math.max(0, this.hurt - dt * 2); this.flash = Math.max(0, this.flash - dt * 2.5);
    this.readInput(dt, hands);
    if (!this.sim && this.noBody > 1.2) a.hint("I can't see you! Step back so your head and shoulders fit on screen. 🙋"); else if (this.t > 7) a.hint(null);
    if (this.over) return;
    const alive = this.ais.filter(q => q.alive);
    for (const q of this.ais) { q.wind = Math.max(0, q.wind - dt); if (!q.alive) q.fall = Math.min(1, q.fall + dt * 3); q.X = lerp(q.X, q.x0 + q.dodge, 1 - Math.exp(-dt * 8)); q.dodge *= Math.exp(-dt * 2); }
    if (this.state === 'play') {
      this.next -= dt;
      if (this.next <= 0 && alive.length) { this.throwAt(alive); this.next = Math.max(.85, rand(1.5, 2.3) - .13 * this.wave); }
      // throw back
      if (this.holding) for (const h of this.hands) {
        const d = this.pdet[h.id] || (this.pdet[h.id] = new FlickDetector({ thr: 1.4, up: .35, cool: .5 }));
        const f = d.push(now, { speed: h.speed, vx: h.vel.x, vy: h.vel.y, x: h.palm.x, y: h.palm.y });
        if (f) { this.throwBack(f); break; }
      }
      if (!alive.length) { this.state = 'clear'; this.waveBreak = 2.2; this.score += 20 * this.wave; this.hud(); a.banner(`Wave ${this.wave} cleared! +${20 * this.wave} 🎉`, 1500); a.sfx.crowdCheer(1); a.sfx.cheer(); this.fx.confetti(a.W / 2, a.H * .4, 70); }
    } else if (this.state === 'clear') { this.waveBreak -= dt; if (this.waveBreak <= 0) this.newWave(); }
    for (const b of this.balls) this.stepBall(b, dt, v);
    this.balls = this.balls.filter(b => !b.done);
  }
  throwAt(alive) {
    const a = this.app, th = pick(alive), high = this.wave >= 2 && Math.random() < .3, aimed = Math.random() < .6;
    const px = clamp((this.px - this.app.W / 2) / this.view().half, -1, 1), Xt = aimed ? clamp(px + rand(-.12, .12), -1, 1) : rand(-1, 1);
    th.wind = .5; a.sfx.whoosh();
    this.balls.push({ kind: 'in', from: th, X0: th.X, Xt, high, T: Math.max(1.1, 1.9 - .12 * this.wave), t: -.35, X: th.X, u: 1, hf: .6, done: false, spin: 0 });
  }
  throwBack(f) {
    const a = this.app, v = this.view(), Xt = clamp((f.x - v.cx) / v.half, -1, 1); this.holding = false; a.sfx.whoosh(); this.hud(); a.hint(null);
    this.balls.push({ kind: 'out', X0: clamp((this.px - v.cx) / v.half, -1, 1), Xt, T: .75, t: 0, X: 0, u: 0, hf: .35, done: false, spin: 0 });
  }
  handNear(b, v) {
    const p = this.scr(v, b.X, b.u, b.hf), r = this.ballR(v, b.u) * 1.1 + this.app.min * .05;
    return this.hands.some(h => Math.hypot(h.palm.x - p.x, h.palm.y - p.y) < r);
  }
  ballR(v, u) { return this.app.min * .075 * (this.pu(u) * (1 + FAR) * .5 + .15); }
  stepBall(b, dt, v) {
    const a = this.app; b.spin += dt * 8; b.t += dt / b.T; if (b.t < 0) return;
    if (b.kind === 'in') {
      const k = clamp(b.t, 0, 1); b.u = 1 - k; b.X = lerp(b.X0, b.Xt, k); b.hf = lerp(.6, b.high ? .78 : .42, k) + Math.sin(k * Math.PI) * .1;
      if (!b.res && b.u < .3 && this.handNear(b, v)) { b.res = 'catch'; b.done = true; this.catches++; this.score += 5; this.holding = true; this.hud(); const p = this.scr(v, b.X, b.u, b.hf); this.pop.add(p.x, p.y, 'CAUGHT! +5', '#7dffb0', Math.max(30, a.min * .06)); this.fx.burst(p.x, p.y, 130, 14, 300, 6); a.sfx.catch_(); a.sfx.crowdCheer(.5); a.hint(this.t < 30 ? '🏐 Got it! Now FLICK your hand UP to throw it back!' : null); return; }
      if (b.t >= 1 && !b.res) {
        const sx = this.scr(v, b.X, 0, b.hf).x, hit = Math.abs(sx - this.px) < v.W * .14 && !(b.high && this.ducked);
        if (hit) { b.res = 'hit'; this.lives--; this.hurt = 1; a.sfx.ouch(); a.sfx.thwack(); this.crowd.sad = 1.2; a.sfx.crowdGroan(); this.pop.add(this.px, a.H * .6, 'OUCH!', '#ff8a8a', Math.max(30, a.min * .07)); this.hud(); if (this.lives <= 0) this.finish(); b.done = true; }
        else { b.res = 'miss'; this.dodges++; this.score += 1; this.pop.add(this.px, a.H * .7, b.high ? 'Ducked!' : 'Dodged!', '#bff', Math.max(24, a.min * .05)); a.sfx.tick(); this.hud(); }
      }
      if (b.t > 1.25) b.done = true;
    } else {
      const k = clamp(b.t, 0, 1); b.u = k; b.X = lerp(b.X0, b.Xt, k); b.hf = .35 + Math.sin(k * Math.PI) * .25;
      if (b.t >= 1 && !b.res) {
        b.res = 'x'; const t = this.ais.filter(q => q.alive).sort((p, q) => Math.abs(p.X - b.Xt) - Math.abs(q.X - b.Xt))[0], p = this.scr(v, b.Xt, 1, .4);
        if (t && Math.abs(t.X - b.Xt) < .42) {
          if (this.wave >= 2 && Math.random() < .2) { t.dodge = pick([-.3, .3]); this.pop.add(p.x, p.y - 30, 'Dodged!', '#ffd2d2', Math.max(24, a.min * .05)); }
          else { t.alive = false; this.outs++; this.score += 10; this.pop.add(p.x, p.y - 30, 'OUT! +10', '#ffe45e', Math.max(28, a.min * .06)); this.fx.burst(p.x, p.y, 40, 16, 320, 6); a.sfx.thwack(); a.sfx.crowdCheer(.6); this.crowd.excite = Math.min(1, this.crowd.excite + .3); this.hud(); }
        } else { this.pop.add(p.x, p.y, 'Miss', '#ddd', Math.max(22, a.min * .045)); a.sfx.bounce(); }
      }
      if (b.t > 1.3) b.done = true;
    }
  }
  finish() {
    const a = this.app; if (this.over) return; this.over = true; a.hint(null); a.sfx.crowdCheer(.6); setTimeout(() => a.sfx.crowdStop(), 2200);
    setTimeout(() => { if (a.game === this) a.showResult({ title: this.wave >= 4 ? 'Dodgeball legend!' : this.wave >= 2 ? 'Great dodging!' : 'Good try!', emoji: this.wave >= 4 ? '🏆' : '🏐', score: this.score, stats: [['Wave', this.wave], ['Outs', this.outs], ['Catches', this.catches], ['Dodges', this.dodges]] }); }, 900);
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view();
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#1a1650'); g.addColorStop(1, '#4b3b9a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#c58a4e'); g.addColorStop(1, '#e8b676'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    // court lines
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3; ctx.beginPath();
    for (const X of [-1.05, 1.05]) { const p0 = this.scr(v, X, 0, 0), p1 = this.scr(v, X, 1.15, 0); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
    for (const u of [.5, 1.15]) { const p0 = this.scr(v, -1.05, u, 0), p1 = this.scr(v, 1.05, u, 0); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); } ctx.stroke();
    ctx.fillStyle = 'rgba(255,60,60,.14)'; const a0 = this.scr(v, -1.05, 1.15, 0), a1 = this.scr(v, 1.05, 1.15, 0), a2 = this.scr(v, 1.05, .5, 0), a3 = this.scr(v, -1.05, .5, 0); ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.lineTo(a3.x, a3.y); ctx.fill();
    // AI team (far first)
    for (const q of this.ais) this.drawKid(ctx, v, q);
    // target markers for incoming balls
    for (const b of this.balls) if (b.kind === 'in' && b.t >= -.1 && b.t < 1 && !b.res) { const p = this.scr(v, b.Xt, 0, 0), r = min * .09; ctx.save(); ctx.globalAlpha = .35 + .3 * Math.sin(this.t * 14); ctx.strokeStyle = b.high ? '#ffb02e' : '#ff4f5e'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(p.x, p.yF, r * 1.3, r * .4, 0, 0, 6.3); ctx.stroke(); ctx.restore(); if (b.high && b.t > .1) bigText(ctx, '⬇ DUCK', p.x, H * .22, min * .06, '#ffb02e'); }
    // balls sorted far→near
    const balls = this.balls.filter(b => b.t >= 0).sort((p, q) => q.u - p.u);
    for (const b of balls) this.drawBall(ctx, v, b);
    // you
    const yy = H * .93, rw = min * .16; ctx.save(); ctx.globalAlpha = .55; ctx.fillStyle = this.ducked ? '#ffb02e' : '#4fe0ff'; ctx.beginPath(); ctx.ellipse(this.px, yy, rw, rw * .28, 0, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = `900 ${min * .028}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(this.ducked ? 'DUCK' : 'YOU', this.px, yy); ctx.restore();
    if (this.holding) { const r = min * .06; this.drawBallSprite(ctx, clamp(this.px, r, W - r), H * .84 - r * .2, r, this.t * 2, '#ff4f5e'); }
    for (const h of this.hands) { if (h.pointer) continue; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(h.palm.x, h.palm.y, min * .04, 0, 6.3); ctx.stroke(); }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.hurt > 0) { ctx.fillStyle = `rgba(255,0,20,${this.hurt * .3})`; ctx.fillRect(0, 0, W, H); }
  }
  drawBallSprite(ctx, x, y, r, rot, col) {
    const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r); g.addColorStop(0, '#ffffffcc'); g.addColorStop(.25, col); g.addColorStop(1, '#6b0f1a'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1.5, r * .08); ctx.beginPath(); ctx.arc(0, 0, r * .6, .3, 2.2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * .6, 3.4, 5.4); ctx.stroke(); ctx.restore();
  }
  drawBall(ctx, v, b) {
    const p = this.scr(v, b.X, b.u, b.hf), r = this.ballR(v, b.u), col = b.kind === 'out' ? '#4f8bff' : b.high ? '#ff9f1c' : '#ff4f5e';
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(p.x, p.yF, r * .9, r * .28, 0, 0, 6.3); ctx.fill();
    this.drawBallSprite(ctx, p.x, p.y, r, b.spin, col);
  }
  drawKid(ctx, v, q) {
    const p = this.scr(v, q.X, 1, 0), h = this.app.min * .6 * p.s * .95, s = h;
    ctx.save(); ctx.translate(p.x, p.yF); if (!q.alive) { ctx.rotate(q.fall * 1.4 * (q.x0 < 0 ? -1 : 1)); ctx.globalAlpha = 1 - q.fall * .6; }
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(0, 0, s * .28, s * .07, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#27346b'; ctx.lineCap = 'round'; ctx.lineWidth = s * .1; ctx.beginPath(); ctx.moveTo(-s * .08, -s * .38); ctx.lineTo(-s * .1, 0); ctx.moveTo(s * .08, -s * .38); ctx.lineTo(s * .1, 0); ctx.stroke();
    ctx.fillStyle = q.shirt; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-s * .17, -s * .75, s * .34, s * .4, s * .06) : ctx.rect(-s * .17, -s * .75, s * .34, s * .4); ctx.fill();
    const w = q.wind > 0 ? 1 - q.wind / .5 : 0; ctx.strokeStyle = '#e0ac84'; ctx.lineWidth = s * .075;
    ctx.beginPath(); ctx.moveTo(-s * .17, -s * .68); ctx.lineTo(-s * .26, -s * .45); ctx.moveTo(s * .17, -s * .68); ctx.lineTo(s * (.24 + .1 * w), -s * (.45 + .55 * w)); ctx.stroke();
    if (q.wind > 0) { ctx.fillStyle = '#ff4f5e'; ctx.beginPath(); ctx.arc(s * .3, -s * (1.05 + .1 * w), s * .09, 0, 6.3); ctx.fill(); }
    ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.arc(0, -s * .88, s * .14, 0, 6.3); ctx.fill(); ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(0, -s * .92, s * .14, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-s * .05, -s * .87, s * .016, 0, 6.3); ctx.arc(s * .05, -s * .87, s * .016, 0, 6.3); ctx.fill();
    ctx.restore();
  }
}
