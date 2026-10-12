import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { PunchDetector, BodyMotion } from '../gestures.js?v=23';

/* Boxing — punch with your wrists (pose), lean left/right to dodge the telegraphed punches. 3 rounds x 45 s. */
const ROUNDS = 3, ROUND_T = 45, DODGE = .28;

export class BoxingGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.sim = !!a.balanceSim || (a.touchMode && !a.cameraOn);
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd();
    this.round = 1; this.score = 0; this.landed = 0; this.dodges = 0; this.kos = 0; this.over = false; this.flash = 0; this.hurtFlash = 0; this.t = 0;
    this.php = 100; this.ai = { hp: 100, st: 'idle', side: 1, t: 0, next: 2.2, tgt: -1, tgtT: 1, open: 0, guard: 0, hurt: 0, ko: 0, glove: { L: 0, R: 0 } };
    this.det = { 15: new PunchDetector(), 16: new PunchDetector() }; this.body = new BodyMotion(); this.lean = 0; this.leanBest = 0; this.duckN = 0; this.gloves = []; this.lastPoseT = -1; this.noBody = 0; this.ptrLean = null; this.pend = [];
    this.state = 'ready'; this.cd = 3.2; this.lastCd = 4; this.rt = ROUND_T;
    a.pose.enabled = !this.sim; a.pose.minInterval = 40;
    a.sfx.crowdStart(); a.sfx.crowdLevel(.4, 1);
    a.setScoreLabel('Points'); a.setScore(0); this.hud();
    this.onDown = (e) => { if (!this.sim && !a.touchMode) return; const r = a.W; const y = e.clientY, x = e.clientX; if (y < a.H * .62 && this.state === 'round') this.pend.push({ side: x < a.W / 2 ? 'L' : 'R', power: .6, x, y, touch: true }); };
    a.canvasEl = document.getElementById('stage'); a.canvasEl.addEventListener('pointerdown', this.onDown);
    a.hint(this.sim ? '🥊 Tap the boxer to punch (left/right side). Hold your finger low on the left/right to lean & dodge!' : '🥊 Punch the air toward the boxer! When he cocks a fist, LEAN the other way!');
  }
  destroy() { const a = this.app; a.pose.enabled = false; a.pose.minInterval = 40; a.sfx.crowdStop(); if (a.canvasEl) a.canvasEl.removeEventListener('pointerdown', this.onDown); }
  hud() { const a = this.app; a.setLeft(`Round ${Math.min(this.round, ROUNDS)}/${ROUNDS} · ⏱ ${Math.ceil(Math.max(0, this.rt))}`); a.setRight(''); a.setScore(this.score); }

  /* ---------- input ---------- */
  readInput(dt, hands) {
    const a = this.app, now = performance.now() / 1000, s = a.pose.state; this.gloves = [];
    if (this.sim) {
      const ptr = hands.find(h => h.pointer);
      if (this.leanOverride !== undefined) this.lean = this.leanOverride;
      else if (ptr && ptr.palm.y > a.H * .62 && now - ptr.seen < .8) this.lean = clamp((ptr.palm.x - a.W / 2) / (a.W * .25), -1, 1) * .6; else this.lean = lerp(this.lean, 0, .2);
      return;
    }
    if (!(now - s.t < 1 && s.pts)) { this.noBody += dt; return; }
    const P = s.pts, vis = (i) => P[i] && (P[i].visibility ?? 1) > .3, m = (i) => a.mapPoint(P[i].x, P[i].y);
    if (!vis(11) || !vis(12)) { this.noBody += dt; return; }
    this.noBody = 0;
    const l = m(11), r = m(12), sw = Math.max(30, Math.hypot(l.x - r.x, l.y - r.y)), zpx = Math.abs(a.mapPoint(1, 0).x - a.mapPoint(0, 0).x), mid = (l.x + r.x) / 2;
    if (vis(0)) { const n = m(0); if (s.t !== this.lastPoseT) { const b = this.body.update(s.t, n.x, n.y, sw); this.lean = b.lean; this.duckN = b.duck; } }
    for (const i of [15, 16]) if (vis(i)) {
      const w = m(i), sh = i === 15 ? l : r, side = w.x < mid ? 'L' : 'R'; this.gloves.push({ x: w.x, y: w.y, side });
      if (s.t !== this.lastPoseT) { const pz = P[i].z * zpx, sz = P[i === 15 ? 11 : 12].z * zpx; const hit = this.det[i].push(s.t, { x: w.x, y: w.y, z: pz, sx: sh.x, sy: sh.y, sz, sw }); if (hit) this.pend.push({ side, power: hit.power, x: w.x, y: w.y }); }
    }
    this.lastPoseT = s.t;
  }

  /* ---------- update ---------- */
  update(dt, hands) {
    const a = this.app, ai = this.ai; this.t += dt;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5); this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.readInput(dt, hands);
    if (!this.sim && this.noBody > 1.2) a.hint("I can't see your shoulders! Step back so your head, arms and shoulders fit on screen. 🙋"); else if (this.state === 'round' && this.t > 8 && !this.sim) a.hint(null);
    if (this.state === 'ready') {
      this.cd -= dt; const n = Math.ceil(this.cd); if (n !== this.lastCd && n >= 1 && n <= 3) { this.lastCd = n; a.sfx.tick(); }
      if (this.cd <= 0) { this.state = 'round'; a.sfx.bell(); a.banner(`Round ${this.round} – FIGHT!`, 900); }
    } else if (this.state === 'round') {
      this.rt -= dt; if (Math.ceil(this.rt) !== this._rc) { this._rc = Math.ceil(this.rt); this.hud(); }
      this.stepAI(dt);
      for (const p of this.pend.splice(0)) this.punch(p);
      if (ai.hp <= 0 && ai.st !== 'ko') this.knockout();
      else if (this.php <= 0) { this.php = 0; this.finish(true); }
      else if (this.rt <= 0) this.endRound(false);
    } else if (this.state === 'between') { this.t2 -= dt; ai.ko = Math.max(0, ai.ko); if (this.t2 <= 0) this.nextRound(); }
    this.pend.length = 0;
    ai.hurt = Math.max(0, ai.hurt - dt); ai.open = Math.max(0, ai.open - dt); ai.guard = Math.max(0, ai.guard - dt);
    ai.glove.L = Math.max(0, ai.glove.L - dt * 4); ai.glove.R = Math.max(0, ai.glove.R - dt * 4);
  }
  stepAI(dt) {
    const ai = this.ai, a = this.app, R = this.round; if (ai.st === 'ko') return;
    ai.tgtT -= dt; if (ai.tgtT <= 0) { ai.tgt = ai.tgt === -1 ? (Math.random() < .5 ? 'L' : 'R') : (ai.tgt === 'L' ? 'R' : -1); ai.tgtT = ai.tgt === -1 ? .6 : 1.4; }
    if (ai.st === 'idle') {
      ai.next -= dt;
      if (ai.guard <= 0 && Math.random() < dt * .22 && ai.next > .8) ai.guard = rand(.8, 1.4);
      if (ai.next <= 0) { ai.st = 'wind'; ai.side = Math.random() < .5 ? -1 : 1; ai.t = Math.max(.55, .95 - .1 * R); ai.leanBest = 0; ai.guard = 0; a.sfx.whoosh(); }
    } else if (ai.st === 'wind') {
      ai.t -= dt; ai.leanBest = Math.max(ai.leanBest || 0, -ai.side * this.lean); if (ai.t <= 0) { ai.st = 'strike'; ai.t = .32; }
    } else if (ai.st === 'strike') {
      ai.t -= dt; this.leanBest = Math.max(this.leanBest || 0, -ai.side * this.lean); ai.leanBest = Math.max(ai.leanBest, -ai.side * this.lean);
      if (ai.t > .12 && ai.t < .2 && !ai.resolved) {
        ai.resolved = true;
        if (ai.leanBest > DODGE) { this.dodges++; this.score += 5; ai.open = 1.2; this.pop.add(a.W / 2, a.H * .3, 'DODGE! +5', '#7dffb0', Math.max(30, a.min * .07)); a.sfx.catch_(); this.crowd.excite = Math.min(1, this.crowd.excite + .3); }
        else { this.php -= 12 + 3 * R; this.hurtFlash = 1; a.sfx.ouch(); a.sfx.punch(); this.crowd.sad = 1.5; this.pop.add(a.W / 2, a.H * .62, 'OUCH!', '#ff8a8a', Math.max(30, a.min * .07)); }
        this.hud();
      }
      if (ai.t <= 0) { ai.st = 'idle'; ai.resolved = false; ai.next = Math.max(1.2, rand(2.2, 3.4) - .4 * (R - 1)); ai.glove[ai.side < 0 ? 'L' : 'R'] = 1; }
    }
  }
  punch(p) {
    const a = this.app, ai = this.ai; if (ai.st === 'ko') return;
    let dmg = 5 + 6 * p.power, txt = 'POW!', col = '#ffe45e';
    if (ai.guard > 0) { dmg *= .3; txt = 'blocked'; col = '#cfd8ff'; a.sfx.block(); }
    else {
      a.sfx.punch(); if (ai.open > 0) { dmg *= 1.5; txt = 'COUNTER!'; }
      if (ai.tgt === p.side) { dmg += 6; txt = 'CRIT!'; col = '#ff9f1c'; ai.tgt = -1; ai.tgtT = .7; }
      if (ai.st === 'wind') { ai.st = 'idle'; ai.next = 1.6; ai.t = 0; this.pop.add(a.W / 2, a.H * .3, 'Interrupted!', '#7dffb0', a.min * .06); }
      ai.hurt = .35; this.crowd.excite = Math.min(1, this.crowd.excite + .15);
    }
    ai.hp = Math.max(0, ai.hp - dmg); this.landed++; this.score += Math.round(dmg); this.hud(); ai.glove[p.side] = 1;
    const bx = a.W / 2 + (p.side === 'L' ? -1 : 1) * a.min * .08, by = a.H * .42; this.pop.add(bx, by, txt, col, Math.max(28, a.min * .06)); this.fx.burst(bx, by, 50, 10, 280, 6);
  }
  knockout() {
    const a = this.app, ai = this.ai; ai.st = 'ko'; ai.ko = 0; this.kos++; this.score += 50 + Math.ceil(this.rt) * 2; a.banner('K.O.! 🥊💥', 1400); a.sfx.crowdCheer(1); a.sfx.cheer(); this.fx.confetti(a.W / 2, a.H * .4, 80); this.hud();
    this.endRound(true);
  }
  endRound(ko) {
    const a = this.app; this.state = 'between'; this.t2 = ko ? 2.4 : 1.8; if (!ko) { a.banner('Time! 🔔', 1000); a.sfx.bell(); }
    if (this.round >= ROUNDS) { setTimeout(() => this.finish(false), 1700); this.t2 = 99; }
  }
  nextRound() {
    const a = this.app, ai = this.ai; this.round++; this.rt = ROUND_T; this.php = Math.min(100, this.php + 30); Object.assign(ai, { hp: 100, st: 'idle', next: 2, guard: 0, open: 0, hurt: 0, resolved: false });
    this.state = 'ready'; this.cd = 2.2; this.lastCd = 4; this.hud();
  }
  finish(lost) {
    const a = this.app; if (this.over) return; this.over = true; a.hint(null); this.state = 'over'; a.sfx.crowdCheer(.8); setTimeout(() => a.sfx.crowdStop(), 2400);
    if (lost) a.banner('Knocked out! 😵', 1300); else this.score += Math.round(this.php);
    setTimeout(() => { if (a.game === this) a.showResult({ title: lost ? 'Down but not out!' : this.kos >= 2 ? 'Champion!' : 'Good fight!', emoji: lost ? '😵' : this.kos >= 2 ? '🏆' : '🥊', score: this.score, stats: [['Punches landed', this.landed], ['Dodges', this.dodges], ['K.O.s', this.kos]] }); }, 1400);
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H, min } = a, ai = this.ai, port = W < H, hy = H * .3, v = { W, H, hy };
    let g = ctx.createLinearGradient(0, 0, 0, hy); g.addColorStop(0, '#12082f'); g.addColorStop(1, '#2d1f66'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 2);
    this.crowd.draw(ctx, v);
    g = ctx.createLinearGradient(0, hy, 0, H); g.addColorStop(0, '#24408f'); g.addColorStop(1, '#3d6bd6'); ctx.fillStyle = g; ctx.fillRect(0, hy, W, H - hy);
    // ring: ropes + posts + apron
    const ry = hy + (H - hy) * .08; ctx.fillStyle = '#c8102e'; ctx.fillRect(0, hy - 2, W, 4);
    for (let i = 0; i < 3; i++) { const y = hy + (H - hy) * (.02 + i * .1); ctx.strokeStyle = ['#ff4f5e', '#fff', '#4f8bff'][i]; ctx.lineWidth = Math.max(3, min * .008); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (const x of [W * .06, W * .94]) { ctx.fillStyle = '#9aa0b8'; ctx.fillRect(x - 6, hy - 10, 12, (H - hy) * .35); }
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; for (let i = 1; i < 6; i++) { const y = hy + (H - hy) * (.3 + i * .14); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    this.drawBoxer(ctx, W / 2, H * .86, Math.min(H * .6, W * .8));
    this.drawBars(ctx, port);
    // player's gloves
    if (!this.sim) for (const gl of this.gloves) this.drawGlove(ctx, gl.x, gl.y, min * .055, '#ff3b4a', 0);
    if (this.state === 'round' || this.state === 'ready') this.drawLean(ctx);
    if (ai.st === 'wind') { const sx = W / 2 + ai.side * W * .22; ctx.save(); ctx.globalAlpha = .55 + .35 * Math.sin(this.t * 18); ctx.fillStyle = '#ff2d3d'; ctx.beginPath(); ctx.moveTo(W / 2 - ai.side * min * .1, H * .56); ctx.lineTo(W / 2 - ai.side * min * .28, H * .56 - min * .08); ctx.lineTo(W / 2 - ai.side * min * .28, H * .56 + min * .08); ctx.closePath(); ctx.fill(); ctx.restore(); bigText(ctx, ai.side < 0 ? 'LEAN RIGHT ➡' : '⬅ LEAN LEFT', W / 2, H * (port ? .16 + .14 : .2), min * .065, '#ff9a9a'); }
    if (this.state === 'ready') { const n = Math.ceil(this.cd); bigText(ctx, n >= 1 && n <= 3 ? String(n) : 'FIGHT!', W / 2, H * .45, min * .3); }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.hurtFlash > 0) { ctx.fillStyle = `rgba(255,0,20,${this.hurtFlash * .3})`; ctx.fillRect(0, 0, W, H); const vg = ctx.createRadialGradient(W / 2, H / 2, min * .3, W / 2, H / 2, Math.max(W, H) * .7); vg.addColorStop(0, 'rgba(255,0,0,0)'); vg.addColorStop(1, `rgba(255,0,0,${this.hurtFlash * .5})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); }
  }
  drawBars(ctx, port) {
    const { W } = this.app, y = port ? 150 : 74, bw = Math.min(W * .4, 320), h = 22, ai = this.ai;
    const bar = (x, frac, col, label, right) => { ctx.fillStyle = 'rgba(15,10,50,.8)'; ctx.fillRect(x - 3, y - 3, bw + 6, h + 6); ctx.fillStyle = col; const w = bw * clamp(frac, 0, 1); ctx.fillRect(right ? x + bw - w : x, y, w, h); ctx.fillStyle = '#fff'; ctx.font = '900 14px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = right ? 'right' : 'left'; ctx.fillText(label, right ? x + bw - 8 : x + 8, y + h / 2); };
    bar(10, this.php / 100, this.php > 35 ? '#3ddc84' : '#ff5252', 'YOU', false); bar(W - bw - 10, ai.hp / 100, '#ffb02e', 'BOXER', true);
  }
  drawLean(ctx) {
    const { W, H, min } = this.app, y = H * .94, x = W / 2 + clamp(this.lean / .6, -1.4, 1.4) * W * .2;
    ctx.save(); ctx.fillStyle = 'rgba(15,10,50,.55)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W * .2, y - 14, W * .6, 28, 14) : ctx.rect(W * .2, y - 14, W * .6, 28); ctx.fill();
    ctx.fillStyle = 'rgba(125,255,176,.35)'; ctx.fillRect(W / 2 - W * .2 * (DODGE / .6) * 1, y - 10, 2, 20); ctx.fillRect(W / 2 + W * .2 * (DODGE / .6), y - 10, 2, 20);
    ctx.fillStyle = Math.abs(this.lean) > DODGE ? '#7dffb0' : '#fff'; ctx.beginPath(); ctx.arc(x, y, 12, 0, 6.3); ctx.fill(); ctx.restore();
  }
  drawGlove(ctx, x, y, r, col, rot, glow = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    if (glow > 0) { ctx.shadowColor = '#ff2d3d'; ctx.shadowBlur = 30 * glow; }
    const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r); g.addColorStop(0, '#ff9aa4'); g.addColorStop(.5, col); g.addColorStop(1, '#7a0f1a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-r * .6, r * .7, r * 1.2, r * .5); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.ellipse(-r * .35, -r * .4, r * .25, r * .14, -.6, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  drawBoxer(ctx, cx, fy, h) {
    const ai = this.ai, t = this.t, sway = Math.sin(t * 2.2) * h * .025, hurt = ai.hurt > 0 ? Math.sin(ai.hurt * 40) * h * .02 : 0, ko = ai.st === 'ko';
    const lean = ai.st === 'wind' ? -ai.side * h * .06 * Math.min(1, 1 - ai.t / .9 + .4) : 0, x = cx + sway + hurt + lean, fall = ko ? Math.min(1, (ai.ko += .02)) : 0;
    ctx.save(); ctx.translate(x, fy); ctx.rotate(fall * 1.45 * (this.ai.side || 1)); ctx.translate(0, fall * h * .12);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, h * .3, h * .05, 0, 0, 6.3); ctx.fill();
    const skin = ai.hurt > 0 ? '#ffb09a' : '#c98c64';
    ctx.strokeStyle = '#d9a37a'; ctx.lineCap = 'round'; ctx.lineWidth = h * .075; ctx.beginPath(); ctx.moveTo(-h * .07, -h * .42); ctx.lineTo(-h * .08, -h * .02); ctx.moveTo(h * .07, -h * .42); ctx.lineTo(h * .08, -h * .02); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(-h * .13, -h * .06, h * .1, h * .06); ctx.fillRect(h * .03, -h * .06, h * .1, h * .06);
    ctx.fillStyle = '#1c3fb0'; ctx.beginPath(); ctx.moveTo(-h * .15, -h * .52); ctx.lineTo(h * .15, -h * .52); ctx.lineTo(h * .17, -h * .33); ctx.lineTo(-h * .17, -h * .33); ctx.fill(); ctx.fillStyle = '#ffd23f'; ctx.fillRect(-h * .15, -h * .52, h * .3, h * .03);
    const tg = ctx.createLinearGradient(-h * .17, 0, h * .17, 0); tg.addColorStop(0, '#e0a37a'); tg.addColorStop(1, '#a8714c'); ctx.fillStyle = tg;
    ctx.beginPath(); ctx.moveTo(-h * .2, -h * .84); ctx.quadraticCurveTo(-h * .25, -h * .6, -h * .15, -h * .5); ctx.lineTo(h * .15, -h * .5); ctx.quadraticCurveTo(h * .25, -h * .6, h * .2, -h * .84); ctx.quadraticCurveTo(0, -h * .9, -h * .2, -h * .84); ctx.fill();
    const hx = 0, hyy = -h * .96 + (ai.hurt > 0 ? -h * .02 : 0), hr = h * .1; ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(hx, hyy, hr * .95, hr * 1.15, ko ? .2 : 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(hx, hyy - hr * .85, hr * 1.0, hr * .45, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#e63946'; ctx.fillRect(hx - hr, hyy - hr * .5, hr * 2, hr * .22);
    ctx.fillStyle = ai.hurt > 0 || ko ? '#fff' : '#111'; ctx.font = `900 ${hr * .6}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if (ai.hurt > 0 || ko) { ctx.fillText('x   x', hx, hyy); } else { ctx.beginPath(); ctx.arc(hx - hr * .38, hyy, hr * .11, 0, 6.3); ctx.arc(hx + hr * .38, hyy, hr * .11, 0, 6.3); ctx.fill(); }
    ctx.strokeStyle = '#7a2a2a'; ctx.lineWidth = hr * .1; ctx.beginPath(); if (ai.st === 'wind' || ai.st === 'strike') { ctx.arc(hx, hyy + hr * .55, hr * .22, Math.PI, 0); } else ctx.arc(hx, hyy + hr * .5, hr * .25, 0, Math.PI); ctx.stroke();
    // gloves
    const gr = h * .105, chestY = -h * .72;
    let L = { x: -h * .27, y: chestY + Math.sin(t * 4) * h * .01 }, R = { x: h * .27, y: chestY + Math.cos(t * 4) * h * .01 }, sc = { L: 1, R: 1 }, glow = { L: 0, R: 0 };
    if (ai.guard > 0) { L = { x: -h * .1, y: -h * .93 }; R = { x: h * .1, y: -h * .93 }; }
    if (ai.st === 'wind') { const k = Math.min(1, 1 - ai.t / .9 + .3), G = ai.side < 0 ? L : R; G.x = ai.side * h * (.34 + .1 * k); G.y = -h * .62 + h * .08 * k; glow[ai.side < 0 ? 'L' : 'R'] = 1; sc[ai.side < 0 ? 'L' : 'R'] = 1.15; }
    if (ai.st === 'strike') { const G = ai.side < 0 ? L : R, u = 1 - ai.t / .32; G.x = lerp(ai.side * h * .38, -ai.side * h * .05, u); G.y = lerp(-h * .62, -h * .55, u); sc[ai.side < 0 ? 'L' : 'R'] = 1 + 1.6 * u; glow[ai.side < 0 ? 'L' : 'R'] = .6; }
    if (ko) { L.y += h * .2; R.y += h * .2; }
    for (const [k, G] of [['L', L], ['R', R]]) { ctx.strokeStyle = '#d9a37a'; ctx.lineWidth = h * .06; ctx.beginPath(); ctx.moveTo(k === 'L' ? -h * .2 : h * .2, -h * .8); ctx.lineTo(G.x, G.y); ctx.stroke(); }
    for (const [k, G] of [['L', L], ['R', R]]) this.drawGlove(ctx, G.x, G.y, gr * sc[k] * (1 + ai.glove[k] * .25), '#2f6bff', 0, glow[k]);
    // weak-spot target
    if (ai.tgt !== -1 && !ko && this.state === 'round') { const tx = (ai.tgt === 'L' ? -1 : 1) * h * .13, ty = h * -.68, pu = .8 + .2 * Math.sin(t * 12); ctx.strokeStyle = '#ffe45e'; ctx.lineWidth = 4; ctx.shadowColor = '#ffe45e'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(tx, ty, h * .06 * pu, 0, 6.3); ctx.stroke(); ctx.beginPath(); ctx.arc(tx, ty, h * .02, 0, 6.3); ctx.fillStyle = '#ffe45e'; ctx.fill(); ctx.shadowBlur = 0; }
    ctx.restore();
  }
}
