// Blackjack: motor de reglas. Logica pura, sin DOM ni red.
//
// Reglas de casino de toda la vida:
//   - Zapato de varias barajas, se rebaraja cuando queda poco.
//   - Blackjack (as + figura de salida) paga 3 a 2.
//   - La banca pide hasta 17 y se planta ahi, tambien con 17 blando.
//   - Doblar solo con dos cartas; dividir solo con pareja.
//   - Los ases divididos reciben una sola carta.

import { makeDeck, shuffle, secureRng, RANK_LABEL } from './cards.js';

export const ESTADOS = ['apuestas', 'turnos', 'banca', 'pagos', 'idle'];

/** Valor de una mano. Devuelve el mejor total y si usa un as como 11. */
export function valorMano(cartas) {
  let total = 0;
  let ases = 0;
  for (const c of cartas) {
    if (c.r === 14) {
      ases++;
      total += 11;
    } else if (c.r >= 11) total += 10;
    else total += c.r;
  }
  let blanda = ases > 0;
  while (total > 21 && ases > 0) {
    total -= 10;
    ases--;
  }
  if (ases === 0) blanda = false;
  return { total, blanda, ases };
}

export function esBlackjack(mano) {
  return mano.cartas.length === 2 && valorMano(mano.cartas).total === 21 && !mano.dividida;
}

export function nombreCarta(c) {
  return c ? RANK_LABEL[c.r] + c.s : '??';
}

export class BlackjackGame {
  constructor(opts = {}) {
    this.mazos = opts.mazos || 6;
    this.rng = opts.rng || secureRng();
    this.fichasIniciales = opts.fichasIniciales || 1000;
    this.apuestaMin = opts.apuestaMin || 10;
    this.apuestaMax = opts.apuestaMax || 500;
    this.jugadores = [];
    this.zapato = [];
    this.descarte = [];
    this.banca = { cartas: [], oculta: true };
    this.estado = 'idle';
    this.turno = -1;       // indice de jugador
    this.manoActiva = 0;   // indice de mano de ese jugador (por las divididas)
    this.ronda = 0;
    this.eventos = [];
    this.resultados = null;
  }

  // ---------------------------------------------------------------- jugadores

  sentar(j) {
    const existente = this.porId(j.id);
    if (existente) {
      existente.ausente = false;
      existente.nombre = j.name || existente.nombre;
      return { ok: true, seat: existente.seat, rejoined: true };
    }
    if (this.jugadores.length >= 6) return { ok: false, reason: 'table-full' };
    const p = {
      id: j.id,
      nombre: j.name || 'Invitado',
      avatar: j.avatar || '🙂',
      esBot: !!j.isBot,
      fichas: j.chips || this.fichasIniciales,
      apuesta: 0,
      manos: [],
      ausente: false,
      seat: this.jugadores.length,
      stats: { rondas: 0, ganadas: 0, blackjacks: 0 }
    };
    this.jugadores.push(p);
    return { ok: true, seat: p.seat };
  }

  salir(id) {
    const i = this.jugadores.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.jugadores.splice(i, 1);
    this.jugadores.forEach((p, idx) => (p.seat = idx));
    if (this.turno >= this.jugadores.length) this.turno = this.jugadores.length - 1;
    return true;
  }

  porId(id) {
    return this.jugadores.find((p) => p.id === id) || null;
  }

  actual() {
    return this.jugadores[this.turno] || null;
  }

  manoEnJuego() {
    const p = this.actual();
    return p ? p.manos[this.manoActiva] : null;
  }

  /** Quien puede jugar esta ronda: tiene fichas y esta presente. */
  elegibles() {
    return this.jugadores.filter((p) => !p.ausente && p.fichas > 0);
  }

  // ------------------------------------------------------------------- zapato

  rellenarZapato() {
    const cartas = [];
    for (let i = 0; i < this.mazos; i++) cartas.push(...makeDeck());
    this.zapato = shuffle(cartas, this.rng);
    this.descarte = [];
    this.emitir({ t: 'baraja', cartas: this.zapato.length });
  }

  sacar() {
    if (this.zapato.length < 15) this.rellenarZapato();
    return this.zapato.pop();
  }

  // ------------------------------------------------------------------- ronda

  abrirApuestas() {
    if (!this.zapato.length) this.rellenarZapato();
    this.ronda++;
    this.estado = 'apuestas';
    this.banca = { cartas: [], oculta: true };
    this.resultados = null;
    this.turno = -1;
    this.manoActiva = 0;
    for (const p of this.jugadores) {
      p.apuesta = 0;
      p.manos = [];
    }
    this.emitir({ t: 'apuestas', ronda: this.ronda });
    return { ok: true };
  }

  apostar(id, cantidad) {
    if (this.estado !== 'apuestas') return { ok: false, reason: 'no-toca-apostar' };
    const p = this.porId(id);
    if (!p) return { ok: false, reason: 'no-estas' };
    const monto = Math.max(this.apuestaMin, Math.min(this.apuestaMax, Math.min(p.fichas, Math.round(cantidad))));
    if (monto <= 0 || monto > p.fichas) return { ok: false, reason: 'fichas-insuficientes' };
    p.apuesta = monto;
    this.emitir({ t: 'apuesta', id, cantidad: monto });
    return { ok: true, cantidad: monto };
  }

  /** ¿Han apostado todos los que pueden jugar? */
  apuestasListas() {
    const listos = this.elegibles();
    return listos.length > 0 && listos.every((p) => p.apuesta > 0);
  }

  repartir() {
    const juegan = this.elegibles().filter((p) => p.apuesta > 0);
    if (!juegan.length) return { ok: false, reason: 'nadie-ha-apostado' };

    for (const p of juegan) {
      p.fichas -= p.apuesta;
      p.manos = [{ cartas: [], apuesta: p.apuesta, estado: 'jugando', doblada: false, dividida: false }];
      p.stats.rondas++;
    }
    this.banca = { cartas: [], oculta: true };

    // Dos vueltas, como en la mesa de verdad.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      for (const p of juegan) p.manos[0].cartas.push(this.sacar());
      this.banca.cartas.push(this.sacar());
    }

    for (const p of juegan) {
      if (esBlackjack(p.manos[0])) {
        p.manos[0].estado = 'blackjack';
        p.stats.blackjacks++;
      }
    }

    this.estado = 'turnos';
    this.emitir({ t: 'reparto', ronda: this.ronda });
    this.turno = -1;
    this.siguienteTurno();
    return { ok: true };
  }

  /** Pasa al siguiente jugador (o mano) que tenga algo que decidir. */
  siguienteTurno() {
    // Primero, otra mano del mismo jugador (division)
    const p = this.actual();
    if (p) {
      for (let i = this.manoActiva + 1; i < p.manos.length; i++) {
        if (p.manos[i].estado === 'jugando') {
          this.manoActiva = i;
          this.emitir({ t: 'turno', id: p.id, mano: i });
          return;
        }
      }
    }
    // Luego, el siguiente jugador
    for (let i = this.turno + 1; i < this.jugadores.length; i++) {
      const j = this.jugadores[i];
      const idx = j.manos.findIndex((m) => m.estado === 'jugando');
      if (idx >= 0) {
        this.turno = i;
        this.manoActiva = idx;
        this.emitir({ t: 'turno', id: j.id, mano: idx });
        return;
      }
    }
    // Nadie mas: juega la banca
    this.turno = -1;
    this.estado = 'banca';
    this.emitir({ t: 'turnoBanca' });
  }

  // ----------------------------------------------------------------- acciones

  /** Comprueba que le toca a este jugador y devuelve su mano en juego. */
  suTurno(id) {
    if (this.estado !== 'turnos') return null;
    const p = this.actual();
    if (!p || p.id !== id) return null;
    const mano = p.manos[this.manoActiva];
    return mano && mano.estado === 'jugando' ? { p, mano } : null;
  }

  opciones(id) {
    const t = this.suTurno(id);
    if (!t) return { tuTurno: false };
    const { p, mano } = t;
    const v = valorMano(mano.cartas);
    const primera = mano.cartas.length === 2;
    const parejaIgual = primera && mano.cartas[0].r === mano.cartas[1].r;
    const asDividido = mano.dividida && mano.cartas[0].r === 14;
    return {
      tuTurno: true,
      total: v.total,
      blanda: v.blanda,
      puedePedir: v.total < 21 && !asDividido,
      puedePlantarse: true,
      puedeDoblar: primera && p.fichas >= mano.apuesta && !asDividido,
      puedeDividir: parejaIgual && p.manos.length < 4 && p.fichas >= mano.apuesta
    };
  }

  pedir(id) {
    const t = this.suTurno(id);
    if (!t) return { ok: false, reason: 'no-es-tu-turno' };
    const { p, mano } = t;
    if (!this.opciones(id).puedePedir) return { ok: false, reason: 'no-puedes-pedir' };
    const carta = this.sacar();
    mano.cartas.push(carta);
    const v = valorMano(mano.cartas);
    this.emitir({ t: 'carta', id: p.id, mano: this.manoActiva, carta, total: v.total });
    if (v.total > 21) {
      mano.estado = 'pasado';
      this.emitir({ t: 'pasado', id: p.id, mano: this.manoActiva, total: v.total });
      this.siguienteTurno();
    } else if (v.total === 21) {
      mano.estado = 'plantado';
      this.siguienteTurno();
    }
    return { ok: true, total: v.total };
  }

  plantarse(id) {
    const t = this.suTurno(id);
    if (!t) return { ok: false, reason: 'no-es-tu-turno' };
    t.mano.estado = 'plantado';
    this.emitir({ t: 'planta', id, mano: this.manoActiva, total: valorMano(t.mano.cartas).total });
    this.siguienteTurno();
    return { ok: true };
  }

  doblar(id) {
    const t = this.suTurno(id);
    if (!t) return { ok: false, reason: 'no-es-tu-turno' };
    if (!this.opciones(id).puedeDoblar) return { ok: false, reason: 'no-puedes-doblar' };
    const { p, mano } = t;
    p.fichas -= mano.apuesta;
    mano.apuesta *= 2;
    mano.doblada = true;
    const carta = this.sacar();
    mano.cartas.push(carta);
    const v = valorMano(mano.cartas);
    mano.estado = v.total > 21 ? 'pasado' : 'plantado';
    this.emitir({ t: 'dobla', id: p.id, mano: this.manoActiva, carta, total: v.total });
    if (v.total > 21) this.emitir({ t: 'pasado', id: p.id, mano: this.manoActiva, total: v.total });
    this.siguienteTurno();
    return { ok: true, total: v.total };
  }

  dividir(id) {
    const t = this.suTurno(id);
    if (!t) return { ok: false, reason: 'no-es-tu-turno' };
    if (!this.opciones(id).puedeDividir) return { ok: false, reason: 'no-puedes-dividir' };
    const { p, mano } = t;
    p.fichas -= mano.apuesta;
    const segunda = mano.cartas.pop();
    const nueva = {
      cartas: [segunda, this.sacar()],
      apuesta: mano.apuesta,
      estado: 'jugando',
      doblada: false,
      dividida: true
    };
    mano.cartas.push(this.sacar());
    mano.dividida = true;
    p.manos.splice(this.manoActiva + 1, 0, nueva);
    this.emitir({ t: 'divide', id: p.id, mano: this.manoActiva });

    // Los ases divididos reciben una carta y se plantan.
    if (mano.cartas[0].r === 14) {
      mano.estado = 'plantado';
      nueva.estado = 'plantado';
      this.siguienteTurno();
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------- banca

  /** La banca destapa y pide hasta 17. */
  jugarBanca() {
    if (this.estado !== 'banca') return { ok: false };
    this.banca.oculta = false;
    this.emitir({ t: 'destapa', cartas: this.banca.cartas.slice() });

    const hayQueJugar = this.jugadores.some((p) =>
      p.manos.some((m) => m.estado === 'plantado' || m.estado === 'blackjack')
    );
    if (hayQueJugar) {
      let guarda = 0;
      while (valorMano(this.banca.cartas).total < 17 && guarda++ < 12) {
        const carta = this.sacar();
        this.banca.cartas.push(carta);
        this.emitir({ t: 'cartaBanca', carta, total: valorMano(this.banca.cartas).total });
      }
    }
    this.estado = 'pagos';
    return { ok: true, total: valorMano(this.banca.cartas).total };
  }

  /** Reparte premios y deja la ronda lista para la siguiente. */
  pagar() {
    const vBanca = valorMano(this.banca.cartas);
    const bancaBJ = this.banca.cartas.length === 2 && vBanca.total === 21;
    const detalle = [];

    for (const p of this.jugadores) {
      for (let i = 0; i < p.manos.length; i++) {
        const m = p.manos[i];
        if (!m.cartas.length) continue;
        const v = valorMano(m.cartas);
        let resultado, premio = 0;

        if (m.estado === 'pasado') {
          resultado = 'pierde';
        } else if (m.estado === 'blackjack') {
          if (bancaBJ) {
            resultado = 'empata';
            premio = m.apuesta;
          } else {
            resultado = 'blackjack';
            premio = m.apuesta + Math.round(m.apuesta * 1.5);
          }
        } else if (bancaBJ) {
          resultado = 'pierde';
        } else if (vBanca.total > 21) {
          resultado = 'gana';
          premio = m.apuesta * 2;
        } else if (v.total > vBanca.total) {
          resultado = 'gana';
          premio = m.apuesta * 2;
        } else if (v.total === vBanca.total) {
          resultado = 'empata';
          premio = m.apuesta;
        } else {
          resultado = 'pierde';
        }

        p.fichas += premio;
        if (resultado === 'gana' || resultado === 'blackjack') p.stats.ganadas++;
        m.resultado = resultado;
        m.premio = premio;
        detalle.push({ id: p.id, mano: i, resultado, premio, apuesta: m.apuesta, total: v.total });
      }
    }

    this.resultados = { banca: vBanca.total, bancaBJ, detalle };
    this.emitir({ t: 'pagos', resultados: this.resultados });
    return this.resultados;
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

  snapshot(viewerId = null) {
    const yo = this.porId(viewerId);
    const ocultarBanca = this.banca.oculta && this.estado !== 'pagos';
    return {
      juego: 'blackjack',
      ronda: this.ronda,
      estado: this.estado,
      you: viewerId,
      apuestaMin: this.apuestaMin,
      apuestaMax: this.apuestaMax,
      zapato: this.zapato.length,
      banca: {
        // Sin cartas repartidas no se pinta nada (antes salian dos fantasma).
        cartas: this.banca.cartas.length === 0
          ? []
          : (ocultarBanca ? [this.banca.cartas[0], null] : this.banca.cartas.slice()),
        // Con la carta tapada se enseña solo lo que vale la descubierta.
        total: ocultarBanca ? null : valorMano(this.banca.cartas).total,
        visible: ocultarBanca && this.banca.cartas.length
          ? valorMano(this.banca.cartas.slice(0, 1)).total
          : null,
        oculta: ocultarBanca
      },
      turno: this.actual() ? this.actual().id : null,
      manoActiva: this.manoActiva,
      resultados: this.resultados,
      opciones: viewerId ? this.opciones(viewerId) : { tuTurno: false },
      jugadores: this.jugadores.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        avatar: p.avatar,
        esBot: p.esBot,
        ausente: p.ausente,
        seat: p.seat,
        fichas: p.fichas,
        apuesta: p.apuesta,
        soyYo: !!yo && p.id === yo.id,
        esTuTurno: this.actual() === p,
        stats: p.stats,
        manos: p.manos.map((m) => ({
          cartas: m.cartas.slice(),
          total: valorMano(m.cartas).total,
          blanda: valorMano(m.cartas).blanda,
          apuesta: m.apuesta,
          estado: m.estado,
          doblada: m.doblada,
          dividida: m.dividida,
          resultado: m.resultado || null,
          premio: m.premio || 0
        }))
      }))
    };
  }
}
