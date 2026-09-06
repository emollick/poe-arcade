#!/usr/bin/env node
/* poe-arcade — tools/bundle-check.mjs
 *
 * Proves that a single-file bundle from tools/bundle-artifact.mjs behaves like the
 * served original. For every page it loads three variants in headless Chromium:
 *
 *   orig     the repo served over http (what verify.mjs checks)
 *   bundle   the bundle fragment, via file://, prefixed only with <!doctype html>
 *   wrapped  the bundle fragment inside an emulation of the Artifact publisher's
 *            skeleton (charset/viewport meta + its small reset), via file://
 *
 * at 1440x900 and 390x844 (DPR 3, touch), waits for the title frame, takes a real
 * page screenshot, then nudges the page like verify.mjs does (centre click, Enter,
 * Space) and screenshots again. For each load it records console errors, page
 * errors, failed requests, 4xx/5xx responses and — for the file:// variants — every
 * request that is not data:/blob:/about: or the document itself (a bundling miss).
 * Screenshots of the same frame are compared in-browser (percentage of pixels
 * whose max channel difference exceeds 40, and the mean absolute difference).
 *
 *   node tools/bundle-check.mjs                      # launcher + all games
 *   node tools/bundle-check.mjs black-cat launcher   # some pages
 *   --bundles <dir>   where the bundles are (default: the bundler's default out dir)
 *   --shots <dir>     where screenshots go (default: <bundles>/../shots)
 *   --json <file>     also write the raw results
 *   --variants a,b    subset of orig,bundle,wrapped
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DEFAULT_BUNDLES = process.env.POE_BUNDLE_OUT_DIR
  || '/tmp/claude-0/-home-claude/e71395e2-57cf-581a-b300-fa3554525d9c/scratchpad/artifacts/bundles';

/* The publisher's skeleton, as observed in the stored HTML of an existing artifact,
 * plus the [hidden] rule the tool description says the current reset carries. */
const WRAPPER_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">'
  + '<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]{display:none!important}</style>'
  + '</head><body>\n';
const WRAPPER_TAIL = '\n</body></html>\n';

const argv = process.argv.slice(2);
const opt = { bundles: DEFAULT_BUNDLES, shots: null, json: null, variants: ['orig', 'bundle', 'wrapped'], slugs: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--bundles') opt.bundles = path.resolve(argv[++i]);
  else if (a === '--shots') opt.shots = path.resolve(argv[++i]);
  else if (a === '--json') opt.json = path.resolve(argv[++i]);
  else if (a === '--variants') opt.variants = argv[++i].split(',');
  else if (a.startsWith('-')) { console.error(`unknown flag ${a}`); process.exit(2); }
  else opt.slugs.push(a);
}
opt.shots ||= path.join(opt.bundles, '..', 'shots');
const testDocs = path.join(opt.bundles, '..', 'testdocs');
if (!opt.slugs.length) {
  opt.slugs = ['launcher', ...fs.readdirSync(path.join(ROOT, 'games')).filter((d) => fs.existsSync(path.join(ROOT, 'games', d, 'index.html'))).sort()];
}

/* ---------- playwright + chromium (same resolution as verify.mjs) --------------- */
async function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const m of ['playwright-core', 'playwright']) {
    try { return (await import(m)).chromium; } catch {}
    try { return require(m).chromium; } catch {}
  }
  throw new Error('playwright not found. Run:  cd tools && npm i --no-bin-links');
}
function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const c = [];
  for (const d of fs.readdirSync(base)) {
    if (!/^chromium(-|_)/.test(d) && d !== 'chromium') continue;
    c.push(path.join(base, d, 'chrome-linux', 'chrome'), path.join(base, d, 'chrome-linux', 'headless_shell'));
  }
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`no chromium under ${base}`);
  return hit;
}

/* ---------- static server for the originals ------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.glsl': 'text/plain', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
function startServer(rootDir) {
  const srv = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(rootDir, path.normalize(p));
      if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

/* ---------- one load ------------------------------------------------------------- */
const VIEWPORTS = [
  { tag: 'desktop', opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { tag: 'mobile', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadOne(browser, target, vp, shotBase, isFile) {
  const rec = { consoleErrors: [], pageErrors: [], requestFailed: [], httpErrors: [], externalRequests: [], requests: 0, shots: {} };
  const ctx = await browser.newContext({ ...vp.opts });
  const page = await ctx.newPage();
  const noise = (u = '') => /\/favicon\.(ico|png)$/.test(u);
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('requestfailed', (r) => { if (!noise(r.url())) rec.requestFailed.push(`${r.url().slice(0, 160)} (${r.failure()?.errorText || '?'})`); });
  page.on('response', (r) => { if (r.status() >= 400 && !noise(r.url())) rec.httpErrors.push(`${r.status()} ${r.url().slice(0, 160)}`); });
  page.on('request', (r) => {
    rec.requests++;
    const u = r.url();
    if (isFile && !/^(data|blob|about):/.test(u) && u !== target && !noise(u)) rec.externalRequests.push(u.slice(0, 200));
  });
  try {
    await page.goto(target, { waitUntil: 'load', timeout: 45000 });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await sleep(2500);
    rec.shots.title = shotBase + '.png';
    await page.screenshot({ path: rec.shots.title });
    const v = page.viewportSize();
    try { await page.mouse.click(Math.floor(v.width / 2), Math.floor(v.height / 2), { delay: 40 }); } catch {}
    try { await page.keyboard.press('Enter'); } catch {}
    try { await page.keyboard.press('Space'); } catch {}
    await sleep(2500);
    rec.shots.play = shotBase.replace(/(-desktop|-mobile)$/, '-play$1') + '.png';
    await page.screenshot({ path: rec.shots.play });
    rec.title = await page.title();
    rec.lang = await page.evaluate(() => document.documentElement.lang || '');
    rec.backHref = await page.evaluate(() => { const a = document.querySelector('.poe-back'); return a ? a.getAttribute('href') : null; });
    rec.gameLinks = await page.evaluate(() => [...document.querySelectorAll('a.front')].slice(0, 2).map((a) => `${a.getAttribute('href')} target=${a.getAttribute('target')} rel=${a.getAttribute('rel')}`));
    rec.assets = await page.evaluate(() => window.__poeBundleAssets || null);
  } catch (e) {
    rec.navigation = String(e.message).slice(0, 300);
  }
  await ctx.close();
  return rec;
}

/* Runs in the page: draws two PNG data URLs and measures how different they are. */
const DIFF_FN = async ([a, b]) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return { sizeMismatch: `${ia.naturalWidth}x${ia.naturalHeight} vs ${ib.naturalWidth}x${ib.naturalHeight}` };
  const w = Math.min(ia.naturalWidth, 1200), h = Math.round(ia.naturalHeight * (w / ia.naturalWidth));
  const cv = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const da = cv(ia), db = cv(ib);
  let differing = 0, sum = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(da[o] - db[o]), Math.abs(da[o + 1] - db[o + 1]), Math.abs(da[o + 2] - db[o + 2]));
    sum += d;
    if (d > 40) differing++;
  }
  return { differingPct: +((differing / n) * 100).toFixed(2), meanAbs: +(sum / n).toFixed(2) };
};

/* ---------- main ------------------------------------------------------------------ */
const chromium = await loadChromium();
const { srv, port } = await startServer(ROOT);
const browser = await chromium.launch({
  executablePath: chromiumExecutable(),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
fs.mkdirSync(opt.shots, { recursive: true });
fs.mkdirSync(testDocs, { recursive: true });

const results = {};
for (const slug of opt.slugs) {
  const bundleFile = path.join(opt.bundles, `${slug}.html`);
  if (!fs.existsSync(bundleFile)) { console.log(`  ${slug}: no bundle at ${bundleFile}`); continue; }
  const fragment = fs.readFileSync(bundleFile, 'utf8');
  const docs = {
    orig: `http://127.0.0.1:${port}/${slug === 'launcher' ? 'index.html' : `games/${slug}/`}`,
    bundle: url.pathToFileURL(path.join(testDocs, `${slug}.bundle.html`)).href,
    wrapped: url.pathToFileURL(path.join(testDocs, `${slug}.wrapped.html`)).href,
  };
  fs.writeFileSync(path.join(testDocs, `${slug}.bundle.html`), '<!doctype html>\n' + fragment);
  fs.writeFileSync(path.join(testDocs, `${slug}.wrapped.html`), WRAPPER_HEAD + fragment + WRAPPER_TAIL);
  const r = { bytes: fs.statSync(bundleFile).size, loads: {}, diffs: {} };
  results[slug] = r;
  for (const variant of opt.variants) {
    for (const vp of VIEWPORTS) {
      const shotBase = path.join(opt.shots, variant === 'bundle' ? `${slug}-${vp.tag}` : `${slug}-${variant}-${vp.tag}`);
      process.stdout.write(`  … ${slug} ${variant} ${vp.tag}`.padEnd(48));
      const rec = await loadOne(browser, docs[variant], vp, shotBase, variant !== 'orig');
      r.loads[`${variant}-${vp.tag}`] = rec;
      const bad = rec.consoleErrors.length + rec.pageErrors.length + rec.requestFailed.length + rec.httpErrors.length + rec.externalRequests.length + (rec.navigation ? 1 : 0);
      console.log(bad ? `${bad} problem(s)` : 'clean');
    }
  }
  // pixel comparisons
  const cmpPage = await (await browser.newContext()).newPage();
  await cmpPage.goto('about:blank');
  const pairs = [['bundle', 'orig'], ['wrapped', 'bundle']].filter(([a, b]) => opt.variants.includes(a) && opt.variants.includes(b));
  for (const [a, b] of pairs) for (const vp of VIEWPORTS) for (const frame of ['title', 'play']) {
    const sa = r.loads[`${a}-${vp.tag}`]?.shots[frame], sb = r.loads[`${b}-${vp.tag}`]?.shots[frame];
    if (!sa || !sb || !fs.existsSync(sa) || !fs.existsSync(sb)) continue;
    const toData = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    try { r.diffs[`${a}-vs-${b} ${vp.tag} ${frame}`] = await cmpPage.evaluate(DIFF_FN, [toData(sa), toData(sb)]); }
    catch (e) { r.diffs[`${a}-vs-${b} ${vp.tag} ${frame}`] = { error: String(e.message) }; }
  }
  await cmpPage.context().close();
}

await browser.close();
srv.close();

/* ---------- report ------------------------------------------------------------------ */
const fmt = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`;
console.log('');
for (const [slug, r] of Object.entries(results)) {
  console.log(`  ${slug}  (${fmt(r.bytes)}, ${r.bytes} bytes)`);
  for (const [k, rec] of Object.entries(r.loads)) {
    const probs = [
      ...rec.consoleErrors.map((x) => `console: ${x}`), ...rec.pageErrors.map((x) => `pageerror: ${x}`),
      ...rec.requestFailed.map((x) => `requestfailed: ${x}`), ...rec.httpErrors.map((x) => `http: ${x}`),
      ...rec.externalRequests.map((x) => `EXTERNAL REQUEST: ${x}`), ...(rec.navigation ? [`navigation: ${rec.navigation}`] : []),
    ];
    console.log(`    ${k.padEnd(16)} ${probs.length ? probs.length + ' problem(s)' : 'clean'}  requests=${rec.requests}  title="${rec.title || ''}"${rec.backHref ? `  back=${rec.backHref}` : ''}${rec.gameLinks?.length ? `  links=${rec.gameLinks[0]}` : ''}${rec.lang ? `  lang=${rec.lang}` : ''}`);
    for (const p of probs) console.log(`        - ${p}`);
  }
  for (const [k, d] of Object.entries(r.diffs)) console.log(`    diff ${k.padEnd(32)} ${d.error || d.sizeMismatch || `${d.differingPct}% px differ, mean |Δ| ${d.meanAbs}`}`);
}
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(results, null, 2));
console.log(`\n  screenshots -> ${opt.shots}\n`);
