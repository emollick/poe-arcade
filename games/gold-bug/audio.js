/* The Gold-Bug — audio.js
 * Every sound is synthesized: quill scratches, a fire crackle, the rival's
 * spade, a chime per landmark, a low brass swell at the win. Nothing is loaded.
 * Uses the shared createAudio() so nothing sounds before the first gesture.
 */
import { createAudio } from '/shared/poe.js';

const A = createAudio();
let noiseBuf = null;
let started = false;
let fire = null;      // {gain, src}
let spade = null;     // {timer, interval}
let muted = false;

function ctx() { return A.ctx; }

function noise() {
  const c = ctx();
  if (noiseBuf) return noiseBuf;
  const len = c.sampleRate * 2;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function burst({ dur = 0.08, filter = 'bandpass', freq = 3000, q = 1, gain = 0.3, at = 0, detune = 0 }) {
  const c = ctx(); if (!c) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource(); src.buffer = noise();
  const f = c.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q; f.detune.value = detune;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(A.master);
  src.start(t); src.stop(t + dur + 0.02);
}

function tone({ type = 'sine', freq = 440, dur = 0.5, gain = 0.2, at = 0, attack = 0.01, glide = 0, dest = null }) {
  const c = ctx(); if (!c) return null;
  const t = c.currentTime + at;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + glide), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || A.master);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

export const sound = {
  /** Call after the first gesture; starts the fire. Safe to call repeatedly. */
  start() {
    if (started) return;
    A.unlock().then((c) => {
      if (!c || started) return;
      started = true;
      sound.fire(true);
    });
  },
  setMuted(v) { muted = v; A.setMuted(v); },
  get muted() { return muted; },

  /** Soft continuous crackle: low-passed noise plus random pops. */
  fire(on) {
    const c = ctx(); if (!c || !started) return;
    if (on && !fire) {
      const src = c.createBufferSource(); src.buffer = noise(); src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
      const g = c.createGain(); g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.045, c.currentTime, 1.2);
      src.connect(lp); lp.connect(g); g.connect(A.master); src.start();
      fire = { src, g, timer: 0 };
      const pop = () => {
        if (!fire) return;
        burst({ dur: 0.02 + Math.random() * 0.04, filter: 'highpass', freq: 1800 + Math.random() * 2500, gain: 0.02 + Math.random() * 0.05 });
        if (Math.random() < 0.3) burst({ dur: 0.03, filter: 'bandpass', freq: 600 + Math.random() * 900, q: 2, gain: 0.03, at: 0.05 });
        fire.timer = setTimeout(pop, 120 + Math.random() * 700);
      };
      pop();
    } else if (!on && fire) {
      clearTimeout(fire.timer);
      fire.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.4);
      const f = fire; fire = null;
      setTimeout(() => { try { f.src.stop(); } catch {} }, 1500);
    }
  },

  /** A quill scratch: two or three quick filtered noise strokes. */
  quill() {
    if (!started) return;
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) {
      burst({ dur: 0.05 + Math.random() * 0.05, filter: 'bandpass', freq: 2600 + Math.random() * 2200, q: 1.4, gain: 0.12, at: i * 0.065 });
    }
  },

  /** Correct assignment: the quill plus a small bright tick. */
  correct(streak = 1) {
    if (!started) return;
    sound.quill();
    const base = 880 * Math.pow(1.0595, Math.min(streak, 8));
    tone({ type: 'triangle', freq: base, dur: 0.22, gain: 0.06, at: 0.02 });
    tone({ type: 'sine', freq: base * 2, dur: 0.16, gain: 0.03, at: 0.03 });
  },

  /** Wrong assignment: an ink blot — dull, low, brief. */
  wrong() {
    if (!started) return;
    burst({ dur: 0.16, filter: 'lowpass', freq: 380, q: 0.7, gain: 0.25 });
    tone({ type: 'sine', freq: 140, dur: 0.25, gain: 0.12, glide: -60 });
  },

  /** Landmark revealed: a two-partial chime with a shimmer. */
  chime() {
    if (!started) return;
    const c = ctx();
    const notes = [1046.5, 1568, 2093];
    notes.forEach((f, i) => {
      tone({ type: 'sine', freq: f, dur: 1.4 - i * 0.2, gain: 0.09 / (i + 1), at: i * 0.06, attack: 0.005 });
      tone({ type: 'sine', freq: f * 1.003, dur: 1.2, gain: 0.03 / (i + 1), at: i * 0.06 + 0.01, attack: 0.005 });
    });
    void c;
  },

  /** The rival's spade, at a tempo that rises with his progress (0..1). Call spade(-1) to stop. */
  spade(progress) {
    const c = ctx();
    if (!c || !started) return;
    if (progress < 0) { if (spade) { clearTimeout(spade.timer); spade = null; } return; }
    const interval = 1900 - progress * 1400; // 1.9s -> 0.5s
    if (!spade) {
      spade = { timer: 0, interval };
      const dig = () => {
        if (!spade) return;
        // thud + gravel
        tone({ type: 'sine', freq: 92, dur: 0.22, gain: 0.16 + progress * 0.1, glide: -40 });
        burst({ dur: 0.09, filter: 'highpass', freq: 2400, gain: 0.05 + progress * 0.05, at: 0.03 });
        burst({ dur: 0.05, filter: 'bandpass', freq: 900, q: 1, gain: 0.04, at: 0.01 });
        spade.timer = setTimeout(dig, spade.interval * (0.92 + Math.random() * 0.16));
      };
      dig();
    } else {
      spade.interval = interval;
    }
  },

  /** Round cleared: a small rising figure. */
  roundWin() {
    if (!started) return;
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.6, gain: 0.08, at: i * 0.11 }));
  },

  /** Win: a low brass swell — detuned saws through an opening low-pass. */
  brass() {
    if (!started) return;
    const c = ctx();
    const t = c.currentTime;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 2.6);
    lp.frequency.exponentialRampToValueAtTime(500, t + 5.5);
    const g = c.createGain(); g.gain.value = 0.9; lp.connect(g); g.connect(A.master);
    const chord = [73.42, 110, 146.83, 185, 220, 293.66]; // D2 A2 D3 F#3 A3 D4
    chord.forEach((f, i) => {
      for (const det of [-6, 5]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + (i % 2) * 3;
        const og = c.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.055, t + 1.8 + i * 0.1);
        og.gain.setValueAtTime(0.055, t + 3.4);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 6);
        o.connect(og); og.connect(lp); o.start(t); o.stop(t + 6.2);
      }
    });
    // a timpani roll underneath
    for (let i = 0; i < 14; i++) tone({ type: 'sine', freq: 55, dur: 0.3, gain: 0.05 + i * 0.006, at: i * 0.14, glide: -15 });
    tone({ type: 'sine', freq: 36.7, dur: 3, gain: 0.18, at: 2.0, attack: 0.05 });
  },

  /** Lose: a single low blow and the fire dying. */
  lose() {
    if (!started) return;
    tone({ type: 'sine', freq: 60, dur: 1.6, gain: 0.25, glide: -25, attack: 0.02 });
    burst({ dur: 0.5, filter: 'lowpass', freq: 200, gain: 0.3 });
    sound.spade(-1);
  },

  /** Interlude page-turn: a slow scrape of paper. */
  page() {
    if (!started) return;
    burst({ dur: 0.35, filter: 'bandpass', freq: 1400, q: 0.6, gain: 0.08 });
    burst({ dur: 0.25, filter: 'highpass', freq: 3000, gain: 0.04, at: 0.1 });
  },
};
