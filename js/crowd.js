/* Shared stadium crowd (used by Baseball and Football). Canvas-drawn, batched fills so it stays cheap on iPad.
 * Fields: excite (0..1 cheering), sad (seconds of groaning), wave (seconds of stadium wave). v = {W,H,hy} (hy = horizon y). */
export class Crowd {
  constructor() { this.t = 0; this.excite = 0; this.sad = 0; this.wave = 0; this.key = ''; this.rows = []; this.count = 0; }
  update(dt) { this.t += dt; this.excite = Math.max(0, this.excite - dt * .4); this.sad = Math.max(0, this.sad - dt); this.wave = Math.max(0, this.wave - dt); }
  build(v) {
    const C = this, key = v.W + 'x' + v.H; if (C.key === key) return; C.key = key;
    const sh = v.H * .17, top = v.hy - sh, size = Math.max(9, Math.min(24, v.W / 28)), ROWS = Math.max(3, Math.min(8, Math.floor(sh / (size * 1.2)))), rowH = sh / ROWS, sp = size * .92;
    const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    C.top = top; C.sh = sh; C.rowH = rowH; C.size = size; C.rows = []; C.count = 0;
    for (let r = 0; r < ROWS; r++) {
      const row = { r, specs: [] }, off = (r % 2) * sp * .5;
      for (let x = -sp + off; x < v.W + sp; x += sp) {
        const sp1 = { x: x + (rnd() - .5) * sp * .4, shirt: Math.floor(rnd() * 8), skin: Math.floor(rnd() * 4), ph: rnd() * 6.28, exc: .55 + rnd() * .45, cap: rnd() < .25, y: 0, arm: 0 };
        row.specs.push(sp1); C.count++;
      }
      C.rows.push(row);
    }
  }
  draw(ctx, v) {
    this.build(v);
    const C = this, { top, sh, rowH, size } = C, t = C.t, W = v.W;
    const SHIRTS = ['#ff4f4f', '#4f8bff', '#ffd23f', '#52d66b', '#ff8a3d', '#c05cff', '#ffffff', '#35d0d0'], SKINS = ['#f6d0b0', '#e0a97c', '#b67d52', '#7a4b2d'];
    ctx.save(); ctx.beginPath(); ctx.rect(0, top - size * 2, W, sh + size * 2); ctx.clip();
    // stand body + tiers
    ctx.fillStyle = '#2a2250'; ctx.fillRect(0, top, W, sh + 2);
    for (let r = 0; r < C.rows.length; r++) { ctx.fillStyle = r % 2 ? 'rgba(90,80,150,.55)' : 'rgba(60,50,110,.55)'; ctx.fillRect(0, top + r * rowH, W, rowH); }
    const ex = C.excite, sad = C.sad > 0;
    for (const row of C.rows) {
      const baseY = top + row.r * rowH + rowH * .42;
      for (const s of row.specs) {
        let e = ex * s.exc, up = 0;
        if (C.wave > 0) { const w = Math.sin(t * 3.4 - s.x / W * 7) - .15; up = Math.max(up, Math.min(1, Math.max(0, w * 2)) * Math.min(1, C.wave)); }
        if (e > .12) up = Math.max(up, e * (.6 + .4 * Math.sin(t * 10 + s.ph)));
        s.arm = up;
        s.y = baseY - (e * size * .22 * (.5 + .5 * Math.sin(t * 11 + s.ph)) + up * size * .08) + Math.sin(t * 1.5 + s.ph) * size * .03 + (sad ? size * .1 : 0);
      }
      // torsos by shirt colour (one fill each)
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = SHIRTS[c]; ctx.beginPath();
        for (const s of row.specs) if (s.shirt === c) ctx.rect(s.x - size * .4, s.y + size * .2, size * .8, rowH * 1.1);
        ctx.fill();
      }
      // arms (skin) — raised when cheering
      ctx.strokeStyle = '#e0a97c'; ctx.lineWidth = Math.max(1.5, size * .15); ctx.lineCap = 'round'; ctx.beginPath();
      for (const s of row.specs) if (s.arm > .05) {
        const k = s.arm, sw = Math.sin(t * 9 + s.ph) * size * .25 * k;
        ctx.moveTo(s.x - size * .38, s.y + size * .35); ctx.lineTo(s.x - size * (.55 + .2 * k) + sw, s.y + size * .35 - size * (.9 * k));
        ctx.moveTo(s.x + size * .38, s.y + size * .35); ctx.lineTo(s.x + size * (.55 + .2 * k) - sw, s.y + size * .35 - size * (.9 * k));
      }
      ctx.stroke();
      // heads by skin tone
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = SKINS[c]; ctx.beginPath();
        for (const s of row.specs) if (s.skin === c) { ctx.moveTo(s.x + size * .3, s.y); ctx.arc(s.x, s.y, size * .3, 0, 6.3); }
        ctx.fill();
      }
      // caps
      ctx.fillStyle = '#e63946'; ctx.beginPath();
      for (const s of row.specs) if (s.cap) { ctx.moveTo(s.x + size * .3, s.y - size * .02); ctx.arc(s.x, s.y - size * .02, size * .3, Math.PI, 0); }
      ctx.fill();
    }
    // camera flashes when the crowd is wild
    if (ex > .4) { ctx.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 6; i++) { const row = C.rows[(Math.random() * C.rows.length) | 0], s = row.specs[(Math.random() * row.specs.length) | 0]; if (Math.random() < ex) { ctx.beginPath(); ctx.arc(s.x, s.y, size * (.25 + Math.random() * .3), 0, 6.3); ctx.fill(); } } }
    ctx.restore();
    // front wall
    ctx.fillStyle = '#1f7a3a'; ctx.fillRect(0, v.hy - 3, W, 6); ctx.fillStyle = '#ffd23f'; ctx.fillRect(0, v.hy - 3, W, 2);
  }
}
