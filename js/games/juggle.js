import { Particles, Popups, bigText, drawBall, rand, pick, clamp, dist, HUES, drawHeartsText } from '../util.js?v=23';

const CFG = {
  easy: { lives: 5, g: .85, fall0: .16, throwV: .92, autoHold: .7, holdLimit: null, maxBalls: 3, ramp: 10, flickV: 1.0, label: 'Learning' },
  pro:  { lives: 3, g: 1.25, fall0: .22, throwV: 1.12, autoHold: null, holdLimit: 2.0, maxBalls: 5, ramp: 8, flickV: 1.25, label: 'Juggler' },
  uni:  { lives: 3, g: 1.0, fall0: .2, throwV: 1.0, autoHold: 1.1, holdLimit: null, maxBalls: 4, ramp: 8, flickV: 1.15, label: 'Unicycle' },
};
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

export class JuggleGame {
  constructor(app) { this.app = app; }
  start(opts = {}) {
    const a = this.app; this.mode = opts.mode === 'pro' ? 'pro' : opts.mode === 'uni' ? 'uni' : 'easy'; this.uni = this.mode === 'uni'; this.cfg = CFG[this.mode];
    this.score = 0; this.lives = this.cfg.lives; this.throws = 0; this.streak = 0; this.bestStreak = 0; this.flicks = 0;
    this.balls = []; this.over = false; this.countdown = 2.0; this.tipStage = 0; this.time = 0;
    this.fx = new Particles(); this.pop = new Popups(); this.held = new Map(); // handId -> ball
    this.hues = HUES.slice().sort(() => Math.random() - .5);
    this.addBall(); this.balls[0].wait = 2.0;
    a.setScoreLabel(this.uni ? 'Score' : 'Throws'); a.setLeft(this.uni ? '🛞 x1' : this.mode === 'easy' ? '🌱 Learning' : '🔥 Juggler'); a.setRight(drawHeartsText(this.lives, this.cfg.lives));
    if (this.uni) {
      this.countdown = 0; this.balls[0].wait = 999;
      this.bal = { phase: 'setup', stability: .6, tilt: 0, bothT: 0, balT: 0, mult: 1, maxMult: 1, fallT: 0, fallDir: 1, visibleT: 0, lostT: 0, readyT: 0, t: 0, wheel: 0, totalBal: 0, falls: 0, status: '', dropped: false, lifted: false };
      a.pose.enabled = !a.balanceSim; document.getElementById('simPanel').classList.toggle('hidden', !a.balanceSim);
      this.inp = a.getBalance();
    } else a.hint('Hold your hand open under the ball to catch it ✋');
  }
  ballR() { return clamp(this.app.min * .06, 24, 54); }
  addBall() {
    const { W } = this.app, r = this.ballR();
    this.balls.push({ x: rand(W * .25, W * .75), y: -r * 2, vx: 0, vy: this.cfg.fall0 * this.app.H, r, hue: this.hues[this.balls.length % this.hues.length], state: 'air', hand: null, holdT: 0, wait: 0, noCatch: 0, lost: 0, trail: [] });
  }
  handR(h) { return clamp(h.size * 1.0, this.app.min * .085, this.app.min * .16); }
  update(dt, hands) {
    const a = this.app, { W, H } = a, cfg = this.cfg;
    this.fx.update(dt); this.pop.update(dt);
    if (this.over) return;
    if (this.uni && !this.updateBalance(dt)) return;
    if (this.countdown > 0) { this.countdown -= dt; if (this.countdown <= 0) a.hint(null); }
    this.time += dt;
    const byId = new Map(hands.map(h => [h.id, h]));
    for (const b of this.balls) {
      if (b.wait > 0) { b.wait -= dt; if (b.wait <= 0) { b.x = rand(W * .25, W * .75); b.y = -b.r * 2; b.vx = 0; b.vy = cfg.fall0 * H; b.state = 'air'; } continue; }
      if (b.state === 'air') {
        b.vy += cfg.g * H * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.noCatch -= dt;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); } else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
        b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 8) b.trail.shift();
        // catch
        if (b.vy > 0 && b.y > -b.r && b.noCatch <= 0) {
          for (const h of hands) {
            if (this.held.has(h.id)) continue;
            const R = this.handR(h), cy = h.palm.y - R * .3;
            if (dist(b.x, b.y, h.palm.x, cy) < R + b.r * .75) { this.catchBall(b, h); break; }
          }
        }
        if (b.y > H + b.r * 1.5) this.dropBall(b, 'Missed!');
      } else if (b.state === 'held') {
        const h = byId.get(b.hand);
        if (!h) { b.lost += dt; if (b.lost > .4) { this.release(b, 0); } continue; }
        b.lost = 0; const R = this.handR(h);
        b.x += (h.palm.x - b.x) * Math.min(1, dt * 20); b.y += (h.palm.y - R * .45 - b.y) * Math.min(1, dt * 20);
        b.holdT += dt;
        if (b.holdT > .12 && h.vel.y < -cfg.flickV) this.throwBall(b, h, true);
        else if (cfg.autoHold && b.holdT > cfg.autoHold) this.throwBall(b, h, false);
        else if (cfg.holdLimit && b.holdT > cfg.holdLimit) { this.release(b, .15); b.noCatch = .7; this.loseLife(b, 'Too slow!'); }
      }
    }
    if (this.countdown <= 0 && this.tipStage === 0 && this.held.size) { this.tipStage = 1; a.hint(this.mode === 'easy' ? 'Nice! It will toss itself — or flick your hand UP 👆' : 'Flick your hand UP quickly to throw! 👆'); setTimeout(() => { if (a.game === this && this.tipStage === 1) { this.tipStage = 2; a.hint(null); } }, 4500); }
    if (this.countdown <= 0 && this.tipStage < 2 && !hands.length && this.time > 5) a.hint('Show your hand to the camera ✋');
  }
  catchBall(b, h) {
    b.state = 'held'; b.hand = h.id; b.holdT = 0; b.lost = 0; this.held.set(h.id, b);
    this.app.sfx.catch_(); this.fx.burst(b.x, b.y, b.hue, 8, 200, 5);
  }
  release(b, vyFrac) { if (b.hand !== null) this.held.delete(b.hand); b.hand = null; b.state = 'air'; b.vy = vyFrac * this.app.H; b.vx = 0; b.noCatch = .35; }
  throwBall(b, h, flick) {
    const a = this.app, { W, H } = a, cfg = this.cfg;
    const sp = flick ? clamp(.95 + (Math.abs(h.vel.y) - cfg.flickV) * .22, .95, 1.35) : 1;
    const v0 = cfg.throwV * H * sp, T = 2 * v0 / (cfg.g * H); // time to return to launch height
    const tx = rand(W * .18, W * .82);
    this.held.delete(b.hand); b.hand = null; b.state = 'air'; b.vy = -v0; b.vx = clamp((tx - b.x) / T, -W * .5, W * .5); b.noCatch = .3; b.holdT = 0;
    this.throws++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak);
    const pts = (flick ? 2 : 1) * (this.uni ? this.bal.mult : 1); this.score += pts; if (flick) this.flicks++;
    a.setScore(this.score);
    this.pop.add(b.x, b.y - b.r * 1.5, flick ? 'FLICK! +' + pts : '+' + pts, flick ? '#7dffb0' : '#fff', flick ? 40 : 32);
    this.fx.burst(b.x, b.y, b.hue, 10, 260, 6);
    a.sfx[flick ? 'flick' : 'toss']();
    if (this.tipStage === 1) { this.tipStage = 2; a.hint(null); }
    if (this.throws % cfg.ramp === 0 && this.balls.length < cfg.maxBalls) { this.addBall(); a.banner('Another ball!<small>Keep going!</small>', 1100); a.sfx.cheer(); }
  }
  dropBall(b, msg) {
    b.state = 'air'; b.wait = 1.0; b.y = -b.r * 3; b.vy = 0; b.vx = 0; b.trail = [];
    this.loseLife(b, msg, true);
  }
  loseLife(b, msg, atBottom) {
    const a = this.app; this.lives--; this.streak = 0;
    a.setRight(drawHeartsText(this.lives, this.cfg.lives)); a.sfx.miss();
    this.pop.add(clamp(b.x, 80, a.W - 80), atBottom ? a.H - 90 : b.y - b.r * 2, msg, '#ff8a8a', 38);
    if (this.lives <= 0) this.finish();
  }
  destroy() { this.app.pose.enabled = false; document.getElementById('simPanel').classList.add('hidden'); }
  /* ---------- unicycle balance ---------- */
  updateBalance(dt) {
    const a = this.app, B = this.bal, inp = this.inp = a.getBalance();
    B.wheel += dt * (B.phase === 'play' ? 1.6 : .2);
    const stepTilt = (penalize) => {
      B.t += dt;
      const sway = inp.swayN, eff = Math.sign(sway) * Math.max(0, Math.abs(sway) - .3) / .9, lifted = inp.lifted;
      B.lifted = lifted; B.eff = eff;
      const target = lifted ? clampN(eff, -1.3, 1.3) * .8 : Math.sin(B.t * 2.3) * (.15 + .25 * Math.min(1, B.bothT / 2));
      B.tilt += (target - B.tilt) * (1 - Math.exp(-dt * 6)); B.tilt += Math.sin(B.t * 1.7) * .004;
      B.tilt = clampN(B.tilt, -1.1, 1.1);
      if (!penalize) return;
      if (lifted) {
        B.bothT = 0; B.dropped = false; const tooFar = Math.abs(eff) > .8;
        B.stability += dt * (tooFar ? -.45 : .22);
        if (!tooFar && B.stability > .35) { B.balT += dt; B.totalBal += dt; if (B.balT >= 7) { B.balT = 0; if (B.mult < 5) { B.mult++; B.maxMult = Math.max(B.maxMult, B.mult); a.setLeft('🛞 x' + B.mult); a.banner(`x${B.mult} bonus!<small>Nice balance!</small>`, 1000); a.sfx.cheer(); } } }
        B.status = tooFar ? `Lean back to center ${eff > 0 ? '⬅' : '➡'}` : 'Balanced! ✨';
      } else {
        B.bothT += dt;
        if (B.bothT > .7) B.stability -= dt * (.15 + .15 * Math.min(B.bothT - .7, 3));
        if (B.bothT > 1.5 && !B.dropped) { B.dropped = true; B.balT = 0; if (B.mult > 1) { B.mult--; a.setLeft('🛞 x' + B.mult); } }
        B.status = B.bothT > .7 ? 'Wobbling! Lift a foot! 🦶' : 'Lift one foot 🦶';
      }
      B.stability = clampN(B.stability, 0, 1);
      if (B.stability <= 0) this.fall();
    };
    if (B.phase === 'setup') {
      B.visibleT = inp.visible ? B.visibleT + dt : 0; stepTilt(false);
      a.hint(inp.visible ? (inp.sim ? 'Use “Foot up” and Sway to balance. Starting…' : 'I can see you! Hold still… ✨') : 'Step back so your whole body is visible, head to toes 🧍');
      if (B.visibleT >= 1.0) { B.phase = 'ready'; B.readyT = 2.2; a.sfx.go(); }
      return false;
    }
    if (B.phase === 'ready') {
      stepTilt(false); B.readyT -= dt; a.hint(B.readyT > 1 ? 'Lift one foot to balance! 🦶' : 'Get ready to juggle! 🤹');
      if (B.readyT <= 0) { B.phase = 'play'; a.hint(null); a.banner('GO!', 600); for (const b of this.balls) if (b.wait > 100) b.wait = .4; this.tipStage = 2; }
      return false;
    }
    if (B.phase === 'fall') {
      B.fallT -= dt; if (B.fallT <= 0) { if (this.lives <= 0) { this.finish(); } else { B.phase = 'ready'; B.readyT = 2.0; B.stability = .6; B.tilt = 0; B.bothT = 0; } }
      return false;
    }
    if (B.phase === 'lost') {
      B.visibleT = inp.visible ? B.visibleT + dt : 0; stepTilt(false); a.hint('I can’t see your whole body — step back so you’re visible head to toes 🧍');
      if (B.visibleT >= .5) { B.phase = 'ready'; B.readyT = 1.4; }
      return false;
    }
    // play
    if (!inp.visible) { B.lostT += dt; if (B.lostT > .8) { B.phase = 'lost'; B.visibleT = 0; } stepTilt(false); return B.lostT <= .8; }
    B.lostT = 0; stepTilt(true);
    return B.phase === 'play';
  }
  fall() {
    const a = this.app, B = this.bal;
    B.phase = 'fall'; B.fallT = 1.9; B.fallDir = Math.sign(B.tilt) || 1; this.lives--; this.streak = 0; B.mult = 1; B.balT = 0; B.falls++;
    a.setLeft('🛞 x1'); a.setRight(drawHeartsText(this.lives, this.cfg.lives)); a.sfx.miss();
    a.banner('Whoa!<small>' + (this.lives > 0 ? 'Lift a foot to get back on' : 'You fell off!') + '</small>', 1400);
  }
  finish() {
    this.over = true; const a = this.app; this.destroy();
    a.banner('Game over', 1200);
    setTimeout(() => { if (a.game === this) a.showResult({ title: this.score >= 25 ? 'Awesome juggling!' : 'Good try!', emoji: this.score >= 25 ? '🤹' : '👏', score: this.score, bestKey: '_' + this.mode, stats: this.uni ? [['Mode', 'Unicycle'], ['Best multiplier', 'x' + this.bal.maxMult], ['Balanced', Math.round(this.bal.totalBal) + 's'], ['Falls', this.bal.falls]] : [['Mode', this.cfg.label], ['Catches in a row', this.bestStreak], ['Flicks', this.flicks]] }); }, 1300);
  }
  draw(ctx) {
    const a = this.app, { W, H } = a, cfg = this.cfg;
    if (this.uni) this.drawUni(ctx);
    // catch circles
    for (const h of a.hands) {
      const R = this.handR(h), cy = h.palm.y - R * .3, hold = this.held.get(h.id);
      ctx.save();
      const g = ctx.createRadialGradient(h.palm.x, cy, R * .2, h.palm.x, cy, R);
      g.addColorStop(0, 'rgba(255,255,255,.05)'); g.addColorStop(1, hold ? 'rgba(125,255,176,.5)' : 'rgba(255,255,255,.35)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.palm.x, cy, R, 0, 6.3); ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = hold ? '#7dffb0' : '#fff'; ctx.setLineDash(hold ? [] : [10, 8]); ctx.stroke();
      ctx.restore();
    }
    for (const b of this.balls) {
      if (b.wait > 0) continue;
      if (b.state === 'air' && b.trail.length > 1) { for (let i = 0; i < b.trail.length - 1; i++) { ctx.globalAlpha = i / b.trail.length * .25; ctx.fillStyle = `hsl(${b.hue},90%,60%)`; ctx.beginPath(); ctx.arc(b.trail[i].x, b.trail[i].y, b.r * (.4 + i / b.trail.length * .5), 0, 6.3); ctx.fill(); } ctx.globalAlpha = 1; }
      drawBall(ctx, b.x, b.y, b.r, b.hue);
      if (b.state === 'held') {
        const lim = cfg.autoHold || cfg.holdLimit, p = clamp(b.holdT / lim, 0, 1), danger = cfg.holdLimit && p > .65;
        ctx.save(); ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.strokeStyle = danger ? '#ff5a5a' : '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 10, -Math.PI / 2, -Math.PI / 2 + p * 6.283); ctx.stroke(); ctx.restore();
        if (cfg.holdLimit && b.holdT > .3) { ctx.fillStyle = danger ? '#ff5a5a' : '#fff'; ctx.font = '900 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText('⬆ flick!', b.x, b.y - b.r - 24); }
      } else if (b.y < -b.r) { // off-screen marker
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); const x = clamp(b.x, 20, W - 20); ctx.moveTo(x, 8); ctx.lineTo(x - 14, 30); ctx.lineTo(x + 14, 30); ctx.fill();
      }
    }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.countdown > 0) bigText(ctx, 'Get ready!', W / 2, H * .35, a.min * .13);
    if (this.uni && this.bal.phase === 'ready' && this.bal.readyT < 2.2 && this.bal.readyT > 0) bigText(ctx, String(Math.ceil(this.bal.readyT)), W / 2, H * .3, a.min * .22);
  }
  drawUni(ctx) {
    const a = this.app, { W, H } = a, B = this.bal, inp = this.inp || { visible: true };
    const u = Math.min(a.min * .34, H * .3), R = u * .3, gy = H - 12;
    // body-pose overlay (legs/torso) so the player sees what the camera sees
    if (inp.pts && !inp.sim) {
      const P = inp.pts, M = (i) => a.mapPoint(P[i].x, P[i].y), segs = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28]];
      ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(4, a.min * .01); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.beginPath();
      for (const [i, j] of segs) { const p = M(i), q = M(j); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } ctx.stroke();
      const hi = P[27].y < P[28].y ? 27 : 28, lo = hi === 27 ? 28 : 27, ph = M(hi), pl = M(lo);
      ctx.fillStyle = B.lifted ? '#7dffb0' : '#ffd23f'; ctx.beginPath(); ctx.arc(ph.x, ph.y, a.min * .018, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pl.x, pl.y, a.min * .014, 0, 6.3); ctx.fill(); ctx.restore();
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(W / 2, gy, R * 1.2, R * .22, 0, 0, 6.3); ctx.fill();
    let ang = B.tilt * .45, ox = 0, oy = 0, k = 0;
    if (B.phase === 'fall') { k = 1 - B.fallT / 1.9; ang += B.fallDir * Math.min(1, k * 1.6) * 1.45; ox = B.fallDir * Math.min(1, k * 1.6) * u * .8; oy = -Math.sin(Math.min(1, k * 2.2) * Math.PI) * u * .35; }
    ctx.save(); ctx.translate(W / 2 + ox, gy + oy); ctx.rotate(ang); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // wheel
    ctx.strokeStyle = '#222'; ctx.lineWidth = R * .26; ctx.beginPath(); ctx.arc(0, -R, R, 0, 6.3); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = R * .08; ctx.beginPath(); ctx.arc(0, -R, R * .82, 0, 6.3); ctx.stroke();
    ctx.lineWidth = R * .05; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const t = B.wheel * 3 + i * Math.PI / 4; ctx.moveTo(0, -R); ctx.lineTo(Math.cos(t) * R * .82, -R + Math.sin(t) * R * .82); } ctx.stroke();
    const seatY = -2 * R - u * .12;
    // legs & pedals
    const cr = u * .07, sp = B.wheel * 3, p1 = [Math.cos(sp) * cr, -R + Math.sin(sp) * cr], p2 = [-Math.cos(sp) * cr, -R - Math.sin(sp) * cr];
    ctx.strokeStyle = '#3b2fb0'; ctx.lineWidth = u * .075; ctx.beginPath();
    for (const [p, hx] of [[p1, -u * .05], [p2, u * .05]]) { const mx = (hx + p[0]) / 2 + u * .07, my = (seatY + p[1]) / 2; ctx.moveTo(hx, seatY); ctx.lineTo(mx, my); ctx.lineTo(p[0], p[1]); } ctx.stroke();
    ctx.fillStyle = '#ff7a3d'; for (const p of [p1, p2]) { ctx.beginPath(); ctx.ellipse(p[0] + u * .02, p[1] + u * .01, u * .06, u * .035, 0, 0, 6.3); ctx.fill(); }
    // fork + seat
    ctx.strokeStyle = '#ff4f9a'; ctx.lineWidth = u * .045; ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(0, seatY + u * .03); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-u * .15, seatY - u * .02, u * .3, u * .05, u * .02) : ctx.rect(-u * .15, seatY - u * .02, u * .3, u * .05); ctx.fill();
    // torso
    const shY = seatY - u * .4, tl = Math.max(-.9, Math.min(.9, B.tilt));
    ctx.strokeStyle = '#35b6f0'; ctx.lineWidth = u * .2; ctx.beginPath(); ctx.moveTo(0, seatY - u * .03); ctx.lineTo(0, shY); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = u * .03; ctx.beginPath(); ctx.moveTo(-u * .08, seatY - u * .1); ctx.lineTo(u * .08, seatY - u * .1); ctx.stroke();
    // arms (seesaw with the wobble) holding little balls
    const wob = Math.sin(B.t * 6) * (B.phase === 'play' && !B.lifted ? .06 : .02);
    const hl = [-u * .4, shY + u * .02 - (tl + wob) * u * .2], hr = [u * .4, shY + u * .02 + (tl + wob) * u * .2];
    ctx.strokeStyle = '#f2b38b'; ctx.lineWidth = u * .06; ctx.beginPath(); ctx.moveTo(-u * .09, shY + u * .03); ctx.lineTo(...hl); ctx.moveTo(u * .09, shY + u * .03); ctx.lineTo(...hr); ctx.stroke();
    ctx.fillStyle = '#ffe45e'; ctx.beginPath(); ctx.arc(hl[0], hl[1] - u * .05, u * .045, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff6a8a'; ctx.beginPath(); ctx.arc(hr[0], hr[1] - u * .05, u * .045, 0, 6.3); ctx.fill();
    // head
    const hy2 = shY - u * .15, worried = !B.lifted && B.bothT > .5 || B.phase === 'fall';
    ctx.fillStyle = '#f2b38b'; ctx.beginPath(); ctx.arc(0, hy2, u * .13, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#9a4dff'; ctx.beginPath(); ctx.moveTo(-u * .14, hy2 - u * .07); ctx.lineTo(0, hy2 - u * .42); ctx.lineTo(u * .14, hy2 - u * .07); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, hy2 - u * .43, u * .035, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-u * .045, hy2 - u * .01, u * (worried ? .028 : .02), 0, 6.3); ctx.arc(u * .045, hy2 - u * .01, u * (worried ? .028 : .02), 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(0, hy2 + u * .02, u * .025, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#a02020'; ctx.lineWidth = u * .015; ctx.beginPath();
    if (worried) ctx.arc(0, hy2 + u * .08, u * .035, 0, 6.3); else ctx.arc(0, hy2 + u * .03, u * .06, .2, Math.PI - .2); ctx.stroke();
    if (B.phase === 'fall') { ctx.font = `${u * .25}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('💫', 0, hy2 - u * .5); }
    ctx.restore();
    // balance meter
    const bw = Math.min(W * .62, 340), mx = W / 2 - bw / 2, my = Math.max(90, gy - u * 1.72 - 50);
    ctx.save();
    ctx.fillStyle = 'rgba(20,10,80,.6)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(mx - 8, my - 34, bw + 16, 76, 16) : ctx.rect(mx - 8, my - 34, bw + 16, 76); ctx.fill();
    const zones = [[-1, '#ff5a5a'], [-.7, '#ffd23f'], [-.35, '#7dffb0'], [.35, '#ffd23f'], [.7, '#ff5a5a'], [1.01, null]];
    for (let i = 0; i < zones.length - 1; i++) { ctx.fillStyle = zones[i][1]; const x0 = mx + (zones[i][0] + 1) / 2 * bw, x1 = mx + (zones[i + 1][0] + 1) / 2 * bw; ctx.fillRect(x0, my, x1 - x0, 16); }
    const mk = mx + (Math.max(-1, Math.min(1, B.tilt)) + 1) / 2 * bw;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b2bb5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(mk, my - 4); ctx.lineTo(mk - 9, my - 16); ctx.lineTo(mk + 9, my - 16); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(mx, my + 24, bw, 8);
    ctx.fillStyle = B.stability > .5 ? '#7dffb0' : B.stability > .25 ? '#ffd23f' : '#ff5a5a'; ctx.fillRect(mx, my + 24, bw * B.stability, 8);
    ctx.font = '800 17px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(B.status || ' ', W / 2, my - 22);
    ctx.restore();
  }
}
