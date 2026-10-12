import { Particles, Popups, bigText, rand, clamp, lerp, pick } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { G, COURT, launch, aimTarget, inCourtFar, inCourtNear, RacketAngle, Score } from '../tennisrules.js?v=23';

/* Tennis — your hand is the racket. Swing fast through the ball as it reaches you. First to 3 games (points to 4) or the 4:00 timer. */
const MATCH_T = 240, BR = .11, REACH_Z = 2.2;

export class TennisGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.sc = new Score(3); this.time = MATCH_T; this.level = 0; this.over = false; this.t = 0; this.hist = {}; this.lastHand = null; this.rk = new RacketAngle(); this.racket = { x: a.W / 2, y: a.H * .75, ang: 0, speed: 0 };
    this.ai = { X: 0, swing: 0 }; this.ball = null; this.trail = []; this.server = 'p'; this.rallies = 0; this.bestRally = 0; this.rally = 0; this.aces = 0;
    a.sfx.crowdStart(.04); a.sfx.crowdLevel(.2, 1); a.setScoreLabel('Points'); a.setScore(0);
    this.toServe(); this.hud();
  }
  destroy() { this.app.sfx.crowdStop(); }
  hud() { const s = this.sc, a = this.app, m = Math.max(0, Math.ceil(this.time)); a.setLeft(`Games ${s.pg}–${s.ag}`); a.setRight(`⏱ ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`); a.setScore(s.totalP * 10 + s.pg * 50); }
  view() {
    const { W, H } = this.app, port = W < H, d0 = port ? 3.5 : 6, s0 = W * (port ? .11 : .0915), K = s0 * d0, y0 = H * (port ? .78 : .72), hy = H * (port ? .3 : .3);
    return { W, H, cx: W / 2, hy, K, d0, camH: (y0 - hy) / s0, s0 };
  }
  P(v, X, Z, h = 0) { const s = v.K / (Z + v.d0); return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s, gy: v.hy + v.camH * s }; }

  /* ---------- flow ---------- */
  toServe() {
    const a = this.app; this.state = 'serve'; this.sT = 0; this.ball = null; this.trail = []; this.rally = 0; this.rallyHit = false;
    if (this.server === 'p') { a.hint(a.touchMode && !a.cameraOn ? '🎾 Your serve! Swipe UP fast to toss & hit. (It serves for you after a few seconds.)' : '🎾 Your serve! Swing your hand up fast to toss & hit. (Auto-serve after a few seconds.)'); }
    else { a.hint(null); this.aiServeT = 1.3; }
  }
  pointTo(who, msg) {
    if (this.state !== 'rally') return; const a = this.app, s = this.sc; this.state = 'point'; this.pT = 1.7; this.ball && (this.ball.dead = true);
    if (this.rally > this.bestRally) this.bestRally = this.rally;
    const r = s.point(who); this.hud();
    a.banner(`${who === 'p' ? '👏 ' : ''}${msg}`, 1200);
    if (who === 'p') { a.sfx.crowdCheer(.6); this.crowd.excite = Math.min(1, this.crowd.excite + .4); a.sfx.cheer(); } else { a.sfx.crowdGroan(); this.crowd.sad = 1; }
    if (r.game) { this.level++; this.server = this.server === 'p' ? 'a' : 'p'; this.pT = 2.6; a.banner(`${r.game === 'p' ? '🏆 Game to YOU!' : 'Game to CPU'}  (${s.pg}–${s.ag})`, 1800); a.sfx.crowdCheer(r.game === 'p' ? 1 : .3); if (r.match) this.matchOver = r.match; }
    if (this.matchOver) this.pT = 2.4;
  }
  finish(w) {
    const a = this.app; if (this.over) return; this.over = true; a.hint(null); const s = this.sc, win = w === 'p';
    const score = s.totalP * 10 + s.pg * 50 + (win ? 100 : 0); a.sfx.crowdCheer(win ? 1 : .4); setTimeout(() => a.sfx.crowdStop(), 2200);
    a.setScore(score); setTimeout(() => { if (a.game === this) a.showResult({ title: win ? 'You win the match!' : w === 'a' ? 'CPU wins — rematch?' : 'Good match!', emoji: win ? '🏆' : '🎾', score, stats: [['Games', `${s.pg}–${s.ag}`], ['Points won', s.totalP], ['Best rally', this.bestRally]] }); }, 700);
  }

  /* ---------- update ---------- */
  update(dt, hands) {
    const a = this.app, v = this.view(), now = performance.now() / 1000; this.t += dt;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.ai.swing = Math.max(0, this.ai.swing - dt * 3);
    if (this.state !== 'point' && !this.over && this.state !== 'serve' || this.state === 'serve') { this.time -= dt; if (Math.ceil(this.time) !== this._tc) { this._tc = Math.ceil(this.time); this.hud(); } }
    if (this.time <= 0 && !this.over && this.state !== 'point') { const l = this.sc.leader(); return this.finish(l || 'draw'); }
    // racket / hand
    const hand = hands.find(h => !h.pointer) || hands[0]; if (hand) this.lastHand = hand;
    const h = hand || (this.lastHand && this.lastHand.pointer ? this.lastHand : null);
    if (h) {
      const k = 1 - Math.exp(-dt * 25); this.racket.x = lerp(this.racket.x, h.palm.x, k); this.racket.y = lerp(this.racket.y, clamp(h.palm.y, a.H * .35, a.H), k);
      let raw = null; if (h.dpts && h.dpts[9] && h.dpts[0]) raw = Math.atan2(h.dpts[9].x - h.dpts[0].x, -(h.dpts[9].y - h.dpts[0].y)); else if (h.pointer) raw = clamp(h.vel.x * .35, -.8, .8);
      this.racket.ang = this.rk.update(raw, dt); this.racket.speed = h.speed;
    } else this.racket.ang = this.rk.update(null, dt);
    for (const hh of hands) { const q = this.hist[hh.id] || (this.hist[hh.id] = []); q.push({ t: now, s: hh.speed, x: hh.palm.x, y: hh.palm.y, vx: hh.vel.x, vy: hh.vel.y }); while (q.length && now - q[0].t > .3) q.shift(); }
    this.swing = this.bestSwing(now);
    // state machine
    if (this.state === 'serve') {
      this.sT += dt;
      if (this.server === 'p') { if ((this.swing && this.swing.s > 1.3 && this.swing.vy < -.15 * this.swing.s && this.sT > .5) || this.sT > 6) this.playerServe(this.sT > 6 && !(this.swing && this.swing.s > 1.3)); }
      else { this.aiServeT -= dt; if (this.aiServeT <= 0) this.aiServe(); }
    } else if (this.state === 'point') { this.pT -= dt; if (this.pT <= 0) { if (this.matchOver) this.finish(this.matchOver); else { this.toServe(); } } }
    if (this.ball && this.state === 'rally') this.stepBall(dt, v);
    this.stepAI(dt);
    if (this.ball) { this.trail.push({ X: this.ball.X, Z: this.ball.Z, h: this.ball.h }); if (this.trail.length > 6) this.trail.shift(); }
    else this.trail.length = 0;
  }
  bestSwing(now) { let b = null; for (const id in this.hist) for (const e of this.hist[id]) if (now - e.t <= .25 && (!b || e.s > b.s)) b = e; return b; }
  playerX(v) { return clamp((this.racket.x - v.cx) / (v.K / (.5 + v.d0)), -4.2, 4.2); }
  playerServe(auto) {
    const a = this.app, v = this.view(), sw = auto ? { x: a.W / 2, s: 1.6, vx: 0 } : this.swing, power = auto ? .3 : clamp((sw.s - 1.3) / 2.2, 0, 1);
    const tgt = aimTarget({ x: sw.x, W: a.W, dir: clamp(sw.vx / (sw.s || 1), -1, 1), power }); tgt.Z = clamp(tgt.Z, 12.6, 17); tgt.X = clamp(tgt.X, -3.4, 3.4);
    const X = this.playerX(v); this.ball = { X, Z: .6, h: 1.8, ...launch({ X, Z: .6, h: 1.8 }, tgt, 1.6 - .4 * power), by: 'p', first: true, bn: { p: 0, a: 0 }, spin: 0, dead: false }; this.state = 'rally'; this.hist = {}; a.hint(null); a.sfx.thwack();
    this.rallyHit = true; this.fx.burst(this.racket.x, this.racket.y - 40, 60, 8, 220, 5);
  }
  aiServe() {
    const a = this.app, X = this.ai.X, tgt = { X: rand(-3, 3), Z: rand(5.5, 9) }, T = 2.0 - .05 * this.level; this.ai.swing = 1;
    this.ball = { X, Z: COURT.LZ - .5, h: 2.1, ...launch({ X, Z: COURT.LZ - .5, h: 2.1 }, tgt, T), by: 'a', first: true, bn: { p: 0, a: 0 }, spin: 0, dead: false }; this.state = 'rally'; a.sfx.thwack(); a.hint(this.level < 1 ? '🎾 Move your hand under the ball, then SWING through it!' : null);
  }
  stepAI(dt) {
    const ai = this.ai, b = this.ball, sp = 3.2 + .5 * this.level; let tx = 0;
    if (b && this.state === 'rally' && b.by === 'p' && b.vz > 0) { const t = Math.max(0, (COURT.LZ - 1.5 - b.Z) / b.vz); tx = clamp(b.X + b.vx * t * .85, -4.3, 4.3); }
    else tx = Math.sin(this.t * .7) * .8;
    ai.X += clamp(tx - ai.X, -sp * dt, sp * dt);
  }
  stepBall(dt, v) {
    const a = this.app, b = this.ball, prevZ = b.Z; b.X += b.vx * dt; b.Z += b.vz * dt; b.h += b.vh * dt; b.vh -= G * dt; b.spin += dt * 10;
    // net
    if (prevZ < COURT.NET && b.Z >= COURT.NET && b.by === 'p' && b.h < COURT.NETH) { b.vz *= -.1; b.vx *= .2; b.vh = 1; b.Z = COURT.NET - .05; a.sfx.bounce(); return this.pointTo('a', 'Net! 🎾'); }
    if (prevZ > COURT.NET && b.Z <= COURT.NET && b.by === 'a' && b.h < COURT.NETH) { b.vz *= -.1; b.vh = 1; b.Z = COURT.NET + .05; return this.pointTo('p', 'CPU hit the net!'); }
    if (b.h <= BR && b.vh < 0) {  // bounce
      b.h = BR; b.vh *= -.72; b.vz *= .88; b.vx *= .92; a.sfx.bounce(); const side = b.Z < COURT.NET ? 'p' : 'a'; b.bn[side]++;
      this.fx.burst(this.P(v, b.X, b.Z).x, this.P(v, b.X, b.Z).y, 50, 4, 90, 3);
      if (b.by === 'p' && (b.bn.a + b.bn.p) === 1) { if (side === 'p' || !inCourtFar(b.X, b.Z)) return this.pointTo('a', side === 'p' ? 'Too short! Swing harder 🎾' : Math.abs(b.X) > COURT.HW ? 'Out wide! 🎾' : 'Out long! 🎾'); }
      if (b.by === 'a' && (b.bn.a + b.bn.p) === 1) { if (side === 'a' || !inCourtNear(b.X, b.Z)) return this.pointTo('p', 'CPU hit it out!'); }
      if (b.by === 'a' && side === 'p' && b.bn.p >= 2) return this.pointTo('a', 'Too late! 🎾');
    }
    // CPU return
    if (b.by === 'p' && b.vz > 0 && b.Z >= COURT.LZ - 1.6 && b.h < 3) {
      if (Math.abs(this.ai.X - b.X) < 1.6 + .06 * this.level) this.aiHit(v); else if (b.Z > COURT.LZ + 1.5) { this.pointTo('p', 'WINNER! 🌟'); }
    }
    // player return
    if (b.by === 'a' && b.vz < 0 && b.Z < REACH_Z && b.Z > -1.4 && b.h < 2.6) {
      const sw = this.swing, p = this.P(v, b.X, b.Z, b.h), reach = Math.max(80, a.W * .13);
      if (sw && sw.s > 1.1 && Math.abs(sw.x - p.x) < reach * 1.25 || sw && sw.s > 1.1 && Math.abs(this.racket.x - p.x) < reach) this.playerHit(sw, v);
    }
    if (b.by === 'a' && b.Z < -1.5) { this.pointTo('a', 'Missed it! Move under the ball'); }
    if (b.Z > 26 || b.Z < -6 || Math.abs(b.X) > 14) { if (this.state === 'rally') this.pointTo(b.by === 'p' ? 'p' : 'a', b.by === 'p' ? 'WINNER! 🌟' : 'Missed it!'); }
  }
  playerHit(sw, v) {
    const a = this.app, b = this.ball, power = clamp((sw.s - 1.1) / 2.4, 0, 1), tgt = aimTarget({ x: sw.x, W: a.W, dir: clamp(sw.vx / (sw.s || 1), -1, 1), power });
    tgt.X += rand(-.25, .25); const T = 1.6 - .6 * power; Object.assign(b, launch({ X: b.X, Z: b.Z, h: Math.max(b.h, .4) }, tgt, T)); b.h = Math.max(b.h, .4);
    b.by = 'p'; b.bn = { p: 0, a: 0 }; this.rally++; this.hist = {};
    a.sfx.thwack(); this.fx.burst(this.racket.x, this.racket.y - 50, 60, 12, 260, 5); this.crowd.excite = Math.min(1, this.crowd.excite + .08);
    if (power > .75) this.pop.add(this.racket.x, this.racket.y - 100, 'SMASH!', '#ffb02e', Math.max(28, a.min * .06)); else if (this.rally >= 4) this.pop.add(this.racket.x, this.racket.y - 100, `Rally ${this.rally}!`, '#7dffb0', Math.max(26, a.min * .05));
  }
  aiHit(v) {
    const b = this.ball, a = this.app, xp = this.playerX(v), err = Math.random() < Math.max(.05, .17 - .03 * this.level);
    let X = Math.random() < .6 ? -Math.sign(xp || 1) * rand(1.4, 3.6) : rand(-3.5, 3.5), Z = rand(5.2, 9.5); if (err) { X = Math.sign(X || 1) * rand(4.7, 5.6); }
    const T = clamp(1.8 - .06 * this.level - rand(0, .15), 1.35, 1.9); Object.assign(b, launch({ X: b.X, Z: b.Z, h: Math.max(b.h, .6) }, { X, Z }, T)); b.h = Math.max(b.h, .6);
    b.by = 'a'; b.bn = { p: 0, a: 0 }; this.ai.swing = 1; this.rally++; a.sfx.thwack();
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view(), s = this.sc;
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#18205a'); g.addColorStop(1, '#3a4a9a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#2f7d4b'); g.addColorStop(1, '#256b3d'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([X, Z], i) => { const p = this.P(v, X, Z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    const HW = COURT.HW, LZ = COURT.LZ;
    poly([[-HW - 1.6, -3], [HW + 1.6, -3], [HW + 1.6, LZ + 2], [-HW - 1.6, LZ + 2]], '#2c5aa8'); poly([[-HW, 0], [HW, 0], [HW, LZ], [-HW, LZ]], '#3f7fd6');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, v.s0 * .05); ctx.lineJoin = 'round'; const seg = (X0, Z0, X1, Z1) => { const p0 = this.P(v, X0, Z0), p1 = this.P(v, X1, Z1); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); };
    ctx.beginPath(); seg(-HW, 0, HW, 0); seg(-HW, LZ, HW, LZ); seg(-HW, 0, -HW, LZ); seg(HW, 0, HW, LZ); seg(-HW, 5, HW, 5); seg(-HW, LZ - 5, HW, LZ - 5); seg(0, 5, 0, LZ - 5); ctx.stroke();
    // CPU (behind the net)
    this.drawAI(ctx, v);
    // ball before the net when it's on the far side
    const b = this.ball; if (b && b.Z > COURT.NET) this.drawBall(ctx, v, b);
    this.drawNet(ctx, v);
    if (b && b.Z <= COURT.NET) this.drawBall(ctx, v, b);
    // landing guide
    if (b && this.state === 'rally' && b.by === 'a' && b.vz < 0) { const Xp = b.X + b.vx * (1 - b.Z) / b.vz, p = this.P(v, clamp(Xp, -6, 6), 1, 0); ctx.save(); ctx.globalAlpha = .45 + .25 * Math.sin(this.t * 12); ctx.strokeStyle = '#ffe45e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(p.x, p.gy, p.s * .7, p.s * .22, 0, 0, 6.3); ctx.stroke(); ctx.restore(); }
    this.drawRacket(ctx, v);
    if (this.state === 'serve' && this.server === 'p') { const r = min * .03, x = this.racket.x, y = this.racket.y - min * .24 - 8 * Math.sin(this.t * 5); this.drawBallSprite(ctx, x, y, r, this.t * 3); }
    this.drawScore(ctx, v);
    this.fx.draw(ctx); this.pop.draw(ctx);
  }
  drawNet(ctx, v) {
    const L = this.P(v, -COURT.HW - .5, COURT.NET, 0), R = this.P(v, COURT.HW + .5, COURT.NET, 0), Lt = this.P(v, -COURT.HW - .5, COURT.NET, 1.07), Rt = this.P(v, COURT.HW + .5, COURT.NET, 1.07);
    ctx.save(); ctx.fillStyle = 'rgba(20,20,40,.35)'; ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(R.x, R.y); ctx.lineTo(Rt.x, Rt.y); ctx.lineTo(Lt.x, Lt.y); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 1; i < 24; i++) { const k = i / 24, x = lerp(L.x, R.x, k); ctx.moveTo(x, lerp(L.y, R.y, k)); ctx.lineTo(x, lerp(Lt.y, Rt.y, k)); } ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, v.s0 * .06); ctx.beginPath(); ctx.moveTo(Lt.x, Lt.y); ctx.lineTo(Rt.x, Rt.y); ctx.stroke();
    ctx.strokeStyle = '#ccd'; ctx.lineWidth = Math.max(3, v.s0 * .05); ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(Lt.x, Lt.y); ctx.moveTo(R.x, R.y); ctx.lineTo(Rt.x, Rt.y); ctx.stroke(); ctx.restore();
  }
  drawAI(ctx, v) {
    const p = this.P(v, this.ai.X, COURT.LZ + .3, 0), hh = 1.9 * p.s * 1.5, sw = this.ai.swing;
    ctx.save(); ctx.translate(p.x, p.gy); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, hh * .22, hh * .05, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineWidth = hh * .08; ctx.beginPath(); ctx.moveTo(-hh * .06, -hh * .42); ctx.lineTo(-hh * .08, 0); ctx.moveTo(hh * .06, -hh * .42); ctx.lineTo(hh * .08, 0); ctx.stroke();
    ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-hh * .14, -hh * .78, hh * .28, hh * .38);
    ctx.strokeStyle = '#e0ac84'; ctx.lineWidth = hh * .06; const ang = -1.2 + sw * 2.4; ctx.beginPath(); ctx.moveTo(hh * .13, -hh * .72); ctx.lineTo(hh * .13 + Math.cos(ang) * hh * .26, -hh * .72 + Math.sin(ang) * hh * .26); ctx.moveTo(-hh * .13, -hh * .72); ctx.lineTo(-hh * .22, -hh * .5); ctx.stroke();
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = hh * .02; ctx.beginPath(); ctx.moveTo(hh * .13 + Math.cos(ang) * hh * .26, -hh * .72 + Math.sin(ang) * hh * .26); ctx.lineTo(hh * .13 + Math.cos(ang) * hh * .5, -hh * .72 + Math.sin(ang) * hh * .5); ctx.stroke();
    ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.arc(0, -hh * .88, hh * .09, 0, 6.3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(-hh * .09, -hh * .95, hh * .18, hh * .04);
    ctx.restore();
  }
  drawBallSprite(ctx, x, y, r, rot) {
    const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r); g.addColorStop(0, '#f7ff9a'); g.addColorStop(.6, '#cfe92a'); g.addColorStop(1, '#8aa312'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1, r * .12); ctx.beginPath(); ctx.arc(-r * 1.15, 0, r * .95, -.7, .7); ctx.stroke(); ctx.beginPath(); ctx.arc(r * 1.15, 0, r * .95, Math.PI - .7, Math.PI + .7); ctx.stroke(); ctx.restore();
  }
  drawBall(ctx, v, b) {
    const p = this.P(v, b.X, b.Z, b.h), gp = this.P(v, b.X, b.Z, 0), r = Math.max(4, BR * 2.2 * p.s);
    for (let i = 0; i < this.trail.length - 1; i++) { const q = this.P(v, this.trail[i].X, this.trail[i].Z, this.trail[i].h); ctx.fillStyle = `rgba(230,255,120,${.05 + i * .04})`; ctx.beginPath(); ctx.arc(q.x, q.y, r * (.4 + i * .1), 0, 6.3); ctx.fill(); }
    ctx.fillStyle = `rgba(0,0,0,${clamp(.35 - b.h * .05, .12, .35)})`; ctx.beginPath(); ctx.ellipse(gp.x, gp.y, r * (1 + b.h * .12), r * .35 * (1 + b.h * .12), 0, 0, 6.3); ctx.fill();
    this.drawBallSprite(ctx, p.x, p.y, r, b.spin);
  }
  drawRacket(ctx, v) {
    const { min } = this.app, R = this.racket, L = min * .17, hr = { x: min * .05, y: min * .068 };
    ctx.save(); ctx.translate(R.x, R.y); ctx.rotate(R.ang);
    if (R.speed > 1) { ctx.globalAlpha = clamp((R.speed - 1) * .3, 0, .5); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-Math.sign(R.ang || 1) * min * .04, -L - hr.y, hr.x * 1.2, hr.y * 1.1, 0, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = '#2b2b3a'; ctx.lineWidth = min * .016; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, min * .02); ctx.lineTo(0, -L); ctx.stroke();
    ctx.translate(0, -L - hr.y * .85); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(0, 0, hr.x, hr.y, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = -3; i <= 3; i++) { const x = i / 3.4 * hr.x, y = Math.sqrt(Math.max(0, 1 - (x / hr.x) ** 2)) * hr.y; ctx.moveTo(x, -y); ctx.lineTo(x, y); ctx.moveTo(-hr.x * Math.sqrt(Math.max(0, 1 - (i / 3.4) ** 2)), i / 3.4 * hr.y); ctx.lineTo(hr.x * Math.sqrt(Math.max(0, 1 - (i / 3.4) ** 2)), i / 3.4 * hr.y); } ctx.stroke();
    ctx.strokeStyle = '#ff3b4a'; ctx.lineWidth = min * .012; ctx.beginPath(); ctx.ellipse(0, 0, hr.x, hr.y, 0, 0, 6.3); ctx.stroke(); ctx.restore();
  }
  drawScore(ctx, v) {
    const { W, H } = this.app, port = W < H, s = this.sc, w = Math.min(W * .62, 300), h = 40, x = (W - w) / 2, y = port ? 142 : 66;
    ctx.save(); ctx.fillStyle = 'rgba(15,10,50,.85)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 12) : ctx.rect(x, y, w, h); ctx.fill(); ctx.textBaseline = 'middle'; ctx.font = '900 20px system-ui';
    ctx.textAlign = 'left'; ctx.fillStyle = '#7dffb0'; ctx.fillText(`YOU ${s.pp}`, x + 14, y + h / 2); ctx.textAlign = 'right'; ctx.fillStyle = '#ffb02e'; ctx.fillText(`${s.ap} CPU`, x + w - 14, y + h / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui'; ctx.fillText(`pts · first to 4`, x + w / 2, y + h / 2); ctx.restore();
  }
}
