/* Random cartoon animals that cross the sky every so often (purely for fun). */
const TYPES = ['birds', 'eagle', 'pig', 'bat', 'butterflies', 'dragon'];

export class Flyovers {
  constructor() { this.list = []; this.next = 4 + Math.random() * 3; this.last = ''; }
  spawn(W, H, sfx, type) {
    if (!type) { do { type = TYPES[(Math.random() * TYPES.length) | 0]; } while (type === this.last); }
    this.last = type;
    const dir = Math.random() < .5 ? 1 : -1, size = Math.min(W, H) * ({ birds: .06, eagle: .16, pig: .15, bat: .1, butterflies: .06, dragon: .24 }[type]);
    const dur = { birds: 6, eagle: 6.5, pig: 8, bat: 5.5, butterflies: 11, dragon: 8 }[type] * (W > H ? 1.15 : 1);
    this.list.push({ type, dir, size, t: 0, dur, y: H * (.07 + Math.random() * .3), W, ph: Math.random() * 6, snd: false });
    const s = sfx; if (s) setTimeout(() => { try { ({ birds: s.chirp, eagle: s.screech, pig: s.oink, bat: s.squeak, butterflies: s.flutter, dragon: s.roar }[type]).call(s); } catch (e) { /* sound optional */ } }, 400);
  }
  update(dt, W, H, sfx) {
    this.next -= dt;
    if (this.next <= 0) { this.spawn(W, H, sfx); this.next = 9 + Math.random() * 9; }
    for (const f of this.list) f.t += dt;
    this.list = this.list.filter(f => f.t < f.dur);
  }
  draw(ctx, W) {
    for (const f of this.list) {
      const k = f.t / f.dur, x = f.dir > 0 ? -f.size * 2 + k * (W + f.size * 4) : W + f.size * 2 - k * (W + f.size * 4);
      const bob = Math.sin(f.t * 2.2 + f.ph) * f.size * .25, y = f.y + bob, flap = f.t * ({ birds: 14, eagle: 5, pig: 9, bat: 18, butterflies: 8, dragon: 6 }[f.type]) + f.ph;
      ctx.save(); ctx.translate(x, y); ctx.scale(f.dir, 1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      DRAW[f.type](ctx, f.size, flap, f.t);
      ctx.restore();
    }
  }
}

function wing(ctx, s, flap, color, len = 1, tip = null) {
  const a = Math.sin(flap) * s * .45 * len;
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-s * .25 * len, -s * .5 * len + a, -s * .7 * len, -s * .15 * len + a * 1.4); ctx.quadraticCurveTo(-s * .3 * len, -s * .05 * len, 0, s * .08); ctx.fill();
  if (tip) { ctx.strokeStyle = tip; ctx.lineWidth = s * .03; ctx.stroke(); }
}

const DRAW = {
  birds(ctx, s, flap) {
    [[0, 0, 1], [-s * 1.1, -s * .5, .8], [-s * 1.2, s * .5, .7]].forEach(([ox, oy, k], i) => {
      ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
      ctx.fillStyle = ['#3a86ff', '#ff6b6b', '#ffd23f'][i]; ctx.beginPath(); ctx.ellipse(0, 0, s * .5, s * .3, 0, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(s * .5, -s * .08, s * .22, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.moveTo(s * .68, -s * .1); ctx.lineTo(s * .9, -s * .03); ctx.lineTo(s * .68, 0); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * .55, -s * .13, s * .05, 0, 6.3); ctx.fill();
      ctx.save(); ctx.translate(s * .05, -s * .1); wing(ctx, s * 1.1, flap + i, ctx.fillStyle = '#ffffffcc'); ctx.restore();
      ctx.restore();
    });
  },
  eagle(ctx, s, flap) {
    ctx.save(); ctx.translate(-s * .1, -s * .1); wing(ctx, s * 1.8, flap, '#6b4423', 1, '#3b2312'); ctx.scale(1, -1); ctx.translate(0, -s * .1); wing(ctx, s * 1.8, flap + .3, '#5a381c'); ctx.restore();
    ctx.fillStyle = '#7b4a24'; ctx.beginPath(); ctx.ellipse(0, 0, s * .7, s * .22, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#7b4a24'; ctx.beginPath(); ctx.moveTo(-s * .6, 0); ctx.lineTo(-s * 1.0, -s * .15); ctx.lineTo(-s * 1.0, s * .15); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * .68, -s * .08, s * .2, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ffc300'; ctx.beginPath(); ctx.moveTo(s * .8, -s * .1); ctx.lineTo(s * 1.05, -s * .02); ctx.lineTo(s * .82, s * .05); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(s * .73, -s * .13, s * .04, 0, 6.3); ctx.fill();
  },
  pig(ctx, s, flap) {
    ctx.save(); ctx.translate(-s * .05, -s * .2); wing(ctx, s * 1.1, flap, '#ffffff', 1, '#ffb3c6'); ctx.restore();
    ctx.fillStyle = '#ff9eb5'; ctx.beginPath(); ctx.ellipse(0, 0, s * .55, s * .4, 0, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.arc(s * .55, -s * .05, s * .3, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ff7f9f'; ctx.beginPath(); ctx.ellipse(s * .8, -s * .02, s * .13, s * .1, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#c2456a'; ctx.beginPath(); ctx.arc(s * .77, -s * .02, s * .02, 0, 6.3); ctx.arc(s * .84, -s * .02, s * .02, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#ff9eb5'; ctx.beginPath(); ctx.moveTo(s * .45, -s * .3); ctx.lineTo(s * .52, -s * .55); ctx.lineTo(s * .65, -s * .3); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(s * .6, -s * .12, s * .04, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#ff7f9f'; ctx.lineWidth = s * .06; ctx.beginPath(); ctx.arc(-s * .62, -s * .02, s * .1, 0, 5); ctx.stroke();
    ctx.lineWidth = s * .09; ctx.beginPath(); ctx.moveTo(-s * .2, s * .3); ctx.lineTo(-s * .2, s * .5); ctx.moveTo(s * .25, s * .3); ctx.lineTo(s * .25, s * .5); ctx.stroke();
  },
  bat(ctx, s, flap) {
    const a = Math.sin(flap) * s * .5;
    ctx.fillStyle = '#2b2142';
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s * .5 * 1, -s * .4 + a); ctx.lineTo(-s * .65, -s * .05 + a); ctx.lineTo(-s * .4, 0 + a * .6); ctx.lineTo(-s * .25, s * .12); ctx.closePath(); ctx.fill(); if (sg === -1) ctx.translate(0, 0); break; }
    ctx.beginPath(); ctx.ellipse(0, 0, s * .22, s * .3, 0, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.arc(s * .02, -s * .32, s * .18, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s * .1, -s * .45); ctx.lineTo(-s * .05, -s * .62); ctx.lineTo(s * .02, -s * .47); ctx.moveTo(s * .06, -s * .47); ctx.lineTo(s * .14, -s * .62); ctx.lineTo(s * .17, -s * .43); ctx.fill();
    ctx.fillStyle = '#ffeb3b'; ctx.beginPath(); ctx.arc(-s * .03, -s * .34, s * .035, 0, 6.3); ctx.arc(s * .09, -s * .34, s * .035, 0, 6.3); ctx.fill();
  },
  butterflies(ctx, s, flap, t) {
    [[0, 0, '#ff6ec7', '#ffd23f'], [-s * 1.2, s * .8, '#6ec7ff', '#fff'], [-s * 2.2, -s * .4, '#ffb347', '#ff6ec7']].forEach(([ox, oy, c1, c2], i) => {
      ctx.save(); ctx.translate(ox, oy + Math.sin(t * 3 + i * 2) * s * .5); const k = Math.abs(Math.cos(flap + i)); 
      ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(0, -s * .18, s * .28 * k + 2, s * .25, -.3, 0, 6.3); ctx.ellipse(0, s * .18, s * .22 * k + 2, s * .2, .3, 0, 6.3); ctx.fill();
      ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, -s * .2, s * .07 * k + 1, 0, 6.3); ctx.fill();
      ctx.strokeStyle = '#333'; ctx.lineWidth = s * .05; ctx.beginPath(); ctx.moveTo(0, -s * .25); ctx.lineTo(0, s * .25); ctx.stroke();
      ctx.restore();
    });
  },
  dragon(ctx, s, flap, t) {
    ctx.save(); ctx.translate(-s * .05, -s * .1); wing(ctx, s * 1.2, flap, '#8e44ad', 1, '#5b2a73'); ctx.restore();
    ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = s * .2; ctx.beginPath(); ctx.moveTo(s * .4, 0);
    for (let i = 1; i <= 8; i++) ctx.lineTo(s * .4 - i * s * .22, Math.sin(t * 5 + i * .8) * s * .12 * i * .35);
    ctx.stroke();
    ctx.fillStyle = '#27ae60'; ctx.beginPath(); ctx.ellipse(s * .55, -s * .02, s * .3, s * .2, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.moveTo(s * .5, -s * .18); ctx.lineTo(s * .55, -s * .38); ctx.lineTo(s * .62, -s * .18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * .62, -s * .08, s * .06, 0, 6.3); ctx.fill(); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(s * .64, -s * .08, s * .03, 0, 6.3); ctx.fill();
    if (Math.sin(t * 3) > .3) { ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.arc(s * .95, 0, s * .12, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(s * 1.1, 0, s * .08, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ff5a3d'; ctx.beginPath(); ctx.arc(s * 1.2, 0, s * .05, 0, 6.3); ctx.fill(); }
  },
};
