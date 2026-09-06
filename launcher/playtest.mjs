#!/usr/bin/env node
/* poe-arcade — launcher/playtest.mjs
 * Extra launcher screenshots beyond tools/verify.mjs:
 *   screenshots/launcher-desktop-hover.png    (doors open, a drawer hovered)
 *   screenshots/launcher-mobile-expanded.png  (a drawer expanded on the phone)
 * Also reports any console error it sees. Run:  node launcher/playtest.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json' };

function serve(rootDir) {
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
function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    for (const f of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = path.join(base, d, f);
      if (/^chromium/.test(d) && fs.existsSync(p)) return p;
    }
  }
  throw new Error('no chromium under ' + base);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, port } = await serve(ROOT);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await fsp.mkdir(SHOTS, { recursive: true });
const problems = [];
const wire = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${tag}] http ${r.status()} ${r.url()}`); });
};

/* seed a best score so the tag shows a real number */
const seed = `localStorage.setItem('poe:masque-red-death:best', JSON.stringify({ score: 1842 }));
              localStorage.setItem('poe:the-raven:best', JSON.stringify({ score: 27 }));`;

// desktop: closed doors (poster), then open + hover
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); wire(page, 'desktop');
  await page.addInitScript(seed);
  await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
  await page.mouse.move(600, 300);
  await sleep(1800);
  await page.screenshot({ path: path.join(SHOTS, 'launcher-desktop-closed.png') });
  await page.mouse.click(700, 450);
  await sleep(1300);
  await page.hover('.drawer[data-slug="masque-red-death"] .front');
  await page.mouse.move(560, 330);
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, 'launcher-desktop-hover.png') });

  // click the drawer: the pull-out transition must end in the game
  const nav = page.waitForURL(/games\/masque-red-death\//, { timeout: 8000, waitUntil: 'commit' });
  await page.click('.drawer[data-slug="masque-red-death"] .front');
  await nav;
  console.log('  desktop: navigated to', page.url());
  await ctx.close();
}

// mobile: tap to expand, screenshot, tap open, confirm navigation
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); wire(page, 'mobile');
  await page.addInitScript(seed);
  await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
  await sleep(1500);
  await page.screenshot({ path: path.join(SHOTS, 'launcher-mobile-top.png') });
  await page.tap('.drawer[data-slug="masque-red-death"] .front');
  await sleep(900);
  await page.screenshot({ path: path.join(SHOTS, 'launcher-mobile-expanded.png') });
  const nav = page.waitForURL(/games\/masque-red-death\//, { timeout: 8000, waitUntil: 'commit' });
  await page.tap('.drawer[data-slug="masque-red-death"] .enter');
  await nav;
  console.log('  mobile: navigated to', page.url());
  await ctx.close();
}

await browser.close();
srv.close();
if (problems.length) { console.log('\n  PROBLEMS'); for (const p of problems) console.log('   - ' + p); process.exit(1); }
console.log('  playtest OK -> screenshots/launcher-desktop-{closed,hover}.png, launcher-mobile-{top,expanded}.png');
