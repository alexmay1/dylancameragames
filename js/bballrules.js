import { clamp } from './util.js?v=23';
/* Basketball shot maths. Metres: ex = sideways miss, ez = long(+)/short(-) miss, both measured at the rim. */
export const idealPower = (Zh) => .35 + .45 * clamp((Zh - 3.4) / 3.6, 0, 1);
export function shotError(f, Zh, hoopScreenX, sHoop) {
  const ex = clamp(((f.x - hoopScreenX) / sHoop) * .4 + clamp(f.dir, -1, 1) * .5, -2.5, 2.5);
  return { ex, ez: (f.power - idealPower(Zh)) * 2.4 };
}
export function outcome(ex, ez, rnd = Math.random) {
  const d = Math.hypot(ex, ez);
  if (d < .24) return 'swish';
  if (d < .58) return rnd() < .55 ? 'rimIn' : 'rimOut';
  if (ez > .5 && Math.abs(ex) < .7 && rnd() < .3) return 'bank';
  return 'miss';
}
export const basketPoints = (streak, kind) => 2 + (kind === 'swish' ? 1 : 0) + (streak >= 5 ? 2 : streak >= 3 ? 1 : 0);
