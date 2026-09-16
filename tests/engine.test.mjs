import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, STAGE } from '../js/engine.js';
import { mulberry32, parseCard } from '../js/cards.js';

function makeGame(chips = [1000, 1000, 1000], opts = {}) {
  const g = new Game({ maxSeats: 9, sb: 10, bb: 20, rng: mulberry32(opts.seed || 7), ...opts });
  chips.forEach((c, i) => g.sit({ id: 'p' + i, name: 'P' + i, chips: c }, i));
  return g;
}

/** Fuerza cartas concretas: mano por asiento y board. */
function stack(g, holes, board) {
  g.startHand();
  Object.entries(holes).forEach(([seat, cs]) => {
    g.seats[seat].hole = cs.split(' ').map(parseCard);
  });
  if (board) {
    const cards = board.split(' ').map(parseCard);
    // Coloca las cartas del board al final del mazo (se hace pop).
    g.deck.splice(g.deck.length, 0, ...[...cards].reverse());
    // Intercala una carta quemada antes de cada calle.
    g._forcedBoard = cards;
  }
}

/** Reparte el board forzado saltando quemadas: mas simple que parchear el mazo. */
function runToShowdown(g) {
  let guard = 0;
  while (g.pending && guard++ < 20) g.advance();
  return g;
}

test('las ciegas se colocan y el turno preflop es correcto en mesa de 3', () => {
  const g = makeGame();
  g.button = 0;
  g.startHand();
  assert.equal(g.button, 1, 'el boton avanza al siguiente asiento');
  assert.equal(g.sbSeat, 2);
  assert.equal(g.bbSeat, 0);
  assert.equal(g.seats[2].bet, 10);
  assert.equal(g.seats[0].bet, 20);
  assert.equal(g.toAct, 1, 'habla el boton (UTG en mesa de 3)');
  assert.equal(g.currentBet, 20);
});

test('heads-up: el boton es ciega pequena y habla primero preflop', () => {
  const g = makeGame([1000, 1000]);
  g.button = 1;
  g.startHand();
  assert.equal(g.button, 0);
  assert.equal(g.sbSeat, 0, 'el boton pone la ciega pequena');
  assert.equal(g.bbSeat, 1);
  assert.equal(g.toAct, 0, 'preflop habla el boton');
  g.act('p0', 'call');
  g.act('p1', 'check');
  g.advance(); // flop
  assert.equal(g.stage, STAGE.FLOP);
  assert.equal(g.toAct, 1, 'postflop habla primero la ciega grande');
});

test('cada jugador recibe dos cartas y no se repiten', () => {
  const g = makeGame();
  g.startHand();
  const all = g.seated().flatMap((p) => p.hole);
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map((c) => c.r + c.s)).size, 6);
});

test('la ciega grande tiene opcion de subir cuando todos igualan', () => {
  const g = makeGame();
  g.button = 0;
  g.startHand(); // sb=2, bb=0, toAct=1
  g.act('p1', 'call');
  g.act('p2', 'call');
  assert.equal(g.toAct, 0, 'la ciega grande conserva su opcion');
  assert.equal(g.stage, STAGE.PREFLOP);
  g.act('p0', 'check');
  assert.equal(g.pending.type, 'street', 'al pasar la BG se cierra el preflop');
});

test('la subida minima es el tamano de la ultima subida', () => {
  const g = makeGame([1000, 1000, 1000]);
  g.button = 0;
  g.startHand();
  let legal = g.legalActions('p1');
  assert.equal(legal.minRaiseTo, 40, 'minimo subir a 2x la ciega grande');
  g.act('p1', 'raise', 60); // sube 40 sobre 20
  legal = g.legalActions('p2');
  assert.equal(legal.minRaiseTo, 100, 'la siguiente subida minima es 60 + 40');
  assert.equal(legal.toCall, 50);
});

test('un all-in corto no reabre la subida pero permite igualar', () => {
  const g = makeGame([1000, 1000, 55]);
  g.button = 0;
  g.startHand(); // sb=2 (55 fichas), bb=0, toAct=1
  g.act('p1', 'raise', 100);
  g.act('p2', 'allin');           // solo llega a 55: subida incompleta
  assert.equal(g.currentBet, 55 >= 100 ? 55 : 100, 'la apuesta vigente sigue siendo 100');
  const legal = g.legalActions('p0');
  assert.equal(legal.yourTurn, true);
  assert.equal(legal.canRaise, true, 'p0 aun no habia actuado, puede resubir');
  g.act('p0', 'call');
  const l1 = g.legalActions('p1');
  assert.equal(l1.yourTurn, false, 'p1 ya habia igualado la subida vigente');
});

test('el jugador que ya actuo solo puede pagar o pasar ante un all-in corto', () => {
  // p3 tiene 90: subir a 90 sobre una apuesta de 60 es una subida incompleta (30 < 40).
  const g = makeGame([1000, 1000, 1000, 90]);
  g.button = 0;
  g.startHand(); // button=1, sb=2, bb=3, toAct=0
  g.act('p0', 'raise', 60);
  g.act('p1', 'call');
  g.act('p2', 'call');
  assert.equal(g.toAct, 3);
  g.act('p3', 'allin');
  assert.equal(g.currentBet, 90, 'la apuesta vigente sube al all-in corto');
  const legal = g.legalActions('p0');
  assert.equal(legal.yourTurn, true, 'le toca pagar la diferencia');
  assert.equal(legal.toCall, 30);
  assert.equal(legal.canRaise, false, 'no puede resubir ante una subida incompleta');
  assert.equal(g.act('p0', 'raise', 200).ok, false, 'y el motor rechaza la resubida');
});

test('gana el bote sin oposicion cuando todos se retiran', () => {
  const g = makeGame();
  g.button = 0;
  g.startHand(); // sb=2 (10), bb=0 (20), toAct=1
  g.act('p1', 'fold');
  g.act('p2', 'fold');
  assert.equal(g.pending.type, 'uncontested');
  g.advance();
  g.advance();
  assert.equal(g.stage, STAGE.HAND_END);
  assert.equal(g.seats[0].chips, 1010, 'la ciega grande se lleva las ciegas');
  assert.equal(g.seats[2].chips, 990);
});

test('reparte botes laterales segun lo comprometido por cada jugador', () => {
  const g = makeGame([100, 300, 500]);
  g.button = 2; // pasa a 0 => sb=1, bb=2, toAct=0
  g.startHand();
  g.act('p0', 'allin');   // 100
  g.act('p1', 'allin');   // 300
  g.act('p2', 'call');    // 300
  g.advance();            // todos all-in salvo p2: se cierra la ronda
  const pots = g.buildPots();
  assert.equal(pots.length, 2);
  assert.equal(pots[0].amount, 300, 'bote principal: 100 x 3');
  assert.deepEqual([...pots[0].eligible].sort(), [0, 1, 2]);
  assert.equal(pots[1].amount, 400, 'bote lateral: 200 x 2');
  assert.deepEqual([...pots[1].eligible].sort(), [1, 2]);
  assert.equal(pots.reduce((a, x) => a + x.amount, 0), 700, 'no se crean ni se pierden fichas');
});

test('el corto no puede ganar el bote lateral aunque tenga la mejor mano', () => {
  const g = makeGame([100, 300, 300]);
  g.button = 2;
  g.startHand();
  g.act('p0', 'allin');
  g.act('p1', 'allin');
  g.act('p2', 'call');
  g.seats[0].hole = ['Ah', 'As'].map(parseCard);  // trio de ases: gana el principal
  g.seats[1].hole = ['Kh', 'Kd'].map(parseCard);  // pareja de reyes: gana el lateral
  g.seats[2].hole = ['2h', '3d'].map(parseCard);
  g.board = ['Ad', '7c', '9s', 'Jh', '4c'].map(parseCard);
  g.stage = STAGE.RIVER;
  g.pending = { type: 'showdown' };
  g.advance();
  const [main, side] = g.results.pots;
  assert.equal(main.winners[0].seat, 0, 'el corto gana el bote principal');
  assert.equal(main.amount, 300);
  assert.equal(side.winners[0].seat, 1, 'el lateral es solo para los que lo pagaron');
  assert.equal(side.amount, 400);
  g.advance(); // reparto
  assert.equal(g.seats[0].chips, 300, 'el corto cobra como maximo lo que cubrio');
  assert.equal(g.seats[1].chips, 400);
});

test('las fichas del bote cuadran con lo apostado tras el reparto', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = makeGame([1000, 1000, 1000, 1000], { seed });
    const before = g.seated().reduce((a, p) => a + p.chips, 0);
    g.startHand();
    let guard = 0;
    while (g.stage !== STAGE.HAND_END && guard++ < 200) {
      if (g.pending) {
        g.advance();
        continue;
      }
      if (g.toAct < 0) break;
      const p = g.seats[g.toAct];
      const legal = g.legalActions(p.id);
      const rng = mulberry32(seed * 31 + guard);
      const roll = rng();
      if (roll < 0.15 && legal.canFold && legal.toCall > 0) g.act(p.id, 'fold');
      else if (roll < 0.3 && legal.canRaise) g.act(p.id, 'raise', Math.min(legal.maxRaiseTo, legal.minRaiseTo * 2));
      else if (legal.canCheck) g.act(p.id, 'check');
      else g.act(p.id, 'call');
    }
    const after = g.seated().reduce((a, p) => a + p.chips, 0);
    assert.equal(after, before, `seed ${seed}: las fichas totales deben conservarse`);
  }
});

test('el bote empatado se reparte y las fichas sueltas van a la izquierda del boton', () => {
  const g = makeGame([1000, 1000, 1000]);
  g.button = 0;
  g.startHand();
  // Mismo board y manos gemelas: empate a tres bandas.
  g.seats[0].hole = ['Ah', 'Kd'].map(parseCard);
  g.seats[1].hole = ['As', 'Kc'].map(parseCard);
  g.seats[2].hole = ['Ad', 'Kh'].map(parseCard);
  g.board = ['2c', '7d', '9s', 'Jh', '3c'].map(parseCard);
  g.seats.forEach((p) => p && (p.committed = 100, p.bet = 0));
  g.stage = STAGE.RIVER;
  g.pending = { type: 'showdown' };
  g.advance();
  const pot = g.results.pots[0];
  assert.equal(pot.amount, 300);
  assert.equal(pot.winners.length, 3);
  assert.equal(pot.winners.reduce((a, w) => a + w.amount, 0), 300);
});

test('gana la mejor mano de cinco cartas entre las siete', () => {
  const g = makeGame([1000, 1000]);
  g.button = 1;
  g.startHand();
  g.seats[0].hole = ['Ah', 'Ad'].map(parseCard);   // trio de ases
  g.seats[1].hole = ['9c', '9d'].map(parseCard);   // color
  g.board = ['Ac', '5c', '7c', 'Jc', '3h'].map(parseCard);
  g.seats.forEach((p) => p && (p.committed = 200, p.bet = 0));
  g.stage = STAGE.RIVER;
  g.pending = { type: 'showdown' };
  g.advance();
  const winner = g.results.pots[0].winners[0];
  assert.equal(winner.seat, 1, 'el color gana al trio');
  assert.match(winner.eval.name, /Color/);
});

test('el motor es determinista con el mismo seed', () => {
  const a = makeGame([1000, 1000, 1000], { seed: 99 });
  const b = makeGame([1000, 1000, 1000], { seed: 99 });
  a.startHand();
  b.startHand();
  assert.deepEqual(a.seats[0].hole, b.seats[0].hole);
  assert.deepEqual(a.seats[1].hole, b.seats[1].hole);
});
