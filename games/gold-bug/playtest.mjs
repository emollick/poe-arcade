#!/usr/bin/env node
/* The Gold-Bug — playtest.mjs
 * Plays Kidd's Cipher with scripted input far enough to reach both the win
 * and the lose state, and saves screenshots/gold-bug-{title,play,win,lose}.png
 * (plus -title-mobile / -play-mobile for the phone layout).
 *
 *   node games/gold-bug/playtest.mjs          # from the repo root
 *
 * Uses tools/node_modules/playwright-core and the preinstalled Chromium
 * exactly as tools/verify.mjs does. The win is reached by actually entering
 * every substitution (click the mark, type the letter); the only cheat is
 * reading the solution from window.__poe and, for the loss, hurrying the
 * rival's clock.
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
    for (const f of ['chrome', 'headless_shell']) {
      const p = path.join(base, d, 'chrome-linux', f);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no chromium under ' + base);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
function startServer(rootDir) {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(rootDir, path.normalize(p));
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

const problems = [];
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${tag}] http ${r.status()} ${r.url()}`); });
}

/** Enter every substitution of the current round by clicking the mark in the
 * frequency chart and typing its letter. `wrongEvery` sprinkles wrong guesses. */
async function solveRound(page, { wrongEvery = 0, stopAfter = Infinity } = {}) {
  const solution = await page.evaluate(() => window.__poe.solution());
  const order = await page.evaluate(() => window.__poe.state.cipher.order.slice());
  let n = 0;
  for (const sym of order) {
    if (n >= stopAfter) break;
    const done = await page.evaluate((s) => window.__poe.state.assign[s] === window.__poe.state.cipher.inverse[s], sym);
    if (done) continue;
    const col = page.locator(`.col[data-s="${sym.replace(/"/g, '\\"')}"]`);
    await col.dispatchEvent('pointerdown');
    if (wrongEvery && n % wrongEvery === wrongEvery - 1) {
      const wrong = 'zqxjk'.split('').find((l) => l !== solution[sym]);
      await page.keyboard.press(wrong); // the mark stays selected after a blot
      await sleep(120);
    }
    await page.keyboard.press(solution[sym]);
    await sleep(90);
    n++;
  }
  return n;
}

async function glyphCheck(page) {
  // does Special Elite carry every one of Kidd's marks? (compare against the fallback alone)
  return page.evaluate(async () => {
    await document.fonts.load("20px 'Special Elite'");
    await document.fonts.load("20px 'JetBrains Mono'");
    const c = document.createElement('canvas').getContext('2d');
    const marks = '8;4‡)*56(†1092:3?¶-.]§&=+!';
    const missing = [];
    for (const m of marks) {
      c.font = "40px 'Special Elite', 'JetBrains Mono'"; const a = c.measureText(m).width;
      c.font = "40px 'JetBrains Mono'"; const b = c.measureText(m).width;
      if (Math.abs(a - b) < 0.01) missing.push(m);
    }
    c.font = "40px 'Special Elite', 'JetBrains Mono'"; const sa = c.measureText('a').width;
    c.font = "40px 'JetBrains Mono'"; const sb = c.measureText('a').width;
    return { missing, fontLoaded: Math.abs(sa - sb) > 0.01 };
  });
}

const { srv, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}/games/gold-bug/`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
await fsp.mkdir(SHOTS, { recursive: true });

/* ---------- desktop: title, play, win, lose ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1600);
  console.log('glyphs:', JSON.stringify(await glyphCheck(page)));
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-title.png') });

  await page.click('#btnStart');
  await sleep(600);
  // a few real assignments, including one wrong one, then the play frame
  await solveRound(page, { wrongEvery: 3, stopAfter: 5 });
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-play.png') });

  // finish all three rounds by hand
  for (let r = 0; r < 3; r++) {
    await solveRound(page, { wrongEvery: r === 2 ? 6 : 0 });
    await page.waitForFunction(() => window.__poe.state.screen !== 'play', null, { timeout: 5000 });
    const screen = await page.evaluate(() => window.__poe.state.screen);
    console.log(`round ${r + 1} done; screen=${screen} score=${await page.evaluate(() => window.__poe.state.score)}`);
    if (screen === 'interlude') {
      await page.waitForSelector('#interlude:not([hidden])', { timeout: 3000 });
      if (r === 0) await page.screenshot({ path: path.join(SHOTS, 'gold-bug-interlude.png') });
      await page.keyboard.press('Enter'); await sleep(400);
    }
  }
  await page.waitForSelector('#end.win:not([hidden])', { timeout: 8000 });
  await sleep(2200); // let the X and the bee line finish drawing
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-win.png') });
  console.log('win reached; best saved =', JSON.stringify(await page.evaluate(() => localStorage.getItem('poe:gold-bug:best'))));

  // lose: dig again, solve a little, then hurry the rival's clock
  await page.click('#btnAgain');
  await sleep(500);
  await solveRound(page, { stopAfter: 4 });
  await page.evaluate(() => window.__poe.rush(9999));
  await page.waitForSelector('#end.lose:not([hidden])', { timeout: 8000 });
  await sleep(900);
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-lose.png') });
  console.log('lose reached');
  await ctx.close();
}

/* ---------- idle: the timed hints and Legrand's auto-reveal must fire cleanly ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watch(page, 'idle');
  await page.goto(base, { waitUntil: 'load' });
  await sleep(800);
  await page.keyboard.press('Enter'); // starts from the title
  await page.waitForFunction(() => window.__poe.state.elapsed > 27, null, { timeout: 40000 });
  const idle = await page.evaluate(() => ({
    notes: document.querySelectorAll('#notes .note').length,
    hints: window.__poe.state.hintIdx,
    autos: window.__poe.state.autos,
    revealedByLegrand: [...document.querySelectorAll('#text .g.auto')].length,
    rival: +(window.__poe.state.elapsed - window.__poe.state.knock).toFixed(1),
  }));
  console.log('idle 27s:', JSON.stringify(idle));
  if (idle.hints < 2 || idle.autos < 1) problems.push('[idle] hints or auto-reveal did not fire');
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-idle.png') });
  await ctx.close();
}

/* ---------- mobile: title + play with touch taps ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'mobile');
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1600);
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-title-mobile.png') });
  await page.tap('#btnStart');
  await sleep(600);
  // touch flow: tap a mark in the text, then tap a letter on the strip
  const sol = await page.evaluate(() => window.__poe.solution());
  const order = await page.evaluate(() => window.__poe.state.cipher.order.slice(0, 4));
  for (const sym of order) {
    await page.locator(`#text .g[data-s="${sym}"]`).first().dispatchEvent('pointerdown');
    await page.locator(`.key[data-l="${sol[sym]}"]`).dispatchEvent('pointerdown');
    await sleep(150);
  }
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, 'gold-bug-play-mobile.png') });
  const solved = await page.evaluate(() => Object.keys(window.__poe.state.assign).length);
  console.log('mobile taps assigned', solved, 'marks');
  await ctx.close();
}

await browser.close();
srv.close();
if (problems.length) { console.log('\nPROBLEMS'); for (const p of problems) console.log(' -', p); process.exit(1); }
console.log('\nplaytest OK — screenshots in', path.relative(process.cwd(), SHOTS));
