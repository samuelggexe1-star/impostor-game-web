// Arranque de la aplicacion: vestibulo, creacion de sesiones y ajustes.

import { Table, DEFAULT_CONFIG } from './table.js';
import { LocalSession, HostSession, GuestSession, RelaySession, roomCode, peerAvailable } from './net.js';
import { relayInfo, relayRooms, createRelayRoom, relayBase, setRelayBase } from './relay.js';
import { UnoMesa } from './uno-mesa.js';
import { UnoUI } from './uno-ui.js';
import { BlackjackMesa } from './blackjack-mesa.js';
import { BlackjackUI } from './bj-ui.js';
import { AltoBajoMesa } from './altobajo-mesa.js';
import { AltoBajoUI } from './ab-ui.js';
import { TableUI } from './ui.js';
import { sfx } from './sound.js';
import { motion, ms, animateOnce } from './fx.js';

const AVATARS = ['😎', '🤠', '👑', '🦊', '🐺', '🦁', '🐲', '🦈', '👻', '🤖', '🧙', '🥷', '🐼', '🦩', '🍀', '💎', '🎩', '🚀'];

/** Juegos de la sala. Añadir uno nuevo es añadir una entrada aquí. */
const JUEGOS = [
  {
    id: 'holdem',
    nombre: "Texas Hold'em",
    icono: '♠️',
    etiqueta: 'Disponible',
    descripcion: 'Poker No Limit con tus amigos. Sala privada con código, bots y todas las reglas de verdad.',
    accion: 'Jugar',
    abrir: () => mostrarPantalla('lobby')
  },
  {
    id: 'uno',
    nombre: 'UNO',
    icono: '🃏',
    etiqueta: 'Disponible',
    descripcion: 'El de toda la vida: colores, números, +2, +4 y cantar ¡UNO! antes de que te pillen.',
    accion: 'Jugar',
    abrir: () => mostrarPantalla('unoLobby')
  },
  {
    id: 'blackjack',
    nombre: 'Blackjack',
    icono: '🂡',
    etiqueta: 'Disponible',
    descripcion: 'Llegar a 21 sin pasarse. Doblar, dividir y aguantar el tipo contra la banca.',
    accion: 'Jugar',
    abrir: () => mostrarPantalla('bjLobby')
  },
  {
    id: 'altobajo',
    nombre: 'Alto o bajo',
    icono: '🔮',
    etiqueta: 'Disponible',
    descripcion: '¿La siguiente carta será más alta o más baja? Todos a la vez, tres vidas y gana el que aguante.',
    accion: 'Jugar',
    abrir: () => mostrarPantalla('abLobby')
  },
  {
    id: 'impostor',
    nombre: 'El Impostor',
    icono: '🎭',
    etiqueta: 'Próximamente',
    descripcion: 'Todos reciben una palabra menos uno. Hay que descubrir quién va de farol.',
    bloqueado: true
  }
];
const STORE_KEY = 'holdem-club/perfil';
const SETTINGS_KEY = 'holdem-club/ajustes';

const state = {
  profile: { name: '', avatar: '😎', id: null },
  settings: {
    volume: 0.5,
    sound: true,
    speed: 2,
    fourColor: false,
    equity: true,
    confetti: true,
    felt: 'esmeralda'
  },
  session: null,
  table: null,
  ui: null,
  server: null       // informacion del servidor de partidas, si lo hay
};

/**
 * Con servidor de partidas, las mesas viven alli: es lo que funciona en redes
 * con restricciones y evita que nadie tenga que dejar el movil encendido.
 * Sin servidor (por ejemplo en GitHub Pages) se cae a conexion directa WebRTC.
 */
function canGoOnline() {
  return !!state.server || peerAvailable();
}

const $ = (id) => document.getElementById(id);

// --------------------------------------------------------------- persistencia

function loadStored() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    Object.assign(state.profile, p);
  } catch (_) {}
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    Object.assign(state.settings, s);
  } catch (_) {}
  if (!state.profile.id) state.profile.id = 'p-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Identidad para esta pestaña. El nombre y el avatar se recuerdan en el
 * dispositivo, pero el jugador es por pestaña: si no, dos ventanas del mismo
 * iPad entran como la misma persona y acaban viendo las mismas cartas.
 * Sobrevive a recargar la pagina, que es lo que pasa al reconectar.
 */
function tabPlayerId() {
  try {
    let id = sessionStorage.getItem('holdem-club/pestana');
    if (!id) {
      id = (state.profile.id || 'p') + '-' + Math.random().toString(36).slice(2, 6);
      sessionStorage.setItem('holdem-club/pestana', id);
    }
    return id;
  } catch (_) {
    if (!state._fallbackId) state._fallbackId = 'p-' + Math.random().toString(36).slice(2, 10);
    return state._fallbackId;
  }
}

function saveProfile() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.profile));
  } catch (_) {}
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (_) {}
}

function applySettings() {
  const s = state.settings;
  sfx.setVolume(s.volume);
  sfx.setEnabled(s.sound);
  motion.speed = [1, 0.75, 1, 1.6][s.speed] || 1;
  document.body.classList.toggle('four-color', s.fourColor);
  document.body.dataset.felt = s.felt;
  $('btnSound').textContent = s.sound ? '🔊' : '🔇';
  if (state.table) state.table.config.speed = [1, 0.7, 1, 1.7][s.speed] || 1;
  const speedNames = { 1: 'relajada', 2: 'normal', 3: 'rápida' };
  $('speedLabel').textContent = speedNames[s.speed] || 'normal';
}

// ---------------------------------------------------------------- pantallas

/** Solo una pantalla visible a la vez: hub, vestibulo del juego o mesa. */
function mostrarPantalla(cual) {
  for (const id of ['hub', 'lobby', 'game', 'unoLobby', 'unoGame', 'bjLobby', 'bjGame', 'abLobby', 'abGame']) {
    document.getElementById(id).classList.toggle('active', id === cual);
  }
  if (cual.endsWith('Lobby') || cual === 'lobby') {
    if (cual === 'lobby') {
      $('lobbyAvatar').textContent = state.profile.avatar;
      $('lobbyName').textContent = state.profile.name || 'Sin nombre';
    } else if (cual === 'unoLobby') {
      $('unoLobbyAvatar').textContent = state.profile.avatar;
      $('unoLobbyName').textContent = state.profile.name || 'Sin nombre';
    }
    document.querySelectorAll('#' + cual + ' .mi-avatar').forEach((e) => (e.textContent = state.profile.avatar));
    document.querySelectorAll('#' + cual + ' .mi-nombre').forEach((e) => (e.textContent = state.profile.name || 'Sin nombre'));
    detectServer();
  }
}

function construirHub() {
  const grid = $('gameGrid');
  grid.innerHTML = '';
  let n = 0;
  for (const j of JUEGOS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'game-card' + (j.bloqueado ? ' locked' : '');
    card.innerHTML = `
      <span class="g-tag">${escapeHtml(j.etiqueta)}</span>
      <span class="g-icon">${j.icono}</span>
      <span class="g-name">${escapeHtml(j.nombre)}</span>
      <span class="g-desc">${escapeHtml(j.descripcion)}</span>
      <span class="g-go">${j.bloqueado ? 'En preparación' : escapeHtml(j.accion)}</span>`;
    if (!j.bloqueado) {
      card.onclick = () => {
        if (!requireNameHub()) return;
        sfx.init();
        sfx.chip(1);
        j.abrir();
      };
    }
    grid.appendChild(card);
    // Las tarjetas entran en cascada, una detrás de otra.
    if (!motion.reduced) {
      animateOnce(card, [
        { transform: 'translateY(26px) scale(.94)', opacity: 0 },
        { transform: 'none', opacity: 1 }
      ], { duration: ms(430), delay: ms(70 + n * 85), easing: 'cubic-bezier(.2,.9,.24,1)', fill: 'backwards' });
    }
    n++;
  }
}

function bindHub() {
  const input = $('hubName');
  input.value = state.profile.name;
  input.addEventListener('input', (e) => {
    state.profile.name = e.target.value.slice(0, 16);
    saveProfile();
  });

  $('hubAvatarBig').textContent = state.profile.avatar;
  const panel = $('hubAvatars');
  const toggle = () => { panel.hidden = !panel.hidden; };
  $('btnChangeAvatar').onclick = toggle;
  $('hubAvatarBig').onclick = toggle;

  panel.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-opt' + (a === state.profile.avatar ? ' selected' : '');
    b.textContent = a;
    b.onclick = () => {
      state.profile.avatar = a;
      saveProfile();
      $('hubAvatarBig').textContent = a;
      panel.querySelectorAll('.avatar-opt').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      sfx.init();
      sfx.chip(1);
    };
    panel.appendChild(b);
  }

  construirHub();
  $('btnBackHub').onclick = () => mostrarPantalla('hub');
}

/** Sin nombre no se entra a ningún juego. */
function requireNameHub() {
  const name = ($('hubName').value || '').trim();
  if (!name) {
    const input = $('hubName');
    input.focus();
    input.style.borderColor = 'var(--red)';
    input.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
       { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 300 }
    );
    setTimeout(() => (input.style.borderColor = ''), 1500);
    return false;
  }
  state.profile.name = name;
  saveProfile();
  return true;
}

// ------------------------------------------------------------------ vestibulo

function bindLobby() {
  // Ojo: solo las pestañas de este vestíbulo. El UNO tiene las suyas.
  document.querySelectorAll('#lobby .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#lobby .tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('#lobby .tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.querySelector(`#lobby .tab-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  const botRange = $('cfgBots');
  const syncRange = (input, label) => {
    const update = () => {
      if (label) label.textContent = input.value;
      const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty('--fill', pct + '%');
    };
    input.addEventListener('input', update);
    update();
  };
  syncRange(botRange, $('botCountLabel'));
  syncRange($('soloBots'), $('soloCountLabel'));

  $('joinCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  $('btnCreate').addEventListener('click', createRoom);
  $('btnJoin').addEventListener('click', joinRoom);
  $('btnSolo').addEventListener('click', playSolo);

  // Codigo en la URL: /?sala=ABCD entra directo a la pestana de unirse.
  const params = new URLSearchParams(location.search);
  const code = (params.get('sala') || params.get('room') || '').toUpperCase();
  if (code) {
    document.querySelector('.tab[data-tab="join"]').click();
    $('joinCode').value = code.slice(0, 4);
  }
}

/** El nombre se pone en el hub; aquí solo se comprueba. */
function requireName() {
  const name = (state.profile.name || '').trim();
  if (!name) {
    mostrarPantalla('hub');
    requireNameHub();
    return null;
  }
  return name;
}

function readConfig() {
  const [sb, bb] = $('cfgBlinds').value.split(',').map(Number);
  return {
    ...DEFAULT_CONFIG,
    mode: $('cfgMode').value,
    startingChips: Number($('cfgChips').value),
    sb,
    bb,
    turnSeconds: Number($('cfgTurn').value),
    speed: [1, 0.7, 1, 1.7][state.settings.speed] || 1
  };
}

// ------------------------------------------------------------------ sesiones

function makeTable(config) {
  const table = new Table(config);
  table.join({
    id: tabPlayerId(),
    name: state.profile.name,
    avatar: state.profile.avatar,
    chips: config.startingChips
  });
  state.table = table;
  return table;
}

function playSolo() {
  if (!requireName()) return;
  sfx.init();
  const config = readConfig();
  const table = makeTable(config);
  const count = Number($('soloBots').value);
  const style = $('soloStyle').value;
  for (let i = 0; i < count; i++) table.addBot(style === 'mixto' ? null : style);
  const session = new LocalSession(table, tabPlayerId());
  enterGame(session, 'LOCAL');
  table.start();
}

async function createRoom() {
  if (!requireName()) return;
  sfx.init();
  const config = readConfig();
  const bots = Number($('cfgBots').value);
  const btn = $('btnCreate');

  // Camino bueno: la mesa la monta y la reparte el servidor.
  if (state.server) {
    btn.disabled = true;
    btn.textContent = 'Creando mesa…';
    try {
      const { code } = await createRelayRoom({
        game: 'holdem',
        owner: { id: tabPlayerId(), name: state.profile.name },
        config: { mode: config.mode, startingChips: config.startingChips, sb: config.sb, bb: config.bb, turnSeconds: config.turnSeconds },
        bots
      });
      const session = new RelaySession({
        code,
        name: state.profile.name,
        avatar: state.profile.avatar,
        playerId: tabPlayerId()
      });
      await session.open();
      enterGame(session, code);
    } catch (err) {
      toastLobby(explainError(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear mesa privada';
    }
    return;
  }

  // Sin servidor: conexion directa entre navegadores.
  if (!peerAvailable()) {
    toastLobby('No se ha podido abrir una sala en red. Se abre una partida local contra bots.', 'error');
    const table = makeTable(config);
    for (let i = 0; i < Math.max(1, bots); i++) table.addBot();
    const session = new LocalSession(table, tabPlayerId());
    enterGame(session, 'LOCAL');
    table.start();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creando mesa…';
  const table = makeTable(config);
  for (let i = 0; i < bots; i++) table.addBot();

  let code = roomCode();
  let session = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    session = new HostSession(table, tabPlayerId(), code);
    try {
      await session.open();
      break;
    } catch (err) {
      lastError = err;
      try { session.close(); } catch (_) {}
      session = null;
      if (err && err.message === 'code-taken') {
        code = roomCode();
        continue;
      }
      break;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Crear mesa privada';

  if (!session) {
    toastLobby(explainError(lastError), 'error');
    table.destroy();
    state.table = null;
    return;
  }
  enterGame(session, code);
  table.start();
}

function explainError(err) {
  const msg = err && err.message;
  if (msg === 'no-room') return 'No hay ninguna mesa con ese código. Comprueba las cuatro letras.';
  if (msg === 'timeout') return 'El servidor tarda en responder. Si está dormido, espera unos segundos y reinténtalo.';
  if (msg === 'sin-servidor') return 'No se llega al servidor de partidas. Comprueba que estás conectado a internet.';
  if (msg === 'servidor-lleno') return 'El servidor tiene demasiadas mesas abiertas ahora mismo.';
  if (msg === 'La mesa está llena') return 'Esa mesa ya tiene nueve jugadores.';
  return 'No se ha podido conectar: ' + (msg || 'error desconocido');
}

async function joinRoom() {
  if (!requireName()) return;
  sfx.init();
  const code = ($('joinCode').value || '').trim().toUpperCase();
  const status = $('joinStatus');
  if (code.length !== 4) {
    status.className = 'status error';
    status.textContent = 'El código tiene 4 letras.';
    return;
  }
  if (!canGoOnline()) {
    status.className = 'status error';
    status.textContent = 'No hay forma de conectar. Prueba a recargar la página.';
    return;
  }
  status.className = 'status loading';
  status.textContent = 'Entrando en la mesa…';
  $('btnJoin').disabled = true;

  const session = state.server
    ? new RelaySession({ code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId(), juego: 'holdem' })
    : new GuestSession({ code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId() });

  try {
    await session.open();
    status.className = 'status ok';
    status.textContent = '¡Dentro!';
    enterGame(session, code);
  } catch (err) {
    session.close();
    status.className = 'status error';
    status.textContent = explainError(err);
  } finally {
    $('btnJoin').disabled = false;
  }
}

function toastLobby(text, kind = '') {
  const status = $('joinStatus');
  status.className = 'status ' + kind;
  status.textContent = text;
}

// ----------------------------------------------------------------- uno

function bindUnoLobby() {
  $('unoBackHub').onclick = () => mostrarPantalla('hub');

  document.querySelectorAll('#unoLobby [data-utab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#unoLobby [data-utab]').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('#unoLobby [data-upanel]').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.querySelector(`#unoLobby [data-upanel="${tab.dataset.utab}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  const rango = (input, label) => {
    const upd = () => {
      if (label) label.textContent = input.value;
      const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty('--fill', pct + '%');
    };
    input.addEventListener('input', upd);
    upd();
  };
  rango($('unoCfgBots'), $('unoBotLabel'));
  rango($('unoSoloBots'), $('unoSoloLabel'));

  $('unoJoinCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  $('unoBtnSolo').onclick = () => {
    if (!requireName()) return;
    sfx.init();
    const mesa = new UnoMesa({
      turnSeconds: 999,
      speed: [1, 0.7, 1, 1.7][state.settings.speed] || 1
    });
    mesa.join({ id: tabPlayerId(), name: state.profile.name, avatar: state.profile.avatar });
    const bots = Number($('unoSoloBots').value);
    for (let i = 0; i < bots; i++) mesa.addBot();
    state.table = mesa;
    const session = new LocalSession(mesa, tabPlayerId());
    entrarUno(session, 'LOCAL');
    mesa.start();
  };

  $('unoBtnCreate').onclick = async () => {
    if (!requireName()) return;
    sfx.init();
    if (!state.server) {
      toastUno('Para jugar con amigos hace falta el servidor. Puedes practicar contra bots.', 'error');
      return;
    }
    const btn = $('unoBtnCreate');
    btn.disabled = true;
    btn.textContent = 'Creando…';
    try {
      const { code } = await createRelayRoom({
        game: 'uno',
        owner: { id: tabPlayerId(), name: state.profile.name },
        config: {
          turnSeconds: Number($('unoCfgTurn').value),
          objetivo: Number($('unoCfgObjetivo').value)
        },
        bots: Number($('unoCfgBots').value)
      });
      const session = new RelaySession({
        code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId(), juego: 'uno'
      });
      await session.open();
      entrarUno(session, code);
    } catch (err) {
      toastUno(explainError(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear partida';
    }
  };

  $('unoBtnJoin').onclick = async () => {
    if (!requireName()) return;
    const code = ($('unoJoinCode').value || '').trim().toUpperCase();
    if (code.length !== 4) return toastUno('El código tiene 4 letras.', 'error');
    if (!state.server) return toastUno('Hace falta el servidor para unirse a una partida.', 'error');
    toastUno('Entrando…', 'loading');
    const session = new RelaySession({
      code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId(), juego: 'uno'
    });
    try {
      await session.open();
      entrarUno(session, code);
    } catch (err) {
      session.close();
      toastUno(explainError(err), 'error');
    }
  };
}

function toastUno(texto, clase = '') {
  const el = $('unoJoinStatus');
  el.className = 'status ' + clase;
  el.textContent = texto;
}

function entrarUno(session, code) {
  state.session = session;
  recordarSala('uno', code);
  keepAwake();
  mostrarPantalla('unoGame');
  $('unoRoomCode').textContent = code;

  const ui = new UnoUI({ session, settings: state.settings });
  state.ui = ui;
  ui.init();
  bindUnoControles(session, code);
  session.refresh();
}

function bindPanelCompartido(session) {
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    session.chat(text);
    input.value = '';
  };
  $('btnClosePanel').onclick = () => $('sidePanel').classList.remove('open');
  document.querySelectorAll('.side-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.side-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.side-view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      const vista = document.querySelector(`.side-view[data-view="${tab.dataset.side}"]`);
      if (vista) vista.classList.add('active');
      if (tab.dataset.side === 'chat' && state.ui && state.ui.clearChatBadge) state.ui.clearChatBadge();
    };
  });
}

function bindUnoControles(session, code) {
  bindPanelCompartido(session);
  // Los controles de mesa del poker no pintan nada en el UNO.
  $('hostControls').style.display = session.isHost ? '' : 'none';
  $('btnRebuy').hidden = true;
  $('btnAddBot').onclick = () => session.command('addBot', {});
  $('btnPause').onclick = () => session.command('pause', {});
  $('btnResume').onclick = () => session.command('resume', {});

  $('unoLeave').onclick = () => {
    if (!confirm('¿Salir de la partida?')) return;
    olvidarSala();
    releaseWake();
    if (state.ui) state.ui.destroy();
    if (state.session) state.session.close();
    state.session = null;
    state.table = null;
    state.ui = null;
    mostrarPantalla('unoLobby');
  };

  $('unoChatBtn').onclick = () => {
    $('sidePanel').classList.add('open');
    document.querySelectorAll('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.side === 'chat'));
    document.querySelectorAll('.side-view').forEach((v) => v.classList.toggle('active', v.dataset.view === 'chat'));
    if (state.ui && state.ui.clearChatBadge) state.ui.clearChatBadge();
  };
  $('unoPanelBtn').onclick = () => $('sidePanel').classList.toggle('open');

  $('unoRoomChip').onclick = async () => {
    if (code === 'LOCAL') return;
    const url = `${inviteOrigin()}${location.pathname}?sala=${code}&juego=uno`;
    try {
      if (navigator.share) await navigator.share({ title: 'UNO', text: `Ven a jugar al UNO. Sala ${code}`, url });
      else await navigator.clipboard.writeText(url);
    } catch (_) {}
  };
}

/**
 * Vestibulo generico: los dos juegos nuevos comparten el mismo esqueleto
 * (crear / unirse / practicar), asi que se configura con una descripcion.
 */
function bindJuegoSimple(cfg) {
  REENTRADA.set(cfg.juego, {
    entrar: (session, code) => entrarJuego(cfg, session, code),
    campoCodigo: cfg.codigo, pestanaUnirse: `#${cfg.lobby} [data-gtab="${cfg.lobby === 'bjLobby' ? 'bj' : 'ab'}-join"]`
  });

  document.querySelectorAll(`#${cfg.lobby} [data-gtab]`).forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll(`#${cfg.lobby} [data-gtab]`).forEach((t) => t.classList.remove('active'));
      document.querySelectorAll(`#${cfg.lobby} [data-gpanel]`).forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.querySelector(`#${cfg.lobby} [data-gpanel="${tab.dataset.gtab}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  for (const [input, label] of cfg.rangos || []) {
    const el = $(input);
    const lab = $(label);
    const upd = () => {
      if (lab) lab.textContent = el.value;
      el.style.setProperty('--fill', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
    };
    el.addEventListener('input', upd);
    upd();
  }

  const codigo = $(cfg.codigo);
  if (codigo) {
    codigo.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
  }

  const aviso = (txt, clase = '') => {
    const el = $(cfg.status);
    if (el) {
      el.className = 'status ' + clase;
      el.textContent = txt;
    }
  };

  $(cfg.botonSolo).onclick = () => {
    if (!requireName()) return;
    sfx.init();
    const mesa = cfg.crearLocal();
    mesa.join({ id: tabPlayerId(), name: state.profile.name, avatar: state.profile.avatar });
    const bots = Number($(cfg.botsSolo).value);
    for (let i = 0; i < bots; i++) mesa.addBot();
    state.table = mesa;
    entrarJuego(cfg, new LocalSession(mesa, tabPlayerId()), 'LOCAL');
    mesa.start();
  };

  $(cfg.botonCrear).onclick = async () => {
    if (!requireName()) return;
    sfx.init();
    if (!state.server) return aviso('Para jugar con amigos hace falta el servidor. Puedes practicar contra bots.', 'error');
    const btn = $(cfg.botonCrear);
    const texto = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creando…';
    try {
      const { code } = await createRelayRoom({
        game: cfg.juego,
        owner: { id: tabPlayerId(), name: state.profile.name },
        config: cfg.config ? cfg.config() : {},
        bots: Number($(cfg.botsCrear).value)
      });
      const session = new RelaySession({
        code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId(), juego: cfg.juego
      });
      await session.open();
      entrarJuego(cfg, session, code);
    } catch (err) {
      aviso(explainError(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = texto;
    }
  };

  $(cfg.botonUnirse).onclick = async () => {
    if (!requireName()) return;
    const code = ($(cfg.codigo).value || '').trim().toUpperCase();
    if (code.length !== 4) return aviso('El código tiene 4 letras.', 'error');
    if (!state.server) return aviso('Hace falta el servidor para unirse.', 'error');
    aviso('Entrando…', 'loading');
    const session = new RelaySession({
      code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId(), juego: cfg.juego
    });
    try {
      await session.open();
      entrarJuego(cfg, session, code);
    } catch (err) {
      session.close();
      aviso(explainError(err), 'error');
    }
  };
}

function entrarJuego(cfg, session, code) {
  state.session = session;
  recordarSala(cfg.juego, code);
  keepAwake();
  mostrarPantalla(cfg.pantalla);
  const cod = $(cfg.roomCode);
  if (cod) cod.textContent = code;

  const ui = new cfg.UI({ session, settings: state.settings });
  state.ui = ui;
  ui.init();
  bindPanelCompartido(session);

  const seccion = document.getElementById(cfg.pantalla);
  seccion.querySelector('[data-salir-juego]').onclick = () => {
    if (!confirm('¿Salir de la partida?')) return;
    olvidarSala();
    releaseWake();
    if (state.ui) state.ui.destroy();
    if (state.session) state.session.close();
    state.session = null;
    state.table = null;
    state.ui = null;
    mostrarPantalla(cfg.lobby);
  };
  // Tocar el código comparte la invitación, igual que en el póker y el UNO.
  const chip = seccion.querySelector('.room-chip');
  if (chip) {
    chip.classList.toggle('local', code === 'LOCAL');
    chip.onclick = async () => {
      if (code === 'LOCAL') return;
      const url = `${inviteOrigin()}${location.pathname}?sala=${code}&juego=${cfg.juego}`;
      const nombre = (JUEGOS.find((j) => j.id === cfg.juego) || {}).nombre || 'una partida';
      const text = `Te invito a jugar al ${nombre}. Sala ${code}: ${url}`;
      try {
        if (navigator.share) await navigator.share({ title: nombre, text, url });
        else {
          await navigator.clipboard.writeText(url);
          if (state.ui && state.ui.aviso) state.ui.aviso('Invitación copiada', 'Pégasela a tus amigos');
        }
      } catch (_) {}
    };
  }

  seccion.querySelector('[data-chat-juego]').onclick = () => {
    $('sidePanel').classList.add('open');
    document.querySelectorAll('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.side === 'chat'));
    document.querySelectorAll('.side-view').forEach((v) => v.classList.toggle('active', v.dataset.view === 'chat'));
    if (state.ui && state.ui.clearChatBadge) state.ui.clearChatBadge();
  };
  seccion.querySelector('[data-panel-juego]').onclick = () => $('sidePanel').classList.toggle('open');

  session.refresh();
}

function bindJuegosNuevos() {
  document.querySelectorAll('[data-volver-hub]').forEach((b) => (b.onclick = () => mostrarPantalla('hub')));

  REENTRADA.set('holdem', {
    entrar: (session, code) => enterGame(session, code),
    campoCodigo: 'joinCode', pestanaUnirse: '#lobby .tab[data-tab="join"]'
  });
  REENTRADA.set('uno', {
    entrar: (session, code) => entrarUno(session, code),
    campoCodigo: 'unoJoinCode', pestanaUnirse: '#unoLobby [data-utab="join"]'
  });

  bindJuegoSimple({
    juego: 'blackjack', lobby: 'bjLobby', pantalla: 'bjGame', UI: BlackjackUI,
    roomCode: 'bjRoomCode', status: 'bjJoinStatus', codigo: 'bjJoinCode',
    botonCrear: 'bjBtnCreate', botonUnirse: 'bjBtnJoin', botonSolo: 'bjBtnSolo',
    botsCrear: 'bjCfgBots', botsSolo: 'bjSoloBots',
    rangos: [['bjCfgBots', 'bjBotLabel'], ['bjSoloBots', 'bjSoloLabel']],
    crearLocal: () => new BlackjackMesa({ speed: [1, 0.7, 1, 1.7][state.settings.speed] || 1, turnSeconds: 999 })
  });

  bindJuegoSimple({
    juego: 'altobajo', lobby: 'abLobby', pantalla: 'abGame', UI: AltoBajoUI,
    roomCode: 'abRoomCode', status: 'abJoinStatus', codigo: 'abJoinCode',
    botonCrear: 'abBtnCreate', botonUnirse: 'abBtnJoin', botonSolo: 'abBtnSolo',
    botsCrear: 'abCfgBots', botsSolo: 'abSoloBots',
    rangos: [['abCfgBots', 'abBotLabel'], ['abSoloBots', 'abSoloLabel']],
    config: () => ({ segundosPorCarta: Number($('abCfgTiempo').value) }),
    crearLocal: () => new AltoBajoMesa({
      speed: [1, 0.7, 1, 1.7][state.settings.speed] || 1,
      segundosPorCarta: Number($('abCfgTiempo').value) || 10
    })
  });
}

// --------------------------------------------------------------------- juego

/** En tablet y movil, evita que la pantalla se apague en mitad de una mano. */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch (_) {
    // Si el navegador no deja, no pasa nada: la partida vive en el servidor.
  }
}

function releaseWake() {
  if (wakeLock) {
    try { wakeLock.release(); } catch (_) {}
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.session) keepAwake();
});

// ------------------------------------------------------- volver a la partida

/**
 * Si el iPad bloquea la pantalla, se cambia de pestaña o se recarga sin
 * querer, la partida sigue viva en el servidor. Guardamos en qué sala
 * estábamos para volver a entrar solos al abrir la página.
 */
const SALA_KEY = 'holdem-club/sala';

/** Cómo se vuelve a entrar en cada juego. Se rellena al enlazar los lobbies. */
const REENTRADA = new Map();

function recordarSala(juego, code) {
  if (!code || code === 'LOCAL') return olvidarSala();
  try {
    sessionStorage.setItem(SALA_KEY, JSON.stringify({ juego, code, cuando: Date.now() }));
  } catch (_) {}
}

function olvidarSala() {
  try { sessionStorage.removeItem(SALA_KEY); } catch (_) {}
}

function salaRecordada() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SALA_KEY) || 'null');
    if (!s || !s.code || !REENTRADA.has(s.juego)) return null;
    // Más de dos horas parado: ya no tiene sentido volver.
    if (Date.now() - (s.cuando || 0) > 2 * 60 * 60 * 1000) return null;
    return s;
  } catch (_) { return null; }
}

/** El código que venga en el enlace: ...?sala=ABCD&juego=uno */
function salaDelEnlace() {
  try {
    const q = new URLSearchParams(location.search);
    const code = (q.get('sala') || q.get('room') || '').trim().toUpperCase();
    const juego = (q.get('juego') || q.get('game') || 'holdem').toLowerCase();
    if (!/^[A-Z0-9]{4}$/.test(code) || !REENTRADA.has(juego)) return null;
    return { juego, code };
  } catch (_) { return null; }
}

/** Quita los parámetros del enlace sin recargar, para no reentrar en bucle. */
function limpiarEnlace() {
  try {
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  } catch (_) {}
}

/**
 * Intenta meterse otra vez en una sala. Devuelve true si lo consigue.
 * Si falla (la sala ya no existe, no hay servidor...) se queda en el hub.
 */
async function volverASala({ juego, code }, motivo = 'recordada') {
  const entrada = REENTRADA.get(juego);
  if (!entrada) return false;
  if (!state.server) await detectServer();
  if (!state.server) return false;

  const cartel = $('reconectando');
  if (cartel) {
    cartel.querySelector('b').textContent = code;
    cartel.hidden = false;
  }
  const session = new RelaySession({
    code, name: state.profile.name, avatar: state.profile.avatar, playerId: tabPlayerId(), juego
  });
  try {
    await session.open();
    entrada.entrar(session, code);
    recordarSala(juego, code);
    if (state.ui && state.ui.toast) {
      state.ui.toast(motivo === 'enlace' ? `Dentro de la sala ${code}` : 'Has vuelto a la partida');
    }
    return true;
  } catch (_) {
    try { session.close(); } catch (__) {}
    if (motivo === 'recordada') olvidarSala();
    return false;
  } finally {
    if (cartel) cartel.hidden = true;
  }
}

/** Al arrancar: primero el enlace de invitación, luego la sala recordada. */
async function reanudarPartida() {
  const delEnlace = salaDelEnlace();
  if (delEnlace) {
    limpiarEnlace();
    const juego = JUEGOS.find((j) => j.id === delEnlace.juego);
    if (!state.profile.name) {
      // Sin nombre no se puede entrar: lo dejamos preparado en el vestíbulo.
      const entrada = REENTRADA.get(delEnlace.juego);
      if (entrada) {
        if (juego && juego.abrir) juego.abrir();
        const campo = $(entrada.campoCodigo);
        if (campo) campo.value = delEnlace.code;
        const pestana = document.querySelector(entrada.pestanaUnirse);
        if (pestana) pestana.click();
      }
      return;
    }
    if (await volverASala(delEnlace, 'enlace')) return;
    if (juego && juego.abrir) juego.abrir();
    return;
  }
  const guardada = salaRecordada();
  if (guardada) await volverASala(guardada, 'recordada');
}

function enterGame(session, code) {
  state.session = session;
  recordarSala('holdem', code);
  keepAwake();
  mostrarPantalla('game');
  $('roomCode').textContent = code;
  document.querySelector('.room-chip').classList.toggle('local', code === 'LOCAL');

  const ui = new TableUI({ session, settings: state.settings });
  state.ui = ui;
  ui.init();
  bindGameControls(session, code);
  session.refresh();

  if (session.isHost && code !== 'LOCAL') {
    ui.toast('Mesa creada. Comparte el código ' + code);
  }
}

function bindGameControls(session, code) {
  bindPanelCompartido(session);
  $('btnRebuy').hidden = false;
  $('btnPanel').onclick = () => $('sidePanel').classList.toggle('open');

  const abrirChat = () => {
    $('sidePanel').classList.add('open');
    document.querySelectorAll('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.side === 'chat'));
    document.querySelectorAll('.side-view').forEach((v) => v.classList.toggle('active', v.dataset.view === 'chat'));
    if (state.ui) state.ui.clearChatBadge();
    setTimeout(() => $('chatInput').focus(), 120);
  };
  $('btnChat').onclick = abrirChat;
  $('btnClosePanel').onclick = () => $('sidePanel').classList.remove('open');

  document.querySelectorAll('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.side-view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.side-view[data-view="${tab.dataset.side}"]`).classList.add('active');
      if (tab.dataset.side === 'chat' && state.ui) state.ui.clearChatBadge();
    });
  });

  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    session.chat(text);
    input.value = '';
  };

  $('roomChip').onclick = async () => {
    if (code === 'LOCAL') return;
    const url = `${inviteOrigin()}${location.pathname}?sala=${code}`;
    const text = `Te invito a jugar al Texas Hold'em. Sala ${code}: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: "Hold'em Club", text, url });
      else {
        await navigator.clipboard.writeText(url);
        state.ui.toast('Invitación copiada al portapapeles');
      }
    } catch (_) {}
  };

  $('btnSound').onclick = () => {
    state.settings.sound = !state.settings.sound;
    saveSettings();
    applySettings();
  };

  $('btnLeave').onclick = () => {
    if (!confirm('¿Salir de la mesa?')) return;
    leaveGame();
  };

  // Ajustes
  const sv = $('setVolume');
  sv.value = String(Math.round(state.settings.volume * 100));
  sv.oninput = () => {
    state.settings.volume = sv.value / 100;
    state.settings.sound = state.settings.volume > 0;
    saveSettings();
    applySettings();
  };

  const sp = $('setSpeed');
  sp.value = String(state.settings.speed);
  sp.oninput = () => {
    state.settings.speed = Number(sp.value);
    saveSettings();
    applySettings();
  };

  const bindSwitch = (id, key) => {
    const el = $(id);
    el.checked = !!state.settings[key];
    el.onchange = () => {
      state.settings[key] = el.checked;
      saveSettings();
      applySettings();
      if (state.ui && state.ui.view) state.ui.render(state.ui.view);
    };
  };
  bindSwitch('setFourColor', 'fourColor');
  bindSwitch('setEquity', 'equity');
  bindSwitch('setConfetti', 'confetti');

  const felt = $('setFelt');
  felt.value = state.settings.felt;
  felt.onchange = () => {
    state.settings.felt = felt.value;
    saveSettings();
    applySettings();
  };

  // Controles de anfitrion
  const hostControls = $('hostControls');
  hostControls.style.display = session.isHost ? '' : 'none';
  $('btnAddBot').onclick = () => session.command('addBot', {});
  $('btnPause').onclick = () => {
    session.command('pause', {});
    $('btnPause').textContent = state.table && state.table.paused ? 'Pausar' : 'Reanudar';
  };
  $('btnRebuy').onclick = () => session.command('rebuy', {});
  $('btnResume').onclick = () => {
    session.command('resume', {});
    if (state.ui) state.ui.toast('Reanudando la mesa…');
  };

  window.addEventListener('beforeunload', (e) => {
    if (session.isHost && session.online) {
      e.preventDefault();
      e.returnValue = 'Si cierras la pestaña se acaba la partida para todos.';
    }
  });
}

function leaveGame() {
  olvidarSala();
  releaseWake();
  if (state.ui) state.ui.destroy();
  if (state.session) state.session.close();
  state.session = null;
  state.table = null;
  state.ui = null;
  mostrarPantalla('lobby');
  $('sidePanel').classList.remove('open');
}

/** Direccion que hay que repartir a los amigos. */
function inviteOrigin() {
  const srv = state.server;
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (srv && srv.addresses && srv.addresses.length && isLocalHost && !relayBase()) {
    return `http://${srv.addresses[0]}:${srv.port}`;
  }
  return relayBase() || location.origin;
}

/** Busca el servidor de partidas y cuenta al usuario como está la cosa. */
async function detectServer() {
  state.server = await relayInfo();
  const banner = $('lanBanner');
  const url = inviteOrigin();
  const remote = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url, location.href).hostname);

  if (state.server) {
    banner.hidden = false;
    banner.className = 'lan-banner';
    banner.innerHTML = remote
      ? `<span><b>Servidor de partidas conectado.</b> Reparte esta dirección y entran desde cualquier
           dispositivo, aunque estéis en la wifi del colegio:</span>
         <code id="lanUrl" title="Copiar">${escapeHtml(url)}</code>`
      : `<span><b>Servidor en marcha.</b> En la misma wifi, tus amigos abren:</span>
         <code id="lanUrl" title="Copiar">${escapeHtml(url)}</code>`;
    const codeEl = $('lanUrl');
    if (codeEl) {
      codeEl.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          codeEl.textContent = '¡copiado!';
          setTimeout(() => (codeEl.textContent = url), 1200);
        } catch (_) {}
      };
    }
    refreshRooms();
    return;
  }

  // Sin servidor: avisamos de que se usara conexion directa, que es mas fragil.
  banner.hidden = false;
  banner.className = 'lan-banner warn';
  banner.innerHTML = `<span><b>Sin servidor de partidas.</b> Se intentará conexión directa entre
      navegadores, que muchas redes de colegios y oficinas bloquean. Si falla,
      <button type="button" class="link-btn" id="btnSetServer">indica la dirección de tu servidor</button>.</span>`;
  const set = $('btnSetServer');
  if (set) set.onclick = askForServer;
  $('lanRooms').hidden = true;
}

/** Permite apuntar a un servidor propio desde una web estatica. */
async function askForServer() {
  const current = relayBase();
  const value = prompt('Dirección de tu servidor de partidas\n(por ejemplo: https://mi-poker.onrender.com)', current || 'https://');
  if (value == null) return;
  setRelayBase(value.trim());
  await detectServer();
  if (state.server) toastLobby('Servidor conectado. Ya podéis crear mesas.', 'ok');
  else toastLobby('Esa dirección no responde. Revisa que esté escrita entera, con https://', 'error');
}

/** Mesas abiertas ahora mismo, para entrar sin teclear el código. */
async function refreshRooms() {
  if (!state.server) return;
  const box = $('lanRooms');
  const list = await relayRooms();
  if (!list.length) {
    box.hidden = true;
  } else {
    box.hidden = false;
    box.innerHTML = '<span class="field-label">Mesas abiertas ahora</span>' + list
      .map((r) => `<button type="button" class="lan-room" data-code="${escapeHtml(r.code)}">
          <span class="r-code">${escapeHtml(r.code)}</span>
          <span class="r-host">mesa de ${escapeHtml(r.host)} · ciegas ${escapeHtml(r.blinds || '')}</span>
          <span class="r-players">${r.players} 👤</span>
        </button>`)
      .join('');
    box.querySelectorAll('.lan-room').forEach((b) => {
      b.onclick = () => {
        $('joinCode').value = b.dataset.code;
        joinRoom();
      };
    });
  }
  clearTimeout(refreshRooms._t);
  if ($('lobby').classList.contains('active')) {
    refreshRooms._t = setTimeout(refreshRooms, 5000);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------------------------------------------------------------------- init

loadStored();
applySettings();
bindHub();
bindLobby();
bindUnoLobby();
bindJuegosNuevos();
detectServer();

// Con un código en el enlace se entra directo; si no, se vuelve sola a la
// última sala (el iPad bloquea la pantalla y recarga la página él solo).
reanudarPartida();

// El audio del navegador necesita un gesto del usuario para arrancar.
const unlock = () => {
  sfx.init();
  sfx.resume();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

window.holdem = state; // util para depurar desde la consola
