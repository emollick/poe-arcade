/* poe-arcade — shared/poe.js
 * A tiny ES module. No framework, no dependencies, no side effects on import.
 * Import with: import { mountBack, fitCanvas } from '/shared/poe.js';
 */

/** Injects the fixed back-to-launcher link into <body> (idempotent). */
export function mountBack(label = '← the cabinet') {
  if (document.querySelector('.poe-back')) return document.querySelector('.poe-back');
  const a = document.createElement('a');
  a.className = 'poe-back';
  a.href = '../../index.html';
  a.textContent = label;
  a.setAttribute('aria-label', 'Back to the launcher');
  const put = () => document.body.appendChild(a);
  if (document.body) put(); else addEventListener('DOMContentLoaded', put, { once: true });
  return a;
}

/** Sizes a canvas to its CSS box across DPR/resize/orientation; DPR capped at 2. */
export function fitCanvas(canvas, onResize) {
  let raf = 0;
  const apply = () => {
    raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(r.width  || window.innerWidth));
    const cssH = Math.max(1, Math.round(r.height || window.innerHeight));
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (typeof onResize === 'function') onResize({ width: cssW, height: cssH, dpr, canvas });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
  addEventListener('resize', schedule, { passive: true });
  addEventListener('orientationchange', schedule, { passive: true });
  if (typeof ResizeObserver === 'function') { try { new ResizeObserver(schedule).observe(canvas); } catch {} }
  apply();
  return { refit: apply, dispose() { removeEventListener('resize', schedule); removeEventListener('orientationchange', schedule); } };
}

/** Lazily creates one shared AudioContext with a master gain, unlock() and setMuted(). */
let _audio = null;
export function createAudio() {
  if (_audio) return _audio;
  let ctx = null, master = null, muted = false, vol = 1;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol;
    master.connect(ctx.destination);
    return ctx;
  };
  const unlock = () => {
    const c = ensure();
    if (!c) return Promise.resolve(null);
    if (c.state === 'suspended') return c.resume().catch(() => {}).then(() => c);
    return Promise.resolve(c);
  };
  onFirstGesture(unlock);
  _audio = {
    get ctx() { return ensure(); },
    get master() { ensure(); return master; },
    get muted() { return muted; },
    unlock,
    setMuted(v) { muted = !!v; if (master) master.gain.setTargetAtTime(muted ? 0 : vol, (ctx && ctx.currentTime) || 0, 0.02); },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); if (master && !muted) master.gain.setTargetAtTime(vol, (ctx && ctx.currentTime) || 0, 0.02); },
  };
  return _audio;
}

/** Writes JSON under the `poe:` localStorage namespace; never throws. */
export function saveState(key, obj) {
  try { localStorage.setItem('poe:' + key, JSON.stringify(obj)); return true; }
  catch { return false; }
}

/** Reads JSON back from the `poe:` namespace; returns fallback if absent/blocked. */
export function loadState(key, fallback = null) {
  try {
    const raw = localStorage.getItem('poe:' + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** Runs cb once on the first pointerdown/keydown/touchstart, then unbinds. */
export function onFirstGesture(cb) {
  const events = ['pointerdown', 'keydown', 'touchstart', 'mousedown'];
  let done = false;
  const fire = (e) => {
    if (done) return;
    done = true;
    for (const t of events) removeEventListener(t, fire, true);
    try { cb(e); } catch (err) { console.warn('[poe] onFirstGesture handler threw', err); }
  };
  for (const t of events) addEventListener(t, fire, { capture: true, passive: true });
  return () => { done = true; for (const t of events) removeEventListener(t, fire, true); };
}
