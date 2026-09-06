/* The Gold-Bug — game.js
 * Kidd's Cipher: a substitution-cipher race against the rival with the spade.
 */
import { mountBack, saveState, loadState, prefersReducedMotion, onFirstGesture } from '/shared/poe.js';
import { ROUNDS, HINTS, buildCipher } from './ciphers.js';
import { paintParchment, parchmentDataURL } from './parchment.js';
import { createMap } from './map.js';
import { sound } from './audio.js';

mountBack();

const $ = (id) => document.getElementById(id);
const reduced = prefersReducedMotion();
const ROMAN = ['I', 'II', 'III'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const STUCK_SECONDS = 25;
const HINT_FIRST = 9, HINT_EVERY = 14;

/* Special Elite has no double dagger, so Kidd's ‡ is set as a † with a second
 * bar drawn by CSS — every mark then comes from the one typewriter face. */
function symHTML(sym) { return sym === '‡' ? '<b class="dd">†</b>' : `<b>${sym}</b>`; }

/* ---------- parchment + embers ---------- */
const parch = $('parchment'), embers = $('embers');
let edgeBottom = null, parchScale = 1;
function isPhone() { return innerWidth <= 760; }
function drawParchment() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  parch.width = W; parch.height = H; embers.width = W; embers.height = Math.ceil(H * 0.3);
  embers.style.top = ''; embers.style.height = '30%'; embers.style.bottom = '0'; embers.style.top = 'auto';
  parchScale = dpr;
  const phone = isPhone();
  const res = paintParchment(parch, {
    seed: 1843, scale: dpr,
    burn: { top: 14 * dpr, right: (phone ? 8 : 26) * dpr, left: (phone ? 8 : 26) * dpr, bottom: (phone ? 30 : 64) * dpr },
  });
  edgeBottom = res.edgeBottom;
}
let resizeT = 0;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(drawParchment, 220); }, { passive: true });
drawParchment();

/* Embers: glowing points along the real burnt edge, flickering. */
const ectx = embers.getContext('2d');
let emberPhase = 0;
function drawEmbers(dt) {
  if (!edgeBottom) return;
  emberPhase += dt * (reduced ? 0.2 : 1);
  const W = embers.width, H = embers.height, off = parch.height - H;
  ectx.clearRect(0, 0, W, H);
  ectx.globalCompositeOperation = 'lighter';
  const step = Math.max(2, Math.round(3 * parchScale));
  for (let x = 0; x < W; x += step) {
    const y = edgeBottom[x] - off;
    if (y < -10 || y > H + 10) continue;
    const f = 0.5 + 0.5 * Math.sin(emberPhase * 3.1 + x * 0.05) * Math.sin(emberPhase * 1.7 + x * 0.013);
    const hot = Math.pow(f, 2.2);
    const r = (2 + hot * 5) * parchScale;
    const g = ectx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    g.addColorStop(0, `rgba(255,${150 + hot * 90 | 0},${40 + hot * 60 | 0},${0.35 + hot * 0.55})`);
    g.addColorStop(0.4, `rgba(255,${80 + hot * 60 | 0},10,${0.2 + hot * 0.3})`);
    g.addColorStop(1, 'rgba(120,20,0,0)');
    ectx.fillStyle = g;
    ectx.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
  }
  ectx.globalCompositeOperation = 'source-over';
}

/* ---------- map ---------- */
const mapEl = $('map');
mapEl.style.backgroundImage = `url(${parchmentDataURL(480, 300, 21)})`;
const map = createMap(mapEl);

/* ---------- state ---------- */
const S = {
  screen: 'title',
  roundIdx: 0, round: null, cipher: null,
  assign: {}, letterOf: {},     // sym -> letter, letter -> sym
  cells: {},                    // sym -> [cell elements]
  wordEls: [],
  selected: null, pending: null, lens: false,
  score: 0, streak: 0, bestStreak: 0, unaided: 0, autos: 0, wrongs: 0,
  elapsed: 0, knock: 0, running: false,
  lastCorrect: 0, hintIdx: 0, lastHint: 0, lastAssignTs: 0,
  autoTimerShown: false,
  totalTime: 0,
};
const best = loadState('gold-bug:best', null);
function showBest() {
  const el = $('best');
  if (best && best.score > 0) el.innerHTML = `Best <b>${best.score.toLocaleString()}</b> · ${best.won ? 'the coffer was yours' : 'reached ' + best.roundName}`;
  else el.textContent = 'No one has read the parchment yet';
}
showBest();

/* ---------- title -> play ---------- */
function startGame() {
  sound.start();
  S.screen = 'play';
  S.score = 0; S.streak = 0; S.bestStreak = 0; S.unaided = 0; S.autos = 0; S.wrongs = 0; S.totalTime = 0; S.hintIdx = 0;
  map.reset();
  // the map lives beside the text during play and inside the card at the end
  const right = document.querySelector('.right');
  if (mapEl.parentElement !== right) right.insertBefore(mapEl, $('rivalLine'));
  $('notes').innerHTML = '';
  $('title').hidden = true; $('end').hidden = true;
  document.body.classList.add('playing');
  beginRound(0);
}
$('btnStart').addEventListener('click', startGame);
$('btnAgain').addEventListener('click', startGame);

/* ---------- rounds ---------- */
function beginRound(i) {
  S.roundIdx = i; S.round = ROUNDS[i];
  S.cipher = buildCipher(S.round);
  S.assign = {}; S.letterOf = {}; S.cells = {}; S.wordEls = [];
  S.selected = null; S.pending = null;
  S.elapsed = 0; S.knock = 0; S.lastCorrect = 0; S.lastHint = 0; S.hintIdx = Math.min(S.hintIdx, HINTS.length);
  S.streak = 0;
  $('roundNum').textContent = ROMAN[i];
  $('roundName').textContent = S.round.name;
  $('rivalLine').textContent = ['The rival has landed on the shore.', 'The rival is crossing the dunes.', 'The rival is in the woods, beneath the tree.'][i];
  $('rivalLine').classList.remove('late');
  $('text').style.fontSize = (isPhone() ? [21, 19, 17] : [38, 30, 24])[i] + 'px';
  buildText();
  buildChart();
  buildKeys();
  updateHud();
  $('interlude').hidden = true;
  $('play').hidden = false;
  addNote(`<b>Round ${ROMAN[i]} · ${S.round.name}</b> — ${S.round.intro}`);
  map.setRival(i / 3, false);
  S.running = true;
  sound.spade(0);
}

function buildText() {
  const box = $('text');
  box.innerHTML = '';
  box.scrollTop = 0;
  const frag = document.createDocumentFragment();
  S.cipher.words.forEach((w, wi) => {
    const we = document.createElement('span');
    we.className = 'w' + (w.key ? ' kw' : '');
    we.dataset.w = wi;
    w.symbols.forEach((sym) => {
      const g = document.createElement('span');
      g.className = 'g'; g.dataset.s = sym;
      g.innerHTML = `${symHTML(sym)}<i></i>`;
      g.addEventListener('pointerdown', (e) => { e.preventDefault(); onSymbolTap(sym); });
      we.appendChild(g);
      (S.cells[sym] ||= []).push(g);
    });
    frag.appendChild(we);
    S.wordEls.push(we);
  });
  box.appendChild(frag);
}

function buildChart() {
  const ch = $('chart');
  ch.innerHTML = '';
  const max = S.cipher.counts[S.cipher.order[0]];
  for (const sym of S.cipher.order) {
    const col = document.createElement('div');
    col.className = 'col'; col.dataset.s = sym;
    const n = S.cipher.counts[sym];
    col.innerHTML = `<span class="n">${n}</span><div class="bar" style="height:${Math.max(6, (n / max) * 100 * 0.62)}%"></div><span class="s">${symHTML(sym)}</span><span class="l"></span>`;
    col.addEventListener('pointerdown', (e) => { e.preventDefault(); onSymbolTap(sym); });
    ch.appendChild(col);
  }
}

function buildKeys() {
  const k = $('keys');
  k.innerHTML = '';
  for (const l of LETTERS) {
    const b = document.createElement('button');
    b.className = 'key'; b.dataset.l = l; b.textContent = l;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); onLetterTap(l); });
    k.appendChild(b);
  }
}

/* ---------- selection ---------- */
function select(sym) {
  S.selected = sym;
  for (const el of document.querySelectorAll('.g.sel, .g.hi, .col.sel')) el.classList.remove('sel', 'hi');
  if (!sym) return;
  for (const c of S.cells[sym] || []) c.classList.add('hi');
  const first = (S.cells[sym] || [])[0];
  if (first) first.classList.add('sel');
  document.querySelector(`.col[data-s="${CSS.escape(sym)}"]`)?.classList.add('sel');
  // keep the first occurrence in view on phones
  if (first && isPhone()) first.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}
function setPending(letter) {
  S.pending = letter;
  for (const el of document.querySelectorAll('.key.pending')) el.classList.remove('pending');
  if (letter) document.querySelector(`.key[data-l="${letter}"]`)?.classList.add('pending');
}
function onSymbolTap(sym) {
  if (!S.running) return;
  if (S.pending) { const l = S.pending; setPending(null); select(sym); assign(sym, l); return; }
  select(sym); // tapping the selected mark keeps it selected; Escape or a blank tap clears
}
function onLetterTap(l) {
  if (!S.running) return;
  if (S.selected) { assign(S.selected, l); return; }
  setPending(S.pending === l ? null : l);
}

/* ---------- assignment: the substitution engine ---------- */
function paintSym(sym) {
  const l = S.assign[sym];
  const right = l && S.cipher.inverse[sym] === l;
  for (const c of S.cells[sym] || []) {
    c.querySelector('i').textContent = l || '';
    c.classList.remove('ok', 'bad');
    if (l) { void c.offsetWidth; c.classList.add(right ? 'ok' : 'bad'); }
    c.classList.toggle('auto', !!c.dataset.auto && !!l);
  }
  const col = document.querySelector(`.col[data-s="${CSS.escape(sym)}"]`);
  if (col) {
    col.querySelector('.l').textContent = l || '';
    col.classList.toggle('done', !!right);
    col.classList.toggle('wrong', !!l && !right);
  }
  document.querySelector(`.key[data-l="${l}"]`)?.classList.add('used');
  refreshWords();
}
function refreshWords() {
  S.cipher.words.forEach((w, i) => {
    const done = w.symbols.every((s) => S.assign[s] === S.cipher.inverse[s]);
    S.wordEls[i].classList.toggle('done', done);
  });
  for (const k of document.querySelectorAll('.key')) k.classList.toggle('used', !!S.letterOf[k.dataset.l]);
}
function unassign(sym, silent) {
  const l = S.assign[sym];
  if (!l) return;
  delete S.assign[sym]; delete S.letterOf[l];
  for (const c of S.cells[sym] || []) delete c.dataset.auto;
  paintSym(sym);
  if (!silent) sound.quill();
}
function assign(sym, letter, auto = false) {
  if (!S.running || !sym || !letter) return;
  if (S.assign[sym] === letter) return;
  // one letter, one mark: take the letter away from wherever it was
  if (S.letterOf[letter] && S.letterOf[letter] !== sym) unassign(S.letterOf[letter], true);
  if (S.assign[sym]) { delete S.letterOf[S.assign[sym]]; }
  S.assign[sym] = letter; S.letterOf[letter] = sym;
  for (const c of S.cells[sym] || []) { if (auto) c.dataset.auto = '1'; else delete c.dataset.auto; }
  paintSym(sym);
  const right = S.cipher.inverse[sym] === letter;
  S.lastAssignTs = S.elapsed;
  if (right) {
    S.lastCorrect = S.elapsed;
    if (auto) { S.autos++; S.score = Math.max(0, S.score - 100); S.streak = 0; }
    else {
      S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); S.unaided++;
      S.score += 50 + 10 * Math.min(S.streak, 10);
      sound.correct(S.streak);
    }
    checkKeywords();
    if (S.cipher.order.every((s) => S.assign[s] === S.cipher.inverse[s])) { roundWon(); return; }
    // advance to the next unsolved mark so the keyboard flow never stalls
    const next = S.cipher.order.find((s) => S.assign[s] !== S.cipher.inverse[s]);
    select(next || null);
  } else {
    S.wrongs++; S.streak = 0;
    S.elapsed += 1.2; // the rival takes a stride while you blot the page
    sound.wrong();
  }
  updateHud();
}

function checkKeywords() {
  S.cipher.words.forEach((w) => {
    if (!w.key || map.has(w.plain)) return;
    if (!w.symbols.every((s) => S.assign[s] === S.cipher.inverse[s])) return;
    map.reveal(w.plain);
    S.knock += S.round.knock;
    S.score += 100;
    sound.chime();
    $('rivalLine').textContent = landmarkLine(w.plain);
    addNote(`<b>${w.plain.toUpperCase()}</b> — ${landmarkLine(w.plain)} <span class="sym">−${S.round.knock}s</span>`);
  });
}
function landmarkLine(k) {
  return {
    island: 'The island draws itself upon the map.',
    sea: 'The Atlantic hatches in along the shore.',
    sand: 'The dunes rise; the rival slows in the sand.',
    skull: 'The death’s head comes out in the corner.',
    fire: 'Scorch marks: the parchment was held to the fire.',
    kid: 'A kid — Kidd’s own signature, in the opposite corner.',
    hostel: 'The Bishop’s Hostel: a crag among the rocks.',
    seat: 'The Devil’s Seat, a narrow ledge upon the crag.',
    glass: 'A good glass: the sight-line runs from the seat.',
    northeast: 'Twenty-one degrees and thirteen minutes, north-east and by north.',
    tree: 'The tulip tree, the tallest on the island.',
    head: 'The death’s head, nailed to the seventh limb.',
    shot: 'The shot dropped through the left eye.',
    line: 'A bee line from the tree through the shot, fifty feet out.',
  }[k] || 'A landmark appears on the map.';
}

/* ---------- rival, clock, hints ---------- */
function rivalTime() { return Math.max(0, S.elapsed - S.knock); }
function rivalProgress() { return Math.min(1, rivalTime() / S.round.budget); }
function remaining() { return Math.max(0, S.round.budget - rivalTime()); }
function fmt(s) { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function updateHud() {
  $('score').textContent = S.score.toLocaleString();
  $('streak').textContent = S.streak >= 2 ? `streak ×${S.streak}` : '';
  const r = remaining();
  $('time').textContent = fmt(r);
  $('hudTime').classList.toggle('late', r < 12);
}
function addNote(html) {
  const n = document.createElement('div');
  n.className = 'note'; n.innerHTML = html;
  const box = $('notes');
  box.prepend(n);
  while (box.children.length > 5) box.lastChild.remove();
}
let toastT = 0;
function showHint(force) {
  if (S.hintIdx >= HINTS.length && !force) return;
  const text = HINTS[S.hintIdx % HINTS.length];
  S.hintIdx++;
  S.lastHint = S.elapsed;
  if (isPhone()) {
    const t = $('toast');
    t.innerHTML = `<b>Legrand:</b> ${text}`; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6500);
  } else {
    addNote(`<b>Legrand</b> — ${text}`);
  }
  // make the hint concrete: nudge the most useful letter key
  for (const k of document.querySelectorAll('.key.hint')) k.classList.remove('hint');
  const want = ['e', 't', 'a', 'o', 'i', 'n', 's', 'h'].find((l) => !S.letterOf[l]);
  if (want) document.querySelector(`.key[data-l="${want}"]`)?.classList.add('hint');
}
$('btnHint').addEventListener('click', () => { if (S.running) showHint(true); });
$('btnLens').addEventListener('click', toggleLens);
$('btnMute').addEventListener('click', toggleMute);
function toggleLens() { S.lens = !S.lens; $('text').classList.toggle('lens', S.lens); $('btnLens').classList.toggle('on', S.lens); }
function toggleMute() { sound.setMuted(!sound.muted); $('btnMute').classList.toggle('on', sound.muted); }

function autoReveal() {
  const sym = S.cipher.order.find((s) => S.assign[s] !== S.cipher.inverse[s]);
  if (!sym) return;
  const l = S.cipher.inverse[sym];
  addNote(`<b>Legrand</b> lays a finger on the mark: <span class="sym">${symHTML(sym)}</span> is <b>${l}</b>. <span class="sym">−100</span>`);
  if (isPhone()) { const t = $('toast'); t.innerHTML = `<b>Legrand</b> lays a finger on the mark: <span class="sym">${symHTML(sym)}</span> is <b>${l}</b> (−100)`; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 5000); }
  select(sym);
  assign(sym, l, true);
}

/* ---------- round end / game end ---------- */
function roundWon() {
  S.running = false;
  sound.spade(-1);
  const rem = remaining();
  const bonus = Math.round(rem * 10);
  S.score += bonus;
  S.totalTime += S.elapsed;
  updateHud();
  select(null);
  if (S.roundIdx >= ROUNDS.length - 1) { map.reveal('x'); setTimeout(() => endGame(true), reduced ? 300 : 1600); return; }
  sound.roundWin();
  const next = ROUNDS[S.roundIdx + 1];
  $('iKicker').textContent = `Round ${ROMAN[S.roundIdx]} read clean · Round ${ROMAN[S.roundIdx + 1]} follows`;
  $('iTitle').textContent = next.name;
  $('iPlain').textContent = '“' + S.round.text + '”';
  $('iBody').textContent = next.intro;
  $('iBonus').textContent = `+${bonus} for ${fmt(rem)} to spare · score ${S.score.toLocaleString()}`;
  S.screen = 'interlude';
  setTimeout(() => { $('play').hidden = true; $('interlude').hidden = false; sound.page(); }, reduced ? 100 : 700);
  interludeT = setTimeout(continueInterlude, 5200);
}
let interludeT = 0;
function continueInterlude() {
  if (S.screen !== 'interlude') return;
  clearTimeout(interludeT);
  S.screen = 'play';
  beginRound(S.roundIdx + 1);
}
function endGame(won) {
  S.running = false;
  S.screen = 'end';
  sound.spade(-1);
  if (won) sound.brass(); else sound.lose();
  const e = $('end');
  e.classList.toggle('win', won); e.classList.toggle('lose', !won);
  $('eKicker').textContent = won ? 'The map reads clean' : `The rival’s spade struck first · Round ${ROMAN[S.roundIdx]}`;
  $('eTitle').textContent = won ? 'THE COFFER' : 'ANOTHER MAN’S';
  $('eQuote').textContent = won
    ? '…an oblong chest of wood, which, from its perfect preservation and wonderful hardness, had plainly been subjected to some mineralizing process. It was firmly secured by bands of wrought iron.'
    : '“We dug very steadily for two hours.” — and at the last the spade struck iron, and the hand upon it was not yours.';
  $('eSrc').textContent = won ? 'Edgar Allan Poe, The Gold-Bug' : 'after Edgar Allan Poe, The Gold-Bug';
  $('eScore').textContent = S.score.toLocaleString();
  const prev = loadState('gold-bug:best', null);
  const isBest = !prev || S.score > prev.score;
  if (isBest) {
    saveState('gold-bug:best', { score: S.score, round: S.roundIdx + 1, roundName: S.round.name, won, date: Date.now() });
    if (best) Object.assign(best, { score: S.score, roundName: S.round.name, won }); 
  }
  $('eBest').textContent = isBest ? 'a new best' : `best ${prev.score.toLocaleString()}`;
  $('eStats').innerHTML = `${S.unaided} marks read unaided · longest streak ${S.bestStreak} · ${S.autos} laid on by Legrand · ${S.wrongs} blots`;
  showBestFrom();
  setTimeout(() => {
    $('play').hidden = true; $('interlude').hidden = true;
    $('eMap').appendChild(mapEl);
    e.hidden = false;
  }, won ? 400 : 900);
}
function showBestFrom() {
  const b = loadState('gold-bug:best', null);
  const el = $('best');
  if (b && b.score > 0) el.innerHTML = `Best <b>${b.score.toLocaleString()}</b> · ${b.won ? 'the coffer was yours' : 'reached ' + b.roundName}`;
}

/* ---------- keyboard ---------- */
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (S.screen === 'title') { if (k === 'Enter' || k === ' ') { e.preventDefault(); startGame(); } return; }
  if (S.screen === 'interlude') { e.preventDefault(); continueInterlude(); return; }
  if (S.screen === 'end') { if (k === 'Enter' || k === ' ') { e.preventDefault(); startGame(); } return; }
  if (!S.running) return;
  if (/^[a-zA-Z]$/.test(k)) {
    const l = k.toLowerCase();
    if (!S.selected) {
      // no mark chosen: choose the most frequent unsolved one and type into it
      const next = S.cipher.order.find((s) => S.assign[s] !== S.cipher.inverse[s]);
      select(next || null);
    }
    if (S.selected) assign(S.selected, l);
    e.preventDefault();
  } else if (k === '1') { showHint(true); e.preventDefault();
  } else if (k === '2') { toggleLens(); e.preventDefault();
  } else if (k === '3') { toggleMute(); e.preventDefault();
  } else if (k === 'Backspace' || k === 'Delete') {
    if (S.selected) unassign(S.selected);
    e.preventDefault();
  } else if (k === 'Escape') {
    select(null); setPending(null);
  } else if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'Tab') {
    e.preventDefault();
    const order = S.cipher.order;
    let i = order.indexOf(S.selected);
    const dir = k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey) ? -1 : 1;
    i = (i + dir + order.length) % order.length;
    select(order[i]);
  } else if (k === ' ' || k === 'Enter') {
    e.preventDefault();
    const order = S.cipher.order;
    const from = order.indexOf(S.selected);
    for (let j = 1; j <= order.length; j++) {
      const s = order[(from + j) % order.length];
      if (S.assign[s] !== S.cipher.inverse[s]) { select(s); break; }
    }
  }
});
$('interlude').addEventListener('pointerdown', continueInterlude);
$('text').addEventListener('pointerdown', (e) => { if (e.target === e.currentTarget) { select(null); setPending(null); } });

/* ---------- main loop ---------- */
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  drawEmbers(dt);
  if (S.running) {
    S.elapsed += dt;
    const p = rivalProgress();
    map.setRival((S.roundIdx + p) / 3, p > 0.7);
    sound.spade(p);
    updateHud();
    if (p >= 1) { endGame(false); }
    else {
      if (p > 0.75 && !$('rivalLine').classList.contains('late')) { $('rivalLine').classList.add('late'); $('rivalLine').textContent = 'He is nearly at the tree. Read faster.'; }
      const sinceHint = S.elapsed - S.lastHint;
      if (S.hintIdx < HINTS.length && ((S.lastHint === 0 && S.elapsed > HINT_FIRST) || (S.lastHint > 0 && sinceHint > HINT_EVERY))) showHint(false);
      if (S.elapsed - S.lastCorrect > STUCK_SECONDS) autoReveal();
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ---------- unlock audio on the first gesture, wherever it lands ---------- */
onFirstGesture(() => sound.start());

/* ---------- hook for the playtest harness ---------- */
window.__poe = {
  get state() { return S; },
  solution() { return S.cipher ? { ...S.cipher.inverse } : null; },
  assign: (sym, l) => assign(sym, l),
  select,
  start: startGame,
  skipInterlude: continueInterlude,
  rush: (secs) => { S.elapsed += secs; },
  map,
};
