/* THE DESCENDING BLADE — The Pit and the Pendulum
   Matter.js rigid bodies, every one of them drawn by hand in torch-lit chiaroscuro.
   The blade swings on real constraints. The walls are real bodies that really push.
   The rats are real bodies. Nothing here uses Matter.Render. */

import { mountBack, fitCanvas, createAudio, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';
import { createSfx } from './audio.js';

mountBack();

const { Engine, Bodies, Body, Composite, Constraint, Events } = Matter;

/* ------------------------------------------------------------------ constants */

const AH = 600;            // arena height in world units
const FLOOR_Y = 530;       // floor top
const PIT_W = 130;         // pit width
const T_WIN = 72;          // seconds until the trumpets
const PIVOT_Y0 = 60;       // starting pivot height (hop-under lethal from ~25s, standing under from ~46s)
const PIVOT_MAX = 190;     // the deepest the pivot may sink (reached ~51s; the safe strip then starts ~135 from the centre)
const NOTCH = 3.4;         // pivot drop per centre pass
const ROD = 290;           // rod length
const BLADE_HALF = 78;     // half chord of the crescent
const G = 1.6;             // Matter gravity.y
const G_STEP = 0.001 * G * (1000 / 60) ** 2; // px per step^2, for energy maths
const G_FORCE = 0.001 * G;                   // Matter force per unit mass that equals gravity
const CAT = { WORLD: 1, MAN: 2, BLADE: 4, RAT: 8 };

const QUOTES = {
  sliced: 'Down—steadily down it crept.',
  fell: 'the pit, whose horrors had been destined for so bold a recusant as myself',
  won: 'An outstretched arm caught my own as I fell, fainting, into the abyss. It was that of General Lasalle.',
};

const reduced = prefersReducedMotion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ DOM */

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = {
  hud: $('hud'), tNow: $('t-now'), tWin: $('t-win'), score: $('score'), scoreBox: $('hud-score'), time: $('hud-time'),
  title: $('title'), end: $('end'), endKicker: $('end-kicker'), endTitle: $('end-title'), endQuote: $('end-quote'), endTally: $('end-tally'),
  start: $('btn-start'), again: $('btn-again'), bestLine: $('best-line'), bestScore: $('best-score'), bestNote: $('best-note'),
  zones: $('touch-zones'),
};
ui.tWin.textContent = fmt(T_WIN);

/* ------------------------------------------------------------------ view */

let W = 0, H = 0, DPR = 1;
let AW = 960;              // arena width, chosen per orientation on game start
let view = { s: 1, ox: 0, oy: 0, zoom: 1 };
let bgCache = null;        // pre-rendered stone backdrop
let shake = { x: 0, y: 0, t: 0 };
let isMobile = matchMedia('(pointer: coarse)').matches;

fitCanvas(canvas, ({ width, height, dpr }) => { W = width; H = height; DPR = dpr; bgCache = null; });

function baseScale() { return Math.min(W / AW, H / AH); }
let floorBand = -1;
function layout() {
  const s0 = baseScale();
  const s = s0 * view.zoom;
  view.s = s;
  view.ox = (W - AW * s) / 2 + shake.x;
  // portrait: the floor sits at 70% of the height — the chain climbs the whole frame above it and
  // the touch buttons live in the band below it. Landscape centres the arena.
  const oy = (W < H) ? H * 0.70 - FLOOR_Y * s : (H - AH * s) / 2;
  view.oy = oy + shake.y + (cam.dy || 0);
  const band = (W < H) ? Math.round(H * 0.70) : -1;
  if (band !== floorBand) { floorBand = band; document.documentElement.style.setProperty('--floor-y', band < 0 ? '' : band + 'px'); }
}
const cam = { dy: 0 };
let worldRectOverride = null; // the title poster lends its own rect
function worldRect() { // the screen in world coords
  if (worldRectOverride) return worldRectOverride;
  return { x: -view.ox / view.s, y: -view.oy / view.s, w: W / view.s, h: H / view.s };
}

/* ------------------------------------------------------------------ audio */

const audio = createAudio();
const sfx = createSfx(audio);

/* ------------------------------------------------------------------ state */

let state = 'title';       // title | playing | sliced | fell | trumpet | won
let engine = null, world = null;
let man = null, blade = null, rods = [], wallL = null, wallR = null, floorL = null, floorR = null;
let rats = [];
let pivot = { x: 0, y: PIVOT_Y0 };
let time = 0;              // seconds of play
let realT = 0;             // wall-clock seconds for effects
let acc = 0;
let lastFrame = 0;
let slowmo = 0;
let lowFx = false, avgDt = 1 / 60, fxFrames = 0;
const perf = { step: 0, render: 0, frames: 0 };
let score = 0, stats = null;
let floaties = [];
let embers = [];
let deathT = 0, endT = 0;
let bladeInfo = { th: 0, vt: 0, speed: 0, passSide: 0, lastNear: -9, freeze: false };
let wall = { gap0: 0, gapEnd: 220, half: 0, heat: 0, surge: 0, prevHalf: 0, retract: 0 };
let manInfo = { grounded: false, coyote: 0, buffer: 0, dir: 1, run: 0, burnCd: 0, biteCd: 0, air: 0, flash: 0, lastGroundY: FLOOR_Y, dead: false, rescue: null };
let waves = { next: 4, n: 0 };
let best = loadState('pit-and-pendulum:best', null);
let debugInvincible = false;

const input = { left: false, right: false, hopQueued: false, touches: new Map(), swipe: null };

/* ------------------------------------------------------------------ world */

function buildWorld() {
  if (engine) { Composite.clear(world, false); Engine.clear(engine); }
  AW = (W < H) ? 660 : 960;
  engine = Engine.create({ gravity: { x: 0, y: G, scale: 0.001 }, positionIterations: 8, velocityIterations: 6, constraintIterations: 4, enableSleeping: false });
  world = engine.world;

  const cx = AW / 2;
  const pitL = cx - PIT_W / 2, pitR = cx + PIT_W / 2;
  floorL = Bodies.rectangle((pitL - 1200) / 2, FLOOR_Y + 60, 1200 + pitL, 120, { isStatic: true, label: 'floor', friction: 0.4, collisionFilter: { category: CAT.WORLD } });
  floorR = Bodies.rectangle((pitR + AW + 1200) / 2, FLOOR_Y + 60, AW + 1200 - pitR, 120, { isStatic: true, label: 'floor', friction: 0.4, collisionFilter: { category: CAT.WORLD } });
  const ceiling = Bodies.rectangle(cx, -60, 4000, 120, { isStatic: true, label: 'ceiling', collisionFilter: { category: CAT.WORLD } });

  wall.gap0 = AW / 2 - (W < H ? 26 : 44); wall.half = wall.gap0; wall.prevHalf = wall.half; wall.heat = 0; wall.surge = 0; wall.retract = 0;
  wallL = Bodies.rectangle(cx - wall.half - 250, AH / 2, 500, 3000, { isStatic: true, label: 'wall', friction: 0, collisionFilter: { category: CAT.WORLD, mask: CAT.MAN | CAT.RAT } });
  wallR = Bodies.rectangle(cx + wall.half + 250, AH / 2, 500, 3000, { isStatic: true, label: 'wall', friction: 0, collisionFilter: { category: CAT.WORLD, mask: CAT.MAN | CAT.RAT } });

  // the prisoner: torso + head, no rotation (kept stable on purpose)
  const mx = cx - 175, my = FLOOR_Y - 21;
  const torso = Bodies.rectangle(mx, my + 4, 22, 34, { chamfer: { radius: 6 } });
  const head = Bodies.circle(mx, my - 18, 9);
  man = Body.create({ parts: [torso, head], label: 'man', friction: 0.02, frictionStatic: 0, frictionAir: 0.012, restitution: 0, density: 0.0025,
    collisionFilter: { category: CAT.MAN, mask: CAT.WORLD | CAT.BLADE | CAT.RAT } });
  Body.setInertia(man, Infinity);
  Body.setPosition(man, { x: mx, y: my });

  // the blade: a crescent approximated by three plates, hung from the pivot on two rods (so it cannot spin)
  pivot = { x: cx, y: PIVOT_Y0 };
  const th0 = -0.95;
  const bx = pivot.x + ROD * Math.sin(th0), by = pivot.y + ROD * Math.cos(th0);
  const pc = Bodies.rectangle(0, 0, 66, 20);
  const pl = Bodies.rectangle(-58, -6, 56, 14, { angle: -0.24 });
  const pr = Bodies.rectangle(58, -6, 56, 14, { angle: 0.24 });
  blade = Body.create({ parts: [pc, pl, pr], label: 'blade', density: 0.02, frictionAir: 0, friction: 0, restitution: 0.1,
    collisionFilter: { category: CAT.BLADE, mask: CAT.MAN | CAT.RAT } });
  Body.setPosition(blade, { x: bx, y: by });
  Body.setAngle(blade, -th0);
  rods = [Constraint.create({ pointA: { x: pivot.x, y: pivot.y }, bodyB: blade, pointB: { x: 0, y: 0 }, length: ROD, stiffness: 1, damping: 0 })];

  Composite.add(world, [floorL, floorR, ceiling, wallL, wallR, man, blade, ...rods]);
  rats = [];

  Events.on(engine, 'collisionStart', onCollision);
  Events.on(engine, 'collisionActive', onCollision);
  bladeInfo = { th: th0, vt: 0, speed: 0, passSide: -1, lastNear: -9, freeze: false, notches: 0 };
}

function spawnRat(side, speed) {
  const cx = AW / 2;
  const x = side < 0 ? cx - wall.half + 10 : cx + wall.half - 10;
  const r = Bodies.circle(x, FLOOR_Y - 8, 7, { label: 'rat', friction: 0, frictionAir: 0.005, restitution: 0, density: 0.0015,
    collisionFilter: { category: CAT.RAT, mask: CAT.WORLD | CAT.MAN | CAT.BLADE } });
  Body.setInertia(r, Infinity);
  r.plugin = { dir: -side, speed, jumper: Math.random() < 0.82, lastRel: 0, phase: Math.random() * 6, hopped: false, tail: Math.random() * 6, dead: false };
  Composite.add(world, r);
  rats.push(r);
}

/* ------------------------------------------------------------------ collisions */

function onCollision(e) {
  if (state !== 'playing' && state !== 'trumpet') return;
  for (const p of e.pairs) {
    const A = p.bodyA.parent, B = p.bodyB.parent;
    const other = A === man ? B : (B === man ? A : null);
    if (other) {
      // anything under the feet counts as ground
      for (const s of p.collision.supports) if (s.y > man.position.y + 14 && (other.label !== 'rat' || other.position.y > man.bounds.max.y - 4)) manInfo.grounded = true;
      if (other.label === 'blade' && state === 'playing' && !debugInvincible) { die('sliced'); return; }
      if (other.label === 'wall' && state === 'playing') burn(other);
      if (other.label === 'rat' && state === 'playing') { ratShove(p, other, e.name === 'collisionStart'); bitten(other); }
      continue;
    }
  }
}

// how far a wall's heat reaches from its face: nothing until the iron is well lit, ~35 units when it is white
function searReach() { return clamp((wall.heat - 0.6) * 90, 0, 35); }

function burn(w) {
  if (wall.heat < 0.15 || manInfo.burnCd > 0) return;
  manInfo.burnCd = 0.7;
  manInfo.stagger = 0.12;                                        // flung: no footing for a few steps
  const dir = (w === wallL) ? 1 : -1;
  Body.setVelocity(man, { x: dir * 11, y: Math.min(man.velocity.y, -2.5) });
  addScore(-4, 'seared −4', '#ff6a3a');
  manInfo.flash = 0.35;
  shakeIt(6);
  sfx.sizzle();
  stats.burns++;
  for (let i = 0; i < 14; i++) embers.push({ x: man.position.x - dir * 8, y: man.position.y + (Math.random() - .5) * 30, vx: dir * (1 + Math.random() * 3), vy: -1 - Math.random() * 3, life: 0.5 + Math.random() * 0.5, r: 1 + Math.random() * 1.5 });
}

// the rats are a tide toward the pit: a rat running at the pit shoves him (one at a time, and each
// gives up after a moment and scrambles over him), a rat running away from it only bites on its way past.
// A pair made a sensor stays one for its life, and Matter fires collisionStart before it resolves the step.
function ratShove(pair, rat, starting) {
  const pl = rat.plugin;
  if (pl.phased) { pair.isSensor = true; return; }
  if (pair.isSensor) return;
  const towardPit = (rat.position.x < AW / 2 ? 1 : -1) === pl.dir;
  if (!towardPit) { pl.phased = true; pair.isSensor = true; return; }
  if (rat.position.y > man.bounds.max.y - 4) return;           // under his feet: he stands on it
  if (starting) {
    let pushing = 0;
    for (const q of engine.pairs.list) {
      if (q === pair || !q.isActive || q.isSensor) continue;
      const A = q.bodyA.parent, B = q.bodyB.parent;
      if ((A === man && B.label === 'rat') || (B === man && A.label === 'rat')) pushing++;
    }
    if (pushing >= 1) { pl.phased = true; pair.isSensor = true; return; }
  }
  pl.blocked = (pl.blocked || 0) + 1;
  if (pl.blocked > 12) { pl.phased = true; pair.isSensor = true; }
}

function bitten(rat) {
  if (manInfo.biteCd > 0) return;
  // only a bite if the rat is not under his feet (a rat on the flagstones sits at FLOOR_Y − 7, beside his shins)
  if (rat.position.y > man.bounds.max.y - 4) return;
  manInfo.biteCd = 0.45;
  addScore(-2, 'bitten −2', '#c9b9a0');
  Body.setVelocity(man, { x: man.velocity.x + rat.plugin.dir * 1.8, y: man.velocity.y });
  manInfo.flash = 0.2;
  sfx.bite();
  stats.bites++;
}

/* ------------------------------------------------------------------ blade geometry */

// the lowest point of the crescent's plates over a column of x (−Infinity when nothing hangs over it)
function bladeEdgeOver(x0, x1) {
  let low = -Infinity;
  for (let i = 1; i < blade.parts.length; i++) {
    const vs = blade.parts[i].vertices;
    for (let j = 0; j < vs.length; j++) {
      const a = vs[j], b = vs[(j + 1) % vs.length];
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      if (hi < x0 || lo > x1) continue;
      if (hi - lo < 0.01) { low = Math.max(low, a.y, b.y); continue; }
      const yAt = (x) => a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      low = Math.max(low, yAt(Math.max(lo, x0)), yAt(Math.min(hi, x1)));
    }
  }
  return low;
}
// how far the edge is above his head/shoulders right now (Infinity when the blade is elsewhere)
function bladeClearance() {
  const mx = man.position.x, my = man.position.y;
  const head = man.bounds.min.y - bladeEdgeOver(mx - 8, mx + 8);
  const torso = (my - 13) - bladeEdgeOver(mx - 11, mx + 11);
  return Math.min(head, torso);
}

/* ------------------------------------------------------------------ score */

function addScore(n, label, color) {
  score = Math.max(0, score + n);
  ui.score.textContent = score;
  ui.scoreBox.classList.remove('hot'); void ui.scoreBox.offsetWidth; ui.scoreBox.classList.add('hot');
  if (label) floaties.push({ x: man.position.x, y: man.position.y - 40, text: label, color, life: 1.1, vy: -22 });
}
function shakeIt(amt) { if (!reduced) shake.t = Math.max(shake.t, amt); }

/* ------------------------------------------------------------------ schedule */

// wall progress 0..1: slow creep plus four surges that shove
const SURGES = [[12, 1.3, 0.1], [32, 1.2, 0.15], [46, 1.0, 0.2], [60, 1.0, 0.2]];
function wallProgress(t) {
  let f = 0.45 * clamp((t - 4) / (T_WIN - 4), 0, 1);
  for (const [at, dur, w] of SURGES) f += w * smooth((t - at) / dur);
  return clamp(f, 0, 1);
}
function surgeAmount(t) {
  let s = 0;
  for (const [at, dur] of SURGES) {
    const u = (t - at + 1.0) / (dur + 1.0);        // one-second telegraph before each surge
    if (u > 0 && u < 1) s = Math.max(s, Math.sin(u * Math.PI));
  }
  return s;
}

function scheduleRats(dt) {
  waves.next -= dt;
  if (waves.next > 0) return;
  waves.n++;
  const cap = isMobile ? 12 : 20;
  const prog = clamp(time / T_WIN, 0, 1);
  const n = Math.min(3 + Math.floor(prog * 6) + (waves.n % 3 === 0 ? 2 : 0), cap - rats.length);
  const both = waves.n >= 4 && waves.n % 3 === 1;
  const side = (waves.n % 2 === 0) ? -1 : 1;
  const speed = 3.2 + prog * 1.6 + Math.random() * 0.6;
  for (let i = 0; i < n; i++) {
    const s = both ? (i % 2 ? 1 : -1) : side;
    setTimeout(() => { if (state === 'playing') spawnRat(s, speed + (Math.random() - .5) * 0.8); }, i * (220 - prog * 90));
  }
  waves.next = 5.0 - prog * 2.3 + Math.random() * 1.0;
  floaties.push({ x: AW / 2 + side * (wall.half - 40) * (both ? 0 : 1), y: FLOOR_Y - 60, text: both ? 'rats — both sides' : 'rats', color: '#a9998a', life: 1.4, vy: -14, italic: true });
}

/* ------------------------------------------------------------------ step */

function step(dt) {
  const cx = AW / 2;
  if (state === 'playing') {
    time += dt;
    if (Math.floor(time) > stats.seconds) { stats.seconds = Math.floor(time); score += 1; ui.score.textContent = score; }
  }
  realT += dt;

  // ---- walls
  if (state === 'playing') {
    const f = wallProgress(time);
    wall.half = lerp(wall.gap0, wall.gapEnd, f);
    wall.heat = clamp(f * 1.15, 0, 1);
    wall.surge = surgeAmount(time);
  } else if (state === 'trumpet') {
    wall.retract = Math.min(1, wall.retract + dt / 4.5);
    wall.half = lerp(wall.half, wall.gap0, smooth(wall.retract) * 0.06 + 0.002);
    wall.heat = Math.max(0, wall.heat - dt * 0.35);
    wall.surge = 0;
  }
  Body.setPosition(wallL, { x: cx - wall.half - 250, y: AH / 2 });
  Body.setPosition(wallR, { x: cx + wall.half + 250, y: AH / 2 });

  // ---- prisoner control
  if (!manInfo.dead && state === 'playing') {
    const target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const spd = 4.3;
    const staggered = (manInfo.stagger || 0) > 0;
    if (staggered) manInfo.stagger -= dt;
    const vx = staggered ? man.velocity.x : (manInfo.grounded ? lerp(man.velocity.x, target * spd, 0.35) : lerp(man.velocity.x, target * spd, 0.12));
    Body.setVelocity(man, { x: vx, y: man.velocity.y });
    if (target) manInfo.dir = target;
    manInfo.run += Math.abs(vx) * dt * 3.2;
    manInfo.coyote = manInfo.grounded ? 0.1 : manInfo.coyote - dt;
    if (input.hopQueued) { manInfo.buffer = 0.12; input.hopQueued = false; }
    manInfo.buffer -= dt;
    if (manInfo.buffer > 0 && manInfo.coyote > 0 && !staggered) {
      Body.setVelocity(man, { x: man.velocity.x, y: -7.2 });
      manInfo.buffer = 0; manInfo.coyote = 0; manInfo.grounded = false;
      sfx.hop();
      stats.hops++;
    }
    if (!manInfo.grounded) manInfo.air += dt; else { if (manInfo.air > 0.25) sfx.land(manInfo.air); manInfo.air = 0; }
    manInfo.burnCd -= dt; manInfo.biteCd -= dt; manInfo.flash = Math.max(0, manInfo.flash - dt);
    // the heat itself sears him before the iron does
    const sear = searReach();
    if (sear > 0 && Math.abs(man.position.x - cx) > wall.half - 11 - sear) burn(man.position.x < cx ? wallL : wallR);
    if (man.position.y > FLOOR_Y + 40) {
      if (!debugInvincible) die('fell');
      else { Body.setPosition(man, { x: cx - 170, y: FLOOR_Y - 30 }); Body.setVelocity(man, { x: 0, y: 0 }); }
    }
  }
  const wasGrounded = manInfo.grounded;
  manInfo.grounded = false;

  // ---- blade: measure, pump to the target amplitude, descend at each centre pass
  if (!bladeInfo.freeze) {
    const dx = blade.position.x - pivot.x, dy = blade.position.y - pivot.y;
    const L = Math.hypot(dx, dy) || ROD;
    const th = Math.atan2(dx, dy);
    const tx = Math.cos(th), ty = -Math.sin(th);
    const vt = blade.velocity.x * tx + blade.velocity.y * ty;
    const ampNow = Math.acos(clamp(Math.cos(th) - (vt * vt) / (2 * G_STEP * L), -1, 1));
    if (state === 'playing') {
      // "the sweep of the pendulum had increased in extent": the swing widens as it sinks
      const reach = Math.min(0.92 * L, wall.half - 62, 118 + time * 4.6);
      const targetAmp = Math.asin(clamp(reach / L, 0.2, 0.95));
      const err = targetAmp - ampNow;
      const f = clamp(err * 5, -1, 1) * blade.mass * G_FORCE * 0.22 * Math.sign(vt || 1);
      Body.applyForce(blade, blade.position, { x: f * tx, y: f * ty });
      const side = Math.sign(th);
      if (side !== 0 && side !== bladeInfo.passSide) {
        bladeInfo.passSide = side;
        if (time > 0.5) {
          pivot.y = Math.min(PIVOT_MAX, pivot.y + NOTCH);
          for (const r of rods) r.pointA.y = pivot.y;
          bladeInfo.notches++;
          sfx.notch();
        }
      }
    } else if (state === 'trumpet') {
      // the blade halts: heavy braking against its motion
      const f = -Math.sign(vt) * blade.mass * G_FORCE * Math.min(0.7, Math.abs(vt) * 0.25);
      Body.applyForce(blade, blade.position, { x: f * tx, y: f * ty });
    }
    bladeInfo.th = th; bladeInfo.vt = vt; bladeInfo.speed = Math.abs(vt) * 60; bladeInfo.reach = L * Math.sin(ampNow);
    // a rigid rod holds its blade square to itself
    Body.setAngle(blade, -th);
    Body.setAngularVelocity(blade, 0);
  }

  // ---- near miss: the edge passes within a hair of his head (the true edge over his column, not the bounds)
  if (state === 'playing' && !manInfo.dead) {
    const clearance = bladeClearance();
    if (clearance > 0 && clearance < 26 && bladeInfo.speed > 120 && time - bladeInfo.lastNear > 0.9) {
      bladeInfo.lastNear = time;
      addScore(10, 'a hair’s breadth +10', '#f0a05a');
      stats.near++;
      sfx.heartbeat();
      if (!reduced) slowmo = 0.28;
    }
  }

  // ---- rats
  const pitL = cx - PIT_W / 2, pitR = cx + PIT_W / 2;
  for (let i = rats.length - 1; i >= 0; i--) {
    const r = rats[i], pl = r.plugin;
    if (state === 'trumpet') pl.dir = r.position.x < cx ? -1 : 1;
    const onGround = Math.abs(r.velocity.y) < 0.6 && r.position.y > FLOOR_Y - 20;
    Body.setVelocity(r, { x: onGround ? pl.dir * pl.speed : lerp(r.velocity.x, pl.dir * pl.speed, 0.05), y: r.velocity.y });
    // leap the pit (or not)
    const edge = pl.dir > 0 ? pitL : pitR;
    const distToEdge = (edge - r.position.x) * pl.dir;
    if (onGround && distToEdge < 9 && distToEdge > -9 && r.position.y < FLOOR_Y && pl.jumper && !pl.leapt) {
      pl.leapt = true;
      const flight = (PIT_W + 40) / pl.speed;
      Body.setVelocity(r, { x: pl.dir * pl.speed, y: -G_STEP * flight / 2 });
    }
    // hopped over?
    if (state === 'playing' && !manInfo.dead) {
      const rel = Math.sign(r.position.x - man.position.x);
      if (pl.lastRel && rel && rel !== pl.lastRel && !wasGrounded && man.bounds.max.y < r.bounds.min.y + 6 && !pl.hopped) {
        pl.hopped = true; addScore(1, '+1', '#d9cdb5'); stats.rats++;
      }
      pl.lastRel = rel;
    }
    pl.phase += dt * 22;
    // gone once it reaches the far wall (its centre sits a radius off the face, so allow for that) or falls out of the world
    const gone = r.position.y > AH + 120 || (r.position.x - cx) * pl.dir > wall.half - 14 || Math.abs(r.position.x - cx) > wall.half + 40;
    if (gone) { Composite.remove(world, r); rats.splice(i, 1); }
  }
  if (state === 'playing') scheduleRats(dt);

  // ---- physics
  engine.timing.timeScale = slowmo > 0 ? 0.3 : 1;
  Engine.update(engine, 1000 / 60);
  if (slowmo > 0) slowmo -= dt;

  // stop the freeze-frame blade one frame after contact
  if (bladeInfo.freezeNext) { bladeInfo.freeze = true; bladeInfo.freezeNext = false; Body.setStatic(blade, true); }

  // ---- particles & floaties
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.x += e.vx * dt * 60; e.y += e.vy * dt * 60; e.vy += 0.08 * dt * 60; e.life -= dt;
    if (e.life <= 0) embers.splice(i, 1);
  }
  for (let i = floaties.length - 1; i >= 0; i--) {
    const f = floaties[i];
    f.y += f.vy * dt; f.life -= dt;
    if (f.life <= 0) floaties.splice(i, 1);
  }
  // torch embers drifting
  if (!reduced && Math.random() < dt * 8) {
    const tx = cx - wall.half + 40, ty = 150;
    embers.push({ x: tx + (Math.random() - .5) * 10, y: ty, vx: (Math.random() - .3) * 0.6, vy: -0.6 - Math.random() * 1.2, life: 1.2 + Math.random() * 1.6, r: 0.8 + Math.random() * 1.2, soft: true });
  }
  if (shake.t > 0) { shake.t = Math.max(0, shake.t - dt * 24); shake.x = (Math.random() - .5) * shake.t; shake.y = (Math.random() - .5) * shake.t; } else { shake.x = shake.y = 0; }

  // ---- the trumpet
  if (state === 'playing' && time >= T_WIN) win();
  if (state === 'trumpet') stepRescue(dt);
  if ((state === 'sliced' || state === 'fell') && !manInfo.endShown) {
    deathT += dt;
    if (state === 'fell') { cam.dy = lerp(cam.dy, -(man.position.y - FLOOR_Y) * view.s * 0.9, 0.08); }
    if (deathT > (state === 'fell' ? 2.4 : 1.4)) showEnd();
  }
  if (state === 'won') endT += dt;

  // ---- audio
  if (sfx.live) {
    const towards = Math.sign(man.position.x - blade.position.x) * Math.sign(blade.velocity.x);
    sfx.update(dt, { bladeSpeed: bladeInfo.freeze ? 0 : bladeInfo.speed, approach: towards, wallHeat: wall.heat, surge: wall.surge * (state === 'playing' ? 1 : 0), rats: rats.length, groanLevel: state === 'playing' ? 1 : (state === 'trumpet' ? 0.6 : 0) });
  }
  // ---- HUD
  if (state === 'playing') {
    ui.tNow.textContent = fmt(time);
    ui.time.classList.toggle('hark', time > T_WIN - 10);
  }
}

/* ------------------------------------------------------------------ rescue */

function stepRescue(dt) {
  const r = manInfo.rescue;
  r.t += dt;
  const cx = AW / 2;
  // the hand comes down from above, finds him, and lifts
  if (r.t > 1.6 && r.phase === 0) r.phase = 1;
  if (r.phase === 1) {
    r.armY = lerp(r.armY, man.position.y - 34, 0.06);
    r.armX = lerp(r.armX, man.position.x, 0.06);
    if (Math.abs(r.armY - (man.position.y - 34)) < 4) { r.phase = 2; r.gripT = 0; Body.setStatic(man, true); manInfo.dead = true; }
  } else if (r.phase === 2) {
    r.gripT += dt;
    if (r.gripT > 0.5) {
      const ny = man.position.y - dt * (70 + r.gripT * 90);
      Body.setPosition(man, { x: man.position.x, y: ny });
      r.armY = ny - 34; r.armX = man.position.x;
      if (ny < -80) { state = 'won'; showEnd(); }
    }
  }
  r.light = Math.min(1, r.t / 4);
}

/* ------------------------------------------------------------------ transitions */

let startedAt = 0;
function startGame() {
  startedAt = performance.now();
  buildWorld();
  state = 'playing';
  time = 0; acc = 0; score = 0; slowmo = 0; cam.dy = 0; deathT = 0; endT = 0;
  stats = { near: 0, rats: 0, hops: 0, burns: 0, bites: 0, seconds: 0 };
  floaties = []; embers = [];
  waves = { next: 3.5, n: 0 };
  manInfo = { grounded: true, coyote: 0, buffer: 0, dir: 1, run: 0, burnCd: 0, biteCd: 0, air: 0, flash: 0, dead: false, rescue: null, endShown: false };
  ui.score.textContent = '0'; ui.tNow.textContent = '0:00'; ui.time.classList.remove('hark');
  ui.title.hidden = true; ui.end.hidden = true; ui.hud.hidden = false;
  ui.zones.hidden = !isMobile;
  sfx.reset();
  sfx.init().then((ok) => { if (ok && state === 'playing') sfx.startAmbience(); });
  floaties.push({ x: AW / 2, y: 300, text: 'the blade is loosed', color: '#c9b9a0', life: 2.2, vy: -8, italic: true, big: true });
}

function die(how) {
  if (state !== 'playing') return;
  state = how;
  manInfo.dead = true; deathT = 0;
  stats.seconds = Math.floor(time);
  if (how === 'sliced') { bladeInfo.freezeNext = true; sfx.slice(); }
  else { sfx.fall(); Body.setVelocity(man, { x: man.velocity.x * 0.3, y: Math.max(man.velocity.y, 1) }); }
  ui.hud.hidden = true;
}

function win() {
  state = 'trumpet';
  stats.seconds = T_WIN;
  score += 50;
  ui.score.textContent = score;
  manInfo.rescue = { t: 0, phase: 0, armX: AW / 2 - 60, armY: -120, gripT: 0, light: 0 };
  sfx.fanfare();
  ui.tNow.textContent = fmt(T_WIN);
  floaties.push({ x: AW / 2, y: 220, text: 'the trumpets of Lasalle', color: '#fff1d6', life: 3, vy: -6, italic: true, big: true });
  shakeIt(10);
}

function showEnd() {
  manInfo.endShown = true;
  ui.hud.hidden = true;
  const won = state === 'won';
  const isBest = !best || score > best.score;
  if (isBest) { best = { score, seconds: stats.seconds, won, near: stats.near, rats: stats.rats }; saveState('pit-and-pendulum:best', best); }
  ui.end.className = 'screen ' + (won ? 'won' : (state === 'sliced' ? 'slain' : 'fell'));
  ui.endKicker.textContent = won ? 'Toledo falls to the French' : (state === 'sliced' ? 'the pendulum' : 'the pit');
  ui.endTitle.textContent = won ? 'Delivered' : (state === 'sliced' ? 'Sliced' : 'Fallen');
  ui.endQuote.textContent = QUOTES[won ? 'won' : state];
  ui.endTally.innerHTML = `${score} <small>${stats.seconds}s endured &middot; ${stats.near} hair’s-breadth ${stats.near === 1 ? 'pass' : 'passes'} &middot; ${stats.rats} rats hopped${isBest ? ' &middot; <span class="newbest">a new best</span>' : ''}</small>`;
  ui.end.hidden = false;
  refreshBest();
}

function refreshBest() {
  if (!best) { ui.bestLine.hidden = true; return; }
  ui.bestLine.hidden = false;
  ui.bestScore.textContent = best.score;
  ui.bestNote.textContent = best.won ? 'delivered by Lasalle' : `${best.seconds}s in the cell`;
}

function toTitle() {
  state = 'title';
  ui.end.hidden = true; ui.hud.hidden = true; ui.title.hidden = false;
  ui.zones.hidden = true;
  sfx.stopAmbience();
  cam.dy = 0;
  refreshBest();
}

/* ------------------------------------------------------------------ input */

function hop() { if (state === 'playing') input.hopQueued = true; }
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code;
  if (state === 'title' && (k === 'Enter' || k === 'Space')) { e.preventDefault(); startGame(); return; }
  if ((state === 'won' || state === 'sliced' || state === 'fell') && manInfo.endShown && (k === 'Enter' || k === 'Space' || k === 'KeyR')) { e.preventDefault(); startGame(); return; }
  if (k === 'ArrowLeft' || k === 'KeyA') { input.left = true; e.preventDefault(); }
  if (k === 'ArrowRight' || k === 'KeyD') { input.right = true; e.preventDefault(); }
  if (k === 'Space' || k === 'KeyW' || k === 'ArrowUp') { hop(); e.preventDefault(); }
  if (k === 'KeyR' && state === 'playing') startGame();
});
addEventListener('keyup', (e) => {
  const k = e.code;
  if (k === 'ArrowLeft' || k === 'KeyA') input.left = false;
  if (k === 'ArrowRight' || k === 'KeyD') input.right = false;
});
addEventListener('blur', () => { input.left = input.right = false; });

// touch: left/right thirds walk, middle hops, swipe up anywhere hops
const zones = [...ui.zones.querySelectorAll('.zone')];
function zoneOf(x) { return x < W / 3 ? 0 : (x > (2 * W) / 3 ? 2 : 1); }
function recomputeTouch() {
  let l = false, r = false;
  for (const t of input.touches.values()) { if (t.zone === 0) l = true; if (t.zone === 2) r = true; }
  input.left = l; input.right = r;
  zones.forEach((z, i) => z.classList.toggle('on', [...input.touches.values()].some((t) => t.zone === i)));
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') { isMobile = true; if (state === 'playing') ui.zones.hidden = false; }
  if (state !== 'playing' || performance.now() - startedAt < 350) return;
  const z = zoneOf(e.clientX);
  input.touches.set(e.pointerId, { zone: z, x0: e.clientX, y0: e.clientY, t0: performance.now(), hopped: z === 1 });
  if (z === 1) hop();
  recomputeTouch();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener('pointermove', (e) => {
  const t = input.touches.get(e.pointerId);
  if (!t) return;
  if (!t.hopped && t.y0 - e.clientY > 28 && performance.now() - t.t0 < 400) { t.hopped = true; hop(); }
  const z = zoneOf(e.clientX);
  if (z !== t.zone && z !== 1) { t.zone = z; recomputeTouch(); }
});
const endTouch = (e) => { if (input.touches.delete(e.pointerId)) recomputeTouch(); };
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
canvas.addEventListener('lostpointercapture', endTouch);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

ui.start.addEventListener('click', () => { if (state === 'title') startGame(); });
ui.again.addEventListener('click', () => { if (state !== 'playing' && manInfo.endShown) startGame(); });
// on the title, a tap or click anywhere (except the back link) enters the cell
document.addEventListener('pointerdown', (e) => {
  if (state !== 'title') return;
  if (e.target.closest && e.target.closest('.poe-back')) return;
  if (e.pointerType !== 'mouse') isMobile = true;
  startGame();
}, { capture: true });

/* ------------------------------------------------------------------ render */

const IRON = '#4a4b4f';
const RUST = '#c4561c';

function flicker(t) { // smooth noise, not jitter
  return 0.82 + 0.09 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1.7) + 0.03 * Math.sin(t * 23.7 + 0.4);
}

function torchPos() { return { x: AW / 2 - wall.half + 42, y: 140 }; }

let seedN = 1;
function srand() { seedN = (seedN * 16807) % 2147483647; return (seedN - 1) / 2147483646; }

function stoneBackdrop() {
  // pre-rendered once per size: the back wall of the cell, in world coords
  const cv = document.createElement('canvas');
  const s = view.s;
  const rect = worldRect();
  cv.width = Math.ceil(rect.w * s * DPR); cv.height = Math.ceil(rect.h * s * DPR);
  const c = cv.getContext('2d');
  c.setTransform(s * DPR, 0, 0, s * DPR, -rect.x * s * DPR, -rect.y * s * DPR);
  c.fillStyle = '#17120f'; c.fillRect(rect.x, rect.y, rect.w, rect.h);
  seedN = 7;
  const rowH = 44;
  for (let y = Math.floor(rect.y / rowH) * rowH - rowH; y < FLOOR_Y; y += rowH) {
    const off = ((y / rowH) | 0) % 2 ? 60 : 0;
    for (let x = Math.floor(rect.x / 120) * 120 - 120 + off; x < rect.x + rect.w + 120; x += 120) {
      const w = 112 + srand() * 6, h = rowH - 4 - srand() * 3;
      const g = 24 + srand() * 12;
      c.fillStyle = `rgb(${g + 6},${g},${g - 4})`;
      c.beginPath(); c.roundRect(x + 2, y + 2, w, h, 3); c.fill();
      c.fillStyle = `rgba(255,220,180,${0.04 + srand() * 0.04})`;
      c.fillRect(x + 4, y + 3, w - 4, 2);
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.fillRect(x + 4, y + h - 1, w - 4, 3);
      // moss / stains
      if (srand() < 0.3) { c.fillStyle = `rgba(0,0,0,${0.15 + srand() * 0.25})`; c.beginPath(); c.ellipse(x + srand() * w, y + srand() * h, 10 + srand() * 25, 4 + srand() * 8, 0, 0, 7); c.fill(); }
    }
  }
  return { cv, rect };
}

function drawFloor(c) {
  const cx = AW / 2, rect = worldRect();
  const pitL = cx - PIT_W / 2, pitR = cx + PIT_W / 2;
  // flagstones
  c.fillStyle = '#2b2420';
  c.fillRect(rect.x, FLOOR_Y, rect.w, rect.y + rect.h - FLOOR_Y);
  c.fillStyle = '#3a312b';
  c.fillRect(rect.x, FLOOR_Y, rect.w, 14);
  c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5;
  seedN = 3;
  for (let x = Math.floor(rect.x / 70) * 70; x < rect.x + rect.w; x += 70) {
    c.beginPath(); c.moveTo(x, FLOOR_Y); c.lineTo(x - 6, FLOOR_Y + 14); c.stroke();
    c.beginPath(); c.moveTo(x + 8, FLOOR_Y + 14); c.lineTo(x + 20, FLOOR_Y + 70); c.stroke();
  }
  c.fillStyle = 'rgba(255,235,200,.14)'; c.fillRect(rect.x, FLOOR_Y, rect.w, 2);
  // the pit: a hole with a lip, depth rings sinking to black
  c.save();
  c.beginPath(); c.rect(pitL - 20, FLOOR_Y - 8, PIT_W + 40, rect.y + rect.h - FLOOR_Y + 8);
  c.clip();
  c.fillStyle = '#000';
  c.fillRect(pitL, FLOOR_Y, PIT_W, rect.y + rect.h - FLOOR_Y);
  const depth = c.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 260);
  depth.addColorStop(0, 'rgba(50,28,20,.35)'); depth.addColorStop(0.3, 'rgba(30,12,8,.2)'); depth.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = depth; c.fillRect(pitL, FLOOR_Y, PIT_W, 260);
  // the shaft walls, all the way down
  const shaftBottom = rect.y + rect.h;
  const sw = c.createLinearGradient(pitL, 0, pitL + 22, 0);
  sw.addColorStop(0, 'rgba(70,45,34,.5)'); sw.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sw; c.fillRect(pitL, FLOOR_Y, 22, shaftBottom - FLOOR_Y);
  const sw2 = c.createLinearGradient(pitR, 0, pitR - 22, 0);
  sw2.addColorStop(0, 'rgba(40,26,20,.5)'); sw2.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sw2; c.fillRect(pitR - 22, FLOOR_Y, 22, shaftBottom - FLOOR_Y);
  // ledges on the way down
  for (let i = 0; i < 6 + Math.max(0, (shaftBottom - FLOOR_Y - 260) / 38); i++) {
    const y = FLOOR_Y + 22 + i * 38, inset = 6 + i * 4;
    c.strokeStyle = `rgba(120,80,60,${0.35 - i * 0.05})`; c.lineWidth = 2;
    c.beginPath(); c.moveTo(pitL + inset, y); c.lineTo(pitL + inset + 18 - i * 2, y + 6); c.stroke();
    c.beginPath(); c.moveTo(pitR - inset, y + 10); c.lineTo(pitR - inset - 14, y + 15); c.stroke();
  }
  // a faint red breath far down
  const breath = c.createRadialGradient(cx, FLOOR_Y + 330, 10, cx, FLOOR_Y + 330, 130);
  breath.addColorStop(0, `rgba(120,20,10,${0.18 + 0.1 * Math.sin(realT * 1.3)})`); breath.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = breath; c.fillRect(pitL, FLOOR_Y + 150, PIT_W, 400);
  c.restore();
  // lip highlights
  c.fillStyle = 'rgba(0,0,0,.7)'; c.fillRect(pitL - 3, FLOOR_Y - 1, 3, 20); c.fillRect(pitR, FLOOR_Y - 1, 3, 20);
  c.fillStyle = 'rgba(255,235,200,.32)'; c.fillRect(pitL - 14, FLOOR_Y - 1, 12, 3); c.fillRect(pitR + 2, FLOOR_Y - 1, 12, 3);
  // worn stone around the mouth of the pit
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(pitL - 40, FLOOR_Y + 6); c.lineTo(pitL - 6, FLOOR_Y + 3); c.moveTo(pitR + 6, FLOOR_Y + 3); c.lineTo(pitR + 40, FLOOR_Y + 8); c.stroke();
}

function demonSet(seed) {
  seedN = seed; const out = [];
  for (let i = 0; i < 4; i++) {
    out.push({ y: 70 + i * 118 + srand() * 20, size: 26 + srand() * 14, horn: 0.7 + srand() * 0.8, mouth: srand(), eyes: 0.5 + srand() * 0.5, tilt: (srand() - .5) * 0.5, arms: srand() > 0.4 });
  }
  return out;
}
const DEMONS = [demonSet(11), demonSet(29)];

function drawWall(c, side, t) {
  // side: -1 left, +1 right. The slab runs from the face to the screen edge.
  const cx = AW / 2, rect = worldRect();
  const face = cx + side * wall.half;
  const x0 = side < 0 ? rect.x - 10 : face;
  const x1 = side < 0 ? face : rect.x + rect.w + 10;
  const top = rect.y - 10, bottom = FLOOR_Y + 8;
  // iron plate body
  const g = c.createLinearGradient(face, 0, face + side * 260, 0);
  g.addColorStop(0, '#3a3b3f'); g.addColorStop(0.15, '#2a2b2e'); g.addColorStop(1, '#141416');
  c.fillStyle = g; c.fillRect(x0, top, x1 - x0, bottom - top);
  // plate seams + rivets
  c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 2;
  for (let y = 0; y < FLOOR_Y; y += 96) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
  for (let k = 1; k < 4; k++) { const x = face + side * k * 110; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); }
  c.fillStyle = '#5b5c61';
  for (let y = 12; y < FLOOR_Y; y += 96) for (let k = 0; k < 4; k++) { const x = face + side * (14 + k * 110); c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); c.fillStyle = '#5b5c61'; }
  // demons painted on the iron
  const heat = wall.heat, surge = wall.surge;
  const glow = clamp(heat * 0.9 + surge * 0.6, 0, 1);
  const pulse = 0.75 + 0.25 * Math.sin(t * 3 + side);
  for (const d of DEMONS[side < 0 ? 0 : 1]) {
    const x = face + side * (48 + d.size * 0.4);
    drawDemon(c, x, d.y, d.size, d, side, glow * pulse);
  }
  // the hot face: a bright rim that reddens with heat
  const rim = c.createLinearGradient(face, 0, face + side * 26, 0);
  rim.addColorStop(0, `rgba(${90 + 165 * glow},${70 - 30 * glow},${40 - 30 * glow},${0.7 + 0.3 * glow})`);
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rim; c.fillRect(Math.min(face, face + side * 26), top, 26, bottom - top);
  c.fillStyle = `rgba(${200 + 55 * glow},${150 - 90 * glow},${80 - 70 * glow},${0.55 + 0.45 * glow})`;
  c.fillRect(side < 0 ? face - 2.5 : face, top, 2.5, bottom - top);
}

function drawDemon(c, x, y, s, d, side, glow) {
  c.save();
  c.translate(x, y); c.rotate(d.tilt); c.scale(-side, 1);
  const paint = (a) => `rgba(${70 + 185 * glow},${18 + 30 * glow},${12},${a})`;
  c.strokeStyle = paint(0.85); c.fillStyle = paint(0.55); c.lineWidth = 2.2; c.lineJoin = 'round';
  // head
  c.beginPath(); c.ellipse(0, 0, s * 0.42, s * 0.5, 0, 0, 7); c.fill(); c.stroke();
  // horns
  c.beginPath(); c.moveTo(-s * 0.3, -s * 0.35); c.quadraticCurveTo(-s * 0.7 * d.horn, -s * 0.9 * d.horn, -s * 0.25, -s * 1.15 * d.horn); c.lineTo(-s * 0.12, -s * 0.45); c.closePath(); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(s * 0.3, -s * 0.35); c.quadraticCurveTo(s * 0.7 * d.horn, -s * 0.9 * d.horn, s * 0.25, -s * 1.15 * d.horn); c.lineTo(s * 0.12, -s * 0.45); c.closePath(); c.fill(); c.stroke();
  // mouth
  c.beginPath(); c.moveTo(-s * 0.25, s * 0.18); c.quadraticCurveTo(0, s * (0.15 + 0.35 * d.mouth), s * 0.25, s * 0.18); c.quadraticCurveTo(0, s * 0.28, -s * 0.25, s * 0.18); c.fillStyle = 'rgba(10,0,0,.9)'; c.fill(); c.stroke();
  for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * s * 0.09, s * 0.19); c.lineTo(i * s * 0.09 + s * 0.03, s * 0.3); c.lineTo(i * s * 0.09 + s * 0.06, s * 0.19); c.fillStyle = paint(0.9); c.fill(); }
  // torso and reaching arm
  c.beginPath(); c.moveTo(-s * 0.35, s * 0.5); c.quadraticCurveTo(0, s * 0.4, s * 0.35, s * 0.5); c.lineTo(s * 0.45, s * 1.6); c.quadraticCurveTo(0, s * 1.75, -s * 0.45, s * 1.6); c.closePath(); c.fillStyle = paint(0.45); c.fill(); c.stroke();
  if (d.arms) { c.beginPath(); c.moveTo(s * 0.4, s * 0.7); c.quadraticCurveTo(s * 1.1, s * 0.5, s * 1.35, s * 1.0); c.lineWidth = 3; c.stroke();
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(s * 1.35, s * 1.0); c.lineTo(s * (1.5 + i * 0.05), s * (0.8 + i * 0.2)); c.lineWidth = 1.8; c.stroke(); } }
  // eyes (drawn again additively in the emissive pass)
  c.fillStyle = `rgba(255,${120 + 80 * glow},60,${0.5 + 0.5 * glow})`;
  c.beginPath(); c.arc(-s * 0.17, -s * 0.08, s * 0.07 * d.eyes, 0, 7); c.fill();
  c.beginPath(); c.arc(s * 0.17, -s * 0.08, s * 0.07 * d.eyes, 0, 7); c.fill();
  c.restore();
}

function drawShadow(c, x, y, w, h, a) {
  c.fillStyle = `rgba(0,0,0,${a})`;
  c.beginPath(); c.ellipse(x, y, w, h, 0, 0, 7); c.fill();
}

function drawRat(c, r, t) {
  const p = r.plugin, x = r.position.x, y = r.position.y, dir = p.dir;
  const airborne = y < FLOOR_Y - 12;
  const gy = FLOOR_Y;
  const h = clamp((gy - y - 7) / 60, 0, 1);
  drawShadow(c, x, gy + 1, 9 - 3 * h, 2.6 - h, 0.5 - 0.3 * h);
  c.save(); c.translate(x, y); c.scale(dir, 1);
  const leg = Math.sin(p.phase) * 3;
  // tail
  c.strokeStyle = '#2b2624'; c.lineWidth = 1.6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-6, 2); c.quadraticCurveTo(-13, 1 + Math.sin(t * 9 + p.tail) * 3, -19, -2 + Math.sin(t * 11 + p.tail) * 3); c.stroke();
  // legs
  c.strokeStyle = '#231e1c'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-3, 4); c.lineTo(-4 + leg, 8); c.moveTo(3, 4); c.lineTo(4 - leg, 8); c.stroke();
  // body
  c.fillStyle = '#3b3532';
  c.beginPath(); c.ellipse(0, 1, 8.5, 5.2, 0, 0, 7); c.fill();
  c.fillStyle = '#4b433f'; c.beginPath(); c.ellipse(-1, -1, 6, 3, 0, 0, 7); c.fill();
  // a bone-pale belly, lit from below by the flagstones
  c.strokeStyle = 'rgba(214,200,172,.62)'; c.lineWidth = 1.4; c.lineCap = 'round';
  c.beginPath(); c.ellipse(0.5, 1.2, 7.6, 4.6, 0, 0.35, 2.85); c.stroke();
  // head
  c.fillStyle = '#3b3532'; c.beginPath(); c.ellipse(7, -0.5, 4.2, 3.2, 0.1, 0, 7); c.fill();
  c.strokeStyle = 'rgba(214,200,172,.5)'; c.lineWidth = 1.1;
  c.beginPath(); c.ellipse(7.2, -0.3, 3.6, 2.7, 0.1, 0.5, 2.4); c.stroke();
  c.fillStyle = '#5a504b'; c.beginPath(); c.arc(4.5, -3.5, 1.9, 0, 7); c.fill();
  c.fillStyle = '#ffb090'; c.beginPath(); c.arc(8.4, -1.3, 0.9, 0, 7); c.fill(); // the eye catches the torch
  c.restore();
  void airborne;
}

function drawMan(c, t) {
  const x = man.position.x, y = man.position.y;
  const grounded = manInfo.grounded || Math.abs(man.velocity.y) < 0.3;
  const h = clamp((FLOOR_Y - man.bounds.max.y) / 90, 0, 1);
  const overPit = Math.abs(x - AW / 2) < PIT_W / 2 - 4;
  if (!overPit && man.bounds.max.y < FLOOR_Y + 30) drawShadow(c, x, FLOOR_Y + 1, 13 - 5 * h, 3.5 - 1.5 * h, 0.55 - 0.35 * h);
  const dir = manInfo.dir;
  const moving = Math.abs(man.velocity.x) > 0.6 && grounded;
  const ph = manInfo.run;
  const bob = moving ? Math.abs(Math.sin(ph)) * 1.6 : 0;
  c.save(); c.translate(x, y - bob); c.scale(dir, 1);
  const flash = manInfo.flash > 0 ? 0.6 * (manInfo.flash / 0.35) : 0;
  // legs: bare, bound at the ankle with a rope
  const la = moving ? Math.sin(ph) * 0.65 : (grounded ? 0.08 : -0.35), lb = moving ? Math.sin(ph + Math.PI) * 0.65 : (grounded ? -0.08 : 0.5);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [a, shade] of [[lb, '#6a5443'], [la, '#8a6f58']]) {
    const kx = Math.sin(a) * 9, ky = 12 + Math.cos(a) * 3, fx = kx + Math.sin(a * 1.3) * 5, fy = 21;
    c.strokeStyle = shade; c.lineWidth = 5.5;
    c.beginPath(); c.moveTo(-2, 8); c.lineTo(kx - 2, ky); c.lineTo(fx - 2, fy); c.stroke();
    c.strokeStyle = '#2a211b'; c.lineWidth = 2; c.beginPath(); c.moveTo(fx - 6, fy + 1); c.lineTo(fx + 3, fy + 1); c.stroke();
  }
  // rags: a tunic with a torn hem
  c.fillStyle = flash ? `rgb(${140 + 115 * flash},${110 - 40 * flash},${80 - 60 * flash})` : '#8c7a63';
  c.beginPath();
  c.moveTo(-9, -12); c.lineTo(9, -12); c.lineTo(12, 4);
  c.lineTo(11, 12); c.lineTo(7, 9); c.lineTo(4, 14); c.lineTo(0, 10); c.lineTo(-4, 15); c.lineTo(-8, 10); c.lineTo(-12, 13); c.lineTo(-12, 4);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(10,6,4,.7)'; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.moveTo(-9, -12); c.lineTo(-4, -12); c.lineTo(-7, 12); c.lineTo(-12, 13); c.closePath(); c.fill();
  // a trailing strip of cloth
  c.strokeStyle = '#7a6a55'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(-11, 6); c.quadraticCurveTo(-18 - Math.abs(man.velocity.x) * 2, 4 + Math.sin(t * 10) * 3, -22 - Math.abs(man.velocity.x) * 3, 12 + Math.sin(t * 7) * 3); c.stroke();
  // ropes around the chest and arms bound before him
  c.strokeStyle = '#c8a86c'; c.lineWidth = 2.2;
  c.beginPath(); c.moveTo(-11, -6); c.lineTo(11, -2); c.moveTo(-11, 0); c.lineTo(11, 4); c.stroke();
  c.strokeStyle = '#7d6a4f'; c.lineWidth = 1; c.beginPath(); c.moveTo(-11, -5); c.lineTo(11, -1); c.stroke();
  // arms: bound at the wrists, elbows out
  c.strokeStyle = '#a6876a'; c.lineWidth = 4.5;
  c.beginPath(); c.moveTo(-8, -9); c.lineTo(-13, 2); c.lineTo(-1, 8); c.stroke();
  c.beginPath(); c.moveTo(8, -9); c.lineTo(12, 2); c.lineTo(1, 8); c.stroke();
  c.fillStyle = '#b3947a'; c.beginPath(); c.arc(0, 9, 3.2, 0, 7); c.fill();
  c.strokeStyle = '#c8a86c'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-3.5, 7); c.lineTo(3.5, 7.5); c.moveTo(-3.5, 10); c.lineTo(3.5, 10.5); c.stroke();
  // head, bowed and gaunt; dark matted hair
  c.fillStyle = flash ? `rgb(${176 + 79 * flash},${138 - 40 * flash},${106 - 60 * flash})` : '#b08a6a';
  c.beginPath(); c.ellipse(1, -19, 8.2, 9.2, 0.15, 0, 7); c.fill();
  c.strokeStyle = 'rgba(10,6,4,.6)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = '#1e1613';
  c.beginPath(); c.moveTo(-7.5, -22); c.quadraticCurveTo(0, -32, 9, -22); c.quadraticCurveTo(10, -18, 8, -14); c.lineTo(6, -20); c.quadraticCurveTo(0, -25, -6, -18); c.lineTo(-8, -12); c.closePath(); c.fill();
  c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.ellipse(4, -19, 1.6, 1.1, 0.2, 0, 7); c.fill(); // the sunken eye
  c.strokeStyle = 'rgba(40,20,10,.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(3, -13); c.lineTo(6, -13.5); c.stroke();
  c.restore();
}

function drawCrescent(c, half, thick, edgeGlow) {
  // a true crescent: two arcs, honed along the lower one
  const tipY = -thick * 0.65;
  const g = c.createLinearGradient(0, -thick, 0, thick);
  g.addColorStop(0, '#2e2f33'); g.addColorStop(0.45, '#6e6f75'); g.addColorStop(0.8, '#3c3d41'); g.addColorStop(1, '#8e8f96');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-half, tipY);
  c.quadraticCurveTo(0, thick * 1.65, half, tipY);
  c.quadraticCurveTo(0, -thick * 0.35, -half, tipY);
  c.closePath(); c.fill();
  // grind marks
  c.save(); c.clip();
  c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
  for (let x = -half; x < half; x += 9) { c.beginPath(); c.moveTo(x, -thick); c.lineTo(x + 4, thick * 1.2); c.stroke(); }
  c.restore();
  // the honed edge
  c.strokeStyle = `rgba(250,244,230,${0.55 + 0.45 * edgeGlow})`; c.lineWidth = thick * 0.11;
  c.beginPath(); c.moveTo(-half, tipY); c.quadraticCurveTo(0, thick * 1.65, half, tipY); c.stroke();
  c.strokeStyle = `rgba(255,255,255,${0.35 + 0.6 * edgeGlow})`; c.lineWidth = thick * 0.04;
  c.beginPath(); c.moveTo(-half * 0.9, tipY + 2); c.quadraticCurveTo(0, thick * 1.5, half * 0.9, tipY + 2); c.stroke();
}

function drawBlade(c, t) {
  // the screw that lowers the pivot — threaded from the top of the frame, however high that is — then the rods, then the crescent
  const px = pivot.x, py = pivot.y;
  const top = Math.min(-20, worldRect().y - 10);
  c.fillStyle = '#1a1a1c'; c.fillRect(px - 7, top, 14, py - top + 8);
  c.fillStyle = '#3a3b3f'; c.fillRect(px - 4, top, 8, py - top + 8);
  c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5;
  for (let y = Math.ceil(top / 7) * 7; y < py + 4; y += 7) { c.beginPath(); c.moveTo(px - 7, y); c.lineTo(px + 7, y + 3); c.stroke(); }
  // the chain links that carry the screw, up into the dark
  c.strokeStyle = '#2a2b2e'; c.lineWidth = 3;
  for (let y = Math.ceil(top / 22) * 22; y < py - 30; y += 22) { c.beginPath(); c.ellipse(px, y, 5, 9, 0, 0, 7); c.stroke(); }
  c.strokeStyle = 'rgba(160,160,170,.35)'; c.lineWidth = 1;
  for (let y = Math.ceil(top / 22) * 22; y < py - 30; y += 22) { c.beginPath(); c.ellipse(px - 1, y - 1, 4, 8, 0, 3.6, 5.2); c.stroke(); }
  // pivot block
  c.fillStyle = IRON; c.fillRect(px - 16, py - 12, 32, 20);
  c.fillStyle = '#26272a'; c.beginPath(); c.arc(px, py, 6, 0, 7); c.fill();
  c.fillStyle = '#8e8f96'; c.beginPath(); c.arc(px - 2, py - 2, 2.2, 0, 7); c.fill();
  // rods (drawn from the two real constraint points)
  const bx = blade.position.x, by = blade.position.y, a = blade.angle;
  const cs = Math.cos(a), sn = Math.sin(a);
  for (const off of [-40, 40]) {
    const qx = bx + off * cs, qy = by + off * sn;
    c.strokeStyle = '#141416'; c.lineWidth = 5; c.beginPath(); c.moveTo(px, py); c.lineTo(qx, qy); c.stroke();
    c.strokeStyle = '#55565c'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(px, py); c.lineTo(qx, qy); c.stroke();
  }
  c.strokeStyle = '#2a2b2e'; c.lineWidth = 9; c.beginPath(); c.moveTo(px, py); c.lineTo(bx, by); c.stroke();
  c.strokeStyle = '#6a6b71'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(px, py); c.lineTo(bx, by); c.stroke();
  // yoke
  c.save(); c.translate(bx, by); c.rotate(a);
  c.fillStyle = '#26272a'; c.fillRect(-44, -8, 88, 10);
  c.fillStyle = '#6a6b71'; for (const o of [-40, -20, 0, 20, 40]) { c.beginPath(); c.arc(o, -3, 2.2, 0, 7); c.fill(); }
  // the crescent glints when its edge faces the torch
  const glint = clamp(0.4 + 0.6 * Math.cos(a * 2 + t * 0.7), 0, 1);
  drawCrescent(c, BLADE_HALF, 22, glint);
  c.restore();
}

function drawLighting(c, t, opts = {}) {
  const rect = worldRect();
  const tp = opts.torch || torchPos();
  const fl = reduced ? 0.95 : flicker(t);
  const dim = opts.dim == null ? 1 : opts.dim;
  const jx = reduced ? 0 : Math.sin(t * 5.1) * 3, jy = reduced ? 0 : Math.cos(t * 3.7) * 2;
  // darkness falling off from the torch
  const R = (opts.radius || 1250) * fl;
  const dark = c.createRadialGradient(tp.x + jx, tp.y + jy, 20, tp.x + jx, tp.y + jy, R);
  dark.addColorStop(0, `rgba(0,0,0,${0.02 * dim})`);
  dark.addColorStop(0.25, `rgba(0,0,0,${lerp(0.9, 0.3, dim)})`);
  dark.addColorStop(0.6, `rgba(0,0,0,${lerp(0.97, 0.58, dim)})`);
  dark.addColorStop(1, `rgba(0,0,0,${lerp(1, 0.8, dim)})`);
  c.fillStyle = dark; c.fillRect(rect.x, rect.y, rect.w, rect.h);
  // the torch's warmth, additive
  c.globalCompositeOperation = 'lighter';
  const warm = c.createRadialGradient(tp.x + jx, tp.y + jy, 6, tp.x + jx, tp.y + jy, R * 0.7);
  warm.addColorStop(0, `rgba(255,140,50,${0.5 * fl * dim})`);
  warm.addColorStop(0.18, `rgba(196,86,28,${0.26 * fl * dim})`);
  warm.addColorStop(0.55, `rgba(120,50,16,${0.1 * fl * dim})`);
  warm.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = warm; c.fillRect(rect.x, rect.y, rect.w, rect.h);
  // hot walls throw ember light onto the floor
  if (!opts.noWalls && !lowFx) {
    const glow = clamp(wall.heat * 0.9 + wall.surge * 0.6, 0, 1) * dim;
    if (glow > 0.02) for (const side of [-1, 1]) {
      const face = AW / 2 + side * wall.half;
      const wg = c.createRadialGradient(face, 340, 4, face, 340, 260);
      wg.addColorStop(0, `rgba(255,50,20,${0.28 * glow})`); wg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = wg; c.fillRect(face - 260, 60, 520, 500);
    }
  }
  // the flagstones nearest a white-hot wall glow: that strip sears him without a touch
  if (!opts.noWalls) {
    const sear = searReach() * dim;
    if (sear > 0.5) for (const side of [-1, 1]) {
      const face = AW / 2 + side * wall.half;
      const pulse = 0.7 + 0.3 * Math.sin(t * 6 + side);
      const sg = c.createLinearGradient(face, 0, face - side * (sear + 10), 0);
      sg.addColorStop(0, `rgba(255,90,30,${0.55 * pulse})`); sg.addColorStop(0.6, `rgba(255,50,20,${0.22 * pulse})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = sg; c.fillRect(Math.min(face, face - side * (sear + 10)), FLOOR_Y - 2, sear + 10, 24);
    }
  }
  c.globalCompositeOperation = 'source-over';
}

function drawTorch(c, t, tp, scale = 1) {
  const fl = reduced ? 0.95 : flicker(t);
  c.save(); c.translate(tp.x, tp.y); c.scale(scale, scale);
  // bracket
  c.strokeStyle = '#1c1c1e'; c.lineWidth = 6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-26, 30); c.lineTo(0, 14); c.stroke();
  c.fillStyle = '#2a2a2d'; c.fillRect(-5, 8, 10, 30);
  c.fillStyle = '#3d3a36'; c.beginPath(); c.moveTo(-9, 10); c.lineTo(9, 10); c.lineTo(6, 22); c.lineTo(-6, 22); c.closePath(); c.fill();
  // flame (additive)
  c.globalCompositeOperation = 'lighter';
  const wob = reduced ? 0 : Math.sin(t * 9.1) * 3;
  const fg = c.createRadialGradient(wob * 0.3, -6, 1, wob * 0.3, -6, 26 * fl);
  fg.addColorStop(0, 'rgba(255,240,200,.95)'); fg.addColorStop(0.3, 'rgba(255,170,60,.8)'); fg.addColorStop(0.7, 'rgba(196,70,20,.35)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = fg;
  c.beginPath(); c.moveTo(-9, 10); c.quadraticCurveTo(-12 + wob, -10, wob * 1.5, -26 * fl); c.quadraticCurveTo(12 + wob, -10, 9, 10); c.closePath(); c.fill();
  c.beginPath(); c.arc(wob * 0.3, -4, 30 * fl, 0, 7); c.fill();
  c.globalCompositeOperation = 'source-over';
  c.restore();
}

function drawEmissives(c, t) {
  c.globalCompositeOperation = 'lighter';
  // demon eyes burn through the dark
  const glow = clamp(wall.heat * 0.9 + wall.surge * 0.6, 0, 1);
  if (glow > 0.03) for (const side of [-1, 1]) {
    const face = AW / 2 + side * wall.half;
    for (const d of DEMONS[side < 0 ? 0 : 1]) {
      const x = face + side * (48 + d.size * 0.4);
      const eg = c.createRadialGradient(x, d.y, 1, x, d.y, d.size * 1.6);
      eg.addColorStop(0, `rgba(255,60,20,${0.35 * glow})`); eg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = eg; c.fillRect(x - d.size * 2, d.y - d.size * 2, d.size * 4, d.size * 4);
    }
  }
  // embers
  for (const e of embers) {
    c.fillStyle = e.soft ? `rgba(255,150,60,${0.6 * clamp(e.life, 0, 1)})` : `rgba(255,90,30,${0.9 * clamp(e.life, 0, 1)})`;
    c.beginPath(); c.arc(e.x, e.y, e.r, 0, 7); c.fill();
  }
  // the blade's edge catches the torch
  if (!bladeInfo.freeze) {
    const speed = clamp(bladeInfo.speed / 600, 0, 1);
    c.save(); c.translate(blade.position.x, blade.position.y); c.rotate(blade.angle);
    c.strokeStyle = `rgba(255,220,170,${0.12 + 0.25 * speed})`; c.lineWidth = 6;
    c.beginPath(); c.moveTo(-BLADE_HALF, -14); c.quadraticCurveTo(0, 36, BLADE_HALF, -14); c.stroke();
    c.restore();
  }
  c.globalCompositeOperation = 'source-over';
}

function drawVignette(c) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.62)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}

let grainCv = null;
function drawGrain(c) {
  if (reduced || isMobile || lowFx) return;
  if (!grainCv) {
    grainCv = document.createElement('canvas'); grainCv.width = grainCv.height = 256;
    const g = grainCv.getContext('2d'); const id = g.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (Math.random() - .5) * 90; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    g.putImageData(id, 0, 0);
  }
  c.save(); c.globalAlpha = 0.045; c.globalCompositeOperation = 'overlay';
  const ox = (Math.random() * 256) | 0, oy = (Math.random() * 256) | 0;
  c.translate(-ox, -oy);
  c.fillStyle = c.createPattern(grainCv, 'repeat'); c.fillRect(ox, oy, W, H);
  c.restore();
}

function drawFloaties(c) {
  for (const f of floaties) {
    const a = clamp(f.life / 0.5, 0, 1);
    c.fillStyle = f.color; c.globalAlpha = a;
    c.font = `${f.italic ? 'italic ' : ''}${f.big ? 22 : 16}px 'Old Standard TT', serif`;
    c.textAlign = 'center';
    c.shadowColor = '#000'; c.shadowBlur = 6;
    c.fillText(f.text, f.x, f.y);
    c.shadowBlur = 0; c.globalAlpha = 1;
  }
}

function drawRescue(c) {
  const r = manInfo.rescue; if (!r || r.phase === 0) return;
  // a shaft of daylight, then the arm of Lasalle
  const cx = AW / 2;
  c.globalCompositeOperation = 'lighter';
  const sh = c.createLinearGradient(0, -100, 0, FLOOR_Y);
  sh.addColorStop(0, `rgba(200,220,255,${0.32 * r.light})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sh; c.beginPath(); c.moveTo(cx - 140, -120); c.lineTo(cx + 140, -120); c.lineTo(cx + 260, FLOOR_Y); c.lineTo(cx - 260, FLOOR_Y); c.closePath(); c.fill();
  c.globalCompositeOperation = 'source-over';
  const ax = r.armX, ay = r.armY;
  c.save();
  // sleeve: a soldier's coat, dark with a bright cuff
  c.strokeStyle = '#1d2233'; c.lineWidth = 22; c.lineCap = 'round';
  c.beginPath(); c.moveTo(ax - 40, ay - 400); c.quadraticCurveTo(ax - 20, ay - 120, ax, ay - 8); c.stroke();
  c.strokeStyle = '#d9c9a0'; c.lineWidth = 24; c.beginPath(); c.moveTo(ax - 3, ay - 30); c.lineTo(ax, ay - 14); c.stroke();
  c.strokeStyle = '#8a6f2e'; c.lineWidth = 3; c.beginPath(); c.moveTo(ax - 14, ay - 22); c.lineTo(ax + 9, ay - 24); c.stroke();
  // the hand, gripping his wrist
  c.fillStyle = '#d6b28f';
  c.beginPath(); c.ellipse(ax, ay - 2, 9, 11, 0.1, 0, 7); c.fill();
  c.strokeStyle = '#d6b28f'; c.lineWidth = 4.5;
  for (let i = -1; i <= 2; i++) { c.beginPath(); c.moveTo(ax - 6 + i * 4, ay + 4); c.lineTo(ax - 7 + i * 4.5, ay + 14); c.stroke(); }
  c.restore();
}

/* ---- the title poster: the crescent filling the top of the frame, the tiny prisoner at the lip of the pit */
function drawTitle(t) {
  const c = ctx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = '#060505'; c.fillRect(0, 0, W, H);
  const portrait = W < H;
  // choose a world scale so the arena fills the width; the arena's floor sits low in the frame
  const s = W / (portrait ? 640 : 1100);
  const AWp = W / s;
  const floorY = H / s * (portrait ? 0.465 : 0.50);
  c.setTransform(DPR * s, 0, 0, DPR * s, 0, 0);
  const cx = AWp / 2;
  // back wall + floor + pit in poster space (temporarily lend the arena constants)
  const saveAW = AW, saveHalf = wall.half, saveHeat = wall.heat, saveSurge = wall.surge;
  AW = AWp; wall.half = AWp / 2 - 60; wall.heat = 0.35 + 0.1 * Math.sin(t * 0.8); wall.surge = 0;
  view.s = s; view.ox = 0; view.oy = 0;
  c.fillStyle = '#17120f'; c.fillRect(0, 0, AWp, H / s);
  seedN = 5;
  for (let y = -10; y < floorY; y += 44) for (let x = -60 + (((y / 44) | 0) % 2 ? 60 : 0); x < AWp + 120; x += 120) {
    const g = 22 + srand() * 12; c.fillStyle = `rgb(${g + 6},${g},${g - 4})`; c.beginPath(); c.roundRect(x + 2, y + 2, 112 + srand() * 6, 40, 3); c.fill();
    c.fillStyle = 'rgba(255,220,180,.05)'; c.fillRect(x + 4, y + 3, 108, 2);
  }
  // floor and pit
  const FY = FLOOR_Y; // draw helpers use FLOOR_Y; translate so the poster floor lands at floorY
  c.save(); c.translate(0, floorY - FY);
  const rr = { x: 0, y: FY - floorY, w: AWp, h: H / s };
  drawFloorAt(c, rr);
  // walls, a little way in
  drawWallAt(c, -1, t, rr); drawWallAt(c, 1, t, rr);
  // the tiny prisoner at the lip of the pit, and the rats that keep him company
  const mx = cx - PIT_W / 2 - 16;
  drawShadow(c, mx, FY + 1, 13, 3.5, 0.55);
  drawManAt(c, t, mx, FY - 21, 1);
  for (const [rx, dir, ph] of [[cx + PIT_W / 2 + 30, -1, 0], [cx + PIT_W / 2 + 62, -1, 2], [mx - 70, 1, 4], [mx - 118, 1, 1]]) {
    drawRat(c, { position: { x: rx, y: FY - 8 }, velocity: { x: 0, y: 0 }, plugin: { dir, phase: ph, tail: ph } }, t);
  }
  // the pit breathes
  c.globalCompositeOperation = 'lighter';
  const pb = c.createRadialGradient(cx, FY + 40, 4, cx, FY + 40, 150);
  const pulse = 0.55 + 0.25 * Math.sin(t * 0.9);
  pb.addColorStop(0, `rgba(200,60,20,${0.16 * pulse})`); pb.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = pb; c.fillRect(cx - 160, FY - 10, 320, 300);
  c.globalCompositeOperation = 'source-over';
  c.restore();
  // the great crescent across the top, hung from far above
  const half = AWp * 0.56, thick = half * 0.16;
  const by = (portrait ? 0.20 : 0.235) * (H / s);
  const swing = reduced ? 0 : Math.sin(t * 0.55) * 0.045;
  c.save(); c.translate(cx, by); c.rotate(swing);
  c.strokeStyle = '#141416'; c.lineWidth = 10; c.beginPath(); c.moveTo(0, -2000); c.lineTo(0, 0); c.stroke();
  c.strokeStyle = '#55565c'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, -2000); c.lineTo(0, 0); c.stroke();
  for (const off of [-half * 0.35, half * 0.35]) { c.strokeStyle = '#1a1a1c'; c.lineWidth = 6; c.beginPath(); c.moveTo(0, -2000); c.lineTo(off, -thick * 0.3); c.stroke(); }
  c.fillStyle = '#26272a'; c.fillRect(-half * 0.38, -thick * 0.6, half * 0.76, thick * 0.4);
  drawCrescent(c, half, thick, 0.8 + 0.2 * Math.sin(t * 1.3));
  c.restore();
  // lighting: the torch high on the left wall
  const tp = { x: AWp * 0.11, y: (H / s) * (portrait ? 0.31 : 0.30) };
  drawLighting(c, t, { torch: tp, radius: AWp * 0.95, noWalls: false });
  // the blade's edge catches the light: an additive sweep along the edge
  c.save(); c.translate(cx, by); c.rotate(swing);
  c.globalCompositeOperation = 'lighter';
  const eg = c.createLinearGradient(-half, 0, half, 0);
  eg.addColorStop(0, 'rgba(255,200,140,.55)'); eg.addColorStop(0.35, 'rgba(255,230,200,.9)'); eg.addColorStop(1, 'rgba(255,200,140,.08)');
  c.strokeStyle = eg; c.lineWidth = thick * 0.16;
  c.beginPath(); c.moveTo(-half, -thick * 0.65); c.quadraticCurveTo(0, thick * 1.65, half, -thick * 0.65); c.stroke();
  c.globalCompositeOperation = 'source-over';
  c.restore();
  drawTorch(c, t, tp, 1.2);
  for (const e of embers) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,150,60,${0.6 * clamp(e.life, 0, 1)})`; c.beginPath(); c.arc(e.x, e.y, e.r, 0, 7); c.fill(); }
  c.globalCompositeOperation = 'source-over';
  if (!reduced && Math.random() < 0.15) embers.push({ x: tp.x + (Math.random() - .5) * 12, y: tp.y - 10, vx: (Math.random() - .3) * 0.5, vy: -0.5 - Math.random(), life: 1.5 + Math.random() * 2, r: 1 + Math.random() * 1.4, soft: true });
  for (let i = embers.length - 1; i >= 0; i--) { const e = embers[i]; e.x += e.vx; e.y += e.vy; e.life -= 1 / 60; if (e.life <= 0) embers.splice(i, 1); }
  AW = saveAW; wall.half = saveHalf; wall.heat = saveHeat; wall.surge = saveSurge;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawVignette(c); drawGrain(c);
}

// poster-space variants that take an explicit rect instead of the live camera
function drawFloorAt(c, rect) { worldRectOverride = rect; drawFloor(c); worldRectOverride = null; }
function drawWallAt(c, side, t, rect) { worldRectOverride = rect; drawWall(c, side, t); worldRectOverride = null; }
function drawManAt(c, t, x, y, dir) {
  const savePos = man;
  man = { position: { x, y }, velocity: { x: 0, y: 0 }, bounds: { min: { y: y - 27 }, max: { y: y + 21 } } };
  const saveInfo = manInfo; manInfo = { ...manInfo, dir, grounded: true, run: 0, flash: 0 };
  drawMan(c, t);
  man = savePos; manInfo = saveInfo;
}

function render(t) {
  if (state === 'title') { drawTitle(t); return; }
  const c = ctx;
  layout();
  const s = view.s;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);

  if (state === 'sliced' && bladeInfo.freeze) {
    // the freeze-frame: black, and only the edge of the blade
    c.setTransform(DPR * s, 0, 0, DPR * s, DPR * view.ox, DPR * view.oy);
    const fade = clamp((deathT - 0.1) / 0.3, 0, 1);
    if (fade < 1) { c.globalAlpha = 1 - fade; drawScene(c, t); c.globalAlpha = 1; }
    c.save(); c.translate(blade.position.x, blade.position.y); c.rotate(blade.angle);
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = `rgba(255,250,240,${0.9})`; c.lineWidth = 3.2;
    c.shadowColor = 'rgba(255,240,220,.9)'; c.shadowBlur = 24;
    c.beginPath(); c.moveTo(-BLADE_HALF, -14); c.quadraticCurveTo(0, 36, BLADE_HALF, -14); c.stroke();
    c.shadowBlur = 0; c.restore();
    c.globalCompositeOperation = 'source-over';
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    return;
  }

  // the pit: follow him down for a moment, then the view turns and looks back up the shaft
  const shaft = state === 'fell' ? clamp((deathT - 0.9) / 0.8, 0, 1) : 0;
  if (shaft < 1) {
    c.setTransform(DPR * s, 0, 0, DPR * s, DPR * view.ox, DPR * view.oy);
    drawScene(c, t);
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  if (shaft > 0) { c.globalAlpha = shaft; drawShaft(c, t); c.globalAlpha = 1; }
  drawVignette(c);
  drawGrain(c);
}

/* ---- the Fallen card: from the bottom of the pit, a dim column of brick receding to the lit mouth of the cell */
function drawShaft(c, t) {
  const vx = W / 2, vy = H * 0.36;
  // the mouth shrinks as he falls, then hangs there, far above (behind the card's title)
  const fall = smooth(clamp((deathT - 0.9) / 3.2, 0, 1));
  const sway = reduced ? 0 : Math.sin(t * 0.7) * 3;
  const mw = Math.min(W, H) * lerp(0.46, 0.11, fall), mh = mw * 0.62;
  const N = 15, g = 1.2;
  c.fillStyle = '#050403'; c.fillRect(0, 0, W, H);
  // rings of brick, nearest (largest, darkest) first
  const rings = [];
  for (let i = N; i >= 1; i--) rings.push({ i, w: mw * g ** i, h: mh * g ** i });
  for (const r of rings) {
    const k = 1 - r.i / N;                                      // 1 near the mouth, 0 near the eye
    const lum = 8 + 78 * k * k;
    c.fillStyle = `rgb(${lum + 8 + 20 * k},${lum},${lum - 5 + 2 * k})`;
    c.fillRect(vx - r.w / 2 + sway * (1 - k), vy - r.h / 2, r.w, r.h);
  }
  // mortar: the ring edges, and joints radiating from the mouth's corners and faces
  c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1.5;
  for (const r of rings) { const k = 1 - r.i / N; c.strokeRect(vx - r.w / 2 + sway * (1 - k), vy - r.h / 2, r.w, r.h); }
  c.lineWidth = 1.2;
  const far = rings[0], near = rings[rings.length - 1];
  const joint = (u, v) => { // from a point on the mouth's edge (u,v in [-1,1]) outward to the frame
    c.beginPath(); c.moveTo(vx + u * near.w / 2 + sway, vy + v * near.h / 2); c.lineTo(vx + u * far.w / 2, vy + v * far.h / 2); c.stroke();
  };
  for (const u of [-1, -0.5, 0, 0.5, 1]) { joint(u, -1); joint(u, 1); }
  for (const v of [-1, -0.45, 0.1, 0.65, 1]) { joint(-1, v); joint(1, v); }
  // staggered half-bricks: short joints between alternate rings
  c.strokeStyle = 'rgba(0,0,0,.4)';
  for (let j = 0; j < rings.length - 1; j += 2) {
    const a = rings[j], b = rings[j + 1];
    for (const u of [-0.75, -0.25, 0.25, 0.75]) {
      c.beginPath(); c.moveTo(vx + u * a.w / 2, vy - a.h / 2); c.lineTo(vx + u * b.w / 2, vy - b.h / 2); c.stroke();
      c.beginPath(); c.moveTo(vx + u * a.w / 2, vy + a.h / 2); c.lineTo(vx + u * b.w / 2, vy + b.h / 2); c.stroke();
    }
    for (const v of [-0.7, -0.2, 0.35, 0.85]) {
      c.beginPath(); c.moveTo(vx - a.w / 2, vy + v * a.h / 2); c.lineTo(vx - b.w / 2, vy + v * b.h / 2); c.stroke();
      c.beginPath(); c.moveTo(vx + a.w / 2, vy + v * a.h / 2); c.lineTo(vx + b.w / 2, vy + v * b.h / 2); c.stroke();
    }
  }
  // the lit mouth of the cell: torch-warm brick, the hot walls at its sides, the crescent hanging across it
  const mx = vx - mw / 2 + sway, my = vy - mh / 2;
  const fl = reduced ? 0.95 : flicker(t);
  const cell = c.createLinearGradient(mx, my, mx + mw, my);
  cell.addColorStop(0, `rgb(${150 * fl | 0},${70 * fl | 0},${30 * fl | 0})`);
  cell.addColorStop(0.35, `rgb(${105 * fl | 0},${62 * fl | 0},${40 * fl | 0})`);
  cell.addColorStop(1, `rgb(${52 * fl | 0},${38 * fl | 0},${30 * fl | 0})`);
  c.fillStyle = cell; c.fillRect(mx, my, mw, mh);
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1;
  for (let y = my + mh * 0.18; y < my + mh; y += mh * 0.18) { c.beginPath(); c.moveTo(mx, y); c.lineTo(mx + mw, y); c.stroke(); }
  const ember = 0.6 + 0.4 * Math.sin(t * 2.1);
  c.fillStyle = `rgba(255,60,20,${0.55 * ember})`; c.fillRect(mx, my, mw * 0.06, mh); c.fillRect(mx + mw * 0.94, my, mw * 0.06, mh);
  c.save(); c.beginPath(); c.rect(mx, my, mw, mh); c.clip();
  c.translate(mx + mw / 2, my + mh * 0.42); c.rotate(reduced ? 0 : Math.sin(t * 0.55) * 0.12);
  c.fillStyle = '#141416';
  c.beginPath(); c.moveTo(-mw * 0.46, -mh * 0.05); c.quadraticCurveTo(0, mh * 0.42, mw * 0.46, -mh * 0.05); c.quadraticCurveTo(0, mh * 0.16, -mw * 0.46, -mh * 0.05); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,246,230,.85)'; c.lineWidth = Math.max(1, mw * 0.012);
  c.beginPath(); c.moveTo(-mw * 0.46, -mh * 0.05); c.quadraticCurveTo(0, mh * 0.42, mw * 0.46, -mh * 0.05); c.stroke();
  c.restore();
  // the light spills a little way down the shaft
  c.globalCompositeOperation = 'lighter';
  const spill = c.createRadialGradient(vx + sway, vy, mw * 0.3, vx + sway, vy, mw * 2.2);
  spill.addColorStop(0, `rgba(196,86,28,${0.28 * fl})`); spill.addColorStop(0.4, `rgba(120,50,16,${0.12 * fl})`); spill.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = spill; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';
  // the dark closes in from the edges
  const edge = c.createRadialGradient(vx, vy, Math.min(W, H) * 0.25, vx, vy, Math.max(W, H) * 0.75);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,.85)');
  c.fillStyle = edge; c.fillRect(0, 0, W, H);
}

function drawScene(c, t) {
  const rect = worldRect();
  // backdrop
  if (!bgCache || bgCache.rect.w !== rect.w) bgCache = stoneBackdrop();
  c.drawImage(bgCache.cv, bgCache.rect.x, bgCache.rect.y, bgCache.rect.w, bgCache.rect.h);
  drawFloor(c);
  drawWall(c, -1, t); drawWall(c, 1, t);
  drawTorch(c, t, torchPos());
  for (const r of rats) drawRat(c, r, t);
  if (!(state === 'fell' && man.position.y > AH + 200)) drawMan(c, t);
  drawBlade(c, t);
  drawLighting(c, t, { dim: state === 'fell' ? clamp(1 - deathT / 2.6, 0.3, 1) : 1 });
  drawEmissives(c, t);
  drawRescue(c);
  drawFloaties(c);
}

/* ------------------------------------------------------------------ loop */

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastFrame) lastFrame = now;
  let dt = (now - lastFrame) / 1000; lastFrame = now;
  if (dt > 0.1) dt = 0.1;
  const t = now / 1000;
  if (state !== 'title' && document.visibilityState === 'visible') {
    avgDt = lerp(avgDt, Math.min(dt, 0.1), 0.06);
    if (++fxFrames > 90 && avgDt > 0.0215 && !lowFx) lowFx = true;
  }
  const t0 = performance.now();
  if (state !== 'title') {
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 4) { step(1 / 60); acc -= 1 / 60; n++; }
    if (n === 4) acc = 0;
  }
  const t1 = performance.now();
  render(t);
  perf.step += t1 - t0; perf.render += performance.now() - t1; perf.frames++;
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  try {
    await Promise.all(["48px 'UnifrakturMaguntia'", "20px 'Old Standard TT'", "italic 20px 'Old Standard TT'", "30px 'Pirata One'"].map((f) => document.fonts.load(f)));
  } catch {}
  refreshBest();
  requestAnimationFrame(frame);
}
boot();

/* ------------------------------------------------------------------ debug hook for playtests */

window.__poe = {
  get state() { return state; },
  get time() { return time; },
  get score() { return score; },
  get stats() { return stats; },
  get man() { return man ? { x: man.position.x, y: man.position.y, vx: man.velocity.x, vy: man.velocity.y, mass: man.mass } : null; },
  get blade() { return blade ? { x: blade.position.x, y: blade.position.y, vx: blade.velocity.x, vy: blade.velocity.y, angle: blade.angle, th: bladeInfo.th, pivotY: pivot.y, speed: bladeInfo.speed, reach: bladeInfo.reach || 0, edgeY: blade.bounds.max.y, clearance: man ? bladeClearance() : null, rod: Math.hypot(blade.position.x - pivot.x, blade.position.y - pivot.y) } : null; },
  // the crescent's plates in its own frame (relative to its centre of mass, at angle 0), for bots that predict passes
  get bladeShape() {
    if (!blade) return null;
    const a = -blade.angle, ca = Math.cos(a), sa = Math.sin(a), { x, y } = blade.position;
    return blade.parts.slice(1).map((p) => p.vertices.map((v) => ({ x: (v.x - x) * ca - (v.y - y) * sa, y: (v.x - x) * sa + (v.y - y) * ca })));
  },
  get walls() { return { half: wall.half, heat: wall.heat, surge: wall.surge }; },
  get rats() { return rats.map((r) => ({ x: r.position.x, y: r.position.y, dir: r.plugin.dir })); },
  get AW() { return AW; }, FLOOR_Y, PIT_W, T_WIN,
  perf, get lowFx() { return lowFx; }, setLowFx(v) { lowFx = !!v; },
  start: startGame,
  title: toTitle,
  setInvincible(v) { debugInvincible = !!v; },
  fastForward(sec) {
    // advance the clock (walls, schedule) without simulating; the blade sinks to where it would be
    if (state !== 'playing') return;
    time = Math.min(T_WIN - 0.01, time + sec);
    const passes = Math.floor(sec / 1.34);
    pivot.y = Math.min(PIVOT_MAX, pivot.y + passes * NOTCH);
    for (const r of rods) r.pointA.y = pivot.y;
  },
  input,
};
