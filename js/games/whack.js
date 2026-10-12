import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';

/* Whack-a-Mole — swat the moles with your hand! Golden = +5, bombs = -5. 50 seconds (or 2 players, 30 s each). */
export const TIME1 = 50, TIME2 = 30;
export const hitPts = (type, combo) => type === 'gold' ? 5 : type === 'bomb' ? -5 : 1 + Math.floor((Math.max(1, combo) - 1) / 3);
/** Does a hand (point p, hand speed in short-sides/s, time overlapped) hit a mole at m with radius r? */
export function whacks(p, m, r, speed, overlapT, handSize = 0) {
  const d = Math.hypot(p.x - m.x, p.y - m.y); if (d > r * 1.2 + handSize * .25) return false;
  return speed > .35 || overlapT > .22;
}

export class WhackGame {
  constructor(app) { this.app = app; }
  start(opts = {}) {
    const a = this.app; this.players = opts.players === 2 ? 2 : 1; this.turn = 0; this.scores = [0, 0];
    this.fx = new Particles(); this.pop = new Popups(); this.t = 0; this.over = false; this.swing = 0; this.hits = 0; this.misses = 0; this.bestCombo = 0; this.golds = 0;
    a.setScoreLabel(this.players === 2 ? 'P1' : 'Score'); a.setScore(0);
    this.beginTurn(true);
  }
  destroy() {}
  get timeMax() { return this.players === 2 ? TIME2 : TIME1; }
  beginTurn(first) {
    const a = this.app; this.moles = null; this.time = this.timeMax; this.combo = 0; this.spawnT = 1; this.state = 'ready'; this.cd = first ? 2.5 : 3.2; this.lastCd = 9; this.el = 0; this.layout = ''; this.ov = {};
    a.setScoreLabel(this.players === 2 ? 'P' + (this.turn + 1) : 'Score'); a.setScore(this.scores[this.turn]);
    a.hint(first ? (a.touchMode && !a.cameraOn ? '🔨 Tap or swipe over the moles to whack them! Avoid the 💣 bombs.' : '🔨 Swat the moles with your hand! Golden ones are worth 5. Avoid the 💣 bombs.') : null);
    this.hud(); if (!first) a.banner(`🔨 Player ${this.turn + 1} — get ready!`, 2400);
  }
  hud() { const a = this.app; a.setLeft('⏱ ' + Math.ceil(Math.max(0, this.time))); a.setRight(this.players === 2 ? `P1 ${this.scores[0]} · P2 ${this.scores[1]}${this.combo >= 3 ? ' · 🔥' + this.combo : ''}` : (this.combo >= 2 ? `🔥 Combo ${this.combo}` : '')); a.setScore(this.scores[this.turn]); }
  grid() {
    const { W, H } = this.app, port = W < H, cols = port ? 3 : 4, rows = port ? 4 : 3, top = port ? 150 : 84, aw = W * .94, ah = H - top - 14, cell = Math.min(aw / cols, ah / rows), key = `${W}x${H}`;
    const gx = (W - cell * cols) / 2 + cell / 2, gy = top + (ah - cell * rows) / 2 + cell / 2;
    return { cols, rows, cell, gx, gy, r: cell * .33, key };
  }
  init(g) { this.moles = []; for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) this.moles.push({ i, j, up: false, t: 0, dur: 1, type: 'mole', hit: false, hitT: 0, ov: 0 }); this.layout = g.key; }
  spawn() {
    const free = this.moles.filter(m => !m.up && m.hitT <= 0); if (!free.length) return; const m = free[Math.floor(Math.random() * free.length)], el = this.el;
    const r = Math.random(); m.type = r < .08 ? 'gold' : (el > 6 && r < .2) ? 'bomb' : 'mole'; m.up = true; m.t = 0; m.hit = false; m.ov = 0;
    m.dur = (m.type === 'gold' ? .95 : clamp(1.7 - el * .014, 1, 1.7)) * rand(.9, 1.1); this.app.sfx.plop();
  }
  update(dt, hands) {
    const a = this.app, g = this.grid(); if (!this.moles || this.layout !== g.key) this.init(g);
    this.t += dt; this.fx.update(dt); this.pop.update(dt); this.swing = Math.max(0, this.swing - dt * 5);
    if (this.state === 'ready') { this.cd -= dt; const n = Math.ceil(this.cd); if (n !== this.lastCd && n >= 1 && n <= 3) { this.lastCd = n; a.sfx.tick(); } if (this.cd <= 0) { this.state = 'play'; a.sfx.bell(); a.hint(null); } }
    else if (this.state === 'play') {
      this.time -= dt; this.el += dt; if (Math.ceil(this.time) !== this._c) { this._c = Math.ceil(this.time); this.hud(); }
      if (this.time <= 0) return this.endTurn();
      this.spawnT -= dt; const maxUp = 1 + Math.min(3, Math.floor(this.el / 12)); if (this.spawnT <= 0 && this.moles.filter(m => m.up).length < maxUp) { this.spawn(); this.spawnT = Math.max(.35, .95 - this.el * .01) * rand(.7, 1.3); }
    }
    for (const m of this.moles) {
      if (m.up) { m.t += dt; if (m.t >= m.dur) { m.up = false; if (!m.hit && m.type !== 'bomb') { this.combo = 0; this.misses++; this.hud(); } } }
      if (m.hitT > 0) m.hitT -= dt;
    }
    if (this.state !== 'play') return;
    for (const m of this.moles) {
      if (!m.up || m.hit || this.rise(m) < .45) { m.ov = 0; continue; }
      const c = this.pos(g, m); let any = false;
      for (const h of hands) { const pts = [h.palm, h.tip]; for (const pt of pts) { if (pt && Math.hypot(pt.x - c.x, pt.y - c.y) < g.r * 1.2 + (h.pointer ? 0 : (h.size || 0) * .25)) any = true; }
        const best = pts.find(pt => pt && whacks(pt, c, g.r, h.speed, m.ov, h.pointer ? 0 : h.size || 0)); if (best) { this.whack(m, c, h); break; } }
      m.ov = any ? m.ov + dt : 0;
    }
  }
  pos(g, m) { return { x: g.gx + m.i * g.cell, y: g.gy + m.j * g.cell }; }
  rise(m) { const k = Math.min(m.t / .18, 1), out = Math.min((m.dur - m.t) / .2, 1); return Math.max(0, Math.min(k, out)); }
  whack(m, c, h) {
    const a = this.app, g = this.grid(); m.hit = true; m.up = false; m.hitT = .5; this.swing = 1; this.hitAt = { x: c.x, y: c.y };
    const pts = hitPts(m.type, m.type === 'bomb' ? 0 : this.combo + 1), who = this.turn;
    if (m.type === 'bomb') { this.combo = 0; this.scores[who] = Math.max(0, this.scores[who] + pts); a.sfx.miss(); a.sfx.punch(); this.fx.burst(c.x, c.y, 20, 24, 420, 9); this.pop.add(c.x, c.y - g.r, 'BOOM! -5', '#ff8a8a', Math.max(28, g.cell * .22)); }
    else { this.combo++; this.hits++; this.bestCombo = Math.max(this.bestCombo, this.combo); this.scores[who] += pts; if (m.type === 'gold') this.golds++; a.sfx.thwack(); if (m.type === 'gold') a.sfx.bell(); this.fx.burst(c.x, c.y, m.type === 'gold' ? 50 : 30, 14, 300, 7);
      this.pop.add(c.x, c.y - g.r, m.type === 'gold' ? 'GOLDEN +5!' : this.combo >= 4 ? `Combo ${this.combo}! +${pts}` : `+${pts}`, m.type === 'gold' ? '#ffe45e' : this.combo >= 4 ? '#ff9f1c' : '#fff', Math.max(24, g.cell * .2)); }
    this.hud();
  }
  endTurn() {
    const a = this.app; this.state = 'end'; a.sfx.bell(); this.hud();
    if (this.players === 2 && this.turn === 0) { this.turn = 1; setTimeout(() => { if (a.game === this) this.beginTurn(false); }, 900); return; }
    this.over = true; const s = this.scores, two = this.players === 2;
    setTimeout(() => { if (a.game !== this) return; const w = s[0] === s[1] ? 0 : s[0] > s[1] ? 1 : 2;
      a.showResult({ title: two ? (w ? `Player ${w} wins!` : 'It’s a tie!') : (s[0] >= 40 ? 'Mole master!' : s[0] >= 20 ? 'Great whacking!' : 'Nice try!'), emoji: two ? '🏆' : s[0] >= 20 ? '🏆' : '🔨', score: two ? Math.max(s[0], s[1]) : s[0], bestKey: two ? '_2p' : '',
        stats: two ? [['Player 1', s[0]], ['Player 2', s[1]]] : [['Moles whacked', this.hits], ['Best combo', this.bestCombo], ['Golden', this.golds]] }); }, 800);
  }
  draw(ctx) {
    const a = this.app, { W, H, min } = a, g = this.grid(); if (!this.moles || this.layout !== g.key) this.init(g);
    let gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#7ad35a'); gr.addColorStop(1, '#3d9a3a'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,80,0,.12)'; for (let i = 0; i < 14; i++) { const x = (i * 211 % W), y = (i * 137 % H); ctx.beginPath(); ctx.ellipse(x, y, 60, 22, 0, 0, 6.3); ctx.fill(); }
    for (const m of this.moles) this.drawHole(ctx, g, m);
    this.fx.draw(ctx); this.pop.draw(ctx);
    // hammer(s)
    for (const h of this.app.hands) { const p = h.pointer ? h.palm : h.palm, s = g.cell * .55, an = -.9 + this.swing * 1.5 + clamp(h.vel.x * .3, -.4, .4);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(an); ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = s * .13; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 1.1); ctx.stroke();
      ctx.fillStyle = '#e6463e'; ctx.fillRect(-s * .38, -s * 1.35, s * .76, s * .42); ctx.strokeStyle = '#7a1612'; ctx.lineWidth = 3; ctx.strokeRect(-s * .38, -s * 1.35, s * .76, s * .42); ctx.restore(); }
    if (this.state === 'ready') { const n = Math.ceil(this.cd); bigText(ctx, n >= 1 && n <= 3 ? String(n) : 'WHACK!', W / 2, H * .5, min * .26); }
  }
  drawHole(ctx, g, m) {
    const c = this.pos(g, m), r = g.r, k = m.up ? this.rise(m) : 0;
    ctx.fillStyle = '#2a1a0a'; ctx.beginPath(); ctx.ellipse(c.x, c.y + r * .35, r * 1.1, r * .5, 0, 0, 6.3); ctx.fill();
    if (m.up || m.hitT > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(c.x - r * 2, c.y - r * 3, r * 4, r * 3 + r * .45); ctx.clip();
      const hit = m.hitT > 0, sq = hit ? .55 + .45 * (1 - m.hitT / .5) : 1, cy = c.y + r * .3 - (hit ? r * .2 : k * r * 1.35), mr = r * .92;
      ctx.translate(c.x, cy); ctx.scale(1 + (hit ? .25 : 0), sq);
      if (m.type === 'bomb') { ctx.fillStyle = '#20202c'; ctx.beginPath(); ctx.arc(0, 0, mr * .9, 0, 6.3); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(-mr * .3, -mr * .3, mr * .25, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#a0764a'; ctx.lineWidth = mr * .12; ctx.beginPath(); ctx.moveTo(0, -mr * .85); ctx.quadraticCurveTo(mr * .3, -mr * 1.25, mr * .55, -mr * 1.1); ctx.stroke(); ctx.fillStyle = '#ff7b1a'; ctx.beginPath(); ctx.arc(mr * .6, -mr * 1.12, mr * .12 + Math.sin(this.t * 30) * 2, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff4040'; ctx.font = `900 ${mr * .8}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, mr * .05); }
      else {
        const gold = m.type === 'gold', body = gold ? '#ffcf33' : '#9a6a3a'; ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, mr * .95, mr * 1.15, 0, 0, 6.3); ctx.fill();
        ctx.fillStyle = gold ? '#fff0a0' : '#d9b48a'; ctx.beginPath(); ctx.ellipse(0, mr * .3, mr * .55, mr * .5, 0, 0, 6.3); ctx.fill();
        ctx.fillStyle = hit ? '#fff' : '#111'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * mr * .32, -mr * .25, mr * .13, 0, 6.3); ctx.fill(); }
        if (hit) { ctx.strokeStyle = '#111'; ctx.lineWidth = 3; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * mr * .32 - 6, -mr * .25 - 6); ctx.lineTo(s * mr * .32 + 6, -mr * .25 + 6); ctx.moveTo(s * mr * .32 + 6, -mr * .25 - 6); ctx.lineTo(s * mr * .32 - 6, -mr * .25 + 6); ctx.stroke(); } }
        ctx.fillStyle = '#ff7a8a'; ctx.beginPath(); ctx.ellipse(0, mr * .05, mr * .16, mr * .11, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(-mr * .1, mr * .22, mr * .09, mr * .16); ctx.fillRect(mr * .01, mr * .22, mr * .09, mr * .16);
        if (gold) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `${mr * .5}px serif`; ctx.textAlign = 'center'; ctx.fillText('✨', mr * .6, -mr * .9 + Math.sin(this.t * 8) * 3); }
      }
      ctx.restore();
    }
    ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.ellipse(c.x, c.y + r * .55, r * 1.15, r * .38, 0, 0, Math.PI); ctx.fill(); ctx.strokeStyle = '#4a2c14'; ctx.lineWidth = 3; ctx.stroke();
    if (m.hitT > 0) { ctx.fillStyle = '#fff'; ctx.font = `${r * .6}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; for (let i = 0; i < 3; i++) { const an = this.t * 8 + i * 2.1; ctx.fillText('⭐', c.x + Math.cos(an) * r * .8, c.y - r * 1.2 + Math.sin(an) * r * .25); } }
  }
}
