#!/usr/bin/env node
/* FISSURE bots — tuning harness for the fissure clock.
 *   node games/house-of-usher/bots.mjs             (from the repo root)
 *   node games/house-of-usher/bots.mjs --marks     (only the projected-mark check per viewport)
 * Each bot plays a whole run in-page: the sim is stepped at 1/60 s through
 * __poe.step(), and every lit brace gets a real pointerdown on #stage at its
 * projected position exactly `reaction` seconds after it lit — or is skipped,
 * at the bot's error rate (a skip is an expiry, the first-timer's usual miss).
 * Math.random is seeded per run so a row is reproducible. */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');
const ONLY_MARKS = process.argv.includes('--marks');

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

const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const base = `http://127.0.0.1:${port}/games/house-of-usher/`;
const errors = [];

async function openPage(vp, touch) {
  const ctx = await browser.newContext(touch ? { viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: vp, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__poe && window.__poe.state === 'title', null, { timeout: 60000 });
  return { ctx, page };
}

/* ---------- the projected-mark check (bug 2) ---------- */
const VIEWPORTS = [[1440, 900, false], [1366, 768, false], [1280, 720, false], [844, 390, true], [390, 844, true]];
console.log('projected braces per viewport (play camera; r = reflection):');
for (const [w, h, touch] of VIEWPORTS) {
  const { ctx, page } = await openPage({ width: w, height: h }, touch);
  const r = await page.evaluate(() => {
    const P = window.__poe; P.start(); P.step(1 / 60);
    const ms = P.marks.map((m) => ({ k: (m.refl ? 'r' : 'f') + (m.i + 1), x: Math.round(m.x), y: Math.round(m.y), off: m.off }));
    return { ms, H: innerHeight };
  });
  const deepest = r.ms.reduce((a, m) => (m.y > a.y ? m : a));
  const offs = r.ms.filter((m) => m.off).map((m) => m.k);
  console.log(`  ${String(w + 'x' + h).padEnd(9)} deepest ${deepest.k} at y=${deepest.y} of ${r.H} (limit ${r.H - 40})  off-screen: ${offs.length ? offs.join(',') : 'none'}   ` +
    r.ms.filter((m) => !m.refl && m.k[0] === 'f').map((m) => `${m.k}(${m.x},${m.y})`).join(' '));
  await ctx.close();
}
if (ONLY_MARKS) { await browser.close(); srv.close(); process.exit(0); }

/* ---------- the bots ---------- */
async function runBot(page, cfg) {
  return page.evaluate((cfg) => {
    const P = window.__poe;
    let s = (cfg.seed * 2654435761) >>> 0; const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    P.start();
    const stage = document.getElementById('stage');
    const step = 1 / 60;
    const pending = []; const seen = new Set();
    const out = { braces: 0, taps: 0, skips: 0, forks: 0, samples: [], aliveAt50: false, seq: [] };
    let guard = 0;
    while (P.state === 'play' && guard++ < 60 * 90) {
      P.step(step);
      const t = P.t;
      const ms = P.marks;
      const lit = ms.filter((m) => m.active);
      const fresh = lit.filter((m) => !seen.has(`${m.i}:${m.refl}:${m.born.toFixed(3)}`));
      if (fresh.length) {
        for (const m of fresh) seen.add(`${m.i}:${m.refl}:${m.born.toFixed(3)}`);
        out.braces++;
        if (fresh.length > 1) out.forks++;
        // a fork: brace the lower one (the learned play) or either at random (the naive play)
        let pick = fresh[0];
        if (fresh.length > 1) pick = cfg.forkLower ? fresh.reduce((a, m) => (m.i > a.i ? m : a)) : fresh[Math.floor(rng() * fresh.length)];
        const skip = rng() < cfg.err;
        if (skip) out.skips++;
        if (out.seq.length < 40) out.seq.push((pick.refl ? 'r' : '') + (pick.i + 1) + (skip ? 'x' : ''));
        pending.push({ at: t + cfg.reaction, i: pick.i, refl: pick.refl, born: pick.born, skip });
      }
      for (let k = pending.length - 1; k >= 0; k--) {
        const p = pending[k];
        if (t < p.at) continue;
        pending.splice(k, 1);
        if (p.skip) continue;
        const cur = ms.find((m) => m.i === p.i && m.refl === p.refl && m.active && Math.abs(m.born - p.born) < 1e-6);
        if (!cur) continue;
        stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: cur.x, clientY: cur.y, bubbles: true, pointerId: 1, pointerType: cfg.touch ? 'touch' : 'mouse', isPrimary: true }));
        out.taps++;
      }
      const sec = Math.floor(t + 1e-6);
      if (sec % 10 === 0 && !out.samples.some((x) => x[0] === sec)) out.samples.push([sec, +P.crack.toFixed(2)]);
      if (t >= 50 && P.state === 'play') out.aliveAt50 = true;
    }
    return { ...out, result: P.state, t: +P.t.toFixed(1), crack: +P.crack.toFixed(2), score: P.score };
  }, cfg);
}

const rows = [];
const table = [
  { reaction: 0.45, err: 0.00, seeds: [1] },
  { reaction: 0.45, err: 0.05, seeds: [1, 2, 3] },
  { reaction: 0.45, err: 0.12, seeds: [1, 2, 3] },
  { reaction: 0.45, err: 0.20, seeds: [1, 2] },
  { reaction: 0.70, err: 0.12, seeds: [1, 2] },
  { reaction: 0.45, err: 0.05, seeds: [1, 2], forkLower: false },
];
const { ctx, page } = await openPage({ width: 1440, height: 900 }, false);
for (const row of table) {
  for (const seed of row.seeds) {
    await page.addInitScript((seed) => {
      let s = (seed * 747796405 + 2891336453) >>> 0;
      Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }, seed);
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__poe && window.__poe.state === 'title', null, { timeout: 60000 });
    const r = await runBot(page, { reaction: row.reaction, err: row.err, seed, forkLower: row.forkLower !== false, touch: false });
    rows.push({ ...row, seed, ...r });
    const samples = r.samples.map(([s, c]) => `${s}s:${c.toFixed(2)}`).join(' ');
    console.log(`react ${row.reaction}s err ${(row.err * 100).toFixed(0).padStart(2)}% ${row.forkLower === false ? 'naive-fork' : 'lower-fork'} seed ${seed}: ${r.result.toUpperCase().padEnd(4)} at ${String(r.t).padStart(4)}s crack ${r.crack.toFixed(2)}  alive@50 ${r.aliveAt50 ? 'yes' : 'no '}  braces ${r.braces} taps ${r.taps} skips ${r.skips} forks ${r.forks} score ${r.score}\n      ${samples}\n      seq ${r.seq.join(' ')}`);
  }
}
await ctx.close();
await browser.close(); srv.close();
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of errors) console.log('  - ' + e); process.exit(1); }
console.log('bots ok, no console errors');
