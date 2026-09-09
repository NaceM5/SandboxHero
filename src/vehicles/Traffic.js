import * as THREE from 'three';
import { CITY } from '../world/RoadNetwork.js';
import { VehicleFactory, VEHICLE_TYPES, randomCarColor } from './VehicleFactory.js';
import { clamp, rand, randInt, pick, angleDelta } from '../core/Util.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _wp = new THREE.Vector3(), _wm = new THREE.Matrix4();
const _c = new THREE.Vector3();

const fwdX = h => Math.sin(h), fwdZ = h => Math.cos(h);
const rightX = h => -Math.cos(h), rightZ = h => Math.sin(h);

function hermite (p0, t0, p1, t1, s, out) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return out.set(
    h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x,
    0,
    h00 * p0.z + h10 * t0.z + h01 * p1.z + h11 * t1.z
  );
}
function hermiteD (p0, t0, p1, t1, s, out) {
  const s2 = s * s;
  const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
  return out.set(
    d00 * p0.x + d10 * t0.x + d01 * p1.x + d11 * t1.x,
    0,
    d00 * p0.z + d10 * t0.z + d01 * p1.z + d11 * t1.z
  );
}

export class Traffic {
  constructor (scene, roads, city, fx) {
    this.scene = scene;
    this.roads = roads;
    this.city = city;
    this.fx = fx;
    this.factory = new VehicleFactory(scene, 40);
    this.world = null;          // assigned by the game shell for player queries
    this.vehicles = [];
    this.lightTimer = 0;
    this.lightPhase = 0;      // 0 = north/south green, 1 = east/west green
    this.lightYellow = false;
    this.night = 0;
  }

  /* ---------------- spawning ---------------- */

  setCount (n) {
    n = Math.max(0, Math.min(n, 40 * VEHICLE_TYPES.length));
    while (this.vehicles.length < n) if (!this.spawnOne()) break;
    while (this.vehicles.length > n) this.despawn(this.vehicles[this.vehicles.length - 1]);
  }

  spawnOne () {
    const type = pick(VEHICLE_TYPES);
    const idx = this.factory.alloc(type);
    if (idx < 0) return false;
    const T = this.factory.typeInfo(type);
    const v = {
      type, idx, T,
      pos: new THREE.Vector3(),
      heading: 0, speed: 0, steer: 0, wheelSpin: 0,
      state: 'drive', path: null, wps: [], wi: 0,
      bay: null, curve: null, curveT: 0, curveDur: 1, dwell: 0,
      headlights: false, braking: false,
      pitch: 0, roll: 0,
      tvel: new THREE.Vector3(), spin: new THREE.Vector3(), smokeT: 0,
      stuckT: 0, waiting: false, wreckT: 0, restT: 0,
      hp: 240, destroyed: false,
      reckless: false, driver: 'npc', dead: false,
      color: randomCarColor(),
      target: null, hijacker: null, alarm: 0
    };
    this.factory.setColor(type, idx, v.color);

    // drop it somewhere legal on the grid
    for (let tries = 0; tries < 40; tries++) {
      const a = this.roads.randomNode();
      const nbs = this.roads.neighbors(a);
      if (!nbs.length) continue;
      const b = pick(nbs);
      const t = rand(0.15, 0.85);
      this.roads.lanePoint(a, b, t, _p);
      if (this.vehicles.some(o => o.pos.distanceToSquared(_p) < 90)) continue;
      v.pos.copy(_p);
      v.pos.y = this.city.groundHeight(_p.x, _p.z);
      v.heading = Math.atan2(b.x - a.x, b.z - a.z);
      v.speed = rand(4, 10);
      this.vehicles.push(v);
      this.repath(v, b);
      return true;
    }
    this.factory.pools[type].count--;
    return false;
  }

  despawn (v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (v.bay) v.bay.occupied = false;
    this.factory.writeVehicle({ ...v, headlights: false, braking: false }, new THREE.Matrix4().makeScale(0, 0, 0));
  }

  /* ---------------- navigation ---------------- */

  repath (v, from) {
    const start = from || this.roads.nearestNode(v.pos.x, v.pos.z);
    let goal = this.roads.randomNode();
    let guard = 0;
    while ((Math.abs(goal.i - start.i) + Math.abs(goal.j - start.j)) < 3 && guard++ < 20) {
      goal = this.roads.randomNode();
    }
    v.path = this.roads.path(start, goal);
    v.wps = [];
    for (let k = 0; k < v.path.length - 1; k++) {
      const a = v.path[k], b = v.path[k + 1];
      v.wps.push(this.roads.lanePoint(a, b, 0.10, new THREE.Vector3()));
      v.wps.push(this.roads.lanePoint(a, b, 0.90, new THREE.Vector3()));
    }
    v.wi = 0;
    v.state = 'drive';
    // pick a curb bay on the final block so the trip ends with a real park
    if (v.path.length >= 2 && !v.reckless) {
      const a = v.path[v.path.length - 2], b = v.path[v.path.length - 1];
      v.bay = this.roads.claimBayOnSegment(a, b);
      if (v.bay) {
        const h = v.bay.heading;
        const fx = fwdX(h), fz = fwdZ(h);
        const rx = rightX(h), rz = rightZ(h);
        const lat = CITY.CURB - CITY.LANE;
        v.align = new THREE.Vector3(
          v.bay.x + fx * 6.6 - rx * lat, 0, v.bay.z + fz * 6.6 - rz * lat
        );
        // trim waypoints that overshoot the align point
        while (v.wps.length && v.wps[v.wps.length - 1].distanceTo(v.align) < 14) v.wps.pop();
        v.wps.push(v.align);
      }
    }
  }

  _beginPark (v) {
    const h = v.bay.heading;
    const f = _v.set(fwdX(h), 0, fwdZ(h));
    v.curveP0 = v.pos.clone();
    v.curveP1 = new THREE.Vector3(v.bay.x, 0, v.bay.z);
    v.curveT0 = f.clone().multiplyScalar(-9.5);
    v.curveT1 = f.clone().multiplyScalar(-6.5);
    v.curveT = 0;
    v.curveDur = 2.6;
    v.state = 'parkIn';
    v.speed = 0;
  }

  _beginLeave (v) {
    const h = v.bay.heading;
    const f = _v.set(fwdX(h), 0, fwdZ(h));
    const rx = rightX(h), rz = rightZ(h);
    const lat = CITY.CURB - CITY.LANE;
    v.curveP0 = v.pos.clone();
    v.curveP1 = new THREE.Vector3(v.bay.x + f.x * 11 - rx * lat, 0, v.bay.z + f.z * 11 - rz * lat);
    v.curveT0 = f.clone().multiplyScalar(8);
    v.curveT1 = f.clone().multiplyScalar(11);
    v.curveT = 0;
    v.curveDur = 2.2;
    v.state = 'parkOut';
  }

  /* ---------------- hijack / occupancy ---------------- */

  nearest (pos, maxDist = 8, filter = null) {
    let best = null, bd = maxDist * maxDist;
    for (const v of this.vehicles) {
      if (filter && !filter(v)) continue;
      const d = v.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  hijack (v, who, onEject) {
    if (!v || v.driver === who) return false;
    v.disturbed = true;
    if (v.onDisturbed) v.onDisturbed(v);
    if (v.driver === 'npc' && onEject) onEject(v);
    if (v.bay) { v.bay.occupied = false; v.bay = null; }
    v.driver = who;
    v.alarm = 1.2;
    v.reckless = who === 'enemy';
    if (who === 'player') { v.state = 'player'; v.path = null; v.wps = []; }
    else { this.repath(v); v.state = 'drive'; }
    return true;
  }

  release (v) {
    if (!v) return;
    v.driver = 'npc';
    v.reckless = false;
    v.speed = 0;
    this.repath(v);
  }

  /* ---------------- per-frame ---------------- */

  update (dt, ctx) {
    // city-wide signal cycle
    this.lightTimer += dt;
    const GREEN = 11, YELLOW = 2.4;
    if (this.lightTimer > GREEN + YELLOW) { this.lightTimer = 0; this.lightPhase ^= 1; }
    this.lightYellow = this.lightTimer > GREEN;

    this.factory.beginFrame();
    for (const v of this.vehicles) {
      if (v.driver === 'player') this._drivePlayer(v, dt, ctx);
      else this._driveAI(v, dt, ctx);
      this._integrate(v, dt);
      this._render(v);
    }
    this.factory.endFrame();
  }

  _laneTarget (v) {
    if (v.wi < v.wps.length) return v.wps[v.wi];
    return null;
  }

  _driveAI (v, dt, ctx) {
    const T = v.T;

    if (v.state === 'held') { v.braking = false; return; }
    if (v.state === 'wrecked') {
      v.speed = 0; v.braking = false;
      v.restT = Math.max(0, v.restT - dt);
      // a wreck parked across a lane jams the whole grid, so recycle it
      v.wreckT += dt;
      if (v.wreckT > 26 && this.city.groundHeight(v.pos.x, v.pos.z) >= 0) {
        this.fx.burst(v.pos, '#585e68', 16, 5, 0.7, 0.9, { grav: -1, drag: 0.95, grow: 2 });
        this.respawn(v);
        return;
      }
      v.smokeT = (v.smokeT || 0) - dt;
      if (v.smokeT <= 0) {
        v.smokeT = 0.09;
        this.fx.particle(
          v.pos.x + rand(-0.6, 0.6), v.pos.y + 1.1, v.pos.z + rand(-0.6, 0.6),
          rand(-0.4, 0.4), rand(1.2, 2.6), rand(-0.4, 0.4),
          '#3a3f47', rand(0.9, 1.8), rand(1.2, 2.2), { drag: 0.94, grow: 2.2, fade: 0.6 }
        );
      }
      return;
    }
    if (v.state === 'thrown') { v.braking = false; v.restT = Math.max(0, v.restT - dt); return; }

    if (v.state === 'parked') {
      v.dwell -= dt;
      v.speed = 0;
      v.braking = false;
      if (v.dwell <= 0) this._beginLeave(v);
      return;
    }
    if (v.state === 'parkIn' || v.state === 'parkOut') {
      v.curveT += dt;
      const s = clamp(v.curveT / v.curveDur, 0, 1);
      const e = s * s * (3 - 2 * s);
      hermite(v.curveP0, v.curveT0, v.curveP1, v.curveT1, e, _p);
      hermiteD(v.curveP0, v.curveT0, v.curveP1, v.curveT1, e, _v);
      v.pos.x = _p.x; v.pos.z = _p.z;
      const rev = v.state === 'parkIn';
      if (_v.lengthSq() > 1e-4) {
        const th = rev ? Math.atan2(-_v.x, -_v.z) : Math.atan2(_v.x, _v.z);
        v.heading += angleDelta(v.heading, th) * clamp(dt * 8, 0, 1);
      }
      v.speed = (rev ? -1 : 1) * 2.0 * (1 - Math.abs(s - 0.5) * 0.6);
      v.wheelSpin += v.speed * dt / T.wheelR;
      v.braking = rev;
      v.steer = clamp(angleDelta(v.heading, Math.atan2(_v.x, _v.z)) * (rev ? -1 : 1), -0.5, 0.5);
      if (s >= 1) {
        if (rev) {
          v.pos.set(v.bay.x, 0, v.bay.z);
          v.heading = v.bay.heading;
          v.state = 'parked';
          v.dwell = rand(12, 55);
          v.speed = 0;
        } else {
          v.bay.occupied = false; v.bay = null;
          this.repath(v);
        }
      }
      return;
    }

    /* ---- normal driving ---- */
    const tgt = this._laneTarget(v);
    if (!tgt) {
      if (v.bay) this._beginPark(v);
      else this.repath(v);
      return;
    }

    const dx = tgt.x - v.pos.x, dz = tgt.z - v.pos.z;
    const distToWp = Math.hypot(dx, dz);
    if (distToWp < 4.5) {
      v.wi++;
      if (v.wi >= v.wps.length && v.bay && v.pos.distanceTo(v.align) < 7) { this._beginPark(v); return; }
      if (v.wi >= v.wps.length && !v.bay) { this.repath(v); return; }
      return;
    }

    const desired = Math.atan2(dx, dz);
    const err = angleDelta(v.heading, desired);
    const maxSteer = this._steerLimit(v);
    v.steer = clamp(err * 1.7, -maxSteer, maxSteer);

    /* speed target */
    let target = T.speed * (v.reckless ? 1.55 : 1);
    // slow into corners
    const next = v.wps[v.wi + 1];
    if (next) {
      const a2 = Math.atan2(next.x - tgt.x, next.z - tgt.z);
      const turn = Math.abs(angleDelta(desired, a2));
      if (turn > 0.5) target *= clamp(1 - (turn - 0.5) * 0.85, 0.30, 1);
    }
    target *= clamp(1 - Math.abs(err) * 0.9, 0.25, 1);

    // traffic signal
    v.waiting = false;
    if (!v.reckless) {
      const stop = this._signalStop(v);
      if (stop >= 0) {
        target = Math.min(target, stop);
        if (stop < 1.2) v.waiting = true;      // legitimately held at a red
      }
    }
    // car ahead / obstacles
    const gap = this._forwardGap(v, ctx);
    if (gap < 22) target = Math.min(target, clamp((gap - 5.5) * 1.5, 0, target));

    if (v.alarm > 0) { v.alarm -= dt; target *= 1.15; }

    const accel = target > v.speed ? (v.reckless ? 11 : 8.5) : 18;
    v.speed += clamp(target - v.speed, -accel * dt, accel * dt);
    v.speed = clamp(v.speed, 0, T.speed * 1.7);
    v.braking = target < v.speed - 0.6;

    /* ---- deadlock breaker ----
       Two cars can end up yielding to each other forever, and a blocked
       waypoint can strand one permanently. Anything sitting still that isn't
       waiting at a red light gets re-routed, then relocated outright. */
    if (v.speed < 0.6 && !v.waiting) v.stuckT += dt; else v.stuckT = 0;
    if (v.stuckT > 5.5 && v.stuckT - dt <= 5.5) {
      this.repath(v);
    } else if (v.stuckT > 12) {
      v.stuckT = 0;
      this.relocate(v);
    }
  }

  /** Drop a vehicle onto a free lane point well away from the player. */
  relocate (v) {
    if (v.bay) { v.bay.occupied = false; v.bay = null; }
    const player = this.world?.player;
    for (let tries = 0; tries < 40; tries++) {
      const a = this.roads.randomNode();
      const nbs = this.roads.neighbors(a);
      if (!nbs.length) continue;
      const b = pick(nbs);
      this.roads.lanePoint(a, b, rand(0.2, 0.8), _p);
      if (player && player.pos.distanceToSquared(_p) < 90 * 90) continue;
      if (this.vehicles.some(o => o !== v && o.pos.distanceToSquared(_p) < 110)) continue;
      v.pos.copy(_p);
      v.pos.y = this._surfaceY(v);
      v.heading = Math.atan2(b.x - a.x, b.z - a.z);
      v.pitch = 0; v.roll = 0;
      v.speed = 6;
      v.stuckT = 0;
      this.repath(v, b);
      return true;
    }
    return false;
  }

  /** Bring a wreck back into circulation as a fresh vehicle. */
  respawn (v) {
    v.state = 'drive';
    v.wreckT = 0;
    v.hp = 240;
    v.destroyed = false;
    v.restT = 0;
    v.pitch = 0; v.roll = 0;
    v.tvel.set(0, 0, 0);
    v.spin.set(0, 0, 0);
    v.driver = 'npc';
    v.reckless = false;
    v.color = randomCarColor();
    this.factory.setColor(v.type, v.idx, v.color);
    if (!this.relocate(v)) { v.state = 'wrecked'; v.wreckT = 0; }
  }

  /**
   * Largest steering angle the tyres can actually hold at the current speed.
   *
   * The bicycle model on its own lets a car pivot on the spot at 70 km/h,
   * which is what made driving feel wrong. Capping the implied lateral
   * acceleration gives speed-sensitive steering: tight in a car park, gentle
   * on a straight.
   */
  _steerLimit (v, arcade = false) {
    // The AI drives to a physical grip budget; the player gets an arcade one,
    // plus a floor on steering authority. Pure physical grip means a 42 m turn
    // radius at 20 m/s, which can't take a city corner without braking to a
    // crawl — the floor keeps corners driveable at speed.
    const MAX_LAT = arcade ? 17 : 9.5;
    const sp = Math.max(Math.abs(v.speed), 0.5);
    const physical = Math.atan(MAX_LAT * v.T.wheelbase / (sp * sp));
    const floor = arcade ? 0.135 : 0;
    return Math.min(0.62, Math.max(physical, floor));
  }

  /** Distance at which the car must be stopped for a red light, or -1. */
  _signalStop (v) {
    const n = this.roads.nearestNode(v.pos.x, v.pos.z);
    const dx = n.x - v.pos.x, dz = n.z - v.pos.z;
    const ahead = dx * fwdX(v.heading) + dz * fwdZ(v.heading);
    const d = Math.hypot(dx, dz);
    if (ahead < 2 || d > 40) return -1;
    const goingNS = Math.abs(fwdZ(v.heading)) > Math.abs(fwdX(v.heading));
    const green = goingNS ? this.lightPhase === 0 : this.lightPhase === 1;
    if (green && !this.lightYellow) return -1;
    if (green && this.lightYellow && d < 16) return -1;   // already committed
    const stopLine = d - (CITY.ROAD_W / 2 + 2.5);
    if (stopLine < 0.4) return 0;
    return clamp(stopLine * 1.4, 0, 30);
  }

  /** Free distance in front of the car, considering traffic and people. */
  _forwardGap (v, ctx) {
    let best = 60;
    const fx = fwdX(v.heading), fz = fwdZ(v.heading);
    for (const o of this.vehicles) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0.5 || ahead > 40) continue;
      const side = Math.abs(dx * -fz + dz * fx);
      if (side > 2.4) continue;
      best = Math.min(best, ahead - v.T.len / 2 - o.T.len / 2 + 1.0);
    }
    if (ctx?.obstacles) {
      for (const o of ctx.obstacles) {
        const dx = o.x - v.pos.x, dz = o.z - v.pos.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0.5 || ahead > 22) continue;
        const side = Math.abs(dx * -fz + dz * fx);
        if (side > 2.2) continue;
        best = Math.min(best, ahead - v.T.len / 2 - 0.6);
      }
    }
    return Math.max(0, best);
  }

  _drivePlayer (v, dt, ctx) {
    const inp = ctx.driveInput || { throttle: 0, steer: 0, brake: false };
    const T = v.T;
    const maxSpeed = T.speed * 2.1;
    if (inp.brake) {
      v.speed += clamp(-Math.sign(v.speed) * 26 * dt, -26 * dt, 26 * dt);
      if (Math.abs(v.speed) < 0.4) v.speed = 0;
      v.braking = true;
    } else if (inp.throttle !== 0) {
      const a = inp.throttle > 0 ? 12 : -9;
      v.speed += a * dt * (inp.throttle > 0 ? 1 : 1);
      v.braking = inp.throttle < 0 && v.speed > 0;
    } else {
      v.speed *= Math.pow(0.55, dt);
      v.braking = false;
    }
    v.speed = clamp(v.speed, -maxSpeed * 0.35, maxSpeed);

    // steer toward the input, rate-limited so the wheel doesn't snap over, and
    // clamped by what the tyres can hold at this speed
    const lim = this._steerLimit(v, true);
    const want = -inp.steer * lim;
    const rate = 3.2 * dt;
    v.steer += clamp(want - v.steer, -rate, rate);
    v.steer = clamp(v.steer, -lim, lim);
  }

  _integrate (v, dt) {
    if (v.state === 'held') return;
    if (v.state === 'wrecked') return;
    if (v.state === 'thrown') {
      v.tvel.y -= 26 * dt;
      v.pos.addScaledVector(v.tvel, dt);
      v.pitch += v.spin.x * dt;
      v.heading += v.spin.y * dt;
      v.roll += v.spin.z * dt;
      // a car in flight flattens anyone it passes through
      if (this.world && v.tvel.lengthSq() > 50) {
        for (const a of this.world.actorsNear(v.pos, 2.8)) {
          if (a.phys !== 'walk') continue;
          _c.copy(a.pos).sub(v.pos).setY(0);
          if (_c.lengthSq() < 1e-4) _c.set(1, 0, 0);
          _c.normalize();
          if (a.faction === 'civilian') {
            a.panic?.(v.pos, 1);
            a.applyKnockback(_c, 17, 0.5, 1.2);
          } else {
            this.world.player.dealDamage(a, 70 * this.world.player.strength, _c, 19, false, 0.5, 1.2);
          }
          v.tvel.multiplyScalar(0.9);
        }
      }

      // bounce off walls instead of clipping through them
      if (this.city.bounceMoving(v.pos, v.tvel, v.T.w * 0.8, 0.3)) {
        v.bounces = (v.bounces || 0) + 1;
        v.spin.multiplyScalar(0.7);
        this.fx.burst(v.pos, '#c9d2dc', 14, 8, 0.36, 0.34, { grav: -7 });
        this.fx.spawnDebris(v.pos, '#5a5f68', 4, 6, 0.22);
        this.explode(v, v.pos, 0);
        if (v.bounces < 3 && v.tvel.lengthSq() > 90) v.state = 'thrown';
        this.world?.applyImpact(v.pos, 6, {
          damage: 35, knock: 12, up: 0.6, hitY: 0.7, vehicleDamage: 25, propForce: 0, skipVehicle: v
        });
        if (v.state === 'thrown') return;
      }

      const g = this.city.groundHeight(v.pos.x, v.pos.z, v.pos.y + 2);
      if (v.pos.y <= g + 0.15) {
        v.pos.y = Math.max(v.pos.y, g + 0.15);
        v.restT = 0.8;                        // can't be re-thrown immediately
        this.explode(v, v.pos, 0);
        this.world?.applyImpact(v.pos, 7, {
          damage: 45, knock: 15, up: 0.7, hitY: 0.7,
          vehicleDamage: 30, propForce: 0, skipVehicle: v
        });
      }
      return;
    }
    if (v.state === 'parkIn' || v.state === 'parkOut' || v.state === 'parked') {
      v.pos.y = this._surfaceY(v);
      this._followSlope(v, dt);
      return;
    }
    const T = v.T;
    if (Math.abs(v.speed) > 0.01) {
      v.heading += (v.speed / T.wheelbase) * Math.tan(v.steer) * dt;
    }
    v.pos.x += fwdX(v.heading) * v.speed * dt;
    v.pos.z += fwdZ(v.heading) * v.speed * dt;
    v.wheelSpin += v.speed * dt / T.wheelR;
    v.pos.y = this._surfaceY(v);
    this._followSlope(v, dt);
    if (this._collideBody(v)) {
      v.speed *= 0.15;
      v.stuckT += 0.05;                        // scraping a wall counts toward a re-route
    }

    const lim = CITY.HALF + CITY.CELL * 0.6;
    if (Math.abs(v.pos.x) > lim || Math.abs(v.pos.z) > lim) {
      v.pos.x = clamp(v.pos.x, -lim, lim);
      v.pos.z = clamp(v.pos.z, -lim, lim);
      if (v.driver !== 'player') this.repath(v);
    }
  }

  /**
   * Buildings are solid. Tested at the front and rear axle rather than the
   * centre, so a long car can't push its nose through a wall.
   */
  _collideBody (v) {
    const half = v.T.len * 0.32;
    const fx = fwdX(v.heading), fz = fwdZ(v.heading);
    let hit = false;
    for (const off of [half, -half]) {
      _c.set(v.pos.x + fx * off, v.pos.y, v.pos.z + fz * off);
      if (this.city.resolveCollision(_c, v.T.w * 0.5, v.pos.y, v.pos.y + 1.4, true)) {
        v.pos.x = _c.x - fx * off;
        v.pos.z = _c.z - fz * off;
        hit = true;
      }
    }
    return hit;
  }

  _surfaceY (v) {
    return this.city.groundHeight(v.pos.x, v.pos.z, v.pos.y + 3);
  }

  /** Pitch the body to match the slope it's sitting on. */
  _followSlope (v, dt) {
    const T = v.T;
    const fx = fwdX(v.heading), fz = fwdZ(v.heading);
    const half = T.wheelbase / 2;
    const front = this.city.groundHeight(v.pos.x + fx * half, v.pos.z + fz * half, v.pos.y + 3);
    const rear = this.city.groundHeight(v.pos.x - fx * half, v.pos.z - fz * half, v.pos.y + 3);
    const target = Math.atan2(front - rear, T.wheelbase);
    v.pitch += ((-target) - v.pitch) * Math.min(1, dt * 8);
  }

  _render (v) {
    const T = v.T;
    _e.set(v.pitch || 0, v.heading, v.roll || 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.copy(v.pos);
    _s.set(1, 1, 1);
    _m4.compose(_p, _q, _s);
    v.headlights = this.night > 0.35;
    this.factory.writeVehicle(v, _m4);

    // wheels — transformed by the car's full orientation so they stay attached
    // while a vehicle is being tumbled by telekinesis or flung through the air
    const half = T.wheelbase / 2;
    const track = T.track ?? (T.w / 2 - 0.10);
    const carQ = _q2.copy(_q);
    for (let i = 0; i < 4; i++) {
      const front = i < 2, left = i % 2 === 0;
      _wp.set(left ? -track : track, T.wheelR, front ? half : -half);
      _wp.applyMatrix4(_m4);
      _e.set(0, front ? v.steer : 0, 0);
      _q3.setFromEuler(_e);
      _e.set(v.wheelSpin, 0, 0);
      _q4.setFromEuler(_e);
      _q3.premultiply(carQ).multiply(_q4);
      _s.set(T.wheelR * 0.62, T.wheelR, T.wheelR);
      _wm.compose(_wp, _q3, _s);
      this.factory.writeWheel(_wm);
    }
  }

  /* ---------------- telekinesis & destruction ---------------- */

  setHeld (v, on) {
    if (on) {
      if (v.bay) { v.bay.occupied = false; v.bay = null; }
      v.state = 'held';
      v.speed = 0;
      v.spin.set(rand(-0.6, 0.6), rand(-1.2, 1.2), rand(-0.6, 0.6));
    } else if (v.state === 'held') {
      v.state = 'thrown';
      v.tvel.set(0, 0, 0);
    }
  }

  moveHeld (v, point, dt) {
    const k = clamp(dt * 6, 0, 1);
    v.pos.lerp(point, k);
    v.pitch += v.spin.x * dt;
    v.heading += v.spin.y * dt;
    v.roll += v.spin.z * dt;
  }

  launch (v, dir, power) {
    if (v.bay) { v.bay.occupied = false; v.bay = null; }
    v.state = 'thrown';
    v.bounces = 0;
    v.tvel.copy(dir).multiplyScalar(power);
    if (v.tvel.y < 3) v.tvel.y += 5;
    v.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3));
    v.pos.y += 0.4;
  }

  /**
   * Any power can hurt a car. A wreck is still a physical object — it can be
   * shoved, thrown and blown around, it just doesn't drive any more.
   */
  impact (v, dir, force, damage) {
    // Anyone driving for a crime bails the moment the car is interfered with,
    // however that happened — rammed, shot, blasted or picked up.
    v.disturbed = true;
    if (v.onDisturbed) v.onDisturbed(v);
    if (v.restT > 0) return;                 // just landed — let it settle
    if (v.destroyed) {
      if (force > 7) {
        v.state = 'thrown';
        v.tvel.copy(dir).multiplyScalar(force * 0.5);
        v.tvel.y = force * 0.28 + 3;
        v.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3));
        v.wreckT = 0;
      }
      this.fx.burst(v.pos, '#8b939c', 8, 6, 0.34, 0.35, { grav: -8 });
      return;
    }
    v.hp -= damage;
    if (v.hp <= 0) { this.explode(v, v.pos, force); return; }
    if (force > 13) {
      _v.copy(dir).setY(0.42).normalize();
      this.launch(v, _v, force * 0.85);
    } else if (force > 3) {
      v.speed *= 0.45;
      v.alarm = 1.6;
    }
    this.fx.burst(v.pos, '#c9d2dc', 7, 6, 0.3, 0.3, { grav: -8 });
  }

  explode (v, at, knock) {
    const first = !v.destroyed;
    v.destroyed = true;
    v.state = 'wrecked';
    v.speed = 0;
    v.tvel.set(0, 0, 0);
    v.spin.set(0, 0, 0);
    v.pitch = rand(-0.28, 0.28);
    v.roll = rand(-0.42, 0.42);
    if (v.bay) { v.bay.occupied = false; v.bay = null; }
    const c = at || v.pos;
    if (!first) {
      // already a wreck — a smaller secondary pop, no second fireball
      this.fx.burst(c, '#8b939c', 14, 8, 0.45, 0.5, { grav: -8 });
      this.fx.spawnDebris(c, '#4a4f57', 4, 7, 0.26);
      return;
    }
    this.fx.burst(c, '#ffb43a', 46, 17, 0.85, 0.85, { grav: -7, drag: 0.9 });
    this.fx.burst(c, '#ff5a1e', 26, 9, 1.3, 1.1, { grav: -2, drag: 0.93, grow: 2 });
    this.fx.shockwave(c, '#ffa030', 13, 0.5);
    this.fx.spawnDebris(c, '#4a4f57', 12, 12, 0.32);
    this.wrecks = (this.wrecks || 0) + 1;
    if (this.onExplosion) this.onExplosion(v, c, knock);
  }

  setNight (n) { this.night = n; this.factory.setNight(n); }
}
