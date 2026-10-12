import { Particles, Popups, bigText, drawBubble, rand, pick, segDist, HUES } from '../util.js?v=23';

export class BubbleGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.time = 60; this.score = 0; this.elapsed = 0; this.pops = 0; this.bestCombo = 0;
    this.bubbles = []; this.spawnT = 0; this.combo = 0; this.comboT = 0;
    this.countdown = 2.4; this.lastCount = 3; this.over = false;
    this.fx = new Particles(); this.pop = new Popups(); this.prevTip = new Map();
    a.setScoreLabel('Score'); a.setLeft('⏱ 60'); a.setRight('');
    a.hint('Pop the bubbles with your pointer finger! ☝️');
  }
  base() { return Math.max(30, Math.min(78, this.app.min * .085)); }
  spawn() {
    const { W, H } = this.app, b = this.base(), gold = Math.random() < .09;
    const r = gold ? b * .8 : b * rand(.75, 1.3), ramp = Math.min(1, this.elapsed / 60);
    this.bubbles.push({ x: rand(r, W - r), y: H + r, r, vy: -rand(.13, .26) * H * .72 * (1 + ramp * .5) * (gold ? 1.4 : 1), ph: rand(0, 6), amp: rand(10, 35), hue: pick(HUES), gold, bx: 0 });
    this.bubbles[this.bubbles.length - 1].bx = this.bubbles[this.bubbles.length - 1].x;
  }
  update(dt, hands) {
    const a = this.app, { W, H } = a;
    this.fx.update(dt); this.pop.update(dt);
    if (this.over) return;
    if (this.countdown > 0) {
      this.countdown -= dt; const n = Math.ceil(this.countdown / .8);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; a.sfx.tick(); }
      if (this.countdown <= 0) { a.sfx.go(); a.banner('GO!', 600); a.hint(null); }
      return;
    }
    this.time -= dt; this.elapsed += dt;
    if (this.time <= 0) return this.finish();
    a.setLeft('⏱ ' + Math.ceil(this.time));
    this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
    this.spawnT -= dt;
    const gap = 0.75 - Math.min(1, this.elapsed / 60) * .4;
    if (this.spawnT <= 0) { this.spawn(); this.spawnT = gap * rand(.6, 1.2); if (this.bubbles.length < 3) this.spawnT *= .5; }
    for (const b of this.bubbles) { b.y += b.vy * dt; b.x = b.bx + Math.sin(b.ph + this.elapsed * 1.6) * b.amp; }
    this.bubbles = this.bubbles.filter(b => b.y > -b.r * 2 && !b.popped);
    const tipR = a.min * .035;
    for (const h of hands) {
      const prev = this.prevTip.get(h.id) || { x: h.tip.x, y: h.tip.y };
      for (const b of this.bubbles) {
        if (b.popped) continue;
        if (segDist(b.x, b.y, prev.x, prev.y, h.tip.x, h.tip.y) < b.r + tipR) this.popBubble(b);
      }
      this.prevTip.set(h.id, { x: h.tip.x, y: h.tip.y });
    }
    for (const id of [...this.prevTip.keys()]) if (!hands.some(h => h.id === id)) this.prevTip.delete(id);
    if (!hands.length && this.elapsed > 4 && performance.now() - a.lastHandSeen > 2500) a.hint('Show your hand to the camera ✋'); else a.hint(null);
  }
  popBubble(b) {
    const a = this.app; b.popped = true;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1; this.comboT = 1.1; this.bestCombo = Math.max(this.bestCombo, this.combo);
    const mult = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1, pts = (b.gold ? 5 : 1) * mult;
    this.score += pts; this.pops++; a.setScore(this.score);
    this.fx.burst(b.x, b.y, b.gold ? 50 : b.hue, b.gold ? 28 : 14, 360, b.r * .18);
    this.pop.add(b.x, b.y - b.r * .3, '+' + pts + (mult > 1 ? ' x' + mult : ''), b.gold ? '#fff06a' : '#ffffff', 30 + mult * 6);
    if (b.gold) a.sfx.gold(); else a.sfx.pop(1 + Math.min(this.combo, 10) * .06);
  }
  finish() {
    this.over = true; const a = this.app;
    a.setLeft('⏱ 0');
    a.banner("Time's up!", 1200);
    setTimeout(() => { if (a.game === this) a.showResult({ title: this.score >= 40 ? 'Bubble champion!' : 'Nice popping!', emoji: this.score >= 40 ? '🏆' : '🫧', score: this.score, stats: [['Bubbles', this.pops], ['Best combo', this.bestCombo]] }); }, 1300);
  }
  draw(ctx) {
    const { W, H } = this.app;
    for (const b of this.bubbles) drawBubble(ctx, b.x, b.y, b.r, b.hue, b.gold);
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.countdown > 0) bigText(ctx, String(Math.max(1, Math.ceil(this.countdown / .8))), W / 2, H * .4, this.app.min * .35);
    if (this.combo >= 3 && this.comboT > 0) bigText(ctx, `${this.combo} combo!`, W / 2, H * .18, this.app.min * .09, '#7dffb0');
  }
}
