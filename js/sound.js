// Sonidos sintetizados con WebAudio: cero archivos, cero descargas.

class SoundKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.5;
    this.musicOn = false;
    this._music = null;
  }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  get t() {
    return this.ctx.currentTime;
  }

  tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.2, sweep = null, delay = 0, detune = 0 }) {
    if (!this.enabled) return;
    const ctx = this.init();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.value = detune;
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.12, gain = 0.2, filter = 1200, type = 'bandpass', delay = 0, q = 1 }) {
    if (!this.enabled) return;
    const ctx = this.init();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = filter;
    bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq).connect(g).connect(this.master);
    src.start(t0);
  }

  // ------------------------------------------------------------ efectos

  deal(i = 0) {
    this.noise({ dur: 0.1, gain: 0.16, filter: 2600, type: 'highpass', delay: i * 0.01 });
  }

  flip() {
    this.noise({ dur: 0.13, gain: 0.2, filter: 1800, type: 'bandpass', q: 0.6 });
    this.tone({ freq: 620, type: 'triangle', dur: 0.06, gain: 0.05 });
  }

  chip(n = 1) {
    for (let i = 0; i < Math.min(4, n); i++) {
      this.noise({ dur: 0.07, gain: 0.13, filter: 3200 + Math.random() * 1800, type: 'bandpass', q: 3, delay: i * 0.045 });
      this.tone({ freq: 1500 + Math.random() * 700, type: 'square', dur: 0.04, gain: 0.03, delay: i * 0.045 });
    }
  }

  check() {
    this.noise({ dur: 0.09, gain: 0.25, filter: 340, type: 'lowpass' });
    this.tone({ freq: 180, type: 'sine', dur: 0.09, gain: 0.12, sweep: 120 });
  }

  fold() {
    this.noise({ dur: 0.22, gain: 0.12, filter: 900, type: 'lowpass' });
  }

  bet() {
    this.chip(3);
    this.tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.08, sweep: 660 });
  }

  raise() {
    this.chip(4);
    this.tone({ freq: 380, type: 'sawtooth', dur: 0.2, gain: 0.07, sweep: 780 });
  }

  allin() {
    this.tone({ freq: 140, type: 'sawtooth', dur: 0.7, gain: 0.16, sweep: 60 });
    this.noise({ dur: 0.6, gain: 0.18, filter: 900, type: 'bandpass', q: 0.5 });
    this.chip(4);
  }

  turn() {
    this.tone({ freq: 880, type: 'sine', dur: 0.18, gain: 0.1 });
    this.tone({ freq: 1320, type: 'sine', dur: 0.14, gain: 0.05, delay: 0.07 });
  }

  tick(urgent = false) {
    this.tone({ freq: urgent ? 1200 : 820, type: 'square', dur: 0.04, gain: urgent ? 0.09 : 0.04 });
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.35, gain: 0.13, delay: i * 0.09 }));
  }

  lose() {
    this.tone({ freq: 300, type: 'triangle', dur: 0.4, gain: 0.1, sweep: 150 });
  }

  pot() {
    this.chip(4);
    this.tone({ freq: 700, type: 'sine', dur: 0.25, gain: 0.08, sweep: 1200 });
  }

  chat() {
    this.tone({ freq: 700, type: 'sine', dur: 0.09, gain: 0.07, sweep: 980 });
  }

  emote() {
    this.tone({ freq: 500, type: 'triangle', dur: 0.18, gain: 0.08, sweep: 1400 });
  }

  levelUp() {
    [440, 554, 659, 880].forEach((f, i) =>
      this.tone({ freq: f, type: 'square', dur: 0.18, gain: 0.07, delay: i * 0.1 })
    );
  }

  join() {
    this.tone({ freq: 660, type: 'sine', dur: 0.14, gain: 0.08, sweep: 990 });
  }
}

export const sfx = new SoundKit();
