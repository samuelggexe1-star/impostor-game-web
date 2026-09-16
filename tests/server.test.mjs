// Pruebas de la centralita local: reparto de mensajes, salas y limites.
// Arranca el servidor de verdad en un puerto libre y habla con el por HTTP.

import test from 'node:test';
import assert from 'node:assert/strict';
import { start, server } from '../server.js';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.QUIET = '1';

await start(PORT, '127.0.0.1');

test.after(() => server.close());

/** Abre un SSE y va acumulando los mensajes recibidos. */
function sse(pathname) {
  const events = [];
  const ctrl = new AbortController();
  const ready = fetch(BASE + pathname, { signal: ctrl.signal }).then(async (res) => {
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
  return { events, ready, close: () => ctrl.abort() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(25);
  }
  return false;
};

const send = (body) =>
  fetch(BASE + '/lan/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

test('responde al ping con las direcciones de la red', async () => {
  const res = await fetch(BASE + '/lan/ping');
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(typeof data.port, 'number');
  assert.ok(Array.isArray(data.addresses));
});

test('sirve la web', async () => {
  const res = await fetch(BASE + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Hold'em Club/);
  const css = await fetch(BASE + '/css/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('no deja salir de la carpeta del proyecto', async () => {
  const res = await fetch(BASE + '/%2e%2e/%2e%2e/etc/passwd');
  assert.ok(res.status === 403 || res.status === 404, 'ruta fuera del proyecto rechazada');
});

test('el anfitrion abre sala, el invitado entra y los mensajes van y vienen', async () => {
  const host = sse('/lan/events?room=TST1&peer=h1&role=host&name=Ana');
  await host.ready;
  assert.ok(await until(() => host.events.some((e) => e.type === 'ready')), 'la sala se abre');

  const rooms = await (await fetch(BASE + '/lan/rooms')).json();
  assert.ok(rooms.find((r) => r.code === 'TST1' && r.host === 'Ana'), 'la sala se anuncia en la red');

  const guest = sse('/lan/events?room=TST1&peer=g1&role=guest&name=Luis');
  await guest.ready;
  assert.ok(await until(() => guest.events.some((e) => e.type === 'ready')), 'el invitado entra');
  assert.ok(await until(() => host.events.some((e) => e.type === 'peer-join' && e.peer === 'g1')),
    'el anfitrion se entera de quien llega');

  await send({ room: 'TST1', from: 'g1', to: 'host', data: { type: 'act', action: 'fold' } });
  assert.ok(await until(() => host.events.some((e) => e.type === 'msg' && e.data.action === 'fold')),
    'la accion del invitado llega al anfitrion');

  await send({ room: 'TST1', from: 'host', to: 'g1', data: { type: 'state', view: { pot: 40 } } });
  assert.ok(await until(() => guest.events.some((e) => e.type === 'msg' && e.data.view.pot === 40)),
    'el estado llega al invitado');

  guest.close();
  assert.ok(await until(() => host.events.some((e) => e.type === 'peer-leave' && e.peer === 'g1')),
    'el anfitrion se entera de quien se va');
  host.close();
  await wait(100);
});

test('dos salas no se mezclan', async () => {
  const a = sse('/lan/events?room=AAAA&peer=ha&role=host&name=A');
  const b = sse('/lan/events?room=BBBB&peer=hb&role=host&name=B');
  await Promise.all([a.ready, b.ready]);
  await until(() => a.events.length && b.events.length);

  const ga = sse('/lan/events?room=AAAA&peer=g&role=guest&name=G');
  await ga.ready;
  await until(() => ga.events.some((e) => e.type === 'ready'));

  await send({ room: 'AAAA', from: 'host', to: 'g', data: { secreto: 'solo-A' } });
  await until(() => ga.events.some((e) => e.type === 'msg'));
  assert.ok(!b.events.some((e) => e.type === 'msg'), 'la sala B no ve nada de la sala A');

  a.close(); b.close(); ga.close();
  await wait(100);
});

test('no se puede entrar en una sala que no existe', async () => {
  const guest = sse('/lan/events?room=ZZZZ&peer=g9&role=guest&name=X');
  await guest.ready;
  assert.ok(await until(() => guest.events.some((e) => e.type === 'error' && e.reason === 'no-room')),
    'avisa de que no hay sala');
  guest.close();
});

test('un codigo ya usado no se puede robar', async () => {
  const host = sse('/lan/events?room=DUPE&peer=h1&role=host&name=Ana');
  await host.ready;
  await until(() => host.events.some((e) => e.type === 'ready'));

  const ladron = sse('/lan/events?room=DUPE&peer=h2&role=host&name=Otro');
  await ladron.ready;
  assert.ok(await until(() => ladron.events.some((e) => e.type === 'error' && e.reason === 'code-taken')),
    'el segundo anfitrion es rechazado');
  host.close(); ladron.close();
  await wait(100);
});

test('si el anfitrion se va, sus invitados se enteran', async () => {
  const host = sse('/lan/events?room=BYE1&peer=h1&role=host&name=Ana');
  await host.ready;
  await until(() => host.events.some((e) => e.type === 'ready'));
  const guest = sse('/lan/events?room=BYE1&peer=g1&role=guest&name=Luis');
  await guest.ready;
  await until(() => guest.events.some((e) => e.type === 'ready'));

  host.close();
  assert.ok(await until(() => guest.events.some((e) => e.type === 'host-gone')),
    'el invitado recibe el aviso de cierre');
  guest.close();
  await wait(100);
});

test('rechaza mensajes enormes y json invalido', async () => {
  const big = await fetch(BASE + '/lan/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(600 * 1024)
  }).catch(() => ({ status: 400 }));
  assert.ok(big.status >= 400, 'un mensaje gigante no pasa');

  const bad = await fetch(BASE + '/lan/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{no es json'
  });
  assert.equal(bad.status, 400);
});
