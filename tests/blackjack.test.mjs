// Blackjack: los ases que cambian de valor, el pago 3 a 2, doblar, dividir
// y que la banca pida hasta 17. Y sobre todo, que las fichas cuadren.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BlackjackGame, valorMano, esBlackjack } from '../js/blackjack.js';
import { parseCard, mulberry32 } from '../js/cards.js';

const mano = (s) => s.split(' ').map(parseCard);

function mesa(jugadores = ['ana', 'luis'], opts = {}) {
  const g = new BlackjackGame({ rng: mulberry32(9), fichasIniciales: 1000, ...opts });
  for (const id of jugadores) g.sentar({ id, name: id });
  return g;
}

/** Coloca cartas concretas para probar una situacion. */
function montar(g, { jugador, banca, apuesta = 100 }) {
  g.abrirApuestas();
  for (const p of g.jugadores) g.apostar(p.id, apuesta);
  g.repartir();
  const p = g.jugadores[0];
  if (jugador) p.manos[0].cartas = mano(jugador);
  if (banca) g.banca.cartas = mano(banca);
  return p;
}

test('los ases valen 11 o 1 segun convenga', () => {
  assert.equal(valorMano(mano('As Kd')).total, 21);
  assert.equal(valorMano(mano('As 6d')).total, 17);
  assert.equal(valorMano(mano('As 6d Ts')).total, 17, 'el as baja a 1');
  assert.equal(valorMano(mano('As Ad 9c')).total, 21);
  assert.equal(valorMano(mano('As Ad Ah 8c')).total, 21);
  assert.equal(valorMano(mano('Kh Qd 5s')).total, 25);
  assert.equal(valorMano(mano('As 6d')).blanda, true);
  assert.equal(valorMano(mano('As 6d Ts')).blanda, false);
});

test('reconoce el blackjack de salida', () => {
  assert.equal(esBlackjack({ cartas: mano('As Kd') }), true);
  assert.equal(esBlackjack({ cartas: mano('As 5d 5c') }), false, '21 con tres cartas no es blackjack');
  assert.equal(esBlackjack({ cartas: mano('As Kd'), dividida: true }), false, 'con cartas divididas tampoco');
});

test('reparte dos cartas a cada uno y dos a la banca, una tapada', () => {
  const g = mesa(['ana', 'luis']);
  g.abrirApuestas();
  g.apostar('ana', 100);
  g.apostar('luis', 50);
  g.repartir();
  assert.equal(g.porId('ana').manos[0].cartas.length, 2);
  assert.equal(g.porId('luis').manos[0].cartas.length, 2);
  assert.equal(g.banca.cartas.length, 2);
  const vista = g.snapshot('ana');
  assert.equal(vista.banca.cartas[1], null, 'la segunda de la banca va tapada');
  assert.equal(vista.banca.total, null, 'y no se chiva del total');
  assert.equal(g.porId('ana').fichas, 900, 'la apuesta sale de las fichas');
});

test('el blackjack paga 3 a 2', () => {
  const g = mesa(['ana']);
  const p = montar(g, { jugador: 'As Kd', banca: '9h 7c', apuesta: 100 });
  p.manos[0].estado = 'blackjack';
  g.estado = 'banca';
  g.jugarBanca();
  g.pagar();
  assert.equal(p.fichas, 900 + 250, 'recupera 100 y cobra 150');
});

test('si la banca tambien tiene blackjack, empate', () => {
  const g = mesa(['ana']);
  const p = montar(g, { jugador: 'As Kd', banca: 'Ah Qs', apuesta: 100 });
  p.manos[0].estado = 'blackjack';
  g.estado = 'banca';
  g.jugarBanca();
  g.pagar();
  assert.equal(p.fichas, 1000, 'le devuelven su apuesta');
});

test('pasarse de 21 pierde aunque la banca tambien se pase', () => {
  const g = mesa(['ana']);
  const p = montar(g, { jugador: 'Kh Qd 5s', banca: 'Ts 9h 8c', apuesta: 100 });
  p.manos[0].estado = 'pasado';
  g.estado = 'banca';
  g.jugarBanca();
  g.pagar();
  assert.equal(p.fichas, 900, 'la casa cobra primero');
});

test('la banca pide hasta 17 y se planta ahi, ni antes ni despues', () => {
  const g = mesa(['ana']);
  const p = montar(g, { jugador: 'Kh Qd', banca: '5h 6c', apuesta: 100 });
  p.manos[0].estado = 'plantado';
  g.estado = 'banca';
  g.jugarBanca();

  const total = valorMano(g.banca.cartas).total;
  assert.ok(total >= 17, `la banca se planta en ${total}, deberia seguir pidiendo`);

  // Y tampoco puede pedir de mas: rehacemos la mano carta a carta y miramos
  // que en ningun momento pidiera teniendo ya 17 o mas.
  for (let n = 2; n < g.banca.cartas.length; n++) {
    const antes = valorMano(g.banca.cartas.slice(0, n)).total;
    assert.ok(antes < 17, `la banca pidio teniendo ${antes}, deberia haberse plantado`);
  }
});

test('con 17 de salida la banca no pide nada', () => {
  const g = mesa(['ana']);
  const p = montar(g, { jugador: 'Kh Qd', banca: 'Kh 7c', apuesta: 100 });
  p.manos[0].estado = 'plantado';
  g.estado = 'banca';
  g.jugarBanca();
  assert.equal(g.banca.cartas.length, 2, 'no deberia haber pedido ninguna carta');
});

test('la banca no juega si todos se han pasado', () => {
  const g = mesa(['ana']);
  const p = montar(g, { jugador: 'Kh Qd 5s', banca: '5h 6c', apuesta: 100 });
  p.manos[0].estado = 'pasado';
  g.estado = 'banca';
  g.jugarBanca();
  assert.equal(g.banca.cartas.length, 2, 'no gasta cartas de mas');
});

test('doblar pone otra apuesta, da una carta y planta', () => {
  const g = mesa(['ana']);
  g.abrirApuestas();
  g.apostar('ana', 100);
  g.repartir();
  const p = g.porId('ana');
  p.manos[0].cartas = mano('5h 6c');    // 11: el clasico para doblar
  p.manos[0].estado = 'jugando';
  g.turno = 0; g.manoActiva = 0; g.estado = 'turnos';
  assert.equal(g.opciones('ana').puedeDoblar, true);
  const fichasAntes = p.fichas;
  g.doblar('ana');
  assert.equal(p.fichas, fichasAntes - 100, 'pone la segunda apuesta');
  assert.equal(p.manos[0].apuesta, 200);
  assert.equal(p.manos[0].cartas.length, 3, 'recibe una sola carta');
  assert.notEqual(p.manos[0].estado, 'jugando', 'y se queda plantada');
});

test('dividir una pareja crea dos manos con su apuesta cada una', () => {
  const g = mesa(['ana']);
  g.abrirApuestas();
  g.apostar('ana', 100);
  g.repartir();
  const p = g.porId('ana');
  p.manos[0].cartas = mano('8h 8c');
  p.manos[0].estado = 'jugando';
  g.turno = 0; g.manoActiva = 0; g.estado = 'turnos';
  assert.equal(g.opciones('ana').puedeDividir, true);
  const antes = p.fichas;
  g.dividir('ana');
  assert.equal(p.manos.length, 2);
  assert.equal(p.fichas, antes - 100, 'la segunda mano cuesta otra apuesta');
  for (const m of p.manos) assert.equal(m.cartas.length, 2, 'cada mano recibe su segunda carta');
});

test('los ases divididos reciben una sola carta', () => {
  const g = mesa(['ana']);
  g.abrirApuestas();
  g.apostar('ana', 100);
  g.repartir();
  const p = g.porId('ana');
  p.manos[0].cartas = mano('As Ad');
  p.manos[0].estado = 'jugando';
  g.turno = 0; g.manoActiva = 0; g.estado = 'turnos';
  g.dividir('ana');
  for (const m of p.manos) {
    assert.equal(m.cartas.length, 2);
    assert.notEqual(m.estado, 'jugando', 'no se puede seguir pidiendo');
  }
});

test('no se puede jugar fuera de turno', () => {
  const g = mesa(['ana', 'luis']);
  g.abrirApuestas();
  g.apostar('ana', 100);
  g.apostar('luis', 100);
  g.repartir();
  const otro = g.jugadores.find((p) => p !== g.actual());
  assert.equal(g.pedir(otro.id).ok, false);
  assert.equal(g.plantarse(otro.id).ok, false);
});

test('las fichas cuadran ronda tras ronda', () => {
  const g = mesa(['ana', 'luis', 'eva']);
  const inicial = g.jugadores.reduce((a, p) => a + p.fichas, 0);
  let banca = 0;   // lo que gana o pierde la casa

  for (let ronda = 0; ronda < 40; ronda++) {
    g.abrirApuestas();
    let apostado = 0;
    for (const p of g.elegibles()) {
      const r = g.apostar(p.id, 50);
      if (r.ok) apostado += r.cantidad;
    }
    if (!g.apuestasListas()) break;
    g.repartir();
    let guarda = 0;
    while (g.estado === 'turnos' && guarda++ < 60) {
      const p = g.actual();
      const o = g.opciones(p.id);
      if (!o.tuTurno) break;
      if (o.total < 17 && o.puedePedir) g.pedir(p.id);
      else g.plantarse(p.id);
    }
    // Las manos dobladas ponen fichas extra: se cuentan aparte
    const extra = g.jugadores.reduce((a, p) =>
      a + p.manos.reduce((b, m) => b + (m.doblada ? m.apuesta / 2 : 0), 0), 0);
    g.jugarBanca();
    const res = g.pagar();
    const pagado = res.detalle.reduce((a, d) => a + d.premio, 0);
    banca += apostado + extra - pagado;
  }

  const final = g.jugadores.reduce((a, p) => a + p.fichas, 0);
  assert.equal(final + banca, inicial, 'lo que pierden los jugadores lo gana la banca, ni una ficha de mas');
  for (const p of g.jugadores) assert.ok(p.fichas >= 0, `${p.nombre} no puede tener fichas negativas`);
});

test('cada jugador ve sus cartas y las de los demas, pero no la tapada de la banca', () => {
  const g = mesa(['ana', 'luis']);
  g.abrirApuestas();
  g.apostar('ana', 100);
  g.apostar('luis', 100);
  g.repartir();
  const v = g.snapshot('ana');
  // En blackjack las manos son publicas: cada uno juega contra la casa.
  for (const p of v.jugadores) assert.ok(p.manos[0].cartas.length === 2);
  assert.equal(v.banca.cartas[1], null);
});

test('el zapato se rebaraja cuando se queda corto', () => {
  const g = mesa(['ana'], { mazos: 1 });
  g.rellenarZapato();
  g.zapato = g.zapato.slice(0, 10);
  const antes = g.zapato.length;
  g.sacar();
  assert.ok(g.zapato.length > antes, 'se rehace el zapato');
});

test('el blackjack sale con la frecuencia que dicen las matematicas', () => {
  // Con una baraja bien barajada sale blackjack en un 4,75% de las manos.
  // Si esto se dispara o se hunde, algo va mal en el reparto o en el zapato.
  const g = new BlackjackGame({ rng: mulberry32(98765) });
  for (const n of ['Ana', 'Bea', 'Cris']) g.sentar({ id: n, name: n });

  let manos = 0;
  let bj = 0;
  for (let r = 0; r < 1200; r++) {
    for (const p of g.jugadores) p.fichas = 1000000;
    g.abrirApuestas();
    for (const p of g.jugadores) g.apostar(p.id, 10);
    if (g.estado === 'apuestas') g.repartir();
    if (!g.jugadores[0].manos.length) break;
    for (const p of g.jugadores) {
      for (const m of p.manos) {
        manos++;
        if (esBlackjack(m)) bj++;
      }
    }
    let vueltas = 0;
    while (g.estado === 'turnos' && vueltas++ < 80) {
      const p = g.actual();
      if (!p) break;
      g.plantarse(p.id);
    }
    if (g.estado === 'banca') g.jugarBanca();
    if (g.estado === 'pagos') g.pagar();
  }

  assert.ok(manos > 3000, `deberian jugarse muchas manos, se jugaron ${manos}`);
  const tasa = bj / manos;
  assert.ok(tasa > 0.03 && tasa < 0.07, `blackjack en el ${(tasa * 100).toFixed(2)}% de las manos, fuera de lo razonable`);
});

test('la banca gana a la larga lo que dicen las matematicas, ni mas ni menos', () => {
  // Jugando con estrategia basica pero sin doblar ni dividir, la ventaja de
  // la casa ronda el 2%. Si los pagos se rompen se nota enseguida: pagar el
  // blackjack 1 a 1 la dispara, y no cobrar los empates la hunde.
  const estrategia = (mano, arriba) => {
    const v = valorMano(mano.cartas);
    const up = arriba ? (arriba.r >= 10 ? 10 : arriba.r === 14 ? 11 : arriba.r) : 10;
    if (v.blanda) {
      if (v.total >= 19) return 'plantarse';
      if (v.total === 18) return up >= 9 ? 'pedir' : 'plantarse';
      return 'pedir';
    }
    if (v.total >= 17) return 'plantarse';
    if (v.total >= 13) return up >= 7 ? 'pedir' : 'plantarse';
    if (v.total === 12) return (up >= 4 && up <= 6) ? 'plantarse' : 'pedir';
    return 'pedir';
  };

  const g = new BlackjackGame({ rng: mulberry32(4242) });
  g.sentar({ id: 'a', name: 'Ana' });
  const APUESTA = 10;
  const INICIO = 10000000;
  g.porId('a').fichas = INICIO;

  let apostado = 0;
  let rondas = 0;
  for (let r = 0; r < 8000; r++) {
    g.abrirApuestas();
    if (g.porId('a').fichas < APUESTA) break;
    g.apostar('a', APUESTA);
    if (g.estado === 'apuestas') g.repartir();
    if (!g.porId('a').manos.length) break;
    apostado += APUESTA;
    rondas++;
    let vueltas = 0;
    while (g.estado === 'turnos' && vueltas++ < 30) {
      const p = g.actual();
      if (!p) break;
      const mano = p.manos[g.manoActiva];
      if (!mano) { g.plantarse(p.id); continue; }
      const q = estrategia(mano, g.banca.cartas[0]);
      const res = q === 'pedir' ? g.pedir(p.id) : g.plantarse(p.id);
      if (!res || !res.ok) g.plantarse(p.id);
    }
    if (g.estado === 'banca') g.jugarBanca();
    if (g.estado === 'pagos') g.pagar();
  }

  assert.ok(rondas > 5000, `deberian jugarse muchas rondas, se jugaron ${rondas}`);
  const ventaja = -(g.porId('a').fichas - INICIO) / apostado;
  assert.ok(
    ventaja > 0 && ventaja < 0.05,
    `la banca se lleva el ${(ventaja * 100).toFixed(2)}% de lo apostado, fuera de lo razonable`
  );
});
