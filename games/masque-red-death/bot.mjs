#!/usr/bin/env node
/* Seven Chambers — scripted human-ish bot for tuning the strokes.
 *   node games/masque-red-death/bot.mjs [--trials 40] [--runs 20]      (run from the repo root)
 * Drives the simulation headlessly through window.__poe.step(dt) — no GPU time is spent per step —
 * with three players:
 *   hugger   runs to the wall away from him and stays there (the reviewer's wall-hugger)
 *   reader   watches which side he is on, goes the other way, and cuts back across when he lines up
 *   stepper  the reader, plus the sidestep (space) when he is close
 * Every player sees the world late (reaction latency), decides only a few times a second, and
 * misjudges distances a little. Prints survival per stroke and how far full runs get. */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'tools', 'package.json'));
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const TRIALS = arg('--trials', 40), RUNS = arg('--runs', 20);
const PHONE = process.argv.includes('--phone');   // the narrow portrait corridor

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

/* ---- the players (run inside the page) ---- */
const BOT_SRC = `window.__bot = (() => {
  const P = window.__poe;
  const R = Math.random, N = (s) => (R() + R() + R() - 1.5) * s;   // rough gaussian noise
  const XLIM = P.XLIM;
  function makePlayer(o) {
    const q = [];                       // decisions waiting on the player's reaction time
    let t = 0, nextDecide = 0, side = 0, dashed = false, juked = false, jukeDist = 0, dashDist = 0, strikeSeen = false;
    // pick the lane through the revelers ahead: cheapest sum of nearness to each dancer, a little inertia, a dislike of walls
    function lane(p, centre) {
      const rv = P.revelers().filter((r) => !r.fallen && p.z - r.z > -0.5 && p.z - r.z < 9);
      let bestX = p.x, bestC = 1e9;
      for (let x = -XLIM + 0.2; x <= XLIM - 0.2; x += 0.4) {
        let c = Math.abs(x - p.x) * 0.15 + (Math.abs(x) > XLIM - 1 ? 0.6 : 0) + Math.abs(x) * centre;
        for (const r of rv) { const ahead = Math.max(0.3, p.z - r.z), d = x - r.x; c += Math.exp(-d * d / 2.6) * (3 / ahead); }
        if (c < bestC) { bestC = c; bestX = x; }
      }
      return bestX;
    }
    function decide() {
      const p = P.player, s = P.strike, rd = P.rd;
      let left = false, right = false, dash = false;
      if (s && !s.passedDoor && rd.active) {
        if (!strikeSeen) { strikeSeen = true; side = 0; dashed = false; juked = false; jukeDist = o.jukeT + N(o.err); dashDist = o.dashT + N(o.err); }
        const dz = p.z - rd.z, dx = rd.x - p.x, closing = p.speed + rd.speed;
        const lead = o.latency + o.rate / 2;             // this decision lands that much later: a human judges looming and anticipates
        const ttc = dz / closing - lead;                 // seconds until he is on you, as of landing
        const dzL = Math.max(0, dz - closing * lead);    // his distance at landing
        const away = Math.abs(dx) < 0.2 ? (p.x > 0 ? -1 : 1) : (dx > 0 ? -1 : 1);   // away from him (dead level: toward the open floor)
        if (dz < o.readDist) {
          if (!side) side = away;
          const roomL = XLIM + p.x, roomR = XLIM - p.x, room = (d) => (d < 0 ? roomL : roomR);
          const miss = Math.abs(dx) - rd.track * Math.max(0, ttc + lead) > 2.4;   // he clearly cannot reach you in time: stand still and let him pass
          if (o.juke && !juked && !miss && room(side) < 1.2 && ttc < jukeDist) { side = -side; juked = true; }   // wall at your back: cut across him, once
          if (o.dash && !dashed && !miss && ttc < dashDist && p.dashCd <= 0) {
            dash = true; dashed = true;
            // a crossing is safe only if the lateral gap reaches his reach (1.15) before he is within 1.1 of level with you
            const need = 1.15 / (22 - rd.track) * closing + 1.1 + 0.4;
            const canCross = dzL - (Math.abs(dx) / 22) * closing > need;
            if (room(away) >= 2.4) side = away;
            else if (canCross) side = -away;
            else side = room(away) < 1.0 ? -away : away;    // cornered: across is the only hope
          }
          if (!miss) {
            const want = side * o.hold, xL = p.x + p.vx * lead;         // where this player waits for him (9 = at the wall); own x when the input lands
            if (dash) { if (side < 0) left = true; else right = true; }
            else if (xL < want - 0.3) right = true; else if (xL > want + 0.3) left = true;
          }
        } else { const x = lane(p, 0.5); if (x < p.x - 0.3) left = true; else if (x > p.x + 0.3) right = true; }   // he is far: thread the frozen dancers, keeping to the middle so both sides stay open
      } else {
        strikeSeen = false;
        // between strokes: thread the dancers
        const x = lane(p, 0.05); if (x < p.x - 0.3) left = true; else if (x > p.x + 0.3) right = true;
      }
      q.push({ at: t + o.latency + Math.abs(N(0.05)), left, right, dash });
    }
    return {
      tick(dt) {
        t += dt;
        if (t >= nextDecide) { decide(); nextDecide = t + o.rate * (0.8 + R() * 0.4); }
        while (q.length && q[0].at <= t) { const d = q.shift(); window.__lastKeys = d; P.setInput({ left: d.left, right: d.right }); if (d.dash) P.dash(); }
      },
    };
  }
  const PLAYERS = {
    // hold: how far from the middle the player will go before waiting (9 = to the wall)
    // jukeT / dashT: time-to-contact at which the cut-back or the sidestep is made (seconds), err the timing scatter
    hugger:  { juke: false, dash: false, readDist: 14, jukeT: 0.65, dashT: 0.25, hold: 9,   latency: 0.2, rate: 0.06, err: 0.08 },
    reader:  { juke: true,  dash: false, readDist: 30, jukeT: 0.65, dashT: 0.25, hold: 9,   latency: 0.2, rate: 0.06, err: 0.08 },
    stepper: { juke: false, dash: true,  readDist: 30, jukeT: 0.65, dashT: 0.25, hold: 2.2, latency: 0.2, rate: 0.06, err: 0.08 },
  };
  const DT = 1 / 60;
  function fresh() { P.setInput({ left: false, right: false, up: false, down: false }); P.abort(); P.start(); }
  // one stroke in isolation: k-1 already survived, rooms as crowded as they would be, the clock due at the second door (full speed)
  function trial(name, k, maxT = 40) {
    fresh(); P.setStrikes(k - 1); P.respawn(); P.run.nextStrike = P.time + 3;
    const pl = makePlayer(PLAYERS[name]); let t = 0, seen = false;
    while (t < maxT) {
      pl.tick(DT); P.step(DT); t += DT;
      if (P.mode === 'dead') return { ok: false, t };
      if (P.mode === 'won') return { ok: true, t };
      if (P.strike) seen = true; else if (seen) return { ok: true, t };
    }
    return { ok: false, timeout: true };
  }
  function why() {
    const s = P.strike, p = P.player, rd = P.rd;
    if (!s) return 'no strike';
    return { k: s.k, elapsed: +s.elapsed.toFixed(2), deadline: +(s.count * s.spacing).toFixed(2), passedDoor: s.passedDoor, px: +p.x.toFixed(2), rdx: +rd.x.toFixed(2), dz: +(p.z - rd.z).toFixed(2), speed: +p.speed.toFixed(1), grace: +p.grace.toFixed(2), brushCd: +p.brushCd.toFixed(2), dashCd: +p.dashCd.toFixed(2) };
  }
  function fullRun(name, maxT = 420) {
    fresh();
    const pl = makePlayer(PLAYERS[name]); let t = 0, jostles = 0, lastBrush = 0;
    while (t < maxT) {
      pl.tick(DT); P.step(DT); t += DT;
      if (P.player.brushCd > lastBrush) jostles++; lastBrush = P.player.brushCd;
      if (P.mode === 'dead') return { strikes: P.run.strikes, won: false, t, score: P.run.score, jostles, why: why() };
      if (P.mode === 'won') return { strikes: P.run.strikes, won: true, t, score: P.run.score };
    }
    return { strikes: P.run.strikes, won: false, timeout: true };
  }
  // frame-by-frame record of the last half second before a death at stroke k (for debugging the bot or the game)
  function trace(name, k, tries = 30) {
    for (let i = 0; i < tries; i++) {
      fresh(); P.setStrikes(k - 1); P.respawn(); P.run.nextStrike = P.time + 3;
      const pl = makePlayer(PLAYERS[name]); let t = 0; const ring = [];
      while (t < 40) {
        pl.tick(DT); P.step(DT); t += DT;
        const p = P.player, rd = P.rd, s = P.strike;
        ring.push({ t: +t.toFixed(2), px: +p.x.toFixed(2), vx: +p.vx.toFixed(1), rdx: +rd.x.toFixed(2), dz: s ? +(p.z - rd.z).toFixed(2) : null, dash: +p.dash.toFixed(2), cd: +p.dashCd.toFixed(2), spd: +p.speed.toFixed(1), L: window.__lastKeys && window.__lastKeys.left ? 1 : 0, R: window.__lastKeys && window.__lastKeys.right ? 1 : 0 });
        if (ring.length > 45) ring.shift();
        if (P.mode === 'dead') return ring;
        if (P.mode === 'won' || (!s && ring.some((r) => r.dz !== null))) break;
      }
    }
    return null;
  }
  const _si = P.setInput; window.__lastKeys = {};
  return { trial, fullRun, trace, names: Object.keys(PLAYERS) };
})();`;

const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/games/masque-red-death/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__poe && window.__poe.step');
// freeze the rendered clock and shrink the frame: the bot advances the world itself
await page.evaluate('window.__poe.setMaxDt(0); window.__poe.setResolution(0.2);');
await page.evaluate(BOT_SRC);

if (process.argv.includes('--trace')) {
  const k = arg('--trace', 1);
  const who = process.argv[process.argv.indexOf('--who') + 1] || 'stepper';
  const ring = await page.evaluate(`window.__bot.trace(${JSON.stringify(who)}, ${k})`);
  if (!ring) console.log('no death in 30 tries'); else for (const r of ring) console.log(JSON.stringify(r));
  await browser.close(); srv.close(); process.exit(0);
}
const names = await page.evaluate('window.__bot.names');
const pct = (a, b) => `${Math.round(100 * a / b).toString().padStart(3)}%`;
console.log(`${PHONE ? 'phone (portrait, 7-unit corridor)' : 'desktop (10-unit corridor)'} — per-stroke survival, ${TRIALS} trials each (the stroke alone, k-1 already survived)`);
console.log('stroke   ' + names.map((n) => n.padStart(8)).join(''));
const perStroke = {};
for (let k = 1; k <= 12; k++) {
  const row = [];
  for (const n of names) {
    let ok = 0, to = 0;
    for (let i = 0; i < TRIALS; i++) { const r = await page.evaluate(`window.__bot.trial(${JSON.stringify(n)}, ${k})`); if (r.ok) ok++; if (r.timeout) to++; }
    row.push(pct(ok, TRIALS) + (to ? `(${to} t/o)` : '').padEnd(0));
    (perStroke[n] ||= [])[k] = ok / TRIALS;
  }
  console.log(`${String(k).padStart(4)}     ` + row.map((c) => c.padStart(8)).join(''));
}
console.log(`\nfull runs, ${RUNS} each (strokes survived before he took them; 12 = midnight)`);
for (const n of names) {
  const hist = new Array(13).fill(0); let wins = 0, best = 0;
  for (let i = 0; i < RUNS; i++) { const r = await page.evaluate(`window.__bot.fullRun(${JSON.stringify(n)})`); hist[Math.min(12, r.strikes)]++; if (r.won) wins++; best = Math.max(best, r.score || 0); if (process.argv.includes('--why')) console.log('   ', n, JSON.stringify(r)); }
  const median = (() => { let c = 0; for (let k = 0; k <= 12; k++) { c += hist[k]; if (c * 2 >= RUNS) return k; } return 12; })();
  console.log(`${n.padEnd(8)} won ${pct(wins, RUNS)}  median ${median}  best score ${best}  histogram [${hist.join(' ')}]`);
}
await browser.close(); srv.close();
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of errors) console.log('  ' + e); process.exit(1); }
