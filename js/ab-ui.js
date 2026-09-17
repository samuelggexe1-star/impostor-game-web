// Pantalla de alto o bajo.

import { RANK_LABEL, SUIT_GLYPH } from './cards.js';
import { sfx } from './sound.js';
import { motion, ms, rectIn, floatText, initConfetti, confettiBurst, animateOnce } from './fx.js';

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
      fx: $('abFx'),
      fogonazo: $('abFogonazo'),
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList'),
      badge: document.querySelector('#abGame .chat-badge')
    };
    initConfetti(this.el.confetti);
    for (const el of [this.el.jugadores, this.el.carta, this.el.historial, this.el.fx]) {
      if (el) el.innerHTML = '';
    }
    this._firma = null;
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
    // El volteo gordo lo lanza animar(), asi que render() no pone el suyo.
    this._volteoPendiente = (eventos || []).some((e) => e.t === 'revela');
    this.view = view;
    this.render();
    this.animar(eventos || []);
    this._volteoPendiente = false;
  }

  render() {
    const v = this.view;
    this.el.ronda.textContent = v.ronda;
    this.el.mano.textContent = v.mano;

    // Jugadores con sus vidas
    this.el.jugadores.innerHTML = v.jugadores.map((p) => {
      const vidas = '❤️'.repeat(Math.max(0, p.vidas)) + '🖤'.repeat(Math.max(0, v.vidasMax - p.vidas));
      return `<div class="ab-jugador${p.vivo ? '' : ' fuera'}${p.apuesta ? ' listo' : ''}${p.racha >= 3 ? ' ardiendo' : ''}" data-id="${escapeHtml(p.id)}">
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
        // Sin 'saliendo' cuando toca el volteo largo: lo lanza animar().
        if (!this._volteoPendiente) el.classList.add('saliendo');
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
          const subio = ev.acertada === 'alto';
          this.alHistorial(ev.anterior);
          this.voltear(subio, ev.empate);
          const yo = this.view.jugadores.find((p) => p.soyYo);
          const mio = yo && ev.detalle.find((d) => d.id === yo.id);

          // Cada jugador se lleva su reacción: puntos, corazón roto o llamas.
          for (const d of ev.detalle) {
            if (d.resultado === 'acierta') {
              this.puntosFlotantes(d.id, '+' + d.puntos, 'win');
              if (d.racha >= 3) this.llamarada(d.id, d.racha);
            } else if (d.resultado === 'falla') {
              this.corazonRoto(d.id);
              if (d.vidas <= 0) this.eliminado(d.id);
            }
          }

          if (ev.empate) this.aviso('¡Empate!', 'Misma carta: no cuenta', 'bien', 1600);
          else if (mio && mio.resultado === 'acierta') {
            this.aviso('¡Bien!', `+${mio.puntos} punto${mio.puntos > 1 ? 's' : ''}${mio.racha >= 3 ? ` · racha de ${mio.racha} 🔥` : ''}`, 'bien', 1700);
            this.fogonazo(true);
            sfx.win();
          } else if (mio && mio.resultado === 'falla') {
            this.aviso('Fallaste', `Te quedan ${mio.vidas} vida${mio.vidas === 1 ? '' : 's'}`, 'mal', 1700);
            this.fogonazo(false);
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

  // ------------------------------------------------------ piezas de animación

  /**
   * El momento gordo del juego: la carta nueva llega tapada, da la vuelta y
   * detrás sale una flecha verde o roja segun haya subido o bajado.
   */
  voltear(subio, empate) {
    const carta = this.el.carta.querySelector('.card');
    if (!carta || motion.reduced) return;
    const inner = carta.querySelector('.card-inner') || carta;
    animateOnce(inner, [
      { transform: 'rotateY(180deg) translateY(-26px) scale(.72)', opacity: .25 },
      { transform: 'rotateY(96deg) translateY(-10px) scale(1.18)', opacity: 1, offset: .42 },
      { transform: 'rotateY(18deg) scale(1.08)', offset: .74 },
      { transform: 'rotateY(0deg) scale(1)' }
    ], { duration: ms(760), easing: 'cubic-bezier(.24,.85,.3,1.05)' });
    if (!empate) this.flecha(subio);
  }

  /** La carta anterior se encoge y se va al historial de arriba. */
  alHistorial(carta) {
    const capa = this.el.fx;
    if (!capa || !carta || motion.reduced) return;
    const destino = this.el.historial.lastElementChild || this.el.historial;
    const a = rectIn(this.el.carta, capa);
    const b = rectIn(destino, capa);
    if (!a.w || !b.w) return;
    const el = crearCarta(carta);
    el.style.position = 'absolute';
    el.style.left = a.cx + 'px';
    el.style.top = a.cy + 'px';
    el.style.transform = 'translate(-50%,-50%)';
    el.style.setProperty('--cw', a.w + 'px');
    capa.appendChild(el);
    animateOnce(el, [
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${(b.cx - a.cx) * .55}px, ${(b.cy - a.cy) * .55}px) scale(.55) rotate(-8deg)`, opacity: .85, offset: .6 },
      { transform: `translate(-50%,-50%) translate(${b.cx - a.cx}px, ${b.cy - a.cy}px) scale(${b.w / a.w}) rotate(0deg)`, opacity: 0 }
    ], { duration: ms(620), easing: 'cubic-bezier(.3,.7,.3,1)' })
      .finished.catch(() => {}).then(() => el.remove());
  }

  /** Flecha grande detrás de la carta: ▲ si ha subido, ▼ si ha bajado. */
  flecha(subio) {
    const capa = this.el.fx;
    if (!capa) return;
    const r = rectIn(this.el.carta, capa);
    const el = document.createElement('div');
    el.className = 'ab-flecha ' + (subio ? 'sube' : 'baja');
    el.textContent = subio ? '▲' : '▼';
    el.style.left = r.cx + 'px';
    el.style.top = r.cy + 'px';
    capa.appendChild(el);
    const dy = subio ? -1 : 1;
    animateOnce(el, [
      { transform: `translate(-50%,-50%) translateY(${dy * 70}px) scale(.4)`, opacity: 0 },
      { transform: 'translate(-50%,-50%) translateY(0) scale(1.35)', opacity: .85, offset: .35 },
      { transform: `translate(-50%,-50%) translateY(${dy * -90}px) scale(1.7)`, opacity: 0 }
    ], { duration: ms(1100), delay: ms(300), easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' })
      .finished.catch(() => {}).then(() => el.remove());
  }

  /** Destello verde o rojo por toda la mesa segun tu resultado. */
  fogonazo(bien) {
    const el = this.el.fogonazo;
    if (!el || motion.reduced) return;
    el.style.setProperty('--tono', bien ? 'rgba(53,208,127,.34)' : 'rgba(255,95,109,.34)');
    animateOnce(el, [{ opacity: 0 }, { opacity: 1, offset: .16 }, { opacity: 0 }],
      { duration: ms(680), easing: 'ease-out' });
  }

  /** Corazón que se parte cuando alguien pierde una vida. */
  corazonRoto(id) {
    const plato = this.el.jugadores.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const capa = this.el.fx;
    if (!plato || !capa || motion.reduced) return;
    const vidas = plato.querySelector('.a-vidas');
    const r = rectIn(vidas || plato, capa);
    for (const lado of [-1, 1]) {
      const trozo = document.createElement('div');
      trozo.className = 'ab-trozo';
      trozo.textContent = '💔';
      trozo.style.left = r.cx + 'px';
      trozo.style.top = r.cy + 'px';
      trozo.style.clipPath = lado < 0 ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)';
      capa.appendChild(trozo);
      animateOnce(trozo, [
        { transform: 'translate(-50%,-50%) scale(1.5) rotate(0deg)', opacity: 1 },
        { transform: `translate(-50%,-50%) translate(${lado * 30}px, 40px) scale(.9) rotate(${lado * 42}deg)`, opacity: 0 }
      ], { duration: ms(900), easing: 'cubic-bezier(.4,.1,.7,1)' })
        .finished.catch(() => {}).then(() => trozo.remove());
    }
    animateOnce(plato, [{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }],
      { duration: ms(320), easing: 'ease-in-out' });
  }

  /** Llamaradas para quien lleva racha. */
  llamarada(id, racha) {
    const plato = this.el.jugadores.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const capa = this.el.fx;
    if (!plato || !capa || motion.reduced) return;
    const r = rectIn(plato, capa);
    for (let i = 0; i < Math.min(6, 2 + racha); i++) {
      const f = document.createElement('div');
      f.className = 'ab-llama';
      f.textContent = '🔥';
      f.style.left = (r.x + Math.random() * r.w) + 'px';
      f.style.top = (r.y + r.h - 6) + 'px';
      capa.appendChild(f);
      animateOnce(f, [
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
        { transform: 'translate(-50%,-50%) translateY(-22px) scale(1.1)', opacity: 1, offset: .35 },
        { transform: `translate(-50%,-50%) translate(${(Math.random() - .5) * 26}px, -58px) scale(.5)`, opacity: 0 }
      ], { duration: ms(1000), delay: ms(i * 90), easing: 'ease-out', fill: 'backwards' })
        .finished.catch(() => {}).then(() => f.remove());
    }
  }

  /** Sello de eliminado sobre la placa de quien se queda sin vidas. */
  eliminado(id) {
    const plato = this.el.jugadores.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const capa = this.el.fx;
    if (!plato || !capa || motion.reduced) return;
    const r = rectIn(plato, capa);
    const s = document.createElement('div');
    s.className = 'ab-sello';
    s.textContent = 'FUERA';
    s.style.left = r.cx + 'px';
    s.style.top = r.cy + 'px';
    capa.appendChild(s);
    animateOnce(s, [
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(.95)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(1)', opacity: 1, offset: .7 },
      { transform: 'translate(-50%,-50%) rotate(-12deg) scale(1.15)', opacity: 0 }
    ], { duration: ms(1800), easing: 'cubic-bezier(.2,1.5,.3,1)' })
      .finished.catch(() => {}).then(() => s.remove());
    sfx.allin();
  }

  /** Puntos que suben flotando junto a quien acierta. */
  puntosFlotantes(id, texto, clase) {
    const plato = this.el.jugadores.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!plato || !this.el.fx || motion.reduced) return;
    const r = rectIn(plato, this.el.fx);
    floatText(this.el.fx, { cx: r.cx, cy: r.y }, texto, clase);
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
    if (this.el.fx) this.el.fx.innerHTML = '';
    clearTimeout(this._t);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
