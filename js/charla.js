// Los bots sueltan algún comentario en los momentos gordos de cada juego.
// Es puro adorno, pero una mesa donde nadie dice nada parece vacía.
//
// Reglas que se siguen aquí:
//  - nunca dos veces seguidas la misma frase,
//  - como mucho un comentario cada pocos segundos por mesa,
//  - y solo cuando de verdad ha pasado algo (no de relleno).

const FRASES = {
  // ---- póker
  ganaBote: ['Uy, qué bote', 'Ese era mío…', 'Buena mano', 'Así cualquiera', 'Enhorabuena'],
  allin: ['Voy con todo', 'A ver si hay huevos', 'Todo o nada', 'Me la juego'],
  farolPillado: ['Te vi el farol', 'Sabía que ibas de vacío', 'Menudo morro'],
  granSubida: ['Qué agresivo', 'Ahí va la mitad del stack', 'Tranquilo, campeón'],
  meVoy: ['Nada, esta la dejo', 'No me llega', 'Paso, paso'],

  // ---- UNO
  unoCantado: ['¡Que canta UNO!', 'A por él', 'No le dejéis'],
  masCuatro: ['Serás rata', 'No me hagas eso', 'Toma cuatro, toma'],
  pillado: ['¡Pillado!', 'No lo cantaste', 'A robar dos'],
  ganaRonda: ['Otra para mí', 'Qué cartas me entran', 'Se juega así'],

  // ---- blackjack
  blackjack: ['¡Blackjack!', 'Veintiuno clavado', 'Qué gusto'],
  pasado: ['Me he pasado', 'Otra vez no…', 'Qué manía de pedir'],
  bancaSePasa: ['Se pasó la banca', 'Gracias, crupier', 'Ahí estaba'],

  // ---- alto o bajo
  acierto: ['Lo sabía', 'Cantado', 'Estaba clarísimo'],
  fallo: ['No me lo creo', 'Casi', 'Menuda suerte tiene'],
  racha: ['Va lanzado', 'Paradle ya', 'Qué racha lleva']
};

const PAUSA_MINIMA = 6000;    // ms entre comentarios en una misma mesa

export class Charla {
  /**
   * @param {object} mesa  la mesa, que es quien sabe hablar (mesa.chat)
   * @param {object} opts  { probabilidad } de 0 a 1
   */
  constructor(mesa, { probabilidad = 0.45 } = {}) {
    this.mesa = mesa;
    this.probabilidad = probabilidad;
    this.ultima = 0;
    this.dichas = new Set();
  }

  /** Elige una frase del grupo que no se haya dicho hace nada. */
  frase(grupo) {
    const lista = FRASES[grupo];
    if (!lista || !lista.length) return null;
    const frescas = lista.filter((f) => !this.dichas.has(f));
    const pool = frescas.length ? frescas : lista;
    const f = pool[Math.floor(Math.random() * pool.length)];
    this.dichas.add(f);
    if (this.dichas.size > 12) this.dichas.delete([...this.dichas][0]);
    return f;
  }

  /** ¿Toca hablar? Ni muy seguido ni siempre. */
  puede() {
    const ahora = Date.now();
    if (ahora - this.ultima < PAUSA_MINIMA) return false;
    if (Math.random() > this.probabilidad) return false;
    this.ultima = ahora;
    return true;
  }

  /**
   * Suelta un comentario de un bot cualquiera (o de uno concreto).
   * @param {string} grupo   clave de FRASES
   * @param {string} [botId] si se quiere que hable uno en particular
   * @param {number} [retardo] ms de espera, para que no sea instantáneo
   */
  decir(grupo, botId = null, retardo = 700 + Math.random() * 1400) {
    if (!this.puede()) return;
    const bots = this.bots();
    if (!bots.length) return;
    const quien = (botId && bots.find((b) => b.id === botId)) ||
      bots[Math.floor(Math.random() * bots.length)];
    const texto = this.frase(grupo);
    if (!texto || !quien) return;
    const t = setTimeout(() => {
      try {
        if (this.mesa.destroyed) return;
        this.mesa.chat(quien.id, texto);
      } catch (_) {}
    }, retardo);
    if (t.unref) t.unref();
  }

  /** Los bots de la mesa, sea cual sea el juego. */
  bots() {
    const g = this.mesa.game;
    if (!g) return [];
    const lista = g.jugadores || (g.seats ? g.seats.filter(Boolean) : []);
    return lista.filter((p) => p && (p.esBot || p.isBot) && !p.ausente);
  }
}

export const FRASES_BOT = FRASES;
