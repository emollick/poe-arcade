/* THE RAVEN — "Nevermore"
 * A wordplay nerve game against a guttering lamp. Pure SVG plate, DOM cards,
 * Web Audio synthesis. No assets, no libraries.
 */
import { mountBack, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';
import { QUESTIONS, NAME_QUESTION, LINES } from './questions.js';

mountBack();

/* ───────────────────────── constants ───────────────────────── */
const WIN_SAFE   = 18;   // mercies to reach the dawn
const MAX_STEPS  = 5;    // shadow steps before it covers the narrator
const BEST_KEY   = 'the-raven:best';
const SVG_NS     = 'http://www.w3.org/2000/svg';

/* ───────────────────────── DOM ───────────────────────── */
const $ = (s) => document.querySelector(s);
const stage = $('#stage'), plate = $('#plate'), line = $('#line');
const deck = $('#deck'), cards = [...deck.querySelectorAll('.card')];
const hudScore = $('#hudScore b'), hudStreak = $('#hudStreak b'), hudSafe = $('#hudSafe b');
const titleUI = $('#titleUI'), endUI = $('#endUI'), bestEl = $('#best');
const flame = $('#flame'), shadow = $('#shadow'), shroud = $('#shroud');
const raven = $('#raven'), ravenBody = $('#ravenBody'), word = $('#word');
const drape = $('#drape'), narrator = $('#narrator'), feathers = $('#feathers');
const RM = prefersReducedMotion();
if (RM) stage.classList.add('rm');

/* normalise every stroke so the draw-in runs at one speed for all of them */
for (const el of plate.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon')) el.setAttribute('pathLength', '1');
for (const el of deck.querySelectorAll('.frame rect')) el.setAttribute('pathLength', '1');
/* card frames are drawn in real pixels so the draw-in runs true at any card size */
function fitFrames() {
  for (const c of cards) {
    const w = Math.round(c.clientWidth), h = Math.round(c.clientHeight);
    const f = c.querySelector('.frame'); if (!w || !h) continue;
    f.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const set = (sel, x, y, ww, hh) => { const r = f.querySelector(sel); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', ww); r.setAttribute('height', hh); };
    set('.bg', 0, 0, w, h); set('.outer', 1.5, 1.5, w - 3, h - 3); set('.inner', 5.5, 5.5, w - 11, h - 11);
  }
}
addEventListener('resize', () => requestAnimationFrame(fitFrames), { passive: true });

/* portrait phones look through a window onto the middle of the plate, framed so
 * the chair and the whole lamp (the round timer) with its halo stay in shot */
function fitPlate() {
  const portrait = innerWidth / innerHeight < 5 / 6;
  plate.setAttribute('viewBox', portrait ? '350 0 780 900' : '0 0 1400 900');
  plate.setAttribute('preserveAspectRatio', portrait ? 'xMidYMid meet' : 'xMidYMax meet');
}
addEventListener('resize', fitPlate, { passive: true });
fitPlate();

/* ───────────────────────── audio (all synthesised) ───────────────────────── */
const A = createAudio();
A.setVolume(0.85);
let noiseBuf = null;
function noiseSrc(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
}
function env(c, g, t, pts) {          // pts: [[dt, value], …] relative to t
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
  for (const [dt, v] of pts) g.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + dt);
}
const sfx = {
  ready() { const c = A.ctx; return (c && c.state === 'running') ? c : null; },
  /* "Nevermore": two croaked syllables — saw + noise through three formant band-passes, pitch sweeping down */
  croak() {
    const c = this.ready(); if (!c) return;
    const t = c.currentTime;
    const syl = (t0, f0, f1, dur, fmts, vol) => {
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t0); osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const nz = noiseSrc(c); const nzg = c.createGain(); nzg.gain.value = 0.45;
      const shaper = c.createWaveShaper(); const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.6); }
      shaper.curve = curve;
      const mix = c.createGain(); mix.gain.value = 0.9;
      osc.connect(mix); nz.connect(nzg).connect(mix); mix.connect(shaper);
      const out = c.createGain(); out.connect(A.master);
      for (const [f, q, g] of fmts) {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const fg = c.createGain(); fg.gain.value = g;
        shaper.connect(bp).connect(fg).connect(out);
      }
      env(c, out, t0, [[0.02, vol], [dur * 0.55, vol * 0.7], [dur, 0]]);
      osc.start(t0); nz.start(t0); osc.stop(t0 + dur + 0.05); nz.stop(t0 + dur + 0.05);
    };
    syl(t,        180, 95, 0.22, [[420, 7, 1.0], [1150, 9, 0.55], [2500, 10, 0.3]], 0.7);
    syl(t + 0.24, 150, 60, 0.36, [[340, 6, 1.0], [900, 8, 0.6],  [2200, 10, 0.25]], 0.8);
  },
  flap(n = 3, t0 = 0) {
    const c = this.ready(); if (!c) return;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + t0 + i * 0.17;
      const nz = noiseSrc(c); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.13);
      const g = c.createGain(); nz.connect(lp).connect(g).connect(A.master);
      env(c, g, t, [[0.03, 0.5], [0.15, 0]]);
      nz.start(t); nz.stop(t + 0.2);
    }
  },
  gutter() {
    const c = this.ready(); if (!c) return;
    const t = c.currentTime;
    const nz = noiseSrc(c); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const g = c.createGain(); nz.connect(bp).connect(g).connect(A.master);
    env(c, g, t, [[0.05, 0.10], [0.15, 0.03], [0.25, 0.12], [0.38, 0.02], [0.5, 0.09], [0.7, 0]]);
    nz.start(t); nz.stop(t + 0.75);
  },
  rustle() {
    const c = this.ready(); if (!c) return;
    const t = c.currentTime;
    const nz = noiseSrc(c); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = c.createGain(); nz.connect(hp).connect(g).connect(A.master);
    const pts = []; for (let i = 0; i < 6; i++) { pts.push([i * 0.2 + 0.08, 0.05 + Math.random() * 0.05]); pts.push([i * 0.2 + 0.2, 0.01]); }
    pts.push([1.35, 0]);
    env(c, g, t, pts); nz.start(t); nz.stop(t + 1.4);
  },
  tap(n = 3) {
    const c = this.ready(); if (!c) return;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + i * 0.19;
      const nz = noiseSrc(c); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 5;
      const g = c.createGain(); nz.connect(bp).connect(g).connect(A.master);
      env(c, g, t, [[0.004, 0.45], [0.05, 0]]); nz.start(t); nz.stop(t + 0.06);
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 170;
      const og = c.createGain(); o.connect(og).connect(A.master);
      env(c, og, t, [[0.004, 0.25], [0.06, 0]]); o.start(t); o.stop(t + 0.07);
    }
  },
  note(step = 0) {
    const c = this.ready(); if (!c) return;
    const t = c.currentTime, base = 659.25 * Math.pow(2, Math.min(step, 7) / 12);
    for (const [ratio, vol, dur] of [[1, 0.32, 1.2], [2.01, 0.12, 0.7], [3.0, 0.05, 0.4], [0.5, 0.1, 1.0]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = base * ratio;
      const g = c.createGain(); o.connect(g).connect(A.master);
      env(c, g, t, [[0.008, vol], [dur, 0]]); o.start(t); o.stop(t + dur + 0.05);
    }
  },
  thud() {
    const c = this.ready(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(76, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    const g = c.createGain(); o.connect(g).connect(A.master);
    env(c, g, t, [[0.01, 0.9], [0.4, 0]]); o.start(t); o.stop(t + 0.45);
    const nz = noiseSrc(c); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const ng = c.createGain(); nz.connect(lp).connect(ng).connect(A.master);
    env(c, ng, t, [[0.01, 0.5], [0.12, 0]]); nz.start(t); nz.stop(t + 0.15);
  },
  relight() {
    const c = this.ready(); if (!c) return;
    const t = c.currentTime;
    const nz = noiseSrc(c); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = c.createGain(); nz.connect(lp).connect(g).connect(A.master);
    env(c, g, t, [[0.04, 0.14], [0.22, 0]]); nz.start(t); nz.stop(t + 0.25);
  },
};
$('#mute').addEventListener('click', (e) => {
  const on = !e.currentTarget.classList.toggle('off');
  A.setMuted(!on); e.currentTarget.setAttribute('aria-label', on ? 'Mute' : 'Unmute');
});

/* ───────────────────────── helpers ───────────────────────── */
const rnd = (n) => Math.floor(Math.random() * n);
const pickOne = (arr) => arr[rnd(arr.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function roman(n) {
  if (n <= 0) return '0';
  const t = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function reflow(el) { void el.offsetWidth; }
function restartClass(el, cls) { el.classList.remove(cls); reflow(el); el.classList.add(cls); }
function setLine(text, opts = {}) {
  line.textContent = text;
  line.classList.toggle('hint', !!opts.hint);
  if (opts.tremble && !RM) restartClass(line, 'tremble');
}
function spawnFeather(x, y, scatter) {
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', '#featherSil');
  u.style.setProperty('--fx', x + 'px'); u.style.setProperty('--fy', y + 'px');
  if (scatter) {
    u.classList.add('scatter');
    u.style.setProperty('--sx', (rnd(500) - 250) + 'px'); u.style.setProperty('--sy', (rnd(380) - 120) + 'px');
    u.style.setProperty('--sr', (rnd(720) - 360) + 'deg');
  }
  feathers.appendChild(u);
  u.addEventListener('animationend', () => u.remove(), { once: true });
  if (RM) setTimeout(() => u.remove(), 100);
}

/* ───────────────────────── question pools ───────────────────────── */
const pools = {};
function drawFrom(tier, safe) {
  const key = tier + (safe ? 's' : 'r');
  if (!pools[key] || !pools[key].length) pools[key] = shuffle(QUESTIONS.filter((q) => q.tier === tier && q.safe === safe));
  return pools[key].pop();
}
function tierFor(round) {
  const r = Math.random();
  if (round <= 5)  return 1;
  if (round <= 10) return r < 0.7 ? 2 : 1;
  return r < 0.55 ? 3 : (r < 0.9 ? 2 : 1);
}
function durationFor(round, tier) {
  let d = Math.max(2800, 7400 - round * 270);
  if (tier === 3) d += 700; else if (tier === 2) d += 250;
  return d;
}

/* ───────────────────────── game state ───────────────────────── */
const G = {
  phase: 'title', round: 0, score: 0, streak: 0, best: 0, safe: 0, steps: 0,
  dealt: [], token: 0, t0: 0, dur: 0, raf: 0, guttered: false, tier3Shown: false, nameUsed: false,
  tricks: { swap: false, croak: false },
};
let best = loadState(BEST_KEY, null);
function showBest() {
  if (best && typeof best.score === 'number') {
    bestEl.textContent = `BEST · ${best.score.toLocaleString()} · ${roman(best.safe || 0)} MERCIES${best.won ? ' · REACHED THE DAWN' : ''}`;
  } else bestEl.textContent = 'NO ONE HAS ASKED YET';
}
showBest();

function hud(bump) {
  hudScore.textContent = G.score.toLocaleString();
  hudStreak.textContent = '×' + mult();
  hudSafe.textContent = roman(G.safe);
  if (bump) restartClass(bump, 'bump');
}
function mult() { return Math.min(5, 1 + Math.floor(G.streak / 3)); }
function setLamp(v) { stage.style.setProperty('--lamp', String(Math.max(0, Math.min(1, v)))); }
function setShadow(k, extra) {
  const s = extra || { tx: -k * 22, ty: k * 2, sx: 1 + k * 0.22, sy: 1 + k * 0.26 };
  shadow.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.sx}, ${s.sy})`;
}

/* ───────────────────────── the clock (the lamp) ───────────────────────── */
function lightLamp(dur) {
  flame.classList.remove('gutter');
  flame.style.transition = 'none'; flame.style.transform = 'scaleY(1)'; reflow(flame);
  if (RM) return;
  flame.style.transition = `transform ${dur}ms linear`; flame.style.transform = 'scaleY(0.05)';
}
function freezeLamp(frac) {
  flame.classList.remove('gutter');
  flame.style.transition = 'none'; flame.style.transform = `scaleY(${Math.max(0.05, frac)})`;
}
function timeLeft() { return Math.max(0, 1 - (performance.now() - G.t0) / G.dur); }
function tick() {
  if (G.phase !== 'await') return;
  const frac = timeLeft();
  if (frac <= 0.3 && !G.guttered) { G.guttered = true; flame.classList.add('gutter'); sfx.gutter(); }
  if (frac <= 0) { ravenChooses(); return; }
  G.raf = requestAnimationFrame(tick);
}

/* ───────────────────────── rounds ───────────────────────── */
function layoutCards() {
  for (const c of cards) c.querySelector('.num').textContent = ['I', 'II', 'III'][+c.dataset.slot];
}
async function deal() {
  const token = ++G.token;
  G.round++;
  G.phase = 'deal';
  const tier = tierFor(G.round);
  const nSafe = Math.random() < 0.35 ? 2 : 1;
  const hand = [];
  for (let i = 0; i < nSafe; i++) hand.push(drawFrom(tier, true));
  for (let i = nSafe; i < 3; i++) hand.push(drawFrom(tier, false));
  if (!G.nameUsed && G.round >= 3 && G.round <= 6 && Math.random() < 0.5) { hand[0] = NAME_QUESTION; G.nameUsed = true; }
  shuffle(hand);
  G.dealt = hand;
  G.tricks.swap  = G.round >= 7 && Math.random() < 0.32;
  G.tricks.croak = G.round >= 9 && Math.random() < 0.3;

  cards.forEach((c, i) => {
    c.dataset.slot = String(i);
    c.className = 'card'; c.disabled = false;
    c.querySelector('.q').textContent = hand[i].q;
  });
  layoutCards();
  reflow(deck);
  fitFrames();
  cards.forEach((c) => c.classList.add('dealt'));
  word.classList.add('gone');

  // a line for the round
  if (tier === 3 && !G.tier3Shown) { G.tier3Shown = true; setLine(LINES.hintTier3, { hint: true }); }
  else if (G.tricks.croak) setLine(LINES.hintCroak, { hint: true });
  else if (G.tricks.swap) setLine(LINES.hintSwap, { hint: true });
  else if (G.round === 1) setLine(LINES.open[0]);

  sfx.tap(3);
  if (G.steps > 0 || G.round > 1) sfx.relight();
  if (G.tricks.croak) { restartClass(raven, 'flap'); sfx.flap(3, 0.1); }

  // the lamp is lit; the clock runs
  G.dur = durationFor(G.round, tier) * (G.tricks.croak ? 0.6 : 1);
  G.t0 = performance.now(); G.guttered = false;
  lightLamp(G.dur);
  G.phase = 'await';
  cancelAnimationFrame(G.raf); G.raf = requestAnimationFrame(tick);

  if (G.tricks.swap) {
    await wait(Math.min(1100, G.dur * 0.3));
    if (token !== G.token || G.phase !== 'await') return;
    const a = rnd(3); let b = rnd(3); if (b === a) b = (a + 1) % 3;
    const ca = cards.find((c) => +c.dataset.slot === a), cb = cards.find((c) => +c.dataset.slot === b);
    ca.classList.add('swapping'); cb.classList.add('swapping');
    ca.dataset.slot = String(b); cb.dataset.slot = String(a);
    layoutCards();
    restartClass(drape, 'rustle'); sfx.rustle();
  }
}

function cardInSlot(slot) { return cards.find((c) => +c.dataset.slot === slot); }
function pick(slot, byRaven = false) {
  if (G.phase !== 'await') return;
  const card = cardInSlot(slot); if (!card) return;
  const idx = cards.indexOf(card), q = G.dealt[idx];
  const frac = byRaven ? 0 : timeLeft();
  G.phase = 'resolve'; cancelAnimationFrame(G.raf);
  freezeLamp(frac);
  card.classList.add('picked', q.safe ? 'safe' : 'ruin');
  if (byRaven) card.classList.add('byRaven');
  for (const c of cards) { c.disabled = true; if (c !== card) c.classList.add('dim'); }
  resolve(q, frac, byRaven);
}
function ravenChooses() {
  const ruin = cards.map((c, i) => ({ c, i })).filter(({ i }) => !G.dealt[i].safe);
  const target = ruin.length ? pickOne(ruin).c : pickOne(cards);
  pick(+target.dataset.slot, true);
}

async function resolve(q, frac, byRaven) {
  const token = G.token;
  // the Raven answers
  restartClass(ravenBody, 'croak');
  word.classList.remove('gone'); restartClass(word, 'croak');
  sfx.croak();
  await wait(RM ? 200 : 560);
  if (token !== G.token) return;

  if (q.safe) {
    G.streak++; G.safe++;
    const bonus = Math.round(frac * 100);
    G.score += 100 * mult() + bonus;
    setLamp(1);
    sfx.note(G.streak);
    spawnFeather(690 + rnd(40) - 20, 130);
    setLine(pickOne(LINES.safe));
    hud(hudScore.parentElement);
  } else {
    G.streak = 0; G.steps++;
    setShadow(G.steps);
    setLamp(1 - (G.steps / MAX_STEPS) * 0.85);
    sfx.thud();
    if (!RM) { restartClass(narrator, 'tremble'); }
    setLine(byRaven ? `${pickOne(LINES.timeout)} ${q.gloss}` : `${q.gloss} ${pickOne(LINES.ruin)}`, { tremble: true });
    hud(hudStreak.parentElement);
  }

  await wait(RM ? 700 : 1350);
  if (token !== G.token) return;
  word.classList.add('gone');
  if (G.safe >= WIN_SAFE) return finish(true);
  if (G.steps >= MAX_STEPS) return finish(false);
  await wait(250);
  if (token !== G.token) return;
  deal();
}

/* ───────────────────────── beginnings and endings ───────────────────────── */
function resetPlate() {
  stage.classList.remove('dawn');
  raven.classList.remove('fly', 'flap'); raven.classList.add('idle');
  shadow.style.transition = 'none'; setShadow(0); reflow(shadow); shadow.style.transition = '';
  shroud.style.transition = 'none'; shroud.style.opacity = '0'; reflow(shroud); shroud.style.transition = '';
  feathers.replaceChildren();
  setLamp(1);
  freezeLamp(1);
  word.classList.remove('croak'); word.classList.add('gone');
}
function start() {
  G.token++; cancelAnimationFrame(G.raf);
  Object.assign(G, { round: 0, score: 0, streak: 0, safe: 0, steps: 0, guttered: false, tier3Shown: false, nameUsed: false });
  for (const k in pools) delete pools[k];
  resetPlate();
  endUI.hidden = true;
  stage.classList.remove('is-title', 'is-end'); stage.classList.add('is-play');
  hud();
  setLine(LINES.open[0]);
  deal();
}
async function finish(won) {
  const token = ++G.token;
  G.phase = 'end'; cancelAnimationFrame(G.raf);
  stage.classList.remove('is-play'); stage.classList.add('is-end');
  const rec = { score: G.score, safe: G.safe, won, round: G.round, when: Date.now() };
  const isBest = !best || G.score > best.score || (G.score === best.score && won && !best.won);
  if (isBest) { best = rec; saveState(BEST_KEY, rec); showBest(); }

  if (won) {
    stage.classList.add('dawn');
    setShadow(0, { tx: 60, ty: 0, sx: 0.15, sy: 0.3 });
    setLamp(1);
    setLine(LINES.win);
    await wait(RM ? 200 : 900); if (token !== G.token) return;
    raven.classList.remove('idle'); raven.classList.add('fly');
    sfx.flap(6, 0);
    for (let i = 0; i < 9; i++) spawnFeather(700 + rnd(120) - 60, 120 + rnd(40), true);
    await wait(RM ? 300 : 2300); if (token !== G.token) return;
    sfx.note(9);
  } else {
    setShadow(MAX_STEPS, { tx: -150, ty: 6, sx: 2.7, sy: 2.6 });
    shroud.style.opacity = '0.92';
    setLamp(0); flame.classList.remove('gutter');
    flame.style.transition = 'transform 1.2s ease'; flame.style.transform = 'scaleY(0.02)';
    setLine(LINES.lose, { tremble: true });
    sfx.thud();
    await wait(RM ? 200 : 1100); if (token !== G.token) return;
    restartClass(ravenBody, 'croak'); word.classList.remove('gone'); restartClass(word, 'croak'); sfx.croak();
    await wait(RM ? 300 : 1500); if (token !== G.token) return;
  }
  $('#endTitle').textContent = won ? 'THE DAWN · THE BIRD IS GONE' : 'THE SHADOW HAS YOU';
  $('#endLine').textContent = won ? LINES.win : LINES.lose;
  $('#endScore').innerHTML = `<b>${G.score.toLocaleString()}</b> · ${roman(G.safe)} MERCIES · ${roman(G.round)} QUESTIONS${isBest ? ' · A NEW BEST' : ''}`;
  endUI.hidden = false;
  $('#again').focus({ preventScroll: true });
}
function toTitle() {
  G.token++; cancelAnimationFrame(G.raf);
  G.phase = 'title';
  resetPlate();
  word.classList.remove('gone', 'croak');
  endUI.hidden = true;
  stage.classList.remove('is-play', 'is-end'); stage.classList.add('is-title');
  showBest();
}

/* ───────────────────────── input ───────────────────────── */
cards.forEach((c) => {
  c.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType !== 'mouse') { e.preventDefault(); pick(+c.dataset.slot); } });
  c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(+c.dataset.slot); } });
});
$('#begin').addEventListener('click', start);
$('#again').addEventListener('click', start);
addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (G.phase === 'await' && /^[123]$/.test(e.key)) { e.preventDefault(); pick(+e.key - 1); return; }
  if (G.phase === 'title' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); start(); return; }
  if (G.phase === 'end' && !endUI.hidden && (e.key === 'Enter' || e.key === ' ') && document.activeElement !== $('#again')) { e.preventDefault(); start(); return; }
  if (e.key === 'Escape' && G.phase !== 'title') toTitle();
  if (e.key.toLowerCase() === 'm') $('#mute').click();
});

/* idle life for the bird once the plate has drawn itself */
setTimeout(() => raven.classList.add('idle'), RM ? 0 : 3200);

/* a hook for the playtest harness */
window.__poe = {
  get state() { return { phase: G.phase, round: G.round, score: G.score, streak: G.streak, safe: G.safe, steps: G.steps, timeLeft: G.phase === 'await' ? timeLeft() : 0 }; },
  safeSlots() { return cards.filter((c, i) => G.dealt[i] && G.dealt[i].safe).map((c) => +c.dataset.slot); },
  ruinSlots() { return cards.filter((c, i) => G.dealt[i] && !G.dealt[i].safe).map((c) => +c.dataset.slot); },
  pick, start, toTitle, finish,
  questions: QUESTIONS.length,
};
