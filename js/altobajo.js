// Alto o bajo: se ve una carta y todos apuestan a la vez si la siguiente sera
// mas alta o mas baja. Fallar cuesta una vida; acertar seguido da mas puntos.
// Al ser simultaneo nadie espera turno, que es la gracia del juego.

import { makeDeck, shuffle, secureRng, RANK_LABEL } from './cards.js';

export const VIDAS = 3;
/** Tope de cartas por ronda: evita rondas eternas si nadie falla. */
export const MAX_CARTAS = 40;

export class AltoBajoGame {
  constructor(opts = {}) {
    this.rng = opts.rng || secureRng();
    this.vidas = opts.vidas || VIDAS;
    this.jugadores = [];
    this.mazo = [];
    this.carta = null;
    this.reveladas = [];
    this.ronda = 0;
    this.mano = 0;          // cartas dentro de la ronda
    this.estado = 'idle';   // idle | apuestas | revelando | finRonda
    this.eventos = [];
    this.ultimo = null;     // resultado de la ultima carta
  }

  sentar(j) {
    const ex = this.porId(j.id);
    if (ex) {
      ex.ausente = false;
      ex.nombre = j.name || ex.nombre;
      return { ok: true, seat: ex.seat, rejoined: true };
    }
    if (this.jugadores.length >= 10) return { ok: false, reason: 'table-full' };
    const p = {
      id: j.id,
      nombre: j.name || 'Invitado',
      avatar: j.avatar || '🙂',
      esBot: !!j.isBot,
      vidas: this.vidas,
      puntos: 0,
      racha: 0,
      mejorRacha: 0,
      apuesta: null,
      vivo: true,
      ausente: false,
      // Con la ronda empezada se mira: entrar con tres vidas nuevas a mitad
      // de partida alarga la ronda indefinidamente y es injusto.
      esperando: this.estado === 'apuestas' || this.estado === 'revelando',
      rondasGanadas: 0,
      seat: this.jugadores.length
    };
    this.jugadores.push(p);
    return { ok: true, seat: p.seat };
  }

  salir(id) {
    const i = this.jugadores.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.jugadores.splice(i, 1);
    this.jugadores.forEach((p, idx) => (p.seat = idx));
    return true;
  }

  porId(id) {
    return this.jugadores.find((p) => p.id === id) || null;
  }

  vivos() {
    return this.jugadores.filter((p) => p.vivo && !p.ausente && !p.esperando);
  }

  sacar() {
    if (!this.mazo.length) {
      this.mazo = shuffle(makeDeck(), this.rng);
      this.emitir({ t: 'baraja' });
    }
    return this.mazo.pop();
  }

  nuevaRonda() {
    if (this.jugadores.length < 1) {
      this.estado = 'idle';
      return { ok: false, reason: 'faltan-jugadores' };
    }
    this.ronda++;
    this.mano = 0;
    this.mazo = shuffle(makeDeck(), this.rng);
    this.reveladas = [];
    this.ultimo = null;
    for (const p of this.jugadores) {
      p.vidas = this.vidas;
      p.racha = 0;
      p.apuesta = null;
      p.esperando = false;      // ronda nueva, juegan todos
      p.vivo = !p.ausente;
    }
    this.carta = this.sacar();
    this.reveladas.push(this.carta);
    this.estado = 'apuestas';
    this.emitir({ t: 'nuevaRonda', ronda: this.ronda, carta: this.carta });
    return { ok: true };
  }

  apostar(id, apuesta) {
    if (this.estado !== 'apuestas') return { ok: false, reason: 'no-toca-apostar' };
    if (apuesta !== 'alto' && apuesta !== 'bajo') return { ok: false, reason: 'apuesta-invalida' };
    const p = this.porId(id);
    if (!p || !p.vivo) return { ok: false, reason: 'no-juegas' };
    p.apuesta = apuesta;
    this.emitir({ t: 'apuesta', id, apuesta });
    return { ok: true };
  }

  /** ¿Han apostado ya todos los que siguen vivos? */
  todosListos() {
    const v = this.vivos();
    return v.length > 0 && v.every((p) => p.apuesta !== null);
  }

  /**
   * Da la vuelta a la siguiente carta y resuelve.
   * Empate: no pasa nada, ni puntos ni vidas.
   */
  revelar() {
    if (this.estado !== 'apuestas') return { ok: false };
    const anterior = this.carta;
    const nueva = this.sacar();
    this.carta = nueva;
    this.reveladas.push(nueva);
    this.mano++;

    const subio = nueva.r > anterior.r;
    const empate = nueva.r === anterior.r;
    const acertada = empate ? null : subio ? 'alto' : 'bajo';
    const detalle = [];

    for (const p of this.jugadores) {
      if (!p.vivo) continue;
      if (p.apuesta === null) {
        detalle.push({ id: p.id, resultado: 'sin-apostar' });
        continue;
      }
      if (empate) {
        detalle.push({ id: p.id, resultado: 'empate' });
      } else if (p.apuesta === acertada) {
        p.racha++;
        p.mejorRacha = Math.max(p.mejorRacha, p.racha);
        const gana = 1 + Math.floor(p.racha / 3);   // las rachas pagan mas
        p.puntos += gana;
        detalle.push({ id: p.id, resultado: 'acierta', puntos: gana, racha: p.racha });
      } else {
        p.racha = 0;
        p.vidas--;
        if (p.vidas <= 0) p.vivo = false;
        detalle.push({ id: p.id, resultado: 'falla', vidas: p.vidas });
      }
      p.apuesta = null;
    }

    this.ultimo = { anterior, nueva, acertada, empate, detalle };
    this.emitir({ t: 'revela', anterior, nueva, acertada, empate, detalle });

    const vivos = this.vivos();
    const soloUno = this.jugadores.length > 1 && vivos.length <= 1;
    const demasiadas = this.mano >= MAX_CARTAS;
    if (soloUno || vivos.length === 0 || demasiadas) {
      this.estado = 'finRonda';
      // Si se acaba por tope, gana quien mas puntos lleve de los que siguen.
      const ganador = soloUno || vivos.length === 0
        ? (vivos[0] || null)
        : [...vivos].sort((a, b) => b.puntos - a.puntos)[0] || null;
      if (ganador) {
        ganador.rondasGanadas++;
        ganador.puntos += 5;                    // premio por aguantar
      }
      this.emitir({ t: 'finRonda', ganador: ganador ? ganador.id : null });
    } else {
      this.estado = 'apuestas';
    }
    return { ok: true, empate, acertada };
  }

  emitir(ev) {
    this.eventos.push({ ...ev, n: this.eventos.length });
  }

  vaciarEventos() {
    const e = this.eventos;
    this.eventos = [];
    return e;
  }

  snapshot(viewerId = null) {
    const yo = this.porId(viewerId);
    return {
      juego: 'altobajo',
      ronda: this.ronda,
      mano: this.mano,
      estado: this.estado,
      you: viewerId,
      carta: this.carta,
      // Solo las ultimas, para no mandar la lista entera cada vez
      reveladas: this.reveladas.slice(-8),
      mazoRestante: this.mazo.length,
      ultimo: this.ultimo,
      tuApuesta: yo ? yo.apuesta : null,
      vidasMax: this.vidas,
      jugadores: this.jugadores.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        avatar: p.avatar,
        esBot: p.esBot,
        ausente: p.ausente,
        vidas: p.vidas,
        puntos: p.puntos,
        racha: p.racha,
        mejorRacha: p.mejorRacha,
        rondasGanadas: p.rondasGanadas,
        vivo: p.vivo,
        esperando: !!p.esperando,
        // La apuesta ajena no se ve hasta que se revela: si no, se copian.
        apuesta: (yo && p.id === yo.id) ? p.apuesta : (p.apuesta ? 'oculta' : null),
        soyYo: !!yo && p.id === yo.id
      }))
    };
  }
}

export function etiquetaCarta(c) {
  return c ? RANK_LABEL[c.r] : '?';
}
