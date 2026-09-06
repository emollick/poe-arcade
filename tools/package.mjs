#!/usr/bin/env node
/* poe-arcade — tools/package.mjs
 *
 * Builds the drag-and-drop Netlify bundle:
 *
 *   node tools/package.mjs                  # -> ../poe-arcade-netlify.zip
 *   node tools/package.mjs /path/to/out.zip # custom output path
 *
 * The zip contains exactly what the site needs to run, with the repo root as
 * the zip root, so it can be dropped straight onto https://app.netlify.com/drop:
 *
 *   index.html  netlify.toml  favicon.svg (if present)
 *   launcher/  shared/  vendor/
 *   games/**   minus every playtest.mjs, NOTES.md and games/<slug>/rust/
 *              (games/black-cat/sim.wasm, the compiled artifact, IS included)
 *
 * Left out: .git, tools/, screenshots/, README.md, CONVENTIONS.md, node_modules,
 * OS droppings. No dependencies: uses the system `zip` binary when present and
 * otherwise a minimal zip writer on top of node:zlib.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'poe-arcade-netlify.zip'));

/* ---------- what goes in --------------------------------------------------- */

const ROOT_FILES = ['index.html', 'netlify.toml', 'favicon.svg'];
const ROOT_DIRS = ['launcher', 'shared', 'vendor', 'games'];
const SKIP_FILES = new Set(['playtest.mjs', 'NOTES.md', '.DS_Store', 'Thumbs.db', '.gitkeep', '.gitignore']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', '.cache', '.netlify']);

function skipDir(rel, name) {
  if (SKIP_DIRS.has(name)) return true;
  // games/<slug>/rust — Rust sources; only the committed sim.wasm ships.
  return /^games\/[^/]+\/rust$/.test(rel);
}

function skipFile(name) {
  return SKIP_FILES.has(name) || /\.log$/.test(name);
}

function walk(relDir, out) {
  const abs = path.join(ROOT, relDir);
  for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) { if (!skipDir(rel, ent.name)) walk(rel, out); continue; }
    if (ent.isFile() && !skipFile(ent.name)) out.push(rel);
  }
}

const files = [];
for (const f of ROOT_FILES) if (fs.existsSync(path.join(ROOT, f))) files.push(f);
for (const d of ROOT_DIRS) {
  if (!fs.existsSync(path.join(ROOT, d))) { console.error(`missing directory: ${d}`); process.exit(1); }
  walk(d, files);
}
files.sort();

for (const must of ['index.html', 'netlify.toml', 'shared/poe.js', 'games/black-cat/sim.wasm']) {
  if (!files.includes(must)) { console.error(`refusing to package: ${must} is missing`); process.exit(1); }
}

/* ---------- write the zip --------------------------------------------------- */

function haveZipBinary() {
  const r = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

function writeWithZipBinary() {
  // -X: no extra attributes, -D: no directory entries, -@: file list on stdin
  const r = spawnSync('zip', ['-q', '-X', '-D', '-@', OUT], { cwd: ROOT, input: files.join('\n') + '\n', encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`zip failed: ${r.stderr || r.stdout}`);
  return 'system zip';
}

/* Minimal ZIP writer: deflate entries, local headers, central directory, EOCD.
 * Fine for a few thousand entries under 4 GB, which is all this site is. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function writeWithZlib() {
  const fd = fs.openSync(OUT, 'w');
  const central = [];
  let offset = 0;
  const put = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
  for (const rel of files) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);
    let method = 8, body = zlib.deflateRawSync(data, { level: 9 });
    if (body.length >= data.length) { method = 0; body = data; }
    const { time, date } = dosDateTime(fs.statSync(path.join(ROOT, rel)).mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const headerOffset = offset;
    put(local); put(name); put(body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(headerOffset, 42);
    central.push(Buffer.concat([c, name]));
  }
  const cdStart = offset;
  for (const c of central) put(c);
  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  put(eocd);
  fs.closeSync(fd);
  return 'node:zlib';
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
const writer = haveZipBinary() ? writeWithZipBinary() : writeWithZlib();

/* ---------- manifest ---------------------------------------------------------- */

const fmt = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
let total = 0;
console.log(`\n  poe-arcade package — ${ROOT}\n`);
for (const rel of files) {
  const size = fs.statSync(path.join(ROOT, rel)).size;
  total += size;
  console.log(`  ${fmt(size).padStart(10)}  ${rel}`);
}
const zipSize = fs.statSync(OUT).size;
console.log(`\n  ${files.length} files, ${fmt(total)} uncompressed`);
console.log(`  wrote ${OUT} (${fmt(zipSize)}, via ${writer})`);
console.log(`  drop it on https://app.netlify.com/drop\n`);
