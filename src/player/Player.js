import * as THREE from 'three';
import { buildCharacter, heroSuitAppearance, heroCivAppearance } from '../char/Rig.js';
import { Animator } from '../char/Animator.js';
import { Cape } from '../char/Cape.js';
import { makePowers } from '../powers/Powers.js';
import { clamp, lerp, smooth, rand, angleDelta, approachAngle } from '../core/Util.js';
import { CITY } from '../world/RoadNetwork.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e2 = new THREE.Euler(0, 0, 0, 'YXZ');
const ROLL_WHIP = 3.2;    // rad/s of view whip that commits to a barrel roll
const _m3 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

const GRAVITY = 26;

export class Player {
  constructor (world, cameraRig) {
    this.world = world;
    this.cam = cameraRig;
    this.settings = world.settings;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.groundY = 0;
    this.grounded = true;
    this.flying = false;
    this.suited = true;
    this.downed = false;
    this.radius = 0.42;
    this.height = 1.88;

    this.health = this.settings.get('maxHealth');
    this.energy = this.settings.get('maxEnergy');
    this.actionLock = 0;
    this.actionName = null;
    this.aimPose = false;
    this.pendingStrike = null;
    this.pendingSlam = null;
    this.slamDive = false;
    this.vehicle = null;
    this.airTime = 0;
    this.coyote = 0;
    this.bank = 0;
    this.flightBlend = 0;
    this.diveBlend = 0;
    this.breach = 0;
    this.rollT = 0;
    this.rollDur = 0.52;
    this.rollDir = 1;
    this.rollTurns = 1;
    this.rollAngle = 0;
    this.boomCooldown = 0;
    this.lastSpeed = 0;
    this.hurtT = 0;
    this.noControlT = 0;      // brief window where air control is off
    this.swimming = false;
    this.faceLock = 0;        // seconds left forcing the body toward the aim
    this.lungeT = 0;
    this.lungeDir = new THREE.Vector3();
    this.lungeSpeed = 0;
    this.stats = { crimes: 0, takedowns: 0 };

    /* ---- rigs ---- */
    this.holder = new THREE.Group();
    this.inner = new THREE.Group();
    this.inner.position.y = -1.0;
    this.holder.add(this.inner);
    world.scene.add(this.holder);

    this.rigs = {};
    this.buildRigs();

    this.cape = new Cape(world.scene, { color: this.settings.get('suit.capeColor') });
    // buildRigs() ran before the cape existed, so settle its visibility now
    this.applyActive();

    this.powers = makePowers(this);
    this.powerIndex = clamp(this.settings.get('startPower') | 0, 0, this.powers.length - 1);
  }

  get power () { return this.powers[this.powerIndex]; }
  get strength () { return this.settings.get('strength'); }
  get maxHealth () { return this.settings.get('maxHealth'); }
  get maxEnergy () { return this.settings.get('maxEnergy'); }
  get speed () { return this.vel.length(); }
  get speedRatio () { return clamp((this.speed - 26) / 78, 0, 1); }

  /* ================= rigs & appearance ================= */

  buildRigs () {
    const s = this.settings.data;
    for (const k of ['suit', 'civ']) {
      if (this.rigs[k]) this.inner.remove(this.rigs[k].built.group);
    }
    const suitBuilt = buildCharacter(heroSuitAppearance(s.suit));
    const civBuilt = buildCharacter(heroCivAppearance(s.civ, s.suit.build * 0.94, s.suit.height));
    this.rigs.suit = { built: suitBuilt, anim: new Animator(suitBuilt) };
    this.rigs.civ = { built: civBuilt, anim: new Animator(civBuilt) };
    for (const k of ['suit', 'civ']) {
      this.inner.add(this.rigs[k].built.group);
      this.rigs[k].anim.onEvent = (e) => { if (e === 'hit') this.onStrikeFrame(); };
    }
    this.applyActive();
    if (this.cape) this.cape.setColor(s.suit.capeColor);
  }

  applyActive () {
    const active = this.suited ? 'suit' : 'civ';
    for (const k of ['suit', 'civ']) this.rigs[k].built.group.visible = (k === active);
    this.rig = this.rigs[active].built;
    this.anim = this.rigs[active].anim;
    this.bones = this.rig.bones;
    if (this.cape) this.cape.setVisible(this.suited && this.settings.get('suit.cape'));
  }

  transform () {
    if (this.actionLock > 0.2) return;
    this.suited = !this.suited;
    this.power?.cancel?.();
    this.applyActive();
    const c = this.pos.clone(); c.y += 1.0;
    const col = this.suited ? this.settings.get('suit.accent') : '#cfe6ff';
    const fx = this.world.effects;
    fx.burst(c, col, 60, 14, 0.55, 0.7, { grav: -4, drag: 0.9 });
    fx.ring(c, col, 0.4, 6.5, 0.55);
    fx.ring(c, '#ffffff', 0.3, 4.0, 0.4);
    this.cam.addShake(0.22);
    if (this.cape) this.cape.reset();
    this.world.flashTransform();
    this.world.notify(this.suited ? 'SUITED UP' : 'BACK TO CIVILIAN');

  }

  setEyeGlow (v) {
    const em = this.rig.parts.mask?.material;
    if (em && em.emissive) em.emissiveIntensity = lerp(this.settings.get('suit.glow'), 4.5, v);
  }

  /* ================= helpers used by powers ================= */

  spendEnergy (n) {
    if (!this.settings.get('energyEnabled')) return true;
    if (this.energy < n) return false;
    this.energy -= n;
    return true;
  }

  playAction (name, opts = {}) {
    if (opts.hold) {
      this.anim.play(name, { fade: 0.14, speed: opts.speed ?? 1 });
      this.holdPose = name;
      return;
    }
    this.holdPose = null;
    this.anim.play(name, { fade: opts.fade ?? 0.07, restart: true, speed: opts.speed ?? 1 });
    this.actionLock = opts.lock ?? 0.3;
    this.actionName = name;
  }

  setAimPose (on) { this.aimPose = on; }

  /**
   * Best melee target under the crosshair.
   *
   * The body's facing follows movement, not the camera, so without this a
   * punch fires off in whatever direction you last walked instead of at the
   * thing you're looking at.
   */
  meleeTarget (range = 7, cone = 0.62) {
    const o = this.world.camera.position;
    const d = this.cam.forward(_v2);
    let best = null, bestScore = -Infinity;
    for (const a of this.world.enemies) {
      if (a.dead || a.phys === 'held') continue;
      const dist = a.pos.distanceTo(this.pos);
      if (dist > range) continue;
      _v3.copy(a.pos); _v3.y += a.height * 0.5;
      _v3.sub(o).normalize();
      const dot = _v3.dot(d);
      if (dot < 1 - cone) continue;
      const score = dot * 3 - dist * 0.12;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  /** Turn the body to the aim (or a specific target) and hold it there. */
  faceAim (target = null, hold = 0.35) {
    this.faceHeading = target
      ? Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z)
      : this.cam.yaw;
    this.faceLock = hold;
  }

  /** Short step-in so a swing at something just out of reach still lands. */
  lungeTo (target, minGap = 2.2) {
    const d = this.pos.distanceTo(target.pos);
    if (d <= minGap) return;
    this.lungeDir.copy(target.pos).sub(this.pos).setY(0).normalize();
    this.lungeSpeed = Math.min((d - minGap) / 0.16, 26);
    this.lungeT = 0.16;
  }

  eyePosition (out = new THREE.Vector3()) {
    const h = this.bones.head;
    h.updateWorldMatrix(true, false);
    out.set(0, this.rig.P.headR * 0.95, this.rig.P.headR * 0.92);
    return h.localToWorld(out);
  }

  handPosition (out = new THREE.Vector3(), side = 'R') {
    const h = this.bones['hand' + side];
    h.updateWorldMatrix(true, false);
    out.set(0, -this.rig.P.armR2 * 2.0, 0);
    return h.localToWorld(out);
  }

  rightVector (out = new THREE.Vector3()) {
    return out.set(-1, 0, 0).applyQuaternion(this.holder.quaternion);
  }

  /** Where the crosshair lands in the world, with light aim assist. */
  aimPoint (range = 120, out = new THREE.Vector3()) {
    const o = this.world.camera.position;
    const d = this.cam.forward(_v2);
    let best = range;
    const hit = this.world.city.raycastBuildings(o, d, range);
    if (hit) best = hit.dist;
    // Stop where the ray meets the ground it is actually over. A fixed
    // sea-level plane is right only in the street: aiming down from a rooftop,
    // a ship's deck or the penthouse it cuts the ray off at y = 0, far below
    // the surface you are standing on — so a long-range aim lands in the sea a
    // few metres away instead of where you were pointing.
    if (d.y < -0.0001) {
      const STEP = 2.5;
      for (let t = 2; t < best; t += STEP) {
        const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
        if (py <= this.world.city.groundHeight(px, pz, py + 2.5)) {
          best = Math.max(1, t - STEP * 0.5);
          break;
        }
      }
    }
    // vehicles are solid to a beam — without this, heat vision aims straight
    // through a car and burns the pavement behind it
    for (const v of this.world.traffic.vehicles) {
      if (v.state === 'held') continue;
      const ox = v.pos.x - o.x, oy = (v.pos.y + 0.8) - o.y, oz = v.pos.z - o.z;
      const t = ox * d.x + oy * d.y + oz * d.z;
      if (t < 1 || t > best) continue;
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      if (Math.hypot(v.pos.x - px, v.pos.y + 0.8 - py, v.pos.z - pz) < 1.9) best = t;
    }

    // snap to a hostile inside a narrow cone
    let bestDot = 0.985;
    for (const a of this.world.enemies) {
      if (a.dead) continue;
      _v3.copy(a.pos); _v3.y += a.height * 0.55;
      const dist = _v3.distanceTo(o);
      if (dist > best + 3 || dist < 1) continue;
      _v3.sub(o).normalize();
      const dot = _v3.dot(d);
      if (dot > bestDot) { bestDot = dot; best = Math.min(best, dist); }
    }
    return out.copy(o).addScaledVector(d, best);
  }

  /**
   * Nearest actor or vehicle along the aim ray (not merely near the far aim
   * point) — what telekinesis and any other "grab that thing" power wants.
   */
  rayPick (range = 46, tol = 2.6) {
    const o = this.world.camera.position;
    const d = this.cam.forward(_v2);
    let best = null, bestT = range;
    const consider = (kind, ref, cx, cy, cz, r) => {
      const ox = cx - o.x, oy = cy - o.y, oz = cz - o.z;
      const t = ox * d.x + oy * d.y + oz * d.z;
      if (t < 0.5 || t > range || t > bestT) return;
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      const dist = Math.hypot(cx - px, cy - py, cz - pz);
      if (dist <= r) { bestT = t; best = { kind, ref, dist: t }; }
    };
    // anything already in the air gets a far more forgiving cone — snatching a
    // tumbling body or a flying car out of mid-flight should feel easy
    const AIR = 2.4;
    for (const a of this.world.enemies) {
      if (a.dead) continue;
      const air = a.phys === 'ragdoll' ? AIR : 1;
      consider('actor', a, a.pos.x, a.pos.y + a.height * 0.55, a.pos.z, tol * air);
    }
    for (const a of this.world.peds) {
      const air = a.phys === 'ragdoll' ? AIR : 0.8;
      consider('actor', a, a.pos.x, a.pos.y + a.height * 0.55, a.pos.z, tol * air);
    }
    for (const v of this.world.traffic.vehicles) {
      if (v.driver === 'player' || v.state === 'held') continue;
      const air = v.state === 'thrown' ? AIR : 1;
      consider('vehicle', v, v.pos.x, v.pos.y + 0.85, v.pos.z, (tol + 1.4) * air);
    }
    for (const pr of this.world.city.props) {
      if (!pr.alive) continue;
      consider('prop', pr, pr.center.x, pr.center.y, pr.center.z, tol + pr.radius);
    }
    // loose debris that's already been torn off stays grabbable
    for (const it of this.world.props.items) {
      if (it.state === 'held') continue;
      const air = it.state === 'thrown' ? AIR : 1;
      consider('item', it, it.pos.x, it.pos.y, it.pos.z, (tol + it.radius) * air);
    }
    return best;
  }

  aimDirection (out = new THREE.Vector3(), from = null) {
    const p = this.aimPoint(140, _v1);
    if (from) return out.copy(p).sub(from).normalize();
    const o = _v2.copy(this.pos); o.y += 1.4;
    return out.copy(p).sub(o).normalize();
  }

  dealDamage (actor, amount, dir, knock = 0, silent = false, up = 0.45, hitY = 1.35) {
    if (!actor || actor.dead) return;
    const killed = actor.damage(amount, this);
    if (knock > 0) actor.applyKnockback(dir, knock, up, hitY);
    if (!silent) {
      _v1.copy(actor.pos); _v1.y += actor.height * 0.62;
      this.world.effects.burst(_v1, '#ffd9a0', 6, 5, 0.3, 0.25, { grav: -6 });
    }
    if (killed) { this.stats.takedowns++; this.world.onTakedown?.(actor); }
  }

  onStrikeFrame () {
    if (!this.pendingStrike) return;
    const s = this.pendingStrike;
    this.pendingStrike = null;
    const fwd = _v1.set(0, 0, 1).applyQuaternion(this.holder.quaternion);
    const origin = _v2.copy(this.pos).addScaledVector(fwd, 1.0);
    origin.y += 1.15;

    // the acquired target always counts, even if the step-in didn't quite
    // close the gap — nothing feels worse than a punch that visually connects
    // and does nothing
    let any = false;
    const tgt = s.target;
    if (tgt && !tgt.dead && this.pos.distanceTo(tgt.pos) < s.reach + 3.5) {
      _v3.copy(tgt.pos).sub(this.pos).setY(0).normalize();
      this.dealDamage(tgt, s.damage, _v3, s.knock, false, s.up, s.hitY);
      any = true;
    }
    const hit = this.world.applyImpact(origin, s.reach, {
      damage: s.damage, knock: s.knock, up: s.up, hitY: s.hitY,
      falloff: 0.25, vehicleDamage: 55 * this.strength, propForce: 26 * this.strength,
      skip: tgt, color: s.color
    });
    any = any || hit > 0;

    const fx = this.world.effects;
    if (any) {
      fx.burst(origin, '#ffe9c0', 20, 12, 0.45, 0.35, { grav: -6 });
      fx.ring(origin, s.color, 0.25, 1.6, 0.20, { rx: Math.PI / 2, ry: this.heading });
      this.cam.addShake(0.32);
    } else {
      fx.burst(origin, s.color, 7, 8, 0.28, 0.22);
      this.cam.addShake(0.07);
    }
  }

  doSlam (radius, damage, color) {
    const c = this.pos.clone();
    const fx = this.world.effects;
    fx.shockwave(c, color, radius, 0.6);
    fx.ring(c, '#ffffff', 0.5, radius * 0.55, 0.35);
    fx.burst(c, '#c8b89a', 45, 16, 0.6, 0.8, { grav: -14, drag: 0.92 });
    fx.spawnDebris(c, '#5a5f68', 14, 11, 0.30);
    this.cam.addShake(0.95);
    this.world.applyImpact(c, radius, {
      damage, knock: 26 * this.strength, up: 1.25, hitY: 0.35,
      vehicleDamage: 45, propForce: 30, falloff: 0.6
    });
  }

  startSlamDive () {
    this.slamDive = true;
    this.vel.set(this.vel.x * 0.2, -85, this.vel.z * 0.2);
    this.anim.play('dive', { fade: 0.1 });
    this.world.effects.burst(this.pos, this.power.color, 24, 12, 0.5, 0.4);
  }

  /* ================= damage ================= */

  takeDamage (amount, fromPos) {
    if (!this.settings.get('hasHealth') || this.settings.get('invulnerable') || this.downed) return;
    this.health -= amount;
    this.hurtT = 0.55;
    this.anim.flinch = 1;
    this.cam.addShake(clamp(amount * 0.012, 0.05, 0.4));
    this.world.onPlayerHurt?.(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.downed = true;
      this.downT = 0;
      this.flying = false;
      this.anim.play('knockdown', { fade: 0.08 });
      this.world.notify('DOWNED — getting back up');
    }
  }

  /* ================= vehicles ================= */

  tryEnterVehicle () {
    if (this.vehicle) { this.exitVehicle(); return; }
    if (this.flying) return;
    const v = this.world.traffic.nearest(this.pos, 5.5,
      x => x.state !== 'wrecked' && x.state !== 'held' && x.state !== 'thrown' && x.driver !== 'player');
    if (!v) { this.world.notify('No vehicle in reach'); return; }
    const wasNpc = v.driver === 'npc';
    this.world.traffic.hijack(v, 'player', (veh) => {
      const p = this.world.spawnPedestrian(veh.pos.x + rand(-2.5, 2.5), veh.pos.z + rand(-2.5, 2.5));
      p?.panic(this.pos, 1);
    });
    this.vehicle = v;
    this.holder.visible = false;
    if (this.cape) this.cape.setVisible(false);
    this.world.notify(wasNpc ? 'VEHICLE HIJACKED' : 'DRIVING');
  }

  exitVehicle () {
    if (!this.vehicle) return;
    const v = this.vehicle;
    const rx = -Math.cos(v.heading), rz = Math.sin(v.heading);
    this.pos.set(v.pos.x - rx * 2.2, v.pos.y, v.pos.z - rz * 2.2);
    this.pos.y = this.world.city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 2);
    this.heading = v.heading;
    this.vel.set(0, 0, 0);
    this.world.traffic.release(v);
    this.vehicle = null;
    this.holder.visible = true;
    if (this.cape) { this.cape.setVisible(this.suited && this.settings.get('suit.cape')); this.cape.reset(); }
  }

  /* ================= flight ================= */

  startFlight () {
    if (this.flying) return;
    if (this.settings.get('flightMode') === 'paragon' && this.power.id !== 'paragon') {
      this.world.notify('Flight requires the PARAGON powerset');
      return;
    }
    this.flying = true;
    this.grounded = false;
    this.slamDive = false;
    this.vel.y = Math.max(this.vel.y, 7);
    this.anim.play('takeoff', { fade: 0.1 });
    const c = this.pos.clone();
    this.world.effects.ring(c, this.power.color, 0.5, 7, 0.5);
    this.world.effects.burst(c, '#dceeff', 26, 9, 0.5, 0.5, { grav: -5 });
    this.cam.addShake(0.18);
  }

  stopFlight () {
    if (!this.flying) return;
    this.flying = false;
    this.flightBlend = 0;
    this.bank = 0;
    this.rollT = 0;
    this.rollAngle = 0;
    this.airTime = 0;
  }

  /**
   * Drop out of flight without killing the velocity — you keep sailing on the
   * arc you were already on instead of stopping dead in mid-air.
   */
  disengageFlight () {
    if (!this.flying) return;
    const sp = this.speed;
    this.stopFlight();
    this.grounded = false;
    this.noControlT = 0.55;
    const fx = this.world.effects;
    fx.burst(this.pos, '#bfe6ff', 14, 6, 0.4, 0.4, { grav: -4 });
    if (sp > 20) this.world.notify('FLIGHT DISENGAGED');
  }

  _flight (dt, input) {
    const s = this.settings;
    const boosting = input.sprint;
    // The sprint flight and the cruise are tuned independently — they are two
    // different ways of flying, so one pair of multipliers can't serve both.
    const spMul = s.get(boosting ? 'boostSpeed' : 'flightSpeed');
    const acMul = s.get(boosting ? 'boostAccel' : 'flightAccel');
    const maxSpeed = (boosting ? 118 : 52) * spMul;
    const accel = (boosting ? 88 : 46) * acMul;

    const fwd = this.cam.forward(_v1);
    const right = this.cam.right(_v2);
    const move = input.move;

    const desired = _v3.set(0, 0, 0);
    if (move.y !== 0) desired.addScaledVector(fwd, move.y);   // S thrusts backwards
    if (move.x !== 0) desired.addScaledVector(right, move.x);
    if (input.up) desired.y += 1.0;
    if (input.down) desired.y -= 1.0;

    if (this.slamDive) {
      this.vel.y = -95;
    } else if (desired.lengthSq() > 0.0001) {
      desired.normalize();
      const target = desired.multiplyScalar(maxSpeed);
      const k = 1 - Math.exp(-(accel / Math.max(maxSpeed, 1)) * 2.6 * dt);
      this.vel.lerp(target, k);
    } else {
      // Hover: hold altitude and bleed off speed — but gently while you're
      // still moving fast, so letting go at sprint speed coasts to a stop
      // instead of stopping dead in the air. The hard damping only comes in
      // once you're slow enough to want to park precisely.
      const fast = Math.hypot(this.vel.x, this.vel.z) > 34;
      const damp = Math.pow(fast ? 0.62 : 0.12, dt);
      this.vel.x *= damp; this.vel.z *= damp;
      this.vel.y = smooth(this.vel.y, 0, 5 * dt);
    }
    // Releasing sprint drops the cap from 118 to 52 m/s. Snapping the vector
    // to the new cap kills the momentum dead, so bleed the excess off at a
    // fixed rate instead and let the hero coast down out of a sprint.
    const cur = this.vel.length();
    if (cur > maxSpeed) this.vel.setLength(Math.max(maxSpeed, cur - 46 * dt));

    this.pos.addScaledVector(this.vel, dt);

    // ceiling & floor
    if (this.pos.y > 800) { this.pos.y = 800; this.vel.y = Math.min(this.vel.y, 0); }
    const g = this.world.city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.5);
    this.groundY = g;
    // Some powersets treat flight as the state you live in: flying into the
    // ground skims along it rather than putting you down, and the only ways
    // out are holding descend all the way to the floor, the flight toggle, or
    // a double tap of jump — all of which are handled in update().
    if (this.pos.y <= g + 0.06 && this.power?.stickyFlight && !input.down && !this.slamDive) {
      this.pos.y = g + 0.06;
      this.vel.y = Math.max(this.vel.y, 0);
      if (this.speed > 14) {
        this.world.effects.burst(this.pos, '#cfd6e0', 5, 6, 0.3, 0.25, { grav: -6 });
      }
    } else if (this.pos.y <= g + 0.06) {
      this.pos.y = g;
      const impact = -this.vel.y;
      this.stopFlight();
      this.grounded = true;
      this.vel.y = 0;
      if (this.slamDive) {
        this.slamDive = false;
        this.doSlam(24 * this.strength, 110 * this.strength, this.power.color);
        this.anim.play('heroLand', { fade: 0.05 });
        this.actionLock = 0.75;
      } else if (impact > 20) {
        this.heroLanding(impact);
      } else {
        this.anim.play('land', { fade: 0.1 });
        this.actionLock = 0.2;
      }
      return;
    }

    // buildings
    const before = _v1.copy(this.pos);
    if (this.world.city.resolveCollision(this.pos, this.radius + 0.25, this.pos.y, this.pos.y + this.height)) {
      const push = _v2.copy(this.pos).sub(before);
      if (push.lengthSq() > 1e-6) {
        push.normalize();
        const into = this.vel.dot(push);
        if (into < 0) this.vel.addScaledVector(push, -into * 1.25);
        if (this.speed > 30) {
          this.world.effects.burst(this.pos, '#cfd6e0', 16, 10, 0.4, 0.35, { grav: -8 });
          this.cam.addShake(0.30);
        }
        this.vel.multiplyScalar(0.72);
      }
    }

    /* ---- orientation: build a basis from the travel direction ---- */
    const sp = this.vel.length();
    // Upright until genuinely travelling *horizontally*, then tip into the
    // head-first cruise. Keyed off ground speed, so climbing straight up keeps
    // the hero levitating vertically rather than pitching over.
    const hsp = Math.hypot(this.vel.x, this.vel.z);
    // Only a SPRINT flight tips the hero head-first. A normal flight stays
    // upright and levitates along, however fast it happens to be travelling —
    // the two read as completely different ways of flying.
    const blendTarget = boosting ? clamp((hsp - 32) / 34, 0, 1) : 0;
    this.flightBlend = smooth(this.flightBlend, blendTarget, 7 * dt);

    let dir;
    if (sp > 1.2) dir = _v1.copy(this.vel).normalize();
    else dir = this.cam.forward(_v1);

    // banking from how hard the travel direction is turning
    const yawNow = Math.atan2(dir.x, dir.z);
    const turn = angleDelta(this.lastYaw ?? yawNow, yawNow) / Math.max(dt, 1e-3);
    this.lastYaw = yawNow;
    // a fast flick of the view rolls the hero into the turn
    const whipRaw = -this.cam.yawRate;
    const whip = clamp(whipRaw * 0.42, -1.3, 1.3);
    const bankTarget = clamp(-turn * 0.26 - move.x * 0.40 + whip, -1.45, 1.45) *
      clamp(sp / 26, 0, 1);
    this.bank = smooth(this.bank, bankTarget, 6.5 * dt);

    /* ---- barrel roll ---- */
    // Past a certain sharpness a whip of the view shouldn't just lean the hero
    // over, it should throw them through a full roll. Once committed the roll
    // runs to completion under its own momentum, so it reads as a deliberate
    // aerobatic move rather than a twitch that follows the mouse.
    if (this.rollT > 0) {
      this.rollT -= dt;
      const t = clamp(1 - this.rollT / this.rollDur, 0, 1);
      this.rollAngle = this.rollDir * t * t * (3 - 2 * t) * Math.PI * 2 * this.rollTurns;
      if (this.rollT <= 0) { this.rollAngle = 0; this.rollT = 0; }
    } else if (sp > 40 && this.flightBlend > 0.35 && Math.abs(whipRaw) > ROLL_WHIP) {
      // a harder whip spins you further round
      this.rollTurns = Math.abs(whipRaw) > ROLL_WHIP * 1.9 ? 2 : 1;
      this.rollDur = 0.52 * this.rollTurns;
      this.rollT = this.rollDur;
      this.rollDir = Math.sign(whipRaw);
      this.cam.addShake(0.18);
      const back = _v2.copy(this.vel).normalize().multiplyScalar(-2.0);
      this.world.effects.burst(
        _v3.copy(this.pos).add(back), '#dff2ff', 18, 9, 0.4, 0.45, { grav: -3, drag: 0.9 });
    }

    // A hard turn scrubs speed. Cornering for free is what makes flight feel
    // weightless rather than fast.
    const turnMag = Math.abs(turn);
    if (turnMag > 1.1 && sp > 28) {
      const scrub = clamp((turnMag - 1.1) * 0.22, 0, 1.4);
      this.vel.multiplyScalar(Math.max(0.965, 1 - scrub * dt));
      this.cam.addShake(clamp(scrub * 0.05, 0, 0.16));
    }

    // upright hover orientation
    _q1.setFromEuler(new THREE.Euler(0, yawNow, 0, 'YXZ'));
    // head-first orientation: local +Y along travel, rolled by bank
    const yAxis = _v2.copy(dir);
    const xAxis = _v3.copy(UP).cross(yAxis);
    if (xAxis.lengthSq() < 1e-4) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    const roll = this.bank + this.rollAngle;
    const cb = Math.cos(roll), sb = Math.sin(roll);
    const xr = xAxis.clone().multiplyScalar(cb).addScaledVector(zAxis, sb);
    const zr = zAxis.clone().multiplyScalar(cb).addScaledVector(xAxis, -sb);
    _m3.makeBasis(xr, yAxis, zr);
    _q2.setFromRotationMatrix(_m3);

    this.holder.quaternion.slerpQuaternions(_q1, _q2, this.flightBlend);
    this.heading = yawNow;

    /* ---- flight animation ---- */
    if (this.actionLock <= 0 && !this.holdPose) {
      // The raised fist is part of the sprint flight, not of flying as such:
      // a normal flight keeps the upright, arms-down levitating pose.
      if (this.rollT > 0) this.anim.play('boost', { fade: 0.12 });
      else if (this.slamDive || (this.vel.y < -30 && sp > 30)) this.anim.play('dive', { fade: 0.2 });
      else if (boosting && sp > 60) this.anim.play('boost', { fade: 0.25 });
      else if (boosting && sp > 16) this.anim.play('cruise', { fade: 0.3 });
      else this.anim.play('hover', { fade: 0.35 });
    }

    /* ---- flight FX ---- */
    const fx = this.world.effects;
    if (sp > 24) {
      // stream the wake well behind the body, otherwise it sits on top of the
      // hero and the camera sees nothing but glare at high speed
      const back = _v2.copy(this.vel).normalize().multiplyScalar(-1);
      const p = _v3.copy(this.pos).addScaledVector(back, 2.2);
      p.y += 1.0;
      const col = boosting ? this.power.color : '#a8d8ff';
      const size = 0.22 + Math.min(sp, 70) * 0.0035;
      fx.trail(p, col, size, 0.26, 0.30);
      if (boosting && sp > 70) {
        p.addScaledVector(back, 1.4);
        fx.trail(p, '#dff2ff', size * 0.8, 0.18, 0.55);
      }
    }
    this.boomCooldown -= dt;
    if (sp > 88 * spMul && this.lastSpeed <= 88 * spMul && this.boomCooldown <= 0) {
      this.boomCooldown = 2.4;
      const d = _v2.copy(this.vel).normalize();
      const p = _v3.copy(this.pos); p.y += 1.0;
      fx.boom(p, d, '#ffffff', 16, 0.5);
      fx.boom(p, d, this.power.color, 22, 0.75);
      this.cam.addShake(0.5);
      this.world.notify('SONIC BOOM');
    }
    this.lastSpeed = sp;
  }

  heroLanding (impact) {
    this.anim.play('heroLand', { fade: 0.05 });
    this.actionLock = 0.65;
    const r = clamp(impact * 0.32, 4, 22);
    const fx = this.world.effects;
    fx.shockwave(this.pos, this.suited ? this.power.color : '#cfd6e0', r, 0.5);
    fx.burst(this.pos, '#c8b89a', 26, 12, 0.5, 0.6, { grav: -12 });
    fx.spawnDebris(this.pos, '#5a5f68', 7, 8, 0.24);
    this.cam.addShake(clamp(impact * 0.014, 0.2, 0.8));
    if (this.suited) {
      this.world.applyImpact(this.pos, r * 0.8, {
        damage: impact * 1.4 * this.strength, knock: 16, up: 0.9, hitY: 0.4,
        vehicleDamage: 35, propForce: 20, falloff: 0.55
      });
    }
  }

  /* ================= swimming ================= */

  /**
   * In the water. The hero floats at the surface and swims rather than walking
   * on it; the body is held horizontal and face-down, and you climb out
   * automatically as soon as the ground under you comes back above the
   * waterline.
   */
  _swim (dt, input) {
    const s = this.settings;
    // `pos` is the FEET, and syncMesh hangs the body a metre above it, so the
    // swimmer's torso sits at roughly pos.y + 1. Putting the feet just under
    // the waterline therefore leaves the whole body out of the water, crawling
    // across the top of it; the float height has to account for that offset.
    const surface = CITY.WATER_Y - 1.18;
    const sprint = input.sprint;
    const speed = (sprint ? 7.0 * s.get('sprintSpeed') : 3.4 * s.get('jogSpeed'));

    const fwd = this.cam.forward(_v1); fwd.y = 0; fwd.normalize();
    const right = this.cam.right(_v2);
    const wish = _v3.set(0, 0, 0);
    if (input.move.y !== 0) wish.addScaledVector(fwd, input.move.y);
    if (input.move.x !== 0) wish.addScaledVector(right, input.move.x);
    const moving = wish.lengthSq() > 0.0001;

    if (moving) {
      wish.normalize();
      this.vel.x = smooth(this.vel.x, wish.x * speed, 5 * dt);
      this.vel.z = smooth(this.vel.z, wish.z * speed, 5 * dt);
      this.heading = approachAngle(this.heading, Math.atan2(wish.x, wish.z), 6, dt);
    } else {
      const damp = Math.pow(0.02, dt);
      this.vel.x *= damp; this.vel.z *= damp;
    }
    // Bob up to the surface. Holding the ascend key has to actually beat the
    // restoring force, or you can never break the surface and you're stuck in
    // the water with no way out of it.
    const lift = input.up ? 7.5 : 0;
    this.vel.y = smooth(this.vel.y, (surface - this.pos.y) * 3.5 + lift, 8 * dt);
    if (this.breach > 0) { this.breach -= dt; this.vel.y = Math.max(this.vel.y, 7.5); }
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = Math.max(this.pos.y, CITY.WATER_Y - 2.0);

    this.world.city.resolveCollision(this.pos, this.radius, this.pos.y - 0.4, this.pos.y + 1.2);

    // wake
    if (this.speed > 1.2 && Math.random() < dt * 26) {
      this.world.effects.particle(
        this.pos.x + rand(-0.5, 0.5), CITY.WATER_Y + 0.05, this.pos.z + rand(-0.5, 0.5),
        rand(-0.6, 0.6), rand(0.4, 1.6), rand(-0.6, 0.6),
        '#cfe8f2', rand(0.25, 0.55), rand(0.35, 0.7), { grav: -4, drag: 0.9 }
      );
    }

    // Climb out where there's something to climb onto — the shore ahead, or
    // anything solid you've been lifted level with, such as a deck or a quay.
    const ahead = _v1.set(this.pos.x + Math.sin(this.heading) * 1.5, 0,
      this.pos.z + Math.cos(this.heading) * 1.5);
    const gh = this.world.city.groundHeight(ahead.x, ahead.z, this.pos.y + 2.4);
    if (gh > CITY.WATER_Y + 0.1 && gh < this.pos.y + 2.2) {
      this.pos.x = ahead.x; this.pos.z = ahead.z;
      this.pos.y = gh;
      this.exitWater();
      this.vel.y = Math.max(this.vel.y, 1.5);
      return;
    }

    _e2.set(moving ? 1.35 : 0, this.heading, 0, 'YXZ');
    this.holder.quaternion.setFromEuler(_e2);
    if (this.actionLock <= 0) {
      this.anim.play(moving ? 'swim' : 'tread', { fade: 0.3, speed: moving ? clamp(this.speed / 3.4, 0.8, 1.8) : 1 });
    }
  }

  enterWater () {
    if (this.swimming) return;
    this.swimming = true;
    this.breach = 0;
    this.stopFlight();
    this.grounded = false;
    this.vel.y = Math.max(this.vel.y, -4);
    const c = _v1.copy(this.pos); c.y = CITY.WATER_Y;
    this.world.effects.burst(c, '#dff2fb', 34, 9, 0.5, 0.8, { grav: -7, drag: 0.9 });
    this.world.effects.ring(c, '#cfe8f2', 0.5, 7, 0.6);
    this.cam.addShake(0.2);
  }

  exitWater () {
    if (!this.swimming) return;
    this.swimming = false;
    this.grounded = true;
    this.vel.set(0, 0, 0);
  }

  /* ================= ground ================= */

  _ground (dt, input) {
    const s = this.settings;
    const sprint = input.sprint && !this.aimPose;
    const jogMul = s.get('jogSpeed'), sprintMul = s.get('sprintSpeed');
    const maxSpeed = sprint ? 16.5 * sprintMul : 6.4 * jogMul;
    const move = input.move;

    const fwd = this.cam.forward(_v1); fwd.y = 0; fwd.normalize();
    const right = this.cam.right(_v2);
    const wish = _v3.set(0, 0, 0);
    if (move.y !== 0) wish.addScaledVector(fwd, move.y);
    if (move.x !== 0) wish.addScaledVector(right, move.x);

    // after disengaging flight the hero coasts; air control returns shortly
    this.noControlT = Math.max(0, this.noControlT - dt);
    const moving = wish.lengthSq() > 0.0001 && this.actionLock <= 0 && this.noControlT <= 0;
    // free fall gets real authority — you can steer a dive, not just drift
    const accel = this.grounded ? 42 : 30;
    if (moving) {
      wish.normalize();
      const tx = wish.x * maxSpeed, tz = wish.z * maxSpeed;
      this.vel.x += clamp(tx - this.vel.x, -accel * dt, accel * dt) * 2.2;
      this.vel.z += clamp(tz - this.vel.z, -accel * dt, accel * dt) * 2.2;
      const target = Math.atan2(wish.x, wish.z);
      this.heading = approachAngle(this.heading, target, this.grounded ? 13 : 10, dt);
    } else if (this.grounded) {
      const damp = Math.pow(0.0009, dt);
      this.vel.x *= damp; this.vel.z *= damp;
    }
    if (this.faceLock > 0) {
      this.faceLock -= dt;
      this.heading = approachAngle(this.heading, this.faceHeading, 26, dt);
    } else if (this.aimPose && this.grounded) {
      this.heading = approachAngle(this.heading, this.cam.yaw, 14, dt);
    }

    if (this.lungeT > 0) {
      this.lungeT -= dt;
      this.vel.x = this.lungeDir.x * this.lungeSpeed;
      this.vel.z = this.lungeDir.z * this.lungeSpeed;
    }

    // jump
    if (input.jumpPressed && (this.grounded || this.coyote > 0) && this.actionLock <= 0) {
      this.vel.y = 10.6 * s.get('jumpPower');
      this.grounded = false;
      this.coyote = 0;
      this.airTime = 0;
      this.anim.play('jumpUp', { fade: 0.06 });
      this.world.effects.burst(this.pos, '#d8e6f2', 12, 6, 0.35, 0.35, { grav: -8 });
    }

    // skydiving: tuck to drop faster, spread to slow the descent
    let gscale = 1;
    if (!this.grounded && this.airTime > 0.25) {
      if (input.down) gscale = 1.7;
      else if (input.up) gscale = 0.55;
    }
    this.vel.y -= GRAVITY * gscale * dt;
    if (!this.grounded && input.up && this.vel.y < -14) this.vel.y = -14;   // terminal glide
    this.pos.addScaledVector(this.vel, dt);

    const g = this.world.city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.2);
    this.groundY = g;
    const wasGrounded = this.grounded;
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (!wasGrounded) {
        const impact = -this.vel.y;
        if (impact > 22 && this.suited) this.heroLanding(impact);
        else if (impact > 6) { this.anim.play('land', { fade: 0.08 }); this.actionLock = 0.18; }
        this.world.effects.burst(this.pos, '#c9d3de', clamp(impact * 0.4, 3, 20), 5, 0.3, 0.3, { grav: -8 });
      }
      this.grounded = true;
      this.vel.y = 0;
      this.airTime = 0;
      this.coyote = 0.12;
    } else if (wasGrounded && this.vel.y <= 0.5 &&
               this.pos.y - g < 0.4 + Math.hypot(this.vel.x, this.vel.z) * 0.07) {
      // Running downhill the ground falls away faster than gravity pulls you
      // into it, so you leave the surface and re-land every single frame and
      // the whole descent judders. Stay glued while the drop is no more than a
      // stride's worth — step off anything bigger and you're properly airborne.
      this.pos.y = g;
      this.vel.y = 0;
      this.grounded = true;
      this.airTime = 0;
      this.coyote = 0.12;
    } else {
      this.grounded = false;
      this.airTime += dt;
      this.coyote -= dt;
    }

    // a stride's worth of step-up, so stairs and kerbs are climbable
    this.world.city.resolveCollision(this.pos, this.radius, this.pos.y, this.pos.y + this.height,
      false, this.grounded ? 0.55 : 0.2);
    const lim = 900 + 220;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    /* ---- falling fast and flat reads as a dive ---- */
    // Not flight — this is free fall. Once you're moving at sprint-flight
    // speed the body pitches into the direction of travel, and how far is set
    // by how lateral the fall is: skimming flat puts you nearly horizontal,
    // dropping straight down leaves you upright. No raised fist: that belongs
    // to the sprint flight.
    const hspd = Math.hypot(this.vel.x, this.vel.z);
    const vspd = Math.abs(this.vel.y);
    const fastEnough = clamp((hspd - 20) / 26, 0, 1);
    const lateral = hspd / Math.max(hspd + vspd, 1e-3);
    // Biased hard toward the dive: once there's any real lateral component it
    // should already be reading as a dive rather than a slight lean. Only a
    // fall that's genuinely near-vertical stays upright.
    const shaped = clamp((lateral - 0.18) / 0.52, 0, 1);
    const diveTarget = this.grounded ? 0 : fastEnough * Math.pow(shaped, 0.72);
    this.diveBlend = smooth(this.diveBlend, diveTarget, 6.5 * dt);

    if (this.diveBlend > 0.02) {
      // face the way you're actually travelling, then pitch over into it
      if (hspd > 6) {
        this.heading = approachAngle(this.heading, Math.atan2(this.vel.x, this.vel.z), 6, dt);
      }
      _e2.set(this.diveBlend * 1.42, this.heading, 0, 'YXZ');
      this.holder.quaternion.setFromEuler(_e2);
    } else {
      this.holder.quaternion.setFromEuler(new THREE.Euler(0, this.heading, 0, 'YXZ'));
    }

    /* ground animation */
    if (this.actionLock <= 0 && !this.holdPose) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (!this.grounded) {
        if (this.diveBlend > 0.3) this.anim.play('dive', { fade: 0.22 });
        else if (this.vel.y > 1.5) this.anim.play('jumpUp', { fade: 0.2 });
        else this.anim.play('fall', { fade: 0.22 });
      } else if (hs > Math.max(8, 6.4 * s.get('jogSpeed') * 1.15)) {
        this.anim.play('sprint', { fade: 0.18, speed: clamp(hs / (16.5 * s.get('sprintSpeed')), 0.75, 1.5) });
      } else if (hs > 2.6) {
        this.anim.play('run', { fade: 0.18, speed: clamp(hs / (6.4 * s.get('jogSpeed')), 0.7, 1.7) });
      } else if (hs > 0.35) {
        this.anim.play('walk', { fade: 0.2, speed: clamp(hs / 1.6, 0.6, 1.6) });
      } else {
        this.anim.play(this.suited ? 'idleSuit' : 'idle', { fade: 0.32 });
      }
    }
  }

  /**
   * Barge through whatever you run or fly into. The impulse is taken from the
   * closing speed at the moment of contact, so brushing past someone nudges
   * them and hitting them at 40 m/s sends them properly flying.
   */
  bodyCheck (dt) {
    const sp = this.speed;
    if (sp < 3.5 || this.vehicle) return;
    const reach = this.radius + (this.flying ? 1.4 : 0.9);

    for (const a of this.world.actorsNear(this.pos, reach + 0.5)) {
      if (a.phys !== 'walk') continue;
      _v1.copy(a.pos).sub(this.pos).setY(0);
      const d = _v1.length();
      if (d < 1e-4) continue;
      _v1.divideScalar(d);
      const closing = this.vel.x * _v1.x + this.vel.z * _v1.z;
      if (closing < 2.5) continue;                     // must be moving into them
      const force = clamp(closing * 0.85, 6, 34) * (this.suited ? 1 : 0.55);
      if (a.faction === 'civilian') {
        a.panic?.(this.pos, 1);
        a.applyKnockback(_v1, force, 0.42, 1.25);
      } else {
        this.dealDamage(a, closing * 1.4 * this.strength, _v1, force, false, 0.42, 1.25);
      }
      this.cam.addShake(clamp(force * 0.007, 0, 0.22));
      this.world.effects.burst(a.pos, '#ffe3bd', 8, 5, 0.3, 0.28, { grav: -6 });
      this.vel.multiplyScalar(0.93);                   // you lose a little too
    }

    // loose debris gets kicked out of the way; anything still rooted to the
    // ground does not budge until a power tears it off, but you feel it
    for (const it of this.world.props.items) {
      if (it.state !== 'settled' || it.restT > 0) continue;
      _v1.copy(it.pos).sub(this.pos).setY(0);
      const d = _v1.length();
      if (d > reach + it.radius) continue;
      _v1.divideScalar(Math.max(d, 1e-4));
      const closing = this.vel.x * _v1.x + this.vel.z * _v1.z;
      if (closing < 3) continue;
      it.smashed = true;                       // a kick shouldn't re-detonate it
      this.world.props.launch(it, _v1.setY(0.35).normalize(), clamp(closing * 0.8, 6, 40));
      this.vel.multiplyScalar(0.9);
      this.cam.addShake(0.12);
    }
    if (sp > 6) {
      for (const pr of this.world.city.propsNear(this.pos.x, this.pos.z, reach + 1.2)) {
        if (Math.abs(pr.center.y - this.pos.y) > 4) continue;
        _v1.copy(pr.center).sub(this.pos).setY(0);
        const d = _v1.length();
        if (d < 1e-4) continue;
        _v1.divideScalar(d);
        if (this.vel.x * _v1.x + this.vel.z * _v1.z < 3) continue;
        // rooted: it wins. You stop, it doesn't move.
        this._clangT = (this._clangT || 0) - dt;
        if (this._clangT <= 0) {
          this._clangT = 0.4;
          this.world.effects.burst(
            _v2.copy(this.pos).addScaledVector(_v1, 0.8).setY(this.pos.y + 1.1),
            '#cfd6e0', 12, 7, 0.3, 0.3, { grav: -7 }
          );
          this.cam.addShake(clamp(sp * 0.012, 0.1, 0.35));
          this.anim.flinch = 1;
        }
        const into = this.vel.x * _v1.x + this.vel.z * _v1.z;
        this.vel.x -= _v1.x * into * 0.95;
        this.vel.z -= _v1.z * into * 0.95;
      }
    }

    this._carHitT = (this._carHitT || 0) - dt;
    if (this._carHitT > 0) return;
    const v = this.world.traffic.nearest(this.pos, reach + 2.4,
      x => x.driver !== 'player' && x.state !== 'held');
    if (!v) return;
    _v1.copy(v.pos).sub(this.pos).setY(0);
    const d = _v1.length();
    if (d < 1e-4) return;
    _v1.divideScalar(d);
    const closing = this.vel.x * _v1.x + this.vel.z * _v1.z;
    if (closing < 4) return;
    this._carHitT = 0.35;
    const force = clamp(closing * 0.9, 8, 46) * (this.suited ? 1 : 0.4);
    this.world.traffic.impact(v, _v1, force, closing * 2.2 * this.strength);
    this.cam.addShake(clamp(force * 0.006, 0.05, 0.3));
    this.vel.multiplyScalar(this.flying ? 0.86 : 0.7);
  }

  /* ================= main update ================= */

  update (dt, input) {
    const s = this.settings;

    if (this.vehicle) {
      this.pos.copy(this.vehicle.pos);
      this.pos.y += 1.1;
      this.heading = this.vehicle.heading;
      this.energyRegen(dt);
      return;
    }

    if (this.downed) {
      this.downT += dt;
      this.vel.y -= GRAVITY * dt;
      this.pos.y = Math.max(this.pos.y + this.vel.y * dt, this.world.city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1));
      if (this.downT > 2.6) {
        this.anim.play('getUp', { fade: 0.15 });
        if (this.downT > 3.5) {
          this.downed = false;
          this.health = this.maxHealth * 0.45;
          this.actionLock = 0;
        }
      }
      this.anim.update(dt);
      this.syncMesh(dt);
      return;
    }

    this.actionLock = Math.max(0, this.actionLock - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.actionLock === 0) this.actionName = null;

    /* mode switches */
    this._t = (this._t || 0) + dt;
    if (input.toggleFlight) { this.flying ? this.stopFlight() : this.startFlight(); }
    if (input.jumpPressed) {
      // double-tapping jump drops out of flight, same as F
      if (this.flying && this._t - (this._lastJump || -9) < 0.33) this.stopFlight();
      this._lastJump = this._t;
    }
    if (!this.flying && !this.grounded && input.jumpPressed && this.airTime > 0.22) this.startFlight();
    if (this.swimming && input.jumpPressed) {
      // Only leave the water if flight actually engages. Exiting first and
      // then failing to take off drops you into the sea with `swimming` off,
      // and you sink and re-enter every frame — stuck, with no way up.
      const canFly = !(s.get('flightMode') === 'paragon' && this.power.id !== 'paragon');
      if (canFly) { this.exitWater(); this.startFlight(); }
      else this.breach = 0.45;          // a hard kick to the surface instead
    }
    if (this.flying && input.down && this.pos.y - this.groundY < 1.6) this.stopFlight();

    // fall into water -> start swimming; fly out of it -> stop
    const inWater = this.world.city.isWater(this.pos.x, this.pos.z);
    if (!this.flying && inWater && this.pos.y < CITY.WATER_Y + 0.9) this.enterWater();
    else if (this.swimming && (!inWater || this.flying)) this.exitWater();

    if (this.flying) this._flight(dt, input);
    else if (this.swimming) this._swim(dt, input);
    else this._ground(dt, input);
    if (!this.swimming) this.bodyCheck(dt);

    /* powers */
    // Powers are the character's, not the costume's — the suit is a look.
    if (!this.aimBlocked) {
      const P = this.power;
      if (input.primaryPressed) P.primary?.();
      if (input.secondaryPressed) P.secondaryDown?.();
      if (input.secondaryHeld) P.secondaryHold?.(dt);
      if (input.secondaryReleased) P.secondaryUp?.();
      if (input.ultPressed) P.ultimate?.();
      P.update?.(dt);
    }

    /* deferred slam from the animation event */
    if (this.pendingSlam && this.anim.clipName === 'slam' && this.anim.progress > 0.30) {
      const p = this.pendingSlam; this.pendingSlam = null;
      this.doSlam(p.radius, p.damage, p.color);
    }

    if (this.holdPose && !input.secondaryHeld) this.holdPose = null;

    this.energyRegen(dt);
    if (s.get('hasHealth') && !s.get('invulnerable')) {
      this.health = Math.min(this.maxHealth, this.health + s.get('regen') * dt);
    } else if (s.get('invulnerable')) this.health = this.maxHealth;

    this.anim.update(dt);
    this.syncMesh(dt);
  }

  energyRegen (dt) {
    if (!this.settings.get('energyEnabled')) { this.energy = this.maxEnergy; return; }
    this.energy = Math.min(this.maxEnergy, this.energy + this.settings.get('energyRegen') * dt);
  }

  syncMesh (dt) {
    this.holder.position.copy(this.pos);
    this.holder.position.y += 1.0;

    if (this.cape && this.cape.mesh.visible) {
      const chest = this.bones.chest;
      chest.updateWorldMatrix(true, false);
      const P = this.rig.P;
      // span must match the cloth's rest width or the sheet flares outward
      const half = this.cape.width / 2;
      this.cape.anchorL.set(half, P.chestH * 0.86, -P.torsoTop * 0.55);
      this.cape.anchorR.set(-half, P.chestH * 0.86, -P.torsoTop * 0.55);
      chest.localToWorld(this.cape.anchorL);
      chest.localToWorld(this.cape.anchorR);
      this.cape.bodyCenter.copy(this.pos); this.cape.bodyCenter.y += 1.0;
      this.cape.bodyRadius = 0.33;
      // the shoulder plane follows the body, including the flight pitch
      this.cape.forward.set(0, 0, 1).applyQuaternion(this.holder.quaternion);
      this.cape.update(dt, this.vel, this.flying);
    }
  }
}
