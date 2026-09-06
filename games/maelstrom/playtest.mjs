#!/usr/bin/env node
/* The Vortex — scripted playtest.
 *   node games/maelstrom/playtest.mjs            # desktop 1440x900
 *   node games/maelstrom/playtest.mjs mobile     # 390x844, touch
 * Plays with real input until the player is lost to the gulf, then replays and
 * fast-forwards (window.__poe) to the slack of the tide. Screenshots land in
 * screenshots/maelstrom-{title,play,win,lose}.png (mobile adds "-mobile").
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const mobile = process.argv.includes('mobile');
const suffix = mobile ? '-mobile' : '';

const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');
function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
    for (const f of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = path.join(base, d, f); if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no chromium under ' + base);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await fsp.mkdir(SHOTS, { recursive: true });
await page.goto(`http://127.0.0.1:${port}/games/maelstrom/?q=${mobile ? 'phone' : 'full'}`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await sleep(2500);
const q = await page.evaluate(() => window.__poe && window.__poe.quality);
console.log('renderer:', q && q.renderer, '| particles:', q && q.MAX_PARTICLES);
await page.screenshot({ path: path.join(SHOTS, `maelstrom-title${suffix}.png`) });
console.log('title shot');

const mode = () => page.evaluate(() => window.__poe.state.mode);
const stat = () => page.evaluate(() => { const s = window.__poe.state; return { mode: s.mode, t: +s.t.toFixed(1), u: +s.player.u.toFixed(3), score: Math.round(s.score), lashed: s.player.lashed ? s.player.lashed.kind : null, objs: s.objects.length, debris: s.debris.length, fps: window.__poe.quality.drawCount }; });

/* ---- run 1: real input until lost ------------------------------------ */
if (mobile) await page.touchscreen.tap(195, 500); else { await page.mouse.click(720, 450); }
await sleep(300);
console.log('after start:', await stat());
// swiftshader is slow: run several sim steps per frame so a run takes seconds, not minutes
await page.evaluate(() => window.__poe.setFF(3));

let playShot = false;
const t0 = Date.now();
let lastLash = 0;
while (Date.now() - t0 < 120000) {
  const s = await stat();
  if (s.mode === 'dying' || s.mode === 'lost') break;
  if (s.mode !== 'play') break;
  // a plausible novice: swim toward the nearest object, lash whatever is near, climb when deep
  const near = await page.evaluate(() => { const n = window.__poe.nearest(); return n.obj ? { d: n.d, good: n.obj.k.good, kind: n.obj.kind } : null; });
  if (near && near.d < 0.17 && !s.lashed && Date.now() - lastLash > 600) {
    if (mobile) await page.touchscreen.tap(330, 700); else await page.keyboard.press('Space');
    lastLash = Date.now();
  }
  if (s.lashed && !(near && near.good) && Date.now() - lastLash > 2500) {
    // lashed to something bad: let go
    if (mobile) await page.touchscreen.tap(330, 700); else await page.keyboard.press('Space');
    lastLash = Date.now();
  }
  if (!s.lashed) {
    const dir = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
    if (!mobile) { await page.keyboard.down(dir); await sleep(180); await page.keyboard.up(dir); }
    else { await page.evaluate((d) => { window.__poe.input.axis = d === 'ArrowLeft' ? -1 : 1; }, dir); await sleep(180); await page.evaluate(() => { window.__poe.input.axis = 0; }); }
  }
  if (s.u > 0.55 && !mobile) { await page.keyboard.down('ArrowUp'); await sleep(200); await page.keyboard.up('ArrowUp'); }
  if (!playShot && s.t > 9) {
    await page.screenshot({ path: path.join(SHOTS, `maelstrom-play${suffix}.png`) });
    console.log('play shot at', s);
    playShot = true;
  }
  await sleep(120);
}
console.log('run 1 ended:', await stat());
// give up: hold still until the gulf takes us (the novice stops swimming)
await page.evaluate(() => { const s = window.__poe.state; if (s.mode === 'play') { s.player.lashed = null; window.__poe.fastForward(60); } });
await sleep(200);
let m = await mode();
for (let i = 0; i < 100 && m !== 'lost'; i++) { await sleep(200); m = await mode(); }
if (m !== 'lost') throw new Error('never reached the lose state: ' + m);
await sleep(600);
await page.screenshot({ path: path.join(SHOTS, `maelstrom-lose${suffix}.png`) });
console.log('lose shot:', await stat());

/* ---- run 2: restart, fast-forward to the slack of the tide ----------- */
await page.keyboard.press('Enter');
await sleep(300);
console.log('run 2 started:', await stat());
await page.evaluate(() => { const s = window.__poe.state; window.__poe.fastForward(6); s.player.u = 0.25; window.__poe.win(); });
await page.evaluate(() => window.__poe.setFF(2));
m = await mode();
let winShot = false;
for (let i = 0; i < 300 && m !== 'won'; i++) {
  await sleep(200); m = await mode();
  const s = await stat();
  if (!winShot && s.mode === 'slack' && s.t > 76.5) { winShot = true; }
}
if (m !== 'won') throw new Error('never reached the win state: ' + m);
await sleep(800);
await page.screenshot({ path: path.join(SHOTS, `maelstrom-win${suffix}.png`) });
console.log('win shot:', await stat());
const best = await page.evaluate(() => localStorage.getItem('poe:maelstrom:best'));
console.log('saved best:', best);

await browser.close(); srv.close();
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of errors) console.log('  -', e); process.exit(1); }
console.log('playtest OK, no console errors');
