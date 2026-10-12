/* Simplified bowling: F frames, 2 rolls each; last frame gets bonus rolls on a strike (2) or spare (1). */
export function bowlState(rolls, F = 5) {
  let i = 0;
  for (let f = 0; f < F; f++) {
    const r1 = rolls[i]; if (r1 === undefined) return { done: false, frame: f, ball: 0 };
    if (f < F - 1) { if (r1 === 10) { i++; continue; } if (rolls[i + 1] === undefined) return { done: false, frame: f, ball: 1 }; i += 2; continue; }
    const r2 = rolls[i + 1]; if (r2 === undefined) return { done: false, frame: f, ball: 1 };
    if ((r1 === 10 || r1 + r2 === 10) && rolls[i + 2] === undefined) return { done: false, frame: f, ball: 2 };
    return { done: true, frame: F - 1, ball: 0 };
  }
  return { done: true, frame: F - 1, ball: 0 };
}
/** frames: [{ r: ['X'] | ['7','/'] | ['3','4'], cum: number|null }] */
export function bowlScore(rolls, F = 5) {
  const out = []; let i = 0, total = 0, ok = true;
  const mark = (v, prev) => v === 10 ? 'X' : prev !== undefined && prev + v === 10 ? '/' : v === 0 ? '-' : String(v);
  for (let f = 0; f < F; f++) {
    const r1 = rolls[i], fr = { r: [], cum: null };
    if (r1 === undefined) { out.push(fr); ok = false; continue; }
    let add = null, used = 1;
    if (f < F - 1) {
      if (r1 === 10) { fr.r = ['X']; const b1 = rolls[i + 1], b2 = rolls[i + 2]; if (b1 !== undefined && b2 !== undefined) add = 10 + b1 + b2; }
      else { const r2 = rolls[i + 1]; fr.r = [mark(r1)]; used = 2; if (r2 !== undefined) { fr.r.push(mark(r2, r1)); if (r1 + r2 === 10) { const b = rolls[i + 2]; if (b !== undefined) add = 10 + b; } else add = r1 + r2; } }
    } else {
      const rest = rolls.slice(i); fr.r = rest.map((v, k) => (k === 0 ? mark(v) : (v === 10 ? 'X' : rest[k - 1] !== 10 && rest[k - 1] + v === 10 && (k === 1 || rest[0] === 10) ? '/' : v === 0 ? '-' : String(v))));
      const st = bowlState(rolls, F); if (st.done) add = rest.reduce((a, b) => a + b, 0);
    }
    if (add !== null && ok) { total += add; fr.cum = total; } else ok = false;
    out.push(fr); i += used;
  }
  return out;
}
export const bowlTotal = (rolls, F = 5) => { const s = bowlScore(rolls, F).filter(f => f.cum !== null); return s.length ? s[s.length - 1].cum : 0; };
