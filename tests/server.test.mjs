// Pruebas del servidor de partidas: aqui las mesas viven en el servidor,
// asi que se comprueba que reparte, que respeta los permisos y que a cada
// jugador solo le llegan sus cartas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { start, server, rooms } from '../server.js';

const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.QUIET = '1';

await start(PORT, '127.0.0.1');
test.after(() => {
  for (const room of [...rooms.values()]) room.destroy('fin de pruebas');
  server.close();
});

/** Cliente SSE que va guardando lo que recibe. */
function connect(code, peer, name = 'Jugador') {
  const events = [];
  const ctrl = new AbortController();
  const qs = new URLSearchParams({ room: code, peer, name, avatar: '🙂' });
  const ready = fetch(`${BASE}/api/events?${qs}`, { signal: ctrl.signal }).then((res) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (line) events.push(JSON.parse(line.slice(6)));
          }
        }
      } catch (_) {}
    })();
    return res;
  });
  return {
    events,
    ready,
    close: () => ctrl.abort(),
    last: () => [...events].reverse().find((e) => e.type === 'state'),
    send: (data) =>
      fetch(`${BASE}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: code, from: peer, data })
      })
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(25);
  }
  return false;
};

async function createRoom(owner = 'o1', extra = {}) {
  const res = await fetch(`${BASE}/api/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: { id: owner, name: 'Samuel' },
      config: { sb: 10, bb: 20, startingChips: 1000, turnSeconds: 600 },
      bots: 0,
      ...extra
    })
  });
  return res.json();
}

test('dice quien es y sirve la web', async () => {
  const ping = await (await fetch(`${BASE}/api/ping`)).json();
  assert.equal(ping.ok, true);
  assert.equal(ping.mode, 'servidor');

  const html = await (await fetch(`${BASE}/`)).text();
  assert.match(html, /Sala de juegos/);
  const css = await fetch(`${BASE}/css/style.css`);
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('no deja salir de la carpeta del proyecto', async () => {
  const res = await fetch(`${BASE}/%2e%2e/%2e%2e/etc/passwd`);
  assert.ok(res.status === 403 || res.status === 404);
});

test('crea una mesa y la anuncia', async () => {
  const { code } = await createRoom('dueño1');
  assert.match(code, /^[A-Z0-9]{4}$/);
  const list = await (await fetch(`${BASE}/api/rooms`)).json();
  assert.ok(list.find((r) => r.code === code), 'la mesa sale en la lista');
  rooms.get(code).destroy('fin');
});

test('dos jugadores entran y el servidor reparte la mano', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  await ana.ready;
  assert.ok(await until(() => ana.events.some((e) => e.type === 'accepted')), 'Ana entra');

  const luis = connect(code, 'luis', 'Luis');
  await luis.ready;
  assert.ok(await until(() => luis.events.some((e) => e.type === 'accepted')), 'Luis entra');

  // Con dos jugadores, la mesa arranca sola.
  assert.ok(await until(() => {
    const v = ana.last();
    return v && v.view.stage === 'preflop' && v.view.handNumber >= 1;
  }, 6000), 'se reparte una mano sin que nadie haga de crupier');

  const vAna = ana.last().view;
  const vLuis = luis.last().view;
  const yoAna = vAna.players.find((p) => p && p.isYou);
  assert.equal(yoAna.hole.length, 2, 'Ana ve sus dos cartas');
  for (const p of vAna.players.filter(Boolean)) {
    if (!p.isYou) assert.equal(p.hole, null, 'las cartas de Luis no viajan a Ana');
  }
  for (const p of vLuis.players.filter(Boolean)) {
    if (!p.isYou) assert.equal(p.hole, null, 'las cartas de Ana no viajan a Luis');
  }

  rooms.get(code).destroy('fin');
  ana.close();
  luis.close();
});

test('la accion de un jugador llega a la mesa del servidor', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  const luis = connect(code, 'luis', 'Luis');
  await Promise.all([ana.ready, luis.ready]);
  await until(() => ana.last() && ana.last().view.stage === 'preflop', 6000);

  const room = rooms.get(code);
  const turno = room.table.game.seats[room.table.game.toAct];
  const cliente = turno.id === 'ana' ? ana : luis;
  const fichasAntes = turno.chips;

  await cliente.send({ type: 'act', action: 'fold' });
  assert.ok(await until(() => {
    const p = room.table.game.playerById(turno.id);
    return p.status === 'folded' || room.table.game.handNumber > 1 || p.chips !== fichasAntes;
  }), 'el servidor aplica la accion');

  room.destroy('fin');
  ana.close();
  luis.close();
});

test('el chat pasa por el servidor y lo ven todos', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  const luis = connect(code, 'luis', 'Luis');
  await Promise.all([ana.ready, luis.ready]);
  await until(() => luis.last());

  await ana.send({ type: 'chat', text: 'buena mano' });
  assert.ok(await until(() => {
    const v = luis.last();
    return v && (v.view.messages || []).some((m) => m.text === 'buena mano');
  }), 'Luis recibe el mensaje de Ana');

  rooms.get(code).destroy('fin');
  ana.close();
  luis.close();
});

test('solo quien creo la mesa puede cambiarla', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  const luis = connect(code, 'luis', 'Luis');
  await Promise.all([ana.ready, luis.ready]);
  await until(() => luis.last());
  const room = rooms.get(code);
  const antes = room.table.game.seated().length;

  await luis.send({ type: 'command', cmd: 'addBot', payload: {} });
  await wait(250);
  assert.equal(room.table.game.seated().length, antes, 'un invitado no añade bots');

  await ana.send({ type: 'command', cmd: 'addBot', payload: {} });
  assert.ok(await until(() => room.table.game.seated().length === antes + 1),
    'la dueña de la mesa sí');

  room.destroy('fin');
  ana.close();
  luis.close();
});

test('quien no está en la mesa no puede mandarle nada', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  await ana.ready;
  await until(() => ana.events.some((e) => e.type === 'accepted'));

  const res = await fetch(`${BASE}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: code, from: 'colado', data: { type: 'act', action: 'fold' } })
  });
  assert.equal(res.status, 403);

  rooms.get(code).destroy('fin');
  ana.close();
});

test('avisa si la sala no existe', async () => {
  const perdido = connect('ZZZZ', 'x1', 'Perdido');
  await perdido.ready;
  assert.ok(await until(() => perdido.events.some((e) => e.type === 'error' && e.reason === 'no-room')));
  perdido.close();
});

test('si te desconectas guardas la silla y puedes volver', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  const luis = connect(code, 'luis', 'Luis');
  await Promise.all([ana.ready, luis.ready]);
  await until(() => luis.last());
  const room = rooms.get(code);
  const fichas = room.table.game.playerById('luis').chips;

  luis.close();  // se le acaba la bateria
  await wait(300);
  assert.ok(room.table.game.playerById('luis'), 'la silla sigue ahí');

  const luis2 = connect(code, 'luis', 'Luis');
  await luis2.ready;
  assert.ok(await until(() => luis2.events.some((e) => e.type === 'accepted')), 'vuelve a entrar');
  assert.equal(room.table.game.playerById('luis').chips, fichas, 'conserva sus fichas');

  room.destroy('fin');
  ana.close();
  luis2.close();
});

test('rechaza mensajes enormes y json invalido', async () => {
  const big = await fetch(`${BASE}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(400 * 1024)
  }).catch(() => ({ status: 400 }));
  assert.ok(big.status >= 400);

  const bad = await fetch(`${BASE}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{roto'
  });
  assert.equal(bad.status, 400);
});

test('permite que la web esté en otro dominio (CORS)', async () => {
  const res = await fetch(`${BASE}/api/ping`, { headers: { Origin: 'https://ejemplo.github.io' } });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const pre = await fetch(`${BASE}/api/send`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
});

test('al volver de una desconexion te vuelven a repartir', async () => {
  const { code } = await createRoom('ana');
  const ana = connect(code, 'ana', 'Ana');
  const luis = connect(code, 'luis', 'Luis');
  await Promise.all([ana.ready, luis.ready]);
  await until(() => luis.last());
  const room = rooms.get(code);

  luis.close();                       // se le va la wifi
  await wait(300);
  assert.equal(room.table.game.playerById('luis').sittingOut, true, 'queda fuera mientras no está');

  const luis2 = connect(code, 'luis', 'Luis');
  await luis2.ready;
  await until(() => luis2.events.some((e) => e.type === 'accepted'));
  const p = room.table.game.playerById('luis');
  assert.equal(p.away, false);
  assert.equal(p.sittingOut, false, 'vuelve al reparto, no se queda de espectador');
  assert.ok(room.table.game.eligibleForHand().some((x) => x.id === 'luis'),
    'entra en la siguiente mano');

  room.destroy('fin');
  ana.close();
  luis2.close();
});

test('avisa a la ventana antigua cuando abres la mesa en otra', async () => {
  const { code } = await createRoom('ana');
  const v1 = connect(code, 'ana', 'Ana');
  await v1.ready;
  await until(() => v1.events.some((e) => e.type === 'accepted'));

  const v2 = connect(code, 'ana', 'Ana');   // misma identidad, otra ventana
  await v2.ready;
  assert.ok(await until(() => v1.events.some((e) => e.type === 'closed')),
    'la primera ventana recibe el aviso en vez de quedarse mostrando lo mismo');

  rooms.get(code).destroy('fin');
  v1.close();
  v2.close();
});
