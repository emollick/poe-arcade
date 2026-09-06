/* The Vortex — A Descent into the Maelström
 * Raw WebGL2. Every particle is positioned in the vertex shader from a seed and
 * the vortex time; the CPU only runs the small game (player, a dozen objects).
 */
import { mountBack, fitCanvas, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';
import { PARTICLE_VS, PARTICLE_FS, SKY_VS, SKY_FS, GLYPH_VS, GLYPH_FS, GRADE_VS, GRADE_FS } from './shaders.js';

mountBack();

/* ------------------------------------------------------------------ DOM */
const $ = (s) => document.querySelector(s);
const canvas   = $('#gl');
const elTitle  = $('#title');
const elHud    = $('#hud');
const elEnd    = $('#end');
const elBest   = $('#best');
const elScore  = $('#score');
const elTide   = $('#tide');
const elMult   = $('#mult');
const elStam   = $('#stamFill');
const elDepthFill = $('#depthFill');
const elDepthMark = $('#depthMark');
const elPrompt = $('#prompt');
const elToast  = $('#toast');
const elFlash  = $('#flash');
const elRimPath = $('#rimPath');
const elRimText = $('#rimText');
const elStacked = $('#stacked');
const elMute   = $('#mute');
const elTouch  = $('#touch');
const reduced  = prefersReducedMotion();

/* ------------------------------------------------------------------ GL */
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
if (!gl) {
  $('#nogl').hidden = false;
  elTitle.hidden = true;
}

function compile(vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

/* Quality tier: discrete GPU desktop → 300k, phones → 60k, software GL → 24k. */
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && innerWidth < 900);
let renderer = '';
try { const ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); if (ext) renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ''; } catch {}
const software = /swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer);
const qParam = new URLSearchParams(location.search).get('q');
const MAX_PARTICLES = qParam === 'full' ? 300000 : qParam === 'phone' ? 60000 : software ? 24000 : (isTouch ? 60000 : 300000);
let drawCount = MAX_PARTICLES;
const DPR_CAP = (isTouch || software) ? 1 : 2;

let progP, progS, progG, progV, vaoP, vaoG, instBuf;
const INST_STRIDE = 11; // pos3 size1 kind1 rot1 col4 glow1
const MAX_INST = 160;
const instData = new Float32Array(MAX_INST * INST_STRIDE);

function initGL() {
  progP = compile(PARTICLE_VS, PARTICLE_FS);
  progS = compile(SKY_VS, SKY_FS);
  progG = compile(GLYPH_VS, GLYPH_FS);
  progV = compile(GRADE_VS, GRADE_FS);

  // particle seeds: 4 floats per particle from a fixed PRNG (deterministic look)
  let s = 0x9e3779b9 | 0;
  const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const seeds = new Float32Array(MAX_PARTICLES * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  vaoP = gl.createVertexArray(); gl.bindVertexArray(vaoP);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(progP.p, 'aSeed');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);

  // glyph instances
  vaoG = gl.createVertexArray(); gl.bindVertexArray(vaoG);
  instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
  const attrs = [['iPos', 3, 0], ['iSize', 1, 3], ['iKind', 1, 4], ['iRot', 1, 5], ['iCol', 4, 6], ['iGlow', 1, 10]];
  for (const [name, size, off] of attrs) {
    const l = gl.getAttribLocation(progG.p, name);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, INST_STRIDE * 4, off * 4);
    gl.vertexAttribDivisor(l, 1);
  }
  gl.bindVertexArray(null);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
}

/* ------------------------------------------------------------------ math */
const M = {
  perspective(fovy, aspect, near, far, shiftY = 0) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, shiftY, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    return o;
  },
  invert(m) {
    const a = m, o = new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return o; det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  project(vp, p, W, H) {
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H, w];
  },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ------------------------------------------------------------------ funnel (mirrors the shader) */
const RC = 0.06, PEX = 0.65, WRIM = 0.36;
const radiusOf = (u) => lerp(RC, 1.0, Math.pow(1 - clamp(u, 0, 1), PEX));
const funnelZ = (r) => -(0.8 * (1 - r) + 0.03 * (1 / r - 1));
const omegaAt = (r) => WRIM / r;                          // rad per vortex-second
function worldOf(u, th, flat) {
  const r = radiusOf(u);
  return [r * Math.cos(th), r * Math.sin(th), funnelZ(r) * flat];
}

/* ------------------------------------------------------------------ game constants */
const T_WIN = 80;            // seconds until the slack of the tide
const T_SLACK = 10;          // the last ten seconds: the funnel flattens
const KINDS = {
  cask:  { id: 1, good: true,  rate: -0.022, size: 0.085, name: 'water-cask',    note: 'a cylinder. It rises.' },
  spar:  { id: 2, good: true,  rate: -0.017, size: 0.13,  name: 'broken spar',   note: 'a cylinder. It rises.' },
  buoy:  { id: 3, good: false, rate:  0.045, size: 0.08,  name: 'buoy',          note: 'a sphere. It plunges.' },
  chest: { id: 4, good: false, rate:  0.038, size: 0.08,  name: 'sea-chest',     note: 'it plunges.' },
  hull:  { id: 5, good: false, rate:  0.070, size: 0.12,  name: 'hull fragment', note: 'it plunges fast.' },
  boat:  { id: 6, good: false, rate:  0.105, size: 0.19,  name: 'the smack',     note: 'the largest body. It plunges fastest.' },
};
const GOOD_KINDS = ['cask', 'spar', 'cask'];
const BAD_KINDS  = ['buoy', 'chest', 'hull', 'boat', 'hull'];
const COL = {
  good:  [0.62, 1.0, 0.86],
  bad:   [0.85, 0.55, 0.36],
  debris:[0.95, 0.98, 1.0],
  player:[1.0, 0.93, 0.72],
  gold:  [1.0, 0.82, 0.42],
};

/* ------------------------------------------------------------------ state */
const S = {
  mode: 'title',          // title | play | dying | lost | slack | won
  t: 0, tau: 0,           // game seconds, vortex time
  titleT: 0,
  speed: 1,               // whirl multiplier
  flat: 1,                // funnel depth scale
  moonLit: 0,
  dark: 0, dive: 0,
  player: { u: 0.18, th: 0, stamina: 1, stun: 0, lashed: null, lashCd: 0, swimDir: 1 },
  objects: [], debris: [],
  score: 0, lashedGood: 0, dodges: 0, streak: 0,
  spawnGoodCd: 0, spawnBadCd: 0, debrisCd: 4,
  camAz: 0, camAzTarget: 0,
  endT: 0, shake: 0,
  best: loadState('maelstrom:best', { score: 0, time: 0, won: false }),
};
const input = { left: false, right: false, up: false, lash: false, axis: 0 };

function pressure() { return 1 + 1.3 * clamp(S.t / 60, 0, 1); }
function baseSink(u) { return 0.008 + 0.036 * u; }

/* ------------------------------------------------------------------ audio */
const audio = createAudio();
const A = { ready: false, nodes: null, muted: loadState('maelstrom:muted', false) };
audio.setMuted(A.muted);
elMute.textContent = A.muted ? 'sound off' : 'sound on';
function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) { // pinkish noise
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return buf;
}
function buildAudio() {
  const ctx = audio.ctx; if (!ctx || A.ready) return; A.ready = true;
  const master = audio.master;
  const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(master);
  const nb = noiseBuffer(ctx, 3);
  const mk = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4; s.start(); return s; };
  // the roar: two low noise beds + a resonant peak that rises with the whirl
  const roar = ctx.createGain(); roar.gain.value = 0.9; roar.connect(bus);
  const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 140; lp1.Q.value = 0.8; mk().connect(lp1); lp1.connect(roar);
  const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 420; lp2.Q.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.45; mk().connect(lp2); lp2.connect(g2); g2.connect(roar);
  const peak = ctx.createBiquadFilter(); peak.type = 'bandpass'; peak.frequency.value = 90; peak.Q.value = 9; const gp = ctx.createGain(); gp.gain.value = 1.6; mk().connect(peak); peak.connect(gp); gp.connect(roar);
  // slow surge LFO on the roar
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lfoG = ctx.createGain(); lfoG.gain.value = 0.25; lfo.connect(lfoG); lfoG.connect(roar.gain); lfo.start();
  // the whistle: a narrow high band
  const wh = ctx.createBiquadFilter(); wh.type = 'bandpass'; wh.frequency.value = 2600; wh.Q.value = 18; const gw = ctx.createGain(); gw.gain.value = 0.05; mk().connect(wh); wh.connect(gw); gw.connect(bus);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.31; const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.035; lfo2.connect(lfo2G); lfo2G.connect(gw.gain); lfo2.start();
  // sub drone
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 38; const gs = ctx.createGain(); gs.gain.value = 0.12; sub.connect(gs); gs.connect(bus); sub.start();
  A.nodes = { bus, peak, wh, gw, sub, nb, roar };
}
function setRoar(level, whirl, dt) {
  if (!A.ready) return; const n = A.nodes, ctx = audio.ctx, now = ctx.currentTime;
  n.bus.gain.setTargetAtTime(level, now, 0.4);
  n.peak.frequency.setTargetAtTime(70 + 190 * clamp(whirl - 1, 0, 1.3), now, 0.5);
  n.wh.frequency.setTargetAtTime(2200 + 1800 * clamp(whirl - 1, 0, 1.3), now, 0.5);
  n.sub.frequency.setTargetAtTime(34 + 22 * clamp(whirl - 1, 0, 1.3), now, 0.5);
}
function splash(strength = 1, pitch = 1) {
  if (!A.ready) return; const ctx = audio.ctx, now = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = A.nodes.nb; s.playbackRate.value = 1.4 * pitch;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400 * pitch; f.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.9 * strength, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  s.connect(f); f.connect(g); g.connect(audio.master); s.start(now); s.stop(now + 0.5);
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(140 * pitch, now); o.frequency.exponentialRampToValueAtTime(45, now + 0.25);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.5 * strength, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  o.connect(og); og.connect(audio.master); o.start(now); o.stop(now + 0.32);
}
function chime(freq = 880) {
  if (!A.ready) return; const ctx = audio.ctx, now = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * (i ? 1.5 : 1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.18, now + 0.01 + i * 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    o.connect(g); g.connect(audio.master); o.start(now); o.stop(now + 1);
  }
}
function thud() {
  if (!A.ready) return; const ctx = audio.ctx, now = ctx.currentTime;
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(30, now + 0.35);
  const g = ctx.createGain(); g.gain.setValueAtTime(1.0, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  o.connect(g); g.connect(audio.master); o.start(now); o.stop(now + 0.45);
  splash(0.8, 0.5);
}
function swell() {
  if (!A.ready) return; const ctx = audio.ctx, now = ctx.currentTime;
  const chord = [130.8, 196, 261.6, 329.6, 392];
  chord.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now + 1.2); g.gain.exponentialRampToValueAtTime(0.07, now + 4 + i * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, now + 14);
    o.connect(g); g.connect(audio.master); o.start(now + 1); o.stop(now + 14.5);
  });
}
function toggleMute() { A.muted = !A.muted; audio.setMuted(A.muted); saveState('maelstrom:muted', A.muted); elMute.textContent = A.muted ? 'sound off' : 'sound on'; }
elMute.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });

/* ------------------------------------------------------------------ input */
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') input.left = true;
  if (k === 'arrowright' || k === 'd') input.right = true;
  if (k === 'arrowup' || k === 'w') input.up = true;
  if (k === ' ') { e.preventDefault(); if (S.mode === 'play') lashToggle(); else if (S.mode === 'title' || S.mode === 'lost' || S.mode === 'won') startGame(); }
  if (k === 'enter') { if (S.mode === 'title' || S.mode === 'lost' || S.mode === 'won') startGame(); }
  if (k === 'm') toggleMute();
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') input.left = false;
  if (k === 'arrowright' || k === 'd') input.right = false;
  if (k === 'arrowup' || k === 'w') input.up = false;
});
// touch: drag sideways to swim, drag/swipe up to climb, tap to lash
const T = { active: false, id: -1, x0: 0, y0: 0, x: 0, y: 0, t0: 0, moved: false };
canvas.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'play') { if (S.mode === 'title' || S.mode === 'lost' || S.mode === 'won') startGame(); return; }
  T.active = true; T.id = e.pointerId; T.x0 = T.x = e.clientX; T.y0 = T.y = e.clientY; T.t0 = performance.now(); T.moved = false;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener('pointermove', (e) => {
  if (!T.active || e.pointerId !== T.id) return;
  T.x = e.clientX; T.y = e.clientY;
  if (Math.hypot(T.x - T.x0, T.y - T.y0) > 12) T.moved = true;
  input.axis = clamp((T.x - T.x0) / 70, -1, 1);
  // the anchor follows the finger so the joystick never runs out of travel
  if (Math.abs(T.x - T.x0) > 70) T.x0 = T.x - Math.sign(T.x - T.x0) * 70;
  input.up = (T.y0 - T.y) > 36 || input.upBtn;
});
const endTouch = (e) => {
  if (!T.active || e.pointerId !== T.id) return;
  T.active = false; input.axis = 0; input.up = !!input.upBtn;
  if (!T.moved && performance.now() - T.t0 < 320 && S.mode === 'play') lashToggle();
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
// on-screen buttons
const hold = (el, on, off) => {
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); on(); try { el.setPointerCapture(e.pointerId); } catch {} });
  el.addEventListener('pointerup', (e) => { e.stopPropagation(); off(); });
  el.addEventListener('pointercancel', off);
};
hold($('#btnUp'), () => { input.upBtn = true; input.up = true; }, () => { input.upBtn = false; input.up = false; });
hold($('#btnLeft'), () => { input.left = true; }, () => { input.left = false; });
hold($('#btnRight'), () => { input.right = true; }, () => { input.right = false; });
$('#btnLash').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (S.mode === 'play') lashToggle(); });
if (isTouch) elTouch.hidden = false;
$('#start').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
$('#again').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });

/* ------------------------------------------------------------------ objects */
function spawnObject(kindName, uAt, thAt) {
  const k = KINDS[kindName];
  S.objects.push({ kind: kindName, k, u: uAt, th: thAt, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 0.6, age: 0, life: k.good ? 9 + Math.random() * 6 : 99, fade: 0, gone: false, born: true });
}
function spawnDebris() {
  const p = S.player;
  const th = p.th + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.9);
  S.debris.push({ u: -0.02, th, rot: Math.random() * TAU, spin: 3 + Math.random() * 4, minD: 9, passed: false, hit: false, age: 0 });
}
function nearestObject() {
  const p = S.player, pw = worldOf(p.u, p.th, S.flat);
  let best = null, bd = 1e9;
  for (const o of S.objects) {
    if (o.gone || o.fade < 0.5) continue;
    const w = worldOf(o.u, o.th, S.flat);
    const d = Math.hypot(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    if (d < bd) { bd = d; best = o; }
  }
  return { obj: best, d: bd };
}
const LASH_RANGE = 0.17;
function lashToggle() {
  const p = S.player;
  if (p.stun > 0 || p.lashCd > 0) return;
  if (p.lashed) {
    p.lashed = null; p.lashCd = 0.25; splash(0.6, 1.2); toast('let go');
    return;
  }
  const { obj, d } = nearestObject();
  if (obj && d < LASH_RANGE) {
    p.lashed = obj; p.lashCd = 0.25; splash(1, 0.9);
    toast(obj.k.good ? `lashed to the ${obj.k.name} — ${obj.k.note}` : `lashed to the ${obj.k.name} — ${obj.k.note}`, obj.k.good ? 'good' : 'bad');
  } else {
    p.lashCd = 0.15; splash(0.25, 1.6);
  }
}
let toastTimer = 0;
function toast(msg, cls = '') { elToast.textContent = msg; elToast.className = 'toast show ' + cls; toastTimer = 2.2; }
function flash(cls) { elFlash.className = 'flash ' + cls; void elFlash.offsetWidth; elFlash.classList.add('go'); }

/* ------------------------------------------------------------------ game flow */
function startGame() {
  buildAudio();
  S.mode = 'play'; S.t = 0; S.tau = 0; S.speed = 1; S.flat = 1; S.moonLit = 0; S.dark = 0; S.dive = 0;
  S.player = { u: 0.16, th: 0, stamina: 1, stun: 0, lashed: null, lashCd: 0, swimDir: 1 };
  S.objects = []; S.debris = [];
  S.score = 0; S.lashedGood = 0; S.dodges = 0; S.streak = 0;
  S.spawnGoodCd = 0.6; S.spawnBadCd = 1.6; S.debrisCd = 6; S.shake = 0;
  S.camAz = S.player.th + Math.PI; S.camAzTarget = S.camAz;
  // the first cask is close, so the rule teaches itself in the first seconds
  spawnObject('cask', 0.22, 0.55);
  spawnObject('hull', 0.14, -0.7);
  elTitle.hidden = true; elEnd.hidden = true; elHud.hidden = false;
  elToast.className = 'toast';
  document.body.classList.add('playing');
}
function loseGame() {
  S.mode = 'dying'; S.endT = 0; S.player.lashed = null;
  if (A.ready) { const now = audio.ctx.currentTime; A.nodes.bus.gain.setTargetAtTime(0, now + 1.2, 0.5); }
  splash(1.2, 0.5);
}
function showEnd(won) {
  S.mode = won ? 'won' : 'lost';
  const score = Math.round(S.score);
  const prevBest = S.best.score || 0;
  const isBest = score > prevBest;
  const survived = !!(S.best.survived || won);
  if (isBest) S.best = { score, time: Math.round(S.t), won, survived };
  else S.best = { ...S.best, survived };
  saveState('maelstrom:best', S.best);
  $('#endKicker').textContent = won ? 'The slack of the tide' : 'Into the gulf';
  $('#endQuote').innerHTML = won
    ? '“The bottom of the gulf seemed slowly to uprise. The sky was clear, the winds had gone down, and the full moon was setting radiantly in the west.”'
    : '“…like that narrow and tottering bridge which Mussulmen say is the only pathway between Time and Eternity.”';
  $('#endScore').textContent = score.toLocaleString();
  $('#endStats').textContent = `${Math.round(S.t)}s in the water · ${Math.round(S.lashedGood)}s lashed to cylinders · ${S.dodges} dodged` + (isBest ? ' · new best' : '');
  elEnd.className = 'screen ' + (won ? 'won' : 'lost');
  elEnd.hidden = false; elHud.hidden = true;
  document.body.classList.remove('playing');
  updateBest();
}
function updateBest() {
  const b = S.best;
  elBest.textContent = b && b.score ? `best ${b.score.toLocaleString()} · ${b.time}s${b.survived ? ' · you have come up out of it' : ''}` : 'no one has yet come up out of it';
}
updateBest();

/* ------------------------------------------------------------------ update */
function update(dt) {
  const p = S.player;
  if (S.mode === 'title') { S.titleT += dt; S.tau += dt; S.camAz += dt * (reduced ? 0.02 : 0.06); return; }

  if (S.mode === 'play' || S.mode === 'slack') {
    S.t += dt;
    const slackP = S.mode === 'slack' ? clamp((S.t - (T_WIN - T_SLACK)) / T_SLACK, 0, 1) : 0;
    S.speed = (1 + 0.9 * clamp(S.t / 60, 0, 1)) * (1 - slackP * 0.85);
    S.tau += dt * S.speed;
    S.flat = 1 - slackP * 0.93;
    S.moonLit = slackP;
    if (S.mode === 'play' && S.t >= T_WIN - T_SLACK) {
      S.mode = 'slack'; p.lashed = null; toast('the whirl is slackening — the bottom of the gulf seems slowly to uprise', 'good');
      if (A.ready) { const now = audio.ctx.currentTime; A.nodes.bus.gain.setTargetAtTime(0, now + 2, 1.2); }
      swell();
    }
    if (S.mode === 'slack' && S.t >= T_WIN) { showEnd(true); return; }

    // ---- player -----------------------------------------------------
    p.stun = Math.max(0, p.stun - dt); p.lashCd = Math.max(0, p.lashCd - dt);
    const r = radiusOf(p.u);
    const omega = omegaAt(r) * S.speed;
    let axis = 0;
    if (p.stun <= 0 && S.mode === 'play') {
      axis = (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.axis;
      axis = clamp(axis, -1, 1);
    }
    const climbing = p.stun <= 0 && input.up && p.stamina > 0 && S.mode === 'play';
    if (climbing) p.stamina = Math.max(0, p.stamina - dt / 2.6);
    else p.stamina = Math.min(1, p.stamina + dt / (p.lashed ? 3.0 : 5.0));

    if (p.lashed) {
      const o = p.lashed;
      if (o.gone) { p.lashed = null; toast(o.k.good ? `the ${o.k.name} is torn away` : `the ${o.k.name} is gone into the gulf`); splash(0.8, 0.7); }
      else {
        // ride the object
        p.u += (o.u - p.u) * Math.min(1, dt * 8);
        p.th += wrapAngle(o.th + 0.02 - p.th) * Math.min(1, dt * 8);
        if (climbing) p.u -= 0.028 * dt;
      }
    } else {
      const sink = baseSink(p.u) * pressure() * S.speed * (p.stun > 0 ? 2.2 : 1) * (1 - slackP);
      p.u += sink * dt;
      if (climbing) p.u -= 0.055 * dt;
      p.th += omega * dt + axis * 0.95 * p.swimDir * dt / Math.max(r, 0.25);
    }
    if (S.mode === 'slack') p.u += (-0.02 - p.u) * Math.min(1, dt * (0.4 + slackP * 2));
    p.u = clamp(p.u, -0.03, 1.05);
    if (p.u >= 1 && S.mode === 'play') { loseGame(); return; }

    // ---- objects --------------------------------------------------------
    for (const o of S.objects) {
      o.age += dt;
      o.fade = o.gone ? Math.max(0, o.fade - dt * 2.5) : Math.min(1, o.fade + dt * 1.5);
      const ro = radiusOf(o.u);
      o.th += omegaAt(ro) * S.speed * dt;
      o.rot += o.spin * dt;
      let du = o.k.rate;
      if (o.k.good) du = o.k.rate + 0.42 * baseSink(o.u) * pressure(); // late in the whirl even casks barely hold
      o.u += du * S.speed * dt * (1 - slackP);
      if (S.mode === 'slack') o.u += (-0.05 - o.u) * dt * 0.5;
      if (!o.gone && (o.age > o.life || o.u > 1.0 || o.u < -0.06)) { o.gone = true; }
    }
    S.objects = S.objects.filter((o) => !(o.gone && o.fade <= 0));

    // keep the water populated: good ones near the player, bad ones everywhere
    if (S.mode === 'play') {
      S.spawnGoodCd -= dt; S.spawnBadCd -= dt;
      const goods = S.objects.filter((o) => o.k.good && !o.gone && Math.abs(wrapAngle(o.th - p.th)) < 2.4).length;
      const bads  = S.objects.filter((o) => !o.k.good && !o.gone).length;
      if (S.spawnGoodCd <= 0 && goods < 2) {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnObject(GOOD_KINDS[Math.floor(Math.random() * GOOD_KINDS.length)], clamp(p.u + (Math.random() * 0.5 - 0.15), 0.04, 0.8), p.th + side * (0.5 + Math.random() * 1.4));
        S.spawnGoodCd = 1.6 + Math.random() * 1.8;
      }
      if (S.spawnBadCd <= 0 && bads < 3) {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnObject(BAD_KINDS[Math.floor(Math.random() * BAD_KINDS.length)], clamp(p.u + (Math.random() * 0.4 - 0.25), 0.02, 0.6), p.th + side * (0.3 + Math.random() * 1.6));
        S.spawnBadCd = 2.2 + Math.random() * 2.5;
      }
      // debris sweeps
      S.debrisCd -= dt;
      if (S.debrisCd <= 0) {
        spawnDebris();
        if (S.t > 45 && Math.random() < 0.5) spawnDebris();
        S.debrisCd = lerp(6.5, 2.4, clamp(S.t / 60, 0, 1)) * (0.7 + Math.random() * 0.6);
      }
    }
    // ---- debris ---------------------------------------------------------
    const pw = worldOf(p.u, p.th, S.flat);
    for (const d of S.debris) {
      d.age += dt;
      const rd = radiusOf(Math.max(d.u, 0));
      d.th += omegaAt(rd) * S.speed * 1.05 * dt;
      d.u += 0.15 * S.speed * dt * (1 - slackP);
      d.rot += d.spin * dt;
      const w = worldOf(d.u, d.th, S.flat);
      const dist = Math.hypot(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
      d.minD = Math.min(d.minD, dist);
      if (!d.hit && !d.passed && dist < 0.085 && S.mode === 'play') {
        d.hit = true; p.stun = 1.1; p.u += 0.07; S.streak = 0; S.shake = 1;
        if (p.lashed) { p.lashed = null; toast('struck — torn from your hold', 'bad'); } else toast('struck by wreckage', 'bad');
        flash('hit'); thud();
      }
      if (!d.passed && d.u > p.u + 0.04) {
        d.passed = true;
        if (!d.hit && d.minD < 0.36 && S.mode === 'play') {
          S.streak = Math.min(S.streak + 1, 6);
          const pts = 100 + 50 * (S.streak - 1);
          S.score += pts; S.dodges++;
          toast(`dodged · +${pts}` + (S.streak > 1 ? ` · streak ${S.streak}` : ''), 'gold');
          chime(660 + S.streak * 80);
        }
      }
    }
    S.debris = S.debris.filter((d) => d.u < 1.02);

    // ---- score ----------------------------------------------------------
    if (S.mode === 'play') {
      const lashedGood = p.lashed && p.lashed.k.good;
      if (lashedGood) S.lashedGood += dt;
      S.score += dt * 10 * (lashedGood ? 3 : 1);
    }
    S.camAzTarget = p.th + Math.PI;
    setRoar(S.mode === 'play' ? 0.55 + 0.2 * clamp(p.u, 0, 1) : 0, S.speed, dt);
  }

  if (S.mode === 'dying') {
    S.endT += dt;
    const k = clamp(S.endT / 2.8, 0, 1);
    S.dive = k; S.speed = 1 + 4 * k; S.tau += dt * S.speed;
    S.dark = k * k * 0.78;
    p.u = Math.min(1.02, p.u + dt * 0.1);
    S.camAzTarget = p.th + Math.PI;
    if (S.endT > 3.4) showEnd(false);
  }
  S.shake = Math.max(0, S.shake - dt * 2.5);
  // camera azimuth follows the player around the funnel with a gentle sway
  const sway = reduced ? 0 : Math.sin(S.tau * 0.23) * 0.16;
  S.camAz += wrapAngle(S.camAzTarget + sway - S.camAz) * Math.min(1, dt * 3.5);

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) elToast.classList.remove('show'); }
}

/* ------------------------------------------------------------------ camera */
let W = 1, H = 1, DPR = 1;
const cam = { view: null, proj: null, vp: null, inv: null, eye: [0, 0, 0], fov: 1, moonDir: [0, 0, 1], moonAz: 0 };
function buildCamera() {
  const portrait = H > W * 1.05;
  const p = S.player;
  const depth = S.mode === 'title' ? 0.15 : clamp(p.u, 0, 1);
  const az = S.camAz;
  // eye hangs just inside the rim, looking across the funnel at the far wall
  let R = portrait ? 1.3 : 1.02, Hh = portrait ? 1.05 : 1.0, fov = portrait ? 92 : 72;
  let pitch = (portrait ? -33 : -24) - 10 * depth;
  if (S.mode === 'dying') {
    const k = S.dive; R = lerp(R, 0.3, k); Hh = lerp(Hh, -0.3, k * k); pitch = lerp(pitch, -88, k); fov = lerp(fov, 105, k);
  }
  if (S.mode === 'slack' || S.mode === 'won') { const k = S.moonLit; Hh += 0.45 * k; R += 0.25 * k; pitch += 6 * k; }
  const sh = S.shake * (reduced ? 0 : 0.03);
  const eye = [Math.cos(az) * R + (Math.random() - 0.5) * sh, Math.sin(az) * R + (Math.random() - 0.5) * sh, Hh + (Math.random() - 0.5) * sh];
  const pr = pitch * Math.PI / 180;
  const target = [eye[0] - Math.cos(az) * Math.cos(pr), eye[1] - Math.sin(az) * Math.cos(pr), eye[2] + Math.sin(pr)];
  cam.eye = eye; cam.fov = fov * Math.PI / 180;
  cam.view = M.lookAt(eye, target, [0, 0, 1]);
  cam.proj = M.perspective(cam.fov, W / H, 0.05, 40, 0);
  cam.vp = M.mul(cam.proj, cam.view);
  cam.inv = M.invert(cam.vp);
  cam.moonAz = az + Math.PI + (portrait ? -0.06 : 0.30);
  const el = (portrait ? 0.125 : 0.09) + 0.06 * S.moonLit;
  cam.moonDir = [Math.cos(cam.moonAz) * Math.cos(el), Math.sin(cam.moonAz) * Math.cos(el), Math.sin(el)];
  // which way is "right" for the player on screen?
  const w0 = M.project(cam.vp, worldOf(p.u, p.th, S.flat), W, H);
  const w1 = M.project(cam.vp, worldOf(p.u, p.th + 0.05, S.flat), W, H);
  p.swimDir = (w1[0] - w0[0]) >= 0 ? 1 : -1;
}

/* ------------------------------------------------------------------ render */
let frameTimes = [], lastFrame = 0;
function pushInst(i, pos, size, kind, rot, col, a, glow) {
  const o = i * INST_STRIDE;
  instData[o] = pos[0]; instData[o + 1] = pos[1]; instData[o + 2] = pos[2];
  instData[o + 3] = size; instData[o + 4] = kind; instData[o + 5] = rot;
  instData[o + 6] = col[0]; instData[o + 7] = col[1]; instData[o + 8] = col[2]; instData[o + 9] = a;
  instData[o + 10] = glow;
}
function render() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  // sky
  gl.disable(gl.BLEND);
  gl.useProgram(progS.p);
  gl.uniformMatrix4fv(progS.u.uInvVP, false, cam.inv);
  gl.uniform3fv(progS.u.uCam, cam.eye);
  gl.uniform3fv(progS.u.uMoonDir, cam.moonDir);
  gl.uniform1f(progS.u.uMoonLit, S.moonLit);
  gl.uniform1f(progS.u.uT, S.tau);
  gl.uniform1f(progS.u.uDark, S.dark);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // particles, additive; a second ghost draw slightly behind in time for the streak
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(progP.p); gl.bindVertexArray(vaoP);
  const proj = canvas.height / (2 * Math.tan(cam.fov / 2));
  const density = Math.sqrt(300000 / drawCount);
  gl.uniformMatrix4fv(progP.u.uVP, false, cam.vp);
  gl.uniform1f(progP.u.uTau, S.tau);
  gl.uniform1f(progP.u.uFlat, S.flat);
  gl.uniform1f(progP.u.uProj, proj);
  gl.uniform1f(progP.u.uSizeMul, 0.0135 * Math.sqrt(density) * (DPR > 1 ? 1.15 : 1));
  gl.uniform1f(progP.u.uMoonAz, cam.moonAz);
  gl.uniform1f(progP.u.uMoonLit, S.moonLit);
  gl.uniform1f(progP.u.uDive, S.dive);
  gl.uniform3fv(progP.u.uCam, cam.eye);
  const streaks = S.dive > 0 ? 3 : (software ? 1 : 2);
  const base = 0.42 * density * (1 - S.dark);
  for (let i = 0; i < streaks; i++) {
    gl.uniform1f(progP.u.uStreak, -i * (0.045 + S.dive * 0.25));
    gl.uniform1f(progP.u.uFrac, base * (i === 0 ? 1 : 0.55 / i));
    gl.drawArrays(gl.POINTS, 0, drawCount);
  }

  // glyphs
  let n = 0;
  const p = S.player;
  const pw = worldOf(p.u, p.th, S.flat);
  const near = S.mode === 'play' ? nearestObject() : { obj: null, d: 9 };
  const items = [];
  const gs = (H > W * 1.05 ? 1.9 : 1.4);
  for (const o of S.objects) {
    const w = worldOf(o.u, o.th, S.flat);
    const dcam = Math.hypot(w[0] - cam.eye[0], w[1] - cam.eye[1], w[2] - cam.eye[2]);
    const a = o.fade * clamp((dcam - 0.35) / 0.4, 0, 1);
    const isNear = near.obj === o && near.d < LASH_RANGE;
    const col = o.k.good ? COL.good : COL.bad;
    items.push({ d: dcam, pos: w, size: gs * o.k.size * (0.9 + 0.1 * Math.sin(o.age * 3)), kind: o.k.id, rot: o.rot + Math.sin(o.age * 1.7) * 0.15, col, a, glow: (p.lashed === o ? 1 : isNear ? 0.6 + 0.4 * Math.sin(S.tau * 8) : 0.15) });
    if (isNear || p.lashed === o) items.push({ d: dcam - 0.001, pos: w, size: gs * o.k.size * 1.35, kind: 8, rot: S.tau * (p.lashed === o ? 0.5 : 2), col: COL.gold, a: a * (p.lashed === o ? 0.9 : 0.55 + 0.35 * Math.sin(S.tau * 8)), glow: 0 });
  }
  for (const d of S.debris) {
    const w = worldOf(d.u, d.th, S.flat);
    const dcam = Math.hypot(w[0] - cam.eye[0], w[1] - cam.eye[1], w[2] - cam.eye[2]);
    const a = clamp(d.age * 2, 0, 1) * clamp((dcam - 0.3) / 0.4, 0, 1);
    items.push({ d: dcam, pos: w, size: gs * 0.10, kind: 7, rot: d.rot, col: COL.debris, a, glow: 0.9 });
    items.push({ d: dcam + 0.001, pos: w, size: gs * 0.16, kind: 0, rot: 0, col: [0.8, 0.9, 1.0], a: a * 0.35, glow: 0 });
  }
  if (S.mode !== 'title') {
    // rope
    if (p.lashed && !p.lashed.gone) {
      const ow = worldOf(p.lashed.u, p.lashed.th, S.flat);
      for (let i = 1; i < 9; i++) {
        const t = i / 9, sag = Math.sin(t * Math.PI) * 0.02;
        const pos = [lerp(pw[0], ow[0], t), lerp(pw[1], ow[1], t), lerp(pw[2], ow[2], t) - sag];
        items.push({ d: 0.5, pos, size: 0.014, kind: 0, rot: 0, col: COL.gold, a: 0.9, glow: 0 });
      }
    }
    const dcam = Math.hypot(pw[0] - cam.eye[0], pw[1] - cam.eye[1], pw[2] - cam.eye[2]);
    const pulse = 1 + 0.12 * Math.sin(S.tau * 6);
    const stunCol = p.stun > 0 ? [1.0, 0.45, 0.35] : COL.player;
    items.push({ d: dcam + 0.002, pos: pw, size: gs * 0.11 * pulse, kind: 0, rot: 0, col: stunCol, a: 0.8 * (1 - S.dark), glow: 0 });
    items.push({ d: dcam, pos: pw, size: gs * 0.055 * pulse, kind: 9, rot: S.tau * 0.8, col: stunCol, a: (1 - S.dark), glow: p.lashed ? 1 : 0 });
  }
  items.sort((a, b) => b.d - a.d);
  for (const it of items) { if (n >= MAX_INST) break; pushInst(n++, it.pos, it.size, it.kind, it.rot, it.col, it.a, it.glow); }
  if (n) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progG.p); gl.bindVertexArray(vaoG);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, n * INST_STRIDE);
    gl.uniformMatrix4fv(progG.u.uView, false, cam.view);
    gl.uniformMatrix4fv(progG.u.uProj, false, cam.proj);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }

  // grade: vignette (multiply)
  gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
  gl.useProgram(progV.p); gl.bindVertexArray(null);
  gl.uniform1f(progV.u.uDark, S.dark * 0.6);
  gl.uniform1f(progV.u.uAspect, W / H);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // HUD / prompt
  if (S.mode === 'play' || S.mode === 'slack') {
    elScore.textContent = Math.round(S.score).toLocaleString();
    const left = Math.max(0, T_WIN - S.t);
    elTide.textContent = S.mode === 'slack' ? 'the tide turns' : `tide turns in ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    const lg = p.lashed && p.lashed.k.good;
    elMult.textContent = lg ? '×3 lashed to a cylinder' : (p.lashed ? 'lashed to a plunging body' : '×1 adrift');
    elMult.className = 'mult ' + (lg ? 'good' : p.lashed ? 'bad' : '');
    elStam.style.transform = `scaleX(${p.stamina.toFixed(3)})`;
    elStam.parentElement.classList.toggle('low', p.stamina < 0.25);
    const depthPct = clamp(p.u, 0, 1);
    elDepthFill.style.transform = `scaleY(${depthPct.toFixed(3)})`;
    elDepthMark.style.top = `${(depthPct * 100).toFixed(1)}%`;
    if (near.obj && near.d < LASH_RANGE && !p.lashed && p.stun <= 0) {
      const sp = M.project(cam.vp, worldOf(near.obj.u, near.obj.th, S.flat), W, H);
      elPrompt.hidden = false;
      elPrompt.style.transform = `translate(${sp[0].toFixed(0)}px, ${(sp[1] - 34).toFixed(0)}px)`;
      elPrompt.className = 'prompt ' + (near.obj.k.good ? 'good' : 'bad');
      elPrompt.innerHTML = `<b>${near.obj.k.name}</b> · ${near.obj.k.note}<span>${isTouch ? 'tap' : 'space'} to lash</span>`;
    } else elPrompt.hidden = true;
  } else elPrompt.hidden = true;

  if (S.mode === 'title') layoutTitle();
}

/* The title runs along the far rim of the funnel: project the rim circle. */
function layoutTitle() {
  const az = S.camAz;
  const pts = [];
  const span = H > W ? 0.95 : 1.35;
  for (let i = 0; i <= 40; i++) {
    const phi = -span + (2 * span) * (i / 40);
    const th = az + Math.PI - phi;
    const r = 1.07;
    pts.push(M.project(cam.vp, [r * Math.cos(th), r * Math.sin(th), 0.055], W, H));
  }
  if (pts[0][0] > pts[pts.length - 1][0]) pts.reverse();
  const ok = pts.every((q) => q[2] > 0 && q[1] > -H * 0.2 && q[1] < H * 0.9) && pts[0][0] < W * 0.35 && pts[pts.length - 1][0] > W * 0.65 && pts[0][0] > -W * 0.1 && pts[pts.length - 1][0] < W * 1.1;
  const svg = $('#titleSvg');
  if (!ok) { svg.hidden = true; elStacked.hidden = false; return; }
  svg.hidden = false; elStacked.hidden = true;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  elRimPath.setAttribute('d', 'M' + pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L'));
  let size = H > W ? Math.min(W * 0.19, 96) : Math.min(W * 0.11, 168);
  const len = elRimPath.getTotalLength();
  size = Math.min(size, len / (10 * 0.66));   // "The Vortex": ~0.66em per glyph in heavy italic
  elRimText.setAttribute('font-size', size.toFixed(1));
}

/* ------------------------------------------------------------------ loop */
const fit = fitCanvas(canvas, ({ width, height, dpr }) => {
  W = width; H = height;
  DPR = Math.min(dpr, DPR_CAP);
  const w = Math.max(1, Math.round(width * DPR)), h = Math.max(1, Math.round(height * DPR));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
});
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = dtRaw * (S.ff || 1);
  // adaptive particle budget
  if (lastFrame && !qParam) { frameTimes.push(now - lastFrame); if (frameTimes.length >= 40) { const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length; frameTimes = []; if (avg > 28 && drawCount > 12000) drawCount = Math.floor(drawCount * 0.7); else if (avg < 13 && drawCount < MAX_PARTICLES) drawCount = Math.min(MAX_PARTICLES, Math.floor(drawCount * 1.15)); } }
  lastFrame = now;
  if (S.ff && S.ff > 1) { for (let i = 0; i < S.ff; i++) update(dtRaw); } else update(dt);
  buildCamera();
  render();
}

if (gl) {
  initGL();
  buildCamera();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ debug / playtest hook */
window.__poe = {
  state: S, input,
  start: startGame,
  fastForward(seconds) { const steps = Math.ceil(seconds / (1 / 60)); for (let i = 0; i < steps; i++) update(1 / 60); },
  setFF(mult) { S.ff = mult; },
  lash: lashToggle,
  nearest: nearestObject,
  kill() { S.player.u = 1; },
  win() { S.t = T_WIN - T_SLACK - 0.01; },
  quality: { renderer, software, isTouch, MAX_PARTICLES, get drawCount() { return drawCount; } },
};
