#!/usr/bin/env node
/* THE RAVEN — scripted playtest.
 *   node games/the-raven/playtest.mjs        (run from the repo root)
 * Serves the repo over http, plays the game with real clicks to BOTH endings,
 * and writes screenshots/the-raven-{title,play,win,lose,mobile-play}.png.
 * Uses tools/node_modules/playwright-core and the preinstalled Chromium, exactly as tools/verify.mjs does. */
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png' };
function serve() {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/favicon.ico') return res.writeHead(204).end();
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    try { const st = await fsp.stat(file); res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size }); fs.createReadStream(file).pipe(res); }
    catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPhase(page, want, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ph = await page.evaluate(() => window.__poe && window.__poe.state.phase);
    if (want.includes(ph)) return ph;
    await sleep(60);
  }
  throw new Error(`timed out waiting for phase ${want}`);
}
/* play rounds by clicking real cards until the game ends; `strategy` picks a slot */
async function playUntilEnd(page, strategy, onRound) {
  for (let i = 0; i < 60; i++) {
    const ph = await waitPhase(page, ['await', 'end']);
    if (ph === 'end') return;
    const st = await page.evaluate(() => ({ s: window.__poe.safeSlots(), r: window.__poe.ruinSlots(), state: window.__poe.state }));
    const slot = strategy(st);
    if (onRound) await onRound(st.state, slot);
    await page.click(`.card[data-slot="${slot}"]`);
    await waitPhase(page, ['resolve', 'end']);
  }
}

const problems = [];
const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}/games/the-raven/`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
await fsp.mkdir(SHOTS, { recursive: true });

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`); });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.fonts.status === 'loaded' && window.__poe);
  return { ctx, page };
}

/* ── desktop: title → win ── */
{
  const { ctx, page } = await open({ viewport: { width: 1440, height: 900 } });
  await sleep(4200);                                   // let the plate draw itself
  await page.screenshot({ path: path.join(SHOTS, 'the-raven-title.png') });
  await page.click('#begin');
  let shotDone = false;
  await playUntilEnd(page, (st) => st.s[0], async (state) => {
    if (!shotDone && state.round === 4) {              // mid-game frame: cards out, lamp burning, one shadow step
      await sleep(900);
      await page.screenshot({ path: path.join(SHOTS, 'the-raven-play.png') });
      shotDone = true;
    }
    if (state.round === 2) {                           // take one ruinous answer on purpose so the shadow has moved
      const r = await page.evaluate(() => window.__poe.ruinSlots()[0]);
      await page.click(`.card[data-slot="${r}"]`);
      await waitPhase(page, ['resolve']);
    }
  });
  const end = await page.evaluate(() => window.__poe.state);
  console.log('desktop run ended:', end);
  if (end.safe < 18) problems.push('expected the WIN state, got ' + JSON.stringify(end));
  await sleep(5200);                                   // dawn, takeoff, feathers, panel
  await page.screenshot({ path: path.join(SHOTS, 'the-raven-win.png') });
  const winText = await page.textContent('#endLine');
  if (!/Take thy beak/.test(winText)) problems.push('win line missing');
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('poe:the-raven:best')));
  console.log('saved best:', best);
  if (!best || !best.won) problems.push('best score not persisted');

  /* restart without reload → lose */
  await page.click('#again');
  await playUntilEnd(page, (st) => st.r[0]);
  const end2 = await page.evaluate(() => window.__poe.state);
  console.log('second run ended:', end2);
  if (end2.steps < 5) problems.push('expected the LOSE state, got ' + JSON.stringify(end2));
  await sleep(4200);
  await page.screenshot({ path: path.join(SHOTS, 'the-raven-lose.png') });
  const loseText = await page.textContent('#endLine');
  if (!/lifted — nevermore/.test(loseText)) problems.push('lose line missing');

  /* the lamp burns out: the raven must choose (ruinously) */
  await page.click('#again');
  await waitPhase(page, ['await']);
  const t0 = Date.now();
  await waitPhase(page, ['resolve'], 15000);
  const byRaven = await page.evaluate(() => !!document.querySelector('.card.byRaven.ruin'));
  console.log(`timeout round resolved after ${Date.now() - t0}ms, raven chose ruin: ${byRaven}`);
  if (!byRaven) problems.push('timeout did not make the raven pick a ruinous card');
  await ctx.close();
}

/* ── mobile portrait: touch play, keys 1/2/3 ── */
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(3600);
  await page.screenshot({ path: path.join(SHOTS, 'the-raven-mobile-title.png') });
  await page.tap('#begin');
  await waitPhase(page, ['await']);
  const slot = await page.evaluate(() => window.__poe.safeSlots()[0]);
  await page.tap(`.card[data-slot="${slot}"]`);
  await waitPhase(page, ['resolve']);
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'the-raven-mobile-play.png') });
  await waitPhase(page, ['await']);
  const k = await page.evaluate(() => window.__poe.safeSlots()[0]);
  await page.keyboard.press(String(k + 1));
  await waitPhase(page, ['resolve']);
  await sleep(900);                                    // the mercy is counted after the croak
  const st = await page.evaluate(() => window.__poe.state);
  if (st.safe !== 2) problems.push('mobile tap + key picks did not both register: ' + JSON.stringify(st));
  else console.log('mobile: tap and key picks both registered, safe =', st.safe);
  await ctx.close();
}

await browser.close(); srv.close();
if (problems.length) { console.log('\nPROBLEMS'); for (const p of problems) console.log(' - ' + p); process.exit(1); }
console.log('\nplaytest PASS — screenshots in', path.relative(process.cwd(), SHOTS));
