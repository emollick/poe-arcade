/* poe-arcade — launcher/launcher.js
 * Builds the nine drawers, lights the candle, drifts the dust, opens the doors.
 */
import { fitCanvas, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';
import { SPECIMENS } from './specimens.js';

const GAMES = [
  /* the hints and blurbs follow each game's NOTES.md; keep them in step */
  { slug: 'tell-tale-heart',  title: 'Under the Boards',    story: 'The Tell-Tale Heart',
    c1: '#0a0908', c2: '#7a0f12',
    line: 'The officers sit above the boards and the boards keep time. Keep the beat, and keep your composure.',
    keys: 'keys: space', touch: 'touch: tap' },
  { slug: 'masque-red-death', title: 'Seven Chambers',      story: 'The Masque of the Red Death',
    c1: '#1a0b2e', c2: '#c8102e',
    line: 'The ebony clock strikes and he walks. Reach the next chamber before the last chime.',
    keys: 'keys: ← → · space to dash', touch: 'touch: hold a side, double-tap to dash' },
  { slug: 'pit-and-pendulum', title: 'The Descending Blade', story: 'The Pit and the Pendulum',
    c1: '#0b0a08', c2: '#c4602a',
    line: 'Each sweep comes a little lower. Hop the rats, shun the pit, and last until the trumpets.',
    keys: 'keys: ← → · space to hop', touch: 'touch: tap the sides to walk, the middle to hop' },
  { slug: 'house-of-usher',   title: 'Fissure',             story: 'The Fall of the House of Usher',
    c1: '#1c2230', c2: '#8b1a1a',
    line: 'A fissure creeps from the roof toward the tarn. Brace each wall as the storm finds it; hold the house up till dawn.',
    keys: 'keys: click the marks (1–6)', touch: 'touch: tap' },
  { slug: 'maelstrom',        title: 'The Vortex',          story: 'A Descent into the Maelström',
    c1: '#030507', c2: '#b9e6dc',
    line: 'Into the whirl. Lash yourself to the casks and spars that rise, let go of whatever plunges, and outlast the tide.',
    keys: 'keys: ← → ↑ space', touch: 'touch: drag, tap' },
  { slug: 'gold-bug',         title: "Kidd's Cipher",       story: 'The Gold-Bug',
    c1: '#d9c39a', c2: '#c9a227',
    line: "Break Captain Kidd's cipher before the rival's spade finds the tree.",
    keys: 'keys: click a mark, type', touch: 'touch: tap a mark, then a letter' },
  { slug: 'amontillado',      title: 'Brick by Brick',      story: 'The Cask of Amontillado',
    c1: '#0e0d0b', c2: '#d98b2b',
    line: 'For the love of God, Montresor. Eleven tiers to lay true before the torch burns out.',
    keys: 'keys: space (hold to listen)', touch: 'touch: tap (hold to listen)' },
  { slug: 'the-raven',        title: 'Nevermore',           story: 'The Raven',
    c1: '#efe6d3', c2: '#111111',
    line: 'Quoth the Raven. Ask only what you can bear to hear answered Nevermore, before the lamp burns out.',
    keys: 'keys: 1 · 2 · 3', touch: 'touch: tap a card' },
  { slug: 'black-cat',        title: 'Pluto',               story: 'The Black Cat',
    c1: '#e8dfcf', c2: '#b5c93a',
    line: 'The police are in the cellar. Plaster over the damp and the eye before the lantern finds what is in the wall.',
    keys: 'mouse: drag to plaster', touch: 'touch: drag' },
];

const $ = (s, r = document) => r.querySelector(s);
const reduced = prefersReducedMotion();
if (reduced) document.documentElement.classList.add('reduced');
const isPhone = () => matchMedia('(max-width: 760px)').matches;

/* ---------- build the drawers ---------------------------------------------- */

const drawers = $('#drawers');
const bestOf = (slug) => {
  const s = loadState(slug + ':best', null);
  const n = s && typeof s === 'object' ? s.score : s;
  return typeof n === 'number' && isFinite(n) ? Math.round(n) : null;
};

drawers.innerHTML = GAMES.map((g, i) => {
  const best = bestOf(g.slug);
  return `
  <li class="drawer" data-slug="${g.slug}" style="--c1:${g.c1};--c2:${g.c2}">
    <a class="front" href="games/${g.slug}/index.html" aria-describedby="tag-${g.slug}">
      <div class="window">
        ${SPECIMENS[g.slug]()}
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      </div>
      <div class="plate">
        <span class="title">${g.title}</span>
        <span class="story">${g.story}</span>
      </div>
      <span class="no">specimen no. ${i + 1}</span>
    </a>
    <div class="tag" id="tag-${g.slug}">
      <p class="line">${g.line}</p>
      <p class="meta">
        <span class="hint">${g.keys} · ${g.touch}</span>
        <span class="best${best != null ? ' has' : ''}">best: ${best != null ? best : '—'}</span>
      </p>
      <button class="enter" type="button">Open the drawer</button>
    </div>
  </li>`;
}).join('');

/* ---------- the cabinet doors --------------------------------------------- */

const cabinet = $('#cabinet');
const SWING = 500;                 // ms the doors are given to swing before a click made through them leaves the page
const PULL = 420;                  // ms the drawer pulls out before the game loads
let open = isPhone();
let openedAt = -Infinity;
if (open) cabinet.classList.add('open');

function openDoors() {
  if (open) return;
  open = true;
  openedAt = performance.now();
  cabinet.classList.add('open');
  $('#hint').setAttribute('aria-hidden', 'true');
  stopWaiting();
}

/* The closed doors are the poster, not a gate: the first pointer move, any
 * key, or 1.2s of idling opens them, whichever comes first. Phones never
 * have doors. `?poster` keeps them shut until a click, for screenshots. */
const poster = new URLSearchParams(location.search).has('poster');
let idleTimer = 0;
const onFirstMove = () => openDoors();
const onFirstKey = () => openDoors();
function stopWaiting() {
  clearTimeout(idleTimer);
  removeEventListener('pointermove', onFirstMove);
  removeEventListener('keydown', onFirstKey);
}
if (!open && !poster) {
  addEventListener('pointermove', onFirstMove, { passive: true });
  addEventListener('keydown', onFirstKey);
  idleTimer = setTimeout(openDoors, 1200);
}
$('.case').addEventListener('click', openDoors);

/* ---------- opening a drawer ---------------------------------------------- */

const dim = $('#dim');
let leaving = false;
function enter(li) {
  if (leaving) return;
  leaving = true;
  const href = $('.front', li).getAttribute('href');
  if (reduced) { location.href = href; return; }
  li.classList.add('pulling');
  dim.classList.add('on');
  // a click that also opened the doors waits for the swing, then goes
  const wait = Math.max(PULL, openedAt + SWING - performance.now());
  setTimeout(() => { location.href = href; }, wait);
}

drawers.addEventListener('click', (e) => {
  const li = e.target.closest('.drawer');
  if (!li) return;
  if (e.target.closest('.enter')) { enter(li); return; }
  const front = e.target.closest('.front');
  if (!front) return;
  e.preventDefault();
  if (isPhone()) {
    const was = li.classList.contains('expanded');
    for (const d of drawers.children) d.classList.remove('expanded');
    if (!was) {
      li.classList.add('expanded');
      li.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
    return;
  }
  openDoors();                            // a click through the shut doors opens them and still counts
  enter(li);
});
drawers.addEventListener('keydown', (e) => {
  if (!isPhone() || e.key !== ' ') return;
  const front = e.target.closest('.front');
  if (!front) return;
  e.preventDefault();
  front.click();
});

/* test hook, as the games have */
window.__poe = { get open() { return open; }, openDoors };

/* refresh best scores when we come back from a game via bfcache */
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  leaving = false;
  dim.classList.remove('on');
  for (const li of drawers.children) {
    li.classList.remove('pulling');
    const best = bestOf(li.dataset.slug);
    const el = $('.best', li);
    el.textContent = 'best: ' + (best != null ? best : '—');
    el.classList.toggle('has', best != null);
  }
});

/* ---------- footer: sound and about --------------------------------------- */

const sound = $('#sound');
let muted = !!loadState('muted', false);
const paintSound = () => {
  sound.setAttribute('aria-pressed', String(muted));
  sound.setAttribute('aria-label', muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
  $('.label', sound).textContent = muted ? 'silent' : 'sound';
};
paintSound();
sound.addEventListener('click', () => { muted = !muted; saveState('muted', muted); paintSound(); });

const about = $('#about'), scrim = $('#scrim'), aboutBtn = $('#about-btn');
const showAbout = (v) => {
  about.hidden = !v; scrim.hidden = !v;
  aboutBtn.setAttribute('aria-expanded', String(v));
  if (v) $('.close', about).focus(); else aboutBtn.focus();
};
aboutBtn.addEventListener('click', () => showAbout(about.hidden));
$('.close', about).addEventListener('click', () => showAbout(false));
scrim.addEventListener('click', () => showAbout(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !about.hidden) showAbout(false); });

/* ---------- the bookcase, procedurally ------------------------------------ */
(() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tones = ['#3a2a1c', '#4a2b1e', '#2b2a24', '#5a3a22', '#33301f', '#4b3320', '#2a2320', '#5c4a2a'];
  let out = '<svg viewBox="0 0 120 700" preserveAspectRatio="none" aria-hidden="true">';
  out += '<rect width="120" height="700" fill="#120c08"/>';
  for (let shelf = 0; shelf < 7; shelf++) {
    const y = 20 + shelf * 96;
    let x = 6;
    while (x < 112) {
      const w = 6 + rnd() * 10, h = 54 + rnd() * 30;
      out += `<rect x="${x.toFixed(1)}" y="${(y + 86 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${tones[Math.floor(rnd() * tones.length)]}"/>`;
      if (rnd() > .5) out += `<rect x="${(x + 1).toFixed(1)}" y="${(y + 92 - h + 10).toFixed(1)}" width="${(w - 2).toFixed(1)}" height="2" fill="#a8863c" opacity=".55"/>`;
      x += w + 1.5;
    }
    out += `<rect x="0" y="${y + 86}" width="120" height="6" fill="#241710"/>`;
  }
  out += '<rect width="120" height="700" fill="url(#bcShade)"/>';
  out += '<defs><linearGradient id="bcShade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".85"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs></svg>';
  $('#bookcase').innerHTML = out;
})();

/* ---------- light, parallax, dust ----------------------------------------- */

const root = document.documentElement.style;
const stage = $('#stage');
const flameEl = $('#flame-pt');

let mx = 0, my = 0, tmx = 0, tmy = 0;
if (matchMedia('(hover: hover)').matches) {
  addEventListener('pointermove', (e) => {
    tmx = (e.clientX / innerWidth) * 2 - 1;
    tmy = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });
}

/* where the flame actually is, in stage coordinates, so the light comes from it */
let flame = { x: innerWidth * 0.82, y: innerHeight * 0.5 };
function locateFlame() {
  try {
    const r = flameEl.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    if (r.width || r.height) flame = { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
  } catch {}
  root.setProperty('--cx', flame.x.toFixed(0) + 'px');
  root.setProperty('--cy', flame.y.toFixed(0) + 'px');
}
locateFlame();
addEventListener('resize', locateFlame, { passive: true });
document.fonts && document.fonts.ready.then(locateFlame).catch(() => {});

/* smooth flicker: three incommensurate sines plus a slow random walk */
let t0 = performance.now(), walk = 0, walkTarget = 0, lastWalk = 0;
function flicker(now) {
  const t = (now - t0) / 1000;
  if (now - lastWalk > 140) { lastWalk = now; walkTarget = (Math.random() - .5) * .16; }
  walk += (walkTarget - walk) * .12;
  const f = 1 + .05 * Math.sin(t * 7.3) + .035 * Math.sin(t * 11.9 + 1.7) + .025 * Math.sin(t * 3.1 + .4) + walk;
  const fx = .6 * Math.sin(t * 5.1) + .4 * Math.sin(t * 13.7 + 2) + walk * 2;
  return { f: Math.max(.82, Math.min(1.18, f)), fx: Math.max(-1, Math.min(1, fx)) };
}

/* dust motes */
const canvas = $('#dust');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
const motes = [];
fitCanvas(canvas, ({ width, height, dpr }) => {
  W = width; H = height; DPR = dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = isPhone() ? 36 : 70;
  motes.length = 0;
  for (let i = 0; i < n; i++) motes.push(newMote(true));
});
function newMote(anywhere) {
  return {
    x: Math.random() * W, y: anywhere ? Math.random() * H : H + 10,
    r: .5 + Math.random() * 1.4,
    vy: -(3 + Math.random() * 9), vx: 2 + Math.random() * 6,
    ph: Math.random() * Math.PI * 2, sp: .3 + Math.random() * .8,
    a: .3 + Math.random() * .7,
  };
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const { f, fx } = reduced ? { f: 1, fx: 0 } : flicker(now);
  root.setProperty('--flick', f.toFixed(3));
  root.setProperty('--fx', fx.toFixed(3));

  mx += (tmx - mx) * .06; my += (tmy - my) * .06;
  root.setProperty('--mx', mx.toFixed(3));
  root.setProperty('--my', my.toFixed(3));

  ctx.clearRect(0, 0, W, H);
  const cx = isPhone() ? W / 2 : flame.x, cy = isPhone() ? 0 : flame.y;
  const reach = isPhone() ? 420 : 760;
  for (const m of motes) {
    if (!reduced) {
      m.ph += dt * m.sp;
      m.x += (m.vx + Math.sin(m.ph) * 8 + mx * 6) * dt;
      m.y += (m.vy + Math.cos(m.ph * .7) * 5) * dt;
      if (m.y < -10 || m.x > W + 10) Object.assign(m, newMote(false), { x: Math.random() * W });
    }
    const d = Math.hypot(m.x - cx, m.y - cy);
    const lit = Math.max(0, 1 - d / reach);
    const a = m.a * (.08 + lit * .9) * f;
    if (a < .01) continue;
    ctx.fillStyle = `rgba(255,${205 - lit * 40 | 0},${140 - lit * 60 | 0},${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * (0.8 + lit * .6), 0, 6.2832); ctx.fill();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
