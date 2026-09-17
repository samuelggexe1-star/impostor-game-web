// Motor de Texas Hold'em No Limit.
// Logica pura y determinista: no toca el DOM ni la red. La UI y el host lo consumen.

import { makeDeck, shuffle, secureRng } from './cards.js';
import { evaluate } from './evaluator.js';

export const STAGE = {
  IDLE: 'idle',
  PREFLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown',
  HAND_END: 'handEnd'
};

const STREET_ORDER = [STAGE.PREFLOP, STAGE.FLOP, STAGE.TURN, STAGE.RIVER];

export class Game {
  constructor(opts = {}) {
    this.maxSeats = opts.maxSeats || 9;
    this.sb = opts.sb || 10;
    this.bb = opts.bb || 20;
    this.ante = opts.ante || 0;
    this.rng = opts.rng || secureRng();
    this.seats = new Array(this.maxSeats).fill(null);
    this.button = -1;
    this.handNumber = 0;
    this.stage = STAGE.IDLE;
    this.board = [];
    this.deck = [];
    this.burned = [];
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.toAct = -1;
    this.lastAggressor = -1;
    this.pots = [];
    this.results = null;
    this.pending = null;
    this.events = [];
    this.sbSeat = -1;
    this.bbSeat = -1;
  }

  // ---------------------------------------------------------------- jugadores

  sit(player, seat = -1) {
    let s = seat;
    if (s < 0 || this.seats[s]) {
      s = this.seats.findIndex((x) => !x);
      if (s < 0) return { ok: false, reason: 'table-full' };
    }
    this.seats[s] = {
      id: player.id,
      name: player.name,
      avatar: player.avatar || '🙂',
      chips: player.chips || 0,
      buyIn: player.chips || 0,
      seat: s,
      isBot: !!player.isBot,
      botStyle: player.botStyle || null,
      status: 'waiting',      // waiting | active | folded | allin | out
      bet: 0,
      committed: 0,
      hole: [],
      hasActed: false,
      noReraise: false,
      lastAction: null,
      sittingOut: !!player.sittingOut,
      away: false,
      revealed: false,
      timeBank: 30,
      stats: { hands: 0, won: 0, vpip: 0, raises: 0, calls: 0, folds: 0, biggestPot: 0, showdowns: 0, bestHand: null }
    };
    return { ok: true, seat: s };
  }

  leave(id) {
    const p = this.playerById(id);
    if (!p) return false;
    if (this.inHand() && p.committed > 0) {
      // Ojo: sus fichas ya estan en el bote. Si le quitamos la silla ahora, esas
      // fichas desaparecen al recontar los botes. Se queda retirado y la silla
      // se libera al empezar la mano siguiente.
      p.status = 'folded';
      p.away = true;
      p.leaving = true;
      if (this.toAct === p.seat) this.afterAction();
      return true;
    }
    this.seats[p.seat] = null;
    return true;
  }

  /** Libera las sillas de quienes se fueron con una mano en curso. */
  removeLeavers() {
    for (const p of this.seated()) {
      if (p.leaving) this.seats[p.seat] = null;
    }
  }

  playerById(id) {
    return this.seats.find((p) => p && p.id === id) || null;
  }

  seated() {
    return this.seats.filter(Boolean);
  }

  inHand() {
    return this.stage !== STAGE.IDLE && this.stage !== STAGE.HAND_END;
  }

  eligibleForHand() {
    return this.seated().filter((p) => p.chips > 0 && !p.sittingOut && !p.away);
  }

  // -------------------------------------------------------------- reparto

  nextSeat(from) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (from + i + this.maxSeats) % this.maxSeats;
      if (this.seats[s]) return s;
    }
    return -1;
  }

  nextEligible(from, pool) {
    const ids = new Set(pool.map((p) => p.seat));
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (from + i + this.maxSeats) % this.maxSeats;
      if (ids.has(s)) return s;
    }
    return -1;
  }

  /** Siguiente asiento que todavia puede actuar (no retirado, con fichas). */
  nextToAct(from) {
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (from + i + this.maxSeats) % this.maxSeats;
      const p = this.seats[s];
      if (!p || p.status !== 'active' || p.chips <= 0) continue;
      if (!p.hasActed || p.bet < this.currentBet) return s;
    }
    return -1;
  }

  firstToActPostflop() {
    for (let i = 1; i <= this.maxSeats; i++) {
      const s = (this.button + i) % this.maxSeats;
      const p = this.seats[s];
      if (p && p.status === 'active' && p.chips > 0) return s;
    }
    return -1;
  }

  startHand() {
    this.removeLeavers();
    const pool = this.eligibleForHand();
    if (pool.length < 2) {
      this.stage = STAGE.IDLE;
      return { ok: false, reason: 'need-players' };
    }
    this.handNumber++;
    this.events = [];
    this.results = null;
    this.pots = [];
    this.board = [];
    this.burned = [];
    this.deck = shuffle(makeDeck(), this.rng);
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.lastAggressor = -1;
    this.pending = null;

    for (const p of this.seated()) {
      p.bet = 0;
      p.committed = 0;
      p.hole = [];
      p.hasActed = false;
      p.noReraise = false;
      p.lastAction = null;
      p.revealed = false;
      p.wonAmount = 0;
      p.handEval = null;
      p.status = pool.includes(p) ? 'active' : 'out';
      if (pool.includes(p)) p.stats.hands++;
    }

    this.button = this.button < 0
      ? pool[Math.floor(this.rng() * pool.length)].seat
      : this.nextEligible(this.button, pool);

    const heads = pool.length === 2;
    this.sbSeat = heads ? this.button : this.nextEligible(this.button, pool);
    this.bbSeat = this.nextEligible(this.sbSeat, pool);

    if (this.ante > 0) {
      for (const p of pool) this.postChips(p, Math.min(this.ante, p.chips), 'ante');
    }
    this.postChips(this.seats[this.sbSeat], Math.min(this.sb, this.seats[this.sbSeat].chips), 'sb');
    this.postChips(this.seats[this.bbSeat], Math.min(this.bb, this.seats[this.bbSeat].chips), 'bb');

    this.currentBet = this.bb;
    this.minRaise = this.bb;

    // Reparto: dos vueltas empezando por la ciega pequena.
    const order = [];
    let s = this.sbSeat;
    for (let i = 0; i < pool.length; i++) {
      order.push(s);
      s = this.nextEligible(s, pool);
    }
    for (let round = 0; round < 2; round++) {
      for (const seat of order) this.seats[seat].hole.push(this.deck.pop());
    }

    this.stage = STAGE.PREFLOP;
    this.toAct = heads ? this.sbSeat : this.nextToAct(this.bbSeat);
    this.lastAggressor = this.bbSeat;

    this.emit({ t: 'handStart', hand: this.handNumber, button: this.button, order });
    if (this.toAct < 0 || this.bettingClosed()) this.closeStreet();
    return { ok: true };
  }

  postChips(p, amount, kind) {
    const amt = Math.min(amount, p.chips);
    p.chips -= amt;
    if (kind === 'ante') {
      p.committed += amt;                 // la ante va al bote pero no cuenta como apuesta de calle
    } else {
      p.bet += amt;
      p.committed += amt;
    }
    if (p.chips === 0) p.status = 'allin';
    this.emit({ t: 'post', seat: p.seat, kind, amount: amt });
    return amt;
  }

  // -------------------------------------------------------------- apuestas

  legalActions(id) {
    const p = this.playerById(id);
    if (!p || this.toAct !== p.seat || !this.inHand()) return { yourTurn: false };
    const toCall = Math.max(0, this.currentBet - p.bet);
    const maxTo = p.bet + p.chips;
    const opponentsWithChips = this.seated().filter(
      (o) => o !== p && o.status === 'active' && o.chips > 0
    ).length;
    const canRaise = p.chips > toCall && !p.noReraise && (opponentsWithChips > 0 || this.contenders().some((o) => o !== p && o.chips > 0));
    const minRaiseTo = Math.min(this.currentBet + this.minRaise, maxTo);
    return {
      yourTurn: true,
      toCall: Math.min(toCall, p.chips),
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canRaise,
      isReraise: this.currentBet > 0,
      minRaiseTo,
      maxRaiseTo: maxTo,
      pot: this.potTotal() + this.streetBets(),
      chips: p.chips
    };
  }

  act(id, action, amount = 0) {
    const p = this.playerById(id);
    if (!p) return { ok: false, reason: 'no-player' };
    if (this.toAct !== p.seat) return { ok: false, reason: 'not-your-turn' };
    const legal = this.legalActions(id);
    const toCall = legal.toCall;

    switch (action) {
      case 'fold': {
        if (toCall === 0) {
          // Pasar es gratis: evitamos tirar una mano por error.
          return this.act(id, 'check');
        }
        p.status = 'folded';
        p.lastAction = { type: 'fold' };
        p.stats.folds++;
        break;
      }
      case 'check': {
        if (!legal.canCheck) return { ok: false, reason: 'cannot-check' };
        p.lastAction = { type: 'check' };
        break;
      }
      case 'call': {
        if (toCall <= 0) return this.act(id, 'check');
        const paid = this.moveChips(p, toCall);
        p.lastAction = { type: 'call', amount: paid };
        p.stats.calls++;
        if (this.stage === STAGE.PREFLOP) p.stats.vpip++;
        break;
      }
      case 'bet':
      case 'raise': {
        if (!legal.canRaise) return { ok: false, reason: 'cannot-raise' };
        let to = Math.round(amount);
        if (to > legal.maxRaiseTo) to = legal.maxRaiseTo;
        const isAllIn = to >= legal.maxRaiseTo;
        if (!isAllIn && to < legal.minRaiseTo) return { ok: false, reason: 'raise-too-small' };
        if (to <= p.bet) return { ok: false, reason: 'raise-too-small' };
        const inc = to - this.currentBet;
        const paid = this.moveChips(p, to - p.bet);
        const full = inc >= this.minRaise;
        const prevBet = this.currentBet;
        this.currentBet = Math.max(this.currentBet, to);
        if (full) {
          this.minRaise = inc;
          this.lastAggressor = p.seat;
          for (const o of this.seated()) {
            if (o !== p && o.status === 'active') {
              o.hasActed = false;
              o.noReraise = false;
            }
          }
        } else {
          // All-in corto: no reabre la subida, pero los demas pueden igualar el extra.
          for (const o of this.seated()) {
            if (o !== p && o.status === 'active' && o.hasActed) {
              o.hasActed = false;
              o.noReraise = true;
            }
          }
        }
        p.lastAction = {
          type: prevBet === 0 ? 'bet' : 'raise',
          amount: paid,
          to,
          allIn: p.chips === 0
        };
        p.stats.raises++;
        if (this.stage === STAGE.PREFLOP) p.stats.vpip++;
        break;
      }
      case 'allin': {
        const to = p.bet + p.chips;
        if (to > this.currentBet && legal.canRaise) return this.act(id, 'raise', to);
        const paid = this.moveChips(p, p.chips);
        p.lastAction = { type: 'call', amount: paid, allIn: true };
        break;
      }
      default:
        return { ok: false, reason: 'unknown-action' };
    }

    p.hasActed = true;
    if (p.chips === 0 && p.status === 'active') p.status = 'allin';
    this.emit({ t: 'action', seat: p.seat, action: p.lastAction, stage: this.stage });
    this.afterAction();
    return { ok: true, action: p.lastAction };
  }

  moveChips(p, amount) {
    const amt = Math.max(0, Math.min(amount, p.chips));
    p.chips -= amt;
    p.bet += amt;
    p.committed += amt;
    if (p.chips === 0) p.status = p.status === 'active' ? 'allin' : p.status;
    return amt;
  }

  contenders() {
    return this.seated().filter((p) => p.status === 'active' || p.status === 'allin');
  }

  bettingClosed() {
    const live = this.contenders();
    if (live.length <= 1) return true;
    const canAct = live.filter((p) => p.status === 'active' && p.chips > 0);
    if (canAct.length === 0) return true;
    if (canAct.length === 1 && canAct[0].bet >= this.currentBet) return true;
    return canAct.every((p) => p.hasActed && p.bet === this.currentBet);
  }

  afterAction() {
    if (this.contenders().length <= 1) {
      this.collectBets();
      this.pending = { type: 'uncontested' };
      this.toAct = -1;
      return;
    }
    if (this.bettingClosed()) {
      this.closeStreet();
      return;
    }
    this.toAct = this.nextToAct(this.toAct);
    if (this.toAct < 0) this.closeStreet();
  }

  collectBets() {
    for (const p of this.seated()) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bb;
  }

  closeStreet() {
    this.collectBets();
    for (const p of this.seated()) {
      p.hasActed = false;
      p.noReraise = false;
    }
    this.toAct = -1;
    const idx = STREET_ORDER.indexOf(this.stage);
    if (idx < 0 || idx === STREET_ORDER.length - 1) {
      this.pending = { type: 'showdown' };
    } else {
      this.pending = { type: 'street', next: STREET_ORDER[idx + 1] };
    }
  }

  /**
   * Avanza el estado bloqueado (repartir calle, showdown, reparto de botes).
   * El controlador lo llama con retardo para que las animaciones respiren.
   */
  advance() {
    if (!this.pending) return null;
    const step = this.pending;
    this.pending = null;

    if (step.type === 'street') {
      this.burned.push(this.deck.pop());
      const n = step.next === STAGE.FLOP ? 3 : 1;
      const cards = [];
      for (let i = 0; i < n; i++) {
        const c = this.deck.pop();
        this.board.push(c);
        cards.push(c);
      }
      this.stage = step.next;
      this.emit({ t: 'street', stage: this.stage, cards });
      this.toAct = this.firstToActPostflop();
      if (this.toAct < 0 || this.bettingClosed()) {
        this.closeStreet();
        return { type: 'street', stage: this.stage, cards, runout: true };
      }
      this.lastAggressor = -1;
      return { type: 'street', stage: this.stage, cards };
    }

    if (step.type === 'showdown') {
      this.stage = STAGE.SHOWDOWN;
      this.buildPots();
      const live = this.contenders();
      for (const p of live) {
        p.handEval = evaluate(p.hole.concat(this.board));
        p.revealed = true;
        p.stats.showdowns++;
        if (!p.stats.bestHand || p.handEval.score > p.stats.bestHand.score) {
          p.stats.bestHand = { score: p.handEval.score, name: p.handEval.name };
        }
      }
      this.results = this.settle();
      this.pending = { type: 'payout' };
      this.emit({ t: 'showdown', order: this.revealOrder() });
      return { type: 'showdown', results: this.results };
    }

    if (step.type === 'uncontested') {
      this.buildPots();
      this.results = this.settle();
      this.pending = { type: 'payout' };
      return { type: 'uncontested', results: this.results };
    }

    if (step.type === 'payout') {
      for (const pot of this.results.pots) {
        for (const w of pot.winners) {
          const p = this.seats[w.seat];
          if (p) {
            p.chips += w.amount;
            p.wonAmount = (p.wonAmount || 0) + w.amount;
          }
        }
      }
      for (const p of this.seated()) {
        if (p.wonAmount > 0) {
          p.stats.won++;
          p.stats.biggestPot = Math.max(p.stats.biggestPot, p.wonAmount);
        }
        if (p.chips <= 0 && p.status !== 'out') p.status = 'out';
      }
      this.stage = STAGE.HAND_END;
      this.emit({ t: 'payout', results: this.results });
      return { type: 'payout', results: this.results };
    }
    return null;
  }

  /** Orden de enseñar cartas: primero el ultimo agresor, luego en sentido horario. */
  revealOrder() {
    const live = this.contenders();
    const start = this.lastAggressor >= 0 ? this.lastAggressor : this.nextSeat(this.button);
    const order = [];
    for (let i = 0; i < this.maxSeats; i++) {
      const s = (start + i) % this.maxSeats;
      const p = this.seats[s];
      if (p && live.includes(p)) order.push(s);
    }
    return order;
  }

  /** Construye bote principal y laterales a partir de lo comprometido por cada jugador. */
  buildPots() {
    const contributors = this.seated().filter((p) => p.committed > 0);
    const levels = [...new Set(contributors.map((p) => p.committed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of contributors) amount += Math.max(0, Math.min(p.committed, level) - prev);
      const eligible = contributors
        .filter((p) => p.committed >= level && (p.status === 'active' || p.status === 'allin'))
        .map((p) => p.seat);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    // Fusiona botes consecutivos con los mismos elegibles (mas limpio en pantalla).
    const merged = [];
    for (const pot of pots) {
      const last = merged[merged.length - 1];
      if (last && last.eligible.join(',') === pot.eligible.join(',')) last.amount += pot.amount;
      else merged.push(pot);
    }
    this.pots = merged;
    return merged;
  }

  settle() {
    const pots = this.pots.map((pot, i) => ({
      ...pot,
      index: i,
      label: i === 0 ? (this.pots.length > 1 ? 'Bote principal' : 'Bote') : `Bote lateral ${i}`,
      winners: []
    }));

    for (const pot of pots) {
      const players = pot.eligible.map((s) => this.seats[s]).filter(Boolean);
      if (players.length === 0) continue;
      if (players.length === 1) {
        pot.winners = [{ seat: players[0].seat, amount: pot.amount, eval: players[0].handEval || null }];
        continue;
      }
      let best = -1;
      let winners = [];
      for (const p of players) {
        const ev = p.handEval || (p.hole.length === 2 ? evaluate(p.hole.concat(this.board)) : null);
        if (!ev) continue;
        p.handEval = ev;
        if (ev.score > best) {
          best = ev.score;
          winners = [p];
        } else if (ev.score === best) {
          winners.push(p);
        }
      }
      if (!winners.length) winners = players;
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // Las fichas sueltas van al primer jugador a la izquierda del boton.
      const ordered = [...winners].sort((a, b) => {
        const da = (a.seat - this.button + this.maxSeats) % this.maxSeats;
        const db = (b.seat - this.button + this.maxSeats) % this.maxSeats;
        return da - db;
      });
      pot.winners = ordered.map((p) => {
        let amt = share;
        if (remainder > 0) {
          amt += 1;
          remainder--;
        }
        return { seat: p.seat, amount: amt, eval: p.handEval || null };
      });
    }

    const total = pots.reduce((a, p) => a + p.amount, 0);
    return { pots, total, board: this.board.slice() };
  }

  potTotal() {
    return this.seated().reduce((a, p) => a + p.committed, 0) - this.streetBets();
  }

  streetBets() {
    return this.seated().reduce((a, p) => a + p.bet, 0);
  }

  emit(ev) {
    this.events.push({ ...ev, n: this.events.length });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // -------------------------------------------------------------- snapshot

  /**
   * Vista del estado para un jugador concreto: oculta las cartas ajenas
   * salvo en el showdown. Es lo unico que viaja por la red.
   */
  snapshot(viewerId = null) {
    const showAll = this.stage === STAGE.SHOWDOWN || this.stage === STAGE.HAND_END;
    return {
      handNumber: this.handNumber,
      stage: this.stage,
      board: this.board.slice(),
      pots: this.pots.map((p) => ({ amount: p.amount, eligible: p.eligible.slice() })),
      potTotal: this.potTotal(),
      streetBets: this.streetBets(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      button: this.button,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      toAct: this.toAct,
      blinds: { sb: this.sb, bb: this.bb, ante: this.ante },
      maxSeats: this.maxSeats,
      results: this.results
        ? {
            total: this.results.total,
            pots: this.results.pots.map((p) => ({
              label: p.label,
              amount: p.amount,
              winners: p.winners.map((w) => ({
                seat: w.seat,
                amount: w.amount,
                name: w.eval ? w.eval.name : null,
                best: w.eval ? w.eval.best : null
              }))
            }))
          }
        : null,
      players: this.seats.map((p, seat) => {
        if (!p) return null;
        const isYou = viewerId && p.id === viewerId;
        const reveal = isYou || (showAll && p.revealed);
        // Quien se retira manda sus cartas al monton: nadie las ve, ni al final.
        const mucked = p.status === 'folded' && !isYou;
        return {
          seat,
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          chips: p.chips,
          bet: p.bet,
          committed: p.committed,
          status: p.status,
          isBot: p.isBot,
          sittingOut: p.sittingOut,
          away: p.away,
          lastAction: p.lastAction,
          isYou: !!isYou,
          holeCount: mucked ? 0 : p.hole.length,
          hole: reveal ? p.hole.slice() : null,
          handName: reveal && p.handEval ? p.handEval.name : null,
          bestCards: showAll && p.handEval ? p.handEval.best : null,
          wonAmount: p.wonAmount || 0,
          stats: p.stats
        };
      }),
      you: viewerId,
      legal: viewerId ? this.legalActions(viewerId) : { yourTurn: false }
    };
  }
}
