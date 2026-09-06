/* The Vortex — GLSL sources (WebGL2 / GLSL ES 3.00).
 * Every particle position is computed here, in the vertex shader, from a
 * per-particle seed and the vortex time. No CPU simulation.
 */

export const COMMON = `
const float PI  = 3.14159265;
const float RC  = 0.06;    // core radius
const float PEX = 0.65;    // radial drift exponent: r = (1-u)^PEX
const float WRIM = 0.36;   // rim angular velocity (rad / vortex-second)
float funnelZ(float r){ return -(0.8*(1.0-r) + 0.03*(1.0/r - 1.0)); }
`;

export const PARTICLE_VS = `#version 300 es
precision highp float;
in vec4 aSeed;
uniform mat4  uVP;
uniform float uTau;       // vortex time
uniform float uFlat;      // funnel depth scale (1 = full, ~0 = slack water)
uniform float uProj;      // px per world unit at w=1
uniform float uSizeMul;
uniform float uMoonAz;
uniform float uMoonLit;   // 0..1
uniform float uStreak;    // tau offset for the ghost draw
uniform float uFrac;      // brightness multiplier for this draw
uniform float uDive;      // 0..1 during the lose dive
uniform vec3  uCam;
out vec3 vCol;
${COMMON}
void main(){
  float s0=aSeed.x, s1=aSeed.y, s2=aSeed.z, s3=aSeed.w;
  float tau = uTau + uStreak;
  vec3 pos; float bright; float size; vec3 col; float u = 0.0;
  if (s3 < 0.80) {
    // ---- funnel wall particle ---------------------------------------
    float L = mix(14.0, 34.0, s1);                 // lifetime in vortex-seconds
    u = fract(s0 + tau / L);
    float rr = pow(1.0 - u, PEX);
    float r  = mix(RC, 1.0, rr);
    // closed-form integral of (omega(r)/omega_rim - 1) over the life
    float G  = (1.0 - pow(1.0 - u, 1.0 - PEX)) / (1.0 - PEX) - u;
    float th = s2 * 2.0 * PI + WRIM * tau + L * WRIM * G;
    // ripple bands riding the wall
    float wave = 0.010 * sin(th * 9.0 - tau * 2.6 + s1 * 6.0)
               + 0.005 * sin(th * 23.0 + tau * 4.0 + s0 * 9.0);
    r += wave * (1.0 - u) * uFlat;
    float z = funnelZ(r) * uFlat;
    float jit = (fract(s0 * 77.7 + s1 * 13.1) - 0.5) * 0.06;
    pos = vec3(r * cos(th), r * sin(th), z + jit * (0.35 + 0.6 * u) * uFlat);
    bright = mix(1.0, 0.22, u);
    // spiral foam bands, slowly turning with the rim: the classic whirlpool streaks;
    // at the slack of the tide they settle into gentle concentric rings
    float band = sin((th - WRIM * tau) * 5.0 + log(r) * 14.0 + s0 * 0.4);
    float ring = sin(r * 36.0 - tau * 0.8 + s0 * 0.3);
    band = mix(band, ring, uMoonLit);
    bright *= 0.45 + 0.75 * smoothstep(-0.2, 0.9, band);
    size   = mix(1.0, 0.5, u) * (0.6 + 0.8 * fract(s1 * 41.3));
    col = mix(vec3(0.82, 1.0, 0.90), vec3(0.12, 0.32, 0.72), smoothstep(0.08, 0.85, u));
    col = mix(col, vec3(0.80, 0.86, 0.92), uMoonLit * 0.8);   // calm silver water at the slack
    // foam crests: a subset near the rim burns white
    float crest = step(0.86, fract(s2 * 53.7)) * (1.0 - smoothstep(0.0, 0.35, u));
    col = mix(col, vec3(1.0, 1.0, 0.97), crest);
    bright *= 1.0 + crest * 1.2;
    bright *= smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.86, 1.0, u));
  } else {
    // ---- open sea beyond the rim -------------------------------------
    float q = fract(s3 * 37.1);
    float r = 1.02 + 3.4 * q * q;
    float th = s2 * 2.0 * PI + WRIM * tau * 0.55 / r;
    float z = 0.018 * sin(th * 6.0 + tau * 1.4 + s1 * 10.0)
            + 0.012 * sin(r * 22.0 - tau * 1.8 + s0 * 4.0);
    pos = vec3(r * cos(th), r * sin(th), z * (0.4 + 0.6 * uFlat));
    bright = 1.3 / (r * r);
    size = 1.0;
    col = vec3(0.45, 0.66, 0.85);
    // foam ring right at the rim
    float ring = 1.0 - smoothstep(0.0, 0.10, r - 1.02);
    col = mix(col, vec3(0.9, 1.0, 0.95), ring);
    bright += ring * 0.8;
  }
  // moonlight: the wall under the moon is lit, with rays streaming down it
  float ang = atan(pos.y, pos.x);
  float side = 0.5 + 0.5 * cos(ang - uMoonAz);
  float rays = pow(max(0.0, cos((ang - uMoonAz) * 9.0 + sin(tau * 0.15) * 0.5)), 30.0);
  float depthFade = clamp(1.0 + pos.z / 1.3, 0.0, 1.0);
  bright *= (0.45 + 0.55 * side + rays * 1.1 * depthFade) * (0.75 + 0.55 * uMoonLit) * (1.0 - 0.4 * uMoonLit);
  // gold on the lit rim
  col = mix(col, vec3(1.0, 0.86, 0.55), side * 0.35 * (1.0 - u) * (1.0 - smoothstep(0.0, 0.25, u)) * step(s3, 0.8));
  // at the slack the moon's path lies across the calm water: the rings under it turn gold
  float lineD = abs(pos.x * sin(uMoonAz) - pos.y * cos(uMoonAz));
  float path = exp(-lineD * lineD * 30.0) * (0.55 + 0.45 * cos(ang - uMoonAz)) * uMoonLit * step(s3, 0.8);
  col = mix(col, vec3(1.0, 0.84, 0.50), path * 0.85);
  bright *= 1.0 + path * 0.6;

  vec4 clip = uVP * vec4(pos, 1.0);
  gl_Position = clip;
  float w = max(clip.w, 0.05);
  float ps = size * uSizeMul * uProj / w * (1.0 + uDive * 0.5);
  gl_PointSize = clamp(ps, 1.0, 48.0);
  // fade very-near particles so they never smear the lens
  float near = smoothstep(0.12, 0.45, w);
  float a = bright * near * clamp(ps * 0.6, 0.0, 1.0);
  vCol = col * a * uFrac;
}`;

export const PARTICLE_FS = `#version 300 es
precision mediump float;
in vec3 vCol;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.2) * (1.0 - r2);
  o = vec4(vCol * a, 1.0);
}`;

/* ---- sky + moon: full-screen triangle, ray direction per pixel -------- */
export const SKY_VS = `#version 300 es
precision highp float;
uniform mat4 uInvVP;
out vec3 vWorld;
void main(){
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vec4 w = uInvVP * vec4(p, 1.0, 1.0);
  vWorld = w.xyz / w.w;
  gl_Position = vec4(p, 0.999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3  uCam;
uniform vec3  uMoonDir;
uniform float uMoonLit;
uniform float uT;
uniform float uDark;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float a=0.0, w=0.5; for(int i=0;i<4;i++){ a += w*noise(p); p = p*2.03 + 7.1; w *= 0.5; } return a; }
void main(){
  vec3 d = normalize(vWorld - uCam);
  float el = d.z;
  float az = atan(d.y, d.x);
  vec3 skyTop = vec3(0.012, 0.018, 0.040);
  vec3 skyHor = vec3(0.055, 0.080, 0.125);
  vec3 col = mix(skyHor, skyTop, clamp(el * 3.5, 0.0, 1.0));
  // storm clouds streaming
  vec2 cp = vec2(az * 2.2 + uT * 0.025, el * 7.0 + uT * 0.006);
  float n = fbm(cp) * 0.7 + fbm(cp * 2.7 + 3.0) * 0.3;
  float cloud = smoothstep(0.38, 0.72, n) * (1.0 - uMoonLit * 0.75) * smoothstep(-0.02, 0.06, el);
  col = mix(col, vec3(0.13, 0.145, 0.175), cloud * 0.85);
  // the moon
  float ang = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(0.058, 0.064, ang);
  float halo = exp(-ang * 6.0) * 0.6 + exp(-ang * 2.0) * 0.18 + exp(-ang * 0.8) * 0.06;
  vec3 moonCol = vec3(1.0, 0.97, 0.88);
  vec3 gold = vec3(0.98, 0.80, 0.46);
  float veil = 1.0 - cloud * 0.55;
  col += moonCol * disc * veil * (0.9 + 0.35 * uMoonLit);
  col += gold * halo * veil * (0.75 + 0.7 * uMoonLit);
  // horizon haze
  col += vec3(0.30, 0.36, 0.42) * exp(-abs(el) * 22.0) * 0.18;
  // below the horizon: black water, a moon-path glitter
  if (el < 0.0) {
    float hz = smoothstep(0.0, -0.04, el);
    vec3 water = mix(vec3(0.006, 0.012, 0.024), vec3(0.04, 0.06, 0.10), exp(el * 9.0));
    col = mix(col, water, hz);
    float daz = abs(atan(sin(az - atan(uMoonDir.y, uMoonDir.x)), cos(az - atan(uMoonDir.y, uMoonDir.x))));
    col += gold * 0.16 * exp(-daz * 4.0) * exp(el * 10.0) * (0.6 + 0.6 * uMoonLit);
  }
  o = vec4(col * (1.0 - uDark), 1.0);
}`;

/* ---- funnel floor: a GPU-independent whirlpool under the particles ------
 * Same full-screen triangle and unprojection as the sky. Each ray is dropped
 * onto the z=0 plane, then marched down the funnel surface z = funnelZ(r)*flat
 * (a short adaptive march + bisection); the hit is shaded as dark water falling
 * into black, with log-spiral foam bands that turn with the rim, the moon's
 * rays down the wall and a lighter rim. uMoonLit cross-fades it to the calm
 * silver disc of the slack, uDive/uDark darken it on the way into the gulf.
 * Particles (24k or 300k) sit on top as sparkle; the composition is this. */
export const FUNNEL_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3  uCam;
uniform float uTau;
uniform float uFlat;
uniform float uMoonAz;
uniform float uMoonLit;
uniform float uDark;
uniform float uDive;
out vec4 o;
${COMMON}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float surf(vec2 xy){ return funnelZ(max(length(xy), RC)) * uFlat; }
void main(){
  vec3 d = normalize(vWorld - uCam);
  bool inside = uCam.z < 0.0 && length(uCam.xy) < 1.0;   // the eye has gone down into the funnel
  float t; vec3 p;
  if (!inside) {
    if (d.z > -0.002) discard;                            // sky
    t = -uCam.z / d.z; p = uCam + d * t;                  // where the ray meets the sea level
    if (length(p.xy) > 1.12) discard;                     // open sea: the sky pass painted it
  } else { t = 0.0; p = uCam; }
  float gap = p.z - surf(p.xy);
  float dt = 0.0; bool hit = false; bool escaped = false;
  float stepK = inside ? 0.7 : 0.45, stepMax = inside ? 0.22 : 0.10;
  for (int i = 0; i < 48; i++) {
    if (gap < 0.0) { hit = true; break; }
    dt = clamp(gap * stepK, 0.004, stepMax);
    t += dt; p = uCam + d * t;
    if (p.z > 0.0 && length(p.xy) > 1.12) { escaped = true; break; }
    gap = p.z - surf(p.xy);
  }
  if (escaped) discard;
  if (hit) {   // refine
    float t0 = t - dt, t1 = t;
    for (int i = 0; i < 5; i++) { float tm = 0.5 * (t0 + t1); vec3 pm = uCam + d * tm; if (pm.z - surf(pm.xy) < 0.0) t1 = tm; else t0 = tm; }
    t = 0.5 * (t0 + t1); p = uCam + d * t;
  }
  float r  = length(p.xy);
  float th = atan(p.y, p.x);
  float wall = clamp((r - RC) / (1.0 - RC), 0.0, 1.0);    // 0 at the core, 1 at the rim
  float deep = clamp(uFlat, 0.0, 1.0);                     // 1 = funnel, ~0 = the calm disc
  float lit  = 0.5 + 0.5 * cos(th - uMoonAz);              // the wall under the moon
  // -- the whirl: dark water sliding into black, with a fine grain so it never bands
  float grain = noise(vec2(th * 9.0 + log(r) * 3.0, log(r) * 16.0 - uTau * 0.7)) * 0.5
              + noise(vec2(th * 31.0 - uTau * 0.4, log(r) * 44.0 - uTau * 1.6)) * 0.5;
  float shade = pow(wall, 1.7) * (0.75 + 0.5 * grain);
  vec3 funnel = mix(vec3(0.0, 0.0, 0.0), vec3(0.075, 0.14, 0.25), shade) * (0.55 + 0.6 * lit);
  // log-spiral foam bands, turning with the rim (the same phase the particles ride)
  float sp = th - WRIM * uTau;
  float band  = sin(sp * 5.0 + log(r) * 14.0);
  float band2 = sin(sp * 11.0 + log(r) * 31.0 + grain * 1.5);
  float foam = smoothstep(0.35, 0.95, band) * (0.55 + 0.45 * smoothstep(-0.2, 0.8, band2)) * pow(wall, 1.3);
  funnel += vec3(0.28, 0.46, 0.46) * foam * (0.28 + 0.34 * lit) * (0.6 + 0.4 * grain);
  // the moon's rays streaming down the wall
  float rays = pow(max(0.0, cos((th - uMoonAz) * 9.0 + sin(uTau * 0.15) * 0.5)), 30.0);
  float depthFade = clamp(1.0 + p.z / 1.3, 0.0, 1.0);
  funnel += vec3(0.62, 0.52, 0.30) * rays * depthFade * pow(wall, 0.8) * 0.36 * (0.6 + 0.4 * lit);
  // -- the slack of the tide: a calm silver disc with the moon's path laid across it
  float rings = 0.5 + 0.5 * sin(r * 36.0 - uTau * 0.8);
  vec3 disc = vec3(0.30, 0.35, 0.41) * (0.70 + 0.30 * wall) * (0.80 + 0.30 * rings) * (0.85 + 0.3 * grain);
  disc += vec3(0.34, 0.38, 0.42) * lit * 0.40;
  float lineD = abs(p.x * sin(uMoonAz) - p.y * cos(uMoonAz));   // distance from the moon's path through the centre
  float path = exp(-lineD * lineD * 28.0) * (0.55 + 0.45 * noise(vec2(r * 40.0 - uTau * 1.5, th * 4.0)));
  path *= 0.55 + 0.45 * cos(th - uMoonAz);                    // brightest under the moon, dying toward the viewer
  disc += vec3(0.98, 0.80, 0.46) * path * 0.9;
  vec3 col = mix(disc, funnel, deep);
  // -- a slightly lighter rim, gold on the moon's side, fading into the open sea
  float rim = 1.0 - smoothstep(0.0, 0.11, abs(r - 1.0));
  col += vec3(0.30, 0.40, 0.40) * rim * (0.35 + 0.35 * deep) * (0.7 + 0.6 * grain);
  col += vec3(0.98, 0.80, 0.46) * rim * lit * 0.32;
  if (!hit) col = vec3(0.0);                                 // straight down the throat
  float alpha = 1.0 - smoothstep(1.04, 1.12, r);
  col *= (1.0 - uDark);
  o = vec4(col, alpha);
}`;

/* ---- glyphs: instanced billboards with SDF silhouettes ------------------ */
export const GLYPH_VS = `#version 300 es
precision highp float;
in vec3  iPos;
in float iSize;
in float iKind;
in float iRot;
in vec4  iCol;
in float iGlow;
uniform mat4 uView;
uniform mat4 uProj;
out vec2  vUv;
out vec4  vCol;
flat out float vKind;
out float vGlow;
void main(){
  vec2 corner = vec2((gl_VertexID == 1 || gl_VertexID == 3) ? 1.0 : -1.0, (gl_VertexID >= 2) ? 1.0 : -1.0);
  vec3 vp = (uView * vec4(iPos, 1.0)).xyz;
  vp.xy += corner * iSize;
  gl_Position = uProj * vec4(vp, 1.0);
  float c = cos(iRot), s = sin(iRot);
  vUv = mat2(c, -s, s, c) * corner;
  vCol = iCol; vKind = iKind; vGlow = iGlow;
}`;

export const GLYPH_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vCol; flat in float vKind; in float vGlow;
out vec4 o;
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
void main(){
  vec2 p = vUv;
  int k = int(vKind + 0.5);
  float d = 1.0;       // signed distance to silhouette (negative inside)
  float detail = 0.0;  // dark detail lines inside
  if (k == 0) {                                   // soft mote
    float r = length(p);
    float core = exp(-r * r * 14.0);
    float halo = exp(-r * 2.6) * 0.55;
    o = vec4(vCol.rgb * (core * 1.6 + halo), (core + halo * 0.5) * vCol.a);
    if (r > 1.0) discard;
    return;
  } else if (k == 1) {                            // cask
    d = sdBox(p, vec2(0.48, 0.30)) - 0.09;
    float bulge = abs(p.y) - (0.33 + 0.06 * (1.0 - p.x * p.x * 4.0));
    d = max(d, bulge);
    detail = max(1.0 - abs(abs(p.x) - 0.22) / 0.03, 0.0);
    detail = max(detail, max(1.0 - abs(p.y) / 0.03, 0.0) * step(0.15, abs(p.x)));
  } else if (k == 2) {                            // spar
    d = sdBox(p, vec2(0.82, 0.055)) - 0.03;
    detail = max(1.0 - abs(p.x + 0.35) / 0.03, 0.0) + max(1.0 - abs(p.x - 0.5) / 0.03, 0.0);
  } else if (k == 3) {                            // buoy (sphere)
    d = length(p) - 0.45;
    float ring = abs(length(p) - 0.30);
    detail = max(1.0 - ring / 0.03, 0.0);
    detail = max(detail, max(1.0 - abs(p.x) / 0.03, 0.0) * step(0.30, abs(p.y)));
  } else if (k == 4) {                            // chest
    d = sdBox(p, vec2(0.46, 0.34)) - 0.04;
    detail = max(1.0 - abs(p.y - 0.10) / 0.03, 0.0);
    detail = max(detail, 1.0 - smoothstep(0.05, 0.09, length(p - vec2(0.0, -0.05))));
  } else if (k == 5) {                            // hull fragment: jagged plank
    d = sdBox(p, vec2(0.62, 0.26));
    float tooth = sin(p.x * 21.0) * 0.08;
    d = max(d, -(p.y - 0.18 + tooth));
    d = max(d, -(-p.y - 0.06 + sin(p.x * 13.0 + 2.0) * 0.1));
    detail = max(1.0 - abs(p.y + 0.02 + sin(p.x * 5.0) * 0.03) / 0.025, 0.0);
  } else if (k == 6) {                            // the smack: half hull + broken mast
    vec2 q = p; q.y += 0.1;
    float hull = length(q / vec2(0.85, 0.50)) - 1.0;
    hull = max(hull, q.y);
    float mast = sdBox(p - vec2(0.05, 0.28), vec2(0.035, 0.36));
    float stump = sdSeg(p, vec2(0.05, 0.62), vec2(0.42, 0.45)) - 0.03;
    d = min(hull, min(mast, stump));
    detail = max(1.0 - abs(q.y + 0.18) / 0.025, 0.0) * step(abs(q.x), 0.7);
  } else if (k == 7) {                            // spinning wreckage
    float a = sdBox(p, vec2(0.75, 0.05));
    vec2 p2 = mat2(0.5, -0.866, 0.866, 0.5) * p;
    float b = sdBox(p2, vec2(0.55, 0.045));
    vec2 p3 = mat2(0.5, 0.866, -0.866, 0.5) * p;
    float c = sdBox(p3 - vec2(0.15, 0.0), vec2(0.45, 0.04));
    d = min(a, min(b, c)) - 0.02;
  } else if (k == 9) {                            // the player: a dark bead with a bright heart and a gold ring
    float r = length(p);
    float body = 1.0 - smoothstep(0.50, 0.56, r);
    float ring = 1.0 - smoothstep(0.03, 0.08, abs(r - 0.62));
    float heart = exp(-r * r * 22.0);
    vec3 rgb = vec3(0.01, 0.02, 0.04) * body + vCol.rgb * ring * 1.2 + vec3(1.0, 0.98, 0.9) * heart * 1.8 + vCol.rgb * heart * 0.5;
    float alpha = max(body * 0.95, max(ring, heart)) * vCol.a;
    if (alpha < 0.01) discard;
    o = vec4(rgb, alpha);
    return;
  } else if (k == 8) {                            // lash ring
    float r = length(p);
    float ring = abs(r - 0.82);
    float dash = 0.5 + 0.5 * sin(atan(p.y, p.x) * 8.0);
    float a = (1.0 - smoothstep(0.02, 0.06, ring)) * (0.55 + 0.45 * dash);
    o = vec4(vCol.rgb, a * vCol.a);
    if (a < 0.01) discard;
    return;
  }
  float aa = fwidth(d) * 1.2 + 0.004;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float edge = 1.0 - smoothstep(0.0, 0.07, abs(d));
  float glow = exp(-max(d, 0.0) * 9.0) * (0.35 + vGlow * 0.9);
  vec3 body = vec3(0.012, 0.02, 0.035) * 1.0;
  vec3 rgb = body * fill + vCol.rgb * (edge * 1.3 + glow * 0.9 * (1.0 - fill * 0.5));
  rgb += vCol.rgb * detail * fill * 0.55;
  float alpha = max(fill * 0.92, max(edge, glow * 0.7)) * vCol.a;
  if (alpha < 0.01) discard;
  o = vec4(rgb, alpha);
}`;

/* ---- final grade: multiply-blended vignette + fade ----------------------- */
export const GRADE_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const GRADE_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform float uDark;
uniform float uAspect;
out vec4 o;
void main(){
  vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
  float v = 1.0 - smoothstep(0.55, 1.35, length(c)) * 0.75;
  o = vec4(vec3(v * (1.0 - uDark)), 1.0);
}`;
