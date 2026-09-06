/* Seven Chambers — The Masque of the Red Death
 * three.js r160, first person, endless enfilade of Poe's seven chambers.
 * Palette anchors: velvet #07040a, scarlet #ff1f1f. Everything else is one hue per room. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mountBack, saveState, loadState, prefersReducedMotion } from '/shared/poe.js';
import { makeAudio } from './audio.js';

mountBack();

/* ------------------------------------------------------------------ device */
const REDUCED = prefersReducedMotion();
const COARSE = matchMedia('(pointer: coarse)').matches;
const PHONE = Math.min(innerWidth, innerHeight) < 720;
const PORTRAIT = innerHeight > innerWidth;
const NARROW = PHONE && PORTRAIT;
const DPR = PHONE ? 1 : Math.min(devicePixelRatio || 1, 2);

/* ------------------------------------------------------------------ world */
const W = NARROW ? 7 : 10;       // corridor width
const HALF = W / 2;
const H = 8;                     // vault height
const L = 30;                    // chamber length
const DOOR_W = NARROW ? 3.4 : 4.4;
const DOOR_H = 6.2;
const EYE = 1.7;
const XLIM = HALF - 0.7;
const ROOMS = 7;
const STRIKES_TO_WIN = 12;
const FIRST_STRIKE = 8;          // seconds of play before the first stroke is due
const STRIKE_INTERVAL = 13;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

const CHAMBERS = [
  { name: 'Blue',   hue: 0x2c6cff, css: '#5b8cff', glow: 1.5,  fog: 0.9 },
  { name: 'Purple', hue: 0xb92de6, css: '#cf63f5', glow: 1.35, fog: 0.7 },
  { name: 'Green',  hue: 0x26d468, css: '#55e68c', glow: 0.95, fog: 0.42 },
  { name: 'Orange', hue: 0xff7d1a, css: '#ffa054', glow: 1.0,  fog: 0.42 },
  { name: 'White',  hue: 0xf4ecd8, css: '#f8f2e4', glow: 0.8,  fog: 0.36, white: true },
  { name: 'Violet', hue: 0x7d47ff, css: '#a381ff', glow: 1.4,  fog: 0.8 },
  { name: 'Black',  hue: 0xff1f1f, css: '#ff4a4a', glow: 1.15, fog: 0.1, black: true },
];
const SCARLET = new THREE.Color(0xff1f1f);
const DREAD = new THREE.Color(0x2a0206);

/* ------------------------------------------------------------------ dom */
const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const ui = { title: $('title'), hud: $('hud'), end: $('end'), how: $('how'), best: $('best'), start: $('start'), again: $('again'),
  chamber: $('chamberName'), grace: $('graceBar'), graceWrap: $('graceBar').parentElement, score: $('score'), streak: $('streak'),
  strikeNum: $('strikeNum'), chimes: $('chimes'), chimeLine: $('chimeLine'), dots: $('dots'), vignette: $('vignette'), flash: $('flash'),
  floats: $('floats'), endKicker: $('endKicker'), endTitle: $('endTitle'), endQuote: $('endQuote'), endScore: $('endScore') };

ui.how.innerHTML = COARSE
  ? 'Hold the <b>left</b> or <b>right</b> of the screen to sidestep, <b>double-tap</b> to dash. When the clock strikes, slip past him and reach the next door before the last chime.'
  : '<b>&larr; &rarr;</b> sidestep &middot; <b>W</b> hurry, <b>S</b> hang back &middot; <b>space</b> dash. When the clock strikes, slip past him and reach the next door before the last chime.';

function fmt(n) { return n.toLocaleString('en-US'); }
function showBest() {
  const b = loadState('masque-red-death:best', null);
  ui.best.textContent = b && b.score > 0
    ? `Best ${fmt(b.score)} · ${ROMAN[Math.min(b.strikes, 12) - 1] || 'no'} stroke${b.strikes === 1 ? '' : 's'} survived · ${b.chambers} chambers`
    : 'No one has yet outrun the clock';
}
showBest();

/* ------------------------------------------------------------------ textures (all generated) */
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso || 1;
  if (opts.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function archPath2D(g, l, r, top, bottom) {
  const w = r - l, sy = top + w * 0.866;
  g.beginPath();
  g.moveTo(l, bottom); g.lineTo(l, sy);
  g.arc(r, sy, w, Math.PI, Math.PI * 4 / 3, false);
  g.arc(l, sy, w, Math.PI * 5 / 3, Math.PI * 2, false);
  g.lineTo(r, bottom); g.closePath();
  return sy;
}
const glassTex = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const inset = 18;
  const sy = archPath2D(g, inset, w - inset, inset, h - inset);
  g.save(); g.clip();
  // panes: a diamond lattice, each pane its own brightness
  const S = 34;
  for (let j = -1; j < h / (S / 2) + 2; j++) for (let i = -1; i < w / S + 2; i++) {
    const cx = i * S + (j % 2 ? S / 2 : 0), cy = j * (S / 2);
    const b = 0.62 + Math.random() * 0.38 - (cy / h) * 0.12;
    const v = Math.round(255 * Math.min(1, b));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.moveTo(cx, cy - S / 2); g.lineTo(cx + S / 2, cy); g.lineTo(cx, cy + S / 2); g.lineTo(cx - S / 2, cy); g.closePath(); g.fill();
    g.strokeStyle = '#050505'; g.lineWidth = 2.6; g.stroke();
  }
  // tracery above the springing line
  const rcx = w / 2, rcy = sy - (sy - inset) * 0.38, rr = (w - inset * 2) * 0.24;
  g.strokeStyle = '#000'; g.lineWidth = 5;
  g.beginPath(); g.arc(rcx, rcy, rr, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(rcx, rcy, rr * 0.42, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.beginPath(); g.moveTo(rcx + Math.cos(a) * rr * 0.42, rcy + Math.sin(a) * rr * 0.42); g.lineTo(rcx + Math.cos(a) * rr, rcy + Math.sin(a) * rr); g.stroke(); }
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; g.beginPath(); g.arc(rcx + Math.cos(a) * rr * 0.72, rcy + Math.sin(a) * rr * 0.72, rr * 0.3, 0, Math.PI * 2); g.stroke(); }
  // mullion & transom
  g.fillStyle = '#000';
  g.fillRect(w / 2 - 4, sy - 2, 8, h);
  g.fillRect(0, sy - 3, w, 7);
  g.fillRect(0, sy + (h - inset - sy) * 0.55, w, 5);
  g.restore();
  // frame
  archPath2D(g, inset, w - inset, inset, h - inset);
  g.strokeStyle = '#000'; g.lineWidth = 12; g.stroke();
});
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(0.6, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const faceTex = canvasTex(128, 160, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  // corpse-pale mask
  g.fillStyle = '#d9d2bd';
  g.beginPath(); g.ellipse(w / 2, h * 0.5, w * 0.36, h * 0.44, 0, 0, Math.PI * 2); g.fill();
  const sh = g.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.5, w * 0.42);
  sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(1, 'rgba(60,50,40,0.55)');
  g.fillStyle = sh; g.beginPath(); g.ellipse(w / 2, h * 0.5, w * 0.36, h * 0.44, 0, 0, Math.PI * 2); g.fill();
  // sunken eyes
  g.fillStyle = '#120608';
  g.beginPath(); g.ellipse(w * 0.36, h * 0.42, 11, 8, -0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(w * 0.64, h * 0.42, 11, 8, 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2a0a0e';
  g.beginPath(); g.ellipse(w * 0.5, h * 0.58, 4, 7, 0, 0, Math.PI * 2); g.fill();
  // rictus
  g.strokeStyle = '#1a0608'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(w * 0.36, h * 0.72); g.quadraticCurveTo(w * 0.5, h * 0.8, w * 0.64, h * 0.72); g.stroke();
  for (let i = 0; i < 6; i++) { const x = w * 0.38 + i * (w * 0.26 / 5); g.beginPath(); g.moveTo(x, h * 0.71); g.lineTo(x, h * 0.78); g.stroke(); }
  // dabbled in blood
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${170 + Math.random() * 85 | 0},${Math.random() * 20 | 0},${Math.random() * 25 | 0},${0.5 + Math.random() * 0.5})`;
    const x = w * 0.2 + Math.random() * w * 0.6, y = h * 0.1 + Math.random() * h * 0.8;
    g.beginPath(); g.ellipse(x, y, 1.5 + Math.random() * 4, 1 + Math.random() * 3, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
});
const shroudTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#0c0405'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {           // vertical folds of the grave-clothes
    g.strokeStyle = `rgba(${20 + Math.random() * 20 | 0},6,8,${Math.random() * 0.5})`; g.lineWidth = 1 + Math.random() * 3;
    const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 30, h); g.stroke();
  }
  for (let i = 0; i < 220; i++) {           // scarlet spattering
    g.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${Math.random() * 24 | 0},${Math.random() * 24 | 0},${0.55 + Math.random() * 0.45})`;
    const x = Math.random() * w, y = Math.random() * h;
    g.beginPath(); g.ellipse(x, y, 0.6 + Math.random() * 3, 0.6 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
}, { wrap: true });
const dialTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#0a0506'; g.fillRect(0, 0, w, h);
  const c = w / 2;
  g.strokeStyle = '#c9b48a'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, 56, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.lineWidth = i % 3 ? 2 : 4; g.beginPath(); g.moveTo(c + Math.cos(a) * 44, c + Math.sin(a) * 44); g.lineTo(c + Math.cos(a) * 54, c + Math.sin(a) * 54); g.stroke(); }
  g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(c, c); g.lineTo(c - 8, c - 34); g.stroke();      // hour hand near XII
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(c, c); g.lineTo(c - 18, c - 44); g.stroke();     // minute hand: five to midnight
  g.fillStyle = '#c9b48a'; g.beginPath(); g.arc(c, c, 4, 0, Math.PI * 2); g.fill();
});

/* ------------------------------------------------------------------ renderer & scene */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !PHONE, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x2c6cff, 0.008);
const camera = new THREE.PerspectiveCamera(NARROW ? 78 : 58, 1, 0.1, 260);
camera.rotation.order = 'YXZ';
scene.add(new THREE.AmbientLight(0xffffff, 0.14));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), PHONE ? 0.6 : 0.75, PHONE ? 0.4 : 0.5, 0.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize, { passive: true });
addEventListener('orientationchange', resize, { passive: true });
resize();

/* ------------------------------------------------------------------ shared geometry */
function archShape(w, h) {
  const s = new THREE.Shape();
  const spring = h - w * 0.866;
  s.moveTo(-w / 2, 0); s.lineTo(-w / 2, spring);
  s.absarc(w / 2, spring, w, Math.PI, Math.PI * 2 / 3, true);
  s.absarc(-w / 2, spring, w, Math.PI / 3, 0, true);
  s.lineTo(w / 2, 0); s.closePath();
  return s;
}
const endWallGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-HALF - 0.5, 0); s.lineTo(HALF + 0.5, 0); s.lineTo(HALF + 0.5, H + 0.5); s.lineTo(-HALF - 0.5, H + 0.5); s.closePath();
  s.holes.push(archShape(DOOR_W, DOOR_H));
  return new THREE.ShapeGeometry(s, 10);
})();
const trimGeo = (() => {
  const s = archShape(DOOR_W + 0.55, DOOR_H + 0.28);
  s.holes.push(archShape(DOOR_W, DOOR_H));
  return new THREE.ShapeGeometry(s, 10);
})();
const floorGeo = new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2).translate(0, 0, -L / 2);
const ceilGeo = new THREE.PlaneGeometry(W, L).rotateX(Math.PI / 2).translate(0, H, -L / 2);
const wallGeoL = new THREE.PlaneGeometry(L, H).rotateY(Math.PI / 2).translate(-HALF, H / 2, -L / 2);
const wallGeoR = new THREE.PlaneGeometry(L, H).rotateY(-Math.PI / 2).translate(HALF, H / 2, -L / 2);
const winGeo = new THREE.PlaneGeometry(2.4, 5.2);
const poolGeoL = new THREE.PlaneGeometry(3.6, 6.6).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
const poolGeoR = new THREE.PlaneGeometry(3.6, 6.6).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
const WIN_Z = [-L * 0.2, -L * 0.5, -L * 0.8];
const decorGeo = (() => {
  const parts = [];
  const pil = new THREE.BoxGeometry(0.45, H, 0.6);
  const rib = new THREE.BoxGeometry(W, 0.36, 0.36);
  const skirt = new THREE.BoxGeometry(0.22, 0.55, L);
  for (const z of [-1.2, -L * 0.35, -L * 0.65, -L + 1.2]) {
    parts.push(pil.clone().translate(-HALF + 0.2, H / 2, z), pil.clone().translate(HALF - 0.2, H / 2, z));
    parts.push(rib.clone().translate(0, H - 0.18, z));
  }
  parts.push(skirt.clone().translate(-HALF + 0.11, 0.27, -L / 2), skirt.clone().translate(HALF - 0.11, 0.27, -L / 2));
  return mergeGeometries(parts);
})();
const brazierGeo = (() => {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.CylinderGeometry(0.035, 0.045, 1.25, 5).translate(0, 0.62, 0).rotateZ(0.22).rotateY(i * Math.PI * 2 / 3);
    parts.push(leg);
  }
  parts.push(new THREE.ConeGeometry(0.34, 0.26, 9).rotateX(Math.PI).translate(0, 1.2, 0));
  parts.push(new THREE.TorusGeometry(0.34, 0.03, 5, 12).rotateX(Math.PI / 2).translate(0, 1.33, 0));
  return mergeGeometries(parts);
})();
const brazierMat = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.55, metalness: 0.8 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.42, metalness: 0.5, transparent: true, opacity: 0.8, depthWrite: true });

const revBodyGeo = mergeGeometries([
  new THREE.ConeGeometry(0.55, 1.75, 9, 1).translate(0, 0.875, 0),
  new THREE.SphereGeometry(0.34, 8, 6).scale(1, 0.6, 0.8).translate(0, 1.72, 0),
  new THREE.SphereGeometry(0.24, 8, 7).translate(0, 2.08, 0),
  new THREE.CylinderGeometry(0.05, 0.07, 0.85, 5).rotateZ(1.0).translate(-0.48, 1.62, 0),
  new THREE.CylinderGeometry(0.05, 0.07, 0.85, 5).rotateZ(-1.0).translate(0.48, 1.62, 0),
]);
const revMaskGeo = mergeGeometries([
  new THREE.CircleGeometry(0.19, 10).translate(0, 2.08, 0.19),
  new THREE.ConeGeometry(0.06, 0.75, 5).rotateZ(-0.28).translate(0.1, 2.62, 0),
]);

/* ------------------------------------------------------------------ rooms */
class Room {
  constructor(t) {
    this.t = t;
    this.spec = CHAMBERS[t];
    const spec = this.spec;
    const hue = new THREE.Color(spec.hue);
    this.hue = hue;
    const g = this.group = new THREE.Group();
    this.revelers = [];
    this.index = t;

    const wallColor = spec.black ? new THREE.Color(0x0e080b) : hue.clone().lerp(new THREE.Color(0x777777), 0.3).multiplyScalar(0.5);
    const wallMat = new THREE.MeshLambertMaterial({ color: wallColor });
    const ceilMat = new THREE.MeshLambertMaterial({ color: wallColor.clone().multiplyScalar(0.55) });
    const decorMat = new THREE.MeshLambertMaterial({ color: spec.black ? 0x120a0e : wallColor.clone().multiplyScalar(1.35) });
    g.add(new THREE.Mesh(floorGeo, floorMat));
    g.add(new THREE.Mesh(ceilGeo, ceilMat));
    g.add(new THREE.Mesh(wallGeoL, wallMat), new THREE.Mesh(wallGeoR, wallMat));
    const endWall = new THREE.Mesh(endWallGeo, wallMat); endWall.position.z = -L; g.add(endWall);
    const trim = new THREE.Mesh(trimGeo, new THREE.MeshBasicMaterial({ color: hue.clone().multiplyScalar(spec.white ? 0.9 : 0.75) }));
    trim.position.z = -L + 0.05; g.add(trim);
    g.add(new THREE.Mesh(decorGeo, decorMat));

    // windows: unlit, HDR bright so bloom picks them up; mirrored twins under the glass floor
    const winMat = new THREE.MeshBasicMaterial({ map: glassTex, color: hue.clone().multiplyScalar(spec.glow), fog: true });
    const poolMat = new THREE.MeshBasicMaterial({ map: glassTex, color: hue, transparent: true, opacity: spec.black ? 0.22 : 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    this.windows = [];
    for (const z of WIN_Z) for (const side of [-1, 1]) {
      const m = new THREE.Mesh(winGeo, winMat);
      m.position.set(side * (HALF - 0.05), 4.0, z); m.rotation.y = -side * Math.PI / 2; g.add(m);
      const r = m.clone(); r.position.y = -4.0; r.scale.y = -1; g.add(r);
      const p = new THREE.Mesh(side < 0 ? poolGeoL : poolGeoR, poolMat);
      p.position.set(side * (HALF - 2.1), 0.02, z); p.renderOrder = 2; g.add(p);
      this.windows.push(m);
    }
    // braziers
    const flameColor = spec.black ? new THREE.Color(0xff3a1a) : hue.clone().lerp(new THREE.Color(0xffd9a0), 0.45);
    const flameMat = new THREE.SpriteMaterial({ map: glowTex, color: flameColor, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.85 });
    const coreMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2d0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 });
    this.flames = [];
    for (const z of [-L * 0.33, -L * 0.67]) for (const side of [-1, 1]) {
      const b = new THREE.Mesh(brazierGeo, brazierMat); b.position.set(side * (HALF - 1.3), 0, z); g.add(b);
      const f = new THREE.Sprite(flameMat); f.position.set(side * (HALF - 1.3), 1.5, z); f.scale.set(1.5, 1.9, 1); g.add(f);
      const c = new THREE.Sprite(coreMat); c.position.set(side * (HALF - 1.3), 1.42, z); c.scale.set(0.5, 0.7, 1); g.add(c);
      this.flames.push(f, c);
    }
    // embers
    const N = REDUCED ? 0 : (PHONE ? 28 : 48);
    if (N) {
      const pos = new Float32Array(N * 3);
      this.emberSeeds = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const z = (i % 2 ? -L * 0.33 : -L * 0.67), side = (i >> 1) % 2 ? -1 : 1;
        pos[i * 3] = side * (HALF - 1.3) + (Math.random() - 0.5) * 0.8;
        pos[i * 3 + 1] = 1.4 + Math.random() * 3.2;
        pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
        this.emberSeeds[i] = Math.random() * 6.28;
      }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: glowTex, color: flameColor, size: 0.11, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
      this.embers.frustumCulled = false;
      g.add(this.embers);
    }
    // the light of the room: one colour, nothing else
    this.lights = [];
    const lightColor = spec.black ? new THREE.Color(0xff2a1a) : hue;
    const zs = PHONE ? [-L * 0.5] : [-L * 0.28, -L * 0.72];
    for (const z of zs) {
      const pl = new THREE.PointLight(lightColor, spec.black ? 40 : (PHONE ? 95 : 60), 0, 2);
      pl.position.set(0, H - 1.6, z); g.add(pl); this.lights.push(pl);
    }
    this.lightBase = this.lights[0].intensity;

    // reveler materials for this room
    this.bodyMat = new THREE.MeshLambertMaterial({ color: 0x050405, emissive: hue, emissiveIntensity: 0.06 });
    this.maskMat = new THREE.MeshBasicMaterial({ color: hue.clone().multiplyScalar(spec.white ? 0.8 : 1.1) });

    if (spec.black) this.buildClock();
    scene.add(g);
  }
  buildClock() {
    const g = this.group;
    const ebony = new THREE.MeshStandardMaterial({ color: 0x050305, roughness: 0.32, metalness: 0.25 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3f, roughness: 0.3, metalness: 0.9, emissive: 0x3a2508, emissiveIntensity: 0.8 });
    const clock = new THREE.Group();
    clock.position.set(-HALF + 0.75, 0, -L * 0.5);
    clock.rotation.y = Math.PI / 2;
    const parts = [
      [new THREE.BoxGeometry(1.5, 0.5, 1.0), 0, 0.25, 0],
      [new THREE.BoxGeometry(0.16, 5.6, 1.0), -0.67, 2.8, 0],
      [new THREE.BoxGeometry(0.16, 5.6, 1.0), 0.67, 2.8, 0],
      [new THREE.BoxGeometry(1.5, 5.6, 0.14), 0, 2.8, -0.43],
      [new THREE.BoxGeometry(1.5, 1.5, 1.0), 0, 4.85, 0],
      [new THREE.BoxGeometry(1.7, 0.3, 1.15), 0, 5.75, 0],
      [new THREE.ConeGeometry(0.9, 0.7, 4).rotateY(Math.PI / 4), 0, 6.2, 0],
    ];
    for (const [geo, x, y, z] of parts) { const m = new THREE.Mesh(geo, ebony); m.position.set(x, y, z); clock.add(m); }
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ map: dialTex }));
    dial.position.set(0, 4.85, 0.51); clock.add(dial);
    const pend = this.pendulum = new THREE.Group(); pend.position.set(0, 4.1, 0.1);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 6), brass); rod.position.y = -1.3; pend.add(rod);
    const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 18).rotateX(Math.PI / 2), brass); bob.position.y = -2.6; pend.add(bob);
    clock.add(pend);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2020, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5 }));
    glow.position.set(0, 2.4, 0.2); glow.scale.set(2.2, 4, 1); clock.add(glow);
    this.clockGlow = glow;
    g.add(clock);
  }
  setIndex(i) {
    this.index = i;
    this.group.position.z = -i * L;
    this.zStart = -i * L;
    this.zEnd = -i * L - L;
    this.pattern = null;
  }
  setLights(on) { for (const l of this.lights) l.visible = on; }
  clearRevelers() {
    for (const r of this.revelers) this.group.remove(r.group);
    this.revelers.length = 0;
  }
  spawnRevelers(strikes) {
    this.clearRevelers();
    if (this.index === 0) return;
    let n = NARROW ? 3 + Math.round(strikes * 0.8) : 5 + strikes;
    n = Math.min(NARROW ? 10 : 13, n);
    const style = Math.floor(Math.random() * 3);
    const slots = [];
    for (let i = 0; i < n; i++) slots.push(-5.5 - (L - 10.5) * (i + Math.random() * 0.7) / n);
    let i = 0;
    while (i < n) {
      if (style === 1 && i + 1 < n && Math.random() < 0.6) {          // a waltzing pair
        const cx = (Math.random() - 0.5) * (W - 3.2), cz = slots[i] - 0.8, w = 0.9 + Math.random() * 0.6, ph = Math.random() * 6.28;
        this.revelers.push(new Reveler(this, { type: 'waltz', cx, cz, r: 1.05, w, ph }));
        this.revelers.push(new Reveler(this, { type: 'waltz', cx, cz, r: 1.05, w, ph: ph + Math.PI }));
        i += 2;
      } else if (style === 2 && i + 2 < n && Math.random() < 0.55) {  // a line, arm in arm
        const k = 3, ph = Math.random() * 6.28, w = 0.45 + Math.random() * 0.4, amp = HALF - 0.9 - (k - 1) * 0.8;
        for (let j = 0; j < k; j++) this.revelers.push(new Reveler(this, { type: 'sweep', z: slots[i], amp, w, ph, off: (j - (k - 1) / 2) * 1.6 }));
        i += k;
      } else {
        const amp = 0.6 + Math.random() * (HALF - 1.4), w = 0.4 + Math.random() * 0.7, ph = Math.random() * 6.28;
        this.revelers.push(new Reveler(this, { type: 'sweep', z: slots[i], amp, w, ph, off: 0 }));
        i++;
      }
    }
  }
  update(t, dt, danceT) {
    for (const r of this.revelers) r.update(danceT, dt);
    const flick = REDUCED ? 0 : 1;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i], s = i % 2 ? 0.5 : 1.5;
      const n = 1 + flick * (Math.sin(t * 13 + i * 1.7) * 0.08 + Math.sin(t * 29 + i) * 0.05);
      f.scale.set(s * n, s * 1.3 * n, 1);
    }
    if (this.embers) {
      const p = this.embers.geometry.attributes.position, a = p.array;
      for (let i = 0; i < p.count; i++) {
        a[i * 3 + 1] += dt * (0.5 + 0.3 * Math.sin(this.emberSeeds[i]));
        a[i * 3] += Math.sin(t * 2 + this.emberSeeds[i]) * dt * 0.25;
        if (a[i * 3 + 1] > 4.8) a[i * 3 + 1] = 1.3;
      }
      p.needsUpdate = true;
    }
    if (this.pendulum) this.pendulum.rotation.z = Math.sin(t * 2.4) * 0.34;
  }
}

class Reveler {
  constructor(room, p) {
    this.room = room; this.p = p;
    const g = this.group = new THREE.Group();
    const body = new THREE.Mesh(revBodyGeo, room.bodyMat);
    const mask = new THREE.Mesh(revMaskGeo, room.maskMat);
    g.add(body, mask);
    if (!PHONE) { const refl = new THREE.Group(); refl.scale.y = -1; refl.add(body.clone(), mask.clone()); g.add(refl); }
    this.x = 0; this.z = p.type === 'waltz' ? p.cz : p.z;
    this.minD = 99; this.judged = false; this.fallen = false; this.fall = 0;
    this.spin = Math.random() * 6.28;
    room.group.add(g);
    this.update(0, 0);
  }
  update(t, dt) {
    const p = this.p;
    if (p.type === 'waltz') {
      this.x = p.cx + Math.cos(t * p.w + p.ph) * p.r;
      this.z = p.cz + Math.sin(t * p.w + p.ph) * p.r;
    } else {
      this.x = THREE.MathUtils.clamp(Math.sin(t * p.w + p.ph) * p.amp + p.off, -HALF + 0.6, HALF - 0.6);
    }
    const g = this.group;
    g.position.set(this.x, Math.abs(Math.sin(t * 5.2 + this.spin)) * 0.07, this.z);
    g.rotation.y = this.spin + Math.sin(t * 2.4 + this.spin) * 0.8 + t * 0.35;
    if (this.fallen && this.fall < 1) { this.fall = Math.min(1, this.fall + dt * 3); g.scale.y = 1 - this.fall * 0.72; g.rotation.x = this.fall * 0.5; }
  }
}

/* ------------------------------------------------------------------ the Red Death */
class RedDeath {
  constructor() {
    const g = this.group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: shroudTex, emissive: 0xff2020, emissiveIntensity: 0.6, emissiveMap: shroudTex, fog: false });
    const shroud = new THREE.Mesh(mergeGeometries([
      new THREE.ConeGeometry(0.82, 3.1, 16, 1).translate(0, 1.55, 0),
      new THREE.SphereGeometry(0.5, 10, 8).scale(1, 0.4, 0.8).translate(0, 2.75, 0),
      new THREE.ConeGeometry(0.46, 1.05, 12).translate(0, 3.28, 0),
    ]), mat);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.6), new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, color: 0xffffff, fog: false }));
    face.position.set(0, 2.92, 0.36);
    g.add(shroud, face);
    const refl = new THREE.Group(); refl.scale.y = -1; refl.add(shroud.clone(), face.clone()); g.add(refl);
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff1a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.32, fog: false }));
    this.aura.position.y = 1.9; this.aura.scale.set(7, 9, 1); g.add(this.aura);
    this.light = new THREE.PointLight(0xff2020, 34, 26, 2); this.light.position.y = 2.6; g.add(this.light);
    g.visible = false;
    scene.add(g);
    this.x = 0; this.z = 0; this.speed = 0; this.track = 0; this.stepAcc = 0; this.active = false;
  }
  appear(x, z, speed, track) {
    this.x = x; this.z = z; this.speed = speed; this.track = track; this.active = true; this.stepAcc = 0;
    this.group.visible = true; this.group.position.set(x, 0, z);
    this.group.scale.setScalar(1);
  }
  hide() { this.group.visible = false; this.active = false; }
  update(dt, t, targetX) {
    if (!this.group.visible) return;
    if (this.active) {
      this.z += this.speed * dt;
      const dx = THREE.MathUtils.clamp(targetX - this.x, -this.track * dt, this.track * dt);
      this.x = THREE.MathUtils.clamp(this.x + dx, -XLIM, XLIM);
      this.stepAcc += this.speed * dt;
      if (this.stepAcc > 1.6) { this.stepAcc -= 1.6; audio.rdStep(); shake = Math.max(shake, 0.05); }
    }
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.z = Math.sin(t * 1.1) * 0.025;
    this.group.rotation.y = Math.sin(t * 0.7) * 0.08;
    this.aura.material.opacity = 0.28 + Math.sin(t * 3.1) * 0.08;
    this.light.intensity = 30 + Math.sin(t * 5) * 5;
  }
}

/* ------------------------------------------------------------------ build */
const rooms = [];
for (let t = 0; t < ROOMS; t++) { const r = new Room(t); r.setIndex(t); rooms.push(r); }
const rd = new RedDeath();
const audio = makeAudio();

/* ------------------------------------------------------------------ state */
const keys = { left: false, right: false, up: false, down: false };
const touches = new Map();
let mode = 'title';          // title | play | dead | won
let time = 0;                // game clock (seconds)
let danceT = 0;              // reveler clock; stops when the revel freezes
let shake = 0;
let danceFrozen = false;
let playerPrevZ = 0;
let maxDt = 0.05;
let fogTarget = new THREE.Color(CHAMBERS[0].hue);
let fogDensityTarget = 0.008;
let fovTarget = camera.fov;
let uiTimer = 0;
let lastTap = 0;
let debug = { godmode: false };

const player = { x: 0, z: -22, vx: 0, speed: 0, base: 10, dash: 0, dashCd: 0, grace: 1, brushCd: 0, stride: 0, doorBump: false };
const run = { score: 0, chambers: 0, streak: 0, strikes: 0, curIdx: 0, nextStrike: FIRST_STRIKE, strike: null, warp: 0, playTime: 0, best: 0 };

function roomOfIndex(i) { return rooms[((i % ROOMS) + ROOMS) % ROOMS]; }

function setChamberUI(room) {
  ui.chamber.textContent = `The ${room.spec.name} Chamber`;
  document.documentElement.style.setProperty('--hue', room.spec.css);
}
function floatText(text, cls = '') {
  if (ui.floats.childElementCount > 5) ui.floats.firstElementChild.remove();
  const d = document.createElement('div');
  d.className = 'float ' + cls;
  d.textContent = text;
  d.style.top = (52 + Math.random() * 10) + '%';
  d.style.left = (44 + Math.random() * 12) + '%';
  ui.floats.appendChild(d);
  setTimeout(() => d.remove(), 1400);
}
function flash(cls) {
  ui.flash.classList.remove('hit', 'red');
  void ui.flash.offsetWidth;
  ui.flash.classList.add(cls);
}
function addScore(n) { run.score += n; ui.score.textContent = fmt(run.score); }

function resetRun() {
  for (let t = 0; t < ROOMS; t++) rooms[t].setIndex(t);
  player.x = 0; player.z = -22; player.vx = 0; player.speed = 0; player.dash = 0; player.dashCd = 0; player.grace = 1; player.brushCd = 0; player.doorBump = false;
  run.score = 0; run.chambers = 0; run.streak = 0; run.strikes = 0; run.curIdx = 0; run.nextStrike = FIRST_STRIKE; run.strike = null; run.warp = 0; run.playTime = 0;
  for (const r of rooms) r.spawnRevelers(0);
  rd.hide();
  danceT = 0;
  fogTarget = new THREE.Color(CHAMBERS[0].hue);
  ui.score.textContent = '0'; ui.streak.textContent = '';
  ui.strikeNum.textContent = 'Stroke I';
  ui.chimes.hidden = true;
  ui.vignette.classList.remove('strike');
  setChamberUI(rooms[0]);
  ui.end.classList.remove('won');
}
resetRun();

function startRun() {
  if (mode === 'play') return;
  resetRun();
  mode = 'play';
  audio.init();
  audio.setTempo(160);
  audio.setWarp(0);
  audio.startMusic();
  ui.title.hidden = true; ui.end.hidden = true; ui.hud.hidden = false;
  fogDensityTarget = 0.022;
  fovTarget = NARROW ? 84 : 72;
  uiTimer = 0;
}

function die() {
  if (mode !== 'play') return;
  mode = 'dead';
  rd.active = false;
  rd.x = player.x; rd.z = player.z - 3.2;
  rd.group.visible = true;
  flash('red');
  audio.death();
  shake = 0.5;
  ui.chimes.hidden = true;
  ui.vignette.classList.remove('strike');
  saveBest();
  uiTimer = 1.6;
}
function win() {
  if (mode !== 'play') return;
  mode = 'won';
  addScore(1000);
  audio.win();
  rd.hide();
  ui.chimes.hidden = true;
  ui.vignette.classList.remove('strike');
  fogTarget = new THREE.Color(0x101014); fogDensityTarget = 0.04;
  saveBest();
  uiTimer = 2.2;
}
function saveBest() {
  const b = loadState('masque-red-death:best', { score: 0 });
  if (run.score > (b.score || 0)) saveState('masque-red-death:best', { score: run.score, strikes: run.strikes, chambers: run.chambers, when: Date.now() });
  showBest();
}
function showEnd() {
  const won = mode === 'won';
  ui.end.classList.toggle('won', won);
  ui.endKicker.textContent = won ? 'Midnight' : 'The Red Death';
  ui.endTitle.textContent = won ? 'The Clock Falls Silent' : 'Dominion';
  ui.endQuote.textContent = won
    ? '“And the life of the ebony clock went out with that of the last of the gay; and the flames of the tripods expired.”'
    : '“And Darkness and Decay and the Red Death held illimitable dominion over all.”';
  const b = loadState('masque-red-death:best', { score: 0 });
  ui.endScore.innerHTML = `<b>${fmt(run.score)}</b> · ${ROMAN[run.strikes - 1] || 'no'} stroke${run.strikes === 1 ? '' : 's'} survived · ${run.chambers} chambers${run.score >= (b.score || 0) && run.score > 0 ? ' · <b>a new best</b>' : ''}`;
  ui.hud.hidden = true;
  ui.end.hidden = false;
}

/* ------------------------------------------------------------------ the strike */
function beginStrike(room) {
  const k = run.strikes + 1;
  const count = 2 + k;
  const spacing = Math.max(0.78, 1.9 - 0.08 * k);
  // snapshot the geometry: the Room object is recycled ahead once the player leaves it
  run.strike = { k, count, spacing, elapsed: 0, rung: 0, zStart: room.zStart, zEnd: room.zEnd, revelers: room.revelers.slice(), passedDoor: false, brushedHim: false, done: false };
  rd.appear(0, room.zEnd + 1.0, (NARROW ? 3.6 : 4.2) + 0.5 * k, (NARROW ? 1.3 : 1.6) + 0.26 * k);
  danceFrozen = true;
  audio.duck(true);
  audio.setWarp(0);
  run.warp = 0;
  ui.chimes.hidden = false;
  ui.chimeLine.textContent = k === STRIKES_TO_WIN ? 'Midnight strikes' : `The clock strikes ${ROMAN[k - 1]}`;
  ui.dots.innerHTML = '';
  for (let i = 0; i < count; i++) ui.dots.appendChild(document.createElement('i'));
  ui.vignette.classList.add('strike');
  fogDensityTarget = 0.03;
  floatText('the music stops', 'bad');
}
function endStrike() {
  const s = run.strike;
  run.strike = null;
  danceFrozen = false;
  rd.hide();
  audio.duck(false);
  audio.setTempo(160 + run.strikes * 4);
  ui.chimes.hidden = true;
  ui.vignette.classList.remove('strike');
  fogDensityTarget = 0.022;
  run.nextStrike = time + STRIKE_INTERVAL;
  ui.strikeNum.textContent = `Stroke ${ROMAN[Math.min(run.strikes, 11)]}`;
  for (const r of rooms) for (const rv of r.revelers) if (rv.fallen) { rv.fallen = false; rv.fall = 0; rv.group.scale.y = 1; rv.group.rotation.x = 0; }
  if (s.winPending) win();
  else floatText('the revel resumes');
}
function updateStrike(dt) {
  const s = run.strike;
  s.elapsed += dt;
  while (s.rung < s.count && s.elapsed >= s.rung * s.spacing) {
    audio.chime(s.rung, s.count);
    const dot = ui.dots.children[s.rung]; if (dot) dot.classList.add('rung');
    shake = Math.max(shake, 0.09);
    s.rung++;
  }
  const deadline = s.count * s.spacing;
  if (!s.passedDoor) {
    // he stalks (swept so a slow frame cannot step him through the player)
    const rdPrevZ = rd.z, plPrevZ = playerPrevZ;
    rd.update(dt, time, player.x);
    const crossed = (rdPrevZ <= plPrevZ && rd.z >= player.z) || (rdPrevZ - 1.1 <= plPrevZ && rd.z + 1.1 >= player.z && rd.z >= player.z - 1.1);
    for (const rv of s.revelers) {
      if (rv.fallen) continue;
      const dx = rv.x - rd.x, dz = (s.zStart + rv.z) - rd.z;
      if (dx * dx + dz * dz < 1.5) rv.fallen = true;
    }
    const dx = player.x - rd.x, dz = player.z - rd.z;
    const d = Math.hypot(dx, dz);
    if ((d < 1.15 || (crossed && Math.abs(dx) < 1.15)) && !debug.godmode) { die(); return; }
    if (d < 1.9 && !s.brushedHim && rd.z > player.z - 0.3) { s.brushedHim = true; addScore(150 * s.k); floatText(`+${150 * s.k}  you brushed his shroud`); audio.nearMiss(6); }
    if (player.z < s.zEnd - 0.4) {
      s.passedDoor = true;
      run.strikes++;
      addScore(300 * s.k);
      floatText(`+${300 * s.k}  he passed you by`, 'big');
      audio.doorPass();
      rd.active = false;
      if (run.strikes >= STRIKES_TO_WIN) s.winPending = true;
    } else if (s.elapsed > deadline && !debug.godmode) {
      rd.x = player.x; rd.z = player.z - 1.6; die(); return;
    }
  }
  if (s.elapsed > deadline + 1.1) endStrike();
}

/* ------------------------------------------------------------------ input */
function dash() {
  if (mode !== 'play' || player.dashCd > 0) return;
  player.dash = 0.28; player.dashCd = 1.35;
  audio.dash();
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
  else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
  else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
  if (k === ' ' || k === 'Enter') {
    if (mode === 'title') { e.preventDefault(); startRun(); }
    else if ((mode === 'dead' || mode === 'won') && uiTimer <= 0 && !ui.end.hidden) { e.preventDefault(); startRun(); }
    else if (k === ' ') { e.preventDefault(); dash(); }
  }
});
addEventListener('keyup', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
  else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
});
addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button')) return;
  if (mode === 'title') { startRun(); return; }
  if (mode !== 'play') { if (uiTimer <= 0 && !ui.end.hidden) startRun(); return; }
  const now = performance.now();
  if (now - lastTap < 320) dash();
  lastTap = now;
  touches.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1);
});
const release = (e) => touches.delete(e.pointerId);
addEventListener('pointerup', release); addEventListener('pointercancel', release);
addEventListener('pointermove', (e) => { if (touches.has(e.pointerId)) touches.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1); });
ui.start.addEventListener('click', startRun);
ui.again.addEventListener('click', () => { if (uiTimer <= 0) startRun(); });
addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; touches.clear(); });

/* ------------------------------------------------------------------ player */
function updatePlayer(dt) {
  let dir = 0;
  if (keys.left) dir -= 1; if (keys.right) dir += 1;
  for (const s of touches.values()) dir += s;
  dir = THREE.MathUtils.clamp(dir, -1, 1);
  const strafe = NARROW ? 6.5 : 7.5;
  player.vx += (dir * strafe - player.vx) * Math.min(1, dt * 16);
  player.x += player.vx * dt;
  if (player.x > XLIM) { player.x = XLIM; player.vx = Math.min(0, player.vx); }
  if (player.x < -XLIM) { player.x = -XLIM; player.vx = Math.max(0, player.vx); }

  const cap = player.base * (0.55 + 0.45 * player.grace);
  let target = Math.min(cap, player.base + (keys.up ? 3.5 : 0) - (keys.down ? 4 : 0));
  if (run.playTime < 1.5) target *= run.playTime / 1.5;
  player.speed += (target - player.speed) * Math.min(1, dt * 3.2);
  let v = player.speed;
  if (player.dash > 0) { v += 15 * (player.dash / 0.28); player.dash -= dt; }
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.brushCd = Math.max(0, player.brushCd - dt);
  player.grace = Math.min(1, player.grace + dt * 0.06);
  player.z -= v * dt;

  // door funnel
  const room = roomOfIndex(run.curIdx);
  const toEnd = player.z - room.zEnd;
  const doorHalf = DOOR_W / 2 - 0.4;
  if (toEnd < 2.4 && Math.abs(player.x) > doorHalf) {
    const push = (toEnd < 1.2 ? 16 : 7) * dt;
    player.x -= Math.sign(player.x) * Math.min(push, Math.abs(player.x) - doorHalf);
    if (toEnd < 0.9 && !player.doorBump) { player.doorBump = true; player.speed *= 0.8; audio.brush(); }
  }

  // footsteps
  player.stride += v * dt;
  if (player.stride > 2.3) { player.stride -= 2.3; audio.step(v); }

  // revelers in this room
  const pz = player.z - room.zStart;
  for (const rv of room.revelers) {
    const dx = rv.x - player.x, dz = rv.z - pz;
    const d = Math.hypot(dx, dz);
    if (rv.z > pz + 0.9) {
      if (!rv.judged) {
        rv.judged = true;
        if (rv.minD < 1.75 && !rv.fallen) {
          run.streak = Math.min(6, run.streak + 1);
          const pts = 25 * run.streak;
          addScore(pts);
          ui.streak.textContent = run.streak > 1 ? `streak ×${run.streak}` : '';
          floatText(`+${pts}  ${['a brush of silk', 'her mask turns', 'so close', 'the plume grazes you', 'unseen', 'a ghost among them'][Math.min(5, run.streak - 1)]}`);
          audio.nearMiss(run.streak);
        }
      }
    } else {
      rv.minD = Math.min(rv.minD, d);
      if (d < 1.0 && player.brushCd <= 0 && !rv.fallen) {
        player.brushCd = 0.7;
        player.grace = Math.max(0, player.grace - 0.2);
        player.speed *= 0.45;
        player.vx = (dx < 0 ? 1 : -1) * 9;
        run.streak = 0; ui.streak.textContent = '';
        flash('hit'); shake = Math.max(shake, 0.12);
        audio.brush();
        floatText('jostled', 'bad');
      }
    }
  }
  ui.grace.style.width = (player.grace * 100).toFixed(1) + '%';
  ui.graceWrap.classList.toggle('low', player.grace < 0.35);
}

function updateRooms() {
  const idx = Math.floor(-player.z / L);
  if (idx === run.curIdx) return;
  run.curIdx = idx;
  const room = roomOfIndex(idx);
  run.chambers++;
  addScore(100);
  player.doorBump = false;
  for (const rv of room.revelers) { rv.judged = false; rv.minD = 99; }
  for (const r of rooms) if (r.index < idx) { r.setIndex(r.index + ROOMS); r.spawnRevelers(run.strikes); }
  fogTarget = room.spec.black ? new THREE.Color(0x1a0406) : room.hue.clone().multiplyScalar(room.spec.fog);
  setChamberUI(room);
  if (!run.strike && time >= run.nextStrike) beginStrike(room);
}

/* ------------------------------------------------------------------ frame */
const fogColor = new THREE.Color(CHAMBERS[0].hue);
let last = performance.now();
function frame(now) {
  const raw = Math.min(maxDt, (now - last) / 1000);
  last = now;
  const dt = raw;
  time += dt;
  if (mode === 'play') run.playTime += dt;
  playerPrevZ = player.z;

  if (mode === 'title') {
    camera.position.set(Math.sin(time * 0.25) * 0.35, EYE + Math.sin(time * 0.6) * 0.05, -22);
    camera.rotation.set(0.005, Math.sin(time * 0.25) * 0.012, 0);
  } else if (mode === 'play') {
    updatePlayer(dt);
    updateRooms();
    if (run.strike) updateStrike(dt);
    else {
      const untilStrike = run.nextStrike - time;
      const warp = THREE.MathUtils.clamp(1 - untilStrike / 1.6, 0, 1);
      if (warp !== run.warp) { run.warp = warp; audio.setWarp(warp); }
    }
  } else {
    // dead / won: settle
    player.speed *= 0.9;
    rd.update(dt, time, rd.x);
    if (mode === 'dead') { rd.group.scale.setScalar(Math.min(1.25, rd.group.scale.x + dt * 0.25)); rd.z += (player.z - 2.9 - rd.z) * dt * 2; }
    if (uiTimer > 0) { uiTimer -= dt; if (uiTimer <= 0) showEnd(); }
  }

  if (!danceFrozen) danceT += dt;
  const light = run.strike && !run.strike.passedDoor ? 0.4 : 1;
  for (const r of rooms) {
    const dist = r.index - run.curIdx;
    r.setLights(dist >= -1 && dist <= (PHONE ? 2 : 3));
    r.update(time, dt, danceT);
    for (const l of r.lights) l.intensity += (r.lightBase * light - l.intensity) * Math.min(1, dt * 4);
  }
  if (rd.group.visible && mode === 'play' && (!run.strike || run.strike.passedDoor)) rd.update(dt, time, rd.x);

  // camera
  if (mode !== 'title') {
    const bob = REDUCED ? 0 : Math.sin(player.stride / 2.3 * Math.PI * 2) * 0.035 * Math.min(1, player.speed / 8);
    shake = Math.max(0, shake - dt * 0.5);
    const sx = REDUCED ? 0 : (Math.random() - 0.5) * shake, sy = REDUCED ? 0 : (Math.random() - 0.5) * shake;
    camera.position.set(player.x + sx, EYE + bob + sy, player.z);
    camera.rotation.set(0, REDUCED ? 0 : -player.vx * 0.006, REDUCED ? 0 : -player.vx * 0.012);
    if (mode === 'dead') camera.rotation.x = Math.min(0.3, camera.rotation.x + dt * 0.35);
  }
  const fovGoal = fovTarget + (player.dash > 0 ? 9 : 0);
  if (Math.abs(camera.fov - fovGoal) > 0.05) { camera.fov += (fovGoal - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }

  // fog: the current chamber's one colour, reddening while he walks
  const ft = run.strike && !run.strike.passedDoor ? fogTarget.clone().lerp(DREAD, 0.75) : fogTarget;
  fogColor.lerp(ft, Math.min(1, dt * 2.5));
  scene.fog.color.copy(fogColor);
  scene.fog.density += (fogDensityTarget - scene.fog.density) * Math.min(1, dt * 2);

  audio.update();
  composer.render();
}
renderer.setAnimationLoop(frame);

/* ------------------------------------------------------------------ debug / playtest hook */
window.__poe = {
  get mode() { return mode; },
  get run() { return run; },
  get player() { return player; },
  get strike() { return run.strike; },
  start: startRun,
  setStrikes(n) { run.strikes = n; ui.strikeNum.textContent = `Stroke ${ROMAN[Math.min(n, 11)]}`; },
  strikeNow() { run.nextStrike = 0; },
  setMaxDt(v) { maxDt = v; },
  set godmode(v) { debug.godmode = !!v; },
  get godmode() { return debug.godmode; },
  setX(x) { player.x = x; },
  setInput(o) { Object.assign(keys, o); },
  setResolution(s) { renderer.setPixelRatio(DPR * s); resize(); },
};
