// Capa visual: pinta la mesa a partir de los snapshots y anima las transiciones.
// Nunca decide reglas; solo representa lo que dice el motor.

import { RANK_LABEL, SUIT_GLYPH } from './cards.js';
import { evaluate } from './evaluator.js';
import { equity } from './odds.js';
import { sfx } from './sound.js';
import {
  motion, ms, wait, rectIn, flyTo, floatText, makeChipEl, chipBreakdown,
  initConfetti, confettiBurst, coinRain, tweenNumber
} from './fx.js';

// Los asientos se reparten sobre una elipse. El jugador local siempre abajo
// en el centro, y el resto en sentido horario segun su posicion real en la mesa.
function ellipsePoint(angleDeg, scale = 1, rx = 45, ry = 43) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + rx * scale * Math.cos(a), y: 50 + ry * scale * Math.sin(a) };
}

/** Angulo de cada asiento: el indice 0 (tu) queda abajo (90 grados). */
function seatAngle(i, total) {
  return 90 + (i * 360) / Math.max(1, total);
}

const EMOJIS = ['👏', '😂', '😱', '🔥', '🤔', '😎', '🍀', '💀', '🤡', '🍺'];

const ACTION_TEXT = {
  fold: 'Se retira',
  check: 'Pasa',
  call: 'Paga',
  bet: 'Apuesta',
  raise: 'Sube a'
};

export class TableUI {
  constructor({ session, settings, onLeave }) {
    this.session = session;
    this.settings = settings;
    this.onLeave = onLeave;
    this.view = null;
    this.prev = null;
    this.clockOffset = 0;
    this.seatEls = new Map();
    this.boardEls = [];
    this.lastHand = -1;
    this.equityCache = { key: '', value: null };
    this.raiseAmount = 0;
    this.pendingPre = null;
    this.animating = false;
    this.el = {};
  }

  // ------------------------------------------------------------------ init

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      felt: $('felt'),
      seats: $('seats'),
      board: $('board'),
      potAmount: $('potAmount'),
      potPending: $('potPending'),
      potWrap: $('potWrap'),
      potChips: $('potChips'),
      sidePots: $('sidePots'),
      stageLabel: $('stageLabel'),
      dealer: $('dealerButton'),
      fx: $('fxLayer'),
      confetti: $('confetti'),
      banner: $('banner'),
      roomCode: $('roomCode'),
      handNumber: $('handNumber'),
      blindsLabel: $('blindsLabel'),
      levelLabel: $('levelLabel'),
      levelTimer: $('levelTimer'),
      netStatus: $('netStatus'),
      // acciones
      betPanel: $('betPanel'),
      betRange: $('betRange'),
      betInput: $('betInput'),
      btnFold: $('btnFold'),
      btnCall: $('btnCall'),
      btnRaise: $('btnRaise'),
      waitingMsg: $('waitingMsg'),
      btnRebuySeat: $('btnRebuySeat'),
      handHud: $('handHud'),
      hudHand: $('hudHand'),
      hudEquity: $('hudEquity'),
      hudEquityRow: $('hudEquityRow'),
      equityFill: $('equityFill'),
      preActions: $('preActions'),
      preFold: $('preFold'),
      preCheckFold: $('preCheckFold'),
      preCallAny: $('preCallAny'),
      emoteBar: $('emoteBar'),
      btnSitOut: $('btnSitOut'),
      // panel
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList'),
      toast: $('toast')
    };

    initConfetti(this.el.confetti);
    this.buildEmotes();
    this.bindControls();
    this.startClock();
    window.addEventListener('resize', () => {
      if (this.view) this.layoutSeats(this.view);
    });

    this.session.on('state', (view, events) => this.onState(view, events));
    this.session.on('latency', (lat) => {
      this.el.netStatus.textContent = `${lat} ms`;
      this.el.netStatus.classList.toggle('bad', lat > 400);
    });
    this.session.on('netstatus', (s) => {
      this.el.netStatus.textContent = s;
    });
    this.session.on('hostgone', () => {
      this.toast('Se ha perdido la conexión con el anfitrión');
    });
  }

  /** Punto sobre la elipse de la mesa, con radios segun el ancho disponible. */
  point(angle, scale = 1) {
    const w = this.el.felt ? this.el.felt.clientWidth : 900;
    const rx = w < 620 ? 33 : w < 860 ? 40 : 45;
    const ry = w < 620 ? 39 : 40;
    return ellipsePoint(angle, scale, rx, ry);
  }

  /** Crea (una vez) el DOM de un asiento ocupado. */
  ensureSeat(seatIndex) {
    if (this.seatEls.has(seatIndex)) return this.seatEls.get(seatIndex);

    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.innerHTML = `
      <div class="seat-cards"></div>
      <div class="seat-body">
        <div class="avatar-wrap">
          <svg class="timer-ring" viewBox="0 0 44 44">
            <circle class="track" cx="22" cy="22" r="20"></circle>
            <circle class="bar" cx="22" cy="22" r="20" stroke-dasharray="125.6" stroke-dashoffset="0"></circle>
          </svg>
          <div class="avatar">🙂</div>
        </div>
        <div class="seat-info">
          <div class="seat-name"></div>
          <div class="seat-chips"></div>
        </div>
      </div>
      <div class="action-bubble"></div>
      <div class="hand-name"></div>`;

    // La apuesta vive suelta sobre el tapete, entre el asiento y el bote.
    const bet = document.createElement('div');
    bet.className = 'seat-bet';

    this.el.seats.appendChild(seat);
    this.el.seats.appendChild(bet);

    const entry = {
      root: seat,
      cards: seat.querySelector('.seat-cards'),
      avatar: seat.querySelector('.avatar'),
      name: seat.querySelector('.seat-name'),
      chips: seat.querySelector('.seat-chips'),
      bubble: seat.querySelector('.action-bubble'),
      handName: seat.querySelector('.hand-name'),
      ring: seat.querySelector('.timer-ring'),
      bar: seat.querySelector('.timer-ring .bar'),
      bet,
      cardEls: [],
      lastChips: null,
      sig: null
    };
    this.seatEls.set(seatIndex, entry);
    return entry;
  }

  dropSeat(seatIndex) {
    const S = this.seatEls.get(seatIndex);
    if (!S) return;
    S.root.remove();
    S.bet.remove();
    this.seatEls.delete(seatIndex);
  }

  /** Reparte a los jugadores presentes por la elipse, contigo abajo. */
  layoutSeats(view) {
    const present = view.players.filter(Boolean).map((p) => p.seat).sort((a, b) => a - b);
    const mySeat = this.youSeat(view);
    const pivot = present.indexOf(mySeat);
    const order = pivot >= 0
      ? present.slice(pivot).concat(present.slice(0, pivot))
      : present;

    for (const seatIndex of [...this.seatEls.keys()]) {
      if (!order.includes(seatIndex)) this.dropSeat(seatIndex);
    }

    const total = Math.max(order.length, 2);
    order.forEach((seatIndex, i) => {
      const S = this.ensureSeat(seatIndex);
      const angle = seatAngle(i, total);
      const pt = this.point(angle);
      S.angle = angle;
      S.root.style.setProperty('--x', pt.x.toFixed(2) + '%');
      S.root.style.setProperty('--y', pt.y.toFixed(2) + '%');
      S.root.classList.toggle('top', pt.y < 46);

      // Tu apuesta se aparta un poco: tus cartas son grandes y la taparian.
      const betPt = i === 0 ? this.point(angle + 24, 0.66) : this.point(angle, 0.58);
      S.bet.style.left = betPt.x.toFixed(2) + '%';
      S.bet.style.top = betPt.y.toFixed(2) + '%';
    });
    return order;
  }

  buildEmotes() {
    this.el.emoteBar.innerHTML = '';
    for (const e of EMOJIS) {
      const b = document.createElement('button');
      b.className = 'emote-btn';
      b.textContent = e;
      b.onclick = () => {
        this.session.emote(e, -1);
        sfx.emote();
      };
      this.el.emoteBar.appendChild(b);
    }
  }

  // -------------------------------------------------------------- controles

  bindControls() {
    const { betRange, betInput, btnFold, btnCall, btnRaise } = this.el;

    const sync = (val) => {
      const legal = this.legal();
      if (!legal || !legal.canRaise) return;
      const v = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(val)));
      this.raiseAmount = v;
      betRange.value = String(v);
      betInput.value = String(v);
      const pct = ((v - legal.minRaiseTo) / Math.max(1, legal.maxRaiseTo - legal.minRaiseTo)) * 100;
      betRange.style.setProperty('--fill', pct + '%');
      this.updateRaiseLabel();
    };
    this.syncBet = sync;

    betRange.addEventListener('input', () => sync(+betRange.value));
    betInput.addEventListener('input', () => sync(+betInput.value || 0));

    document.querySelectorAll('.chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const legal = this.legal();
        if (!legal || !legal.canRaise) return;
        const kind = btn.dataset.bet;
        const pot = legal.pot;
        if (kind === 'min') sync(legal.minRaiseTo);
        else if (kind === 'max') sync(legal.maxRaiseTo);
        else sync(legal.toCall + this.view.currentBet + pot * parseFloat(kind));
        sfx.chip(1);
      });
    });

    btnFold.addEventListener('click', () => this.doAction('fold'));
    btnCall.addEventListener('click', () => {
      const legal = this.legal();
      if (!legal) return;
      this.doAction(legal.canCheck ? 'check' : 'call');
    });
    btnRaise.addEventListener('click', () => this.doAction('raise', this.raiseAmount));

    this.el.btnRebuySeat.addEventListener('click', () => {
      this.session.command('rebuy', {});
      sfx.chip(3);
    });

    this.el.btnSitOut.addEventListener('click', () => {
      const me = this.me();
      const away = !(me && me.sittingOut);
      if (this.session.setAway) this.session.setAway(away);
      else this.session.command('away', { away });
      this.el.btnSitOut.textContent = away ? 'Volver' : 'Ausentarme';
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      const legal = this.legal();
      if (!legal || !legal.yourTurn) return;
      const k = e.key.toLowerCase();
      if (k === 'f') this.doAction('fold');
      else if (k === 'c' || k === ' ') {
        e.preventDefault();
        this.doAction(legal.canCheck ? 'check' : 'call');
      } else if (k === 'r') this.doAction('raise', this.raiseAmount);
      else if (k === 'a' && legal.canRaise) this.doAction('raise', legal.maxRaiseTo);
      else if (['1', '2', '3', '4'].includes(k) && legal.canRaise) {
        const f = { 1: 0.5, 2: 0.75, 3: 1, 4: 2 }[k];
        this.syncBet(legal.toCall + this.view.currentBet + legal.pot * f);
      }
    });
  }

  doAction(action, amount = 0) {
    const legal = this.legal();
    if (!legal || !legal.yourTurn) return;
    this.clearPre();
    this.session.act(action, amount);
    this.setActionsEnabled(false);
  }

  clearPre() {
    this.el.preFold.checked = false;
    this.el.preCheckFold.checked = false;
    this.el.preCallAny.checked = false;
  }

  legal() {
    return this.view ? this.view.legal : null;
  }

  me() {
    if (!this.view) return null;
    return this.view.players.find((p) => p && p.isYou) || null;
  }

  // ------------------------------------------------------------------ ciclo

  onState(view, events) {
    this.clockOffset = view.now ? view.now - Date.now() : 0;
    this.prev = this.view;
    this.view = view;
    const wasMyTurn = this.prev && this.prev.legal && this.prev.legal.yourTurn;
    this.render(view);
    this.playEvents(events || [], view);
    if (view.legal && view.legal.yourTurn && !wasMyTurn) this.notifyTurn();
    if (!view.legal || !view.legal.yourTurn) this.stopTitleFlash();
    this.maybeAutoAction(view);
  }

  render(view) {
    const prev = this.prev;
    const youSeat = this.youSeat(view);

    // --- cabecera
    this.el.handNumber.textContent = view.handNumber || 0;
    this.el.blindsLabel.textContent = `${view.blinds.sb} / ${view.blinds.bb}${view.blinds.ante ? ` (${view.blinds.ante})` : ''}`;
    if (view.level) {
      this.el.levelLabel.textContent = `Nivel ${view.level.index}`;
      const left = Math.max(0, view.level.endsAt - (Date.now() + this.clockOffset));
      this.el.levelTimer.textContent = this.mmss(left);
    } else {
      this.el.levelLabel.textContent = 'Ciegas';
      this.el.levelTimer.textContent = '';
    }

    // --- asientos
    const order = this.layoutSeats(view);
    for (const seatIndex of order) this.renderSeat(seatIndex, view.players[seatIndex], view);

    // --- boton del crupier, ligeramente al lado para no tapar las cartas
    const dealerSeat = this.seatEls.get(view.button);
    if (view.button >= 0 && dealerSeat && view.players[view.button]) {
      // Bastante girado para no pisar la chapa de ciega, que va arriba a la derecha.
      const pt = this.point(dealerSeat.angle + 17, 0.93);
      this.el.dealer.hidden = false;
      this.el.dealer.style.left = pt.x.toFixed(2) + '%';
      this.el.dealer.style.top = pt.y.toFixed(2) + '%';
    } else {
      this.el.dealer.hidden = true;
    }

    // --- board
    this.renderBoard(view);

    // --- bote
    const potNow = view.potTotal;
    const potPrev = prev ? prev.potTotal : 0;
    if (potNow !== potPrev) {
      tweenNumber(this.el.potAmount, potPrev, potNow, 500);
      if (potNow > potPrev) {
        this.el.potAmount.parentElement.classList.add('bump');
        setTimeout(() => this.el.potAmount.parentElement.classList.remove('bump'), 250);
      }
    } else {
      this.el.potAmount.textContent = potNow.toLocaleString('es-ES');
    }
    this.el.potPending.textContent = view.streetBets > 0
      ? `+${view.streetBets.toLocaleString('es-ES')}`
      : '';
    this.renderPotChips(potNow + view.streetBets);
    this.renderSidePots(view);

    // --- etiqueta de calle
    const labels = {
      preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
      showdown: 'Showdown', handEnd: '', idle: 'Esperando jugadores'
    };
    this.el.stageLabel.textContent = labels[view.stage] || '';

    // --- panel de acciones
    this.renderActions(view);
    this.renderHud(view);
    this.renderChat(view);
    this.renderHistory(view);
    this.renderStats(view);
  }

  youSeat(view) {
    const me = view.players.find((p) => p && p.isYou);
    return me ? me.seat : 0;
  }

  renderSeat(seatIndex, p, view) {
    const S = this.seatEls.get(seatIndex);
    if (!S || !p) return;
    const root = S.root;

    const classes = ['seat'];
    if (root.classList.contains('top')) classes.push('top');
    if (p.isYou) classes.push('you');
    if (p.status === 'folded') classes.push('folded');
    if (p.status === 'allin') classes.push('allin');
    if (view.toAct === p.seat) classes.push('acting');
    if (p.wonAmount > 0 && (view.stage === 'showdown' || view.stage === 'handEnd')) classes.push('winner');
    if (p.sittingOut || p.away) classes.push('away');
    root.className = classes.join(' ');

    S.avatar.textContent = p.avatar || '🙂';
    S.name.textContent = p.name + (p.away ? ' 💤' : '');

    const tagText = view.sbSeat === p.seat && view.stage !== 'idle' ? 'CP'
      : view.bbSeat === p.seat && view.stage !== 'idle' ? 'CG'
      : '';
    if (tagText) {
      if (!S.tag) {
        S.tag = document.createElement('span');
        S.tag.className = 'seat-tag';
        S.root.querySelector('.seat-body').appendChild(S.tag);
      }
      S.tag.textContent = tagText;
      S.tag.hidden = false;
    } else if (S.tag) {
      S.tag.hidden = true;
    }

    if (S.lastChips == null) {
      S.chips.textContent = p.chips.toLocaleString('es-ES');
    } else if (S.lastChips !== p.chips) {
      tweenNumber(S.chips, S.lastChips, p.chips, 600);
    }
    S.lastChips = p.chips;

    this.renderHole(S, p, view);

    if (p.bet > 0) {
      S.bet.innerHTML = `<span class="mini-chips">${chipBreakdown(p.bet)
        .slice(0, 3)
        .map(() => '<i class="mini-chip"></i>')
        .join('')}</span>${p.bet.toLocaleString('es-ES')}`;
      S.bet.classList.add('show');
    } else {
      S.bet.classList.remove('show');
    }

    if (p.handName && (view.stage === 'showdown' || view.stage === 'handEnd')) {
      S.handName.textContent = p.handName;
      S.handName.classList.add('show');
    } else {
      S.handName.classList.remove('show');
    }
  }

  renderHole(S, p, view) {
    const want = p.hole ? p.hole.length : p.holeCount;
    const faceUp = !!p.hole;
    const sig = (p.hole ? p.hole.map((c) => c.r + c.s).join('') : 'x'.repeat(want)) + '|' + want;
    if (S.sig === sig && S.cardEls.length === want) {
      this.highlightBest(S, p, view);
      return;
    }

    if (want === 0) {
      if (S.cardEls.length) {
        // Se retira: las cartas se van con un pequeno gesto.
        for (const el of S.cardEls) {
          el.style.transition = 'transform .35s ease, opacity .35s ease';
          el.style.transform = 'translateY(14px) scale(.8) rotate(6deg)';
          el.style.opacity = '0';
          setTimeout(() => el.remove(), 380);
        }
      }
      S.cardEls = [];
      S.sig = sig;
      return;
    }

    const isNew = S.cardEls.length !== want;
    if (isNew) {
      S.cards.innerHTML = '';
      S.cardEls = [];
      for (let i = 0; i < want; i++) {
        const card = p.hole ? p.hole[i] : null;
        const el = this.makeCard(card, !faceUp);
        el.classList.add('dealing');
        el.style.animationDelay = ms(i * 110) + 'ms';
        S.cards.appendChild(el);
        S.cardEls.push(el);
      }
    } else {
      // Mismo numero de cartas: solo cambia el reverso por la cara (showdown).
      S.cardEls.forEach((el, i) => {
        const card = p.hole ? p.hole[i] : null;
        if (card) this.setCardFace(el, card);
        el.classList.toggle('face-down', !faceUp);
      });
    }
    S.sig = sig;
    this.highlightBest(S, p, view);
  }

  highlightBest(S, p, view) {
    const best = p.bestCards;
    if (!best || view.stage !== 'showdown' && view.stage !== 'handEnd') {
      S.cardEls.forEach((el) => el.classList.remove('winning-card', 'dimmed'));
      return;
    }
    const codes = new Set(best.map((c) => c.r + c.s));
    S.cardEls.forEach((el) => {
      const inBest = codes.has(el.dataset.code);
      el.classList.toggle('winning-card', inBest && p.wonAmount > 0);
      el.classList.toggle('dimmed', !inBest);
    });
  }

  renderBoard(view) {
    const board = view.board || [];
    if (board.length < this.boardEls.length) {
      this.el.board.innerHTML = '';
      this.boardEls = [];
    }
    for (let i = this.boardEls.length; i < board.length; i++) {
      const el = this.makeCard(board[i], true);
      el.classList.add('dealing');
      el.style.animationDelay = ms((i % 3) * 130) + 'ms';
      this.el.board.appendChild(el);
      this.boardEls.push(el);
      const delay = ms(180 + (i % 3) * 130);
      setTimeout(() => {
        el.classList.remove('face-down');
        sfx.flip();
      }, delay);
    }
    // Resalta las cartas del board que forman la mano ganadora.
    const winners = view.results ? view.results.pots.flatMap((p) => p.winners) : [];
    const bestCodes = new Set();
    for (const w of winners) if (w.best) for (const c of w.best) bestCodes.add(c.r + c.s);
    this.boardEls.forEach((el) => {
      if (!bestCodes.size) {
        el.classList.remove('winning-card', 'dimmed');
      } else {
        const inBest = bestCodes.has(el.dataset.code);
        el.classList.toggle('winning-card', inBest);
        el.classList.toggle('dimmed', !inBest);
      }
    });
  }

  renderPotChips(amount) {
    const chips = amount > 0 ? chipBreakdown(amount) : [];
    if (this.el.potChips.childElementCount === chips.length) return;
    this.el.potChips.innerHTML = '';
    for (const value of chips) {
      const c = makeChipEl(value);
      c.style.position = 'relative';
      c.style.transform = 'none';
      c.style.width = '16px';
      c.style.height = '16px';
      this.el.potChips.appendChild(c);
    }
  }

  renderSidePots(view) {
    if (!view.pots || view.pots.length <= 1) {
      this.el.sidePots.innerHTML = '';
      return;
    }
    this.el.sidePots.innerHTML = view.pots
      .map((p, i) => `<span class="side-pot">${i === 0 ? 'Principal' : 'Lateral ' + i}: ${p.amount.toLocaleString('es-ES')}</span>`)
      .join('');
  }

  // ---------------------------------------------------------------- acciones

  renderActions(view) {
    const legal = view.legal || {};
    const me = this.me();
    const yourTurn = !!legal.yourTurn;

    // Sin fichas: que pueda recargar el mismo, sin depender de nadie.
    const sinFichas = !!me && me.chips <= 0 && me.status !== 'active' && me.status !== 'allin';
    this.el.btnRebuySeat.hidden = !sinFichas;
    this.el.waitingMsg.hidden = yourTurn;
    this.el.betPanel.hidden = !yourTurn || !legal.canRaise;
    document.querySelector('.buttons').style.display = yourTurn ? 'grid' : 'none';
    this.el.preActions.hidden = yourTurn || !me || me.status !== 'active' || view.stage === 'idle' || view.stage === 'handEnd';

    if (!yourTurn) {
      let msg = 'Esperando a los demás…';
      if (!me) msg = 'Estás mirando la partida';
      else if (me.status === 'folded') msg = 'Te has retirado de esta mano';
      else if (me.status === 'allin') msg = 'All-in: a ver qué sale 🤞';
      else if (me.chips <= 0) msg = 'Sin fichas. Pide una recarga al anfitrión.';
      else if (view.stage === 'idle') msg = 'Esperando a que haya al menos 2 jugadores…';
      else if (view.toAct >= 0 && view.players[view.toAct]) msg = `Le toca a ${view.players[view.toAct].name}…`;
      this.el.waitingMsg.textContent = msg;
      return;
    }

    this.setActionsEnabled(true);
    this.el.btnFold.disabled = false;
    this.el.btnCall.querySelector('b').textContent = legal.canCheck
      ? 'Pasar'
      : legal.toCall >= (me ? me.chips : 0)
        ? `All-in ${legal.toCall.toLocaleString('es-ES')}`
        : `Pagar ${legal.toCall.toLocaleString('es-ES')}`;
    this.el.btnCall.disabled = false;

    if (legal.canRaise) {
      this.el.btnRaise.disabled = false;
      this.el.betRange.min = String(legal.minRaiseTo);
      this.el.betRange.max = String(legal.maxRaiseTo);
      const start = Math.min(
        legal.maxRaiseTo,
        Math.max(legal.minRaiseTo, Math.round((legal.pot * 0.6 + legal.toCall + view.currentBet) / 5) * 5)
      );
      this.syncBet(this.raiseAmount && this.raiseAmount >= legal.minRaiseTo && this.raiseAmount <= legal.maxRaiseTo && this.keepRaise
        ? this.raiseAmount
        : start);
      this.keepRaise = false;
    } else {
      this.el.btnRaise.disabled = true;
    }
  }

  /** Aviso cuando te toca: sonido, vibracion y parpadeo del titulo si no miras. */
  notifyTurn() {
    sfx.turn();
    if (navigator.vibrate) {
      try { navigator.vibrate([35, 60, 35]); } catch (_) {}
    }
    if (document.hidden) this.startTitleFlash();
  }

  startTitleFlash() {
    if (this._titleTimer) return;
    this._title = this._title || document.title;
    let on = false;
    this._titleTimer = setInterval(() => {
      document.title = on ? this._title : '🔔 ¡Te toca!';
      on = !on;
    }, 900);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.stopTitleFlash();
    }, { once: true });
  }

  stopTitleFlash() {
    if (!this._titleTimer) return;
    clearInterval(this._titleTimer);
    this._titleTimer = null;
    if (this._title) document.title = this._title;
  }

  updateRaiseLabel() {
    const legal = this.legal();
    if (!legal) return;
    const isAllIn = this.raiseAmount >= legal.maxRaiseTo;
    const label = isAllIn ? 'ALL-IN' : `${legal.isReraise ? 'Subir a' : 'Apostar'} ${this.raiseAmount.toLocaleString('es-ES')}`;
    this.el.btnRaise.querySelector('b').textContent = label;
    this.el.btnRaise.classList.toggle('allin-style', isAllIn);
  }

  setActionsEnabled(on) {
    for (const b of [this.el.btnFold, this.el.btnCall, this.el.btnRaise]) b.disabled = !on;
  }

  /** Acciones anticipadas: si marcaste "pasar/retirarme", se ejecuta al llegar tu turno. */
  maybeAutoAction(view) {
    const legal = view.legal || {};
    if (!legal.yourTurn) return;
    if (this.el.preFold.checked) {
      this.clearPre();
      this.doAction('fold');
    } else if (this.el.preCheckFold.checked) {
      this.clearPre();
      this.doAction(legal.canCheck ? 'check' : 'fold');
    } else if (this.el.preCallAny.checked) {
      this.clearPre();
      this.doAction(legal.canCheck ? 'check' : 'call');
    }
  }

  renderHud(view) {
    const me = this.me();
    if (!me || !me.hole || me.status === 'folded') {
      this.el.handHud.hidden = true;
      return;
    }
    this.el.handHud.hidden = false;
    if (view.board.length >= 3) {
      const ev = evaluate(me.hole.concat(view.board));
      this.el.hudHand.textContent = ev.name;
    } else {
      this.el.hudHand.textContent = me.hole.map((c) => RANK_LABEL[c.r] + SUIT_GLYPH[c.s]).join(' ');
    }

    if (!this.settings.equity || view.stage === 'handEnd') {
      this.el.hudEquityRow.hidden = true;
      return;
    }
    const rivals = view.players.filter((p) => p && !p.isYou && (p.status === 'active' || p.status === 'allin')).length;
    if (rivals < 1) {
      this.el.hudEquityRow.hidden = true;
      return;
    }
    const key = me.hole.map((c) => c.r + c.s).join('') + '|' + view.board.map((c) => c.r + c.s).join('') + '|' + rivals;
    if (this.equityCache.key !== key) {
      this.equityCache.key = key;
      // Simulacion corta: el HUD es orientativo, no un solver.
      this.equityCache.value = equity(me.hole, view.board, rivals, view.board.length ? 700 : 900);
    }
    const eq = this.equityCache.value;
    const pct = Math.round((eq.win + eq.tie / 2) * 100);
    this.el.hudEquityRow.hidden = false;
    this.el.hudEquity.textContent = pct + '%';
    this.el.equityFill.style.width = pct + '%';
  }

  // ------------------------------------------------------------- panel info

  renderChat(view) {
    const msgs = view.messages || [];
    if (this._chatCount === msgs.length) return;
    this._chatCount = msgs.length;
    this.el.chatLog.innerHTML = msgs
      .map((m) =>
        m.system
          ? `<div class="chat-msg system">${escapeHtml(m.text)}</div>`
          : `<div class="chat-msg"><span>${m.avatar || '👤'}</span><div><span class="who">${escapeHtml(m.from)}</span><div class="text">${escapeHtml(m.text)}</div></div></div>`
      )
      .join('');
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
  }

  renderHistory(view) {
    const hist = view.history || [];
    if (this._histKey === (hist[0] ? hist[0].hand : 0) + ':' + hist.length) return;
    this._histKey = (hist[0] ? hist[0].hand : 0) + ':' + hist.length;
    if (!hist.length) {
      this.el.historyList.innerHTML = '<p class="hint">Aquí aparecerán las manos jugadas.</p>';
      return;
    }
    this.el.historyList.innerHTML = hist
      .map((h) => {
        const board = h.board
          .map((c) => `<div class="mini-card${c.s === 'h' || c.s === 'd' ? ' red' : ''}">${RANK_LABEL[c.r]}${SUIT_GLYPH[c.s]}</div>`)
          .join('');
        const wins = h.pots
          .map((p) => p.winners.map((w) => `<div class="history-win"><b>${escapeHtml(w.name)}</b> +${w.amount.toLocaleString('es-ES')}${w.hand ? ` · ${w.hand}` : ''}</div>`).join(''))
          .join('');
        return `<div class="history-item">
          <div class="history-head"><span>Mano #${h.hand}</span><span>${h.total.toLocaleString('es-ES')} fichas</span></div>
          <div class="history-board">${board || '<span class="hint">sin board</span>'}</div>
          ${wins}
        </div>`;
      })
      .join('');
  }

  renderStats(view) {
    const players = view.players.filter(Boolean);
    this.el.statsList.innerHTML = players
      .map((p) => {
        const s = p.stats || { hands: 0, won: 0, vpip: 0, biggestPot: 0 };
        const vpip = s.hands ? Math.round((s.vpip / s.hands) * 100) : 0;
        const winRate = s.hands ? Math.round((s.won / s.hands) * 100) : 0;
        return `<div class="stat-row">
          <span class="s-avatar">${p.avatar || '🙂'}</span>
          <span class="s-name">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
          <span class="s-nums">
            <span>manos<b>${s.hands}</b></span>
            <span>ganadas<b>${winRate}%</b></span>
            <span>VPIP<b>${vpip}%</b></span>
          </span>
          <span class="s-chips">${p.chips.toLocaleString('es-ES')}</span>
        </div>`;
      })
      .join('');
  }

  // ------------------------------------------------------------ animaciones

  async playEvents(events, view) {
    for (const ev of events) {
      switch (ev.t) {
        case 'handStart':
          this.onHandStart(view);
          break;
        case 'post':
          if (ev.amount > 0) sfx.chip(1);
          break;
        case 'action':
          this.showAction(ev, view);
          break;
        case 'street':
          sfx.deal();
          this.collectBetsToPot(view);
          break;
        case 'showdown':
          sfx.flip();
          break;
        case 'payout':
          this.celebrate(ev.results, view);
          break;
        case 'chat':
          sfx.chat();
          break;
        case 'emote':
          this.throwEmote(ev, view);
          break;
        case 'join':
          sfx.join();
          this.toast(`${ev.name} se ha sentado`);
          break;
        case 'rejoin':
          this.toast(`${ev.name} ha vuelto`);
          break;
        case 'leave':
          this.toast(`${ev.name} se ha ido`);
          break;
        case 'timeout':
          this.toast('Se acabó el tiempo');
          break;
        case 'timebank':
          this.toast('Tiempo extra');
          break;
        case 'levelUp':
          sfx.levelUp();
          this.banner(`Nivel ${ev.level}`, `Ciegas ${ev.sb} / ${ev.bb}`, 2600);
          break;
        case 'rebuy':
          sfx.chip(3);
          break;
        case 'busted':
          if (this.me() && ev.seat === this.me().seat) this.banner('Sin fichas', 'Pide una recarga para seguir', 3000);
          break;
        default:
          break;
      }
    }
  }

  onHandStart(view) {
    this.lastHand = view.handNumber;
    this.el.board.innerHTML = '';
    this.boardEls = [];
    this.el.banner.hidden = true;
    this.equityCache = { key: '', value: null };
    for (const [, S] of this.seatEls) {
      S.bubble.classList.remove('show');
      S.handName.classList.remove('show');
      S.root.classList.remove('winner');
      S.sig = null;
    }
    sfx.deal();
    const n = view.players.filter((p) => p && p.holeCount > 0).length;
    for (let i = 0; i < n * 2; i++) setTimeout(() => sfx.deal(i), ms(90 * i));
  }

  showAction(ev, view) {
    const S = this.seatEls.get(ev.seat);
    if (!S) return;
    const a = ev.action || {};
    const allIn = a.allIn;
    const type = allIn ? 'allin' : a.type;
    let text = ACTION_TEXT[a.type] || '';
    if (allIn) text = 'ALL-IN';
    else if (a.type === 'raise' || a.type === 'bet') text += ' ' + (a.to || a.amount).toLocaleString('es-ES');
    else if (a.type === 'call') text += ' ' + (a.amount || 0).toLocaleString('es-ES');

    S.bubble.textContent = text;
    S.bubble.className = 'action-bubble show ' + type;
    clearTimeout(S.bubbleTimer);
    S.bubbleTimer = setTimeout(() => S.bubble.classList.remove('show'), ms(2400));

    if (allIn) sfx.allin();
    else if (a.type === 'fold') sfx.fold();
    else if (a.type === 'check') sfx.check();
    else if (a.type === 'call') sfx.chip(2);
    else if (a.type === 'bet') sfx.bet();
    else if (a.type === 'raise') sfx.raise();

    if (allIn) {
      const rect = rectIn(S.root, this.el.fx);
      floatText(this.el.fx, rect, 'ALL-IN', 'loss');
    }
  }

  /** Las apuestas de la calle vuelan al centro cuando se cierra la ronda. */
  collectBetsToPot(view) {
    const potRect = rectIn(this.el.potWrap, this.el.fx);
    const prev = this.prev;
    if (!prev) return;
    for (const p of prev.players) {
      if (!p || !p.bet) continue;
      const S = this.seatEls.get(p.seat);
      if (!S) continue;
      const from = rectIn(S.bet, this.el.fx);
      this.flyChips(from, potRect, p.bet, 3);
    }
    setTimeout(() => sfx.pot(), ms(380));
  }

  flyChips(from, to, amount, count = 3) {
    if (motion.reduced) return;
    const values = chipBreakdown(amount).slice(0, count);
    values.forEach((v, i) => {
      const chip = makeChipEl(v);
      chip.style.position = 'absolute';
      this.el.fx.appendChild(chip);
      const jitterTo = { cx: to.cx + (Math.random() - 0.5) * 26, cy: to.cy + (Math.random() - 0.5) * 14 };
      setTimeout(() => {
        flyTo(chip, from, jitterTo, { duration: 480, arc: 40 + Math.random() * 30, spin: 180 }).then(() => chip.remove());
      }, ms(i * 70));
    });
  }

  async celebrate(results, view) {
    if (!results) return;
    const potRect = rectIn(this.el.potWrap, this.el.fx);
    const me = this.me();
    let iWon = false;
    let bestLine = '';

    for (const pot of results.pots) {
      for (const w of pot.winners) {
        const S = this.seatEls.get(w.seat);
        if (!S) continue;
        const to = rectIn(S.root, this.el.fx);
        this.flyChips(potRect, to, w.amount, 4);
        setTimeout(() => {
          floatText(this.el.fx, to, '+' + w.amount.toLocaleString('es-ES'));
          sfx.chip(3);
        }, ms(420));
        const player = view.players[w.seat];
        if (player) {
          if (me && player.seat === me.seat) iWon = true;
          if (!bestLine) {
            bestLine = `${player.name} gana ${w.amount.toLocaleString('es-ES')}`;
            if (w.name) bestLine += ` con ${w.name}`;
          }
        }
      }
    }

    this.banner(iWon ? '¡Ganas el bote!' : 'Fin de la mano', bestLine, 3200);
    if (iWon) {
      sfx.win();
      if (this.settings.confetti) {
        const r = this.el.confetti.getBoundingClientRect();
        confettiBurst(r.width / 2, r.height * 0.45, 110, 1.15);
        coinRain(34);
      }
    } else if (me && me.status !== 'folded' && me.holeCount > 0) {
      sfx.lose();
    }
  }

  throwEmote(ev, view) {
    const S = this.seatEls.get(ev.from);
    if (!S) return;
    const from = rectIn(S.root, this.el.fx);
    const target = ev.to >= 0 ? this.seatEls.get(ev.to) : null;
    const to = target ? rectIn(target.root, this.el.fx) : { cx: from.cx, cy: from.cy - 90 };
    const el = document.createElement('div');
    el.className = 'float-text emoji';
    el.textContent = ev.emoji;
    el.style.position = 'absolute';
    this.el.fx.appendChild(el);
    flyTo(el, from, to, { duration: 900, arc: 110, spin: 360, scaleTo: 1.5 }).then(() => {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(350), fill: 'forwards' }).finished.catch(() => {}).then(() => el.remove());
    });
    sfx.emote();
  }

  banner(title, sub, duration = 2600) {
    const el = this.el.banner;
    el.innerHTML = `<div class="banner-title">${escapeHtml(title)}</div>${sub ? `<div class="banner-sub">${escapeHtml(sub)}</div>` : ''}`;
    el.hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      el.hidden = true;
    }, ms(duration));
  }

  toast(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => (el.hidden = true), 300);
    }, 2600);
  }

  // ------------------------------------------------------------- reloj/turno

  startClock() {
    const loop = () => {
      this.tickTimer();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  tickTimer() {
    const view = this.view;
    if (!view) return;
    const total = (view.config && view.config.turnSeconds ? view.config.turnSeconds : 30) * 1000;
    for (const [seatIndex, S] of this.seatEls) {
      const acting = view.toAct === seatIndex && view.deadline > 0;
      if (!acting) {
        S.bar.style.strokeDashoffset = '0';
        S.ring.setAttribute('class', 'timer-ring');
        continue;
      }
      const left = Math.max(0, view.deadline - (Date.now() + this.clockOffset));
      const frac = Math.max(0, Math.min(1, left / total));
      S.bar.style.strokeDashoffset = String(125.6 * (1 - frac));
      S.ring.setAttribute('class', 'timer-ring' + (frac < 0.2 ? ' danger' : frac < 0.45 ? ' warn' : ''));
      // Ticks solo en tu turno y en los ultimos segundos.
      const secs = Math.ceil(left / 1000);
      if (view.players[seatIndex] && view.players[seatIndex].isYou && secs <= 5 && secs !== this._lastTick) {
        this._lastTick = secs;
        if (secs > 0) sfx.tick(secs <= 3);
      }
    }
  }

  // ----------------------------------------------------------------- cartas

  makeCard(card, faceDown) {
    const el = document.createElement('div');
    el.className = 'card' + (faceDown ? ' face-down' : '');
    el.innerHTML = `<div class="card-inner">
        <div class="card-face card-front"></div>
        <div class="card-face card-back"></div>
      </div>`;
    if (card) this.setCardFace(el, card);
    return el;
  }

  setCardFace(el, card) {
    const r = RANK_LABEL[card.r];
    const s = SUIT_GLYPH[card.s];
    el.dataset.code = card.r + card.s;
    el.classList.remove('suit-s', 'suit-h', 'suit-d', 'suit-c');
    el.classList.add('suit-' + card.s);
    el.querySelector('.card-front').innerHTML =
      `<span class="corner">${r}<small>${s}</small></span>
       <span class="pip">${s}</span>
       <span class="corner bottom">${r}<small>${s}</small></span>`;
  }

  mmss(msLeft) {
    const t = Math.max(0, Math.floor(msLeft / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.stopTitleFlash();
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
