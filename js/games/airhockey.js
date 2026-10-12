import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';

/* Air Hockey — top-down. Your hand moves the red mallet (lower half of the table). First to 7 goals wins.
 * Physics is in "table widths": the table is 1 wide and R tall. */
export const R = 1.8, PR = .05, MR = .085, GW = .36, VMAX = 3.4, WIN = 7;
/** One physics step for puck p={x,y,vx,vy} against mallets m=[{x,y,vx,vy}]. Returns 'top' | 'bottom' if a goal was scored (puck crossed that end), else null. */
export function stepPuck(p, m, dt) {
  p.x += p.vx * dt; p.y += p.vy * dt; const f = Math.exp(-.22 * dt); p.vx *= f; p.vy *= f; let ev = null;
  if (p.x < PR) { p.x = PR; p.vx = Math.abs(p.vx) * .92; ev = 'wall'; } else if (p.x > 1 - PR) { p.x = 1 - PR; p.vx = -Math.abs(p.vx) * .92; ev = 'wall'; }
  const inGoal = Math.abs(p.x - .5) < GW / 2 - PR * .4;
  if (p.y < PR) { if (inGoal) return 'top'; p.y = PR; p.vy = Math.abs(p.vy) * .92; ev = 'wall'; } else if (p.y > R - PR) { if (inGoal) return 'bottom'; p.y = R - PR; p.vy = -Math.abs(p.vy) * .92; ev = 'wall'; }
  for (const k of m) {
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy), min = PR + MR;
    if (d < min && d > 1e-6) {
      const nx = dx / d, ny = dy / d; p.x = k.x + nx * min; p.y = k.y + ny * min;
      const vn = (p.vx - k.vx) * nx + (p.vy - k.vy) * ny;
      if (vn < 0) { p.vx -= 1.9 * vn * nx; p.vy -= 1.9 * vn * ny; ev = 'hit'; }
    }
  }
  const s = Math.hypot(p.vx, p.vy); if (s > VMAX) { p.vx *= VMAX / s; p.vy *= VMAX / s; }
  p.ev = ev; return null;
}

export class AirHockeyGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.t = 0; this.over = false; this.pg = 0; this.ag = 0; this.hits = 0; this.best = 0; this.rallyHits = 0;
    this.me = { x: .5, y: R * .85, vx: 0, vy: 0, tx: .5, ty: R * .85 }; this.ai = { x: .5, y: .16, vx: 0, vy: 0, nx: 0, nt: 0 };
    this.puck = { x: .5, y: R / 2, vx: 0, vy: 0 }; this.trail = []; this.state = 'ready'; this.sT = 1.8; this.flash = 0; this.lastHandT = 0;
    a.setScoreLabel('Goals'); a.setScore(0); this.hud(); a.hint(a.touchMode && !a.cameraOn ? '🏒 Drag your finger on the table to move your red mallet. Hit the puck into the top goal!' : '🏒 Move your hand to slide the red mallet. Smack the puck into the top goal!');
  }
  destroy() {}
  hud() { const a = this.app; a.setLeft(`You ${this.pg} – ${this.ag} CPU`); a.setRight('First to ' + WIN); a.setScore(this.pg); }
  get level() { return Math.min(5, this.pg + (this.ag > this.pg + 2 ? -1 : 0)); }
  geo() { const { W, H } = this.app, port = W < H, y0 = port ? 140 : 62, av = H - y0 - 8; let tw = av / R; if (tw > W * .94) tw = W * .94; return { tw, th: tw * R, x0: (W - tw) / 2, y0: y0 + (av - tw * R) / 2 + 2 }; }
  toX(g, px) { return (px - g.x0) / g.tw; } toY(g, py) { return (py - g.y0) / g.tw; }

  update(dt, hands) {
    const a = this.app, g = this.geo(); this.t += dt; this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5);
    const hand = hands.find(h => !h.pointer) || hands[0], me = this.me;
    if (hand) {
      if (hand.pointer) { me.tx = this.toX(g, hand.palm.x); me.ty = this.toY(g, hand.palm.y); }
      else { me.tx = clamp((hand.palm.x / a.W - .1) / .8, 0, 1); me.ty = R * (.5 + .5 * clamp((hand.palm.y / a.H - .12) / .78, 0, 1)); }
    }
    me.tx = clamp(me.tx, MR, 1 - MR); me.ty = clamp(me.ty, R / 2 + MR * .3, R - MR);
    if (this.state === 'ready') { this.sT -= dt; me.x = lerp(me.x, me.tx, .4); me.y = lerp(me.y, me.ty, .4); if (this.sT <= 0) { this.state = 'play'; a.hint(null); const d = this.serveDir || (Math.random() < .5 ? 1 : -1); this.puck.vx = rand(-.4, .4); this.puck.vy = .9 * d; } }
    else if (this.state === 'goal') { this.sT -= dt; if (this.sT <= 0) { if (this.matchOver) return this.finish(); this.reset(); } }
    const n = 4, h = dt / n;
    for (let i = 0; i < n; i++) {
      // player mallet follows the hand quickly, but with a speed cap so it can't teleport through the puck
      const px = me.x, py = me.y, k = 1 - Math.exp(-h * 38), mx = (me.tx - me.x) * k, my = (me.ty - me.y) * k, ms = Math.hypot(mx, my) / h, cap = 7;
      const sc = ms > cap ? cap * h / (ms * h) : 1; me.x += mx * sc; me.y += my * sc; me.vx = (me.x - px) / h; me.vy = (me.y - py) / h;
      this.stepAI(h);
      if (this.state === 'play') {
        const r = stepPuck(this.puck, [me, this.ai], h);
        if (this.puck.ev === 'hit') { const sp = Math.hypot(this.puck.vx, this.puck.vy); if (!this._hs || this.t - this._hs > .08) { this._hs = this.t; a.sfx.thwack(); this.fx.burst(a.W / 2, a.H / 2, 40, 0, 0, 0); this.sparks(g); if (this.lastHitter === 'p') this.rallyHits++; } }
        else if (this.puck.ev === 'wall' && (!this._ws || this.t - this._ws > .08)) { this._ws = this.t; a.sfx.bounce(); }
        if (r) { this.goal(r === 'top' ? 'p' : 'a'); break; }
      }
    }
    if (this.state === 'play') {
      // note who touched last (for stats) & nudge a stalled puck
      const pk = this.puck, sp = Math.hypot(pk.vx, pk.vy);
      if (Math.hypot(pk.x - me.x, pk.y - me.y) < PR + MR + .03) { this.lastHitter = 'p'; if (sp > this.best) this.best = sp; }
      if (sp < .12) { this.stall = (this.stall || 0) + dt; if (this.stall > 2.5) { pk.vy += (pk.y < R / 2 ? 1 : -1) * .5; this.stall = 0; } } else this.stall = 0;
      this.trail.push({ x: pk.x, y: pk.y, s: sp }); if (this.trail.length > 8) this.trail.shift();
    }
  }
  sparks(g) { const pk = this.puck; this.fx.burst(g.x0 + pk.x * g.tw, g.y0 + pk.y * g.tw, 45, 6, 180, 4); }
  stepAI(dt) {
    const ai = this.ai, pk = this.puck, sp = 2.1 + .3 * this.level, home = .14; let tx = .5, ty = home;
    ai.nt -= dt; if (ai.nt <= 0) { ai.nt = .5; ai.nx = rand(-1, 1) * Math.max(.02, .1 - .015 * this.level); }
    if (this.state === 'play' || this.state === 'ready') {
      if (pk.y < R * .52) {
        if (ai.y < pk.y - .02) { tx = pk.x + (pk.x - .5) * .0 + ai.nx; ty = pk.y + (this.pg > this.ag ? .02 : 0); if (Math.abs(ai.x - pk.x) > MR * 1.2) ty = Math.min(pk.y - .1, ai.y + .05); }
        else { tx = pk.x + (pk.x < .5 ? .25 : -.25); ty = Math.max(.12, pk.y - .22); }
      } else if (pk.vy < -.2) { const t = Math.max(0, (pk.y - home) / -pk.vy); tx = pk.x + pk.vx * Math.min(t, .6) + ai.nx; ty = home + .06; }
      else { tx = lerp(.5, pk.x, .5) + ai.nx; ty = home; }
    }
    tx = clamp(tx, MR, 1 - MR); ty = clamp(ty, MR, R / 2 - MR * .3);
    let dx = tx - ai.x, dy = ty - ai.y; const d = Math.hypot(dx, dy), step = Math.min(d, sp * dt); const px = ai.x, py = ai.y;
    if (d > 1e-6) { ai.x += dx / d * step; ai.y += dy / d * step; } ai.vx = (ai.x - px) / dt; ai.vy = (ai.y - py) / dt;
  }
  goal(who) {
    const a = this.app, g = this.geo(); this.state = 'goal'; this.sT = 1.6; if (who === 'p') this.pg++; else this.ag++; this.flash = 1;
    this.serveDir = who === 'p' ? -1 : 1; this.hud();
    a.banner(who === 'p' ? '🎉 GOAL! 🥅' : 'CPU scores 😬', 1200); who === 'p' ? (a.sfx.cheer(), this.fx.confetti(a.W / 2, g.y0 + g.th * .1, 50, 600)) : a.sfx.miss();
    if (this.pg >= WIN || this.ag >= WIN) { this.matchOver = true; this.sT = 2; }
  }
  reset() {
    const a = this.app; this.puck = { x: .5, y: this.serveDir > 0 ? R * .35 : R * .65, vx: 0, vy: 0 }; this.me.tx = this.me.x; this.state = 'ready'; this.sT = 1.2; this.trail = []; this.rallyHits = 0; a.hideBanner();
    this.ai.x = .5; this.ai.y = .16;
  }
  finish() {
    const a = this.app; if (this.over) return; this.over = true; const win = this.pg > this.ag, score = this.pg * 10 + (win ? 40 + (WIN - this.ag) * 5 : 0);
    a.sfx.bell(); setTimeout(() => { if (a.game === this) a.showResult({ title: win ? 'You win!' : 'CPU wins — rematch?', emoji: win ? '🏆' : '🏒', score, stats: [['Final', `${this.pg}–${this.ag}`], ['Hardest shot', Math.round(this.best * 30) + ' mph']] }); }, 600);
  }

  draw(ctx) {
    const a = this.app, { W, H, min } = a, g = this.geo(), { tw, th, x0, y0 } = g, S = (u) => u * tw;
    ctx.fillStyle = 'rgba(15,10,40,.55)'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(x0, y0);
    // wooden frame + ice
    ctx.fillStyle = '#5b3a1e'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-10, -10, tw + 20, th + 20, 26) : ctx.rect(-10, -10, tw + 20, th + 20); ctx.fill();
    let gr = ctx.createLinearGradient(0, 0, 0, th); gr.addColorStop(0, '#d8f1ff'); gr.addColorStop(.5, '#bfe6ff'); gr.addColorStop(1, '#d8f1ff'); ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, tw, th, 18) : ctx.rect(0, 0, tw, th); ctx.fill();
    ctx.strokeStyle = 'rgba(220,40,60,.8)'; ctx.lineWidth = Math.max(2, tw * .012); ctx.beginPath(); ctx.moveTo(0, th / 2); ctx.lineTo(tw, th / 2); ctx.stroke(); ctx.beginPath(); ctx.arc(tw / 2, th / 2, tw * .16, 0, 6.3); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,110,220,.6)'; ctx.beginPath(); ctx.arc(tw / 2, 0, tw * .26, 0, Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(tw / 2, th, tw * .26, Math.PI, 6.3); ctx.stroke();
    // goals
    const gw = S(GW); for (const top of [true, false]) { const y = top ? 0 : th; ctx.fillStyle = this.flash > 0 && (top ? this.state === 'goal' : false) ? '#ffe45e' : '#223'; ctx.fillRect(tw / 2 - gw / 2, y - (top ? 12 : 0), gw, 12); ctx.fillStyle = top ? '#3b82f6' : '#ef4444'; ctx.fillRect(tw / 2 - gw / 2, y + (top ? -12 : 0), gw, 3); }
    // puck trail + puck
    for (let i = 0; i < this.trail.length - 1; i++) { const q = this.trail[i]; ctx.fillStyle = `rgba(40,40,60,${.03 + i * .02 * Math.min(1, q.s)})`; ctx.beginPath(); ctx.arc(S(q.x), S(q.y), S(PR) * (.5 + i * .06), 0, 6.3); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(S(this.puck.x) + 3, S(this.puck.y) + 4, S(PR), 0, 6.3); ctx.fill();
    ctx.fillStyle = '#1a1a24'; ctx.beginPath(); ctx.arc(S(this.puck.x), S(this.puck.y), S(PR), 0, 6.3); ctx.fill(); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(2, S(PR) * .22); ctx.beginPath(); ctx.arc(S(this.puck.x), S(this.puck.y), S(PR) * .72, 0, 6.3); ctx.stroke();
    const mallet = (m, c1, c2) => { const r = S(MR); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.arc(S(m.x) + 4, S(m.y) + 6, r, 0, 6.3); ctx.fill(); const gg = ctx.createRadialGradient(S(m.x) - r * .3, S(m.y) - r * .3, r * .1, S(m.x), S(m.y), r); gg.addColorStop(0, c1); gg.addColorStop(1, c2); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(S(m.x), S(m.y), r, 0, 6.3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(S(m.x), S(m.y), r * .45, 0, 6.3); ctx.fill(); };
    mallet(this.ai, '#7ab4ff', '#1f55c8'); mallet(this.me, '#ff8a8a', '#c4202c');
    ctx.restore();
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.state === 'ready') bigText(ctx, this.sT > 0 ? (this.sT > 1.2 ? 'READY' : 'GO!') : '', W / 2, y0 + th / 2, min * .14);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .25})`; ctx.fillRect(0, 0, W, H); }
  }
}
