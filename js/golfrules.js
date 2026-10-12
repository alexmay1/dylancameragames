/* Golf rules (metres). The tee is at (0,0); the hole lies up the +y axis (a little off to one side on some holes). */
export const HOLES = [
  { par: 3, hole: { x: 0, y: 115 }, fw: 26, green: 14, bunkers: [{ x: -13, y: 96, rx: 8, ry: 5 }, { x: 14, y: 124, rx: 7, ry: 5 }], water: null },
  { par: 4, hole: { x: 14, y: 215 }, fw: 28, green: 14, bunkers: [{ x: 2, y: 150, rx: 7, ry: 6 }, { x: 26, y: 205, rx: 7, ry: 5 }], water: null },
  { par: 3, hole: { x: -8, y: 135 }, fw: 24, green: 14, bunkers: [{ x: 12, y: 130, rx: 7, ry: 5 }], water: { x: -2, y: 82, rx: 16, ry: 10 } },
];
const ell = (p, e) => ((p.x - e.x) / e.rx) ** 2 + ((p.y - e.y) / e.ry) ** 2 < 1;
export function lineDist(h, p) { // distance from the tee→hole line segment
  const hx = h.hole.x, hy = h.hole.y, l2 = hx * hx + hy * hy, t = Math.max(0, Math.min(1, (p.x * hx + p.y * hy) / l2));
  return Math.hypot(p.x - hx * t, p.y - hy * t);
}
export function terrainAt(h, p) {
  if (Math.hypot(p.x - h.hole.x, p.y - h.hole.y) < h.green) return 'green';
  if (h.water && ell(p, h.water)) return 'water';
  for (const b of h.bunkers) if (ell(p, b)) return 'sand';
  if (lineDist(h, p) > 55 || p.y < -25 || p.y > h.hole.y + 60) return 'oob';
  if (lineDist(h, p) < h.fw / 2) return 'fairway';
  return 'rough';
}
export const modeAt = (h, p) => { const t = terrainAt(h, p); if (t === 'green') return 'putt'; return Math.hypot(h.hole.x - p.x, h.hole.y - p.y) < 70 ? 'pitch' : 'drive'; };
export const MODE = { drive: { hi: 1.4, max: 3.5, drop: .55 }, pitch: { hi: 1.0, max: 2.5, drop: .55 }, putt: { hi: .3, max: 1.3, drop: .42 } };
/** power 0.25..1 -> metres */
export function strokeDistance(mode, power, terrain = 'fairway') {
  const k = Math.max(0, Math.min(1, (power - .25) / .75));
  const base = mode === 'putt' ? 1.5 + k * 16 : mode === 'pitch' ? 15 + k * 70 : 60 + k * 170;
  return base * (mode === 'putt' ? 1 : terrain === 'sand' ? .55 : terrain === 'rough' ? .75 : 1);
}
export function shotResult(h, B, o) {
  const dx = h.hole.x - B.x, dy = h.hole.y - B.y, psi = Math.atan2(dx, dy) + o.aim + (o.noise || 0), dir = { x: Math.sin(psi), y: Math.cos(psi) };
  const D = strokeDistance(o.mode, o.power, terrainAt(h, B)), W = o.wind || { x: 0, y: 0 };
  if (o.mode === 'putt') {
    const t = dx * dir.x + dy * dir.y, pd = Math.abs(dx * dir.y - dy * dir.x), holed = t > 0 && t <= D + .3 && pd < .7 && (D - t) < 5.5;
    const rest = holed ? { x: h.hole.x, y: h.hole.y } : { x: B.x + dir.x * D, y: B.y + dir.y * D };
    return { mode: 'putt', D, dir, T: 0, land: rest, rest, terrain: 'green', holed, penalty: false };
  }
  const T = .8 + D / 180, land = { x: B.x + dir.x * D + W.x * T * .9, y: B.y + dir.y * D + W.y * T * .9 }, lt = terrainAt(h, land);
  if (lt === 'water' || lt === 'oob') return { mode: o.mode, D, dir, T, land, rest: { x: B.x, y: B.y }, terrain: lt, holed: false, penalty: true };
  const roll = lt === 'fairway' ? .12 : lt === 'green' ? .07 : lt === 'rough' ? .03 : 0;
  let rest = { x: land.x + dir.x * D * roll, y: land.y + dir.y * D * roll }; const rt = terrainAt(h, rest); if (rt === 'water' || rt === 'oob') rest = land;
  const holed = terrainAt(h, rest) === 'green' && Math.hypot(rest.x - h.hole.x, rest.y - h.hole.y) < 1.0;
  return { mode: o.mode, D, dir, T, land, rest: holed ? { x: h.hole.x, y: h.hole.y } : rest, terrain: terrainAt(h, rest), holed, penalty: false };
}
export const holePoints = (par, strokes) => Math.max(0, par + 4 - strokes) * 10;
export const holeName = (par, s) => s === 1 ? 'HOLE IN ONE!' : s <= par - 2 ? 'EAGLE!' : s === par - 1 ? 'BIRDIE!' : s === par ? 'PAR' : s === par + 1 ? 'Bogey' : 'Keep going!';
