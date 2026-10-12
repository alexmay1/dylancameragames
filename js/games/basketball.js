import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { FlickDetector } from '../gestures.js?v=23';
import { idealPower, shotError, outcome, basketPoints } from '../bballrules.js?v=23';

/* Basketball — flick a hand UP to shoot. Metres: X sideways, Z away from you, h height. */
const TIME = 60, RIM_H = 3.05, RIM_R = .3, BALL_R = .17, D0 = 1;

export class BasketballGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.time = TIME; this.score = 0; this.made = 0; this.shots = 0; this.streak = 0; this.bestStreak = 0; this.over = false; this.t = 0; this.flash = 0;
    this.hoop = { bx: 0, Z: 4.2, tx: 0, tz: 4.2, x: 0 }; this.ball = null; this.heldX = 0; this.heldT = 0; this.net = 0; this.det = {}; this.lastHand = null; this.cd = 3.2; this.lastCd = 4; this.state = 'ready'; this.defT = 0;
    a.sfx.crowdStart(); a.sfx.crowdLevel(.35, 1);
    a.setScoreLabel('Points'); a.setScore(0); this.hud();
    a.hint(a.touchMode && !a.cameraOn ? '🏀 Swipe UP fast to shoot! Start your swipe lined up with the hoop.' : '🏀 Raise a hand under the hoop, then FLICK it UP to shoot!');
  }
  destroy() { this.app.sfx.crowdStop(); }
  level() { return 1 + Math.floor(this.made / 3); }
  hud() { const a = this.app; a.setLeft('⏱ ' + Math.ceil(Math.max(0, this.time))); a.setRight(this.streak >= 2 ? `🔥 Streak ${this.streak}` : `Level ${this.level()}`); a.setScore(this.score); }
  view() { const { W, H } = this.app, port = W < H; return { W, H, cx: W / 2, hy: H * (port ? .4 : .44), K: W * (port ? 1.5 : .8), camH: 2.2 }; }
  P(v, X, Z, h = 0) { const s = v.K / (Z + D0); return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s }; }
  hoopX(t) { const L = this.level(); return L >= 3 ? this.hoop.bx + Math.sin(t * (.8 + .1 * L)) * Math.min(1.3, .6 + .15 * (L - 3)) : this.hoop.bx; }
  relocate() {
    const L = this.level(), h = this.hoop; h.tz = 3.6 + Math.random() * Math.min(3.2, 1.2 + L * .5); h.bx = rand(-1, 1) * Math.min(2.2, .9 + L * .3);
  }

  update(dt, hands) {
    const a = this.app, now = performance.now() / 1000;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5); this.net = Math.max(0, this.net - dt); this.t += dt; this.defT += dt;
    const h = this.hoop; h.Z = lerp(h.Z, h.tz, 1 - Math.exp(-dt * 3)); h.x = this.hoopX(this.t);
    const hand = hands.find(q => !q.pointer) || hands[0]; if (hand) this.lastHand = hand;
    if (this.lastHand && (hand || this.lastHand.pointer)) this.heldX = lerp(this.heldX, this.lastHand.palm.x, .35);
    if (this.state === 'ready') {
      this.cd -= dt; const n = Math.ceil(this.cd); if (n !== this.lastCd && n >= 1 && n <= 3) { this.lastCd = n; a.sfx.tick(); }
      if (this.cd <= 0) { this.state = 'play'; a.sfx.bell(); }
    } else if (this.state === 'play') {
      this.time -= dt; this.heldT -= dt; if (Math.ceil(this.time) !== this._ct) { this._ct = Math.ceil(this.time); this.hud(); }
      if (this.time <= 0) return this.finish();
      if (this.time < 10 && Math.ceil(this.time) !== this._tk) { this._tk = Math.ceil(this.time); a.sfx.tick(); }
      for (const hh of hands) {
        const d = this.det[hh.id] || (this.det[hh.id] = new FlickDetector({ thr: 1.5, cool: .5 }));
        const f = d.push(now, { speed: hh.speed, vx: hh.vel.x, vy: hh.vel.y, x: hh.palm.x, y: hh.palm.y });
        if (f && this.heldT <= 0) { this.shoot(f); break; }
      }
    }
    if (this.ball) this.stepBall(dt);
  }
  shoot(f) {
    const a = this.app, v = this.view(), h = this.hoop, L = this.level();
    this.shots++; this.heldT = .7; a.hint(null); a.sfx.whoosh();
    const T = .85 + .05 * h.Z, hx = this.hoopX(this.t + T), sc = this.P(v, h.x, h.Z, RIM_H), er = shotError(f, h.Z, sc.x, sc.s);
    const s0 = v.K / (.3 + D0), X0 = (f.x - v.cx) / s0, ball = { X: X0, Z: .3, h: 1.1, t: 0, T, from: { X: X0, Z: .3, h: 1.1 }, to: { X: hx + er.ex, Z: h.Z + er.ez, h: RIM_H }, peak: 1.1 + .22 * h.Z, ex: er.ex, ez: er.ez, phase: 'fly', res: null, vx: 0, vz: 0, vh: 0, spin: 0 };
    // defender (level 2+): may swat a ball that passes near him mid-flight
    if (L >= 2) { const dx = this.defX(), mid = lerp(X0, hx + er.ex, .5); if (Math.abs(mid - dx) < .38 && Math.random() < .6) ball.blocked = true; }
    ball.res = ball.blocked ? 'blocked' : outcome(er.ex, er.ez);
    this.ball = ball;
  }
  defX() { return this.hoop.x + Math.sin(this.defT * 1.3) * 1.5; }
  stepBall(dt) {
    const b = this.ball, a = this.app; b.spin += dt * 9;
    if (b.phase === 'fly') {
      b.t += dt / b.T; const k = Math.min(1, b.t);
      b.X = lerp(b.from.X, b.to.X, k); b.Z = lerp(b.from.Z, b.to.Z, k); b.h = lerp(b.from.h, b.to.h, k) + 4 * b.peak * k * (1 - k) * .55;
      if (b.res === 'blocked' && k > .42) { b.phase = 'free'; b.vx = rand(-2, 2); b.vz = -2.2; b.vh = 2.5; this.miss('BLOCKED!'); a.sfx.block(); }
      else if (k >= 1) { this.arrive(b); }
    } else {
      b.vh -= 9.8 * .7 * dt; b.X += b.vx * dt; b.Z += b.vz * dt; b.h += b.vh * dt;
      if (b.phase === 'in' && b.h < RIM_H - .5) { b.vx *= .4; b.vz *= .4; }
      if (b.h < BALL_R && b.vh < 0) { b.h = BALL_R; b.vh *= -.55; b.vx *= .8; b.vz *= .8; b.bounces = (b.bounces || 0) + 1; if (b.bounces < 3) this.app.sfx.bounce(); }
      if ((b.bounces || 0) >= 3 || b.Z < -1) this.ball = null;
    }
  }
  arrive(b) {
    const a = this.app, r = b.res, v = this.view(), q = this.P(v, this.hoop.x, this.hoop.Z, RIM_H);
    b.phase = 'free'; b.bounces = 0;
    if (r === 'swish') { b.vx = -b.ex * 1.2; b.vz = -b.ez * 1.2; b.vh = -1.5; b.phase = 'in'; a.sfx.swish(); this.score_(r); }
    else if (r === 'rimIn' || r === 'bank') { b.vx = -b.ex * 2.4; b.vz = -b.ez * 2.4; b.vh = 1.2; b.phase = 'in'; a.sfx.rim(); setTimeout(() => a.sfx.swish(), 220); this.score_(r); }
    else if (r === 'rimOut') { b.vx = (b.ex || .3) * 3 + rand(-.5, .5); b.vz = (b.ez || .3) * 3; b.vh = 2.6; a.sfx.rim(); this.miss('So close!'); }
    else { b.vx = b.ex * .8; b.vz = b.ez * .8 + 1.4; b.vh = 1; this.miss('Miss'); }
  }
  score_(kind) {
    const a = this.app, v = this.view(); this.streak++; this.made++; this.bestStreak = Math.max(this.bestStreak, this.streak);
    const pts = basketPoints(this.streak - 1, kind); this.score += pts; this.net = .7; this.flash = .6;
    const q = this.P(v, this.hoop.x, this.hoop.Z, RIM_H); this.pop.add(q.x, q.y - 50, `+${pts}${kind === 'swish' ? ' SWISH!' : ''}`, kind === 'swish' ? '#7dffb0' : '#ffe45e', Math.max(30, a.min * .06));
    this.fx.confetti(q.x, q.y, 24, 400); a.sfx.crowdCheer(Math.min(1, .5 + this.streak * .1)); a.sfx.cheer(); this.crowd.excite = Math.min(1, this.crowd.excite + .45);
    if (this.streak === 3 || this.streak === 5) a.banner(`🔥 ${this.streak} in a row! Bonus points!`, 1000);
    if (this.made % 3 === 0 && a.banner) { setTimeout(() => a.banner(`Level ${this.level()}!`, 800), 600); }
    this.relocate(); this.hud();
  }
  miss(txt) { this.streak = 0; this.app.sfx.crowdGroan(); const v = this.view(), q = this.P(v, this.hoop.x, this.hoop.Z, RIM_H + .7); this.pop.add(q.x, q.y, txt, '#ffb3b3', Math.max(26, this.app.min * .05)); this.hud(); }
  finish() {
    const a = this.app; this.over = true; this.time = 0; this.hud(); a.hint(null);
    a.sfx.bell(); a.sfx.crowdCheer(.9); setTimeout(() => a.sfx.crowdStop(), 2400);
    a.banner('Time!', 900);
    setTimeout(() => { if (a.game === this) a.showResult({ title: this.score >= 40 ? 'MVP!' : this.score >= 20 ? 'Great shooting!' : 'Nice try!', emoji: this.score >= 20 ? '🏆' : '🏀', score: this.score, stats: [['Baskets', this.made], ['Shots', this.shots], ['Best streak', this.bestStreak]] }); }, 1200);
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H } = a, v = this.view(), h = this.hoop, now = this.t;
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#1a1245'); g.addColorStop(1, '#3a2b7a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    // floor
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#b5733a'); g.addColorStop(1, '#e0a566'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const Zb = h.Z + 1.3, poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([X, Z], i) => { const p = this.P(v, X, Z, 0); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); } };
    ctx.strokeStyle = 'rgba(110,60,20,.25)'; ctx.lineWidth = 1; for (let X = -10; X <= 10; X += 1) { const p0 = this.P(v, X * .6 + h.bx * 0, 0, 0), p1 = this.P(v, X * .6, Zb, 0); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); }
    poly([[-2.4, Zb], [2.4, Zb], [2.4, Zb - 5.8], [-2.4, Zb - 5.8]], 'rgba(200,40,50,.45)', 'rgba(255,255,255,.9)');
    const c = this.P(v, 0, Zb - 5.8, 0); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(c.x, c.y, 1.8 * c.s, 1.8 * c.s * .22, 0, 0, 6.3); ctx.stroke();
    poly([[-9, Zb], [9, Zb], [9, Zb + .06], [-9, Zb + .06]], '#fff');
    // backboard + hoop
    const hp = this.P(v, h.x, h.Z + .45, RIM_H + 1.0), sb = hp.s, bw = 1.8 * sb, bh = 1.05 * sb;
    ctx.fillStyle = '#2b2b3a'; const pole = this.P(v, h.x, h.Z + .75, 0); ctx.fillRect(hp.x - 4, hp.y + bh / 2, 8, Math.max(0, H - hp.y)); 
    ctx.fillStyle = 'rgba(235,245,255,.92)'; ctx.fillRect(hp.x - bw / 2, hp.y - bh / 2, bw, bh); ctx.strokeStyle = '#d33'; ctx.lineWidth = 4; ctx.strokeRect(hp.x - bw / 2, hp.y - bh / 2, bw, bh);
    const rim = this.P(v, h.x, h.Z, RIM_H), rr = RIM_R * rim.s, ry = rr * .32;
    ctx.strokeStyle = '#d33'; ctx.lineWidth = Math.max(2, rr * .1); ctx.strokeRect(hp.x - bw * .17, hp.y + bh * .05 - bh * .12, bw * .34, bh * .3);
    ctx.lineWidth = Math.max(3, rr * .14); ctx.strokeStyle = '#ff6a1f'; ctx.beginPath(); ctx.ellipse(rim.x, rim.y, rr, ry, 0, Math.PI, 0); ctx.stroke();     // back rim
    // defender
    if (this.level() >= 2) this.drawDefender(ctx, v);
    // ball behind-the-rim parts then net
    const ball = this.ball, behind = ball && ball.phase === 'in' && ball.h < RIM_H - .15;
    if (ball && !behind) this.drawBall(ctx, v, ball);
    this.drawNet(ctx, rim, rr, ry);
    if (ball && behind) this.drawBall(ctx, v, ball);
    ctx.strokeStyle = '#ff6a1f'; ctx.lineWidth = Math.max(3, rr * .14); ctx.beginPath(); ctx.ellipse(rim.x, rim.y, rr, ry, 0, 0, Math.PI); ctx.stroke();               // front rim
    // held ball (follows your hand)
    if (!ball && (this.state === 'play' || this.state === 'ready') && !this.over) {
      const r = a.min * .07, x = clamp(this.heldX || W / 2, r, W - r), y = H - r * 1.35; this.drawBallSprite(ctx, x, y, r, 0);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x - 1.5, y - H * .12, 3, H * .1);
    }
    if (this.state === 'ready') { const n = Math.ceil(this.cd); if (n >= 1 && n <= 3) bigText(ctx, String(n), W / 2, H * .5, a.min * .3); else bigText(ctx, 'GO!', W / 2, H * .5, a.min * .25, '#7dffb0'); }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .25})`; ctx.fillRect(0, 0, W, H); }
  }
  drawNet(ctx, rim, rr, ry) {
    const sw = this.net > 0 ? Math.sin(this.net * 28) * rr * .18 * (this.net / .7) : 0, nh = rr * 1.2;
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1.2, rr * .035); ctx.beginPath();
    for (let i = 0; i <= 8; i++) { const u = i / 8 * 2 - 1, x0 = rim.x + u * rr, x1 = rim.x + u * rr * .55 + sw; ctx.moveTo(x0, rim.y + (1 - Math.abs(u) ** 2) * ry * .2); ctx.lineTo(x1, rim.y + nh); }
    for (let j = 1; j <= 3; j++) { const k = j / 4, y = rim.y + nh * k, w = rr * (1 - .45 * k); ctx.moveTo(rim.x - w + sw * k, y); ctx.lineTo(rim.x + w + sw * k, y); }
    ctx.stroke(); ctx.restore();
  }
  drawBallSprite(ctx, x, y, r, rot) {
    const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r); g.addColorStop(0, '#ffb072'); g.addColorStop(.6, '#f07a1c'); g.addColorStop(1, '#a8460a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = 'rgba(40,15,0,.75)'; ctx.lineWidth = Math.max(1.5, r * .07); ctx.beginPath(); ctx.arc(0, 0, r * .98, 0, 6.3); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r * .7, -r * .7); ctx.quadraticCurveTo(-r * .2, 0, -r * .7, r * .7); ctx.moveTo(r * .7, -r * .7); ctx.quadraticCurveTo(r * .2, 0, r * .7, r * .7); ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(x - r * .38, y - r * .42, r * .2, r * .11, -.8, 0, 6.3); ctx.fill();
  }
  drawBall(ctx, v, b) {
    const p = this.P(v, b.X, b.Z, b.h), gp = this.P(v, b.X, b.Z, 0), r = BALL_R * 1.15 * p.s;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(gp.x, gp.y, r, r * .3, 0, 0, 6.3); ctx.fill();
    this.drawBallSprite(ctx, p.x, p.y, r, b.spin);
  }
  drawDefender(ctx, v) {
    const X = this.defX(), Z = this.hoop.Z - 1.1, f = this.P(v, X, Z, 0), s = f.s, t = this.defT;
    ctx.save(); ctx.translate(f.x, f.y); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, .4 * s, .12 * s, 0, 0, 6.3); ctx.fill();
    ctx.lineCap = 'round'; ctx.strokeStyle = '#27346b'; ctx.lineWidth = .2 * s; ctx.beginPath(); ctx.moveTo(-.12 * s, -.95 * s); ctx.lineTo(-.16 * s, 0); ctx.moveTo(.12 * s, -.95 * s); ctx.lineTo(.16 * s, 0); ctx.stroke();
    ctx.fillStyle = '#1c9c5d'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-.3 * s, -1.65 * s, .6 * s, .85 * s, .12 * s) : ctx.rect(-.3 * s, -1.65 * s, .6 * s, .85 * s); ctx.fill();
    ctx.strokeStyle = '#8b5a3c'; ctx.lineWidth = .14 * s; for (const sg of [-1, 1]) { const w = Math.sin(t * 7 + sg) * .35; ctx.beginPath(); ctx.moveTo(sg * .3 * s, -1.55 * s); ctx.lineTo(sg * (.5 + w * .3) * s, -2.35 * s); ctx.stroke(); }
    ctx.fillStyle = '#8b5a3c'; ctx.beginPath(); ctx.arc(0, -1.85 * s, .2 * s, 0, 6.3); ctx.fill(); ctx.restore();
  }
}
