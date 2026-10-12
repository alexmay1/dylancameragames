import { Particles, Popups, bigText, rand, clamp, lerp, pick } from '../util.js?v=23';
import { SteerCal, pointerSteer } from '../skirules.js?v=23';

/* Skiing — lean left/right to steer. Dodge trees & rocks, pass through gates, hit ramps. 60 seconds, 3 lives. */
const TIME = 60, SLOPE = 8, ZMAX = 75;
export class SkiGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app; this.sim = !!a.balanceSim || (a.touchMode && !a.cameraOn);
    this.fx = new Particles(); this.pop = new Popups(); this.cal = new SteerCal(); this.t = 0; this.over = false; this.time = TIME; this.dist = 0; this.gates = 0; this.gatesMissed = 0; this.jumps = 0; this.lives = 3; this.score = 0;
    this.X = 0; this.camX = 0; this.vX = 0; this.speed = 0; this.vMax = 9; this.steer = 0; this.air = 0; this.crash = 0; this.inv = 0; this.objs = []; this.nextRow = 0; this.nextGate = 40; this.nextRamp = 95; this.travel = 0; this.noBody = 0; this.lastGate = 0; this.ptrSteer = 0; this.flash = 0;
    this.state = 'ready'; this.cd = this.sim ? 2.2 : 4; this.lastCd = 9; this.el = 0; this.lastPoseT = -1;
    a.pose.enabled = !this.sim; a.pose.minInterval = 40; a.setScoreLabel('Score'); a.setScore(0); this.prefill(); this.hud();
    a.hint(this.sim ? '⛷️ Move your finger left/right to steer. Dodge the trees, go through the gates!' : '⛷️ Stand tall in the middle, then LEAN your body left or right to steer!');
  }
  destroy() { this.app.pose.enabled = false; }
  hud() { const a = this.app; a.setLeft(`⏱ ${Math.ceil(Math.max(0, this.time))} · ${Math.floor(this.dist)}m`); a.setRight(`🚩 ${this.gates} ${'❤️'.repeat(this.lives)}`); a.setScore(this.score); }
  prefill() { for (let z = 10; z < ZMAX; z += 5) this.spawnRow(z, z > 20); }
  spawnRow(z, obstacles = true) {
    for (const s of [-1, 1]) this.objs.push({ t: 'deco', X: s * rand(SLOPE + .8, SLOPE + 7), Z: z + rand(-2, 2), sz: rand(.8, 1.3) });
    if (Math.random() < .5) this.objs.push({ t: 'deco', X: (Math.random() < .5 ? -1 : 1) * rand(SLOPE + 1, SLOPE + 12), Z: z + rand(0, 3), sz: rand(.8, 1.4) });
    if (obstacles && Math.random() < clamp(.5 + this.el * .004, .5, .8)) { const n = Math.random() < .35 ? 2 : 1; for (let i = 0; i < n; i++) this.objs.push({ t: Math.random() < .65 ? 'tree' : 'rock', X: rand(-SLOPE + 1.2, SLOPE - 1.2), Z: z + rand(0, 4), sz: rand(.9, 1.2), hit: false }); }
  }
  spawnGate(z) { const Xg = clamp(this.lastGate + rand(-4, 4), -5, 5); this.lastGate = Xg; this.objs.push({ t: 'gate', X: Xg, Z: z, done: false, ok: false, col: (this.gates + this.gatesMissed) % 2 }); }
  spawnRamp(z) { this.objs.push({ t: 'ramp', X: rand(-4, 4), Z: z, used: false }); }
  readSteer(dt, hands) {
    const a = this.app, now = performance.now() / 1000, s = a.pose.state;
    if (this.sim) { const ptr = hands.find(h => h.pointer); if (ptr && now - ptr.seen < 2) this.ptrSteer = pointerSteer(ptr.palm.x, a.W); this.steer = lerp(this.steer, this.ptrSteer, .35); return; }
    if (this.steerOverride !== undefined) { this.steer = this.steerOverride; return; }
    if (!(now - s.t < 1 && s.pts)) { this.noBody += dt; this.steer = lerp(this.steer, 0, .1); return; }
    const P = s.pts, vis = (i) => P[i] && (P[i].visibility ?? 1) > .3, m = (i) => a.mapPoint(P[i].x, P[i].y);
    if (!vis(11) || !vis(12)) { this.noBody += dt; return; }
    this.noBody = 0; const l = m(11), r = m(12), sw = Math.hypot(l.x - r.x, l.y - r.y); let x = (l.x + r.x) / 2; if (vis(0)) x = (x + m(0).x) / 2;
    if (s.t !== this.lastPoseT) { this.lastPoseT = s.t; } this.steer = this.cal.update(dt, x, sw);
  }
  update(dt, hands) {
    const a = this.app; this.t += dt; this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5);
    this.readSteer(dt, hands);
    if (!this.sim && this.noBody > 1.2) a.hint("I can't see your shoulders! Step back so your head and shoulders fit on screen. 🙋");
    if (this.state === 'ready') {
      this.cd -= dt; const n = Math.ceil(this.cd); if (n !== this.lastCd && n >= 1 && n <= 3) { this.lastCd = n; a.sfx.tick(); }
      if (this.cd <= 0 && (this.sim || this.cal.ready)) { this.state = 'run'; a.sfx.bell(); a.hint(null); } else if (this.cd <= -3 && !this.cal.ready) { this.state = 'run'; }
      this.camX = lerp(this.camX, this.X, .1); return;
    }
    if (this.state === 'dead') { this.camX = lerp(this.camX, this.X, .1); return; }
    this.time -= dt; this.el += dt; if (Math.ceil(this.time) !== this._c) { this._c = Math.ceil(this.time); this.hud(); }
    if (this.time <= 0) return this.finish('time');
    // speed & steering
    const vTarget = clamp(9 + this.el * .18, 9, 24); this.vMax = vTarget; this.speed += (vTarget * (this.crash > 0 ? .35 : 1) - this.speed) * Math.min(1, dt * (this.crash > 0 ? 6 : 1.2));
    this.crash = Math.max(0, this.crash - dt); this.inv = Math.max(0, this.inv - dt); this.air = Math.max(0, this.air - dt);
    const steerF = this.crash > 0 ? 0 : this.steer; this.vX += (steerF * (7 + this.speed * .14) - this.vX) * Math.min(1, dt * 8); this.X += this.vX * dt;
    if (Math.abs(this.X) > SLOPE - .3) { this.X = clamp(this.X, -SLOPE + .3, SLOPE - .3); this.vX *= .3; this.speed *= (1 - dt * .8); }
    this.camX = lerp(this.camX, this.X, 1 - Math.exp(-dt * 6));
    const d = this.speed * dt; this.dist += d; this.travel += d; this.score = Math.floor(this.dist / 10) + this.gates * 25 + this.jumps * 15;
    for (const o of this.objs) o.Z -= d;
    this.nextRow -= d; while (this.nextRow <= 0) { this.spawnRow(ZMAX + this.nextRow * -1 + 0, true); this.nextRow += 5; }
    this.nextGate -= d; if (this.nextGate <= 0) { this.spawnGate(ZMAX); this.nextGate = rand(38, 52); }
    this.nextRamp -= d; if (this.nextRamp <= 0) { this.spawnRamp(ZMAX); this.nextRamp = rand(85, 120); }
    // snow spray
    if (this.air <= 0 && (Math.abs(this.vX) > 3.5 || Math.random() < .2)) { const v = this.view(), sk = this.skierPos(v); this.fx.burst(sk.x, sk.y, 200, 1, 160, 3); }
    // interactions
    for (const o of this.objs) {
      if (o.t === 'tree' || o.t === 'rock') { if (!o.hit && o.Z < .9 && o.Z > -.6 && this.air <= 0 && this.inv <= 0 && Math.abs(o.X - this.X) < (o.t === 'tree' ? .85 : .7) * o.sz) { o.hit = true; this.hitObstacle(o); } }
      else if (o.t === 'gate' && !o.done && o.Z <= 0) { o.done = true; if (Math.abs(o.X - this.X) < 1.7) { o.ok = true; this.gates++; this.score += 0; a.sfx.bell(); const v = this.view(); this.pop.add(v.W / 2, v.H * .45, 'GATE! +25', '#7dffb0', Math.max(26, a.min * .06)); this.flash = .3; } else { this.gatesMissed++; a.sfx.miss(); } this.hud(); }
      else if (o.t === 'ramp' && !o.used && o.Z <= .5 && o.Z > -3) { if (Math.abs(o.X - this.X) < 1.7) { o.used = true; this.air = .95; this.jumps++; a.sfx.whoosh(); const v = this.view(); this.pop.add(v.W / 2, v.H * .4, 'JUMP! +15', '#ffe45e', Math.max(26, a.min * .06)); } else if (o.Z < -2) o.used = true; }
    }
    this.objs = this.objs.filter(o => o.Z > -4);
    if (this.t % 1 < dt) this.hud();
  }
  hitObstacle(o) {
    const a = this.app; this.lives--; this.crash = 1.1; this.inv = 2.2; this.speed *= .4; this.flash = 1; a.sfx.ouch(); a.sfx.punch(); const v = this.view(), sk = this.skierPos(v); this.fx.burst(sk.x, sk.y - 30, 200, 24, 400, 7);
    this.pop.add(v.W / 2, v.H * .5, this.lives > 0 ? 'OUCH!' : 'WIPEOUT!', '#ff8a8a', Math.max(30, a.min * .08)); this.hud();
    if (this.lives <= 0) { this.state = 'dead'; setTimeout(() => this.finish('crash'), 900); }
  }
  finish(why) {
    const a = this.app; if (this.over) return; this.over = true; a.hint(null); a.sfx.bell(); this.hud();
    setTimeout(() => { if (a.game === this || !a.game) a.showResult({ title: why === 'time' ? (this.score >= 150 ? 'Olympic skier!' : this.score >= 80 ? 'Great run!' : 'Nice run!') : 'Wipeout! Try again', emoji: this.score >= 80 ? '🏆' : '⛷️', score: this.score, stats: [['Distance', Math.floor(this.dist) + ' m'], ['Gates', this.gates], ['Jumps', this.jumps]] }); }, why === 'time' ? 500 : 300);
  }
  view() { const { W, H } = this.app, port = W < H, d0 = 3, s0 = W * (port ? .24 : .15), hy = H * (port ? .32 : .3), y0 = H * (port ? .8 : .8), camH = (y0 - hy) / s0; return { W, H, d0, s0, K: s0 * d0, hy, y0, camH, cx: W / 2 }; }
  P(v, X, Z, h = 0) { const s = v.K / Math.max(.3, Z + v.d0); return { x: v.cx + (X - this.camX) * s, y: v.hy + (v.camH - h) * s, s, gy: v.hy + v.camH * s }; }
  skierPos(v) { const p = this.P(v, this.X, 0, 0); const up = this.air > 0 ? Math.sin(Math.PI * (1 - this.air / .95)) * 1.6 * v.s0 : 0; return { x: p.x, y: p.y - up, gy: p.y, s: p.s, up }; }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view();
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#4aa3ff'); g.addColorStop(1, '#cfeaff'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 2);
    ctx.fillStyle = '#9db8d8'; ctx.beginPath(); ctx.moveTo(0, v.hy); for (let i = 0; i <= 10; i++) ctx.lineTo(W * i / 10 - this.camX * 6 % 20, v.hy - (i % 2 ? .13 : .06) * H - Math.sin(i * 2.1) * H * .03); ctx.lineTo(W, v.hy); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); for (let i = 1; i < 10; i += 2) { const x = W * i / 10, y = v.hy - .13 * H - Math.sin(i * 2.1) * H * .03; ctx.moveTo(x - 24, y + 26); ctx.lineTo(x, y); ctx.lineTo(x + 24, y + 26); } ctx.fill();
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#e9f3fb'); g.addColorStop(1, '#ffffff'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    // slope stripes (scroll with travel) + rough snow outside the piste
    const off = this.travel % 8;
    for (let k = 0; k < 14; k++) { const z0 = k * 6 - off, z1 = z0 + 3, p0 = this.P(v, 0, Math.max(0, z0)), p1 = this.P(v, 0, Math.max(0, z1)); if (z1 <= 0) continue; ctx.fillStyle = 'rgba(180,205,235,.35)'; ctx.fillRect(0, p1.y, W, Math.max(1, p0.y - p1.y)); }
    for (const sgn of [-1, 1]) { ctx.fillStyle = 'rgba(120,150,190,.28)'; ctx.beginPath(); const a0 = this.P(v, sgn * SLOPE, 0), a1 = this.P(v, sgn * SLOPE, ZMAX), far = sgn < 0 ? 0 : W, nearx = sgn < 0 ? 0 : W; ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(far, a1.y); ctx.lineTo(nearx, a0.y); ctx.closePath(); ctx.fill(); }
    // objects far -> near
    const list = this.objs.filter(o => o.Z > -2).sort((p, q) => q.Z - p.Z);
    let drewSkier = false;
    for (const o of list) { if (!drewSkier && o.Z < 0) { this.drawSkier(ctx, v); drewSkier = true; } this.drawObj(ctx, v, o); }
    if (!drewSkier) this.drawSkier(ctx, v);
    this.fx.draw(ctx); this.pop.draw(ctx);
    // speed lines
    if (this.speed > 14 && this.state === 'run') { ctx.strokeStyle = `rgba(255,255,255,${clamp((this.speed - 14) / 20, 0, .5)})`; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < 14; i++) { const x = (i * 97.3 + this.travel * 40) % W, y = (i * 53.7 + this.travel * 90) % H; ctx.moveTo(x, y); ctx.lineTo(x + (x - W / 2) * .03, y + 22); } ctx.stroke(); }
    if (this.state === 'ready') { const n = Math.ceil(this.cd); bigText(ctx, !this.sim && !this.cal.ready ? 'STAND TALL…' : n >= 1 && n <= 3 ? String(n) : 'GO!', W / 2, H * .38, min * (this.cal.ready || this.sim ? .24 : .11)); }
    // lean indicator
    if (!this.sim || true) { const bw = Math.min(W * .5, 240), bx = (W - bw) / 2, by = H - 30; ctx.fillStyle = 'rgba(15,10,50,.6)'; ctx.fillRect(bx, by, bw, 12); ctx.fillStyle = '#ffe45e'; const mx = bx + bw / 2 + this.steer * bw / 2; ctx.fillRect(mx - 5, by - 4, 10, 20); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(bx + bw / 2 - 1, by, 2, 12); }
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,70,50,${this.flash * .35})`; ctx.fillRect(0, 0, W, H); }
  }
  drawObj(ctx, v, o) {
    const p = this.P(v, o.X, Math.max(o.Z, -1.5)); if (p.s < 3) return; const s = p.s;
    if (o.t === 'tree' || o.t === 'deco') {
      const h = (o.t === 'deco' ? 4.2 : 3.4) * (o.sz || 1) * s, w = h * .5, x = p.x, y = p.gy; ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.ellipse(x, y, w * .55, w * .12, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x - w * .06, y - h * .18, w * .12, h * .18);
      for (let i = 0; i < 3; i++) { const yy = y - h * (.12 + i * .27), ww = w * (1 - i * .22); ctx.fillStyle = i % 2 ? '#2c8a46' : '#1f7a3a'; ctx.beginPath(); ctx.moveTo(x - ww * .5, yy); ctx.lineTo(x, yy - h * .42); ctx.lineTo(x + ww * .5, yy); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.moveTo(x - ww * .22, yy - h * .17); ctx.lineTo(x, yy - h * .42); ctx.lineTo(x + ww * .22, yy - h * .17); ctx.fill(); }
    } else if (o.t === 'rock') { const w = 1.5 * o.sz * s; ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.beginPath(); ctx.ellipse(p.x, p.gy, w * .6, w * .15, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = '#7c8794'; ctx.beginPath(); ctx.moveTo(p.x - w * .55, p.gy); ctx.quadraticCurveTo(p.x - w * .4, p.gy - w * .75, p.x, p.gy - w * .65); ctx.quadraticCurveTo(p.x + w * .5, p.gy - w * .7, p.x + w * .55, p.gy); ctx.fill(); ctx.fillStyle = '#a6b0bc'; ctx.beginPath(); ctx.ellipse(p.x - w * .1, p.gy - w * .45, w * .2, w * .12, -.4, 0, 6.3); ctx.fill(); }
    else if (o.t === 'gate') {
      const A = this.P(v, o.X - 1.6, Math.max(o.Z, -1.5)), B = this.P(v, o.X + 1.6, Math.max(o.Z, -1.5)), h = 2.6 * s, col = o.done ? (o.ok ? '#3ddc6b' : '#888') : (o.col ? '#2f7fe0' : '#e63946');
      ctx.strokeStyle = '#444'; ctx.lineWidth = Math.max(2, s * .06); ctx.beginPath(); ctx.moveTo(A.x, A.gy); ctx.lineTo(A.x, A.gy - h); ctx.moveTo(B.x, B.gy); ctx.lineTo(B.x, B.gy - h); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(A.x, A.gy - h); ctx.lineTo(A.x + s * .9, A.gy - h * .88); ctx.lineTo(A.x, A.gy - h * .75); ctx.fill(); ctx.beginPath(); ctx.moveTo(B.x, B.gy - h); ctx.lineTo(B.x - s * .9, B.gy - h * .88); ctx.lineTo(B.x, B.gy - h * .75); ctx.fill();
      if (!o.done) { ctx.strokeStyle = 'rgba(255,230,90,.5)'; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.moveTo(A.x, A.gy); ctx.lineTo(B.x, B.gy); ctx.stroke(); ctx.setLineDash([]); }
    } else if (o.t === 'ramp') {
      const a0 = this.P(v, o.X - 1.6, Math.max(o.Z, -1.5), 0), a1 = this.P(v, o.X + 1.6, Math.max(o.Z, -1.5), 0), b0 = this.P(v, o.X - 1.6, o.Z + 2.6, .9), b1 = this.P(v, o.X + 1.6, o.Z + 2.6, .9), c0 = this.P(v, o.X - 1.6, o.Z + 2.6, 0), c1 = this.P(v, o.X + 1.6, o.Z + 2.6, 0);
      ctx.fillStyle = '#a77b4a'; ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b0.x, b0.y); ctx.fill(); ctx.fillStyle = '#7a5530'; ctx.beginPath(); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c0.x, c0.y); ctx.fill();
      ctx.strokeStyle = '#ffe45e'; ctx.lineWidth = Math.max(2, a0.s * .08); ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(b0.x, b0.y); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
    }
  }
  drawSkier(ctx, v) {
    const sk = this.skierPos(v), s = v.s0 * .55, tilt = this.steer * .38 + (this.crash > 0 ? Math.sin(this.crash * 18) * .6 : 0), blink = this.inv > 0 && Math.floor(this.t * 14) % 2 === 0;
    if (blink && this.crash <= 0) return;
    ctx.save(); ctx.fillStyle = `rgba(0,0,0,${this.air > 0 ? .18 : .2})`; ctx.beginPath(); ctx.ellipse(sk.x, sk.gy + 4, s * .7, s * .12, 0, 0, 6.3); ctx.fill();
    ctx.translate(sk.x, sk.y); ctx.rotate(tilt);
    ctx.strokeStyle = '#222'; ctx.lineWidth = s * .09; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-s * .22, s * .02); ctx.lineTo(-s * .26, -s * 1.15 * .25 + s * 1.15 * .0 - s * .02); ctx.moveTo(s * .22, s * .02); ctx.lineTo(s * .26, -s * .3); ctx.stroke();
    ctx.strokeStyle = '#2f7fe0'; ctx.lineWidth = s * .12; ctx.beginPath(); ctx.moveTo(-s * .24, s * .08); ctx.lineTo(-s * .24, -s * .95 * .1 - s * .5 * 0 + s * -.0); ctx.moveTo(s * .24, s * .08); ctx.lineTo(s * .24, -s * .1); ctx.stroke();
    ctx.fillStyle = '#e8402e'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-s * .3, -s * 1.0, s * .6, s * .72, s * .15) : ctx.rect(-s * .3, -s * 1.0, s * .6, s * .72); ctx.fill();
    ctx.strokeStyle = '#e8402e'; ctx.lineWidth = s * .13; ctx.beginPath(); ctx.moveTo(-s * .28, -s * .9); ctx.lineTo(-s * (.6 + Math.abs(this.steer) * .1), -s * .55); ctx.moveTo(s * .28, -s * .9); ctx.lineTo(s * (.6 + Math.abs(this.steer) * .1), -s * .55); ctx.stroke();
    ctx.strokeStyle = '#555'; ctx.lineWidth = s * .04; ctx.beginPath(); ctx.moveTo(-s * (.6 + Math.abs(this.steer) * .1), -s * .55); ctx.lineTo(-s * .75, s * .1); ctx.moveTo(s * (.6 + Math.abs(this.steer) * .1), -s * .55); ctx.lineTo(s * .75, s * .1); ctx.stroke();
    ctx.fillStyle = '#ffd7b0'; ctx.beginPath(); ctx.arc(0, -s * 1.15, s * .2, 0, 6.3); ctx.fill(); ctx.fillStyle = '#2f7fe0'; ctx.beginPath(); ctx.arc(0, -s * 1.2, s * .22, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(-s * .2, -s * 1.17, s * .4, s * .06);
    if (this.crash > 0) { ctx.fillStyle = '#fff'; ctx.font = `${s * .4}px serif`; ctx.textAlign = 'center'; for (let i = 0; i < 3; i++) { const an = this.t * 9 + i * 2.1; ctx.fillText('⭐', Math.cos(an) * s * .6, -s * 1.5 + Math.sin(an) * s * .15); } }
    ctx.restore();
  }
}
