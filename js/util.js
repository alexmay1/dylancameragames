export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, String(val));
  } catch (e) { return null; }
}

export const HUES = [330, 200, 50, 130, 275, 20, 175];
export const hsl = (h, s = 90, l = 55, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;

export class Particles {
  constructor() { this.list = []; }
  burst(x, y, hue, n = 14, speed = 320, size = 7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(.3, 1) * speed;
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.4, .8), age: 0, size: rand(.5, 1) * size, hue: hue + rand(-20, 20), g: 400 });
    }
  }
  confetti(x, y, n = 60, spread = 700) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0), s = rand(.3, 1) * spread;
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1, 1.8), age: 0, size: rand(6, 12), hue: rand(0, 360), g: 900, rect: true, rot: rand(0, 6) });
    }
  }
  update(dt) {
    for (const p of this.list) {
      p.age += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= (1 - .8 * dt);
      if (p.rot !== undefined) p.rot += dt * 8;
    }
    this.list = this.list.filter(p => p.age < p.life);
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = 1 - p.age / p.life;
      ctx.fillStyle = hsl(p.hue, 95, 60, a);
      if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * .6), 0, 6.3); ctx.fill(); }
    }
  }
}

export class Popups {
  constructor() { this.list = []; }
  add(x, y, text, color = '#ffe45e', size = 34) { this.list.push({ x, y, text, color, size, age: 0, life: .9 }); }
  update(dt) { for (const p of this.list) { p.age += dt; p.y -= 70 * dt; } this.list = this.list.filter(p => p.age < p.life); }
  draw(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.list) {
      const a = 1 - p.age / p.life, s = p.size * (1 + .3 * Math.max(0, 1 - p.age * 6));
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.font = `900 ${s}px -apple-system, system-ui, sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(60,20,120,.9)'; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}

export function bigText(ctx, text, x, y, size, color = '#ffe45e') {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${size}px -apple-system, system-ui, sans-serif`;
  ctx.lineWidth = size * .12; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#5b2bb5'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

export function drawBubble(ctx, x, y, r, hue, gold = false) {
  ctx.save();
  const g = ctx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
  if (gold) { g.addColorStop(0, 'rgba(255,255,200,.85)'); g.addColorStop(1, 'rgba(255,190,30,.7)'); }
  else { g.addColorStop(0, hsl(hue, 100, 90, .35)); g.addColorStop(.75, hsl(hue, 95, 65, .35)); g.addColorStop(1, hsl(hue, 95, 55, .7)); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  ctx.lineWidth = Math.max(3, r * .07); ctx.strokeStyle = gold ? '#fff2a0' : hsl(hue, 100, 85, .95); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.ellipse(x - r * .38, y - r * .42, r * .22, r * .12, -.8, 0, 6.3); ctx.fill();
  if (gold) { ctx.font = `900 ${r * .9}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⭐', x, y + r * .05); }
  ctx.restore();
}

export function drawBall(ctx, x, y, r, hue) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(x + r * .15, y + r * .25, r, r * .95, 0, 0, 6.3); ctx.fill();
  const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
  g.addColorStop(0, hsl(hue, 100, 85)); g.addColorStop(.45, hsl(hue, 95, 55)); g.addColorStop(1, hsl(hue, 90, 33));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  ctx.lineWidth = Math.max(2, r * .06); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.ellipse(x - r * .35, y - r * .4, r * .2, r * .11, -.8, 0, 6.3); ctx.fill();
  ctx.restore();
}

export function drawHeartsText(n, max) { return '❤️'.repeat(Math.max(0, n)) + '🤍'.repeat(Math.max(0, max - n)); }
