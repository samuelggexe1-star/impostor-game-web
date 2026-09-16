// Bots con personalidad. No hacen trampa: solo ven sus cartas, el board y el bote.

import { equity, chenScore } from './odds.js';

export const STYLES = {
  roca:     { name: 'Roca',     avatar: '🗿', vpip: 0.16, aggr: 0.25, bluff: 0.04, tilt: 0.0 },
  solido:   { name: 'Solido',   avatar: '🤖', vpip: 0.26, aggr: 0.45, bluff: 0.10, tilt: 0.05 },
  loco:     { name: 'Loco',     avatar: '🤪', vpip: 0.62, aggr: 0.70, bluff: 0.30, tilt: 0.25 },
  tiburon:  { name: 'Tiburon',  avatar: '🦈', vpip: 0.30, aggr: 0.62, bluff: 0.18, tilt: 0.02 },
  pescado:  { name: 'Pescado',  avatar: '🐟', vpip: 0.70, aggr: 0.20, bluff: 0.06, tilt: 0.10 },
  maniaco:  { name: 'Maniaco',  avatar: '🔥', vpip: 0.80, aggr: 0.85, bluff: 0.42, tilt: 0.30 }
};

export const BOT_NAMES = [
  'Lucia', 'Bruno', 'Nacho', 'Elena', 'Kiko', 'Marta', 'Dani', 'Vera',
  'Pablo', 'Sara', 'Toni', 'Ines', 'Rulo', 'Chema', 'Noa'
];

/**
 * Decide la accion de un bot.
 * @param {object} view snapshot del motor visto por el bot (con sus cartas)
 * @param {object} legal acciones legales
 * @returns {{action:string, amount:number}}
 */
export function decide(view, legal, style = 'solido') {
  const S = STYLES[style] || STYLES.solido;
  const me = view.players.find((p) => p && p.isYou);
  if (!me || !me.hole) return { action: legal.canCheck ? 'check' : 'fold' };

  const rivals = view.players.filter((p) => p && !p.isYou && (p.status === 'active' || p.status === 'allin')).length;
  const pot = Math.max(1, view.potTotal + view.streetBets);
  const toCall = legal.toCall;
  const potOdds = toCall / (pot + toCall);
  const jitter = (n) => (Math.random() - 0.5) * n;

  let strength;
  if (view.board.length === 0) {
    // Preflop: Chen normalizado a 0..1 (20 es AA).
    strength = Math.min(1, chenScore(me.hole) / 20);
    const openness = S.vpip;
    if (strength < 0.28 * (1 - openness + 0.5) && toCall > 0) {
      const defend = strength > 0.2 && potOdds < 0.12;
      if (!defend) return fold(legal);
    }
  } else {
    const eq = equity(me.hole, view.board, Math.max(1, rivals), 320);
    strength = eq.win + eq.tie * 0.5;
  }

  const adjusted = Math.max(0, Math.min(1, strength + jitter(S.tilt * 0.4)));
  const bluffing = Math.random() < S.bluff && view.board.length >= 3;
  const wantsAggression = adjusted > 0.62 || (bluffing && adjusted < 0.35);
  const bigBet = Math.round(pot * (0.55 + Math.random() * 0.35));

  // Mano monstruo: sube casi siempre para construir bote.
  if (adjusted > 0.85 && legal.canRaise && Math.random() < 0.85) {
    return raiseTo(legal, Math.max(legal.minRaiseTo, (view.currentBet || 0) + bigBet));
  }

  if (wantsAggression && legal.canRaise && Math.random() < S.aggr) {
    const size = bluffing ? Math.round(pot * (0.4 + Math.random() * 0.3)) : bigBet;
    return raiseTo(legal, Math.max(legal.minRaiseTo, (view.currentBet || 0) + size));
  }

  if (toCall === 0) return { action: 'check', amount: 0 };

  // Paga si la equity supera las probabilidades del bote (con margen por estilo).
  const margin = 0.03 + (1 - S.aggr) * 0.05;
  if (adjusted > potOdds + margin) return { action: 'call', amount: toCall };
  if (adjusted > potOdds - 0.04 && Math.random() < S.vpip) return { action: 'call', amount: toCall };
  return fold(legal);
}

function fold(legal) {
  return legal.canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
}

function raiseTo(legal, target) {
  let to = Math.round(target / 5) * 5;
  to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
  // Si subir se come casi toda la pila, mejor ir con todo.
  if (to > legal.maxRaiseTo * 0.72) to = legal.maxRaiseTo;
  return { action: 'raise', amount: to };
}

/** Frase para el chat segun lo que acaba de pasar. */
export function botChatter(kind) {
  const lines = {
    win: ['gg', 'Facil 😎', 'Gracias por las fichas', 'Lo tenia clarisimo', 'jaja qué suerte'],
    lose: ['Buena mano', 'Menudo river...', 'nh', 'Me lo esperaba', 'Siempre igual 😤'],
    bluffCaught: ['Me pillaste', 'Tenia que intentarlo', '🫠'],
    allin: ['Vamos allá', 'Todo dentro', 'A ver qué pasa 🎲']
  };
  const arr = lines[kind] || lines.win;
  return arr[Math.floor(Math.random() * arr.length)];
}
