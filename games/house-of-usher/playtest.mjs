#!/usr/bin/env node
/* FISSURE playtest — drives the game with scripted input through both endings.
 *   node games/house-of-usher/playtest.mjs            (from the repo root)
 * Writes screenshots/house-of-usher-{title,play,win,lose}.png */
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
const MOBILE = process.argv.includes('--mobile');

function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
    for (const f of ['chrome', 'headless_shell']) { const p = path.join(base, d, 'chrome-linux', f); if (fs.existsSync(p)) return p; }
  }
  throw new Error('no chromium');
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glsl': 'text/plain', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
function serve() {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/favicon.ico') return res.writeHead(204).end();
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    try { const st = await fsp.stat(file); res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size }); fs.createReadStream(file).pipe(res); }
    catch { res.writeHead(404).end('nope'); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const suffix = MOBILE ? '-mobile' : '';
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `house-of-usher-${n}${suffix}.png`) });
await fsp.mkdir(SHOTS, { recursive: true });

const base = `http://127.0.0.1:${port}/games/house-of-usher/`;
const frames = (n = 2) => page.evaluate((k) => new Promise((r) => { const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const st = () => page.evaluate(() => ({ mode: window.__poe.state, marks: window.__poe.marks, t: window.__poe.t, score: window.__poe.score, crack: window.__poe.crack }));

/* ================= phase A: real input at the default (software) resolution ================= */
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__poe && window.__poe.state === 'title', null, { timeout: 60000 });
await frames(3);
const ft = await page.evaluate(() => new Promise((r) => { let n = 0, t0 = performance.now(); const f = () => { if (++n >= 4) r((performance.now() - t0) / n); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
console.log(`software=${await page.evaluate(() => window.__poe.software)} scale=${await page.evaluate(() => window.__poe.scale)} frame≈${ft.toFixed(0)}ms (SwiftShader)`);

// begin via the real button, then brace by clicking/tapping the lit marks where the page projects them
await page.click('#start');
await page.waitForFunction(() => window.__poe.state === 'play');
let clicks = 0, scoreBefore = 0;
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => window.__poe.ff(0.7, false));   // let the storm advance (frames are ~0.7s here)
  await frames(1);
  const s0 = await st(); if (s0.mode !== 'play') break;
  const a = s0.marks.filter((m) => m.active);
  for (const m of a) { if (MOBILE) await page.touchscreen.tap(m.x, m.y); else await page.mouse.click(m.x, m.y); clicks++; }
}
const a1 = await st();
console.log(`phase A: ${clicks} real ${MOBILE ? 'taps' : 'clicks'} on projected marks -> score ${a1.score}, crack ${a1.crack.toFixed(2)}, t=${a1.t.toFixed(1)}s`);
if (clicks && a1.score === 0) { console.log('FAIL: clicks did not register'); process.exit(1); }
// keyboard mapping: press the number of the next active mark
await page.evaluate(() => window.__poe.ff(1.2, false)); await frames(1);
const a2 = await st(); const k = a2.marks.find((m) => m.active);
if (k) { await page.keyboard.press(String(k.i + 1)); await frames(1); const a3 = await st(); console.log(`key ${k.i + 1} -> score ${a2.score} -> ${a3.score}`); }
// then stop bracing and let the fissure reach the tarn
await page.evaluate(() => window.__poe.ff(45, false));
await page.waitForFunction(() => window.__poe.state === 'lose', null, { timeout: 30000 });
console.log('LOSE reached at t=' + (await page.evaluate(() => window.__poe.t.toFixed(1))) + 's');
await page.evaluate(() => window.__poe.ff(6.5, false));
await page.waitForFunction(() => document.querySelector('#lose').classList.contains('show'), null, { timeout: 60000 });
// restart from the lose screen with Enter, auto-brace through to the win
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__poe.state === 'play');
await page.evaluate(() => window.__poe.ff(75, true));
await page.waitForFunction(() => window.__poe.state === 'win', null, { timeout: 30000 });
console.log('WIN reached, score=' + (await page.evaluate(() => window.__poe.score)));
await page.evaluate(() => window.__poe.ff(5, false));
await page.waitForFunction(() => document.querySelector('#win').classList.contains('show'), null, { timeout: 60000 });
await page.click('#again1');
await page.waitForFunction(() => window.__poe.state === 'play');
console.log('restart from the win screen: ok');
const bestSaved = await page.evaluate(() => localStorage.getItem('poe:house-of-usher:best'));
console.log('best persisted: ' + bestSaved);

/* ================= phase B: the four frames at real resolution (slow under SwiftShader) ================= */
const SC = MOBILE ? 0.34 : 0.5;
await page.goto(base + `?scale=${SC}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__poe && window.__poe.state === 'title', null, { timeout: 60000 });
await page.evaluate(() => window.__poe.ff(1.2, false)); await frames(2);
await shot('title'); console.log('shot: title');
await page.evaluate(() => document.getElementById('start').click());
await page.waitForFunction(() => window.__poe.state === 'play');
await page.evaluate(() => { window.__poe.ff(9, true); window.__poe.setCrack(0.42); window.__poe.ff(0.3, false); });
await frames(2);
await shot('play'); console.log('shot: play');
await page.evaluate(() => { window.__poe.forceLose(); window.__poe.ff(0.1, false); window.__poe.ff(3.5, false); });
await frames(2);
await shot('collapse'); console.log('shot: collapse');
await page.evaluate(() => window.__poe.ff(3.5, false));
await page.waitForFunction(() => document.querySelector('#lose').classList.contains('show'), null, { timeout: 120000 });
await frames(2); await sleep(1500);
await shot('lose'); console.log('shot: lose');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__poe.state === 'play');
await page.evaluate(() => { window.__poe.ff(75, true); window.__poe.ff(3.3, false); });
await page.waitForFunction(() => window.__poe.state === 'win', null, { timeout: 30000 });
await page.evaluate(() => window.__poe.ff(1.5, false));
await page.waitForFunction(() => document.querySelector('#win').classList.contains('show'), null, { timeout: 120000 });
await frames(2); await sleep(1500);
await shot('win'); console.log('shot: win');

await browser.close(); srv.close();
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of errors) console.log('  - ' + e); process.exit(1); }
console.log('playtest ok, no console errors');
