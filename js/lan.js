// Transporte para jugar en la wifi local, contra el servidor incluido (server.js).
// Imita la interfaz de una conexion de PeerJS, asi que el protocolo de net.js
// funciona igual venga por WebRTC o por la centralita local.

const PING_MS = 4000;

class Emitter {
  constructor() {
    this._h = {};
  }
  on(evt, fn) {
    (this._h[evt] = this._h[evt] || []).push(fn);
  }
  fire(evt, ...args) {
    for (const fn of this._h[evt] || []) {
      try {
        fn(...args);
      } catch (err) {
        console.error('[lan]', evt, err);
      }
    }
  }
}

/** Una conexion con un invitado, vista desde el anfitrion. */
class LanConn extends Emitter {
  constructor(peerId, sendFn, meta = {}) {
    super();
    this.peer = peerId;
    this.metadata = meta;
    this.open = true;
    this._send = sendFn;
  }
  send(msg) {
    if (this.open) this._send(this.peer, msg);
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.fire('close');
  }
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.ok;
}

/**
 * ¿Hay servidor local sirviendo esta pagina?
 * @returns {Promise<null|{port:number, addresses:string[]}>}
 */
export async function lanAvailable() {
  try {
    const res = await fetch('lan/ping', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? { port: data.port, addresses: data.addresses || [] } : null;
  } catch (_) {
    return null;
  }
}

/** Mesas abiertas ahora mismo en esta red. */
export async function lanRooms() {
  try {
    const res = await fetch('lan/rooms', { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch (_) {
    return [];
  }
}

/** Lado anfitrion: escucha invitados y entrega conexiones ya listas. */
export class LanHostLink {
  constructor(code, { peerId, name, onConnection }) {
    this.code = code;
    this.peerId = peerId;
    this.name = name;
    this.onConnection = onConnection;
    this.conns = new Map();
    this.source = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const qs = new URLSearchParams({ room: this.code, peer: this.peerId, role: 'host', name: this.name || '' });
      const src = new EventSource('lan/events?' + qs.toString());
      this.source = src;
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          src.close();
          reject(new Error('timeout'));
        }
      }, 8000);

      src.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (_) {
          return;
        }
        if (msg.type === 'ready') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(this.code);
          }
          return;
        }
        if (msg.type === 'error') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            src.close();
            reject(new Error(msg.reason || 'error'));
          }
          return;
        }
        if (msg.type === 'peer-join') {
          const conn = new LanConn(msg.peer, (to, payload) =>
            post('lan/send', { room: this.code, from: 'host', to, data: payload })
          , { playerId: msg.peer });
          this.conns.set(msg.peer, conn);
          this.onConnection(conn);
          // El protocolo espera un 'open' despues de registrar los manejadores.
          setTimeout(() => conn.fire('open'), 0);
          return;
        }
        if (msg.type === 'peer-leave') {
          const conn = this.conns.get(msg.peer);
          if (conn) {
            this.conns.delete(msg.peer);
            conn.close();
          }
          return;
        }
        if (msg.type === 'msg') {
          const conn = this.conns.get(msg.from);
          if (conn) conn.fire('data', msg.data);
        }
      };

      src.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          src.close();
          reject(new Error('sin-servidor'));
        }
      };
    });
  }

  close() {
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    if (this.source) this.source.close();
  }
}

/** Lado invitado: habla solo con el anfitrion, a traves de la centralita. */
export class LanGuestLink extends Emitter {
  constructor(code, { peerId, name }) {
    super();
    this.code = code;
    this.peerId = peerId;
    this.name = name;
    this.open = false;
    this.source = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const qs = new URLSearchParams({ room: this.code, peer: this.peerId, role: 'guest', name: this.name || '' });
      const src = new EventSource('lan/events?' + qs.toString());
      this.source = src;
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          src.close();
          reject(new Error('timeout'));
        }
      }, 8000);

      src.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (_) {
          return;
        }
        if (msg.type === 'ready') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.open = true;
            resolve();
          }
          return;
        }
        if (msg.type === 'error') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            src.close();
            reject(new Error(msg.reason || 'error'));
          }
          return;
        }
        if (msg.type === 'host-gone') {
          this.open = false;
          this.fire('close');
          src.close();
          return;
        }
        if (msg.type === 'msg') this.fire('data', msg.data);
      };

      src.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          src.close();
          reject(new Error('sin-servidor'));
        } else if (this.open) {
          // EventSource reintenta solo; avisamos por si tarda.
          this.fire('reconnecting');
        }
      };
    });
  }

  send(msg) {
    if (!this.open) return;
    post('lan/send', { room: this.code, from: this.peerId, to: 'host', data: msg });
  }

  close() {
    this.open = false;
    if (this.source) this.source.close();
  }
}

export { PING_MS };
