// Alto o bajo: acertar suma, fallar cuesta vida, el empate no hace nada,
// y nadie puede ver la apuesta de los demas antes de tiempo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AltoBajoGame } from '../js/altobajo.js';
import { mulberry32, parseCard } from '../js/cards.js';

function partida(ids = ['ana', 'luis'], seed = 3) {
  const g = new AltoBajoGame({ rng: mulberry32(seed) });
  for (const id of ids) g.sentar({ id, name: id });
  g.nuevaRonda();
  return g;
}

/** Fuerza la carta en mesa y la siguiente del mazo. */
function montar(g, actual, siguiente) {
  g.carta = parseCard(actual);
  g.mazo.push(parseCard(siguiente));
}

test('acertar suma puntos y mantiene la racha', () => {
  const g = partida();
  montar(g, '7h', 'Kd');          // sube
  g.apostar('ana', 'alto');
  g.apostar('luis', 'bajo');
  g.revelar();
  assert.equal(g.porId('ana').puntos, 1);
  assert.equal(g.porId('ana').racha, 1);
  assert.equal(g.porId('ana').vidas, 3, 'quien acierta no pierde vidas');
  assert.equal(g.porId('luis').vidas, 2, 'quien falla pierde una');
  assert.equal(g.porId('luis').racha, 0);
});

test('el empate no quita vidas ni da puntos', () => {
  const g = partida();
  montar(g, '9h', '9s');
  g.apostar('ana', 'alto');
  g.apostar('luis', 'bajo');
  g.revelar();
  for (const p of g.jugadores) {
    assert.equal(p.vidas, 3);
    assert.equal(p.puntos, 0);
  }
});

test('las rachas largas pagan mas', () => {
  const g = partida(['ana']);
  const cartas = [['2h', '5d'], ['5d', '9c'], ['9c', 'Kh'], ['Kh', 'Ah']];
  let puntosPrevios = 0;
  const ganancias = [];
  for (const [a, b] of cartas) {
    montar(g, a, b);
    g.apostar('ana', 'alto');
    g.revelar();
    ganancias.push(g.porId('ana').puntos - puntosPrevios);
    puntosPrevios = g.porId('ana').puntos;
  }
  assert.deepEqual(ganancias, [1, 1, 2, 2], 'a partir de la tercera seguida se cobra mas');
  assert.equal(g.porId('ana').mejorRacha, 4);
});

test('te quedas fuera al perder las tres vidas', () => {
  const g = partida(['ana', 'luis']);
  for (let i = 0; i < 3; i++) {
    montar(g, 'Kh', '2d');        // baja
    g.apostar('ana', 'alto');     // falla siempre
    g.apostar('luis', 'bajo');
    g.revelar();
  }
  assert.equal(g.porId('ana').vivo, false);
  assert.equal(g.estado, 'finRonda', 'con un solo superviviente, ronda terminada');
});

test('el ultimo en pie gana la ronda y se lleva premio', () => {
  const g = partida(['ana', 'luis']);
  const antes = g.porId('luis').puntos;
  for (let i = 0; i < 3; i++) {
    montar(g, 'Kh', '2d');
    g.apostar('ana', 'alto');
    g.apostar('luis', 'bajo');
    g.revelar();
  }
  const luis = g.porId('luis');
  assert.equal(luis.rondasGanadas, 1);
  assert.ok(luis.puntos > antes + 3, 'cobra sus aciertos y el premio final');
});

test('quien no apuesta no gana ni pierde', () => {
  const g = partida(['ana', 'luis']);
  montar(g, '7h', 'Kd');
  g.apostar('ana', 'alto');
  g.revelar();
  assert.equal(g.porId('luis').vidas, 3, 'no se le castiga por no contestar');
  assert.equal(g.porId('luis').puntos, 0, 'pero tampoco puntua');
});

test('nadie ve la apuesta de los demas antes de revelar', () => {
  const g = partida(['ana', 'luis']);
  g.apostar('ana', 'alto');
  g.apostar('luis', 'bajo');
  const vista = g.snapshot('ana');
  const luis = vista.jugadores.find((p) => p.id === 'luis');
  assert.equal(luis.apuesta, 'oculta', 'solo se sabe que ya ha apostado');
  const mia = vista.jugadores.find((p) => p.soyYo);
  assert.equal(mia.apuesta, 'alto', 'la propia si se ve');
});

test('sabe cuando han apostado todos', () => {
  const g = partida(['ana', 'luis']);
  assert.equal(g.todosListos(), false);
  g.apostar('ana', 'alto');
  assert.equal(g.todosListos(), false);
  g.apostar('luis', 'alto');
  assert.equal(g.todosListos(), true);
});

test('el mazo se rehace solo y la partida aguanta muchas manos', () => {
  const g = partida(['ana', 'luis'], 11);
  let manos = 0;
  for (let i = 0; i < 300 && manos < 120; i++) {
    if (g.estado === 'finRonda') {
      g.nuevaRonda();
      continue;
    }
    for (const p of g.vivos()) g.apostar(p.id, Math.random() < 0.5 ? 'alto' : 'bajo');
    g.revelar();
    manos++;
    assert.ok(g.carta, 'siempre hay carta en mesa');
    for (const p of g.jugadores) assert.ok(p.vidas >= 0, 'las vidas nunca bajan de cero');
  }
  assert.ok(manos >= 100, `se jugaron ${manos} manos sin atascarse`);
});

test('quien entra a mitad de ronda espera a la siguiente', () => {
  const g = partida(['ana', 'luis']);
  g.sentar({ id: 'tarde', name: 'Tarde' });
  assert.equal(g.porId('tarde').esperando, true);
  assert.ok(!g.vivos().some((p) => p.id === 'tarde'), 'no cuenta para la ronda en curso');
  g.nuevaRonda();
  assert.equal(g.porId('tarde').esperando, false);
  assert.ok(g.vivos().some((p) => p.id === 'tarde'), 'ya juega');
});

test('la ronda no puede eternizarse aunque nadie falle', () => {
  const g = partida(['ana', 'luis']);
  let vueltas = 0;
  while (g.estado === 'apuestas' && vueltas++ < 200) {
    // Todos aciertan siempre: forzamos la carta para que nadie pierda vidas
    const actual = g.carta.r;
    const alto = actual < 8;
    g.mazo.push({ r: alto ? Math.min(14, actual + 1) : Math.max(2, actual - 1), s: 'h' });
    for (const p of g.vivos()) g.apostar(p.id, alto ? 'alto' : 'bajo');
    g.revelar();
  }
  assert.equal(g.estado, 'finRonda', `la ronda termina sola (${g.mano} cartas)`);
  assert.ok(g.mano <= 41, 'por el tope de cartas');
});
