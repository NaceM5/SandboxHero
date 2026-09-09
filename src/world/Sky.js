import * as THREE from 'three';
import { clamp } from '../core/Util.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main () {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always on the far plane
}`;

const FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uSunCol, uSunDir;
uniform float uNight, uHaze, uTime;
uniform vec3 uCloudLit, uCloudDark;

float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise (vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm (vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { v += vnoise(p) * a; p *= 2.03; a *= 0.5; }
  return v;
}

void main () {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = clamp(h * 1.15 + 0.08, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.72));
  col = mix(uGround, col, smoothstep(-0.06, 0.05, h));

  // sun disc + broad glow
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunCol * pow(sd, 2600.0) * 1.8;
  col += uSunCol * pow(sd, 60.0) * 0.075 * uHaze;
  col += uSunCol * pow(sd, 9.0) * 0.028 * uHaze;

  // soft cloud bands, two layers drifting at different rates
  if (h > 0.005) {
    vec2 uv = d.xz / max(h + 0.12, 0.12);
    float c = fbm(uv * 0.55 + vec2(uTime * 0.010, uTime * 0.004));
    float c2 = fbm(uv * 1.25 + vec2(-uTime * 0.017, uTime * 0.009) + 21.0);
    float dens = c * 0.66 + c2 * 0.34;
    float cover = smoothstep(0.40, 0.66, dens);
    cover *= smoothstep(0.015, 0.20, h);
    // thicker cores read brighter where the sun is behind them
    vec3 lit = mix(uCloudDark, uCloudLit, clamp(pow(sd, 1.6) * 0.75 + 0.40, 0.0, 1.0));
    col = mix(col, lit, cover * 0.92);
    // a rim of light on the sunward edges
    col += uCloudLit * smoothstep(0.36, 0.44, dens) * (1.0 - cover) * pow(sd, 3.0) * 0.35;
  }

  // stars
  if (uNight > 0.01 && h > 0.0) {
    vec2 g = floor(d.xz * 260.0 / max(h + 0.25, 0.15));
    float s = hash(g);
    if (s > 0.9965) {
      float tw = 0.6 + 0.4 * hash(g + 3.3);
      col += vec3(0.85, 0.90, 1.0) * uNight * tw * smoothstep(0.0, 0.25, h);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const C = (r, g, b) => new THREE.Color(r, g, b);

// keyframed palette: [elevation, zenith, horizon, sun, light, ambient]
const PALETTE = [
  { e: -0.55, z: C(0.012, 0.016, 0.038), h: C(0.030, 0.040, 0.075), s: C(0.10, 0.12, 0.25), l: C(0.16, 0.20, 0.42), a: C(0.06, 0.08, 0.16), i: 0.09 },
  { e: -0.16, z: C(0.045, 0.058, 0.125), h: C(0.30, 0.19, 0.24), s: C(0.85, 0.36, 0.28), l: C(0.55, 0.33, 0.42), a: C(0.14, 0.16, 0.26), i: 0.30 },
  { e: -0.02, z: C(0.12, 0.17, 0.34), h: C(0.92, 0.44, 0.24), s: C(1.00, 0.48, 0.22), l: C(1.00, 0.55, 0.32), a: C(0.26, 0.26, 0.34), i: 1.05 },
  { e: 0.14, z: C(0.20, 0.34, 0.60), h: C(1.00, 0.66, 0.42), s: C(1.00, 0.74, 0.44), l: C(1.00, 0.79, 0.58), a: C(0.34, 0.37, 0.46), i: 2.05 },
  { e: 0.45, z: C(0.23, 0.44, 0.80), h: C(0.72, 0.82, 0.94), s: C(1.00, 0.96, 0.88), l: C(1.00, 0.97, 0.92), a: C(0.44, 0.50, 0.60), i: 2.85 },
  { e: 1.00, z: C(0.16, 0.36, 0.78), h: C(0.66, 0.79, 0.95), s: C(1.00, 0.99, 0.96), l: C(1.00, 0.99, 0.96), a: C(0.48, 0.54, 0.64), i: 3.10 }
];

function samplePalette (e) {
  let a = PALETTE[0], b = PALETTE[PALETTE.length - 1];
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (e >= PALETTE[i].e && e <= PALETTE[i + 1].e) { a = PALETTE[i]; b = PALETTE[i + 1]; break; }
    if (e < PALETTE[0].e) { a = b = PALETTE[0]; break; }
  }
  const t = a === b ? 0 : clamp((e - a.e) / (b.e - a.e), 0, 1);
  return {
    z: a.z.clone().lerp(b.z, t),
    h: a.h.clone().lerp(b.h, t),
    s: a.s.clone().lerp(b.s, t),
    l: a.l.clone().lerp(b.l, t),
    a: a.a.clone().lerp(b.a, t),
    i: a.i + (b.i - a.i) * t
  };
}

export class Sky {
  constructor (scene, renderer) {
    this.scene = scene;

    const geo = new THREE.SphereGeometry(1, 40, 24);
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color(0.02, 0.022, 0.028) },
      uSunCol: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
      uHaze: { value: 1 },
      uTime: { value: 0 },
      uCloudLit: { value: new THREE.Color(1, 0.97, 0.93) },
      uCloudDark: { value: new THREE.Color(0.42, 0.46, 0.56) }
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
    }));
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.near = 1; cam.far = 620;
    cam.left = -150; cam.right = 150; cam.top = 150; cam.bottom = -150;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.32;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fc4ff, 0x2a2620, 0.9);
    scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x5f7fb0, 0.35);
    this.fill.position.set(-0.5, 0.4, -0.8);
    scene.add(this.fill);

    // user-controlled flat fill — the "let me actually see" knob
    this.ambient = new THREE.AmbientLight(0xffffff, 0);
    scene.add(this.ambient);
    this.ambientLevel = 0.35;
    this.bright = false;

    scene.fog = new THREE.FogExp2(0x1a2230, 0.0016);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.setTime(0.66);
  }

  setTime (t) {
    this.t = t;
    const ang = (t - 0.25) * Math.PI * 2;
    const e = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.62, e, Math.cos(ang) * 0.78).normalize();

    const p = samplePalette(e);
    this.uniforms.uZenith.value.copy(p.z);
    this.uniforms.uHorizon.value.copy(p.h);
    this.uniforms.uSunCol.value.copy(p.s);
    this.uniforms.uSunDir.value.copy(this.sunDir);

    this.night = clamp(-e * 3.2 + 0.42, 0, 1);
    this.uniforms.uNight.value = this.night;
    this.uniforms.uHaze.value = clamp(1.05 - Math.abs(e) * 0.7, 0.3, 1.05);

    this.uniforms.uCloudLit.value.copy(p.s).lerp(new THREE.Color(1, 1, 1), 0.45);
    this.uniforms.uCloudDark.value.copy(p.z).lerp(new THREE.Color(0.35, 0.38, 0.46), 0.5);
    this.sun.color.copy(p.l);
    this._sunBase = p.i;
    this.hemi.color.copy(p.z).multiplyScalar(1.7).offsetHSL(0, 0, 0.12);
    // warm bounce off the streets keeps night-time readable
    this.hemi.groundColor.setRGB(0.16 + 0.06 * (1 - this.night), 0.13, 0.11);
    this._hemiBase = 0.95 + (1 - this.night) * 0.62;
    // bounce light from the opposite side of the sun keeps shadowed facades
    // from reading as flat black at a low sun angle
    this.fill.position.set(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.35 + 0.45, -this.sunDir.z);
    this._fillBase = 0.42 + this.night * 0.22;
    this.fill.color.setHex(this.night > 0.5 ? 0x4a6ea8 : 0x9dbbe4);

    this._fogBase = p.h.clone().lerp(p.z, 0.55).multiplyScalar(0.78);
    this._skyTint = p.z.clone();
    this.scene.background = null;
    this.applyLighting();
  }

  /** Ambient fill + bright mode. Re-applied whenever the time of day moves. */
  setLighting (ambientLevel, bright) {
    this.ambientLevel = ambientLevel;
    this.bright = bright;
    this.applyLighting();
  }

  applyLighting () {
    const n = this.night;
    const lvl = this.ambientLevel + (this.bright ? 0.55 : 0);
    // night needs more flat fill than midday to stay readable
    this.ambient.intensity = lvl * (0.55 + n * 0.95);
    this.ambient.color.copy(this._skyTint || new THREE.Color(1, 1, 1))
      .lerp(new THREE.Color(1, 0.97, 0.92), 0.55);

    // additive deltas off the stored base, so repeated calls don't compound
    const b = this.bright ? 1 : 0;
    this.hemi.intensity = this._hemiBase + b * 0.50;
    this.fill.intensity = this._fillBase + b * 0.32;
    this.sun.intensity = b ? Math.max(this._sunBase, 0.8) : this._sunBase;
    this.scene.fog.color.copy(this._fogBase);
    const fogK = this.bright ? 0.45 : 1;
    this.scene.fog.density = (0.00062 + n * 0.00055) * fogK;
  }

  /** Keep the sky centred on the camera and the shadow box around the player. */
  update (camera, focus, dt = 0) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(1);
    const d = 210;
    this.sun.position.set(
      focus.x + this.sunDir.x * d,
      focus.y + this.sunDir.y * d + 40,
      focus.z + this.sunDir.z * d
    );
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }
}
