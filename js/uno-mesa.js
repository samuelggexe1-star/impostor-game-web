// Mesa de UNO: da ritmo a la partida (turnos, tiempos, bots, chat) y publica
// el estado. Ofrece la misma interfaz que la mesa de poker, asi que el
// servidor y el cliente la manejan igual.

import { Emitter } from './table.js';
import { Charla } from './charla.js';
import { UnoGame, COLORES, esComodin } from './uno.js';

export const CONFIG_UNO = {
  turnSeconds: 30,
  cartasIniciales: 7,
  objetivo: 500,        // puntos para ganar la partida
  speed: 1,
  autoStart: true
};

const RETARDOS = { reparto: 1200, siguienteRonda: 4500, botMin: 700, botMax: 1800 };

export class UnoMesa extends Emitter {
  constructor(config = {}) {
    super();
    this.config = { ...CONFIG_UNO, ...config };
    this.game = new UnoGame({ cartasIniciales: this.config.cartasIniciales });
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

  // -------------------------------------------------------------- utilidades

  delay(clave) {
    return Math.max(120, Math.round(RETARDOS[clave] / (this.config.speed || 1)));
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
      if (ev.t === 'uno') this.charla.decir('unoCantado');
      else if (ev.t === 'pillado') this.charla.decir('pillado');
      else if (ev.t === 'roba' && ev.motivo === 'mas4') this.charla.decir('masCuatro');
      else if (ev.t === 'finRonda') this.charla.decir('ganaRonda', ev.ganador);
    }
  }

  // --------------------------------------------------------------- jugadores

  join(player) {
    const res = this.game.sentar({ ...player });
    if (!res.ok) return res;
    this.pushEvent({ t: 'join', name: player.name });
    this.system(`${player.name} se une a la partida`);
    this.publish();
    this.maybeStart();
    return res;
  }

  addBot(nombre) {
    const usados = new Set(this.game.jugadores.map((p) => p.nombre));
    const nombres = ['Lucia', 'Bruno', 'Nacho', 'Elena', 'Kiko', 'Marta', 'Dani'];
    const caras = ['🤖', '🦊', '🐼', '🐲', '🦁', '👻', '🧙'];
    const libre = nombres.findIndex((n) => !usados.has(n));
    return this.join({
      id: 'bot-' + Math.random().toString(36).slice(2, 9),
      name: nombre || nombres[libre] || 'Bot',
      avatar: caras[libre >= 0 ? libre : 0],
      isBot: true
    });
  }

  leave(id) {
    const p = this.game.porId(id);
    if (!p) return;
    this.game.salir(id);
    this.pushEvent({ t: 'leave', name: p.nombre });
    this.system(`${p.nombre} se ha ido`);
    this.publish();
    this.step();
  }

  setAway(id, away) {
    const p = this.game.porId(id);
    if (!p) return;
    p.ausente = !!away;
    this.publish();
    if (away && this.game.actual() === p) this.forzarTurno(p, 'ausente');
    else if (!away) this.maybeStart();
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

  // ------------------------------------------------------------------ partida

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
    if (this.campeon) return;              // partida acabada: espera a otra
    if (this.game.estado === 'jugando') return;
    if (this.game.jugadores.length < 2) {
      this.publish();
      return;
    }
    const espera = this.game.estado === 'finRonda' ? this.delay('siguienteRonda') : this.delay('reparto');
    this.later(() => this.empezar(), espera);
  }

  empezar() {
    if (!this.running || this.paused || this.game.estado === 'jugando') return;
    this.touch();
    const res = this.game.empezarRonda();
    if (!res.ok) {
      this.publish();
      return;
    }
    this.publish();
    this.later(() => this.step(), this.delay('reparto'));
  }

  /** Decide que toca ahora: turno de humano, de bot, o siguiente ronda. */
  step() {
    if (!this.running || this.paused || this.destroyed) return;
    this.touch();
    this.clearTurnTimer();
    const g = this.game;

    if (g.estado === 'finRonda') {
      this.registrarRonda();
      this.maybeStart();
      return;
    }
    if (g.estado !== 'jugando') return;

    const p = g.actual();
    if (!p) return;

    if (p.esBot) {
      const pensar = RETARDOS.botMin + Math.random() * (RETARDOS.botMax - RETARDOS.botMin);
      this.later(() => this.jugarBot(p), Math.round(pensar / (this.config.speed || 1)));
      this.publish();
      return;
    }
    if (p.ausente) {
      this.later(() => this.forzarTurno(p, 'ausente'), 250);
      return;
    }
    this.empezarReloj(p);
    this.publish();
  }

  /**
   * Bot: juega lo que pueda, con algo de criterio.
   * Prioriza deshacerse de cartas gordas y fastidiar al siguiente si va ganando.
   */
  jugarBot(p) {
    const g = this.game;
    if (g.actual() !== p || g.estado !== 'jugando') return;

    if (g.esperaColor === p.id) {
      g.elegirColor(p.id, this.colorFavorito(p));
      this.publish();
      this.step();
      return;
    }

    const jugables = g.manoJugable(p);
    if (!jugables.length) {
      const r = g.robar(p.id);
      if (r.puedeJugarla) {
        const carta = p.mano.find((c) => c.id === g.robadaJugable);
        if (carta && Math.random() < 0.85) this.jugarCarta(p, carta);
        else g.pasar(p.id);
      }
      this.publish();
      this.step();
      return;
    }

    // Al siguiente le queda poco: toca fastidiar con lo que haya.
    const siguiente = g.jugadores[g.indiceSiguiente()];
    const agobio = siguiente && siguiente.mano.length <= 2;
    const orden = (c) => {
      if (agobio && (c.valor === 'mas4' || c.valor === 'mas2')) return 0;
      if (agobio && c.valor === 'salta') return 1;
      if (c.valor === 'mas4') return 6;          // el +4 se guarda para el final
      if (c.valor === 'comodin') return 5;
      if (['mas2', 'salta', 'sentido'].includes(c.valor)) return 3;
      return 4;
    };
    jugables.sort((a, b) => orden(a) - orden(b) || Number(b.valor || 0) - Number(a.valor || 0));
    this.jugarCarta(p, jugables[0]);
    this.publish();
    this.step();
  }

  jugarCarta(p, carta) {
    const g = this.game;
    // Antes de quedarse con una sola, el bot canta UNO casi siempre.
    if (p.mano.length === 2 && Math.random() < 0.85) g.decirUno(p.id);
    g.jugar(p.id, carta.id, esComodin(carta) ? this.colorFavorito(p) : null);
  }

  colorFavorito(p) {
    const cuenta = {};
    for (const c of p.mano) if (c.color) cuenta[c.color] = (cuenta[c.color] || 0) + 1;
    let mejor = COLORES[Math.floor(Math.random() * COLORES.length)];
    let max = 0;
    for (const [color, n] of Object.entries(cuenta)) {
      if (n > max) {
        max = n;
        mejor = color;
      }
    }
    return mejor;
  }

  empezarReloj(p) {
    const segundos = this.config.turnSeconds;
    this.deadline = Date.now() + segundos * 1000;
    this.turnTimer = setTimeout(() => {
      if (this.game.actual() === p) this.forzarTurno(p, 'tiempo');
    }, segundos * 1000);
  }

  clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.deadline = 0;
  }

  /** Se acabo el tiempo: roba y pasa. */
  forzarTurno(p, motivo) {
    const g = this.game;
    if (g.actual() !== p) return;
    if (g.esperaColor === p.id) g.elegirColor(p.id, this.colorFavorito(p));
    else {
      const r = g.robar(p.id);
      if (r && r.puedeJugarla) g.pasar(p.id);
    }
    this.pushEvent({ t: 'timeout', id: p.id, motivo });
    this.publish();
    this.step();
  }

  // ------------------------------------------------------------------ acciones

  act(id, accion, datos = {}) {
    const g = this.game;
    let res;
    switch (accion) {
      case 'jugar': res = g.jugar(id, datos.carta, datos.color); break;
      case 'color': res = g.elegirColor(id, datos.color); break;
      case 'robar': res = g.robar(id); break;
      case 'pasar': res = g.pasar(id); break;
      case 'uno': res = g.decirUno(id); break;
      case 'pillar': res = g.pillar(id, datos.objetivo); break;
      default: return { ok: false, reason: 'accion-desconocida' };
    }
    if (!res || !res.ok) return res || { ok: false };
    this.touch();
    this.clearTurnTimer();
    this.publish();
    // Si hay que elegir color, esperamos sin pasar turno.
    if (!g.esperaColor) this.step();
    else this.empezarReloj(g.porId(g.esperaColor));
    return res;
  }

  registrarRonda() {
    const g = this.game;
    if (!g.ganador || this.historial[0]?.ronda === g.ronda) return;
    const ganador = g.porId(g.ganador);
    this.historial.unshift({
      ronda: g.ronda,
      ganador: ganador ? ganador.nombre : '?',
      puntos: ganador ? ganador.puntos : 0,
      at: Date.now()
    });
    if (this.historial.length > 20) this.historial.pop();
    if (ganador) this.system(`${ganador.nombre} gana la ronda ${g.ronda}`);
    this.comprobarObjetivo();
  }

  /**
   * La partida se juega a puntos (500 por defecto). Antes se decia en el
   * panel pero no se comprobaba nunca: la partida no acababa jamas.
   */
  comprobarObjetivo() {
    if (this.campeon) return;
    const meta = this.config.objetivo || 500;
    const candidatos = this.game.jugadores.filter((p) => p.puntos >= meta);
    if (!candidatos.length) return;
    // Si empatan a puntos gana quien mas rondas se haya llevado.
    candidatos.sort((a, b) => b.puntos - a.puntos || b.rondasGanadas - a.rondasGanadas);
    const campeon = candidatos[0];
    this.campeon = { id: campeon.id, nombre: campeon.nombre, avatar: campeon.avatar, puntos: campeon.puntos };
    this.game.emitir({ t: 'finPartida', id: campeon.id, nombre: campeon.nombre, puntos: campeon.puntos, objetivo: meta });
    this.system(`${campeon.nombre} gana la partida con ${campeon.puntos} puntos`);
  }

  /** Borrón y cuenta nueva sin salir de la sala. */
  nuevaPartida() {
    this.campeon = null;
    this.historial = [];
    for (const p of this.game.jugadores) {
      p.puntos = 0;
      p.rondasGanadas = 0;
    }
    this.game.ronda = 0;
    this.system('Empieza una partida nueva');
    this.maybeStart();
    this.publish();
    return { ok: true };
  }

  // ----------------------------------------------------------------- vigilante

  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      try {
        this.checkStuck();
      } catch (err) {
        console.error('[uno vigilante]', err);
      }
    }, 3000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  checkStuck() {
    if (!this.running || this.paused || this.destroyed) return;
    const g = this.game;
    const parado = Date.now() - this.lastProgress;
    if (g.estado !== 'jugando' && g.jugadores.length >= 2 && parado > 9000) {
      this.system('La partida se había quedado parada y ha seguido sola.');
      this.pushEvent({ t: 'recover' });
      this.empezar();
      return;
    }
    if (g.estado === 'jugando' && parado > 12000) {
      const p = g.actual();
      if (p) {
        this.system('La partida se había quedado parada y ha seguido sola.');
        this.pushEvent({ t: 'recover' });
        this.forzarTurno(p, 'atasco');
      }
    }
  }

  // ------------------------------------------------------------------ snapshot

  snapshotFor(id) {
    const snap = this.game.snapshot(id);
    return {
      ...snap,
      config: { turnSeconds: this.config.turnSeconds, objetivo: this.config.objetivo },
      running: this.running,
      paused: this.paused,
      deadline: this.deadline,
      now: Date.now(),
      campeon: this.campeon || null,
      messages: this.messages.slice(-40),
      historial: this.historial.slice(0, 10)
    };
  }
}
