#!/usr/bin/env node
/* Playtest for games/amontillado — Brick by Brick.
 * Drives the game with scripted pointer input far enough to reach the lose state
 * (a clumsy player: three collapsed courses) and the win state (a skilled player,
 * with the window.__poe debug hook available as a fallback), and saves
 *   screenshots/amontillado-title.png  -play.png  -win.png  -lose.png
 * Run from the repo root:  node games/amontillado/playtest.mjs
 */
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
  throw new Error('no chromium');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
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

/* In-page bot. skill: fraction of the sweet zone it aims inside; err: chance of a deliberately bad tap. */
const BOT = `(opts) => {
  const G = window.__poe.G;
  const down = () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  const up = () => document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  let cool = 0, lastForce = 0, taps = 0, listens = 0;
  window.__bot = { taps: 0, stop: false };
  function step(now) {
    if (window.__bot.stop) return;
    requestAnimationFrame(step);
    if (G.state !== 'play') return;
    if (G.phase === 'force') { if (now - lastForce > 140) { lastForce = now; down(); setTimeout(up, 40); } return; }
    if (G.phase !== 'lay' || G.held) return;
    if (now < cool) return;
    const e = Math.abs(G.disp - G.c);
    if (opts.random) { if (Math.random() < 0.06) { down(); setTimeout(up, 60); cool = now + 250; window.__bot.taps++; } return; }
    // occasionally hold to listen when the marker is dark (the quiet)
    if (G.darkT > 0 && Math.random() < 0.02 && opts.listen) { down(); setTimeout(up, 500); cool = now + 700; listens++; return; }
    if (G.darkT > 0 && !opts.blind) return;
    if (e <= G.hw * opts.skill) {
      const bad = Math.random() < opts.err;
      const delay = bad ? 200 + Math.random() * 250 : Math.random() * 40;
      setTimeout(() => { down(); setTimeout(up, 50); }, delay);
      cool = now + 400 + delay; window.__bot.taps++;
    }
  }
  requestAnimationFrame(step);
}`;

async function waitFor(page, fn, timeout, poll = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn)) return true; await sleep(poll); }
  return false;
}

const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}/games/amontillado/`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
await fsp.mkdir(SHOTS, { recursive: true });
const errors = [];
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
}
const report = {};

/* ---- run 1: desktop, title + skilled play → win */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, 'desktop');
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(2200);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-title.png') });
  await page.mouse.click(720, 450); // start
  await sleep(1200);
  await page.evaluate(`(${BOT})(${JSON.stringify({ skill: 0.75, err: 0.1, listen: true })})`);
  // fps sample during the first seconds of play
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(+(n / 2).toFixed(1)); }; requestAnimationFrame(f); }));
  report.fpsDesktop = fps;
  // play screenshot once a voice/narration line is up around tier 3-4
  await waitFor(page, () => window.__poe.G.tier >= 3, 60000);
  await waitFor(page, () => document.querySelector('#voice.on, #narr.on'), 8000);
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-play.png') });
  const t0 = Date.now();
  const won = await waitFor(page, () => window.__poe.G.state !== 'play', 240000, 500);
  const info = await page.evaluate(() => window.__poe.info());
  report.run1 = { ...info, seconds: +((Date.now() - t0) / 1000).toFixed(1), taps: await page.evaluate(() => window.__bot.taps), ended: won };
  if (info.state !== 'win') {
    // fall back to the debug hook so the win sequence is still exercised and screenshotted
    report.run1.note = 'bot did not win on its own; used __poe hooks to reach the end';
    await page.evaluate(() => { window.__bot.stop = true; });
    if (info.state === 'lose') { await sleep(1500); await page.mouse.click(720, 450); await sleep(1500); }
    await page.evaluate(() => { const P = window.__poe; P.skipTo(10); P.lay(true); P.lay(true); P.lay(true); });
    await waitFor(page, () => window.__poe.G.phase === 'force', 20000);
    for (let i = 0; i < 6; i++) { await page.mouse.click(720, 450); await sleep(150); }
    await waitFor(page, () => window.__poe.G.state !== 'play', 10000);
  }
  await waitFor(page, () => document.querySelector('#end.on'), 12000);
  await sleep(1500);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-win.png') });
  report.best = await page.evaluate(() => localStorage.getItem('poe:amontillado:best'));
  await ctx.close();
}

/* ---- run 2: desktop, clumsy play → lose (the chain gives) */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, 'lose');
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(800);
  await page.keyboard.press('Space');
  await sleep(1200);
  await page.evaluate(`(${BOT})(${JSON.stringify({ random: true })})`);
  const t0 = Date.now();
  const lost = await waitFor(page, () => window.__poe.G.state === 'lose', 150000, 500);
  const info = await page.evaluate(() => window.__poe.info());
  report.run2 = { ...info, seconds: +((Date.now() - t0) / 1000).toFixed(1), taps: await page.evaluate(() => window.__bot.taps), lost };
  await waitFor(page, () => document.querySelector('#end.on'), 8000);
  await sleep(1600);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-lose.png') });
  // the other lose: torch out
  await page.evaluate(() => { window.__bot.stop = true; });
  await page.mouse.click(720, 450); await sleep(1600);
  await page.evaluate(() => window.__poe.setTorch(0.2));
  const torchOut = await waitFor(page, () => window.__poe.G.state === 'lose', 8000);
  await waitFor(page, () => document.querySelector('#end.on'), 8000); await sleep(1500);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-lose-torch.png') });
  report.torchOut = torchOut;
  // restart without reload works?
  await page.mouse.click(720, 450); await sleep(800);
  report.restart = await page.evaluate(() => window.__poe.G.state);
  await ctx.close();
}

/* ---- run 3: mobile portrait, touch */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); watch(page, 'mobile');
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1800);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-mobile-title.png') });
  await page.touchscreen.tap(195, 422);
  await sleep(1200);
  await page.evaluate(`(${BOT})(${JSON.stringify({ skill: 0.75, err: 0.1, listen: true })})`);
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(+(n / 2).toFixed(1)); }; requestAnimationFrame(f); }));
  report.fpsMobile = fps;
  await waitFor(page, () => window.__poe.G.tier >= 2, 40000);
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, 'amontillado-mobile-play.png') });
  report.mobile = await page.evaluate(() => window.__poe.info());
  await ctx.close();
}

await browser.close(); srv.close();
console.log(JSON.stringify(report, null, 2));
if (errors.length) { console.log('\nERRORS:'); for (const e of errors) console.log('  ' + e); process.exit(1); }
console.log('\nno console errors. screenshots in screenshots/amontillado-{title,play,win,lose}.png');
