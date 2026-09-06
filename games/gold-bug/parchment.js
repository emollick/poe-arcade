/* The Gold-Bug — parchment.js
 * Procedurally weathered parchment on a canvas: layered value noise for the
 * fibre, tea-brown stains, foxing, creases, and a scorched irregular edge
 * (the story's parchment was held to the fire). Nothing is loaded; it is all
 * generated at load time.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A grid of random values sampled with bilinear interpolation = value noise. */
function makeNoise(rnd, cells) {
  const g = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (u, v) => { // u,v wrap, so any scale is safe
    u = u - Math.floor(u); v = v - Math.floor(v);
    const x = Math.min(u * cells, cells - 1e-6), y = Math.min(v * cells, cells - 1e-6);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i = y0 * (cells + 1) + x0;
    const a = g[i], b = g[i + 1], c = g[i + cells + 1], d = g[i + cells + 2];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/**
 * Paints parchment onto `canvas` at its current pixel size.
 * opts.burn: {top,right,bottom,left} depth in px of scorch per edge (0 = clean edge)
 * opts.seed: number
 * Returns {edgeBottom: Float32Array} — the y of the burnt edge per column,
 * so an ember layer can be drawn along the real char line.
 */
export function paintParchment(canvas, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rnd = mulberry32(opts.seed || 1843);
  const scale = opts.scale || 1; // device pixels per css px, for stroke widths
  const burn = Object.assign({ top: 0, right: 0, bottom: 0, left: 0 }, opts.burn || {});
  const base = opts.base || [216, 187, 140];

  /* 1. fibre: three octaves of value noise, computed on a downsampled grid
   * then upscaled by the browser (the noise is soft anyway). */
  const ds = Math.max(1, Math.round(scale * 1.5));
  const w = Math.ceil(W / ds), h = Math.ceil(H / ds);
  const n1 = makeNoise(rnd, 6), n2 = makeNoise(rnd, 24), n3 = makeNoise(rnd, 90);
  const stainN = makeNoise(rnd, 4);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = n1(u, v) * 0.55 + n2(u, v) * 0.3 + n3(u, v) * 0.15; // 0..1
      const tea = stainN(u, v); // broad tonal drift
      const k = 0.86 + n * 0.22 - tea * 0.08;
      const o = (y * w + x) * 4;
      d[o] = Math.min(255, base[0] * k);
      d[o + 1] = Math.min(255, base[1] * k * (0.98 + tea * 0.02));
      d[o + 2] = Math.min(255, base[2] * k * (0.94 + tea * 0.04));
      d[o + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, W, H);

  /* 2. fine fibres: short low-alpha hairlines in every direction. */
  ctx.save();
  ctx.lineWidth = Math.max(0.6, 0.7 * scale);
  const fibres = Math.round((W * H) / (2600 * scale * scale));
  for (let i = 0; i < fibres; i++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, l = (4 + rnd() * 14) * scale;
    const light = rnd() < 0.45;
    ctx.strokeStyle = light ? `rgba(255,245,220,${0.05 + rnd() * 0.08})` : `rgba(90,60,30,${0.04 + rnd() * 0.07})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();

  /* 3. stains: big soft radial gradients in tea-brown, with a darker ring. */
  const stains = opts.stains ?? 5;
  for (let i = 0; i < stains; i++) {
    const cx = rnd() * W, cy = rnd() * H;
    const r = (0.07 + rnd() * 0.14) * Math.max(W, H);
    const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    const a = 0.045 + rnd() * 0.07;
    g.addColorStop(0, `rgba(140,95,40,${a * 0.5})`);
    g.addColorStop(0.75, `rgba(120,80,30,${a * 0.7})`);
    g.addColorStop(0.93, `rgba(95,60,22,${a * 1.1})`); // the ring where the tea dried
    g.addColorStop(1, 'rgba(95,60,22,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    // slightly irregular ellipse
    ctx.ellipse(cx, cy, r * (0.85 + rnd() * 0.3), r * (0.85 + rnd() * 0.3), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 4. foxing: rusty freckles. */
  const fox = Math.round((W * H) / (9000 * scale * scale));
  for (let i = 0; i < fox; i++) {
    const x = rnd() * W, y = rnd() * H, r = (0.6 + rnd() * rnd() * 3.2) * scale;
    ctx.fillStyle = `rgba(${120 + rnd() * 40 | 0},${60 + rnd() * 30 | 0},${20 + rnd() * 20 | 0},${0.08 + rnd() * 0.3})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  /* 5. creases: faint long lines, a light and a dark stroke side by side. */
  const creases = opts.creases ?? 4;
  ctx.save();
  for (let i = 0; i < creases; i++) {
    const vertical = rnd() < 0.5;
    const p = 0.15 + rnd() * 0.7;
    const wobble = (rnd() - 0.5) * 0.08;
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const jitter = (rnd() - 0.5) * 6 * scale;
      pts.push(vertical ? [W * (p + wobble * (t - 0.5)) + jitter, H * t] : [W * t, H * (p + wobble * (t - 0.5)) + jitter]);
    }
    for (const [col, off, lw] of [[`rgba(255,240,210,0.35)`, 1, 1.2], [`rgba(80,50,20,0.22)`, -1, 1]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw * scale;
      ctx.beginPath();
      pts.forEach(([x, y], j) => (j ? ctx.lineTo(x + off * scale, y + off * scale) : ctx.moveTo(x + off * scale, y + off * scale)));
      ctx.stroke();
    }
  }
  ctx.restore();

  /* 6. vignette: paper is darker toward its edges. */
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(70,40,10,0)');
  vg.addColorStop(1, 'rgba(70,40,10,0.28)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  /* 7. scorched edge. For every pixel near an edge, compare its distance to
   * the edge against a noisy threshold; inside the threshold it is char,
   * beyond it the paper is gone (alpha 0). Done per-pixel on the edge bands
   * only, so it stays cheap on a phone. */
  const edgeBottom = new Float32Array(W).fill(H);
  const maxBurn = Math.max(burn.top, burn.right, burn.bottom, burn.left);
  if (maxBurn > 0) {
    const eN1 = makeNoise(rnd, 14), eN2 = makeNoise(rnd, 60);
    const band = Math.ceil(maxBurn * 1.6);
    const process = (x0, y0, x1, y1) => {
      const id = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      const p = id.data, bw = x1 - x0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          // signed "depth into paper" from the nearest burnt edge, scaled by that edge's burn depth
          let best = Infinity;
          const consider = (dist, depth) => { if (depth > 0) best = Math.min(best, dist / depth); };
          consider(y, burn.top); consider(H - 1 - y, burn.bottom);
          consider(x, burn.left); consider(W - 1 - x, burn.right);
          if (best === Infinity) continue;
          const u = x / W, v = y / H;
          const nz = eN1(u * 3, v * 3) * 0.7 + eN2(u * 3, v * 3) * 0.3; // 0..1
          const edge = 0.35 + nz * 0.65; // where the paper actually ends, in burn units
          const t = best - edge; // <0 gone, 0..0.35 char, beyond fine
          const o = ((y - y0) * bw + (x - x0)) * 4;
          if (t < 0) {
            p[o + 3] = 0;
            if (burn.bottom > 0 && y > H - 1 - burn.bottom * 1.6 && edgeBottom[x] === H) edgeBottom[x] = y;
          } else {
            const ch = Math.min(1, t / 0.42); // 0 at the very edge -> 1 in clean paper
            const dark = 1 - ch;
            const k = dark * dark;
            // blacken toward the edge, with a brown scorch halo before it
            p[o] = p[o] * (1 - k * 0.92) - dark * 30 * (1 - k);
            p[o + 1] = p[o + 1] * (1 - k * 0.95) - dark * 40 * (1 - k);
            p[o + 2] = p[o + 2] * (1 - k * 0.97) - dark * 50 * (1 - k);
            if (t < 0.08) p[o + 3] = 255 * Math.min(1, t / 0.08 + 0.3);
          }
        }
      }
      ctx.putImageData(id, x0, y0);
    };
    if (burn.top) process(0, 0, W, Math.min(H, Math.ceil(burn.top * 1.6)));
    if (burn.bottom) process(0, Math.max(0, H - Math.ceil(burn.bottom * 1.6)), W, H);
    if (burn.left) process(0, 0, Math.min(W, Math.ceil(burn.left * 1.6)), H);
    if (burn.right) process(Math.max(0, W - Math.ceil(burn.right * 1.6)), 0, W, H);
    // fix the columns where the edge was never found (paper reaches the bottom)
    for (let x = 0; x < W; x++) {
      if (edgeBottom[x] === H) {
        // find first transparent pixel scanning down the bottom band
        edgeBottom[x] = H - 1;
      }
    }
    void band;
  }
  return { edgeBottom };
}

/** A small parchment as a data-URL, for the treasure map's backing. */
export function parchmentDataURL(w, h, seed = 7) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paintParchment(c, { seed, scale: 1, stains: 3, creases: 2, burn: { top: 6, right: 8, bottom: 8, left: 6 }, base: [205, 172, 122] });
  return c.toDataURL('image/png');
}
