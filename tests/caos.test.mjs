// Prueba de aguante: gente que entra, se va, se ausenta y vuelve a mitad de
// partida mientras los cuatro juegos corren solos. No comprueba reglas
// concretas, sino que nada se rompa, se atasque ni deje el estado imposible.
//
// Es la prueba que más bugs raros ha pillado: los que solo salen cuando
// alguien cierra la tapa del iPad en el peor momento.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../js/table.js';
import { UnoMesa } from '../js/uno-mesa.js';
import { BlackjackMesa } from '../js/blackjack-mesa.js';
import { AltoBajoMesa } from '../js/altobajo-mesa.js';

/**
 * Deja una mesa corriendo unos segundos con gente entrando y saliendo.
 * @param mesa        la mesa ya montada
 * @param jugar       lo que hacen los humanos en cada tic
 * @param invariantes lo que nunca puede pasar
 */
async function caos(mesa, jugar, invariantes, segundos = 4) {
  const problemas = [];
  const humanos = ['a', 'b', 'c'];
  humanos.forEach((id, i) => mesa.join({ id, name: 'J' + i, chips: 1000 }));
  mesa.addBot();
  mesa.addBot();
  mesa.on('update', () => {
    try {
      invariantes(mesa);
    } catch (e) {
      problemas.push('invariante: ' + e.message);
    }
  });
  mesa.start();

  const bucle = setInterval(() => {
    try {
      jugar(mesa);
      const r = Math.random();
      if (r < 0.03) mesa.setAway(humanos[(Math.random() * 3) | 0], true);
      else if (r < 0.06) mesa.setAway(humanos[(Math.random() * 3) | 0], false);
      else if (r < 0.075) {
        const id = humanos[(Math.random() * 3) | 0];
        mesa.leave(id);
        mesa.join({ id, name: 'revive', chips: 1000 });
      }
    } catch (e) {
      problemas.push('excepcion: ' + e.message);
    }
  }, 20);

  await new Promise((r) => setTimeout(r, segundos * 1000));
  clearInterval(bucle);
  mesa.destroy();
  return problemas;
}

test('el poker aguanta gente entrando y saliendo sin perder fichas', async () => {
  const mesa = new Table({ startingChips: 1000, speed: 50, turnSeconds: 999, allowRebuy: false });
  const problemas = await caos(mesa, (m) => {
    const g = m.game;
    if (!g.inHand()) return;
    const p = g.seats[g.toAct];
    if (!p || p.isBot) return;
    const legal = g.legalActions(p.id);
    if (!legal.yourTurn) return;
    m.act(p.id, legal.canCheck ? 'check' : 'fold');
  }, (m) => {
    const g = m.game;
    for (const p of g.seated()) {
      if (p.chips < 0) throw new Error(`${p.name} con fichas negativas`);
      if (p.committed < 0) throw new Error('apuesta negativa');
    }
  });
  assert.deepEqual(problemas, []);
});

test('el uno aguanta el mismo trato', async () => {
  const mesa = new UnoMesa({ speed: 50, turnSeconds: 999 });
  const problemas = await caos(mesa, (m) => {
    const g = m.game;
    if (g.estado !== 'jugando') return;
    if (g.esperaColor) {
      m.act(g.esperaColor, 'color', { color: 'rojo' });
      return;
    }
    const p = g.actual();
    if (!p || p.esBot) return;
    const v = g.snapshot(p.id);
    if (v.jugables.length) m.act(p.id, 'jugar', { carta: v.jugables[0], color: 'rojo' });
    else if (v.puedePasar) m.act(p.id, 'pasar');
    else m.act(p.id, 'robar');
  }, (m) => {
    for (const p of m.game.jugadores) {
      if (p.mano.length > 60) throw new Error(`${p.nombre} con ${p.mano.length} cartas`);
      if (p.puntos < 0) throw new Error('puntos negativos');
    }
  });
  assert.deepEqual(problemas, []);
});

test('el blackjack aguanta el mismo trato', async () => {
  const mesa = new BlackjackMesa({ speed: 50, turnSeconds: 999 });
  const problemas = await caos(mesa, (m) => {
    const g = m.game;
    if (g.estado === 'apuestas') {
      for (const p of g.elegibles()) if (!p.esBot && !p.apuesta && p.fichas > 0) m.act(p.id, 'apostar', { cantidad: 50 });
    } else if (g.estado === 'turnos') {
      const p = g.actual();
      if (!p || p.esBot) return;
      const o = g.opciones(p.id);
      if (!o.tuTurno) return;
      m.act(p.id, o.total < 17 && o.puedePedir ? 'pedir' : 'plantarse');
    }
  }, (m) => {
    for (const p of m.game.jugadores) {
      if (p.fichas < 0) throw new Error(`${p.nombre} con fichas negativas`);
      for (const mano of p.manos) if (mano.cartas.length > 12) throw new Error('mano imposible de larga');
    }
  });
  assert.deepEqual(problemas, []);
});

test('el alto o bajo aguanta el mismo trato', async () => {
  const mesa = new AltoBajoMesa({ speed: 50, segundosPorCarta: 1 });
  const problemas = await caos(mesa, (m) => {
    const g = m.game;
    if (g.estado !== 'apuestas') return;
    for (const p of g.vivos()) if (!p.esBot && !p.apuesta) m.act(p.id, 'apostar', { apuesta: Math.random() < 0.5 ? 'alto' : 'bajo' });
  }, (m) => {
    for (const p of m.game.jugadores) {
      if (p.vidas < 0) throw new Error(`${p.nombre} con vidas negativas`);
      if (p.puntos < 0) throw new Error('puntos negativos');
    }
  });
  assert.deepEqual(problemas, []);
});
