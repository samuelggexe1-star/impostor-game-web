import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, CAT } from '../js/evaluator.js';
import { parseCard } from '../js/cards.js';

const hand = (s) => s.split(' ').map(parseCard);
const ev = (s) => evaluate(hand(s));

test('reconoce cada categoria de jugada', () => {
  assert.equal(ev('As Ks Qs Js Ts 2h 3d').cat, CAT.STRAIGHT_FLUSH);
  assert.equal(ev('5s 4s 3s 2s As 9h Kd').cat, CAT.STRAIGHT_FLUSH, 'la rueda de color cuenta');
  assert.equal(ev('9c 9d 9h 9s 2c 3d 4h').cat, CAT.QUADS);
  assert.equal(ev('9c 9d 9h 2s 2c 3d 4h').cat, CAT.FULL_HOUSE);
  assert.equal(ev('Ah Kh 9h 5h 2h 3d 4c').cat, CAT.FLUSH);
  assert.equal(ev('Ah 2d 3c 4s 5h Kd 9c').cat, CAT.STRAIGHT, 'A-2-3-4-5 es escalera');
  assert.equal(ev('7h 7d 7c 2s 9d 4h Kc').cat, CAT.TRIPS);
  assert.equal(ev('Ah Ad Kc Ks 9d 4h 2c').cat, CAT.TWO_PAIR);
  assert.equal(ev('Ah Ad Kc 9s 7d 4h 2c').cat, CAT.PAIR);
  assert.equal(ev('Ah Qd Kc 9s 7d 4h 2c').cat, CAT.HIGH);
});

test('ordena correctamente jugadas de la misma categoria', () => {
  assert.ok(ev('Ah Ad 2c 3s 4d 7h 9c').score > ev('Kh Kd 2c 3s 4d 7h 9c').score, 'ases > reyes');
  assert.ok(ev('Ah Ad Kc 9s 7d 4h 2c').score > ev('Ah Ad Qc 9s 7d 4h 2c').score, 'decide el kicker');
  assert.ok(ev('6s 7s 8s 9s Ts 2h 3d').score > ev('2s 3s 4s 5s 6s Kh Qd').score, 'escalera de color mas alta');
  assert.ok(ev('As Ks Qs Js 9s 2h 3d').score > ev('Ah Kh Qh Th 9h 2s 3d').score, 'color con mejor cuarta carta');
});

test('dos jugadores con el mismo board empatan exacto', () => {
  const board = '2c 7d 9s Jh 3c';
  const a = evaluate(hand('Ah Kd ' + board));
  const b = evaluate(hand('As Kc ' + board));
  assert.equal(a.score, b.score);
});

test('devuelve las cinco cartas que forman la jugada', () => {
  const r = ev('Ah Ad Ac Ks Kd 7h 2c');
  assert.equal(r.cat, CAT.FULL_HOUSE);
  assert.equal(r.best.length, 5);
  const ranks = r.best.map((c) => c.r).sort((x, y) => y - x);
  assert.deepEqual(ranks, [14, 14, 14, 13, 13]);
});

test('la escalera usa el as como 1 solo en la rueda', () => {
  const wheel = ev('Ah 2d 3c 4s 5h Kd 9c');
  assert.equal(wheel.kickers[0], 5, 'la rueda es escalera al 5');
  const broadway = ev('Ah Kd Qc Js Th 2d 3c');
  assert.equal(broadway.kickers[0], 14, 'la escalera maxima es al as');
  assert.ok(broadway.score > wheel.score);
});

test('elige la mejor combinacion de cinco entre siete cartas', () => {
  // Con trio y color disponibles, debe quedarse con el color.
  const r = ev('Ah Ad Ac 5c 7c Jc 2c');
  assert.equal(r.cat, CAT.FLUSH);
  assert.ok(r.best.every((c) => c.s === 'c'));
});
