// Pantalla de alto o bajo.

import { RANK_LABEL, SUIT_GLYPH } from './cards.js';
import { sfx } from './sound.js';
import { motion, ms, initConfetti, confettiBurst, animateOnce } from './fx.js';

function crearCarta(c) {
  const el = document.createElement('div');
  if (!c) {
    el.className = 'card face-down';
    el.innerHTML = '<div class="card-inner"><div class="card-face card-front"></div><div class="card-face card-back"></div></div>';
    return el;
  }
  el.className = 'card suit-' + c.s;
  el.innerHTML = `<div class="card-inner"><div class="card-face card-front">
      <span class="corner">${RANK_LABEL[c.r]}<small>${SUIT_GLYPH[c.s]}</small></span>
      <span class="pip">${SUIT_GLYPH[c.s]}</span>
      <span class="corner bottom">${RANK_LABEL[c.r]}<small>${SUIT_GLYPH[c.s]}</small></span>
    </div><div class="card-face card-back"></div></div>`;
  return el;
}

export class AltoBajoUI {
  constructor({ session, settings }) {
    this.session = session;
    this.settings = settings;
    this.view = null;
    this.clockOffset = 0;
    this.sinLeer = 0;
    this.el = {};
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      jugadores: $('abJugadores'),
      carta: $('abCarta'),
      historial: $('abHistorial'),
      reloj: $('abRelojBarra'),
      alto: $('abAlto'),
      bajo: $('abBajo'),
      estado: $('abEstado'),
      aviso: $('abAviso'),
      ronda: $('abRonda'),
      mano: $('abMano'),
      roomCode: $('abRoomCode'),
      confetti: $('abConfetti'),
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList'),
      badge: document.querySelector('#abGame .chat-badge')
    };
    initConfetti(this.el.confetti);
    this.el.alto.onclick = () => this.apostar('alto');
    this.el.bajo.onclick = () => this.apostar('bajo');
    this.session.on('state', (v, e) => this.onState(v, e));
    this.session.on('hostgone', () => this.aviso('Se ha cerrado la partida', '', 'mal'));
    this.tick();
  }

  apostar(cual) {
    const v = this.view;
    if (!v || v.estado !== 'apuestas') return;
    const yo = v.jugadores.find((p) => p.soyYo);
    if (!yo || !yo.vivo || v.tuApuesta) return;
    this.session.act('apostar', { apuesta: cual });
    sfx.turn();
  }

  onState(view, eventos) {
    this.clockOffset = view.now ? view.now - Date.now() : 0;
    this.view = view;
    this.render();
    this.animar(eventos || []);
  }

  render() {
    const v = this.view;
    this.el.ronda.textContent = v.ronda;
    this.el.mano.textContent = v.mano;

    // Jugadores con sus vidas
    this.el.jugadores.innerHTML = v.jugadores.map((p) => {
      const vidas = '❤️'.repeat(Math.max(0, p.vidas)) + '🖤'.repeat(Math.max(0, v.vidasMax - p.vidas));
      return `<div class="ab-jugador${p.vivo ? '' : ' fuera'}${p.apuesta ? ' listo' : ''}">
        <span class="a-avatar">${p.avatar}</span>
        <span>
          <span class="a-nombre">${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</span>
          <span class="a-vidas">${vidas}</span>
        </span>
        <span class="a-puntos">${p.puntos} pts</span>
        ${p.racha >= 2 ? `<span class="a-racha">🔥${p.racha}</span>` : ''}
      </div>`;
    }).join('');

    // Carta en mesa
    const firma = v.carta ? v.carta.r + v.carta.s : '';
    if (firma !== this._firma) {
      this._firma = firma;
      this.el.carta.innerHTML = '';
      if (v.carta) {
        const el = crearCarta(v.carta);
        el.classList.add('saliendo');
        this.el.carta.appendChild(el);
      }
    }

    // Últimas cartas
    this.el.historial.innerHTML = (v.reveladas || []).slice(0, -1).slice(-6)
      .map((c) => `<div class="mini-card${c.s === 'h' || c.s === 'd' ? ' red' : ''}">${RANK_LABEL[c.r]}${SUIT_GLYPH[c.s]}</div>`)
      .join('');

    // Botones
    const yo = v.jugadores.find((p) => p.soyYo);
    const puede = v.estado === 'apuestas' && yo && yo.vivo && !v.tuApuesta;
    this.el.alto.disabled = !puede;
    this.el.bajo.disabled = !puede;
    this.el.alto.classList.toggle('elegida', v.tuApuesta === 'alto');
    this.el.bajo.classList.toggle('elegida', v.tuApuesta === 'bajo');

    if (!yo) this.el.estado.textContent = 'Estás mirando la partida';
    else if (!yo.vivo) this.el.estado.innerHTML = 'Sin vidas. Esperando a la siguiente ronda…';
    else if (v.estado === 'finRonda') this.el.estado.textContent = 'Ronda terminada';
    else if (v.tuApuesta) this.el.estado.innerHTML = `Has dicho <b>${v.tuApuesta === 'alto' ? 'más alta' : 'más baja'}</b>. Esperando…`;
    else if (v.estado === 'apuestas') this.el.estado.innerHTML = '¿La siguiente será más alta o más baja?';
    else this.el.estado.textContent = 'Preparando…';

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
          <div class="history-head"><span>Ronda ${r.ronda}</span><span>${r.cartas} cartas</span></div>
          <div class="history-win">Aguanta <b>${escapeHtml(r.ganador)}</b></div></div>`).join('')
      : '<p class="hint">Aquí aparecerán las rondas.</p>';
    this.el.statsList.innerHTML = [...v.jugadores].sort((a, b) => b.puntos - a.puntos)
      .map((p) => `<div class="stat-row">
        <span class="s-avatar">${p.avatar}</span>
        <span class="s-name">${escapeHtml(p.nombre)}</span>
        <span class="s-nums"><span>rondas<b>${p.rondasGanadas}</b></span><span>mejor racha<b>${p.mejorRacha}</b></span></span>
        <span class="s-chips">${p.puntos} pts</span></div>`).join('');
  }

  animar(eventos) {
    for (const ev of eventos) {
      switch (ev.t) {
        case 'nuevaRonda':
          this.aviso(`Ronda ${ev.ronda}`, 'Tres vidas para cada uno', 'bien', 1800);
          sfx.deal();
          break;
        case 'revela': {
          sfx.flip();
          const yo = this.view.jugadores.find((p) => p.soyYo);
          const mio = yo && ev.detalle.find((d) => d.id === yo.id);
          if (ev.empate) this.aviso('¡Empate!', 'Misma carta: no cuenta', 'bien', 1600);
          else if (mio && mio.resultado === 'acierta') {
            this.aviso('¡Bien!', `+${mio.puntos} punto${mio.puntos > 1 ? 's' : ''}${mio.racha >= 3 ? ` · racha de ${mio.racha} 🔥` : ''}`, 'bien', 1700);
            sfx.win();
          } else if (mio && mio.resultado === 'falla') {
            this.aviso('Fallaste', `Te quedan ${mio.vidas} vida${mio.vidas === 1 ? '' : 's'}`, 'mal', 1700);
            sfx.lose();
          }
          break;
        }
        case 'finRonda': {
          const gan = this.view.jugadores.find((p) => p.id === ev.ganador);
          const gane = gan && gan.soyYo;
          this.aviso(gane ? '¡Has aguantado!' : `Gana ${gan ? gan.nombre : 'nadie'}`, '+5 puntos', gane ? 'bien' : 'mal', 3000);
          if (gane) {
            sfx.win();
            if (this.settings.confetti) {
              const r = this.el.confetti.getBoundingClientRect();
              confettiBurst(r.width / 2, r.height * 0.4, 110, 1.2);
            }
          }
          break;
        }
        case 'chat': sfx.chat(); this.bumpBadge(); break;
        case 'recover': this.aviso('Partida reanudada', '', 'bien', 1500); break;
        default: break;
      }
    }
  }

  /** Barra de cuenta atras. */
  tick() {
    const bucle = () => {
      const v = this.view;
      if (v && v.deadline > 0 && v.config) {
        const total = v.config.segundosPorCarta * 1000;
        const queda = Math.max(0, v.deadline - (Date.now() + this.clockOffset));
        this.el.reloj.style.width = Math.min(100, (queda / total) * 100) + '%';
      } else if (this.el.reloj) {
        this.el.reloj.style.width = '0%';
      }
      this._raf = requestAnimationFrame(bucle);
    };
    this._raf = requestAnimationFrame(bucle);
  }

  aviso(titulo, sub, clase = 'bien', duracion = 2000) {
    const el = this.el.aviso;
    el.className = 'ab-aviso ' + clase;
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
    cancelAnimationFrame(this._raf);
    clearTimeout(this._t);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
