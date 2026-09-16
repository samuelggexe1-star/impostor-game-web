// Probabilidades por simulacion de Montecarlo.
// Se usa para el HUD de equity y para que los bots decidan.

import { makeDeck } from './cards.js';
import { evaluate } from './evaluator.js';

function keyOf(c) {
  return c.r * 4 + { s: 0, h: 1, d: 2, c: 3 }[c.s];
}

/**
 * Equity aproximada del heroe contra N rivales con mano aleatoria.
 * @returns {{win:number, tie:number, lose:number, iters:number}}
 */
export function equity(hole, board = [], opponents = 1, iters = 1200) {
  if (!hole || hole.length < 2 || opponents < 1) return { win: 1, tie: 0, lose: 0, iters: 0 };
  const dead = new Set([...hole, ...board].map(keyOf));
  const stock = makeDeck().filter((c) => !dead.has(keyOf(c)));
  let win = 0;
  let tie = 0;

  for (let it = 0; it < iters; it++) {
    // Baraja parcial: solo lo que hace falta para esta simulacion.
    const need = 5 - board.length + opponents * 2;
    const pool = stock.slice();
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    let k = 0;
    const full = board.concat(pool.slice(k, k + (5 - board.length)));
    k += 5 - board.length;
    const heroScore = evaluate(hole.concat(full)).score;
    let best = -1;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const villain = [pool[k++], pool[k++]];
      const s = evaluate(villain.concat(full)).score;
      if (s > best) best = s;
    }
    if (heroScore > best) win++;
    else if (heroScore === best) tie++;
  }
  return { win: win / iters, tie: tie / iters, lose: 1 - (win + tie) / iters, iters };
}

/** Puntuacion Chen: fuerza rapida de una mano preflop (sin simular). */
export function chenScore(hole) {
  const [a, b] = hole[0].r >= hole[1].r ? hole : [hole[1], hole[0]];
  const val = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score = val(a.r);
  if (a.r === b.r) {
    score = Math.max(5, val(a.r) * 2);
    return score;
  }
  if (a.s === b.s) score += 2;
  const gap = a.r - b.r - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  if (gap <= 1 && a.r < 12) score += 1;
  return Math.max(0, Math.round(score));
}

/** Nombre corto de la mano preflop: "AKs", "77", "T9o". */
export function holeLabel(hole) {
  const L = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
  const lab = (r) => L[r] || String(r);
  const [a, b] = hole[0].r >= hole[1].r ? hole : [hole[1], hole[0]];
  if (a.r === b.r) return lab(a.r) + lab(b.r);
  return lab(a.r) + lab(b.r) + (a.s === b.s ? 's' : 'o');
}
