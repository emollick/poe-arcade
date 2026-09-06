/* PLUTO — The Black Cat.
 * The plaster / damp / crack simulation runs in Rust (sim.wasm). This file only
 * loads the module, feeds it input and the lantern, blits its RGBA buffer,
 * runs the officers' inspection, the score, the HUD and the synthesized sound. */
import { mountBack, fitCanvas, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';

mountBack();

const $ = (id) => document.getElementById(id);
const canvas = $('wall');
const ctx = canvas.getContext('2d', { alpha: false });
const reduced = prefersReducedMotion();
const BEST_KEY = 'black-cat:best';

// ---------------------------------------------------------------- wasm glue
async function loadSim() {
  const url = new URL('sim.wasm', import.meta.url);
  let result;
  try {
    result = await WebAssembly.instantiateStreaming(fetch(url), {});
  } catch {
    const buf = await (await fetch(url)).arrayBuffer();
    result = await WebAssembly.instantiate(buf, {});
  }
  return result.instance.exports;
}
const sim = await loadSim();

const grid = { w: 0, h: 0, ptr: 0, view: null, img: null, off: null, offCtx: null, cell: 1 };

function pixelView() {
  // memory never grows (static buffers), but never trust a detached view
  if (!grid.view || grid.view.byteLength === 0 || grid.view.buffer !== sim.memory.buffer) {
    grid.view = new Uint8ClampedArray(sim.memory.buffer, grid.ptr, grid.w * grid.h * 4);
    grid.img = new ImageData(grid.view, grid.w, grid.h);
  }
  return grid.img;
}

// ---------------------------------------------------------------- layout
let W = 0, H = 0, DPR = 1;            // CSS px
let portrait = false;
let grainPattern = null;

function makeGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  const id = g.createImageData(160, 160);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 120 + Math.random() * 120;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  grainPattern = ctx.createPattern(c, 'repeat');
}

function setupGrid(seed) {
  portrait = H > W;
  // ~2.8 CSS px per cell on desktop, ~2 on phones, capped at 512x512 cells total
  let cell = W >= 1000 ? W / 512 : (W >= 700 ? W / 360 : 2);
  let w = Math.round(W / cell), h = Math.round(H / cell);
  while (w * h > 512 * 512) { cell *= 1.1; w = Math.round(W / cell); h = Math.round(H / cell); }
  grid.cell = cell;
  grid.ptr = sim.init(w, h, seed >>> 0);
  grid.w = sim.width(); grid.h = sim.height();
  grid.view = null;
  grid.off = document.createElement('canvas');
  grid.off.width = grid.w; grid.off.height = grid.h;
  grid.offCtx = grid.off.getContext('2d');
  pixelView();
}

// ---------------------------------------------------------------- game state
const G = {
  state: 'title',     // title | play | win | lose
  seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
  t: 0,               // play seconds
  timeScale: 1,
  difficulty: 0,
  susp: 0,
  suspMaxSweep: 0,
  warned: false,
  sweep: 0,           // 0..3 index of current/next sweep
  phase: 'wait',      // wait | sweep | done
  phaseT: 0,
  u: -0.2,            // beam position along its axis
  pauses: [],
  pauseLeft: 0,
  rapPending: 0,
  breath: 0, breathCd: 0,
  lantern: { x: -1e9, y: 0, r: 100, s: 0, target: 0 },
  bucket: 1, spent: 0,
  unseen: 0, streak: 0, maxStreak: 0, cleanSweeps: 0, bonus: 0,
  ambient: 1, eyeOpen: 0, reveal: 0, endT: 0,
  score: 0,
};
const SWEEP_DUR = [12, 11, 10, 9];
const SWEEP_GAP = [4.2, 5, 4.5, 4];
const PAUSE_N = [2, 2, 3, 3];
const PAUSE_LEN = [1.2, 1.5, 1.8, 2.2];

const ROMAN = ['I', 'II', 'III', 'IV'];
let best = loadState(BEST_KEY, null);

function bestLine() {
  return best && best.score ? `Best <b>${best.score}</b> · ${best.unseen}s unseen${best.won ? ' · they left' : ''}` : 'No one has yet come down the stair.';
}

// ---------------------------------------------------------------- title
function dressTitle() {
  sim.title_dress();
  sim.set_ambient(1);
  sim.set_eye(0);
  sim.set_reveal(0);
  G.lantern.s = 0.9;
}

function planSweep(k) {
  const n = PAUSE_N[k];
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(0.14 + (i + 0.25 + Math.random() * 0.5) / n * 0.74);
  ps.sort((a, b) => a - b);
  G.pauses = ps;
}

function startGame() {
  G.seed = (Math.random() * 0xffffffff) >>> 0;
  setupGrid(G.seed);
  Object.assign(G, {
    state: 'play', t: 0, difficulty: 0, susp: 0, suspMaxSweep: 0, warned: false,
    sweep: 0, phase: 'wait', phaseT: 0, u: -0.2, pauseLeft: 0, rapPending: 0,
    breath: 0, breathCd: 0, bucket: 1, spent: 0, unseen: 0, streak: 0, maxStreak: 0,
    cleanSweeps: 0, bonus: 0, ambient: 1, eyeOpen: 0, reveal: 0, endT: 0, score: 0,
  });
  G.lantern = { x: -1e9, y: 0, r: 100, s: 0, target: 0 };
  sim.set_ambient(1); sim.set_eye(0); sim.set_reveal(0);
  planSweep(0);
  $('title').hidden = true;
  $('end').hidden = true;
  $('hud').hidden = false;
  document.body.classList.remove('on-screen');
  $('btn-wide').setAttribute('aria-pressed', 'false');
  wideToggle = false;
  caption('They come down the stair. The lantern is lit.', 3.2);
  audio.startAmbience();
  updateHud(true);
}

// ---------------------------------------------------------------- captions
let capTimer = 0;
function caption(text, secs = 2.6) {
  const el = $('caption');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(capTimer);
  capTimer = setTimeout(() => el.classList.remove('show'), secs * 1000);
}

// ---------------------------------------------------------------- input
const pointers = new Map(); // id -> {x, y}
let primary = null;         // pointer id painting
let last = null;            // last paint point (grid coords)
let shift = false, wideToggle = false;
let hover = { x: -1, y: -1, on: false };
let moveSpeed = 0;

const toGrid = (cx, cy) => ({ x: cx / grid.cell, y: cy / grid.cell });
const isWide = () => shift || wideToggle || pointers.size >= 2;
const brushR = () => grid.h && Math.min(grid.w, grid.h) * (isWide() ? 0.095 : 0.055);

canvas.addEventListener('pointerdown', (e) => {
  if (G.state !== 'play') return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (primary === null) { primary = e.pointerId; last = toGrid(e.clientX, e.clientY); paintTo(last.x, last.y, true); }
});
canvas.addEventListener('pointermove', (e) => {
  hover = { x: e.clientX, y: e.clientY, on: true };
  if (e.pointerType === 'mouse') document.body.classList.add('has-mouse');
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerId === primary && G.state === 'play') {
    const p = toGrid(e.clientX, e.clientY);
    paintTo(p.x, p.y, false);
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (e.pointerId === primary) { primary = null; last = null; }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { hover.on = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function paintTo(x, y, first) {
  if (!last) last = { x, y };
  const r = brushR();
  const dx = x - last.x, dy = y - last.y;
  const dist = Math.hypot(dx, dy);
  moveSpeed = Math.min(1, moveSpeed * 0.6 + dist / (r * 2));
  const steps = first ? 1 : Math.max(1, Math.ceil(dist / (r * 0.35)));
  const wide = isWide();
  const perStep = (first ? 0.32 : 0.16) * (wide ? 1.15 : 1);
  const cost = perStep * (wide ? 3.0 : 1.0) * 0.024;
  for (let i = 1; i <= steps; i++) {
    if (G.bucket <= 0) { $('trowel').classList.add('empty'); break; }
    const px = last.x + dx * (i / steps), py = last.y + dy * (i / steps);
    sim.plaster(px, py, r, perStep);
    G.bucket = Math.max(0, G.bucket - cost);
    G.spent += cost;
  }
  last = { x, y };
  audio.scrape(Math.min(1, dist / r) * (G.bucket > 0 ? 1 : 0.2));
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'Shift') shift = true;
  if (e.code === 'Space') {
    if (G.state === 'play') { holdBreath(); e.preventDefault(); }
    else if (G.state === 'title') startGame();
    else if ((G.state === 'win' || G.state === 'lose') && G.endT > 1.2) startGame();
  }
  if (e.code === 'Enter') {
    if (G.state === 'title') startGame();
    else if ((G.state === 'win' || G.state === 'lose') && G.endT > 1.2) startGame();
  }
  if (e.key === 'm' || e.key === 'M') audio.toggleMute();
});
addEventListener('keyup', (e) => { if (e.key === 'Shift') shift = false; });

$('btn-wide').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
$('btn-wide').addEventListener('click', () => {
  wideToggle = !wideToggle;
  $('btn-wide').setAttribute('aria-pressed', String(wideToggle));
});
$('btn-breath').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); holdBreath(); });
$('btn-start').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
$('title').addEventListener('pointerdown', (e) => { if (e.target.closest('.poe-back')) return; startGame(); });
$('btn-again').addEventListener('click', (e) => { e.stopPropagation(); if (G.endT > 0.6) startGame(); });
$('end').addEventListener('pointerdown', (e) => { if (e.target.closest('.poe-back')) return; if (G.endT > 1.2) startGame(); });

function holdBreath() {
  if (G.state !== 'play' || G.breathCd > 0 || G.breath > 0) return;
  G.breath = 1.0;
  G.breathCd = 4.0;
  G.susp = Math.min(1, G.susp + 0.06);
  caption('You hold your breath. He glances at you.', 1.6);
  audio.breath();
  $('btn-breath').classList.add('cooling');
}

// ---------------------------------------------------------------- the officers
function beamAxis() {
  // returns {x, y} in grid cells for position u along the sweep axis
  const wob = reduced ? 0 : Math.sin(G.t * 0.9) * 0.10 + Math.sin(G.t * 0.37 + 1) * 0.06;
  if (portrait) return { x: grid.w * (0.5 + wob * 0.6), y: grid.h * (0.06 + 0.86 * G.u) };
  return { x: grid.w * G.u, y: grid.h * (0.5 + wob) };
}

function updateOfficers(dt) {
  const k = G.sweep;
  const L = G.lantern;
  if (G.phase === 'wait') {
    G.phaseT += dt;
    L.target = 0;
    const gap = k === 0 ? SWEEP_GAP[0] : SWEEP_GAP[k];
    if (G.phaseT >= gap) {
      G.phase = 'sweep'; G.phaseT = 0; G.u = -0.18; G.suspMaxSweep = 0; G.warned = false;
      planSweep(k);
      caption(k === 0 ? 'The lantern comes to the wall.' : ['They turn back to the wall.', 'He brings the lantern closer.', 'The last wall. He is thorough.'][k - 1], 2.4);
      audio.footsteps(true);
    }
  } else if (G.phase === 'sweep') {
    L.target = 1;
    // portrait sweeps run along the cat's height, so they move faster to expose it for the same time
    const speed = 1.36 / SWEEP_DUR[k] * (portrait ? 1.35 : 1);
    if (G.pauseLeft > 0) {
      G.pauseLeft -= dt;
      if (G.rapPending > 0) {
        G.rapPending -= dt;
        if (G.rapPending <= 0) doRap(0.7 + 0.15 * k);
      }
    } else if (G.breath > 0) {
      // holding your breath: he waits too
    } else {
      const before = G.u;
      G.u += speed * dt;
      const hit = G.pauses.find((p) => before < p && G.u >= p);
      if (hit !== undefined) {
        G.pauseLeft = PAUSE_LEN[k];
        G.pauses = G.pauses.filter((p) => p !== hit);
        const raps = k >= 1 && Math.random() < (k >= 2 ? 0.75 : 0.5);
        G.rapPending = raps ? 0.45 : 0;
        caption(raps ? 'He lingers, and raises his hand.' : 'He lingers.', 1.5);
      }
      if (G.u > 1.18) {
        // sweep complete
        const clean = G.suspMaxSweep < 0.35;
        if (clean) { G.streak++; G.cleanSweeps++; G.bonus += 25 * G.streak; G.maxStreak = Math.max(G.maxStreak, G.streak); }
        else G.streak = 0;
        if (k === 3) { win(); return; }
        G.sweep++; G.phase = 'wait'; G.phaseT = 0;
        caption(clean ? 'Satisfied, they turn away.' : 'They move on. Not convinced.', 2.4);
        audio.footsteps(false);
        updateHud(true);
      }
    }
  }
  // lantern position + strength
  const p = beamAxis();
  L.x = p.x; L.y = p.y;
  L.r = Math.min(grid.w, grid.h) * (0.30 + 0.035 * k);
  const rate = dt * 2.2;
  L.s += (L.target - L.s) * Math.min(1, rate);
  const flick = reduced ? 1 : 1 + 0.05 * Math.sin(G.t * 23) * Math.sin(G.t * 7.3);
  sim.set_lantern(L.x, L.y, L.r, L.s * flick);
}

function doRap(strength) {
  const L = G.lantern;
  sim.rap(L.x, L.y, strength);
  audio.rap();
  shakeT = 0.35;
  caption('He raps upon the wall.', 1.6);
}

function updateSuspicion(dt) {
  const L = G.lantern;
  const vis = L.s > 0.4 ? sim.visibility() : 0;
  const k = G.sweep;
  const closer = G.pauseLeft > 0 ? 1.3 : 1;
  if (vis > 0.12) G.susp += (vis - 0.12) * (0.55 + 0.25 * k) * closer * dt;
  else G.susp = Math.max(0, G.susp - 0.055 * dt);
  G.susp = Math.min(1, G.susp);
  G.suspMaxSweep = Math.max(G.suspMaxSweep, G.susp);
  if (G.susp > 0.62 && !G.warned) {
    G.warned = true;
    doRap(0.5);
    caption('He frowns, and raps upon the wall.', 1.8);
  }
  if (G.susp < 0.5) G.unseen += dt;
  audio.setDread(G.susp);
  if (G.susp >= 1) lose();
}

// ---------------------------------------------------------------- score, win, lose
function thrift() {
  const budget = G.t * 0.125 + 0.8;
  return 1 + 0.5 * Math.max(0, Math.min(1, 1 - G.spent / budget));
}
function computeScore(won) {
  const th = thrift();
  const base = G.unseen * th * (1 + 0.15 * G.maxStreak);
  return Math.round(base + G.bonus + (won ? 60 : 0));
}

function finish(won) {
  G.score = computeScore(won);
  const th = thrift();
  const end = $('end');
  end.classList.toggle('win', won);
  end.classList.toggle('lose', !won);
  $('end-kicker').textContent = won ? 'The police were thoroughly satisfied and prepared to depart.' : 'The fourth day of the search';
  $('end-quote').textContent = won
    ? 'The glee at my heart was too strong to be restrained. I burned to say if but one word, by way of triumph.'
    : 'The corpse, already greatly decayed and clotted with gore, stood erect before the eyes of the spectators. Upon its head sat the hideous beast.';
  $('score-num').textContent = String(G.score);
  $('score-breakdown').innerHTML =
    `<span>${Math.floor(G.unseen)} s unseen</span><span>thrift ×${th.toFixed(2)}</span>` +
    `<span>${G.cleanSweeps} clean sweep${G.cleanSweeps === 1 ? '' : 's'}</span>` +
    (won ? `<span>they left +60</span>` : `<span>sweep ${ROMAN[G.sweep]}</span>`);
  const isBest = !best || G.score > (best.score || 0);
  if (isBest) {
    best = { score: G.score, unseen: Math.floor(G.unseen), won, at: Date.now() };
    saveState(BEST_KEY, best);
  }
  const bl = isBest ? `A new best · <b>${G.score}</b>` : bestLine();
  $('end-best').innerHTML = bl;
  $('best').innerHTML = bestLine();
  $('hud').hidden = true;
  document.body.classList.add('on-screen');
  G.endT = 0;
  end.hidden = false;
}
function win() {
  if (G.state !== 'play') return;
  G.state = 'win';
  audio.footsteps(false);
  audio.leave();
  caption('The light goes up the stair. You are alone with the wall.', 4);
  finish(true);
}
function lose() {
  if (G.state !== 'play') return;
  G.state = 'lose';
  audio.footsteps(false);
  audio.shriek();
  shakeT = 0.9;
  $('flash').classList.remove('on'); void $('flash').offsetWidth; $('flash').classList.add('on');
  finish(false);
}

// ---------------------------------------------------------------- HUD
let hudAcc = 0;
function updateHud(force) {
  hudAcc += 1;
  if (!force && hudAcc % 3) return;
  $('sweep-num').textContent = ROMAN[Math.min(3, G.sweep)];
  $('susp-fill').style.width = `${(G.susp * 100).toFixed(1)}%`;
  $('susp-bar').classList.toggle('hot', G.susp > 0.62);
  $('unseen-num').textContent = String(Math.floor(G.unseen));
  const st = $('streak');
  st.hidden = G.streak === 0;
  st.textContent = `CLEAN ×${G.streak}`;
  // trowel load
  const load = $('load'), lip = $('load-lip');
  const top = 100 - 68 * G.bucket;
  load.setAttribute('y', top.toFixed(1));
  lip.setAttribute('y', (top - 1.5).toFixed(1));
  if (G.bucket > 0.05) $('trowel').classList.remove('empty');
  $('btn-breath').classList.toggle('cooling', G.breathCd > 0 || G.breath > 0);
}

// ---------------------------------------------------------------- render
let shakeT = 0;
let lastTs = 0;
let titleT = 0;

function drawLedge() {
  const lh = Math.max(26, H * 0.075);
  const y = H - lh;
  const g = ctx.createLinearGradient(0, y, 0, H);
  g.addColorStop(0, '#2a2119'); g.addColorStop(0.08, '#17120e'); g.addColorStop(1, '#0a0806');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, W, lh);
  // the lip where plaster meets floor
  ctx.fillStyle = 'rgba(233,223,201,.10)';
  ctx.fillRect(0, y, W, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(0, y - 10, W, 10);
  const sh = ctx.createLinearGradient(0, y - 34, 0, y);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, y - 34, W, 34);
}

function drawCursor() {
  if (!hover.on || G.state !== 'play' || !document.body.classList.contains('has-mouse')) return;
  const r = brushR() * grid.cell;
  ctx.save();
  ctx.translate(hover.x, hover.y);
  ctx.strokeStyle = 'rgba(22,17,13,.55)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 5]);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = G.bucket > 0.02 ? 'rgba(233,223,201,.9)' : 'rgba(122,26,18,.9)';
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke();
  ctx.restore();
}

const perf = { frames: 0, ms: 0, fps: 0, step: 0, render: 0, blit: 0, post: 0, n: 0 };
function frame(ts) {
  requestAnimationFrame(frame);
  if (!grid.w) return;
  perf.frames++;
  if (ts - perf.ms > 1000) { perf.fps = perf.frames * 1000 / (ts - perf.ms); perf.frames = 0; perf.ms = ts; }
  let dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
  lastTs = ts;
  dt = Math.min(0.05, dt) * G.timeScale;

  if (G.state === 'title') {
    titleT += dt;
    // the lantern breathes at the right edge; the wall itself is still
    const L = G.lantern;
    const breathe = 0.5 + 0.5 * Math.sin(titleT * 0.5);
    if (portrait) sim.set_lantern(grid.w * 0.5 + grid.w * 0.15 * Math.sin(titleT * 0.3), grid.h * (1.02 + 0.06 * breathe), grid.h * 0.42, 0.95);
    else sim.set_lantern(grid.w * (1.02 + 0.05 * breathe), grid.h * (0.42 + 0.1 * Math.sin(titleT * 0.23)), grid.h * 0.78, 0.95);
    L.s = 0.9;
  } else if (G.state === 'play') {
    G.t += dt;
    G.difficulty = Math.min(1.25, G.t / 72 + G.sweep * 0.08);
    if (G.breath > 0) G.breath -= dt;
    if (G.breathCd > 0) G.breathCd -= dt;
    G.bucket = Math.min(1, G.bucket + 0.125 * dt);
    // substep the sim so fast-forward stays stable
    const sub = Math.max(1, Math.ceil(dt / 0.034));
    const p0 = performance.now();
    for (let i = 0; i < sub; i++) sim.step((dt / sub) * 1000, G.difficulty);
    perf.step += performance.now() - p0;
    updateOfficers(dt);
    updateSuspicion(dt);
    audio.tick(dt);
    updateHud(false);
  } else {
    G.endT += dt;
    const L = G.lantern;
    if (G.state === 'win') {
      // the light goes up the stair; in the dark the eye opens all the way
      L.s = Math.max(0, L.s - dt * 0.6);
      sim.set_lantern(L.x, L.y - (portrait ? grid.h : 0) * dt, L.r, L.s);
      G.ambient = Math.max(0.05, G.ambient - dt * 0.4);
      sim.set_ambient(G.ambient);
      if (G.endT > 1.4) { G.eyeOpen = Math.min(1, G.eyeOpen + dt * 0.35); sim.set_eye(G.eyeOpen); }
      for (let i = 0; i < 2; i++) sim.step(dt * 500, 0.4);
    } else {
      // the wall gives up the cat
      G.reveal = Math.min(1, G.reveal + dt * 0.9);
      sim.set_reveal(G.reveal);
      sim.set_eye(Math.min(1, G.reveal * 1.5));
      L.s = Math.min(1.4, L.s + dt * 0.8);
      const cx = sim.cat_cx(), cy = sim.cat_cy();
      L.x += (cx - L.x) * Math.min(1, dt * 2.5);
      L.y += (cy - L.y) * Math.min(1, dt * 2.5);
      sim.set_lantern(L.x, L.y, Math.min(grid.w, grid.h) * 0.55, L.s);
      G.ambient = Math.max(0.35, G.ambient - dt * 0.5);
      sim.set_ambient(G.ambient);
    }
  }

  // ---- blit
  const p1 = performance.now();
  sim.render();
  const p2 = performance.now();
  grid.offCtx.putImageData(pixelView(), 0, 0);
  ctx.save();
  if (shakeT > 0 && !reduced) {
    shakeT -= dt;
    const a = shakeT * 8;
    ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(grid.off, 0, 0, grid.w, grid.h, -2, -2, W + 4, H + 4);
  const p3 = performance.now();
  // full-resolution tooth over the soft upscale
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  drawLedge();
  drawCursor();
  ctx.restore();
  const p4 = performance.now();
  perf.render += p2 - p1; perf.blit += p3 - p2; perf.post += p4 - p3; perf.n++;
}

// ---------------------------------------------------------------- sound
const audio = (() => {
  const A = createAudio();
  let noiseBuf = null;
  let muted = false;
  let amb = null;
  let dread = null;
  let scrapeNode = null;
  let stepsOn = false, stepClock = 0, dripClock = 4;

  const ok = () => A.ctx && A.ctx.state === 'running';
  const noise = () => {
    const c = A.ctx;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
  };
  const env = (g, t, a, peak, d, sus = 0) => {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus), t + a + d);
  };

  function startAmbience() {
    if (!ok() || amb) return;
    const c = A.ctx;
    // murmurs: band-passed noise, slowly gated
    const n = noise();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 1.6;
    const bp2 = c.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 700; bp2.Q.value = 3;
    const g = c.createGain(); g.gain.value = 0.0;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.23;
    const lfoG = c.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(g.gain);
    n.connect(bp).connect(g); n.connect(bp2).connect(g);
    g.connect(A.master);
    n.start(); lfo.start();
    g.gain.setTargetAtTime(0.045, c.currentTime, 2);
    // dread: two subs beating
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 41;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 42.3;
    const dg = c.createGain(); dg.gain.value = 0;
    o1.connect(dg); o2.connect(dg); dg.connect(A.master); o1.start(); o2.start();
    dread = dg;
    // scrape: noise through a resonant band, gain follows the trowel
    const sn = noise();
    const sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1400; sf.Q.value = 2.2;
    const sf2 = c.createBiquadFilter(); sf2.type = 'highpass'; sf2.frequency.value = 400;
    const sg = c.createGain(); sg.gain.value = 0;
    sn.connect(sf).connect(sf2).connect(sg).connect(A.master); sn.start();
    scrapeNode = { g: sg, f: sf };
    amb = { g, n, lfo, o1, o2, sn };
  }
  function tick(dt) {
    if (!ok()) return;
    const c = A.ctx;
    if (scrapeNode) scrapeNode.g.gain.setTargetAtTime(0, c.currentTime, 0.08);
    if (stepsOn) {
      stepClock -= dt;
      if (stepClock <= 0) { stepClock = 0.55 + Math.random() * 0.35; footstep(); }
    }
    dripClock -= dt;
    if (dripClock <= 0) { dripClock = 3 + Math.random() * 7; drip(); }
  }
  function footstep() {
    const c = A.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = c.createGain(); env(g, t, 0.005, 0.18, 0.16);
    o.connect(g).connect(A.master); o.start(t); o.stop(t + 0.25);
    const n = noise(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const ng = c.createGain(); env(ng, t, 0.003, 0.06, 0.08);
    n.connect(f).connect(ng).connect(A.master); n.start(t); n.stop(t + 0.15);
  }
  function drip() {
    const c = A.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    const f0 = 1400 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.07);
    const g = c.createGain(); env(g, t, 0.002, 0.05, 0.12);
    const r = c.createBiquadFilter(); r.type = 'bandpass'; r.frequency.value = f0 * 0.6; r.Q.value = 14;
    o.connect(g).connect(A.master); o.connect(r).connect(g);
    o.start(t); o.stop(t + 0.3);
  }
  function scrape(v) {
    if (!ok() || !scrapeNode) return;
    const c = A.ctx;
    scrapeNode.g.gain.setTargetAtTime(0.08 * v, c.currentTime, 0.02);
    scrapeNode.f.frequency.setTargetAtTime(900 + 1200 * v, c.currentTime, 0.05);
  }
  function rap() {
    if (!ok()) return;
    const c = A.ctx;
    for (let k = 0; k < 2; k++) {
      const t = c.currentTime + k * 0.22;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
      const g = c.createGain(); env(g, t, 0.002, 0.5, 0.18);
      o.connect(g).connect(A.master); o.start(t); o.stop(t + 0.3);
      const n = noise(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 9;
      const ng = c.createGain(); env(ng, t, 0.001, 0.35, 0.3);
      n.connect(f).connect(ng).connect(A.master); n.start(t); n.stop(t + 0.4);
      const n2 = noise(); const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 900;
      const ng2 = c.createGain(); env(ng2, t, 0.001, 0.25, 0.05);
      n2.connect(f2).connect(ng2).connect(A.master); n2.start(t); n2.stop(t + 0.1);
    }
  }
  function breath() {
    if (!ok()) return;
    const c = A.ctx, t = c.currentTime;
    const n = noise(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    const g = c.createGain(); env(g, t, 0.35, 0.05, 0.5);
    n.connect(f).connect(g).connect(A.master); n.start(t); n.stop(t + 1);
  }
  function setDread(s) {
    if (!ok() || !dread) return;
    dread.gain.setTargetAtTime(0.3 * s * s, A.ctx.currentTime, 0.1);
  }
  function footsteps(on) { stepsOn = on; }
  function leave() {
    if (!ok()) return;
    const c = A.ctx, t = c.currentTime;
    // steps going away
    for (let i = 0; i < 9; i++) setTimeout(() => { if (ok()) { footstep(); } }, i * 520);
    if (amb) amb.g.gain.setTargetAtTime(0, t + 1, 1.5);
    if (dread) dread.gain.setTargetAtTime(0, t, 0.3);
    // the eye opens: a thin whine in the dark
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2380;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t + 2); g.gain.exponentialRampToValueAtTime(0.03, t + 6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 12);
    o.connect(g).connect(A.master); o.start(t + 2); o.stop(t + 12.2);
    const d = c.createOscillator(); d.type = 'sine'; d.frequency.value = 36;
    const dg = c.createGain(); dg.gain.setValueAtTime(0.0001, t + 2.5); dg.gain.exponentialRampToValueAtTime(0.25, t + 5); dg.gain.exponentialRampToValueAtTime(0.0001, t + 12);
    d.connect(dg).connect(A.master); d.start(t + 2.5); d.stop(t + 12.2);
  }
  function shriek() {
    if (!ok()) return;
    const c = A.ctx, t = c.currentTime;
    if (amb) amb.g.gain.setTargetAtTime(0, t, 0.5);
    if (dread) dread.gain.setTargetAtTime(0, t, 0.2);
    const dur = 2.1;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i / 255.5) - 1; curve[i] = Math.tanh(x * 3.2); }
    shaper.curve = curve;
    const formant = c.createBiquadFilter(); formant.type = 'bandpass'; formant.Q.value = 7;
    formant.frequency.setValueAtTime(700, t);
    formant.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
    formant.frequency.exponentialRampToValueAtTime(1500, t + 1.2);
    formant.frequency.exponentialRampToValueAtTime(600, t + dur);
    const formant2 = c.createBiquadFilter(); formant2.type = 'peaking'; formant2.frequency.value = 3200; formant2.Q.value = 4; formant2.gain.value = 10;
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(0.7, t + 0.08);
    master.gain.setValueAtTime(0.7, t + 1.3);
    master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    shaper.connect(formant).connect(formant2).connect(master).connect(A.master);
    const vib = c.createOscillator(); vib.frequency.setValueAtTime(5.5, t); vib.frequency.linearRampToValueAtTime(9, t + dur);
    const vibG = c.createGain(); vibG.gain.setValueAtTime(20, t); vibG.gain.linearRampToValueAtTime(90, t + 1.2);
    vib.connect(vibG);
    for (const [det, gain] of [[0, 1], [7, 0.6], [-5, 0.5]]) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(420 + det * 4, t);
      o.frequency.exponentialRampToValueAtTime(1400 + det * 8, t + 0.3);
      o.frequency.setValueAtTime(1400 + det * 8, t + 0.9);
      o.frequency.exponentialRampToValueAtTime(700 + det * 6, t + 1.7);
      o.frequency.exponentialRampToValueAtTime(240, t + dur);
      vibG.connect(o.frequency);
      const g = c.createGain(); g.gain.value = gain;
      o.connect(g).connect(shaper); o.start(t); o.stop(t + dur + 0.1);
    }
    vib.start(t); vib.stop(t + dur + 0.1);
    // breath / hiss under it
    const n = noise(); const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 1.5;
    const ng = c.createGain(); env(ng, t, 0.1, 0.12, dur - 0.2);
    n.connect(nf).connect(ng).connect(A.master); n.start(t); n.stop(t + dur);
    // the wall giving way: low rumble
    const r = c.createOscillator(); r.type = 'sine'; r.frequency.setValueAtTime(60, t); r.frequency.exponentialRampToValueAtTime(28, t + 1.5);
    const rg = c.createGain(); env(rg, t, 0.02, 0.5, 1.6);
    r.connect(rg).connect(A.master); r.start(t); r.stop(t + 1.8);
  }
  function toggleMute() { muted = !muted; A.setMuted(muted); }
  return { startAmbience, tick, scrape, rap, breath, setDread, footsteps, leave, shriek, toggleMute };
})();

// ---------------------------------------------------------------- boot
fitCanvas(canvas, ({ width, height, dpr }) => {
  W = width; H = height; DPR = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!grainPattern) makeGrain();
  const wasPortrait = portrait;
  if (!grid.w || (wasPortrait !== (H > W)) || Math.abs(grid.w * grid.cell - W) > W * 0.25) {
    // first fit, or an orientation flip: rebuild the wall (the cat pose changes with it)
    setupGrid(G.seed);
    if (G.state === 'title') dressTitle();
  }
});

$('best').innerHTML = bestLine();
document.body.classList.add('on-screen');
await Promise.all([
  document.fonts.load("900 100px 'Playfair Display'"),
  document.fonts.load("italic 400 16px 'Spectral'"),
  document.fonts.load("400 16px 'Spectral'"),
]).catch(() => {});
if (grid.w && G.state === 'title') dressTitle();
requestAnimationFrame(frame);

// ---------------------------------------------------------------- test hooks
window.__poe = {
  get state() { return G.state; },
  G, sim, grid,
  start: startGame,
  setTimeScale(k) { G.timeScale = k; },
  win() { if (G.state === 'play') { G.sweep = 3; win(); } },
  lose() { if (G.state === 'play') { G.susp = 1; lose(); } },
  paint(cssX, cssY) { const p = toGrid(cssX, cssY); if (!last) last = p; paintTo(p.x, p.y, false); },
  release() { last = null; },
  cat() { return { x: sim.cat_cx() * grid.cell, y: sim.cat_cy() * grid.cell, s: sim.cat_size() * grid.cell }; },
  showAt(cssX, cssY) { return sim.show_at(cssX / grid.cell, cssY / grid.cell); },
  visibility: () => sim.visibility(),
  fps: () => perf.fps,
  perf: () => ({ fps: +perf.fps.toFixed(1), step: +(perf.step / perf.n).toFixed(2), render: +(perf.render / perf.n).toFixed(2), blit: +(perf.blit / perf.n).toFixed(2), post: +(perf.post / perf.n).toFixed(2), n: perf.n }),
  total: () => sim.total_visibility(),
};
