// GLSL for the orb. Kept in one file so the look can be tuned in one place.

export const NOISE = /* glsl */ `
vec3 hash3(vec3 p){
  p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}
float gnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  return mix(
    mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)), u.x),
        mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)), u.x), u.y),
    mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)), u.x),
        mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++){ s += a*gnoise(p); p = p*2.03 + 7.1; a *= 0.5; }
  return s;
}
`;

export const SPHERE_VERT = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uWobble;
varying vec3 vN;
varying vec3 vVN;
varying vec3 vView;
void main(){
  vec3 n = normalize(position);
  float d = gnoise(n*1.7 + vec3(0.0, 0.0, uTime*0.7)) * uWobble;
  vec3 p = position + n*d;
  vN = n;
  vVN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

// Core: domain-warped spiral bands around the camera-facing axis, hot eye, fresnel rim.
export const CORE_FRAG = /* glsl */ `
${NOISE}
uniform float uTime, uCharge, uIntensity, uFlash;
uniform vec3 uA, uB, uC;
varying vec3 vN;
varying vec3 vVN;
varying vec3 vView;
void main(){
  vec3 n = normalize(vN);
  float r = length(n.xy);
  float th = atan(n.y, n.x);
  float t = uTime;
  vec3 w = vec3(n.xy*2.1, n.z*1.3 + t*0.35);
  float warp = fbm(w + fbm(w*1.7 - vec3(0.0, 0.0, t*0.25))*1.3);
  float spiral = th*3.0 + (1.0 - r)*6.0 - t*2.4 + warp*3.4;
  float band = 0.5 + 0.5*sin(spiral);
  band = pow(band, 1.5);
  float fine = 0.5 + 0.5*sin(th*7.0 - (1.0 - r)*11.0 + t*3.6 + warp*5.0);
  float eye = smoothstep(0.7, 0.0, r);
  float fres = pow(1.0 - abs(dot(normalize(vVN), normalize(vView))), 2.2);
  vec3 col = mix(uB*0.45, mix(uB, uA, 0.35)*0.72, band);
  col += uB * fine * 0.12;
  col += uC * fres * 1.3;
  col += uA * eye*eye*eye * 0.25;
  col *= (0.5 + 0.5*uCharge) * uIntensity;
  col += uA * uFlash;
  float alpha = clamp(0.62 + 0.38*band + fres, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

// Shell: faster, counter-rotating streaks, mostly rim.
export const SHELL_FRAG = /* glsl */ `
${NOISE}
uniform float uTime, uCharge, uIntensity;
uniform vec3 uA, uB, uC;
varying vec3 vN;
varying vec3 vVN;
varying vec3 vView;
void main(){
  vec3 n = normalize(vN);
  float r = length(n.xy);
  float th = atan(n.y, n.x);
  float a = th + uTime*2.9;
  vec3 p = vec3(cos(a)*2.6, sin(a)*2.6, r*7.0 - uTime*0.8);
  float s = gnoise(p) * 0.5 + gnoise(p*2.1 + 3.7) * 0.35;
  float streak = smoothstep(0.05, 0.55, s);
  float fres = pow(1.0 - abs(dot(normalize(vVN), normalize(vView))), 1.6);
  float k = fres * (0.25 + 0.95*streak);
  vec3 col = mix(uB, uA, streak) * k * 1.0 * uIntensity;
  gl_FragColor = vec4(col + uC*fres*0.25, clamp(k*0.8, 0.0, 1.0) * (0.3 + 0.7*uCharge));
}
`;

export const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Soft sprite: lights the hand around the orb.
export const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float g = pow(max(0.0, 1.0 - d), 2.3);
  gl_FragColor = vec4(uColor, g * uStrength);
}
`;

export const PARTICLE_VERT = /* glsl */ `
uniform float uTime, uInflow, uImplode, uPxPerWorld, uScale, uSeedOff, uCharge;
uniform vec3 uTips[5];
attribute vec4 aSeed;
varying float vAlpha;
varying float vMix;
const float PI = 3.14159265;
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  float ph = fract(aSeed.x + uSeedOff);
  float rate = 0.10 + 0.16*fract(aSeed.y*7.3);
  float life = fract(uTime*rate + ph);
  float inflow = step(aSeed.w, uInflow);

  // tilted rings that slowly spiral inwards
  float ring = floor(aSeed.y*5.0);
  float ta = ring*1.7 + 0.6, tb = ring*2.3 + 0.2;
  vec3 nrm = normalize(vec3(sin(ta)*cos(tb), cos(ta)*0.8 + 0.3, sin(ta)*sin(tb) + 0.4));
  vec3 u = normalize(cross(nrm, vec3(0.0, 1.0, 0.3)));
  vec3 v = cross(nrm, u);
  float R0 = 1.12 + 0.9*aSeed.z;
  float R = mix(R0, R0*0.38, life*life);
  float dir = mod(ring, 2.0) < 1.0 ? 1.0 : -1.0;
  float ang = fract(aSeed.x*91.7)*6.2832 + uTime*dir*(0.9 + 1.5/R) + life*2.5*dir;
  vec3 pr = R*(cos(ang)*u + sin(ang)*v);

  // charge: streams spiral in from the fingertips
  int ti = int(floor(fract(aSeed.x*13.7)*5.0));
  vec3 tip = uTips[ti];
  float e = life*life*(3.0 - 2.0*life);
  vec2 xy = rot(e*4.6*(1.0 - 0.3*aSeed.z)) * (tip.xy*(1.0 - e));
  vec3 pin = vec3(xy, tip.z*(1.0 - e));

  vec3 p = mix(pr, pin, inflow);
  p *= 1.0 - uImplode*0.92;

  float fadeRing = sin(life*PI);
  float fadeIn = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.82, 1.0, life));
  vAlpha = mix(fadeRing, fadeIn, inflow) * (0.4 + 0.6*aSeed.z) * smoothstep(0.0, 0.06, uCharge + inflow*0.5);
  vMix = aSeed.z;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ws = (0.05 + 0.07*aSeed.z) * uScale;
  gl_PointSize = max(1.5, ws * uPxPerWorld / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uA, uB;
uniform float uIntensity;
varying float vAlpha;
varying float vMix;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  vec3 col = mix(uB, uA, vMix) * 1.2 * uIntensity;
  gl_FragColor = vec4(col, a * vAlpha);
}
`;

// FX: shockwave ring (plane, uv space)
export const RING_FRAG = /* glsl */ `
uniform vec3 uColor, uHot;
uniform float uT;      // 0..1
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float eased = 1.0 - pow(1.0 - uT, 3.0);
  float r = 0.04 + eased*0.96;
  float w = 0.02 + 0.10*(1.0 - uT);
  float ring = smoothstep(w, 0.0, abs(d - r));
  float inner = smoothstep(r, 0.0, d) * (1.0 - uT) * 0.22;
  float fade = pow(1.0 - uT, 1.4);
  vec3 col = mix(uColor, uHot, ring*0.6);
  gl_FragColor = vec4(col * (ring*2.2 + inner), (ring + inner) * fade);
}
`;

// FX: sparks. mode 0 = outward burst, mode 1 = inward collapse
export const SPARK_VERT = /* glsl */ `
uniform float uT;      // seconds since start
uniform float uLife;
uniform float uSize;   // world units
uniform float uSpeed;  // world units / s
uniform float uMode;
uniform float uPxPerWorld;
attribute vec4 aSeed;
varying float vAlpha;
varying float vMix;
void main(){
  float k = uT / uLife;
  float ang = aSeed.x * 6.2832;
  float el = (aSeed.y - 0.5) * 2.0;
  vec3 dir = normalize(vec3(cos(ang), sin(ang), el*0.6));
  float sp = uSpeed * (0.35 + 0.9*aSeed.z);
  float drag = 3.2;
  float dist = sp * (1.0 - exp(-drag*uT)) / drag;
  vec3 p;
  if (uMode > 0.5) {
    float rr = uSpeed * 0.6 * (0.5 + aSeed.z);
    float e = clamp(k, 0.0, 1.0);
    p = dir * rr * (1.0 - e*e);
  } else {
    p = dir * dist;
  }
  vAlpha = (1.0 - smoothstep(0.35, 1.0, k)) * step(k, 1.0);
  if (uMode > 0.5) vAlpha = smoothstep(0.0, 0.2, k) * (1.0 - smoothstep(0.8, 1.0, k)) * step(k, 1.0);
  vMix = aSeed.w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float s = uSize * (0.5 + aSeed.w) * (1.0 - 0.5*k);
  gl_PointSize = max(1.5, s * uPxPerWorld / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

export const SPARK_FRAG = /* glsl */ `
uniform vec3 uA, uB;
varying float vAlpha;
varying float vMix;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(mix(uB, uA, vMix) * 1.8, a * a * vAlpha);
}
`;
