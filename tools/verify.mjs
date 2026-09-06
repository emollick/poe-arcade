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
/* ---------- the not-blank assertion ----------------------------------------
 * Two independent signals; the page passes if EITHER is satisfied.
 *
 * (1) PIXELS — the authoritative one. We take a real screenshot and count how
 *     many pixels differ from the single most common colour. This is what the
 *     player actually sees, so it works identically for 2D canvas, WebGL,
 *     WebGPU, SVG and plain DOM.
 *
 *     Decoding the PNG is the interesting part. Writing a dependency-free PNG
 *     decoder would mean implementing zlib inflate plus all five scanline
 *     filters, and getting it wrong would produce silent false failures. So
 *     instead we hand the PNG back to the browser — which obviously already
 *     has a decoder — as a data URL, draw it to an offscreen canvas, and read
 *     it with getImageData. No dependency, no hand-rolled codec.
 *
 *     Reading the game's own canvas in-page does NOT work and must not be used:
 *     a WebGL context created without preserveDrawingBuffer (the default, and
 *     what three.js does) returns an empty buffer once the frame is composited,
 *     so a perfectly-rendered 3D scene reads back as 0% and fails. The
 *     screenshot has no such problem.
 *
 *     Before the analysis shot we hide the shared chrome (.poe-back), so the
 *     back link's own pixels can never disguise a genuinely blank game. The
 *     screenshot saved for humans keeps it.
 *
 *     Thresholds: >=2% of pixels differing from the modal colour. Poe games are
 *     deliberately dark, so a dimmer scene also passes when its content is
 *     SPREAD OUT — >=0.8% differing across >=22% of a 16x10 grid of cells.
 *     Raw percentage alone is not enough to tell one line of centred text from
 *     a dim real scene (at DPR 3 a caption's antialiasing already reaches
 *     ~0.5%), which is what the coverage term is for. Measured: a placeholder
 *     tops out at 0.58% / 18.8% coverage; the sparsest real scene is
 *     1.3% / 28%; a lit 3D scene is 24.6% / 36.9%.
 *
 * (2) DOM — >=8 elements with a non-zero on-screen box that carry visible
 *     paint. A canvas game legitimately has almost no DOM and a DOM game
 *     legitimately has no canvas, so either signal alone is enough.
 *
 * Special case: a landscape-only game showing .poe-rotate-hint in portrait is
 * behaving correctly, and is not treated as blank.
 */

/* Runs in the page. Decodes a PNG data URL and reports its colour spread. */
const ANALYSE_PNG = async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = Math.min(img.naturalWidth, 900);
  const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h).data;

  const counts = new Map();
  const px = data.length / 4;
  const stride = Math.max(1, Math.floor(px / 40000));
  let sampled = 0;
  for (let i = 0; i < px; i += stride) {
    const o = i * 4;
    // quantise to 4 bits per channel so film grain and dithering do not read as signal
    const k = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
    sampled++;
  }
  let top = 0, modal = 0;
  for (const [k, v] of counts) if (v > top) { top = v; modal = k; }

  /* Spatial coverage. Raw "% of pixels differing" cannot tell one line of
   * centred text (a placeholder) from a dim but real scene: at DPR 3 the
   * antialiased edges of a single sentence already reach ~0.5%. So also ask
   * WHERE the non-modal pixels are. Split the image into a 16x10 grid and
   * count the cells in which at least 1.5% of pixels differ from the global
   * modal colour. A caption lights up a handful of cells; an actual game
   * paints most of the screen. */
  const GX = 16, GY = 10;
  const cells = new Array(GX * GY).fill(0);
  const cellPx = new Array(GX * GY).fill(0);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GY - 1, Math.floor((y / h) * GY));
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const k = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
      const idx = gy * GX + Math.min(GX - 1, Math.floor((x / w) * GX));
      cellPx[idx]++;
      if (k !== modal) cells[idx]++;
    }
  }
  let live = 0;
  for (let i = 0; i < cells.length; i++) if (cellPx[i] && cells[i] / cellPx[i] >= 0.015) live++;

  return {
    w, h, sampled,
    distinctColors: counts.size,
    differingPct: +(sampled ? ((sampled - top) / sampled) * 100 : 0).toFixed(2),
    coveragePct: +((live / (GX * GY)) * 100).toFixed(1),
  };
};

/* Runs in the page. Counts DOM elements that actually paint something. */
const DOM_PAINT_FN = `() => {
  let painted = 0;
  const els = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) continue;
    const tag = el.tagName.toLowerCase();
    const structural = ['html','body','main','div','section'].includes(tag);
    const hasPaint =
      ['svg','path','circle','rect','line','polygon','text','img','video','canvas','button','a','input'].includes(tag) ||
      (s.backgroundImage && s.backgroundImage !== 'none') ||
      (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && !structural) ||
      (s.borderTopWidth !== '0px' || s.borderLeftWidth !== '0px') ||
      (el.childElementCount === 0 && (el.textContent || '').trim().length > 0);
    if (hasPaint) painted++;
  }
  const hint = document.querySelector('.poe-rotate-hint');
  const rotateGate = !!(hint && getComputedStyle(hint).display !== 'none' && hint.getBoundingClientRect().width > 0);
  const canvases = [...document.querySelectorAll('canvas')].map(c => {
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) };
  });
  return { painted, rotateGate, canvases };
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

/* A landscape-only game covers the screen with .poe-rotate-hint in portrait.
 * Passing it on the strength of the hint alone would mean never checking the
 * game itself on mobile at all, so we re-run it rotated — which is what the
 * player actually sees. */
const MOBILE_LANDSCAPE = {
  tag: 'mobile',
  opts: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

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
    blank = { dom: await page.evaluate(`(${DOM_PAINT_FN})()`) };

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

  if (blank) {
    try {
      // Analysis shot with the shared chrome hidden, so .poe-back cannot mask
      // a blank game. Restored immediately afterwards.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.poe-back')) el.style.visibility = 'hidden';
      });
      const buf = await page.screenshot({ type: 'png' });
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.poe-back')) el.style.visibility = '';
      });
      blank.pixels = await page.evaluate(ANALYSE_PNG, 'data:image/png;base64,' + buf.toString('base64'));
    } catch (e) {
      problems.push(`pixel analysis failed: ${e.message}`.slice(0, 300));
    }

    const px = blank.pixels;
    const dom = blank.dom || { painted: 0, rotateGate: false };
    if (dom.rotateGate) {
      blank.ok = true; blank.why = 'showing .poe-rotate-hint (landscape-only game in portrait)';
    } else if (px && px.differingPct >= 2) {
      // PRIMARY: plenty of the screen is not the background colour.
      blank.ok = true; blank.why = `${px.differingPct}% of pixels differ from the modal colour`;
    } else if (px && px.differingPct >= 0.8 && px.coveragePct >= 22) {
      // SECONDARY: dim, but the content is spread across the screen rather than
      // being one caption. Calibrated against real pages: a placeholder tops out
      // at 0.58% / 18.8% coverage, the sparsest real scene measures 1.3% / 28%.
      blank.ok = true; blank.why = `${px.differingPct}% differing spread over ${px.coveragePct}% of the screen`;
    } else if (dom.painted >= 8) {
      blank.ok = true; blank.why = `${dom.painted} painted DOM elements`;
    } else {
      blank.why = px
        ? `only ${px.differingPct}% of pixels differ from the modal colour, spread over just ${px.coveragePct}% of the screen, and only ${dom.painted} painted DOM elements`
        : `no pixel analysis and only ${dom.painted} painted DOM elements`;
    }
  }

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
    let r = await checkOne(browser, base, p, vp);
    let note = '';
    if (vp.tag === 'mobile' && r.blank && r.blank.dom && r.blank.dom.rotateGate) {
      r = await checkOne(browser, base, p, MOBILE_LANDSCAPE);
      note = ' (landscape)';
    }
    const pass = r.problems.length === 0;
    if (!pass) failures++;
    const detail = r.blank
      ? [
          r.blank.pixels ? `${r.blank.pixels.differingPct}% px, ${r.blank.pixels.coveragePct}% cover` : 'no pixels',
          `${r.blank.dom.painted} dom`,
          r.blank.dom.canvases.length ? `canvas ${r.blank.dom.canvases[0].w}x${r.blank.dom.canvases[0].h}` : 'no canvas',
        ].join(', ')
      : '—';
    console.log((pass ? 'PASS' : `FAIL (${r.problems.length})`) + note);
    rows.push({ page: p.name, vp: vp.tag + note, pass, detail, problems: r.problems, shot: r.shot });
  }
}

await browser.close();
srv.close();

/* summary table */
const W = { page: Math.max(6, ...rows.map((r) => r.page.length)), vp: Math.max(7, ...rows.map((r) => r.vp.length)) };
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
