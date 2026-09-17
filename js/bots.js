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
 * Lectura del rival a partir de lo que lleva hecho en la mesa.
 * @returns {number} 0 = pasivo como una piedra, 1 = sube por todo
 */
function lecturaAgresion(p) {
  const s = p && p.stats;
  if (!s || !s.hands) return 0.25;            // sin datos, un poco de credito
  const manos = Math.max(1, s.hands);
  const subidasPorMano = (s.raises || 0) / manos;
  const entradas = (s.vpip || 0) / manos;
  const acciones = (s.raises || 0) + (s.calls || 0) + (s.folds || 0);
  const proporcionSubidas = acciones ? (s.raises || 0) / acciones : 0;
  return Math.min(1, subidasPorMano * 0.5 + entradas * 0.25 + proporcionSubidas * 0.6);
}

/** Fuerza real de la mano: contra cuantos y con que board. */
function fuerzaDeMano(hole, board, rivales) {
  if (board.length === 0) {
    const eq = equity(hole, [], rivales, 260);
    const premio = Math.min(0.12, chenScore(hole) / 160);   // premia las manotas
    return Math.min(0.97, eq.win + eq.tie * 0.5 + premio);
  }
  const eq = equity(hole, board, rivales, 420);
  return eq.win + eq.tie * 0.5;
}

/**
 * Decide la accion de un bot.
 *
 * La idea: no basta con mirar las propias cartas. Si alguien sube en todas las
 * manos, su rango es mucho mas flojo de lo que aparenta y hay que pagarle mas
 * a menudo; si no, cualquiera se lleva todos los botes subiendo a lo bestia.
 *
 * @param {object} view snapshot del motor visto por el bot (con sus cartas)
 * @param {object} legal acciones legales
 * @returns {{action:string, amount:number}}
 */
export function decide(view, legal, style = 'solido') {
  const S = STYLES[style] || STYLES.solido;
  const me = view.players.find((p) => p && p.isYou);
  if (!me || !me.hole) return { action: legal.canCheck ? 'check' : 'fold' };

  const vivos = view.players.filter(
    (p) => p && !p.isYou && (p.status === 'active' || p.status === 'allin')
  );
  const rivales = Math.max(1, vivos.length);
  const bote = Math.max(1, view.potTotal + view.streetBets);
  const pagar = legal.toCall;
  const oddsBote = pagar > 0 ? pagar / (bote + pagar) : 0;
  const relativo = pagar / bote;                 // lo que pide respecto al bote
  const azar = () => Math.random();

  // --- ¿Quien ha subido y como de creible es? ---
  const agresor = vivos.find(
    (p) => p.lastAction && (p.lastAction.type === 'raise' || p.lastAction.type === 'bet')
  );
  const agresion = agresor ? lecturaAgresion(agresor) : 0.2;
  // Una subida desproporcionada respecto al bote huele todavia mas a farol.
  const desproporcion = Math.min(0.3, Math.max(0, relativo - 0.9) * 0.3);
  const farol = Math.min(0.62, agresion * 0.6 + desproporcion);

  // --- Fuerza propia ---
  const fuerza = fuerzaDeMano(me.hole, view.board, rivales);
  const nervios = (azar() - 0.5) * S.tilt * 0.35;
  // Contra un rival que sube por todo, nuestra mano vale mas de lo que dice la equity.
  const fuerzaEfectiva = Math.max(0, Math.min(0.99, fuerza + farol * 0.24 + nervios));

  const puedeSubir = legal.canRaise;
  const tamañoValor = () => Math.round(bote * (0.55 + azar() * 0.4));
  const subirA = (extra) => raiseTo(legal, Math.max(legal.minRaiseTo, (view.currentBet || 0) + extra));

  // ------------------------------------------------------------- manos fuertes
  if (fuerzaEfectiva > 0.80 && puedeSubir && azar() < 0.55 + S.aggr * 0.4) {
    return subirA(tamañoValor());
  }

  // --------------------------------------------------- castigar al que sube siempre
  // Si el agresor lo hace constantemente y tenemos algo, le resubimos.
  if (puedeSubir && farol > 0.38 && fuerzaEfectiva > 0.45 && azar() < S.aggr * 0.55) {
    return subirA(Math.round(bote * (0.6 + azar() * 0.3)));
  }

  // ------------------------------------------------------------- nadie ha apostado
  if (pagar === 0) {
    const apuestaValor = fuerzaEfectiva > 0.58 && azar() < S.aggr;
    const farolPropio = view.board.length >= 3 && fuerza < 0.35 && azar() < S.bluff;
    if (puedeSubir && (apuestaValor || farolPropio)) {
      return subirA(Math.round(bote * (farolPropio ? 0.45 + azar() * 0.25 : 0.5 + azar() * 0.35)));
    }
    return { action: 'check', amount: 0 };
  }

  // ------------------------------------------------------------------ hay que pagar
  // Umbral de equity necesario, rebajado segun lo farolero que parezca el rival.
  const margen = 0.035 * (1 - S.aggr);
  const umbral = Math.max(0.1, oddsBote * (1 - farol * 0.5) + margen);

  if (fuerzaEfectiva >= umbral) return { action: 'call', amount: pagar };

  // Precio ridiculo: se paga casi con cualquier cosa.
  if (oddsBote < 0.14 && fuerza > 0.16) return { action: 'call', amount: pagar };

  // Defensa minima: nadie puede robar todos los botes a base de subir. Con una
  // mano decente y un precio razonable, se paga una parte de las veces.
  if (fuerzaEfectiva > 0.30 && relativo <= 1.2) {
    const ganas = 0.24 + farol * 0.5 + (fuerzaEfectiva - 0.30) * 0.75;
    if (azar() < Math.min(0.78, ganas)) return { action: 'call', amount: pagar };
  }

  // Cazar el farol de vez en cuando aunque la mano sea mediocre.
  if (farol > 0.45 && fuerza > 0.24 && azar() < S.bluff + 0.08) {
    return { action: 'call', amount: pagar };
  }

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
