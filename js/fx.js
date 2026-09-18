// Efectos visuales: confeti, fichas voladoras, textos flotantes y brillos.

const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const motion = {
  reduced: REDUCED,
  speed: 1,
  get on() {
    return !this.reduced;
  }
};

/**
 * Lanza una animacion y la suelta al acabar. Sin esto se acumulan cientos de
 * animaciones terminadas a lo largo de una partida larga.
 */
export function animateOnce(el, keyframes, options) {
  const anim = el.animate(keyframes, options);
  anim.onfinish = () => {
    try {
      anim.cancel();
    } catch (_) {}
  };
  return anim;
}

export function ms(v) {
  return Math.max(0, Math.round(v / (motion.speed || 1)));
}

export function wait(v) {
  return new Promise((r) => setTimeout(r, ms(v)));
}

/** Rectangulo de un elemento relativo a la capa de animacion. */
export function rectIn(el, layer) {
  const a = el.getBoundingClientRect();
  const b = layer.getBoundingClientRect();
  return {
    x: a.left - b.left,
    y: a.top - b.top,
    w: a.width,
    h: a.height,
    cx: a.left - b.left + a.width / 2,
    cy: a.top - b.top + a.height / 2
  };
}

/** Anima un nodo de A a B con un arco suave. Devuelve una promesa. */
export function flyTo(node, from, to, { duration = 550, arc = 60, spin = 0, scaleTo = 1, easing = 'cubic-bezier(.22,.9,.24,1)' } = {}) {
  const layer = node.parentElement;
  node.style.left = from.cx + 'px';
  node.style.top = from.cy + 'px';
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const anim = node.animate(
    [
      { transform: 'translate(-50%,-50%) translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${dx * 0.5}px, ${dy * 0.5 - arc}px) rotate(${spin * 0.5}deg) scale(${(1 + scaleTo) / 2})`, opacity: 1, offset: 0.55 },
      { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${scaleTo})`, opacity: 1 }
    ],
    { duration: ms(duration), easing, fill: 'forwards' }
  );
  return anim.finished.catch(() => {});
}

/** Texto flotante tipo "+1.250" sobre un punto. */
export function floatText(layer, point, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'float-text ' + cls;
  el.textContent = text;
  el.style.left = point.cx + 'px';
  el.style.top = point.cy + 'px';
  layer.appendChild(el);
  el.animate(
    [
      { transform: 'translate(-50%,-50%) translateY(0) scale(.7)', opacity: 0 },
      { transform: 'translate(-50%,-50%) translateY(-18px) scale(1.1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%,-50%) translateY(-54px) scale(1)', opacity: 0 }
    ],
    { duration: ms(1500), easing: 'ease-out' }
  ).finished.catch(() => {}).then(() => el.remove());
  return el;
}

/** Ficha de colores segun valor (como en un casino). */
export function chipColor(value) {
  if (value >= 5000) return { body: '#1c1c22', ring: '#f6c453', label: '#f6c453' };
  if (value >= 1000) return { body: '#7a2ff2', ring: '#e9d8ff', label: '#fff' };
  if (value >= 500) return { body: '#2b2f77', ring: '#8ba2ff', label: '#dfe6ff' };
  if (value >= 100) return { body: '#14202b', ring: '#9fb6c9', label: '#dff0ff' };
  if (value >= 25) return { body: '#1f7a43', ring: '#a7f3c8', label: '#eafff2' };
  if (value >= 5) return { body: '#b02b2b', ring: '#ffc2c2', label: '#fff0f0' };
  return { body: '#e9eef5', ring: '#9aa7b8', label: '#1a2030' };
}

export function makeChipEl(value) {
  const c = chipColor(value);
  const el = document.createElement('div');
  el.className = 'fx-chip';
  el.style.setProperty('--chip-body', c.body);
  el.style.setProperty('--chip-ring', c.ring);
  return el;
}

/** Descompone una cantidad en fichas visibles (maximo 5). */
export function chipBreakdown(amount) {
  const denoms = [5000, 1000, 500, 100, 25, 5, 1];
  const out = [];
  let rest = amount;
  for (const d of denoms) {
    while (rest >= d && out.length < 5) {
      out.push(d);
      rest -= d;
    }
    if (out.length >= 5) break;
  }
  if (!out.length) out.push(1);
  return out;
}

// ----------------------------------------------------------------- confeti

let confettiCanvas = null;
let confettiCtx = null;
let particles = [];
let rafId = null;

export function initConfetti(canvas) {
  confettiCanvas = canvas;
  confettiCtx = canvas.getContext('2d');
  resizeConfetti();
  window.addEventListener('resize', resizeConfetti);
}

function resizeConfetti() {
  if (!confettiCanvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  confettiCanvas.width = confettiCanvas.clientWidth * dpr;
  confettiCanvas.height = confettiCanvas.clientHeight * dpr;
  confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const CONFETTI_COLORS = ['#f6c453', '#ff6b6b', '#4ecdc4', '#a06bff', '#7ef29d', '#ffffff'];

export function confettiBurst(x, y, count = 90, power = 1) {
  if (!confettiCtx || motion.reduced) return;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 7) * power;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      size: 4 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 90 + Math.random() * 60,
      shape: Math.random() < 0.35 ? 'circle' : 'rect'
    });
  }
  if (!rafId) rafId = requestAnimationFrame(stepConfetti);
}

export function coinRain(count = 40) {
  if (!confettiCtx || motion.reduced) return;
  const w = confettiCanvas.clientWidth;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * w,
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 1.5,
      vy: 2 + Math.random() * 3,
      size: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: '#f6c453',
      life: 220,
      shape: 'coin'
    });
  }
  if (!rafId) rafId = requestAnimationFrame(stepConfetti);
}

function stepConfetti() {
  const ctx = confettiCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, confettiCanvas.clientWidth, confettiCanvas.clientHeight);
  particles = particles.filter((p) => p.life > 0 && p.y < confettiCanvas.clientHeight + 60);
  for (const p of particles) {
    p.life--;
    p.vy += 0.16;
    p.vx *= 0.995;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'coin') {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size / 2, p.size / 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.stroke();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  if (particles.length) rafId = requestAnimationFrame(stepConfetti);
  else rafId = null;
}

/** Tween numerico para contadores de fichas. */
export function tweenNumber(el, from, to, duration = 700, format = (v) => Math.round(v).toLocaleString('es-ES')) {
  if (from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const dur = ms(duration);
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// -------------------------------------------------- aviso de "te toca a ti"

/**
 * El navegador no deja vibrar hasta que el usuario ha tocado la pantalla.
 * Llevamos la cuenta para no llenar la consola de avisos al reconectar.
 */
let huboGesto = false;
const marcarGesto = () => {
  huboGesto = true;
  window.removeEventListener('pointerdown', marcarGesto);
  window.removeEventListener('keydown', marcarGesto);
  window.removeEventListener('touchstart', marcarGesto);
};
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', marcarGesto, { passive: true });
  window.addEventListener('keydown', marcarGesto);
  window.addEventListener('touchstart', marcarGesto, { passive: true });
}

export function vibrar(patron) {
  if (!huboGesto || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try { navigator.vibrate(patron); } catch (_) {}
}

/**
 * Parpadeo del título de la pestaña. Sirve para enterarte de que te toca
 * cuando estás en otra pestaña, que es lo normal en clase.
 *
 * Se guarda si tienes turno pendiente: así también parpadea cuando te vas
 * de la pestaña con el turno ya abierto, no solo si te toca estando fuera.
 */
let tituloOriginal = null;
let tituloTimer = null;
let turnoPendiente = false;
let textoTurno = '🔔 ¡Te toca!';

export function parpadearTitulo(texto = textoTurno) {
  if (tituloTimer || typeof document === 'undefined') return;
  tituloOriginal = tituloOriginal || document.title;
  let puesto = false;
  tituloTimer = setInterval(() => {
    document.title = puesto ? tituloOriginal : texto;
    puesto = !puesto;
  }, 900);
}

export function pararParpadeo() {
  turnoPendiente = false;
  if (!tituloTimer) return;
  clearInterval(tituloTimer);
  tituloTimer = null;
  if (tituloOriginal) document.title = tituloOriginal;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (turnoPendiente) parpadearTitulo(textoTurno);
    } else if (tituloTimer) {
      clearInterval(tituloTimer);
      tituloTimer = null;
      if (tituloOriginal) document.title = tituloOriginal;
    }
  });
}

/** Sonido lo pone cada juego; esto es el resto del aviso. */
export function avisarTurno(texto = '🔔 ¡Te toca!') {
  textoTurno = texto;
  turnoPendiente = true;
  vibrar([35, 60, 35]);
  if (typeof document !== 'undefined' && document.hidden) parpadearTitulo(texto);
}
