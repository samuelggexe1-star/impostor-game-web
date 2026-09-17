// Multijugador P2P con PeerJS (WebRTC).
// El anfitrion es la autoridad: ejecuta el motor y reparte snapshots ya censurados
// (nadie recibe las cartas de los demas hasta el showdown).
// No hay servidor que desplegar: solo el broker publico para el saludo inicial.

import { Emitter, Table } from './table.js';
import { RelayLink } from './relay.js';

const PREFIX = 'holdemclub-es-';
const PROTOCOL = 1;

export function roomCode(len = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I/O/0/1 para dictarlo por voz
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function peerAvailable() {
  return typeof window !== 'undefined' && typeof window.Peer === 'function';
}

function peerOptions() {
  return { debug: 1, config: { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ] } };
}

/** Sesion local: partida contra bots o pasa-y-juega, sin red. */
export class LocalSession extends Emitter {
  constructor(table, youId) {
    super();
    this.table = table;
    this.you = youId;
    this.isHost = true;
    this.online = false;
    this.peers = new Map();
    this.table.on('update', (events) => {
      this.emit('state', this.table.snapshotFor(this.you), events);
    });
  }

  act(action, amount) {
    return this.table.act(this.you, action, amount);
  }

  chat(text) {
    this.table.chat(this.you, text);
  }

  emote(emoji, seat) {
    this.table.emote(this.you, emoji, seat);
  }

  command(cmd, payload = {}) {
    return runHostCommand(this.table, this.you, cmd, payload);
  }

  refresh() {
    this.emit('state', this.table.snapshotFor(this.you), []);
  }

  close() {
    this.table.destroy();
  }
}

/** Sesion de anfitrion: igual que la local pero ademas sirve a los invitados. */
export class HostSession extends LocalSession {
  constructor(table, youId, code) {
    super(table, youId);
    this.online = true;
    this.code = code;
    this.peer = null;
    this.conns = new Map();  // playerId -> DataConnection
    this.table.on('update', (events) => this.broadcast(events));
  }

  async open() {
    if (!peerAvailable()) throw new Error('PeerJS no disponible');
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + this.code, peerOptions());
      this.peer = peer;
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      peer.on('open', () => {
        clearTimeout(timeout);
        resolve(this.code);
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        if (err && err.type === 'unavailable-id') reject(new Error('code-taken'));
        else if (this.peer && !this.peer.open) reject(err);
        else this.emit('neterror', err);
      });
      peer.on('connection', (conn) => this.accept(conn));
      peer.on('disconnected', () => {
        this.emit('netstatus', 'reconectando');
        try { peer.reconnect(); } catch (_) {}
      });
    });
  }

  accept(conn) {
    conn.on('open', () => {
      conn.send({ type: 'hello', protocol: PROTOCOL, code: this.code });
    });
    conn.on('data', (msg) => this.onMessage(conn, msg));
    conn.on('close', () => this.dropConn(conn));
    conn.on('error', () => this.dropConn(conn));
  }

  dropConn(conn) {
    const id = conn.metadata && conn.metadata.playerId ? conn.metadata.playerId : conn._playerId;
    if (id) {
      this.conns.delete(id);
      const p = this.table.game.playerById(id);
      if (p) {
        p.away = true;
        p.sittingOut = true;
        this.table.system(`${p.name} ha perdido la conexion`);
        this.table.publish();
      }
    }
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'join': {
        if (msg.protocol !== PROTOCOL) {
          conn.send({ type: 'rejected', reason: 'Version distinta del juego. Recargad la pagina.' });
          return;
        }
        const id = String(msg.playerId || '').slice(0, 40) || 'guest-' + Math.random().toString(36).slice(2, 8);
        const res = this.table.join({
          id,
          name: String(msg.name || 'Invitado').slice(0, 16),
          avatar: String(msg.avatar || '🙂').slice(0, 4),
          chips: this.table.config.startingChips
        });
        if (!res.ok) {
          conn.send({ type: 'rejected', reason: res.reason === 'table-full' ? 'La mesa esta llena' : 'No se ha podido sentar' });
          return;
        }
        conn._playerId = id;
        this.conns.set(id, conn);
        const p = this.table.game.playerById(id);
        if (p) {
          p.away = false;
          p.sittingOut = false;
        }
        conn.send({ type: 'accepted', playerId: id, seat: res.seat, code: this.code });
        this.sendTo(id, []);
        this.table.publish();
        break;
      }
      case 'act':
        this.table.act(conn._playerId, msg.action, msg.amount);
        break;
      case 'chat':
        this.table.chat(conn._playerId, msg.text);
        break;
      case 'emote':
        this.table.emote(conn._playerId, msg.emoji, msg.seat);
        break;
      case 'command':
        runHostCommand(this.table, conn._playerId, msg.cmd, msg.payload || {}, this.you);
        break;
      case 'away':
        this.table.setAway(conn._playerId, msg.away);
        break;
      case 'ping':
        conn.send({ type: 'pong', at: msg.at });
        break;
      default:
        break;
    }
  }

  sendTo(playerId, events) {
    const conn = this.conns.get(playerId);
    if (!conn || !conn.open) return;
    try {
      conn.send({ type: 'state', view: this.table.snapshotFor(playerId), events });
    } catch (err) {
      console.warn('[host] envio fallido', err);
    }
  }

  broadcast(events) {
    for (const id of this.conns.keys()) this.sendTo(id, events);
  }

  close() {
    for (const conn of this.conns.values()) {
      try { conn.send({ type: 'closed' }); conn.close(); } catch (_) {}
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
    }
    super.close();
  }
}

/** Sesion de invitado: manda acciones y pinta lo que diga el anfitrion. */
export class GuestSession extends Emitter {
  constructor({ code, name, avatar, playerId }) {
    super();
    this.code = code.toUpperCase();
    this.name = name;
    this.avatar = avatar;
    this.you = playerId || 'guest-' + Math.random().toString(36).slice(2, 10);
    this.isHost = false;
    this.online = true;
    this.conn = null;
    this.peer = null;
    this.latency = 0;
    this.lastView = null;
    this.closed = false;
  }

  async open() {
    return this.openPeer();
  }

  /** Reparte los mensajes que manda quien reparte. */
  handleMessage(msg, resolve, reject) {
    if (!msg) return;
    if (msg.type === 'accepted') {
      this._resolved = true;
      this.you = msg.playerId;
      resolve(msg);
    } else if (msg.type === 'rejected') {
      reject(new Error(msg.reason || 'Rechazado'));
    } else if (msg.type === 'state') {
      this.lastView = msg.view;
      this.emit('state', msg.view, msg.events || []);
    } else if (msg.type === 'pong') {
      this.latency = Date.now() - msg.at;
      this.emit('latency', this.latency);
    } else if (msg.type === 'closed') {
      this.emit('hostgone');
    }
  }

  async openPeer() {
    if (!peerAvailable()) throw new Error('PeerJS no disponible');
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(null, peerOptions());
      this.peer = peer;
      const fail = (err) => {
        if (!this._resolved) reject(err);
      };
      const timeout = setTimeout(() => fail(new Error('timeout')), 20000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true, metadata: { playerId: this.you } });
        this.conn = conn;
        conn.on('open', () => {
          conn.send({
            type: 'join',
            protocol: PROTOCOL,
            playerId: this.you,
            name: this.name,
            avatar: this.avatar
          });
          this.startPing();
        });
        conn.on('data', (msg) =>
          this.handleMessage(msg, (v) => {
            clearTimeout(timeout);
            resolve(v);
          }, (e) => {
            clearTimeout(timeout);
            fail(e);
          })
        );
        conn.on('close', () => {
          if (!this.closed) this.emit('hostgone');
        });
        conn.on('error', (err) => fail(err));
      });
      peer.on('error', (err) => {
        clearTimeout(timeout);
        if (err && err.type === 'peer-unavailable') fail(new Error('no-room'));
        else fail(err);
      });
      peer.on('disconnected', () => {
        this.emit('netstatus', 'reconectando');
        try { peer.reconnect(); } catch (_) {}
      });
    });
  }

  startPing() {
    this._pingTimer = setInterval(() => {
      if (this.conn && this.conn.open) this.conn.send({ type: 'ping', at: Date.now() });
    }, 4000);
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  act(action, amount) {
    this.send({ type: 'act', action, amount });
    return { ok: true, remote: true };
  }

  chat(text) {
    this.send({ type: 'chat', text });
  }

  emote(emoji, seat) {
    this.send({ type: 'emote', emoji, seat });
  }

  command(cmd, payload = {}) {
    this.send({ type: 'command', cmd, payload });
  }

  setAway(away) {
    this.send({ type: 'away', away });
  }

  refresh() {
    if (this.lastView) this.emit('state', this.lastView, []);
  }

  close() {
    this.closed = true;
    clearInterval(this._pingTimer);
    try { if (this.conn) this.conn.close(); } catch (_) {}
    try { if (this.peer) this.peer.destroy(); } catch (_) {}
  }
}

/**
 * Sesion contra el servidor de partidas: alli viven las cartas y los tiempos.
 * Tu dispositivo solo manda lo que haces y pinta lo que le devuelven, asi que
 * la partida sigue aunque se te apague la pantalla.
 */
export class RelaySession extends Emitter {
  constructor({ code, name, avatar, playerId, juego = null }) {
    super();
    this.code = String(code || '').toUpperCase();
    this.name = name;
    this.avatar = avatar;
    this.you = playerId;
    this.juego = juego;       // si se indica, se comprueba al entrar
    this.isHost = false;      // lo dice el servidor al aceptarte
    this.online = true;
    this.serverHosted = true;
    this.lastView = null;
    this.latency = 0;
    this.closed = false;
    this.link = null;
  }

  async open() {
    const link = new RelayLink(this.code, {
      playerId: this.you,
      name: this.name,
      avatar: this.avatar
    });
    this.link = link;

    link.on('data', (msg) => {
      if (msg.type === 'state') {
        this.lastView = msg.view;
        this.emit('state', msg.view, msg.events || []);
      } else if (msg.type === 'pong') {
        this.latency = Date.now() - msg.at;
        this.emit('latency', this.latency);
      }
    });
    link.on('closed', (reason) => this.emit('hostgone', reason));
    link.on('offline', () => this.emit('netstatus', 'reconectando…'));
    link.on('online', () => this.emit('netstatus', ''));

    const accepted = await link.connect();
    if (this.juego && accepted.juego && accepted.juego !== this.juego) {
      link.close();
      throw new Error(accepted.juego === 'uno'
        ? 'Esa sala es de UNO, no de póker'
        : 'Esa sala es de póker, no de UNO');
    }
    this.you = accepted.playerId || this.you;
    this.isHost = !!accepted.owner;
    this.juego = accepted.juego || this.juego;
    this.startPing();
    return accepted;
  }

  startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (this.link && this.link.open) this.link.send({ type: 'ping', at: Date.now() });
    }, 5000);
  }

  act(action, amount) {
    this.link.send({ type: 'act', action, amount });
    return { ok: true, remote: true };
  }

  chat(text) {
    this.link.send({ type: 'chat', text });
  }

  emote(emoji, seat) {
    this.link.send({ type: 'emote', emoji, seat });
  }

  command(cmd, payload = {}) {
    this.link.send({ type: 'command', cmd, payload });
  }

  setAway(away) {
    this.link.send({ type: 'away', away });
  }

  refresh() {
    if (this.lastView) this.emit('state', this.lastView, []);
  }

  close() {
    this.closed = true;
    clearInterval(this._pingTimer);
    if (this.link) this.link.close();
  }
}

/** Comandos de mesa. Solo el anfitrion puede tocar la configuracion. */
export function runHostCommand(table, requesterId, cmd, payload = {}, hostId = null) {
  const isHost = hostId == null || requesterId === hostId;
  switch (cmd) {
    case 'start':
      if (!isHost) return { ok: false };
      table.start();
      return { ok: true };
    case 'pause':
      if (!isHost) return { ok: false };
      table.pause(!table.paused);
      return { ok: true };
    case 'resume':
      if (!isHost) return { ok: false };
      table.resume();
      return { ok: true };
    case 'addBot':
      if (!isHost) return { ok: false };
      table.addBot(payload.style);
      return { ok: true };
    case 'kick': {
      if (!isHost) return { ok: false };
      const p = table.game.seats[payload.seat];
      if (p) table.leave(p.id);
      return { ok: true };
    }
    case 'rebuy':
      return { ok: table.rebuy(requesterId, payload.amount) };
    case 'away':
      table.setAway(requesterId, payload.away);
      return { ok: true };
    case 'config': {
      if (!isHost) return { ok: false };
      const cfg = payload.config || {};
      if (cfg.speed) table.config.speed = cfg.speed;
      if (cfg.turnSeconds) table.config.turnSeconds = cfg.turnSeconds;
      if (cfg.sb && cfg.bb) {
        table.config.sb = cfg.sb;
        table.config.bb = cfg.bb;
        table.game.sb = cfg.sb;
        table.game.bb = cfg.bb;
      }
      table.publish();
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'unknown-command' };
  }
}

export function createLocalTable(config, host) {
  const table = new Table(config);
  table.join(host);
  return table;
}
