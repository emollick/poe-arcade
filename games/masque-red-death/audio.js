/* Seven Chambers — audio.js
 * Everything is synthesised through Web Audio on top of poe.js createAudio().
 * Nothing here touches the AudioContext until init() is called from a gesture. */
import { createAudio } from '/shared/poe.js';

// A-minor waltz. Chords are semitone offsets from A; melody from A4.
const CHORDS = [[0, 3, 7], [0, 3, 7], [5, 8, 12], [7, 11, 14], [0, 3, 7], [8, 12, 15], [7, 11, 14], [0, 3, 7]];
const MELODY = [
  0, 3, 7,      12, -99, 7,     8, 5, 8,      11, -99, 7,
  12, 15, 12,   8, 12, 8,       11, 7, 2,     0, -99, -99,
];
const R = () => Math.random();

export function makeAudio() {
  const A = createAudio();
  let ctx = null, master = null;
  let musicVol, musicFilter, musicBus, hall, delay, delayGain, sfx, noiseBuf, ambGain;
  let running = false, warp = 0, tempo = 160, nextBeat = 0, beatIndex = 0;
  let stepSide = 1;

  function init() {
    if (ctx) return true;
    ctx = A.ctx;
    if (!ctx) return false;
    master = A.master;
    A.unlock();
    const t = ctx.currentTime;

    sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(master);

    // ballroom echo
    delay = ctx.createDelay(1.5); delay.delayTime.value = 0.31;
    const dFilter = ctx.createBiquadFilter(); dFilter.type = 'lowpass'; dFilter.frequency.value = 1500;
    delayGain = ctx.createGain(); delayGain.gain.value = 0.34;
    delay.connect(dFilter).connect(delayGain); delayGain.connect(delay); delayGain.connect(master);
    hall = ctx.createGain(); hall.gain.value = 1; hall.connect(master); hall.connect(delay);

    // music chain: voices -> filter -> vol -> bus(duck) -> master + hall
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 2400; musicFilter.Q.value = 0.8;
    musicVol = ctx.createGain(); musicVol.gain.value = 0.16;
    musicBus = ctx.createGain(); musicBus.gain.value = 0;
    musicFilter.connect(musicVol).connect(musicBus); musicBus.connect(master); musicBus.connect(delay);

    // noise buffer for steps / cloth
    const n = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = R() * 2 - 1;

    // room tone: a faint brown drone, so silence during the chimes is not digital silence
    const amb = ctx.createBufferSource(); amb.buffer = noiseBuf; amb.loop = true;
    const ambF = ctx.createBiquadFilter(); ambF.type = 'lowpass'; ambF.frequency.value = 110; ambF.Q.value = 0.5;
    ambGain = ctx.createGain(); ambGain.gain.value = 0.05;
    amb.connect(ambF).connect(ambGain).connect(master); amb.start(t);
    return true;
  }

  function tone(type, freq, t0, dur, gain, dest, detune = 0, attack = 0.012, release = 0.09) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + dur + release + 0.05);
    return o;
  }
  function noise(t0, dur, gain, dest, type = 'bandpass', freq = 800, q = 1, sweepTo = null) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + R() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, R() * 0.5); s.stop(t0 + dur + 0.02);
  }

  /* ---- the waltz ---- */
  function scheduleBeat(i, t) {
    const bar = Math.floor(i / 3), beat = i % 3;
    const chord = CHORDS[bar % 8];
    const wf = 1 - 0.16 * warp;
    if (beat === 0) {
      const f = 110 * Math.pow(2, chord[0] / 12) * wf;
      tone('sine', f, t, 0.42, 0.55, musicFilter, 0, 0.01, 0.12);
      tone('triangle', f, t, 0.3, 0.25, musicFilter, 5, 0.01, 0.1);
    } else {
      for (const n of chord) tone('triangle', 220 * Math.pow(2, n / 12) * wf, t, 0.17, 0.11, musicFilter, (R() - 0.5) * 14, 0.008, 0.07);
    }
    let m = MELODY[i % 24];
    if (Math.floor(i / 24) % 2 === 1 && i % 24 === 10) m = 6;      // the wrong note, every other round
    if (i % 24 === 19 && Math.floor(i / 24) % 3 === 2) m = 1;
    if (m > -50) {
      const f = 440 * Math.pow(2, m / 12) * wf;
      const dur = (i % 24 === 21) ? 0.9 : 0.34;
      tone('sawtooth', f, t, dur, 0.09, musicFilter, -9, 0.02, 0.1);
      tone('sawtooth', f * 1.004, t, dur, 0.07, musicFilter, 11, 0.03, 0.12);
    }
  }
  function update() {
    if (!ctx || !running) return;
    const now = ctx.currentTime;
    if (nextBeat < now - 0.4) nextBeat = now + 0.05;
    while (nextBeat < now + 0.28) {
      scheduleBeat(beatIndex++, nextBeat);
      nextBeat += 60 / tempo;
    }
  }

  return {
    init,
    update,
    get ready() { return !!ctx; },
    startMusic() {
      if (!ctx) return;
      running = true;
      nextBeat = ctx.currentTime + 0.1;
      musicBus.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    },
    stopMusic() { if (!ctx) return; running = false; musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3); },
    duck(on) {
      if (!ctx) return;
      const t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setTargetAtTime(on ? 0 : 1, t, on ? 0.06 : 0.9);
      ambGain.gain.setTargetAtTime(on ? 0.02 : 0.05, t, 0.3);
      if (!on) running = true;
    },
    setTempo(bpm) { tempo = bpm; },
    setWarp(v) {
      warp = v;
      if (ctx) musicFilter.frequency.setTargetAtTime(2400 - 1900 * v, ctx.currentTime, 0.05);
    },
    step(speed) {
      if (!ctx) return;
      const t = ctx.currentTime;
      stepSide = -stepSide;
      const p = ctx.createStereoPanner(); p.pan.value = stepSide * 0.3; p.connect(sfx);
      noise(t, 0.075, 0.07 + Math.min(0.08, speed * 0.004), p, 'bandpass', 220 + R() * 260, 1.1);
      tone('sine', 70 + R() * 20, t, 0.05, 0.12, p, 0, 0.004, 0.05);
    },
    chime(k, n) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const f0 = 88 * (1 + (k / n) * 0.02);
      const partials = [[0.5, 0.4, 7], [1, 1, 6], [2.02, 0.5, 4.2], [2.76, 0.45, 3.4], [4.07, 0.24, 2.4], [5.43, 0.16, 1.7], [8.9, 0.07, 0.9]];
      for (const [r, g, dec] of partials) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * r * (1 + (R() - 0.5) * 0.004);
        const gn = ctx.createGain();
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.linearRampToValueAtTime(g * 0.42, t + 0.006);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(gn).connect(hall); o.start(t); o.stop(t + dec + 0.1);
      }
      noise(t, 0.05, 0.35, hall, 'bandpass', 1900, 2.5);
      const th = ctx.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(52, t); th.frequency.exponentialRampToValueAtTime(30, t + 0.45);
      const tg = ctx.createGain(); tg.gain.setValueAtTime(0.7, t); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      th.connect(tg).connect(sfx); th.start(t); th.stop(t + 0.55);
    },
    rdStep() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(64, t); o.frequency.exponentialRampToValueAtTime(26, t + 0.32);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.75, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(hall); o.start(t); o.stop(t + 0.45);
      noise(t, 0.16, 0.25, hall, 'lowpass', 180, 0.7);
    },
    brush() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noise(t, 0.14, 0.22, sfx, 'bandpass', 700 + R() * 500, 0.8);
      tone('sine', 130, t, 0.12, 0.3, sfx, 0, 0.004, 0.1);
      tone('triangle', 62, t, 0.16, 0.25, sfx, 0, 0.004, 0.1);
    },
    dash() {
      if (!ctx) return;
      noise(ctx.currentTime, 0.28, 0.16, sfx, 'lowpass', 300, 1, 3200);
    },
    nearMiss(streak) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const f = 1318 * Math.pow(2, Math.min(streak, 6) / 12);
      tone('sine', f, t, 0.22, 0.06, hall, 0, 0.004, 0.25);
      tone('triangle', f * 1.5, t + 0.02, 0.18, 0.03, hall, 4, 0.004, 0.2);
    },
    doorPass() {
      if (!ctx) return;
      noise(ctx.currentTime, 0.3, 0.06, hall, 'bandpass', 500, 0.5, 1600);
    },
    death() {
      if (!ctx) return;
      running = false;
      const t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(0, t, 0.05);
      for (const det of [0.965, 1, 1.037]) {
        for (const [r, g, dec] of [[0.5, 0.5, 7], [1, 1, 6], [2.76, 0.4, 4], [4.07, 0.2, 2.5]]) {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 74 * r * det;
          const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(g * 0.3, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dec);
          o.connect(gn).connect(hall); o.start(t); o.stop(t + dec + 0.1);
        }
      }
      const dr = ctx.createOscillator(); dr.type = 'sawtooth'; dr.frequency.setValueAtTime(34, t); dr.frequency.linearRampToValueAtTime(58, t + 3);
      const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 220;
      const dg = ctx.createGain(); dg.gain.setValueAtTime(0.0001, t); dg.gain.linearRampToValueAtTime(0.35, t + 0.8); dg.gain.setValueAtTime(0.35, t + 2.6); dg.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
      dr.connect(df).connect(dg).connect(sfx); dr.start(t); dr.stop(t + 4.6);
    },
    win() {
      if (!ctx) return;
      running = false;
      const t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(0, t, 0.3);
      [0, 3, 7, 12].forEach((n, i) => tone('triangle', 440 * Math.pow(2, n / 12), t + 0.5 + i * 0.45, 1.6, 0.12, hall, 0, 0.05, 0.8));
      [[1, 0.4], [2.02, 0.2], [2.76, 0.15]].forEach(([r, g]) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 176 * r;
        const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t + 2.4); gn.gain.linearRampToValueAtTime(g, t + 2.41); gn.gain.exponentialRampToValueAtTime(0.0001, t + 9);
        o.connect(gn).connect(hall); o.start(t + 2.4); o.stop(t + 9.1);
      });
    },
  };
}
