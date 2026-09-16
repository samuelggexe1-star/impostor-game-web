// Controlador de mesa: da ritmo al motor (tiempos, turnos, bots, niveles de ciegas)
// y publica el estado. Es lo que ejecuta el anfitrion de la sala.

import { Game, STAGE } from './engine.js';
import { decide as botDecide, STYLES } from './bots.js';

export class Emitter {
  constructor() {
    this._h = {};
  }
  on(evt, fn) {
    (this._h[evt] = this._h[evt] || []).push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    this._h[evt] = (this._h[evt] || []).filter((f) => f !== fn);
  }
  emit(evt, ...args) {
    for (const fn of this._h[evt] || []) {
      try {
        fn(...args);
      } catch (err) {
        console.error('[emitter]', evt, err);
      }
    }
  }
}

export const DEFAULT_CONFIG = {
  sb: 10,
  bb: 20,
  ante: 0,
  startingChips: 2000,
  maxSeats: 9,
  turnSeconds: 30,
  timeBankSeconds: 30,
  speed: 1,              // multiplicador de las pausas de animacion
  mode: 'cash',          // 'cash' | 'torneo'
  levelMinutes: 8,
  levels: [
    { sb: 10, bb: 20, ante: 0 },
    { sb: 15, bb: 30, ante: 0 },
    { sb: 25, bb: 50, ante: 5 },
    { sb: 50, bb: 100, ante: 10 },
    { sb: 75, bb: 150, ante: 15 },
    { sb: 100, bb: 200, ante: 25 },
    { sb: 150, bb: 300, ante: 40 },
    { sb: 250, bb: 500, ante: 50 },
    { sb: 400, bb: 800, ante: 100 },
    { sb: 600, bb: 1200, ante: 150 }
  ],
  allowRebuy: true,
  autoStart: true
};

const BASE_DELAYS = {
  deal: 1500,
  street: 1000,
  showdown: 1600,
  uncontested: 900,
  payout: 4200,
  nextHand: 900,
  botMin: 650,
  botMax: 1900
};

export class Table extends Emitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.game = new Game({
      maxSeats: this.config.maxSeats,
      sb: this.config.sb,
      bb: this.config.bb,
      ante: this.config.ante
    });
    this.running = false;
    this.timers = new Set();
    this.turnTimer = null;
    this.deadline = 0;
    this.pendingEvents = [];
    this.history = [];
    this.messages = [];
    this.level = 0;
    this.levelStartedAt = 0;
    this.lastResultAt = 0;
    this.paused = false;
    this.lastProgress = Date.now();
    this.watchdog = null;
  }

  // -------------------------------------------------------------- utilidades

  delay(key) {
    return Math.max(120, Math.round(BASE_DELAYS[key] / (this.config.speed || 1)));
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
    this.watchdog = null;
    this.clearTimers();
  }

  pushEvent(ev) {
    this.pendingEvents.push(ev);
  }

  /** Publica estado + eventos acumulados a los suscriptores (UI y red). */
  publish() {
    const events = this.game.drainEvents().concat(this.pendingEvents);
    this.pendingEvents = [];
    this.emit('update', events);
  }

  // -------------------------------------------------------------- jugadores

  join(player) {
    const existing = this.game.playerById(player.id);
    if (existing) {
      // Al volver hay que devolverle al reparto: si solo quitamos 'away' y
      // dejamos 'sittingOut', se queda mirando el resto de la partida.
      existing.away = false;
      existing.sittingOut = false;
      existing.name = player.name || existing.name;
      existing.avatar = player.avatar || existing.avatar;
      this.pushEvent({ t: 'rejoin', seat: existing.seat, name: existing.name });
      this.publish();
      return { ok: true, seat: existing.seat, rejoined: true };
    }
    const res = this.game.sit(
      {
        ...player,
        chips: player.chips || this.config.startingChips
      },
      player.seat != null ? player.seat : -1
    );
    if (!res.ok) return res;
    const p = this.game.seats[res.seat];
    // Quien entra con la mano empezada espera a la siguiente.
    p.status = this.game.inHand() ? 'out' : 'waiting';
    this.pushEvent({ t: 'join', seat: res.seat, name: p.name, avatar: p.avatar });
    this.system(`${p.name} se sienta en la mesa`);
    this.publish();
    this.maybeStart();
    return res;
  }

  addBot(style) {
    const styles = Object.keys(STYLES);
    const s = style || styles[Math.floor(Math.random() * styles.length)];
    const used = new Set(this.game.seated().map((p) => p.name));
    const names = ['Lucia', 'Bruno', 'Nacho', 'Elena', 'Kiko', 'Marta', 'Dani', 'Vera', 'Pablo', 'Sara', 'Toni', 'Ines'];
    const name = names.find((n) => !used.has(n)) || 'Bot' + Math.floor(Math.random() * 99);
    return this.join({
      id: 'bot-' + Math.random().toString(36).slice(2, 9),
      name,
      avatar: STYLES[s].avatar,
      isBot: true,
      botStyle: s,
      chips: this.config.startingChips
    });
  }

  leave(id) {
    const p = this.game.playerById(id);
    if (!p) return;
    const name = p.name;
    const wasToAct = this.game.toAct === p.seat;
    this.game.leave(id);
    this.pushEvent({ t: 'leave', name });
    this.system(`${name} ha salido de la mesa`);
    this.publish();
    if (wasToAct) this.step();
    else if (this.game.inHand() && this.game.pending) this.step();
  }

  setAway(id, away) {
    const p = this.game.playerById(id);
    if (!p) return;
    p.away = !!away;
    p.sittingOut = !!away;
    this.publish();
    if (p.away) {
      // Si se marcha cuando le tocaba hablar, resolvemos su turno ya en vez de
      // tener a los demas esperando a que se agote el reloj.
      if (this.game.toAct === p.seat) this.forceAction(p, 'ausente');
    } else {
      // Al volver puede que la mesa estuviera parada por falta de jugadores.
      this.maybeStart();
    }
  }

  rebuy(id, amount) {
    const p = this.game.playerById(id);
    if (!p || !this.config.allowRebuy) return false;
    const amt = amount || this.config.startingChips;
    p.chips += amt;
    p.buyIn += amt;
    if (p.status === 'out' && !this.game.inHand()) p.status = 'waiting';
    this.pushEvent({ t: 'rebuy', seat: p.seat, amount: amt });
    this.system(`${p.name} recarga ${amt} fichas`);
    this.publish();
    this.maybeStart();
    return true;
  }

  // -------------------------------------------------------------- chat

  chat(id, text) {
    const p = this.game.playerById(id);
    const msg = {
      id: Math.random().toString(36).slice(2),
      from: p ? p.name : 'Invitado',
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
    const msg = { id: Math.random().toString(36).slice(2), system: true, text, at: Date.now() };
    this.messages.push(msg);
    if (this.messages.length > 120) this.messages.shift();
  }

  emote(id, emoji, targetSeat = -1) {
    const p = this.game.playerById(id);
    if (!p) return;
    this.pushEvent({ t: 'emote', from: p.seat, to: targetSeat, emoji });
    this.publish();
  }

  // -------------------------------------------------------------- partida

  start() {
    if (this.running) return;
    this.running = true;
    this.levelStartedAt = Date.now();
    this.touch();
    this.startWatchdog();
    this.maybeStart();
  }

  /** Marca que la partida ha avanzado. Lo usa el vigilante para detectar atascos. */
  touch() {
    this.lastProgress = Date.now();
  }

  /**
   * Una mesa parada arruina la partida a todos, y basta un temporizador perdido
   * (pestaña dormida, error puntual) para que pase. Cada pocos segundos miramos
   * si la mesa deberia estar avanzando y no lo hace, y la empujamos.
   */
  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      try {
        this.checkStuck();
      } catch (err) {
        console.error('[vigilante]', err);
      }
    }, 3000);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  checkStuck() {
    if (!this.running || this.paused || this.destroyed) return;
    const g = this.game;
    const parado = Date.now() - (this.lastProgress || 0);

    // a) No hay mano en curso pero hay gente de sobra para jugar.
    if (!g.inHand() && g.eligibleForHand().length >= 2 && parado > 8000) {
      this.recover('la mesa llevaba parada, empezamos mano');
      this.beginHand();
      return;
    }
    // b) Mano viva, nadie tiene el turno y no hay nada pendiente.
    if (g.inHand() && g.toAct < 0 && !g.pending && parado > 8000) {
      this.recover('nadie tenía el turno');
      this.step();
      return;
    }
    // c) Le toca a alguien pero su reloj venció hace rato: se perdió el aviso.
    if (g.toAct >= 0 && this.deadline && Date.now() > this.deadline + 6000) {
      const p = g.seats[g.toAct];
      if (p) {
        this.recover('se perdió el reloj de un turno');
        this.forceAction(p, 'tiempo');
      }
    }
  }

  /**
   * Recoloca una mano que se quedo sin turno ni paso pendiente.
   * @returns {boolean} true si la mano vuelve a ser jugable.
   */
  repair() {
    const g = this.game;
    if (!g.inHand()) return false;
    if (g.pending || g.toAct >= 0) return true;

    if (g.contenders().length <= 1) {
      g.collectBets();
      g.pending = { type: 'uncontested' };
      return true;
    }
    if (g.bettingClosed()) {
      g.closeStreet();
      return true;
    }
    const siguiente = g.nextToAct(g.button);
    if (siguiente >= 0) {
      g.toAct = siguiente;
      return true;
    }
    g.closeStreet();
    return true;
  }

  recover(motivo) {
    this.pushEvent({ t: 'recover', motivo });
    this.system('La mesa se había quedado parada y se ha reanudado sola.');
    console.warn('[vigilante] ' + motivo);
  }

  /** Empujon manual, por si el anfitrion ve la mesa parada. */
  resume() {
    this.paused = false;
    this.touch();
    if (this.game.inHand()) this.step();
    else this.maybeStart();
    this.publish();
  }

  pause(v) {
    this.paused = !!v;
    this.publish();
    if (!this.paused) this.step();
  }

  maybeStart() {
    if (!this.running || this.paused) return;
    if (this.game.inHand()) return;
    if (this.game.eligibleForHand().length < 2) {
      this.publish();
      return;
    }
    this.later(() => this.beginHand(), this.delay('nextHand'));
  }

  beginHand() {
    if (!this.running || this.paused || this.game.inHand()) return;
    this.applyLevel();
    for (const p of this.game.seated()) {
      if (p.status === 'waiting') p.status = 'active';
      p.timeBank = this.config.timeBankSeconds;
    }
    this.touch();
    const res = this.game.startHand();
    if (!res.ok) {
      this.publish();
      return;
    }
    this.publish();
    this.later(() => this.step(), this.delay('deal'));
  }

  applyLevel() {
    if (this.config.mode !== 'torneo') return;
    const mins = this.config.levelMinutes;
    const elapsed = (Date.now() - this.levelStartedAt) / 60000;
    const target = Math.min(this.config.levels.length - 1, Math.floor(elapsed / mins));
    if (target !== this.level) {
      this.level = target;
      const lv = this.config.levels[this.level];
      this.game.sb = lv.sb;
      this.game.bb = lv.bb;
      this.game.ante = lv.ante;
      this.pushEvent({ t: 'levelUp', level: this.level + 1, ...lv });
      this.system(`Nivel ${this.level + 1}: ciegas ${lv.sb}/${lv.bb}${lv.ante ? ` (ante ${lv.ante})` : ''}`);
    }
  }

  /** Motor de estados: decide que toca hacer ahora (avanzar calle, pedir accion, repartir). */
  step() {
    if (!this.running || this.paused || this.destroyed) return;
    this.touch();
    this.clearTurnTimer();
    const g = this.game;

    if (g.pending) {
      const kind = g.pending.type;
      const wait =
        kind === 'street' ? this.delay('street')
        : kind === 'showdown' ? this.delay('showdown')
        : kind === 'uncontested' ? this.delay('uncontested')
        : kind === 'payout' ? this.delay('showdown')
        : 300;
      this.later(() => {
        const out = g.advance();
        this.publish();
        if (out && out.type === 'payout') this.onHandComplete();
        else this.step();
      }, wait);
      return;
    }

    if (g.stage === STAGE.HAND_END || g.stage === STAGE.IDLE) {
      this.maybeStart();
      return;
    }

    if (g.toAct < 0) {
      // Estado imposible: mano viva, nadie con el turno y nada pendiente.
      // En vez de quedarnos mirando, reconstruimos a quien le toca.
      if (!this._reparando && this.repair()) {
        this._reparando = true;
        this.step();
        this._reparando = false;
        return;
      }
      this.publish();
      return;
    }

    const p = g.seats[g.toAct];
    if (!p) return;

    if (p.isBot) {
      const think = BASE_DELAYS.botMin + Math.random() * (BASE_DELAYS.botMax - BASE_DELAYS.botMin);
      this.later(() => this.playBot(p), Math.round(think / (this.config.speed || 1)));
      this.publish();
      return;
    }

    if (p.away) {
      this.later(() => this.forceAction(p, 'ausente'), 250);
      return;
    }

    this.startTurnTimer(p);
    this.publish();
  }

  playBot(p) {
    if (!this.running || this.game.toAct !== p.seat) return;
    const view = this.game.snapshot(p.id);
    const legal = this.game.legalActions(p.id);
    if (!legal.yourTurn) return;
    let move;
    try {
      move = botDecide(view, legal, p.botStyle);
    } catch (err) {
      console.error('[bot]', err);
      move = { action: legal.canCheck ? 'check' : 'fold' };
    }
    const res = this.game.act(p.id, move.action, move.amount);
    if (!res.ok) this.game.act(p.id, legal.canCheck ? 'check' : 'fold');
    this.publish();
    this.step();
  }

  startTurnTimer(p) {
    const secs = this.config.turnSeconds + (p.timeBank > 0 ? 0 : 0);
    this.deadline = Date.now() + secs * 1000;
    this.turnTimer = setTimeout(() => {
      if (this.game.toAct !== p.seat) return;
      if (p.timeBank > 0) {
        // Primer aviso: se le da el banco de tiempo antes de actuar por el.
        const extra = Math.min(p.timeBank, this.config.timeBankSeconds);
        p.timeBank -= extra;
        this.deadline = Date.now() + extra * 1000;
        this.pushEvent({ t: 'timebank', seat: p.seat, seconds: extra });
        this.publish();
        this.turnTimer = setTimeout(() => this.forceAction(p, 'tiempo'), extra * 1000);
        return;
      }
      this.forceAction(p, 'tiempo');
    }, secs * 1000);
  }

  clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.deadline = 0;
  }

  forceAction(p, reason) {
    if (this.game.toAct !== p.seat) return;
    const legal = this.game.legalActions(p.id);
    const action = legal.canCheck ? 'check' : 'fold';
    this.game.act(p.id, action);
    this.pushEvent({ t: 'timeout', seat: p.seat, reason, action });
    this.publish();
    this.step();
  }

  act(id, action, amount) {
    const g = this.game;
    const p = g.playerById(id);
    if (!p || g.toAct !== p.seat) return { ok: false, reason: 'not-your-turn' };
    const res = g.act(id, action, amount);
    if (!res.ok) return res;
    this.touch();
    this.clearTurnTimer();
    this.publish();
    this.step();
    return res;
  }

  onHandComplete() {
    const g = this.game;
    const results = g.results;
    if (results) {
      this.history.unshift({
        hand: g.handNumber,
        at: Date.now(),
        board: results.board.slice(),
        total: results.total,
        blinds: { sb: g.sb, bb: g.bb },
        pots: results.pots.map((pot) => ({
          label: pot.label,
          amount: pot.amount,
          winners: pot.winners.map((w) => ({
            name: g.seats[w.seat] ? g.seats[w.seat].name : '?',
            amount: w.amount,
            hand: w.eval ? w.eval.name : null
          }))
        })),
        players: g.seated().map((p) => ({
          name: p.name,
          hole: p.revealed ? p.hole.slice() : null,
          committed: p.committed,
          won: p.wonAmount || 0
        }))
      });
      if (this.history.length > 50) this.history.pop();
      for (const pot of results.pots) {
        for (const w of pot.winners) {
          const win = g.seats[w.seat];
          if (win) this.system(`${win.name} gana ${w.amount}${w.eval ? ` con ${w.eval.name}` : ''}`);
        }
      }
    }
    this.lastResultAt = Date.now();
    this.publish();
    this.later(() => {
      this.checkBustouts();
      this.maybeStart();
    }, this.delay('payout'));
  }

  checkBustouts() {
    for (const p of this.game.seated()) {
      if (p.chips <= 0 && !p.isBot) this.pushEvent({ t: 'busted', seat: p.seat, name: p.name });
      if (p.chips <= 0 && p.isBot && this.config.allowRebuy) {
        p.chips = this.config.startingChips;
        p.status = 'waiting';
        this.system(`${p.name} recarga y sigue jugando`);
      }
    }
  }

  // -------------------------------------------------------------- snapshot

  snapshotFor(id) {
    const snap = this.game.snapshot(id);
    const lv = this.config.levels[this.level] || null;
    return {
      ...snap,
      config: {
        mode: this.config.mode,
        turnSeconds: this.config.turnSeconds,
        startingChips: this.config.startingChips,
        allowRebuy: this.config.allowRebuy
      },
      running: this.running,
      paused: this.paused,
      deadline: this.deadline,
      now: Date.now(),
      level: this.config.mode === 'torneo'
        ? {
            index: this.level + 1,
            sb: lv ? lv.sb : this.game.sb,
            bb: lv ? lv.bb : this.game.bb,
            ante: lv ? lv.ante : this.game.ante,
            endsAt: this.levelStartedAt + (this.level + 1) * this.config.levelMinutes * 60000
          }
        : null,
      messages: this.messages.slice(-40),
      history: this.history.slice(0, 12)
    };
  }
}
