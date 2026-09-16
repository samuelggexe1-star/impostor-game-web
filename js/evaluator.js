// Evaluador de manos de poker: mejor combinacion de 5 entre 7 cartas.
// Devuelve un score entero comparable: mayor = mejor.

import { RANK_LABEL } from './cards.js';

export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8
};

export const CAT_NAME = [
  'Carta alta', 'Pareja', 'Doble pareja', 'Trio', 'Escalera',
  'Color', 'Full', 'Poker', 'Escalera de color'
];

const RANK_WORD = {
  2: 'doses', 3: 'treses', 4: 'cuatros', 5: 'cincos', 6: 'seises', 7: 'sietes',
  8: 'ochos', 9: 'nueves', 10: 'dieces', 11: 'jotas', 12: 'reinas', 13: 'reyes', 14: 'ases'
};

/** Empaqueta categoria + 5 desempates en un entero (base 16). */
function pack(cat, kickers) {
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 16 + (kickers[i] || 0);
  return v;
}

/** Busca la escalera mas alta en un set de rangos distintos ordenado desc. Devuelve la carta alta o 0. */
function findStraight(sortedDistinctDesc) {
  const rs = sortedDistinctDesc;
  // La rueda: A-5-4-3-2 cuenta como escalera al 5.
  const withWheel = rs[0] === 14 ? rs.concat([1]) : rs;
  let run = 1;
  for (let i = 1; i < withWheel.length; i++) {
    if (withWheel[i] === withWheel[i - 1] - 1) {
      run++;
      if (run >= 5) return withWheel[i] + 4;
    } else {
      run = 1;
    }
  }
  return 0;
}

/**
 * Evalua 5..7 cartas.
 * @returns {{score:number, cat:number, name:string, best:Array, kickers:number[]}}
 */
export function evaluate(cards) {
  const bySuit = { s: [], h: [], d: [], c: [] };
  const countByRank = new Array(15).fill(0);
  for (const c of cards) {
    bySuit[c.s].push(c.r);
    countByRank[c.r]++;
  }

  let flushSuit = null;
  for (const s of ['s', 'h', 'd', 'c']) {
    if (bySuit[s].length >= 5) flushSuit = s;
  }

  // Escalera de color
  if (flushSuit) {
    const fr = [...new Set(bySuit[flushSuit])].sort((a, b) => b - a);
    const sfHigh = findStraight(fr);
    if (sfHigh) {
      const kick = [sfHigh, 0, 0, 0, 0];
      return finish(CAT.STRAIGHT_FLUSH, kick, cards, { straightHigh: sfHigh, suit: flushSuit });
    }
  }

  const quads = [], trips = [], pairs = [];
  const singles = [];
  for (let r = 14; r >= 2; r--) {
    const n = countByRank[r];
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }
  const allDesc = [];
  for (let r = 14; r >= 2; r--) if (countByRank[r]) allDesc.push(r);

  if (quads.length) {
    const q = quads[0];
    const kicker = allDesc.find((r) => r !== q) || 0;
    return finish(CAT.QUADS, [q, kicker, 0, 0, 0], cards, { quad: q, kicker });
  }

  if (trips.length && (pairs.length || trips.length > 1)) {
    const t = trips[0];
    const pairRank = trips.length > 1 ? Math.max(trips[1], pairs[0] || 0) : pairs[0];
    return finish(CAT.FULL_HOUSE, [t, pairRank, 0, 0, 0], cards, { trip: t, pair: pairRank });
  }

  if (flushSuit) {
    const fr = [...bySuit[flushSuit]].sort((a, b) => b - a).slice(0, 5);
    return finish(CAT.FLUSH, fr, cards, { suit: flushSuit });
  }

  const straightHigh = findStraight(allDesc);
  if (straightHigh) {
    return finish(CAT.STRAIGHT, [straightHigh, 0, 0, 0, 0], cards, { straightHigh });
  }

  if (trips.length) {
    const t = trips[0];
    const ks = allDesc.filter((r) => r !== t).slice(0, 2);
    return finish(CAT.TRIPS, [t, ks[0] || 0, ks[1] || 0, 0, 0], cards, { trip: t });
  }

  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const kicker = allDesc.find((r) => r !== p1 && r !== p2) || 0;
    return finish(CAT.TWO_PAIR, [p1, p2, kicker, 0, 0], cards, { pairs: [p1, p2], kicker });
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    const ks = allDesc.filter((r) => r !== p).slice(0, 3);
    return finish(CAT.PAIR, [p, ks[0] || 0, ks[1] || 0, ks[2] || 0, 0], cards, { pair: p });
  }

  const hi = allDesc.slice(0, 5);
  return finish(CAT.HIGH, hi, cards, {});
}

/** Reconstruye las 5 cartas concretas que forman la jugada, para poder resaltarlas. */
function pickBest(cat, kickers, cards, info) {
  const used = [];
  const take = (pred, n) => {
    for (const c of cards) {
      if (used.length >= 5) break;
      if (used.includes(c)) continue;
      if (pred(c) && n > 0) {
        used.push(c);
        n--;
      }
    }
  };

  if (cat === CAT.STRAIGHT_FLUSH || cat === CAT.STRAIGHT) {
    const high = info.straightHigh;
    const wanted = [];
    for (let i = 0; i < 5; i++) {
      let r = high - i;
      if (r === 1) r = 14; // la rueda usa el As como 1
      wanted.push(r);
    }
    for (const r of wanted) {
      const c = cards.find((x) => x.r === r && !used.includes(x) && (cat === CAT.STRAIGHT_FLUSH ? x.s === info.suit : true));
      if (c) used.push(c);
    }
    return used;
  }
  if (cat === CAT.FLUSH) {
    const fr = cards.filter((c) => c.s === info.suit).sort((a, b) => b.r - a.r).slice(0, 5);
    return fr;
  }
  if (cat === CAT.QUADS) {
    take((c) => c.r === info.quad, 4);
    take((c) => c.r === info.kicker, 1);
    return used;
  }
  if (cat === CAT.FULL_HOUSE) {
    take((c) => c.r === info.trip, 3);
    take((c) => c.r === info.pair, 2);
    return used;
  }
  if (cat === CAT.TRIPS) {
    take((c) => c.r === info.trip, 3);
    for (let i = 1; i <= 2; i++) take((c) => c.r === kickers[i], 1);
    return used;
  }
  if (cat === CAT.TWO_PAIR) {
    take((c) => c.r === info.pairs[0], 2);
    take((c) => c.r === info.pairs[1], 2);
    take((c) => c.r === info.kicker, 1);
    return used;
  }
  if (cat === CAT.PAIR) {
    take((c) => c.r === info.pair, 2);
    for (let i = 1; i <= 3; i++) take((c) => c.r === kickers[i], 1);
    return used;
  }
  for (const k of kickers) if (k) take((c) => c.r === k, 1);
  return used;
}

function finish(cat, kickers, cards, info) {
  return {
    cat,
    kickers,
    score: pack(cat, kickers),
    name: describe(cat, kickers, info),
    best: pickBest(cat, kickers, cards, info)
  };
}

function describe(cat, k, info) {
  const L = (r) => RANK_LABEL[r === 1 ? 14 : r];
  switch (cat) {
    case CAT.STRAIGHT_FLUSH:
      return k[0] === 14 ? 'Escalera real' : `Escalera de color al ${L(k[0])}`;
    case CAT.QUADS: return `Poker de ${RANK_WORD[k[0]]}`;
    case CAT.FULL_HOUSE: return `Full de ${RANK_WORD[k[0]]} con ${RANK_WORD[k[1]]}`;
    case CAT.FLUSH: return `Color al ${L(k[0])}`;
    case CAT.STRAIGHT: return `Escalera al ${L(k[0])}`;
    case CAT.TRIPS: return `Trio de ${RANK_WORD[k[0]]}`;
    case CAT.TWO_PAIR: return `Doble pareja, ${RANK_WORD[k[0]]} y ${RANK_WORD[k[1]]}`;
    case CAT.PAIR: return `Pareja de ${RANK_WORD[k[0]]}`;
    default: return `Carta alta ${L(k[0])}`;
  }
}

/** Nombre corto para el HUD (sin kickers). */
export function shortName(ev) {
  return CAT_NAME[ev.cat];
}
