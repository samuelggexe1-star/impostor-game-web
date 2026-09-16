// Pruebas del ritmo de la mesa: lo que hace que una partida siga viva.
// Una mesa parada arruina la partida a todos, asi que se prueba a proposito.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../js/table.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mesa(opts = {}) {
  const t = new Table({ startingChips: 500, speed: 40, turnSeconds: 999, ...opts });
  t.join({ id: 'a', name: 'Ana', chips: 500 });
  t.join({ id: 'b', name: 'Luis', chips: 500 });
  return t;
}

/** Una mesa esta atascada si podria jugar y no avanza. */
function atascada(t) {
  const g = t.game;
  if (!g.inHand()) return g.eligibleForHand().length >= 2;
  return g.toAct < 0 && !g.pending;
}

test('volver de ausentarse reanuda la mesa', async () => {
  const t = mesa();
  t.start();
  await wait(500);
  t.setAway('b', true);
  await wait(700);
  t.setAway('b', false);
  await wait(800);
  assert.equal(atascada(t), false, 'al volver se reparte otra mano');
  t.destroy();
});

test('si se ausentan todos y vuelven, la mesa sigue', async () => {
  const t = mesa();
  t.start();
  await wait(500);
  t.setAway('a', true);
  t.setAway('b', true);
  await wait(600);
  t.setAway('a', false);
  t.setAway('b', false);
  await wait(800);
  assert.equal(atascada(t), false);
  t.destroy();
});

test('ausentarse en tu turno no deja a los demas esperando', async () => {
  const t = mesa({ turnSeconds: 999 });
  t.addBot();
  t.start();
  await wait(700);
  const enTurno = t.game.seats[t.game.toAct];
  if (enTurno && !enTurno.isBot) {
    t.setAway(enTurno.id, true);
    await wait(400);
    assert.notEqual(t.game.toAct, enTurno.seat, 'su turno se resuelve solo');
  }
  t.destroy();
});

test('repara una mano que se quedo sin turno', () => {
  const t = mesa();
  t.game.startHand();
  t.game.toAct = -1;
  t.game.pending = null;
  assert.equal(t.repair(), true);
  assert.ok(t.game.toAct >= 0 || t.game.pending, 'vuelve a haber turno o paso pendiente');
  t.destroy();
});

test('repara una mano donde ya solo queda un jugador', () => {
  const t = mesa();
  t.game.startHand();
  const [uno] = t.game.seated();
  for (const p of t.game.seated()) if (p !== uno) p.status = 'folded';
  t.game.toAct = -1;
  t.game.pending = null;
  assert.equal(t.repair(), true);
  assert.equal(t.game.pending.type, 'uncontested', 'se cierra la mano y se reparte el bote');
  t.destroy();
});

test('el vigilante reanima una mesa congelada', async () => {
  const t = mesa();
  t.addBot();
  let rescates = 0;
  t.on('update', (evs) => {
    for (const e of evs || []) if (e.t === 'recover') rescates++;
  });
  t.start();
  await wait(700);
  const manoAntes = t.game.handNumber;

  // Simula un aviso perdido: matamos los temporizadores a mitad de mano.
  t.clearTimers();
  t.game.toAct = -1;
  t.game.pending = null;
  t.lastProgress = Date.now() - 20000;

  await wait(4500);
  assert.ok(rescates > 0, 'el vigilante se da cuenta');
  assert.equal(atascada(t), false, 'y la mesa vuelve a avanzar');
  assert.ok(t.game.handNumber >= manoAntes);
  t.destroy();
});

test('el empujon manual del anfitrion tambien la desatasca', async () => {
  const t = mesa();
  t.start();
  await wait(500);
  t.clearTimers();
  t.game.stage = 'handEnd';
  await wait(200);
  t.resume();
  await wait(700);
  assert.equal(atascada(t), false);
  t.destroy();
});

test('una mesa con un solo jugador espera, no se considera atascada', async () => {
  const t = new Table({ startingChips: 500, speed: 40 });
  t.join({ id: 'a', name: 'Ana', chips: 500 });
  t.start();
  await wait(600);
  assert.equal(t.game.inHand(), false, 'no reparte con uno solo');
  assert.equal(t.game.eligibleForHand().length, 1);
  t.destroy();
});
