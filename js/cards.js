// Baraja, cartas y utilidades de azar.
// Una carta es {r, s} con r = 2..14 (14 = As) y s = 's'|'h'|'d'|'c'.

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'treboles' };
export const RANK_LABEL = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

/** PRNG determinista (mulberry32): mismo seed -> misma baraja. Util para tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG criptografico cuando existe (partidas reales), con fallback a Math.random. */
export function secureRng() {
  const crypto = globalThis.crypto;
  if (crypto && crypto.getRandomValues) {
    const buf = new Uint32Array(64);
    let i = buf.length;
    return function rng() {
      if (i >= buf.length) {
        crypto.getRandomValues(buf);
        i = 0;
      }
      return buf[i++] / 4294967296;
    };
  }
  return Math.random;
}

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s });
  }
  return deck;
}

/** Fisher-Yates in-place. */
export function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

export function cardCode(c) {
  return c ? RANK_LABEL[c.r] + c.s : '??';
}

/** Acepta 'As', 'Td', '10d', '7c'... */
export function parseCard(code) {
  const s = code.slice(-1);
  const rs = code.slice(0, -1).toUpperCase();
  const named = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  const r = named[rs] != null ? named[rs] : parseInt(rs, 10);
  if (!r || r < 2 || r > 14 || !'shdc'.includes(s)) {
    throw new Error('Carta no valida: ' + code);
  }
  return { r, s };
}

export function isRed(c) {
  return c.s === 'h' || c.s === 'd';
}
