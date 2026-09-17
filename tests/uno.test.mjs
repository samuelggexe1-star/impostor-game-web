// Reglas del UNO. Las trampas estan en el sentido, el salta con dos jugadores,
// los comodines y en que nunca se pierdan cartas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { UnoGame, crearBaraja, puntos, esComodin } from '../js/uno.js';
import { mulberry32 } from '../js/cards.js';

function partida(nombres = ['ana', 'luis', 'eva'], seed = 5) {
  const g = new UnoGame({ rng: mulberry32(seed) });
  for (const n of nombres) g.sentar({ id: n, name: n });
  g.empezarRonda();
  return g;
}

/** Coloca una mano y una carta de mesa concretas, para probar una regla. */
function montar(g, { turno, mano, arriba, color }) {
  g.turno = g.jugadores.findIndex((p) => p.id === turno);
  if (mano) g.porId(turno).mano = mano.map((c, i) => ({ id: 'x' + i, ...c }));
  if (arriba) g.descarte = [{ id: 'top', ...arriba }];
  g.colorActual = color !== undefined ? color : (arriba ? arriba.color : g.colorActual);
}

test('la baraja tiene las 108 cartas repartidas como toca', () => {
  const b = crearBaraja();
  assert.equal(b.length, 108);
  assert.equal(b.filter((c) => c.valor === 'comodin').length, 4);
  assert.equal(b.filter((c) => c.valor === 'mas4').length, 4);
  assert.equal(b.filter((c) => c.color === 'rojo').length, 25);
  assert.equal(b.filter((c) => c.color === 'rojo' && c.valor === '0').length, 1, 'solo un cero por color');
  assert.equal(b.filter((c) => c.color === 'rojo' && c.valor === '7').length, 2, 'dos de cada numero');
  assert.equal(b.filter((c) => c.color === 'azul' && c.valor === 'mas2').length, 2);
});

test('reparte siete cartas a cada uno y saca una de salida', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = partida(['ana', 'luis', 'eva'], seed);
    const salida = g.arriba();
    assert.ok(salida, 'hay carta en la mesa');
    assert.notEqual(salida.valor, 'mas4', 'la salida nunca es un +4');

    // Reparte siete, salvo que la carta de salida sea un +2: entonces el
    // primero ya ha robado sus dos y se queda con nueve.
    const manos = g.jugadores.map((p) => p.mano.length).sort();
    const esperado = salida.valor === 'mas2' ? [7, 7, 9] : [7, 7, 7];
    assert.deepEqual(manos, esperado, `seed ${seed}, salida ${salida.valor}`);

    const total = g.mazo.length + g.descarte.length +
      g.jugadores.reduce((a, p) => a + p.mano.length, 0);
    assert.equal(total, 108, 'no se pierde ninguna carta');
  }
});

test('solo deja echar cartas que encajan en color o numero', () => {
  const g = partida();
  montar(g, { turno: 'ana', arriba: { color: 'rojo', valor: '5' } });
  assert.equal(g.sePuedeJugar({ color: 'rojo', valor: '9' }), true, 'mismo color');
  assert.equal(g.sePuedeJugar({ color: 'azul', valor: '5' }), true, 'mismo numero');
  assert.equal(g.sePuedeJugar({ color: 'azul', valor: '9' }), false, 'ni color ni numero');
  assert.equal(g.sePuedeJugar({ color: null, valor: 'comodin' }), true, 'el comodin siempre vale');
  assert.equal(g.sePuedeJugar({ color: null, valor: 'mas4' }), true);
});

test('el +2 hace robar dos al siguiente y le salta el turno', () => {
  const g = partida(['ana', 'luis', 'eva']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: 'mas2' }], arriba: { color: 'rojo', valor: '3' } });
  g.porId('ana').mano.push({ id: 'extra', color: 'azul', valor: '2' });  // que no gane la ronda
  const antes = g.porId('luis').mano.length;
  g.jugar('ana', 'x0');
  assert.equal(g.porId('luis').mano.length, antes + 2, 'luis roba dos');
  assert.equal(g.actual().id, 'eva', 'y se salta su turno');
});

test('el salta se lleva por delante al siguiente', () => {
  const g = partida(['ana', 'luis', 'eva']);
  montar(g, { turno: 'ana', mano: [{ color: 'verde', valor: 'salta' }, { color: 'verde', valor: '1' }], arriba: { color: 'verde', valor: '7' } });
  g.jugar('ana', 'x0');
  assert.equal(g.actual().id, 'eva');
});

test('el cambio de sentido da la vuelta a la mesa', () => {
  const g = partida(['ana', 'luis', 'eva', 'ivan']);
  montar(g, { turno: 'luis', mano: [{ color: 'azul', valor: 'sentido' }, { color: 'azul', valor: '4' }], arriba: { color: 'azul', valor: '8' } });
  assert.equal(g.sentido, 1);
  g.jugar('luis', 'x0');
  assert.equal(g.sentido, -1, 'cambia el sentido');
  assert.equal(g.actual().id, 'ana', 'ahora va hacia atras');
});

test('con dos jugadores, el cambio de sentido funciona como un salta', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: 'sentido' }, { color: 'rojo', valor: '2' }], arriba: { color: 'rojo', valor: '6' } });
  g.jugar('ana', 'x0');
  assert.equal(g.actual().id, 'ana', 'vuelve a jugar ana');
});

test('el comodin obliga a elegir color y ese color manda', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: null, valor: 'comodin' }, { color: 'rojo', valor: '2' }], arriba: { color: 'verde', valor: '6' } });
  const r = g.jugar('ana', 'x0');            // sin decir color
  assert.equal(r.esperaColor, true, 'la partida espera a que elija');
  assert.equal(g.jugar('luis', 'loquesea').ok, false, 'nadie juega mientras tanto');
  g.elegirColor('ana', 'amarillo');
  assert.equal(g.colorActual, 'amarillo');
  assert.equal(g.sePuedeJugar({ color: 'amarillo', valor: '3' }), true);
  assert.equal(g.sePuedeJugar({ color: 'verde', valor: '3' }), false);
});

test('el +4 reparte cuatro cartas y salta al siguiente', () => {
  const g = partida(['ana', 'luis', 'eva']);
  montar(g, { turno: 'ana', mano: [{ color: null, valor: 'mas4' }, { color: 'rojo', valor: '2' }], arriba: { color: 'verde', valor: '6' } });
  const antes = g.porId('luis').mano.length;
  g.jugar('ana', 'x0', 'rojo');
  assert.equal(g.porId('luis').mano.length, antes + 4);
  assert.equal(g.actual().id, 'eva');
  assert.equal(g.colorActual, 'rojo');
});

test('si robas y la carta encaja, puedes jugarla o pasar', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: '9' }], arriba: { color: 'azul', valor: '3' } });
  g.mazo.push({ id: 'robada', color: 'azul', valor: '7' });   // encaja
  const r = g.robar('ana');
  assert.equal(r.puedeJugarla, true);
  assert.equal(g.actual().id, 'ana', 'el turno no se va todavia');
  assert.deepEqual(g.snapshot('ana').jugables, ['robada'], 'solo puede jugar la que acaba de robar');
  g.pasar('ana');
  assert.equal(g.actual().id, 'luis');
});

test('si robas y no encaja, el turno pasa solo', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: '9' }], arriba: { color: 'azul', valor: '3' } });
  g.mazo.push({ id: 'robada', color: 'verde', valor: '7' });
  const r = g.robar('ana');
  assert.equal(r.puedeJugarla, false);
  assert.equal(g.actual().id, 'luis');
});

test('al quedarte con una carta te pueden pillar si no dices UNO', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: '5' }, { color: 'rojo', valor: '6' }], arriba: { color: 'rojo', valor: '3' } });
  g.jugar('ana', 'x0');
  assert.ok(g.ventanaUno, 'queda expuesta');
  const antes = g.porId('ana').mano.length;
  assert.equal(g.pillar('ana', 'ana').ok, false, 'no puede pillarse a si misma');
  assert.equal(g.pillar('luis', 'ana').ok, true);
  assert.equal(g.porId('ana').mano.length, antes + 2, 'roba dos de castigo');
  assert.equal(g.pillar('luis', 'ana').ok, false, 'y solo una vez');
});

test('si dices UNO a tiempo no te pillan', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: '5' }, { color: 'rojo', valor: '6' }], arriba: { color: 'rojo', valor: '3' } });
  g.decirUno('ana');
  g.jugar('ana', 'x0');
  assert.equal(g.pillar('luis', 'ana').ok, false);
  assert.equal(g.porId('ana').mano.length, 1);
});

test('gana quien se queda sin cartas y suma los puntos de los demas', () => {
  const g = partida(['ana', 'luis']);
  montar(g, { turno: 'ana', mano: [{ color: 'rojo', valor: '5' }], arriba: { color: 'rojo', valor: '3' } });
  g.porId('luis').mano = [{ id: 'l1', color: 'azul', valor: '9' }, { id: 'l2', color: null, valor: 'mas4' }];
  g.jugar('ana', 'x0');
  assert.equal(g.estado, 'finRonda');
  assert.equal(g.ganador, 'ana');
  assert.equal(g.porId('ana').puntos, 9 + 50, 'nueve del 9 y cincuenta del +4');
});

test('cuando se acaba el mazo se rebaraja el descarte', () => {
  const g = partida(['ana', 'luis']);
  const arriba = g.arriba();
  g.descarte = [arriba, { id: 'd1', color: 'rojo', valor: '1' }, { id: 'd2', color: 'verde', valor: 'comodin' }];
  g.mazo = [];
  g.robarCartas(g.porId('ana'), 1);
  assert.ok(g.descarte.length >= 1, 'la carta de arriba se queda');
  const comodin = [...g.mazo, ...g.porId('ana').mano].find((c) => c.id === 'd2');
  if (comodin) assert.equal(comodin.color, null, 'los comodines vuelven sin color');
});

test('nunca se pierden ni se duplican cartas durante una partida entera', () => {
  const g = partida(['ana', 'luis', 'eva'], 21);
  let vueltas = 0;
  while (g.estado === 'jugando' && vueltas++ < 600) {
    const p = g.actual();
    if (g.esperaColor) {
      g.elegirColor(g.esperaColor, 'rojo');
      continue;
    }
    const jugables = g.manoJugable(p);
    if (jugables.length) g.jugar(p.id, jugables[0].id, 'rojo');
    else {
      const r = g.robar(p.id);
      if (r.puedeJugarla) g.pasar(p.id);
    }
    const total = g.mazo.length + g.descarte.length + g.jugadores.reduce((a, x) => a + x.mano.length, 0);
    assert.equal(total, 108, `en la vuelta ${vueltas} hay ${total} cartas`);
  }
  assert.equal(g.estado, 'finRonda', 'la ronda termina');
  assert.ok(g.ganador, 'y hay ganador');
});

test('nadie juega fuera de su turno', () => {
  const g = partida(['ana', 'luis', 'eva']);
  const otro = g.jugadores.find((p) => p !== g.actual());
  const r = g.jugar(otro.id, otro.mano[0].id);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-es-tu-turno');
});

test('cada jugador solo ve su propia mano', () => {
  const g = partida(['ana', 'luis', 'eva']);
  const vista = g.snapshot('ana');
  for (const p of vista.jugadores) {
    if (p.id === 'ana') assert.equal(p.mano.length, 7);
    else assert.equal(p.mano, null, `no deberia ver la mano de ${p.id}`);
  }
  assert.equal(vista.tuMano.length, 7);
});

test('quien llega con la ronda empezada espera a la siguiente', () => {
  const g = partida(['ana', 'luis']);
  g.sentar({ id: 'tarde', name: 'Tarde' });
  const nuevo = g.porId('tarde');
  assert.equal(nuevo.esperando, true);
  assert.equal(nuevo.mano.length, 0, 'no recibe cartas a medias');

  // No le toca el turno ni le caen los +2
  const orden = [];
  for (let i = 0; i < 6; i++) {
    orden.push(g.actual().id);
    g.turno = g.indiceSiguiente();
  }
  assert.ok(!orden.includes('tarde'), 'no entra en la rotacion: ' + orden.join(','));

  g.empezarRonda();
  assert.equal(g.porId('tarde').esperando, false, 'en la ronda siguiente ya juega');
  assert.equal(g.porId('tarde').mano.length, 7, 'y recibe sus siete cartas');
});
