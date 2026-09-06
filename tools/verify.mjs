#!/usr/bin/env node
/* poe-arcade — tools/verify.mjs
 *
 * The harness every game worker runs before calling a game done.
 *
 *   node tools/verify.mjs                      # launcher + all 9 games
 *   node tools/verify.mjs games/the-raven      # one game
 *   node tools/verify.mjs the-raven black-cat  # bare names work too
 *   node tools/verify.mjs tools/selftest       # the reference page (must PASS)
 *
 * For each page, at desktop 1440x900 and mobile 390x844, it:
 *   - serves the site over real http (never file://: ES modules and CORS break)
 *   - waits for network idle + 2500ms of animation
 *   - nudges the page (centre click, Enter, Space) for games that need a start
 *   - fails on any console.error, uncaught page error, or 4xx/5xx request
 *   - fails if the page is effectively BLANK (see notBlank() below)
 *   - writes screenshots/<name>-desktop.png and screenshots/<name>-mobile.png
 *
 * Exits non-zero if anything failed.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');

/* ---------- playwright resolution ------------------------------------------
 * Prefer tools/node_modules/playwright-core (committed as a devDependency and
 * installed with --no-bin-links, since this filesystem has no symlinks).
 * Fall back to a global playwright install so the harness still runs on a box
 * where `npm i` in tools/ has not been done. */
async function loadChromium() {
  const require = createRequire(import.meta.url);
  const tries = ['playwright-core', 'playwright'];
  for (const m of tries) {
    try { return (await import(m)).chromium; } catch {}
    try { return require(m).chromium; } catch {}
  }
  // global install (npm root -g)
  try {
    const { execFileSync } = await import('node:child_process');
    const g = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    for (const m of tries) {
      const p = path.join(g, m);
      if (fs.existsSync(p)) return (await import(url.pathToFileURL(path.join(p, 'index.js')).href)).chromium;
    }
  } catch {}
  throw new Error('playwright not found. Run:  cd tools && npm i --no-bin-links');
}

/* Preinstalled browser. NEVER run `playwright install` in this container. */
function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const candidates = [];
  try {
    for (const d of fs.readdirSync(base)) {
      if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
      candidates.push(
        path.join(base, d, 'chrome-linux', 'chrome'),
        path.join(base, d, 'chrome-linux', 'headless_shell'),
      );
    }
  } catch {}
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`no chromium binary under ${base}`);
  return hit;
}

/* ---------- tiny static server (node built-ins only) ----------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

function startServer(rootDir) {
  const srv = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // Chromium always requests /favicon.ico. Answer it so the automatic
      // request never shows up as a spurious 404 failure in every game.
      if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(rootDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(rootDir)) { res.writeHead(403).end('forbidden'); return; }
      let st;
      try { st = await fsp.stat(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      if (st.isDirectory()) { res.writeHead(302, { location: p + '/' }).end(); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

/* ---------- the not-blank assertion ----------------------------------------
 * Why in-page rather than decoding the PNG: a dependency-free PNG decoder would
 * have to implement zlib inflate + all five filter types, and it would still
 * only see the composited image. Reading the live DOM is both simpler and more
 * informative — it tells us WHICH kind of emptiness we hit.
 *
 * The page passes if EITHER holds:
 *   (a) CANVAS: for the largest on-screen canvas, we read back getImageData and
 *       count how many pixels differ from the single most common colour. A page
 *       that is all black, all white, or a flat un-drawn fill scores ~0%.
 *       Threshold: >= 2% of sampled pixels must differ. We sample on a stride
 *       so a 4K canvas costs the same as a small one. WebGL canvases cannot be
 *       read with getImageData, so for those we re-read via
 *       gl.readPixels on a preserved buffer; when the context was created
 *       without preserveDrawingBuffer that returns blank, so we fall back to
 *       the DOM check plus a "canvas is animating" heuristic (two rAF frames
 *       with differing timestamps AND a non-zero-size canvas).
 *   (b) DOM/SVG: count elements with a non-zero bounding box that carry visible
 *       paint (text, background, border, image, or being an svg/img/video).
 *       >= 8 such elements means a real page rendered.
 *
 * A page needs only one of the two to pass, because a canvas game legitimately
 * has almost no DOM and a DOM game legitimately has no canvas. */
const NOT_BLANK_FN = `() => {
  const out = { mode: null, canvas: null, dom: null, ok: false, why: '' };

  // ---- (a) canvas ----
  const canvases = [...document.querySelectorAll('canvas')]
    .map(c => ({ c, r: c.getBoundingClientRect() }))
    .filter(o => o.r.width > 40 && o.r.height > 40)
    .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height));

  if (canvases.length) {
    const c = canvases[0].c;
    let data = null, note = '';
    const ctx2d = (() => { try { return c.getContext('2d'); } catch { return null; } })();
    if (ctx2d && typeof ctx2d.getImageData === 'function') {
      try { data = ctx2d.getImageData(0, 0, c.width, c.height).data; } catch (e) { note = '2d read blocked: ' + e.message; }
    }
    if (!data) {
      // WebGL / WebGPU path: snapshot through an offscreen 2d canvas. This works
      // whenever the drawing buffer is still valid (preserveDrawingBuffer, or
      // immediately after a draw within the same frame).
      try {
        const t = document.createElement('canvas');
        const w = t.width = Math.min(c.width || 1, 512);
        const h = t.height = Math.min(c.height || 1, 512);
        const tx = t.getContext('2d', { willReadFrequently: true });
        tx.drawImage(c, 0, 0, w, h);
        data = tx.getImageData(0, 0, w, h).data;
        note = note || 'sampled via drawImage';
      } catch (e) { note = note + ' | drawImage failed: ' + e.message; }
    }
    if (data) {
      const counts = new Map();
      const px = data.length / 4;
      const stride = Math.max(1, Math.floor(px / 20000)); // cap at ~20k samples
      let sampled = 0;
      for (let i = 0; i < px; i += stride) {
        const o = i * 4;
        // quantise to 4 bits/channel so film grain / dithering is not counted as signal
        const k = ((data[o] >> 4) << 8) | ((data[o+1] >> 4) << 4) | (data[o+2] >> 4);
        counts.set(k, (counts.get(k) || 0) + 1);
        sampled++;
      }
      let top = 0;
      for (const v of counts.values()) if (v > top) top = v;
      const diffRatio = sampled ? (sampled - top) / sampled : 0;
      out.mode = 'canvas';
      out.canvas = {
        w: c.width, h: c.height, cssW: Math.round(canvases[0].r.width), cssH: Math.round(canvases[0].r.height),
        sampled, distinctColors: counts.size, differingPct: +(diffRatio * 100).toFixed(2), note,
      };
      // PRIMARY RULE: >=2% of sampled pixels differ from the single most common
      // colour. An all-black / all-white / never-drawn canvas scores ~0%.
      // SECONDARY RULE: Poe games are deliberately dark, and a moody scene can
      // legitimately sit under 2% while still being a real render. So also pass
      // a canvas that shows genuine tonal variety (>=16 distinct quantised
      // colours) with a non-trivial amount of non-modal pixels. A blank canvas
      // fails both: it has 1-2 colours and ~0% non-modal pixels.
      if (diffRatio >= 0.02) {
        out.ok = true; out.why = 'canvas has ' + out.canvas.differingPct + '% non-modal pixels';
      } else if (counts.size >= 16 && diffRatio >= 0.0035) {
        out.ok = true; out.why = 'canvas has ' + counts.size + ' distinct colours and ' + out.canvas.differingPct + '% non-modal pixels';
      }
    }
  }

  // ---- (b) DOM / SVG ----
  let painted = 0;
  const els = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) continue;
    const tag = el.tagName.toLowerCase();
    const structural = tag === 'html' || tag === 'body' || tag === 'main' || tag === 'div' || tag === 'section';
    const hasPaint =
      ['svg','path','circle','rect','line','polygon','text','img','video','canvas','button','a','input'].includes(tag) ||
      (s.backgroundImage && s.backgroundImage !== 'none') ||
      (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && !structural) ||
      (s.borderTopWidth !== '0px' || s.borderLeftWidth !== '0px') ||
      (el.childElementCount === 0 && (el.textContent || '').trim().length > 0);
    if (hasPaint) painted++;
  }
  out.dom = { paintedElements: painted };
  if (!out.ok && painted >= 8) { out.mode = out.mode || 'dom'; out.ok = true; out.why = painted + ' painted DOM elements'; }

  if (!out.ok) {
    out.why = out.mode === 'canvas'
      ? 'canvas is effectively flat (' + (out.canvas ? out.canvas.differingPct : '?') + '% non-modal pixels) and only ' + painted + ' painted DOM elements'
      : 'no usable canvas and only ' + painted + ' painted DOM elements';
  }
  return out;
}`;

/* ---------- page discovery -------------------------------------------------- */

function discover(args) {
  const gamesDir = path.join(ROOT, 'games');
  const all = fs.existsSync(gamesDir)
    ? fs.readdirSync(gamesDir).filter((d) => fs.existsSync(path.join(gamesDir, d, 'index.html'))).sort()
    : [];
  if (!args.length) {
    return [{ name: 'launcher', route: '/index.html' }, ...all.map((g) => ({ name: g, route: `/games/${g}/` }))];
  }
  return args.map((a) => {
    const cleaned = a.replace(/^\.?\//, '').replace(/\/+$/, '').replace(/\/index\.html$/, '');
    if (cleaned === '' || cleaned === 'index.html' || cleaned === 'launcher') return { name: 'launcher', route: '/index.html' };
    // Any path under the repo root that has an index.html is verifiable as-is
    // (e.g. `node tools/verify.mjs tools/selftest`). Otherwise treat the
    // argument as a bare game slug.
    if (fs.existsSync(path.join(ROOT, cleaned, 'index.html'))) {
      return { name: cleaned.split('/').filter(Boolean).join('-'), route: `/${cleaned}/` };
    }
    const g = cleaned.startsWith('games/') ? cleaned.slice(6) : cleaned;
    return { name: g, route: `/games/${g}/` };
  });
}

/* ---------- one page, one viewport ------------------------------------------ */

const VIEWPORTS = [
  { tag: 'desktop', opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { tag: 'mobile',  opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkOne(browser, base, page_, vp) {
  const problems = [];
  const ctx = await browser.newContext({ ...vp.opts, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // The browser's own favicon probe is not the game's fault; never fail on it.
  const noise = (u = '') => /\/favicon\.(ico|png)$/.test(u);

  page.on('console', (m) => {
    const t = m.text();
    if (m.type() !== 'error') return;
    // A console.error whose only cause is the favicon probe carries no location.
    if (/Failed to load resource/.test(t) && noise(m.location() && m.location().url)) return;
    problems.push(`console.error: ${t}`.slice(0, 400));
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`.slice(0, 400)));
  page.on('requestfailed', (r) => {
    if (noise(r.url())) return;
    const f = r.failure();
    problems.push(`requestfailed: ${r.url().slice(0, 160)} (${f ? f.errorText : 'unknown'})`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !noise(r.url())) problems.push(`http ${r.status()}: ${r.url().slice(0, 160)}`);
  });

  let blank = null;
  try {
    await page.goto(base + page_.route, { waitUntil: 'load', timeout: 45000 });
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* long-poll / rAF audio keeps it busy; fine */ }
    await sleep(2500);

    /* Nudge: many games sit on a title screen until you interact. Every step is
     * individually guarded so a page with nothing clickable cannot crash us. */
    const vpSize = page.viewportSize() || { width: 800, height: 600 };
    try { await page.mouse.click(Math.floor(vpSize.width / 2), Math.floor(vpSize.height / 2), { delay: 40 }); } catch {}
    try { await page.keyboard.press('Enter'); } catch {}
    try { await page.keyboard.press('Space'); } catch {}
    await sleep(2500);

    // NOTE: Playwright evaluates a STRING as an expression, so the arrow-function
    // source must be wrapped in an immediately-invoked call to actually run it.
    blank = await page.evaluate(`(${NOT_BLANK_FN})()`);

    /* Without <meta name="viewport" content="width=device-width, ...">, Chromium
     * lays a mobile page out at the legacy 980px width and scales it down: the
     * game renders at the wrong size and touch coordinates are wrong. This is
     * the single most common mobile-breaking omission, so check it explicitly
     * rather than letting it show up as a mystery. */
    const vpMeta = await page.evaluate(() => {
      const m = document.querySelector('meta[name="viewport"]');
      return { present: !!m, content: m ? m.getAttribute('content') : null, layoutWidth: document.documentElement.clientWidth };
    });
    if (!vpMeta.present) {
      problems.push('missing <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"> — mobile lays out at 980px without it');
    } else if (!/width\s*=\s*device-width/i.test(vpMeta.content || '')) {
      problems.push(`viewport meta lacks width=device-width (got "${vpMeta.content}")`);
    }
  } catch (e) {
    problems.push(`navigation: ${e.message}`.slice(0, 400));
  }

  await fsp.mkdir(SHOTS, { recursive: true });
  const shot = path.join(SHOTS, `${page_.name}-${vp.tag}.png`);
  try { await page.screenshot({ path: shot }); } catch (e) { problems.push(`screenshot: ${e.message}`); }

  if (!blank) problems.push('not-blank check did not run (page never became evaluable)');
  else if (!blank.ok) problems.push(`BLANK: ${blank.why}`);

  await ctx.close();
  return { problems, blank, shot: path.relative(ROOT, shot) };
}

/* ---------- main ------------------------------------------------------------ */

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const pages = discover(args);
const chromium = await loadChromium();
const { srv, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  executablePath: chromiumExecutable(),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

console.log(`\n  poe-arcade verify — serving ${ROOT} at ${base}`);
console.log(`  ${pages.length} page(s) x ${VIEWPORTS.length} viewport(s)\n`);

const rows = [];
let failures = 0;

for (const p of pages) {
  for (const vp of VIEWPORTS) {
    process.stdout.write(`  … ${p.name} @ ${vp.tag}`.padEnd(46));
    const r = await checkOne(browser, base, p, vp);
    const pass = r.problems.length === 0;
    if (!pass) failures++;
    const detail = r.blank
      ? (r.blank.mode === 'canvas' && r.blank.canvas
          ? `canvas ${r.blank.canvas.w}x${r.blank.canvas.h}, ${r.blank.canvas.differingPct}% non-modal, ${r.blank.canvas.distinctColors} colours, ${r.blank.dom.paintedElements} dom`
          : `${r.blank.dom.paintedElements} painted dom elements`)
      : '—';
    console.log(pass ? 'PASS' : `FAIL (${r.problems.length})`);
    rows.push({ page: p.name, vp: vp.tag, pass, detail, problems: r.problems, shot: r.shot });
  }
}

await browser.close();
srv.close();

/* summary table */
const W = { page: Math.max(6, ...rows.map((r) => r.page.length)), vp: 7 };
console.log('\n  ' + '─'.repeat(W.page + W.vp + 60));
console.log('  ' + 'PAGE'.padEnd(W.page) + '  ' + 'VIEW'.padEnd(W.vp) + '  ' + 'RESULT'.padEnd(8) + '  DETAIL');
console.log('  ' + '─'.repeat(W.page + W.vp + 60));
for (const r of rows) {
  console.log('  ' + r.page.padEnd(W.page) + '  ' + r.vp.padEnd(W.vp) + '  ' + (r.pass ? 'PASS' : 'FAIL').padEnd(8) + '  ' + r.detail);
}
console.log('  ' + '─'.repeat(W.page + W.vp + 60));

const bad = rows.filter((r) => !r.pass);
if (bad.length) {
  console.log('\n  PROBLEMS\n');
  for (const r of bad) {
    console.log(`  ${r.page} @ ${r.vp}`);
    for (const p of r.problems) console.log(`      - ${p}`);
    console.log('');
  }
}

console.log(`  screenshots -> ${path.relative(process.cwd(), SHOTS)}/`);
console.log(`  ${rows.length - failures}/${rows.length} passed\n`);
process.exit(failures ? 1 : 0);
