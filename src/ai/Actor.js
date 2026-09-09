import * as THREE from 'three';
import { buildCharacter } from '../char/Rig.js';
import { Animator } from '../char/Animator.js';
import { Ragdoll } from '../char/Ragdoll.js';
import { approachAngle } from '../core/Util.js';
import { CITY } from '../world/RoadNetwork.js';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const STEP_DOWN = 0.62;   // anything taller than a kerb is a fall, not a step
const FALL_G = 26;
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Shared body for every non-player character: a rig, an animator, grounded
 * movement, and an articulated verlet ragdoll (see char/Ragdoll.js) for when a
 * superpower sends them flying. Limbs simulate independently and every joint
 * collides with the ground and with buildings on its own, so nothing sinks
 * through the pavement when the pose disagrees with a capsule hitbox.
 */
export class Actor {
  constructor (world, appearance, opts = {}) {
    this.world = world;
    const built = buildCharacter(appearance);
    this.rig = built;
    this.group = built.group;
    this.anim = new Animator(built);
    this.height = built.P.hipY + built.P.chestH + built.P.neckH + built.P.headR * 2;
    world.scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.targetHeading = 0;
    this.speed = 0;
    this.moveSpeed = opts.moveSpeed ?? 1.6;
    this.radius = 0.36;
    this.grounded = true;
    this.airborne = false;
    this.vy = 0;
    this.fallVX = 0;
    this.fallVZ = 0;
    this.inWater = false;
    this.drownT = 0;
    this.health = opts.health ?? 100;
    this.maxHealth = this.health;
    this.dead = false;
    this.stagger = 0;
    this.cull = opts.cull ?? 200;
    this.faction = opts.faction ?? 'civilian';
    this.hidden = false;
    this.invulnerable = !!opts.invulnerable;
    this.mass = opts.mass ?? 1;
    this.staysDown = false;

    /* ---- physics state ---- */
    this.phys = 'walk';            // walk | held | ragdoll | rising
    this.doll = new Ragdoll();
    this.settleT = 0;
    this.settled = false;
    this.downT = 0;
    this.riseT = 0;
    this.riseDur = 0.95;
  }

  setVisible (v) {
    if (this.hidden === !v) return;
    this.hidden = !v;
    this.group.visible = v;
  }

  /**
   * Drop the small parts at distance. Hands, feet, hair and the neck join are
   * a few pixels each past ~70 m but account for a third of a character's draw
   * calls, which matters a lot with a two-hundred-strong crowd on screen.
   */
  setLOD (far) {
    if (this._lodFar === far) return;
    this._lodFar = far;
    const P = this.rig.parts;
    for (const k of ['handL', 'handR', 'footL', 'footR', 'hair', 'neck']) {
      if (P[k]) P[k].visible = !far;
    }
  }

  /* ================= impulses ================= */

  /**
   * Go limp and take an impulse. The ragdoll is seeded from whatever pose the
   * character is currently animating, so standing -> flying is continuous
   * instead of snapping to a canned frame.
   */
  launch (dir, force, up = 0.5, spin = 1, hitY = 1.35) {
    if (this.phys === 'walk' || this.phys === 'rising') {
      this.doll.bind(this.rig, this.group);
    }
    this.phys = 'ragdoll';
    this.airborne = true;
    this.grounded = false;
    this.settleT = 0;
    this.settled = false;
    this.downT = 0;
    this.anim.additive = null;
    this.doll.impulse(dir, force / this.mass, up, hitY, spin);
  }

  /** Where telekinesis is suspending this body from, if anywhere. */
  holdAt (point) {
    this._hold = this._hold || new THREE.Vector3();
    this._hold.copy(point);
  }

  /** Suspended by telekinesis — hangs and dangles from the grip. */
  beginHeld () {
    if (this.phys === 'walk' || this.phys === 'rising') {
      this.doll.bind(this.rig, this.group);
    }
    this.phys = 'held';
    this.anim.additive = null;
  }

  /** A shove that doesn't take them off their feet. */
  shove (dir, force) {
    this.pos.x += dir.x * force * 0.05;
    this.pos.z += dir.z * force * 0.05;
    this.anim.flinch = 1;
    if (this.phys === 'walk' && this.anim.clipName !== 'hitReact') {
      this.anim.play('hitReact', { fade: 0.05, restart: true });
    }
  }

  applyKnockback (dir, force, up = 0.45, hitY = 1.35) {
    if (this.phys === 'held') return;
    if (force >= 6) this.launch(dir, force, up, 1, hitY);
    else this.shove(dir, force);
  }

  /* ================= damage ================= */

  damage (amount, from) {
    if (this.dead) return false;
    if (this.invulnerable) { this.anim.flinch = 1; this.onHarmless?.(from); return false; }
    this.health -= amount;
    this.anim.flinch = 1;
    if (this.health <= 0) { this.health = 0; this.onDeath?.(from); return true; }
    return false;
  }

  faceTowards (x, z, rate, dt) {
    this.targetHeading = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.heading = approachAngle(this.heading, this.targetHeading, rate, dt);
  }

  /* ================= physics ================= */

  /**
   * Grounded integration with real falling, used while `phys === 'walk'`.
   *
   * Clamping straight to `groundHeight` every frame is what made a character
   * who walked off a roof teleport down to the street: the surface under them
   * changed by fifty metres in one frame and they simply appeared there. So a
   * drop bigger than a kerb hands them over to gravity instead, carrying the
   * horizontal speed they walked off the edge with, until they meet a surface.
   */
  integrate (dt) {
    const city = this.world.city;
    const support = city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.4);

    if (!this.airborne && this.pos.y - support > STEP_DOWN) {
      this.airborne = true;
      this.vy = 0;
      this.fallVX = this._vx || 0;
      this.fallVZ = this._vz || 0;
    }

    // Out of their depth: water with nothing standable under it. Thrown off
    // the warship there is no seabed within reach, so they tread water and
    // make for the nearest shore rather than standing on the bottom.
    const deep = city.isWater(this.pos.x, this.pos.z) && support <= CITY.WATER_Y + 0.3;
    if (deep && this.phys === 'walk') {
      if (!this.inWater) { this.inWater = true; this.drownT = 0; this.onEnterWater?.(); }
      this.airborne = false;
      this.vy = 0;
      this.drownT += dt;
      this.pos.y = CITY.WATER_Y - 0.45;          // chest deep, not standing on it
      const n = this.world.roads.nearestWalkNode(this.pos.x, this.pos.z);
      if (n) {
        const dx = n.x - this.pos.x, dz = n.z - this.pos.z;
        const L = Math.hypot(dx, dz) || 1;
        const sp = 1.5;
        this.pos.x += dx / L * sp * dt;
        this.pos.z += dz / L * sp * dt;
        this.heading = approachAngle(this.heading, Math.atan2(dx, dz), 3, dt);
      }
      this.speed = 0;
      this._px = this.pos.x; this._pz = this.pos.z;
      this.group.position.copy(this.pos);
      _e.set(0, this.heading, 0);
      this.group.quaternion.setFromEuler(_e);
      return false;
    }
    if (this.inWater) { this.inWater = false; this.drownT = 0; }

    if (this.airborne) {
      this.vy -= FALL_G * dt;
      this.pos.x += this.fallVX * dt;
      this.pos.z += this.fallVZ * dt;
      this.pos.y += this.vy * dt;
      const land = city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.4);
      if (this.pos.y <= land) {
        this.pos.y = land;
        const impact = -this.vy;
        this.airborne = false;
        this.vy = 0;
        this.onLanded(impact);
      }
    } else {
      this.pos.y = support;
      // remember how fast we were walking, so stepping off a ledge keeps it
      const inv = 1 / Math.max(dt, 1e-4);
      this._vx = (this.pos.x - (this._px ?? this.pos.x)) * inv;
      this._vz = (this.pos.z - (this._pz ?? this.pos.z)) * inv;
    }
    this._px = this.pos.x; this._pz = this.pos.z;

    this.vel.set(0, 0, 0);
    const hitWall = city.resolveCollision(this.pos, this.radius, this.pos.y, this.pos.y + this.height,
      false, this.airborne ? 0 : 0.45);
    this.group.position.copy(this.pos);
    _e.set(0, this.heading, 0);
    this.group.quaternion.setFromEuler(_e);
    return hitWall;
  }

  /** Hit the ground after a fall. Anything past a stumble puts them down. */
  onLanded (impact) {
    if (impact < 11) return;
    const vx = this.fallVX, vz = this.fallVZ;
    const len = Math.hypot(vx, vz);
    _d.set(len > 0.1 ? vx / len : 0, 0, len > 0.1 ? vz / len : 1);
    this.launch(_d, Math.min(impact * 0.8, 24), 0.12, 0.7, 1.0);
    this.panic?.(null, 1);
  }

  /**
   * True when the ground a step ahead on heading `h` falls away far enough to
   * be a real drop rather than a kerb — a roof edge, a quay wall, a retaining
   * wall. Used to steer characters along ledges instead of off them.
   */
  ledgeAhead (h, dist = 1.7) {
    const x = this.pos.x + Math.sin(h) * dist;
    const z = this.pos.z + Math.cos(h) * dist;
    return this.pos.y - this.world.city.groundHeight(x, z, this.pos.y + 1.4) > 1.3;
  }

  /** Ragdoll / recovery integration. Returns true when it handled the frame. */
  updateRagdoll (dt) {
    const city = this.world.city;
    dt = Math.min(dt, 1 / 45);

    if (this.phys === 'rising') {
      this.riseT += dt;
      _e.set(0, this.heading, 0);
      this.group.quaternion.setFromEuler(_e);
      this.pos.y = city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.4);
      this.group.position.copy(this.pos);
      this.anim.update(dt);
      if (this.riseT >= this.riseDur) {
        this.phys = 'walk';
        this.onRecovered?.();
      }
      return true;
    }

    this.doll.step(dt, city, this.phys === 'held' ? this._hold : null);
    this.doll.applyToRig(this.rig, this.group);
    this.doll.centre(_c);
    this.pos.set(_c.x, city.groundHeight(_c.x, _c.z, _c.y + 0.5), _c.z);

    if (this.phys === 'held') return true;

    const speed = this.doll.velocity(_d).length();

    // a body travelling fast enough bowls over whoever it hits
    this._bowlT = (this._bowlT || 0) - dt;
    if (this._bowlT <= 0 && speed > 6) {
      for (const o of this.world.actorsNear(this.pos, 1.5)) {
        if (o === this || o.phys !== 'walk') continue;
        _d.copy(o.pos).sub(this.pos).setY(0);
        if (_d.lengthSq() < 1e-4) _d.set(1, 0, 0);
        _d.normalize();
        o.applyKnockback(_d, Math.min(speed * 0.85, 18), 0.4, 1.2);
        o.panic?.(this.pos, 1);
        this._bowlT = 0.35;
        break;
      }
    }

    const still = this.doll.grounded && speed < 0.9 && this.doll.churn() < 1.2;
    if (still) {
      this.settleT += dt;
      if (this.settleT > 0.45 && !this.settled) {
        this.settled = true;
        this.heading = this.doll.restYaw();
        this.downT = 0;
        this.onSettled?.();
      }
    } else { this.settleT = 0; this.settled = false; }

    if (this.settled) {
      this.downT += dt;
      if (this.downT > this.getUpDelay()) this._rise();
    }
    return true;
  }

  getUpDelay () { return this.staysDown ? Infinity : 1.6; }

  _rise () {
    this.phys = 'rising';
    this.settled = false;
    this.airborne = false;
    this.vy = 0;
    this.riseT = 0;
    // cross-fade out of the physical pose rather than snapping into the clip
    this.anim.play('riseUp', { fade: 0.3, fromBones: true });
    this.riseDur = this.anim.clip.duration;
  }

  /** Force an immediate return to normal control (used when despawning etc). */
  resetPhysics () {
    this.phys = 'walk';
    this.settled = false;
    this.airborne = false;
    this.vy = 0;
    this.anim.additive = null;
    this.vel.set(0, 0, 0);
    _e.set(0, this.heading, 0);
    this.group.quaternion.setFromEuler(_e);
  }

  updateAnim (dt) { this.anim.update(dt); }

  dispose () {
    this.world.scene.remove(this.group);
  }
}
