#!/usr/bin/env node
/**
 * Servidor de Hold'em Club para jugar en la wifi de casa.
 *
 *   node server.js            (o: npm start)
 *
 * Hace dos cosas:
 *  1. Sirve la web (index.html, css, js).
 *  2. Actua de centralita: reenvia mensajes entre el anfitrion y sus invitados
 *     por SSE + POST, para que la partida funcione sin salir a internet.
 *
 * El servidor NO conoce las reglas del poker ni mira las cartas: solo pasa
 * mensajes de un navegador a otro. Quien reparte sigue siendo el anfitrion.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 512 * 1024;
const PING_MS = 20000;

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

/** code -> { code, host, guests: Map, since } */
const rooms = new Map();

// --------------------------------------------------------------- utilidades

function sseOpen(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
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

function closeRoom(room, reason) {
  for (const [, guest] of room.guests) {
    sseSend(guest.res, { type: 'host-gone', reason });
    try { guest.res.end(); } catch (_) {}
  }
  room.guests.clear();
  rooms.delete(room.code);
}

// ------------------------------------------------------------------ centralita

function handleEvents(req, res, url) {
  const code = (url.searchParams.get('room') || '').toUpperCase();
  const peer = url.searchParams.get('peer') || '';
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
  const name = (url.searchParams.get('name') || '').slice(0, 24);

  if (!/^[A-Z0-9]{3,8}$/.test(code) || !peer) {
    json(res, 400, { error: 'parametros-invalidos' });
    return;
  }

  if (role === 'host') {
    const existing = rooms.get(code);
    if (existing && existing.host && !existing.host.res.writableEnded) {
      sseOpen(res);
      sseSend(res, { type: 'error', reason: 'code-taken' });
      res.end();
      return;
    }
    const room = { code, host: null, guests: new Map(), since: Date.now(), name };
    rooms.set(code, room);
    sseOpen(res);
    room.host = { peer, res, name };
    sseSend(res, { type: 'ready', room: code });

    const ping = setInterval(() => {
      if (res.writableEnded) return clearInterval(ping);
      try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
    }, PING_MS);

    req.on('close', () => {
      clearInterval(ping);
      if (rooms.get(code) === room) {
        closeRoom(room, 'el anfitrion ha cerrado la mesa');
        log(`sala ${code} cerrada`);
      }
    });
    log(`sala ${code} abierta por ${name || peer}`);
    return;
  }

  const room = rooms.get(code);
  if (!room || !room.host || room.host.res.writableEnded) {
    sseOpen(res);
    sseSend(res, { type: 'error', reason: 'no-room' });
    res.end();
    return;
  }

  sseOpen(res);
  room.guests.set(peer, { res, name });
  sseSend(res, { type: 'ready', room: code });
  sseSend(room.host.res, { type: 'peer-join', peer, name });

  const ping = setInterval(() => {
    if (res.writableEnded) return clearInterval(ping);
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, PING_MS);

  req.on('close', () => {
    clearInterval(ping);
    if (room.guests.get(peer) && room.guests.get(peer).res === res) {
      room.guests.delete(peer);
      sseSend(room.host.res, { type: 'peer-leave', peer });
    }
  });
  log(`${name || peer} entra en la sala ${code}`);
}

async function handleSend(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    json(res, 400, { error: err.message === 'body-too-large' ? 'mensaje-demasiado-grande' : 'json-invalido' });
    return;
  }
  const { room: code, from, to, data } = payload || {};
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) {
    json(res, 404, { error: 'no-room' });
    return;
  }
  const target = to === 'host' ? room.host : room.guests.get(to);
  if (!target) {
    json(res, 404, { error: 'destinatario-desconectado' });
    return;
  }
  const ok = sseSend(target.res, { type: 'msg', from, data });
  json(res, ok ? 200 : 410, { ok });
}

function handleRooms(res) {
  const list = [];
  for (const room of rooms.values()) {
    if (!room.host || room.host.res.writableEnded) continue;
    list.push({
      code: room.code,
      host: room.host.name || 'Anfitrion',
      players: room.guests.size + 1,
      since: room.since
    });
  }
  list.sort((a, b) => b.since - a.since);
  json(res, 200, list);
}

// --------------------------------------------------------------- ficheros

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(ROOT, rel);
  // Nadie sale de la carpeta del proyecto.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    json(res, 403, { error: 'prohibido' });
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
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

  if (url.pathname === '/lan/ping') {
    return json(res, 200, { ok: true, protocol: 1, port: PORT, addresses: localAddresses() });
  }
  if (url.pathname === '/lan/rooms') return handleRooms(res);
  if (url.pathname === '/lan/events') return handleEvents(req, res, url);
  if (url.pathname === '/lan/send' && req.method === 'POST') return handleSend(req, res);
  if (url.pathname.startsWith('/lan/')) return json(res, 404, { error: 'ruta-desconocida' });

  return serveStatic(req, res, url);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

function localAddresses() {
  const out = [];
  for (const [, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function log(msg) {
  if (process.env.QUIET) return;
  console.log(`  · ${msg}`);
}

export function start(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

// Solo arranca solo si lo ejecutas directamente (los tests lo importan).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  start().then(() => {
    const addrs = localAddresses();
    console.log('\n  ♠️  Hold\'em Club en marcha\n');
    console.log(`  En este ordenador:   http://localhost:${PORT}`);
    if (addrs.length) {
      console.log('\n  Para tus amigos en la misma wifi:');
      for (const a of addrs) console.log(`      http://${a}:${PORT}`);
    } else {
      console.log('\n  (No se ha encontrado ninguna IP de red: ¿estás conectado a la wifi?)');
    }
    console.log('\n  Crea la mesa aquí y pásales el código de 4 letras.');
    console.log('  Ctrl+C para parar.\n');
  });
}

export { server, rooms };
