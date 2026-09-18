// Mesa de blackjack: lleva las fases (apuestas, turnos, banca, pagos), los
// tiempos, los bots y el chat. Misma interfaz que las demas mesas.

import { Emitter } from './table.js';
import { Charla } from './charla.js';
import { BlackjackGame, valorMano } from './blackjack.js';

export const CONFIG_BJ = {
  turnSeconds: 25,
  apuestaSegundos: 15,
  fichasIniciales: 1000,
  apuestaMin: 10,
  apuestaMax: 500,
  mazos: 6,
  speed: 1
};

const RETARDOS = { reparto: 1400, banca: 1200, pagos: 4000, nuevaRonda: 1200, botMin: 600, botMax: 1500 };

export class BlackjackMesa extends Emitter {
  constructor(config = {}) {
    super();
    this.config = { ...CONFIG_BJ, ...config };
    this.game = new BlackjackGame({
      mazos: this.config.mazos,
      fichasIniciales: this.config.fichasIniciales,
      apuestaMin: this.config.apuestaMin,
      apuestaMax: this.config.apuestaMax
    });
    this.running = false;
    this.paused = false;
    this.timers = new Set();
    this.turnTimer = null;
    this.deadline = 0;
    this.messages = [];
    this.pendingEvents = [];
    this.historial = [];
    this.lastProgress = Date.now();
    this.watchdog = null;
    this.charla = new Charla(this);
  }

  delay(k) {
    return Math.max(120, Math.round(RETARDOS[k] / (this.config.speed || 1)));
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  destroy() {
    this.destroyed = true;
    this.running = false;
    if (this.watchdog) clearInterval(this.watchdog);
    this.clearTimers();
  }

  touch() {
    this.lastProgress = Date.now();
  }

  pushEvent(ev) {
    this.pendingEvents.push(ev);
  }

  publish() {
    const eventos = this.game.vaciarEventos().concat(this.pendingEvents);
    this.pendingEvents = [];
    this.comentar(eventos);
    this.emit('update', eventos);
  }

  /** Los bots pican algo cuando pasa algo gordo. Adorno, nada más. */
  comentar(eventos) {
    for (const ev of eventos) {
      if (ev.t === 'pasado') {
        const p = this.game.porId(ev.id);
        if (p && p.esBot) this.charla.decir('pasado', p.id);
      } else if (ev.t === 'pagos' && ev.resultados) {
        const hayBJ = (ev.resultados.detalle || []).some((d) => d.resultado === 'blackjack');
        if (hayBJ) this.charla.decir('blackjack');
        else if (this.game.banca && valorMano(this.game.banca.cartas).total > 21) this.charla.decir('bancaSePasa');
      }
    }
  }

  // --------------------------------------------------------------- jugadores

  join(player) {
    const res = this.game.sentar({ ...player, chips: this.config.fichasIniciales });
    if (!res.ok) return res;
    this.system(`${player.name} se sienta en la mesa`);
    this.pushEvent({ t: 'join', name: player.name });
    this.publish();
    this.maybeStart();
    return res;
  }

  addBot() {
    const usados = new Set(this.game.jugadores.map((p) => p.nombre));
    const nombres = ['Lucia', 'Bruno', 'Nacho', 'Elena', 'Kiko'];
    const caras = ['🤖', '🦊', '🐼', '🐲', '🦁'];
    const i = nombres.findIndex((n) => !usados.has(n));
    return this.join({
      id: 'bot-' + Math.random().toString(36).slice(2, 9),
      name: nombres[i] || 'Bot',
      avatar: caras[i >= 0 ? i : 0],
      isBot: true
    });
  }

  leave(id) {
    const p = this.game.porId(id);
    if (!p) return;
    this.game.salir(id);
    this.system(`${p.nombre} se ha ido`);
    this.publish();
    this.step();
  }

  setAway(id, away) {
    const p = this.game.porId(id);
    if (!p) return;
    p.ausente = !!away;
    this.publish();
    if (!away) this.maybeStart();
    else if (this.game.actual() === p) this.forzar(p);
  }

  rebuy(id, cantidad) {
    const p = this.game.porId(id);
    if (!p) return false;
    p.fichas += cantidad || this.config.fichasIniciales;
    this.system(`${p.nombre} recarga fichas`);
    this.publish();
    this.maybeStart();
    return true;
  }

  // -------------------------------------------------------------------- chat

  chat(id, text) {
    const p = this.game.porId(id);
    const msg = {
      id: Math.random().toString(36).slice(2),
      from: p ? p.nombre : 'Invitado',
      seat: p ? p.seat : -1,
      avatar: p ? p.avatar : '👤',
      text: String(text).slice(0, 240),
      at: Date.now()
    };
    this.messages.push(msg);
    if (this.messages.length > 120) this.messages.shift();
    this.pushEvent({ t: 'chat', msg });
    this.publish();
  }

  system(text) {
    this.messages.push({ id: Math.random().toString(36).slice(2), system: true, text, at: Date.now() });
    if (this.messages.length > 120) this.messages.shift();
  }

  emote(id, emoji, seat = -1) {
    const p = this.game.porId(id);
    if (!p) return;
    this.pushEvent({ t: 'emote', from: p.seat, to: seat, emoji });
    this.publish();
  }

  // ----------------------------------------------------------------- partida

  start() {
    if (this.running) return;
    this.running = true;
    this.touch();
    this.startWatchdog();
    this.maybeStart();
  }

  pause(v) {
    this.paused = !!v;
    this.publish();
    if (!this.paused) this.step();
  }

  resume() {
    this.paused = false;
    this.touch();
    this.step();
    this.maybeStart();
    this.publish();
  }

  maybeStart() {
    if (!this.running || this.paused) return;
    if (this.game.estado !== 'idle' && this.game.estado !== 'pagos') return;
    if (!this.game.elegibles().length) {
      this.publish();
      return;
    }
    this.later(() => this.abrirApuestas(), this.delay('nuevaRonda'));
  }

  abrirApuestas() {
    if (!this.running || this.paused) return;
    if (this.game.estado === 'turnos' || this.game.estado === 'apuestas') return;
    this.touch();
    this.game.abrirApuestas();
    this.deadline = Date.now() + this.config.apuestaSegundos * 1000;
    this.publish();

    // Los bots apuestan enseguida
    for (const p of this.game.elegibles()) {
      if (!p.esBot) continue;
      this.later(() => {
        const monto = Math.min(p.fichas, this.config.apuestaMin * (1 + Math.floor(Math.random() * 4)));
        this.game.apostar(p.id, monto);
        this.publish();
        this.comprobarApuestas();
      }, 300 + Math.random() * 900);
    }

    // Quien no apueste a tiempo se queda fuera de la ronda
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => this.cerrarApuestas(), this.config.apuestaSegundos * 1000);
  }

  comprobarApuestas() {
    if (this.game.estado !== 'apuestas') return;
    if (this.game.apuestasListas()) {
      this.clearTurnTimer();
      this.later(() => this.cerrarApuestas(), 400);
    }
  }

  cerrarApuestas() {
    if (this.game.estado !== 'apuestas') return;
    this.clearTurnTimer();
    const hay = this.game.elegibles().some((p) => p.apuesta > 0);
    if (!hay) {
      // Nadie apuesta: la mesa espera sin bloquearse.
      this.game.estado = 'idle';
      this.publish();
      this.maybeStart();
      return;
    }
    this.touch();
    this.game.repartir();
    this.publish();
    this.later(() => this.step(), this.delay('reparto'));
  }

  step() {
    if (!this.running || this.paused || this.destroyed) return;
    this.touch();
    this.clearTurnTimer();
    const g = this.game;

    if (g.estado === 'banca') {
      this.later(() => {
        g.jugarBanca();
        this.publish();
        this.later(() => {
          const res = g.pagar();
          this.registrar(res);
          this.publish();
          this.maybeStart();
        }, this.delay('banca'));
      }, this.delay('banca'));
      return;
    }
    if (g.estado !== 'turnos') return;

    const p = g.actual();
    if (!p) return;
    if (p.esBot) {
      const pensar = RETARDOS.botMin + Math.random() * (RETARDOS.botMax - RETARDOS.botMin);
      this.later(() => this.jugarBot(p), Math.round(pensar / (this.config.speed || 1)));
      this.publish();
      return;
    }
    if (p.ausente) {
      this.later(() => this.forzar(p), 250);
      return;
    }
    this.deadline = Date.now() + this.config.turnSeconds * 1000;
    this.turnTimer = setTimeout(() => this.forzar(p), this.config.turnSeconds * 1000);
    this.publish();
  }

  /**
   * Estrategia basica de blackjack, la de la tarjeta de casino:
   * mirando la carta vista de la banca.
   */
  jugarBot(p) {
    const g = this.game;
    if (g.actual() !== p) return;
    const o = g.opciones(p.id);
    if (!o.tuTurno) return;

    const mano = g.manoEnJuego();
    const v = valorMano(mano.cartas);
    const cartaBanca = g.banca.cartas[0];
    const vistaBanca = cartaBanca ? (cartaBanca.r === 14 ? 11 : Math.min(10, cartaBanca.r)) : 10;
    const bancaFloja = vistaBanca >= 2 && vistaBanca <= 6;

    if (o.puedeDividir) {
      const par = mano.cartas[0].r;
      if (par === 14 || par === 8) return this.hacer(p, 'dividir');
      if ([2, 3, 6, 7, 9].includes(par) && bancaFloja) return this.hacer(p, 'dividir');
    }
    if (o.puedeDoblar) {
      if (v.total === 11) return this.hacer(p, 'doblar');
      if (v.total === 10 && vistaBanca <= 9) return this.hacer(p, 'doblar');
      if (v.total === 9 && bancaFloja) return this.hacer(p, 'doblar');
      if (v.blanda && v.total >= 13 && v.total <= 18 && vistaBanca >= 4 && vistaBanca <= 6) {
        return this.hacer(p, 'doblar');
      }
    }
    if (v.blanda) {
      if (v.total <= 17) return this.hacer(p, 'pedir');
      if (v.total === 18 && vistaBanca >= 9) return this.hacer(p, 'pedir');
      return this.hacer(p, 'plantarse');
    }
    if (v.total <= 11) return this.hacer(p, 'pedir');
    if (v.total === 12) return this.hacer(p, vistaBanca >= 4 && vistaBanca <= 6 ? 'plantarse' : 'pedir');
    if (v.total <= 16) return this.hacer(p, bancaFloja ? 'plantarse' : 'pedir');
    return this.hacer(p, 'plantarse');
  }

  hacer(p, accion) {
    const g = this.game;
    if (accion === 'pedir') g.pedir(p.id);
    else if (accion === 'plantarse') g.plantarse(p.id);
    else if (accion === 'doblar') g.doblar(p.id);
    else if (accion === 'dividir') g.dividir(p.id);
    this.publish();
    this.step();
  }

  forzar(p) {
    if (this.game.estado === 'apuestas') return this.cerrarApuestas();
    if (this.game.actual() !== p) return;
    this.game.plantarse(p.id);
    this.pushEvent({ t: 'timeout', id: p.id });
    this.publish();
    this.step();
  }

  clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.deadline = 0;
  }

  // ---------------------------------------------------------------- acciones

  act(id, accion, datos = {}) {
    const g = this.game;
    let res;
    switch (accion) {
      case 'apostar': res = g.apostar(id, Number(datos.cantidad) || 0); break;
      case 'pedir': res = g.pedir(id); break;
      case 'plantarse': res = g.plantarse(id); break;
      case 'doblar': res = g.doblar(id); break;
      case 'dividir': res = g.dividir(id); break;
      default: return { ok: false, reason: 'accion-desconocida' };
    }
    if (!res || !res.ok) return res || { ok: false };
    this.touch();
    this.publish();
    if (accion === 'apostar') this.comprobarApuestas();
    else {
      this.clearTurnTimer();
      this.step();
    }
    return res;
  }

  registrar(res) {
    if (!res) return;
    const ganadores = res.detalle.filter((d) => d.resultado === 'gana' || d.resultado === 'blackjack');
    this.historial.unshift({
      ronda: this.game.ronda,
      banca: res.banca,
      ganadores: ganadores.map((d) => {
        const p = this.game.porId(d.id);
        return { nombre: p ? p.nombre : '?', premio: d.premio, blackjack: d.resultado === 'blackjack' };
      }),
      at: Date.now()
    });
    if (this.historial.length > 20) this.historial.pop();
  }

  // --------------------------------------------------------------- vigilante

  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      try {
        this.checkStuck();
      } catch (err) {
        console.error('[bj vigilante]', err);
      }
    }, 3000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  checkStuck() {
    if (!this.running || this.paused || this.destroyed) return;
    const parado = Date.now() - this.lastProgress;
    if (parado < 12000) return;
    const g = this.game;
    this.pushEvent({ t: 'recover' });
    this.system('La mesa se había quedado parada y ha seguido sola.');
    if (g.estado === 'apuestas') this.cerrarApuestas();
    else if (g.estado === 'turnos' && g.actual()) this.forzar(g.actual());
    else if (g.estado === 'banca') this.step();
    else this.abrirApuestas();
  }

  // ---------------------------------------------------------------- snapshot

  snapshotFor(id) {
    return {
      ...this.game.snapshot(id),
      config: {
        turnSeconds: this.config.turnSeconds,
        apuestaSegundos: this.config.apuestaSegundos,
        fichasIniciales: this.config.fichasIniciales
      },
      running: this.running,
      paused: this.paused,
      deadline: this.deadline,
      now: Date.now(),
      messages: this.messages.slice(-40),
      historial: this.historial.slice(0, 10)
    };
  }
}
