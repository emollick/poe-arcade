/* Under the Boards — game.js
 * The Tell-Tale Heart as a rhythm game of restraint.
 * Web Audio is the engine (audio.js); this file reads the analyser and draws
 * what it hears on a single 2D canvas.
 */
import { mountBack, fitCanvas, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';
import { HeartEngine } from './audio.js';

mountBack();

/* ---------- constants ---------------------------------------------------- */

const INK   = '#030303';
const BONE  = '#e6dcc6';
const BLOOD = '#6e1a1c';
const VEIL  = '#8fb3c9';
const LAMP  = '#e9cf98';      // the lantern's light on the boards

const DUR = 76;               // seconds of game time to dawn
const GOOD    = 0.15;         // seconds either side of the beat
const BEST_KEY = 'tell-tale-heart:best';

const CAPTIONS = [
  [0.00, 'They sit. They chat. They are satisfied.'],
  [0.16, 'The noise steadily increased.'],
  [0.40, 'One of them rises.'],
  [0.56, 'Why would they not be gone?'],
  [0.70, 'They gather their hats.'],
  [0.90, 'They move toward the door.'],
];

const reduceMotion = prefersReducedMotion();
const mobile = () => innerWidth < 640;

/* ---------- canvas ------------------------------------------------------- */

const canvas = document.getElementById('paper');
const cx = canvas.getContext('2d', { alpha: false });
let W = 1, H = 1, DPR = 1;
let L = null;                 // layout

function layout() {
  const m = mobile();
  const eyeW = m ? Math.min(W * 0.78, H * 0.36) : Math.min(W * 0.44, H * 0.58);
  const eyeY = m ? H * 0.26 : H * 0.32;
  const ringR = m ? Math.min(W * 0.17, H * 0.075) : Math.min(W, H) * 0.085;
  const ringY = m ? H * 0.55 : H * 0.70;
  const boardsY = m ? H * 0.465 : H * 0.60;
  L = {
    m, eyeW, eyeX: W / 2, eyeY,
    meterY: eyeY + eyeW * 0.30 + (m ? 34 : 40),
    meterW: Math.min(W * 0.52, 460),
    ringX: W / 2, ringY, ringR,
    boardsY,
    safeTop: 0, // filled from CSS env is not readable; keep HUD inset generously
  };
}


/* ---------- pre-rendered paper: grain + vignette + board grain ----------- */

const grainTiles = [];
(function buildGrain() {
  const S = 160;
  for (let k = 0; k < 4; k++) {
    const t = document.createElement('canvas');
    t.width = S; t.height = S;
    const g = t.getContext('2d');
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = Math.random() < 0.55 ? 0 : 9 + Math.random() * 10;
    }
    g.putImageData(img, 0, 0);
    grainTiles.push(t);
  }
})();

let vig = null, vigRed = null;
function buildVignette() {
  const w = Math.max(2, Math.round(W / 4)), h = Math.max(2, Math.round(H / 4));
  const make = (color) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const r = Math.hypot(w, h) * 0.5;
    const grad = g.createRadialGradient(w / 2, h * 0.48, r * 0.25, w / 2, h * 0.48, r * 1.0);
    grad.addColorStop(0, color + '00');
    grad.addColorStop(0.55, color + '44');
    grad.addColorStop(1, color + 'cc');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c;
  };
  vig = make('#000000');
  vigRed = make('#4a0d10');
}

let boards = null;
function buildBoards() {
  const y0 = L.boardsY;
  const N = L.m ? 7 : 8;
  const seams = [];
  for (let k = 0; k <= N; k++) {
    const f = k / N;
    seams.push(y0 + (H - y0) * Math.pow(f, 1.35));
  }
  // grain: long faint strokes inside boards, and board ends
  const grain = [];
  const ends = [];
  for (let k = 0; k < N; k++) {
    const a = seams[k], b = seams[k + 1];
    const n = 2 + Math.floor((b - a) / 9);
    for (let i = 0; i < n; i++) {
      const y = a + (b - a) * (0.15 + Math.random() * 0.7);
      const x0 = Math.random() * W * 0.7 - W * 0.1;
      grain.push({ y, x0, x1: x0 + W * (0.25 + Math.random() * 0.6), a: 0.025 + Math.random() * 0.04 });
    }
    const e = Math.floor(1 + Math.random() * 2.5);
    for (let i = 0; i < e; i++) ends.push({ x: Math.random() * W, a, b });
  }
  boards = { seams, grain, ends };
}

fitCanvas(canvas, ({ width, height, dpr }) => {
  W = width; H = height; DPR = dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout();
  buildVignette();
  buildBoards();
});

/* ---------- audio -------------------------------------------------------- */

const audio = createAudio();
const heart = new HeartEngine(audio);
let muted = false;

/* ---------- game state --------------------------------------------------- */

const best = loadState(BEST_KEY, { score: 0, beats: 0, won: false });

const G = {
  state: 'title',         // title | play | paused | confess | dawn
  speed: 1,               // debug: time multiplier
  startAt: 0,             // audio time when the game began
  t: 0,                   // game time (seconds)
  u: 0,                   // progress 0..1
  composure: 1,
  score: 0,
  streak: 0,
  bestStreak: 0,
  beatsHit: 0,
  perfects: 0,
  misses: 0,
  tells: 0,
  beats: [],              // scheduled beats {t, judged, free, kind}
  nextBeat: 0,            // audio time of next beat to schedule
  lastBeat: 0,            // audio time of last real beat (for the ring)
  lastInterval: 1.2,
  heard: 0,               // audio-stream time being heard this frame
  shadowX: [0, 0, 0],     // where each officer's shadow lies across the lamplight
  nextTick: 0,
  tickN: 0,
  nextChatter: 0,
  windows: [],            // watched windows in game time {s, e, side, tapped, announced}
  win: null,              // current watched window
  warn: 0,                // 0..1 how far into the pre-window warning
  endAt: 0,               // audio time of ending
  finalBeatAt: 0,
  judgments: [],          // floating judgment texts
  shocks: [],             // expanding rings on beats
  caption: null,          // {text, at}
  captionIdx: 0,
  officers: [1, 1, 1],    // presence 0..1
  lockUntil: 0,           // input lock after end (perf.now ms)
  flash: 0,
  relax: 0,
  pauseAt: 0,
  timer: 0,
};

const V = {                 // what the picture is drawn from
  wave: new Float32Array(256),
  level: 0,
  env: 0,
  synthPhase: 0,
};

function planWindows() {
  const w = [];
  let t = 8.5 + Math.random() * 1.5;
  while (t < DUR - 4) {
    const d = 1.3 + Math.random() * 1.1 + (t / DUR) * 0.5;
    w.push({ s: t, e: t + d, side: [-1, 0, 1][Math.floor(Math.random() * 3)], tapped: 0, announced: false, survived: false });
    t += d + 5.5 + Math.random() * 4.5;
  }
  return w;
}

function bpmAt(u) { return 54 + 98 * Math.pow(Math.max(0, u), 1.2); }
/* The perfect window. A first night is ±90 ms, easing to ±80 ms by dawn; once
 * a score is on the books it is ±75 ms all night. Fair, not easy. */
function perfectWindow(u) { return best.score ? 0.075 : lerp(0.09, 0.08, clamp01(u)); }
function irregularityAt(u) { return Math.max(0, Math.min(1, (u - 0.48) / 0.42)); }

function startGame() {
  heart.build();
  if (!heart.ready) return;
  heart.reset();
  heart.startRoom();
  const now = heart.now;
  Object.assign(G, {
    state: 'play', startAt: now, t: 0, u: 0, composure: 1, score: 0, streak: 0, bestStreak: 0,
    beatsHit: 0, perfects: 0, misses: 0, tells: 0, beats: [], nextBeat: now + 0.9, lastBeat: now + 0.9,
    lastInterval: 60 / bpmAt(0), nextTick: now + 0.4, tickN: 0, nextChatter: now + 2.5,
    windows: planWindows(), win: null, warn: 0, endAt: 0, finalBeatAt: 0, judgments: [], shocks: [],
    caption: null, captionIdx: 0, officers: [1, 1, 1], flash: 0, relax: 0, heard: now, shadowX: [0, 0, 0],
  });
  heart.setPressure(0, 0.05);
  clearInterval(G.timer);
  G.timer = setInterval(schedule, 24);
}

/* The lookahead scheduler: books beats, ticks and chatter ~200ms ahead. */
function schedule() {
  if (G.state !== 'play') return;
  const now = heart.now;
  const horizon = now + 0.22;
  while (G.nextBeat < horizon) {
    const gt = (G.nextBeat - G.startAt) * G.speed;
    const u = gt / DUR;
    const bpm = bpmAt(u);
    const irr = irregularityAt(u);
    const base = 60 / bpm;
    const inWin = G.windows.some((w) => gt >= w.s - 0.2 && gt <= w.e);
    const t = G.nextBeat;
    heart.beat(t, 0.9, bpm);
    G.beats.push({ t, judged: false, free: inWin, kind: 'beat' });

    // the heart gets irregular near the end: skipped beats, flutters, jitter
    let interval = base;
    const r = Math.random();
    if (irr > 0 && r < 0.11 * irr) {
      interval = base * 2;                                  // a skipped beat
    } else if (irr > 0.3 && r < 0.11 * irr + 0.13 * irr) {
      // a flutter: an extra beat halfway
      const t2 = t + base * 0.5;
      heart.beat(t2, 0.75, bpm * 2);
      const inWin2 = G.windows.some((w) => (t2 - G.startAt) * G.speed >= w.s - 0.2 && (t2 - G.startAt) * G.speed <= w.e);
      G.beats.push({ t: t2, judged: false, free: inWin2, kind: 'flutter' });
    } else if (irr > 0) {
      interval = base * (1 + (Math.random() - 0.5) * 0.36 * irr);
    }
    G.nextBeat = t + interval;
  }
  while (G.nextTick < horizon) {
    heart.tick(G.nextTick, G.tickN++ % 2 === 1);
    G.nextTick += 1.0;
  }
  if (G.nextChatter < horizon) {
    const gt = (G.nextChatter - G.startAt) * G.speed;
    const watched = G.windows.some((w) => gt >= w.s - 0.6 && gt <= w.e + 0.4);
    if (!watched && gt < DUR - 3) {
      const side = [-1, 0, 1][Math.floor(Math.random() * 3)];
      heart.murmur(G.nextChatter, { side, loud: 0.05 + Math.random() * 0.03, syllables: 4 + Math.floor(Math.random() * 6), question: Math.random() < 0.3 });
    }
    G.nextChatter += 3.5 + Math.random() * 4;
  }
}

/* ---------- judging ------------------------------------------------------ */

function addJudgment(text, kind) {
  G.judgments.push({ text, kind, at: performance.now() });
  if (G.judgments.length > 4) G.judgments.shift();
}

function bumpComposure(d) {
  G.composure = Math.max(0, Math.min(1, G.composure + d));
  if (G.composure <= 0 && G.state === 'play') confess();
}

function mult() { return 1 + Math.min(7, Math.floor(G.streak / 6)); }

function tap(evt) {
  const now = performance.now();
  if (now < G.lockUntil) return;
  if (G.state === 'title') {
    if (G.starting) return;
    G.starting = true;
    audio.unlock().then(() => { G.starting = false; if (G.state === 'title') startGame(); });
    return;
  }
  if (G.state === 'paused') { resume(); return; }
  if (G.state === 'confess' || G.state === 'dawn') { G.lockUntil = now + 300; startGame(); return; }
  if (G.state !== 'play') return;

  // judge against what was coming out of the speaker when the finger landed,
  // not against when this handler finally ran
  const stamp = evt && Number.isFinite(evt.timeStamp) && evt.timeStamp > 0 && now - evt.timeStamp < 400 ? evt.timeStamp : now;
  const t = heart.heardAt(stamp);
  const gt = (heart.now - G.startAt) * G.speed;

  // watched: any tap is a tell
  const w = G.win;
  if (w && gt > w.s + 0.12 && gt < w.e) {
    w.tapped++;
    G.tells++;
    G.streak = 0;
    bumpComposure(w.tapped === 1 ? -0.22 : -0.08);
    G.flash = 1;
    heart.knock('tell');
    addJudgment(w.tapped === 1 ? 'a tell' : 'he sees', 'tell');
    return;
  }

  let bestB = null, bestD = 1e9;
  for (const b of G.beats) {
    if (b.judged) continue;
    const d = t - b.t;
    if (Math.abs(d) < Math.abs(bestD)) { bestD = d; bestB = b; }
  }
  if (bestB && Math.abs(bestD) <= GOOD) {
    bestB.judged = true;
    if (bestB.free) { heart.knock('good'); return; }
    G.beatsHit++;
    if (Math.abs(bestD) <= perfectWindow(G.u)) {
      G.streak++;
      G.bestStreak = Math.max(G.bestStreak, G.streak);
      G.perfects++;
      G.score += 100 * mult();
      bumpComposure(0.045);
      G.relax = 1;
      heart.knock('perfect');
      addJudgment('perfect', 'perfect');
    } else {
      G.streak = Math.floor(G.streak * 0.5);
      G.score += 40 * mult();
      bumpComposure(0.012);
      heart.knock('good');
      addJudgment(bestD < 0 ? 'early' : 'late', 'good');
    }
  } else {
    // off the beat: you moved when nothing moved
    G.streak = 0;
    bumpComposure(-0.06);
    heart.knock('miss');
    addJudgment('off the beat', 'miss');
  }
}

function judgeMisses(heard) {
  for (const b of G.beats) {
    if (b.judged) continue;
    if (heard > b.t + GOOD) {
      b.judged = true;
      if (b.free) continue;
      G.misses++;
      G.streak = 0;
      bumpComposure(b.kind === 'flutter' ? -0.06 : -0.10);
      heart.knock('miss');
      addJudgment('missed', 'miss');
    }
  }
  // prune
  while (G.beats.length && G.beats[0].judged && G.beats[0].t < heard - 2) G.beats.shift();
}

/* ---------- endings ------------------------------------------------------ */

function confess() {
  G.state = 'confess';
  clearInterval(G.timer);
  G.endAt = heart.now;
  G.finalBeatAt = heart.confess();
  G.lockUntil = performance.now() + 2600;
  commitBest(false);
}

function dawn() {
  G.state = 'dawn';
  clearInterval(G.timer);
  G.endAt = heart.now;
  G.lockUntil = performance.now() + 1800;
  G.score += 1000 + Math.round(G.composure * 1500);
  heart.dawn();
  commitBest(true);
  // the heart keeps beating anyway: a slow, steady pulse, forever
  G.timer = setInterval(() => {
    const now = heart.now, horizon = now + 0.25;
    while (G.nextBeat < horizon) {
      heart.beat(G.nextBeat, 0.8, 58);
      G.beats.push({ t: G.nextBeat, judged: true, free: true, kind: 'beat' });
      G.lastInterval = 60 / 58;
      G.nextBeat += 60 / 58;
    }
    while (G.beats.length > 8) G.beats.shift();
  }, 40);
}

function commitBest(won) {
  if (G.score > (best.score || 0)) {
    best.score = G.score; best.beats = G.beatsHit; best.won = won; best.streak = G.bestStreak;
    saveState(BEST_KEY, best);
  } else if (won && !best.won) {
    best.won = true;
    saveState(BEST_KEY, best);
  }
}

function pause() {
  if (G.state !== 'play') return;
  G.state = 'paused';
  G.pauseAt = heart.now;
  clearInterval(G.timer);
  for (const n of heart.live) { try { n.stop(); } catch {} }
  heart.live.clear();
}

function resume() {
  const d = heart.now - G.pauseAt;
  G.startAt += d;
  for (const b of G.beats) b.t += d;
  G.nextBeat = Math.max(G.nextBeat + d, heart.now + 0.5);
  G.lastBeat += d;
  G.nextTick = heart.now + 0.3;
  G.nextChatter += d;
  G.state = 'play';
  G.timer = setInterval(schedule, 24);
}

/* ---------- input -------------------------------------------------------- */

addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('.poe-back')) return;
  tap(e);
});
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); tap(e); }
  else if (e.code === 'KeyM') { muted = !muted; audio.setMuted(muted); }
  else if (e.code === 'KeyR' && (G.state === 'confess' || G.state === 'dawn')) { G.lockUntil = 0; tap(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

/* ---------- update ------------------------------------------------------- */

function update(dtMs) {
  const dt = Math.min(0.1, dtMs / 1000);
  const rm = reduceMotion;

  // what the sound is doing
  if (heart.ready) {
    V.level = heart.sample(V.wave) * 2.6;
  } else {
    synthWave(performance.now() / 1000);
  }
  V.env = Math.max(V.level, V.env * Math.pow(0.02, dt));   // fast attack, ~0.2s release

  if (G.state === 'play') {
    const now = heart.now;
    const heard = heart.heardAt();
    G.heard = heard;
    G.t = (now - G.startAt) * G.speed;
    G.u = Math.min(1, G.t / DUR);
    const u = G.u;

    // passing beats: the picture moves when the sound is heard, not when it is scheduled
    for (const b of G.beats) {
      if (!b.seen && heard >= b.t) {
        b.seen = true;
        G.lastInterval = Math.max(0.25, b.t - G.lastBeat);
        G.lastBeat = b.t;
        G.shocks.push({ at: heard, free: b.free });
        if (G.shocks.length > 5) G.shocks.shift();
      }
    }
    judgeMisses(heard);

    // watched windows
    let win = null, warn = 0;
    for (const w of G.windows) {
      if (G.t >= w.s && G.t < w.e) win = w;
      else if (G.t >= w.s - 0.55 && G.t < w.s) warn = Math.max(warn, (G.t - (w.s - 0.55)) / 0.55);
      if (!w.announced && G.t >= w.s - 0.5) {
        w.announced = true;
        heart.murmur(now + 0.02, { side: w.side, loud: 0.11, syllables: 6 + Math.floor(Math.random() * 4), question: true });
      }
      if (!w.survived && G.t >= w.e) {
        w.survived = true;
        if (w.tapped === 0) { G.score += 250; bumpComposure(0.03); addJudgment('he looks away', 'good'); }
      }
    }
    G.win = win;
    G.warn = warn;

    // pressure: time-driven for the sound; the picture adds the panic
    const drain = 0.006 + 0.03 * u;
    bumpComposure(-drain * dt);
    heart.setPressure(u);

    // captions and officers rising
    while (G.captionIdx < CAPTIONS.length && u >= CAPTIONS[G.captionIdx][0]) {
      G.caption = { text: CAPTIONS[G.captionIdx][1], at: performance.now() };
      G.captionIdx++;
    }
    const rise = [0.40, 0.70, 0.90];
    for (let i = 0; i < 3; i++) if (u >= rise[i]) G.officers[i] = Math.max(0, G.officers[i] - dt / 1.8);

    if (G.u >= 1) dawn();
  }

  G.flash = Math.max(0, G.flash - dt * 2.2);
  G.relax = Math.max(0, G.relax - dt * 3);
  if (rm) V.env *= 0.5;
}

/* Before any gesture there is no analyser to read; the title wave is drawn
 * from a shaped fake heartbeat so the frame is never still. */
function synthWave(time) {
  const period = 60 / 52;
  const ph = (time % period) / period;
  const lub = Math.exp(-ph / 0.06);
  const dub = ph > 0.2 ? 0.7 * Math.exp(-(ph - 0.2) / 0.05) : 0;
  const e = lub + dub;
  const w = V.wave;
  for (let i = 0; i < w.length; i++) {
    const x = i / w.length;
    w[i] = e * Math.sin(x * 22 + time * 6) * 0.55 + e * 0.2 * Math.sin(x * 61 - time * 9);
  }
  V.level = e * 0.5;
}

/* ---------- drawing ------------------------------------------------------ */

const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rgba = (c, a) => {
  if (c[0] !== '#') { // an rgb(r,g,b) string from mix()
    const m = c.match(/[\d.]+/g);
    return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  }
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};
const mix = (h1, h2, t) => {
  const c = (h, i) => parseInt(h.slice(i, i + 2), 16);
  const r = Math.round(lerp(c(h1, 1), c(h2, 1), t)), g = Math.round(lerp(c(h1, 3), c(h2, 3), t)), b = Math.round(lerp(c(h1, 5), c(h2, 5), t));
  return `rgb(${r},${g},${b})`;
};
const font = (size, sc, italic) => `${italic ? 'italic ' : ''}${size}px ${sc ? "'IM Fell English SC'" : "'IM Fell English'"}, 'IM Fell English', Georgia, serif`;

let frameSeed = 0;
function jitter(amount) {
  // deterministic per frame so text does not tear between draw calls
  frameSeed = (frameSeed * 9301 + 49297) % 233280;
  return (frameSeed / 233280 - 0.5) * 2 * amount;
}

function shuddered(text, x, y, size, opts = {}) {
  const amp = opts.amp != null ? opts.amp : V.env;
  const k = (opts.k != null ? opts.k : 3) * (reduceMotion ? 0.3 : 1);
  const dx = jitter(amp * k), dy = jitter(amp * k * 0.6);
  cx.font = font(size, opts.sc, opts.italic);
  cx.textAlign = opts.align || 'center';
  cx.textBaseline = opts.baseline || 'middle';
  cx.fillStyle = opts.color || BONE;
  cx.fillText(text, x + dx, y + dy);
}

function fitFont(text, sc, maxW, maxSize) {
  let size = maxSize;
  cx.font = font(size, sc);
  const w = cx.measureText(text).width;
  if (w > maxW) size = Math.floor(size * maxW / w);
  return size;
}

function drawGrain(alpha) {
  const S = 160;
  const tile = grainTiles[(Math.random() * grainTiles.length) | 0];
  const ox = -(Math.random() * S) | 0, oy = -(Math.random() * S) | 0;
  cx.globalAlpha = alpha;
  for (let y = oy; y < H; y += S) for (let x = ox; x < W; x += S) cx.drawImage(tile, x, y, S, S);
  cx.globalAlpha = 1;
}

function drawVignette(red) {
  cx.drawImage(vig, 0, 0, W, H);
  if (red > 0.01) { cx.globalAlpha = red; cx.drawImage(vigRed, 0, 0, W, H); cx.globalAlpha = 1; }
}

/* The vulture eye. open 0..1, gaze {x,y} -1..1, watch 0..1 (fixed on you). */
function drawEye(ex, ey, ew, open, gaze, watch, pressure) {
  const eh = ew * 0.5 * Math.max(0.03, open);
  const irisR = ew * 0.205;
  const ix = ex + gaze.x * ew * 0.13, iy = ey + gaze.y * ew * 0.05;

  // glow when it turns on you
  if (watch > 0.01) {
    const g = cx.createRadialGradient(ex, ey, ew * 0.1, ex, ey, ew * 0.9);
    g.addColorStop(0, rgba(VEIL, 0.24 * watch));
    g.addColorStop(1, rgba(VEIL, 0));
    cx.fillStyle = g;
    cx.fillRect(ex - ew, ey - ew * 0.8, ew * 2, ew * 1.6);
  }

  // the socket: creases around the eye
  cx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const sx = 1.1 + i * 0.12;
    cx.strokeStyle = rgba(BONE, 0.11 - i * 0.03);
    cx.beginPath();
    cx.moveTo(ex - ew * 0.5 * sx, ey + eh * 0.15);
    cx.quadraticCurveTo(ex, ey - eh * (1.55 + i * 0.32) - 6, ex + ew * 0.5 * sx, ey + eh * 0.15);
    cx.stroke();
  }
  cx.strokeStyle = rgba(BONE, 0.09);
  cx.beginPath();
  cx.moveTo(ex - ew * 0.46, ey + eh * 0.35);
  cx.quadraticCurveTo(ex, ey + eh * 1.9 + 8, ex + ew * 0.47, ey + eh * 0.3);
  cx.stroke();

  const upper = (k) => { cx.moveTo(ex - ew / 2, ey); cx.quadraticCurveTo(ex, ey - eh * 1.9 * k, ex + ew / 2, ey); };
  const lidPath = () => {
    cx.beginPath();
    upper(1);
    cx.quadraticCurveTo(ex, ey + eh * 1.6, ex - ew / 2, ey);
    cx.closePath();
  };

  cx.save();
  lidPath();
  cx.clip();
  // the white of an old man's eye: yellowed, dim, bloodshot toward the corners
  const sg0 = cx.createRadialGradient(ix, iy, irisR * 0.9, ix, iy, ew * 0.55);
  sg0.addColorStop(0, mix('#4a443a', '#5a3d33', pressure * 0.6));
  sg0.addColorStop(1, mix('#1c1917', '#2d1512', pressure * 0.8));
  cx.fillStyle = sg0;
  cx.fillRect(ex - ew / 2, ey - eh * 1.2, ew, eh * 2.4);
  // veins
  const veinA = 0.08 + pressure * 0.7;
  cx.strokeStyle = rgba(pressure > 0.3 ? '#8a2224' : '#5a2a2a', veinA);
  cx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    cx.beginPath();
    cx.moveTo(ix + Math.cos(a) * irisR * 1.05, iy + Math.sin(a) * irisR * 1.05);
    cx.quadraticCurveTo(ix + Math.cos(a + 0.3) * irisR * 1.8, iy + Math.sin(a + 0.3) * irisR * 1.6, ix + Math.cos(a) * ew * 0.55, iy + Math.sin(a) * ew * 0.4);
    cx.stroke();
  }
  // iris: dull blue, a dark limbal ring, radial fibres
  const ig = cx.createRadialGradient(ix, iy, irisR * 0.15, ix, iy, irisR);
  ig.addColorStop(0, '#6d8798');
  ig.addColorStop(0.55, '#46606e');
  ig.addColorStop(0.9, '#243038');
  ig.addColorStop(1, '#0e1316');
  cx.fillStyle = ig;
  cx.beginPath(); cx.arc(ix, iy, irisR, 0, Math.PI * 2); cx.fill();
  cx.lineWidth = 1;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + (i % 2) * 0.02;
    const r0 = irisR * (0.32 + ((i * 7) % 5) * 0.05), r1 = irisR * (0.86 + ((i * 3) % 3) * 0.05);
    cx.strokeStyle = rgba(i % 3 === 0 ? '#0a0f12' : VEIL, i % 3 === 0 ? 0.5 : 0.22);
    cx.beginPath();
    cx.moveTo(ix + Math.cos(a) * r0, iy + Math.sin(a) * r0);
    cx.lineTo(ix + Math.cos(a) * r1, iy + Math.sin(a) * r1);
    cx.stroke();
  }
  // pupil: a pinpoint when it fixes on you
  const pr = irisR * lerp(0.44, 0.17, watch);
  cx.fillStyle = INK;
  cx.beginPath(); cx.arc(ix, iy, pr * 1.08, 0, Math.PI * 2); cx.fill();
  // the film: "a dull blue, with a hideous veil over it"
  const fx = ix - irisR * 0.28, fy = iy - irisR * 0.18;
  const fg = cx.createRadialGradient(fx, fy, 0, fx, fy, irisR * 1.15);
  fg.addColorStop(0, rgba('#e8eef0', 0.72));
  fg.addColorStop(0.45, rgba('#c7d5dc', 0.42));
  fg.addColorStop(0.8, rgba(VEIL, 0.12));
  fg.addColorStop(1, rgba(VEIL, 0.0));
  cx.fillStyle = fg;
  cx.beginPath(); cx.arc(ix, iy, irisR * 1.3, 0, Math.PI * 2); cx.fill();
  // highlight
  cx.fillStyle = rgba('#ffffff', 0.55);
  cx.beginPath(); cx.ellipse(ix - irisR * 0.42, iy - irisR * 0.46, irisR * 0.12, irisR * 0.07, -0.6, 0, Math.PI * 2); cx.fill();
  // shadow of the upper lid
  const sg = cx.createLinearGradient(0, ey - eh * 1.05, 0, ey - eh * 0.1);
  sg.addColorStop(0, rgba('#000000', 0.8));
  sg.addColorStop(1, rgba('#000000', 0));
  cx.fillStyle = sg;
  cx.fillRect(ex - ew / 2, ey - eh * 1.2, ew, eh * 1.2);
  cx.restore();

  // the lids have weight: a filled crescent above, a thin one below
  const lidT = Math.max(2, ew * 0.018);
  cx.fillStyle = mix('#5b5246', '#6a3d38', pressure * 0.6);
  cx.beginPath();
  upper(1);
  cx.quadraticCurveTo(ex, ey - eh * 1.9 - lidT * 2.2, ex - ew / 2, ey);
  cx.closePath();
  cx.fill();
  cx.strokeStyle = rgba(BONE, 0.8);
  cx.lineWidth = 1.2;
  cx.beginPath(); upper(1); cx.stroke();
  cx.strokeStyle = rgba(BONE, 0.5);
  cx.beginPath();
  cx.moveTo(ex - ew / 2, ey);
  cx.quadraticCurveTo(ex, ey + eh * 1.6, ex + ew / 2, ey);
  cx.stroke();
  // lashes on the upper lid, sparse and old
  cx.strokeStyle = rgba(BONE, 0.35);
  cx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const t = 0.08 + (i / 13) * 0.84;
    const bx = ex - ew / 2 + ew * t;
    const by = ey - eh * 1.9 * 2 * t * (1 - t) - lidT * 1.1;
    const dir = (t - 0.5) * 1.6;
    const len = ew * (0.018 + 0.012 * Math.sin(i * 2.3));
    cx.beginPath(); cx.moveTo(bx, by); cx.lineTo(bx + dir * len, by - len); cx.stroke();
  }
}

/* Floorboards: seams that bulge with the live waveform under the ring, and
 * that ride up over `ridge` — a ring-shaped swelling under the planks that
 * closes in on the burial spot with every beat (the approach ring, in wood). */
function drawBoards(pressure, bulgeX, bulgeY, ampPx, ridge) {
  const { seams, grain, ends } = boards;
  const w = V.wave;
  const n = w.length;
  boards.paths = [];

  // blood seeping up between the boards as the pressure rises
  if (pressure > 0.2) {
    const a = (pressure - 0.2) * 0.75;
    const g = cx.createRadialGradient(bulgeX, bulgeY + 8, 0, bulgeX, bulgeY, L.ringR * 3.6);
    g.addColorStop(0, rgba(BLOOD, a));
    g.addColorStop(1, rgba(BLOOD, 0));
    cx.fillStyle = g;
    cx.fillRect(bulgeX - L.ringR * 4, L.boardsY, L.ringR * 8, H - L.boardsY);
  }

  // grain
  cx.lineWidth = 1;
  for (const s of grain) {
    cx.strokeStyle = rgba(BONE, s.a);
    cx.beginPath(); cx.moveTo(s.x0, s.y); cx.lineTo(s.x1, s.y); cx.stroke();
  }
  // seams
  const sig = Math.max(140, W * 0.22);
  const rr = ridge ? ridge.r : 0, rAmp = ridge ? ridge.amp : 0, rSig = ridge ? ridge.sigma : 1;
  for (let k = 0; k < seams.length; k++) {
    const y0 = seams[k];
    const depth = 1 - Math.abs(y0 - bulgeY) / (H - L.boardsY);
    const rowAmp = ampPx * Math.max(0.15, depth);
    const dy0 = y0 - bulgeY;
    const near = rAmp > 0 && Math.abs(dy0) < rr + rSig * 3;
    cx.strokeStyle = rgba(BONE, 0.22 + 0.12 * (k / seams.length));
    cx.lineWidth = 1 + k * 0.12;
    const path = new Path2D();
    const step = 6;
    for (let x = 0; x <= W + step; x += step) {
      const g = Math.exp(-((x - bulgeX) * (x - bulgeX)) / (2 * sig * sig));
      const i = Math.floor((x / W) * (n - 1));
      let y = y0 - w[i] * rowAmp * g;
      if (near) {
        const dx = x - bulgeX;
        const d = Math.sqrt(dx * dx + dy0 * dy0) - rr;
        y -= rAmp * Math.exp(-(d * d) / (2 * rSig * rSig));
      }
      if (x === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    cx.stroke(path);
    boards.paths.push(path);
  }
  // board ends
  cx.strokeStyle = rgba(BONE, 0.16);
  cx.lineWidth = 1;
  for (const e of ends) { cx.beginPath(); cx.moveTo(e.x, e.a); cx.lineTo(e.x, e.b); cx.stroke(); }
}

/* Three officers. On desktop: hats and shoulders along the top. On a phone
 * they sit at the bottom edge of the frame, faces turned up toward you, and
 * sink out of the picture when they leave. */
function drawOfficers(t) {
  const m = L.m;
  const xs = m ? [0.22, 0.5, 0.78] : [0.38, 0.5, 0.62];
  const y = m ? H - 46 : 58;
  const s = m ? 1.35 : 1;
  for (let i = 0; i < 3; i++) {
    const p = G.officers[i];
    if (p <= 0) continue;
    const x = W * xs[i];
    const lift = (1 - p) * (m ? -90 : 40);
    const watching = G.win && G.win.side === i - 1 ? 1 : 0;
    const sway = m ? Math.sin(t * 0.7 + i * 2.3) * 1.5 : 0;
    cx.globalAlpha = (m ? 0.42 : 0.34) * p;
    cx.fillStyle = BONE;
    if (m) {
      // seen from above: the hat's crown, its brim, the upturned face, shoulders
      const hy = y - 30 * s - lift + sway;
      cx.fillRect(x - 12 * s, hy - 10 * s, 24 * s, 9 * s);                  // crown
      cx.beginPath(); cx.ellipse(x, hy, 19 * s, 4 * s, 0, 0, Math.PI * 2); cx.fill(); // brim
      cx.beginPath(); cx.ellipse(x, hy + 9 * s, 8 * s, 8.5 * s, 0, 0, Math.PI * 2); cx.fill(); // face
      cx.beginPath();
      cx.moveTo(x - 30 * s, y + 30 * s - lift);
      cx.quadraticCurveTo(x - 28 * s, hy + 14 * s, x - 10 * s, hy + 15 * s);
      cx.lineTo(x + 10 * s, hy + 15 * s);
      cx.quadraticCurveTo(x + 28 * s, hy + 14 * s, x + 30 * s, y + 30 * s - lift);
      cx.closePath(); cx.fill();
      cx.globalAlpha = 1;
      // eyes, looking up: dark normally, the veil's blue when one fixes on you
      cx.fillStyle = watching ? VEIL : INK;
      if (watching) cx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 12); else cx.globalAlpha = 0.9 * p;
      cx.beginPath(); cx.ellipse(x - 3.2 * s, hy + 8 * s, 1.7 * s, 1.1 * s, 0, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.ellipse(x + 3.2 * s, hy + 8 * s, 1.7 * s, 1.1 * s, 0, 0, Math.PI * 2); cx.fill();
      cx.globalAlpha = 1;
      continue;
    }
    // hat
    cx.fillRect(x - 12 * s, y - 26 * s - lift, 24 * s, 12 * s);
    cx.fillRect(x - 18 * s, y - 14 * s - lift, 36 * s, 2.5 * s);
    // head + shoulders
    cx.beginPath(); cx.ellipse(x, y - 4 * s - lift, 8 * s, 9 * s, 0, 0, Math.PI * 2); cx.fill();
    cx.beginPath();
    cx.moveTo(x - 26 * s, y + 18 * s - lift);
    cx.quadraticCurveTo(x - 24 * s, y + 3 * s - lift, x - 10 * s, y + 4 * s - lift);
    cx.lineTo(x + 10 * s, y + 4 * s - lift);
    cx.quadraticCurveTo(x + 24 * s, y + 3 * s - lift, x + 26 * s, y + 18 * s - lift);
    cx.closePath(); cx.fill();
    cx.globalAlpha = 1;
    if (watching) {
      cx.fillStyle = VEIL;
      cx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 12);
      cx.beginPath(); cx.arc(x - 3 * s, y - 5 * s - lift, 1.6, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.arc(x + 3 * s, y - 5 * s - lift, 1.6, 0, Math.PI * 2); cx.fill();
      cx.globalAlpha = 1;
    }
  }
}

/* Where the approach ridge is this frame: radius closes from ~2.1R to R on the
 * beat, exactly the easing the old ring used, so the timing reads the same. */
function ridgeNow(heard) {
  const R = L.ringR;
  const phase = clamp01((heard - G.lastBeat) / G.lastInterval);
  const r = R * (1 + 1.1 * (1 - phase) * (1 - phase));
  const amp = (L.m ? 4.5 : 6) * (0.7 + 0.6 * G.u) * (reduceMotion ? 0.5 : 1);
  return { r, amp, sigma: L.m ? 5 : 6.5, phase };
}

/* An embossed arc: a ridge in the planks, lit from above — bone on the upper
 * edge, ink beneath. */
function ridgeArc(x, y, r, alpha, width) {
  cx.lineWidth = width;
  cx.strokeStyle = rgba('#000000', 0.85 * alpha);
  cx.beginPath(); cx.arc(x, y + width * 0.9, r, 0, Math.PI * 2); cx.stroke();
  cx.strokeStyle = rgba(BONE, 0.55 * alpha);
  cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.stroke();
}

function drawRing(heard, t) {
  const { ringX: x, ringY: y, ringR: R } = L;
  const m = L.m;
  const watched = !!G.win;
  const pressure = G.u;
  const col = watched ? VEIL : mix(BONE, BLOOD, Math.pow(pressure, 1.4) * 0.85);
  const lampCol = watched ? VEIL : mix(LAMP, BLOOD, Math.pow(pressure, 1.6) * 0.55);

  /* The target is the lantern's circle of light on the boards, over the place
   * where he lies. It brightens with the beat; the planks inside it are lit. */
  const glow = 0.13 + V.env * 0.22 + G.relax * 0.08;
  const pool = cx.createRadialGradient(x, y - R * 0.15, 0, x, y, R);
  pool.addColorStop(0, rgba(lampCol, glow * 1.1));
  pool.addColorStop(0.75, rgba(lampCol, glow * 0.8));
  pool.addColorStop(1, rgba(lampCol, glow * 0.25));
  cx.fillStyle = pool;
  cx.beginPath(); cx.arc(x, y, R, 0, Math.PI * 2); cx.fill();
  cx.save();
  cx.beginPath(); cx.arc(x, y, R, 0, Math.PI * 2); cx.clip();
  if (boards.paths) {
    cx.strokeStyle = rgba(lampCol, 0.5 + V.env * 0.3);
    cx.lineWidth = 1.2;
    for (const p of boards.paths) cx.stroke(p);
  }
  // the heart under the boards: a dark pulse in the middle of the light
  const g = cx.createRadialGradient(x, y, 0, x, y, R * 0.95);
  g.addColorStop(0, rgba(watched ? VEIL : BLOOD, 0.18 + V.env * 0.6 * (0.3 + pressure)));
  g.addColorStop(1, rgba(BLOOD, 0));
  cx.fillStyle = g;
  cx.fillRect(x - R, y - R, R * 2, R * 2);

  // the officers' shadows fall across the light. Each drifts as its man
  // shifts in his chair; the one who turns on you plants his over the spot.
  for (let i = 0; i < 3; i++) {
    const p = G.officers[i];
    if (p <= 0) continue;
    const mine = G.win && G.win.side === i - 1;
    const warnMine = !G.win && G.warn > 0;
    const drift = x + Math.sin(t * 0.11 + i * 2.1) * R * 1.15 + (i - 1) * R * 0.5;
    const target = mine ? x : warnMine ? lerp(drift, x, G.warn * 0.5) : drift;
    if (!G.shadowX[i]) G.shadowX[i] = target;
    G.shadowX[i] += (target - G.shadowX[i]) * (mine ? 0.18 : 0.06);
    const sx = G.shadowX[i];
    const lean = Math.sin(t * 0.5 + i) * 0.08 + (mine ? 0 : 0.15 * (i - 1));
    const a = (mine ? 0.55 + 0.1 * Math.sin(t * 9) : 0.26) * p;
    cx.fillStyle = rgba('#000000', a);
    cx.beginPath();
    // a long man-shaped wedge cast up the boards: shoulders wide at the far edge, hat at the near
    const top = y + R * 1.05, hat = y - R * 0.95;
    cx.moveTo(sx - R * 0.42, top);
    cx.lineTo(sx + R * 0.42, top);
    cx.lineTo(sx + R * 0.2 + lean * R, hat + R * 0.55);
    cx.lineTo(sx + R * 0.24 + lean * R, hat + R * 0.45);
    cx.lineTo(sx + R * 0.13 + lean * R, hat + R * 0.28);
    cx.lineTo(sx + R * 0.17 + lean * R, hat + R * 0.02);
    cx.lineTo(sx - R * 0.17 + lean * R, hat + R * 0.02);
    cx.lineTo(sx - R * 0.13 + lean * R, hat + R * 0.28);
    cx.lineTo(sx - R * 0.24 + lean * R, hat + R * 0.45);
    cx.lineTo(sx - R * 0.2 + lean * R, hat + R * 0.55);
    cx.closePath(); cx.fill();
  }
  cx.restore();

  // shockwaves on the real beats: the planks heave outward from the spot
  for (const sh of G.shocks) {
    const a = (heard - sh.at) / 0.55;
    if (a < 0 || a > 1) continue;
    ridgeArc(x, y, R * (1 + a * 1.6), (1 - a) * (sh.free ? 0.45 : 0.75), 1.5 + (1 - a) * 2.5);
  }

  // the approach: the swelling under the boards closing in on the light
  const ridge = ridgeNow(heard);
  if (ridge.r > R + 1.5) ridgeArc(x, y, ridge.r, 0.55 + 0.35 * ridge.phase, 1.5 + ridge.amp * 0.25);

  // the light's edge: the target ring, breathing with the analyser
  const thick = 2.5 + V.env * 6 + G.relax * 2;
  cx.strokeStyle = col;
  cx.lineWidth = thick;
  cx.beginPath(); cx.arc(x, y, R + V.env * 4, 0, Math.PI * 2); cx.stroke();
  // and a soft halo just outside it, where the lamplight dies on the wood
  cx.strokeStyle = rgba(lampCol, 0.10 + V.env * 0.1);
  cx.lineWidth = thick * 2.4;
  cx.beginPath(); cx.arc(x, y, R + thick * 1.2, 0, Math.PI * 2); cx.stroke();

  // instruction over the light
  if (watched) {
    const blink = 0.78 + 0.22 * Math.sin(performance.now() / 90);
    shuddered('HOLD STILL', x, y - R - (m ? 13 : 16), m ? 18 : 22, { sc: true, color: rgba(VEIL, blink), k: 1.5 });
  } else if (G.warn > 0) {
    shuddered('he turns', x, y - R - (m ? 13 : 16), m ? 17 : 19, { italic: true, color: rgba(VEIL, 0.5 + 0.5 * G.warn), k: 1 });
  }

  // streak + multiplier
  if (G.streak >= 3) {
    shuddered(`×${mult()}`, x, y + 2, Math.round(R * 0.62), { sc: true, color: rgba(BONE, 0.9), k: 2 });
    shuddered(`${G.streak} steady`, x, y + R + (m ? 22 : 26), m ? 15 : 17, { italic: true, color: rgba(BONE, 0.8), k: 1 });
  }

  // judgments
  const pn = performance.now();
  for (const j of G.judgments) {
    const a = (pn - j.at) / 700;
    if (a > 1) continue;
    const color = j.kind === 'perfect' ? BONE : j.kind === 'tell' ? VEIL : j.kind === 'miss' ? '#b04a4c' : rgba(BONE, 0.8);
    cx.globalAlpha = 1 - a * a;
    const size = j.kind === 'tell' ? 28 : 20;
    shuddered(j.text, x + R * 1.5 + (m ? 8 : 26), y - a * 22, size, { sc: j.kind === 'tell', italic: j.kind !== 'tell', color, align: 'left', k: 1 });
    cx.globalAlpha = 1;
  }
}

function drawMeter() {
  const c = G.composure;
  const y = L.meterY, w = L.meterW, x0 = W / 2 - w / 2;
  const col = mix(BONE, BLOOD, Math.pow(1 - c, 1.2));
  const low = c < 0.3;
  const pulse = low ? 0.5 + 0.5 * V.env : 0;
  cx.strokeStyle = rgba(BONE, 0.18);
  cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x0 + w, y); cx.stroke();
  // fill from the centre outward: composure holds together in the middle
  const half = (w / 2) * c;
  cx.strokeStyle = col;
  cx.lineWidth = 2.5 + pulse * 3 + G.relax * 2;
  cx.beginPath(); cx.moveTo(W / 2 - half, y); cx.lineTo(W / 2 + half, y); cx.stroke();
  // end ticks
  cx.strokeStyle = rgba(BONE, 0.35);
  cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(x0, y - 5); cx.lineTo(x0, y + 5); cx.moveTo(x0 + w, y - 5); cx.lineTo(x0 + w, y + 5); cx.stroke();
  shuddered('composure', W / 2, y + (L.m ? 15 : 19), L.m ? 14 : 17, { sc: true, color: rgba(BONE, low ? 0.95 : 0.8), k: low ? 2 : 0.5 });
}

function drawHUD() {
  const m = L.m;
  const right = W - (m ? 18 : 36), top = m ? 56 : 30;
  // IM Fell's figures are old-style (x-height digits), so the block runs a
  // little larger than a lining face would need to read at a glance
  const scoreSz = m ? 30 : 36, lineSz = m ? 14 : 16;
  const ink80 = rgba(BONE, 0.8);
  shuddered(fmt(G.score), right, top + scoreSz * 0.55, scoreSz, { sc: true, align: 'right', color: ink80, k: 1.2 });
  shuddered(best.score ? `best ${fmt(best.score)}` : 'first night', right, top + scoreSz * 0.55 + lineSz * 1.9, lineSz, { align: 'right', italic: true, color: ink80, k: 0.5 });
  // hour: the night wears on
  const pct = Math.round(G.u * 100);
  shuddered(`${pct}% to dawn`, right, top + scoreSz * 0.55 + lineSz * 3.5, lineSz, { align: 'right', sc: true, color: ink80, k: 0.5 });

  // caption: over the boards on desktop; on a phone it sits with the officers
  if (G.caption) {
    const a = (performance.now() - G.caption.at) / 1000;
    const alpha = a < 0.5 ? a * 2 : a < 3.6 ? 1 : Math.max(0, 1 - (a - 3.6) / 0.8);
    if (alpha > 0) shuddered(G.caption.text, W / 2, m ? H - 128 : H - 34, m ? 18 : 22, { italic: true, color: rgba(BONE, 0.85 * alpha), k: 1 });
  }
}

function drawTitle(t) {
  const m = L.m;
  const amp = V.env;
  // the eye, half-lidded, looking off
  const open = 0.55 + amp * 0.12;
  drawEye(L.eyeX, L.eyeY, L.eyeW, open, { x: -0.55 + Math.sin(t * 0.3) * 0.08, y: 0.15 }, 0, 0.1);

  // the title, split by a seam that is the waveform
  const seamY = m ? H * 0.53 : H * 0.575;
  const text = 'UNDER THE BOARDS';
  let size;
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  const dx = jitter(amp * 4), dy = jitter(amp * 2);
  const split = (m ? 4 : 6) + amp * 8;
  const drawSplit = (str, y, sz) => {
    cx.font = font(sz, true);
    cx.fillStyle = BONE;
    cx.save();
    cx.beginPath(); cx.rect(0, 0, W, seamY); cx.clip();
    cx.fillText(str, W / 2 + dx - split, y + dy);
    cx.restore();
    cx.save();
    cx.beginPath(); cx.rect(0, seamY, W, H - seamY); cx.clip();
    cx.fillText(str, W / 2 + dx + split, y + dy + 2);
    cx.restore();
  };
  if (m) {
    const s1 = fitFont('UNDER THE', true, W * 0.86, 88);
    const s2 = fitFont('BOARDS', true, W * 0.9, 150);
    size = s2;
    cx.font = font(s1, true); cx.fillStyle = BONE;
    cx.fillText('UNDER THE', W / 2 + dx * 0.5, seamY - s2 * 0.42 - s1 * 0.5 + dy);
    drawSplit('BOARDS', seamY + s2 * 0.02, s2);
  } else {
    size = fitFont(text, true, W * 0.92, 190);
    drawSplit(text, seamY + size * 0.06, size);
  }

  // the seam: a gap between the boards, and in it the live waveform
  const w = V.wave, n = w.length;
  const seam = (width, color, ampPx) => {
    cx.strokeStyle = color;
    cx.lineWidth = width;
    cx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const i = Math.floor((x / W) * (n - 1));
      const g = Math.exp(-Math.pow((x - W / 2) / (W * 0.3), 2));
      const y = seamY + w[i] * ampPx * g;
      if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
    }
    cx.stroke();
  };
  seam(m ? 3 : 4, INK, m ? 12 : 20);
  seam(1, rgba(BONE, 0.7), m ? 12 : 20);

  const under = m ? seamY + size * 0.62 : seamY + size * 0.60;
  shuddered('The Tell-Tale Heart · Edgar Allan Poe', W / 2, under, m ? 15 : 19, { italic: true, color: rgba(BONE, 0.62), k: 1 });

  const howY = under + (m ? 44 : 54);
  const how1 = 'Tap with the heartbeat.';
  const how2 = 'When the eye turns on you, hold still.';
  if (m) {
    shuddered(how1, W / 2, howY, 17, { color: rgba(BONE, 0.92), k: 1 });
    shuddered(how2, W / 2, howY + 24, 17, { color: rgba(BONE, 0.92), k: 1 });
  } else {
    shuddered(how1 + '  ' + how2, W / 2, howY, 22, { color: rgba(BONE, 0.92), k: 1 });
  }

  const blink = 0.55 + 0.45 * Math.sin(t * 2.4);
  const cta = m ? 'touch to begin' : 'space · click · touch — press to begin';
  shuddered(cta, W / 2, howY + (m ? 60 : 40), m ? 14 : 15, { sc: true, color: rgba(BONE, 0.45 + 0.4 * blink), k: 0.5 });

  const bestLine = best.score
    ? `best ${fmt(best.score)} · ${best.beats || 0} beats${best.won ? ' · survived to dawn' : ''}`
    : 'no one has yet kept their composure';
  shuddered(bestLine, W / 2, howY + (m ? 84 : 66), 13, { italic: true, color: rgba(BONE, 0.5), k: 0.5 });
}

function drawEnd(now, t) {
  const m = L.m;
  const lose = G.state === 'confess';
  const since = now - G.endAt;

  if (lose) {
    const hit = G.finalBeatAt ? now - G.finalBeatAt : -1;
    // dark until the final beat lands; then the words arrive
    const reveal = hit < 0 ? 0 : clamp01(hit / 0.25);
    if (reveal <= 0) {
      // silence: only the eye, wide, on you
      drawEye(L.eyeX, L.eyeY, L.eyeW * 0.9, 1, { x: 0, y: 0 }, 1, 1);
      drawGrain(0.9);
      return;
    }
    drawEye(L.eyeX, L.eyeY, L.eyeW * 0.9, 1, { x: 0, y: 0 }, 1, 1);
    cx.globalAlpha = reveal;
    const headY = m ? H * 0.52 : H * 0.62;
    const hs = fitFont('I ADMIT THE DEED', true, W * 0.9, m ? 60 : 110);
    shuddered('I ADMIT THE DEED', W / 2, headY, hs, { sc: true, color: BLOOD, k: 6 });
    const lines = m
      ? ['“Villains!” I shrieked, “dissemble no more!', 'I admit the deed! — tear up the planks!', 'here, here! — It is the beating', 'of his hideous heart!”']
      : ['“Villains!” I shrieked, “dissemble no more! I admit the deed!', '— tear up the planks! here, here! — It is the beating of his hideous heart!”'];
    const ls = m ? 16 : 22;
    lines.forEach((ln, i) => shuddered(ln, W / 2, headY + hs * 0.55 + 12 + i * (ls + 8), ls, { italic: true, color: rgba(BONE, 0.85), k: 2 }));
    const statY = headY + hs * 0.55 + 12 + lines.length * (ls + 8) + (m ? 14 : 20);
    shuddered(`${fmt(G.score)} · ${G.beatsHit} beats · ${G.perfects} perfect · ${G.tells} tell${G.tells === 1 ? '' : 's'}`, W / 2, statY, m ? 14 : 16, { sc: true, color: rgba(BONE, 0.7), k: 1 });
    if (since > 2.6) {
      const blink = 0.55 + 0.45 * Math.sin(t * 2.4);
      shuddered(m ? 'touch to try again' : 'space · click · touch — try again', W / 2, statY + 30, 14, { sc: true, color: rgba(BONE, 0.3 + 0.5 * blink), k: 0.5 });
    }
    cx.globalAlpha = 1;
    return;
  }

  // dawn
  const dawnA = clamp01(since / 3);
  const g = cx.createLinearGradient(0, 0, 0, H * 0.6);
  g.addColorStop(0, rgba(VEIL, 0.18 * dawnA));
  g.addColorStop(1, rgba(VEIL, 0));
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, H * 0.6);
  drawEye(L.eyeX, L.eyeY, L.eyeW * 0.9, 0.5, { x: 0.2, y: 0.1 }, 0, 0.15);
  const headY = m ? H * 0.52 : H * 0.60;
  const hs = fitFont('THEY ARE GONE', true, W * 0.9, m ? 64 : 110);
  cx.globalAlpha = clamp01(since / 1.2);
  shuddered('THEY ARE GONE', W / 2, headY, hs, { sc: true, color: BONE, k: 2 });
  const lines = m
    ? ['I smiled, — for what had I to fear?', 'It was a low, dull, quick sound —', 'much such a sound as a watch makes', 'when enveloped in cotton.']
    : ['I smiled, — for what had I to fear?', 'It was a low, dull, quick sound — much such a sound as a watch makes when enveloped in cotton.'];
  const ls = m ? 16 : 21;
  lines.forEach((ln, i) => shuddered(ln, W / 2, headY + hs * 0.55 + 12 + i * (ls + 8), ls, { italic: true, color: rgba(BONE, 0.85), k: 1 }));
  const statY = headY + hs * 0.55 + 12 + lines.length * (ls + 8) + (m ? 14 : 20);
  const isBest = G.score >= best.score && G.score > 0;
  shuddered(`${fmt(G.score)}${isBest ? ' · best' : ''} · ${G.beatsHit} beats · ${G.perfects} perfect · ${G.bestStreak} streak`, W / 2, statY, m ? 14 : 16, { sc: true, color: rgba(BONE, 0.7), k: 1 });
  shuddered('the heart keeps beating.', W / 2, statY + 26, m ? 15 : 17, { italic: true, color: rgba(BLOOD, 0.9), k: 3 });
  if (since > 1.8) {
    const blink = 0.55 + 0.45 * Math.sin(t * 2.4);
    shuddered(m ? 'touch to play again' : 'space · click · touch — play again', W / 2, statY + 54, 14, { sc: true, color: rgba(BONE, 0.3 + 0.5 * blink), k: 0.5 });
  }
  cx.globalAlpha = 1;
}

function render(t) {
  const now = heart.now;
  const play = G.state === 'play' || G.state === 'paused';
  const pressure = play ? clamp01(Math.max(G.u * 0.75, (1 - G.composure) * 0.9)) : (G.state === 'confess' ? 1 : 0);

  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx.fillStyle = INK;
  cx.fillRect(0, 0, W, H);

  // the whole frame shakes with the beat as the night wears on
  if (!reduceMotion) {
    const shake = play ? V.env * Math.pow(G.u, 1.5) * 9 + G.flash * 4 : (G.state === 'confess' ? V.env * 14 : 0);
    if (shake > 0.2) cx.translate(jitter(shake), jitter(shake * 0.6));
  }

  if (G.state === 'title') {
    drawBoards(0, W / 2, L.boardsY + 30, L.m ? 10 : 16);
    drawTitle(t);
  } else if (play) {
    const u = G.u;
    const watch = G.win ? 1 : G.warn * 0.6;
    const open = lerp(0.42, 0.8, Math.pow(u, 0.8)) + (G.win ? 0.25 : G.warn * 0.15) - G.relax * 0.08 + V.env * 0.05;
    const gaze = G.win ? { x: 0, y: 0 } : { x: lerp(-0.6, 0, G.warn) + Math.sin(t * 0.4) * 0.06, y: 0.15 - G.warn * 0.1 };
    // dawn creeping in at the top
    if (u > 0.82) {
      const a = (u - 0.82) / 0.18;
      const g = cx.createLinearGradient(0, 0, 0, H * 0.35);
      g.addColorStop(0, rgba(VEIL, 0.13 * a)); g.addColorStop(1, rgba(VEIL, 0));
      cx.fillStyle = g; cx.fillRect(0, 0, W, H * 0.35);
    }
    drawBoards(pressure, L.ringX, L.ringY, (L.m ? 22 : 34) * (0.5 + u) * (0.4 + V.level), ridgeNow(G.heard));
    drawEye(L.eyeX, L.eyeY, L.eyeW, Math.min(0.95, open), gaze, watch, pressure);
    drawOfficers(t);
    drawMeter();
    drawRing(G.heard, t);
    drawHUD();
    if (G.state === 'paused') {
      cx.fillStyle = rgba('#000000', 0.6); cx.fillRect(0, 0, W, H);
      shuddered('the night waits', W / 2, H / 2, 40, { sc: true, k: 0.5 });
      shuddered('tap to go on', W / 2, H / 2 + 36, 16, { italic: true, color: rgba(BONE, 0.6), k: 0.5 });
    }
  } else {
    drawBoards(G.state === 'confess' ? 1 : 0.1, L.ringX, L.ringY, (L.m ? 26 : 40) * (0.4 + V.level));
    drawEnd(now, t);
  }

  // blue flash on a tell
  if (G.flash > 0) { cx.fillStyle = rgba(VEIL, G.flash * 0.18); cx.fillRect(-20, -20, W + 40, H + 40); }

  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawVignette(pressure * 0.7);
  drawGrain(L.m ? 0.6 : 0.85);
}

/* ---------- loop --------------------------------------------------------- */

let last = performance.now();
let started = false;
function loop(ts) {
  const dt = ts - last; last = ts;
  update(dt);
  render(ts / 1000);
  requestAnimationFrame(loop);
}

(async () => {
  try {
    await Promise.all([
      document.fonts.load("100px 'IM Fell English SC'"),
      document.fonts.load("20px 'IM Fell English'"),
      document.fonts.load("italic 20px 'IM Fell English'"),
    ]);
    await document.fonts.ready;
  } catch {}
  if (!started) { started = true; requestAnimationFrame(loop); }
})();
// never wait forever for a font
setTimeout(() => { if (!started) { started = true; requestAnimationFrame(loop); } }, 2500);

/* ---------- debug hook for the playtest ---------------------------------- */

window.__poe = {
  get state() { return G.state; },
  get score() { return G.score; },
  get composure() { return G.composure; },
  get progress() { return G.u; },
  get watched() { return !!G.win; },
  get level() { return { level: +V.level.toFixed(3), env: +V.env.toFixed(3), peak: +(heart.peak || 0).toFixed(3) }; },
  get stats() { return { hit: G.beatsHit, perfects: G.perfects, misses: G.misses, tells: G.tells, streak: G.streak }; },
  /** the audio-stream time being heard right now: the clock taps are judged on */
  now: () => heart.heardAt(),
  latency: () => heart.latency,
  perfect: () => perfectWindow(G.u),
  /** upcoming judged beats as heard-clock times, plus whether they are free (watched) */
  upcoming: () => G.beats.filter((b) => !b.judged).map((b) => ({ t: b.t, free: b.free })),
  setSpeed: (k) => { k = Math.max(0.1, k); if (G.state === 'play') G.startAt = heart.now - G.t / k; G.speed = k; },
  start: () => { if (G.state === 'title') tap(); },
  tap,
  forceConfess: () => { if (G.state === 'play') { G.composure = 0; confess(); } },
  forceDawn: () => { if (G.state === 'play') dawn(); },
  setComposure: (c) => { G.composure = c; },
};
