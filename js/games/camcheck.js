import { clamp } from '../util.js?v=23';

/* Camera check: live skeleton + hand overlay with FPS / detection state, so you can position the device. */
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32]];
export class CamCheckGame {
  constructor(app) { this.app = app; }
  start() { const a = this.app; this.t = 0; a.pose.enabled = !!(a.cameraOn && a.poseReady); a.pose.minInterval = 40; a.setScoreLabel('Check'); a.setScore('📷'); a.setLeft('Camera check'); a.setRight(''); a.hint(null); }
  destroy() { this.app.pose.enabled = false; }
  update(dt) { this.t += dt; }
  draw(ctx) {
    const a = this.app, { W, H, min } = a, now = performance.now() / 1000, s = a.pose.state, port = W < H;
    ctx.fillStyle = 'rgba(10,5,40,.22)'; ctx.fillRect(0, 0, W, H);
    const fresh = a.pose.enabled && s.pts && now - s.t < .5; let seen = 0;
    if (fresh) {
      const P = s.pts, m = (i) => a.mapPoint(P[i].x, P[i].y), vis = (i) => P[i] && (P[i].visibility ?? 1) > .3;
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(4, min * .01);
      for (const [i, j] of BONES) if (vis(i) && vis(j)) { const p = m(i), q = m(j); ctx.strokeStyle = 'rgba(125,255,176,.9)'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      for (const i in P) if (vis(i)) { seen++; const p = m(i); ctx.fillStyle = [15, 16].includes(+i) ? '#ffe45e' : '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, [15, 16].includes(+i) ? min * .014 : min * .009, 0, 6.3); ctx.fill(); }
    }
    const q = a.quality(), hn = a.hands.filter(h => !h.pointer).length;
    const lines = [
      `${q.icon} Tracking: ${q.label}`,
      `🖐 Hands: ${hn} seen · ${a.tracker.detFps.toFixed(0)} fps · ${a.tracker.mode} · ${a.tracker.delegate || '—'}`,
      a.cameraOn ? (a.pose.enabled ? `🧍 Body: ${fresh && s.visible ? 'found' : fresh ? 'partly visible' : 'not found'} (${seen} points) · ${a.pose.fps.toFixed(0)} fps · ${a.pose.cost.toFixed(0)} ms · ${a.pose.info || '—'}` : '🧍 Body: model not loaded (tap Camera check again)') : '🧍 Body: no camera (touch mode)',
      `💡 Light: ${a.light === null ? '—' : a.light < 60 ? 'too dark' : a.light > 215 ? 'very bright' : 'good'}`,
    ];
    const fs = clamp(min * .03, 13, 20), lh = fs * 1.5, tips = ['Face a window or lamp — light on you, not behind you', 'Plain background helps', 'Body games: stand 6–8 ft back so your head to feet fit', 'Hand games: keep your hands in view'];
    const w = Math.min(W - 20, 560), hh = lh * (lines.length + tips.length + 1.6) + 20, x = 10, y = port ? 150 : 70;
    ctx.fillStyle = 'rgba(15,10,50,.82)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, 14) : ctx.rect(x, y, w, hh); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `800 ${fs}px system-ui`; let yy = y + 12; ctx.fillStyle = '#fff';
    for (const l of lines) { ctx.fillText(l, x + 14, yy, w - 28); yy += lh; }
    yy += lh * .3; ctx.fillStyle = '#ffe45e'; ctx.fillText('Tips', x + 14, yy); yy += lh; ctx.font = `600 ${fs * .95}px system-ui`; ctx.fillStyle = '#d6dcff';
    for (const t of tips) { ctx.fillText('• ' + t, x + 14, yy, w - 28); yy += lh; }
  }
}
