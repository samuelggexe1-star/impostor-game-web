// Pantalla del UNO: pinta la partida y anima las jugadas.
// Igual que en el poker, aqui no se deciden reglas: solo se representa el estado.

import { sfx } from './sound.js';
import { motion, ms, rectIn, floatText, initConfetti, confettiBurst, animateOnce } from './fx.js';

const SIMBOLO = { mas2: '+2', salta: '🚫', sentido: '🔄', mas4: '+4', comodin: '★' };
const COLOR_HEX = { rojo: '#e8443a', amarillo: '#f2c231', verde: '#2fae5a', azul: '#2f7fe0' };
const NOMBRE_COLOR = { rojo: 'rojo', amarillo: 'amarillo', verde: 'verde', azul: 'azul' };

/** Crea el elemento visual de una carta de UNO. */
export function crearCarta(carta, { mesa = false } = {}) {
  const el = document.createElement('div');
  const comodin = carta.valor === 'comodin' || carta.valor === 'mas4';
  el.className = 'ucard ' + (comodin && !carta.color ? 'comodin' : carta.color || 'comodin') + (mesa ? ' mesa' : '');
  el.dataset.carta = carta.id;
  const texto = SIMBOLO[carta.valor] || carta.valor;

  if (comodin) {
    el.innerHTML = `<span class="esquina ar">${carta.valor === 'mas4' ? '+4' : '★'}</span>
      <span class="rueda"><span>${carta.valor === 'mas4' ? '+4' : ''}</span></span>
      <span class="esquina ab">${carta.valor === 'mas4' ? '+4' : '★'}</span>`;
    if (carta.color) el.style.setProperty('--c', COLOR_HEX[carta.color]);
  } else {
    const subraya = texto === '6' || texto === '9' ? ' subraya' : '';
    el.innerHTML = `<span class="esquina ar${subraya}">${texto}</span>
      <span class="valor${subraya}">${texto}</span>
      <span class="esquina ab${subraya}">${texto}</span>`;
  }
  return el;
}

export class UnoUI {
  constructor({ session, settings }) {
    this.session = session;
    this.settings = settings;
    this.view = null;
    this.prev = null;
    this.clockOffset = 0;
    this.sinLeer = 0;
    this.el = {};
    this.manoRender = '';
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      rivales: $('unoRivales'),
      mazo: $('unoMazo'),
      mazoNum: $('unoMazoNum'),
      descarte: $('unoDescarte'),
      color: $('unoColor'),
      mano: $('unoMano'),
      estado: $('unoEstado'),
      robar: $('unoRobar'),
      pasar: $('unoPasar'),
      grito: $('unoGrito'),
      selector: $('unoSelector'),
      aviso: $('unoAviso'),
      ronda: $('unoRonda'),
      sentido: $('unoSentido'),
      roomCode: $('unoRoomCode'),
      net: $('unoNet'),
      chatBadge: $('unoChatBadge'),
      fx: $('unoFx'),
      confetti: $('unoConfetti'),
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList')
    };
    initConfetti(this.el.confetti);
    this.bind();
    this.session.on('state', (v, evs) => this.onState(v, evs));
    this.session.on('latency', (l) => {
      this.el.net.textContent = l + ' ms';
    });
    this.session.on('netstatus', (s) => (this.el.net.textContent = s));
    this.session.on('hostgone', () => this.aviso('Se ha cerrado la partida', ''));
  }

  bind() {
    this.el.mazo.onclick = () => {
      if (!this.esMiTurno()) return;
      this.session.act('robar', {});
      sfx.deal();
    };
    this.el.pasar.onclick = () => {
      this.session.act('pasar', {});
      sfx.check();
    };
    this.el.grito.onclick = () => {
      this.session.act('uno', {});
      sfx.win();
      this.aviso('¡UNO!', 'Te queda una carta', 1400);
    };
    this.el.selector.querySelectorAll('button[data-color]').forEach((b) => {
      b.onclick = () => {
        this.session.act('color', { color: b.dataset.color });
        this.el.selector.hidden = true;
        sfx.flip();
      };
    });
  }

  esMiTurno() {
    return !!this.view && this.view.turno === this.view.you && this.view.estado === 'jugando' && !this.view.esperaColor;
  }

  yo() {
    return this.view ? this.view.jugadores.find((p) => p.soyYo) : null;
  }

  // ------------------------------------------------------------------- ciclo

  onState(view, eventos) {
    this.clockOffset = view.now ? view.now - Date.now() : 0;
    this.prev = this.view;
    this.view = view;
    this.render();
    this.animar(eventos || []);
  }

  render() {
    const v = this.view;
    this.el.ronda.textContent = v.ronda || 1;
    this.el.sentido.textContent = v.sentido === 1 ? '→' : '←';

    this.renderRivales();
    this.renderCentro();
    this.renderMano();
    this.renderAcciones();
    this.renderPanel();
  }

  renderRivales() {
    const v = this.view;
    const otros = v.jugadores.filter((p) => !p.soyYo);
    this.el.rivales.innerHTML = '';
    for (const p of otros) {
      const el = document.createElement('div');
      el.className = 'uno-rival' + (p.esTuTurno ? ' turno' : '') + (p.ausente || p.esperando ? ' fuera' : '');
      const abanico = Array.from({ length: Math.min(7, p.cartas) }, () => '<i></i>').join('');
      el.innerHTML = `
        <span class="r-avatar">${p.avatar}</span>
        <span>
          <span class="r-nombre">${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</span>
          <span class="r-cartas">${p.esperando ? 'entra en la próxima ronda' : `${p.cartas} carta${p.cartas === 1 ? '' : 's'} · ${p.puntos} pts`}</span>
        </span>
        <span class="r-abanico">${abanico}</span>
        ${p.cartas === 1 && p.dijoUno ? '<span class="r-uno">UNO</span>' : ''}`;

      // Se le puede pillar si le queda una y no lo ha cantado
      const pillable = v.ventanaUno && v.ventanaUno.id === p.id && p.id !== v.you;
      if (pillable) {
        const b = document.createElement('button');
        b.className = 'uno-pillar';
        b.textContent = '¡Le pillé!';
        b.onclick = () => {
          this.session.act('pillar', { objetivo: p.id });
          sfx.raise();
        };
        el.appendChild(b);
      }
      this.el.rivales.appendChild(el);
    }
  }

  renderCentro() {
    const v = this.view;
    this.el.mazoNum.textContent = v.mazoRestante;
    this.el.mazo.disabled = !this.esMiTurno() || v.puedePasar;

    const arriba = v.arriba;
    const firma = arriba ? arriba.id + (arriba.color || '') : '';
    if (firma !== this._firmaMesa) {
      this._firmaMesa = firma;
      this.el.descarte.innerHTML = '';
      if (arriba) {
        const el = crearCarta(arriba, { mesa: true });
        this.el.descarte.appendChild(el);
        if (!motion.reduced) {
          animateOnce(el,
            [{ transform: 'translateY(-120px) rotate(-25deg) scale(.6)', opacity: 0 },
             { transform: 'translateY(4px) rotate(3deg) scale(1.06)', opacity: 1, offset: .7 },
             { transform: 'none', opacity: 1 }],
            { duration: ms(380), easing: 'cubic-bezier(.2,.9,.24,1)' });
        }
      }
    }
    const hex = COLOR_HEX[v.colorActual] || 'transparent';
    this.el.color.style.setProperty('--color-actual', hex);
    this.el.descarte.style.setProperty('--halo', hex);
  }

  renderMano() {
    const v = this.view;
    const mano = v.tuMano || [];
    const jugables = new Set(v.jugables || []);
    const firma = mano.map((c) => c.id).join(',') + '|' + [...jugables].join(',') + '|' + this.esMiTurno();
    if (firma === this.manoRender) return;
    const nuevas = new Set(mano.map((c) => c.id));
    const antes = new Set(this._cartasAntes || []);
    this.manoRender = firma;
    this._cartasAntes = [...nuevas];

    this.el.mano.innerHTML = '';
    const miTurno = this.esMiTurno();
    for (const carta of mano) {
      const el = crearCarta(carta);
      const puede = jugables.has(carta.id);
      // Solo se apagan las que no valen cuando de verdad te toca elegir.
      if (miTurno) el.classList.add(puede ? 'jugable' : 'no-jugable');
      if (!antes.has(carta.id) && antes.size) el.classList.add('entrando');
      el.onclick = () => this.intentarJugar(carta, puede);
      this.el.mano.appendChild(el);
    }
  }

  intentarJugar(carta, puede) {
    if (!this.esMiTurno()) {
      this.estado('No es tu turno todavía');
      return;
    }
    if (!puede) {
      this.estado('Esa carta no encaja: mismo color, mismo número o comodín');
      sfx.fold();
      return;
    }
    const comodin = carta.valor === 'comodin' || carta.valor === 'mas4';
    if (comodin) {
      this.cartaPendiente = carta.id;
      this.el.selector.hidden = false;
      this.session.act('jugar', { carta: carta.id });   // el servidor pedira color
      return;
    }
    this.session.act('jugar', { carta: carta.id });
    sfx.flip();
  }

  renderAcciones() {
    const v = this.view;
    const yo = this.yo();
    const miTurno = this.esMiTurno();

    this.el.robar.hidden = v.puedePasar;
    this.el.robar.disabled = !miTurno;
    this.el.pasar.hidden = !v.puedePasar;
    this.el.grito.disabled = !yo || yo.cartas > 2 || yo.dijoUno;

    // Selector de color: solo si me toca elegir a mi
    this.el.selector.hidden = v.esperaColor !== v.you;

    if (v.estado === 'finRonda') {
      const gan = v.jugadores.find((p) => p.id === v.ganador);
      this.estado(gan ? `${gan.nombre} se queda sin cartas · siguiente ronda en unos segundos` : 'Ronda terminada');
      return;
    }
    if (v.estado !== 'jugando') {
      this.estado(v.jugadores.length < 2 ? 'Esperando a que entre alguien más…' : 'Preparando la ronda…');
      return;
    }
    if (yo && yo.esperando) {
      this.estado('Has llegado con la ronda empezada: entras en la siguiente');
      return;
    }
    if (v.esperaColor) {
      const quien = v.jugadores.find((p) => p.id === v.esperaColor);
      this.estado(v.esperaColor === v.you ? 'Elige el color' : `${quien ? quien.nombre : 'Alguien'} está eligiendo color…`);
      return;
    }
    if (miTurno) {
      this.estado(v.puedePasar ? 'Puedes jugar la carta robada o pasar' : 'Te toca: echa una carta o roba');
    } else {
      const quien = v.jugadores.find((p) => p.id === v.turno);
      this.estado(`Turno de <b>${escapeHtml(quien ? quien.nombre : '…')}</b>`);
    }
  }

  estado(html) {
    this.el.estado.innerHTML = html;
  }

  /** Chat, rondas y puntos en el panel lateral (el mismo que usa el poker). */
  renderPanel() {
    const v = this.view;
    const msgs = v.messages || [];
    if (this._nChat !== msgs.length) {
      this._nChat = msgs.length;
      this.el.chatLog.innerHTML = msgs
        .map((m) => m.system
          ? `<div class="chat-msg system">${escapeHtml(m.text)}</div>`
          : `<div class="chat-msg"><span>${m.avatar || '👤'}</span><div><span class="who">${escapeHtml(m.from)}</span><div class="text">${escapeHtml(m.text)}</div></div></div>`)
        .join('');
      this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight;
    }

    const hist = v.historial || [];
    this.el.historyList.innerHTML = hist.length
      ? hist.map((h) => `<div class="history-item">
          <div class="history-head"><span>Ronda ${h.ronda}</span><span>${h.puntos} pts</span></div>
          <div class="history-win">Gana <b>${escapeHtml(h.ganador)}</b></div>
        </div>`).join('')
      : '<p class="hint">Aquí aparecerán las rondas jugadas.</p>';

    const objetivo = (v.config && v.config.objetivo) || 500;
    this.el.statsList.innerHTML = `<p class="hint">Gana quien llegue a ${objetivo} puntos.</p>` +
      [...v.jugadores]
        .sort((a, b) => b.puntos - a.puntos)
        .map((p) => `<div class="stat-row">
          <span class="s-avatar">${p.avatar}</span>
          <span class="s-name">${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</span>
          <span class="s-nums"><span>rondas<b>${p.rondasGanadas}</b></span><span>cartas<b>${p.cartas}</b></span></span>
          <span class="s-chips">${p.puntos} pts</span>
        </div>`).join('');
  }

  // -------------------------------------------------------------- animaciones

  animar(eventos) {
    for (const ev of eventos) {
      switch (ev.t) {
        case 'reparto':
          sfx.deal();
          this.aviso(`Ronda ${ev.ronda}`, '¡A jugar!', 1500);
          break;
        case 'juega':
          sfx.flip();
          break;
        case 'roba':
          sfx.deal();
          if (ev.cuantas > 1) {
            const quien = this.view.jugadores.find((p) => p.id === ev.id);
            this.aviso(`+${ev.cuantas}`, quien ? `${quien.nombre} roba ${ev.cuantas}` : '', 1300);
            sfx.chip(2);
          }
          break;
        case 'salta': {
          const p = this.view.jugadores.find((x) => x.id === ev.id);
          this.aviso('¡Te saltas!', p ? `${p.nombre} pierde el turno` : '', 1200);
          sfx.check();
          break;
        }
        case 'sentido':
          this.aviso('Cambio de sentido', ev.sentido === 1 ? 'Ahora hacia la derecha' : 'Ahora hacia la izquierda', 1300);
          sfx.raise();
          this.girarSentido();
          break;
        case 'color':
          sfx.chat();
          break;
        case 'uno': {
          const p = this.view.jugadores.find((x) => x.id === ev.id);
          if (p && !p.soyYo) this.aviso('¡UNO!', `${p.nombre} se queda con una carta`, 1400);
          sfx.turn();
          break;
        }
        case 'pillado': {
          const p = this.view.jugadores.find((x) => x.id === ev.id);
          this.aviso('¡Pillado!', p ? `${p.nombre} roba dos por no cantar UNO` : '', 1800);
          sfx.allin();
          break;
        }
        case 'finRonda': {
          const gan = this.view.jugadores.find((p) => p.id === ev.ganador);
          const gane = gan && gan.soyYo;
          this.aviso(gane ? '¡Has ganado la ronda!' : `Gana ${gan ? gan.nombre : '?'}`,
            `+${ev.puntos} puntos`, 3200);
          if (gane) {
            sfx.win();
            if (this.settings.confetti) {
              const r = this.el.confetti.getBoundingClientRect();
              confettiBurst(r.width / 2, r.height * 0.4, 120, 1.2);
            }
          } else {
            sfx.lose();
          }
          break;
        }
        case 'chat':
          sfx.chat();
          this.bumpBadge();
          break;
        case 'rebaraja':
          this.aviso('Se rebaraja', 'El mazo se rehace con el descarte', 1400);
          sfx.deal();
          break;
        case 'recover':
          this.aviso('Partida reanudada', 'Se había quedado parada', 1800);
          break;
        default:
          break;
      }
    }
  }

  girarSentido() {
    const chip = document.getElementById('unoSentidoChip');
    if (!chip || motion.reduced) return;
    animateOnce(chip,
      [{ transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(180deg) scale(1.2)' }, { transform: 'rotate(360deg) scale(1)' }],
      { duration: ms(600), easing: 'ease-in-out' });
  }

  aviso(titulo, sub, duracion = 2000) {
    const el = this.el.aviso;
    el.innerHTML = `<div class="a-titulo">${escapeHtml(titulo)}</div>${sub ? `<div class="a-sub">${escapeHtml(sub)}</div>` : ''}`;
    el.hidden = false;
    clearTimeout(this._avisoTimer);
    this._avisoTimer = setTimeout(() => (el.hidden = true), ms(duracion));
  }

  bumpBadge() {
    const abierto = document.getElementById('sidePanel').classList.contains('open');
    if (abierto) return;
    this.sinLeer++;
    this.el.chatBadge.textContent = this.sinLeer > 9 ? '9+' : String(this.sinLeer);
    this.el.chatBadge.hidden = false;
  }

  clearChatBadge() {
    this.sinLeer = 0;
    this.el.chatBadge.hidden = true;
  }

  destroy() {
    clearTimeout(this._avisoTimer);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
