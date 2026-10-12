import { Particles, Popups, bigText, rand, clamp, lerp, pick } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { Flyovers } from '../flyers.js?v=23';
import { KickDetector, shotFromKick, saveZones, ballSaved } from '../soccerlogic.js?v=23';

/* Soccer — two roles. KICKER: swing a foot (pose ankle speed) or swipe (touch) to shoot at an AI goalie.
 * GOALIE: an AI kicker shoots at you; your hands/feet/body (pose + hands) or finger cover the ball's path.
 * Pseudo-3D: P(X metres sideways, zf metres out from the goal line, H metres high) -> screen. */

const SHOTS = 5, GOAL_W = 7.32, HALF = GOAL_W / 2, GOAL_H = 2.44, BR = .16, PEN = 11;

export class SoccerGame {
  constructor(app) { this.app = app; }
  start(opts = {}) {
    const a = this.app;
    this.role = opts.role === 'goalie' ? 'goalie' : 'kick';
    this.sim = !!a.balanceSim || (a.touchMode && !a.cameraOn);
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd(); this.fly = new Flyovers();
    this.shotN = 0; this.goals = 0; this.saves = 0; this.misses = 0; this.score = 0; this.over = false; this.flash = 0;
    this.det = new KickDetector(); this.lastPoseT = -1; this.hist = []; this.lastPtr = null; this.cdN = 9; this.noFeetT = 0;
    this.gk = { x: 0, rot: 0, plan: null, t: 0 }; this.ball = null; this.shot = null; this.kickerRun = null; this.spin = 0; this.firstShot = true;
    a.pose.enabled = !this.sim; a.pose.minInterval = 45;
    a.sfx.crowdStart(); a.sfx.crowdLevel(.35, 1);
    a.setScoreLabel(this.role === 'kick' ? 'Goals' : 'Saves'); a.setScore(0); this.hud();
    const sw = document.getElementById('socSwitch'); this.swEl = sw; sw.classList.remove('hidden');
    sw.textContent = this.role === 'kick' ? '🔄 Switch to GOALIE 🧤' : '🔄 Switch to KICKER ⚽';
    this.swHandler = () => a.startRole && a.startRole(this.role === 'kick' ? 'goalie' : 'kick'); sw.onclick = this.swHandler;
    this.toReady();
  }
  destroy() {
    const a = this.app; a.pose.enabled = false; a.pose.minInterval = 40; a.sfx.crowdStop();
    if (this.swEl) { this.swEl.classList.add('hidden'); this.swEl.onclick = null; }
  }
  hud() { const a = this.app; a.setLeft(`Shot ${Math.min(this.shotN + (this.state === 'ready' || this.state === 'aim' || this.state === 'runup' || this.state === 'flight' ? 1 : 0), SHOTS)}/${SHOTS}`); a.setRight(this.role === 'kick' ? '⚽ Kicker' : '🧤 Goalie'); }

  /* ---------- flow ---------- */
  toReady() {
    const a = this.app; this.state = 'ready'; this.t = this.firstShot ? 2.6 : 1.7; this.ball = null; this.shot = null; this.after = null;
    this.gk = { x: 0, rot: 0, plan: null, t: 0 }; this.kickerRun = null; this.cdN = 9; this.hud();
    a.hint(this.role === 'kick'
      ? (this.sim ? '⚽ Swipe UP on the screen to kick! Swipe left or right to aim.' : '⚽ Swing your foot fast through the ball! Move it left or right to aim.')
      : (this.sim ? '🧤 Drag your finger to block the ball!' : '🧤 Move your hands, feet and body to block the ball!'));
  }
  nextShot() {
    this.shotN++; this.firstShot = false;
    if (this.shotN >= SHOTS) return this.finish();
    this.toReady();
  }
  finish() {
    const a = this.app; this.over = true; this.state = 'over'; a.hint(null); this.swEl.classList.add('hidden');
    const k = this.role === 'kick', sc = this.score, top = sc >= 4;
    a.banner(k ? `${this.goals} goals!` : `${this.saves} saves!`, 1100); a.sfx.crowdCheer(.8); setTimeout(() => a.sfx.crowdStop(), 2400);
    const other = k ? 'goalie' : 'kick';
    setTimeout(() => { if (a.game === this) a.showResult({ title: top ? (k ? 'Superstar striker!' : 'Wall of steel!') : sc >= 2 ? 'Nice game!' : 'Good try!', emoji: top ? '🏆' : '⚽', score: sc, bestKey: '_' + this.role, stats: [[k ? 'Goals' : 'Saves', sc], [k ? 'Saved by keeper' : 'Goals let in', k ? this.saves : this.goals], ['Missed', this.misses]], switchTo: other, switchLabel: k ? '🔄 Play as GOALIE 🧤' : '🔄 Play as KICKER ⚽' }); }, 1300);
  }

  /* ---------- geometry ---------- */
  view() {
    const { W, H } = this.app, port = W < H, K = W * (port ? 1.7 : 1.1);
    if (this.role === 'kick') return { mode: 'kick', W, H, cx: W / 2, K, hy: H * .38, camH: port ? 3 : 2, dg: 17.7 };
    return { mode: 'goalie', W, H, cx: W / 2, K, hy: H * .34, camH: 1.5, dg: GOAL_W * K / (.9 * W) };
  }
  P(v, X, zf, h = 0) {
    const d = v.mode === 'kick' ? v.dg - zf : v.dg + zf; if (d < 1.2) return null;
    const s = v.K / d; return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s, d };
  }

  /* ---------- update ---------- */
  update(dt, hands) {
    const a = this.app; this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.fly.update(dt, a.W, a.H, a.sfx); this.flash = Math.max(0, this.flash - dt * 2);
    this.spin += dt * (this.shot ? 10 + this.shot.power * 20 : 0);
    this.readInput(dt, hands);
    if (this.over) return;
    if (this.state === 'ready') {
      this.t -= dt; const n = Math.ceil(this.t); if (n !== this.cdN && n >= 1 && n <= 3) { this.cdN = n; a.sfx.tick(); }
      if (this.t <= 0) { if (this.role === 'kick') { this.state = 'aim'; this.kickT = 0; this.det.lastFire = performance.now() / 1000 - 5; } else { this.state = 'runup'; this.t = 1.3; this.makeAIShot(); } this.hud(); }
    } else if (this.state === 'aim') {
      this.kickT += dt;
      const k = this.pendingKick; this.pendingKick = null;
      if (k && this.kickT > .25) this.launchKick(k);
      if (!this.sim) { this.noFeetT = this.feet.length ? 0 : this.noFeetT + dt; a.hint(this.noFeetT > 1 ? "I can't see your feet! Step back, or tilt the device so your legs are in view. 🦶" : (this.firstShot || this.kickT > 8 ? '⚽ Swing your foot fast through the ball!' : null)); }
      else a.hint(this.kickT > 6 ? '⚽ Swipe UP on the screen to kick!' : null);
    } else if (this.state === 'runup') {
      this.t -= dt; const r = this.kickerRun; r.k = clamp(1 - this.t / 1.3, 0, 1);
      if (this.t <= 0) this.launchAI();
    } else if (this.state === 'flight') this.updateFlight(dt);
    else if (this.state === 'result') { this.stepAfter(dt); this.t -= dt; if (this.t <= 0) this.nextShot(); }
    this.updateGK(dt);
  }
  readInput(dt, hands) {
    const a = this.app, min = a.min, now = performance.now() / 1000, s = a.pose.state, fresh = !this.sim && now - s.t < 1.0 && s.pts;
    this.feet = []; this.pend = null;
    if (fresh) {
      for (const i of [27, 28]) { const p = s.pts[i]; if (p && (p.visibility ?? 1) > .35 && p.x > -.05 && p.x < 1.05 && p.y < 1.05) { const m = a.mapPoint(p.x, p.y); this.feet.push({ i, x: m.x, y: m.y }); } }
      if (s.t !== this.lastPoseT) {
        this.lastPoseT = s.t; const f = {}; for (const q of this.feet) f[q.i] = { x: q.x / min, y: q.y / min };
        const k = this.det.push(s.t, f); if (k && this.state === 'aim') { k.off = (k.x * min - a.W / 2) / min; this.pendingKick = k; }
      }
    }
    // touch / hand swipe
    if (this.role === 'kick' && this.state === 'aim' && (this.sim || a.touchMode)) for (const h of hands) {
      if (h.speed > 1.7 && h.vel.y < -.35 * h.speed) { this.pendingKick = { power: clamp((h.speed - 1.7) / 2.3, .12, 1), vx: h.vel.x, vy: h.vel.y, speed: h.speed, x: h.palm.x / min, y: h.palm.y / min, off: 0 }; break; }
    }
    if (this.role === 'goalie') {
      const hs = hands.slice(); const ptr = hands.find(h => h.pointer); if (ptr) this.lastPtr = { x: ptr.palm.x, y: ptr.palm.y };
      if (this.sim && !ptr && this.lastPtr) hs.push({ palm: this.lastPtr, pointer: true });
      const zones = saveZones({ pts: fresh ? s.pts : null, map: (i) => a.mapPoint(s.pts[i].x, s.pts[i].y), hands: hs, min, W: a.W });
      this.zones = zones; this.hist.push({ t: now, zones }); while (this.hist.length && now - this.hist[0].t > .3) this.hist.shift();
      if (!this.sim && !zones.length && (this.state === 'ready' || this.state === 'runup')) a.hint("I can't see you! Step back so your body or legs are in view. 🙋");
      else if (this.state === 'ready' && !this.firstShot) a.hint(null);
    }
  }

  /* ---------- kicker role ---------- */
  launchKick(k) {
    const a = this.app, v = this.view(), s = shotFromKick(k, k.off || 0); a.hint(null);
    const wide = Math.abs(s.xt) > HALF + .15, over = s.hg > GOAL_H;
    const i = this.shotN, diff = clamp(i / 4, 0, 1), react = lerp(.42, .26, diff) + rand(-.04, .04), correct = Math.random() < .22 + .13 * i;
    let tx = pick([-2.3, 0, 2.3]); if (correct) tx = Math.abs(s.xt) > 1.3 ? Math.sign(s.xt) * 2.3 : 0;
    this.gk.plan = { react, tx, dived: tx !== 0 };
    this.shot = { t: 0, T: PEN / s.speed, xs: 0, zs: PEN, xt: s.xt, hg: s.hg, arc: .35 + .5 * s.power, power: s.power, wide, over, dir: Math.sign(s.xt) || 1 };
    this.ball = { X: 0, zf: PEN, h: BR, a: 1 }; this.state = 'flight'; this.hud(); a.sfx.kick();
    this.fx.burst(this.sx(v, 0, PEN, .2), this.sy(v, 0, PEN, .2), 120, 16, 300, 6);
  }
  updateGK(dt) {
    const g = this.gk; g.t += dt;
    if (this.role !== 'kick') return;
    if (g.plan && this.state === 'flight') { const k = clamp((g.t - g.plan.react) / .3, 0, 1), e = 1 - (1 - k) * (1 - k); g.x = g.plan.tx * e; g.rot = g.plan.dived ? Math.sign(g.plan.tx) * e * 1.25 : 0; }
    else if (this.state === 'ready' || this.state === 'aim') { g.x = Math.sin(performance.now() / 500) * .35; g.rot = 0; }
  }
  /* ---------- goalie role ---------- */
  makeAIShot() {
    const i = this.shotN, r = Math.random(); let xt = rand(-3.3, 3.3), hg = rand(.25, 2.2);
    if (r < .12) xt = (Math.random() < .5 ? -1 : 1) * rand(4.1, 5.4); else if (r < .2) hg = rand(2.7, 3.3);
    else if (Math.random() < .35) { xt = Math.sign(xt || 1) * rand(2.4, 3.4); hg = pick([rand(.2, .7), rand(1.7, 2.3)]); }
    const xs = rand(-5, 5), zs = rand(9.5, 14), speed = 8 + i * 1.2 + rand(0, 2), dist = Math.hypot(xs - xt, zs);
    this.shot = { t: 0, T: dist / speed, xs, zs, xt, hg, arc: .5 + Math.random() * .5, power: clamp((speed - 8) / 10, .1, 1), wide: Math.abs(xt) > HALF + .15, over: hg > GOAL_H, dir: Math.sign(xt - xs) || 1 };
    this.kickerRun = { k: 0, x: xs, z: zs };
    this.ball = { X: xs, zf: zs, h: BR, a: 1 };
  }
  launchAI() { this.state = 'flight'; this.app.sfx.kick(); this.app.hint(null); this.hud(); }

  /* ---------- flight / results ---------- */
  ballAt(k) { const s = this.shot; return { X: lerp(s.xs, s.xt, k), zf: lerp(s.zs, 0, k), h: BR + (s.hg - BR) * k + 4 * s.arc * k * (1 - k) }; }
  updateFlight(dt) {
    const s = this.shot; s.t += dt; const k = Math.min(1, s.t / s.T); Object.assign(this.ball, this.ballAt(k));
    if (k >= 1) this.arrive();
  }
  arrive() {
    const a = this.app, s = this.shot, kick = this.role === 'kick'; let res;
    const v = this.view();
    if (s.wide) res = 'wide'; else if (s.over) res = 'over';
    else if (kick) {
      const g = this.gk, dived = g.plan && g.plan.dived && g.t > g.plan.react, reachX = .85 + (dived ? 1.05 : 0), reachH = dived ? 2.35 : 2.05;
      res = Math.abs(s.xt - g.x) <= reachX && s.hg <= reachH ? 'saved' : 'goal';
    } else {
      const p = this.P(v, s.xt, 0, s.hg), br = p ? BR * p.s * 1.3 : 10, z = p && ballSaved(p.x, p.y, br, this.hist);
      res = z ? 'saved' : 'goal'; this.saveZone = z;
    }
    const b = this.ball, sp = s.power * 10 + 8;
    // post-arrival physics
    this.after = { vx: 0, vz: 0, vh: 0, t: 0, res, fade: false };
    const A = this.after;
    if (kick) {
      if (res === 'goal') { A.vz = -sp * .35; A.vx = s.xt * .12; A.vh = 1; }
      else if (res === 'saved') { A.vz = 3 + sp * .15; A.vx = (Math.random() < .5 ? -1 : 1) * rand(2, 4.5); A.vh = rand(2.5, 4); }
      else { A.vz = -sp * .5; A.vx = s.xt * .15; A.vh = res === 'over' ? 3 : 1; }
    } else {
      if (res === 'goal') { A.vz = -sp * .8; A.fade = true; }
      else if (res === 'saved') { A.vz = 6; A.vx = (Math.random() < .5 ? -1 : 1) * rand(2, 5); A.vh = rand(2.5, 4); }
      else { A.vz = -sp * .8; A.fade = true; }
    }
    this.showResult(res);
  }
  showResult(res) {
    const a = this.app, kick = this.role === 'kick', v = this.view();
    const msg = { goal: ['GOOOAL!', '⚽ What a shot!'], saved: ['SAVED!', kick ? 'The keeper got it' : 'Great save! 🧤'], wide: ['WIDE!', kick ? 'Just missed the post' : 'It missed the goal!'], over: ['OVER THE BAR!', kick ? 'Too high!' : 'It sailed over!'] }[res];
    a.banner(`${msg[0]}<small>${msg[1]}</small>`, 1500);
    const good = kick ? res === 'goal' : (res === 'saved' || res === 'wide' || res === 'over');
    if (res === 'goal') this.goals++; else if (res === 'saved') this.saves++; else this.misses++;
    if (kick ? res === 'goal' : res === 'saved') { this.score++; a.setScore(this.score); }
    if (res === 'goal' || res === 'saved') { /* crowd reacts for the player */ }
    if (res === 'goal') {
      if (kick) { a.sfx.cheer(); a.sfx.crowdCheer(1); this.crowd.excite = 1; this.crowd.wave = 3.5; this.flash = 1; this.fx.confetti(a.W * .3, a.H * .45, 50); this.fx.confetti(a.W * .7, a.H * .45, 50); }
      else { this.crowd.sad = 1.8; this.crowd.excite = 0; a.sfx.crowdGroan(); a.sfx.miss && a.sfx.miss(); }
    } else if (res === 'saved') {
      if (kick) { this.crowd.sad = 1.4; a.sfx.crowdGroan(); a.sfx.thud(); }
      else { a.sfx.cheer(); a.sfx.crowdCheer(.8); this.crowd.excite = .9; this.crowd.wave = 2; this.fx.confetti(a.W / 2, a.H * .4, 40); a.sfx.thud(); }
    } else { this.crowd.sad = 1.1; a.sfx.crowdGroan(); }
    this.state = 'result'; this.t = 2.0; this.result = res; this.hud();
  }
  stepAfter(dt) {
    const A = this.after, b = this.ball; if (!A || !b) return; A.t += dt;
    b.X += A.vx * dt; b.zf += A.vz * dt; b.h += A.vh * dt; A.vh -= 9.8 * dt;
    if (b.h < BR) { b.h = BR; A.vh = -A.vh * .45; A.vx *= .75; A.vz *= .75; }
    if (this.role === 'kick' && A.res === 'goal' && b.zf < -1.7) { b.zf = -1.7; A.vz = 0; A.vx *= .3; }
    if (A.fade) b.a = Math.max(0, 1 - A.t * 1.6);
    this.spin += dt * 6;
  }

  /* ---------- drawing ---------- */
  sx(v, X, zf, h) { const p = this.P(v, X, zf, h); return p ? p.x : this.app.W / 2; }
  sy(v, X, zf, h) { const p = this.P(v, X, zf, h); return p ? p.y : this.app.H / 2; }
  draw(ctx) {
    const a = this.app, { W, H } = a, v = this.view();
    this.crowd.draw(ctx, { W, H, hy: v.hy }); this.fly.draw(ctx, W);
    this.drawPitch(ctx, v);
    if (v.mode === 'kick') this.drawKickView(ctx, v); else this.drawGoalieView(ctx, v);
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .35})`; ctx.fillRect(0, 0, W, H); }
    if (this.state === 'ready' && this.t < 2.2) bigText(ctx, String(Math.max(1, Math.ceil(this.t - .1))), W / 2, H * .24, a.min * .15);
  }
  poly(ctx, pts) { if (pts.some(p => !p)) return false; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); return true; }
  seg(ctx, v, X0, z0, h0, X1, z1, h1) { const p = this.P(v, X0, z0, h0), q = this.P(v, X1, z1, h1); if (!p || !q) return; ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
  drawPitch(ctx, v) {
    const { W, H } = v, kick = v.mode === 'kick', zMin = kick ? -40 : -8, zMax = kick ? 14 : 40;
    ctx.fillStyle = 'rgba(40,130,60,.82)'; ctx.fillRect(0, v.hy, W, H - v.hy);
    for (let z = zMin, i = 0; z < zMax; z += 4, i++) {
      ctx.fillStyle = i % 2 ? 'rgba(66,172,86,.8)' : 'rgba(48,150,70,.8)';
      if (this.poly(ctx, [this.P(v, -70, z), this.P(v, 70, z), this.P(v, 70, z + 4), this.P(v, -70, z + 4)])) ctx.fill();
    }
    // stand base + advertising boards
    const zb = kick ? -14 : 30, b0 = this.P(v, 0, zb, 0), b1 = this.P(v, 0, zb, 1);
    if (b0 && b1) {
      ctx.fillStyle = '#3a3a5c'; ctx.fillRect(0, v.hy - 2, W, Math.max(0, b1.y - v.hy + 2));
      const w = 3.2 * b0.s; for (let x = -((v.cx / w) | 0) - 1, i = 0; x * w + v.cx < W; x++, i++) { ctx.fillStyle = ['#e63946', '#ffd23f', '#2a9df4', '#fff'][((x % 4) + 4) % 4]; ctx.fillRect(v.cx + x * w, b1.y, w + 1, b0.y - b1.y); }
    }
    // lines
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; const s0 = this.P(v, 0, 0, 0); ctx.lineWidth = Math.max(2, .13 * (s0 ? s0.s : 30)); ctx.lineCap = 'round'; ctx.beginPath();
    this.seg(ctx, v, -60, 0, 0, 60, 0, 0);
    this.seg(ctx, v, -9.16, 0, 0, -9.16, 5.5, 0); this.seg(ctx, v, 9.16, 0, 0, 9.16, 5.5, 0); this.seg(ctx, v, -9.16, 5.5, 0, 9.16, 5.5, 0);
    this.seg(ctx, v, -20.16, 0, 0, -20.16, 16.5, 0); this.seg(ctx, v, 20.16, 0, 0, 20.16, 16.5, 0); this.seg(ctx, v, -20.16, 16.5, 0, 20.16, 16.5, 0);
    ctx.stroke();
    const sp = this.P(v, 0, PEN, 0); if (sp && v.mode === 'kick') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y, sp.s * .2, sp.s * .08, 0, 0, 6.3); ctx.fill(); }
  }
  drawGoal(ctx, v, net) {
    const kick = v.mode === 'kick', f = (X, h) => this.P(v, X, 0, h), bz = -1.8;
    if (net && kick) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let X = -HALF; X <= HALF + .01; X += .61) this.seg(ctx, v, X, bz, 0, X, bz, GOAL_H - .15);
      for (let h = 0; h <= GOAL_H; h += .5) this.seg(ctx, v, -HALF, bz, h, HALF, bz, h);
      for (let h = 0; h <= GOAL_H; h += .5) { this.seg(ctx, v, -HALF, 0, h, -HALF, bz, Math.min(h, GOAL_H - .15)); this.seg(ctx, v, HALF, 0, h, HALF, bz, Math.min(h, GOAL_H - .15)); }
      for (let X = -HALF; X <= HALF + .01; X += .61) this.seg(ctx, v, X, 0, GOAL_H, X, bz, GOAL_H - .15);
      ctx.stroke(); ctx.restore();
    }
    const a = f(-HALF, 0), b = f(-HALF, GOAL_H), c = f(HALF, GOAL_H), d = f(HALF, 0); if (!a || !b || !c || !d) return;
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(4, .13 * a.s); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    if (!kick) { ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.beginPath(); for (let X = -HALF; X <= HALF + .01; X += .61) this.seg(ctx, v, X, 0, 0, X, 0, GOAL_H); for (let h = 0; h <= GOAL_H; h += .5) this.seg(ctx, v, -HALF, 0, h, HALF, 0, h); ctx.stroke(); }
    ctx.restore();
  }
  drawPerson(ctx, x, y, h, o) {
    ctx.save(); ctx.translate(x, y); if (o.rot) { ctx.translate(0, -h * .45); ctx.rotate(o.rot); ctx.translate(0, h * .45); }
    ctx.lineCap = 'round'; const sw = Math.sin(o.ph || 0) * h * .14, kk = o.kick || 0;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; if (!o.rot) { ctx.beginPath(); ctx.ellipse(0, 0, h * .28, h * .06, 0, 0, 6.3); ctx.fill(); }
    ctx.strokeStyle = o.pants; ctx.lineWidth = h * .12; ctx.beginPath(); ctx.moveTo(-h * .08, -h * .42); ctx.lineTo(-h * .12 - sw, 0); ctx.moveTo(h * .08, -h * .42); ctx.lineTo(h * .12 + sw + kk * h * .25, -kk * h * .12); ctx.stroke();
    ctx.strokeStyle = '#f2c9a0'; ctx.lineWidth = h * .08; ctx.beginPath();
    if (o.arms === 'out') { ctx.moveTo(-h * .18, -h * .74); ctx.lineTo(-h * .5, -h * .72); ctx.moveTo(h * .18, -h * .74); ctx.lineTo(h * .5, -h * .72); }
    else { ctx.moveTo(-h * .18, -h * .74); ctx.lineTo(-h * .26, -h * .5 + sw); ctx.moveTo(h * .18, -h * .74); ctx.lineTo(h * .26, -h * .5 - sw); }
    ctx.stroke();
    if (o.arms === 'out') { ctx.fillStyle = '#7dffb0'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * h * .52, -h * .72, h * .07, 0, 6.3); ctx.fill(); } }
    ctx.fillStyle = o.jersey; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-h * .2, -h * .8, h * .4, h * .4, h * .1) : ctx.rect(-h * .2, -h * .8, h * .4, h * .4); ctx.fill();
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(0, -h * .9, h * .12, 0, 6.3); ctx.fill();
    ctx.fillStyle = o.hair || '#5a3b1e'; ctx.beginPath(); ctx.arc(0, -h * .93, h * .12, Math.PI, 0); ctx.fill();
    ctx.restore();
  }
  drawBall(ctx, x, y, r, a = 1) {
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill();
    ctx.save(); ctx.rotate(this.spin); ctx.fillStyle = '#222';
    for (let i = 0; i < 5; i++) { const t = i * 1.2566; ctx.beginPath(); ctx.arc(Math.cos(t) * r * .62, Math.sin(t) * r * .62, r * .2, 0, 6.3); ctx.fill(); }
    ctx.beginPath(); ctx.arc(0, 0, r * .24, 0, 6.3); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(1, r * .08); ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.stroke();
    const g = ctx.createRadialGradient(-r * .35, -r * .4, r * .1, 0, 0, r); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(0,0,0,.15)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  drawBallAt(ctx, v, b) {
    const g = this.P(v, b.X, b.zf, 0), p = this.P(v, b.X, b.zf, b.h); if (!g || !p) return;
    ctx.fillStyle = `rgba(0,0,0,${.28 * b.a})`; ctx.beginPath(); ctx.ellipse(g.x, g.y, BR * g.s * (1.4 + b.h * .15), BR * g.s * .5, 0, 0, 6.3); ctx.fill();   // ground shadow
    this.drawBall(ctx, p.x, p.y, clamp(BR * p.s * 1.35, 6, this.app.min * .3), b.a);
  }
  drawKickView(ctx, v) {
    const a = this.app, g = this.gk;
    this.drawGoal(ctx, v, true);
    // goalkeeper
    const fp = this.P(v, g.x, 0, 0); if (fp) {
      const h = 1.85 * fp.s, lift = g.rot ? Math.sin(Math.abs(g.rot) / 1.25 * Math.PI * .7) * .5 * fp.s : 0;
      this.drawPerson(ctx, fp.x, fp.y - lift, h, { jersey: '#ffb703', pants: '#222', arms: 'out', rot: g.rot, hair: '#222' });
    }
    // front of the goal frame over the keeper
    if (this.ball) this.drawBallAt(ctx, v, this.ball);
    else if (this.state === 'ready' || this.state === 'aim') this.drawBallAt(ctx, v, { X: 0, zf: PEN, h: BR, a: 1 });
    if (this.state === 'aim') { // pulsing ring to show where to kick
      const p = this.P(v, 0, PEN, BR); if (p) { ctx.strokeStyle = `rgba(255,228,94,${.5 + .4 * Math.sin(performance.now() / 200)})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, BR * p.s * 2.2, 0, 6.3); ctx.stroke(); }
    }
    // feet markers + kick-power gauge (so the player can see what the camera sees)
    if (!this.sim) {
      ctx.fillStyle = 'rgba(125,255,176,.85)'; for (const f of this.feet) { ctx.beginPath(); ctx.arc(f.x, f.y, a.min * .03, 0, 6.3); ctx.fill(); }
      if (this.state === 'aim') {
        const w = Math.min(a.W * .5, 300), x = a.W / 2 - w / 2, y = a.H - 26, k = clamp(this.det.live / 3.6, 0, 1);
        ctx.fillStyle = 'rgba(20,10,80,.6)'; ctx.fillRect(x - 4, y - 4, w + 8, 20); ctx.fillStyle = k > .36 ? '#7dffb0' : '#ffd23f'; ctx.fillRect(x, y, w * k, 12);
        ctx.fillStyle = '#fff'; ctx.fillRect(x + w * .36 - 1, y - 4, 3, 20);
      }
    }
  }
  drawGoalieView(ctx, v) {
    const a = this.app, s = this.shot;
    // AI kicker far away
    const kr = this.kickerRun;
    if (kr) {
      const run = this.state === 'runup' ? kr.k : 1, z = kr.z + (1 - run) * 3.5, x = kr.x + (1 - run) * (kr.x > 0 ? .8 : -.8), fp = this.P(v, x, z, 0);
      if (fp) this.drawPerson(ctx, fp.x, fp.y, 1.8 * fp.s, { jersey: '#e63946', pants: '#fff', ph: run * 18, kick: this.state === 'flight' ? 1 : (run > .85 ? (run - .85) / .15 : 0), hair: '#8b4513' });
      if (this.state !== 'flight' && this.state !== 'result') this.drawBallAt(ctx, v, { X: kr.x, zf: kr.z, h: BR, a: 1 });
    }
    this.drawGoal(ctx, v, false);
    if (this.ball && (this.state === 'flight' || this.state === 'result')) this.drawBallAt(ctx, v, this.ball);
    // save zones (what the camera sees of you)
    if (this.zones) {
      ctx.save(); for (const z of this.zones) { ctx.fillStyle = z.k === 'torso' ? 'rgba(255,228,94,.18)' : 'rgba(125,255,176,.28)'; ctx.strokeStyle = z.k === 'torso' ? 'rgba(255,228,94,.7)' : 'rgba(125,255,176,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, 6.3); ctx.fill(); ctx.stroke(); }
      if (this.sim && this.lastPtr) { ctx.font = `${a.min * .07}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🧤', this.lastPtr.x, this.lastPtr.y); }
      ctx.restore();
    }
    if (this.state === 'flight' && s) { // distance cue: ring on the goal plane where the ball will arrive
      const p = this.P(v, s.xt, 0, s.hg); const k = clamp(s.t / s.T, 0, 1); if (p && !s.wide && !s.over) { ctx.strokeStyle = `rgba(255,228,94,${.25 + .5 * k})`; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(p.x, p.y, BR * p.s * 1.35 * (1 + (1 - k) * 2.4), 0, 6.3); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
}
