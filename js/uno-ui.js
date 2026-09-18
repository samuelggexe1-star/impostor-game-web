// Pantalla del UNO: pinta la partida y anima las jugadas.
// Igual que en el poker, aqui no se deciden reglas: solo se representa el estado.

import { sfx } from './sound.js';
import { motion, ms, rectIn, floatText, initConfetti, confettiBurst, animateOnce, avisarTurno, pararParpadeo } from './fx.js';

const SIMBOLO = { mas2: '+2', salta: '🚫', sentido: '🔄', mas4: '+4', comodin: '★' };
const COLOR_HEX = { rojo: '#e8443a', amarillo: '#f2c231', verde: '#2fae5a', azul: '#2f7fe0' };
const ORDEN_COLOR = { rojo: 0, amarillo: 1, verde: 2, azul: 3 };
/** Los números primero, luego las especiales y al final los comodines. */
const ORDEN_VALOR = { mas2: 10, salta: 11, sentido: 12, comodin: 20, mas4: 21 };
const pesoValor = (v) => (ORDEN_VALOR[v] != null ? ORDEN_VALOR[v] : Number(v));
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
      fin: $('unoFinPartida'),
      orden: $('unoOrden'),
      confetti: $('unoConfetti'),
      chatLog: $('chatLog'),
      historyList: $('historyList'),
      statsList: $('statsList')
    };
    initConfetti(this.el.confetti);
    this._pila = [];
    this._arribaAnterior = null;
    this._campeonVisto = null;
    if (this.el.fin) this.el.fin.hidden = true;
    for (const el of [this.el.rivales, this.el.mano, this.el.descarte, this.el.fx]) {
      if (el) el.innerHTML = '';
    }
    this._firmaMesa = null;
    this.manoRender = '';
    this.bind();
    this.session.on('state', (v, evs) => this.onState(v, evs));
    this.session.on('latency', (l) => {
      this.el.net.textContent = l + ' ms';
    });
    this.session.on('netstatus', (s) => (this.el.net.textContent = s));
    this.session.on('hostgone', () => this.aviso('Se ha cerrado la partida', ''));
  }

  bind() {
    this.el.orden.onclick = () => this.alternarOrden();
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

  /** Ordena la mano por color y valor. Con 15 cartas en un iPad se agradece. */
  alternarOrden() {
    this.ordenada = !this.ordenada;
    this.el.orden.classList.toggle('activo', this.ordenada);
    this.el.orden.title = this.ordenada ? 'Volver al orden de siempre' : 'Ordenar la mano';
    this.manoRender = null;        // fuerza repintado
    sfx.chip(1);
    this.renderMano();
  }

  /** La mano tal y como hay que pintarla: como vino o puesta en orden. */
  manoOrdenada() {
    const mano = (this.view && this.view.tuMano) || [];
    if (!this.ordenada) return mano;
    return [...mano].sort((a, b) => {
      const ca = a.color ? ORDEN_COLOR[a.color] : 9;   // comodines al final
      const cb = b.color ? ORDEN_COLOR[b.color] : 9;
      return ca - cb || pesoValor(a.valor) - pesoValor(b.valor);
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
    // Aviso de turno: suena, vibra y parpadea el título si estás en otra pestaña.
    const meToca = this.esMiTurno();
    if (meToca && !this._tocaba) { sfx.turn(); avisarTurno('🔔 ¡Te toca!'); }
    if (!meToca) pararParpadeo();
    this._tocaba = meToca;
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
      el.dataset.id = p.id;
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
      // El montón guarda las últimas cartas debajo, giradas, para que se vea
      // que es una pila de verdad y no una carta suelta.
      if (this._arribaAnterior) {
        this._pila.push(this._arribaAnterior);
        while (this._pila.length > 4) this._pila.shift();
      }
      this._arribaAnterior = arriba;
      this._firmaMesa = firma;
      this.el.descarte.innerHTML = '';
      this._pila.forEach((c, i) => {
        const el = crearCarta(c, { mesa: true });
        el.classList.add('posada');
        const giro = ((i * 37) % 23) - 11;
        el.style.transform = `translate(-50%,-50%) rotate(${giro}deg)`;
        el.style.opacity = String(0.45 + i * 0.12);
        this.el.descarte.appendChild(el);
      });
      if (arriba) {
        const el = crearCarta(arriba, { mesa: true });
        this.el.descarte.appendChild(el);
        if (!motion.reduced) {
          // Aterrizaje: la carta que venía volando se posa y rebota un poco.
          animateOnce(el,
            [{ transform: 'scale(1.18) rotate(-6deg)', opacity: 0 },
             { transform: 'scale(.94) rotate(2deg)', opacity: 1, offset: .55 },
             { transform: 'none', opacity: 1 }],
            { duration: ms(340), easing: 'cubic-bezier(.3,1.4,.5,1)' });
        }
      }
    }
    const hex = COLOR_HEX[v.colorActual] || 'transparent';
    this.el.color.style.setProperty('--color-actual', hex);
    this.el.descarte.style.setProperty('--halo', hex);
  }

  renderMano() {
    const v = this.view;
    const mano = this.manoOrdenada();
    const jugables = new Set(v.jugables || []);
    const firma = mano.map((c) => c.id).join(',') + '|' + [...jugables].join(',') + '|' + this.esMiTurno() + '|' + this.ordenada;
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

    this.renderFinPartida();

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

  /** Cartel de campeón cuando alguien llega al objetivo de puntos. */
  renderFinPartida() {
    const el = this.el.fin;
    if (!el) return;
    const v = this.view;
    const c = v.campeon;
    if (!c) {
      el.hidden = true;
      this._campeonVisto = null;
      return;
    }
    if (this._campeonVisto === c.id && !el.hidden) return;

    const gane = c.id === v.you;
    el.querySelector('.fp-titulo').textContent = gane ? '¡Has ganado la partida!' : `Gana ${c.nombre}`;
    el.querySelector('.fp-sub').textContent =
      `${c.puntos} puntos · objetivo ${(v.config && v.config.objetivo) || 500}`;
    el.querySelector('.fp-tabla').innerHTML = [...v.jugadores]
      .sort((a, b) => b.puntos - a.puntos || b.rondasGanadas - a.rondasGanadas)
      .map((p, i) => `<li class="${p.soyYo ? 'yo' : ''}">
        <span class="fp-puesto">${i + 1}</span>
        <span>${p.avatar}</span>
        <span class="fp-nombre">${escapeHtml(p.nombre)}${p.esBot ? ' 🤖' : ''}</span>
        <span class="fp-puntos">${p.puntos}</span>
      </li>`).join('');

    if (!this._finEnlazado) {
      this._finEnlazado = true;
      el.querySelector('[data-otra]').onclick = () => {
        el.hidden = true;
        this.session.command('nuevaPartida', {});
      };
      el.querySelector('[data-cerrar-fin]').onclick = () => (el.hidden = true);
    }
    el.hidden = false;
    this._campeonVisto = c.id;

    if (gane) {
      sfx.win();
      if (this.settings.confetti) {
        const r = this.el.confetti.getBoundingClientRect();
        confettiBurst(r.width / 2, r.height * 0.35, 180, 1.5);
        setTimeout(() => confettiBurst(r.width * 0.25, r.height * 0.4, 90, 1.2), 420);
        setTimeout(() => confettiBurst(r.width * 0.75, r.height * 0.4, 90, 1.2), 780);
      }
    } else {
      sfx.lose();
    }
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
          this.volar(ev.carta, this.origenDe(ev.id), this.el.descarte, { giro: 380 });
          break;
        case 'roba': {
          sfx.deal();
          const destino = this.origenDe(ev.id);
          for (let i = 0; i < Math.min(4, ev.cuantas); i++) {
            this.volar(null, this.el.mazo, destino, { duracion: 460, giro: 180, escala: .8, retardo: i * 110 });
          }
          if (ev.cuantas > 1) {
            const quien = this.view.jugadores.find((p) => p.id === ev.id);
            this.aviso(`+${ev.cuantas}`, quien ? `${quien.nombre} roba ${ev.cuantas}` : '', 1300);
            sfx.chip(2);
          }
          break;
        }
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
          this.fogonazoColor(ev.color);
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
          this.burbuja(ev.msg);
          sfx.chat();
          this.bumpBadge();
          break;
        case 'emote':
          this.lanzarEmoji(ev);
          break;
        case 'rebaraja':
          this.aviso('Se rebaraja', 'El mazo se rehace con el descarte', 1400);
          sfx.deal();
          break;
        case 'finPartida':
          this.aviso('Fin de la partida', `${ev.nombre} llega a ${ev.puntos} puntos`, 2600);
          break;
        case 'recover':
          this.aviso('Partida reanudada', 'Se había quedado parada', 1800);
          break;
        default:
          break;
      }
    }
  }

  /** Dónde va el bocadillo: sobre la placa del rival o sobre mi mano. */
  anclaDe(msg) {
    const quien = (this.view.jugadores || []).find((p) => p.nombre === msg.from);
    if (!quien) return null;
    if (quien.soyYo) return this.el.mano;
    return this.el.rivales.querySelector(`[data-id="${CSS.escape(quien.id)}"]`);
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

  /**
   * El emoji sale volando y girando desde quien lo lanza. El evento trae el
   * asiento, así que buscamos al jugador por ahí y si no, lo soltamos en medio.
   */
  lanzarEmoji(ev) {
    const capa = this.el.fx;
    if (!capa || motion.reduced) return;
    const lista = (this.view && this.view.jugadores) || [];
    const quien = lista.find((p) => p.seat === ev.from);
    const ancla = quien ? this.anclaDe({ from: quien.nombre }) : null;
    const r = ancla ? rectIn(ancla, capa) : null;
    const caja = capa.getBoundingClientRect();
    const desde = r || { cx: caja.width / 2, cy: caja.height * 0.7, w: 0, h: 0 };

    const el = document.createElement('div');
    el.className = 'float-text emoji';
    el.textContent = ev.emoji;
    el.style.position = 'absolute';
    el.style.left = desde.cx + 'px';
    el.style.top = desde.cy + 'px';
    capa.appendChild(el);

    const dx = (Math.random() - 0.5) * 120;
    animateOnce(el, [
      { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 0 },
      { transform: `translate(-50%,-50%) translate(${dx * 0.5}px, -70px) scale(1.7) rotate(200deg)`, opacity: 1, offset: .45 },
      { transform: `translate(-50%,-50%) translate(${dx}px, -150px) scale(1.2) rotate(360deg)`, opacity: 0 }
    ], { duration: ms(1100), easing: 'cubic-bezier(.2,.8,.3,1)' })
      .finished.catch(() => {}).then(() => el.remove());
    sfx.emote();
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

  /** Punto de partida de una carta segun quien la juega. */
  origenDe(id) {
    if (!this.view) return null;
    if (id === this.view.you) {
      const mano = this.el.mano;
      return mano && mano.children.length ? mano.children[Math.floor(mano.children.length / 2)] : mano;
    }
    return this.el.rivales.querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  /**
   * Manda una carta volando de un sitio a otro. Se usa al jugar (de la mano al
   * monton), al robar (del mazo a la mano) y en los +2 y +4.
   */
  volar(carta, desde, hasta, { duracion = 520, giro = 360, escala = 1, retardo = 0 } = {}) {
    if (motion.reduced || !desde || !hasta) return;
    const capa = this.el.fx;
    const a = rectIn(desde, capa);
    const b = rectIn(hasta, capa);
    if (!a.w && !b.w) return;

    let el;
    if (carta) {
      el = crearCarta(carta);
    } else {
      el = document.createElement('div');
      el.className = 'ucard comodin';
      el.innerHTML = '<span class="rueda"></span>';
    }
    el.style.position = 'absolute';
    el.style.left = a.cx + 'px';
    el.style.top = a.cy + 'px';
    el.style.margin = '0';
    el.style.zIndex = '30';
    capa.appendChild(el);

    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    animateOnce(el, [
      { transform: 'translate(-50%,-50%) scale(.85) rotate(0deg)', opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.15) rotate(${giro * 0.5}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(${escala}) rotate(${giro}deg)`, opacity: 1 }
    ], { duration: ms(duracion), delay: ms(retardo), easing: 'cubic-bezier(.22,.9,.24,1)', fill: 'backwards' })
      .finished.catch(() => {}).then(() => el.remove());
  }

  /** La mesa se tiñe un instante del color elegido con el comodín. */
  fogonazoColor(color) {
    if (motion.reduced) return;
    const hex = COLOR_HEX[color];
    if (!hex) return;
    const capa = document.createElement('div');
    capa.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:25;border-radius:inherit;background:radial-gradient(circle at 50% 45%, ${hex}, transparent 68%);`;
    this.el.fx.appendChild(capa);
    animateOnce(capa, [{ opacity: 0 }, { opacity: .55, offset: .2 }, { opacity: 0 }],
      { duration: ms(900), easing: 'ease-out' })
      .finished.catch(() => {}).then(() => capa.remove());
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
    pararParpadeo();
    this.limpiarBurbujas();
    clearTimeout(this._avisoTimer);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
