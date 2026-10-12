import { Particles, Popups, bigText, rand, clamp, lerp, pick, segDist } from '../util.js?v=23';

/* Fruit Slicer — swipe your hand through flying fruit. Avoid the bombs! 60 seconds. */
const TIME = 60;
const FRUITS = [['🍉', 350], ['🍊', 30], ['🍎', 0], ['🍌', 55], ['🍓', 345], ['🍍', 45], ['🍇', 280], ['🥝', 100]];

export class FruitGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.items = []; this.halves = []; this.trails = {}; this.prev = {};
    this.time = TIME; this.score = 0; this.sliced = 0; this.bombs = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0; this.next = 1; this.t = 0; this.over = false; this.flash = 0; this.cd = 2.6; this.state = 'ready'; this.lastCd = 4;
    a.setScoreLabel('Fruit'); a.setScore(0); this.hud();
    a.hint(a.touchMode && !a.cameraOn ? '🍉 Swipe your finger FAST through the fruit! Don’t touch the bombs 💣' : '🍉 Swipe your hand fast through the fruit! Don’t touch the bombs 💣');
  }
  destroy() {}
  hud() { const a = this.app; a.setLeft('⏱ ' + Math.ceil(Math.max(0, this.time))); a.setRight(this.combo >= 2 ? `🔥 Combo ${this.combo}` : ''); a.setScore(this.score); }
  g() { return this.app.H * 1.15; }
  spawn() {
    const a = this.app, bomb = Math.random() < clamp(.1 + (TIME - this.time) / 60 * .1, .1, .2), W = a.W, H = a.H, r = a.min * (bomb ? .06 : rand(.065, .085));
    const x = rand(.14, .86) * W, apex = H * rand(.55, .85), vy = -Math.sqrt(2 * this.g() * apex), vx = (W / 2 - x) * rand(.1, .45) + rand(-60, 60);
    const f = pick(FRUITS); this.items.push({ x, y: H + r, vx, vy, r, bomb, emoji: bomb ? '💣' : f[0], hue: f[1], rot: 0, vr: rand(-3, 3), dead: false });
  }
  update(dt, hands) {
    const a = this.app, W = a.W, H = a.H; this.t += dt; this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.state === 'ready') { this.cd -= dt; const n = Math.ceil(this.cd); if (n !== this.lastCd && n >= 1 && n <= 3) { this.lastCd = n; a.sfx.tick(); } if (this.cd <= 0) { this.state = 'play'; a.sfx.bell(); a.hint(null); } }
    else if (this.state === 'play') {
      this.time -= dt; if (Math.ceil(this.time) !== this._c) { this._c = Math.ceil(this.time); this.hud(); }
      if (this.time <= 0) return this.finish();
      this.next -= dt; if (this.next <= 0) { const n = Math.random() < .35 ? 2 + (Math.random() < .4 ? 1 : 0) : 1; for (let i = 0; i < n; i++) setTimeout(() => this.state === 'play' && this.a_spawn(), i * 140); this.next = Math.max(.65, 1.5 - (TIME - this.time) * .014) * rand(.8, 1.2); a.sfx.toss(); }
    }
    this.comboT -= dt; if (this.comboT <= 0 && this.combo) { this.combo = 0; this.hud(); }
    const g = this.g();
    for (const it of this.items) { it.vy += g * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.rot += it.vr * dt; if (it.y > H + it.r * 2 && it.vy > 0) it.dead = true; }
    this.items = this.items.filter(i => !i.dead);
    for (const h of this.halves) { h.vy += g * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.vr * dt; }
    this.halves = this.halves.filter(h => h.y < H + h.r * 2);
    // blade (fingertip / pointer)
    for (const h of hands) {
      const p = h.tip || h.palm, pv = this.prev[h.id], now = performance.now() / 1000;
      const tr = this.trails[h.id] || (this.trails[h.id] = []); tr.push({ x: p.x, y: p.y, t: now }); while (tr.length && now - tr[0].t > .22) tr.shift();
      if (pv && this.state === 'play' && h.speed > .9) for (const it of this.items) if (!it.dead && segDist(it.x, it.y, pv.x, pv.y, p.x, p.y) < it.r * 1.05) this.slice(it, h);
      this.prev[h.id] = { x: p.x, y: p.y };
    }
    for (const id in this.trails) if (!hands.find(h => h.id == id)) { const tr = this.trails[id]; const now = performance.now() / 1000; while (tr.length && now - tr[0].t > .22) tr.shift(); }
  }
  a_spawn() { this.spawn(); }
  slice(it, h) {
    const a = this.app; it.dead = true;
    if (it.bomb) { this.bombs++; this.score = Math.max(0, this.score - 5); this.flash = 1; this.combo = 0; a.sfx.miss(); a.sfx.punch(); this.fx.burst(it.x, it.y, 20, 30, 500, 10); this.pop.add(it.x, it.y, 'BOOM! -5', '#ff8a8a', Math.max(30, a.min * .06)); this.hud(); return; }
    this.sliced++; this.combo = this.comboT > 0 ? this.combo + 1 : 1; this.comboT = .45; this.bestCombo = Math.max(this.bestCombo, this.combo);
    const bonus = this.combo >= 3 ? this.combo - 1 : 0, pts = 1 + bonus; this.score += pts;
    const ang = Math.atan2(h.vel.y, h.vel.x), nx = -Math.sin(ang), ny = Math.cos(ang);
    for (const s of [-1, 1]) this.halves.push({ x: it.x, y: it.y, vx: it.vx * .5 + s * nx * 220 + rand(-40, 40), vy: it.vy * .4 + s * ny * 220 - 120, rot: it.rot, vr: s * rand(2, 5), r: it.r, emoji: it.emoji, side: s, ang });
    this.fx.burst(it.x, it.y, it.hue, 16, 380, 8); a.sfx.pop(1 + Math.min(.6, this.combo * .08)); a.sfx.swing();
    this.pop.add(it.x, it.y - it.r, bonus ? `Combo x${this.combo}! +${pts}` : '+1', bonus ? '#ff9f1c' : '#fff', Math.max(26, a.min * (bonus ? .055 : .045)));
    if (this.combo >= 3) a.sfx.crowdCheer && 0;
    this.hud();
  }
  finish() {
    const a = this.app; this.over = true; this.time = 0; this.hud(); a.hint(null); a.sfx.bell();
    setTimeout(() => { if (a.game === this) a.showResult({ title: this.score >= 60 ? 'Fruit ninja!' : this.score >= 30 ? 'Great slicing!' : 'Nice try!', emoji: this.score >= 30 ? '🏆' : '🍉', score: this.score, stats: [['Sliced', this.sliced], ['Best combo', this.bestCombo], ['Bombs hit', this.bombs]] }); }, 800);
  }
  draw(ctx) {
    const a = this.app, { W, H, min } = a;
    ctx.fillStyle = 'rgba(30,10,60,.25)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    for (const h of this.halves) {
      ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.rot); ctx.font = `${h.r * 2.1}px serif`; ctx.beginPath(); ctx.rect(h.side < 0 ? -h.r * 2 : 0, -h.r * 2, h.r * 2, h.r * 4); ctx.clip(); ctx.fillText(h.emoji, 0, 0); ctx.restore();
    }
    for (const it of this.items) { ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot); ctx.font = `${it.r * 2.1}px serif`; ctx.fillText(it.emoji, 0, 0); if (it.bomb) { ctx.strokeStyle = 'rgba(255,60,60,.6)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, it.r * 1.15 + 3 * Math.sin(this.t * 14), 0, 6.3); ctx.stroke(); } ctx.restore(); }
    // blade trails
    const now = performance.now() / 1000; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const id in this.trails) { const tr = this.trails[id]; for (let i = 1; i < tr.length; i++) { const k = 1 - (now - tr[i].t) / .22; if (k <= 0) continue; ctx.strokeStyle = `rgba(190,235,255,${k})`; ctx.shadowColor = '#7de3ff'; ctx.shadowBlur = 14; ctx.lineWidth = Math.max(3, min * .016 * k); ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke(); } ctx.shadowBlur = 0; }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.state === 'ready') { const n = Math.ceil(this.cd); bigText(ctx, n >= 1 && n <= 3 ? String(n) : 'SLICE!', W / 2, H * .45, min * .28); }
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,60,40,${this.flash * .45})`; ctx.fillRect(0, 0, W, H); }
  }
}
