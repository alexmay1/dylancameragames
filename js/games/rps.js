import { Particles, Popups, bigText, rand, clamp, pick } from '../util.js?v=23';
import { classify, Vote, duel, EMOJI } from '../rpsrules.js?v=23';

/* Rock Paper Scissors — best of 5. Show your hand shape on "SHOOT!". */
const BEATS = [['ROCK', 0], ['PAPER', .8], ['SCISSORS', 1.6], ['SHOOT!', 2.4]], SAMPLE0 = 2.5, SAMPLE1 = 3.15, WINS = 3;
export class RpsGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app; this.sim = a.touchMode && !a.cameraOn;
    this.fx = new Particles(); this.pop = new Popups(); this.vote = new Vote(.4); this.t = 0; this.over = false; this.pw = 0; this.cw = 0; this.ties = 0; this.rounds = 0; this.streak = 0; this.bestStreak = 0; this.unclear = 0;
    this.live = null; this.pick = null; this.btns = [];
    this.onDown = (e) => { if (!this.sim || this.state !== 'round') return; for (const b of this.btns) if (e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) { this.pick = b.k; this.app.sfx.tick(); } };
    a.canvasEl = document.getElementById('stage'); a.canvasEl.addEventListener('pointerdown', this.onDown);
    a.setScoreLabel('Wins'); a.setScore(0); this.hud(); this.toRound(2);
    a.hint(this.sim ? '✊ Tap ROCK, PAPER or SCISSORS before “SHOOT!”' : '✊ Pump your fist with the beat, then show ✊ ✋ or ✌️ on “SHOOT!”');
  }
  destroy() { if (this.app.canvasEl) this.app.canvasEl.removeEventListener('pointerdown', this.onDown); }
  hud() { const a = this.app; a.setLeft(`You ${this.pw} – ${this.cw} CPU`); a.setRight('Best of 5'); a.setScore(this.pw); }
  toRound(delay = 1) { this.state = 'wait'; this.wt = delay; this.rt = 0; this.cpu = pick(['rock', 'paper', 'scissors']); this.pick = null; this.shown = null; this.vote.reset(); this.samples = []; this.msg = ''; this.lastBeat = -1; }
  update(dt, hands) {
    const a = this.app; this.t += dt; this.fx.update(dt); this.pop.update(dt);
    const h = hands.find(h => !h.pointer); this.live = h && h.pts && h.pts.length >= 21 ? classify(h.pts) : null; this.hasHand = !!h; this.vote.push(this.t, this.live);
    if (this.state === 'wait') { this.wt -= dt; if (this.wt <= 0) { this.state = 'round'; this.rt = 0; this.lastBeat = -1; a.hint(null); } }
    else if (this.state === 'round') {
      this.rt += dt; const bi = BEATS.reduce((k, b, i) => this.rt >= b[1] ? i : k, 0); if (bi !== this.lastBeat) { this.lastBeat = bi; bi === 3 ? a.sfx.bell() : a.sfx.tick(); }
      if (this.rt >= SAMPLE0 && this.rt <= SAMPLE1 && this.live) this.samples.push(this.live);
      if (this.rt > SAMPLE1) this.resolve();
    } else if (this.state === 'show') { this.wt -= dt; if (this.wt <= 0) { if (this.over) return this.finish(); this.toRound(1.3); } }
  }
  resolve() {
    const a = this.app; let you = this.sim ? this.pick : null;
    if (!you) { const c = {}; for (const s of this.samples) c[s] = (c[s] || 0) + 1; const e = Object.entries(c).sort((x, y) => y[1] - x[1])[0]; if (e && e[1] >= 2) you = e[0]; }
    this.state = 'show'; this.wt = 2; this.shown = { you, cpu: this.cpu };
    if (!you) { this.unclear++; this.msg = this.sim ? 'Too slow! Tap a button faster.' : 'I couldn’t see your hand shape! Hold it clearly in view.'; this.wt = 1.8; a.sfx.miss(); return; }
    this.unclear = 0; const r = duel(you, this.cpu); this.rounds++;
    if (r === 0) { this.ties++; this.msg = 'It’s a tie! Go again.'; a.sfx.tick(); this.streak = this.streak; }
    else if (r > 0) { this.pw++; this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); this.msg = `${EMOJI[you]} beats ${EMOJI[this.cpu]} — you win the round!`; a.sfx.cheer(); this.fx.confetti(a.W * .3, a.H * .5, 40, 600); }
    else { this.cw++; this.streak = 0; this.msg = `${EMOJI[this.cpu]} beats ${EMOJI[you]} — CPU wins the round`; a.sfx.miss(); }
    this.hud(); if (this.pw >= WINS || this.cw >= WINS) { this.over = true; this.wt = 2.2; }
  }
  finish() {
    const a = this.app; const win = this.pw > this.cw, score = this.pw * 30 + (win ? 60 : 0) + this.bestStreak * 10;
    a.sfx[win ? 'cheer' : 'over'](); a.showResult({ title: win ? 'You win the match!' : 'CPU wins — rematch?', emoji: win ? '🏆' : '✊', score, stats: [['Final', `${this.pw}–${this.cw}`], ['Ties', this.ties], ['Best streak', this.bestStreak]] });
  }
  draw(ctx) {
    const a = this.app, { W, H, min } = a, port = W < H;
    ctx.fillStyle = 'rgba(20,10,60,.55)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(W * .44, H * .34), py = port ? H * .3 : H * .22, ps = pw * .62;
    const panel = (cx, cy, label, emoji, color) => { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - pw / 2, cy, pw, pw * 1.05, 24) : ctx.rect(cx - pw / 2, cy, pw, pw * 1.05); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `900 ${pw * .13}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(label, cx, cy + pw * .04); if (emoji) { ctx.font = `${ps}px serif`; ctx.textBaseline = 'middle'; ctx.fillText(emoji, cx, cy + pw * .62); } };
    const bob = this.state === 'round' && this.rt < SAMPLE0 ? Math.abs(Math.sin(this.rt * Math.PI / .8)) * -pw * .08 : 0;
    const youE = this.state === 'show' ? (this.shown.you ? EMOJI[this.shown.you] : '❓') : (this.state === 'round' && this.rt < SAMPLE0 ? '✊' : this.live ? EMOJI[this.live] : '✊');
    const cpuE = this.state === 'show' ? EMOJI[this.shown.cpu] : '✊';
    ctx.save(); ctx.translate(0, bob); panel(W * (port ? .27 : .3), py, 'YOU', youE, '#7dffb0'); panel(W * (port ? .73 : .7), py, 'CPU', cpuE, '#ffb02e'); ctx.restore();
    // beat text
    let txt = ''; if (this.state === 'wait') txt = 'Get ready…'; else if (this.state === 'round') txt = BEATS[Math.max(0, this.lastBeat)][0]; else txt = this.msg;
    if (this.state === 'round') bigText(ctx, txt, W / 2, py + pw * 1.25, min * (txt.length > 6 ? .1 : .13), txt === 'SHOOT!' ? '#ff6b6b' : '#ffe45e');
    else { ctx.fillStyle = '#fff'; ctx.font = `900 ${clamp(min * .045, 16, 30)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, W / 2, py + pw * 1.25, W * .94); }
    // round pips
    const pip = (x, y, on, c) => { ctx.fillStyle = on ? c : 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.arc(x, y, min * .017, 0, 6.3); ctx.fill(); };
    for (let i = 0; i < WINS; i++) { pip(W * (port ? .27 : .3) - min * .05 + i * min * .05, py + pw * 1.12 + min * .1, i < this.pw, '#7dffb0'); pip(W * (port ? .73 : .7) - min * .05 + i * min * .05, py + pw * 1.12 + min * .1, i < this.cw, '#ffb02e'); }
    // hand-shape debug indicator
    const lab = this.sim ? '' : !this.hasHand ? '🙈 No hand seen' : this.live ? `I see: ${EMOJI[this.live]} ${this.live}` : '🤔 Unsure — show a clear shape';
    if (lab) { ctx.fillStyle = 'rgba(15,10,50,.85)'; const lw = Math.min(W * .9, 300), lx = (W - lw) / 2, ly = port ? 100 : 66; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, ly, lw, 38, 14) : ctx.rect(lx, ly, lw, 38); ctx.fill(); ctx.fillStyle = this.live ? '#7dffb0' : '#ffd23f'; ctx.font = '800 17px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, W / 2, ly + 19); }
    // touch buttons
    this.btns = []; if (this.sim) { const bw = Math.min(W * .28, 150), gap = bw * .12, x0 = (W - (bw * 3 + gap * 2)) / 2, by = H - bw - 24; [['rock', '✊'], ['paper', '✋'], ['scissors', '✌️']].forEach(([k, e], i) => { const x = x0 + i * (bw + gap); this.btns.push({ k, x, y: by, w: bw, h: bw }); ctx.fillStyle = this.pick === k ? '#ffe45e' : 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, by, bw, bw, 24) : ctx.rect(x, by, bw, bw); ctx.fill(); ctx.font = `${bw * .55}px serif`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(e, x + bw / 2, by + bw * .45); ctx.font = `800 ${bw * .13}px system-ui`; ctx.fillStyle = this.pick === k ? '#4a2200' : '#fff'; ctx.fillText(k.toUpperCase(), x + bw / 2, by + bw * .85); }); }
    this.fx.draw(ctx); this.pop.draw(ctx);
  }
}
