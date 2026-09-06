/* Under the Boards — audio.js
 * The engine. Everything the player hears is synthesized here through Web
 * Audio; everything the player sees is read back off `analyser`.
 *
 *   heart ─► lowpass ─► heartGain ─┐
 *   room tone / clock / murmurs ───┴► compressor ─► analyser ─► master
 */

export class HeartEngine {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.ready = false;
    this.live = new Set();          // every playing source, so we can silence at once
    this.pan = { l: -0.6, c: 0, r: 0.6 };
  }

  /* Build the graph. Only call after a user gesture. */
  build() {
    if (this.ready) return;
    const ctx = this.audio.ctx;
    if (!ctx) return;
    this.ctx = ctx;
    const master = this.audio.master;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.4;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.16;

    this.heartLP = ctx.createBiquadFilter();
    this.heartLP.type = 'lowpass';
    this.heartLP.frequency.value = 180;
    this.heartLP.Q.value = 0.8;

    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0.35;

    this.heartBus = ctx.createGain();
    this.heartBus.connect(this.heartLP);
    this.heartLP.connect(this.heartGain);
    this.heartGain.connect(this.comp);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 1;
    this.ambBus.connect(this.comp);

    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 1;
    this.uiBus.connect(this.comp);

    this.comp.connect(this.analyser);
    this.analyser.connect(master);

    this.noise = this.makeNoise(2.0);
    this.timeBuf = new Uint8Array(this.analyser.fftSize);
    this.ready = true;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  track(node, stopAt) {
    this.live.add(node);
    node.onended = () => this.live.delete(node);
    if (stopAt != null) node.stop(stopAt);
    return node;
  }

  /* ---------- the heart -------------------------------------------------- */

  /** One stroke of the two-stroke beat. */
  stroke(t, strength, opts = {}) {
    const ctx = this.ctx;
    const f0 = opts.f0 || 66, f1 = opts.f1 || 36;
    const decay = opts.decay || 0.2;
    const dest = opts.dest || this.heartBus;

    // body: sine with a fast pitch drop
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strength, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g); g.connect(dest);
    o.start(t); this.track(o, t + decay + 0.05);

    // a triangle on top for the knock of the muscle
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(f0 * 1.5, t);
    o2.frequency.exponentialRampToValueAtTime(f1 * 1.2, t + 0.07);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(strength * 0.3, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0005, t + decay * 0.55);
    o2.connect(g2); g2.connect(dest);
    o2.start(t); this.track(o2, t + decay + 0.05);

    // sub layer
    const s = ctx.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(opts.sub || 31, t);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(strength * 0.8, t + 0.012);
    sg.gain.exponentialRampToValueAtTime(0.0006, t + decay * 1.3);
    s.connect(sg); sg.connect(dest);
    s.start(t); this.track(s, t + decay * 1.3 + 0.05);

    // short band-passed noise burst: the thump of flesh on the boards
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = opts.noiseF || 140;
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(strength * 0.55, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + (opts.noiseDecay || 0.06));
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    n.start(t); this.track(n, t + (opts.noiseDecay || 0.06) + 0.05);
  }

  /** lub-dub at time t. Returns the dub offset so the visuals can echo it. */
  beat(t, strength = 0.9, bpm = 60) {
    const dub = Math.min(0.2, Math.max(0.11, 0.19 * Math.sqrt(60 / bpm)));
    this.stroke(t, strength, { f0: 66, f1: 36, decay: 0.22 });
    this.stroke(t + dub, strength * 0.72, { f0: 54, f1: 33, decay: 0.17, sub: 28, noiseF: 110 });
    return dub;
  }

  /** Loudness / muffling as the pressure climbs (0..1). */
  setPressure(p, tc = 0.15) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const gain = 0.32 + 0.78 * p;
    const cutoff = 170 + 3400 * Math.pow(p, 1.6);
    this.heartGain.gain.setTargetAtTime(gain, now, tc);
    this.heartLP.frequency.setTargetAtTime(cutoff, now, tc);
  }

  /* ---------- the room --------------------------------------------------- */

  startRoom() {
    const ctx = this.ctx;
    if (this.room) return;
    const n = ctx.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.045, ctx.currentTime, 1.2);
    n.connect(lp); lp.connect(g); g.connect(this.ambBus);
    n.start();
    this.room = { src: n, gain: g };
    // a slow draught: modulate the room a little so it never sits still
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(g.gain);
    lfo.start();
    this.room.lfo = lfo;
  }

  stopRoom(fade = 1.5) {
    if (!this.room) return;
    const t = this.ctx.currentTime;
    this.room.gain.gain.cancelScheduledValues(t);
    this.room.gain.gain.setTargetAtTime(0.0001, t, fade / 3);
    const r = this.room;
    this.room = null;
    try { r.src.stop(t + fade + 0.5); r.lfo.stop(t + fade + 0.5); } catch {}
  }

  /** A clock tick at time t; alternate tick/tock. */
  tick(t, tock) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3200; hp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.028);
    n.connect(hp); hp.connect(g); g.connect(this.ambBus);
    n.start(t); this.track(n, t + 0.06);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(tock ? 1720 : 2140, t);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.028, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0003, t + 0.05);
    o.connect(og); og.connect(this.ambBus);
    o.start(t); this.track(o, t + 0.08);
  }

  /** An officer speaking — speech cadence without a single word in it.
   *  side: -1 | 0 | 1. question: rising contour. Returns the duration. */
  murmur(t, { side = 0, loud = 0.09, syllables = 7, question = false } = {}) {
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = 1;
    if (panner) { panner.pan.value = side * 0.55; out.connect(panner); panner.connect(this.ambBus); }
    else out.connect(this.ambBus);

    let time = t;
    let f = 300 + Math.random() * 300;
    const voiceF = 95 + Math.random() * 45;
    for (let i = 0; i < syllables; i++) {
      const dur = 0.07 + Math.random() * 0.1;
      const gap = 0.02 + Math.random() * 0.07;
      const stress = (i % 3 === 1) ? 1 : 0.6 + Math.random() * 0.3;
      const amp = loud * stress;
      f = Math.max(220, Math.min(1400, f + (Math.random() - 0.5) * 380));
      const last = i === syllables - 1;
      const contour = last ? (question ? 1.25 : 0.72) : 1;

      // breathy formant: band-passed noise
      const n = ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 5;
      bp.frequency.setValueAtTime(f, time);
      bp.frequency.linearRampToValueAtTime(f * contour, time + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(amp, time + 0.018);
      g.gain.setValueAtTime(amp, time + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0003, time + dur);
      n.connect(bp); bp.connect(g); g.connect(out);
      n.start(time); this.track(n, time + dur + 0.02);

      // voicing under it: a low hum, pitch sliding with the contour
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(voiceF * (0.95 + Math.random() * 0.1), time);
      o.frequency.linearRampToValueAtTime(voiceF * contour, time + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 1.5;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, time);
      og.gain.exponentialRampToValueAtTime(amp * 0.28, time + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0003, time + dur);
      o.connect(lp); lp.connect(og); og.connect(out);
      o.start(time); this.track(o, time + dur + 0.02);

      time += dur + gap;
    }
    return time - t;
  }

  /* ---------- the player ------------------------------------------------- */

  /** A small knock on tap. Perfect taps ring a little warmer. */
  knock(kind) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (kind === 'tell') {
      // a sharp inhale: the gasp that gives you away
      const n = ctx.createBufferSource();
      n.buffer = this.noise; n.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass'; hp.frequency.setValueAtTime(900, t);
      hp.frequency.exponentialRampToValueAtTime(2600, t + 0.28); hp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 0.4);
      n.connect(hp); hp.connect(g); g.connect(this.uiBus);
      n.start(t); this.track(n, t + 0.45);
      return;
    }
    if (kind === 'miss') {
      // a floorboard creak
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 0.18);
      o.connect(lp); lp.connect(g); g.connect(this.uiBus);
      o.start(t); this.track(o, t + 0.22);
      return;
    }
    const perfect = kind === 'perfect';
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(perfect ? 520 : 380, t);
    o.frequency.exponentialRampToValueAtTime(perfect ? 180 : 140, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(perfect ? 0.09 : 0.05, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0003, t + (perfect ? 0.11 : 0.07));
    o.connect(g); g.connect(this.uiBus);
    o.start(t); this.track(o, t + 0.15);
  }

  /* ---------- endings ---------------------------------------------------- */

  /** Cut everything, then one enormous final beat. Returns the time of it. */
  confess() {
    const ctx = this.ctx, t = ctx.currentTime;
    this.heartGain.gain.cancelScheduledValues(t);
    this.heartGain.gain.setTargetAtTime(0.0001, t, 0.012);
    this.ambBus.gain.cancelScheduledValues(t);
    this.ambBus.gain.setTargetAtTime(0.0001, t, 0.012);
    this.uiBus.gain.setTargetAtTime(0.0001, t, 0.012);
    this.stopRoom(0.1);
    for (const n of this.live) { try { n.stop(t + 0.06); } catch {} }
    this.live.clear();

    const T = t + 0.9;
    // the final beat goes straight to the compressor: unfiltered, unmuffled
    const g = ctx.createGain();
    g.gain.value = 1.15;
    g.connect(this.comp);
    this.stroke(T, 1.0, { f0: 70, f1: 30, decay: 1.4, sub: 30, noiseF: 150, noiseDecay: 0.14, dest: g });
    this.stroke(T + 0.27, 0.9, { f0: 56, f1: 26, decay: 2.6, sub: 26, noiseF: 100, noiseDecay: 0.2, dest: g });
    return T;
  }

  /** The officers leave. The room goes quiet. The heart keeps beating. */
  dawn() {
    const ctx = this.ctx, t = ctx.currentTime;
    this.stopRoom(2.5);
    this.ambBus.gain.setTargetAtTime(0.0001, t, 1.0);
    this.heartGain.gain.cancelScheduledValues(t);
    this.heartGain.gain.setTargetAtTime(0.5, t, 0.8);
    this.heartLP.frequency.cancelScheduledValues(t);
    this.heartLP.frequency.setTargetAtTime(420, t, 0.8);
  }

  /** Back to a fresh room for a new game. */
  reset() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const n of this.live) { try { n.stop(); } catch {} }
    this.live.clear();
    this.heartGain.gain.cancelScheduledValues(t);
    this.heartGain.gain.setValueAtTime(0.35, t);
    this.heartLP.frequency.cancelScheduledValues(t);
    this.heartLP.frequency.setValueAtTime(180, t);
    this.ambBus.gain.cancelScheduledValues(t);
    this.ambBus.gain.setValueAtTime(1, t);
    this.uiBus.gain.cancelScheduledValues(t);
    this.uiBus.gain.setValueAtTime(1, t);
  }

  /* ---------- what the picture is drawn from ------------------------------ */

  /** Fills `wave` (-1..1) and returns the RMS level. */
  sample(wave) {
    if (!this.ready) return 0;
    const b = this.timeBuf;
    this.analyser.getByteTimeDomainData(b);
    let sum = 0, peak = 0;
    const n = b.length, step = n / wave.length;
    for (let i = 0; i < wave.length; i++) {
      const v = (b[Math.floor(i * step)] - 128) / 128;
      wave[i] = v;
    }
    for (let i = 0; i < n; i += 4) { const v = (b[i] - 128) / 128; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    this.peak = Math.max(peak, (this.peak || 0) * 0.995);
    return Math.sqrt(sum / (n / 4));
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Reported output latency, clamped to something a real device could have.
   * Headless / virtual sinks and some Bluetooth stacks report nonsense here
   * (0, NaN, or half a second); the judge must never inherit that. */
  get latency() {
    if (!this.ctx) return 0;
    const l = (+this.ctx.outputLatency || 0) + (+this.ctx.baseLatency || 0);
    return Number.isFinite(l) ? Math.min(0.12, Math.max(0, l)) : 0;
  }

  /** The audio-stream time that was coming out of the speaker at wall-clock
   * `perfMs` (a performance.now() stamp, e.g. an input event's timeStamp).
   * Uses getOutputTimestamp() when the browser provides a sane one, so the
   * judgement does not depend on when the main thread got round to running the
   * handler, nor on a misreported latency figure. */
  heardAt(perfMs = performance.now()) {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const cur = ctx.currentTime;
    const wall = performance.now();
    let ots = null;
    try { ots = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null; } catch {}
    if (ots && ots.performanceTime > 0 && Number.isFinite(ots.contextTime) && wall - ots.performanceTime < 250) {
      const est = ots.contextTime + (perfMs - ots.performanceTime) / 1000;
      // sane only if it sits a little behind the scheduling clock
      if (est <= cur + 0.01 && est >= cur - 0.25) return est;
    }
    return cur - (wall - perfMs) / 1000 - this.latency;
  }
}
