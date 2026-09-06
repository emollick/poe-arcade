#!/usr/bin/env node
/* PLUTO — scripted playtest.
 *   node games/black-cat/playtest.mjs            # desktop
 *   node games/black-cat/playtest.mjs --mobile   # 390x844 touch
 *
 * Serves the repo over http (like tools/verify.mjs), plays the game with a
 * scripted trowel until the officers catch the cat (lose), then again with a
 * fast-forward hook and a diligent bot until they leave (win). Writes
 * screenshots/black-cat-{title,play,win,lose}.png and prints timings.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const MOBILE = process.argv.includes('--mobile');
const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');

function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
    for (const f of ['chrome', 'headless_shell']) {
      const p = path.join(base, d, 'chrome-linux', f);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no chromium');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    try {
      const st = await fsp.stat(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(404).end('nope'); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await fsp.mkdir(SHOTS, { recursive: true });
const tag = MOBILE ? '-mobile' : '';
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `black-cat-${n}${tag}.png`) });

await page.goto(`http://127.0.0.1:${port}/games/black-cat/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__poe && window.__poe.grid.w > 0, null, { timeout: 20000 });
await sleep(2200);
await shot('title');
console.log('title: grid', await page.evaluate(() => [__poe.grid.w, __poe.grid.h, __poe.grid.cell.toFixed(2)].join('x')));

/* ---- run 1: a lazy player. Paints a little at the start, then stops. */
const vp = page.viewportSize();
await page.mouse.click(vp.width / 2, vp.height / 2);
await page.waitForFunction(() => __poe.state === 'play');
// a few strokes over the cat, then give up
const cat = await page.evaluate(() => __poe.cat());
await page.mouse.move(cat.x - cat.s * 0.2, cat.y - cat.s * 0.2);
await page.mouse.down();
for (let i = 0; i < 20; i++) { await page.mouse.move(cat.x - cat.s * 0.2 + i * 6, cat.y - cat.s * 0.2 + Math.sin(i) * 20); await sleep(30); }
await page.mouse.up();
await sleep(6500);
await shot('play');
console.log('fps', await page.evaluate(() => __poe.fps().toFixed(1)));
console.log('play: t', await page.evaluate(() => __poe.G.t.toFixed(1)), 'total vis', await page.evaluate(() => __poe.total().toFixed(3)));
// fast forward the neglect
await page.evaluate(() => __poe.setTimeScale(4));
const t0 = Date.now();
await page.waitForFunction(() => __poe.state !== 'play', null, { timeout: 90000 });
const r1 = await page.evaluate(() => ({ state: __poe.state, t: __poe.G.t.toFixed(1), sweep: __poe.G.sweep, score: __poe.G.score }));
console.log('run 1 (lazy):', r1, `(${((Date.now() - t0) / 1000).toFixed(1)}s wall)`);
await sleep(2600);
await shot('lose');

/* ---- run 2: a diligent bot. Samples the wall, paints what shows, ahead of the beam. */
await page.evaluate(() => __poe.setTimeScale(1));
await page.keyboard.press('Enter');
await page.waitForFunction(() => __poe.state === 'play');
await page.evaluate(() => {
  const bot = () => {
    if (__poe.state !== 'play') return;
    const g = __poe.grid, G = __poe.G;
    // look for the worst spot among samples inside the cat's neighbourhood
    const c = __poe.cat();
    let bx = 0, by = 0, bs = 0;
    for (let i = 0; i < 60; i++) {
      const x = c.x + (Math.random() - 0.5) * c.s * 0.95, y = c.y + (Math.random() - 0.5) * c.s * 0.95;
      const s = __poe.showAt(x, y);
      if (s > bs) { bs = s; bx = x; by = y; }
    }
    if (bs > 0.08 && G.bucket > 0.05) {
      // a short stroke through the spot
      __poe.release();
      const r = g.cell * Math.min(g.w, g.h) * 0.055;
      for (let k = -2; k <= 2; k++) __poe.paint(bx + k * r * 0.6, by + k * r * 0.25);
      __poe.release();
    }
  };
  window.__bot = setInterval(bot, 45);
});
await page.evaluate(() => __poe.setTimeScale(3));
const t1 = Date.now();
await page.waitForFunction(() => __poe.state !== 'play', null, { timeout: 120000 });
const r2 = await page.evaluate(() => ({ state: __poe.state, t: __poe.G.t.toFixed(1), sweep: __poe.G.sweep, score: __poe.G.score, unseen: __poe.G.unseen.toFixed(1), clean: __poe.G.cleanSweeps }));
console.log('run 2 (bot):', r2, `(${((Date.now() - t1) / 1000).toFixed(1)}s wall)`);
if (r2.state !== 'win') {
  console.log('bot lost; forcing the win state through the hook for the screenshot');
  await sleep(1600);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __poe.state === 'play');
  await page.evaluate(() => __poe.win());
}
await page.evaluate(() => clearInterval(window.__bot));
await page.evaluate(() => __poe.setTimeScale(1));
await sleep(5200);
await shot('win');
console.log('best saved:', await page.evaluate(() => localStorage.getItem('poe:black-cat:best')));
console.log(errors.length ? `ERRORS:\n  ${errors.join('\n  ')}` : 'no console errors');
await browser.close();
srv.close();
process.exit(errors.length ? 1 : 0);
