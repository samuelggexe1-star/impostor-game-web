// Conexion con el servidor de partidas (server.js).
// El servidor reparte; aqui solo mandamos acciones y pintamos lo que llega.
// Transporte: SSE para recibir y POST para enviar, o sea HTTPS del normal.
// Es lo que atraviesa wifis con restricciones (colegios, oficinas, datos moviles),
// donde WebRTC suele estar bloqueado.

const STORE_KEY = 'holdem-club/servidor';

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
        console.error('[relay]', evt, err);
      }
    }
  }
}

/** Direccion del servidor: la propia pagina, o la que hayas configurado. */
export function relayBase() {
  const fromUrl = new URLSearchParams(location.search).get('servidor');
  if (fromUrl) {
    try {
      localStorage.setItem(STORE_KEY, fromUrl);
    } catch (_) {}
    return fromUrl.replace(/\/$/, '');
  }
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return saved.replace(/\/$/, '');
  } catch (_) {}
  return '';
}

export function setRelayBase(url) {
  const clean = (url || '').trim().replace(/\/$/, '');
  try {
    if (clean) localStorage.setItem(STORE_KEY, clean);
    else localStorage.removeItem(STORE_KEY);
  } catch (_) {}
  return clean;
}

function api(pathname) {
  const base = relayBase();
  return (base ? base : '') + pathname;
}

/** ¿Hay servidor de partidas? Devuelve su informacion o null. */
export async function relayInfo() {
  try {
    const res = await fetch(api('/api/ping'), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok) return null;
    return { ...data, base: relayBase() || location.origin };
  } catch (_) {
    return null;
  }
}

/** Mesas abiertas en el servidor. */
export async function relayRooms() {
  try {
    const res = await fetch(api('/api/rooms'), { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch (_) {
    return [];
  }
}

/** Crea una mesa del juego indicado. El servidor devuelve el codigo de 4 letras. */
export async function createRelayRoom({ game = 'holdem', owner, config, bots, botStyle }) {
  const res = await fetch(api('/api/room'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game, owner, config, bots, botStyle })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'no-se-pudo-crear');
  }
  return res.json();
}

/** Conexion viva con una mesa del servidor. */
export class RelayLink extends Emitter {
  constructor(code, { playerId, name, avatar }) {
    super();
    this.code = code;
    this.playerId = playerId;
    this.name = name;
    this.avatar = avatar;
    this.open = false;
    this.source = null;
    this.closedByUs = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const qs = new URLSearchParams({
        room: this.code,
        peer: this.playerId,
        name: this.name || '',
        avatar: this.avatar || ''
      });
      const src = new EventSource(api('/api/events') + '?' + qs.toString());
      this.source = src;
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          src.close();
          reject(new Error('timeout'));
        }
      }, 12000);

      src.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (_) {
          return;
        }

        if (msg.type === 'accepted') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.open = true;
            resolve(msg);
          }
          return;
        }
        if (msg.type === 'error' || msg.type === 'rejected') {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            src.close();
            reject(new Error(msg.reason || 'error'));
          }
          return;
        }
        if (msg.type === 'closed') {
          this.open = false;
          this.fire('closed', msg.reason);
          src.close();
          return;
        }
        this.fire('data', msg);
      };

      src.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          src.close();
          reject(new Error('sin-servidor'));
        } else {
          // EventSource reintenta solo; avisamos mientras tanto.
          this.fire('offline');
        }
      };

      src.onopen = () => {
        if (settled) this.fire('online');
      };
    });
  }

  send(data) {
    if (!this.open || this.closedByUs) return;
    fetch(api('/api/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: this.code, from: this.playerId, data }),
      keepalive: true
    }).catch(() => {});
  }

  close() {
    this.closedByUs = true;
    this.open = false;
    if (this.source) this.source.close();
  }
}
