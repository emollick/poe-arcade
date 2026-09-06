#!/usr/bin/env node
/* Playtest for THE DESCENDING BLADE.
   Serves the repo, drives the game with scripted keyboard/touch input through window.__poe,
   reaches the lose states (sliced + pit) and the win state (via the fast-forward hook),
   and saves screenshots/pit-and-pendulum-{title,play,win,lose}.png (+ a few extras).
     node games/pit-and-pendulum/playtest.mjs            # from the repo root */

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

/* a modest bot: hugs a ledge, hops rats, flees a low blade. Real key events only. */
async function bot(page, seconds, opts = {}) {
  const held = { left: false, right: false };
  const set = async (k, v) => { if (held[k] === v) return; held[k] = v; await page.keyboard[v ? 'down' : 'up'](k === 'left' ? 'ArrowLeft' : 'ArrowRight'); };
  const t0 = Date.now();
  let lastHop = 0, lastState = '';
  while (Date.now() - t0 < seconds * 1000) {
    const s = await poe(page, `({ state: p.state, time: p.time, man: p.man, blade: p.blade, walls: p.walls, rats: p.rats, AW: p.AW, FLOOR_Y: p.FLOOR_Y, PIT_W: p.PIT_W })`);
    if (s.state !== 'playing') { lastState = s.state; break; }
    const cx = s.AW / 2, m = s.man, b = s.blade;
    const side = opts.side || -1;
    // stand on the ledge: outside the blade's low sweep but clear of the wall
    let target = opts.target != null ? opts.target : cx + side * Math.max(s.PIT_W / 2 + 95, Math.min(s.walls.half - 70, 210));
    if (opts.target == null && b.pivotY > 150) target = cx + side * Math.max(s.PIT_W / 2 + 110, Math.min(s.walls.half - 40, 200));
    const dx = target - m.x;
    await set('left', dx < -5); await set('right', dx > 5);
    // hop rats coming at us (never right at the lip of the pit)
    const threat = s.rats.find((r) => Math.abs(r.y - s.FLOOR_Y) < 30 && Math.sign(m.x - r.x) === r.dir && Math.abs(r.x - m.x) < 30);
    const bladeAbove = Math.abs(b.x - m.x) < 120 && b.edgeY > s.FLOOR_Y - 140;
    const nearLip = Math.abs(m.x - cx) < s.PIT_W / 2 + 22;
    if (threat && !bladeAbove && !nearLip && Date.now() - lastHop > 600 && Math.abs(m.vy) < 0.5) { await page.keyboard.press('Space'); lastHop = Date.now(); }
    // (suicide mode) hop straight up into the passing blade
    if (opts.hopUnder && Math.abs(b.x - m.x) < 70 && Date.now() - lastHop > 400) { await page.keyboard.press('Space'); lastHop = Date.now(); }
    await sleep(40);
  }
  await set('left', false); await set('right', false);
  return lastState || 'playing';
}

const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}/games/pit-and-pendulum/`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
const errors = [];
const log = (...a) => console.log('  ', ...a);
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
  await shot(page, 'title'); log('title screenshot');

  // play honestly for a while
  await page.keyboard.press('Enter');
  await sleep(200);
  log('state after Enter:', await poe(page, 'p.state'));
  const playShotAt = 14;
  let took = false;
  const t0 = Date.now();
  let outcome = 'playing';
  while (Date.now() - t0 < 60000) {
    outcome = await bot(page, 1);
    if (outcome !== 'playing') break;
    const t = await poe(page, 'p.time');
    if (!took && t >= playShotAt) { await shot(page, 'play'); took = true; log('play screenshot at', t.toFixed(1) + 's'); }
  }
  const run1 = await poe(page, `({ state: p.state, time: p.time, score: p.score, stats: p.stats })`);
  log('run 1 (bot):', JSON.stringify(run1));
  if (run1.state === 'playing') { // the bot survived a minute: let it walk into the pit
    await page.keyboard.down('ArrowRight'); await sleep(2500); await page.keyboard.up('ArrowRight');
  }
  if (!took) { await shot(page, 'play'); log('play screenshot (late)'); }
  await sleep(3200);
  log('end state:', await poe(page, 'p.state'));
  if ((await poe(page, 'p.state')) === 'fell') await shot(page, 'lose-pit');
  else if ((await poe(page, 'p.state')) === 'sliced') await shot(page, 'lose-sliced-run1');

  // the blade death, deliberately: fast-forward so the blade is low, then stand beneath it
  await page.keyboard.press('Enter'); await sleep(300);
  await poe(page, 'p.fastForward(62)');
  const AW = await poe(page, 'p.AW');
  let st = await bot(page, 12, { target: AW / 2 - 104, hopUnder: true }); // stand at the lip and hop into the blade
  log('blade geometry:', JSON.stringify(await poe(page, 'p.blade')));
  log('blade-death state:', st, 'at', (await poe(page, 'p.time')).toFixed(1) + 's');
  await sleep(500);
  await shot(page, 'lose-freeze');
  await sleep(1400);
  await shot(page, 'lose'); log('lose screenshot (' + st + ')');

  // the win: fast-forward to just before the trumpets and let the invincible bot ride it out
  await page.keyboard.press('Enter'); await sleep(300);
  await poe(page, 'p.setInvincible(true)');
  await poe(page, 'p.fastForward(66)');
  await bot(page, 9);
  st = await poe(page, 'p.state');
  log('after fast-forward:', st, 'score', await poe(page, 'p.score'));
  for (let i = 0; i < 60 && (await poe(page, 'p.state')) === 'trumpet'; i++) {
    await sleep(100);
    if (i === 24) { await shot(page, 'rescue'); log('rescue screenshot'); }
  }
  await sleep(400);
  log('final state:', await poe(page, 'p.state'));
  await shot(page, 'win'); log('win screenshot');
  await poe(page, 'p.setInvincible(false)');
  const best = await page.evaluate(() => localStorage.getItem('poe:pit-and-pendulum:best'));
  log('saved best:', best);
  await ctx.close();

  /* ------------------------------------------------ mobile touch */
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
  // hold the right third with a CDP touch, then release
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
  await sleep(2500);
  await shot(mp, 'mobile-play');
  await mctx.close();
} finally {
  await browser.close();
  srv.close();
}
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('playtest ok');
