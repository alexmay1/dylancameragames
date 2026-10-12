import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { launch, RacketAngle } from '../tennisrules.js?v=23';

/* Ping-Pong — your hand is the paddle. Swing through the ball when it reaches you. First to 11 (win by 2, max 13) or the 4:00 timer. */
export const G = 6, HW = .76, LZ = 2.74, NET = 1.37, NETH = .1525, BR = .02, MATCH_T = 240, REACH_Z = .45;
export function winner(pp, ap) { if ((pp >= 11 || ap >= 11) && Math.abs(pp - ap) >= 2) return pp > ap ? 'p' : 'a'; if (pp >= 13 || ap >= 13) return pp > ap ? 'p' : 'a'; return null; }
export function serverFor(total, pp, ap, first = 'p') { const other = first === 'p' ? 'a' : 'p'; const k = (pp >= 10 && ap >= 10) ? total : total >> 1; return k % 2 === 0 ? first : other; }
/** Make sure a shot clears the net: raise the launch speed if it would cross below the tape. */
export function clearNet(b, g = G) {
  const dz = b.vz > 0 ? NET - b.Z : b.vz < 0 ? b.Z - NET : 0; if (dz <= 0 || !b.vz) return b;
  const t = dz / Math.abs(b.vz), hc = b.h + b.vh * t - .5 * g * t * t, need = NETH + .1;
  if (hc < need) b.vh += (need - hc) / t; return b;
}

export class PingPongGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.pp = 0; this.ap = 0; this.total = 0; this.time = MATCH_T; this.over = false; this.t = 0; this.hist = {}; this.lastHand = null; this.rk = new RacketAngle(); this.racket = { x: a.W / 2, y: a.H * .78, ang: 0, speed: 0 };
    this.ai = { X: 0, swing: 0 }; this.ball = null; this.trail = []; this.server = 'p'; this.rally = 0; this.bestRally = 0; this.first = 'p'; this.matchOver = null;
    a.sfx.crowdStart(.03); a.sfx.crowdLevel(.15, 1); a.setScoreLabel('Points'); a.setScore(0);
    this.toServe(); this.hud();
  }
  destroy() { this.app.sfx.crowdStop(); }
  hud() { const a = this.app, m = Math.max(0, Math.ceil(this.time)); a.setLeft(`You ${this.pp} – ${this.ap} CPU`); a.setRight(`⏱ ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`); a.setScore(this.pp); }
  get level() { return clamp(Math.floor((this.pp + this.ap) / 3), 0, 5); }
  view() {
    const { W, H } = this.app, port = W < H, s0 = port ? W * .62 : Math.min(W * .5, H * .85), d0 = 1;
    return { W, H, cx: W / 2, hy: H * (port ? .28 : .2), K: s0 * d0, d0, camH: port ? .9 : .62, s0 };
  }
  P(v, X, Z, h = 0) { const s = v.K / (Z + v.d0); return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s, gy: v.hy + v.camH * s }; }

  /* ---------- flow ---------- */
  toServe() {
    const a = this.app; this.state = 'serve'; this.sT = 0; this.ball = null; this.trail = []; this.rally = 0;
    this.server = serverFor(this.total, this.pp, this.ap, this.first);
    if (this.server === 'p') a.hint(a.touchMode && !a.cameraOn ? '🏓 Your serve! Swipe UP fast. (It serves for you after a few seconds.)' : '🏓 Your serve! Swing your hand up fast. (Auto-serve after a few seconds.)');
    else { a.hint(null); this.aiServeT = 1.2; }
  }
  pointTo(who, msg) {
    if (this.state !== 'rally') return; const a = this.app; this.state = 'point'; this.pT = 1.5; this.ball && (this.ball.dead = true);
    if (this.rally > this.bestRally) this.bestRally = this.rally;
    if (who === 'p') this.pp++; else this.ap++; this.total++; this.hud();
    a.banner(`${who === 'p' ? '👏 ' : ''}${msg}`, 1100);
    if (who === 'p') { a.sfx.crowdCheer(.5); this.crowd.excite = Math.min(1, this.crowd.excite + .35); a.sfx.cheer(); } else { a.sfx.crowdGroan(); this.crowd.sad = 1; }
    const w = winner(this.pp, this.ap); if (w) { this.matchOver = w; this.pT = 2; }
  }
  finish(w) {
    const a = this.app; if (this.over) return; this.over = true; a.hint(null); const win = w === 'p', score = this.pp * 10 + (win ? 50 : 0);
    a.sfx.crowdCheer(win ? 1 : .4); setTimeout(() => a.sfx.crowdStop(), 2200); a.setScore(this.pp);
    setTimeout(() => { if (a.game === this) a.showResult({ title: win ? 'You win the match!' : w === 'a' ? 'CPU wins — rematch?' : 'Good match!', emoji: win ? '🏆' : '🏓', score, stats: [['Final', `${this.pp}–${this.ap}`], ['Best rally', this.bestRally]] }); }, 700);
  }

  /* ---------- update ---------- */
  update(dt, hands) {
    const a = this.app, v = this.view(), now = performance.now() / 1000; this.t += dt;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.ai.swing = Math.max(0, this.ai.swing - dt * 3);
    if (this.state !== 'point') { this.time -= dt; if (Math.ceil(this.time) !== this._tc) { this._tc = Math.ceil(this.time); this.hud(); } }
    if (this.time <= 0 && !this.over && this.state !== 'point') { const l = this.pp === this.ap ? null : this.pp > this.ap ? 'p' : 'a'; return this.finish(l || 'draw'); }
    const hand = hands.find(h => !h.pointer) || hands[0]; if (hand) this.lastHand = hand;
    const h = hand || (this.lastHand && this.lastHand.pointer ? this.lastHand : null);
    if (h) {
      const k = 1 - Math.exp(-dt * 25); this.racket.x = lerp(this.racket.x, h.palm.x, k); this.racket.y = lerp(this.racket.y, clamp(h.palm.y, a.H * .4, a.H), k);
      let raw = null; if (h.dpts && h.dpts[9] && h.dpts[0]) raw = Math.atan2(h.dpts[9].x - h.dpts[0].x, -(h.dpts[9].y - h.dpts[0].y)); else if (h.pointer) raw = clamp(h.vel.x * .35, -.8, .8);
      this.racket.ang = this.rk.update(raw, dt); this.racket.speed = h.speed;
    } else this.racket.ang = this.rk.update(null, dt);
    for (const hh of hands) { const q = this.hist[hh.id] || (this.hist[hh.id] = []); q.push({ t: now, s: hh.speed, x: hh.palm.x, y: hh.palm.y, vx: hh.vel.x, vy: hh.vel.y }); while (q.length && now - q[0].t > .3) q.shift(); }
    this.swing = this.bestSwing(now);
    if (this.state === 'serve') {
      this.sT += dt;
      if (this.server === 'p') { const sw = this.swing; if ((sw && sw.s > 1.2 && sw.vy < -.15 * sw.s && this.sT > .5) || this.sT > 5.5) this.playerServe(this.sT > 5.5 && !(sw && sw.s > 1.2)); }
      else { this.aiServeT -= dt; if (this.aiServeT <= 0) this.aiServe(); }
    } else if (this.state === 'point') { this.pT -= dt; if (this.pT <= 0) { if (this.matchOver) this.finish(this.matchOver); else this.toServe(); } }
    if (this.ball && this.state === 'rally') this.stepBall(dt, v);
    this.stepAI(dt);
    if (this.ball) { this.trail.push({ X: this.ball.X, Z: this.ball.Z, h: this.ball.h }); if (this.trail.length > 6) this.trail.shift(); } else this.trail.length = 0;
  }
  bestSwing(now) { let b = null; for (const id in this.hist) for (const e of this.hist[id]) if (now - e.t <= .25 && (!b || e.s > b.s)) b = e; return b; }
  playerX(v) { return clamp((this.racket.x - v.cx) / v.s0, -1.1, 1.1); }
  mk(from, tgt, T, by) { const b = { X: from.X, Z: from.Z, h: from.h, ...launch(from, tgt, T, G), by, bn: { p: 0, a: 0 }, spin: 0, sp: 0, dead: false }; return clearNet(b); }
  playerServe(auto) {
    const a = this.app, v = this.view(), sw = auto ? { x: a.W / 2, s: 1.4, vx: 0 } : this.swing, power = auto ? .3 : clamp((sw.s - 1.2) / 2.2, 0, 1);
    const X = this.playerX(v), tgt = { X: clamp((sw.x - a.W / 2) / (a.W * .3), -1, 1) * .5, Z: 1.7 + power * .9 };
    this.ball = this.mk({ X, Z: -.05, h: .25 }, tgt, .95 - .25 * power, 'p'); this.state = 'rally'; this.hist = {}; a.hint(null); a.sfx.thwack();
    this.fx.burst(this.racket.x, this.racket.y - 30, 60, 6, 200, 4);
  }
  aiServe() {
    const a = this.app, X = this.ai.X; this.ai.swing = 1;
    this.ball = this.mk({ X, Z: LZ + .05, h: .25 }, { X: rand(-.5, .5), Z: rand(.4, 1.0) }, 1 - .02 * this.level, 'a'); this.state = 'rally'; a.sfx.thwack();
    a.hint(this.pp + this.ap < 1 ? '🏓 Move your hand under the ball, then SWING through it!' : null);
  }
  stepAI(dt) {
    const ai = this.ai, b = this.ball, sp = 1.5 + .22 * this.level; let tx = 0;
    if (b && this.state === 'rally' && b.by === 'p' && b.vz > 0) tx = clamp(b.X + b.vx * Math.max(0, (LZ - b.Z) / b.vz) * .8, -HW - .1, HW + .1); else tx = Math.sin(this.t * .8) * .2;
    ai.X += clamp(tx - ai.X, -sp * dt, sp * dt);
  }
  stepBall(dt, v) {
    const a = this.app, b = this.ball, prevZ = b.Z; b.X += b.vx * dt; b.Z += b.vz * dt; b.h += b.vh * dt; b.vh -= G * dt; b.sp += dt * 14;
    if (prevZ < NET && b.Z >= NET && b.h < NETH && b.vz > 0) { b.vz *= -.1; b.vx *= .2; b.vh = .5; b.Z = NET - .03; a.sfx.bounce(); return this.pointTo(b.by === 'p' ? 'a' : 'p', b.by === 'p' ? 'Net! 🏓' : 'CPU hit the net!'); }
    if (prevZ > NET && b.Z <= NET && b.h < NETH && b.vz < 0) { b.vz *= -.1; b.vx *= .2; b.vh = .5; b.Z = NET + .03; a.sfx.bounce(); return this.pointTo(b.by === 'p' ? 'a' : 'p', b.by === 'p' ? 'Net! 🏓' : 'CPU hit the net!'); }
    const onTable = Math.abs(b.X) <= HW + .02 && b.Z >= 0 && b.Z <= LZ;
    if (b.h <= BR && b.vh < 0 && onTable) {
      b.h = BR; b.vh *= -.85; b.vz *= .94; b.vx = b.vx * .94 + b.spin * .35; b.spin = 0; a.sfx.bounce(); const side = b.Z < NET ? 'p' : 'a', P = this.P(v, b.X, b.Z, 0); this.fx.burst(P.x, P.y, 200, 3, 60, 2);
      b.bn[side]++;
      if (b.by === 'p' && b.bn.a + b.bn.p === 1 && side === 'p') return this.pointTo('a', 'Hit your own side! Swing farther 🏓');
      if (b.by === 'a' && b.bn.a + b.bn.p === 1 && side === 'a') return this.pointTo('p', 'CPU missed the table!');
      if (b.by === 'a' && side === 'p' && b.bn.p >= 2) return this.pointTo('a', 'Too late! 🏓');
      if (b.by === 'p' && side === 'a' && b.bn.a >= 2) return this.pointTo('p', 'WINNER! 🌟');
    }
    if (b.by === 'p' && b.bn.a >= 1 && b.vz > 0 && b.Z >= LZ - .35 && b.Z < LZ + .5 && b.h < .7 && !b.aiTried) {
      b.aiTried = true; const reach = .26 + .02 * this.level + .05; if (Math.abs(this.ai.X - b.X) < reach) this.aiHit(v); }
    if (b.by === 'a' && b.bn.p >= 1 && b.vz < 0 && b.Z < REACH_Z && b.Z > -1 && b.h < .9) {
      const sw = this.swing, p = this.P(v, b.X, Math.max(0, b.Z), b.h), reach = Math.max(70, this.app.W * .12);
      if (sw && sw.s > .9 && (Math.abs(sw.x - p.x) < reach * 1.2 || Math.abs(this.racket.x - p.x) < reach)) this.playerHit(sw, v);
    }
    if (b.by === 'a' && b.Z < -1) return this.pointTo('a', 'Missed it! Move under the ball');
    if (b.h < -.35) { if (b.by === 'p') this.pointTo(b.bn.a >= 1 ? 'p' : 'a', b.bn.a >= 1 ? 'WINNER! 🌟' : 'Missed the table!'); else this.pointTo(b.bn.p >= 1 ? 'a' : 'p', b.bn.p >= 1 ? 'Missed it!' : 'CPU missed the table!'); }
  }
  playerHit(sw, v) {
    const a = this.app, b = this.ball, power = clamp((sw.s - .9) / 2.2, 0, 1), dir = clamp(sw.vx / (sw.s || 1), -1, 1);
    const tgt = { X: clamp((sw.x - a.W / 2) / (a.W * .3), -1, 1) * .5 + dir * .2 + rand(-.04, .04), Z: 1.55 + power * 1.05 };
    const nb = this.mk({ X: b.X, Z: Math.max(0, b.Z), h: Math.max(b.h, .12) }, tgt, .95 - .3 * power, 'p'); nb.spin = dir * power; Object.assign(b, nb);
    this.rally++; this.hist = {}; a.sfx.thwack(); this.fx.burst(this.racket.x, this.racket.y - 40, 20, 10, 240, 4); this.crowd.excite = Math.min(1, this.crowd.excite + .05);
    if (power > .75) this.pop.add(this.racket.x, this.racket.y - 100, 'SMASH!', '#ffb02e', Math.max(28, a.min * .06)); else if (Math.abs(dir) > .6 && power > .3) this.pop.add(this.racket.x, this.racket.y - 100, 'SPIN!', '#7dffb0', Math.max(26, a.min * .05)); else if (this.rally >= 4) this.pop.add(this.racket.x, this.racket.y - 100, `Rally ${this.rally}!`, '#7dffb0', Math.max(26, a.min * .05));
  }
  aiHit(v) {
    const b = this.ball, a = this.app, xp = this.playerX(v) * HW, err = Math.random() < Math.max(.06, .2 - .03 * this.level);
    let X = Math.random() < .6 ? -Math.sign(xp || 1) * rand(.25, .65) : rand(-.65, .65), Z = rand(.35, 1.0); if (err) X = Math.sign(X || 1) * rand(HW + .12, HW + .3);
    const T = clamp(.95 - .03 * this.level - rand(0, .1), .6, 1);
    const nb = this.mk({ X: b.X, Z: b.Z, h: Math.max(b.h, .15) }, { X, Z }, T, 'a'); Object.assign(b, nb); this.ai.swing = 1; this.rally++; a.sfx.thwack();
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view();
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#1b1840'); g.addColorStop(1, '#3b3a78'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#4a3c63'); g.addColorStop(1, '#2d2342'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([X, Z, h], i) => { const p = this.P(v, X, Z, h || 0); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    this.drawAI(ctx, v);
    poly([[-HW, 0, -.04], [HW, 0, -.04], [HW, 0, 0], [-HW, 0, 0]], '#0f3566'); // near edge thickness
    poly([[-HW, 0], [HW, 0], [HW, LZ], [-HW, LZ]], '#1d62b3');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, v.s0 * .012); ctx.lineJoin = 'round'; ctx.beginPath(); const seg = (X0, Z0, X1, Z1) => { const p0 = this.P(v, X0, Z0), p1 = this.P(v, X1, Z1); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); };
    seg(-HW, 0, HW, 0); seg(-HW, LZ, HW, LZ); seg(-HW, 0, -HW, LZ); seg(HW, 0, HW, LZ); ctx.stroke(); ctx.lineWidth = Math.max(1, v.s0 * .006); ctx.beginPath(); seg(0, 0, 0, LZ); ctx.stroke();
    const b = this.ball; if (b && b.Z > NET) this.drawBall(ctx, v, b);
    this.drawNet(ctx, v);
    if (b && b.Z <= NET) this.drawBall(ctx, v, b);
    if (b && this.state === 'rally' && b.by === 'a' && b.bn.p === 0 && b.vh !== undefined) { const t = (b.vh + Math.sqrt(b.vh * b.vh + 2 * G * Math.max(0, b.h - BR))) / G, X = b.X + b.vx * t, Z = b.Z + b.vz * t; if (Z > 0 && Z < NET) { const p = this.P(v, X, Z, 0); ctx.save(); ctx.globalAlpha = .45 + .25 * Math.sin(this.t * 12); ctx.strokeStyle = '#ffe45e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * .09, p.s * .035, 0, 0, 6.3); ctx.stroke(); ctx.restore(); } }
    this.drawRacket(ctx, v);
    if (this.state === 'serve' && this.server === 'p') this.drawBallSprite(ctx, this.racket.x, this.racket.y - min * .2 - 6 * Math.sin(this.t * 5), min * .018);
    this.fx.draw(ctx); this.pop.draw(ctx);
  }
  drawNet(ctx, v) {
    const L = this.P(v, -HW - .1, NET, 0), R = this.P(v, HW + .1, NET, 0), Lt = this.P(v, -HW - .1, NET, NETH), Rt = this.P(v, HW + .1, NET, NETH);
    ctx.save(); ctx.fillStyle = 'rgba(230,240,255,.28)'; ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(R.x, R.y); ctx.lineTo(Rt.x, Rt.y); ctx.lineTo(Lt.x, Lt.y); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 1; i < 30; i++) { const k = i / 30, x = lerp(L.x, R.x, k); ctx.moveTo(x, lerp(L.y, R.y, k)); ctx.lineTo(x, lerp(Lt.y, Rt.y, k)); } ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, v.s0 * .012); ctx.beginPath(); ctx.moveTo(Lt.x, Lt.y); ctx.lineTo(Rt.x, Rt.y); ctx.stroke();
    ctx.strokeStyle = '#ccd'; ctx.lineWidth = Math.max(3, v.s0 * .01); ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(Lt.x, Lt.y); ctx.moveTo(R.x, R.y); ctx.lineTo(Rt.x, Rt.y); ctx.stroke(); ctx.restore();
  }
  drawAI(ctx, v) {
    const p = this.P(v, this.ai.X * 1.2, LZ + .55, -.76), hh = 1.75 * p.s, sw = this.ai.swing;
    ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, hh * .2, hh * .04, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#223'; ctx.lineCap = 'round'; ctx.lineWidth = hh * .07; ctx.beginPath(); ctx.moveTo(-hh * .05, -hh * .45); ctx.lineTo(-hh * .07, 0); ctx.moveTo(hh * .05, -hh * .45); ctx.lineTo(hh * .07, 0); ctx.stroke();
    ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-hh * .13, -hh * .82, hh * .26, hh * .4);
    ctx.strokeStyle = '#e0ac84'; ctx.lineWidth = hh * .055; const ang = -1.4 + sw * 1.6; ctx.beginPath(); ctx.moveTo(hh * .12, -hh * .76); ctx.lineTo(hh * .12 + Math.cos(ang) * hh * .24, -hh * .76 + Math.sin(ang) * hh * .24); ctx.moveTo(-hh * .12, -hh * .76); ctx.lineTo(-hh * .2, -hh * .55); ctx.stroke();
    ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.arc(hh * .12 + Math.cos(ang) * hh * .3, -hh * .76 + Math.sin(ang) * hh * .3, hh * .06, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.arc(0, -hh * .92, hh * .085, 0, 6.3); ctx.fill(); ctx.fillStyle = '#4a2a10'; ctx.fillRect(-hh * .085, -hh * 1.0, hh * .17, hh * .05);
    ctx.restore();
  }
  drawBallSprite(ctx, x, y, r) { const g = ctx.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r); g.addColorStop(0, '#fff'); g.addColorStop(1, '#ff9f3a'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }
  drawBall(ctx, v, b) {
    const p = this.P(v, b.X, b.Z, b.h), r = Math.max(4, BR * 2.4 * p.s), onT = Math.abs(b.X) <= HW && b.Z >= 0 && b.Z <= LZ && b.h > -.05, gp = this.P(v, b.X, b.Z, 0);
    for (let i = 0; i < this.trail.length - 1; i++) { const q = this.P(v, this.trail[i].X, this.trail[i].Z, this.trail[i].h); ctx.fillStyle = `rgba(255,220,160,${.04 + i * .04})`; ctx.beginPath(); ctx.arc(q.x, q.y, r * (.4 + i * .1), 0, 6.3); ctx.fill(); }
    if (onT) { ctx.fillStyle = `rgba(0,0,0,${clamp(.4 - b.h * .4, .1, .4)})`; ctx.beginPath(); ctx.ellipse(gp.x, gp.y, r * (1 + b.h * .6), r * .4, 0, 0, 6.3); ctx.fill(); }
    this.drawBallSprite(ctx, p.x, p.y, r);
  }
  drawRacket(ctx, v) {
    const { min } = this.app, R = this.racket, L = min * .1, rr = min * .07;
    ctx.save(); ctx.translate(R.x, R.y); ctx.rotate(R.ang);
    ctx.strokeStyle = '#a9743c'; ctx.lineWidth = min * .02; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, min * .04); ctx.lineTo(0, -L * .3); ctx.stroke();
    ctx.translate(0, -L - rr * .3); ctx.fillStyle = '#d6303a'; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = min * .008; ctx.stroke();
    if (R.speed > 1) { ctx.globalAlpha = clamp((R.speed - 1) * .25, 0, .4); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, rr * 1.15, 0, 6.3); ctx.fill(); }
    ctx.restore();
  }
}
