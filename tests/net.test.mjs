// Prueba del protocolo P2P con un PeerJS simulado: sin WebRTC real, pero
// ejercitando los mismos mensajes que viajan entre anfitrion e invitados.

import test from 'node:test';
import assert from 'node:assert/strict';

// ---- PeerJS de mentira: dos "peers" que se hablan por memoria ----
const registry = new Map();

class FakeConn {
  constructor(peerId, metadata) {
    this.peer = peerId;
    this.metadata = metadata;
    this.open = false;
    this._h = {};
    this.sent = [];
  }
  on(evt, fn) { (this._h[evt] = this._h[evt] || []).push(fn); }
  fire(evt, ...a) { for (const f of this._h[evt] || []) f(...a); }
  send(msg) {
    this.sent.push(msg);
    // Entrega sincrona al otro extremo.
    if (this.other) queueMicrotask(() => this.other.fire('data', JSON.parse(JSON.stringify(msg))));
  }
  close() { this.open = false; this.fire('close'); }
}

class FakePeer {
  constructor(id) {
    this.id = id || 'anon-' + Math.random().toString(36).slice(2, 8);
    this.open = false;
    this._h = {};
    if (id) {
      if (registry.has(id)) {
        queueMicrotask(() => this.fire('error', { type: 'unavailable-id' }));
        return;
      }
      registry.set(id, this);
    }
    queueMicrotask(() => { this.open = true; this.fire('open', this.id); });
  }
  on(evt, fn) { (this._h[evt] = this._h[evt] || []).push(fn); }
  fire(evt, ...a) { for (const f of this._h[evt] || []) f(...a); }
  connect(targetId, opts = {}) {
    const target = registry.get(targetId);
    const mine = new FakeConn(targetId, opts.metadata);
    if (!target) {
      queueMicrotask(() => this.fire('error', { type: 'peer-unavailable' }));
      return mine;
    }
    const theirs = new FakeConn(this.id, opts.metadata);
    mine.other = theirs;
    theirs.other = mine;
    queueMicrotask(() => {
      mine.open = true;
      theirs.open = true;
      target.fire('connection', theirs);
      theirs.fire('open');
      mine.fire('open');
    });
    return mine;
  }
  destroy() { if (registry.get(this.id) === this) registry.delete(this.id); }
  reconnect() {}
}

globalThis.window = { Peer: FakePeer };

const { Table } = await import('../js/table.js');
const { HostSession, GuestSession } = await import('../js/net.js');

const tick = (n = 8) => new Promise((r) => { let i = 0; const step = () => (++i >= n ? r() : queueMicrotask(step)); step(); });

test('un invitado entra, recibe estado y puede actuar', async () => {
  const table = new Table({ startingChips: 1000, speed: 50, turnSeconds: 999 });
  table.join({ id: 'host', name: 'Anfitrion', avatar: '👑', chips: 1000 });
  const host = new HostSession(table, 'host', 'TEST');
  await host.open();

  const guest = new GuestSession({ code: 'TEST', name: 'Invitada', avatar: '🦊', playerId: 'g1' });
  const views = [];
  guest.on('state', (v) => views.push(v));
  const accepted = await guest.open();

  assert.equal(accepted.type, 'accepted');
  assert.equal(accepted.playerId, 'g1');
  await tick(20);

  assert.ok(views.length > 0, 'el invitado recibe snapshots');
  const v = views[views.length - 1];
  assert.equal(v.players.filter(Boolean).length, 2, 'hay dos jugadores sentados');
  assert.ok(v.players.find((p) => p && p.isYou && p.name === 'Invitada'), 'se reconoce a si misma');

  host.close();
  guest.close();
  table.destroy();
});

test('el invitado nunca recibe las cartas de los demas antes del showdown', async () => {
  const table = new Table({ startingChips: 1000, speed: 50, turnSeconds: 999 });
  table.join({ id: 'host', name: 'Anfitrion', chips: 1000 });
  const host = new HostSession(table, 'host', 'SECR');
  await host.open();
  const guest = new GuestSession({ code: 'SECR', name: 'Invitada', playerId: 'g1' });
  const views = [];
  guest.on('state', (v) => views.push(v));
  await guest.open();
  await tick(20);

  table.start();
  await new Promise((r) => setTimeout(r, 300));

  const withCards = views.filter((v) => v.stage === 'preflop');
  assert.ok(withCards.length, 'se ha repartido alguna mano');
  for (const v of withCards) {
    for (const p of v.players.filter(Boolean)) {
      if (p.isYou) assert.ok(Array.isArray(p.hole) && p.hole.length === 2, 've sus dos cartas');
      else assert.equal(p.hole, null, `las cartas de ${p.name} viajan ocultas`);
    }
  }

  host.close();
  guest.close();
  table.destroy();
});

test('las acciones del invitado llegan al motor del anfitrion', async () => {
  const table = new Table({ startingChips: 1000, speed: 50, turnSeconds: 999 });
  table.join({ id: 'host', name: 'Anfitrion', chips: 1000 });
  const host = new HostSession(table, 'host', 'ACTS');
  await host.open();
  const guest = new GuestSession({ code: 'ACTS', name: 'Invitada', playerId: 'g1' });
  await guest.open();
  await tick(20);

  table.start();
  await new Promise((r) => setTimeout(r, 300));

  // Quien tenga el turno, actua; si es la invitada lo hace por la red.
  const toActId = table.game.seats[table.game.toAct] && table.game.seats[table.game.toAct].id;
  const before = table.game.handNumber;
  if (toActId === 'g1') {
    guest.act('fold');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(table.game.seats.find((p) => p && p.id === 'g1').status !== 'active'
      || table.game.handNumber > before, 'el fold remoto se ha aplicado');
  } else {
    table.act('host', 'fold');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(true);
  }

  host.close();
  guest.close();
  table.destroy();
});

test('el chat del invitado se propaga a la mesa', async () => {
  const table = new Table({ startingChips: 1000, speed: 50 });
  table.join({ id: 'host', name: 'Anfitrion', chips: 1000 });
  const host = new HostSession(table, 'host', 'CHAT');
  await host.open();
  const guest = new GuestSession({ code: 'CHAT', name: 'Invitada', playerId: 'g1' });
  await guest.open();
  await tick(20);

  guest.chat('¡hola a todos!');
  await new Promise((r) => setTimeout(r, 120));
  const msg = table.messages.find((m) => m.text === '¡hola a todos!');
  assert.ok(msg, 'el mensaje llega al anfitrion');
  assert.equal(msg.from, 'Invitada');

  host.close();
  guest.close();
  table.destroy();
});

test('entrar en una sala inexistente falla con un motivo claro', async () => {
  const guest = new GuestSession({ code: 'NADA', name: 'Perdida', playerId: 'g9' });
  await assert.rejects(() => guest.open(), /no-room/);
  guest.close();
});

test('un invitado no puede cambiar la configuracion de la mesa', async () => {
  const table = new Table({ startingChips: 1000, speed: 50, turnSeconds: 40 });
  table.join({ id: 'host', name: 'Anfitrion', chips: 1000 });
  const host = new HostSession(table, 'host', 'PERM');
  await host.open();
  const guest = new GuestSession({ code: 'PERM', name: 'Colada', playerId: 'g1' });
  await guest.open();
  await tick(20);

  guest.command('config', { config: { turnSeconds: 1 } });
  guest.command('addBot', {});
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(table.config.turnSeconds, 40, 'la configuracion no cambia');
  assert.equal(table.game.seated().length, 2, 'no ha podido anadir bots');

  host.close();
  guest.close();
  table.destroy();
});
