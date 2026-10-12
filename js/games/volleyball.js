import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { RacketAngle } from '../tennisrules.js?v=23';

/* Volleyball — BUMP the ball up with an upward swing, then SPIKE it over the net with a fast downward swing. First to 11. */
export const G = 9, HW = 4.5, LZ = 18, NET = 9, NETH = 2.43, BR = .11, WIN = 11;
/** Launch from `from` {X,Z,h} to land at `tgt` {X,Z} about T seconds later, guaranteeing the net is cleared. Returns velocities. */
export function shot(from, tgt, T, g = G) {
  let vz = (tgt.Z - from.Z) / T, vh = (.5 * g * T * T - from.h) / T, Tl = T;
  for (let i = 0; i < 4; i++) {
    const tc = (NET - from.Z) / vz; if (tc > 0 && tc < Tl) { const hc = from.h + vh * tc - .5 * g * tc * tc; if (hc < NETH + .15) vh += (NETH + .15 - hc) / tc; }
    Tl = (vh + Math.sqrt(vh * vh + 2 * g * (from.h - BR))) / g; vz = (tgt.Z - from.Z) / Tl;
  }
  return { vx: (tgt.X - from.X) / Tl, vz, vh, T: Tl };
}
/** Set: pop the ball up so it is at height hs, descending, near the net at Zs after ~1.5 s. */
export function setPass(from, Xs, Zs = NET - 2, hs = 2.3, vh = 8) {
  const t = (vh + Math.sqrt(vh * vh - 2 * G * (hs - from.h))) / G; return { vx: (Xs - from.X) / t, vz: (Zs - from.Z) / t, vh, T: t };
}
/** What a swing means to the ball: 'spike' (fast & downward), 'bump' (upward-ish) or 'tap'. */
export function classifySwing(s, stage) {
  if (stage === 'bump') return s.s > .8 ? 'bump' : null;
  if (s.s > 1.1 && s.vy > .2 * s.s) return 'spike'; if (s.s > .7) return 'tap'; return null;
}

export class VolleyballGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.pp = 0; this.ap = 0; this.over = false; this.t = 0; this.hist = {}; this.lastHand = null; this.rk = new RacketAngle(); this.racket = { x: a.W / 2, y: a.H * .7, ang: 0, speed: 0 };
    this.ai = { X: 0, X2: 0, jump: 0 }; this.ball = null; this.trail = []; this.server = 'p'; this.rally = 0; this.bestRally = 0; this.spikes = 0; this.matchOver = null; this.shake = 0;
    a.sfx.crowdStart(.04); a.sfx.crowdLevel(.2, 1); a.setScoreLabel('Points'); a.setScore(0);
    this.toServe(); this.hud();
  }
  destroy() { this.app.sfx.crowdStop(); }
  hud() { const a = this.app; a.setLeft(`You ${this.pp} – ${this.ap} CPU`); a.setRight('First to ' + WIN); a.setScore(this.pp); }
  get level() { return clamp(Math.floor((this.pp + this.ap) / 4), 0, 4); }
  view() {
    const { W, H } = this.app, port = W < H, d0 = port ? 3.5 : 6, s0 = W * (port ? .1 : .085), K = s0 * d0, y0 = H * (port ? .8 : .74), hy = H * .3;
    return { W, H, cx: W / 2, hy, K, d0, camH: (y0 - hy) / s0, s0 };
  }
  P(v, X, Z, h = 0) { const s = v.K / (Z + v.d0); return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s, gy: v.hy + v.camH * s }; }
  playerX(v) { return clamp((this.racket.x - v.cx) / (v.K / (1.5 + v.d0)), -HW, HW); }

  toServe() {
    const a = this.app; this.state = 'serve'; this.sT = 0; this.ball = null; this.trail = []; this.rally = 0;
    if (this.server === 'p') a.hint(a.touchMode && !a.cameraOn ? '🏐 Your serve! Swipe UP fast. (Auto-serve after a few seconds.)' : '🏐 Your serve! Swing your hand UP fast. (Auto-serve after a few seconds.)'); else { a.hint(null); this.aiServeT = 1.4; }
  }
  pointTo(who, msg) {
    if (this.state !== 'rally') return; const a = this.app; this.state = 'point'; this.pT = 1.6; this.ball && (this.ball.dead = true);
    if (this.rally > this.bestRally) this.bestRally = this.rally; if (who === 'p') this.pp++; else this.ap++; this.server = who; this.hud();
    a.banner(`${who === 'p' ? '👏 ' : ''}${msg}`, 1100);
    if (who === 'p') { a.sfx.crowdCheer(.6); this.crowd.excite = Math.min(1, this.crowd.excite + .4); a.sfx.cheer(); this.crowd.wave = Math.max(this.crowd.wave, 2); } else { a.sfx.crowdGroan(); this.crowd.sad = 1; }
    if (this.pp >= WIN || this.ap >= WIN) { this.matchOver = this.pp >= WIN ? 'p' : 'a'; this.pT = 2.2; }
  }
  finish() {
    const a = this.app; if (this.over) return; this.over = true; a.hint(null); const win = this.matchOver === 'p', score = this.pp * 10 + (win ? 50 : 0) + this.bestRally * 2 + this.spikes * 3;
    a.sfx.crowdCheer(win ? 1 : .4); setTimeout(() => a.sfx.crowdStop(), 2200); a.setScore(this.pp);
    setTimeout(() => { if (a.game === this) a.showResult({ title: win ? 'You win the match!' : 'CPU wins — rematch?', emoji: win ? '🏆' : '🏐', score, stats: [['Final', `${this.pp}–${this.ap}`], ['Spikes', this.spikes], ['Best rally', this.bestRally]] }); }, 700);
  }

  update(dt, hands) {
    const a = this.app, v = this.view(), now = performance.now() / 1000; this.t += dt; this.shake = Math.max(0, this.shake - dt * 4);
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.ai.jump = Math.max(0, this.ai.jump - dt * 2.5);
    const hand = hands.find(h => !h.pointer) || hands[0]; if (hand) this.lastHand = hand; const h = hand || (this.lastHand && this.lastHand.pointer ? this.lastHand : null);
    if (h) {
      const k = 1 - Math.exp(-dt * 25); this.racket.x = lerp(this.racket.x, h.palm.x, k); this.racket.y = lerp(this.racket.y, clamp(h.palm.y, a.H * .12, a.H), k);
      let raw = null; if (h.dpts && h.dpts[9] && h.dpts[0]) raw = Math.atan2(h.dpts[9].x - h.dpts[0].x, -(h.dpts[9].y - h.dpts[0].y)); else if (h.pointer) raw = clamp(h.vel.x * .35, -.8, .8);
      this.racket.ang = this.rk.update(raw, dt); this.racket.speed = h.speed;
    } else this.racket.ang = this.rk.update(null, dt);
    for (const hh of hands) { const q = this.hist[hh.id] || (this.hist[hh.id] = []); q.push({ t: now, s: hh.speed, x: hh.palm.x, y: hh.palm.y, vx: hh.vel.x, vy: hh.vel.y }); while (q.length && now - q[0].t > .3) q.shift(); }
    this.swing = this.bestSwing(now);
    if (this.state === 'serve') {
      this.sT += dt;
      if (this.server === 'p') { const sw = this.swing; if ((sw && sw.s > 1.1 && sw.vy < -.15 * sw.s && this.sT > .5) || this.sT > 6) this.playerServe(this.sT > 6 && !(sw && sw.s > 1.1)); }
      else { this.aiServeT -= dt; if (this.aiServeT <= 0) this.aiServe(); }
    } else if (this.state === 'point') { this.pT -= dt; if (this.pT <= 0) { if (this.matchOver) this.finish(); else this.toServe(); } }
    if (this.ball && this.state === 'rally') this.stepBall(dt, v);
    this.stepAI(dt);
    if (this.ball) { this.trail.push({ X: this.ball.X, Z: this.ball.Z, h: this.ball.h }); if (this.trail.length > 7) this.trail.shift(); } else this.trail.length = 0;
  }
  bestSwing(now) { let b = null; for (const id in this.hist) for (const e of this.hist[id]) if (now - e.t <= .25 && (!b || e.s > b.s)) b = e; return b; }
  mkBall(from, vel, by, stage) { return { X: from.X, Z: from.Z, h: from.h, vx: vel.vx, vz: vel.vz, vh: vel.vh, by, stage, spin: 0, spike: false, power: 0, aiTried: false, dead: false, crossed: false }; }
  playerServe(auto) {
    const a = this.app, v = this.view(), sw = auto ? { x: a.W / 2, s: 1.3, vx: 0 } : this.swing, power = auto ? .4 : clamp((sw.s - 1.1) / 2.2, 0, 1);
    const X = this.playerX(v), tgt = { X: clamp((sw.x - a.W / 2) / (a.W * .3), -1, 1) * 3 + rand(-.4, .4), Z: 11 + power * 5 }, from = { X, Z: .4, h: 2 };
    this.ball = this.mkBall(from, shot(from, tgt, 1.9 - .3 * power), 'p', 'over'); this.state = 'rally'; this.hist = {}; a.hint(null); a.sfx.thwack(); this.fx.burst(this.racket.x, this.racket.y, 200, 8, 220, 5);
  }
  aiServe() {
    const a = this.app, from = { X: this.ai.X, Z: LZ - .3, h: 2 }; this.ai.jump = 1;
    this.ball = this.mkBall(from, shot(from, { X: rand(-3, 3), Z: rand(1.6, 4) }, 1.9 - .04 * this.level), 'a', 'incoming'); this.state = 'rally'; a.sfx.thwack();
    a.hint(this.pp + this.ap < 1 ? '🏐 BUMP: swing your hand UP under the ball. Then SPIKE it with a fast swing DOWN!' : null);
  }
  stepAI(dt) {
    const ai = this.ai, b = this.ball, sp = 3.4 + .35 * this.level; let tx = 0;
    if (b && this.state === 'rally' && b.by === 'p' && b.Z > NET - 1) { const t = Math.max(0, (b.vh + Math.sqrt(Math.max(0, b.vh * b.vh + 2 * G * (b.h - BR)))) / G); tx = clamp(b.X + b.vx * t, -HW, HW); } else tx = Math.sin(this.t * .6) * 1.2;
    ai.X += clamp(tx - ai.X, -sp * dt, sp * dt); ai.X2 += clamp(-ai.X * .7 - ai.X2, -2 * dt, 2 * dt);
  }
  stepBall(dt, v) {
    const a = this.app, b = this.ball, pz = b.Z; b.X += b.vx * dt; b.Z += b.vz * dt; b.h += b.vh * dt; b.vh -= G * dt; b.spin += dt * 8;
    if ((pz < NET && b.Z >= NET || pz > NET && b.Z <= NET) && b.h < NETH) { b.vz *= -.1; b.vx *= .2; b.vh = Math.max(b.vh, 1); a.sfx.bounce(); this.fx.burst(this.P(v, b.X, NET, b.h).x, this.P(v, b.X, NET, b.h).y, 0, 8, 120, 3); return this.pointTo(b.by === 'p' ? 'a' : 'p', b.by === 'p' ? 'Into the net! 🏐' : 'CPU hit the net!'); }
    if (pz <= NET && b.Z > NET) b.crossed = true;
    // AI dig
    if (b.by === 'p' && b.Z > NET && b.h < 2.5 && b.vh < 0 && !b.aiTried) {
      b.aiTried = true; const prob = clamp(.9 - .04 * this.level - (b.spike ? .45 * b.power : 0), .25, .95);
      if (b.Z < LZ + 1 && Math.abs(b.X) < HW + 1 && Math.random() < prob) this.aiHit(v, b);
    }
    // player bump / set / spike
    if (b.by === 'a' && b.stage === 'incoming' && b.vz < 0 && b.Z < 4.8 && b.Z > -2 && b.h < 2.7 && b.h > .2) {
      const sw = this.swing, p = this.P(v, b.X, Math.max(0, b.Z), b.h), reach = Math.max(80, a.W * .14);
      if (sw && classifySwing(sw, 'bump') && (Math.abs(sw.x - p.x) < reach * 1.3 || Math.abs(this.racket.x - p.x) < reach)) this.bump(sw, v);
    } else if (b.by === 'p' && b.stage === 'set' && b.Z < NET && b.Z > NET - 4.5 && b.h < 3.6 && b.h > 1.4 && b.vh < 1) {
      const sw = this.swing, p = this.P(v, b.X, b.Z, b.h), reach = Math.max(90, a.W * .16), kind = sw && classifySwing(sw, 'spike');
      if (kind && (Math.abs(sw.x - p.x) < reach * 1.3 || Math.abs(this.racket.x - p.x) < reach)) this.attack(sw, kind, v);
    }
    if (b.by === 'a' && b.Z < -2.5) return this.pointTo('a', 'Missed it! Move under the ball');
    if (b.h <= BR && b.vh < 0) {
      b.h = BR; a.sfx.bounce(); const P = this.P(v, b.X, b.Z, 0); this.fx.burst(P.x, P.y, 40, 10, 140, 4); this.shake = .4; const inb = Math.abs(b.X) <= HW + .1 && b.Z >= -.1 && b.Z <= LZ + .1;
      if (b.Z < NET) return this.pointTo('a', b.by === 'a' ? (b.stage === 'incoming' ? 'Dropped it! Swing UP under the ball' : 'Dropped it!') : (b.stage === 'set' ? 'Missed the spike! Swing DOWN at the ball' : 'Landed on your side!'));
      return this.pointTo(b.by === 'p' && !inb ? 'a' : 'p', b.by === 'p' && !inb ? 'Out! Aim closer 🏐' : (b.spike ? 'SPIKE! 💥' : 'Point! 🌟'));
    }
  }
  bump(sw, v) {
    const a = this.app, b = this.ball, dir = clamp(sw.vx / (sw.s || 1), -1, 1), from = { X: b.X, Z: Math.max(0, b.Z), h: Math.max(b.h, .5) };
    const Xs = clamp(b.X * .5 + dir * 1.3, -2.8, 2.8), vel = setPass(from, Xs, NET - rand(1.7, 2.4), 2.3, 7.6 + clamp(sw.s - .8, 0, 2) * .5);
    Object.assign(b, from, { vx: vel.vx, vz: vel.vz, vh: vel.vh, by: 'p', stage: 'set', aiTried: false }); this.rally++; this.hist = {}; a.sfx.thwack(); this.fx.burst(this.racket.x, this.racket.y, 200, 10, 220, 5);
    this.pop.add(this.racket.x, this.racket.y - 90, 'BUMP!', '#7dffb0', Math.max(26, a.min * .06)); a.hint(null); this.crowd.excite = Math.min(1, this.crowd.excite + .05);
  }
  attack(sw, kind, v) {
    const a = this.app, b = this.ball, from = { X: b.X, Z: b.Z, h: Math.max(b.h, 1.9) }, dir = clamp(sw.vx / (sw.s || 1), -1, 1), aimX = clamp((sw.x - a.W / 2) / (a.W * .3), -1, 1) * 3.4 + dir * .8;
    let power, tgt, T;
    if (kind === 'spike') { power = clamp((sw.s - 1.1) / 2.2, .15, 1); tgt = { X: clamp(aimX + rand(-.3, .3), -4.1, 4.1), Z: lerp(11, 16.5, power) }; T = lerp(1.0, .62, power); this.spikes++; b.spike = true; this.ai.jump = 0; }
    else { power = .1; tgt = { X: clamp(aimX, -3.6, 3.6), Z: rand(12, 15.5) }; T = 1.7; b.spike = false; }
    const vel = shot(from, tgt, T); Object.assign(b, from, { vx: vel.vx, vz: vel.vz, vh: vel.vh, stage: 'over', aiTried: false, power }); this.rally++; this.hist = {}; a.sfx.thwack();
    this.fx.burst(this.racket.x, this.racket.y, kind === 'spike' ? 30 : 60, 14, 300, 6); this.shake = kind === 'spike' ? .5 : 0;
    this.pop.add(this.racket.x, this.racket.y - 90, kind === 'spike' ? (power > .7 ? 'SMASH SPIKE!' : 'SPIKE!') : 'Tap over', kind === 'spike' ? '#ffb02e' : '#fff', Math.max(28, a.min * .065)); this.crowd.excite = Math.min(1, this.crowd.excite + (kind === 'spike' ? .25 : .05));
  }
  aiHit(v, b) {
    const a = this.app, xp = this.playerX(v), spike = this.level >= 1 && Math.random() < .25 + .08 * this.level, from = { X: b.X, Z: b.Z, h: Math.max(b.h, 1.2) };
    const tgt = { X: clamp(-Math.sign(xp || 1) * rand(.5, 3.6), -4, 4), Z: spike ? rand(2, 4.5) : rand(1.2, 4) }, T = spike ? rand(1.0, 1.25) : 1.7 - .03 * this.level + rand(-.1, .15);
    const vel = shot(from, tgt, T); Object.assign(b, from, { vx: vel.vx, vz: vel.vz, vh: vel.vh, by: 'a', stage: 'incoming', spike: false, aiTried: true }); this.ai.jump = 1; this.rally++; a.sfx.thwack();
    this.pop.add(v.cx, v.hy + 50, spike ? 'CPU spike!' : 'Great dig!', '#ffb02e', Math.max(24, a.min * .05));
  }

  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view();
    ctx.save(); if (this.shake > 0) ctx.translate(rand(-1, 1) * this.shake * 6, rand(-1, 1) * this.shake * 6);
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#2b2a6a'); g.addColorStop(1, '#4b4a96'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#c98b4d'); g.addColorStop(1, '#a56a32'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([X, Z], i) => { const p = this.P(v, X, Z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    poly([[-HW - 1.6, -3], [HW + 1.6, -3], [HW + 1.6, LZ + 2], [-HW - 1.6, LZ + 2]], '#3f6fb8'); poly([[-HW, 0], [HW, 0], [HW, LZ], [-HW, LZ]], '#e2a864');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, v.s0 * .05); ctx.beginPath(); const seg = (X0, Z0, X1, Z1) => { const p0 = this.P(v, X0, Z0), p1 = this.P(v, X1, Z1); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); };
    seg(-HW, 0, HW, 0); seg(-HW, LZ, HW, LZ); seg(-HW, 0, -HW, LZ); seg(HW, 0, HW, LZ); seg(-HW, NET - 3, HW, NET - 3); seg(-HW, NET + 3, HW, NET + 3); ctx.stroke();
    this.drawAI(ctx, v, this.ai.X, 1); this.drawAI(ctx, v, this.ai.X2, 2);
    const b = this.ball; if (b && b.Z > NET) this.drawBall(ctx, v, b);
    this.drawNet(ctx, v);
    if (b && b.Z <= NET) this.drawBall(ctx, v, b);
    if (b && this.state === 'rally' && b.by === 'a' && b.stage === 'incoming' && b.vz < 0) { const t = (b.vh + Math.sqrt(Math.max(0, b.vh * b.vh + 2 * G * (b.h - BR)))) / G, X = b.X + b.vx * t, Z = b.Z + b.vz * t, p = this.P(v, clamp(X, -HW - 2, HW + 2), clamp(Z, -1, NET), 0); ctx.save(); ctx.globalAlpha = .5 + .3 * Math.sin(this.t * 12); ctx.strokeStyle = '#ffe45e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * .7, p.s * .22, 0, 0, 6.3); ctx.stroke(); ctx.restore(); }
    this.drawHand(ctx);
    if (this.state === 'serve' && this.server === 'p') this.drawBallSprite(ctx, this.racket.x, this.racket.y - min * .18 - 6 * Math.sin(this.t * 5), min * .035, this.t * 2);
    this.fx.draw(ctx); ctx.restore(); this.pop.draw(ctx);
  }
  drawNet(ctx, v) {
    const L = this.P(v, -HW - .5, NET, 0), R = this.P(v, HW + .5, NET, 0), Lt = this.P(v, -HW - .5, NETH + .1, 0).y, Rt = this.P(v, HW + .5, NETH + .1, 0), top = (X) => this.P(v, X, NET, NETH);
    const Ltp = top(-HW - .5), Rtp = top(HW + .5), Lb = this.P(v, -HW - .5, NET, NETH - 1), Rb = this.P(v, HW + .5, NET, NETH - 1);
    ctx.save(); ctx.fillStyle = 'rgba(20,20,40,.3)'; ctx.beginPath(); ctx.moveTo(Lb.x, Lb.y); ctx.lineTo(Rb.x, Rb.y); ctx.lineTo(Rtp.x, Rtp.y); ctx.lineTo(Ltp.x, Ltp.y); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 1; i < 36; i++) { const k = i / 36; ctx.moveTo(lerp(Lb.x, Rb.x, k), lerp(Lb.y, Rb.y, k)); ctx.lineTo(lerp(Ltp.x, Rtp.x, k), lerp(Ltp.y, Rtp.y, k)); } for (let j = 1; j < 5; j++) { const k = j / 5; ctx.moveTo(lerp(Lb.x, Ltp.x, k), lerp(Lb.y, Ltp.y, k)); ctx.lineTo(lerp(Rb.x, Rtp.x, k), lerp(Rb.y, Rtp.y, k)); } ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, v.s0 * .08); ctx.beginPath(); ctx.moveTo(Ltp.x, Ltp.y); ctx.lineTo(Rtp.x, Rtp.y); ctx.stroke();
    ctx.strokeStyle = '#ccd'; ctx.lineWidth = Math.max(3, v.s0 * .06); ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(Ltp.x, Ltp.y); ctx.moveTo(R.x, R.y); ctx.lineTo(Rtp.x, Rtp.y); ctx.stroke(); ctx.restore();
  }
  drawAI(ctx, v, X, k) {
    const p = this.P(v, X, LZ - (k === 1 ? 2 : 4.5), 0), hh = 1.9 * p.s, jump = k === 1 ? this.ai.jump : 0, up = Math.sin(Math.min(1, jump) * Math.PI) * hh * .18;
    ctx.save(); ctx.translate(p.x, p.gy); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, hh * .2, hh * .05, 0, 0, 6.3); ctx.fill(); ctx.translate(0, -up);
    ctx.strokeStyle = '#223'; ctx.lineCap = 'round'; ctx.lineWidth = hh * .07; ctx.beginPath(); ctx.moveTo(-hh * .06, -hh * .42); ctx.lineTo(-hh * .08, 0); ctx.moveTo(hh * .06, -hh * .42); ctx.lineTo(hh * .08, 0); ctx.stroke();
    ctx.fillStyle = k === 1 ? '#e03a3a' : '#e0a03a'; ctx.fillRect(-hh * .13, -hh * .8, hh * .26, hh * .4);
    ctx.strokeStyle = '#e0ac84'; ctx.lineWidth = hh * .06; ctx.beginPath(); ctx.moveTo(hh * .13, -hh * .75); ctx.lineTo(hh * .2, -hh * (.95 + jump * .1)); ctx.moveTo(-hh * .13, -hh * .75); ctx.lineTo(-hh * .2, -hh * (.95 + jump * .1)); ctx.stroke();
    ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.arc(0, -hh * .9, hh * .085, 0, 6.3); ctx.fill(); ctx.restore();
  }
  drawBallSprite(ctx, x, y, r, rot) {
    const g = ctx.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r); g.addColorStop(0, '#fffbe0'); g.addColorStop(1, '#e8c04a'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = '#2f6fe0'; ctx.lineWidth = Math.max(1.5, r * .14); ctx.beginPath(); ctx.arc(-r * .9, 0, r * .9, -1, 1); ctx.moveTo(r * .1, -r); ctx.quadraticCurveTo(r * .6, 0, r * .1, r); ctx.stroke(); ctx.restore();
  }
  drawBall(ctx, v, b) {
    const p = this.P(v, b.X, b.Z, b.h), gp = this.P(v, b.X, b.Z, 0), r = Math.max(5, BR * 2.1 * p.s);
    for (let i = 0; i < this.trail.length - 1; i++) { const q = this.P(v, this.trail[i].X, this.trail[i].Z, this.trail[i].h); ctx.fillStyle = `rgba(255,240,170,${.04 + i * .035})`; ctx.beginPath(); ctx.arc(q.x, q.y, r * (.4 + i * .1), 0, 6.3); ctx.fill(); }
    ctx.fillStyle = `rgba(0,0,0,${clamp(.38 - b.h * .05, .1, .38)})`; ctx.beginPath(); ctx.ellipse(gp.x, gp.y, r * (1 + b.h * .1), r * .3 * (1 + b.h * .1), 0, 0, 6.3); ctx.fill();
    this.drawBallSprite(ctx, p.x, p.y, r, b.spin);
  }
  drawHand(ctx) {
    const { min } = this.app, R = this.racket, r = min * .075;
    ctx.save(); ctx.translate(R.x, R.y); ctx.rotate(R.ang);
    if (R.speed > .9) { ctx.globalAlpha = clamp((R.speed - .9) * .3, 0, .5); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.5, r * 1.1, 0, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * .8, 0, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = min * .008; ctx.stroke();
    ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.ellipse(0, 0, r * .6, r * .45, 0, 0, 6.3); ctx.fill(); ctx.restore();
  }
}
