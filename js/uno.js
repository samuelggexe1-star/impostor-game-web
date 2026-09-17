// El UNO de toda la vida: motor de reglas.
// Logica pura y testeable: no toca el DOM ni la red.
//
// Baraja de 108 cartas:
//   - Por cada color: un 0, dos de cada 1-9, dos +2, dos salta, dos cambio de sentido
//   - Cuatro comodines y cuatro comodines +4

import { shuffle, secureRng } from './cards.js';

export const COLORES = ['rojo', 'amarillo', 'verde', 'azul'];
export const ESPECIALES = ['mas2', 'salta', 'sentido'];
export const COMODINES = ['comodin', 'mas4'];

export const NOMBRE_COLOR = { rojo: 'Rojo', amarillo: 'Amarillo', verde: 'Verde', azul: 'Azul' };

export function crearBaraja() {
  const baraja = [];
  let n = 0;
  const añadir = (color, valor) => baraja.push({ id: `c${n++}`, color, valor });
  for (const color of COLORES) {
    añadir(color, '0');
    for (let v = 1; v <= 9; v++) {
      añadir(color, String(v));
      añadir(color, String(v));
    }
    for (const esp of ESPECIALES) {
      añadir(color, esp);
      añadir(color, esp);
    }
  }
  for (let i = 0; i < 4; i++) {
    añadir(null, 'comodin');
    añadir(null, 'mas4');
  }
  return baraja;
}

export function esComodin(carta) {
  return carta && (carta.valor === 'comodin' || carta.valor === 'mas4');
}

/** Puntos de una carta, para contar al acabar la ronda. */
export function puntos(carta) {
  if (!carta) return 0;
  if (esComodin(carta)) return 50;
  if (ESPECIALES.includes(carta.valor)) return 20;
  return Number(carta.valor) || 0;
}

export class UnoGame {
  constructor(opts = {}) {
    this.maxJugadores = opts.maxJugadores || 8;
    this.rng = opts.rng || secureRng();
    this.cartasIniciales = opts.cartasIniciales || 7;
    this.jugadores = [];
    this.mazo = [];
    this.descarte = [];
    this.colorActual = null;
    this.sentido = 1;
    this.turno = 0;
    this.estado = 'idle';      // idle | jugando | finRonda
    this.ronda = 0;
    this.ganador = null;
    this.eventos = [];
    this.esperaColor = null;   // id del jugador que tiene que elegir color
    this.robadaJugable = null; // carta recien robada que se puede jugar
    this.ventanaUno = null;    // { id, hasta } para pillar a quien no dijo UNO
  }

  // ---------------------------------------------------------------- jugadores

  sentar(jugador) {
    if (this.jugadores.length >= this.maxJugadores) return { ok: false, reason: 'table-full' };
    const existente = this.porId(jugador.id);
    if (existente) {
      existente.ausente = false;
      existente.nombre = jugador.name || existente.nombre;
      return { ok: true, seat: existente.seat, rejoined: true };
    }
    const p = {
      id: jugador.id,
      nombre: jugador.name || 'Invitado',
      avatar: jugador.avatar || '🙂',
      esBot: !!jugador.isBot,
      mano: [],
      dijoUno: false,
      ausente: false,
      // Quien llega con la ronda empezada mira hasta la siguiente: repartirle
      // cartas a medias desequilibraria la partida.
      esperando: this.estado === 'jugando',
      seat: this.jugadores.length,
      puntos: 0,
      rondasGanadas: 0
    };
    this.jugadores.push(p);
    return { ok: true, seat: p.seat };
  }

  salir(id) {
    const i = this.jugadores.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const eraSuTurno = this.turno === i && this.estado === 'jugando';
    // Sus cartas vuelven al mazo para que no se pierdan del juego.
    this.mazo.push(...this.jugadores[i].mano);
    this.jugadores.splice(i, 1);
    this.jugadores.forEach((p, idx) => (p.seat = idx));
    if (this.turno > i) this.turno--;
    if (this.turno >= this.jugadores.length) this.turno = 0;
    if (this.jugadores.length < 2) this.estado = 'finRonda';
    else if (eraSuTurno) this.emitir({ t: 'turno', id: this.actual() && this.actual().id });
    return true;
  }

  porId(id) {
    return this.jugadores.find((p) => p.id === id) || null;
  }

  actual() {
    return this.jugadores[this.turno] || null;
  }

  activos() {
    return this.jugadores.filter((p) => !p.ausente);
  }

  // ------------------------------------------------------------------- ronda

  empezarRonda() {
    if (this.jugadores.length < 2) {
      this.estado = 'idle';
      return { ok: false, reason: 'faltan-jugadores' };
    }
    this.ronda++;
    this.ganador = null;
    this.esperaColor = null;
    this.robadaJugable = null;
    this.ventanaUno = null;
    this.sentido = 1;
    this.eventos = [];
    this.mazo = shuffle(crearBaraja(), this.rng);
    this.descarte = [];

    for (const p of this.jugadores) {
      p.mano = [];
      p.dijoUno = false;
      p.esperando = false;     // ronda nueva, entran todos
    }
    for (let i = 0; i < this.cartasIniciales; i++) {
      for (const p of this.jugadores) p.mano.push(this.mazo.pop());
    }

    // Primera carta: si sale un +4 se devuelve al mazo y se saca otra.
    let inicial = this.mazo.pop();
    let vueltas = 0;
    while (inicial.valor === 'mas4' && vueltas++ < 20) {
      this.mazo.unshift(inicial);
      inicial = this.mazo.pop();
    }
    this.descarte.push(inicial);
    this.colorActual = inicial.color;

    this.turno = Math.floor(this.rng() * this.jugadores.length);
    if (this.jugadores[this.turno].esperando) this.turno = this.indiceSiguiente();
    this.estado = 'jugando';
    this.emitir({ t: 'reparto', ronda: this.ronda });

    // La carta de salida hace su efecto sobre el primero en jugar.
    if (inicial.valor === 'mas2') {
      this.robarCartas(this.actual(), 2);
      this.emitir({ t: 'roba', id: this.actual().id, cuantas: 2, motivo: 'salida' });
      this.avanzar();
    } else if (inicial.valor === 'salta') {
      this.emitir({ t: 'salta', id: this.actual().id });
      this.avanzar();
    } else if (inicial.valor === 'sentido') {
      this.sentido = -1;
      this.emitir({ t: 'sentido', sentido: this.sentido });
      if (this.jugadores.length > 2) this.turno = this.indiceSiguiente();
    } else if (inicial.valor === 'comodin') {
      // El primero elige color antes de jugar.
      this.colorActual = null;
      this.esperaColor = this.actual().id;
    }
    return { ok: true };
  }

  // -------------------------------------------------------------- utilidades

  /** Siguiente asiento en juego, saltando a quien espera a la proxima ronda. */
  indiceSiguiente(desde = this.turno, saltos = 1) {
    const n = this.jugadores.length;
    if (!n) return 0;
    let i = desde;
    let dados = 0;
    let vueltas = 0;
    while (dados < saltos && vueltas++ < n * 4) {
      i = (((i + this.sentido) % n) + n) % n;
      if (!this.jugadores[i].esperando) dados++;
    }
    return i;
  }

  avanzar(saltos = 1) {
    this.turno = this.indiceSiguiente(this.turno, saltos);
    const p = this.actual();
    if (p) this.emitir({ t: 'turno', id: p.id });
  }

  /** Rellena el mazo con el descarte cuando se acaba (dejando la carta de arriba). */
  rellenarMazo() {
    if (this.mazo.length > 0) return;
    const arriba = this.descarte.pop();
    const reciclables = this.descarte.splice(0, this.descarte.length);
    // Los comodines vuelven sin color asignado.
    for (const c of reciclables) if (esComodin(c)) c.color = null;
    this.mazo = shuffle(reciclables, this.rng);
    this.descarte = arriba ? [arriba] : [];
    this.emitir({ t: 'rebaraja', cuantas: this.mazo.length });
  }

  robarCartas(jugador, cuantas) {
    const robadas = [];
    for (let i = 0; i < cuantas; i++) {
      this.rellenarMazo();
      if (!this.mazo.length) break;   // baraja agotada de verdad
      const c = this.mazo.pop();
      jugador.mano.push(c);
      robadas.push(c);
    }
    if (jugador.mano.length > 1) jugador.dijoUno = false;
    return robadas;
  }

  arriba() {
    return this.descarte[this.descarte.length - 1] || null;
  }

  /** ¿Se puede echar esta carta sobre la mesa tal y como esta? */
  sePuedeJugar(carta) {
    if (!carta) return false;
    if (esComodin(carta)) return true;
    const top = this.arriba();
    if (!top) return true;
    if (this.colorActual && carta.color === this.colorActual) return true;
    if (!esComodin(top) && carta.valor === top.valor) return true;
    return false;
  }

  manoJugable(jugador) {
    return jugador.mano.filter((c) => this.sePuedeJugar(c));
  }

  // ------------------------------------------------------------------ acciones

  jugar(id, cartaId, colorElegido = null) {
    const p = this.porId(id);
    if (!p) return { ok: false, reason: 'no-estas' };
    if (this.estado !== 'jugando') return { ok: false, reason: 'ronda-parada' };
    if (this.esperaColor) return { ok: false, reason: 'falta-elegir-color' };
    if (this.actual() !== p) return { ok: false, reason: 'no-es-tu-turno' };

    const idx = p.mano.findIndex((c) => c.id === cartaId);
    if (idx < 0) return { ok: false, reason: 'no-tienes-esa-carta' };
    const carta = p.mano[idx];
    if (!this.sePuedeJugar(carta)) return { ok: false, reason: 'no-encaja' };

    p.mano.splice(idx, 1);
    this.descarte.push(carta);
    this.robadaJugable = null;
    this.emitir({ t: 'juega', id: p.id, carta });

    // Comodin: hay que elegir color antes de seguir.
    if (esComodin(carta)) {
      const color = COLORES.includes(colorElegido) ? colorElegido : null;
      if (!color) {
        this.colorActual = null;
        this.esperaColor = p.id;
        this.pendiente = carta.valor;
        return { ok: true, esperaColor: true };
      }
      carta.color = color;
      this.colorActual = color;
      this.emitir({ t: 'color', color, id: p.id });
      return this.trasJugar(p, carta);
    }

    this.colorActual = carta.color;
    return this.trasJugar(p, carta);
  }

  elegirColor(id, color) {
    if (this.esperaColor !== id) return { ok: false, reason: 'no-te-toca-elegir' };
    if (!COLORES.includes(color)) return { ok: false, reason: 'color-invalido' };
    const p = this.porId(id);
    this.colorActual = color;
    this.esperaColor = null;
    const carta = this.arriba();
    if (carta && esComodin(carta)) carta.color = color;
    this.emitir({ t: 'color', color, id });

    // Si el color se elegia por la carta de salida, no hay efecto que aplicar.
    if (!this.pendiente) return { ok: true };
    const valor = this.pendiente;
    this.pendiente = null;
    return this.trasJugar(p, { ...carta, valor });
  }

  /** Efectos de la carta jugada y paso de turno. */
  trasJugar(p, carta) {
    // ¿Se ha quedado sin cartas?
    if (p.mano.length === 0) {
      this.terminarRonda(p);
      return { ok: true, ronda: 'terminada' };
    }

    // Aviso de UNO: si le queda una y no lo ha dicho, se le puede pillar.
    if (p.mano.length === 1 && !p.dijoUno) {
      this.ventanaUno = { id: p.id, hasta: Date.now() + 5000 };
    }

    const siguiente = this.jugadores[this.indiceSiguiente()];
    switch (carta.valor) {
      case 'mas2':
        this.robarCartas(siguiente, 2);
        this.emitir({ t: 'roba', id: siguiente.id, cuantas: 2, motivo: 'mas2' });
        this.avanzar(2);
        break;
      case 'mas4':
        this.robarCartas(siguiente, 4);
        this.emitir({ t: 'roba', id: siguiente.id, cuantas: 4, motivo: 'mas4' });
        this.avanzar(2);
        break;
      case 'salta':
        this.emitir({ t: 'salta', id: siguiente.id });
        this.avanzar(2);
        break;
      case 'sentido':
        this.sentido *= -1;
        this.emitir({ t: 'sentido', sentido: this.sentido });
        // Con dos jugadores, cambiar el sentido equivale a saltar.
        this.avanzar(this.jugadores.length === 2 ? 2 : 1);
        break;
      default:
        this.avanzar();
    }
    return { ok: true };
  }

  /** Roba una carta. Si encaja, puede jugarla; si no, pasa el turno. */
  robar(id) {
    const p = this.porId(id);
    if (!p) return { ok: false, reason: 'no-estas' };
    if (this.estado !== 'jugando') return { ok: false, reason: 'ronda-parada' };
    if (this.esperaColor) return { ok: false, reason: 'falta-elegir-color' };
    if (this.actual() !== p) return { ok: false, reason: 'no-es-tu-turno' };
    if (this.robadaJugable) return { ok: false, reason: 'ya-has-robado' };

    const [carta] = this.robarCartas(p, 1);
    if (!carta) {
      this.avanzar();
      return { ok: true, vacio: true };
    }
    this.emitir({ t: 'roba', id: p.id, cuantas: 1, motivo: 'voluntario' });

    if (this.sePuedeJugar(carta)) {
      this.robadaJugable = carta.id;       // puede jugarla o pasar
      return { ok: true, puedeJugarla: true, carta };
    }
    this.avanzar();
    return { ok: true, puedeJugarla: false };
  }

  /** Pasar despues de robar una carta que no quiere jugar. */
  pasar(id) {
    const p = this.porId(id);
    if (!p || this.actual() !== p) return { ok: false, reason: 'no-es-tu-turno' };
    if (!this.robadaJugable) return { ok: false, reason: 'tienes-que-robar-antes' };
    this.robadaJugable = null;
    this.avanzar();
    return { ok: true };
  }

  /** Avisar de que te queda una carta. */
  decirUno(id) {
    const p = this.porId(id);
    if (!p) return { ok: false };
    p.dijoUno = true;
    if (this.ventanaUno && this.ventanaUno.id === id) this.ventanaUno = null;
    this.emitir({ t: 'uno', id });
    return { ok: true };
  }

  /** Pillar a quien se quedo con una carta sin avisar: roba dos. */
  pillar(id, objetivoId) {
    const v = this.ventanaUno;
    if (!v || v.id !== objetivoId || Date.now() > v.hasta) return { ok: false, reason: 'nada-que-pillar' };
    if (id === objetivoId) return { ok: false, reason: 'no-puedes-pillarte' };
    const objetivo = this.porId(objetivoId);
    if (!objetivo) return { ok: false };
    this.robarCartas(objetivo, 2);
    this.ventanaUno = null;
    this.emitir({ t: 'pillado', id: objetivoId, por: id });
    return { ok: true };
  }

  terminarRonda(ganador) {
    this.estado = 'finRonda';
    this.ganador = ganador.id;
    ganador.rondasGanadas++;
    let total = 0;
    for (const p of this.jugadores) {
      if (p === ganador) continue;
      const suyos = p.mano.reduce((a, c) => a + puntos(c), 0);
      total += suyos;
    }
    ganador.puntos += total;
    this.emitir({ t: 'finRonda', ganador: ganador.id, puntos: total });
  }

  emitir(ev) {
    this.eventos.push({ ...ev, n: this.eventos.length });
  }

  vaciarEventos() {
    const e = this.eventos;
    this.eventos = [];
    return e;
  }

  // ---------------------------------------------------------------- snapshot

  /** Vista para un jugador: solo ve su propia mano. */
  snapshot(viewerId = null) {
    const yo = this.porId(viewerId);
    const verTodo = this.estado === 'finRonda';
    return {
      juego: 'uno',
      ronda: this.ronda,
      estado: this.estado,
      arriba: this.arriba(),
      colorActual: this.colorActual,
      sentido: this.sentido,
      mazoRestante: this.mazo.length,
      descarteTotal: this.descarte.length,
      turno: this.actual() ? this.actual().id : null,
      esperaColor: this.esperaColor,
      puedePasar: !!this.robadaJugable && this.actual() === yo,
      ventanaUno: this.ventanaUno ? { id: this.ventanaUno.id, hasta: this.ventanaUno.hasta } : null,
      ganador: this.ganador,
      you: viewerId,
      jugadores: this.jugadores.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        avatar: p.avatar,
        esBot: p.esBot,
        ausente: p.ausente,
        seat: p.seat,
        cartas: p.mano.length,
        dijoUno: p.dijoUno,
        esperando: !!p.esperando,
        puntos: p.puntos,
        rondasGanadas: p.rondasGanadas,
        esTuTurno: this.actual() === p,
        soyYo: !!yo && p.id === yo.id,
        mano: (yo && p.id === yo.id) || verTodo ? p.mano.slice() : null
      })),
      tuMano: yo ? yo.mano.slice() : [],
      jugables: yo && this.actual() === yo && !this.esperaColor
        ? (this.robadaJugable
            ? yo.mano.filter((c) => c.id === this.robadaJugable).map((c) => c.id)
            : this.manoJugable(yo).map((c) => c.id))
        : []
    };
  }
}
