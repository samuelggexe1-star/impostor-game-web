// Mesa de alto o bajo: cuenta atras por carta, bots, chat y reparto de estado.
// Como todos apuestan a la vez, la mesa solo controla el reloj.

import { Emitter } from './table.js';
import { Charla } from './charla.js';
import { AltoBajoGame } from './altobajo.js';

export const CONFIG_AB = {
  segundosPorCarta: 10,
  vidas: 3,
  objetivo: 30,          // puntos para ganar la partida entera
  speed: 1
};

const RETARDOS = { revelar: 2200, nuevaRonda: 4200, entreCartas: 1400 };

export class AltoBajoMesa extends Emitter {
  constructor(config = {}) {
    super();
    this.config = { ...CONFIG_AB, ...config };
    this.game = new AltoBajoGame({ vidas: this.config.vidas });
    this.running = false;
    this.paused = false;
    this.timers = new Set();
    this.reloj = null;
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
    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = null;
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
      if (ev.t !== 'revela' || !ev.detalle) continue;
      const enRacha = ev.detalle.find((d) => d.resultado === 'acierta' && d.racha >= 4);
      if (enRacha) { this.charla.decir('racha'); continue; }
      const bots = new Set(this.charla.bots().map((b) => b.id));
      const acierta = ev.detalle.find((d) => d.resultado === 'acierta' && bots.has(d.id));
      const falla = ev.detalle.find((d) => d.resultado === 'falla' && bots.has(d.id));
      if (acierta) this.charla.decir('acierto', acierta.id);
      else if (falla) this.charla.decir('fallo', falla.id);
    }
  }

  // --------------------------------------------------------------- jugadores

  join(player) {
    const res = this.game.sentar({ ...player });
    if (!res.ok) return res;
    this.system(`${player.name} entra a jugar`);
    this.pushEvent({ t: 'join', name: player.name });
    this.publish();
    this.maybeStart();
    return res;
  }

  addBot() {
    const usados = new Set(this.game.jugadores.map((p) => p.nombre));
    const nombres = ['Lucia', 'Bruno', 'Nacho', 'Elena', 'Kiko', 'Marta'];
    const caras = ['🤖', '🦊', '🐼', '🐲', '🦁', '👻'];
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
  }

  setAway(id, away) {
    const p = this.game.porId(id);
    if (!p) return;
    p.ausente = !!away;
    this.publish();
    if (!away) this.maybeStart();
  }

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
    if (!this.paused) this.abrirCarta();
  }

  resume() {
    this.paused = false;
    this.touch();
    if (this.game.estado === 'apuestas') this.abrirCarta();
    else this.maybeStart();
    this.publish();
  }

  maybeStart() {
    if (!this.running || this.paused) return;
    if (this.campeon) return;              // partida acabada: espera a otra
    if (this.game.estado === 'apuestas') return;
    if (!this.game.jugadores.length) {
      this.publish();
      return;
    }
    const espera = this.game.estado === 'finRonda' ? this.delay('nuevaRonda') : this.delay('entreCartas');
    this.later(() => {
      if (this.game.estado === 'apuestas') return;
      this.game.nuevaRonda();
      this.registrarRonda();
      this.publish();
      this.abrirCarta();
    }, espera);
  }

  /** Abre el plazo para apostar a la carta siguiente. */
  abrirCarta() {
    if (!this.running || this.paused || this.game.estado !== 'apuestas') return;
    this.touch();
    this.deadline = Date.now() + this.config.segundosPorCarta * 1000;
    this.publish();

    for (const p of this.game.vivos()) {
      if (!p.esBot || p.apuesta) continue;
      this.later(() => this.apostarBot(p), 600 + Math.random() * 2500);
    }

    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = setTimeout(() => this.revelar(), this.config.segundosPorCarta * 1000);
  }

  /**
   * Los bots apuestan con criterio: con una carta baja en mesa casi siempre
   * sube, y al reves. Con cartas del medio, se lo juegan.
   */
  apostarBot(p) {
    const g = this.game;
    if (g.estado !== 'apuestas' || !p.vivo || p.apuesta) return;
    // Cuentan las cartas que quedan, como haria cualquiera mirando el
    // historial, pero se despistan de vez en cuando para no ser perfectos.
    const pr = g.probabilidades();
    const r = g.carta ? g.carta.r : 8;
    const probSube = pr ? pr.alto / Math.max(1e-6, pr.alto + pr.bajo) : (14 - r) / 12;
    const acierto = 0.82;                     // cuanto se fian de la logica
    const logico = probSube > 0.5 ? 'alto' : 'bajo';
    const elige = Math.random() < acierto ? logico : (logico === 'alto' ? 'bajo' : 'alto');
    g.apostar(p.id, elige);
    this.publish();
    this.comprobar();
  }

  comprobar() {
    if (this.game.estado !== 'apuestas') return;
    if (this.game.todosListos()) {
      if (this.reloj) clearTimeout(this.reloj);
      this.later(() => this.revelar(), 500);
    }
  }

  revelar() {
    if (this.game.estado !== 'apuestas') return;
    if (this.reloj) clearTimeout(this.reloj);
    this.touch();
    this.game.revelar();
    this.deadline = 0;
    this.publish();

    if (this.game.estado === 'finRonda') {
      this.registrarRonda();
      this.maybeStart();
    } else {
      this.later(() => this.abrirCarta(), this.delay('revelar'));
    }
  }

  act(id, accion, datos = {}) {
    if (accion !== 'apostar') return { ok: false, reason: 'accion-desconocida' };
    const res = this.game.apostar(id, datos.apuesta);
    if (!res.ok) return res;
    this.touch();
    this.publish();
    this.comprobar();
    return res;
  }

  registrarRonda() {
    const g = this.game;
    if (g.estado !== 'finRonda') return;
    if (this.historial[0] && this.historial[0].ronda === g.ronda) return;
    const vivos = g.vivos();
    const ganador = vivos[0];
    this.historial.unshift({
      ronda: g.ronda,
      cartas: g.mano,
      ganador: ganador ? ganador.nombre : 'nadie',
      at: Date.now()
    });
    if (this.historial.length > 20) this.historial.pop();
    if (ganador) this.system(`${ganador.nombre} gana la ronda ${g.ronda}`);
    this.comprobarObjetivo();
  }

  /**
   * Las rondas sueltas no acababan nunca en nada. Ahora la partida se juega
   * a puntos: quien llega al objetivo se lleva el trofeo.
   */
  comprobarObjetivo() {
    if (this.campeon) return;
    const meta = this.config.objetivo || 30;
    const candidatos = this.game.jugadores.filter((p) => p.puntos >= meta);
    if (!candidatos.length) return;
    candidatos.sort((a, b) => b.puntos - a.puntos || b.rondasGanadas - a.rondasGanadas);
    const c = candidatos[0];
    this.campeon = { id: c.id, nombre: c.nombre, avatar: c.avatar, puntos: c.puntos };
    this.pushEvent({ t: 'finPartida', id: c.id, nombre: c.nombre, puntos: c.puntos, objetivo: meta });
    this.system(`${c.nombre} gana la partida con ${c.puntos} puntos`);
  }

  /** Borrón y cuenta nueva sin salir de la sala. */
  nuevaPartida() {
    this.campeon = null;
    this.historial = [];
    for (const p of this.game.jugadores) {
      p.puntos = 0;
      p.rondasGanadas = 0;
      p.mejorRacha = 0;
    }
    this.game.ronda = 0;
    this.system('Empieza una partida nueva');
    this.maybeStart();
    this.publish();
    return { ok: true };
  }

  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      try {
        if (!this.running || this.paused || this.destroyed) return;
        if (Date.now() - this.lastProgress < 14000) return;
        this.pushEvent({ t: 'recover' });
        this.system('La partida se había quedado parada y ha seguido sola.');
        if (this.game.estado === 'apuestas') this.revelar();
        else this.maybeStart();
      } catch (err) {
        console.error('[ab vigilante]', err);
      }
    }, 3000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  snapshotFor(id) {
    return {
      ...this.game.snapshot(id),
      config: { segundosPorCarta: this.config.segundosPorCarta, objetivo: this.config.objetivo },
      campeon: this.campeon || null,
      running: this.running,
      paused: this.paused,
      deadline: this.deadline,
      now: Date.now(),
      messages: this.messages.slice(-40),
      historial: this.historial.slice(0, 10)
    };
  }
}
