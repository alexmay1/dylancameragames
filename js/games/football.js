import { Particles, Popups, bigText, rand, clamp, lerp } from '../util.js?v=23';
import { Crowd } from '../crowd.js?v=23';
import { Flyovers } from '../flyers.js?v=23';

/* Football — pseudo-3D view from behind the offence, looking downfield.
 * World: X = sideways yards (0 = middle), y = yards from own goal line (0..100, end zones -10..0 and 100..110), h = height in yards.
 * Perspective: u = (y - camY) * depthScale + camBack ; s = c / (u + c) ; screen x = cx + (X - camX) * S * s ; screen y = horizon + (groundY - horizon - h * S) * s */

const HW = 26.65;                 // half field width (yards)
const DRIVES = 3;
const RUN = 6.2, REC_SPEED = 6.3, BALL_V = 24, LAG = .75, TACKLE_R = 1.05;
const FG_MIN_SPOT = 55;           // field goal range (<= ~62 yard kick)
const SWING_V = 1.6, FLICK_V = 1.5;
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ord = (n) => ['', '1st', '2nd', '3rd', '4th'][n] || n + 'th';

function makePath(sx, sy, rel, ext = 14) {
  const pts = [{ X: sx, y: sy }]; let X = sx, y = sy;
  for (const [dx, dy] of rel) { X += dx; y += dy; pts.push({ X, y }); }
  const l = pts[pts.length - 1], p = pts[pts.length - 2]; let ex = l.X - p.X, ey = l.y - p.y; const n = Math.hypot(ex, ey) || 1;
  pts.push({ X: l.X + ex / n * ext, y: l.y + ey / n * ext });
  let L = 0; pts[0].c = 0; for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].X - pts[i - 1].X, pts[i].y - pts[i - 1].y); pts[i].c = L; }
  return { pts, len: L };
}
function posOnPath(path, d) {
  d = clamp(d, 0, path.len); const P = path.pts;
  for (let i = 1; i < P.length; i++) if (d <= P[i].c + 1e-6) { const t = (d - P[i - 1].c) / Math.max(1e-6, P[i].c - P[i - 1].c); return { X: lerp(P[i - 1].X, P[i].X, t), y: lerp(P[i - 1].y, P[i].y, t) }; }
  return { X: P[P.length - 1].X, y: P[P.length - 1].y };
}

export class FootballGame {
  constructor(app) { this.app = app; }
  start() {
    const a = this.app;
    this.pts = 0; this.tds = 0; this.fgs = 0; this.longest = 0; this.att = 0; this.comp = 0; this.drivesDone = 0; this.over = false;
    this.fx = new Particles(); this.pop = new Popups(); this.crowd = new Crowd(); this.fly = new Flyovers();
    this.cam = { y: 25, x: 0, kick: false }; this.flash = 0; this.peak = 0; this.dwell = 0; this.firstPlay = true;
    a.sfx.crowdStart(); a.sfx.crowdLevel(.35, 1);
    a.setScoreLabel('Points'); a.setScore(0);
    this.newDrive(); this.state = 'intro'; this.t = 2.6;
    a.hint('🏈 Raise your hand to RUN • Flick toward a receiver to PASS • Don’t get tackled!');
  }
  destroy() { this.app.sfx.crowdStop(); }

  /* ---------- drive / play setup ---------- */
  newDrive() {
    this.drive = this.drivesDone + 1; this.los = 25; this.down = 1; this.toGo = 10; this.fdY = 35; this.setupPlay(); this.toPresnap(3.2);
    this.hud();
  }
  hud() {
    const a = this.app, goal = this.fdY >= 100;
    a.setLeft(`${ord(this.down)} & ${goal ? 'Goal' : Math.max(1, Math.round(this.toGo))}`);
    const s = Math.round(this.los), yl = s === 50 ? '50' : s < 50 ? 'OWN ' + s : 'OPP ' + (100 - s);
    a.setRight(`D${this.drive}/${DRIVES} · ${yl}`);
  }
  toPresnap(t) { this.state = 'presnap'; this.t = t; this.dwell = 0; }
  inFGRange() { return this.los >= FG_MIN_SPOT; }
  setupPlay() {
    const los = this.los, ds = 3.7 + .35 * (this.drive - 1);
    this.ds = ds; this.playT = 0; this.ball = { state: 'held' }; this.released = false; this.thrown = false; this.tackled = null; this.preview = -1;
    this.qb = { X: 0, y: los - 5, ph: 0, vx: 0, vy: 0, role: 'qb', down: 0 }; this.carrier = this.qb;
    const R = [
      [-20, [[0, 24]], 14], [-12, [[0, 10], [9, 8]], 14], [12, [[0, 8], [10, 0]], 14], [20, [[0, 12], [-2, -3]], .5], [6, [[0, 3], [-5, 6]], 14],
    ];
    this.recs = R.map(([sx, rel, ext], i) => ({ idx: i, path: makePath(sx, los - .5, rel, ext), X: sx, y: los - .5, ph: Math.random() * 6, ctrl: false, down: 0 }));
    const D = (X, y, role, delay, cover = -1) => ({ X, y, ph: Math.random() * 6, role, delay, cover, down: 0, vx: 0 });
    this.defs = [
      D(-9, los + 1.5, 'rush', .8), D(-3, los + 1.5, 'rush', .8), D(3, los + 1.5, 'rush', .8), D(9, los + 1.5, 'rush', .8),
      D(-6, los + 5, 'chase', 1.3), D(6, los + 5, 'chase', 1.3),
      D(-18, los + 8, 'cover', 0, 0), D(18, los + 8, 'cover', 0, 3), D(-7, los + 13, 'cover', 0, 1), D(9, los + 13, 'cover', 0, 2), D(3, los + 5, 'cover', 0, 4),
    ];
    this.cam.kick = false;
  }

  /* ---------- camera / projection ---------- */
  view() {
    const { W, H, min } = this.app, k = this.cam.kick;
    return { W, H, cx: W / 2, hy: H * .3, yG: H * 1.08, S: Math.min(W, H * 1.2) / 21 * (k ? 1.7 : 1), ds: k ? .3 : 1, hs: k ? .55 : 1, c: 9, cB: 4, camX: this.cam.x, camY: this.cam.y, min };
  }
  proj(v, X, y, h = 0) {
    const u = (y - v.camY) * v.ds + v.cB; if (u < -v.c + .6) return null;
    const s = v.c / (u + v.c);
    return { x: v.cx + (X - v.camX) * v.S * s, y: v.hy + (v.yG - v.hy) * s - h * v.S * v.hs * s, s };
  }

  /* ---------- update ---------- */
  update(dt, hands) {
    const a = this.app, { W, H } = a;
    this.crowd.update(dt); this.fx.update(dt); this.pop.update(dt); this.fly.update(dt, W, H, a.sfx); this.flash = Math.max(0, this.flash - dt * 2);
    this.peak = Math.max(this.peak - dt * 8, ...hands.map(h => h.speed), 0);
    this.updateCamera(dt);
    if (this.over) return;
    switch (this.state) {
      case 'intro': this.t -= dt; if (this.t <= 0) this.toPresnap(3.4); break;
      case 'presnap': this.updatePresnap(dt, hands); break;
      case 'play': this.updatePlay(dt, hands); break;
      case 'whistle': case 'driveEnd': this.updateDead(dt); this.t -= dt; if (this.t <= 0 && this.pend) { const f = this.pend; this.pend = null; f(); } break;
      case 'kick': this.updateKick(dt, hands); break;
      case 'kickfly': this.updateKickFly(dt); break;
    }
  }
  updateCamera(dt) {
    const c = this.cam, k = 1 - Math.exp(-dt * 5);
    if (this.state === 'kick' || this.state === 'kickfly') { c.kick = true; c.y = this.kick.y; c.x = 0; return; }
    c.kick = false;
    let ty = this.carrier ? this.carrier.y : this.los - 5, tx = this.carrier ? this.carrier.X * .6 : 0;
    if (this.state === 'play' && this.ball.state === 'air') { ty = lerp(this.qb.y, this.ball.y, .65); tx = this.ball.X * .5; }
    if (this.state === 'presnap' || this.state === 'intro') { ty = this.los - 5; tx = 0; }
    if (this.state === 'driveEnd' && this.kickDone) { ty = this.los; tx = 0; }
    c.y += (ty - c.y) * k; c.x += (tx - c.x) * k;
  }
  updatePresnap(dt, hands) {
    const a = this.app, v = this.view();
    this.t -= dt;
    for (const r of this.recs) r.ph += dt * .5;
    if (this.inFGRange()) {
      const tgt = this.fgTarget(), r = tgt.r; let on = false;
      for (const h of hands) if (Math.hypot(h.palm.x - tgt.x, h.palm.y - tgt.y) < r * 1.15) on = true;
      this.dwell = on ? this.dwell + dt : Math.max(0, this.dwell - dt * 2);
      if (this.dwell >= .9) { this.startKick(false); return; }
      a.hint(this.down === 4 ? '4th down! Hold your hand on the 🥅 circle to kick a field goal — or go for it!' : this.firstPlay ? '🏈 Raise your hand to RUN • Flick toward a receiver to PASS • 🥅 circle = field goal' : null);
    } else a.hint(this.firstPlay ? '🏈 Raise your hand to RUN • Flick toward a receiver to PASS' : null);
    if (this.t <= 0) { this.snap(); }
  }
  snap() { this.state = 'play'; this.playT = 0; this.firstPlay = false; this.app.hint(null); this.app.sfx.thud(); }
  fgTarget() { const { W, H, min } = this.app; return { x: Math.max(min * .16, W * .14), y: H * .56, r: min * .1 }; }

  updatePlay(dt, hands) {
    const a = this.app, v = this.view(); this.playT += dt; const T = this.playT;
    const hand = hands[0], car = this.carrier;
    // --- receivers run routes ---
    for (const r of this.recs) {
      if (r.ctrl) continue;
      const p = posOnPath(r.path, REC_SPEED * Math.max(0, T - .15)); r.vx = p.X - r.X; r.X = p.X; r.y = p.y; r.ph += dt * 9;
    }
    // --- ball in the air ---
    if (this.ball.state === 'air') {
      const b = this.ball; b.t += dt; const k = Math.min(1, b.t / b.T);
      b.X = lerp(b.x0, b.tx, k); b.y = lerp(b.y0, b.ty, k); b.h = lerp(b.h0, 1.2, k) + 4 * b.peak * k * (1 - k);
      if (b.t >= b.T) { this.resolvePass(); return; }
    } else if (car && !this.tackled) {
      // --- steering: hand position = lane, hand height = speed ---
      const ctl = T > .35;
      let fwd = 0;
      if (hand && ctl) {
        const sC = v.c / (v.cB + v.c), visHalf = (v.W / 2) / (v.S * sC);
        const tx = this.cam.x + ((hand.palm.x - v.cx) / (v.W / 2)) * visHalf;
        const dx = clamp(tx - car.X, -11 * dt, 11 * dt); car.X = clamp(car.X + dx, -HW + .5, HW - .5); car.vx = dx / dt;
        fwd = clamp((a.H * .78 - hand.palm.y) / (a.H * .45), 0, 1) * (car === this.qb ? RUN : REC_SPEED + .2);
        car.y += fwd * dt; car.vy = fwd; car.ph += dt * (4 + fwd * 2);
      } else { car.vx = 0; car.vy = 0; }
      // --- pass: flick up/forward ---
      if (car === this.qb && hand && T > .3) {
        const sp = Math.max(hand.speed, this.peak * .85);
        if (hand.speed > FLICK_V && hand.vel.y < -.4 * hand.speed && sp > FLICK_V) this.throwBall(hand);
      }
      if (car === this.qb) { const sel = hand ? this.pickReceiver(this.aimDir(hand, v)) : null; this.preview = sel ? sel.idx : -1; }
      if (!hand && T > 1.6) a.hint('Show your hand to the camera ✋'); else if (a.hint) a.hint(null);
    }
    // --- defenders ---
    this.updateDefenders(dt);
    // --- tackle / touchdown ---
    if (this.ball.state !== 'air' && car && !this.tackled) {
      if (car.y >= 100) return this.touchdown();
      for (const d of this.defs) if (T > .35 && Math.hypot(d.X - car.X, d.y - car.y) < TACKLE_R) { this.tackle(d); return; }
    }
  }
  updateDefenders(dt) {
    const T = this.playT, car = this.carrier, air = this.ball.state === 'air';
    if (!this.released && (car !== this.qb || this.qb.y > this.los + 2 || T > 7)) this.released = true;
    const cover = this.defs.filter(d => d.role === 'cover');
    let near = [];
    if (air) near = cover.map(d => ({ d, dd: Math.hypot(d.X - this.ball.tx, d.y - this.ball.ty) })).sort((p, q) => p.dd - q.dd).slice(0, 2).map(o => o.d);
    for (const d of this.defs) {
      if (this.tackled) break;
      let tx, ty, sp = this.ds, go = true;
      if (air && near.includes(d)) { tx = this.ball.tx; ty = this.ball.ty; sp = this.ds * 1.2; }
      else if (d.role === 'cover' && !this.released && !air) {
        const r = this.recs[d.cover], p = posOnPath(r.path, REC_SPEED * Math.max(0, T - .15 - LAG)); tx = p.X; ty = p.y + .6; sp = this.ds * 1.15; go = T > .1;
      } else {
        const tgt = (air ? this.qb : car) || this.qb; go = T > (d.role === 'rush' ? d.delay : d.role === 'chase' ? d.delay : .6);
        if (air && d.role !== 'rush') { tx = this.ball.tx; ty = this.ball.ty; } else { tx = tgt.X + (tgt.vx || 0) * .25; ty = tgt.y + (tgt.vy || 0) * .25; }
        if (d.role === 'cover') sp = this.ds * 1.05;
      }
      if (!go) continue;
      const dx = tx - d.X, dy = ty - d.y, L = Math.hypot(dx, dy), st = sp * dt;
      if (L > .01) { const m = Math.min(st, L); d.X += dx / L * m; d.y += dy / L * m; d.vx = dx / L * sp; d.ph += dt * 9; }
    }
    for (let i = 0; i < this.defs.length; i++) for (let j = i + 1; j < this.defs.length; j++) { const p = this.defs[i], q = this.defs[j], dx = q.X - p.X, dy = q.y - p.y, L = Math.hypot(dx, dy); if (L < .9 && L > .001) { const k = (.9 - L) * .5 / L; p.X -= dx * k; p.y -= dy * k; q.X += dx * k; q.y += dy * k; } }
  }
  updateDead(dt) {
    for (const o of [this.carrier, ...this.recs, ...this.defs]) if (o && o.down > 0 && o.down < 1) o.down = Math.min(1, o.down + dt * 3);
    if (this.tackled && !this.tackled.td && this.carrier) this.carrier.down = Math.min(1, (this.carrier.down || 0) + dt * 3);
  }

  /* ---------- passing ---------- */
  aimDir(h, v) {
    if (h.speed > .6) return { x: h.vel.x, y: h.vel.y };
    const q = this.proj(v, this.qb.X, this.qb.y, 1.5); return q ? { x: h.palm.x - q.x, y: h.palm.y - q.y } : { x: 0, y: -1 };
  }
  pickReceiver(dir) {
    const fa = Math.atan2(dir.x, -dir.y); let best = null;
    for (const r of this.recs) {
      const ra = Math.atan2(r.X - this.qb.X, Math.max(1, r.y - this.qb.y)), diff = wrapPi(fa - ra);
      if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { idx: r.idx, diff };
    }
    return best;
  }
  throwBall(h) {
    const a = this.app, v = this.view(), sel = this.pickReceiver({ x: h.vel.x, y: h.vel.y }), r = this.recs[sel.idx], qb = this.qb;
    let tf = .9, p = { X: r.X, y: r.y };
    for (let i = 0; i < 4; i++) { p = posOnPath(r.path, REC_SPEED * Math.max(0, this.playT + tf - .15)); tf = clamp(Math.hypot(p.X - qb.X, p.y - qb.y) / BALL_V, .55, 2.2); }
    const dist = Math.hypot(p.X - qb.X, p.y - qb.y), miss = clamp(Math.abs(sel.diff) / (40 * Math.PI / 180), 0, 1.6) * 3.2 * (sel.diff > 0 ? 1 : -1);
    this.ball = { state: 'air', t: 0, T: tf, x0: qb.X, y0: qb.y, h0: 1.8, tx: p.X + miss, ty: p.y, X: qb.X, y: qb.y, h: 1.8, rec: sel.idx, peak: 1.2 + dist * .07, miss: Math.abs(miss) };
    this.thrown = true; this.att++; this.preview = -1; a.sfx.throwSfx(); qb.vx = 0; qb.vy = 0;
  }
  resolvePass() {
    const a = this.app, b = this.ball, r = this.recs[b.rec];
    let dd = 99; for (const d of this.defs) dd = Math.min(dd, Math.hypot(d.X - b.tx, d.y - b.ty));
    const rr = Math.hypot(r.X - b.tx, r.y - b.ty);
    let res = 'catch';
    if (rr > 2.4) res = 'inc-off';
    else if (dd < .8) res = Math.random() < .35 ? 'int' : 'inc-def';
    else if (dd < 1.6 && Math.random() < .25) res = 'inc-def';
    if (res === 'catch') {
      r.ctrl = true; r.X = b.tx; r.y = b.ty; this.carrier = r; this.ball = { state: 'held' }; this.comp++; this.released = true;
      a.sfx.catchBall(); this.pop.add(this.proj(this.view(), r.X, r.y, 3)?.x ?? a.W / 2, this.proj(this.view(), r.X, r.y, 3)?.y ?? a.H / 2, 'CAUGHT!', '#7dffb0', 38); this.crowd.excite = Math.max(this.crowd.excite, .5);
    } else if (res === 'int') { this.endPlay('int', b.ty); }
    else this.endPlay('inc', this.los, res === 'inc-off' ? 'Off target!' : 'Broken up!');
  }

  /* ---------- play endings ---------- */
  tackle(d) {
    const a = this.app, c = this.carrier; this.tackled = d; c.down = .01; d.down = .01; a.sfx.thud(); this.fx.burst(this.sx(c.X, c.y), this.sy(c.X, c.y), 40, 12, 260, 6);
    this.endPlay('tackle', c.y);
  }
  sx(X, y) { const q = this.proj(this.view(), X, y, 1); return q ? q.x : this.app.W / 2; }
  sy(X, y) { const q = this.proj(this.view(), X, y, 1); return q ? q.y : this.app.H / 2; }
  endPlay(kind, y, why) {
    const a = this.app; this.state = 'whistle'; this.t = 1.9; a.sfx.whistle();
    if (kind === 'int') { a.banner('INTERCEPTED!<small>Turnover — drive over</small>', 1800); this.crowd.sad = 2; this.crowd.excite = 0; a.sfx.crowdGroan(); this.pend = () => this.driveEnd('int'); return; }
    if (kind === 'inc') { this.down++; a.banner(`INCOMPLETE<small>${why || ''}</small>`, 1500); this.crowd.sad = 1.2; a.sfx.crowdGroan(); return this.afterDown(this.los); }
    const spot = clamp(y, 1, 99.5), gained = Math.round(spot - this.los); this.longest = Math.max(this.longest, gained);
    if (spot >= this.fdY) { a.banner(`FIRST DOWN!<small>${gained >= 0 ? '+' : ''}${gained} yards</small>`, 1600); this.crowd.excite = .7; a.sfx.crowdCheer(.5); this.afterDown(spot, true); }
    else { this.down++; a.banner(gained < 0 ? `LOSS OF ${-gained}<small>Tackled!</small>` : `TACKLED!<small>${gained >= 0 ? '+' : ''}${gained} yards</small>`, 1500); if (gained <= 0) { this.crowd.sad = 1.3; a.sfx.crowdGroan(); } else a.sfx.crowdLevel(.25, 1); this.afterDown(spot, false); }
  }
  afterDown(spot, first) {
    this.los = spot;
    if (first) { this.down = 1; this.toGo = Math.min(10, 100 - spot); this.fdY = spot + this.toGo; }
    else { if (this.down > 4) { this.pend = () => this.driveEnd('downs'); return; } this.toGo = Math.max(1, Math.ceil(this.fdY - spot)); }
    this.hud();
    this.pend = () => { this.setupPlay(); this.toPresnap(this.down === 4 && this.inFGRange() ? 5 : 3); };
  }
  touchdown() {
    const a = this.app; this.state = 'whistle'; this.t = 2.4; this.pts += 6; this.tds++; a.setScore(this.pts);
    this.longest = Math.max(this.longest, Math.round(this.carrier.y - this.los));
    a.banner('TOUCHDOWN!<small>+6 points</small>', 2200); a.sfx.cheer(); a.sfx.crowdCheer(1); this.crowd.excite = 1; this.crowd.wave = 4; this.flash = 1;
    this.fx.confetti(a.W * .3, a.H * .5, 50); this.fx.confetti(a.W * .7, a.H * .5, 50);
    this.tackled = { td: true }; this.pend = () => this.startKick(true);
  }
  driveEnd(reason) {
    const a = this.app; this.drivesDone++; this.state = 'driveEnd'; this.t = 2.4;
    const msg = { downs: 'Turnover on downs', int: 'Interception', fg: 'Drive complete', td: 'Drive complete', miss: 'Kick missed' }[reason] || 'Drive over';
    if (reason === 'downs') { a.banner('TURNOVER ON DOWNS<small>Drive over</small>', 1900); this.crowd.sad = 1.8; a.sfx.crowdGroan(); }
    else if (this.drivesDone < DRIVES) a.banner(`${msg}<small>Next drive: ${this.drivesDone + 1} of ${DRIVES}</small>`, 1800);
    this.kickDone = false;
    this.pend = () => { if (this.drivesDone >= DRIVES) this.finish(); else { this.newDrive(); } };
  }
  finish() {
    const a = this.app; this.over = true; a.banner('Game over!', 1300); a.sfx.crowdCheer(.8); setTimeout(() => a.sfx.crowdStop(), 2600);
    setTimeout(() => { if (a.game === this) a.showResult({ title: this.pts >= 14 ? 'MVP!' : this.pts >= 6 ? 'Great game!' : 'Good effort!', emoji: this.pts >= 14 ? '🏆' : '🏈', score: this.pts, stats: [['Touchdowns', this.tds], ['Field goals', this.fgs], ['Passes', `${this.comp}/${this.att}`], ['Longest play', this.longest + ' yds']] }); }, 1400);
  }

  /* ---------- kicking (field goal / extra point) ---------- */
  startKick(isXP) {
    const a = this.app, spot = isXP ? 85 : this.los, ky = spot - 7, D = 110 - ky;
    const need = clamp((D * 1.12 + 1 - 22) / 55, .05, .95);
    this.kick = { xp: isXP, y: ky, D, need, t: 0, phase: 'aim', needle: 0, power: 0, fly: null, spot };
    this.state = 'kick'; this.kicker = { X: 0, y: ky - 1.8, ph: 0, down: 0, leg: 0 }; this.carrier = this.kicker; this.tackled = null; this.preview = -1;
    a.hint(isXP ? '🥅 Extra point! Swing your hand DOWN fast to kick — watch the aim needle!' : `🥅 ${Math.round(D)}-yard field goal! Swing your hand DOWN fast — power past the line, needle in the green!`);
    a.hideBanner();
  }
  updateKick(dt, hands) {
    const K = this.kick, a = this.app; K.t += dt;
    K.needle = Math.sin(K.t * 2.1 + .6);
    K.gauge = clamp(this.peak / 3.0, 0, 1);
    this.kicker.ph += dt * 2;
    if (K.t > .8) for (const h of hands) {
      if (h.speed > SWING_V && h.vel.y > .3 * h.speed) { this.doKick(clamp(Math.max(this.peak, h.speed) / 3.0, .12, 1)); return; }
    }
    if (K.t > 14) { a.hint(null); if (K.xp) { this.driveEnd('td'); } else { this.state = 'presnap'; this.setupPlay(); this.toPresnap(3); } }
  }
  doKick(power) {
    const a = this.app, K = this.kick; a.hint(null); a.sfx.kick();
    const Lf = 22 + 55 * power, X = K.needle * 9, tc = K.D / Lf, hp = 8 + Lf * .08;
    const hAt = tc <= 1 ? 4 * hp * tc * (1 - tc) : 0;
    let res = 'good'; if (Lf < K.D || hAt < 3.4) res = 'short'; else if (Math.abs(X) >= 4.5) res = 'wide';
    K.power = power; K.fly = { t: 0, dur: 1.3 + Lf / 70, Lf, X, hp, res }; K.phase = 'fly'; this.state = 'kickfly'; K.ball = { X: 0, y: K.y, h: .3 };
  }
  updateKickFly(dt) {
    const K = this.kick, f = K.fly, a = this.app; f.t += dt; const k = Math.min(1, f.t / f.dur), dist = f.Lf * k;
    K.ball = { X: f.X * (dist / K.D), y: K.y + dist, h: .3 + 4 * f.hp * k * (1 - k) };
    this.kicker.leg = k < .2 ? 1 : 0;
    if (f.t >= f.dur + .6 && !f.done) {
      f.done = true;
      if (f.res === 'good') {
        const p = K.xp ? 1 : 3; this.pts += p; a.setScore(this.pts); if (!K.xp) this.fgs++;
        a.banner(K.xp ? 'EXTRA POINT IS GOOD!<small>+1</small>' : 'IT’S GOOD!<small>Field goal +3</small>', 2000); a.sfx.cheer(); a.sfx.crowdCheer(.9); this.crowd.excite = 1; this.crowd.wave = 2.5; this.flash = .6;
        this.fx.confetti(a.W * .5, a.H * .45, 60);
      } else {
        a.banner(f.res === 'short' ? 'NO GOOD<small>Not enough power</small>' : 'NO GOOD<small>Wide of the posts</small>', 1800); this.crowd.sad = 1.6; a.sfx.crowdGroan();
      }
      this.state = 'driveEnd'; this.t = 2.3; this.kickDone = true; this.drivesDone++;
      this.pend = () => { if (this.drivesDone >= DRIVES) this.finish(); else this.newDrive(); };
    }
  }

  /* ---------- drawing ---------- */
  draw(ctx) {
    const a = this.app, { W, H } = a, v = this.view();
    this.crowd.draw(ctx, { W, H, hy: v.hy });
    this.fly.draw(ctx, W);
    this.drawField(ctx, v);
    this.drawPosts(ctx, v);
    if (this.state === 'kick' || this.state === 'kickfly') this.drawKick(ctx, v);
    else this.drawPlay(ctx, v);
    this.fx.draw(ctx); this.pop.draw(ctx);
    if (this.state === 'presnap' && this.inFGRange()) this.drawFGTarget(ctx);
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * .4})`; ctx.fillRect(0, 0, W, H); }
    if (this.state === 'presnap' && this.t < 3 && this.t > 0) bigText(ctx, String(Math.ceil(this.t)), W / 2, H * .22, a.min * .16);
  }
  line(ctx, v, X0, y0, X1, y1, h = 0) { const p = this.proj(v, X0, y0, h), q = this.proj(v, X1, y1, h); if (!p || !q) return; ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
  quad(ctx, v, X0, X1, y0, y1) {
    const p = [this.proj(v, X0, y0), this.proj(v, X1, y0), this.proj(v, X1, y1), this.proj(v, X0, y1)]; if (p.some(z => !z)) return false;
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); return true;
  }
  drawField(ctx, v) {
    const { W, H } = v;
    ctx.fillStyle = 'rgba(30,110,50,.75)'; ctx.fillRect(0, v.hy, W, H - v.hy);                 // surroundings
    const yMin = Math.max(-10, Math.floor((v.camY - 6 / v.ds) / 5) * 5), yMax = Math.min(110, v.camY + 75 / v.ds);
    for (let y0 = Math.max(-10, yMin); y0 < yMax; y0 += 5) {
      const ez = y0 < 0 || y0 >= 100, idx = Math.floor((y0 + 10) / 5);
      ctx.fillStyle = ez ? (y0 < 0 ? 'rgba(40,90,200,.75)' : 'rgba(200,50,60,.75)') : idx % 2 ? 'rgba(70,175,85,.78)' : 'rgba(52,152,72,.78)';
      if (this.quad(ctx, v, -HW, HW, y0, y0 + 5)) ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let y = Math.ceil(yMin / 5) * 5; y <= yMax; y += 5) if (y >= 0 && y <= 100) this.line(ctx, v, -HW, y, HW, y);
    ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); this.line(ctx, v, -HW, yMin, -HW, yMax); this.line(ctx, v, HW, yMin, HW, yMax); this.line(ctx, v, -HW, -10, HW, -10); this.line(ctx, v, -HW, 110, HW, 110); ctx.stroke();
    // yard numbers
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let y = 10; y <= 90; y += 10) { if (y < yMin || y > yMax) continue; const n = Math.min(y, 100 - y); for (const X of [-HW + 6, HW - 6]) { const p = this.proj(v, X, y); if (!p) continue; ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, .5); ctx.font = `900 ${Math.max(8, v.S * p.s * 1.7)}px system-ui`; ctx.fillText(String(n), 0, 0); ctx.restore(); } }
    // line of scrimmage + first-down marker
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(70,130,255,.95)'; ctx.beginPath(); this.line(ctx, v, -HW, this.los, HW, this.los); ctx.stroke();
    const fy = Math.min(this.fdY, 100);
    ctx.lineWidth = 5; ctx.strokeStyle = '#ffe45e'; ctx.shadowColor = '#ffe45e'; ctx.shadowBlur = 10; ctx.beginPath(); this.line(ctx, v, -HW, fy, HW, fy); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff8a1c'; ctx.lineWidth = Math.max(3, v.S * .3 * (this.proj(v, 0, fy)?.s || .3)); ctx.beginPath(); this.line(ctx, v, -HW, fy, -HW, fy, 2.5); this.line(ctx, v, HW, fy, HW, fy, 2.5);
    for (const X of [-HW, HW]) { const p = this.proj(v, X, fy, 0), q = this.proj(v, X, fy, 2.5); if (p && q) { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } } ctx.stroke();
  }
  drawPosts(ctx, v) {
    const b = this.proj(v, 0, 110, 0), p = (X, h) => this.proj(v, X, 110, h); if (!b) return;
    const bar = 3.05, up = 12, hw = 4.5; ctx.save(); ctx.strokeStyle = '#ffd23f'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, v.S * b.s * .35);
    ctx.beginPath(); let q = p(0, 0), q2 = p(0, bar); ctx.moveTo(q.x, q.y); ctx.lineTo(q2.x, q2.y);
    q = p(-hw, bar); q2 = p(hw, bar); ctx.moveTo(q.x, q.y); ctx.lineTo(q2.x, q2.y);
    for (const X of [-hw, hw]) { q = p(X, bar); q2 = p(X, up); ctx.moveTo(q.x, q.y); ctx.lineTo(q2.x, q2.y); }
    ctx.stroke(); ctx.restore();
  }
  drawPlayer(ctx, v, o, X, y, opt) {
    const pr = this.proj(v, X, y); if (!pr) return; const h = Math.max(12, 3 * v.S * pr.s), x = pr.x, gy = pr.y;
    ctx.save(); ctx.translate(x, gy);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 0, h * .3, h * .09, 0, 0, 6.3); ctx.fill();
    if (o.down > 0) ctx.rotate((opt.side || 1) * Math.min(1, o.down) * 1.45);
    const sw = Math.sin(o.ph || 0) * h * .16;
    ctx.lineCap = 'round'; ctx.strokeStyle = opt.pants; ctx.lineWidth = h * .13; ctx.beginPath(); ctx.moveTo(-h * .09, -h * .42); ctx.lineTo(-h * .09 + sw, 0); ctx.moveTo(h * .09, -h * .42); ctx.lineTo(h * .09 - sw, 0); ctx.stroke();
    ctx.strokeStyle = '#f2c9a0'; ctx.lineWidth = h * .09; ctx.beginPath(); ctx.moveTo(-h * .2, -h * .72); ctx.lineTo(-h * .27, -h * .5 - sw * .5); ctx.moveTo(h * .2, -h * .72); ctx.lineTo(h * .27, -h * .5 + sw * .5); ctx.stroke();
    ctx.fillStyle = opt.jersey; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-h * .2, -h * .8, h * .4, h * .4, h * .1) : ctx.rect(-h * .2, -h * .8, h * .4, h * .4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-h * .2, -h * .62, h * .4, h * .06);
    ctx.fillStyle = opt.helmet; ctx.beginPath(); ctx.arc(0, -h * .9, h * .14, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-h * .015, -h * 1.04, h * .03, h * .14);
    if (opt.front) { ctx.strokeStyle = '#ddd'; ctx.lineWidth = h * .025; ctx.beginPath(); ctx.arc(0, -h * .88, h * .1, .2, Math.PI - .2); ctx.stroke(); }
    if (opt.ball) { ctx.fillStyle = '#8b4513'; ctx.beginPath(); ctx.ellipse(h * .05, -h * .55, h * .13, h * .075, -.5, 0, 6.3); ctx.fill(); }
    ctx.restore();
    if (opt.mark) { const t = performance.now() / 300, by = gy - h * 1.25 + Math.sin(t) * h * .06; ctx.fillStyle = opt.mark; ctx.strokeStyle = '#5b2bb5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, by + h * .1); ctx.lineTo(x - h * .14, by - h * .08); ctx.lineTo(x + h * .14, by - h * .08); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  drawPlay(ctx, v) {
    const list = [];
    const OFF = { helmet: '#2a6df4', jersey: '#2a6df4', pants: '#f2f2f2' }, DEF = { helmet: '#d62839', jersey: '#d62839', pants: '#333', front: true };
    const hasBall = (o) => this.ball.state === 'held' && this.carrier === o;
    for (const d of this.defs) list.push([d.y, () => this.drawPlayer(ctx, v, d, d.X, d.y, { ...DEF, side: d.X > 0 ? 1 : -1 })]);
    for (const r of this.recs) list.push([r.y, () => this.drawPlayer(ctx, v, r, r.X, r.y, { ...OFF, jersey: '#34b4ff', ball: hasBall(r), mark: this.ball.state === 'held' && this.carrier === this.qb && !this.tackled ? (this.preview === r.idx ? '#ffe45e' : this.isOpen(r) ? '#7dffb0' : '#ff9a9a') : null, side: -1 })]);
    list.push([this.qb.y, () => this.drawPlayer(ctx, v, this.qb, this.qb.X, this.qb.y, { ...OFF, jersey: '#1f3fbf', ball: hasBall(this.qb), side: -1 })]);
    list.sort((p, q) => q[0] - p[0]); for (const [, f] of list) f();
    if (this.ball.state === 'air') {
      const b = this.ball, g = this.proj(v, b.X, b.y, 0), p = this.proj(v, b.X, b.y, b.h);
      if (g && p) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(g.x, g.y, v.S * g.s * .5, v.S * g.s * .18, 0, 0, 6.3); ctx.fill(); this.drawBall(ctx, p.x, p.y, Math.max(6, v.S * p.s * .6), b.t * 14); }
      const t = this.proj(v, b.tx, b.ty, 0); if (t) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(t.x, t.y, v.S * t.s * 1.2, v.S * t.s * .45, 0, 0, 6.3); ctx.stroke(); }
    }
    this.drawHandMarker(ctx);
    if (this.state === 'play' && this.carrier === this.qb && this.ball.state === 'held' && this.playT < 3.5 && !this.tackled) {
      const a = this.app; ctx.font = '800 16px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('Flick toward a receiver to pass ↗  •  hand up = run', a.W / 2, a.H - 16 - 6);
    }
  }
  isOpen(r) { let m = 99; for (const d of this.defs) m = Math.min(m, Math.hypot(d.X - r.X, d.y - r.y)); return m > 3.2; }
  drawHandMarker(ctx) { /* hands are drawn by the app; nothing extra */ }
  drawBall(ctx, x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot * .1); ctx.fillStyle = '#8b4513'; ctx.beginPath(); ctx.ellipse(0, 0, r, r * .62, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, r * .12); ctx.beginPath(); ctx.moveTo(-r * .35, 0); ctx.lineTo(r * .35, 0); for (let i = -1; i <= 1; i++) { ctx.moveTo(i * r * .2, -r * .18); ctx.lineTo(i * r * .2, r * .18); } ctx.stroke(); ctx.restore();
  }
  drawFGTarget(ctx) {
    const t = this.fgTarget(), a = this.app, k = clamp(this.dwell / .9, 0, 1), pulse = this.down === 4 ? .5 + .5 * Math.sin(performance.now() / 180) : 0;
    ctx.save(); ctx.fillStyle = `rgba(255,210,63,${.35 + .25 * pulse})`; ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(t.x, t.y, t.r + 8, -Math.PI / 2, -Math.PI / 2 + k * 6.283); ctx.stroke();
    ctx.font = `${t.r * .8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('🥅', t.x, t.y - t.r * .15);
    ctx.font = '900 15px system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b2bb5'; ctx.lineWidth = 4; const D = Math.round(117 - this.los); ctx.strokeText(`FG ${D} yd`, t.x, t.y + t.r * .62); ctx.fillText(`FG ${D} yd`, t.x, t.y + t.r * .62); ctx.restore();
  }
  drawKick(ctx, v) {
    const K = this.kick, a = this.app, { W, H } = a;
    this.drawPlayer(ctx, v, this.kicker, 0, K.y - 1.8, { helmet: '#2a6df4', jersey: '#1f3fbf', pants: '#f2f2f2', side: -1 });
    // ball on the tee or in flight
    const b = K.ball || { X: 0, y: K.y, h: .3 }, g = this.proj(v, b.X, b.y, 0), p = this.proj(v, b.X, b.y, b.h);
    if (g && p) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(g.x, g.y, Math.max(4, v.S * g.s * .5), Math.max(2, v.S * g.s * .18), 0, 0, 6.3); ctx.fill(); this.drawBall(ctx, p.x, p.y, Math.max(6, v.S * p.s * .6), (K.fly ? K.fly.t : 0) * 20); }
    // meters
    const bw = Math.min(W * .62, 340), mx = W / 2 - bw / 2, my = (W < H ? 118 : 74) + 46;
    ctx.save(); ctx.fillStyle = 'rgba(20,10,80,.85)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(mx - 12, my - 46, bw + 24, 124, 16) : ctx.rect(mx - 12, my - 46, bw + 24, 124); ctx.fill();
    const zones = [[-1, '#ff5a5a'], [-.45, '#7dffb0'], [.45, '#ff5a5a'], [1.01, null]];
    for (let i = 0; i < 3; i++) { ctx.fillStyle = zones[i][1]; const x0 = mx + (zones[i][0] + 1) / 2 * bw, x1 = mx + (zones[i + 1][0] + 1) / 2 * bw; ctx.fillRect(x0, my, x1 - x0, 16); }
    const nx = mx + (K.needle + 1) / 2 * bw; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b2bb5'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(nx, my + 20); ctx.lineTo(nx - 9, my + 34); ctx.lineTo(nx + 9, my + 34); ctx.closePath(); ctx.fill(); ctx.stroke();
    // power bar
    const py = my + 44, g2 = K.phase === 'aim' ? K.gauge : K.power;
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(mx, py, bw, 12); ctx.fillStyle = g2 >= K.need ? '#7dffb0' : '#ffd23f'; ctx.fillRect(mx, py, bw * g2, 12);
    ctx.fillStyle = '#fff'; ctx.fillRect(mx + bw * K.need - 2, py - 4, 4, 20);
    ctx.font = '800 14px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('AIM — needle in the green', W / 2, my - 28); ctx.textAlign = 'left'; ctx.fillText('POWER ▸ past the white line', mx, py + 28);
    ctx.restore();
  }
}
