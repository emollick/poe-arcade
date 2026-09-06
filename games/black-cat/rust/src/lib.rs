//! PLUTO — the cellar wall.
//!
//! The whole plaster simulation lives here and is compiled to
//! wasm32-unknown-unknown without wasm-bindgen. Every buffer is a static, so
//! linear memory never grows and the JS views over `pixels_ptr()` stay valid
//! for the life of the module.
//!
//! Fields per cell: plaster thickness, moisture, crack, fresh-coat wetness,
//! plus the static cat mask (signed distance, soft mask, boundary band, eye,
//! eye halo, seepage source, grain).
//!
//! Exports (all `extern "C"`):
//!   init(w, h, seed) -> pixels ptr
//!   step(dt_ms, difficulty)
//!   plaster(x, y, radius, amount) -> spent
//!   set_lantern(x, y, radius, strength)
//!   render()
//!   pixels_ptr(), visibility(), total_visibility()
//!   rap(x, y, strength), set_ambient(a), set_eye(force), set_reveal(r),
//!   title_dress(), eye_x(), eye_y(), cat_cx(), cat_cy(), cat_size(), width(), height()

#![allow(static_mut_refs)]
#![allow(clippy::missing_safety_doc)]

use core::f32::consts::PI;

const MAX_N: usize = 512 * 512;
const MAX_WALKERS: usize = 160;
const MAX_EDGE: usize = 32768;

// ---------------------------------------------------------------- statics
static mut W: usize = 0;
static mut H: usize = 0;
static mut N: usize = 0;

static mut THICK: [f32; MAX_N] = [0.0; MAX_N];
static mut MOIST_A: [f32; MAX_N] = [0.0; MAX_N];
static mut MOIST_B: [f32; MAX_N] = [0.0; MAX_N];
static mut CRACK: [f32; MAX_N] = [0.0; MAX_N];
static mut FRESH: [f32; MAX_N] = [0.0; MAX_N];
static mut SDF: [f32; MAX_N] = [0.0; MAX_N];
static mut CAT: [f32; MAX_N] = [0.0; MAX_N];
static mut EDGE: [f32; MAX_N] = [0.0; MAX_N];
static mut EYE: [f32; MAX_N] = [0.0; MAX_N];
static mut HALO: [f32; MAX_N] = [0.0; MAX_N];
static mut SRC: [f32; MAX_N] = [0.0; MAX_N];
static mut GRAIN: [f32; MAX_N] = [0.0; MAX_N];
static mut PIX: [u8; MAX_N * 4] = [0; MAX_N * 4];

static mut MOIST_CUR: bool = false; // false => A is current

#[derive(Clone, Copy)]
struct Walker {
    x: f32,
    y: f32,
    dx: f32,
    dy: f32,
    sign: f32,
    life: i32,
    acc: f32,
    active: bool,
}
const DEAD: Walker = Walker { x: 0.0, y: 0.0, dx: 0.0, dy: 0.0, sign: 1.0, life: 0, acc: 0.0, active: false };
static mut WALK: [Walker; MAX_WALKERS] = [DEAD; MAX_WALKERS];

static mut EDGE_LIST: [u32; MAX_EDGE] = [0; MAX_EDGE];
static mut EDGE_COUNT: usize = 0;

static mut RNG: u32 = 0x9e3779b9;
static mut SEED: u32 = 1;
static mut TIME: f32 = 0.0;
static mut EYE_P: f32 = 0.0; // eye pressure (grows with difficulty)
static mut EYE_FORCE: f32 = 0.0; // 0..1 override (win: fully open)
static mut REVEAL: f32 = 0.0; // 0..1 (lose: the wall gives up the cat)
static mut AMBIENT: f32 = 1.0;
static mut LX: f32 = -1e9;
static mut LY: f32 = 0.0;
static mut LR: f32 = 1.0;
static mut LS: f32 = 0.0;
static mut VIS_BEAM: f32 = 0.0;
static mut VIS_TOTAL: f32 = 0.0;
static mut CAT_CX: f32 = 0.0;
static mut CAT_CY: f32 = 0.0;
static mut CAT_S: f32 = 1.0;
static mut REL: f32 = 1.0; // grid resolution relative to the 320-cell reference wall
static mut EYE_X: f32 = 0.0;
static mut EYE_Y: f32 = 0.0;
static mut EAR_X: f32 = 0.0;
static mut EAR_Y: f32 = 0.0;
static mut EYE_IDX: usize = 0;
static mut EYE_R: f32 = 1.0;

// ---------------------------------------------------------------- helpers
#[inline]
fn rnd() -> f32 {
    unsafe {
        let mut x = RNG;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        RNG = x;
        (x >> 8) as f32 / 16777216.0
    }
}

#[inline]
fn hash2(x: i32, y: i32, s: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(374761393) ^ (y as u32).wrapping_mul(668265263) ^ s.wrapping_mul(2246822519);
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    h ^= h >> 16;
    (h & 0xffffff) as f32 / 16777216.0
}

fn vnoise(x: f32, y: f32, s: u32) -> f32 {
    let xi = x.floor();
    let yi = y.floor();
    let mut fx = x - xi;
    let mut fy = y - yi;
    fx = fx * fx * (3.0 - 2.0 * fx);
    fy = fy * fy * (3.0 - 2.0 * fy);
    let ix = xi as i32;
    let iy = yi as i32;
    let a = hash2(ix, iy, s);
    let b = hash2(ix + 1, iy, s);
    let c = hash2(ix, iy + 1, s);
    let d = hash2(ix + 1, iy + 1, s);
    let top = a + (b - a) * fx;
    let bot = c + (d - c) * fx;
    top + (bot - top) * fy
}

fn fbm(x: f32, y: f32, s: u32, oct: u32) -> f32 {
    let mut v = 0.0;
    let mut amp = 0.5;
    let mut fx = x;
    let mut fy = y;
    let mut sum = 0.0;
    for o in 0..oct {
        v += (vnoise(fx, fy, s.wrapping_add(o * 7919)) * 2.0 - 1.0) * amp;
        sum += amp;
        amp *= 0.5;
        fx *= 2.03;
        fy *= 2.01;
    }
    v / sum
}

#[inline]
fn clamp01(x: f32) -> f32 {
    if x < 0.0 { 0.0 } else if x > 1.0 { 1.0 } else { x }
}
#[inline]
fn smooth(a: f32, b: f32, x: f32) -> f32 {
    let t = clamp01((x - a) / (b - a));
    t * t * (3.0 - 2.0 * t)
}
#[inline]
fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp01(0.5 + 0.5 * (b - a) / k);
    b + (a - b) * h - k * h * (1.0 - h)
}
#[inline]
fn sd_circle(px: f32, py: f32, cx: f32, cy: f32, r: f32) -> f32 {
    ((px - cx) * (px - cx) + (py - cy) * (py - cy)).sqrt() - r
}
fn sd_ellipse(px: f32, py: f32, cx: f32, cy: f32, rx: f32, ry: f32, rot: f32) -> f32 {
    let (s, c) = rot.sin_cos();
    let dx = px - cx;
    let dy = py - cy;
    let x = dx * c + dy * s;
    let y = -dx * s + dy * c;
    let k = ((x / rx) * (x / rx) + (y / ry) * (y / ry)).sqrt();
    // approximate signed distance: scale by the smaller radius
    (k - 1.0) * rx.min(ry)
}
fn sd_tri(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) -> f32 {
    let e0 = (bx - ax, by - ay);
    let e1 = (cx - bx, cy - by);
    let e2 = (ax - cx, ay - cy);
    let v0 = (px - ax, py - ay);
    let v1 = (px - bx, py - by);
    let v2 = (px - cx, py - cy);
    let seg = |v: (f32, f32), e: (f32, f32)| {
        let t = clamp01((v.0 * e.0 + v.1 * e.1) / (e.0 * e.0 + e.1 * e.1));
        let qx = v.0 - e.0 * t;
        let qy = v.1 - e.1 * t;
        qx * qx + qy * qy
    };
    let s = (e0.0 * e2.1 - e0.1 * e2.0).signum();
    let d0 = seg(v0, e0);
    let d1 = seg(v1, e1);
    let d2 = seg(v2, e2);
    let c0 = s * (v0.0 * e0.1 - v0.1 * e0.0);
    let c1 = s * (v1.0 * e1.1 - v1.1 * e1.0);
    let c2 = s * (v2.0 * e2.1 - v2.1 * e2.0);
    let d = d0.min(d1).min(d2);
    let sgn = if c0 > 0.0 && c1 > 0.0 && c2 > 0.0 { -1.0 } else { 1.0 };
    d.sqrt() * sgn
}

#[inline]
unsafe fn moist_cur() -> *mut f32 {
    if MOIST_CUR { MOIST_B.as_mut_ptr() } else { MOIST_A.as_mut_ptr() }
}
#[inline]
unsafe fn moist_nxt() -> *mut f32 {
    if MOIST_CUR { MOIST_A.as_mut_ptr() } else { MOIST_B.as_mut_ptr() }
}

// ---------------------------------------------------------------- exports

#[no_mangle]
pub unsafe extern "C" fn init(w: u32, h: u32, seed: u32) -> u32 {
    let mut w = w as usize;
    let mut h = h as usize;
    if w < 8 { w = 8; }
    if h < 8 { h = 8; }
    while w * h > MAX_N {
        w = w * 7 / 8;
        h = h * 7 / 8;
    }
    W = w;
    H = h;
    N = w * h;
    SEED = seed;
    RNG = seed.wrapping_mul(2654435761) ^ 0x9e3779b9;
    if RNG == 0 { RNG = 1; }
    TIME = 0.0;
    EYE_P = 0.0;
    EYE_FORCE = 0.0;
    REVEAL = 0.0;
    AMBIENT = 1.0;
    LS = 0.0;
    LX = -1e9;
    VIS_BEAM = 0.0;
    VIS_TOTAL = 0.0;
    MOIST_CUR = false;
    for wk in WALK.iter_mut() { *wk = DEAD; }
    EDGE_COUNT = 0;

    let wf = w as f32;
    let hf = h as f32;
    let s = wf.min(hf);
    CAT_S = s;
    REL = s / 320.0;
    let rel = REL;

    // ---- pose, varied a little per seed
    let j = |k: u32| hash2(k as i32, 17, seed) * 2.0 - 1.0;
    let cx = wf * 0.5 + j(1) * wf * 0.05;
    let cy = hf * 0.52 + j(2) * hf * 0.03;
    CAT_CX = cx;
    CAT_CY = cy;
    let side = if hash2(3, 3, seed) > 0.5 { 1.0 } else { -1.0 };
    let lean = j(4) * 0.12; // body lean (radians)
    // body: upright ellipse, sitting
    let bcx = cx;
    let bcy = cy + 0.09 * s;
    let brx = 0.145 * s * (1.0 + j(5) * 0.08);
    let bry = 0.195 * s * (1.0 + j(6) * 0.06);
    // head
    let hr = 0.098 * s * (1.0 + j(7) * 0.06);
    let hcx = cx - lean * 0.9 * s * 0.5 + j(8) * 0.015 * s;
    let hcy = cy - 0.155 * s;
    // ears
    let ear_h = 0.115 * s;
    let ear_tilt = j(9) * 0.25;
    let mut ears = [(0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32); 2];
    for (k, e) in ears.iter_mut().enumerate() {
        let sd = if k == 0 { -1.0 } else { 1.0 };
        let ang = -PI / 2.0 + sd * 0.72 + ear_tilt * sd;
        let bx0 = hcx + hr * 0.92 * (ang - 0.42).cos();
        let by0 = hcy + hr * 0.92 * (ang - 0.42).sin();
        let bx1 = hcx + hr * 0.92 * (ang + 0.42).cos();
        let by1 = hcy + hr * 0.92 * (ang + 0.42).sin();
        let ax = hcx + (hr + ear_h) * (ang + sd * 0.05).cos();
        let ay = hcy + (hr + ear_h) * (ang + sd * 0.05).sin();
        *e = (ax, ay, bx0, by0, bx1, by1);
    }
    // the ear whose top the title crack traces
    EAR_X = ears[1].0;
    EAR_Y = ears[1].1;
    // tail: a chain of circles that leaves the base of the body and curls out and up
    let tail_n = 30;
    let t_sx = bcx + side * brx * 0.55;
    let t_sy = bcy + bry * 0.78;
    let curl = 2.9 + j(10) * 0.4;
    let t_rad = 0.14 * s * (1.0 + j(13) * 0.12);
    let t_ccx = t_sx + side * t_rad; // arc centre, to the side of the start point
    let t_ccy = t_sy - t_rad * 0.12;
    // eye
    let eside = if hash2(11, 11, seed) > 0.5 { 1.0 } else { -1.0 };
    let ex = hcx + eside * hr * 0.38;
    let ey = hcy - hr * 0.05 + j(12) * hr * 0.06;
    let er = hr * 0.30;
    EYE_X = ex;
    EYE_Y = ey;
    EYE_R = er;
    EYE_IDX = (ey as usize).min(h - 1) * w + (ex as usize).min(w - 1);

    let nscale = 1.0 / (s * 0.09);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            // ---- cat SDF
            let mut d = sd_ellipse(px, py, bcx, bcy, brx, bry, lean);
            d = smin(d, sd_circle(px, py, hcx, hcy, hr), 0.05 * s);
            for e in ears.iter() {
                d = smin(d, sd_tri(px, py, e.0, e.1, e.2, e.3, e.4, e.5), 0.02 * s);
            }
            let mut dt = 1e9f32;
            for k in 0..tail_n {
                let t = k as f32 / (tail_n - 1) as f32;
                // start at angle pointing from arc centre back to the start point, sweep downward then up
                let th = if side > 0.0 { PI - t * curl } else { t * curl };
                let rr = t_rad * (1.0 - 0.12 * t);
                let tx = t_ccx + rr * th.cos();
                let ty = t_ccy + rr * th.sin();
                let cr = 0.042 * s * (1.0 - 0.5 * t);
                dt = smin(dt, sd_circle(px, py, tx, ty, cr), 0.015 * s);
            }
            d = smin(d, dt, 0.03 * s);
            // wobble the silhouette a little so it reads as damp, not vector art
            d += fbm(px * nscale, py * nscale, seed ^ 0x51, 3) * 0.012 * s;
            SDF[i] = d;
            let cat = smooth(1.8, -1.8, d);
            CAT[i] = cat;
            let band = (-(d * d) / (12.0 * rel * rel)).exp(); // ~3.5 cells wide on the reference wall
            let band = if band < 3e-3 { 0.0 } else { band };
            EDGE[i] = band;
            // eye
            let de = sd_circle(px, py, ex, ey, er);
            EYE[i] = smooth(1.2, -1.2, de);
            let hr2 = (de + er).max(0.0);
            // flush tiny values to exactly zero: subnormal floats cost ~100 cycles each in the render loop
            let halo = (-(hr2 * hr2) / (2.0 * (er * 1.15) * (er * 1.15))).exp() * (1.0 - EYE[i]);
            HALO[i] = if halo < 3e-3 { 0.0 } else { halo };
            // seepage source: whole body seeps, the outline seeps most
            let nv = fbm(px * nscale * 0.55, py * nscale * 0.55, seed ^ 0x77, 3) * 0.5 + 0.5;
            let var = 0.25 + 1.1 * nv * nv;
            let s_in = cat * 0.75 * var;
            let s_edge = band * 0.55;
            let s_eye = EYE[i] * 0.3;
            SRC[i] = (s_in + s_edge + s_eye).min(1.6);
            // wall grain: fine + coarse
            let fine = hash2(x as i32, y as i32, seed ^ 0xabc) * 2.0 - 1.0;
            let mid = fbm(px * 0.11, py * 0.11, seed ^ 0x99, 2);
            let coarse = fbm(px * nscale * 0.35, py * nscale * 0.35, seed ^ 0x33, 3);
            // trowel sweeps: anisotropic low-frequency arcs
            let sa = fbm(px * 0.012 + py * 0.05, py * 0.012 - px * 0.03, seed ^ 0x44, 2);
            let strokes = (sa * 9.0).sin() * 0.5 * (0.4 + 0.6 * (fbm(px * 0.02, py * 0.02, seed ^ 0x55, 2) * 0.5 + 0.5));
            GRAIN[i] = fine * 0.5 + mid * 0.55 + coarse * 0.9 + strokes * 0.45;
            THICK[i] = 1.0 + coarse * 0.06 + fine * 0.02;
            MOIST_A[i] = 0.0;
            MOIST_B[i] = 0.0;
            CRACK[i] = 0.0;
            FRESH[i] = 0.0;
            if band > 0.55 && x > 1 && y > 1 && x < w - 2 && y < h - 2 && EDGE_COUNT < MAX_EDGE {
                EDGE_LIST[EDGE_COUNT] = i as u32;
                EDGE_COUNT += 1;
            }
        }
    }
    // border thickness matches neighbours so the diffusion border copy looks flat
    PIX.as_ptr() as u32
}

#[no_mangle]
pub unsafe extern "C" fn width() -> u32 { W as u32 }
#[no_mangle]
pub unsafe extern "C" fn height() -> u32 { H as u32 }
#[no_mangle]
pub unsafe extern "C" fn pixels_ptr() -> u32 { PIX.as_ptr() as u32 }
#[no_mangle]
pub unsafe extern "C" fn visibility() -> f32 { VIS_BEAM }
#[no_mangle]
pub unsafe extern "C" fn total_visibility() -> f32 { VIS_TOTAL }
#[no_mangle]
pub unsafe extern "C" fn eye_x() -> f32 { EYE_X }
#[no_mangle]
pub unsafe extern "C" fn eye_y() -> f32 { EYE_Y }
#[no_mangle]
pub unsafe extern "C" fn cat_cx() -> f32 { CAT_CX }
#[no_mangle]
pub unsafe extern "C" fn cat_cy() -> f32 { CAT_CY }
#[no_mangle]
pub unsafe extern "C" fn cat_size() -> f32 { CAT_S }
#[no_mangle]
pub unsafe extern "C" fn ear_x() -> f32 { EAR_X }
#[no_mangle]
pub unsafe extern "C" fn ear_y() -> f32 { EAR_Y }

#[no_mangle]
pub unsafe extern "C" fn set_lantern(x: f32, y: f32, r: f32, strength: f32) {
    LX = x;
    LY = y;
    LR = r.max(1.0);
    LS = strength.max(0.0);
}
#[no_mangle]
pub unsafe extern "C" fn set_ambient(a: f32) { AMBIENT = a.max(0.0); }
#[no_mangle]
pub unsafe extern "C" fn set_eye(f: f32) { EYE_FORCE = clamp01(f); }
#[no_mangle]
pub unsafe extern "C" fn set_reveal(r: f32) { REVEAL = clamp01(r); }

/// Sample the cat mask at a cell (for the JS auto-player / aiming). 0..1
#[no_mangle]
pub unsafe extern "C" fn cat_at(x: f32, y: f32) -> f32 {
    let xi = (x as i32).clamp(0, W as i32 - 1) as usize;
    let yi = (y as i32).clamp(0, H as i32 - 1) as usize;
    CAT[yi * W + xi].max(EDGE[yi * W + xi])
}

/// How much is showing at a cell (stain / crack / eye), 0..1. For bots and hints.
#[no_mangle]
pub unsafe extern "C" fn show_at(x: f32, y: f32) -> f32 {
    let xi = (x as i32).clamp(0, W as i32 - 1) as usize;
    let yi = (y as i32).clamp(0, H as i32 - 1) as usize;
    let i = yi * W + xi;
    let m = *moist_cur().add(i);
    let t = THICK[i];
    let wet = m / (0.25 + 0.75 * t);
    let stain = smooth(0.26, 1.05, wet);
    let eyeshow = EYE[i] * clamp01((EYE_P + 0.45 - t) * 1.3);
    stain.max(CRACK[i]).max(eyeshow)
}

fn spawn_walker(i: usize, w: usize, life: i32) {
    unsafe {
        let x = (i % w) as f32 + 0.5;
        let y = (i / w) as f32 + 0.5;
        for wk in WALK.iter_mut() {
            if !wk.active {
                let a = rnd() * 2.0 * PI;
                *wk = Walker {
                    x,
                    y,
                    dx: a.cos(),
                    dy: a.sin(),
                    sign: if rnd() < 0.5 { -1.0 } else { 1.0 },
                    life,
                    acc: 0.0,
                    active: true,
                };
                return;
            }
        }
    }
}

unsafe fn walker_step(wk: &mut Walker, jitter: f32, block: f32) {
    let w = W;
    let h = H;
    let xi = wk.x as i32;
    let yi = wk.y as i32;
    if xi < 1 || yi < 1 || xi >= w as i32 - 1 || yi >= h as i32 - 1 {
        wk.active = false;
        return;
    }
    let i = yi as usize * w + xi as usize;
    // deposit
    let c = 0.78 + rnd() * 0.22;
    if CRACK[i] < c { CRACK[i] = c; }
    // a faint bleed into the neighbours: keeps the hairline from aliasing without fattening it
    for &n in [i - 1, i + 1, i - w, i + w].iter() {
        let v = 0.09 + rnd() * 0.07;
        if CRACK[n] < v { CRACK[n] = v; }
    }
    // thick plaster blocks cracks
    if THICK[i] > 1.45 && rnd() < block {
        wk.active = false;
        return;
    }
    // direction: follow the boundary of the cat
    let gx = SDF[i + 1] - SDF[i - 1];
    let gy = SDF[i + w] - SDF[i - w];
    let gl = (gx * gx + gy * gy).sqrt().max(1e-4);
    let (gx, gy) = (gx / gl, gy / gl);
    let d = SDF[i];
    let tx = -gy * wk.sign;
    let ty = gx * wk.sign;
    let pull = (-d * 0.35).clamp(-1.0, 1.0);
    let jx = (rnd() * 2.0 - 1.0) * jitter;
    let jy = (rnd() * 2.0 - 1.0) * jitter;
    let mut dx = wk.dx * 0.5 + tx * 0.62 + gx * pull + jx;
    let mut dy = wk.dy * 0.5 + ty * 0.62 + gy * pull + jy;
    let l = (dx * dx + dy * dy).sqrt().max(1e-4);
    dx /= l;
    dy /= l;
    wk.dx = dx;
    wk.dy = dy;
    wk.x += dx;
    wk.y += dy;
    wk.life -= 1;
    if wk.life <= 0 { wk.active = false; }
    if rnd() < 0.012 { wk.sign = -wk.sign; }
}

#[no_mangle]
pub unsafe extern "C" fn step(dt_ms: f32, difficulty: f32) {
    let w = W;
    let h = H;
    if w == 0 { return; }
    let dt = (dt_ms / 1000.0).clamp(0.0, 0.05);
    let d = difficulty.max(0.0);
    TIME += dt;
    EYE_P = 0.06 + 1.15 * d;

    let seep = 0.09 + 0.17 * d;
    let crack_seep = 0.9 * REL; // one-cell cracks are relatively wider on coarse grids
    let decay = 0.09;
    let diff = (1.6 * REL * REL).min(0.24 / dt.max(1e-3)) * dt;
    let eye_burn = (0.012 + 0.075 * d) * dt;
    let cur = moist_cur();
    let nxt = moist_nxt();

    // ---- seep + absorb + eye burn + fresh drying
    for i in 0..N {
        let mut m = *cur.add(i);
        m += (SRC[i] * seep + CRACK[i] * seep * crack_seep) * dt;
        m -= m * decay * dt;
        if m < 1e-5 { m = 0.0; } // flush to zero (denormals are slow)
        *cur.add(i) = m;
        let c = CRACK[i];
        if c > 0.0 && c < 1e-3 { CRACK[i] = 0.0; }
        let e = EYE[i];
        if e > 0.0 {
            let t = THICK[i] - e * eye_burn;
            THICK[i] = t.max(0.15);
        }
        let f = FRESH[i];
        if f > 0.0 { FRESH[i] = if f < 2e-3 { 0.0 } else { f - f * 0.28 * dt }; }
    }
    // ---- diffusion (interior), borders copied
    for y in 1..h - 1 {
        let row = y * w;
        for x in 1..w - 1 {
            let i = row + x;
            let m = *cur.add(i);
            let lap = *cur.add(i - 1) + *cur.add(i + 1) + *cur.add(i - w) + *cur.add(i + w) - 4.0 * m;
            *nxt.add(i) = m + diff * lap;
        }
    }
    for x in 0..w {
        *nxt.add(x) = *nxt.add(x + w);
        *nxt.add((h - 1) * w + x) = *nxt.add((h - 2) * w + x);
    }
    for y in 0..h {
        *nxt.add(y * w) = *nxt.add(y * w + 1);
        *nxt.add(y * w + w - 1) = *nxt.add(y * w + w - 2);
    }
    MOIST_CUR = !MOIST_CUR;
    let cur = moist_cur();

    // ---- crack spawning along the damp outline
    let rate = (0.45 + 2.6 * d) * dt;
    let mut budget = rate;
    while budget > 0.0 {
        if rnd() < budget.min(1.0) {
            for _ in 0..5 {
                if EDGE_COUNT == 0 { break; }
                let i = EDGE_LIST[(rnd() * EDGE_COUNT as f32) as usize % EDGE_COUNT] as usize;
                if *cur.add(i) > 0.20 && CRACK[i] < 0.4 && THICK[i] < 1.45 {
                    spawn_walker(i, w, ((18.0 + rnd() * 50.0) * REL) as i32 + 4);
                    break;
                }
            }
        }
        budget -= 1.0;
    }
    // ---- walkers
    let step_ms = (30.0 - 13.0 * d.min(1.0)) / REL;
    let jitter = 0.45;
    for wk in WALK.iter_mut() {
        if !wk.active { continue; }
        wk.acc += dt_ms.min(50.0);
        while wk.acc >= step_ms && wk.active {
            wk.acc -= step_ms;
            walker_step(wk, jitter, 0.55);
        }
    }
}

/// Deposit plaster in a soft disc. Returns the amount actually laid (for the bucket).
#[no_mangle]
pub unsafe extern "C" fn plaster(x: f32, y: f32, radius: f32, amount: f32) -> f32 {
    let w = W as i32;
    let h = H as i32;
    if w == 0 { return 0.0; }
    let r = radius.max(0.5);
    let x0 = ((x - r).floor() as i32).max(0);
    let x1 = ((x + r).ceil() as i32).min(w - 1);
    let y0 = ((y - r).floor() as i32).max(0);
    let y1 = ((y + r).ceil() as i32).min(h - 1);
    let cur = moist_cur();
    let mut spent = 0.0;
    let r2 = r * r;
    for yy in y0..=y1 {
        for xx in x0..=x1 {
            let dx = xx as f32 + 0.5 - x;
            let dy = yy as f32 + 0.5 - y;
            let q = (dx * dx + dy * dy) / r2;
            if q >= 1.0 { continue; }
            let k = (1.0 - q) * (1.0 - q) * amount;
            let i = (yy * w + xx) as usize;
            let t = THICK[i];
            THICK[i] = (t + k * 0.6).min(2.6);
            let cover = (k * 1.6).min(1.0);
            *cur.add(i) *= 1.0 - 0.9 * cover;
            CRACK[i] *= 1.0 - 0.92 * cover;
            FRESH[i] = (FRESH[i] + cover).min(1.0);
            spent += k;
        }
    }
    spent
}

/// The officer raps the wall: cracks shake loose along the outline near (x, y).
#[no_mangle]
pub unsafe extern "C" fn rap(x: f32, y: f32, strength: f32) {
    let w = W;
    if w == 0 || EDGE_COUNT == 0 { return; }
    let n = 3 + (strength * 7.0) as i32;
    let reach = CAT_S * 0.55;
    let mut placed = 0;
    let mut tries = 0;
    while placed < n && tries < 400 {
        tries += 1;
        let i = EDGE_LIST[(rnd() * EDGE_COUNT as f32) as usize % EDGE_COUNT] as usize;
        let cx = (i % w) as f32;
        let cy = (i / w) as f32;
        let dd = ((cx - x) * (cx - x) + (cy - y) * (cy - y)).sqrt();
        if dd < reach || tries > 250 {
            if THICK[i] < 1.6 {
                spawn_walker(i, w, ((14.0 + rnd() * 36.0 * strength) * REL) as i32 + 4);
                placed += 1;
            }
        }
    }
    // existing cracks weep a little more
    let cur = moist_cur();
    for i in 0..N {
        let c = CRACK[i];
        if c > 0.2 { *cur.add(i) += c * 0.12 * strength; }
    }
}

/// Dress the wall for the title frame: eye faintly through, one hairline along an ear.
#[no_mangle]
pub unsafe extern "C" fn title_dress() {
    let w = W;
    if w == 0 { return; }
    EYE_FORCE = 0.0;
    EYE_P = 0.42;
    // thin the plaster over the eye so it bleeds faintly through
    for i in 0..N {
        if EYE[i] > 0.0 { THICK[i] -= EYE[i] * 0.3; }
    }
    // a little damp around the head and the ear tip
    let cur = moist_cur();
    let ex = EAR_X;
    let ey = EAR_Y;
    for y in 0..H {
        for x in 0..w {
            let i = y * w + x;
            let dx = x as f32 - ex;
            let dy = y as f32 - ey;
            let dd = (dx * dx + dy * dy).sqrt() / (CAT_S * 0.12);
            let k = (-(dd * dd)).exp();
            *cur.add(i) += k * 0.45 * (0.6 + 0.4 * EDGE[i]);
        }
    }
    // the crack: start on the ear boundary near the tip and walk it
    let mut best = usize::MAX;
    let mut bd = 1e9f32;
    for k in 0..EDGE_COUNT {
        let i = EDGE_LIST[k] as usize;
        let dx = (i % w) as f32 - ex;
        let dy = (i / w) as f32 - ey;
        let dd = dx * dx + dy * dy;
        if dd < bd { bd = dd; best = i; }
    }
    if best != usize::MAX {
        spawn_walker(best, w, 40 + (CAT_S * 0.22) as i32);
        for wk in WALK.iter_mut() {
            if wk.active {
                let mut steps = 0;
                while wk.active && steps < 400 {
                    walker_step(wk, 0.3, 0.0);
                    steps += 1;
                }
            }
        }
    }
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }

#[no_mangle]
pub unsafe extern "C" fn render() {
    let w = W;
    let h = H;
    if w == 0 { return; }
    let cur = moist_cur();
    let inv_w = 1.0 / w as f32;
    let inv_h = 1.0 / h as f32;
    let lr2 = 1.0 / (LR * LR);
    let ls = LS;
    let amb = AMBIENT;
    let eye_p = EYE_P;
    let eye_force = EYE_FORCE;
    let reveal = REVEAL;
    let rel = REL;
    // eye core brightness (drives the halo)
    let t_eye = THICK[EYE_IDX];
    let core = clamp01((eye_p + 0.45 - t_eye) * 1.3).max(eye_force);
    let core = core.max(reveal);
    let flick = 1.0 + 0.05 * (TIME * 9.0).sin() * (TIME * 2.3).cos();

    let mut sum_show_b = 0.0f32;
    let mut sum_cat_b = 0.0f32;
    let mut sum_b = 0.0f32;
    let mut sum_show_c = 0.0f32;
    let mut sum_c = 0.0f32;

    for y in 0..h {
        let fy = (y as f32 + 0.5) * inv_h - 0.5;
        let dy = y as f32 + 0.5 - LY;
        let row = y * w;
        let ym = if y > 0 { row - w } else { row };
        let yp = if y + 1 < h { row + w } else { row };
        for x in 0..w {
            let i = row + x;
            let fx = (x as f32 + 0.5) * inv_w - 0.5;
            let t = THICK[i];
            let m = *cur.add(i);
            let c = CRACK[i];
            let g = GRAIN[i];
            let f = FRESH[i];
            let e = EYE[i];
            let ha = HALO[i];
            let cat = CAT[i];

            let wet = m / (0.25 + 0.75 * t);
            let stain = smooth(0.26, 1.05, wet) * 0.9;
            let eyeshow = e * clamp01((eye_p + 0.45 - t) * 1.3).max(eye_force).max(reveal);
            // lumps: shade by thickness gradient, only where the coat is heavy
            let xm = if x > 0 { i - 1 } else { i };
            let xp = if x + 1 < w { i + 1 } else { i };
            let lumpf = smooth(1.1, 1.65, t);
            // gradient over two cells: scaled by REL so a stroke lumps the same on any grid
            let grad = (THICK[ym + (xm - row)] - THICK[yp + (xp - row)]) * 1.6 * rel;
            let shade = grad.clamp(-0.6, 0.6) * lumpf;

            // ---- base plaster colour
            let thin = smooth(1.0, 0.3, t) * 0.75;
            let mut r = lerp(233.0, 138.0, thin);
            let mut gg = lerp(223.0, 122.0, thin);
            let mut b = lerp(201.0, 100.0, thin);
            let gr = g * 9.0;
            r += gr; gg += gr; b += gr * 0.9;
            // fresh coat is greyer and darker until it dries
            let fw = f * 0.42;
            r = lerp(r, 208.0, fw); gg = lerp(gg, 199.0, fw); b = lerp(b, 184.0, fw);
            // damp stain
            r = lerp(r, 70.0, stain); gg = lerp(gg, 52.0, stain); b = lerp(b, 36.0, stain);
            // hairline cracks
            r = lerp(r, 22.0, c); gg = lerp(gg, 17.0, c); b = lerp(b, 13.0, c);
            // lump shading
            let sh = 1.0 + shade;
            r *= sh; gg *= sh; b *= sh;
            // the reveal: the wall gives up its shape
            if reveal > 0.0 {
                let k = cat * reveal;
                r = lerp(r, 16.0, k); gg = lerp(gg, 12.0, k); b = lerp(b, 10.0, k);
            }

            // ---- light
            let vig = (fx * fx * 1.35 + fy * fy) * 1.7;
            let vig = if vig > 1.0 { 1.0 } else { vig };
            let a = amb * (1.0 - 0.38 * vig) * 0.84;
            let dx = x as f32 + 0.5 - LX;
            let q = (dx * dx + dy * dy) * lr2;
            let l = if q < 1.0 { let u = 1.0 - q; u * u * (1.0 + 0.6 * u) * 0.75 * ls * flick } else { 0.0 };
            let lr_ = a + l * 0.42;
            let lg_ = a * 0.965 + l * 0.33;
            let lb_ = a * 0.90 + l * 0.18;
            let mut or = r * lr_;
            let mut og = gg * lg_;
            let mut ob = b * lb_;
            // the eye is emissive: it does not need the lantern
            let glow = eyeshow * 0.9 + ha * core * core * (0.3 + 0.7 * eye_force);
            if glow > 0.0 {
                // iris: brighter toward the pupil, darker at the rim
                let ex = x as f32 + 0.5 - EYE_X;
                let ey = y as f32 + 0.5 - EYE_Y;
                let rr = (ex * ex + ey * ey) / (EYE_R * EYE_R);
                let iris = 1.0 - 0.5 * rr;
                let open = eye_force.max(reveal);
                let pw = EYE_R * (0.16 + 0.42 * open);
                let ph = EYE_R * 0.82;
                let pq = (ex * ex) / (pw * pw) + (ey * ey) / (ph * ph);
                let pupil = clamp01((1.0 - pq) * 4.0) * e;
                let gk = (glow * (0.55 + 0.45 * eyeshow)).min(1.0);
                let ir = 150.0 + 60.0 * iris;
                let ig = 190.0 + 50.0 * iris;
                let ib = 40.0 + 30.0 * iris;
                or = lerp(or, ir, gk) + 20.0 * glow * eyeshow;
                og = lerp(og, ig, gk) + 16.0 * glow * eyeshow;
                ob = lerp(ob, ib, gk);
                let pk = pupil * eyeshow;
                or = lerp(or, 10.0, pk); og = lerp(og, 9.0, pk); ob = lerp(ob, 7.0, pk);
                // glint
                let gx = ex + EYE_R * 0.38; let gy = ey + EYE_R * 0.40;
                let gl = clamp01(1.0 - (gx * gx + gy * gy) / (EYE_R * EYE_R * 0.05)) * eyeshow * 0.8;
                or += 90.0 * gl; og += 90.0 * gl; ob += 70.0 * gl;
            }
            let o = i * 4;
            PIX[o] = if or > 255.0 { 255 } else { or as u8 };
            PIX[o + 1] = if og > 255.0 { 255 } else { og as u8 };
            PIX[o + 2] = if ob > 255.0 { 255 } else { ob as u8 };
            PIX[o + 3] = 255;

            // ---- visibility bookkeeping
            let show = (stain * stain * 1.4).max(c * 0.75).max(eyeshow * 1.6).min(1.0) + lumpf * shade.abs() * 0.7;
            let catish = cat.max(EDGE[i]).max(ha);
            let bw = if q < 1.0 { (1.0 - q) * (1.0 - q) } else { 0.0 };
            sum_b += bw;
            sum_show_b += show * bw;
            sum_cat_b += catish * bw;
            sum_show_c += show * catish;
            sum_c += catish;
        }
    }
    VIS_BEAM = if ls > 0.0 && sum_b > 0.0 {
        // "how much of the cat is showing under the lantern": normalised by the cat area in the
        // beam, floored by a slice of the beam and by a slice of the WHOLE cat so that a few
        // marks on a narrow part (the ears) do not read as a full reveal
        let denom = (sum_cat_b * 0.85).max(sum_b * 0.10).max(sum_c * 0.12);
        (sum_show_b / denom).min(1.0)
    } else { 0.0 };
    VIS_TOTAL = if sum_c > 0.0 { (sum_show_c / sum_c).min(1.0) } else { 0.0 };
}
