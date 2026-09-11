import * as THREE from 'three';
import { rand, clamp } from '../core/Util.js';

const _axis = new THREE.Vector3(), _dq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

const MAX_SETTLED = 26;

/**
 * Physics for street furniture that telekinesis has torn loose — lamp posts
 * and trees. Each item is a rigid body: it tumbles, hits things, damages what
 * it lands on, then lies where it stopped until the debris budget recycles it.
 */
export class PropSystem {
  constructor (world) {
    this.world = world;
    this.items = [];
  }

  /** Pull a standing prop out of the city and start tracking it. */
  grab (prop) {
    const group = this.world.city.detachProp(prop);
    if (!group) return null;
    const it = {
      group,
      pos: group.position.clone(),
      quat: group.quaternion.clone(),
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(1.6),
      state: 'held',
      bounces: 0,
      radius: prop.radius,
      mass: prop.mass,
      kind: prop.kind,
      restT: 0,
      age: 0
    };
    this.items.push(it);
    return it;
  }

  /** Pick a piece of debris back up — landed props stay fully interactive. */
  regrab (it) {
    if (!it) return null;
    it.state = 'held';
    it._audioInWater = false;
    it.smashed = false;
    it.vel.set(0, 0, 0);
    return it;
  }

  hold (it, point, dt) {
    if (!it || it.state !== 'held') return;
    it.pos.lerp(point, clamp(dt * 8, 0, 1));
  }

  launch (it, dir, power) {
    if (!it || it.restT > 0) return;
    it.state = 'thrown';
    it._audioInWater = false;
    it.bounces = 0;
    this.world.audio?.play('whoosh', it.pos, .65);
    it.vel.copy(dir).multiplyScalar(power / it.mass);
    if (it.vel.y < 2) it.vel.y += 3;
    it.angVel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 9));
  }

  /** Let go without throwing — it just falls. */
  drop (it) {
    if (!it) return;
    it.state = 'thrown';
    it._audioInWater = false;
    it.vel.set(0, 0, 0);
  }

  _smash (it) {
    const fx = this.world.effects;
    const col = it.kind === 'tree' || it.kind === 'bush' ? '#4e7a3e' : it.kind === 'rock' ? '#9a9385' : '#8b939c';
    fx.burst(it.pos, col, 20, 8, 0.45, 0.6, { grav: -9, drag: 0.9 });
    fx.spawnDebris(it.pos, it.kind === 'tree' ? '#4a3826' : it.kind === 'bush' ? '#3a5a2c' : '#5a6068', 7, 8, 0.26);
    if (it.kind === 'lamp') fx.burst(it.pos, '#ffd9a0', 12, 9, 0.35, 0.4);
    this.world.player.cam?.addShake(0.16);

    // anything it lands on takes a beating — civilians included
    this.world.applyImpact(it.pos, 3.4, {
      damage: 55 * this.world.player.strength, knock: 15, up: 0.6, hitY: 0.8,
      vehicleDamage: 70, propForce: 0
    });
  }

  _settle (it) {
    it.state = 'settled';
    it.restT = 0.8;                          // brief immunity so it can't ping-pong
    it.vel.set(0, 0, 0);
    it.angVel.set(0, 0, 0);
    // lie the long axis flat on the ground
    const yaw = Math.atan2(it.group.position.x - it.pos.x || Math.random() - 0.5, Math.random() - 0.5);
    it.quat.setFromEuler(new THREE.Euler(Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), yaw, 0, 'YXZ'));
    it.pos.y = this.world.city.groundHeight(it.pos.x, it.pos.z) + it.radius * 0.35;

    // keep the debris budget bounded
    const settled = this.items.filter(x => x.state === 'settled');
    if (settled.length > MAX_SETTLED) {
      const oldest = settled[0];
      this.world.scene.remove(oldest.group);
      this.items.splice(this.items.indexOf(oldest), 1);
    }
  }

  update (dt) {
    const city = this.world.city;
    for (const it of this.items) {
      it.age += dt;
      it.restT = Math.max(0, it.restT - dt);
      if (it.state === 'settled') {
        // nothing rests on water: whatever landed in it sinks and is gone
        if (city.isWater(it.pos.x, it.pos.z)) {
          const wl = city.waterLevel(it.pos.x, it.pos.z);
          if (city.groundHeight(it.pos.x, it.pos.z, it.pos.y + 1) <= wl + 0.05) {
            it.pos.y -= 0.9 * dt;
            it.group.position.copy(it.pos);
            if (it.pos.y < wl - 5) { this.world.scene.remove(it.group); this.items.splice(this.items.indexOf(it), 1); }
          }
        }
        continue;
      }

      if (it.state === 'held') {
        const ang = it.angVel.length() * dt;
        if (ang > 1e-6) {
          _axis.copy(it.angVel).normalize();
          _dq.setFromAxisAngle(_axis, ang);
          it.quat.premultiply(_dq);
        }
      } else {
        it.vel.y -= 24 * dt;
        it.pos.addScaledVector(it.vel, dt);
        const ang = it.angVel.length() * dt;
        if (ang > 1e-6) {
          _axis.copy(it.angVel).normalize();
          _dq.setFromAxisAngle(_axis, ang);
          it.quat.premultiply(_dq);
        }

        // clip anyone it passes through in flight
        if (!it.smashed) {
          for (const a of this.world.actorsNear(it.pos, it.radius + 0.8)) {
            _d.copy(a.pos).sub(it.pos).setY(0);
            if (_d.lengthSq() < 1e-4) _d.set(1, 0, 0);
            _d.normalize();
            if (a.faction === 'civilian') { a.panic?.(it.pos, 1); a.applyKnockback(_d, 13, 0.5, 1.2); }
            else this.world.player.dealDamage(a, 40 * this.world.player.strength, _d, 15, false, 0.5, 1.2);
            it.vel.multiplyScalar(0.85);
          }
        }

        // bounce off walls rather than sailing through them
        _v.copy(it.vel);
        if (city.bounceMoving(it.pos, it.vel, it.radius * 0.7, 0.35)) {
          this.world.audio?.collision(it.kind, it.pos, _v.sub(it.vel).length(), it.mass, it);
          it.bounces = (it.bounces || 0) + 1;
          it.angVel.multiplyScalar(0.7);
          if (!it.smashed) { it.smashed = true; this._smash(it); }
          this.world.effects.burst(it.pos, '#c9d2dc', 10, 6, 0.32, 0.3, { grav: -7 });
        }

        const g = city.groundHeight(it.pos.x, it.pos.z, it.pos.y + 2) + it.radius * 0.35;
        if (it.pos.y <= g) {
          it.pos.y = g;
          const impact = -it.vel.y;
          const inWater = city.isWater(it.pos.x, it.pos.z) && g - it.radius * .35 <= city.waterLevel(it.pos.x, it.pos.z) + .05;
          if (!inWater || !it._audioInWater) this.world.audio?.collision(inWater ? 'water' : it.kind, it.pos, impact, it.mass, it);
          it._audioInWater = inWater;
          it.bounces = (it.bounces || 0) + 1;
          if (impact > 4 && it.bounces < 3) {
            it.vel.y = impact * 0.3;
            it.vel.x *= 0.6; it.vel.z *= 0.6;
            if (!it.smashed) { it.smashed = true; this._smash(it); }
          } else {
            if (!it.smashed) { it.smashed = true; this._smash(it); }
            this._settle(it);
          }
        }
      }

      it.group.position.copy(it.pos);
      it.group.quaternion.copy(it.quat);
    }
  }

  clear () {
    for (const it of this.items) this.world.scene.remove(it.group);
    this.items.length = 0;
  }
}
