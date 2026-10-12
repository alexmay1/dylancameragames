import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { ReleaseDetector } from '../gestures.js?v=23';

/* Hockey Shootout — swing your hand like a stick to shoot (or play goalie). 5 shots per round. */
export const GX = 1.7, GH = 1.3, SHOTS = 5, DSHOOT = 9;
/** From a stick swing -> where the puck is aimed in the goal plane (X metres, height metres) and flight time. */
export function aimShot(sw, W) {
  const dir = clamp(sw.dir ?? 0, -1, 1), dy = sw.vy !== undefined && sw.peak ? clamp(-sw.vy / (Math.hypot(sw.vx, sw.vy) || 1), -1, 1) : 0;
  return { X: clamp((sw.x - W / 2) / (W * .3), -1.3, 1.3) * GX * 1.1 + dir * .35, h: clamp(.25 + (dy + .15) * 1.3, .05, 1.6), T: .95 - .4 * sw.power };
}
/** Does the AI goalie (at gx, heading for guess) stop a shot to (X,h) arriving after T? */
export function goalieSaves(gx0, guess, X, h, T, react = .28, speed = 4.0) {
  const travel = clamp(guess - gx0, -speed * Math.max(0, T - react), speed * Math.max(0, T - react)), gx = gx0 + travel;
  if (Math.abs(X) > GX + .2 || h > GH + .1) return false;           // wide / over: no save needed
  const reach = .42 + (h < .5 ? .1 : 0) - (h > 1 ? .2 : 0);
  return Math.abs(gx - X) < reach;
}

export class HockeyGame {
  constructor(app) { this.app = app; }
  start(opts = {}) {
    const a = this.app; this.role = opts.role === 'goalie' ? 'goalie' : 'shoot'; this.sim = a.touchMode && !a.cameraOn;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd(); this.det = new ReleaseDetector({ hi: 1.15, drop: .55, cool: 1, max: 3.2 });
    this.t = 0; this.over = false; this.n = 0; this.goals = 0; this.saves = 0; this.misses = 0; this.puck = null; this.glove = { x: a.W / 2, y: a.H * .5 }; this.gk = { x: 0, lean: 0, guess: 0, plan: false }; this.flash = 0; this.lastHand = null; this.stick = { x: a.W / 2, y: a.H * .7, ang: 0 }; this.level = 0;
    a.sfx.crowdStart(.04); a.sfx.crowdLevel(.3, 1); a.setScoreLabel(this.role === 'shoot' ? 'Goals' : 'Saves'); a.setScore(0);
    const sw = document.getElementById('socSwitch'); this.swEl = sw; sw.classList.remove('hidden'); sw.textContent = this.role === 'shoot' ? '🔄 Switch to GOALIE 🥅' : '🔄 Switch to SHOOTER 🏒'; sw.onclick = () => a.startRole && a.startRole(this.role === 'shoot' ? 'goalie' : 'shoot');
    this.toReady(); this.hud();
  }
  destroy() { const a = this.app; a.sfx.crowdStop(); if (this.swEl) { this.swEl.classList.add('hidden'); this.swEl.onclick = null; } }
  hud() { const a = this.app; a.setLeft(`Shot ${Math.min(this.n + (this.state === 'result' ? 0 : 1), SHOTS)}/${SHOTS}`); a.setRight(this.role === 'shoot' ? '🏒 Shooter' : '🥅 Goalie'); a.setScore(this.role === 'shoot' ? this.goals : this.saves); }
  view() {
    const { W, H } = this.app, port = W < H, shoot = this.role === 'shoot';
    const K = shoot ? (port ? 1.8 : 1.34) * W : .7 * W, camH = shoot ? (port ? 1.2 : .9) : 1.0, hy = H * (port ? .42 : .3), off = shoot ? 12 : 3;
    return { W, H, cx: W / 2, hy, K, camH, off, shoot };
  }
  P(v, X, Z, h = 0) { const d = v.shoot ? v.off - Z : v.off + Z, s = v.K / Math.max(.4, d); return { x: v.cx + X * s, y: v.hy + (v.camH - h) * s, s, gy: v.hy + v.camH * s }; }

  toReady() {
    const a = this.app; this.state = 'ready'; this.sT = this.n === 0 ? 2.4 : 1.5; this.puck = null; this.det.reset(); this.gk = { x: 0, lean: 0, guess: 0, plan: false, t: 0, react: 0 }; this.x0 = rand(-2.5, 2.5); this.hud();
    this.windup = 0;
    a.hint(this.role === 'shoot' ? (this.sim ? '🏒 Swipe fast across the screen to shoot. Where you swipe aims it; swipe upward to lift it!' : '🏒 Swing your hand like a stick! Hand position aims. Swing UP to lift the puck.') : (this.sim ? '🥅 Drag your finger to move your glove and stop the puck!' : '🥅 Move your hand to move your glove — block the puck!'));
  }
  startShot(X, h, T, from = 0) {
    const a = this.app; this.state = 'shot'; this.shot = { X, h, T, t: 0, X0: this.role === 'shoot' ? 0 : this.x0, ...{ from } }; this.puck = { X: this.shot.X0, Z: DSHOOT, h: .05 }; a.hint(null);
    if (this.role === 'shoot') { const g = this.gk; g.guess = Math.random() < clamp(.3 + .04 * this.level, .3, .55) ? X + rand(-.25, .25) : (Math.random() < .5 ? -1 : 1) * rand(.4, 1.5); g.react = rand(.2, .36); g.t = 0; g.saved = goalieSaves(0, g.guess, X, h, T, g.react); }
    a.sfx.thwack(); this.fx.burst(a.W / 2, a.H * .8, 200, 10, 250, 5);
  }
  update(dt, hands) {
    const a = this.app, v = this.view(); this.t += dt; this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5);
    const hand = hands.find(h => !h.pointer) || hands[0]; if (hand) this.lastHand = hand; const h = hand || (this.lastHand && this.lastHand.pointer ? this.lastHand : null);
    if (h) { const k = 1 - Math.exp(-dt * 28); this.glove.x = lerp(this.glove.x, h.palm.x, k); this.glove.y = lerp(this.glove.y, h.palm.y, k); this.stick.x = this.glove.x; this.stick.y = clamp(this.glove.y, a.H * .4, a.H); this.stick.ang = lerp(this.stick.ang, clamp(h.vel.x * .5, -.9, .9), .3); }
    if (this.state === 'ready') {
      this.sT -= dt; if (this.sT <= 0) { this.state = 'aim'; this.aimT = 0; }
    } else if (this.state === 'aim') {
      this.aimT += dt;
      if (this.role === 'shoot') {
        if (h) { const r = this.det.push(this.t, { speed: h.speed, vx: h.vel.x, vy: h.vel.y, x: h.palm.x, y: h.palm.y }); if (r) { const s = aimShot({ ...r, peak: true }, a.W); this.startShot(s.X, s.h, s.T); } }
        if (this.aimT > 12) { this.startShot(rand(-.8, .8), .4, .85); }   // forgiving auto-shot
      } else {
        this.windup = Math.min(1, this.aimT / .8);
        if (this.aimT > .85) { const r = Math.random(); const X = r < .12 ? (Math.random() < .5 ? -1 : 1) * rand(GX + .3, GX + 1) : r < .35 ? rand(-.5, .5) : (Math.random() < .5 ? -1 : 1) * rand(.6, GX - .1); this.startShot(X, rand(.1, 1.15), clamp(rand(.9, 1.25) - .04 * this.level, .65, 1.3)); }
      }
    } else if (this.state === 'shot') {
      const s = this.shot, p = this.puck; s.t += dt; const k = clamp(s.t / s.T, 0, 1);
      p.X = lerp(s.X0, s.X, k); p.Z = lerp(DSHOOT, 0, k); p.h = lerp(.05, s.h, Math.pow(k, .8));
      if (this.role === 'shoot') { const g = this.gk; g.t += dt; const tt = Math.max(0, g.t - g.react), sp = 4.0, tgt = g.guess; g.x = clamp(g.x + clamp(tgt - g.x, -sp * dt, sp * dt) * (g.t > g.react ? 1 : 0), -2.6, 2.6); g.lean = lerp(g.lean, clamp((tgt - g.x) * .25, -.8, .8) * (g.t > g.react ? 1 : 0), .2); if (g.saved && k > .72) g.x = lerp(g.x, s.X, .35); }
      if (this.role === 'goalie' && p.Z < .7 && !s.done) { const pp = this.P(v, p.X, p.Z, p.h), r = Math.max(60, a.min * .13); if (Math.hypot(pp.x - this.glove.x, pp.y - this.glove.y) < r) { s.done = true; return this.resolve('save'); } }
      if (k >= 1 && !s.done) { s.done = true; const inside = Math.abs(s.X) < GX && s.h < GH; if (this.role === 'shoot') this.resolve(!inside ? 'wide' : this.gk.saved ? 'save' : 'goal'); else this.resolve(!inside ? 'wide' : 'goal'); }
    } else if (this.state === 'result') { this.sT -= dt; if (this.sT <= 0) { if (this.n >= SHOTS) return this.finish(); this.toReady(); } }
  }
  resolve(kind) {
    const a = this.app, v = this.view(); this.state = 'result'; this.sT = 1.8; this.n++; this.lastKind = kind; const pp = this.P(v, this.puck.X, this.puck.Z, this.puck.h), mine = this.role === 'shoot';
    if (kind === 'goal') { mine ? this.goals++ : 0; this.crowd.excite = 1; a.sfx.cheer(); a.sfx.crowdCheer(1); this.crowd.wave = 3; this.fx.confetti(a.W / 2, a.H * .35, 60, 700); this.flash = 1; a.banner(mine ? '🚨 GOAL! 🎉' : 'They scored 😬', 1400); if (!mine) { a.sfx.crowdGroan(); this.crowd.sad = 1; } else this.level++; }
    else if (kind === 'save') { !mine ? this.saves++ : this.misses++; a.sfx.block(); a.sfx.crowdCheer(.5); this.fx.burst(pp.x, pp.y, 50, 20, 300, 6); a.banner(mine ? '🧤 Saved by the goalie!' : '🧤 GREAT SAVE!', 1400); if (!mine) { this.crowd.excite = .8; this.level = Math.max(0, this.level); } else { a.sfx.crowdGroan(); this.crowd.sad = 1; } }
    else { this.misses++; a.sfx.miss(); a.banner(mine ? 'Just wide! 😬' : 'They missed! 😅', 1300); a.sfx.crowdGroan(); this.crowd.sad = 1; }
    this.hud();
  }
  finish() {
    const a = this.app; if (this.over) return; this.over = true; const mine = this.role === 'shoot', cnt = mine ? this.goals : this.saves, score = cnt * 20 + (cnt === SHOTS ? 20 : 0), other = mine ? 'goalie' : 'shoot';
    a.sfx.bell(); a.sfx.crowdCheer(cnt >= 3 ? 1 : .4); setTimeout(() => a.sfx.crowdStop(), 2200);
    a.showResult({ title: cnt === SHOTS ? 'PERFECT!' : cnt >= 3 ? (mine ? 'Great shooting!' : 'Great goalie!') : 'Good try!', emoji: cnt >= 3 ? '🏆' : '🏒', score, bestKey: mine ? '' : '_g', stats: [[mine ? 'Goals' : 'Saves', `${cnt}/${SHOTS}`]], switchTo: other, switchLabel: other === 'goalie' ? '🔄 Switch to GOALIE 🥅' : '🔄 Switch to SHOOTER 🏒' });
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view(), shoot = this.role === 'shoot';
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#171a4a'); g.addColorStop(1, '#343a86'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    this.crowd.draw(ctx, v);
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#d9ecf7'); g.addColorStop(1, '#bcdcf0'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([X, Z, h], i) => { const p = this.P(v, X, Z, h || 0); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    const zN = shoot ? DSHOOT + 2 : -1.5, zF = shoot ? -1.2 : DSHOOT + 6;     // near & far limits shown
    poly([[-7, zN, 0], [-7, zF, 0], [-7, zF, 1.1], [-7, zN, 1.1]], '#2c4d9a'); poly([[7, zN, 0], [7, zF, 0], [7, zF, 1.1], [7, zN, 1.1]], '#2c4d9a');
    ctx.strokeStyle = 'rgba(220,40,50,.85)'; ctx.lineWidth = Math.max(2, v.K * .004); const ln = (Z, c) => { const p0 = this.P(v, -7, Z), p1 = this.P(v, 7, Z); ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); };
    ln(0, 'rgba(220,40,50,.9)'); ln(DSHOOT + 3, 'rgba(60,110,220,.8)'); ln(DSHOOT - 4, 'rgba(60,110,220,.6)');
    const fc = this.P(v, 0, DSHOOT); ctx.strokeStyle = 'rgba(220,40,50,.55)'; ctx.beginPath(); ctx.ellipse(fc.x, fc.y, fc.s * 1.6, fc.s * .55, 0, 0, 6.3); ctx.stroke();
    if (shoot) { this.drawGoal(ctx, v, true); this.drawGoalie(ctx, v); this.drawPuck(ctx, v); this.drawStick(ctx, v); }
    else { this.drawShooter(ctx, v); this.drawPuck(ctx, v); this.drawGoal(ctx, v, false); this.drawGlove(ctx, v); }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.state === 'ready') bigText(ctx, this.sT > 1 ? 'READY' : 'GO!', W / 2, H * .45, min * .15);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .3})`; ctx.fillRect(0, 0, W, H); }
  }
  drawGoal(ctx, v, far) {
    const L = (X, Z, h) => this.P(v, X, Z, h), back = far ? -1 : -1; ctx.save();
    const a0 = L(-GX, 0, 0), a1 = L(-GX, 0, GH), b0 = L(GX, 0, 0), b1 = L(GX, 0, GH), c0 = L(-GX, back, 0), c1 = L(-GX, back, GH * .9), d0 = L(GX, back, 0), d1 = L(GX, back, GH * .9);
    if (far) { ctx.fillStyle = 'rgba(40,40,60,.35)'; ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(c1.x, c1.y); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i <= 12; i++) { const k = i / 12, x0 = lerp(a1.x, b1.x, k), y0 = lerp(a1.y, b1.y, k), x1 = lerp(c1.x, d1.x, k), y1 = lerp(c1.y, d1.y, k); ctx.moveTo(x0, y0); ctx.lineTo(far ? x1 : x0, far ? y1 : y0 + (a0.y - a1.y)); } ctx.stroke();
    if (!far) { ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(a1.x, a1.y, b1.x - a1.x, a0.y - a1.y); }
    ctx.strokeStyle = '#e03040'; ctx.lineWidth = Math.max(4, a0.s * .09); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b0.x, b0.y); ctx.stroke(); ctx.restore();
  }
  drawGoalie(ctx, v) {
    const g = this.gk, p = this.P(v, g.x, 0, 0), hh = 1.45 * p.s, lean = g.lean, open = this.state === 'shot' ? 1 : 0;
    ctx.save(); ctx.translate(p.x, p.gy); ctx.rotate(lean); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0, 0, hh * .35, hh * .06, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(-hh * .22, -hh * .5, hh * .16, hh * .5); ctx.fillRect(hh * .06, -hh * .5, hh * .16, hh * .5);
    ctx.fillStyle = '#2a5bd6'; ctx.fillRect(-hh * .24, -hh * .92, hh * .48, hh * .46); ctx.strokeStyle = '#2a5bd6'; ctx.lineWidth = hh * .09; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-hh * .22, -hh * .85); ctx.lineTo(-hh * (.45 + .25 * open), -hh * (.7 + .15 * open)); ctx.moveTo(hh * .22, -hh * .85); ctx.lineTo(hh * (.45 + .25 * open), -hh * (.7 + .15 * open)); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(-hh * (.47 + .25 * open), -hh * (.7 + .15 * open), hh * .09, 0, 6.3); ctx.fill(); ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.arc(0, -hh * 1.02, hh * .1, 0, 6.3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -hh * 1.05, hh * .115, Math.PI, 0); ctx.fill(); ctx.restore();
  }
  drawShooter(ctx, v) {
    const p = this.P(v, this.x0, DSHOOT + .4, 0), hh = 1.7 * p.s * 1.8, w = this.windup, strike = this.state === 'shot' && this.shot.t < .25 ? 1 : 0; ctx.save(); ctx.translate(p.x, p.gy); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0, 0, hh * .25, hh * .05, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineCap = 'round'; ctx.lineWidth = hh * .07; ctx.beginPath(); ctx.moveTo(-hh * .05, -hh * .45); ctx.lineTo(-hh * .08, 0); ctx.moveTo(hh * .05, -hh * .45); ctx.lineTo(hh * .08, 0); ctx.stroke();
    ctx.fillStyle = '#d33'; ctx.fillRect(-hh * .13, -hh * .85, hh * .26, hh * .42); ctx.fillStyle = '#e0ac84'; ctx.beginPath(); ctx.arc(0, -hh * .95, hh * .08, 0, 6.3); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, -hh * .98, hh * .09, Math.PI, 0); ctx.fill();
    const an = -.4 - w * 1.2 + strike * 2.2; ctx.strokeStyle = '#a9743c'; ctx.lineWidth = hh * .035; ctx.beginPath(); ctx.moveTo(hh * .1, -hh * .7); ctx.lineTo(hh * .1 + Math.sin(an) * hh * .75, -hh * .7 + Math.cos(an) * hh * .75); ctx.stroke(); ctx.restore();
  }
  drawPuck(ctx, v) {
    const shoot = this.role === 'shoot', pk = this.puck || (shoot ? { X: 0, Z: DSHOOT, h: .05 } : { X: this.x0, Z: DSHOOT, h: .05 }); if (this.state === 'ready' && !shoot) return;
    const p = this.P(v, pk.X, pk.Z, pk.h), gp = this.P(v, pk.X, pk.Z, 0), r = Math.max(4, .12 * p.s);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(gp.x, gp.y, r * 1.2, r * .4, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#15151c'; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * .7, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = '#3a3a48'; ctx.beginPath(); ctx.ellipse(p.x, p.y - r * .15, r * .85, r * .45, 0, 0, 6.3); ctx.fill();
  }
  drawStick(ctx, v) {
    const { min } = this.app, S = this.stick, L = min * .4; ctx.save(); ctx.translate(S.x, S.y); ctx.rotate(S.ang + .3); ctx.strokeStyle = '#a9743c'; ctx.lineWidth = min * .018; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -L * .5); ctx.lineTo(0, L * .45); ctx.stroke(); ctx.strokeStyle = '#222'; ctx.lineWidth = min * .03; ctx.beginPath(); ctx.moveTo(0, L * .45); ctx.lineTo(min * .07, L * .5); ctx.stroke(); ctx.restore();
  }
  drawGlove(ctx, v) {
    const { min } = this.app, G = this.glove, r = min * .1; ctx.save(); ctx.strokeStyle = '#2a5bd6'; ctx.lineWidth = min * .05; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(G.x, this.app.H + 20); ctx.lineTo(G.x, G.y + r * .6); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#a07a00'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(G.x, G.y, r, r * 1.05, 0, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.strokeStyle = 'rgba(160,122,0,.7)'; ctx.beginPath(); for (const k of [-.45, 0, .45]) { ctx.moveTo(G.x + k * r, G.y - r * .2); ctx.lineTo(G.x + k * r, G.y - r * .95); } ctx.stroke(); ctx.restore();
  }
}
