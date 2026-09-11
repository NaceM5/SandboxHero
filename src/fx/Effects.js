import * as THREE from 'three';
import { rand, clamp } from '../core/Util.js';

/* ---------------- soft round sprite ---------------- */
function sparkTexture () {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PVERT = /* glsl */`
attribute float size;
attribute float alpha;
varying vec3 vColor;
varying float vAlpha;
void main () {
  vColor = color; vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = /* glsl */`
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main () {
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a < 0.01) discard;
  gl_FragColor = vec4(vColor * t.a, t.a * vAlpha);
}`;

const MAX_P = 3000;

export class Effects {
  constructor (scene, audio) {
    this.audio = audio;
    this.scene = scene;
    this.time = 0;

    /* ---- particle pool ---- */
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pSize = new Float32Array(MAX_P);
    this.pAlpha = new Float32Array(MAX_P);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1));
    g.setDrawRange(0, 0);
    this.pGeo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: sparkTexture() } },
      vertexShader: PVERT, fragmentShader: PFRAG,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, vertexColors: true
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);

    this.parts = [];
    for (let i = 0; i < MAX_P; i++) {
      this.parts.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0.98, fade: 1 });
    }
    this.pHead = 0;

    /* ---- shared additive material for rings / beams ---- */
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.86, 1.0, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.beams = [];
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.beamGeo.rotateX(Math.PI / 2);   // spans 0..1 along +Z

    this.debris = [];
    this.debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  }

  /* ================= particles ================= */

  _next () {
    for (let k = 0; k < MAX_P; k++) {
      const i = (this.pHead + k) % MAX_P;
      if (!this.parts[i].live) { this.pHead = (i + 1) % MAX_P; return this.parts[i]; }
    }
    return this.parts[this.pHead = (this.pHead + 1) % MAX_P];
  }

  particle (x, y, z, vx, vy, vz, color, size, life, opts = {}) {
    const p = this._next();
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    p.live = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.size = size; p.life = life; p.max = life;
    p.grav = opts.grav ?? 0;
    p.drag = opts.drag ?? 0.985;
    p.fade = opts.fade ?? 1;
    p.grow = opts.grow ?? 0;
    return p;
  }

  burst (pos, color, count, speed, size = 0.6, life = 0.6, opts = {}) {
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(-1, 1));
      const s = speed * rand(0.35, 1);
      this.particle(
        pos.x + rand(-0.15, 0.15), pos.y + rand(-0.15, 0.15), pos.z + rand(-0.15, 0.15),
        Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s * 0.8 + (opts.lift || 0), Math.sin(ph) * Math.sin(th) * s,
        color, size * rand(0.6, 1.4), life * rand(0.65, 1.25), opts
      );
    }
  }

  trail (pos, color, size = 0.5, life = 0.35, spread = 0.15) {
    this.particle(
      pos.x + rand(-spread, spread), pos.y + rand(-spread, spread), pos.z + rand(-spread, spread),
      rand(-0.4, 0.4), rand(-0.2, 0.6), rand(-0.4, 0.4),
      color, size, life, { drag: 0.9, grow: 0.6 }
    );
  }

  /* ================= rings ================= */

  ring (pos, color, from, to, life, opts = {}) {
    let r = this.rings.find(x => !x.live);
    if (!r) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      }));
      m.renderOrder = 9;
      this.scene.add(m);
      r = { live: false, mesh: m };
      this.rings.push(r);
    }
    r.live = true; r.t = 0; r.life = life; r.from = from; r.to = to;
    r.thin = opts.thin ?? 1;
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.material.color.set(color);
    r.mesh.rotation.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    if (opts.facing) r.mesh.lookAt(opts.facing);
    return r;
  }

  shockwave (pos, color, radius = 9, life = 0.55, sound = 'blast') {
    this.audio?.play(sound, pos, Math.min(1.3, radius / 12));
    this.ring(pos, color, 0.4, radius, life);
    this.burst(pos, color, 22, 9, 0.55, 0.5, { grav: -8, drag: 0.9 });
  }

  /** Vertical sonic-boom cone, oriented down a direction. */
  boom (pos, dir, color, radius = 7, life = 0.45) {
    this.audio?.play('boom', pos);
    const r = this.ring(pos, color, 0.5, radius, life);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    r.mesh.quaternion.copy(q);
    return r;
  }

  /* ================= beams ================= */

  acquireBeam (color, radius) {
    let b = this.beams.find(x => !x.live);
    if (!b) {
      const m = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      m.renderOrder = 9;
      this.scene.add(m);
      const core = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      core.renderOrder = 10;
      m.add(core);
      b = { live: false, mesh: m, core };
      this.beams.push(b);
    }
    b.live = true; b.persistent = true; b.t = 0; b.life = 1;
    b.mesh.visible = true;
    b.mesh.material.color.set(color);
    b.mesh.material.opacity = 0.55;
    b.core.material.color.set('#ffffff');
    b.core.material.opacity = 0.9;
    b.radius = radius;
    return b;
  }

  setBeam (b, from, to) {
    if (!b || !b.live) return;
    const d = to.clone().sub(from);
    const len = d.length() || 0.001;
    b.mesh.position.copy(from);
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
    const flick = 0.85 + Math.sin(this.time * 47) * 0.15;
    b.mesh.scale.set(b.radius * flick, b.radius * flick, len);
    b.core.scale.set(0.42, 0.42, 1.001);
  }

  releaseBeam (b) {
    if (!b) return;
    b.live = false; b.persistent = false;
    b.mesh.visible = false;
  }

  /** One-shot beam that fades on its own. */
  flashBeam (from, to, color, radius, life = 0.18) {
    const b = this.acquireBeam(color, radius);
    b.persistent = false; b.life = life; b.t = 0;
    this.setBeam(b, from.clone(), to.clone());
    return b;
  }

  /* ================= debris ================= */

  spawnDebris (pos, color, count = 8, speed = 8, size = 0.35) {
    for (let i = 0; i < count; i++) {
      let d = this.debris.find(x => !x.live);
      if (!d) {
        const m = new THREE.Mesh(this.debrisGeo, new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.85, flatShading: true }));
        m.castShadow = true;
        this.scene.add(m);
        d = { live: false, mesh: m, v: new THREE.Vector3(), av: new THREE.Vector3() };
        this.debris.push(d);
      }
      if (this.debris.filter(x => x.live).length > 120) return;
      d.live = true; d.t = 0; d.life = rand(1.6, 3.2);
      d.mesh.visible = true;
      d.mesh.position.copy(pos).add(new THREE.Vector3(rand(-0.6, 0.6), rand(0, 0.8), rand(-0.6, 0.6)));
      d.mesh.scale.set(size * rand(0.5, 1.6), size * rand(0.5, 1.6), size * rand(0.5, 1.6));
      d.mesh.material.color.set(color);
      d.v.set(rand(-1, 1), rand(0.5, 1.4), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.4, 1));
      d.av.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      d.ground = pos.y;
    }
  }

  /* ================= update ================= */

  update (dt) {
    this.time += dt;
    const pos = this.pPos, col = this.pCol, sz = this.pSize, al = this.pAlpha;
    let n = 0;
    for (let i = 0; i < MAX_P; i++) {
      const p = this.parts[i];
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) { p.live = false; continue; }
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.life / p.max;
      const o = n * 3;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      col[o] = p.r; col[o + 1] = p.g; col[o + 2] = p.b;
      sz[n] = p.size * (1 + p.grow * (1 - k));
      al[n] = Math.pow(k, p.fade);
      n++;
    }
    this.pGeo.setDrawRange(0, n);
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.attributes.size.needsUpdate = true;
    this.pGeo.attributes.alpha.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.live) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.live = false; r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      const rad = r.from + (r.to - r.from) * e;
      r.mesh.scale.set(rad, rad, rad);
      r.mesh.material.opacity = (1 - k) * 0.9;
    }

    for (const b of this.beams) {
      if (!b.live || b.persistent) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) { b.live = false; b.mesh.visible = false; continue; }
      b.mesh.material.opacity = (1 - k) * 0.6;
      b.core.material.opacity = (1 - k) * 0.95;
    }

    for (const d of this.debris) {
      if (!d.live) continue;
      d.t += dt;
      d.v.y -= 22 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.av.x * dt;
      d.mesh.rotation.y += d.av.y * dt;
      d.mesh.rotation.z += d.av.z * dt;
      if (d.mesh.position.y < d.ground + 0.1) {
        d.mesh.position.y = d.ground + 0.1;
        d.v.y *= -0.32; d.v.x *= 0.6; d.v.z *= 0.6;
        d.av.multiplyScalar(0.5);
      }
      if (d.t > d.life) {
        const f = clamp((d.t - d.life) / 0.5, 0, 1);
        d.mesh.scale.multiplyScalar(1 - f * 0.15);
        if (f >= 1) { d.live = false; d.mesh.visible = false; }
      }
    }
  }
}
