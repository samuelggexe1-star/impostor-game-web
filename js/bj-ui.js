// Pantalla de blackjack.

import { RANK_LABEL, SUIT_GLYPH } from './cards.js';
import { sfx } from './sound.js';
import { motion, ms, initConfetti, confettiBurst, animateOnce } from './fx.js';

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
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList'),
      badge: document.querySelector('#bjGame .chat-badge')
    };
    initConfetti(this.el.confetti);
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
  }

  render() {
    const v = this.view;
    this.el.ronda.textContent = v.ronda;

    // Banca
    const firma = v.banca.cartas.map((c) => (c ? c.r + c.s : 'x')).join(',');
    if (firma !== this._firmaBanca) {
      this._firmaBanca = firma;
      this.el.banca.innerHTML = '';
      v.banca.cartas.forEach((c, i) => {
        const el = crearCarta(c, !c);
        this.el.banca.appendChild(el);
        if (!motion.reduced) {
          animateOnce(el, [{ transform: 'translateY(-40px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: ms(320), delay: ms(i * 90), easing: 'cubic-bezier(.2,.9,.24,1)', fill: 'backwards' });
        }
      });
    }
    this.el.bancaTotal.textContent = v.banca.total != null ? v.banca.total : '';

    // Jugadores
    this.el.jugadores.innerHTML = '';
    for (const p of v.jugadores) {
      const el = document.createElement('div');
      el.className = 'bj-jugador' + (p.esTuTurno ? ' turno' : '');
      const manos = p.manos.map((m, i) => {
        const cartas = m.cartas.map((c) => {
          const cc = crearCarta(c);
          return cc.outerHTML;
        }).join('');
        const activa = p.esTuTurno && v.manoActiva === i ? ' activa' : '';
        const res = m.resultado
          ? `<span class="m-res ${m.resultado}">${{ gana: 'Gana', pierde: 'Pierde', empata: 'Empate', blackjack: 'BLACKJACK' }[m.resultado]}${m.premio ? ' +' + m.premio : ''}</span>`
          : '';
        return `<div class="bj-mano${activa}">
            <div class="bj-cartas-mano">${cartas}</div>
            <div class="m-info"><span class="m-total">${m.total}${m.blanda ? ' blando' : ''}</span> · ${m.apuesta}${m.doblada ? ' ×2' : ''}</div>
            ${res}
          </div>`;
      }).join('');
      el.innerHTML = `<div class="j-cab">${p.avatar} ${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</div>
        <div class="j-fichas">${p.fichas.toLocaleString('es-ES')} fichas</div>
        ${manos || '<div class="m-info">sin jugar</div>'}`;
      this.el.jugadores.appendChild(el);
    }

    // Controles
    const yo = this.yo();
    const enApuestas = v.estado === 'apuestas';
    const o = v.opciones || {};
    this.el.apuestas.hidden = !enApuestas || !yo || (yo && yo.apuesta > 0);
    this.el.acciones.hidden = !o.tuTurno;
    if (o.tuTurno) {
      this.el.pedir.disabled = !o.puedePedir;
      this.el.doblar.hidden = !o.puedeDoblar;
      this.el.dividir.hidden = !o.puedeDividir;
    }

    if (enApuestas) {
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
          if (p && p.soyYo) { this.aviso('Te has pasado', `${ev.total} puntos`, 1800); sfx.lose(); }
          break;
        }
        case 'destapa': sfx.flip(); break;
        case 'pagos': this.mostrarPagos(ev.resultados); break;
        case 'chat': sfx.chat(); this.bumpBadge(); break;
        case 'recover': this.aviso('Mesa reanudada', '', 1500); break;
        default: break;
      }
    }
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
    clearTimeout(this._t);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
