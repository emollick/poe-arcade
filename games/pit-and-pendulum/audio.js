/* THE DESCENDING BLADE — every sound is synthesized here through Web Audio.
   Nothing is loaded. The shared createAudio() owns the context + gesture unlock;
   this module only builds nodes on top of it, and only after unlock() resolved. */

export function createSfx(audio) {
  let ctx = null, master = null, bus = null;
  let noiseBuf = null;
  let live = false;

  // continuous voices
  let swish = null, groan = null, torch = null;
  let nextPop = 0;
  let muffled = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function makeNoise(seconds = 2) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function noiseSource(loop = true) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = loop;
    return s;
  }
  const now = () => ctx.currentTime;

  async function init() {
    if (live) return true;
    const c = await audio.unlock();
    if (!c) return false;
    ctx = c; master = audio.master;
    bus = ctx.createGain(); bus.gain.value = 0.9;
    bus.connect(master);
    noiseBuf = makeNoise(2);
    live = true;
    return true;
  }

  /* ---------------- ambience ---------------- */

  function startAmbience() {
    if (!live) return;
    stopAmbience();
    // torch crackle: filtered noise hiss + scheduled pops
    {
      const src = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0.018;
      src.connect(bp).connect(g).connect(bus);
      src.start();
      torch = { src, g };
      nextPop = now() + 0.2;
    }
    // blade swish: band-passed noise, gain and centre swept from outside
    {
      const src = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 1.4;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(bus);
      src.start();
      swish = { src, bp, g };
    }
    // wall groan: two detuned saws + a sub sine, low-passed, rising with progress
    {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 38;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 38.9;
      const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 19;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(lp); o2.connect(lp); o3.connect(lp);
      lp.connect(g).connect(bus);
      o1.start(); o2.start(); o3.start();
      groan = { o1, o2, o3, lp, g };
    }
  }

  function stopAmbience() {
    const t = live ? now() : 0;
    for (const v of [torch, swish, groan]) {
      if (!v) continue;
      try { v.g.gain.setTargetAtTime(0, t, 0.05); } catch {}
      setTimeout(() => { try { for (const k of ['src', 'o1', 'o2', 'o3']) v[k] && v[k].stop(); } catch {} }, 400);
    }
    torch = swish = groan = null;
  }

  /* per-frame control. speed: blade px/s. approach: -1..1 (toward the listener = +) */
  function update(dt, { bladeSpeed = 0, approach = 0, wallHeat = 0, surge = 0, rats = 0, groanLevel = 0 }) {
    if (!live) return;
    const t = now();
    if (swish) {
      const s = clamp(bladeSpeed / 720, 0, 1.2);
      swish.g.gain.setTargetAtTime(s * s * 0.42 * (muffled ? 0.3 : 1), t, 0.035);
      swish.bp.frequency.setTargetAtTime(380 + s * 1900 * (1 + 0.28 * approach), t, 0.04);
    }
    if (groan) {
      const lvl = clamp(groanLevel, 0, 1);
      groan.g.gain.setTargetAtTime((0.05 + 0.13 * wallHeat) * lvl + surge * 0.34, t, 0.12);
      const f = 34 + 26 * wallHeat + surge * 14;
      groan.o1.frequency.setTargetAtTime(f, t, 0.25);
      groan.o2.frequency.setTargetAtTime(f * 1.024, t, 0.25);
      groan.o3.frequency.setTargetAtTime(f / 2, t, 0.25);
      groan.lp.frequency.setTargetAtTime(140 + 120 * surge + 60 * wallHeat, t, 0.2);
    }
    if (torch && t > nextPop) {
      pop(0.02 + Math.random() * 0.05, 900 + Math.random() * 2500);
      nextPop = t + 0.06 + Math.random() * 0.34;
    }
    if (rats > 0 && Math.random() < rats * 0.045 * dt * 60) skitter();
  }

  function pop(gain, freq) {
    const src = noiseSource(false);
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = freq; hp.Q.value = 2;
    const g = ctx.createGain();
    const t = now();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
    src.connect(hp).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5, 0.05);
  }

  /* ---------------- one-shots ---------------- */

  function skitter() {
    if (!live) return;
    const t = now();
    const n = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const src = noiseSource(false);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200 + Math.random() * 2000;
      const g = ctx.createGain();
      const t0 = t + i * (0.035 + Math.random() * 0.03);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.028);
      src.connect(hp).connect(g).connect(bus);
      src.start(t0, Math.random() * 1.5, 0.04);
    }
  }

  function heartbeat() {
    if (!live) return;
    const t = now();
    const thud = (t0, gain) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(64, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.2);
      o.connect(g).connect(bus); o.start(t0); o.stop(t0 + 0.24);
    };
    thud(t, 0.9); thud(t + 0.16, 0.55);
  }

  function sizzle() {
    if (!live) return;
    const t = now();
    const src = noiseSource(false);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.42);
    src.connect(hp).connect(g).connect(bus);
    src.start(t, Math.random(), 0.5);
    // a low iron clang under it
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.3);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25, t); g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(g2).connect(bus); o.start(t); o.stop(t + 0.32);
  }

  function bite() {
    if (!live) return;
    const t = now();
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(2600, t + 0.05); o.frequency.exponentialRampToValueAtTime(1500, t + 0.11);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.13);
  }

  function hop() {
    if (!live) return;
    const t = now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.1);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.11);
  }

  function land(power = 1) {
    if (!live) return;
    const t = now();
    const src = noiseSource(false);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * clamp(power, 0.3, 1.4), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
    src.connect(lp).connect(g).connect(bus);
    src.start(t, Math.random(), 0.1);
  }

  function notch() {
    if (!live) return;
    // the ratchet click of the pivot dropping a notch
    const t = now();
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.04);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.06);
  }

  function slice() {
    if (!live) return;
    const t = now();
    const src = noiseSource(false);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
    src.connect(hp).connect(g).connect(bus); src.start(t, 0.3, 0.3);
    for (const [f, a, d] of [[2210, 0.28, 0.9], [3320, 0.14, 0.6], [5100, 0.07, 0.4]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(a, t + 0.005); g2.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g2).connect(bus); o.start(t); o.stop(t + d + 0.05);
    }
    muffled = true;
    stopAmbience();
  }

  function fall() {
    if (!live) return;
    const t = now();
    const src = noiseSource(false);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0005, t + 2.4);
    src.connect(lp).connect(g).connect(bus); src.start(t); src.stop(t + 2.5);
    stopAmbience();
  }

  function fanfare() {
    if (!live) return;
    const t = now() + 0.05;
    const notes = [[392, 0, 0.17], [392, 0.2, 0.17], [392, 0.4, 0.17], [523.25, 0.62, 0.55], [659.25, 1.25, 0.22], [783.99, 1.5, 1.4]];
    for (const [f, at, dur] of notes) {
      const t0 = t + at;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.14);
      g.gain.setValueAtTime(0.15, t0 + dur);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur + 0.16);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(700, t0); lp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.06); lp.frequency.exponentialRampToValueAtTime(1300, t0 + dur);
      lp.connect(g).connect(bus);
      for (const det of [0, 6, -5]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = f; o.detune.value = det;
        if (dur > 1) { // vibrato on the held note
          const v = ctx.createOscillator(); v.frequency.value = 5.5;
          const vg = ctx.createGain(); vg.gain.value = 0; vg.gain.setTargetAtTime(9, t0 + 0.4, 0.3);
          v.connect(vg).connect(o.detune); v.start(t0); v.stop(t0 + dur + 0.3);
        }
        o.connect(lp); o.start(t0); o.stop(t0 + dur + 0.3);
      }
    }
    // the wall groan falling away as the iron retracts
    if (groan) {
      groan.g.gain.setTargetAtTime(0.28, t, 0.3);
      groan.o1.frequency.setTargetAtTime(24, t + 0.5, 1.4);
      groan.o2.frequency.setTargetAtTime(24.6, t + 0.5, 1.4);
      groan.g.gain.setTargetAtTime(0, t + 3.5, 0.8);
    }
  }

  return { init, startAmbience, stopAmbience, update, skitter, heartbeat, sizzle, bite, hop, land, notch, slice, fall, fanfare,
           get live() { return live; }, reset() { muffled = false; } };
}
