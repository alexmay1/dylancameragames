import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { ReleaseDetector } from '../gestures.js?v=23';
import { HOLES, terrainAt, modeAt, MODE, shotResult, holePoints, holeName, lineDist } from '../golfrules.js?v=23';

/* Golf — swing your hand like a club and let go. 3 holes. Hand x = aim, swing speed = power. Auto-picks DRIVE / PITCH / PUTT. */
const MAX_STROKES = 8, CAMH = 2.5, BACK = 6, DEG = Math.PI / 180;

export class GolfGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd(); this.crowd.excite = 0;
    this.hole = 0; this.card = []; this.total = 0; this.score = 0; this.over = false; this.t = 0; this.det = {}; this.detMode = ''; this.lastHand = null; this.flash = 0;
    a.sfx.crowdStart(.03); a.sfx.crowdLevel(.12, 1); a.setScoreLabel('Points'); a.setScore(0);
    this.startHole();
  }
  destroy() { this.app.sfx.crowdStop(); }
  startHole() {
    const a = this.app, h = HOLES[this.hole]; this.strokes = 0; this.ball = { x: 0, y: 0 }; this.last = { x: 0, y: 0 }; this.state = 'ready'; this.delay = 1; this.shot = null; this.holed = false;
    const ang = rand(0, 6.28), sp = rand(1, 7); this.wind = { x: Math.sin(ang) * sp, y: Math.cos(ang) * sp, sp };
    // trees (seeded per hole)
    let s = 777 + this.hole * 131; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; this.trees = [];
    const L = Math.hypot(h.hole.x, h.hole.y), nx = h.hole.y / L, ny = -h.hole.x / L;
    for (let d = -8; d < L + 40; d += 7 + rnd() * 6) for (const sg of [-1, 1]) { const off = sg * (h.fw / 2 + 5 + rnd() * 16), px = (h.hole.x / L) * d + nx * off, py = (h.hole.y / L) * d + ny * off; const p = { x: px, y: py }; if (terrainAt(h, p) === 'rough') this.trees.push({ x: px, y: py, sz: .8 + rnd() * .5, hue: rnd() }); }
    this.cam = { x: 0, y: 0, ang: Math.atan2(h.hole.x, h.hole.y) }; this.snapCam();
    this.hud(); this.setMode();
    a.banner(`<span style="font-size:.55em">Hole ${this.hole + 1} · Par ${h.par}</span>`, 1300);
    if (this.hole === 0) a.hint(a.touchMode && !a.cameraOn ? '🏌️ Swipe your finger FAST then let go to hit! Where you swipe sets the aim.' : '🏌️ Swing your arm like a golf club, then let go! Hand left/right = aim, faster = farther.');
  }
  snapCam() { const h = HOLES[this.hole], b = this.ball; this.camT = { x: b.x, y: b.y, ang: Math.atan2(h.hole.x - b.x, h.hole.y - b.y) }; if (this.state === 'ready' && !this.shot) Object.assign(this.cam, this.camT); }
  setMode() { const h = HOLES[this.hole]; this.mode = modeAt(h, this.ball); if (this.mode !== this.detMode) { this.detMode = this.mode; this.det = {}; } }
  hud() { const a = this.app, h = HOLES[this.hole]; a.setLeft(`Hole ${this.hole + 1}/3 · Par ${h.par}`); a.setRight(`Strokes ${this.strokes}`); a.setScore(this.score); }
  dToHole() { const h = HOLES[this.hole]; return Math.hypot(h.hole.x - this.ball.x, h.hole.y - this.ball.y); }

  update(dt, hands) {
    const a = this.app, now = performance.now() / 1000; this.t += dt;
    this.fx.update(dt); this.pop.update(dt); this.flash = Math.max(0, this.flash - dt * 2.5);
    const ca = this.cam, ct = this.camT, k = 1 - Math.exp(-dt * 3.2); let da = ct.ang - ca.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    if (this.state !== 'fly' && this.state !== 'roll') { ca.x = lerp(ca.x, ct.x, k); ca.y = lerp(ca.y, ct.y, k); ca.ang += da * k; }
    const hand = hands.find(q => !q.pointer) || hands[0]; if (hand) this.lastHand = hand;
    if (this.state === 'ready') {
      this.delay -= dt;
      if (this.delay <= 0) for (const hh of hands) {
        const cfg = MODE[this.mode], d = this.det[hh.id] || (this.det[hh.id] = new ReleaseDetector({ hi: cfg.hi, max: cfg.max, drop: cfg.drop, cool: 1 }));
        const r = d.push(now, { speed: hh.speed, vx: hh.vel.x, vy: hh.vel.y, x: hh.palm.x, y: hh.palm.y });
        if (r) { this.swing(r); break; }
      }
    } else if (this.state === 'fly') {
      const s = this.shot; s.t += dt; if (s.t >= s.T) { s.t = s.T; this.state = 'roll'; s.rt = 0; if (s.res.terrain === 'water') { this.fx.burst(0, 0, 200, 0); } this.landed(); }
    } else if (this.state === 'roll') {
      const s = this.shot; s.rt += dt; if (s.rt >= s.RT) this.settle();
    } else if (this.state === 'sink') { this.sinkT -= dt; if (this.sinkT <= 0) this.endHole(); }
    else if (this.state === 'card') { this.cardT -= dt; if (this.cardT <= 0) { if (this.hole >= HOLES.length - 1) this.finish(); else { this.hole++; this.startHole(); } } }
  }
  swing(r) {
    const a = this.app, h = HOLES[this.hole], aim = clamp((r.x - a.W / 2) / (a.W * .35), -1, 1) * 12 * DEG + clamp(r.dir, -1, 1) * 10 * DEG, noise = (Math.random() - .5) * 2 * 1.2 * DEG * r.power;
    const res = shotResult(h, this.ball, { mode: this.mode, power: r.power, aim, noise, wind: this.mode === 'putt' ? { x: 0, y: 0 } : this.wind });
    this.strokes++; this.last = { ...this.ball }; a.hint(null); this.hud();
    const T = this.mode === 'putt' ? .001 : .9 + res.D / 160;
    this.shot = { res, t: 0, T, from: { ...this.ball }, peak: this.mode === 'putt' ? 0 : clamp(res.D * .13, 3, 18), rt: 0, RT: this.mode === 'putt' ? clamp(res.D / 7, .35, 2.6) : .6, mode: this.mode };
    this.state = this.mode === 'putt' ? 'roll' : 'fly'; a.sfx.thwack(); if (this.mode !== 'putt') a.sfx.whoosh();
    if (this.mode === 'putt') { this.shot.land = res.rest; }
  }
  landed() {
    const a = this.app, r = this.shot.res; if (this.mode === 'putt') return;
    if (r.penalty) { a.sfx.plop(); this.pop.add(a.W / 2, a.H * .5, r.terrain === 'water' ? '💦 SPLASH! +1 stroke' : 'Out of bounds! +1 stroke', '#bfe6ff', Math.max(26, a.min * .05)); }
    else a.sfx.bounce();
  }
  settle() {
    const a = this.app, h = HOLES[this.hole], r = this.shot.res; this.state = 'ready'; this.delay = .9;
    if (r.penalty) { this.strokes++; this.ball = { ...this.last }; }
    else this.ball = { ...r.rest };
    if (r.holed && !r.penalty) { this.holed = true; this.state = 'sink'; this.sinkT = 1.6; a.sfx.cup(); const nm = holeName(h.par, this.strokes); a.banner(`⛳ ${nm}`, 1500); a.sfx.crowdCheer(this.strokes <= h.par ? 1 : .5); a.sfx.cheer(); this.fx.confetti(a.W / 2, a.H * .45, 60); this.crowd.excite = 1; this.hud(); return; }
    if (this.strokes >= MAX_STROKES) { a.banner('Pick up! (max strokes)', 1200); this.state = 'sink'; this.sinkT = 1.4; this.holed = false; this.hud(); return; }
    this.hud(); this.shot = null; this.setMode(); this.snapCam();
    const D = Math.round(this.dToHole()); a.hint(this.mode === 'putt' ? '⛳ On the green! Swing SLOW and gentle to putt.' : null);
  }
  endHole() {
    const h = HOLES[this.hole], pts = holePoints(h.par, this.strokes); this.score += pts; this.card.push({ par: h.par, strokes: this.strokes, pts }); this.total += this.strokes; this.hud();
    this.state = 'card'; this.cardT = 3; this.shot = null; this.app.setScore(this.score);
  }
  finish() {
    const a = this.app, par = HOLES.reduce((s, h) => s + h.par, 0), diff = this.total - par; this.over = true; this.state = 'over'; a.hint(null); a.sfx.crowdCheer(.7); setTimeout(() => a.sfx.crowdStop(), 2000);
    a.showResult({ title: diff <= -1 ? 'Golf pro!' : diff <= 2 ? 'Nice round!' : 'Good effort!', emoji: diff <= -1 ? '🏆' : '⛳', score: this.score, stats: [['Strokes', this.total], ['Par', par], ['Score', diff === 0 ? 'Even' : (diff > 0 ? '+' : '') + diff]].concat(this.card.map((c, i) => [`Hole ${i + 1}`, `${c.strokes}/${c.par}`])) });
  }

  /* ---------- camera / projection ---------- */
  view() { const { W, H } = this.app, port = W < H; return { W, H, cx: W / 2, hy: H * .33, K: H * (port ? 1.0 : 1.22) }; }
  proj(v, x, y, h = 0, clampBack = false) {
    const c = this.cam, fx = Math.sin(c.ang), fy = Math.cos(c.ang), dx = x - c.x, dy = y - c.y; let fwd = dx * fx + dy * fy; const lat = dx * fy - dy * fx;
    if (clampBack) fwd = Math.max(fwd, -BACK + 1.6); const d = fwd + BACK; if (d < .9) return null;
    const s = v.K / d, sh = v.K / (fwd + 31);
    return { x: v.cx + lat * s, y: v.hy + CAMH * s - h * sh, gy: v.hy + CAMH * s, s, fwd, lat };
  }
  draw(ctx) {
    const a = this.app, { W, H, min } = a, v = this.view(), h = HOLES[this.hole];
    let g = ctx.createLinearGradient(0, 0, 0, v.hy); g.addColorStop(0, '#4ea6ff'); g.addColorStop(1, '#bfe6ff'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, v.hy + 1);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 4; i++) { const x = ((this.t * 6 + i * W / 3.3) % (W + 220)) - 110, y = v.hy * (.2 + i * .17); ctx.beginPath(); ctx.ellipse(x, y, 80, 24, 0, 0, 6.3); ctx.ellipse(x + 44, y + 7, 60, 20, 0, 0, 6.3); ctx.fill(); }
    ctx.fillStyle = '#5da86a'; ctx.beginPath(); ctx.moveTo(0, v.hy); for (let x = 0; x <= W; x += W / 12) ctx.lineTo(x, v.hy - 14 - 10 * Math.sin(x * .013 + this.hole)); ctx.lineTo(W, v.hy); ctx.fill();
    g = ctx.createLinearGradient(0, v.hy, 0, H); g.addColorStop(0, '#3f9c4d'); g.addColorStop(1, '#2e8a3d'); ctx.fillStyle = g; ctx.fillRect(0, v.hy, W, H - v.hy);
    const poly = (pts, fill, stroke) => { ctx.beginPath(); let n = 0; for (const q of pts) { const p = this.proj(v, q[0], q[1], 0, true); if (!p) continue; n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); n++; } if (n < 3) return; ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); } };
    // fairway (mowing stripes)
    const L = Math.hypot(h.hole.x, h.hole.y), ux = h.hole.x / L, uy = h.hole.y / L, nx = uy, ny = -ux, hw = h.fw / 2;
    for (let i = 0, d = -10; d < L + 8; i++, d += 9) { const d1 = d + 9; poly([[ux * d + nx * hw, uy * d + ny * hw], [ux * d1 + nx * hw, uy * d1 + ny * hw], [ux * d1 - nx * hw, uy * d1 - ny * hw], [ux * d - nx * hw, uy * d - ny * hw]], i % 2 ? '#56bb5f' : '#4cae56'); }
    const circ = (cx, cy, rx, ry, n = 28) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * 6.283) * rx, cy + Math.sin(i / n * 6.283) * ry]);
    poly(circ(h.hole.x, h.hole.y, h.green + 2.5, h.green + 2.5), '#58c866'); poly(circ(h.hole.x, h.hole.y, h.green, h.green), '#6fe27e', 'rgba(255,255,255,.25)');
    for (const b of h.bunkers) poly(circ(b.x, b.y, b.rx, b.ry, 20), '#f2e2a4', 'rgba(150,120,60,.6)');
    if (h.water) { poly(circ(h.water.x, h.water.y, h.water.rx, h.water.ry, 24), '#3aa8ff', 'rgba(255,255,255,.6)'); }
    // trees + flag (far to near)
    const items = [];
    for (const tr of this.trees) { const p = this.proj(v, tr.x, tr.y); if (p && p.fwd > -4) items.push({ d: p.fwd, f: () => this.drawTree(ctx, p, tr) }); }
    const fp = this.proj(v, h.hole.x, h.hole.y); if (fp) items.push({ d: fp.fwd, f: () => this.drawFlag(ctx, fp, v) });
    items.sort((p, q) => q.d - p.d).forEach(i => i.f());
    // aim line + ball
    this.drawBallAndAim(ctx, v, h);
    this.drawHud(ctx, v, h);
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.state === 'card') this.drawCard(ctx);
  }
  drawTree(ctx, p, tr) { const s = p.s, hh = 9 * tr.sz * Math.min(s, 40) * (s > 40 ? 1 : 1); const sz = Math.max(6, 8 * tr.sz * Math.min(s, 60)); ctx.fillStyle = '#5a3b22'; ctx.fillRect(p.x - sz * .05, p.gy - sz * .3, sz * .1, sz * .3); ctx.fillStyle = `hsl(${120 + tr.hue * 25},55%,${22 + tr.hue * 8}%)`; ctx.beginPath(); ctx.arc(p.x, p.gy - sz * .55, sz * .28, 0, 6.3); ctx.arc(p.x - sz * .14, p.gy - sz * .42, sz * .2, 0, 6.3); ctx.arc(p.x + sz * .14, p.gy - sz * .42, sz * .2, 0, 6.3); ctx.fill(); }
  drawFlag(ctx, p, v) {
    const s = p.s, ph = Math.max(34, 3.2 * Math.min(s, 80)), rr = Math.max(3, 0.55 * s);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.ellipse(p.x, p.gy, rr, rr * .38, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = Math.max(2, ph * .04); ctx.beginPath(); ctx.moveTo(p.x, p.gy); ctx.lineTo(p.x, p.gy - ph); ctx.stroke();
    ctx.fillStyle = '#ff3b4a'; ctx.beginPath(); ctx.moveTo(p.x, p.gy - ph); ctx.lineTo(p.x + ph * .42, p.gy - ph * .86 + Math.sin(this.t * 4) * 2); ctx.lineTo(p.x, p.gy - ph * .72); ctx.fill();
    const dist = Math.round(this.dToHole()); ctx.font = `800 ${Math.max(14, this.app.min * .03)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4; ctx.strokeText(`${dist} m`, p.x, p.gy - ph - 6); ctx.fillText(`${dist} m`, p.x, p.gy - ph - 6);
  }
  ballPos(v) {
    const s = this.shot, b = this.ball;
    if (!s) return { x: b.x, y: b.y, h: 0, spin: 0 };
    if (this.state === 'fly') { const k = s.t / s.T; return { x: lerp(s.from.x, s.res.land.x, k), y: lerp(s.from.y, s.res.land.y, k), h: 4 * s.peak * k * (1 - k), spin: this.t * 20 }; }
    if (this.state === 'roll') { const k = 1 - (1 - clamp(s.rt / s.RT, 0, 1)) ** 2, a0 = s.mode === 'putt' ? s.from : s.res.land, a1 = s.res.holed && s.mode === 'putt' ? s.res.rest : s.res.rest; return { x: lerp(a0.x, a1.x, k), y: lerp(a0.y, a1.y, k), h: s.res.holed && k > .98 ? -.1 : 0, spin: 0 }; }
    return { x: b.x, y: b.y, h: 0, spin: 0 };
  }
  drawBallAndAim(ctx, v, h) {
    const a = this.app, min = a.min, bp = this.ballPos(v), p = this.proj(v, bp.x, bp.y, bp.h), g = this.proj(v, bp.x, bp.y, 0); if (!p) return;
    if (this.state === 'ready' && !this.over) {   // aim line (hand x), toward the hole
      const hand = this.lastHand, aim = hand ? clamp((hand.palm.x - a.W / 2) / (a.W * .35), -1, 1) * 12 * DEG : 0, psi = Math.atan2(h.hole.x - bp.x, h.hole.y - bp.y) + aim, dd = Math.min(this.dToHole() + 15, this.mode === 'putt' ? 25 : 120);
      ctx.save(); ctx.setLineDash([8, 10]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3; ctx.beginPath(); let n = 0; for (let d = 2; d <= dd; d += dd / 16) { const q = this.proj(v, bp.x + Math.sin(psi) * d, bp.y + Math.cos(psi) * d, 0); if (!q) continue; n ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); n++; } ctx.stroke(); ctx.restore();
    }
    const r = Math.max(3.5, Math.min(min * .022, g.s * .13));
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(g.x, g.gy, r * 1.1, r * .4, 0, 0, 6.3); ctx.fill();
    const gr = ctx.createRadialGradient(p.x - r * .3, p.y - r * .35, r * .1, p.x, p.y, r); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#c9ced8'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.3); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
  }
  drawHud(ctx, v, h) {
    const a = this.app, { W, H, min } = a, port = W < H;
    // wind
    const c = this.cam, fx = Math.sin(c.ang), fy = Math.cos(c.ang), wl = this.wind.x * fy - this.wind.y * fx, wf = this.wind.x * fx + this.wind.y * fy, ang = Math.atan2(wl, wf), wx = W - 62, wy = port ? 186 : 100;
    ctx.save(); ctx.fillStyle = 'rgba(15,10,50,.7)'; ctx.beginPath(); ctx.arc(wx, wy, 40, 0, 6.3); ctx.fill(); ctx.translate(wx, wy - 4); ctx.rotate(ang); ctx.strokeStyle = '#7de3ff'; ctx.fillStyle = '#7de3ff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(0, -16); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(-9, -10); ctx.lineTo(9, -10); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${this.wind.sp.toFixed(0)} m/s`, wx, wy + 28);
    if (this.mode && this.state === 'ready') { const lab = { drive: '🏌️ FULL SWING', pitch: '⛳ PITCH SHOT', putt: '🟢 PUTT – slow & gentle' }[this.mode]; ctx.font = `900 ${Math.max(16, min * .035)}px system-ui`; const w = ctx.measureText(lab).width + 36; ctx.fillStyle = 'rgba(15,10,50,.75)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - w / 2, H - 70, w, 44, 22) : ctx.rect(W / 2 - w / 2, H - 70, w, 44); ctx.fill(); ctx.fillStyle = '#ffe45e'; ctx.fillText(lab, W / 2, H - 48); }
  }
  drawCard(ctx) {
    const { W, H, min } = this.app, w = Math.min(W * .86, 420), rows = HOLES.length + 2, rh = Math.max(30, min * .06), hh = rh * (rows + 1), x = (W - w) / 2, y = H * .5 - hh / 2;
    ctx.fillStyle = 'rgba(15,10,60,.88)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, 18) : ctx.rect(x, y, w, hh); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.font = `900 ${rh * .5}px system-ui`; ctx.fillStyle = '#ffe45e'; ctx.textAlign = 'center'; ctx.fillText('⛳ SCORECARD', W / 2, y + rh * .6);
    const cols = [x + w * .18, x + w * .45, x + w * .72, x + w * .9]; ctx.fillStyle = '#9fb3ff'; ctx.font = `800 ${rh * .4}px system-ui`; ['Hole', 'Par', 'Strokes', 'Pts'].forEach((t, i) => ctx.fillText(t, cols[i], y + rh * 1.5));
    this.card.forEach((c, i) => { const yy = y + rh * (2.5 + i); ctx.fillStyle = c.strokes <= c.par ? '#7dffb0' : '#fff'; [i + 1, c.par, c.strokes, c.pts].forEach((t, k) => ctx.fillText(String(t), cols[k], yy)); });
  }
}
