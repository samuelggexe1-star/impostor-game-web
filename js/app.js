// Arranque de la aplicacion: vestibulo, creacion de sesiones y ajustes.

import { Table, DEFAULT_CONFIG } from './table.js';
import { LocalSession, HostSession, GuestSession, roomCode, peerAvailable } from './net.js';
import { lanAvailable, lanRooms } from './lan.js';
import { TableUI } from './ui.js';
import { sfx } from './sound.js';
import { motion } from './fx.js';

const AVATARS = ['😎', '🤠', '👑', '🦊', '🐺', '🦁', '🐲', '🦈', '👻', '🤖', '🧙', '🥷', '🐼', '🦩', '🍀', '💎', '🎩', '🚀'];
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
  lan: null          // {port, addresses} si la web la sirve server.js
};

/** En red local usamos la centralita del servidor; fuera, WebRTC. */
function transport() {
  return state.lan ? 'lan' : 'peer';
}

function canGoOnline() {
  return !!state.lan || peerAvailable();
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

// ------------------------------------------------------------------ vestibulo

function buildAvatarPicker() {
  const wrap = $('avatarPicker');
  wrap.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.className = 'avatar-opt' + (a === state.profile.avatar ? ' selected' : '');
    b.textContent = a;
    b.type = 'button';
    b.onclick = () => {
      state.profile.avatar = a;
      saveProfile();
      wrap.querySelectorAll('.avatar-opt').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      sfx.init();
      sfx.chip(1);
    };
    wrap.appendChild(b);
  }
}

function bindLobby() {
  $('playerName').value = state.profile.name;
  $('playerName').addEventListener('input', (e) => {
    state.profile.name = e.target.value.slice(0, 16);
    saveProfile();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
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

function requireName() {
  const name = ($('playerName').value || '').trim();
  if (!name) {
    $('playerName').focus();
    $('playerName').style.borderColor = 'var(--red)';
    setTimeout(() => ($('playerName').style.borderColor = ''), 1200);
    return null;
  }
  state.profile.name = name;
  saveProfile();
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
    id: state.profile.id,
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
  const session = new LocalSession(table, state.profile.id);
  enterGame(session, 'LOCAL');
  table.start();
}

async function createRoom() {
  if (!requireName()) return;
  sfx.init();
  const config = readConfig();
  const bots = Number($('cfgBots').value);

  if (!canGoOnline()) {
    toastLobby('No se ha podido abrir una sala en red. Se abre una partida local contra bots.', 'error');
    const table = makeTable(config);
    for (let i = 0; i < Math.max(1, bots); i++) table.addBot();
    const session = new LocalSession(table, state.profile.id);
    enterGame(session, 'LOCAL');
    table.start();
    return;
  }

  const btn = $('btnCreate');
  btn.disabled = true;
  btn.textContent = 'Creando mesa…';
  const table = makeTable(config);
  for (let i = 0; i < bots; i++) table.addBot();

  let code = roomCode();
  let session = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    session = new HostSession(table, state.profile.id, code, transport());
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
    const why = lastError && lastError.message === 'sin-servidor'
      ? 'El servidor local no responde. ¿Sigue abierto el terminal con "npm start"?'
      : 'No se ha podido abrir la sala. Revisa tu conexión o juega en local.';
    toastLobby(why, 'error');
    table.destroy();
    state.table = null;
    return;
  }
  enterGame(session, code);
  table.start();
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
    status.textContent = 'No hay forma de conectar: ni servidor local ni WebRTC. Prueba a recargar la página.';
    return;
  }
  status.className = 'status loading';
  status.textContent = 'Conectando con la mesa…';
  $('btnJoin').disabled = true;

  const session = new GuestSession({
    code,
    name: state.profile.name,
    avatar: state.profile.avatar,
    playerId: state.profile.id,
    transport: transport()
  });
  try {
    await session.open();
    status.className = 'status ok';
    status.textContent = '¡Dentro!';
    enterGame(session, code);
  } catch (err) {
    session.close();
    status.className = 'status error';
    const msg = err && err.message;
    status.textContent =
      msg === 'no-room' ? 'No hay ninguna mesa con ese código (o el anfitrión ha cerrado la pestaña).'
      : msg === 'timeout' ? 'La conexión ha tardado demasiado. Inténtalo otra vez.'
      : msg === 'sin-servidor' ? 'El servidor local no responde. ¿Sigue abierto el terminal con "npm start"?'
      : 'No se ha podido entrar: ' + (msg || 'error desconocido');
  } finally {
    $('btnJoin').disabled = false;
  }
}

function toastLobby(text, kind = '') {
  const status = $('joinStatus');
  status.className = 'status ' + kind;
  status.textContent = text;
}

// --------------------------------------------------------------------- juego

function enterGame(session, code) {
  state.session = session;
  $('lobby').classList.remove('active');
  $('game').classList.add('active');
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
  $('btnPanel').onclick = () => $('sidePanel').classList.toggle('open');
  $('btnClosePanel').onclick = () => $('sidePanel').classList.remove('open');

  document.querySelectorAll('.side-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.side-view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.side-view[data-view="${tab.dataset.side}"]`).classList.add('active');
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

  window.addEventListener('beforeunload', (e) => {
    if (session.isHost && session.online) {
      e.preventDefault();
      e.returnValue = 'Si cierras la pestaña se acaba la partida para todos.';
    }
  });
}

function leaveGame() {
  if (state.ui) state.ui.destroy();
  if (state.session) state.session.close();
  state.session = null;
  state.table = null;
  state.ui = null;
  $('game').classList.remove('active');
  $('lobby').classList.add('active');
  $('sidePanel').classList.remove('open');
  detectLan();
}

/** Origen que sirve para tus amigos: en local, la IP de la wifi (no "localhost"). */
function inviteOrigin() {
  const lan = state.lan;
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (lan && lan.addresses.length && isLocalHost) {
    return `http://${lan.addresses[0]}:${lan.port}`;
  }
  return location.origin;
}

/** Aviso de red local: dice exactamente que direccion compartir. */
async function detectLan() {
  state.lan = await lanAvailable();
  const banner = $('lanBanner');
  if (!state.lan) {
    banner.hidden = true;
    return;
  }
  const url = inviteOrigin();
  banner.hidden = false;
  banner.innerHTML = `<span><b>Red local activa.</b> Tus amigos entran desde su móvil o portátil abriendo:</span>
    <code id="lanUrl" title="Copiar">${url}</code>`;
  $('lanUrl').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      $('lanUrl').textContent = '¡copiado!';
      setTimeout(() => ($('lanUrl').textContent = url), 1200);
    } catch (_) {}
  };
  if (!state.lan.addresses.length) {
    banner.innerHTML = '<span><b>Red local activa</b>, pero no se ha encontrado ninguna IP de wifi. ' +
      'Comprueba que el ordenador está conectado a la red.</span>';
  }
  refreshLanRooms();
}

/** Mesas abiertas ahora mismo en esta wifi, para entrar sin teclear el código. */
async function refreshLanRooms() {
  if (!state.lan) return;
  const box = $('lanRooms');
  const list = await lanRooms();
  if (!list.length) {
    box.hidden = true;
  } else {
    box.hidden = false;
    box.innerHTML = '<span class="field-label">Mesas abiertas en tu red</span>' + list
      .map((r) => `<button type="button" class="lan-room" data-code="${r.code}">
          <span class="r-code">${r.code}</span>
          <span class="r-host">mesa de ${escapeHtml(r.host)}</span>
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
  clearTimeout(refreshLanRooms._t);
  if ($('lobby').classList.contains('active')) {
    refreshLanRooms._t = setTimeout(refreshLanRooms, 4000);
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
buildAvatarPicker();
bindLobby();
detectLan();

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
