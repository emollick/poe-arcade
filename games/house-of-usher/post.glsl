#version 300 es
/* FISSURE — upscale + film: bloom, chromatic fringe, rain, grain, heavy vignette. */
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform vec2  uRes;       // output resolution
uniform vec2  uSceneRes;  // scene texture resolution
uniform float uTime;
uniform float uGrain;
uniform float uFlash;
uniform float uFade;      // 0..1 darkens everything (transitions)
uniform float uRain;

float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  // chromatic fringe toward the edges
  vec2 ca = c * (0.0035 + 0.012 * r2);
  vec3 col;
  col.r = texture(uScene, uv + ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - ca).b;
  // cheap wide bloom off the low-res scene
  vec3 bl = vec3(0.0);
  vec2 px = 1.0 / uSceneRes;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + uTime * 0.0;
    vec2 o = vec2(cos(a), sin(a)) * px * 3.5;
    vec3 s = texture(uScene, uv + o).rgb;
    bl += max(s - 0.5, 0.0);
  }
  bl /= 8.0;
  col += bl * 0.55;
  // rain: thin streaks, sparse
  if (uRain > 0.0) {
    vec2 q = vec2(uv.x + uv.y * 0.10, uv.y);
    float colId = floor(q.x * 140.0 * (uRes.x / uRes.y));
    float ph = hash21(vec2(colId, 3.1));
    float y = fract(q.y * 2.5 + uTime * (1.4 + ph * 1.0) + ph * 9.0);
    float fx = fract(q.x * 140.0 * (uRes.x / uRes.y));
    float streak = smoothstep(0.0, 0.05, y) * smoothstep(0.42, 0.10, y) * step(0.90, hash21(vec2(colId, 7.7))) * smoothstep(0.35, 0.5, fx) * smoothstep(0.65, 0.5, fx);
    col += streak * uRain * (0.05 + 0.5 * uFlash) * vec3(0.8, 0.85, 0.95);
  }
  // tone: soft shoulder, cold grade
  col = 1.0 - exp(-col * 1.55);
  col = mix(col, col * vec3(0.93, 0.97, 1.07), 0.55);
  col = pow(col, vec3(0.94));
  // grain
  float g = hash21(gl_FragCoord.xy + fract(uTime) * 133.7) - 0.5;
  col += g * uGrain * (0.9 - 0.6 * clamp(col.g, 0.0, 1.0));
  // heavy vignette
  float v = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.42);
  col *= mix(0.22, 1.0, v);
  col *= 1.0 - uFade;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
