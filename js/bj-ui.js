// Pantalla de blackjack.

import { RANK_LABEL, SUIT_GLYPH } from './cards.js';
import { sfx } from './sound.js';
import { motion, ms, rectIn, floatText, makeChipEl, chipBreakdown, initConfetti, confettiBurst, animateOnce, avisarTurno, pararParpadeo } from './fx.js';

const FICHAS = [10, 25, 50, 100, 250];
const COLOR_FICHA = { 10: '#e9eef5', 25: '#1f7a43', 50: '#b02b2b', 100: '#14202b', 250: '#2b2f77' };

function crearCarta(c, tapada = false) {
  const el = document.createElement('div');
  if (!c || tapada) {
    el.className = 'card face-down';
    el.innerHTML = '<div class="card-inner"><div class="card-face card-front"></div><div class="card-face card-back"></div></div>';
    return el;
  }
  const roja = c.s === 'h' || c.s === 'd';
  el.className = 'card suit-' + c.s;
  el.innerHTML = `<div class="card-inner"><div class="card-face card-front">
      <span class="corner">${RANK_LABEL[c.r]}<small>${SUIT_GLYPH[c.s]}</small></span>
      <span class="pip">${SUIT_GLYPH[c.s]}</span>
      <span class="corner bottom">${RANK_LABEL[c.r]}<small>${SUIT_GLYPH[c.s]}</small></span>
    </div><div class="card-face card-back"></div></div>`;
  return el;
}

export class BlackjackUI {
  constructor({ session, settings }) {
    this.session = session;
    this.settings = settings;
    this.view = null;
    this.apuesta = 0;
    this.sinLeer = 0;
    this.el = {};
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      banca: $('bjBancaCartas'),
      bancaTotal: $('bjBancaTotal'),
      jugadores: $('bjJugadores'),
      apuestas: $('bjApuestas'),
      fichas: $('bjFichas'),
      monto: $('bjMonto'),
      confirmar: $('bjConfirmar'),
      quitar: $('bjQuitar'),
      recargar: $('bjRecargar'),
      acciones: $('bjAcciones'),
      pedir: $('bjPedir'),
      plantarse: $('bjPlantarse'),
      doblar: $('bjDoblar'),
      dividir: $('bjDividir'),
      estado: $('bjEstado'),
      aviso: $('bjAviso'),
      ronda: $('bjRonda'),
      roomCode: $('bjRoomCode'),
      confetti: $('bjConfetti'),
      fx: $('bjFx'),
      zapato: $('bjZapato'),
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList'),
      badge: document.querySelector('#bjGame .chat-badge')
    };
    initConfetti(this.el.confetti);
    this.el.banca.innerHTML = '';
    this.el.jugadores.innerHTML = '';
    this.el.fx.innerHTML = '';
    this._firmaBanca = null;
    this._conteo = new Map();
    this.construirFichas();
    this.bind();
    this.session.on('state', (v, e) => this.onState(v, e));
    this.session.on('hostgone', () => this.aviso('Se ha cerrado la mesa', ''));
  }

  construirFichas() {
    this.el.fichas.innerHTML = '';
    for (const v of FICHAS) {
      const b = document.createElement('button');
      b.className = 'bj-ficha';
      b.textContent = v;
      b.style.background = `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${COLOR_FICHA[v]} 70%, #fff 30%), ${COLOR_FICHA[v]})`;
      b.onclick = () => {
        this.apuesta += v;
        const max = this.view ? this.view.apuestaMax : 500;
        const mias = this.yo() ? this.yo().fichas : 0;
        this.apuesta = Math.min(this.apuesta, max, mias);
        this.el.monto.textContent = this.apuesta;
        sfx.chip(1);
      };
      this.el.fichas.appendChild(b);
    }
  }

  bind() {
    this.el.confirmar.onclick = () => {
      const min = this.view ? this.view.apuestaMin : 10;
      const cantidad = Math.max(min, this.apuesta);
      this.session.act('apostar', { cantidad });
      this.apuesta = 0;
      this.el.monto.textContent = '0';
      sfx.bet();
    };
    // Deshacer lo que llevas puesto sin tener que confirmarlo.
    this.el.quitar.onclick = () => {
      this.apuesta = 0;
      this.el.monto.textContent = '0';
      sfx.check();
    };
    // Sin fichas no se puede jugar: antes te quedabas mirando la mesa.
    this.el.recargar.onclick = () => {
      this.session.command('rebuy', { amount: 1000 });
      sfx.chip(3);
    };
    this.el.pedir.onclick = () => { this.session.act('pedir', {}); sfx.deal(); };
    this.el.plantarse.onclick = () => { this.session.act('plantarse', {}); sfx.check(); };
    this.el.doblar.onclick = () => { this.session.act('doblar', {}); sfx.raise(); };
    this.el.dividir.onclick = () => { this.session.act('dividir', {}); sfx.flip(); };
  }

  yo() {
    return this.view ? this.view.jugadores.find((p) => p.soyYo) : null;
  }

  onState(view, eventos) {
    this.prev = this.view;
    this.view = view;
    this.render();
    this.animar(eventos || []);
    // Te avisa tanto si te toca decidir como si toca apostar.
    const yo = this.yo();
    const meToca = !!(view.opciones && view.opciones.tuTurno) ||
      (view.estado === 'apuestas' && !!yo && yo.apuesta === 0 && yo.fichas > 0);
    if (meToca && !this._tocaba) { sfx.turn(); avisarTurno('🔔 ¡Te toca!'); }
    if (!meToca) pararParpadeo();
    this._tocaba = meToca;
  }

  render() {
    const v = this.view;
    this.el.ronda.textContent = v.ronda;

    // Banca
    const firma = v.banca.cartas.map((c) => (c ? c.r + c.s : 'x')).join(',');
    if (firma !== this._firmaBanca) {
      const antes = (this._firmaBanca || '').split(',').filter(Boolean);
      this._firmaBanca = firma;
      this.el.banca.innerHTML = '';
      v.banca.cartas.forEach((c, i) => {
        const el = crearCarta(c, !c);
        this.el.banca.appendChild(el);
        if (antes.length && antes[i] === 'x' && c) this.destapar(el);
        else if (i >= antes.length) this.entradaDesdeZapato(el, i * 110);
      });
    }
    this.el.bancaTotal.textContent = v.banca.total != null ? v.banca.total
      : (v.banca.visible != null ? v.banca.visible + '+?' : '');

    // Jugadores
    const nuevas = [];
    this.el.jugadores.innerHTML = '';
    for (const p of v.jugadores) {
      const el = document.createElement('div');
      el.className = 'bj-jugador' + (p.esTuTurno ? ' turno' : '');
      el.dataset.id = p.id;
      el.innerHTML = `<div class="j-cab">${p.avatar} ${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</div>
        <div class="j-fichas">${p.fichas.toLocaleString('es-ES')} fichas</div>`;
      if (!p.manos.length) el.insertAdjacentHTML('beforeend', '<div class="m-info">sin jugar</div>');
      p.manos.forEach((m, i) => {
        const mano = document.createElement('div');
        mano.className = 'bj-mano' + (p.esTuTurno && v.manoActiva === i ? ' activa' : '');
        mano.dataset.mano = i;
        const fila = document.createElement('div');
        fila.className = 'bj-cartas-mano';
        const clave = p.id + ':' + i;
        const antes = this._conteo.get(clave) || 0;
        m.cartas.forEach((c, j) => {
          const cc = crearCarta(c);
          fila.appendChild(cc);
          if (j >= antes) nuevas.push([cc, (j - antes) * 110]);
        });
        this._conteo.set(clave, m.cartas.length);
        mano.appendChild(fila);
        // Las fichas apostadas se ven, no solo el número.
        if (m.apuesta > 0) {
          const pila = document.createElement('div');
          pila.className = 'bj-pila';
          for (const valor of chipBreakdown(m.apuesta)) pila.appendChild(makeChipEl(valor));
          mano.appendChild(pila);
        }
        const res = m.resultado
          ? `<span class="m-res ${m.resultado}">${{ gana: 'Gana', pierde: 'Pierde', empata: 'Empate', blackjack: 'BLACKJACK' }[m.resultado]}${m.premio ? ' +' + m.premio : ''}</span>`
          : '';
        mano.insertAdjacentHTML('beforeend',
          `<div class="m-info"><span class="m-total">${m.total}${m.blanda ? ' blando' : ''}</span> · ${m.apuesta}${m.doblada ? ' ×2' : ''}</div>${res}`);
        el.appendChild(mano);
      });
      this.el.jugadores.appendChild(el);
    }
    // Al empezar una ronda nueva se olvidan los conteos y todo vuelve a animarse.
    if (v.estado === 'apuestas') this._conteo.clear();
    for (const [cc, retardo] of nuevas) this.entradaDesdeZapato(cc, retardo);

    // Controles
    const yo = this.yo();
    const enApuestas = v.estado === 'apuestas';
    const o = v.opciones || {};
    const sinFichas = !!yo && yo.fichas <= 0;
    this.el.apuestas.hidden = !enApuestas || !yo || sinFichas || (yo && yo.apuesta > 0);
    this.el.recargar.hidden = !sinFichas;
    this.el.quitar.hidden = this.apuesta <= 0;
    this.el.acciones.hidden = !o.tuTurno;
    if (o.tuTurno) {
      this.el.pedir.disabled = !o.puedePedir;
      this.el.doblar.hidden = !o.puedeDoblar;
      this.el.dividir.hidden = !o.puedeDividir;
    }

    if (sinFichas) {
      this.el.estado.innerHTML = 'Sin fichas. Recarga para seguir jugando.';
    } else if (enApuestas) {
      this.el.estado.innerHTML = yo && yo.apuesta > 0
        ? `Has apostado <b>${yo.apuesta}</b>. Esperando a los demás…`
        : `Haz tu apuesta (mínimo ${v.apuestaMin})`;
    } else if (o.tuTurno) {
      this.el.estado.innerHTML = `Tu turno · tienes <b>${o.total}</b>${o.blanda ? ' (blando)' : ''}`;
    } else if (v.estado === 'turnos') {
      const quien = v.jugadores.find((p) => p.id === v.turno);
      this.el.estado.innerHTML = `Turno de <b>${escapeHtml(quien ? quien.nombre : '…')}</b>`;
    } else if (v.estado === 'banca') {
      this.el.estado.textContent = 'Juega la banca…';
    } else if (v.estado === 'pagos') {
      this.el.estado.textContent = 'Pagando… siguiente ronda en unos segundos';
    } else {
      this.el.estado.textContent = 'Preparando la mesa…';
    }

    this.renderPanel();
  }

  renderPanel() {
    const v = this.view;
    const msgs = v.messages || [];
    if (this._nChat !== msgs.length) {
      this._nChat = msgs.length;
      this.el.chatLog.innerHTML = msgs.map((m) => m.system
        ? `<div class="chat-msg system">${escapeHtml(m.text)}</div>`
        : `<div class="chat-msg"><span>${m.avatar || '👤'}</span><div><span class="who">${escapeHtml(m.from)}</span><div class="text">${escapeHtml(m.text)}</div></div></div>`).join('');
      this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
    }
    const h = v.historial || [];
    this.el.historyList.innerHTML = h.length
      ? h.map((r) => `<div class="history-item">
          <div class="history-head"><span>Ronda ${r.ronda}</span><span>banca: ${r.banca}</span></div>
          ${r.ganadores.length
            ? r.ganadores.map((g) => `<div class="history-win"><b>${escapeHtml(g.nombre)}</b> +${g.premio}${g.blackjack ? ' · blackjack' : ''}</div>`).join('')
            : '<div class="history-win">gana la banca</div>'}
        </div>`).join('')
      : '<p class="hint">Aquí aparecerán las rondas.</p>';
    this.el.statsList.innerHTML = v.jugadores.map((p) => `<div class="stat-row">
        <span class="s-avatar">${p.avatar}</span>
        <span class="s-name">${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</span>
        <span class="s-nums"><span>rondas<b>${p.stats.rondas}</b></span><span>ganadas<b>${p.stats.ganadas}</b></span><span>BJ<b>${p.stats.blackjacks}</b></span></span>
        <span class="s-chips">${p.fichas}</span>
      </div>`).join('');
  }

  animar(eventos) {
    for (const ev of eventos) {
      switch (ev.t) {
        case 'reparto': sfx.deal(); break;
        case 'carta': case 'cartaBanca': sfx.flip(); break;
        case 'dobla': sfx.raise(); break;
        case 'pasado': {
          const p = this.view.jugadores.find((x) => x.id === ev.id);
          this.sello(ev.id, 'PASADO');
          if (p && p.soyYo) { this.aviso('Te has pasado', `${ev.total} puntos`, 1800); sfx.lose(); }
          else sfx.fold();
          break;
        }
        case 'destapa': sfx.flip(); break;
        case 'pagos':
          this.fichasDePago(ev.resultados);
          this.mostrarPagos(ev.resultados);
          break;
        case 'chat': this.burbuja(ev.msg); sfx.chat(); this.bumpBadge(); break;
        case 'recover': this.aviso('Mesa reanudada', '', 1500); break;
        default: break;
      }
    }
  }

  /** El bocadillo va encima de la placa del jugador. */
  anclaDe(msg) {
    const quien = this.view.jugadores.find((p) => p.nombre === msg.from);
    if (!quien) return null;
    return this.el.jugadores.querySelector(`[data-id="${CSS.escape(quien.id)}"]`);
  }

  /**
   * Bocadillo encima de quien habla. Sin esto los comentarios se quedan
   * escondidos en el panel lateral y no se entera nadie.
   */
  burbuja(msg) {
    if (!msg || msg.system || !this.el.fx || motion.reduced) return;
    const ancla = this.anclaDe(msg);
    const capa = this.el.fx;
    this._burbujas = this._burbujas || new Map();
    const clave = msg.from || '?';
    const vieja = this._burbujas.get(clave);
    if (vieja) {
      clearTimeout(vieja.timer);
      vieja.el.remove();
    }

    const el = document.createElement('div');
    el.className = 'speech';
    el.innerHTML = `<span class="who">${escapeHtml(msg.from)}</span>${escapeHtml(msg.text)}`;
    if (ancla) {
      const r = rectIn(ancla, capa);
      el.style.left = r.cx + 'px';
      // Arriba si cabe; si el jugador está pegado al borde, por debajo.
      if (r.y < 70) {
        el.classList.add('abajo');
        el.style.top = (r.y + r.h + 8) + 'px';
      } else {
        el.style.top = (r.y - 8) + 'px';
      }
    } else {
      el.style.left = '50%';
      el.style.top = '14%';
    }
    capa.appendChild(el);
    const base = el.classList.contains('abajo') ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
    animateOnce(el, [
      { transform: `${base} scale(.7)`, opacity: 0 },
      { transform: `${base} scale(1.06)`, opacity: 1, offset: .55 },
      { transform: `${base} scale(1)`, opacity: 1 }
    ], { duration: ms(320), easing: 'cubic-bezier(.2,1.3,.4,1)' });

    const timer = setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 450);
      this._burbujas.delete(clave);
    }, ms(4200));
    this._burbujas.set(clave, { el, timer });
  }

  /** Limpia los bocadillos pendientes al salir. */
  limpiarBurbujas() {
    if (!this._burbujas) return;
    for (const { el, timer } of this._burbujas.values()) {
      clearTimeout(timer);
      el.remove();
    }
    this._burbujas.clear();
  }

  // ------------------------------------------------------ piezas de animación

  /** Una carta recién repartida entra volando desde el zapato del crupier. */
  entradaDesdeZapato(el, retardo = 0) {
    if (motion.reduced || !this.el.zapato) return;
    const capa = this.el.fx;
    const a = rectIn(this.el.zapato, capa);
    const b = rectIn(el, capa);
    if (!b.w) return;
    const dx = a.cx - b.cx;
    const dy = a.cy - b.cy;
    animateOnce(el, [
      { transform: `translate(${dx}px, ${dy}px) rotate(-16deg) scale(.6)`, opacity: 0 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 24}px) rotate(-7deg) scale(1.08)`, opacity: 1, offset: .55 },
      { transform: 'none', opacity: 1 }
    ], { duration: ms(460), delay: ms(retardo), easing: 'cubic-bezier(.2,.9,.24,1)', fill: 'backwards' });
    if (this.el.zapato) {
      animateOnce(this.el.zapato, [{ transform: 'none' }, { transform: 'translateX(-5px) rotate(-3deg)' }, { transform: 'none' }],
        { duration: ms(260), delay: ms(retardo), easing: 'ease-out' });
    }
  }

  /** Vuelta de la carta tapada de la banca. */
  destapar(el) {
    if (motion.reduced) return;
    // El giro va sobre .card-inner, que es quien tiene la perspectiva del padre.
    const inner = el.querySelector('.card-inner') || el;
    animateOnce(inner, [
      { transform: 'rotateY(180deg) scale(.94)' },
      { transform: 'rotateY(90deg) scale(1.1)', offset: .5 },
      { transform: 'rotateY(0deg) scale(1)' }
    ], { duration: ms(520), easing: 'cubic-bezier(.3,.8,.3,1)' });
  }

  /** Sello rojo de "PASADO" sobre la placa de quien se pasa de 21. */
  sello(id, texto) {
    const plato = this.el.jugadores.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!plato || motion.reduced) return;
    const capa = this.el.fx;
    const r = rectIn(plato, capa);
    const s = document.createElement('div');
    s.className = 'bj-sello';
    s.textContent = texto;
    s.style.left = r.cx + 'px';
    s.style.top = r.cy + 'px';
    capa.appendChild(s);
    animateOnce(s, [
      { transform: 'translate(-50%,-50%) rotate(-14deg) scale(2.6)', opacity: 0 },
      { transform: 'translate(-50%,-50%) rotate(-14deg) scale(.92)', opacity: 1, offset: .25 },
      { transform: 'translate(-50%,-50%) rotate(-14deg) scale(1)', opacity: 1, offset: .75 },
      { transform: 'translate(-50%,-50%) rotate(-14deg) scale(1.1)', opacity: 0 }
    ], { duration: ms(1500), easing: 'cubic-bezier(.2,1.4,.3,1)' })
      .finished.catch(() => {}).then(() => s.remove());
    animateOnce(plato, [{ transform: 'none' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'none' }],
      { duration: ms(340), easing: 'ease-in-out' });
  }

  /** Fichas que viajan entre la banca y cada jugador al liquidar la ronda. */
  fichasDePago(res) {
    if (motion.reduced || !res || !res.detalle) return;
    const capa = this.el.fx;
    const banca = rectIn(this.el.banca, capa);
    let retardo = 0;
    for (const d of res.detalle) {
      const plato = this.el.jugadores.querySelector(`[data-id="${CSS.escape(d.id)}"]`);
      if (!plato) continue;
      const r = rectIn(plato, capa);
      const gana = d.premio > d.apuesta;
      const pierde = d.premio === 0;
      if (!gana && !pierde) continue;            // el empate no mueve fichas
      const desde = gana ? banca : r;
      const hasta = gana ? r : banca;
      for (const valor of chipBreakdown(gana ? d.premio - d.apuesta : d.apuesta)) {
        this.volarFicha(valor, desde, hasta, retardo);
        retardo += 70;
      }
      floatText(capa, { cx: r.cx, cy: r.y }, (gana ? '+' : '−') + (gana ? d.premio - d.apuesta : d.apuesta),
        gana ? 'win' : 'lose');
    }
  }

  volarFicha(valor, desde, hasta, retardo) {
    const capa = this.el.fx;
    const ficha = makeChipEl(valor);
    ficha.style.left = desde.cx + 'px';
    ficha.style.top = desde.cy + 'px';
    capa.appendChild(ficha);
    const dx = hasta.cx - desde.cx;
    const dy = hasta.cy - desde.cy;
    const desvio = (Math.random() - .5) * 46;
    animateOnce(ficha, [
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: `translate(-50%,-50%) translate(${dx * .5 + desvio}px, ${dy * .5 - 46}px) scale(1.1)`, opacity: 1, offset: .5 },
      { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(.85)`, opacity: 0 }
    ], { duration: ms(700), delay: ms(retardo), easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' })
      .finished.catch(() => {}).then(() => ficha.remove());
  }

  mostrarPagos(res) {
    const yo = this.yo();
    if (!yo || !res) return;
    const mio = res.detalle.filter((d) => d.id === yo.id);
    if (!mio.length) return;
    const ganado = mio.reduce((a, d) => a + d.premio, 0);
    const apostado = mio.reduce((a, d) => a + d.apuesta, 0);
    const bj = mio.some((d) => d.resultado === 'blackjack');
    if (bj) {
      this.aviso('¡BLACKJACK!', `+${ganado - apostado} fichas`, 2600);
      sfx.win();
      if (this.settings.confetti) {
        const r = this.el.confetti.getBoundingClientRect();
        confettiBurst(r.width / 2, r.height * 0.4, 110, 1.2);
      }
    } else if (ganado > apostado) {
      this.aviso('¡Ganas!', `+${ganado - apostado} fichas`, 2200);
      sfx.win();
    } else if (ganado === apostado) {
      this.aviso('Empate', 'Recuperas tu apuesta', 1800);
    } else {
      this.aviso('Gana la banca', `−${apostado - ganado} fichas`, 1800);
      sfx.lose();
    }
  }

  aviso(titulo, sub, duracion = 2000) {
    const el = this.el.aviso;
    el.innerHTML = `<div class="a-titulo">${escapeHtml(titulo)}</div>${sub ? `<div class="a-sub">${escapeHtml(sub)}</div>` : ''}`;
    el.hidden = false;
    clearTimeout(this._t);
    this._t = setTimeout(() => (el.hidden = true), ms(duracion));
  }

  bumpBadge() {
    if (document.getElementById('sidePanel').classList.contains('open')) return;
    this.sinLeer++;
    this.el.badge.textContent = this.sinLeer > 9 ? '9+' : String(this.sinLeer);
    this.el.badge.hidden = false;
  }

  clearChatBadge() {
    this.sinLeer = 0;
    this.el.badge.hidden = true;
  }

  destroy() {
    pararParpadeo();
    this.limpiarBurbujas();
    clearTimeout(this._t);
    if (this.el.fx) this.el.fx.innerHTML = '';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
