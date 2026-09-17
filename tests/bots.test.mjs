// Los bots tienen que leer al rival. Si se retiran siempre ante una subida
// grande, cualquiera gana sin cartas: era la queja real de la partida.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/engine.js';
import { decide } from '../js/bots.js';
import { mulberry32, parseCard } from '../js/cards.js';

/**
 * Monta una situacion: te toca, con una mano mediocre, y el rival acaba de
 * subir fuerte. El rival puede ser un maton (sube en todas) o alguien serio.
 */
function situacion({ agresivo, mano = 'Qd 9s', board = '7h 2c Kd' }) {
  const g = new Game({ sb: 10, bb: 20, rng: mulberry32(11) });
  for (let i = 0; i < 3; i++) {
    g.sit({ id: 'p' + i, name: 'P' + i, chips: 2000, isBot: i > 0, botStyle: 'solido' }, i);
  }
  g.startHand();
  g.seats[0].hole = mano.split(' ').map(parseCard);
  g.board = board.split(' ').map(parseCard);

  const rival = g.seats[1];
  rival.stats = agresivo
    ? { hands: 20, won: 5, vpip: 18, raises: 34, calls: 6, folds: 2, biggestPot: 0, showdowns: 3, bestHand: null }
    : { hands: 20, won: 4, vpip: 5, raises: 3, calls: 4, folds: 15, biggestPot: 0, showdowns: 2, bestHand: null };
  rival.lastAction = { type: 'raise', amount: 300, to: 300 };
  rival.bet = 300;
  rival.committed = 300;
  g.currentBet = 300;
  g.minRaise = 280;
  g.toAct = 0;
  g.seats[0].hasActed = false;

  return { view: g.snapshot('p0'), legal: g.legalActions('p0') };
}

/** Reparto de decisiones en N intentos (los bots llevan aleatoriedad a proposito). */
function reparto(sit, veces = 400) {
  const cuenta = { fold: 0, call: 0, raise: 0, check: 0 };
  for (let i = 0; i < veces; i++) {
    const d = decide(sit.view, sit.legal, 'solido');
    cuenta[d.action === 'bet' ? 'raise' : d.action]++;
  }
  return {
    fold: cuenta.fold / veces,
    call: cuenta.call / veces,
    raise: cuenta.raise / veces
  };
}

test('ante alguien que sube en todas las manos, no se retiran siempre', () => {
  const r = reparto(situacion({ agresivo: true }));
  assert.ok(r.fold < 0.6, `se retiran el ${(r.fold * 100).toFixed(0)}% de las veces, demasiado`);
  assert.ok(r.call + r.raise > 0.4, 'le plantan cara la mayoria de las veces');
});

test('leen la diferencia entre un maton y alguien serio', () => {
  const contraMaton = reparto(situacion({ agresivo: true }));
  const contraSerio = reparto(situacion({ agresivo: false }));
  assert.ok(
    contraSerio.fold > contraMaton.fold + 0.08,
    `deberian respetar mas al serio: maton ${(contraMaton.fold * 100).toFixed(0)}% vs serio ${(contraSerio.fold * 100).toFixed(0)}%`
  );
});

test('con una manaza suben en vez de limitarse a pagar', () => {
  const sit = situacion({ agresivo: false, mano: 'Kh Ks', board: 'Kd 7h 2c' });  // trio de reyes
  const r = reparto(sit);
  assert.ok(r.raise > 0.3, `solo suben el ${(r.raise * 100).toFixed(0)}% con un trio`);
  assert.ok(r.fold < 0.05, 'y desde luego no se retiran');
});

test('con basura y un precio caro, se retiran', () => {
  const sit = situacion({ agresivo: false, mano: '7c 2d', board: 'Ah Kd Qs' });
  const r = reparto(sit);
  assert.ok(r.fold > 0.5, `deberian soltar la mano mas a menudo (${(r.fold * 100).toFixed(0)}%)`);
});

test('a precio de risa pagan casi siempre', () => {
  const g = new Game({ sb: 10, bb: 20, rng: mulberry32(4) });
  for (let i = 0; i < 3; i++) g.sit({ id: 'p' + i, name: 'P' + i, chips: 5000, isBot: true }, i);
  g.startHand();
  g.seats[0].hole = ['9c', '4d'].map(parseCard);
  g.board = ['Ah', 'Kd', 'Qs'].map(parseCard);
  // Bote enorme y solo hay que poner una miseria
  for (const p of g.seated()) p.committed = 1200;
  g.seats[1].bet = 40;
  g.currentBet = 40;
  g.toAct = 0;
  g.seats[0].bet = 0;
  const sit = { view: g.snapshot('p0'), legal: g.legalActions('p0') };
  const r = reparto(sit, 200);
  assert.ok(r.fold < 0.25, `con esas probabilidades no se tira una mano (${(r.fold * 100).toFixed(0)}%)`);
});
