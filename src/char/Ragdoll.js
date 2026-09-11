import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Articulated verlet ragdoll.
 *
 *  Thirteen particles sit at the real joints (hips, chest, head, both
 *  shoulders/elbows/hands, both knees/feet) and are held together by
 *  distance constraints. Limbs therefore swing, trail and fold on their own
 *  rather than the whole body rotating as one lump.
 *
 *  Every particle collides with the ground and with buildings individually,
 *  which is also what stops an arm or a shin sinking through the pavement
 *  when the pose disagrees with a single capsule hitbox.
 *
 *  applyToRig() converts the simulated point cloud back into bone rotations:
 *  the torso gets an orthonormal basis built from the spine and shoulder
 *  axes, and every limb bone is aimed down the segment it represents.
 * ------------------------------------------------------------------ */

const HIP = 0, CHEST = 1, HEAD = 2, SHL = 3, SHR = 4,
  ELL = 5, ELR = 6, HAL = 7, HAR = 8, KNL = 9, KNR = 10, FTL = 11, FTR = 12;
const N = 13;

const DOWN = new THREE.Vector3(0, -1, 0);
const UPV = new THREE.Vector3(0, 1, 0);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _up = new THREE.Vector3(), _side = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _tmp = new THREE.Vector3();

// [a, b, stiffness]; rest lengths are measured from the bind pose
const LINKS = [
  [HIP, CHEST, 1.0], [CHEST, HEAD, 1.0],
  [CHEST, SHL, 1.0], [CHEST, SHR, 1.0], [SHL, SHR, 1.0],
  [SHL, ELL, 1.0], [ELL, HAL, 1.0], [SHR, ELR, 1.0], [ELR, HAR, 1.0],
  [HIP, KNL, 1.0], [KNL, FTL, 1.0], [HIP, KNR, 1.0], [KNR, FTR, 1.0],
  // torso braces so the trunk keeps its shape
  [HIP, SHL, 0.75], [HIP, SHR, 0.75],
  [HEAD, SHL, 0.26], [HEAD, SHR, 0.26],   // some neck lag
  [KNL, SHL, 0.09], [KNR, SHR, 0.09]     // loose enough for the legs to swing
];

// [a, b, factor] — pairs that may not fold closer than factor * rest length
const MINS = [
  [KNL, KNR, 0.55], [HAL, HAR, 0.30], [HAL, HIP, 0.45], [HAR, HIP, 0.45],
  [FTL, FTR, 0.40], [HAL, KNL, 0.35], [HAR, KNR, 0.35]
];

const RADII = new Float32Array([0.16, 0.17, 0.13, 0.10, 0.10, 0.07, 0.07, 0.06, 0.06, 0.09, 0.09, 0.08, 0.08]);

export class Ragdoll {
  constructor () {
    this.pos = new Float32Array(N * 3);
    this.old = new Float32Array(N * 3);
    this.rest = new Float32Array(LINKS.length);
    this.minRest = new Float32Array(MINS.length);
    this.active = false;
    this.grounded = false;
    this.scale = 1;
  }

  /** Seed the particles from the rig's current world pose. */
  bind (rig, group) {
    group.updateWorldMatrix(true, true);
    const B = rig.bones;
    const put = (i, obj, offY = 0) => {
      obj.getWorldPosition(_a);
      _a.y += offY;
      this.pos[i * 3] = _a.x; this.pos[i * 3 + 1] = _a.y; this.pos[i * 3 + 2] = _a.z;
      this.old[i * 3] = _a.x; this.old[i * 3 + 1] = _a.y; this.old[i * 3 + 2] = _a.z;
    };
    put(HIP, B.hips);
    put(CHEST, B.neck);
    put(HEAD, B.head, rig.P.headR * 0.9);
    put(SHL, B.armL); put(SHR, B.armR);
    put(ELL, B.forearmL); put(ELR, B.forearmR);
    put(HAL, B.handL); put(HAR, B.handR);
    put(KNL, B.shinL); put(KNR, B.shinR);
    put(FTL, B.footL); put(FTR, B.footR);

    for (let i = 0; i < LINKS.length; i++) {
      this.rest[i] = this._dist(LINKS[i][0], LINKS[i][1]);
    }
    for (let i = 0; i < MINS.length; i++) {
      this.minRest[i] = this._dist(MINS[i][0], MINS[i][1]) * MINS[i][2];
    }
    this.scale = rig.P.h;
    this.active = true;
  }

  _dist (a, b) {
    const ia = a * 3, ib = b * 3;
    return Math.hypot(
      this.pos[ib] - this.pos[ia],
      this.pos[ib + 1] - this.pos[ia + 1],
      this.pos[ib + 2] - this.pos[ia + 2]
    );
  }

  /** Give the whole body a velocity, plus spin about the impact lever arm. */
  impulse (dir, force, up, hitY, spin = 1) {
    const vx = dir.x * force, vy = Math.abs(force) * up + 2.0, vz = dir.z * force;
    // angular part: particles further from the hit height get more tangential kick
    const hy = this.pos[HIP * 3 + 1] + hitY;
    // extremities get a bit of extra scatter, otherwise the limbs trail in a
    // dead-straight line and the whole thing still reads as one solid piece
    const LOOSE = { [HAL]: 1, [HAR]: 1, [FTL]: 0.8, [FTR]: 0.8, [ELL]: 0.6, [ELR]: 0.6, [HEAD]: 0.4, [KNL]: 0.5, [KNR]: 0.5 };
    const jit = Math.min(force, 24) * 0.22;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const lever = (this.pos[o + 1] - hy) * spin;
      const l = LOOSE[i] || 0;
      const jx = (Math.random() - 0.5) * jit * l;
      const jy = (Math.random() - 0.5) * jit * l;
      const jz = (Math.random() - 0.5) * jit * l;
      this.old[o] = this.pos[o] - (vx + dir.z * lever * 1.6 + jx) * (1 / 60);
      this.old[o + 1] = this.pos[o + 1] - (vy + jy) * (1 / 60);
      this.old[o + 2] = this.pos[o + 2] - (vz - dir.x * lever * 1.6 + jz) * (1 / 60);
    }
  }

  /** Average particle velocity, in m/s. */
  velocity (out) {
    out.set(0, 0, 0);
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      out.x += this.pos[o] - this.old[o];
      out.y += this.pos[o + 1] - this.old[o + 1];
      out.z += this.pos[o + 2] - this.old[o + 2];
    }
    return out.multiplyScalar(60 / N);
  }

  centre (out) {
    out.set(this.pos[HIP * 3], this.pos[HIP * 3 + 1], this.pos[HIP * 3 + 2]);
    return out;
  }

  /** Rough spin rate, used to decide when the body has come to rest. */
  churn () {
    let s = 0;
    for (const i of [HAL, HAR, FTL, FTR, HEAD]) {
      const o = i * 3;
      s += Math.hypot(this.pos[o] - this.old[o], this.pos[o + 1] - this.old[o + 1], this.pos[o + 2] - this.old[o + 2]);
    }
    return s * 60 / 5;
  }

  /** Force the chest onto a point; the rest of the body hangs from it. */
  _pin (p) {
    const o = CHEST * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
    this.old[o] = p.x; this.old[o + 1] = p.y; this.old[o + 2] = p.z;
  }

  step (dt, city, pin = null) {
    const g = -26 * dt * dt;
    const damp = 0.992;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        const cur = this.pos[o + c];
        const v = (cur - this.old[o + c]) * damp;
        this.old[o + c] = cur;
        this.pos[o + c] = cur + v + (c === 1 ? g : 0);
      }
    }
    for (let it = 0; it < 7; it++) {
      this._solve();
      if (pin) this._pin(pin);
    }
    this._collide(city, dt);
    if (pin) this._pin(pin);
  }

  _solve () {
    const P = this.pos;
    for (let i = 0; i < LINKS.length; i++) {
      const [a, b, k] = LINKS[i];
      const ia = a * 3, ib = b * 3;
      let dx = P[ib] - P[ia], dy = P[ib + 1] - P[ia + 1], dz = P[ib + 2] - P[ia + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = ((d - this.rest[i]) / d) * 0.5 * k;
      dx *= f; dy *= f; dz *= f;
      P[ia] += dx; P[ia + 1] += dy; P[ia + 2] += dz;
      P[ib] -= dx; P[ib + 1] -= dy; P[ib + 2] -= dz;
    }
    // keep limbs from folding through the body
    for (let i = 0; i < MINS.length; i++) {
      const [a, b] = MINS[i];
      const ia = a * 3, ib = b * 3;
      let dx = P[ib] - P[ia], dy = P[ib + 1] - P[ia + 1], dz = P[ib + 2] - P[ia + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      if (d >= this.minRest[i]) continue;
      const f = ((d - this.minRest[i]) / d) * 0.5;
      dx *= f; dy *= f; dz *= f;
      P[ia] += dx; P[ia + 1] += dy; P[ia + 2] += dz;
      P[ib] -= dx; P[ib + 1] -= dy; P[ib + 2] -= dz;
    }
  }

  _collide (city, dt) {
    const P = this.pos, O = this.old;
    this.grounded = false;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const r = RADII[i] * this.scale;
      let floor = city.groundHeight(P[o], P[o + 2], P[o + 1] + 0.6) + r;
      // Water is not a floor. A limb that reaches it goes under, with the
      // water's drag, and the body comes to rest floating just below the
      // surface rather than lying on top of it.
      let wl = -Infinity;
      if (city.isWater(P[o], P[o + 2])) {
        wl = city.waterLevel(P[o], P[o + 2]);
        if (floor - r <= wl + 0.05) floor = wl - 0.9 + r;
      }
      if (P[o + 1] < wl + 0.1) {
        O[o] += (P[o] - O[o]) * 0.3;
        O[o + 1] += (P[o + 1] - O[o + 1]) * 0.45;
        O[o + 2] += (P[o + 2] - O[o + 2]) * 0.3;
      }
      if (P[o + 1] < floor) {
        P[o + 1] = floor;
        this.grounded = true;
        // tangential friction: scrub the horizontal velocity at the contact
        const fx = (P[o] - O[o]) * 0.62, fz = (P[o + 2] - O[o + 2]) * 0.62;
        O[o] = P[o] - fx;
        O[o + 2] = P[o + 2] - fz;
        O[o + 1] = P[o + 1] + (P[o + 1] - O[o + 1]) * 0.25;   // little bounce
      }
      _tmp.set(P[o], P[o + 1], P[o + 2]);
      if (city.resolveCollision(_tmp, r, P[o + 1] - r, P[o + 1] + r)) {
        P[o] = _tmp.x; P[o + 2] = _tmp.z;
        O[o] += (P[o] - O[o]) * 0.5;
        O[o + 2] += (P[o + 2] - O[o + 2]) * 0.5;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Point cloud -> bone rotations
   * ------------------------------------------------------------------ */

  _v (i, out) {
    const o = i * 3;
    return out.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
  }

  /** World quaternion that points a bone's -Y down the a->b segment. */
  _aim (a, b, out) {
    this._v(a, _b); this._v(b, _c);
    _c.sub(_b);
    if (_c.lengthSq() < 1e-8) _c.set(0, -1, 0);
    _c.normalize();
    return out.setFromUnitVectors(DOWN, _c);
  }

  applyToRig (rig, group) {
    const B = rig.bones;
    const P = rig.P;

    // torso basis: +Y up the spine, +X toward the left shoulder
    this._v(HIP, _a); this._v(CHEST, _b);
    _up.copy(_b).sub(_a);
    if (_up.lengthSq() < 1e-8) _up.set(0, 1, 0);
    _up.normalize();
    this._v(SHL, _b); this._v(SHR, _c);
    _side.copy(_b).sub(_c);
    if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
    _fwd.crossVectors(_side, _up);
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _side.crossVectors(_up, _fwd).normalize();
    _m.makeBasis(_side, _up, _fwd);
    const hipsQ = _q.setFromRotationMatrix(_m).clone();

    // the group carries no rotation; the hips bone holds the body orientation
    group.quaternion.identity();
    this._v(HIP, _a);
    group.position.set(_a.x, _a.y - P.hipY, _a.z);
    B.hips.position.set(0, P.hipY, 0);
    B.hips.quaternion.copy(hipsQ);

    // torso chain rides the hips
    B.spine.quaternion.identity();
    B.chest.quaternion.identity();
    B.neck.quaternion.identity();
    B.shoulderL.quaternion.identity();
    B.shoulderR.quaternion.identity();

    const invHips = _qp.copy(hipsQ).invert();

    // head: its geometry runs +Y, so aim that up the chest->head segment
    this._v(CHEST, _b); this._v(HEAD, _c);
    _c.sub(_b);
    if (_c.lengthSq() < 1e-8) _c.copy(_up);
    _c.normalize();
    _q2.setFromUnitVectors(UPV, _c);
    B.head.quaternion.copy(invHips).multiply(_q2);

    const limb = (bone, parentQ, from, to) => {
      const w = this._aim(from, to, _q2).clone();
      bone.quaternion.copy(parentQ).invert().multiply(w);
      return w;
    };

    const armLW = limb(B.armL, hipsQ, SHL, ELL);
    limb(B.forearmL, armLW, ELL, HAL);
    const armRW = limb(B.armR, hipsQ, SHR, ELR);
    limb(B.forearmR, armRW, ELR, HAR);

    const thighLW = limb(B.thighL, hipsQ, HIP, KNL);
    limb(B.shinL, thighLW, KNL, FTL);
    const thighRW = limb(B.thighR, hipsQ, HIP, KNR);
    limb(B.shinR, thighRW, KNR, FTR);

    B.handL.quaternion.identity();
    B.handR.quaternion.identity();
    B.footL.quaternion.identity();
    B.footR.quaternion.identity();
  }

  /** Yaw the body is facing once it has come to rest. */
  restYaw () {
    this._v(SHL, _b); this._v(SHR, _c);
    _side.copy(_b).sub(_c);
    this._v(HIP, _a); this._v(CHEST, _b);
    _up.copy(_b).sub(_a);
    _fwd.crossVectors(_side, _up);
    if (_fwd.lengthSq() < 1e-8) return 0;
    _fwd.normalize();
    return Math.atan2(_fwd.x, _fwd.z);
  }
}
