#!/usr/bin/env node
/* Under the Boards — playtest.mjs
 * Scripted playthrough with Playwright: title → play → win (scripted perfect
 * taps at a compressed pace) and title → play → lose (a player who never taps).
 *
 *   node games/tell-tale-heart/playtest.mjs            # from the repo root
 *
 * Writes screenshots/tell-tale-heart-{title,play,win,lose}.png (desktop) and
 * -mobile variants for the title and play frames.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const SLUG = 'tell-tale-heart';

const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');

function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const c = [];
  for (const d of fs.readdirSync(base)) {
    if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
    c.push(path.join(base, d, 'chrome-linux', 'chrome'), path.join(base, d, 'chrome-linux', 'headless_shell'));
  }
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('no chromium under ' + base);
  return hit;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve(root) {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    try {
      const st = await fsp.stat(file);
      if (st.isDirectory()) { res.writeHead(302, { location: p + '/' }).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Poll the page on a timer (not rAF, which a busy canvas can starve). */
async function waitFor(page, expr, timeout, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    try { last = await page.evaluate(expr); } catch (e) { last = String(e); }
    if (last === true) return;
    await sleep(120);
  }
  const st = await page.evaluate(() => window.__poe ? { state: __poe.state, progress: __poe.progress, composure: __poe.composure } : null).catch(() => null);
  throw new Error(`timed out waiting for ${label} (last=${JSON.stringify(last)} state=${JSON.stringify(st)})`);
}

/* The scripted player lives in the page: it reads the upcoming beat times off
 * the debug hook and presses Space through a real keydown event on the beat,
 * never during a watched window. `accuracy` is the timing slop in seconds. */
const BOT = `(accuracy) => {
  const hit = new Set();
  window.__bot = setInterval(() => {
    const p = window.__poe;
    if (!p || p.state !== 'play') return;
    const now = p.now();
    for (const b of p.upcoming()) {
      if (b.free || hit.has(b.t)) continue;
      const off = b.t + (Math.random() - 0.5) * 2 * accuracy;
      if (now >= off - 0.008) {
        hit.add(b.t);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
      }
    }
  }, 8);
}`;

async function run() {
  const { srv, port } = await serve(ROOT);
  const base = `http://127.0.0.1:${port}/games/${SLUG}/`;
  const browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader'],
  });
  await fsp.mkdir(SHOTS, { recursive: true });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${SLUG}-${name}.png`) });
  const problems = [];
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${tag} console.error: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${tag} http ${r.status()} ${r.url()}`); });
  };
  const state = (page) => page.evaluate(() => ({ state: __poe.state, score: __poe.score, composure: +__poe.composure.toFixed(3), progress: +__poe.progress.toFixed(3), ...__poe.stats }));
  const trace = (page, tag) => setInterval(() => state(page).then((s) => console.log('   ', tag, JSON.stringify(s))).catch(() => {}), 2000);

  /* ---- desktop: title, then a good player who reaches dawn ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await page.goto(base, { waitUntil: 'load' });
    await waitFor(page, "!!(window.__poe && document.fonts.status === 'loaded')", 20000, 'page ready');
    await sleep(1200);
    await shot(page, 'title');

    await page.keyboard.press('Space');
    await waitFor(page, "__poe.state === 'play'", 5000, '__poe.state === play');
    await page.evaluate(`(${BOT})(0.03)`);
    const tr = process.env.DEBUG ? trace(page, 'win-run') : 0;
    // play at natural pace for a while, screenshot mid-game when the red has come in
    await page.evaluate(() => __poe.setSpeed(2.2));
    await waitFor(page, "__poe.progress > 0.62", 60000, '__poe.progress > 0.62');
    await page.evaluate(() => __poe.setSpeed(1));
    // wait for a watched window so the frame shows the eye on us
    try { await waitFor(page, "__poe.watched", 15000, '__poe.watched'); await sleep(250); } catch {}
    console.log('  mid-game', await state(page));
    await shot(page, 'play');
    await page.evaluate(() => __poe.setSpeed(2.2));
    await waitFor(page, "__poe.state === 'dawn'", 90000, '__poe.state === dawn');
    await sleep(3200);
    const win = await state(page);
    console.log('  win     ', win);
    await shot(page, 'win');
    await page.evaluate(() => clearInterval(window.__bot));
    clearInterval(tr);
    // restart without reload works
    await page.keyboard.press('Space');
    await waitFor(page, "__poe.state === 'play'", 5000, '__poe.state === play');
    console.log('  restart ', await state(page));
    await ctx.close();
    if (win.state !== 'dawn') problems.push('did not reach the win state');
  }

  /* ---- desktop: a player who freezes and never taps → confession ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    watch(page, 'lose');
    await page.goto(base, { waitUntil: 'load' });
    await waitFor(page, "!!(window.__poe && document.fonts.status === 'loaded')", 20000, 'page ready');
    await page.mouse.click(720, 450);
    await waitFor(page, "__poe.state === 'play'", 5000, '__poe.state === play');
    // taps while watched are tells; a few of those plus missed beats end it
    const t0 = Date.now();
    await waitFor(page, "__poe.state === 'confess'", 90000, '__poe.state === confess');
    console.log('  lose after', ((Date.now() - t0) / 1000).toFixed(1) + 's', await state(page));
    await sleep(2400);
    await shot(page, 'lose');
    await page.keyboard.press('KeyR');
    await waitFor(page, "__poe.state === 'play'", 5000, '__poe.state === play');
    console.log('  restart ', await state(page));
    await ctx.close();
  }

  /* ---- mobile: title and play frames, touch input ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    watch(page, 'mobile');
    await page.goto(base, { waitUntil: 'load' });
    await waitFor(page, "!!(window.__poe && document.fonts.status === 'loaded')", 20000, 'page ready');
    await sleep(1200);
    await shot(page, 'title-mobile');
    await page.touchscreen.tap(195, 500);
    await waitFor(page, "__poe.state === 'play'", 5000, '__poe.state === play');
    await page.evaluate(`(${BOT})(0.03)`);
    await page.evaluate(() => __poe.setSpeed(2.2));
    await waitFor(page, "__poe.progress > 0.55", 60000, '__poe.progress > 0.55');
    await page.evaluate(() => __poe.setSpeed(1));
    try { await waitFor(page, "__poe.watched", 15000, '__poe.watched'); await sleep(250); } catch {}
    console.log('  mobile  ', await state(page));
    await shot(page, 'play-mobile');
    await page.evaluate(() => clearInterval(window.__bot));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  if (problems.length) { console.log('\nPROBLEMS'); for (const p of problems) console.log('  - ' + p); process.exit(1); }
  console.log('\nplaytest OK → screenshots/' + SLUG + '-{title,play,win,lose}.png');
}

run().catch((e) => { console.error(e); process.exit(1); });
