#!/usr/bin/env node
/* Playtest for THE DESCENDING BLADE.
   Serves the repo, drives the game with real keyboard/touch events (reading state through window.__poe),
   measures three strategies against the tuning, reaches both lose states and the win, and saves
   screenshots/pit-and-pendulum-{title,play,win,lose,...}.png.
     node games/pit-and-pendulum/playtest.mjs                 # full pass, from the repo root
     node games/pit-and-pendulum/playtest.mjs measure         # only the three measured bots, no screenshots
     node games/pit-and-pendulum/playtest.mjs measure blade   # one of: none | ledge | blade
   Bots:
     none   — no input at all (how long does a spectator last?)
     ledge  — hugs the ledge by the wall, hops rats, walks away from a low blade (must NOT win)
     blade  — stands where the blade passes a hair above his head and hops under it while it is high (should win) */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');
const MODE = process.argv[2] || 'full';
const ONLY = process.argv[3] || null;

function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
    for (const f of ['chrome', 'headless_shell']) { const p = path.join(base, d, 'chrome-linux', f); if (fs.existsSync(p)) return p; }
  }
  throw new Error('no chromium under ' + base);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    try { const st = await fsp.stat(file); res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size }); fs.createReadStream(file).pipe(res); }
    catch { res.writeHead(404).end('nope'); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `pit-and-pendulum-${name}.png`) });
const poe = (page, expr) => page.evaluate(`(() => { const p = window.__poe; return (${expr}); })()`);
const snap = (page) => poe(page, `({ state: p.state, time: p.time, score: p.score, man: p.man, blade: p.blade, walls: p.walls, rats: p.rats, AW: p.AW, FLOOR_Y: p.FLOOR_Y, PIT_W: p.PIT_W })`);
const log = (...a) => console.log('  ', ...a);

/* world numbers the bots reason with (mirrors game.js) */
const ROD = 290, G_STEP = 0.001 * 1.6 * (1000 / 60) ** 2, HOP_APEX = 7.2 * 7.2 / (2 * G_STEP); // ≈58

class Keys {
  /* walking goes through the exposed input flags with an in-page dead-man's release (a slow harness tick
     must never leave him running into the pit); hops are real Space presses. */
  constructor(page) { this.page = page; this.left = false; this.right = false; this.lastHop = 0; }
  async walkTo(x, mx, vx = 0) {
    const dx = x - mx;
    const toward = Math.sign(vx) === Math.sign(dx);
    const stop = toward ? Math.abs(vx) * 7.5 : 0;               // ≈ latency + braking distance
    const go = Math.abs(dx) > Math.max(6, stop);
    this.left = go && dx < 0; this.right = go && dx > 0;
    this.dbg = `target=${x.toFixed(0)} ${this.left ? 'L' : ''}${this.right ? 'R' : ''}`;
    await this.page.evaluate(([l, r]) => {
      const p = window.__poe; p.input.left = l; p.input.right = r;
      clearTimeout(window.__poeHold);
      window.__poeHold = setTimeout(() => { p.input.left = p.input.right = false; }, 170);
    }, [this.left, this.right]);
  }
  async hop(cd = 600) { if (Date.now() - this.lastHop < cd) return false; this.lastHop = Date.now(); await this.page.keyboard.press('Space'); return true; }
  async release() { this.left = this.right = false; await this.page.evaluate(() => { const p = window.__poe; p.input.left = p.input.right = false; clearTimeout(window.__poeHold); }); }
}

/* a rat about to run into him, on the floor */
function ratThreat(s) {
  const m = s.man;
  return s.rats.find((r) => Math.abs(r.y - s.FLOOR_Y) < 30 && Math.sign(m.x - r.x) === r.dir && Math.abs(r.x - m.x) < 34);
}

/* run one strategy until the run ends or `seconds` pass; `onTick(s)` may take screenshots */
async function drive(page, strategy, seconds, opts = {}) {
  const keys = new Keys(page);
  if (!opts.shape) opts.shape = await poe(page, 'p.bladeShape');
  const t0 = Date.now();
  let last = null;
  const ring = [];
  await sleep(opts.warmup == null ? 900 : opts.warmup);
  while (Date.now() - t0 < seconds * 1000) {
    const w0 = Date.now();
    const s = await snap(page);
    const w1 = Date.now();
    if (process.env.TRACE && w1 - w0 > 150) log(`  slow snap ${w1 - w0}ms at t=${s.time.toFixed(2)} rats=${s.rats.length}`);
    last = s;
    if (process.env.TRACE) { s.dbg = keys.dbg; ring.push(s); if (ring.length > 30) ring.shift(); }
    if (opts.onTick) await opts.onTick(s);
    if (s.state !== 'playing') {
      if (process.env.TRACE) for (const q of ring) log(`t=${q.time.toFixed(2)} ${q.state} man=(${q.man.x.toFixed(0)},${q.man.y.toFixed(0)}) vy=${q.man.vy.toFixed(1)} blade=(${q.blade.x.toFixed(0)},${q.blade.y.toFixed(0)}) clr=${q.blade.clearance == null ? '?' : q.blade.clearance.toFixed(0)} piv=${q.blade.pivotY.toFixed(0)} reach=${q.blade.reach.toFixed(0)} spd=${q.blade.speed.toFixed(0)} half=${q.walls.half.toFixed(0)} heat=${q.walls.heat.toFixed(2)} rats=${q.rats.length} ${q.dbg || ''}`);
      break;
    }
    if (process.env.TRACE && Math.abs(s.blade.x - s.man.x) < 12 && s.blade.speed > 100) {
      const d = Math.abs(s.man.x - s.AW / 2);
      log(`  pass t=${s.time.toFixed(1)} d=${d.toFixed(0)} r=${s.blade.reach.toFixed(0)} piv=${s.blade.pivotY.toFixed(0)} predicted=${clearanceAt(buildSwing(opts.shape, s.blade.pivotY, Math.max(60, s.blade.reach + 12), s.AW / 2), s.AW / 2, d, s.FLOOR_Y - 22).toFixed(0)} live=${s.blade.clearance == null ? '?' : s.blade.clearance.toFixed(0)} manY=${s.man.y.toFixed(0)} spd=${s.blade.speed.toFixed(0)} score=${s.score}`);
    }
    const w2 = Date.now();
    await strategy(s, keys, opts);
    if (process.env.TRACE && Date.now() - w2 > 150) log(`  slow strategy ${Date.now() - w2}ms at t=${s.time.toFixed(2)}`);
    await sleep(40);
  }
  await keys.release();
  return last;
}

const strategies = {
  async none() {},

  /* the ledge camper: outside the blade's low sweep, clear of the wall; hops rats; never hops at the lip */
  async ledge(s, keys, opts) {
    const cx = s.AW / 2, m = s.man, b = s.blade, side = opts.side || -1;
    let target = cx + side * Math.max(s.PIT_W / 2 + 95, Math.min(s.walls.half - 70, 210));
    if (b.pivotY > 150) target = cx + side * Math.max(s.PIT_W / 2 + 110, Math.min(s.walls.half - 40, 200));
    await keys.walkTo(target, m.x, m.vx);
    const bladeAbove = Math.abs(b.x - m.x) < 120 && b.edgeY > s.FLOOR_Y - 140;
    const nearLip = Math.abs(m.x - cx) < s.PIT_W / 2 + 22;
    if (ratThreat(s) && !bladeAbove && !nearLip && Math.abs(m.vy) < 0.5) await keys.hop();
  },

  /* the blade timer: knows the crescent's real shape, stands at the innermost spot where every
     position of the swing clears his head, hops under it while there is still room for a hair's
     breadth at the apex, and hops rats only when the blade allows */
  async blade(s, keys, opts) {
    const cx = s.AW / 2, m = s.man, b = s.blade, half = s.walls.half;
    const manY = s.FLOOR_Y - 22;                                  // his centre when standing
    const r = Math.max(60, b.reach + 12);
    const swing = buildSwing(opts.shape, b.pivotY, r, cx);
    const clr = (d) => clearanceAt(swing, cx, d, manY);
    // over the lip (shoved there, or wedged on its edge): hop back onto the ledge, nothing else matters
    if (Math.abs(m.x - cx) < s.PIT_W / 2 + 16) {
      await keys.walkTo(cx - s.PIT_W / 2 - 60, m.x, 0);
      const sliding = m.vy > 0.15 || Math.abs(m.x - cx) < s.PIT_W / 2 + 4;
      if (sliding && (m.vy > 1 || !overheadWithin(s, Math.abs(m.x - cx), 0.6))) await keys.hop(250);
      return;
    }
    const ratsNear = s.rats.some((r) => r.x < cx && Math.abs(r.x - m.x) < 140);
    const sear = Math.max(0, Math.min(35, (s.walls.heat - 0.6) * 90));   // mirrors searReach() in game.js
    const dMin = s.PIT_W / 2 + (ratsNear ? 75 : 40), dMax = half - 11 - sear - 8;
    let stand = null;
    for (let d = dMin; d <= dMax; d += 4) { const c = clr(d); if (c >= 12) { stand = { d, c }; break; } }
    if (!stand) stand = { d: dMax, c: clr(dMax) };
    const target = cx - stand.d;
    await keys.walkTo(target, m.x, m.vx);
    const settled = Math.abs(m.x - target) < 8 && Math.abs(m.vy) < 0.5;
    const towards = b.vx !== 0 && Math.sign(m.x - b.x) === Math.sign(b.vx);
    const tta = towards ? (m.x - b.x) / (b.vx * 60) : 9;           // seconds until the crescent is overhead
    if (settled && stand.c >= HOP_APEX + 10 && stand.c <= HOP_APEX + 30 && tta > 0.2 && tta < 0.34) { await keys.hop(900); return; }
    const here = clr(Math.abs(m.x - cx));
    const hopSafe = here - HOP_APEX > 12 || !overheadWithin(s, Math.abs(m.x - cx), 0.6);
    const coming = s.rats.some((r) => Math.abs(r.y - s.FLOOR_Y) < 30 && Math.sign(m.x - r.x) === r.dir && Math.abs(r.x - m.x) < 70);
    if (coming && hopSafe && Math.abs(m.vy) < 0.5) await keys.hop(450);
  },
};

/* will any part of the crescent be over the man (d left of centre) within the next `seconds`?
   The swing is close to sinusoidal: e = r·sin(φ), φ advancing at ω. */
const OMEGA = 2 * Math.PI / (2 * Math.PI * Math.sqrt(ROD / G_STEP) / 60); // rad/s, ≈2.35
function overheadWithin(s, d, seconds) {
  const cx = s.AW / 2, b = s.blade, r = Math.max(60, b.reach + 8);
  const e0 = cx - b.x;
  let phi = Math.asin(Math.max(-1, Math.min(1, e0 / r)));
  if (b.vx > 0) phi = Math.PI - phi;              // moving right: e decreasing
  for (let t = 0; t <= seconds; t += 0.03) {
    const e = r * Math.sin(phi + OMEGA * t);
    if (Math.abs(e - d) < 92) return true;
  }
  return false;
}

/* the crescent's plates for every position of the swing within reach `r` (rotated once per tick) */
function buildSwing(shape, pivotY, r, cx) {
  const out = [];
  for (let e = -r; e <= r; e += 3) {
    const a = Math.asin(Math.min(1, e / ROD)), cy = pivotY + Math.sqrt(ROD * ROD - e * e), ccx = cx - e, ca = Math.cos(a), sa = Math.sin(a);
    out.push({ e, polys: shape.map((part) => part.map((v) => ({ x: ccx + v.x * ca - v.y * sa, y: cy + v.x * sa + v.y * ca }))) });
  }
  return out;
}
function polyMaxYAt(poly, x) {
  let m = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (!((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x))) continue;
    const y = Math.abs(a.x - b.x) < 0.01 ? Math.max(a.y, b.y) : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    m = m == null ? y : Math.max(m, y);
  }
  return m;
}
/* the crescent's lowest point over his column, for every position of the swing; the man stands `d` left of
   the centre. Mirrors the collision geometry (head circle + shoulders), not the composite's bounds. */
function clearanceAt(swing, cx, d, manY) {
  const manX = cx - d;
  let minC = Infinity;
  for (const { e, polys } of swing) {
    if (Math.abs(e - d) > 100) continue;
    for (const poly of polys) {
      for (let ox = -11; ox <= 11; ox += 2) {
        const my = polyMaxYAt(poly, manX + ox); if (my == null) continue;
        const top = Math.abs(ox) <= 9 ? manY - 18 - Math.sqrt(81 - ox * ox) : manY - 13;
        if (top - my < minC) minC = top - my;
      }
    }
  }
  return minC;
}

async function runOnce(page, name, seconds, opts = {}) {
  await page.keyboard.press('Enter'); await sleep(250);
  if ((await poe(page, 'p.state')) !== 'playing') { await page.keyboard.press('Enter'); await sleep(250); }
  const last = await drive(page, strategies[name], seconds, opts);
  const res = await poe(page, `({ state: p.state, time: p.time, score: p.score, stats: p.stats })`);
  log(`${name.padEnd(6)} → ${res.state.padEnd(8)} at ${res.time.toFixed(1)}s, score ${res.score}, ${JSON.stringify(res.stats)}`);
  return { ...res, last };
}

/* wait for an end card (the fall animation / freeze frame / rescue all take a few seconds) */
async function settle(page, ms) { await sleep(ms); return poe(page, 'p.state'); }
/* the Sliced end: the freeze frame first, then the card */
let slicedTaken = false;
async function slicedShots(page) { slicedTaken = true; await sleep(450); await shot(page, 'lose-freeze'); await settle(page, 1500); await shot(page, 'lose'); log('lose screenshots (sliced)'); }

const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}/games/pit-and-pendulum/`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
const errors = [];
const measured = {};
try {
  await fsp.mkdir(SHOTS, { recursive: true });
  /* ------------------------------------------------ desktop */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1500);
  const full = MODE !== 'measure';
  if (full) { await shot(page, 'title'); log('title screenshot'); }

  // 1. a spectator: no input at all (ends sliced — the freeze frame and the Sliced card come from here)
  if (!ONLY || ONLY === 'none') {
    const r = await runOnce(page, 'none', 45);
    measured.none = r;
    if (full && r.state === 'sliced') { await slicedShots(page); }
    else await settle(page, 3200);
  }

  // 2. the ledge camper (should not reach the trumpets)
  if (!ONLY || ONLY === 'ledge') {
    const r = await runOnce(page, 'ledge', 80);
    measured.ledge = r;
    if (full && r.state === 'sliced' && !slicedTaken) { await slicedShots(page); }
    const st = await settle(page, r.state === 'fell' ? 3400 : 2200);
    if (full && st === 'fell') { await shot(page, 'lose-pit'); log('lose-pit screenshot'); }
    if (st === 'trumpet' || st === 'won') { await settle(page, 6000); }
  }

  // 3. the blade timer (should win) — the poster frame is shot at ~1:02, walls hot, blade low
  if (!ONLY || ONLY === 'blade') {
    let took = false;
    const r = await runOnce(page, 'blade', 80, { onTick: async (s) => {
      if (full && !took && s.time >= 62 && s.blade.speed > 200 && Math.abs(s.blade.x - s.AW / 2) < 60) { took = true; await shot(page, 'play'); log('play screenshot at', s.time.toFixed(1) + 's'); }
    } });
    measured.blade = r;
    if (full && r.state === 'trumpet') {
      for (let i = 0; i < 70 && (await poe(page, 'p.state')) === 'trumpet'; i++) { await sleep(100); if (i === 24) { await shot(page, 'rescue'); log('rescue screenshot'); } }
      await sleep(400); await shot(page, 'win'); log('win screenshot (honest run):', await poe(page, 'p.state'));
    } else await settle(page, 3400);
    if (full && !took) { // fallback poster: fast-forward to the same moment
      await page.keyboard.press('Enter'); await sleep(300);
      await poe(page, 'p.fastForward(57)');
      await drive(page, strategies.blade, 8, { onTick: async (s) => { if (!took && s.time >= 61.5 && s.blade.speed > 200 && Math.abs(s.blade.x - s.AW / 2) < 60) { took = true; await shot(page, 'play'); log('play screenshot (fast-forward) at', s.time.toFixed(1) + 's'); } } });
      if (!took) { await shot(page, 'play'); log('play screenshot (late)'); }
      await settle(page, 3400);
    }
  }

  if (full && !(measured.blade && measured.blade.state === 'trumpet')) {
    // the win, insured: fast-forward to just before the trumpets and let the invincible bot ride it out
    await page.keyboard.press('Enter'); await sleep(300);
    await poe(page, 'p.setInvincible(true)');
    await poe(page, 'p.fastForward(66)');
    await drive(page, strategies.blade, 9);
    log('after fast-forward:', await poe(page, 'p.state'), 'score', await poe(page, 'p.score'));
    for (let i = 0; i < 70 && (await poe(page, 'p.state')) === 'trumpet'; i++) { await sleep(100); if (i === 24) { await shot(page, 'rescue'); log('rescue screenshot'); } }
    await sleep(400); log('final state:', await poe(page, 'p.state'));
    await shot(page, 'win'); log('win screenshot');
    await poe(page, 'p.setInvincible(false)');
  }
  if (full && !slicedTaken) {
    // the blade death, insured: fast-forward so the blade is low, then stand at the lip
    await page.keyboard.press('Enter'); await sleep(300);
    await poe(page, 'p.fastForward(56)');
    const AW = await poe(page, 'p.AW');
    await drive(page, async (s, keys) => { await keys.walkTo(AW / 2 - 100, s.man.x, s.man.vx); }, 10, { warmup: 200 });
    if ((await poe(page, 'p.state')) === 'sliced') await slicedShots(page); else await settle(page, 3400);
    log('blade-death insurance:', await poe(page, 'p.state'));
  }
  if (full) {
    if (!fs.existsSync(path.join(SHOTS, 'pit-and-pendulum-lose-pit.png')) || !(measured.ledge && measured.ledge.state === 'fell')) {
      // the pit, insured: walk him in
      await page.keyboard.press('Enter'); await sleep(400);
      await page.keyboard.down('ArrowRight'); await sleep(1400); await page.keyboard.up('ArrowRight');
      await settle(page, 3400); await shot(page, 'lose-pit'); log('lose-pit screenshot (walked in):', await poe(page, 'p.state'));
    }
    const best = await page.evaluate(() => localStorage.getItem('poe:pit-and-pendulum:best'));
    log('saved best:', best);
  }
  await ctx.close();

  /* ------------------------------------------------ mobile touch */
  if (full) {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage();
    mp.on('console', (m) => { if (m.type() === 'error') errors.push('mobile console.error: ' + m.text()); });
    mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
    await mp.goto(base, { waitUntil: 'networkidle' });
    await mp.evaluate(() => document.fonts.ready);
    await sleep(800);
    await shot(mp, 'mobile-title');
    await mp.touchscreen.tap(195, 500);
    await sleep(600);
    log('mobile state after tap:', await poe(mp, 'p.state'));
    const x0 = (await poe(mp, 'p.man')).x;
    const poeFloor = await poe(mp, 'p.FLOOR_Y');
    // hold the left third with a CDP touch, then release
    const cdp = await mctx.newCDPSession(mp);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 50, y: 600 }] });
    await sleep(350);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const x1 = (await poe(mp, 'p.man')).x;
    log('mobile walk left: x', x0.toFixed(0), '->', x1.toFixed(0));
    await mp.touchscreen.tap(195, 600); // middle: hop
    await sleep(200);
    const mm = await poe(mp, 'p.man');
    log('mobile hop: height above stance', (poeFloor - 21 - mm.y).toFixed(0), 'vy', mm.vy.toFixed(2));
    // the portrait poster: a little way in, with the blade low and the walls warm
    await poe(mp, 'p.fastForward(44)');
    await drive(mp, strategies.blade, 4);
    await shot(mp, 'mobile-play'); log('mobile-play screenshot at', (await poe(mp, 'p.time')).toFixed(1) + 's', await poe(mp, 'p.state'));
    await mctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log('measured:');
for (const [k, v] of Object.entries(measured)) console.log(`   ${k.padEnd(6)} ${v.state.padEnd(8)} ${v.time.toFixed(1)}s  score ${v.score}`);
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('playtest ok');
