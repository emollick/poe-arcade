#version 300 es
/* FISSURE — the House of Usher, raymarched from signed distance fields.
 * Everything visible here is math: house, tarn, storm, fissure, moon. */
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos, uCamFwd, uCamRight, uCamUp;
uniform float uFocal;
uniform float uCrack;      // 0..1 progress of the fissure toward the tarn
uniform float uTipY;       // world y of the fissure tip
uniform float uDepth;      // how deep (z) the cut goes
uniform float uFlash;      // lightning light intensity
uniform vec3  uFlashDir;   // direction TO the lightning
uniform float uBolt;       // bolt visibility
uniform float uBoltAz;     // bolt azimuth (radians)
uniform float uBoltSeed;
uniform vec3  uMark;       // active brace world position
uniform float uMarkI;      // its light intensity
uniform float uJolt;       // recent jolt (crack flare)
uniform float uLean;       // collapse: halves lean apart (radians)
uniform float uSink;       // collapse: house sinks
uniform float uRings;      // collapse: tarn rings
uniform float uMoon;       // blood-red moon
uniform float uMist;       // extra fog
uniform float uWave;       // water agitation
uniform int   uSteps;      // primary march budget
uniform int   uRSteps;     // reflection march budget
uniform float uQual;       // 0..1 quality (shadows / ao)

const float G  = 0.5;      // ground level of the bank top
const float FZ = -1.4;     // front face of the main block
const vec3  MOONDIR = normalize(vec3(0.18, 0.20, 1.0));
const vec3  KEYDIR  = normalize(vec3(-0.55, 0.62, -0.55));

/* ---------- hashing / noise ---------- */
float hash1(float n){ return fract(sin(n)*43758.5453123); }
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f); return mix(hash1(i), hash1(i+1.0), f); }
float noise2(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<3;i++){ v+=a*noise2(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }

/* ---------- primitives ---------- */
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0); }
// gabled roof: base at y=0, apex at y=h, half-width w, half-depth hz
float sdGable(vec3 p, float w, float h, float hz){
  vec2 q = vec2(abs(p.x), p.y);
  vec2 n = normalize(vec2(h, w));
  float d = max(dot(q, n) - w*n.x, -q.y);
  return max(d, abs(p.z) - hz);
}
vec3 rotZ(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z); }

/* ---------- the house ---------- */
float sdHouseRaw(vec3 p){
  float d = sdBox(p - vec3(0.0, G+2.0, 0.0), vec3(2.2, 2.0, 1.4));               // main block
  d = min(d, sdBox(p - vec3(-3.1, G+1.3, 0.15), vec3(1.0, 1.3, 1.2)));          // left wing
  d = min(d, sdBox(p - vec3( 3.1, G+1.3, 0.15), vec3(1.0, 1.3, 1.2)));          // right wing
  d = min(d, sdBox(p - vec3( 1.55, G+3.3, -0.55), vec3(0.6, 3.3, 0.85)));       // squat tower
  d = min(d, sdGable(p - vec3(0.0, G+4.0, 0.0), 2.3, 1.6, 1.5));                // main roof
  d = min(d, sdGable(p - vec3(-3.1, G+2.6, 0.15), 1.05, 0.7, 1.25));            // wing roofs
  d = min(d, sdGable(p - vec3( 3.1, G+2.6, 0.15), 1.05, 0.7, 1.25));
  d = min(d, sdBox(p - vec3(-1.5, G+5.4, 0.7), vec3(0.16, 0.6, 0.16)));         // chimney
  d = min(d, sdBox(p - vec3(-0.6, G+5.7, -0.6), vec3(0.13, 0.35, 0.13)));       // chimney
  d = min(d, sdBox(p - vec3(1.55, G+6.68, -0.55), vec3(0.74, 0.1, 0.99)));      // tower ledge
  d = min(d, sdGable(p - vec3(1.55, G+6.78, -0.55), 0.62, 0.5, 0.86));          // tower cap
  return d;
}

float sdWindows(vec3 p){
  // main block: 4 columns x 3 rows of vacant eyes
  float cx = clamp(floor(p.x) + 0.5, -1.5, 1.5);
  float cy = G + 1.25 + 1.15 * clamp(floor((p.y - (G+1.25)) / 1.15 + 0.5), 0.0, 2.0);
  float d = sdBox(vec3(p.x - cx, p.y - cy, p.z - FZ), vec3(0.19, 0.34, 0.3));
  // the door
  d = min(d, sdBox(vec3(p.x, p.y - (G+0.55), p.z - FZ), vec3(0.3, 0.55, 0.3)));
  // wings
  float wx = sign(p.x) * 3.1;
  d = min(d, sdBox(vec3(p.x - wx, p.y - (G+1.3), p.z + 1.05), vec3(0.22, 0.42, 0.3)));
  d = min(d, sdBox(vec3(p.x - wx, p.y - (G+1.3), p.z - 1.35), vec3(0.22, 0.42, 0.3)));
  // tower slits
  float ty = G + 3.0 + 2.4 * clamp(floor((p.y - (G+3.0)) / 2.4 + 0.5), 0.0, 1.0);
  d = min(d, sdBox(vec3(p.x - 1.55, p.y - ty, p.z - FZ), vec3(0.11, 0.45, 0.3)));
  return d;
}

/* the fissure: a zigzag polyline in the front plane, exposed down to uTipY */
float segT(vec2 q, vec2 a, vec2 b, float tipY){
  float tm = clamp((a.y - tipY) / (a.y - b.y), 0.0, 1.0);
  vec2 pa = q - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, tm);
  return length(pa - ba*h);
}
float crack2D(vec2 q, float tipY){
  float d = 1e9;
  d = min(d, segT(q, vec2( 0.05, 6.35), vec2( 0.30, 5.30), tipY));
  d = min(d, segT(q, vec2( 0.30, 5.30), vec2(-0.20, 4.40), tipY));
  d = min(d, segT(q, vec2(-0.20, 4.40), vec2( 0.33, 3.55), tipY));
  d = min(d, segT(q, vec2( 0.33, 3.55), vec2(-0.14, 2.70), tipY));
  d = min(d, segT(q, vec2(-0.14, 2.70), vec2( 0.30, 1.90), tipY));
  d = min(d, segT(q, vec2( 0.30, 1.90), vec2(-0.06, 1.15), tipY));
  d = min(d, segT(q, vec2(-0.06, 1.15), vec2( 0.24, 0.55), tipY));
  d = min(d, segT(q, vec2( 0.24, 0.55), vec2( 0.10,-0.30), tipY));
  return d;
}
float crackWidth(float y){
  float w = 0.014 + 0.11 * uCrack;
  w *= mix(0.25, 1.0, clamp((y - uTipY) / 2.5, 0.0, 1.0));
  w *= 0.75 + 0.5 * noise1(y * 9.0);
  return w;
}

float sdHouse(vec3 p){
  float d = sdHouseRaw(p);
  if (d < 0.5) {
    d = max(d, -sdWindows(p));
    float c = crack2D(p.xy, uTipY) - crackWidth(p.y);
    float cut = max(c, p.z - (FZ + uDepth));
    d = max(d, -cut);
  }
  return d;
}

float sdBank(vec3 p){
  float d = sdBox(p - vec3(0.0, -0.4, 0.3), vec3(5.0, 0.55, 2.4)) - 0.35;
  d += 0.06 * sin(p.x*2.7 + 1.0) * sin(p.z*3.1);
  return d;
}

float sdScene(vec3 p){
  p.y += uSink;
  float b = sdBank(p);
  float h;
  if (uLean > 0.0) {
    vec3 piv = vec3(0.0, G, 0.0);
    vec3 pl = rotZ(p - piv, -uLean) + piv;
    vec3 pr = rotZ(p - piv,  uLean) + piv;
    float dl = max(sdHouse(pl), pl.x - 0.04);
    float dr = max(sdHouse(pr), -pr.x - 0.04);
    h = min(dl, dr);
  } else h = sdHouse(p);
  return min(b, h);
}

/* the house-local point (undo the collapse transform) for material lookups */
vec3 toLocal(vec3 p){
  p.y += uSink;
  if (uLean > 0.0) {
    vec3 piv = vec3(0.0, G, 0.0);
    return (p.x < 0.0) ? rotZ(p - piv, -uLean) + piv : rotZ(p - piv, uLean) + piv;
  }
  return p;
}

vec3 calcNormal(vec3 p){
  const vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy*sdScene(p+e.xyy) + e.yyx*sdScene(p+e.yyx) + e.yxy*sdScene(p+e.yxy) + e.xxx*sdScene(p+e.xxx));
}

/* scene bounding box: skip marching for rays that cannot hit anything */
bool boxHit(vec3 ro, vec3 rd, out float t0, out float t1){
  vec3 bmin = vec3(-5.6, -1.2 - uSink, -3.0), bmax = vec3(5.6, 8.0 - uSink, 3.0);
  vec3 inv = 1.0 / rd;
  vec3 ta = (bmin - ro) * inv, tb = (bmax - ro) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  t0 = max(max(tmin.x, tmin.y), tmin.z);
  t1 = min(min(tmax.x, tmax.y), tmax.z);
  return t1 > max(t0, 0.0);
}

float march(vec3 ro, vec3 rd, float tmax, int steps){
  float t0, t1;
  if (!boxHit(ro, rd, t0, t1)) return -1.0;
  float t = max(t0, 0.01);
  float tend = min(t1, tmax);
  for (int i = 0; i < 160; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = sdScene(p);
    if (d < 0.0015 * t + 0.0008) return t;
    t += d * 0.92;
    if (t > tend) break;
  }
  return -1.0;
}

float softShadow(vec3 ro, vec3 rd, float k, int steps){
  float r = 1.0, t = 0.06;
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    float d = sdScene(ro + rd * t);
    if (d < 0.001) return 0.0;
    r = min(r, k * d / t);
    t += clamp(d, 0.04, 0.5);
    if (t > 9.0) break;
  }
  return clamp(r, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n){
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 3; i++) {
    float h = 0.07 * float(i);
    float d = sdScene(p + n * h);
    o += (h - d) * s; s *= 0.65;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}

/* ---------- sky ---------- */
float bolt(vec3 rd){
  if (uBolt <= 0.001) return 0.0;
  float az = atan(rd.x, rd.z);
  float el = rd.y;
  float s = uBoltSeed;
  float path = uBoltAz + 0.16*(noise1(el*6.0 + s) - 0.5) + 0.05*(noise1(el*28.0 + s*3.0) - 0.5) + 0.018*(noise1(el*90.0 + s*7.0) - 0.5);
  float d = abs(az - path) * max(cos(el), 0.2);
  float range = smoothstep(-0.02, 0.05, el) * smoothstep(0.85, 0.5, el);
  float b = (exp(-d * 420.0) * 1.0 + exp(-d * 60.0) * 0.16) * range;
  // a branch
  float path2 = path + 0.05 + 0.5*(el - 0.32) + 0.04*(noise1(el*40.0 + s*5.0) - 0.5);
  float d2 = abs(az - path2) * max(cos(el), 0.2);
  b += (exp(-d2 * 460.0) * 0.6 + exp(-d2 * 80.0) * 0.08) * smoothstep(0.30, 0.34, el) * smoothstep(0.62, 0.45, el);
  return b;
}

vec3 sky(vec3 rd){
  float el = rd.y;
  vec3 base = mix(vec3(0.115, 0.125, 0.15), vec3(0.016, 0.02, 0.034), smoothstep(-0.05, 0.55, el));
  vec2 cuv = rd.xz / (max(el, -0.1) + 0.28);
  float cl = fbm(cuv * 0.75 + vec2(uTime*0.018, uTime*0.011));
  float cl2 = fbm(cuv * 1.9 - vec2(uTime*0.03, 0.0));
  cl = smoothstep(0.32, 0.78, cl + 0.25*cl2 - 0.1);
  vec3 cloudCol = mix(vec3(0.04, 0.045, 0.06), vec3(0.25, 0.26, 0.30), cl);
  vec3 col = mix(base, cloudCol, smoothstep(-0.03, 0.22, el) * 0.9);
  // moon glow behind the cloud (cold)
  float md = max(dot(rd, MOONDIR), 0.0);
  col += vec3(0.22, 0.27, 0.36) * pow(md, 30.0) * 0.55 * (1.0 - 0.6*cl);
  // blood-red moon
  if (uMoon > 0.0) {
    float disc = smoothstep(0.9974, 0.9986, md);
    col += (vec3(0.95, 0.10, 0.05) * disc * 2.6 + vec3(0.6, 0.06, 0.03) * pow(md, 60.0) * 1.1) * uMoon;
  }
  // lightning lights the clouds
  col += uFlash * vec3(0.92, 0.94, 1.0) * (0.16 + 0.55 * pow(max(dot(rd, uFlashDir), 0.0), 3.0)) * (0.35 + 0.65 * cl);
  col += bolt(rd) * vec3(1.0, 0.98, 0.92) * uBolt * 1.9;
  if (uBolt > 0.001) col += vec3(0.75, 0.8, 0.95) * cl * exp(-abs(atan(rd.x, rd.z) - uBoltAz) * 4.0) * smoothstep(-0.05, 0.3, el) * uBolt * 0.35;
  // the low sickly exhalation about the house
  float az = atan(rd.x, rd.z);
  col += vec3(0.34, 0.42, 0.20) * exp(-max(el, 0.0) * 9.0) * exp(-abs(az) * 2.2) * 0.22 * smoothstep(-0.1, 0.02, el);
  return col;
}

/* ---------- water ---------- */
float waterH(vec2 xz){
  float t = uTime;
  float h = (0.010*sin(xz.x*3.1 + t*1.3) + 0.009*sin(xz.y*2.3 - t*1.1 + xz.x*1.1) + 0.006*sin((xz.x + xz.y)*6.5 + t*2.3) + 0.004*sin(xz.x*11.0 - t*3.0)) * uWave;
  if (uRings > 0.0) {
    float r = length(xz - vec2(0.0, 0.3));
    h += uRings * sin(r*3.2 - t*4.5) * exp(-r*0.22) * 0.32;
  }
  return h;
}
vec3 waterN(vec2 xz){
  float e = 0.06;
  float h0 = waterH(xz);
  return normalize(vec3(h0 - waterH(xz + vec2(e, 0.0)), e, h0 - waterH(xz + vec2(0.0, e))));
}

/* ---------- materials & lighting ---------- */
struct Mat { vec3 alb; vec3 emis; float rough; };

Mat material(vec3 pw, vec3 n){
  vec3 p = toLocal(pw);
  Mat m; m.emis = vec3(0.0); m.rough = 1.0;
  float house = sdHouseRaw(p);
  float stoneN = 0.5*noise2(p.xy*5.0) + 0.5*noise2(p.zy*5.0 + 3.0);
  if (house > 0.08) {
    // bank
    m.alb = vec3(0.075, 0.08, 0.07) * (0.7 + 0.6*noise2(p.xz*4.0));
    return m;
  }
  // inside a window recess?
  bool inWin = sdWindows(p) < 0.01 && p.z > FZ - 0.28;
  float c2 = crack2D(p.xy, uTipY);
  float cw = crackWidth(p.y);
  bool inCrack = (c2 < cw + 0.012) && (p.z > FZ + 0.004);
  if (inCrack) {
    float deep = clamp((p.z - FZ) / max(uDepth, 0.05), 0.0, 1.0);
    m.alb = vec3(0.03, 0.02, 0.02);
    float pulse = 0.8 + 0.35*sin(uTime*6.0 + p.y*7.0);
    m.emis = mix(vec3(0.35, 0.02, 0.01), vec3(1.0, 0.10, 0.04), deep) * (1.3 + 2.5*uJolt) * pulse * (0.35 + 0.65*uCrack + 0.3);
    return m;
  }
  if (inWin) {
    float cx = clamp(floor(p.x) + 0.5, -1.5, 1.5);
    float cy = floor((p.y - (G+1.25)) / 1.15 + 0.5);
    float h = hash21(vec2(cx, cy) + vec2(sign(p.x)*7.0*step(2.5, abs(p.x)), 0.0));
    m.alb = vec3(0.02, 0.02, 0.025);
    bool lit = h > 0.80 && abs(p.x) < 2.0 && p.y > G + 0.9;
    if (lit) {
      float flick = 0.75 + 0.25*noise1(uTime*3.0 + h*40.0);
      m.emis = vec3(0.42, 0.40, 0.18) * 0.2 * flick;
    }
    return m;
  }
  bool roof = (p.y > G + 3.95 && abs(p.x) < 2.4 && !(abs(p.x - 1.55) < 0.62 && p.z < 0.3 && p.y < G + 6.6)) || (p.y > G + 2.55 && abs(p.x) > 2.0) || p.y > G + 6.6;
  if (roof && n.y > 0.35) {
    m.alb = vec3(0.10, 0.11, 0.135) * (0.75 + 0.5*stoneN);
    m.rough = 0.6;
    return m;
  }
  m.alb = vec3(0.36, 0.40, 0.46) * (0.72 + 0.56*stoneN);
  float course = smoothstep(0.0, 0.05, abs(fract(p.y*3.2) - 0.5));
  float joint = smoothstep(0.0, 0.04, abs(fract((abs(n.x) > 0.5 ? p.z : p.x)*1.6 + floor(p.y*3.2)*0.5) - 0.5));
  m.alb *= 0.78 + 0.22*course*joint;
  m.alb *= mix(0.55, 1.0, smoothstep(G, G + 1.6, p.y));      // damp, dark base
  return m;
}

vec3 shade(vec3 p, vec3 n, vec3 rd, float t, bool cheap){
  Mat m = material(p, n);
  vec3 col = vec3(0.0);
  float ao = cheap ? 0.8 : calcAO(p, n);
  // ambient from the storm sky
  col += m.alb * vec3(0.13, 0.15, 0.20) * ao * (0.55 + 0.45*n.y);
  // cold moon key
  float dk = max(dot(n, KEYDIR), 0.0);
  float sh = 1.0;
  if (dk > 0.0 && !cheap && uQual > 0.3) sh = softShadow(p + n*0.02, KEYDIR, 9.0, 8);
  col += m.alb * vec3(0.36, 0.42, 0.55) * 0.85 * dk * sh;
  // lightning
  if (uFlash > 0.01) {
    float df = max(dot(n, uFlashDir), 0.0);
    float shf = 1.0;
    if (df > 0.0 && !cheap && uQual > 0.5) shf = softShadow(p + n*0.02, uFlashDir, 7.0, 7);
    col += m.alb * vec3(1.0, 0.97, 0.90) * 2.2 * uFlash * (df * shf + 0.12*ao);
  }
  // the blood moon behind
  if (uMoon > 0.0) col += m.alb * vec3(1.0, 0.16, 0.08) * 1.4 * uMoon * max(dot(n, MOONDIR), 0.0);
  // the sickly exhalation from the tarn about the base
  vec3 pl = toLocal(p);
  float base = exp(-max(pl.y - G, 0.0) * 1.25);
  col += m.alb * vec3(0.40, 0.50, 0.26) * 0.30 * base * (0.55 + 0.45*max(-n.y, 0.0) + 0.3) * ao;
  // red light spilling from the fissure
  float cd = crack2D(pl.xy, uTipY);
  col += vec3(1.0, 0.12, 0.05) * exp(-cd * 7.0) * (0.25 + 0.9*uCrack + 1.5*uJolt) * 0.5 * (0.4 + 0.6*m.alb.b*2.0);
  // the lit brace
  if (uMarkI > 0.0) {
    vec3 L = uMark - p; float dl = length(L); L /= dl;
    col += m.alb * vec3(1.0, 0.85, 0.62) * uMarkI * max(dot(n, L), 0.0) / (1.0 + dl*dl*2.5) * 1.6;
  }
  // specular sheen (wet stone) from the lightning
  vec3 h = normalize(uFlashDir - rd);
  col += vec3(1.0) * uFlash * pow(max(dot(n, h), 0.0), 24.0) * 0.25 * (1.0 - m.rough*0.5);
  col += m.emis;
  return col;
}

/* ---------- camera / main ---------- */
void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamRight * uv.x + uCamUp * uv.y + uCamFwd * uFocal);

  vec3 fogCol = vec3(0.10, 0.11, 0.135) + uFlash * vec3(0.22, 0.23, 0.26) + uMoon * vec3(0.12, 0.02, 0.01);
  float fogK = 0.019 + uMist * 0.06;

  float tw = (rd.y < -0.0001) ? (0.0 - ro.y) / rd.y : 1e9;
  float t = march(ro, rd, min(tw, 60.0), uSteps);
  vec3 col;
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    col = shade(p, n, rd, t, false);
    col = mix(col, fogCol, 1.0 - exp(-t * fogK));
  } else if (tw < 1e8) {
    vec3 p = ro + rd * tw;
    vec3 n = waterN(p.xz);
    vec3 rr = reflect(rd, n);
    rr.y = abs(rr.y) + 0.002;
    float tr = march(p + vec3(0.0, 0.01, 0.0), rr, 60.0, uRSteps);
    vec3 refl;
    if (tr > 0.0) {
      vec3 q = p + rr * tr;
      vec3 nq = calcNormal(q);
      refl = shade(q, nq, rr, tr, true);
      refl = mix(refl, fogCol, 1.0 - exp(-(tw + tr) * fogK));
    } else {
      refl = sky(rr);
    }
    float cosT = max(dot(-rd, n), 0.0);
    float F = 0.04 + 0.96 * pow(1.0 - cosT, 4.0);
    vec3 deep = vec3(0.012, 0.016, 0.022);
    // sickly glow lying on the water round the bank
    float rb = length(p.xz - vec2(0.0, 0.3));
    deep += vec3(0.34, 0.42, 0.22) * 0.10 * exp(-max(rb - 5.2, 0.0) * 0.55);
    col = mix(deep, refl * vec3(0.66, 0.68, 0.72), clamp(F * 0.95 + 0.3, 0.0, 1.0)) * 0.92;
    col += vec3(0.34, 0.42, 0.22) * 0.07 * exp(-max(rb - 5.2, 0.0) * 0.55) * (0.5 + uFlash);
    col = mix(col, fogCol, 1.0 - exp(-tw * fogK * 0.8));
  } else {
    col = sky(rd);
  }
  fragColor = vec4(col, 1.0);
}
