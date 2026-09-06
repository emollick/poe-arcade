/* THE CASK OF AMONTILLADO — Brick by Brick
 * Pure CSS 3D: the catacomb is a DOM scene under `perspective`. No canvas, no WebGL, no images.
 * All sound is synthesized with Web Audio via createAudio() from /shared/poe.js.
 */
import { mountBack, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';

mountBack();

const $ = (s) => document.querySelector(s);
const RM = prefersReducedMotion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

/* ------------------------------------------------------------------ world */
// world units; JS multiplies by U (px per unit) which follows the viewport.
const W = 720, FLOOR = 300, WALLTOP = -200, RISE = 180, D = 2600;
const NW = 300, NH = 420, ND = 280;               // the niche
const TIERS = 11, TH = NH / TIERS;                // 38.18 per tier
const BH = 34, BD = 30;                           // brick height / depth
const FAR_LEN = 1200, NEAR_LEN = 900;
const courseY = (i) => FLOOR - TH * (i + 0.5);

let U = 1, PORTRAIT = false;
const stage = $('#stage'), camera = $('#camera'), world = $('#world');
const placed = [];

function el(cls, parent) { const d = document.createElement('div'); if (cls) d.className = cls; (parent || world).appendChild(d); return d; }
function tf(o) {
  let s = `translate3d(${(o.x * U).toFixed(2)}px,${(o.y * U).toFixed(2)}px,${(o.z * U).toFixed(2)}px)`;
  if (o.rz) s += ` rotateZ(${o.rz}deg)`;
  if (o.ry) s += ` rotateY(${o.ry}deg)`;
  if (o.rx) s += ` rotateX(${o.rx}deg)`;
  if (o.extra) s += ' ' + o.extra;
  return s;
}
function applyOne(o) {
  const s = o.el.style;
  s.width = (o.w * U) + 'px'; s.height = (o.h * U) + 'px';
  s.left = (-o.w * U / 2) + 'px'; s.top = (-o.h * U / 2) + 'px';
  s.transform = tf(o);
}
function place(node, spec) {
  node.classList.add('p');
  const o = Object.assign({ el: node, w: 0, h: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, spec);
  placed.push(o); applyOne(o); return o;
}
function unplace(o) { const i = placed.indexOf(o); if (i >= 0) placed.splice(i, 1); o.el.remove(); }

function skulls(wall, n, seed) {
  for (let i = 0; i < n; i++) {
    const s = el('skull tilt', wall);
    s.style.left = (4 + ((i * 37 + seed * 13) % 90)) + '%';
    s.style.top = (50 + ((i * 53 + seed * 7) % 42)) + '%';
    s.style.setProperty('--r', ((i * 29 + seed * 11) % 24 - 12) + 'deg');
  }
}
function bonesOnFloor(fl, n, seed) {
  for (let i = 0; i < n; i++) {
    const b = el('bone', fl);
    b.style.left = (6 + ((i * 41 + seed * 17) % 84)) + '%';
    b.style.top = (10 + ((i * 61 + seed * 5) % 80)) + '%';
    b.style.setProperty('--r', ((i * 71 + seed * 3) % 180) + 'deg');
  }
  for (let i = 0; i < 3; i++) {
    const p = el('puddle', fl);
    p.style.left = (10 + i * 30) + '%'; p.style.top = (20 + i * 25) + '%';
    p.style.width = '22%'; p.style.height = '10%';
  }
}

const S = {};                                  // static scene handles
function buildWorld() {
  world.innerHTML = ''; placed.length = 0;
  // floor
  S.floorFar = place(el('floor seg-far'), { w: W, h: FAR_LEN, y: FLOOR, z: -D + FAR_LEN / 2, rx: 90 });
  bonesOnFloor(S.floorFar.el, 6, 1);
  S.floorNear = place(el('floor seg-near'), { w: W, h: NEAR_LEN, y: FLOOR, z: -D + FAR_LEN + NEAR_LEN / 2, rx: 90 });
  // walls
  const wh = FLOOR - WALLTOP, wy = (FLOOR + WALLTOP) / 2;
  S.wallL = place(el('stone wall seg-far'), { w: FAR_LEN, h: wh, x: -W / 2, y: wy, z: -D + FAR_LEN / 2, ry: 90 });
  S.wallR = place(el('stone wall seg-far'), { w: FAR_LEN, h: wh, x: W / 2, y: wy, z: -D + FAR_LEN / 2, ry: -90 });
  S.wallLn = place(el('stone wall seg-near'), { w: NEAR_LEN, h: wh, x: -W / 2, y: wy, z: -D + FAR_LEN + NEAR_LEN / 2, ry: 90 });
  S.wallRn = place(el('stone wall seg-near'), { w: NEAR_LEN, h: wh, x: W / 2, y: wy, z: -D + FAR_LEN + NEAR_LEN / 2, ry: -90 });
  S.wallL.el.style.setProperty('--dir', '90deg'); S.wallR.el.style.setProperty('--dir', '270deg');
  S.wallLn.el.style.setProperty('--dir', '90deg'); S.wallRn.el.style.setProperty('--dir', '270deg');
  for (const w of [S.wallL, S.wallR, S.wallLn, S.wallRn]) el('row-shadow', w.el);
  skulls(S.wallL.el, 9, 1); skulls(S.wallR.el, 9, 2); skulls(S.wallLn.el, 6, 3); skulls(S.wallRn.el, 6, 4);
  for (const o of [S.floorFar, S.floorNear, S.wallL, S.wallR, S.wallLn, S.wallRn]) el('lite', o.el);
  // vault: a segmental arch of 6 planes, chord W, rise RISE
  const R = (W * W) / (8 * RISE) + RISE / 2, cy = WALLTOP + (R - RISE);
  const half = Math.asin((W / 2) / R), n = 6, step = (2 * half) / n, chord = 2 * R * Math.sin(step / 2);
  S.vault = [];
  for (let k = 0; k < n; k++) {
    const a = -half + (k + 0.5) * step;
    const x = R * Math.sin(a), y = cy - R * Math.cos(a);
    const far = place(el('vault seg-far'), { w: chord + 2, h: FAR_LEN, x, y, z: -D + FAR_LEN / 2, rz: a * 180 / Math.PI, rx: 90 });
    const near = place(el('vault seg-near'), { w: chord + 2, h: NEAR_LEN, x, y, z: -D + FAR_LEN + NEAR_LEN / 2, rz: a * 180 / Math.PI, rx: 90 });
    el('lite', far.el); el('lite', near.el);
    S.vault.push(far, near);
  }
  // far wall around the niche
  const top = place(el('farwall arch'), { w: W, h: 260, y: -250, z: -D });
  const pts = ['0% 100%'];
  for (let i = 0; i <= 20; i++) {
    const wx = -W / 2 + (W * i) / 20, wy = cy - Math.sqrt(Math.max(0, R * R - wx * wx));
    pts.push(`${((wx + W / 2) / W * 100).toFixed(2)}% ${((wy + 380) / 260 * 100).toFixed(2)}%`);
  }
  pts.push('100% 100%');
  top.el.style.setProperty('--arch', `polygon(${pts.join(',')})`);
  top.el.style.setProperty('--lx', '50%'); top.el.style.setProperty('--ly', '110%');
  const pw = (W - NW) / 2;
  const fl = place(el('farwall'), { w: pw, h: NH, x: -(NW / 2 + pw / 2), y: 90, z: -D });
  const fr = place(el('farwall'), { w: pw, h: NH, x: (NW / 2 + pw / 2), y: 90, z: -D });
  fl.el.style.setProperty('--lx', '100%'); fr.el.style.setProperty('--lx', '0%');
  el('jamb r', fl.el); el('jamb', fr.el);
  skulls(fl.el, 3, 5); skulls(fr.el, 3, 6);
  // the niche
  S.nicheBack = place(el('niche'), { w: NW, h: NH, y: 90, z: -D - ND });
  for (const [l, t] of [['30%', '44%'], ['68%', '44%']]) { const s = el('staple', S.nicheBack.el); s.style.left = l; s.style.top = t; }
  const nl = place(el('niche side'), { w: ND, h: NH, x: -NW / 2, y: 90, z: -D - ND / 2, ry: 90 });
  const nr = place(el('niche side'), { w: ND, h: NH, x: NW / 2, y: 90, z: -D - ND / 2, ry: -90 });
  nl.el.style.setProperty('--dir', '270deg'); nr.el.style.setProperty('--dir', '90deg');
  place(el('niche top'), { w: NW, h: ND, y: -120, z: -D - ND / 2, rx: 90 });
  place(el('niche bottom'), { w: NW, h: ND, y: FLOOR, z: -D - ND / 2, rx: 90 });
  S.glow = place(el('glow'), { w: NW, h: NH, y: 90, z: -D - ND + 2 });
  // Fortunato
  S.fort = place(el('fort open'), { w: 170, h: 340, y: FLOOR - 170, z: -D - 150 });
  const fig = el('fig', S.fort.el);
  for (const c of ['legs', 'torso', 'arm l', 'arm r', 'face', 'chain-link c1', 'chain-link c2']) el(c, fig);
  const cap = el('cap', fig); el('bell b1', cap); el('bell b2', cap); el('bell b3', cap);
  // masonry: mortar bed grows tier by tier and hides him course by course
  S.mortar = place(el('mortar'), { w: NW, h: 0, y: FLOOR, z: -D - BD / 2 + 1 });
  S.plaster = place(el('plaster'), { w: NW + 4, h: NH + 4, y: 90, z: -D + BD / 2 + 2 });
  // the next slot, and the trowel
  S.ghost = place(el('ghost'), { w: 71, h: BH, y: courseY(0), z: -D + BD / 2 + 1 });
  S.ghost.core = el('core', S.ghost.el);              // the sweet zone, sized per tier
  S.trowel = place(el('trowel open'), { w: 90, h: 60, y: courseY(0) - 6, z: -D + BD / 2 + 34 });
  el('halo', S.trowel.el); el('handle', S.trowel.el); el('blade', S.trowel.el); el('mortar-blob', S.trowel.el);
  // the quantity of building stone (title foreground)
  S.pile = [];
  const px = 292, pz = -D + 1300;
  const spots = [[-40, 0, 0], [40, 0, 6], [0, 0, -3], [-20, 1, 2], [20, 1, -5], [0, 2, 4], [-48, 0, 40], [30, 0, 38], [-10, 1, 40]];
  spots.forEach(([dx, lvl, dz], i) => {
    const b = makeBrick({ x: px + dx, y: FLOOR - BH / 2 - lvl * (BH + 3), z: pz + dz, L: 71, extra: `rotateY(${dz * 0.5}deg)` });
    b.el.classList.add('pile'); b.faces.f.style.setProperty('--sm', (0.6 + (i * 37 % 7) / 10).toFixed(1));
    S.pile.push(b);
  });
  // the old rampart of bones, re-erected at the end
  S.bonepile = place(el('bonepile'), { w: 340, h: 230, y: FLOOR - 115, z: -D + BD + 40 });
  const bp = el('fig', S.bonepile.el);
  for (let i = 0; i < 16; i++) { const b = el('bone', bp); b.style.left = (2 + (i * 43) % 80) + '%'; b.style.top = (35 + (i * 57) % 60) + '%'; b.style.setProperty('--r', ((i * 67) % 60 - 30) + 'deg'); b.style.width = '5em'; }
  for (let i = 0; i < 7; i++) { const s = el('skull tilt', bp); s.style.left = (6 + (i * 14)) + '%'; s.style.top = (18 + (i % 3) * 22) + '%'; s.style.setProperty('--r', ((i * 41) % 40 - 20) + 'deg'); }
}

/* a brick: a preserve-3d box with three faces (front, top, inner side) */
function makeBrick(o) {
  const b = el('brick instant');
  const side = o.x < -1 ? 'r' : 'l';
  const p = place(b, { w: 0, h: 0, x: o.x, y: o.y, z: o.z, extra: o.extra || '' });
  p.L = o.L; p.side = side;
  const f = el('f front', b), t = el('f top', b), s = el('f side', b);
  p.faces = { f, t, s };
  sizeBrick(p);
  return p;
}
function sizeBrick(p) {
  const L = p.L * U, H = BH * U, Dp = BD * U, { f, t, s } = p.faces;
  f.style.cssText = `width:${L}px;height:${H}px;left:${-L / 2}px;top:${-H / 2}px;transform:translateZ(${Dp / 2}px)`;
  t.style.cssText = `width:${L}px;height:${Dp}px;left:${-L / 2}px;top:${-Dp / 2}px;transform:translateY(${-H / 2}px) rotateX(90deg)`;
  const sx = p.side === 'r' ? L / 2 : -L / 2, ry = p.side === 'r' ? 90 : -90;
  s.style.cssText = `width:${Dp}px;height:${H}px;left:${-Dp / 2}px;top:${-H / 2}px;transform:translateX(${sx}px) rotateY(${ry}deg)`;
}

function layout() {
  PORTRAIT = innerHeight > innerWidth && innerWidth < 700;
  U = PORTRAIT ? innerWidth / 520 : Math.min(innerHeight / 640, innerWidth / 900);
  document.documentElement.style.setProperty('--u', U.toFixed(4));
  world.style.fontSize = (U * 10) + 'px';
  for (const o of placed) { applyOne(o); if (o.faces) sizeBrick(o); }
  camApply();
}
addEventListener('resize', layout, { passive: true });
addEventListener('orientationchange', layout, { passive: true });

/* ----------------------------------------------------------------- camera */
const cam = { x: 0, y: 150, z: -D + 1500, tx: 0, ty: 150, tz: -D + 1500, ease: 0.06 };
let shake = 0, shakeT = 0;
function camApply() { camera.style.transform = `translate3d(${(-cam.x * U).toFixed(2)}px,${(-cam.y * U).toFixed(2)}px,${(-cam.z * U).toFixed(2)}px)`; }
function titleCam() { cam.tx = 0; cam.ty = 150; cam.tz = -D + (PORTRAIT ? 1100 : 1500); }
function playCam(tier) {
  const dist = (PORTRAIT ? 300 : 430) + tier * (PORTRAIT ? 8 : 13);
  cam.tx = 0; cam.ty = courseY(tier) - (PORTRAIT ? 120 : 70); cam.tz = -D + dist;
}
function nearVisible(v) {
  for (const o of [S.floorNear, S.wallLn, S.wallRn, ...S.vault.filter((_, i) => i % 2 === 1), ...S.pile]) o.el.style.visibility = v ? '' : 'hidden';
}

/* ---------------------------------------------------------------- lantern */
const light = $('#light'), warm = $('#warm');
function noise1(t) { return 0.5 + 0.22 * Math.sin(t * 6.1) + 0.14 * Math.sin(t * 11.3 + 1.7) + 0.09 * Math.sin(t * 19.7 + 0.4) + 0.05 * Math.sin(t * 31.1 + 2.2); }
function lantern(t, torchFrac, lx, ly) {
  let n = noise1(t);
  if (RM) n = 0.5 + (n - 0.5) * 0.3;
  const dying = torchFrac < 0.22 ? (0.22 - torchFrac) / 0.22 : 0;
  if (dying) n = n * (1 - dying * 0.6) + dying * 0.55 * Math.abs(Math.sin(t * 23));
  const pool = (0.62 + 0.38 * Math.min(1, torchFrac * 1.6)) * (0.88 + 0.22 * n);
  light.style.transform = `translate(${lx.toFixed(1)}px,${ly.toFixed(1)}px) scale(${pool.toFixed(3)})`;
  warm.style.opacity = (0.45 + 0.55 * n) * (0.4 + 0.6 * Math.min(1, torchFrac * 2));
  S.glow.el.style.opacity = ((0.72 + 0.45 * n) * 0.9).toFixed(3);
}

/* ------------------------------------------------------------------ audio */
const audio = createAudio();
let sfx = null, bed = null, noiseBuf = null, silenced = false;
function ctx() { const c = audio.ctx; if (!c) return null; if (!sfx) { sfx = c.createGain(); sfx.gain.value = 0.9; sfx.connect(audio.master); } return c; }
function nbuf(c) {
  if (noiseBuf) return noiseBuf;
  const b = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}
function noiseHit(c, { t0, dur, type = 'bandpass', f0, f1, q = 1, g = 0.2, attack = 0.005 }) {
  const src = c.createBufferSource(); src.buffer = nbuf(c); src.loop = true;
  const flt = c.createBiquadFilter(); flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t0); if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t0); gn.gain.linearRampToValueAtTime(g, t0 + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(gn).connect(sfx); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}
function tone(c, { t0, dur, type = 'sine', f0, f1, g = 0.1, attack = 0.004, vib }) {
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t0); gn.gain.linearRampToValueAtTime(g, t0 + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (vib) { const l = c.createOscillator(); l.frequency.value = vib[0]; const lg = c.createGain(); lg.gain.value = vib[1]; l.connect(lg).connect(o.frequency); l.start(t0); l.stop(t0 + dur + 0.05); }
  o.connect(gn).connect(sfx); o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}
const SFX = {
  thud(k = 1) { const c = ctx(); if (!c || silenced) return; const t = c.currentTime;
    noiseHit(c, { t0: t, dur: 0.22 * k, type: 'lowpass', f0: 220, f1: 80, q: 1.2, g: 0.9 * k });
    tone(c, { t0: t, dur: 0.09, f0: 130, f1: 38, g: 0.55 * k });
    noiseHit(c, { t0: t, dur: 0.03, type: 'highpass', f0: 2500, g: 0.15 }); },
  scrape() { const c = ctx(); if (!c || silenced) return; const t = c.currentTime;
    noiseHit(c, { t0: t, dur: 0.17, f0: 1800, f1: 3200, q: 2.5, g: 0.09, attack: 0.05 }); },
  bells(n = 5, v = 1) { const c = ctx(); if (!c || silenced) return; let t = c.currentTime;
    for (let i = 0; i < n; i++) { const f = rand(2300, 4800);
      tone(c, { t0: t, dur: 0.28, f0: f, g: 0.09 * v }); tone(c, { t0: t, dur: 0.16, f0: f * 2.76, g: 0.03 * v });
      t += rand(0.045, 0.11); } },
  laugh() { const c = ctx(); if (!c || silenced) return; let t = c.currentTime;
    for (let i = 0; i < 4; i++) { noiseHit(c, { t0: t, dur: 0.11, f0: 620 + i * 30, f1: 520, q: 7, g: 0.32, attack: 0.012 }); tone(c, { t0: t, dur: 0.1, type: 'triangle', f0: 190 - i * 8, f1: 150, g: 0.05 }); t += 0.15; }
    t += 0.12;
    for (let i = 0; i < 5; i++) { noiseHit(c, { t0: t, dur: 0.08, f0: 1050 + i * 40, f1: 900, q: 8, g: 0.26, attack: 0.008 }); tone(c, { t0: t, dur: 0.07, type: 'triangle', f0: 260, f1: 230, g: 0.04 }); t += 0.115; } },
  chain(dur = 0.9) { const c = ctx(); if (!c || silenced) return; const t = c.currentTime; const n = Math.round(dur * 13);
    for (let i = 0; i < n; i++) { const t0 = t + (i / n) * dur + rand(0, 0.03);
      noiseHit(c, { t0, dur: 0.05, type: 'highpass', f0: 3000, g: 0.14 }); tone(c, { t0, dur: 0.07, f0: rand(1400, 3600), g: 0.06 }); } },
  moan() { const c = ctx(); if (!c || silenced) return; const t = c.currentTime;
    tone(c, { t0: t, dur: 1.5, f0: 135, f1: 92, g: 0.16, attack: 0.35, vib: [5.5, 7] }); tone(c, { t0: t, dur: 1.4, f0: 270, f1: 184, g: 0.05, attack: 0.4, vib: [5.5, 10] }); },
  scream() { const c = ctx(); if (!c || silenced) return; const t = c.currentTime;
    const o = tone(c, { t0: t, dur: 0.6, type: 'sawtooth', f0: 900, f1: 1300, g: 0.11, attack: 0.02, vib: [11, 60] });
    noiseHit(c, { t0: t, dur: 0.6, f0: 2400, f1: 1800, q: 1.5, g: 0.06, attack: 0.03 }); o.frequency.exponentialRampToValueAtTime(700, t + 0.6); },
  crackle() { const c = ctx(); if (!c || silenced) return; noiseHit(c, { t0: c.currentTime, dur: 0.02, f0: rand(1500, 5500), q: 3, g: rand(0.02, 0.06) }); },
  force(i) { const c = ctx(); if (!c || silenced) return; const t = c.currentTime;
    noiseHit(c, { t0: t, dur: 0.3, type: 'lowpass', f0: 160, f1: 60, q: 1.5, g: 1.1 }); tone(c, { t0: t, dur: 0.12, f0: 90 - i * 6, f1: 30, g: 0.6 });
    noiseHit(c, { t0: t + 0.02, dur: 0.2, f0: 900, f1: 400, q: 3, g: 0.12 }); },
  bedOn() { const c = ctx(); if (!c || bed) return; const src = c.createBufferSource(); src.buffer = nbuf(c); src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; const g = c.createGain(); g.gain.value = 0.045;
    src.connect(f).connect(g).connect(sfx); src.start(); bed = { src, g }; },
  bedOff() { if (!bed) return; try { bed.g.gain.setTargetAtTime(0, ctx().currentTime, 0.1); bed.src.stop(ctx().currentTime + 0.5); } catch { } bed = null; },
  silence(on) { silenced = on; if (sfx) sfx.gain.setTargetAtTime(on ? 0 : 0.9, ctx().currentTime, 0.03); },
};

/* ------------------------------------------------------------------- text */
const voiceEl = $('#voice'), narrEl = $('#narr');
const chan = { f: { el: voiceEl, until: 0, q: [] }, m: { el: narrEl, until: 0, q: [] } };
function say(who, html, dur = 3.2, cls = '') { chan[who].q.push({ html, dur, cls }); }
function sayNow(who, html, dur = 3.2, cls = '') { chan[who].q.length = 0; chan[who].until = 0; say(who, html, dur, cls); }
function tickText(now) {
  for (const k in chan) {
    const c = chan[k];
    if (now >= c.until && c.el.classList.contains('on')) { c.el.classList.remove('on', 'scream'); c.until = now + 0.5; }
    if (now >= c.until && c.q.length) { const n = c.q.shift(); c.el.innerHTML = n.html; c.el.className = 'on ' + n.cls; c.until = now + n.dur; }
  }
}
function clearText() { for (const k in chan) { chan[k].q.length = 0; chan[k].until = 0; chan[k].el.className = ''; } }

/* ------------------------------------------------------------------- game */
const hud = $('#hud'), title = $('#title'), end = $('#end');
const fort = () => S.fort.el;
let best = loadState('amontillado:best', { score: 0, tier: 0, won: false });
function showBest() { $('#best').textContent = best.score > 0 ? `best ${best.score} · tier ${ROMAN[Math.min(10, Math.max(0, best.tier - 1))]}${best.won ? ' · walled' : ''}` : 'no mortal has yet finished the wall'; }

const G = {
  state: 'title', t: 0, tier: 0, slot: 0, course: [], bricks: [], laid: 0,
  score: 0, streak: 0, bestStreak: 0, perfects: 0, collapses: 0, crookedInCourse: 0,
  torch: 105, torchMax: 105, torchPaused: false,
  p: 0.2, dir: 1, speed: 0.6, disp: 0.2, hw: 0.13, c: 0.5,
  held: false, pressT: 0, pressPos: 0, listening: false,
  jitterT: 0, jitterD: 1, reverseT: 0, boostT: 0, darkT: 0, cueT: 0, pendingEvt: null, nextEvt: 0, lastEvt: '',
  phase: 'lay', forceN: 0, cine: false, lastStone: null,
};
window.__poe = { G, cam, S };

function slotsFor(i) {
  if (i % 2 === 0) return [-112.5, -37.5, 37.5, 112.5].map((x) => ({ x, L: 71 }));
  return [-131.25, -75, 0, 75, 131.25].map((x, k) => ({ x, L: (k === 0 || k === 4) ? 33.5 : 71 })).reverse();
}
function difficulty(i) { const t = i / 10; return { traverse: lerp(1.7, 0.86, t), hw: lerp(0.13, 0.068, t), interval: lerp(5.5, 2.5, t) }; }

function startGame() {
  G.state = 'play'; G.t = 0; G.tier = 0; G.slot = 0; G.laid = 0; G.score = 0; G.streak = 0; G.bestStreak = 0; G.perfects = 0;
  G.collapses = 0; G.crookedInCourse = 0; G.torch = G.torchMax; G.torchPaused = false; G.held = false; G.listening = false;
  G.jitterT = G.reverseT = G.boostT = G.darkT = G.cueT = 0; G.pendingEvt = null; G.phase = 'lay'; G.forceN = 0; G.cine = false; G.lastStone = null;
  for (const b of G.bricks) unplace(b); G.bricks = [];
  S.mortar.h = 0; S.mortar.y = FLOOR; applyOne(S.mortar);
  S.plaster.el.classList.remove('on'); S.bonepile.el.classList.remove('on');
  fort().className = 'p fort open'; S.fort.el.style.visibility = '';
  S.ghost.el.style.visibility = ''; S.trowel.el.style.visibility = '';
  stage.classList.remove('out'); $('#flash').className = '';
  end.hidden = true; end.className = ''; title.classList.add('gone'); hud.hidden = false; $('#mute').hidden = false;
  $('#force').hidden = true; $('#bar-hint').classList.remove('gone');
  for (const l of document.querySelectorAll('#chain .lk')) l.classList.remove('broken');
  clearText();
  SFX.silence(false); SFX.bedOn();
  cam.ease = 0.045;
  setTier(0);
  updateHud();
}
function setTier(i) {
  G.tier = i; G.slot = 0; G.course = slotsFor(i); G.crookedInCourse = 0;
  const d = difficulty(i); G.speed = 1 / d.traverse; G.hw = d.hw;
  G.nextEvt = G.t + (i >= 2 ? Math.min(d.interval, 3.2) : 1e9);
  playCam(i);
  const y = courseY(i);
  S.ghost.y = y; S.trowel.y = y - 6; applyOne(S.trowel);
  setSlot();
  $('#tier-n').textContent = ROMAN[i];
  tierScript(i);
}
function setSlot() {
  const s = G.course[G.slot];
  if (!s) return;
  G.c = (s.x + 150) / 300;
  S.ghost.x = s.x; S.ghost.w = s.L; applyOne(S.ghost);
  S.ghost.core.style.width = Math.min(100, (G.hw * 2 * 300) / s.L * 100).toFixed(1) + '%';
}
function tierScript(i) {
  const f = fort();
  if (i === 1) say('m', 'There was then a long and obstinate silence.', 3.4);
  if (i === 2) say('m', 'I laid the second tier, and the third, and the fourth …', 3.2);
  if (i === 3) { say('m', '… and then I heard the furious vibrations of the chain.', 3.6); startEffect('chain'); }
  if (i === 4) say('m', 'When at last the clanking subsided, I resumed the trowel.', 3.2);
  if (i === 6) say('m', 'The wall was now nearly upon a level with my breast.', 3.2);
  if (i === 7) { say('m', 'A succession of loud and shrill screams, bursting suddenly from the throat of the chained form …', 4.2); startEffect('scream'); }
  if (i === 8) say('m', 'I re-echoed, I aided, I surpassed them in volume and in strength. The clamourer grew still.', 4.2);
  if (i === 9) say('m', 'It was now midnight, and my task was drawing to a close.', 3.4);
  if (i === 10) { SFX.laugh(); f.classList.add('laugh'); setTimeout(() => f.classList.remove('laugh'), 1300);
    say('m', 'There came from out the niche a low laugh that erected the hairs upon my head.', 3.6);
    say('f', 'Ha! ha! ha!—he! he! he!—a very good joke, indeed—an excellent jest.', 3.8); }
}

/* ---- interference */
const EFFECTS = {
  bells: { from: 2, cue: 'the bells stir …' },
  scream: { from: 7, cue: 'a breath drawn in the dark …' },
  laugh: { from: 8, cue: 'a low laugh …' },
  quiet: { from: 9, cue: '… nothing.' },
};
function scheduleEvent() {
  const avail = Object.keys(EFFECTS).filter((k) => G.tier >= EFFECTS[k].from && k !== G.lastEvt);
  if (!avail.length) return;
  const k = avail[Math.floor(Math.random() * avail.length)];
  G.lastEvt = k; G.pendingEvt = k; G.cueT = 0.4;
  const cue = $('#cue'); cue.textContent = EFFECTS[k].cue; cue.classList.add('on');
  if (k === 'bells') SFX.bells(2, 0.5);
  if (k === 'scream') SFX.chain(0.25);
  if (k === 'laugh') SFX.laugh();
  if (k === 'quiet') SFX.chain(0.15);
}
function startEffect(k) {
  const f = fort();
  if (k === 'bells') { SFX.bells(6, 1); G.jitterT = G.jitterD = 1.3; doShake(0.5, 0.55); }
  if (k === 'chain') { SFX.chain(2.4); f.classList.add('rattle'); setTimeout(() => f.classList.remove('rattle'), 2500); G.jitterT = G.jitterD = 2.4; doShake(2.4, 0.4); }
  if (k === 'scream') { SFX.scream(); f.classList.add('scream'); voiceEl.classList.add('scream'); setTimeout(() => { f.classList.remove('scream'); voiceEl.classList.remove('scream'); }, 700); G.reverseT = 0.7; flash('hit'); doShake(0.3, 0.35); }
  if (k === 'laugh') { f.classList.add('laugh'); setTimeout(() => f.classList.remove('laugh'), 1300); G.boostT = 1.25; }
  if (k === 'quiet') { f.classList.add('still'); setTimeout(() => f.classList.remove('still'), 2300); G.darkT = 2.0; }
}
function doShake(dur, amp) { if (RM) return; shake = Math.max(shake, amp); shakeT = Math.max(shakeT, dur); }
function flash(cls) { const f = $('#flash'); f.className = cls; if (cls === 'hit') setTimeout(() => { f.className = ''; }, 60); }

/* ---- laying */
function lay(pos) {
  const s = G.course[G.slot]; if (!s) return;
  const e = Math.abs(pos - G.c);
  let kind = e <= G.hw * 0.4 ? 'true' : e <= G.hw ? 'perfect' : 'crooked';
  if (G.forcePerfect) kind = 'true';
  const y = courseY(G.tier), hero = G.tier === 10 && G.slot === 3;
  const brick = makeBrick({ x: s.x, y: y - 160, z: -D + 110, L: s.L, extra: 'rotateX(-28deg)' });
  brick.kind = kind; brick.slotX = s.x;
  G.bricks.push(brick);
  void brick.el.offsetWidth;
  brick.el.classList.remove('instant');
  brick.y = y; brick.z = -D;
  if (kind === 'crooked') {
    const t = clamp(e / 0.18, 0.4, 1), sg = Math.random() < 0.5 ? -1 : 1;
    brick.extra = `rotateZ(${(sg * t * 9).toFixed(1)}deg) rotateY(${(-sg * t * 6).toFixed(1)}deg) translateZ(${(t * 5).toFixed(1)}px)`;
    brick.y = y - t * 4; brick.el.classList.add('crooked');
  } else brick.extra = '';
  if (hero) brick.el.classList.add('hero');
  applyOne(brick);
  SFX.scrape();
  setTimeout(() => { SFX.thud(kind === 'crooked' ? 0.7 : 1); dust(s.x, y + BH / 2, kind === 'crooked' ? 4 : 8); doShake(0.12, kind === 'crooked' ? 0.12 : 0.22); }, 200);
  // score
  let pts = 0, label = '';
  if (kind === 'true') { G.streak++; pts = Math.round(150 * (1 + Math.min(G.streak, 10) * 0.1)); label = `true · +${pts}`; G.perfects++; }
  else if (kind === 'perfect') { G.streak++; pts = Math.round(100 * (1 + Math.min(G.streak, 10) * 0.1)); label = `perfect · +${pts}`; G.perfects++; }
  else { G.streak = 0; pts = 20; label = 'crooked · +20'; G.crookedInCourse++; }
  G.bestStreak = Math.max(G.bestStreak, G.streak);
  G.score += pts; G.laid++;
  pop(label, kind, s.x);
  if (kind !== 'crooked') { const t = S.trowel.el; t.classList.remove('hit'); void t.offsetWidth; t.classList.add('hit'); }
  if (G.laid === 1) { setTimeout(() => { SFX.moan(); say('m', '… a low moaning cry from the depth of the recess. It was not the cry of a drunken man.', 4); }, 900); }
  if (G.laid === 3) $('#bar-hint').classList.add('gone');
  if (G.crookedInCourse >= 3) { setTimeout(collapse, 420); updateHud(); return; }
  G.slot++;
  if (G.tier === 10) lastTierScript(G.slot);
  if (G.slot >= G.course.length) courseDone(); else setSlot();
  updateHud();
}
function courseDone() {
  S.mortar.h = TH * (G.tier + 1); S.mortar.y = FLOOR - S.mortar.h / 2; applyOne(S.mortar);
  if (G.tier + 1 >= TIERS) return;
  setTier(G.tier + 1);
}
function collapse() {
  G.collapses++;
  pop('the course collapses', 'collapse', 0); SFX.thud(1.3); setTimeout(() => SFX.thud(0.9), 120); setTimeout(() => SFX.thud(0.6), 260); doShake(0.5, 0.7);
  const fall = G.bricks.filter((b) => Math.abs(b.y - courseY(G.tier)) < TH || Math.abs(b.y - (courseY(G.tier) - 4)) < TH);
  for (const b of fall) {
    const i = G.bricks.indexOf(b); if (i >= 0) G.bricks.splice(i, 1);
    b.el.classList.add('fall');
    b.x += rand(-90, 90); b.y += rand(220, 300); b.z += rand(70, 180);
    b.extra = `rotateX(${rand(-120, 120).toFixed(0)}deg) rotateZ(${rand(-90, 90).toFixed(0)}deg)`;
    applyOne(b); setTimeout(() => unplace(b), 1150);
  }
  const links = document.querySelectorAll('#chain .lk');
  for (let i = 0; i < G.collapses && i < 3; i++) links[2 - i].classList.add('broken');
  SFX.chain(0.6); fort().classList.add('rattle'); setTimeout(() => fort().classList.remove('rattle'), 700);
  if (G.collapses >= 3) { lose('free'); return; }
  G.slot = 0; G.crookedInCourse = 0;
  say('m', G.collapses === 1 ? 'The stones would not sit. I began the tier again.' : 'Again the course gave. The chain strained at its staple.', 3);
  setSlot(); updateHud();
}
function dust(x, y, n) {
  const d = place(el('dust open'), { w: 20, h: 10, x, y, z: -D + BD / 2 + 4 });
  for (let i = 0; i < n; i++) { const s = document.createElement('i'); s.style.setProperty('--dx', rand(-3.5, 3.5).toFixed(2) + 'em'); s.style.setProperty('--dy', rand(-2.5, 0.6).toFixed(2) + 'em'); d.el.appendChild(s); }
  setTimeout(() => unplace(d), 700);
}
/* the grade sits on the brick: remember the world point, frame() projects it to the screen while it shows */
function pop(text, cls, x) {
  G.popX = x || 0; G.popY = courseY(G.tier) - 44; G.popUntil = G.t + 1.1;
  const p = $('#pop'); p.textContent = text; p.className = ''; void p.offsetWidth; p.className = 'go ' + cls;
  popPlace();
}
function project(x, y, z) {               // world → screen, mirroring #stage's perspective and #camera's translate
  const P = 1000, Z = z - cam.z, k = P / (P - Z);
  return [innerWidth / 2 + (x - cam.x) * U * k, innerHeight / 2 + (y - cam.y) * U * k];
}
function popPlace() {
  const [sx, sy] = project(G.popX, G.popY, -D + BD / 2);
  const p = $('#pop'); p.style.left = sx.toFixed(1) + 'px'; p.style.top = sy.toFixed(1) + 'px';
}

/* ---- the eleventh tier */
function lastTierScript(k) {
  if (k === 1) say('f', 'We will have many a rich laugh about it at the palazzo—he! he! he!—over our wine—he! he! he!', 4);
  if (k === 2) { say('m', '<q>The Amontillado!</q> I said.', 2.6); say('f', 'He! he! he!—he! he! he!—yes, the Amontillado. But is it not getting late? Let us be gone.', 4.2); }
  if (k === 3) {
    G.cine = true; G.torchPaused = true; G.phase = 'cine';
    S.ghost.el.style.visibility = 'hidden'; S.trowel.el.style.visibility = 'hidden';
    clearText();
    say('m', '<q>Yes,</q> I said, <q>let us be gone.</q>', 2.4);
    setTimeout(() => { sayNow('f', 'For the love of God, Montresor!', 3.2, 'scream'); SFX.scream(); fort().classList.add('scream'); setTimeout(() => fort().classList.remove('scream'), 900); }, 1600);
    setTimeout(() => sayNow('m', '<q>Yes,</q> I said, <q>for the love of God!</q>', 2.8), 3600);
    setTimeout(() => { sayNow('m', 'But to these words I hearkened in vain for a reply. I called aloud— <q>Fortunato!</q>', 3.2); fort().classList.add('still'); }, 6400);
    setTimeout(() => { sayNow('m', 'No answer. There came forth in return only a jingling of the bells.', 3.2); SFX.bells(4, 0.7); }, 9200);
    setTimeout(beginForce, 11800);
  }
}
function beginForce() {
  if (G.state !== 'play') return;
  G.torchPaused = false; G.phase = 'force'; G.forceN = 0;
  const s = G.course[3], y = courseY(10);
  const b = makeBrick({ x: s.x, y, z: -D + 80, L: s.L });
  b.el.classList.add('hero'); G.lastStone = b; G.bricks.push(b);
  void b.el.offsetWidth; b.el.classList.remove('instant');
  $('#force').hidden = false;
  sayNow('m', 'I struggled with its weight; I placed it partially in its destined position.', 3);
}
function forceStep() {
  const b = G.lastStone; if (!b) return;
  G.forceN++;
  const k = G.forceN / 6;
  b.z = -D + 80 * (1 - k); applyOne(b);
  SFX.force(G.forceN); doShake(0.15, 0.3 + k * 0.4); flash('hit');
  if (G.forceN >= 6) win();
}

/* ---- ends */
function finishStats(won) {
  const bonus = won ? Math.round(G.torch * 10) : 0;
  G.score += bonus;
  const isNew = G.score > best.score;
  if (isNew || (won && !best.won)) { best = { score: Math.max(G.score, best.score), tier: Math.max(G.tier + 1, best.tier || 0), won: won || best.won }; saveState('amontillado:best', best); }
  return { bonus, isNew };
}
function showEnd(kind, h, q, who, stats) {
  $('#end-over').textContent = kind === 'win' ? 'The Cask of Amontillado · the last stone' : 'The Cask of Amontillado · the deed half done';
  $('#end-h').textContent = h;
  const qe = $('#end-q'); qe.innerHTML = q; qe.className = 'quote' + (who === 'm' ? ' m' : '');
  $('#end-who').textContent = who === 'm' ? '— Montresor' : '— Fortunato, from the dark';
  $('#end-tally').innerHTML = `<div><b class="${stats.isNew ? 'new' : ''}">${G.score}</b><span>${stats.isNew ? 'new best' : 'score'}</span></div>` +
    `<div><b>${ROMAN[G.tier]}</b><span>tier</span></div><div><b>${G.bestStreak}</b><span>best streak</span></div>` +
    (stats.bonus ? `<div><b>+${stats.bonus}</b><span>torch to spare</span></div>` : `<div><b>${best.score}</b><span>best</span></div>`);
  $('#end-press').textContent = kind === 'win' ? 'wall him again' : 'lay it again';
  end.hidden = false; end.className = kind === 'torch' ? 'dark' : kind === 'free' ? 'red' : '';
  requestAnimationFrame(() => requestAnimationFrame(() => end.classList.add('on')));
  G.endAt = performance.now();
}
function lose(kind) {
  if (G.state !== 'play') return;
  G.state = 'lose'; G.held = false; G.listening = false; $('#listen').classList.remove('on'); $('#force').hidden = true;
  hud.hidden = true; clearText(); SFX.bedOff();
  const stats = finishStats(false);
  if (kind === 'torch') {
    stage.classList.add('out'); light.style.opacity = '0'; warm.style.opacity = '0';
    setTimeout(() => SFX.bells(7, 0.8), 1500); setTimeout(() => SFX.bells(4, 0.5), 2600);
    setTimeout(() => showEnd('torch', 'The torch is out.', 'For the love of God, Montresor!', 'f', stats), 1900);
  } else {
    flash('red'); SFX.chain(2.2); fort().classList.add('rattle'); doShake(2, 0.9);
    setTimeout(() => showEnd('free', 'The chain gives.', '<q>Yes,</q> I said, <q>for the love of God!</q>', 'm', stats), 1400);
  }
}
function win() {
  if (G.state !== 'play') return;
  G.state = 'win'; G.phase = 'done'; $('#force').hidden = true; hud.hidden = true; clearText();
  SFX.silence(true); SFX.bedOff();
  setTimeout(() => {
    SFX.silence(false);
    S.plaster.el.classList.add('on'); S.fort.el.style.visibility = 'hidden';
    cam.ease = 0.012; cam.tz = -D + (PORTRAIT ? 1300 : 1700); cam.ty = 120; cam.tx = 0; nearVisible(true);
    S.bonepile.el.classList.add('on'); SFX.thud(0.8); setTimeout(() => SFX.thud(0.5), 700); setTimeout(() => SFX.thud(0.4), 1500);
    say('m', 'I plastered it up. Against the new masonry I re-erected the old rampart of bones.', 4.4);
    const stats = finishStats(true);
    setTimeout(() => showEnd('win', 'In pace requiescat!', 'For the half of a century no mortal has disturbed them. <em>In pace requiescat!</em>', 'm', stats), 5200);
  }, 1500);
}

/* ------------------------------------------------------------------ input */
function press(e) {
  if (G.state === 'title') { startGame(); return; }
  if (G.state === 'win' || G.state === 'lose') { if (performance.now() - (G.endAt || 0) > 1200 && !end.hidden) { end.classList.remove('on'); setTimeout(startGame, 200); } return; }
  if (G.state !== 'play') return;
  if (G.phase === 'force') { forceStep(); return; }
  if (G.phase !== 'lay' || G.held) return;
  G.held = true; G.pressT = G.t; G.pressPos = G.disp; S.trowel.el.classList.add('frozen');
}
function release() {
  if (G.state !== 'play' || !G.held) return;
  G.held = false; S.trowel.el.classList.remove('frozen');
  const dt = G.t - G.pressT;
  if (G.listening) { G.listening = false; $('#listen').classList.remove('on'); return; }
  if (dt < 0.26 && G.phase === 'lay') lay(G.pressPos);
}
addEventListener('pointerdown', (e) => { if (e.target && e.target.closest && e.target.closest('.poe-back, #mute')) return; press(e); }, { passive: true });
addEventListener('pointerup', release, { passive: true });
addEventListener('pointercancel', release, { passive: true });
addEventListener('blur', () => { if (G.held) release(); });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); press(e); }
  if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') release(); });
function toggleMute() { const m = $('#mute'); const off = !m.classList.contains('off'); m.classList.toggle('off', off); audio.setMuted(off); }
$('#mute').addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });

/* -------------------------------------------------------------------- HUD */
function updateHud() {
  $('#score-n').textContent = G.score;
  const sn = $('#streak-n'); sn.textContent = G.streak; sn.classList.toggle('hot', G.streak >= 3);
}

/* ------------------------------------------------------------------- loop */
let last = performance.now(), crackleAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  G.t += dt;

  // camera
  if (G.state === 'title') { titleCam(); cam.tx = 12 * Math.sin(t * 0.23); cam.ty += 5 * Math.sin(t * 0.37); }
  const ez = RM ? 1 : 1 - Math.pow(1 - cam.ease, dt * 60);
  cam.x += (cam.tx - cam.x) * ez; cam.y += (cam.ty - cam.y) * ez; cam.z += (cam.tz - cam.z) * ez;
  camApply();
  const showNear = cam.z > -D + FAR_LEN - 80;
  if (showNear !== G.nearShown) { G.nearShown = showNear; nearVisible(showNear); }

  // shake
  if (shakeT > 0) { shakeT -= dt; const a = shake * Math.min(1, shakeT * 4) * 8 * U; stage.style.transform = `translate(${(Math.sin(t * 91) * a).toFixed(1)}px,${(Math.cos(t * 73) * a).toFixed(1)}px)`; }
  else if (stage.style.transform) { stage.style.transform = ''; shake = 0; }

  // lantern
  const frac = G.state === 'play' ? G.torch / G.torchMax : 1;
  const lx = G.state === 'title' ? 0 : (G.disp - 0.5) * 60 * U, ly = G.state === 'title' ? 60 * U : 30 * U;
  lantern(t, frac, lx, ly);

  tickText(G.t);

  if (G.state !== 'play') return;
  if (G.t < (G.popUntil || 0)) popPlace();

  // torch
  if (!G.torchPaused) {
    G.torch -= dt * (G.listening ? 3 : 1) * (G.phase === 'force' ? 2 : 1);
    if (G.torch <= 0) { G.torch = 0; lose('torch'); return; }
  }
  $('#torch-fill').style.transform = `scaleX(${(G.torch / G.torchMax).toFixed(4)})`;
  $('#torch-flame').style.left = (100 * G.torch / G.torchMax) + '%';
  $('#torch').classList.toggle('low', G.torch < 22);
  crackleAcc += dt; if (crackleAcc > 0.12 && Math.random() < 0.35) { crackleAcc = 0; SFX.crackle(); }

  if (G.phase !== 'lay') return;

  // listening
  if (G.held && !G.listening && G.t - G.pressT >= 0.26) { G.listening = true; $('#listen').classList.add('on'); SFX.scrape(); }
  const decay = G.listening ? 3.2 : 1;

  // interference timers
  if (G.jitterT > 0) G.jitterT -= dt * decay;
  if (G.reverseT > 0) G.reverseT -= dt * decay;
  if (G.boostT > 0) G.boostT -= dt * decay;
  if (G.darkT > 0) G.darkT -= dt * decay;
  if (G.pendingEvt) { G.cueT -= dt; if (G.cueT <= 0) { startEffect(G.pendingEvt); G.pendingEvt = null; $('#cue').classList.remove('on'); } }
  else if (G.t >= G.nextEvt && !G.listening) { scheduleEvent(); G.nextEvt = G.t + difficulty(G.tier).interval + rand(-0.4, 0.5); }

  // marker
  if (!G.held) {
    const sp = G.speed * (G.boostT > 0 ? 2 : 1), d = G.dir * (G.reverseT > 0 ? -1 : 1);
    G.p += d * sp * dt;
    if (G.p > 1) { G.p = 2 - G.p; G.dir = -G.dir; }
    if (G.p < 0) { G.p = -G.p; G.dir = -G.dir; }
  }
  const j = G.jitterT > 0 ? 0.035 * (Math.sin(t * 37) + 0.5 * Math.sin(t * 61)) * Math.min(1, G.jitterT / G.jitterD * 2) : 0;
  G.disp = clamp(G.p + j, 0, 1);
  // the trowel is the marker: it rides the course, fades in the quiet, and its head lights inside the sweet zone
  const hot = Math.abs(G.disp - G.c) <= G.hw, tr = S.trowel.el;
  S.ghost.el.classList.toggle('hot', hot);
  tr.classList.toggle('hot', hot);
  tr.classList.toggle('dark', G.darkT > 0 && !G.held);
  S.trowel.x = -150 + 300 * G.disp; S.trowel.extra = `rotateZ(${(G.dir * 8).toFixed(0)}deg)`; tr.style.transform = tf(S.trowel);
}

/* ---------------------------------------------------------------- debug */
Object.assign(window.__poe, {
  start: () => { if (G.state === 'title') startGame(); },
  lay: (perfect = true) => { if (G.state !== 'play' || G.phase !== 'lay') return; G.forcePerfect = !!perfect; lay(perfect ? G.c : (G.c + 0.5) % 1); G.forcePerfect = false; },
  force: () => forceStep(),
  skipTo: (tier) => { if (G.state !== 'play') return; for (let i = G.tier; i < tier; i++) { S.mortar.h = TH * (i + 1); S.mortar.y = FLOOR - S.mortar.h / 2; applyOne(S.mortar); setTier(i + 1); } clearText(); },
  setTorch: (s) => { G.torch = s; },
  lose, win,
  info: () => ({ state: G.state, phase: G.phase, tier: G.tier, slot: G.slot, p: G.disp, c: G.c, hw: G.hw, dir: G.dir, score: G.score, torch: G.torch, collapses: G.collapses, held: G.held }),
});

/* ------------------------------------------------------------------ boot */
buildWorld();
layout();
titleCam(); cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; camApply();
G.nearShown = true;
S.ghost.el.style.visibility = 'hidden'; S.trowel.el.style.visibility = 'hidden';
showBest();
requestAnimationFrame(frame);
