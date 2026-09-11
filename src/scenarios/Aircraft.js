import * as THREE from 'three';
import { createAtlas42 } from '../../assets/aircraft/atlas-42/Atlas42.js';
import { createTitan60 } from '../../assets/aircraft/titan-60/Titan60.js';
import { clamp, rand, angleDelta } from '../core/Util.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const GEAR = /Tire|Wheel_hub|strut|brace|Bogie|Nose_gear|Gear_door|Gear_bay|Landing_light/i;

/**
 * A flying aircraft: one of the standalone assets driven by a simple
 * kinematic flight model, with an oriented bounding box for hit tests,
 * hit points, and weapon systems that degrade as it takes damage.
 *
 * Model convention: +Z nose, +Y up, origin on the ground under the fuselage.
 * `heading` follows the game's convention (0 = +Z, forward = (sin h, cos h)),
 * so the model's rotation.y is the heading directly.
 */
export class Aircraft {
  constructor (world, kind) {
    this.world = world;
    this.kind = kind;                       // 'atlas' | 'titan'
    const built = kind === 'titan' ? createTitan60() : createAtlas42();
    this.asset = built;
    this.group = built.group;
    this.group.rotation.order = 'YXZ';
    this.gearMeshes = [];
    this.group.traverse(o => { if (o.isMesh && GEAR.test(o.name)) this.gearMeshes.push(o); });
    this.setGear(false);
    world.scene.add(this.group);

    // local-space box from the collision parts (the visual is within it)
    const box = new THREE.Box3();
    for (const p of built.collisionParts) {
      for (const [x, z] of p.outline) { box.expandByPoint(_p.set(x, p.base, z)); box.expandByPoint(_p.set(x, p.top, z)); }
    }
    this.localBox = box;
    this.size = box.getSize(new THREE.Vector3());
    this.radius = this.size.length() / 2;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; this.pitch = 0; this.roll = 0;
    this.speed = kind === 'titan' ? 48 : 60;
    this.turnRate = kind === 'titan' ? 0.22 : 0.62;
    this.maxPitch = kind === 'titan' ? 0.28 : 0.6;
    this.accel = kind === 'titan' ? 8 : 16;
    this.maxHp = kind === 'titan' ? 2600 : 900;
    this.hp = this.maxHp;
    this.alive = true;
    this.rollExtra = 0;                     // aerobatics on top of the bank
    this.yawRate = 0;
    this.smokeT = 0;
    this.hitFlash = 0;
    this.name = kind === 'titan' ? 'Titan 60' : 'Atlas 42';
    this.desiredSpeed = this.speed;
  }

  setGear (down) { for (const m of this.gearMeshes) m.visible = down; }

  get healthFrac () { return clamp(this.hp / this.maxHp, 0, 1); }
  /** Weapon systems degrade with damage: below 55 % one gun is out, below 30 % they are failing. */
  get weapon () {
    const h = this.healthFrac;
    if (h > 0.55) return { rate: 1, accuracy: 1, burst: this.kind === 'titan' ? 3 : 5, label: 'nominal' };
    if (h > 0.30) return { rate: 0.6, accuracy: 0.7, burst: this.kind === 'titan' ? 2 : 3, label: 'degraded' };
    return { rate: 0.3, accuracy: 0.35, burst: 1, label: 'failing' };
  }

  forward (out = _q) { const cp = Math.cos(this.pitch); return out.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), Math.cos(this.heading) * cp); }

  /** Steer toward a world point at a desired speed. Returns horizontal distance. */
  steerTo (target, dt, speed = this.desiredSpeed, turnScale = 1) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, dy = target.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    const wantH = Math.atan2(dx, dz);
    const dh = angleDelta(this.heading, wantH);
    const maxTurn = this.turnRate * turnScale * dt;
    const turn = clamp(dh, -maxTurn, maxTurn);
    this.heading += turn;
    this.yawRate = turn / Math.max(dt, 1e-4);
    const wantP = clamp(Math.atan2(dy, Math.max(dist, 30)), -this.maxPitch, this.maxPitch);
    this.pitch += clamp(wantP - this.pitch, -1.2 * dt, 1.2 * dt);
    this.desiredSpeed = speed;
    return dist;
  }

  /** Move along the nose, bank into the turn, keep the mesh in step. */
  integrate (dt) {
    this.speed += clamp(this.desiredSpeed - this.speed, -this.accel * 1.6 * dt, this.accel * dt);
    this.forward(_q);
    this.vel.copy(_q).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    const bank = clamp(-this.yawRate * (this.kind === 'titan' ? 2.2 : 1.6), -1.1, 1.1);
    this.roll += (bank + this.rollExtra - this.roll) * Math.min(1, dt * 3.5);
    this.syncMesh();
  }

  syncMesh () {
    this.group.position.copy(this.pos);
    _e.set(-this.pitch, this.heading, this.roll, 'YXZ');
    this.group.quaternion.setFromEuler(_e);
    this.group.updateMatrixWorld(true);
  }

  /** Is a world point inside the aircraft's box, padded by `pad`? */
  containsPoint (p, pad = 0) {
    _m.copy(this.group.matrixWorld).invert();
    _p.copy(p).applyMatrix4(_m);
    const b = this.localBox;
    return _p.x > b.min.x - pad && _p.x < b.max.x + pad && _p.y > b.min.y - pad && _p.y < b.max.y + pad && _p.z > b.min.z - pad && _p.z < b.max.z + pad;
  }

  /** Distance along a world ray to the aircraft's box, or null. */
  rayHit (origin, dir, maxDist, pad = 1.5) {
    _m.copy(this.group.matrixWorld).invert();
    const o = _p.copy(origin).applyMatrix4(_m);
    const d = _q.copy(dir).transformDirection(_m);
    const b = this.localBox;
    let t0 = 0, t1 = maxDist;
    for (const k of ['x', 'y', 'z']) {
      const lo = b.min[k] - pad, hi = b.max[k] + pad;
      if (Math.abs(d[k]) < 1e-6) { if (o[k] < lo || o[k] > hi) return null; continue; }
      let a = (lo - o[k]) / d[k], c = (hi - o[k]) / d[k];
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return null;
    }
    return t0;
  }

  /** Random point on the hull for smoke and sparks. */
  randomSurfacePoint (out) {
    const b = this.localBox;
    out.set(rand(b.min.x * 0.7, b.max.x * 0.7), rand(b.min.y + 2, b.max.y * 0.6), rand(b.min.z * 0.6, b.max.z * 0.6));
    return this.group.localToWorld(out);
  }

  damage (amount, at) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitFlash = 0.12;
    const fx = this.world.effects;
    const p = at ? _p.copy(at) : this.randomSurfacePoint(_p);
    fx.burst(p, '#ffd27a', 10, 9, 0.35, 0.3, { grav: -6 });
    fx.spawnDebris(p, '#5a5f68', 3, 7, 0.22);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; return true; }
    return false;
  }

  /** Smoke and fire from a damaged airframe. */
  emitDamageFx (dt) {
    const h = this.healthFrac;
    if (h > 0.6) return;
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    this.smokeT = h > 0.3 ? 0.12 : 0.05;
    const fx = this.world.effects;
    const p = this.randomSurfacePoint(_p);
    fx.particle(p.x, p.y, p.z, -this.vel.x * 0.25 + rand(-2, 2), rand(1, 4), -this.vel.z * 0.25 + rand(-2, 2), '#3a3f47', rand(1.4, 2.8), rand(1.6, 2.6), { drag: 0.92, grow: 2.4, fade: 0.6 });
    if (h < 0.3) fx.particle(p.x, p.y, p.z, -this.vel.x * 0.2 + rand(-3, 3), rand(2, 6), -this.vel.z * 0.2 + rand(-3, 3), '#ff7a1e', rand(0.8, 1.6), rand(0.4, 0.8), { drag: 0.9, grow: 1.5 });
  }

  dispose () { this.world.scene.remove(this.group); }
}
