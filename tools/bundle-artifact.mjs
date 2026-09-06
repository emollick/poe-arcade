#!/usr/bin/env node
/* poe-arcade — tools/bundle-artifact.mjs
 *
 * Folds one page of the site into ONE self-contained HTML file, the shape a
 * Claude Artifact needs (no external requests of any kind):
 *
 *   node tools/bundle-artifact.mjs the-raven                 # games/the-raven/index.html
 *   node tools/bundle-artifact.mjs launcher                  # index.html
 *   node tools/bundle-artifact.mjs black-cat --out /tmp/x.html
 *
 * Flags
 *   --out <file>          where to write (default: $POE_BUNDLE_OUT_DIR/<slug>.html,
 *                         falling back to the phase-1 scratchpad directory)
 *   --format artifact     (default) a page FRAGMENT: no <!doctype>, <html>, <head>,
 *                         <body> tags, because the Artifact publisher wraps the file
 *                         in its own skeleton. <html>/<body> attributes are re-applied
 *                         by a one-line script so nothing is lost.
 *   --format standalone   a complete document (doctype kept), for opening via file://
 *   --all-fonts           keep every @font-face rule instead of only the families the
 *                         page actually names (pruning is size-only; rendering is identical)
 *   --asset <path>        embed an extra runtime asset (relative to the page directory)
 *                         that the static scan did not find
 *   --quiet               print only the final line
 *
 * What gets inlined
 *   <link rel=stylesheet>        -> <style>, with every url() inside turned into a data: URI
 *   @font-face src               -> data:font/woff2 (pruned to the families the page uses)
 *   <script src> (classic)       -> inline <script>
 *   <script type=module src>     -> the WHOLE import graph (import maps honoured, e.g. the
 *                                   vendored three.js) rewritten into a tiny in-file module
 *                                   registry inside one inline <script type="module">. No
 *                                   data: or blob: script URLs are used anywhere, so the
 *                                   result does not depend on the host CSP allowing them.
 *   img/source/audio/video/track/poster, <image href>, <link rel=icon>, inline style url()
 *                                -> data: URIs
 *   runtime fetch() targets      -> found by scanning the JS for string literals that name an
 *                                   existing file (.glsl, .wasm, .json, images, audio…), embedded
 *                                   as base64, and served by a shim installed before any script
 *                                   runs. The shim answers window.fetch for those URLs with a
 *                                   synthetic Response, routes WebAssembly.instantiateStreaming
 *                                   through WebAssembly.instantiate(bytes), and maps
 *                                   XMLHttpRequest / Image.src / <audio>.src / setAttribute /
 *                                   new Worker() to data: URIs for the same paths.
 *
 * Link rewriting (the site becomes N artifacts instead of one origin)
 *   any link back to the launcher (the ../../index.html that shared/poe.js mountBack()
 *   injects, or the launcher's own href="./")   -> LAUNCHER_URL_PLACEHOLDER, same tab
 *   the launcher's links to games               -> GAME_URL_PLACEHOLDER_<slug>,
 *                                                  target="_blank" rel="noopener"
 *   A later step substitutes the real artifact URLs for the placeholders.
 *
 * Nothing is minified or stripped; the page is meant to be visually and mechanically
 * identical to the served original. Node built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = process.env.POE_BUNDLE_OUT_DIR
  || '/tmp/claude-0/-home-claude/e71395e2-57cf-581a-b300-fa3554525d9c/scratchpad/artifacts/bundles';

export const LAUNCHER_PLACEHOLDER = 'LAUNCHER_URL_PLACEHOLDER';
export const gamePlaceholder = (slug) => `GAME_URL_PLACEHOLDER_${slug}`;

/* ---------- args ------------------------------------------------------------ */

function usage(msg) {
  if (msg) console.error(`\n  ${msg}\n`);
  console.error('  usage: node tools/bundle-artifact.mjs <slug|launcher> [--out file] [--format artifact|standalone] [--all-fonts] [--asset rel]...');
  process.exit(2);
}

function parseArgs(argv) {
  const o = { format: 'artifact', allFonts: false, assets: [], out: null, quiet: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--format') o.format = argv[++i];
    else if (a === '--all-fonts') o.allFonts = true;
    else if (a === '--asset') o.assets.push(argv[++i]);
    else if (a === '--quiet') o.quiet = true;
    else if (a.startsWith('-')) usage(`unknown flag ${a}`);
    else if (o.target) usage('one page at a time');
    else o.target = a;
  }
  if (!o.target) usage();
  if (!['artifact', 'standalone'].includes(o.format)) usage(`--format must be artifact or standalone, got ${o.format}`);
  return o;
}

/* ---------- small helpers --------------------------------------------------- */

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain', '.glsl': 'text/plain', '.frag': 'text/plain', '.vert': 'text/plain',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.vtt': 'text/vtt',
};
const mimeOf = (abs) => MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
const repoRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };
const dataUrl = (abs) => `data:${mimeOf(abs)};base64,${fs.readFileSync(abs).toString('base64')}`;
const fmtBytes = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

/* Inline scripts/styles must not contain the sequences that end them. Inside JS
 * strings, regexes, comments and template literals `\/` is `/` and `\!` is `!`,
 * so these substitutions never change what the code means. Same for CSS. */
const escapeScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escapeStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

/* Where does a reference point? */
function classify(ref) {
  const r = ref.trim();
  if (r === '' || r.startsWith('#')) return 'fragment';
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return 'external';
  return 'path';
}

/* Resolve a relative or root-relative ref against the file it appears in. */
function resolveRef(ref, fromAbs) {
  const clean = ref.trim().replace(/[?#].*$/, '');
  const abs = clean.startsWith('/') ? path.join(ROOT, clean) : path.resolve(path.dirname(fromAbs), clean);
  return { abs, exists: isFile(abs) };
}

function getAttr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}
function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  if (re.test(tag)) return tag.replace(re, `$1"${value}"`);
  return tag.replace(/\s*\/?>$/, (end) => ` ${name}="${value}"${end.trim()}`);
}
function dropAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), '');
}

/* ---------- CSS: url() rewriting and @font-face pruning ---------------------- */

/* Walks every url(...) token, quoted or bare, and lets `onRef` replace the
 * target. Quoted values may legitimately contain ')' (SVG data URIs with
 * filter='url(#f)' inside), which is why this is a scanner and not a regex. */
function rewriteCssUrls(css, onRef) {
  let out = '', i = 0;
  const re = /url\(\s*/gi;
  let m;
  while ((m = re.exec(css))) {
    const start = m.index;
    let j = re.lastIndex, quote = '';
    if (css[j] === '"' || css[j] === "'") { quote = css[j]; j++; }
    const end = quote ? css.indexOf(quote, j) : css.indexOf(')', j);
    if (end < 0) break;
    const close = quote ? css.indexOf(')', end + 1) : end;
    if (close < 0) break;
    const raw = css.slice(j, end).trim();
    const replacement = onRef(raw);
    out += css.slice(i, start) + (replacement == null ? css.slice(start, close + 1) : `url("${replacement}")`);
    i = close + 1;
    re.lastIndex = i;
  }
  return out + css.slice(i);
}

/* ---------- ES modules: import graph + in-file registry ----------------------- */

/* Resolves an import specifier the way the browser would, honouring the page's
 * import map (exact keys and trailing-slash prefix keys). */
function makeSpecifierResolver(importMap) {
  const imports = (importMap && importMap.imports) || {};
  return (spec, fromAbs) => {
    let mapped = null;
    if (Object.prototype.hasOwnProperty.call(imports, spec)) mapped = imports[spec];
    else {
      for (const key of Object.keys(imports).filter((k) => k.endsWith('/')).sort((a, b) => b.length - a.length)) {
        if (spec.startsWith(key)) { mapped = imports[key] + spec.slice(key.length); break; }
      }
    }
    const target = mapped ?? spec;
    if (classify(target) !== 'path') throw new Error(`cannot bundle non-local import "${spec}" (from ${repoRel(fromAbs)})`);
    if (!mapped && !/^(\.\.?\/|\/)/.test(spec)) throw new Error(`bare specifier "${spec}" in ${repoRel(fromAbs)} is not in the import map`);
    const r = resolveRef(target, fromAbs);
    if (!r.exists) throw new Error(`import "${spec}" from ${repoRel(fromAbs)} -> ${repoRel(r.abs)} does not exist`);
    return r.abs;
  };
}

const RE = {
  importSide:   /^[ \t]*import\s*(['"])([^'"]+)\1\s*;?[ \t]*/gm,
  importClause: /^[ \t]*import\s+([^'"]*?)\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*/gm,
  exportStarAs: /^[ \t]*export\s*\*\s*as\s+([\w$]+)\s+from\s*(['"])([^'"]+)\2\s*;?[ \t]*/gm,
  exportStar:   /^[ \t]*export\s*\*\s*from\s*(['"])([^'"]+)\1\s*;?[ \t]*/gm,
  exportFrom:   /^[ \t]*export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?[ \t]*/gm,
  exportList:   /^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*/gm,
  exportDefault:/^([ \t]*)export\s+default\s+/gm,
  exportDecl:   /^([ \t]*)export\s+((?:async\s+)?function\s*\*?|class)\s+([\w$]+)/gm,
  exportVar:    /^([ \t]*)export\s+(const|let|var)\s+([\w$]+)([^\n;]*)/gm,
  exportDestr:  /^[ \t]*export\s+(const|let|var)\s*[[{]/gm,
};

/* Only the specifiers, for walking the graph. */
function importSpecifiers(source) {
  const specs = [];
  for (const re of [RE.importSide, RE.importClause, RE.exportStarAs, RE.exportStar, RE.exportFrom]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) specs.push(m[m.length - 1]);
  }
  return specs;
}

function parseNameList(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((item) => {
    const m = /^([\w$]+|default)(?:\s+as\s+([\w$]+|default))?$/.exec(item);
    if (!m) throw new Error(`unsupported export/import name "${item}"`);
    return { local: m[1], exported: m[2] || m[1] };
  });
}

/* Turns one ES module into a registry entry:
 *   __poeDefine(id, async function (__exports, __poeRequire) { ... })
 * Imports become `const {…} = await __poeRequire(depId)` hoisted to the top
 * (imports are hoisted in ESM too); exports become enumerable getters on
 * __exports so bindings stay live. Every module body is async so a module
 * that uses top-level await keeps working. */
function transformModule(source, id, resolveDep) {
  const hoisted = [];
  const getters = [];   // [exportedName, expression]
  let tmp = 0;
  const dep = (spec) => JSON.stringify(resolveDep(spec));
  const unsupported = (what) => { throw new Error(`${id}: ${what} is not supported by the module transform`); };

  let body = source;
  if (RE.exportDestr.test(body)) unsupported('destructuring export declarations');
  RE.exportDestr.lastIndex = 0;

  body = body.replace(RE.importSide, (_, q, spec) => { hoisted.push(`await __poeRequire(${dep(spec)});`); return ''; });
  body = body.replace(RE.importClause, (_, clause, q, spec) => {
    const v = `__poe_m${tmp++}`;
    const lines = [`const ${v} = await __poeRequire(${dep(spec)});`];
    let c = clause.trim();
    const def = /^([\w$]+)\s*(?:,\s*)?/.exec(c);
    if (def && !c.startsWith('{') && !c.startsWith('*')) { lines.push(`const ${def[1]} = ${v}.default;`); c = c.slice(def[0].length).trim(); }
    if (c.startsWith('*')) {
      const ns = /^\*\s*as\s+([\w$]+)$/.exec(c);
      if (!ns) unsupported(`import clause "${clause}"`);
      lines.push(`const ${ns[1]} = ${v};`);
    } else if (c.startsWith('{')) {
      const names = parseNameList(c.slice(1, c.lastIndexOf('}')));
      if (names.length) lines.push(`const { ${names.map((n) => n.local === n.exported ? n.local : `${n.local}: ${n.exported}`).join(', ')} } = ${v};`);
    } else if (c !== '') unsupported(`import clause "${clause}"`);
    hoisted.push(lines.join(' '));
    return '';
  });
  body = body.replace(RE.exportStarAs, (_, name, q, spec) => {
    const v = `__poe_m${tmp++}`;
    hoisted.push(`const ${v} = await __poeRequire(${dep(spec)});`);
    getters.push([name, v]);
    return '';
  });
  body = body.replace(RE.exportStar, (_, q, spec) => { hoisted.push(`__poeExportStar(__exports, await __poeRequire(${dep(spec)}));`); return ''; });
  body = body.replace(RE.exportFrom, (_, list, q, spec) => {
    const v = `__poe_m${tmp++}`;
    hoisted.push(`const ${v} = await __poeRequire(${dep(spec)});`);
    for (const n of parseNameList(list)) getters.push([n.exported, `${v}.${n.local}`]);
    return '';
  });
  body = body.replace(RE.exportList, (_, list) => { for (const n of parseNameList(list)) getters.push([n.exported, n.local]); return ''; });
  body = body.replace(RE.exportDefault, (m, indent, offset, whole) => {
    const rest = whole.slice(offset + m.length);
    const named = /^((?:async\s+)?function\s*\*?|class)\s+([\w$]+)/.exec(rest);
    if (named) { getters.push(['default', named[2]]); return indent; }
    return `${indent}__exports.default = `;
  });
  body = body.replace(RE.exportDecl, (_, indent, kind, name) => { getters.push([name, name]); return `${indent}${kind} ${name}`; });
  body = body.replace(RE.exportVar, (_, indent, kind, name, rest) => {
    if (/,\s*[\w$]+\s*(=|,|$)/.test(rest)) unsupported(`multi-declarator export "${kind} ${name}${rest}"`);
    getters.push([name, name]);
    return `${indent}${kind} ${name}${rest}`;
  });

  const exportBlock = getters.length
    ? `__poeExport(__exports, { ${getters.map(([k, expr]) => `${JSON.stringify(k)}: () => ${expr}`).join(', ')} });`
    : '';
  return [
    `__poeDefine(${JSON.stringify(id)}, async function (__exports, __poeRequire) {`,
    exportBlock,
    ...hoisted,
    body,
    '});',
  ].filter((l) => l !== '').join('\n');
}

const REGISTRY_RUNTIME = `
/* poe-arcade bundle: in-file ES module registry (no data:/blob: script URLs) */
const __poeDefs = Object.create(null), __poeState = Object.create(null);
function __poeDefine(id, fn) { __poeDefs[id] = fn; }
function __poeExport(ex, getters) {
  for (const k of Object.keys(getters)) Object.defineProperty(ex, k, { get: getters[k], enumerable: true, configurable: true });
}
function __poeExportStar(ex, m) {
  for (const k of Object.keys(m)) if (k !== 'default' && !(k in ex)) Object.defineProperty(ex, k, { get: () => m[k], enumerable: true, configurable: true });
}
function __poeRequire(id) {
  const s = __poeState[id];
  if (s) return s.done ? s.exports : s.evaluating ? s.exports /* cycle: partial namespace */ : s.promise;
  const fn = __poeDefs[id];
  if (!fn) throw new Error('bundle: unknown module ' + id);
  const exports = {};
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
  const st = __poeState[id] = { exports, evaluating: true, done: false, promise: null };
  st.promise = (async () => { await fn(exports, __poeRequire); st.evaluating = false; st.done = true; return exports; })();
  return st.promise;
}
`;

/* ---------- the runtime asset shim ------------------------------------------- */

function shimScript(assets) {
  // assets: [{ key (page-relative), rootRel, mime, b64 }]
  const table = assets.map((a) => ({ keys: [a.key, `./${a.key}`, `/${a.rootRel}`], mime: a.mime, b64: a.b64 }));
  return `/* poe-arcade bundle: runtime asset shim. Answers fetch()/XHR/src for the embedded files. */
(() => {
  const ASSETS = ${JSON.stringify(table)};
  const table = new Map();
  const canon = (u) => { try { return new URL(u, document.baseURI).href; } catch { return String(u); } };
  for (const a of ASSETS) for (const k of a.keys) { table.set(k, a); table.set(canon(k), a); }
  const bytes = (a) => { if (!a.bytes) { const bin = atob(a.b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); a.bytes = out; } return a.bytes; };
  const dataUrl = (a) => 'data:' + a.mime + ';base64,' + a.b64;
  const find = (u) => {
    if (u == null) return null;
    const s = typeof u === 'string' ? u : (typeof u === 'object' && typeof u.url === 'string') ? u.url : String(u);
    if (/^(data|blob):/.test(s)) return null;
    const c = canon(s);
    const hit = table.get(s) || table.get(c);
    if (hit) return hit;
    // same-document suffix match: '<anything>/sim.wasm' when the page itself lives at a deeper URL
    let same = false; try { const x = new URL(c); same = x.origin === location.origin || x.protocol === 'file:'; } catch {}
    if (!same) return null;
    for (const a of ASSETS) if (c.endsWith('/' + a.keys[0])) return a;
    return null;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const a = find(input);
    if (!a) return nativeFetch(input, init);
    return Promise.resolve(new Response(bytes(a).slice(), { status: 200, statusText: 'OK', headers: { 'Content-Type': a.mime } }));
  };
  if (window.WebAssembly) {
    WebAssembly.instantiateStreaming = async (src, imports) => WebAssembly.instantiate(await (await src).arrayBuffer(), imports);
    WebAssembly.compileStreaming = async (src) => WebAssembly.compile(await (await src).arrayBuffer());
  }
  const xopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, u, ...rest) { const a = find(u); return xopen.call(this, method, a ? dataUrl(a) : u, ...rest); };
  for (const C of [window.HTMLImageElement, window.HTMLMediaElement, window.HTMLSourceElement, window.HTMLTrackElement]) {
    if (!C) continue;
    const d = Object.getOwnPropertyDescriptor(C.prototype, 'src');
    if (d && d.set) Object.defineProperty(C.prototype, 'src', { ...d, set(v) { const a = find(v); d.set.call(this, a ? dataUrl(a) : v); } });
  }
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (typeof value === 'string' && /^(src|href|poster|data)$/i.test(name) && this.tagName !== 'A') { const a = find(value); if (a) value = dataUrl(a); }
    return setAttribute.call(this, name, value);
  };
  if (window.Worker) { const W = window.Worker; window.Worker = function (u, o) { const a = find(u); return new W(a ? dataUrl(a) : u, o); }; window.Worker.prototype = W.prototype; }
  window.__poeBundleAssets = ASSETS.map((a) => a.keys[0]);
})();`;
}

/* ---------- the bundle ------------------------------------------------------- */

export function bundle(target, options = {}) {
  const opts = { format: 'artifact', allFonts: false, assets: [], quiet: true, ...options };
  const log = (...a) => { if (!opts.quiet) console.log(...a); };
  const notes = [];

  const cleaned = target.replace(/^\.?\//, '').replace(/\/+$/, '').replace(/\/index\.html$/, '').replace(/^games\//, '');
  const slug = cleaned === '' || cleaned === 'index.html' ? 'launcher' : cleaned;
  const pageAbs = slug === 'launcher' ? path.join(ROOT, 'index.html') : path.join(ROOT, 'games', slug, 'index.html');
  if (!isFile(pageAbs)) throw new Error(`no page at ${repoRel(pageAbs)}`);
  const pageDir = path.dirname(pageAbs);
  let html = fs.readFileSync(pageAbs, 'utf8');
  const manifest = { slug, page: repoRel(pageAbs), styles: [], classicScripts: [], modules: [], assets: [], fontsKept: [], fontsDropped: [], inlined: [], rewrites: [], warnings: [] };

  /* -- 1. import map (consumed, then removed) -------------------------------- */
  let importMap = null;
  html = html.replace(/<script\b[^>]*type\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script>\s*/i, (_, json) => {
    importMap = JSON.parse(json);
    manifest.rewrites.push('import map consumed');
    return '';
  });
  const resolveSpec = makeSpecifierResolver(importMap);

  /* -- 2. scripts --------------------------------------------------------------- */
  const modules = new Map();       // abs -> { id, source }
  const order = [];                // evaluation order of definitions
  const loadModule = (abs) => {
    if (modules.has(abs)) return;
    const source = fs.readFileSync(abs, 'utf8');
    const entry = { id: repoRel(abs), source, deps: [] };
    modules.set(abs, entry);
    for (const spec of importSpecifiers(source)) {
      const depAbs = resolveSpec(spec, abs);
      entry.deps.push(depAbs);
      loadModule(depAbs);
    }
    order.push(abs);
  };
  const entries = [];              // module ids to evaluate, in document order
  let inlineCount = 0;
  const classicInline = [];
  let firstModuleSeen = false;
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs, content) => {
    const type = (getAttr(`<script${attrs}>`, 'type') || '').trim().toLowerCase();
    const src = getAttr(`<script${attrs}>`, 'src');
    if (type === 'module') {
      if (src) {
        if (classify(src) !== 'path') throw new Error(`external module script ${src} cannot be bundled`);
        const r = resolveRef(src, pageAbs);
        if (!r.exists) throw new Error(`module script ${src} not found`);
        loadModule(r.abs);
        entries.push(modules.get(r.abs).id);
      } else {
        const id = `${repoRel(pageAbs)}#inline-module-${inlineCount++}`;
        const fake = path.join(pageDir, `__inline_${inlineCount}.js`);
        const entry = { id, source: content, deps: [] };
        modules.set(fake, entry);
        for (const spec of importSpecifiers(content)) { const d = resolveSpec(spec, fake); entry.deps.push(d); loadModule(d); }
        order.push(fake);
        entries.push(id);
      }
      if (firstModuleSeen) return '';
      firstModuleSeen = true;
      return '__POE_MODULE_BUNDLE__';
    }
    if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) return whole; // JSON/data blocks etc.
    if (!src) return whole;
    if (classify(src) !== 'path') throw new Error(`external script ${src} cannot be bundled`);
    const r = resolveRef(src, pageAbs);
    if (!r.exists) throw new Error(`script ${src} not found`);
    manifest.classicScripts.push(repoRel(r.abs));
    const kept = dropAttr(`<script${attrs}>`, 'src');
    return `${kept}\n${escapeScript(fs.readFileSync(r.abs, 'utf8'))}\n</script>`;
  });

  /* -- 3. stylesheets, collected first so the font-usage corpus is complete ------ */
  const styleRefs = [];
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = (getAttr(tag, 'rel') || '').toLowerCase();
    const href = getAttr(tag, 'href');
    if (!href || classify(href) !== 'path') return tag;
    const r = resolveRef(href, pageAbs);
    if (/\bstylesheet\b/.test(rel)) {
      if (!r.exists) throw new Error(`stylesheet ${href} not found`);
      styleRefs.push(r.abs);
      manifest.styles.push(repoRel(r.abs));
      return `__POE_STYLE_${styleRefs.length - 1}__`;
    }
    if (/\bicon\b/.test(rel) || rel === 'manifest' || rel === 'preload') {
      if (!r.exists) { manifest.warnings.push(`<link rel=${rel}> ${href} not found`); return tag; }
      manifest.inlined.push(repoRel(r.abs));
      return setAttr(tag, 'href', dataUrl(r.abs));
    }
    return tag;
  });

  /* -- 4. runtime assets: string literals in the JS that name a real file ------- */
  const assetMap = new Map(); // abs -> { key, rootRel, mime, b64 }
  const addAsset = (abs, why) => {
    if (assetMap.has(abs)) return;
    const key = path.relative(pageDir, abs).split(path.sep).join('/');
    assetMap.set(abs, { key, rootRel: repoRel(abs), mime: mimeOf(abs), b64: fs.readFileSync(abs).toString('base64'), bytes: fs.statSync(abs).size, why });
  };
  const ASSET_EXT = /\.(glsl|frag|vert|wasm|json|txt|csv|png|jpe?g|webp|gif|svg|mp3|ogg|wav|m4a|mp4|webm|bin|glb|gltf|ttf|otf|woff2?|vtt)$/i;
  for (const [abs, m] of modules) {
    const lit = /(['"`])([^'"`\n\\]{1,200}?)\1/g;
    let x;
    while ((x = lit.exec(m.source))) {
      const s = x[2];
      if (!ASSET_EXT.test(s) || classify(s) !== 'path') continue;
      const r = resolveRef(s, abs.includes('__inline_') ? pageAbs : abs);
      if (r.exists && !modules.has(r.abs)) addAsset(r.abs, `${m.id} literal '${s}'`);
      else if (!r.exists) manifest.warnings.push(`${m.id}: literal '${s}' looks like an asset path but no such file`);
    }
  }
  for (const extra of opts.assets) {
    const r = resolveRef(extra, pageAbs);
    if (!r.exists) throw new Error(`--asset ${extra} not found`);
    addAsset(r.abs, '--asset');
  }
  manifest.assets = [...assetMap.values()].map((a) => ({ file: a.rootRel, key: a.key, bytes: a.bytes, why: a.why }));

  /* -- 5. site-specific JS rewrites (asserted, so a changed source fails loudly) - */
  for (const [abs, m] of modules) {
    if (m.id === 'shared/poe.js') {
      const before = m.source;
      m.source = m.source.replace("a.href = '../../index.html';", `a.href = '${LAUNCHER_PLACEHOLDER}';`);
      if (m.source === before) throw new Error('shared/poe.js: mountBack() href pattern not found; update the bundler');
      manifest.rewrites.push(`shared/poe.js mountBack() -> ${LAUNCHER_PLACEHOLDER}`);
    }
    if (m.id === 'launcher/launcher.js') {
      let s = m.source;
      const a = s.replace('href="games/${g.slug}/index.html"', `href="${gamePlaceholder('${g.slug}')}" target="_blank" rel="noopener"`);
      if (a === s) throw new Error('launcher/launcher.js: drawer href pattern not found; update the bundler');
      s = a;
      // enter(): the launcher used to navigate away; each game is now its own artifact,
      // so open it in a new tab synchronously (inside the click gesture) and let the
      // drawer animation play, then put the cabinet back so it can be used again.
      const enterRe = /function enter\(li\) \{[\s\S]*?\n\}/;
      const orig = enterRe.exec(s);
      if (!orig || !/location\.href = href/.test(orig[0])) throw new Error('launcher/launcher.js: enter() pattern not found; update the bundler');
      s = s.replace(enterRe, `function enter(li) {
  if (leaving) return;
  leaving = true;
  const href = $('.front', li).getAttribute('href');
  window.open(href, '_blank', 'noopener');
  if (reduced) { leaving = false; return; }
  li.classList.add('pulling');
  dim.classList.add('on');
  // a click that also opened the doors waits for the swing, then the drawer slides back
  const wait = Math.max(PULL, openedAt + SWING - performance.now());
  setTimeout(() => { li.classList.remove('pulling'); dim.classList.remove('on'); leaving = false; }, wait);
}`);
      m.source = s;
      manifest.rewrites.push('launcher/launcher.js drawer links -> GAME_URL_PLACEHOLDER_<slug> (new tab), enter() opens a tab instead of navigating');
    }
  }

  /* -- 6. font-usage corpus, then CSS ------------------------------------------- */
  const cssTexts = new Map(styleRefs.map((abs) => [abs, fs.readFileSync(abs, 'utf8')]));
  const corpusParts = [html, ...[...modules.values()].map((m) => m.source)];
  for (const [abs, text] of cssTexts) if (!/@font-face/.test(text)) corpusParts.push(text);
  const corpus = corpusParts.join('\n');
  const familyUsed = (fam) => corpus.includes(fam);

  const processCss = (css, cssAbs) => {
    if (!opts.allFonts && /@font-face/.test(css)) {
      css = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
        const fam = /font-family\s*:\s*(['"]?)([^'";]+)\1/.exec(block);
        const name = fam ? fam[2].trim() : null;
        if (!name || familyUsed(name)) { if (name && !manifest.fontsKept.includes(name)) manifest.fontsKept.push(name); return block; }
        if (!manifest.fontsDropped.includes(name)) manifest.fontsDropped.push(name);
        return '';
      });
    }
    return rewriteCssUrls(css, (ref) => {
      if (classify(ref) !== 'path') return null;
      const r = resolveRef(ref, cssAbs);
      if (!r.exists) { manifest.warnings.push(`${repoRel(cssAbs)}: url(${ref}) not found`); return null; }
      manifest.inlined.push(repoRel(r.abs));
      return dataUrl(r.abs);
    });
  };
  styleRefs.forEach((abs, i) => {
    html = html.replace(`__POE_STYLE_${i}__`, () => `<style data-bundled="${repoRel(abs)}">\n${escapeStyle(processCss(cssTexts.get(abs), abs))}\n</style>`);
  });
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => `${open}${escapeStyle(processCss(css, pageAbs))}${close}`);
  html = html.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (whole, q, dq, sq) => {
    const css = dq ?? sq;
    if (!/url\(/i.test(css)) return whole;
    const out = processCss(css, pageAbs).replace(/"/g, '&quot;');
    return ` style="${out}"`;
  });

  /* -- 7. media attributes ------------------------------------------------------- */
  html = html.replace(/<(img|source|audio|video|track|image|embed|object)\b[^>]*>/gi, (tag) => {
    let t = tag;
    for (const name of ['src', 'href', 'poster', 'data']) {
      const v = getAttr(t, name);
      if (v == null || classify(v) !== 'path') continue;
      const r = resolveRef(v, pageAbs);
      if (!r.exists) { manifest.warnings.push(`<${tag.slice(1, 8).split(/\s/)[0]} ${name}="${v}"> not found`); continue; }
      manifest.inlined.push(repoRel(r.abs));
      t = setAttr(t, name, dataUrl(r.abs));
    }
    if (getAttr(t, 'srcset')) manifest.warnings.push('srcset is not rewritten');
    return t;
  });

  /* -- 8. links between the artifacts ------------------------------------------- */
  html = html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = getAttr(tag, 'href');
    if (href == null || classify(href) !== 'path') return tag;
    const clean = href.replace(/[?#].*$/, '');
    const abs = clean.startsWith('/') ? path.join(ROOT, clean) : path.resolve(pageDir, clean);
    const norm = abs.endsWith(path.sep) || clean.endsWith('/') || clean === '' ? path.join(abs, 'index.html') : abs;
    const rel = repoRel(norm);
    if (rel === 'index.html') { manifest.rewrites.push(`<a href="${href}"> -> ${LAUNCHER_PLACEHOLDER}`); return setAttr(tag, 'href', LAUNCHER_PLACEHOLDER); }
    const g = /^games\/([^/]+)\/index\.html$/.exec(rel);
    if (g) {
      manifest.rewrites.push(`<a href="${href}"> -> ${gamePlaceholder(g[1])} (new tab)`);
      return setAttr(setAttr(setAttr(tag, 'href', gamePlaceholder(g[1])), 'target', '_blank'), 'rel', 'noopener');
    }
    manifest.warnings.push(`<a href="${href}"> points inside the repo but is not a page; left as is`);
    return tag;
  });

  /* -- 9. assemble the module bundle and the shim ------------------------------- */
  const defs = order.map((abs) => {
    const m = modules.get(abs);
    const from = abs.includes('__inline_') ? pageAbs : abs;
    manifest.modules.push({ id: m.id, bytes: Buffer.byteLength(m.source) });
    return transformModule(m.source, m.id, (spec) => modules.get(resolveSpec(spec, from)).id);
  });
  const registry = entries.length
    ? `<script type="module">\n${escapeScript(REGISTRY_RUNTIME + '\n' + defs.join('\n\n') + '\n\n' + entries.map((id) => `await __poeRequire(${JSON.stringify(id)});`).join('\n'))}\n</script>`
    : '';
  html = html.replace('__POE_MODULE_BUNDLE__', () => registry);

  const shim = assetMap.size ? `<script>\n${escapeScript(shimScript([...assetMap.values()]))}\n</script>\n` : '';
  if (shim) {
    const at = html.search(/<script\b/i);
    html = at < 0 ? html + shim : html.slice(0, at) + shim + html.slice(at);
  }

  /* -- 10. document shape ---------------------------------------------------------- */
  const htmlTag = /<html\b([^>]*)>/i.exec(html);
  const bodyTag = /<body\b([^>]*)>/i.exec(html);
  const attrsOf = (s) => { const out = []; const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g; let m; while ((m = re.exec(s || ''))) out.push([m[1], m[2] ?? m[3] ?? m[4]]); return out; };
  if (opts.format === 'artifact') {
    html = html.replace(/<!doctype[^>]*>\s*/i, '').replace(/<\/?(html|head|body)\b[^>]*>\s*/gi, '');
    const fix = [];
    for (const [k, v] of attrsOf(htmlTag && htmlTag[1])) fix.push(`document.documentElement.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
    for (const [k, v] of attrsOf(bodyTag && bodyTag[1])) fix.push(`document.body.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
    if (fix.length) {
      html = html.replace(/(<\/title>)/i, (t) => `${t}\n<script>${fix.join(' ')}</script>`);
      manifest.rewrites.push(`re-applied ${fix.length} <html>/<body> attribute(s) by script (artifact format has no such tags)`);
    }
    html = html.replace(/^\s+/, '');
  } else if (!/^\s*<!doctype/i.test(html)) {
    html = '<!doctype html>\n' + html;
  }

  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1];
  if (!title) throw new Error('bundle lost its <title>');
  const titleAt = html.search(/<title>/i);
  if (titleAt > 8192) notes.push(`<title> sits ${titleAt} bytes in; the Artifact tool scans only the first 8KB`);

  /* -- 11. what is left that could still leave the page? --------------------------- */
  const leaks = [];
  const markupOnly = html.replace(/(<(style|script)\b[^>]*>)[\s\S]*?(<\/\2>)/gi, '$1$3'); // comments inside CSS/JS quote link tags
  for (const m of markupOnly.matchAll(/\b(?:src|href|poster)\s*=\s*"([^"]*)"/gi)) {
    const v = m[1];
    if (classify(v) === 'path' && !v.startsWith(LAUNCHER_PLACEHOLDER) && !v.startsWith('GAME_URL_PLACEHOLDER_')) leaks.push(v);
  }
  if (leaks.length) manifest.warnings.push(`unresolved relative references remain: ${[...new Set(leaks)].join(', ')}`);

  return { slug, html, title, bytes: Buffer.byteLength(html), manifest, notes };
}

/* ---------- CLI ------------------------------------------------------------------ */

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  const result = bundle(opts.target, opts);
  const out = path.resolve(opts.out || path.join(DEFAULT_OUT_DIR, `${result.slug}.html`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.html);
  const m = result.manifest;
  if (!opts.quiet) {
    console.log(`\n  poe-arcade bundle — ${m.page}  (${opts.format})\n`);
    console.log(`  title        ${result.title}`);
    console.log(`  stylesheets  ${m.styles.join(', ') || '—'}`);
    console.log(`  scripts      ${m.classicScripts.join(', ') || '—'}`);
    console.log(`  modules      ${m.modules.length}`);
    for (const mod of m.modules) console.log(`    ${fmtBytes(mod.bytes).padStart(10)}  ${mod.id}`);
    console.log(`  assets       ${m.assets.length ? '' : '—'}`);
    for (const a of m.assets) console.log(`    ${fmtBytes(a.bytes).padStart(10)}  ${a.file}  (${a.why})`);
    console.log(`  fonts kept   ${m.fontsKept.join(', ') || '—'}`);
    console.log(`  fonts dropped${opts.allFonts ? ' (disabled by --all-fonts)' : ''}  ${m.fontsDropped.join(', ') || '—'}`);
    console.log(`  inlined      ${[...new Set(m.inlined)].length} file(s)`);
    for (const r of m.rewrites) console.log(`  rewrite      ${r}`);
    for (const w of m.warnings) console.log(`  WARNING      ${w}`);
    for (const n of result.notes) console.log(`  NOTE         ${n}`);
  }
  console.log(`  wrote ${out} (${fmtBytes(result.bytes)}, ${result.bytes} bytes)${m.warnings.length ? ` with ${m.warnings.length} warning(s)` : ''}`);
}
