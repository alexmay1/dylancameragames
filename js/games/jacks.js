import { Particles, Popups, bigText, clamp } from '../util.js?v=23';
import { JackCounter, jackMetrics } from '../jackcount.js?v=23';

const GAME_TIME = 60;
const SEGS = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 15], [12, 16], [23, 27], [24, 28]];

export class JacksGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.counter = new JackCounter(); this.time = GAME_TIME; this.reps = 0; this.over = false; this.pulse = 0; this.lastSeen = 0; this.visT = 0; this.lostT = 0;
    this.phase = a.balanceSim ? 'count' : 'wait'; this.cd = 3.2; this.lastCd = 4; this.lastPoseT = -1; this.m = null;
    this.fx = new Particles(); this.pop = new Popups(); this.sim = !!a.balanceSim; this.flash = 0; this.rate = []; this.best10 = 0;
    a.pose.enabled = !this.sim;
    a.setScoreLabel('Jacks'); a.setScore(0); a.setLeft('⏱ 60'); a.setRight('');
    const tap = document.getElementById('jackTap');
    tap.classList.toggle('hidden', !this.sim);
    this.onTap = (e) => { e.preventDefault(); if (this.phase === 'play') this.rep(); };
    tap.addEventListener('pointerdown', this.onTap); this.tapEl = tap;
    this.onKey = (e) => { if (e.code === 'Space' && this.phase === 'play') { e.preventDefault(); this.rep(); } };
    if (this.sim) window.addEventListener('keydown', this.onKey);
    a.hint(this.sim ? 'Touch test mode: tap the big button to count a jumping jack!' : '🤸 Step back so your WHOLE body is visible, head to toes!');
  }
  destroy() {
    this.app.pose.enabled = false;
    if (this.tapEl) { this.tapEl.classList.add('hidden'); this.tapEl.removeEventListener('pointerdown', this.onTap); }
    window.removeEventListener('keydown', this.onKey);
  }
  rep(fromPose) {
    const a = this.app; this.reps++; this.pulse = 1; this.flash = .35; a.setScore(this.reps);
    a.sfx.pop(); if (this.reps % 5 === 0) a.sfx.gold ? a.sfx.gold() : a.sfx.cheer();
    this.pop.add(a.W / 2 + (Math.random() - .5) * a.W * .3, a.H * .45, '+1', '#7dffb0', Math.round(a.min * .09));
    this.fx.burst(a.W / 2, a.H * .38, 130 + (this.reps % 5) * 40, 18, 420, 8);
    if (this.reps % 10 === 0) { a.banner(`${this.reps} jacks!<small>Keep going! 💪</small>`, 900); this.fx.confetti(a.W / 2, a.H * .4, 40); a.sfx.cheer(); }
    this.rate.push(this.time);
  }
  pose() {
    const a = this.app, s = a.pose.state, fresh = performance.now() / 1000 - s.t < 1.0;
    return { visible: fresh && s.visible && s.pts && s.vw, pts: fresh ? s.pts : null, s };
  }
  update(dt, hands) {
    const a = this.app; this.fx.update(dt); this.pop.update(dt); this.pulse = Math.max(0, this.pulse - dt * 3); this.flash = Math.max(0, this.flash - dt);
    if (this.over) return;
    const P = this.sim ? { visible: true } : this.pose();
    this.P = P;
    if (!this.sim && P.pts && P.visible) {
      const m = jackMetrics(P.pts, P.s.vw, P.s.vh); this.m = m;
      if (P.s.t !== this.lastPoseT) { this.lastPoseT = P.s.t; if (this.phase === 'play' && this.counter.update(m, P.s.t) ) this.rep(true); else if (this.phase !== 'play') this.counter.update(m, P.s.t), this.counter.count = 0; }
    }
    if (this.phase === 'wait') {
      this.visT = P.visible ? this.visT + dt : 0;
      if (this.visT > .8) { this.phase = 'count'; this.cd = 3.2; this.counter.reset(); a.hint(null); }
    } else if (this.phase === 'count') {
      if (!P.visible) { this.phase = 'wait'; this.visT = 0; a.hint('🤸 Step back so your WHOLE body is visible, head to toes!'); return; }
      this.cd -= dt; const n = Math.ceil(this.cd);
      if (n !== this.lastCd && n > 0) { this.lastCd = n; a.sfx.tick(); }
      if (this.cd <= 0) { this.phase = 'play'; a.sfx.go(); a.banner('GO! Jumping jacks!', 700); this.counter.reset(); this.reps = 0; a.setScore(0); a.hint(null); }
    } else if (this.phase === 'play') {
      if (!P.visible) { this.lostT += dt; if (this.lostT > .5) a.hint("I can't see your whole body — step back a little! (timer paused)"); return; }
      if (this.lostT > 0) { this.lostT = 0; a.hint(null); }
      this.time -= dt; a.setLeft('⏱ ' + Math.max(0, Math.ceil(this.time)));
      if (this.time <= 0) this.finish();
    }
  }
  finish() {
    this.over = true; const a = this.app; a.setLeft('⏱ 0'); a.hint(null); a.banner("Time's up!", 1200); a.sfx.cheer();
    const r = this.reps;
    setTimeout(() => { if (a.game === this) a.showResult({ title: r >= 45 ? 'Super athlete!' : r >= 25 ? 'Great workout!' : 'Nice job!', emoji: r >= 45 ? '🏆' : '🤸', score: r, stats: [['Jumping jacks', r], ['Per minute', r]] }); }, 1300);
  }
  draw(ctx) {
    const a = this.app, { W, H, min } = a, P = this.P || {};
    // big count
    const size = min * (.34 + this.pulse * .08);
    ctx.save(); ctx.globalAlpha = this.phase === 'play' ? .9 : .5; bigText(ctx, String(this.reps), W / 2, H * .36, size, this.pulse > 0 ? '#7dffb0' : '#ffe45e'); ctx.restore();
    if (this.flash > 0) { ctx.fillStyle = `rgba(125,255,176,${this.flash * .35})`; ctx.fillRect(0, 0, W, H); }
    // skeleton
    if (P.pts && !this.sim) this.drawSkeleton(ctx, P.pts);
    // indicators
    const c = this.counter, y = H - Math.max(60, min * .12), w = Math.min(W * .44, 260), h = Math.max(38, min * .075);
    const chip = (x, label, on, color) => {
      ctx.fillStyle = on ? color : 'rgba(20,10,80,.7)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, h / 2) : ctx.rect(x, y, w, h); ctx.fill();
      ctx.fillStyle = on ? '#12084a' : '#fff'; ctx.font = `800 ${Math.round(h * .42)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + h / 2);
    };
    if (!this.sim) {
      chip(W / 2 - w - 6, c.armsUp ? '🙌 Arms UP' : '🙋 Arms down', c.armsUp, '#7dffb0');
      chip(W / 2 + 6, c.legsApart ? '🦵 Legs APART' : '🦶 Legs together', c.legsApart, '#7dffb0');
      // open/closed progress
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(W / 2 - w, y - 14, w * 2 + 12, 8);
      ctx.fillStyle = c.phase === 'up' ? '#7dffb0' : '#ffd23f'; ctx.fillRect(W / 2 - w, y - 14, (w * 2 + 12) * (c.phase === 'up' ? 1 : .5), 8);
    }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.phase === 'wait') this.drawWait(ctx);
    if (this.phase === 'count') bigText(ctx, String(Math.max(1, Math.ceil(this.cd - .2))), W / 2, H * .36, min * .4);
  }
  drawWait(ctx) {
    const a = this.app, { W, H, min } = a;
    // body outline guide
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.setLineDash([12, 10]); ctx.lineWidth = 4; ctx.lineCap = 'round';
    const cx = W / 2, top = H * .12, bot = H * .86, hh = bot - top;
    ctx.beginPath(); ctx.arc(cx, top + hh * .07, hh * .06, 0, 6.3); ctx.moveTo(cx, top + hh * .13); ctx.lineTo(cx, top + hh * .55); ctx.moveTo(cx - hh * .16, top + hh * .2); ctx.lineTo(cx + hh * .16, top + hh * .2);
    ctx.moveTo(cx, top + hh * .55); ctx.lineTo(cx - hh * .08, bot); ctx.moveTo(cx, top + hh * .55); ctx.lineTo(cx + hh * .08, bot); ctx.stroke(); ctx.restore();
    ctx.font = `900 ${Math.round(min * .055)}px system-ui`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b2bb5'; ctx.lineWidth = 6;
    const t = 'Step back — show your whole body!'; ctx.strokeText(t, W / 2, H * .5); ctx.fillText(t, W / 2, H * .5);
  }
  drawSkeleton(ctx, P) {
    const a = this.app, M = (i) => a.mapPoint(P[i].x, P[i].y), c = this.counter, r = Math.max(7, a.min * .02);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(5, a.min * .012); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath();
    for (const [i, j] of SEGS) { if (!P[i] || !P[j]) continue; const p = M(i), q = M(j); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } ctx.stroke();
    const dot = (i, on) => { if (!P[i]) return; const p = M(i); ctx.fillStyle = on ? '#7dffb0' : '#ffd23f'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.3); ctx.fill(); };
    dot(15, c.armsUp); dot(16, c.armsUp); dot(27, c.legsApart); dot(28, c.legsApart);
    if (P[0]) { const p = M(0); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.3, 0, 6.3); ctx.fill(); }
    ctx.restore();
  }
}
