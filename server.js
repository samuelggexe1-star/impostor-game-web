#!/usr/bin/env node
/**
 * Servidor de Hold'em Club.
 *
 *   node server.js            (o: npm start)
 *
 * Aqui las mesas viven en el servidor: es el quien baraja, reparte y lleva los
 * tiempos. Los jugadores solo abren la web y reciben su propia vista de la
 * partida (sus cartas, nunca las de los demas).
 *
 * Por que asi y no navegador contra navegador: en redes con restricciones
 * (colegios, oficinas, moviles con datos) los dispositivos no pueden hablar
 * entre si. Contra un servidor solo hace falta HTTPS normal, que funciona en
 * todas partes. Ademas nadie tiene que dejar su tablet encendida haciendo de
 * crupier: si se te apaga la pantalla, la partida sigue.
 *
 * Todo el envio va por SSE (el servidor te habla) + POST (tu le hablas).
 * Sin websockets ni dependencias: solo Node.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Table, DEFAULT_CONFIG } from './js/table.js';
import { UnoMesa, CONFIG_UNO } from './js/uno-mesa.js';
import { BlackjackMesa, CONFIG_BJ } from './js/blackjack-mesa.js';
import { AltoBajoMesa, CONFIG_AB } from './js/altobajo-mesa.js';

/** Juegos que sabe alojar el servidor. */
const JUEGOS = {
  holdem: {
    nombre: "Texas Hold'em",
    crear: (cfg) => new Table(cfg),
    config: (c) => ({
      ...DEFAULT_CONFIG,
      mode: c.mode === 'torneo' ? 'torneo' : 'cash',
      startingChips: Math.min(100000, Math.max(100, Number(c.startingChips) || 2000)),
      sb: Math.max(1, Number(c.sb) || 10),
      bb: Math.max(2, Number(c.bb) || 20),
      turnSeconds: Math.min(600, Math.max(10, Number(c.turnSeconds) || 30)),
      speed: 1
    })
  },
  uno: {
    nombre: 'UNO',
    crear: (cfg) => new UnoMesa(cfg),
    config: (c) => ({
      ...CONFIG_UNO,
      turnSeconds: Math.min(600, Math.max(10, Number(c.turnSeconds) || 30)),
      objetivo: Math.min(2000, Math.max(100, Number(c.objetivo) || 500)),
      speed: 1
    })
  },
  blackjack: {
    nombre: 'Blackjack',
    crear: (cfg) => new BlackjackMesa(cfg),
    config: (c) => ({
      ...CONFIG_BJ,
      turnSeconds: Math.min(600, Math.max(10, Number(c.turnSeconds) || 25)),
      fichasIniciales: Math.min(100000, Math.max(100, Number(c.fichasIniciales) || 1000)),
      speed: 1
    })
  },
  altobajo: {
    nombre: 'Alto o bajo',
    crear: (cfg) => new AltoBajoMesa(cfg),
    config: (c) => ({
      ...CONFIG_AB,
      segundosPorCarta: Math.min(60, Math.max(4, Number(c.segundosPorCarta) || 10)),
      objetivo: Math.min(500, Math.max(5, Number(c.objetivo) || 30)),
      speed: 1
    })
  }
};

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MAX_BODY = 256 * 1024;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 60;
const PING_MS = 15000;              // mantiene viva la conexion tras los proxies
const IDLE_ROOM_MS = 20 * 60 * 1000; // una mesa vacia se recoge sola

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

// ------------------------------------------------------------------ utilidades

function sseOpen(res) {
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'   // que ningun proxy se guarde los mensajes
  });
  res.write('retry: 3000\n\n');
}

function sseSend(res, payload) {
  if (!res || res.writableEnded) return false;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (_) {
    return false;
  }
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I/O/0/1: se dicta en voz alta
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function clean(str, max) {
  return String(str == null ? '' : str).slice(0, max);
}

function log(msg) {
  if (process.env.QUIET) return;
  console.log(`  · ${msg}`);
}

// ----------------------------------------------------------------------- mesas

/** code -> Room */
const rooms = new Map();

class Room {
  constructor(code, config, owner, juego = 'holdem') {
    this.code = code;
    this.juego = JUEGOS[juego] ? juego : 'holdem';
    this.ownerId = owner.id;
    this.createdAt = Date.now();
    this.emptySince = Date.now();
    this.clients = new Map();  // playerId -> {res, name}
    this.table = JUEGOS[this.juego].crear(config);
    this.table.on('update', (events) => this.broadcast(events));
  }

  /** Humanos sentados, sea cual sea el juego. */
  get playerCount() {
    const g = this.table.game;
    if (typeof g.seated === 'function') return g.seated().filter((p) => !p.isBot).length;
    return (g.jugadores || []).filter((p) => !p.esBot).length;
  }

  get totalJugadores() {
    const g = this.table.game;
    if (typeof g.seated === 'function') return g.seated().length;
    return (g.jugadores || []).length;
  }

  attach(playerId, res, profile) {
    const prev = this.clients.get(playerId);
    if (prev && prev.res !== res) {
      // Alguien vuelve a entrar con la misma identidad: avisamos a la conexion
      // vieja en vez de dejar dos pantallas mostrando lo mismo.
      sseSend(prev.res, { type: 'closed', reason: 'Has abierto la mesa en otra ventana' });
      try { prev.res.end(); } catch (_) {}
    }
    this.clients.set(playerId, { res, name: profile.name });
    this.emptySince = 0;

    const joined = this.table.join({
      id: playerId,
      name: profile.name,
      avatar: profile.avatar,
      chips: this.table.config.startingChips
    });
    if (!joined.ok) {
      sseSend(res, { type: 'rejected', reason: joined.reason === 'table-full' ? 'La mesa está llena' : 'No se ha podido sentar' });
      this.clients.delete(playerId);
      return false;
    }
    sseSend(res, {
      type: 'accepted',
      playerId,
      code: this.code,
      juego: this.juego,
      owner: this.ownerId === playerId
    });
    this.send(playerId, []);
    if (!this.table.running) this.table.start();
    return true;
  }

  detach(playerId, res) {
    const cur = this.clients.get(playerId);
    if (!cur || (res && cur.res !== res)) return;
    this.clients.delete(playerId);
    // No le quitamos la silla: puede volver (se le acabo la bateria, cambio de red...).
    this.table.setAway(playerId, true);
    if (!this.clients.size) this.emptySince = Date.now();
  }

  onMessage(playerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const t = this.table;
    switch (msg.type) {
      case 'act':
        // El poker manda una cantidad; el UNO, que carta y de que color.
        // Solo el poker manda una cantidad suelta; el resto, un objeto con datos.
        t.act(playerId, msg.action, this.juego === 'holdem' ? (Number(msg.amount) || 0) : (msg.datos || {}));
        break;
      case 'chat':
        t.chat(playerId, clean(msg.text, 240));
        break;
      case 'emote':
        t.emote(playerId, clean(msg.emoji, 4), Number(msg.seat));
        break;
      case 'away':
        t.setAway(playerId, !!msg.away);
        break;
      case 'back':
        t.setAway(playerId, false);
        break;
      case 'command':
        this.command(playerId, msg.cmd, msg.payload || {});
        break;
      case 'ping': {
        const c = this.clients.get(playerId);
        if (c) sseSend(c.res, { type: 'pong', at: msg.at });
        break;
      }
      default:
        break;
    }
  }

  /** Solo quien creo la mesa toca la configuracion; recargar se lo permite a todos. */
  command(playerId, cmd, payload) {
    const isOwner = playerId === this.ownerId;
    const t = this.table;
    if (cmd === 'rebuy') {
      if (typeof t.rebuy === 'function') t.rebuy(playerId, payload.amount);
      return;
    }
    if (!isOwner) return;
    if (cmd === 'addBot') t.addBot(payload.style);
    else if (cmd === 'nuevaPartida' && typeof t.nuevaPartida === 'function') t.nuevaPartida();
    else if (cmd === 'pause') t.pause(!t.paused);
    else if (cmd === 'resume') t.resume();
    else if (cmd === 'start') t.start();
    else if (cmd === 'kick' && t.game.seats) {
      const p = t.game.seats[payload.seat];
      if (p && p.id !== this.ownerId) t.leave(p.id);
    }
  }

  send(playerId, events) {
    const c = this.clients.get(playerId);
    if (!c) return;
    sseSend(c.res, { type: 'state', view: this.table.snapshotFor(playerId), events });
  }

  broadcast(events) {
    for (const id of this.clients.keys()) this.send(id, events);
  }

  destroy(reason) {
    for (const [, c] of this.clients) {
      sseSend(c.res, { type: 'closed', reason });
      try { c.res.end(); } catch (_) {}
    }
    this.clients.clear();
    this.table.destroy();
    rooms.delete(this.code);
  }
}

// Recogida de mesas abandonadas.
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!room.clients.size && room.emptySince && now - room.emptySince > IDLE_ROOM_MS) {
      log(`sala ${room.code} recogida por inactividad`);
      room.destroy('inactividad');
    }
  }
}, 60000).unref?.();

// ------------------------------------------------------------------ endpoints

async function handleCreate(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (_) {
    return json(res, 400, { error: 'json-invalido' });
  }
  if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'servidor-lleno' });

  const owner = payload.owner || {};
  if (!owner.id) return json(res, 400, { error: 'falta-jugador' });

  const juego = JUEGOS[payload.game] ? payload.game : 'holdem';
  const config = JUEGOS[juego].config(payload.config || {});

  let code = makeCode();
  for (let i = 0; i < 12 && rooms.has(code); i++) code = makeCode();
  if (rooms.has(code)) return json(res, 503, { error: 'sin-codigos' });

  const room = new Room(code, config, { id: clean(owner.id, 40) }, juego);
  rooms.set(code, room);
  const bots = Math.min(7, Math.max(0, Number(payload.bots) || 0));
  for (let i = 0; i < bots; i++) room.table.addBot(payload.botStyle || null);

  log(`sala ${code} (${JUEGOS[juego].nombre}) creada con ${bots} bots`);
  json(res, 200, { code, juego });
}

function handleEvents(req, res, url) {
  const code = clean(url.searchParams.get('room'), 8).toUpperCase();
  const playerId = clean(url.searchParams.get('peer'), 40);
  const name = clean(url.searchParams.get('name'), 16) || 'Invitado';
  const avatar = clean(url.searchParams.get('avatar'), 4) || '🙂';

  if (!code || !playerId) return json(res, 400, { error: 'parametros-invalidos' });

  const room = rooms.get(code);
  if (!room) {
    sseOpen(res);
    sseSend(res, { type: 'error', reason: 'no-room' });
    return res.end();
  }

  sseOpen(res);
  if (!room.attach(playerId, res, { name, avatar })) return res.end();

  const ping = setInterval(() => {
    if (res.writableEnded) return clearInterval(ping);
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, PING_MS);

  req.on('close', () => {
    clearInterval(ping);
    room.detach(playerId, res);
  });
  log(`${name} entra en la sala ${code}`);
}

async function handleSend(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, {
      error: err.message === 'body-too-large' ? 'mensaje-demasiado-grande' : 'json-invalido'
    });
  }
  const room = rooms.get(clean(payload.room, 8).toUpperCase());
  if (!room) return json(res, 404, { error: 'no-room' });
  const playerId = clean(payload.from, 40);
  if (!room.clients.has(playerId)) return json(res, 403, { error: 'no-estas-en-la-mesa' });
  room.onMessage(playerId, payload.data);
  json(res, 200, { ok: true });
}

function handleRooms(res) {
  const list = [];
  for (const room of rooms.values()) {
    const g = room.table.game;
    const owner = typeof g.playerById === 'function' ? g.playerById(room.ownerId) : g.porId(room.ownerId);
    list.push({
      code: room.code,
      juego: room.juego,
      host: owner ? (owner.name || owner.nombre) : 'Mesa abierta',
      players: room.totalJugadores,
      humans: room.playerCount,
      detalle: room.juego === 'holdem' ? `ciegas ${g.sb}/${g.bb}` : `${room.totalJugadores} jugando`,
      nombreJuego: JUEGOS[room.juego].nombre,
      since: room.createdAt
    });
  }
  list.sort((a, b) => b.since - a.since);
  json(res, 200, list);
}

function localAddresses() {
  const out = [];
  for (const [, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

// --------------------------------------------------------------- ficheros

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return json(res, 403, { error: 'prohibido' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ------------------------------------------------------------------ servidor

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  switch (url.pathname) {
    case '/api/ping':
      return json(res, 200, {
        ok: true, protocol: 3, mode: 'servidor', juegos: Object.keys(JUEGOS),
        port: PORT, addresses: localAddresses(), rooms: rooms.size
      });
    case '/api/rooms':
      return handleRooms(res);
    case '/api/room':
      if (req.method !== 'POST') return json(res, 405, { error: 'usa-post' });
      return handleCreate(req, res);
    case '/api/events':
      return handleEvents(req, res, url);
    case '/api/send':
      if (req.method !== 'POST') return json(res, 405, { error: 'usa-post' });
      return handleSend(req, res);
    default:
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'ruta-desconocida' });
      return serveStatic(req, res, url);
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

export function start(port = PORT, host = HOST) {
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  start().then(() => {
    const addrs = localAddresses();
    console.log('\n  ♠️  Hold\'em Club en marcha\n');
    console.log(`  Aquí:                http://localhost:${PORT}`);
    if (addrs.length) {
      console.log('  En tu red local:');
      for (const a of addrs) console.log(`      http://${a}:${PORT}`);
    }
    console.log('\n  Si lo has desplegado en internet, reparte la dirección pública.');
    console.log('  Las mesas viven aquí: nadie tiene que dejar su móvil encendido.');
    console.log('  Ctrl+C para parar.\n');
  });
}

export { server, rooms, Room };
