#!/usr/bin/env node
/* Seven Chambers — scripted playtest.
 *   node games/masque-red-death/playtest.mjs          (run from the repo root)
 * Serves the repo, plays the game far enough to reach the lose state and (via the
 * window.__poe debug hook) the win state, and writes six screenshots. The play frames are
 * stepped deterministically (window.__poe.step) to stroke II with the Red Death inside five units. */
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
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

const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await fsp.mkdir(SHOTS, { recursive: true });
// SwiftShader is slow: run the long stretches at half resolution, full resolution for every screenshot
const lowRes = (pg, on) => pg.evaluate(`window.__poe.setResolution(${on ? 0.35 : 1})`);
// freeze the game clock (rendering continues), switch to full resolution, shoot, resume
const shot = async (n, pg = page) => {
  await pg.evaluate('window.__poe.setMaxDt(0)'); await lowRes(pg, false); await sleep(600);
  await pg.screenshot({ path: path.join(SHOTS, `masque-red-death-${n}.png`) });
  await lowRes(pg, true); await pg.evaluate('window.__poe.setMaxDt(0.6)');
};
const poe = (expr) => page.evaluate(expr);
const waitFor = (expr, ms = 150000) => page.waitForFunction(expr, null, { timeout: ms, polling: 100 });
// freeze the rendered clock and walk the simulation forward until he is `within` units of the player (stroke in progress)
const stepUntilClose = (pg, within) => pg.evaluate(`(() => {
  const P = window.__poe; P.setMaxDt(0);
  for (let i = 0; i < 4000 && !(P.strike && P.strike.k >= 2 && P.rd.active && P.player.z - P.rd.z < ${within}); i++) P.step(1 / 60);
  return JSON.stringify({ k: P.strike && P.strike.k, rung: P.strike && P.strike.rung, dz: +(P.player.z - P.rd.z).toFixed(2), px: +P.player.x.toFixed(2), rdx: +P.rd.x.toFixed(2) });
})()`);

await page.goto(`http://127.0.0.1:${port}/games/masque-red-death/`, { waitUntil: 'load', timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await sleep(3000);
await shot('title');
console.log('title captured');

// The headless GPU is slow; let the simulation cover real time.
await poe('window.__poe.setMaxDt(0.6)'); await lowRes(page, true);

/* ---- run 1: play with scripted strafing, capture stroke II with the Red Death close, then let him win ---- */
await page.mouse.click(720, 450);
await waitFor('window.__poe.mode === "play"');
await poe('window.__poe.godmode = true; window.__poe.setStrikes(1);');
// weave for a few seconds
let dir = 1;
for (let i = 0; i < 12; i++) { await poe(`window.__poe.setInput({left:${dir < 0}, right:${dir > 0}})`); dir = -dir; await sleep(350); }
await poe('window.__poe.setInput({left:false,right:false})');
await page.keyboard.press('Space');
await poe('window.__poe.strikeNow()');
await waitFor('window.__poe.strike && window.__poe.strike.k >= 2');
await poe('window.__poe.setX(-1.9)');
const strikeInfo = await stepUntilClose(page, 4.6);
await shot('play');
console.log('play captured, score', await poe('window.__poe.run.score'), 'strike', strikeInfo);
// now hang back in his path and let him take us at the next stroke
await poe('window.__poe.godmode = false; window.__poe.setInput({down:true}); window.__poe.strikeNow();');
await waitFor('window.__poe.mode === "dead"', 150000);
await waitFor('!document.getElementById("end").hidden', 15000);
await sleep(1200);
await shot('lose');
console.log('lose captured, score', await poe('window.__poe.run.score'));

/* ---- run 2: eleven strokes already survived; survive midnight for the win ---- */
await poe('window.__poe.setInput({down:false})');
await page.keyboard.press('Enter');
await waitFor('window.__poe.mode === "play"');
await poe('window.__poe.setStrikes(11); window.__poe.godmode = true; window.__poe.strikeNow();');
await waitFor('window.__poe.strike !== null', 150000);
await waitFor('window.__poe.mode === "won"', 150000);
await waitFor('!document.getElementById("end").hidden', 15000);
await sleep(1200);
await shot('win');
console.log('win captured, score', await poe('window.__poe.run.score'));
console.log('best saved:', await poe('localStorage.getItem("poe:masque-red-death:best")'));

await ctx.close();   // stop the desktop page rendering before the phone pass

/* ---- phone: title and a strike frame in portrait ---- */
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
mp.on('console', (m) => { if (m.type() === 'error') errors.push('mobile: ' + m.text()); });
mp.on('pageerror', (e) => errors.push('mobile: ' + e.message));
await mp.goto(`http://127.0.0.1:${port}/games/masque-red-death/`, { waitUntil: 'load', timeout: 120000 });
await mp.evaluate(() => document.fonts.ready);
await sleep(2500);
await mp.screenshot({ path: path.join(SHOTS, 'masque-red-death-title-mobile.png') });
await mp.evaluate('window.__poe.setMaxDt(0.6)'); await lowRes(mp, true);
await mp.touchscreen.tap(195, 500);
await mp.waitForFunction('window.__poe.mode === "play"', null, { timeout: 60000 });
await mp.evaluate('window.__poe.godmode = true; window.__poe.setStrikes(1); window.__poe.strikeNow();');
await mp.waitForFunction('window.__poe.strike && window.__poe.strike.k >= 2', null, { timeout: 150000 });
await mp.evaluate('window.__poe.setX(-1.2)');
const mInfo = await stepUntilClose(mp, 4.2);
await shot('play-mobile', mp);
console.log('mobile title + play captured', mInfo);
await mctx.close();

await browser.close(); srv.close();
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of errors) console.log('  ' + e); process.exit(1); }
console.log('playtest OK, no console errors');
