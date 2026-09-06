/* FISSURE — The Fall of the House of Usher
 * Raw WebGL2. The whole scene is raymarched from SDFs in scene.glsl at reduced
 * resolution, then upscaled through post.glsl (bloom, grain, vignette). The
 * bracing marks are DOM overlays projected from world positions with the same
 * camera the shader uses. */
import { mountBack, fitCanvas, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';

mountBack();

const $ = (id) => document.getElementById(id);
const canvas = $('gl'), stage = $('stage'), hud = $('hud');
const ui = { title: $('title'), win: $('win'), lose: $('lose'), best: $('best'), score: $('score'), streak: $('streak'),
  time: $('time'), fill: $('fill'), hint: $('hint'), wintally: $('wintally'), losetally: $('losetally'), winbest: $('winbest'), losebest: $('losebest') };
const reduced = prefersReducedMotion();
const BEST_KEY = 'house-of-usher:best';
const RUN_LENGTH = 70;            // seconds until the narrator is clear
const G = 0.5, FZ = -1.4;
/* The fissure is the clock. Its tip runs down the facade all night (the floor
 * under it reaches 0.55 at the causeway); every brace you hit recoils it one
 * segment, every one you miss lets it run through. */
const CRACK_TOP = 6.35, CRACK_SPAN = 6.55;                 // tipY = CRACK_TOP - CRACK_SPAN * crack (mirrors scene.glsl)
const CRACK_FLOOR = 0.55;                                  // where the tip sits at t = RUN_LENGTH under perfect play
const CREEP_PER_BRACE = 0.074;                             // crack the tip gains between two braces (vs RECOIL per hit)
const RECOIL = 0.08, COST_EXPIRE = 0.05, COST_WRONG = 0.045, COST_DARK = 0.03;
const FORK_AT = 38;                                        // after this the storm forks the fissure
// the zigzag of crack2D() in scene.glsl; the six braces sit on its vertices, top to bottom
const CRACK_PATH = [[0.05, 6.35], [0.30, 5.30], [-0.20, 4.40], [0.33, 3.55], [-0.14, 2.70], [0.30, 1.90], [-0.06, 1.15], [0.24, 0.55], [0.10, -0.30]];
const tipOf = (crack) => CRACK_TOP - CRACK_SPAN * crack;
const crackAt = (y) => Math.min(1, Math.max(0, (CRACK_TOP - y) / CRACK_SPAN));
const braceInterval = (t) => lerp(1.7, 0.72, smooth(0, 60, t));

/* ---------- WebGL ---------- */
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
if (!gl) { $('nogl').style.display = 'flex'; ui.title.hidden = true; throw new Error('no webgl2'); }

let software = false;
try {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
  software = /swiftshader|llvmpipe|software|mesa offscreen/i.test(String(r));
} catch { /* fine */ }
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const [sceneSrc, postSrc] = await Promise.all([fetch('./scene.glsl').then((r) => r.text()), fetch('./post.glsl').then((r) => r.text())]);
const scene = program(sceneSrc), post = program(postSrc);
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);

// scene framebuffer at reduced resolution
const fbo = gl.createFramebuffer(), tex = gl.createTexture();
let W = 1, H = 1, DPR = 1, SW = 1, SH = 1;
const qs = new URLSearchParams(location.search);
let scale = qs.has('scale') ? parseFloat(qs.get('scale')) : (software ? 0.16 : (touch ? 0.34 : 0.5));
const lockScale = qs.has('scale');
const minScale = software ? 0.08 : 0.16;
function sizeScene() {
  SW = Math.max(64, Math.round(W * DPR * scale));
  SH = Math.max(64, Math.round(H * DPR * scale));
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SW, SH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
fitCanvas(canvas, ({ width, height, dpr }) => { W = width; H = height; DPR = Math.min(dpr, touch ? 2 : 1.5); sizeScene(); });
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

/* ---------- camera ---------- */
const cam = { pos: [0, 1.7, -13], fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], focal: 1.6, shift: 0 };
const FRAME_TOP = [1.55, 7.9, -1.4];                 // the tower cap
const FRAME_BOTTOM = [0.30, -CRACK_PATH[1][1], -1.57]; // the deepest reflected brace
function setCamera(pos, target, dist, fitReflection) {
  const f = norm(sub(target, pos));
  const r = norm(cross([0, 1, 0], f));
  const u = cross(f, r);
  cam.pos = pos; cam.fwd = f; cam.right = r; cam.up = u;
  const aspect = W / H;
  // fit the house (+/-5.2 wide) and house-over-reflection (+/-8 tall) at this distance
  let focal = Math.min(dist / 8.2, aspect * dist / 4.9), shift = 0;
  if (fitReflection) {
    // in play the deepest reflected brace must stay tappable on every aspect: shrink the
    // focal until tower cap and reflected brace both fit, then lens-shift the frame up
    const ndc = (p) => { const d = sub(p, cam.pos); return dot(d, cam.up) / dot(d, cam.fwd); };
    const top = ndc(FRAME_TOP), bot = ndc(FRAME_BOTTOM);
    const margin = 48 / (H / 2);
    const avail = 2 - 2 * margin;
    if ((top - bot) * focal > avail) focal = avail / (top - bot);
    const low = bot * focal, high = top * focal;
    if (low < -1 + margin) shift = Math.min((-1 + margin) - low, (1 - margin) - high);
  }
  cam.focal = focal; cam.shift = shift;
}
function project(p) {
  const d = sub(p, cam.pos);
  const z = dot(d, cam.fwd); if (z <= 0.05) return null;
  const x = dot(d, cam.right) / z * cam.focal / (W / H);
  const y = dot(d, cam.up) / z * cam.focal + cam.shift;
  return [(x * 0.5 + 0.5) * W, (1 - (y * 0.5 + 0.5)) * H];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- the bracing marks ---------- */
// six braces on the fissure's own path: gable, upper wall, second floor, first floor, ground floor, door
const MARK_POS = [1, 2, 3, 4, 5, 6].map((k) => [CRACK_PATH[k][0], CRACK_PATH[k][1], k === 1 ? -1.57 : FZ - 0.07]);
const marks = [];
for (let k = 0; k < 12; k++) {
  const i = k % 6, refl = k >= 6;
  const el = document.createElement('div');
  el.className = 'mark' + (refl ? ' refl' : '');
  el.innerHTML = `<div class="rw"><svg viewBox="0 0 60 60"><circle class="halo" cx="30" cy="30" r="29"/><circle class="ring2" cx="30" cy="30" r="24"/><circle class="ring-bg" cx="30" cy="30" r="24"/><circle class="ring" cx="30" cy="30" r="24"/><circle class="core" cx="30" cy="30" r="2.2"/></svg></div><span class="num">${i + 1}</span>`;
  stage.appendChild(el);
  const ring = el.querySelector('.ring');
  marks.push({ i, refl, el, ring, sx: 0, sy: 0, off: false, active: null, world: refl ? [MARK_POS[i][0], -MARK_POS[i][1], MARK_POS[i][2]] : MARK_POS[i] });
}
const numsVisible = !touch;
for (const m of marks) m.el.querySelector('.num').style.display = numsVisible ? '' : 'none';

/* ---------- state ---------- */
const S = {
  mode: 'title',      // title | play | win | lose
  t: 0,               // run clock (s)
  crack: 0, jolt: 0,
  score: 0, streak: 0, bestStreak: 0, hits: 0, misses: 0,
  nextSpawn: 0, forkNext: false, lastIdx: -1, runTo: -1,
  shake: 0, shakeX: 0, shakeY: 0,
  endT: 0, endShown: false,
  flash: 0, flashHold: 0, bolt: 0, boltAz: 0.14, boltSeed: 3.7, flashDir: norm([0.2, 0.7, 0.35]), nextFlash: 1.2, thunderAt: -1,
  moon: 0, lean: 0, sink: 0, rings: 0, mist: 0, markI: 0, markPos: [0, 0, 0], pulseT: -9, pulsePos: [0, 0, 0], fade: 0,
  seal: 0, clear: 0, winLit: 0, crack0: 0,
  muted: false, time: 0, lastCreak: 0, hintT: 0, hint2: false, reflHinted: false, forkHinted: false, pushed: false,
};
let best = loadState(BEST_KEY, null);
function showBest() {
  if (best && best.score > 0) ui.best.textContent = `BEST  ${best.score.toLocaleString()}  ·  ${best.held ? 'THE HOUSE HELD' : `FELL AT ${Math.round(best.time)}s`}`;
  else ui.best.textContent = 'NO ONE HAS YET HELD THE HOUSE';
}
showBest();

/* ---------- audio ---------- */
const A = createAudio();
const SFX = (() => {
  let ready = false, ctx = null, wind = null, windLfo = null, noise = null;
  function start() {
    if (ready) return; ctx = A.ctx; if (!ctx) return; ready = true;
    const len = ctx.sampleRate * 2; noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.55;
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'lowpass'; bp2.frequency.value = 900;
    wind = ctx.createGain(); wind.gain.value = 0.0001;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain(); lfoG.gain.value = 260; lfo.connect(lfoG).connect(bp.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07; windLfo = ctx.createGain(); windLfo.gain.value = 0.05; lfo2.connect(windLfo).connect(wind.gain);
    src.connect(bp).connect(bp2).connect(wind).connect(A.master); src.start(); lfo.start(); lfo2.start();
    wind.gain.setTargetAtTime(0.16, ctx.currentTime, 1.5);
    A.setVolume(0.8);
  }
  const setFilt = (f, filt) => { f.type = filt.type; f.frequency.value = filt.frequency; if (filt.Q != null) f.Q.value = filt.Q; return f; };
  const burst = (dur, filt, g0, decay, when = 0) => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = setFilt(ctx.createBiquadFilter(), filt);
    const g = ctx.createGain(); const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(g).connect(A.master); s.start(t); s.stop(t + decay + 0.05);
    return f;
  };
  const tone = (type, f0, f1, dur, g0, when = 0, filt) => {
    const o = ctx.createOscillator(); o.type = type; const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filt) { const fl = setFilt(ctx.createBiquadFilter(), filt); o.connect(fl).connect(g); } else o.connect(g);
    g.connect(A.master); o.start(t); o.stop(t + dur + 0.05);
  };
  return {
    start,
    thunder(strength = 1, delay = 0.6) {
      if (!ready) return;
      const f = burst(0, { type: 'lowpass', frequency: 260, Q: 0.7 }, 0.55 * strength, 3.2 + strength, delay);
      f.frequency.setTargetAtTime(70, ctx.currentTime + delay + 0.2, 1.2);
      tone('sine', 44, 30, 2.6, 0.32 * strength, delay + 0.05);
      burst(0, { type: 'lowpass', frequency: 1200, Q: 0.4 }, 0.16 * strength, 0.5, delay);
    },
    creak(k = 0.5) {
      if (!ready) return;
      const f0 = 52 + k * 30 + Math.random() * 12;
      tone('sawtooth', f0, f0 * 0.62, 0.7 + k * 0.5, 0.05 + 0.07 * k, 0, { type: 'lowpass', frequency: 260 + k * 200, Q: 2.5 });
      tone('sawtooth', f0 * 1.012, f0 * 0.6, 0.7 + k * 0.5, 0.04 + 0.05 * k, 0.02, { type: 'lowpass', frequency: 300, Q: 2 });
    },
    crack(big = 1) {
      if (!ready) return;
      burst(0, { type: 'highpass', frequency: 1800, Q: 0.6 }, 0.35 * big, 0.14);
      burst(0, { type: 'bandpass', frequency: 620, Q: 2 }, 0.3 * big, 0.28, 0.02);
      tone('sine', 90, 28, 0.35, 0.5 * big, 0.01);
      tone('sawtooth', 70, 40, 0.5, 0.12 * big, 0.05, { type: 'lowpass', frequency: 220, Q: 3 });
    },
    hit(streak = 0, refl = false) {
      if (!ready) return;
      const f = (refl ? 150 : 190) * Math.pow(1.03, Math.min(streak, 20));
      tone('sine', f, f * 0.94, 0.32, 0.22);
      tone('triangle', f * 2.0, f * 1.9, 0.12, 0.07);
      burst(0, { type: 'highpass', frequency: 2400, Q: 0.5 }, 0.08, 0.04);
    },
    collapse() {
      if (!ready) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90; f.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 2.2); g.gain.setValueAtTime(0.9, t + 5.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 8.5);
      s.connect(f).connect(g).connect(A.master); s.start(t); s.stop(t + 9);
      tone('sine', 32, 24, 8.0, 0.5, 0.3);
      for (let i = 0; i < 6; i++) setTimeout(() => { this.creak(1); this.crack(0.8); }, 400 + i * 620 + Math.random() * 300);
      setTimeout(() => this.thunder(1.2, 0.2), 1800);
      if (wind) wind.gain.setTargetAtTime(0.0001, t + 6.5, 1.5);
    },
    held() {
      if (!ready) return;
      const t = ctx.currentTime;
      if (wind) wind.gain.setTargetAtTime(0.0001, t + 3.5, 1.4);
      tone('sine', 110, 108, 4.0, 0.12, 3.8);
      tone('sine', 165, 164, 4.0, 0.06, 4.0);
    },
    resume() { if (wind && ctx) wind.gain.setTargetAtTime(0.16, ctx.currentTime, 1.0); },
    get ready() { return ready; },
  };
})();

/* ---------- lightning ---------- */
function strike(intensity = 1) {
  S.flash = intensity; S.flashHold = reduced ? 0 : 2;
  S.bolt = 1;
  S.boltAz = rand(-0.9, 0.9) * (Math.random() < 0.5 ? 1 : 1) + (Math.abs(rand(-1, 1)) < 0.3 ? 0.4 : 0);
  S.boltSeed = rand(0, 100);
  const az = S.boltAz + rand(-0.3, 0.3), el = rand(0.25, 0.75);
  S.flashDir = norm([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el) * (Math.random() < 0.35 ? -0.6 : 1)]);
  S.thunderAt = S.time + rand(0.35, 1.5);
  S.thunderStrength = intensity;
}

/* ---------- run control ---------- */
function resetRun() {
  Object.assign(S, { t: 0, crack: 0, jolt: 0, score: 0, streak: 0, bestStreak: 0, hits: 0, misses: 0, nextSpawn: 1.1, forkNext: false,
    lastIdx: -1, runTo: -1, shake: 0, endT: 0, endShown: false, moon: 0, lean: 0, sink: 0, rings: 0, mist: 0, markI: 0, pulseT: -9, fade: 0, hintT: 0, newBest: false,
    seal: 0, clear: 0, winLit: 0, crack0: 0, hint2: false, reflHinted: false, forkHinted: false });
  for (const m of marks) { m.active = null; m.el.className = 'mark' + (m.refl ? ' refl' : ''); }
  updateHud(true);
}
function startRun() {
  SFX.start(); SFX.resume();
  resetRun();
  S.mode = 'play';
  ui.title.hidden = true; ui.win.hidden = true; ui.lose.hidden = true;
  ui.win.classList.remove('show'); ui.lose.classList.remove('show');
  hud.classList.add('on');
  S.nextFlash = S.time + 0.9;
  showHint('The storm is up. Watch the walls.');
}
function showHint(txt, dur = 2.6) { ui.hint.textContent = txt; ui.hint.classList.add('on'); S.hintT = S.time + dur; }

function endRun(won) {
  S.mode = won ? 'win' : 'lose';
  S.endT = 0; S.endShown = false;
  for (const m of marks) { m.active = null; m.el.classList.remove('active', 'dim'); }
  S.markI = 0;
  hud.classList.remove('on');
  const prevBest = best;
  const record = { score: S.score, time: S.t, held: won, streak: S.bestStreak, when: Date.now() };
  if (!prevBest || record.score > prevBest.score || (won && !prevBest.held)) { best = record; saveState(BEST_KEY, best); S.newBest = true; }
  showBest();
  S.crack0 = S.crack;
  if (won) { SFX.held(); strike(1.3); }
  else { SFX.collapse(); }
}
function showEnd() {
  S.endShown = true;
  const scr = S.mode === 'win' ? ui.win : ui.lose;
  const tally = S.mode === 'win' ? ui.wintally : ui.losetally;
  const items = [`SCORE <b>${S.score.toLocaleString()}</b>`, `BRACED <b>${S.hits}</b>`, `STREAK <b>${S.bestStreak}</b>`];
  if (S.mode === 'lose') items.push(`FELL AT <b>${Math.round(S.t)}s</b>`);
  tally.innerHTML = items.map((s) => `<span>${s}</span>`).join('');
  (S.mode === 'win' ? ui.winbest : ui.losebest).classList.toggle('on', !!S.newBest);
  scr.hidden = false;
  requestAnimationFrame(() => scr.classList.add('show'));
}

/* ---------- marks: spawning, hitting, missing ---------- */
function activeMarks() { return marks.filter((m) => m.active); }
/* the brace to light: the mark nearest BELOW the tip along the zigzag (skipping the ones
 * in `skip`); with the tip below every brace, the lowest one left */
function nextBraceIdx(skip) {
  const tipY = tipOf(S.crack);
  for (let i = 0; i < 6; i++) if (MARK_POS[i][1] < tipY - 0.04 && !skip.includes(i)) return i;
  for (let i = 5; i >= 0; i--) if (!skip.includes(i)) return i;
  return 0;
}
function spawn(t, fork = false) {
  const spread = smooth(0, 60, t);
  const life = lerp(1.55, 0.78, spread);
  const first = nextBraceIdx([S.lastIdx]);
  const idx = fork ? [first, nextBraceIdx([S.lastIdx, first])] : [first];
  // late in the run the tarn braces too, but never with a reflection that projects off the screen
  const refl = t > FORK_AT && Math.random() < 0.38 && idx.every((i) => !marks[i + 6].off);
  const group = fork ? idx.slice() : null;
  for (const i of idx) {
    const m = marks[i + (refl ? 6 : 0)];
    m.active = { born: t, life, fork: group };
    m.el.classList.remove('dim', 'hit', 'miss'); m.el.classList.add('active');
  }
  if (refl && !S.reflHinted) { S.reflHinted = true; showHint('The tarn braces too. Tap the reflection.'); }
  else if (fork && !S.forkHinted) { S.forkHinted = true; showHint('The fissure forks. It runs to the brace you leave.'); }
}
function scheduleSpawn(t) {
  S.nextSpawn = t + braceInterval(t) * rand(0.85, 1.15);
  S.forkNext = t > FORK_AT && Math.random() < lerp(0.12, 0.35, smooth(FORK_AT, 65, t));
}
function crackTo(v) { S.crack = clamp(Math.max(v, CRACK_FLOOR * S.t / RUN_LENGTH), 0, 1); }
function hitMark(m) {
  const a = m.active; const age = (S.t - a.born) / a.life;
  m.active = null;
  m.el.classList.remove('active'); m.el.classList.add('hit'); m.el.style.setProperty('--tx', m.el.style.transform);
  S.hits++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
  const mult = 1 + Math.min(Math.floor(S.streak / 5), 6) * 0.5;
  const gain = Math.round((100 + 120 * (1 - clamp(age, 0, 1)) + (m.refl ? 60 : 0)) * mult);
  S.score += gain;
  S.lastIdx = m.i;
  // the wall lights where you braced and the tip recoils one segment
  S.pulseT = S.time; S.pulsePos = marks[m.i].world;
  let recoiled = false;
  if (a.fork) {
    // a fork: the other brace goes dark and the fissure runs to it (the recoil is spent
    // on the run, so taking the lower fork holds the line and taking the upper one costs)
    for (const o of activeMarks()) if (o.active.fork === a.fork) {
      o.active = null; o.el.classList.remove('active'); o.el.classList.add('dim'); setTimeout(() => o.el.classList.remove('dim'), 400);
      const target = crackAt(MARK_POS[o.i][1]) - RECOIL;
      if (target > S.crack) { S.runTo = target; recoiled = true; }
    }
  }
  if (!recoiled) crackTo(S.crack - RECOIL);
  SFX.hit(S.streak, m.refl);
  ripple(m.sx, m.sy, false);
  if (S.streak > 0 && S.streak % 10 === 0) showHint(`${S.streak} braced without a miss.`, 1.8);
}
function missMark(m, expired) {
  const a = m.active;
  m.active = null;
  m.el.classList.remove('active'); m.el.classList.add('miss');
  setTimeout(() => m.el.classList.remove('miss'), 500);
  if (a && a.fork) {
    // both forks left to run: one jolt, and the fissure runs to the lower of them
    let lowest = m.i;
    for (const o of activeMarks()) if (o.active.fork === a.fork) { o.active = null; o.el.classList.remove('active'); lowest = Math.max(lowest, o.i); }
    S.runTo = crackAt(MARK_POS[lowest][1]);
  }
  jolt(expired ? COST_EXPIRE : COST_WRONG, 1);
}
function jolt(amount, k) {
  S.crack = Math.min(1, S.crack + amount);
  S.jolt = 1; S.shake = Math.max(S.shake, 0.6 * k + 0.4);
  S.streak = 0; S.misses++;
  SFX.crack(0.6 + k * 0.5);
}
function ripple(x, y, bad) {
  const p = document.createElement('div'); p.className = 'pulse' + (bad ? ' bad' : '');
  p.style.transform = `translate3d(${x}px,${y}px,0)`; stage.appendChild(p);
  requestAnimationFrame(() => p.classList.add('go'));
  setTimeout(() => p.remove(), 600);
}

/* ---------- input ---------- */
function tapAt(x, y) {
  if (S.mode !== 'play') return;
  const R = touch ? 46 : 36;
  let bestM = null, bestD = 1e9;
  for (const m of activeMarks()) { const d = Math.hypot(m.sx - x, m.sy - y); if (d < bestD) { bestD = d; bestM = m; } }
  if (bestM && bestD <= R + 10) { hitMark(bestM); return; }
  // wrong mark or the empty dark
  let near = null, nd = 1e9;
  for (const m of marks) { const d = Math.hypot(m.sx - x, m.sy - y); if (d < nd) { nd = d; near = m; } }
  ripple(x, y, true);
  jolt(near && nd <= R ? COST_WRONG : COST_DARK, 0.5);
}
function pressKey(k) {
  if (S.mode !== 'play') return;
  const m = marks[k].active ? marks[k] : (marks[k + 6].active ? marks[k + 6] : null);
  if (m) hitMark(m); else { ripple(marks[k].sx, marks[k].sy, true); jolt(COST_WRONG, 0.5); }
}
stage.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (S.mode === 'title') { startRun(); return; }   // the title screen itself is pointer-events:none
  tapAt(e.clientX, e.clientY);
}, { passive: false });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key >= '1' && e.key <= '6') { pressKey(e.key.charCodeAt(0) - 49); e.preventDefault(); return; }
  if (e.key === 'Enter' || e.key === ' ') {
    if (S.mode === 'title') { startRun(); e.preventDefault(); }
    else if ((S.mode === 'win' || S.mode === 'lose') && S.endShown) { startRun(); e.preventDefault(); }
    return;
  }
  if (e.key === 'r' || e.key === 'R') { if (S.mode !== 'title') startRun(); }
  if (e.key === 'm' || e.key === 'M') toggleMute();
});
$('start').addEventListener('click', (e) => { e.stopPropagation(); startRun(); });
$('again1').addEventListener('click', (e) => { e.stopPropagation(); startRun(); });
$('again2').addEventListener('click', (e) => { e.stopPropagation(); startRun(); });
function toggleMute() { S.muted = !S.muted; A.setMuted(S.muted); $('mute').textContent = S.muted ? '—' : '♪'; }
$('mute').addEventListener('click', (e) => { e.stopPropagation(); SFX.start(); toggleMute(); });

/* ---------- simulation ---------- */
function tick(dt) {
  S.time += dt;
  // lightning bookkeeping
  if (S.flashHold > 0) S.flashHold--; else S.flash *= Math.exp(-dt / 0.16);
  S.bolt *= Math.exp(-dt / (S.mode === 'title' ? 0.6 : 0.07));
  if (S.thunderAt > 0 && S.time >= S.thunderAt) { SFX.thunder(S.thunderStrength || 1, 0); S.thunderAt = -1; }
  if (S.mode === 'title') {
    // the poster: a bolt held behind the house, restruck now and then
    if (S.time >= S.nextFlash) { strike(0.9); S.boltAz = (Math.random() < 0.5 ? -1 : 1) * rand(0.1, 0.3); S.flashDir = norm([Math.sin(S.boltAz) * 1.4, 0.7, 0.35]); S.nextFlash = S.time + rand(2.4, 4.6); }
    S.bolt = Math.max(S.bolt, 0.5 + 0.12 * Math.sin(S.time * 9.0) * Math.sin(S.time * 3.1));
    S.flash = Math.max(S.flash, 0.42 + 0.07 * Math.sin(S.time * 7.3));
    S.jolt *= Math.exp(-dt / 0.3);
    S.crack = 0.16 + 0.02 * Math.sin(S.time * 0.5);
  } else if (S.mode === 'play') {
    S.t += dt;
    const t = S.t;
    if (S.time >= S.nextFlash) { strike(rand(0.8, 1.3)); S.nextFlash = S.time + lerp(rand(2.6, 5.5), rand(1.4, 3.2), smooth(0, 60, t)); }
    // the fissure runs: the clock. Between two braces the tip creeps CREEP_PER_BRACE,
    // a hit recoils it RECOIL, and the floor under it rises to CRACK_FLOOR by the causeway.
    let v = S.crack + (CREEP_PER_BRACE / braceInterval(t)) * dt;
    if (S.runTo >= 0) {
      // a fork left to run: the tip races to the brace you did not take
      if (v < S.runTo) v = Math.min(S.runTo, v + 0.9 * dt); else S.runTo = -1;
    }
    crackTo(v);
    S.jolt *= Math.exp(-dt / 0.35);
    // braces, one at a time (a fork lights two)
    if (t >= S.nextSpawn) { if (activeMarks().length) S.nextSpawn = t + 0.12; else { spawn(t, S.forkNext); scheduleSpawn(t); } }
    for (const m of activeMarks()) if (m.active && t - m.active.born > m.active.life) missMark(m, true);
    // creaks
    if (S.time - S.lastCreak > lerp(3.2, 0.7, S.crack) && Math.random() < dt * 1.5) { S.lastCreak = S.time; SFX.creak(S.crack); if (S.crack > 0.6) S.shake = Math.max(S.shake, 0.15 * S.crack); }
    if (S.hintT && S.time > S.hintT) { ui.hint.classList.remove('on'); S.hintT = 0; }
    S.mist = 0.15 * S.crack;
    if (t > 12 && !S.hint2) { S.hint2 = true; if (t < 15) showHint('The brace lights just below the tip. Every miss lets it run.'); }
    if (S.crack >= 1) { endRun(false); return; }
    if (t >= RUN_LENGTH) { endRun(true); return; }
  } else if (S.mode === 'lose') {
    S.endT += dt; const e = S.endT;
    S.jolt = Math.max(S.jolt * Math.exp(-dt / 0.6), smooth(0, 1.2, e) * (1 - smooth(4, 6, e)));
    S.shake = Math.max(S.shake, 0.9 * smooth(0.2, 1.4, e) * (1 - smooth(4.5, 6.5, e)));
    S.moon = smooth(0.4, 2.4, e) * (1 - smooth(7.5, 10, e) * 0.6);
    S.lean = 0.42 * smooth(1.2, 4.6, e);
    S.sink = 9.0 * Math.pow(smooth(2.6, 7.2, e), 1.8);
    S.rings = smooth(2.4, 4.2, e) * (1 - smooth(6.5, 10.5, e));
    S.mist = 0.35 * smooth(3, 7, e) + 0.15;
    S.crack = 1;
    if (e > 1.0 && e < 1.05 && S.flash < 0.5) strike(1.4);
    if (e > 5.6 && !S.endShown) showEnd();
    if (e > 8 && S.time >= S.nextFlash) { strike(0.6); S.nextFlash = S.time + rand(4, 8); }
  } else if (S.mode === 'win') {
    // the house held: the fissure seals bone-white from the tarn up, the windows light
    // one by one, and the storm clears to a cold moon
    S.endT += dt; const e = S.endT;
    S.jolt *= Math.exp(-dt / 0.5);
    S.mist = 0;
    S.seal = smooth(0.3, 2.4, e);
    S.crack = S.crack0 * (1 - smooth(0.8, 4.2, e));
    S.winLit = smooth(1.6, 5.2, e);
    S.clear = smooth(2.2, 7.5, e);
    if (e > 3.2 && e < 3.25 && S.flash < 0.5) strike(1.2);
    if (e > 4.2 && !S.endShown) showEnd();
    if (e > 5 && S.time >= S.nextFlash) { strike(0.5 * (1 - 0.7 * S.clear)); S.nextFlash = S.time + rand(5, 9); }
  }
  // shake decay
  S.shake *= Math.exp(-dt / 0.35);
  const sh = reduced ? S.shake * 0.25 : S.shake;
  S.shakeX = (Math.random() - 0.5) * sh * 0.35; S.shakeY = (Math.random() - 0.5) * sh * 0.3;
}

/* ---------- camera per mode ---------- */
function placeCamera() {
  const tm = S.time;
  const portrait = W < H;
  let dist = portrait ? 11.2 : 13.2, height = 1.6, ty = 0.6, tx = 0, drift = 1;
  const pd = portrait ? 10.2 : 11.8;
  if (S.mode === 'play') { dist = pd; height = 1.9; ty = 1.5; }
  else if (S.mode === 'win') { const e = smooth(0, 6, S.endT); dist = lerp(pd, pd + 4.5, e); height = lerp(1.9, 3.0, e); ty = lerp(1.5, 1.0, e); }
  else if (S.mode === 'lose') { const e = smooth(0, 8, S.endT); dist = lerp(pd, pd + 1.8, e); height = lerp(1.9, 1.3, e); ty = lerp(1.5, 0.6, e); }
  const sway = reduced ? 0 : 1;
  const px = Math.sin(tm * 0.09) * 0.35 * sway * drift + S.shakeX;
  const py = height + Math.sin(tm * 0.13) * 0.06 * sway + S.shakeY;
  setCamera([px, py, -dist], [tx + S.shakeX * 0.5, ty + S.shakeY * 0.5, 0], dist, S.mode !== 'title');
}

/* ---------- render ---------- */
let lastNow = performance.now(), frameAvg = 16, adaptT = 0;
function render(now) {
  const dt = clamp((now - lastNow) / 1000, 0, 0.05); lastNow = now;
  const stepDt = 1 / 60;
  // fixed-step simulation, capped so slow machines do not explode the sim
  let acc = dt; let n = 0;
  while (acc > 0 && n < 4) { tick(Math.min(acc, stepDt)); acc -= stepDt; n++; }
  placeCamera();

  // active brace light; a hit flares the wall to 3x where you braced for 200ms
  const act = activeMarks();
  const lit = act[0];
  const pulse = Math.max(0, 1 - (S.time - S.pulseT) / 0.2);
  if (pulse > 0) { S.markPos = S.pulsePos; S.markI = 3 * pulse; }
  else if (lit) { S.markPos = marks[lit.i].world; S.markI = lerp(S.markI, 1, 0.3); } else S.markI *= 0.8;
  const tipY = tipOf(S.crack);
  const depth = 0.1 + 3.0 * Math.pow(S.crack, 1.6) + (S.mode === 'lose' ? 3 : 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, SW, SH);
  gl.useProgram(scene.p);
  const u = scene.u;
  gl.uniform2f(u.uRes, SW, SH);
  gl.uniform1f(u.uTime, S.time);
  gl.uniform3fv(u.uCamPos, cam.pos); gl.uniform3fv(u.uCamFwd, cam.fwd); gl.uniform3fv(u.uCamRight, cam.right); gl.uniform3fv(u.uCamUp, cam.up);
  gl.uniform1f(u.uFocal, cam.focal); gl.uniform1f(u.uShift, cam.shift);
  gl.uniform1f(u.uCrack, S.crack); gl.uniform1f(u.uTipY, tipY); gl.uniform1f(u.uDepth, depth);
  gl.uniform1f(u.uSeal, S.seal); gl.uniform1f(u.uClear, S.clear); gl.uniform1f(u.uWinLit, S.winLit);
  gl.uniform1f(u.uFlash, S.flash); gl.uniform3fv(u.uFlashDir, S.flashDir);
  gl.uniform1f(u.uBolt, S.bolt); gl.uniform1f(u.uBoltAz, S.boltAz); gl.uniform1f(u.uBoltSeed, S.boltSeed);
  gl.uniform3fv(u.uMark, S.markPos); gl.uniform1f(u.uMarkI, S.markI);
  gl.uniform1f(u.uJolt, S.jolt); gl.uniform1f(u.uLean, S.lean); gl.uniform1f(u.uSink, S.sink); gl.uniform1f(u.uRings, S.rings);
  gl.uniform1f(u.uMoon, S.moon); gl.uniform1f(u.uMist, S.mist);
  const hq = lockScale || !software;
  const q = !hq ? 0.3 : (touch ? 0.6 : 1.0);
  gl.uniform1i(u.uSteps, !hq ? 56 : (touch ? 72 : 96));
  gl.uniform1i(u.uRSteps, !hq ? 28 : (touch ? 40 : 56));
  gl.uniform1f(u.uWave, S.mode === 'title' ? 0.3 : 0.55);
  gl.uniform1f(u.uQual, q);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(post.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(post.u.uScene, 0);
  gl.uniform2f(post.u.uRes, canvas.width, canvas.height);
  gl.uniform2f(post.u.uSceneRes, SW, SH);
  gl.uniform1f(post.u.uTime, S.time);
  gl.uniform1f(post.u.uGrain, reduced ? 0.03 : 0.075);
  gl.uniform1f(post.u.uFlash, S.flash);
  gl.uniform1f(post.u.uFade, S.fade);
  gl.uniform1f(post.u.uRain, S.mode === 'win' ? 1 - smooth(2, 5, S.endT) : 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  layoutMarks();
  layoutTitle();
  updateHud(false);

  // adaptive resolution: keep a real GPU near 60, let slow machines drop
  if (!software && !lockScale) {
    if (S.mode === 'lose' && S.endT < 8) {
      // the collapse is the poster: hold a high internal scale so the split does not staircase
      const want = touch ? 0.55 : 0.75;
      if (!S.pushed) { S.pushed = true; scale = want; sizeScene(); }
    } else {
      if (S.pushed) { S.pushed = false; scale = touch ? 0.34 : 0.5; sizeScene(); frameAvg = 16; render.prev = now; }
      frameAvg = frameAvg * 0.92 + (now - (render.prev || now)) * 0.08; render.prev = now;
      adaptT += dt;
      if (adaptT > 1.2) { adaptT = 0; if (frameAvg > 26 && scale > minScale) { scale = Math.max(minScale, scale * 0.82); sizeScene(); } else if (frameAvg < 13 && scale < (touch ? 0.42 : 0.6)) { scale = Math.min(touch ? 0.42 : 0.6, scale * 1.1); sizeScene(); } }
    }
  }
  requestAnimationFrame(render);
}

/* the title lockup: FISSURE lies across the facade with its red U on the crack line */
const wordEl = $('word'), wordU = $('wordU');
function layoutTitle() {
  if (S.mode !== 'title') return;
  const p = project([0.2, 3.35, FZ]);   // on the zigzag at mid-facade
  if (!p) return;
  const uc = wordU.offsetLeft + wordU.offsetWidth / 2;
  const w = wordEl.offsetWidth, h = wordEl.offsetHeight;
  const x = clamp(p[0] - uc, 14, Math.max(14, W - w - 14));
  wordEl.style.transform = `translate3d(${x.toFixed(1)}px,${(p[1] - h / 2).toFixed(1)}px,0)`;
}
function layoutMarks() {
  const showAll = S.mode === 'play';
  for (const m of marks) {
    const p = project(m.world);
    if (!p) { m.el.style.opacity = '0'; m.off = true; continue; }
    m.sx = p[0]; m.sy = p[1];
    m.off = p[1] > H - 40 || p[1] < 40 || p[0] < 30 || p[0] > W - 30;
    m.el.style.transform = `translate3d(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px,0)`;
    if (!showAll) { if (!m.el.classList.contains('hit')) m.el.style.opacity = '0'; continue; }
    if (m.active) {
      const age = (S.t - m.active.born) / m.active.life;
      m.ring.style.strokeDashoffset = (150.8 * clamp(age, 0, 1)).toFixed(1);
      m.el.style.opacity = String(clamp(0.72 + 0.3 * S.flash, 0, 1));
    } else if (m.el.classList.contains('hit')) {
      m.el.style.opacity = '';
    } else {
      // between flashes the unlit braces vanish into the dark
      const o = m.refl ? 0.10 : 0.22;
      m.el.style.opacity = String(clamp(S.flash * o, 0, 0.3));
    }
  }
}
let hudScore = -1, hudStreak = -1, hudTime = -1, hudFill = -1;
function updateHud(force) {
  if (force || hudScore !== S.score) { hudScore = S.score; ui.score.textContent = S.score.toLocaleString(); }
  if (force || hudStreak !== S.streak) { hudStreak = S.streak; ui.streak.textContent = S.streak >= 3 ? `${S.streak} braced  ×${(1 + Math.min(Math.floor(S.streak / 5), 6) * 0.5).toFixed(1)}` : ''; ui.streak.classList.toggle('hot', S.streak >= 10); }
  const left = Math.max(0, Math.ceil(RUN_LENGTH - S.t));
  if (force || hudTime !== left) { hudTime = left; ui.time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; }
  const f = Math.round(S.crack * 1000);
  if (force || hudFill !== f) { hudFill = f; ui.fill.style.height = (S.crack * 100).toFixed(1) + '%'; }
}

/* ---------- debug / playtest hook ---------- */
window.__poe = {
  get state() { return S.mode; }, get crack() { return S.crack; }, get score() { return S.score; }, get t() { return S.t; },
  get marks() { return marks.map((m) => ({ i: m.i, refl: m.refl, x: m.sx, y: m.sy, off: m.off, active: !!m.active, born: m.active ? m.active.born : -1, fork: !!(m.active && m.active.fork) })); },
  get tipY() { return tipOf(S.crack); },
  start: startRun,
  ff(seconds, autoHit = true) {
    // fast-forward the simulation, hitting every brace as it appears
    const step = 1 / 30; let n = Math.round(seconds / step);
    while (n-- > 0) { tick(step); if (autoHit && S.mode === 'play') for (const m of activeMarks()) if (m.active && S.t - m.active.born > 0.15) hitMark(m); }
  },
  // one fixed step plus a camera/marks layout without drawing — for in-page bots
  step(dt = 1 / 60) { tick(dt); placeCamera(); layoutMarks(); },
  layout() { placeCamera(); layoutMarks(); },
  setCrack(v) { S.crack = clamp(v, 0, 1); },
  forceWin() { S.t = RUN_LENGTH; },
  forceLose() { S.crack = 1; },
  endT: () => S.endT, software, get scale() { return scale; },
};

requestAnimationFrame(render);
