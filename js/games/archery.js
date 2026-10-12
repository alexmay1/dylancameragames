import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { TARGET_R, impact, ringScore, flightT, ArcheryInput } from '../archrules.js?v=23';

/* Archery — hold your hand steady to aim, pull back (down) and release (up) to shoot. 10 arrows. */
const DIST = [12, 12, 15, 15, 20, 20, 25, 25, 30, 35], N = 10;
export class ArcheryGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app; this.sim = a.touchMode && !a.cameraOn;
    this.fx = new Particles(); this.pop = new Popups(); this.inp = new ArcheryInput(); this.t = 0; this.over = false; this.n = 0; this.total = 0; this.xs = 0; this.misses = 0; this.shots = [];
    this.aim = { x: a.W / 2, y: a.H * .45 }; this.pull = 0; this.pd = null; this.state = 'ready'; this.sT = 1.8; this.arrow = null; this.hasHand = false; this.newTarget();
    this.onDown = (e) => { if (!this.sim) return; this.pd = { x: e.clientX, y: e.clientY }; this.aim = { x: e.clientX, y: e.clientY }; this.pull = 0; };
    this.onMove = (e) => { if (!this.sim) return; if (!this.pd) this.aim = { x: e.clientX, y: e.clientY }; else this.pull = clamp((e.clientY - this.pd.y) / (a.min * .22), 0, 1); };
    this.onUp = () => { if (!this.sim || !this.pd) return; const d = this.pull; this.pd = null; this.pull = 0; if (d > .1 && this.state === 'aim') this.release(.2 + .8 * d); };
    a.canvasEl = document.getElementById('stage'); for (const [k, f] of [['pointerdown', this.onDown], ['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onUp]]) a.canvasEl.addEventListener(k, f);
    a.setScoreLabel('Score'); a.setScore(0); this.hud();
    a.hint(this.sim ? '🏹 Move to aim. Press, drag DOWN to pull the bow back, then let go to shoot!' : '🏹 Hold your hand steady to aim. Pull it DOWN fast, then back UP to shoot! (Or use two hands: spread apart, then bring together.)');
  }
  destroy() { const a = this.app; if (a.canvasEl) for (const [k, f] of [['pointerdown', this.onDown], ['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onUp]]) a.canvasEl.removeEventListener(k, f); }
  hud() { const a = this.app; a.setLeft(`🏹 Arrow ${Math.min(this.n + 1, N)}/${N}`); a.setRight(`💨 ${this.wind < 0 ? '←' : '→'} ${Math.abs(this.wind).toFixed(1)}`); a.setScore(this.total); }
  view() { const { W, H, min } = this.app, D = this.D, R = Math.min(min * .26 * 12 / D, W * .3), ppm = R / TARGET_R, hy = H * .4; const lim = Math.max(0, W / 2 - R * 1.15), ox = clamp(this.offX * ppm, -lim, lim); return { W, H, R, ppm, hy, cx: W / 2 + ox, cy: hy + .3 * ppm * 1.0 + (D < 15 ? 0 : -R * .1) }; }
  newTarget() { this.D = DIST[Math.min(this.n, N - 1)]; this.wind = (Math.random() * 2 - 1) * (.5 + this.n * .3); this.offX = rand(-1.6, 1.6); this.stuck = []; }
  release(power) {
    const a = this.app, v = this.view(), D = this.D; if (this.state !== 'aim') return;
    const aim = { x: this.aim.x - v.cx, y: this.aim.y - v.cy }, im = impact(aim, v.ppm, D, power, this.wind); im.dx += rand(-.012, .012); im.dy += rand(-.012, .012);
    const sc = ringScore(im.dx, im.dy); this.arrow = { t: 0, T: flightT(D, power) * .9 + .15, im, sc, from: { x: a.W / 2, y: a.H * .9 }, power };
    this.state = 'flight'; this.pull = 0; this.inp.reset(); a.sfx.swish(); a.sfx.tick(); a.hint(null);
  }
  land() {
    const a = this.app, v = this.view(), ar = this.arrow, sc = ar.sc; this.stuck.push({ dx: ar.im.dx, dy: ar.im.dy }); this.n++; this.total += sc.pts; if (sc.x) this.xs++; if (!sc.pts) this.misses++;
    const px = v.cx + ar.im.dx * v.ppm, py = v.cy + ar.im.dy * v.ppm; this.arrow = null; this.state = 'score'; this.sT = 1.5;
    if (sc.pts) { a.sfx.thwack(); this.fx.burst(px, py, 45, 8, 160, 4); } else a.sfx.miss();
    if (sc.pts >= 9) a.sfx.cheer();
    this.pop.add(px, py - v.R * .3, sc.x ? 'BULLSEYE! 10' : sc.pts ? `${sc.pts}` : 'MISS', sc.pts >= 9 ? '#ffe45e' : sc.pts ? '#fff' : '#ff8a8a', Math.max(32, a.min * .09));
    this.hud();
  }
  update(dt, hands) {
    const a = this.app, v = this.view(); this.t += dt; this.fx.update(dt); this.pop.update(dt);
    if (this.state === 'ready') { this.sT -= dt; if (this.sT <= 0) this.state = 'aim'; }
    else if (this.state === 'aim') {
      if (!this.sim) {
        const o = this.inp.update(this.t, dt, hands, a.min); this.hasHand = o.seen; if (o.aim) { this.aim.x = lerp(this.aim.x, o.aim.x, .5); this.aim.y = lerp(this.aim.y, o.aim.y, .5); this.aim.x = clamp(this.aim.x, 0, a.W); this.aim.y = clamp(this.aim.y, 0, a.H * .9); } this.pull = o.draw; this.mode = o.mode;
        if (o.release) { if (o.aim) this.aim = { x: o.aim.x, y: o.aim.y }; this.release(o.release.power); }
      }
    } else if (this.state === 'flight') {
      const ar = this.arrow; ar.t += dt; if (ar.t >= ar.T) this.land();
    } else if (this.state === 'score') {
      this.sT -= dt; if (this.sT <= 0) { if (this.n >= N) return this.finish(); this.newTarget(); this.state = 'aim'; this.aim = { x: a.W / 2, y: this.view().cy }; this.inp.reset(); this.hud(); }
    }
  }
  finish() {
    const a = this.app; if (this.over) return; this.over = true; a.sfx.bell();
    a.showResult({ title: this.total >= 85 ? 'Robin Hood!' : this.total >= 60 ? 'Sharp shooter!' : this.total >= 35 ? 'Nice shooting!' : 'Keep practicing!', emoji: this.total >= 60 ? '🏆' : '🏹', score: this.total, stats: [['Bullseyes', this.xs], ['Misses', this.misses], ['Out of', 100]] });
  }
  drawTarget(ctx, v) {
    const { cx, cy, R, ppm } = v, cols = ['#f5f5f5', '#f5f5f5', '#222', '#222', '#2f7fe0', '#2f7fe0', '#e63946', '#e63946', '#ffd23f', '#ffd23f'];
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(cx - R * .04, cy, R * .08, R * 1.7); ctx.beginPath(); ctx.moveTo(cx - R * .7, cy + R * 1.7); ctx.lineTo(cx, cy + R * .6); ctx.lineTo(cx + R * .7, cy + R * 1.7); ctx.lineWidth = R * .05; ctx.strokeStyle = '#6b4a2a'; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(cx, cy + R * 1.72, R * .8, R * .08, 0, 0, 6.3); ctx.fill();
    for (let i = 0; i < 10; i++) { ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.arc(cx, cy, R * (1 - i / 10), 0, 6.3); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    for (const s of this.stuck) this.drawArrowStuck(ctx, cx + s.dx * ppm, cy + s.dy * ppm, R);
  }
  drawArrowStuck(ctx, x, y, R) { ctx.strokeStyle = '#d9c7a0'; ctx.lineWidth = Math.max(2, R * .03); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + R * .12, y + R * .22); ctx.stroke(); ctx.strokeStyle = '#e63946'; ctx.beginPath(); ctx.moveTo(x + R * .09, y + R * .17); ctx.lineTo(x + R * .12, y + R * .22); ctx.stroke(); }
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view();
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#5bb6ff'); g.addColorStop(1, '#cdeeff'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 1);
    ctx.fillStyle = '#8fb3c8'; ctx.beginPath(); ctx.moveTo(0, v.hy); for (let i = 0; i <= 8; i++) ctx.lineTo(W * i / 8, v.hy - (i % 2 ? .1 : .05) * H - Math.sin(i * 1.7) * H * .02); ctx.lineTo(W, v.hy); ctx.fill();
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#6fcf5a'); g.addColorStop(1, '#2f8f3a'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 20, v.hy); ctx.lineTo(W / 2 + i * W * .35, H); ctx.stroke(); }
    // wind flag
    const wx = W * .88, wy = v.hy + H * .04; ctx.strokeStyle = '#444'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(wx, wy + 30); ctx.lineTo(wx, wy - 30); ctx.stroke(); ctx.fillStyle = '#ff5a5a'; const fl = Math.sign(this.wind) * (8 + Math.abs(this.wind) * 9), wv = Math.sin(this.t * 6) * 3; ctx.beginPath(); ctx.moveTo(wx, wy - 30); ctx.lineTo(wx + fl, wy - 26 + wv); ctx.lineTo(wx, wy - 12); ctx.fill();
    // distance label
    this.drawTarget(ctx, v);
    ctx.fillStyle = 'rgba(15,10,50,.8)'; ctx.font = `800 ${clamp(min * .035, 14, 20)}px system-ui`; const dl = `${this.D} m`, tw = ctx.measureText(dl).width + 24; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(v.cx - tw / 2, v.cy + v.R + 8, tw, 30, 12) : ctx.rect(v.cx - tw / 2, v.cy + v.R + 8, tw, 30); ctx.fill(); ctx.fillStyle = '#ffe45e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(dl, v.cx, v.cy + v.R + 23);
    // arrow in flight
    if (this.arrow) { const ar = this.arrow, k = clamp(ar.t / ar.T, 0, 1), ix = v.cx + ar.im.dx * v.ppm, iy = v.cy + ar.im.dy * v.ppm, A = H * .12, x = lerp(ar.from.x, ix, k), y = lerp(ar.from.y, iy, k) - Math.sin(Math.PI * k) * A, s = lerp(1, .12, k), L = min * .2 * s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2((iy - ar.from.y) - Math.PI * Math.cos(Math.PI * k) * A, ix - ar.from.x)); ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = Math.max(2, 6 * s); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(0, 0); ctx.stroke(); ctx.fillStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(0, -4 * s - 1); ctx.lineTo(L * .2, 0); ctx.lineTo(0, 4 * s + 1); ctx.fill(); ctx.strokeStyle = '#e63946'; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(-L * .8, 0); ctx.stroke(); ctx.restore(); }
    // bow
    if (this.state === 'aim' || this.state === 'ready' || this.state === 'score') {
      const bx = W / 2, by = H * .98, bh = min * .34, pull = this.pull * min * .1, ax = this.aim.x - bx, ay = this.aim.y - by, al = Math.hypot(ax, ay) || 1;
      ctx.strokeStyle = '#7a4a1e'; ctx.lineWidth = Math.max(6, min * .014); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx - bh * .5, by + bh * .1); ctx.quadraticCurveTo(bx, by - bh * .5, bx + bh * .5, by + bh * .1); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx - bh * .5, by + bh * .1); ctx.lineTo(bx, by + bh * .1 + pull * 3); ctx.lineTo(bx + bh * .5, by + bh * .1); ctx.stroke();
      if (this.state === 'aim') { ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = Math.max(3, min * .008); ctx.beginPath(); ctx.moveTo(bx, by + bh * .1 + pull * 3); ctx.lineTo(bx + ax / al * min * .32, by + bh * .1 + pull * 3 + ay / al * min * .32 - min * .02); ctx.stroke(); }
    }
    // crosshair
    if (this.state === 'aim' || this.state === 'ready') {
      const c = this.aim, r = min * .035 * (1 - this.pull * .3); ctx.strokeStyle = this.pull > 0 ? '#ffe45e' : '#ff4d4d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 6.3); ctx.moveTo(c.x - r * 1.6, c.y); ctx.lineTo(c.x + r * 1.6, c.y); ctx.moveTo(c.x, c.y - r * 1.6); ctx.lineTo(c.x, c.y + r * 1.6); ctx.stroke();
    }
    // power meter
    if (this.state === 'aim' && (this.pull > 0 || this.sim)) { const mx = W - 34, mh = min * .4, my = H * .55 - mh / 2; ctx.fillStyle = 'rgba(15,10,50,.7)'; ctx.fillRect(mx - 14, my - 8, 28, mh + 16); ctx.fillStyle = 'rgba(125,255,176,.35)'; ctx.fillRect(mx - 10, my, 20, mh * .3); ctx.fillStyle = '#ffd23f'; ctx.fillRect(mx - 10, my + mh * (1 - this.pull), 20, mh * this.pull); ctx.fillStyle = '#fff'; ctx.font = '800 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('PULL', mx, my + mh + 20); }
    if (!this.sim && this.state === 'aim' && this.t > 3 && !this.hasHand) { ctx.fillStyle = 'rgba(15,10,50,.85)'; ctx.font = '800 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🖐 Hold your hand up in view of the camera', W / 2, H * .72); }
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.state === 'ready') bigText(ctx, 'AIM!', W / 2, H * .3, min * .16);
  }
}
