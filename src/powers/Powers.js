import * as THREE from 'three';
import { clamp, rand, lerp, pick } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/* ================================================================== *
 *  Projectiles
 * ================================================================== */

export class Projectiles {
  constructor (world) {
    this.world = world;
    this.list = [];
    this.geo = new THREE.IcosahedronGeometry(1, 2);
    this.pool = [];
  }
  _mesh (color, size) {
    let m = this.pool.pop();
    if (!m) {
      m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      m.renderOrder = 8;
      this.world.scene.add(m);
    }
    m.visible = true;
    m.material.color.set(color);
    m.material.opacity = 0.95;
    m.scale.setScalar(size);
    return m;
  }
  fire (opts) {
    this.world.audio.play('shot', opts.pos);
    const p = {
      pos: opts.pos.clone(), vel: opts.dir.clone().multiplyScalar(opts.speed),
      life: opts.life ?? 3.2, radius: opts.radius ?? 0.6, damage: opts.damage ?? 25,
      knock: opts.knock ?? 8, color: opts.color ?? '#ffaa33', blast: opts.blast ?? 4.5,
      grav: opts.grav ?? 0, trail: opts.trail ?? 1, size: opts.size ?? 0.55,
      mesh: this._mesh(opts.color ?? '#ffaa33', opts.size ?? 0.55),
      owner: opts.owner ?? 'player'
    };
    this.list.push(p);
    return p;
  }
  _explode (p) {
    const fx = this.world.effects;
    fx.burst(p.pos, p.color, 34, 13, 0.7, 0.7, { grav: -6, drag: 0.9 });
    fx.burst(p.pos, '#ffffff', 12, 18, 0.4, 0.28);
    fx.shockwave(p.pos, p.color, p.blast * 1.6, 0.45);
    fx.spawnDebris(p.pos, '#6b6f78', 5, 7, 0.22);
    this.world.player.cam?.addShake(clamp(p.blast * 0.035, 0, 0.5));
    this.world.applyImpact(p.pos, p.blast, {
      damage: p.damage, knock: p.knock, up: 0.65, hitY: 0.9,
      vehicleDamage: p.damage * 1.6, propForce: p.knock * 1.2
    });
  }
  update (dt) {
    const fx = this.world.effects;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      _a.copy(p.vel).multiplyScalar(dt);
      const step = _a.length();
      p.pos.add(_a);
      p.mesh.position.copy(p.pos);
      p.mesh.scale.setScalar(p.size * (1 + Math.sin(p.life * 30) * 0.08));
      if (p.trail) fx.trail(p.pos, p.color, p.size * 1.5, 0.3, 0.12);

      let hit = false;
      const gy = this.world.city.groundHeight(p.pos.x, p.pos.z, p.pos.y + 2);
      if (p.pos.y <= gy + 0.2) { p.pos.y = gy + 0.2; hit = true; }
      if (!hit && this.world.city.raycastBuildings(p.pos, _b.copy(p.vel).normalize(), Math.max(step, 1.5))) hit = true;
      if (!hit && this.world.scenarios?.hitTest(p.pos, p.radius + 1)) hit = true;
      if (!hit) {
        for (const a of this.world.actorsNear(p.pos, p.radius + 0.7)) {
          if (a.faction === 'civilian' || a.dead) continue;
          hit = true; break;
        }
      }
      if (hit || p.life <= 0) {
        if (hit) this._explode(p);
        p.mesh.visible = false;
        this.pool.push(p.mesh);
        this.list.splice(i, 1);
      }
    }
  }
}

/* ================================================================== *
 *  Base
 * ================================================================== */

class PowerSet {
  constructor (player) { this.p = player; this.t = 0; }
  get world () { return this.p.world; }
  get fx () { return this.p.world.effects; }
  cost (n) { return this.p.spendEnergy(n); }
  update () {}
  cancel () {}
}

/* ================================================================== *
 *  1 — PARAGON : flight, super strength, heat vision
 * ================================================================== */

export class Paragon extends PowerSet {
  constructor (p) {
    super(p);
    this.id = 'paragon';
    this.name = 'PARAGON';
    this.color = '#4fd1ff';
    this.desc = 'Flight · super strength · heat vision';
    this.combo = 0;
    this.comboT = 0;
    this.beams = null;
    this.beamHeat = 0;
  }

  primary () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(4)) return;
    this.comboT = 0.9;
    const clips = ['punchR', 'punchL', 'uppercut'];
    const name = clips[this.combo % 3];
    this.combo++;
    // aim the swing where the crosshair is, not where the body happens to face
    const target = this.p.meleeTarget(7.5);
    this.p.faceAim(target, name === 'uppercut' ? 0.5 : 0.36);
    if (target) this.p.lungeTo(target, 2.1);

    this.p.playAction(name, { lock: name === 'uppercut' ? 0.5 : 0.36 });
    this.p.pendingStrike = {
      damage: (name === 'uppercut' ? 55 : 32) * this.p.strength,
      // super strength should actually send people flying
      knock: (name === 'uppercut' ? 24 : 14) * this.p.strength,
      up: name === 'uppercut' ? 1.15 : 0.42,
      hitY: name === 'uppercut' ? 1.05 : 1.45,
      reach: 3.6, target, color: this.color
    };
  }

  secondaryHold (dt) {
    if (!this.p.suited) return;
    if (!this.cost(26 * dt)) { this.secondaryUp(); return; }
    const eyes = this.p.eyePosition(_a);
    const aim = this.p.aimPoint(160, _b);
    if (!this.beams) {
      this.beams = [this.fx.acquireBeam('#ff3a24', 0.085), this.fx.acquireBeam('#ff3a24', 0.085)];
      this.p.setEyeGlow(1);
    }
    const side = this.p.rightVector(_c).multiplyScalar(0.052);
    for (let i = 0; i < 2; i++) {
      const o = _d.copy(eyes).addScaledVector(side, i === 0 ? 1 : -1);
      this.fx.setBeam(this.beams[i], o, aim);
    }
    this.beamHeat += dt;
    if (this.beamHeat > 0.06) {
      this.beamHeat = 0;
      this.fx.burst(aim, '#ff8a3a', 5, 6, 0.34, 0.35, { grav: -5 });
      this.fx.burst(aim, '#ffe6a0', 2, 3, 0.22, 0.2);
      this.p.cam.addShake(0.02);
    }
    // heat vision burns whatever it lands on — people, cars, anything
    const hits = this.world.applyImpact(aim, 2.6, {
      damage: 120 * dt * this.p.strength, knock: 0,
      vehicleDamage: 150 * dt * this.p.strength, propForce: 0, falloff: 0.3
    });
    if (hits) this.world.audio?.beamHit(aim, dt, 1);
    this.p.setAimPose(true);
    this.p.playAction('heatVision', { hold: true });
  }

  secondaryUp () {
    if (this.beams) { for (const b of this.beams) this.fx.releaseBeam(b); this.beams = null; }
    this.p.setEyeGlow(0);
    this.p.setAimPose(false);
  }

  ultimate () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(38)) return;
    if (this.p.flying && this.p.pos.y > this.p.groundY + 4) {
      // dive-bomb: slam straight down and detonate on arrival
      this.p.startSlamDive();
      return;
    }
    this.p.playAction('slam', { lock: 0.6 });
    this.p.pendingSlam = { radius: 15 * this.p.strength, damage: 70 * this.p.strength, color: this.color };
  }

  update (dt) {
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
  }
  cancel () { this.secondaryUp(); }
}

/* ================================================================== *
 *  2 — KINETIC : telekinesis
 * ================================================================== */

export class Kinetic extends PowerSet {
  constructor (p) {
    super(p);
    this.id = 'kinetic';
    this.name = 'KINETIC';
    this.color = '#a77bff';
    this.desc = 'Force bolts · lift & hurl · repulsor nova';
    this.held = null;
    this.holdPoint = new THREE.Vector3();
    this.holdPrev = new THREE.Vector3();
    this.swing = new THREE.Vector3();   // how fast the grip is being whipped
    this.swingSpeed = 0;
    this.reel = 0;                      // pulls the object in while you hold still
    this.aura = null;
    this.charge = 0;
  }

  primary () {
    // while something is in the grip, the primary becomes a forward chuck —
    // the swing-based release is great for slinging things around, but you
    // still need a way to put something exactly where you're aiming
    if (this.held) { this.hurlForward(); return; }
    if (this.p.actionLock > 0) return;
    if (!this.cost(9)) return;
    this.p.playAction('tkPush', { lock: 0.30 });
    const from = this.p.handPosition(_a, 'R');
    const dir = this.p.aimDirection(_b, from);
    this.world.projectiles.fire({
      pos: from, dir, speed: 78, damage: 40 * this.p.strength, knock: 15 * this.p.strength,
      color: this.color, blast: 6.5, size: 0.5, life: 2.4
    });
    this.fx.burst(from, this.color, 12, 7, 0.4, 0.3);
    this.p.cam.addShake(0.06);
  }

  /* ---- grab & hurl ---- */

  secondaryDown () {
    if (this.held) return;
    const target = this.p.rayPick(85, 3.2);
    if (!target) {
      this.fx.burst(this.p.aimPoint(24, _a), this.color, 8, 4, 0.3, 0.3);
      this.p.world.notify('Nothing in the beam');
      return;
    }
    if (!this.cost(16)) return;

    this.charge = 0;
    if (target.kind === 'actor') {
      target.ref.holdAt(target.ref.pos);
      target.ref.beginHeld();
      this.held = target;
    } else if (target.kind === 'vehicle') {
      // grabbing the car counts as interfering with it
      target.ref.disturbed = true;
      target.ref.onDisturbed?.(target.ref);
      this.world.traffic.setHeld(target.ref, true);
      this.held = target;
    } else if (target.kind === 'prop') {
      const item = this.world.props.grab(target.ref);
      if (!item) return;
      this.held = { kind: 'prop', ref: item };
      this.fx.burst(item.pos, this.color, 22, 7, 0.5, 0.45);
      this.p.cam.addShake(0.18);
    } else if (target.kind === 'item') {
      this.held = { kind: 'prop', ref: this.world.props.regrab(target.ref) };
      this.fx.burst(target.ref.pos, this.color, 14, 6, 0.45, 0.4);
    }
    this.reel = 0;
    this.swingSpeed = 0;
    this.holdPrev.set(0, 0, 0);
    this.aura = this.fx.acquireBeam(this.color, 0.045);
  }

  secondaryHold (dt) {
    if (!this.held) return;
    if (!this.cost(11 * dt)) { this.release(false); return; }
    this.charge = Math.min(1, this.charge + dt * 0.9);

    const fwd = this.p.aimDirection(_b);
    const anchor = _c.copy(this.p.pos);
    anchor.y += 1.5;

    // Hold the view still and the grip reels the object in toward you; swing
    // the view and it stays out at arm's length, building throw speed.
    const reeling = this.swingSpeed < 6;
    this.reel = clamp(this.reel + (reeling ? dt * 2.4 : -dt * 6), 0, 4.5);
    const reach = 8.5 + this.charge * 2.0 + (this.held.kind === 'prop' ? 2 : 0) - this.reel;

    this.holdPoint.copy(anchor).addScaledVector(fwd, reach);
    this.holdPoint.y = Math.max(
      this.holdPoint.y,
      this.world.city.groundHeight(this.holdPoint.x, this.holdPoint.z) + 2.6
    );

    // measure how fast the grip point is travelling — that's the throw
    if (this.holdPrev.lengthSq() > 0) {
      _d.copy(this.holdPoint).sub(this.holdPrev).divideScalar(Math.max(dt, 1e-3));
      this.swing.lerp(_d, clamp(dt * 12, 0, 1));
      this.swingSpeed = this.swing.length();
    }
    this.holdPrev.copy(this.holdPoint);

    const ref = this.held.ref;
    if (this.held.kind === 'actor') {
      ref.holdAt(this.holdPoint);
      this.fx.trail(this.holdPoint, this.color, 0.4, 0.25, 0.5);
    } else if (this.held.kind === 'vehicle') {
      this.world.traffic.moveHeld(ref, this.holdPoint, dt);
      this.fx.trail(this.holdPoint, this.color, 0.7, 0.3, 1.4);
    } else {
      this.world.props.hold(ref, this.holdPoint, dt);
      this.fx.trail(this.holdPoint, this.color, 0.6, 0.3, 1.1);
    }
    const hand = this.p.handPosition(_a, 'R');
    this.fx.setBeam(this.aura, hand, this.holdPoint);
    this.p.setAimPose(true);
    this.p.playAction('tkGrab', { hold: true });
  }

  /**
   * Let go. The throw comes from how fast the grip was actually moving at the
   * moment of release, so a still camera drops the object at your feet and a
   * hard swing hurls it — the power is in the motion, not the button.
   */
  release (hurl = true) {
    if (!this.held) return;
    const ref = this.held.ref;

    const speed = hurl ? this.swingSpeed : 0;
    const throwing = speed > 7;
    // direction of travel if it was moving, otherwise straight ahead
    const dir = _b.copy(this.swing);
    if (throwing) dir.normalize();
    else this.p.aimDirection(dir);
    const power = throwing ? clamp(speed * 1.35, 18, 130) * (0.75 + this.charge * 0.45) : 3;

    if (this.held.kind === 'actor') {
      ref.launch(dir, throwing ? power * 0.55 : 1.5, throwing ? 0.3 : 0.05, 1.4);
      if (throwing) this.p.dealDamage(ref, 26 * this.p.strength, dir, 0);
    } else if (this.held.kind === 'vehicle') {
      this.world.traffic.setHeld(ref, false);
      if (throwing) this.world.traffic.launch(ref, dir, power * 1.1);
    } else {
      if (throwing) this.world.props.launch(ref, dir, power * 1.05);
      else this.world.props.drop(ref);
    }
    if (throwing) {
      this.fx.burst(this.holdPoint, this.color, 20, 10, 0.5, 0.4);
      this.p.playAction('tkPush', { lock: 0.30 });
      this.p.cam.addShake(clamp(power * 0.0022, 0.08, 0.3));
      if (power > 90) this.p.world.notify('HURLED');
    } else {
      this.fx.burst(this.holdPoint, this.color, 6, 3, 0.3, 0.3);
    }
    if (this.aura) { this.fx.releaseBeam(this.aura); this.aura = null; }
    this.held = null;
    this.charge = 0;
    this.reel = 0;
    this.swing.set(0, 0, 0);
    this.swingSpeed = 0;
    this.p.setAimPose(false);
  }

  /** Fire the held object straight down the crosshair, hard. */
  hurlForward () {
    if (!this.held) return;
    const ref = this.held.ref;
    const dir = this.p.aimDirection(_b);
    const power = 96 + this.charge * 34;
    if (this.held.kind === 'actor') {
      ref.launch(dir, power * 0.55, 0.22, 1.4);
      this.p.dealDamage(ref, 34 * this.p.strength, dir, 0);
    } else if (this.held.kind === 'vehicle') {
      this.world.traffic.setHeld(ref, false);
      this.world.traffic.launch(ref, dir, power * 1.1);
    } else {
      this.world.props.launch(ref, dir, power * 1.05);
    }
    this.fx.burst(this.holdPoint, this.color, 26, 13, 0.55, 0.45);
    this.fx.ring(this.holdPoint, this.color, 0.4, 3.2, 0.28, { facing: this.p.pos });
    this.p.playAction('tkPush', { lock: 0.30 });
    this.p.cam.addShake(0.28);
    if (this.aura) { this.fx.releaseBeam(this.aura); this.aura = null; }
    this.held = null;
    this.charge = 0;
    this.reel = 0;
    this.swing.set(0, 0, 0);
    this.swingSpeed = 0;
    this.p.setAimPose(false);
  }

  secondaryUp () { this.release(true); }

  ultimate () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(40)) return;
    this.release(false);
    this.p.playAction('tkPush', { lock: 0.45 });
    const c = this.p.pos.clone(); c.y += 1.0;
    const R = 26 * this.p.strength;
    this.fx.shockwave(c, this.color, R, 0.7);
    this.fx.ring(c, '#ffffff', 0.6, R * 0.7, 0.45);
    this.fx.burst(c, this.color, 60, 20, 0.6, 0.9, { grav: -3 });
    this.p.cam.addShake(0.8);
    this.world.applyImpact(c, R, {
      damage: 60 * this.p.strength, knock: 30 * this.p.strength, up: 1.1, hitY: 0.5,
      vehicleDamage: 40, propForce: 34, falloff: 0.4
    });
  }

  update () {
    if (this.held && this.held.kind === 'actor' && this.held.ref.phys !== 'held') {
      // something else took them out of our grip
      if (this.aura) { this.fx.releaseBeam(this.aura); this.aura = null; }
      this.held = null;
      this.p.setAimPose(false);
    }
  }
  cancel () { this.release(false); }
}

/* ================================================================== *
 *  3 — SOLAR : plasma
 * ================================================================== */

export class Solar extends PowerSet {
  constructor (p) {
    super(p);
    this.id = 'solar';
    this.name = 'SOLAR';
    this.color = '#ff9a2e';
    this.desc = 'Plasma bolts · flame stream · meteor';
    this.stream = null;
    this.streamT = 0;
    this.charging = 0;
    this.chargeOrb = null;
  }

  primary () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(7)) return;
    this.p.playAction('throwR', { lock: 0.32 });
    const from = this.p.handPosition(_a, 'R');
    const dir = this.p.aimDirection(_b, from);
    this.world.projectiles.fire({
      pos: from, dir, speed: 62, damage: 34 * this.p.strength, knock: 9 * this.p.strength,
      color: '#ff7a1e', blast: 7.5, size: 0.62, life: 3, grav: 3
    });
    this.fx.burst(from, '#ffb347', 14, 8, 0.42, 0.32);
    this.p.cam.addShake(0.05);
  }

  secondaryHold (dt) {
    if (!this.cost(30 * dt)) { this.secondaryUp(); return; }
    const from = this.p.handPosition(_a, 'R');
    const aim = this.p.aimPoint(34, _b);
    if (!this.stream) this.stream = this.fx.acquireBeam('#ff6a12', 0.34);
    this.fx.setBeam(this.stream, from, aim);
    this.streamT += dt;
    if (this.streamT > 0.03) {
      this.streamT = 0;
      const d = _c.copy(aim).sub(from);
      const n = 5;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const p = _d.copy(from).addScaledVector(d, t);
        this.fx.particle(
          p.x + rand(-0.4, 0.4), p.y + rand(-0.4, 0.4), p.z + rand(-0.4, 0.4),
          rand(-1.5, 1.5), rand(0.4, 2.6), rand(-1.5, 1.5),
          i > n * 0.6 ? '#ffcf6a' : '#ff5a10', rand(0.5, 1.1), rand(0.25, 0.5), { drag: 0.9, grow: 1.4 }
        );
      }
      this.fx.burst(aim, '#ff9a2e', 4, 5, 0.4, 0.3, { grav: -3 });
    }
    const hits = this.world.applyImpact(aim, 3.2, {
      damage: 105 * dt * this.p.strength, knock: 0,
      vehicleDamage: 130 * dt * this.p.strength, propForce: 0, falloff: 0.35
    });
    if (hits) this.world.audio?.beamHit(aim, dt, 1.1);
    this.p.setAimPose(true);
    this.p.playAction('beamCast', { hold: true });
  }

  secondaryUp () {
    if (this.stream) { this.fx.releaseBeam(this.stream); this.stream = null; }
    this.p.setAimPose(false);
  }

  ultimate () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(45)) return;
    this.p.playAction('throwR', { lock: 0.55, speed: 0.7 });
    const from = this.p.handPosition(_a, 'R');
    from.y += 0.4;
    const dir = this.p.aimDirection(_b, from);
    this.world.projectiles.fire({
      pos: from, dir, speed: 46, damage: 150 * this.p.strength, knock: 34 * this.p.strength,
      color: '#ffb020', blast: 20, size: 1.5, life: 5, grav: 6, trail: 1
    });
    this.fx.burst(from, '#ffd27a', 34, 12, 0.8, 0.6);
    this.p.cam.addShake(0.35);
  }

  cancel () { this.secondaryUp(); }
}


/* ================================================================== *
 *  4 — PHANTOM : teleportation, blade work, shadow step
 * ================================================================== */

export class Phantom extends PowerSet {
  constructor (p) {
    super(p);
    this.id = 'phantom';
    this.name = 'PHANTOM';
    this.color = '#a06bff';
    this.desc = 'Teleport strike · long shadow step · flurry';
    this.combo = 0;
    this.cool = 0;
    this.flurry = null;
    this.morph = 1;
  }

  /**
   * The signature puff: a shadow cloud you dissolve into and re-form out of.
   *
   * Layered so it reads as smoke rather than sparks — a dense dark core that
   * expands and hangs, a violet bloom through it, and a few wisps thrown
   * outward that drift up and fade. `grow` is what sells it: the particles
   * swell as they die instead of shrinking to nothing.
   */
  _bamf (at, big = 1) {
    const fx = this.fx;
    // dark core, slow and heavy
    fx.burst(at, '#160d20', Math.round(26 * big), 3.2 * big, 1.5 * big, 0.85,
      { grav: 0.5, drag: 0.93, grow: 3.4 });
    // violet bloom through it
    fx.burst(at, '#6a3fb0', Math.round(20 * big), 4.6 * big, 1.1 * big, 0.62,
      { grav: 0.9, drag: 0.9, grow: 2.8 });
    fx.burst(at, '#b98cff', Math.round(12 * big), 6.5 * big, 0.7 * big, 0.4,
      { grav: 1.4, drag: 0.88, grow: 2.2 });
    // wisps curling away
    for (let k = 0; k < Math.round(9 * big); k++) {
      const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 3.4;
      fx.particle(
        at.x + Math.cos(a) * 0.35, at.y + rand(-0.5, 0.7), at.z + Math.sin(a) * 0.35,
        Math.cos(a) * r, rand(0.6, 2.4), Math.sin(a) * r,
        k % 3 ? '#3d2358' : '#8a5fd0', rand(0.5, 1.0), rand(0.5, 0.9),
        { grav: 0.7, drag: 0.9, grow: 2.6 }
      );
    }
    fx.ring(at, '#7d4fd0', 0.3 * big, 5.5 * big, 0.45);
  }

  /**
   * Put the hero down at `dest` if there is room for them there.
   *
   * A teleport that lands you inside a wall is worse than one that fails, so
   * the destination is pushed out of any geometry first and rejected if that
   * moved it far — that means the spot was solid, not merely tight.
   */
  _blinkTo (dest) {
    const city = this.world.city;
    const p = this.p;
    const want = _d.copy(dest);
    want.y = Math.max(want.y, city.groundHeight(want.x, want.z, want.y + 1.4));
    const before = _c.copy(want);
    city.resolveCollision(want, p.radius + 0.15, want.y, want.y + p.height);
    if (before.distanceTo(want) > 1.6) return false;      // that was solid
    want.y = Math.max(want.y, city.groundHeight(want.x, want.z, want.y + 1.4));

    // You can only go where you can see. Without this the blink happily puts
    // you through a wall into the next room, which makes every interior
    // meaningless — and drops you behind a target standing against one.
    if (!city.hasLineOfSight(p.pos.x, p.pos.y + 1.5, p.pos.z, want.x, want.y + 1.2, want.z)) {
      this.fx.burst(_a.copy(p.pos).setY(p.pos.y + 1.4), '#4a2c70', 10, 5, 0.4, 0.3,
        { grav: 0.6, drag: 0.9, grow: 2.0 });
      this.world.notify('No line of sight');
      return false;
    }

    this._bamf(_a.copy(p.pos).setY(p.pos.y + 1.0), 1);
    p.pos.copy(want);
    p.grounded = false;
    p.airTime = 0;
    this._bamf(_b.copy(p.pos).setY(p.pos.y + 1.0), 1);
    p.cam.addShake(0.14);
    // the body re-forms out of the cloud rather than simply being there
    this.morph = 0;
    if (p.actionLock <= 0) p.playAction('bamfIn', { lock: 0.26 });
    return true;
  }

  /**
   * Somewhere to stand next to `a`, on the far side from the hero.
   *
   * Written with the scratch vector for both the direction and the result this
   * aliases into `a.pos * 2.7` and throws you across the map, so the direction
   * is kept in plain numbers.
   */
  _behind (a, out) {
    let dx = a.pos.x - this.p.pos.x, dz = a.pos.z - this.p.pos.z;
    const L = Math.hypot(dx, dz);
    if (L < 1e-3) { dx = 0; dz = 1; } else { dx /= L; dz /= L; }
    return out.set(a.pos.x + dx * 1.7, a.pos.y, a.pos.z + dz * 1.7);
  }

  /* ---- primary: blink onto whatever you're aiming at and cut it ---- */
  primary () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(6)) return;
    const target = this.p.meleeTarget(30, 0.5);
    if (target && this.p.pos.distanceTo(target.pos) > 3.4) {
      this._blinkTo(this._behind(target, _d));
    }
    this.combo++;
    const name = ['punchR', 'punchL', 'uppercut'][this.combo % 3];
    this.p.faceAim(target, 0.3);
    this.p.playAction(name, { lock: 0.3, speed: 1.35 });
    this.p.pendingStrike = {
      damage: 30 * this.p.strength,
      knock: (name === 'uppercut' ? 16 : 9) * this.p.strength,
      up: name === 'uppercut' ? 0.9 : 0.3,
      hitY: 1.4, reach: 3.4, target, color: this.color
    };
  }

  /* ---- secondary: shadow step to the crosshair ---- */
  secondaryDown () {
    if (this.cool > 0) return;
    if (!this.cost(12)) return;
    const aim = this.p.aimPoint(240, _d);
    // stand just short of whatever the ray hit, not inside it
    const back = _c.copy(aim).sub(this.world.camera.position).setY(0);
    if (back.lengthSq() > 1e-4) aim.addScaledVector(back.normalize(), -1.2);
    if (this._blinkTo(aim)) {
      this.cool = 0.28;
      this.p.playAction('land', { lock: 0.12 });
    }
  }

  /* ---- ultimate: a flurry, one blink per enemy ---- */
  ultimate () {
    if (this.flurry) return;
    if (!this.cost(42)) return;
    const near = this.world.enemies
      .filter(e => !e.dead && e.pos.distanceTo(this.p.pos) < 34)
      .sort((a, b) => a.pos.distanceTo(this.p.pos) - b.pos.distanceTo(this.p.pos))
      .slice(0, 6);
    if (!near.length) { this._bamf(_a.copy(this.p.pos).setY(this.p.pos.y + 1), 1.6); return; }
    this.flurry = { list: near, i: 0, t: 0 };
    this.world.notify('SHADOW FLURRY');
  }

  update (dt) {
    this.cool = Math.max(0, this.cool - dt);
    // re-forming: swell back to full size over a beat, trailing smoke
    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + dt * 4.2);
      // overshoot slightly, then settle — it snaps into being rather than
      // sliding up a linear scale, and stretches tall as it forms
      const t = this.morph;
      const k = t < 0.72
        ? 0.12 + 1.0 * (1 - Math.pow(1 - t / 0.72, 3))
        : 1.12 - 0.12 * ((t - 0.72) / 0.28);
      this.p.holder.scale.set(k, k * (t < 0.4 ? 1.35 - t * 0.85 : 1), k);
      if (this.morph < 0.8 && Math.random() < dt * 55) {
        this.fx.particle(
          this.p.pos.x + rand(-0.6, 0.6), this.p.pos.y + rand(0.1, 2.0), this.p.pos.z + rand(-0.6, 0.6),
          rand(-1.1, 1.1), rand(0.4, 1.8), rand(-1.1, 1.1),
          Math.random() < 0.5 ? '#4a2c70' : '#20143a', rand(0.45, 0.95), 0.55,
          { grav: 0.6, drag: 0.9, grow: 2.8 }
        );
      }
      if (this.morph >= 1) this.p.holder.scale.set(1, 1, 1);
    }
    const f = this.flurry;
    if (!f) return;
    f.t -= dt;
    if (f.t > 0) return;
    // one target per beat: appear beside them, cut, move on
    while (f.i < f.list.length) {
      const e = f.list[f.i++];
      if (!e || e.dead) continue;
      this._blinkTo(this._behind(e, _d));
      this.p.faceAim(e, 0.2);
      this.p.playAction(f.i % 2 ? 'punchR' : 'punchL', { lock: 0.18, speed: 1.7 });
      const dir = _c.copy(e.pos).sub(this.p.pos).setY(0).normalize();
      this.p.dealDamage(e, 46 * this.p.strength, dir, 13 * this.p.strength, false, 0.45, 1.35);
      this.fx.burst(e.pos, this.color, 12, 9, 0.4, 0.3);
      f.t = 0.16;
      return;
    }
    this._bamf(_a.copy(this.p.pos).setY(this.p.pos.y + 1), 1.4);
    this.flurry = null;
  }

  cancel () {
    this.flurry = null;
    this.morph = 1;
    this.p.holder.scale.set(1, 1, 1);
  }
}


/* ================================================================== *
 *  5 — VILTRUM : flight as the default state, grabs, and raw force
 * ================================================================== */

export class Viltrum extends PowerSet {
  constructor (p) {
    super(p);
    this.id = 'viltrum';
    this.name = 'VILTRUM';
    this.color = '#ffd84a';
    this.desc = 'Airborne · grab & carry · smash';
    // Flight is where this one lives. Flying into the ground doesn't put you
    // down — Player._flight reads this and holds you just clear of it instead.
    this.stickyFlight = true;
    this.combo = 0;
    this.held = null;
    this.closing = null;
    this.holdPoint = new THREE.Vector3();
    this.holdPrev = new THREE.Vector3();
    this.gripVel = new THREE.Vector3();
    this.crashT = 0;
  }

  /* ---- primary: heavy melee ---- */
  primary () {
    if (this.held) { this.release(true); return; }
    if (this.p.actionLock > 0) return;
    if (!this.cost(5)) return;
    const names = ['punchR', 'punchL', 'uppercut'];
    const name = names[this.combo % 3];
    this.combo++;
    const target = this.p.meleeTarget(9);
    this.p.faceAim(target, 0.34);
    if (target) this.p.lungeTo(target, 2.6);
    this.p.playAction(name, { lock: name === 'uppercut' ? 0.44 : 0.30, speed: 1.2 });
    this.p.pendingStrike = {
      damage: (name === 'uppercut' ? 68 : 40) * this.p.strength,
      knock: (name === 'uppercut' ? 30 : 18) * this.p.strength,
      up: name === 'uppercut' ? 1.25 : 0.4,
      hitY: name === 'uppercut' ? 1.0 : 1.45,
      reach: 3.9, target, color: this.color
    };
  }

  /* ---- secondary: fly over and take hold of it ---- */
  secondaryDown () {
    if (this.held || this.closing) return;
    const target = this.p.rayPick(90, 3.6);
    if (!target) { this.world.notify('Nothing to grab'); return; }
    if (!this.cost(14)) return;
    // close the distance first — the grab is physical, not telekinetic
    this.closing = { target, t: 0 };
    this.holdPrev.set(0, 0, 0);
    this.gripVel.set(0, 0, 0);
  }

  /** Where the grip sits: by the throat in front, or hoisted overhead. */
  _grip (kind, out) {
    const p = this.p;
    if (kind === 'actor') {
      const fwd = p.aimDirection(_b);
      return out.copy(p.pos).addScaledVector(fwd, 1.5).setY(p.pos.y + 1.45);
    }
    return out.copy(p.pos).setY(p.pos.y + 3.1);      // held above the head
  }

  _take (target) {
    const kind = target.kind === 'item' ? 'prop' : target.kind;
    if (kind === 'actor') {
      target.ref.holdAt(target.ref.pos);
      target.ref.beginHeld();
      this.held = { kind, ref: target.ref };
    } else if (kind === 'vehicle') {
      target.ref.disturbed = true;
      target.ref.onDisturbed?.(target.ref);
      this.world.traffic.setHeld(target.ref, true);
      this.held = { kind, ref: target.ref };
    } else {
      const item = target.kind === 'item'
        ? this.world.props.regrab(target.ref)
        : this.world.props.grab(target.ref);
      if (!item) return;
      this.held = { kind: 'prop', ref: item };
    }
    this.fx.burst(this._grip(this.held.kind, _a), this.color, 20, 8, 0.5, 0.4);
    this.p.cam.addShake(0.2);
  }

  secondaryHold (dt) {
    // still flying over to it
    if (this.closing) {
      const c = this.closing;
      const ref = c.target.ref;
      const at = _a.copy(ref.pos ?? ref);
      c.t += dt;
      const d = this.p.pos.distanceTo(at);
      if (d > 2.6 && c.t < 1.6) {
        _b.copy(at).sub(this.p.pos).normalize();
        const sp = Math.min(52, 14 + d * 2.4);
        this.p.vel.copy(_b).multiplyScalar(sp);
        this.p.pos.addScaledVector(_b, sp * dt);
        this.p.playAction('boost', { hold: true });
        this.fx.trail(this.p.pos, this.color, 0.5, 0.25, 0.5);
        return;
      }
      this.closing = null;
      this.p.vel.multiplyScalar(0.15);
      this._take(c.target);
      if (!this.held) return;
    }
    if (!this.held) return;
    if (!this.cost(7 * dt)) { this.release(false); return; }

    this._grip(this.held.kind, this.holdPoint);
    // How fast the grip is actually travelling — that's the momentum a plain
    // release hands over, the same way the force throw works.
    if (this.holdPrev.lengthSq() > 0) {
      _d.copy(this.holdPoint).sub(this.holdPrev).divideScalar(Math.max(dt, 1e-3));
      this.gripVel.lerp(_d, clamp(dt * 12, 0, 1));
    }
    this.holdPrev.copy(this.holdPoint);
    this._crashCheck(dt);
    // This is a physical carry, not telekinesis: whatever you have hold of is
    // in your hands, so it goes exactly where you go. The shared hold helpers
    // ease toward the grip at a fixed rate, which is fine for a telekinetic
    // tether but leaves a carried car fifteen metres behind you at flight
    // speed — so they run for their spin and rotation, then the position is
    // set outright.
    const ref = this.held.ref;
    if (this.held.kind === 'actor') {
      ref.holdAt(this.holdPoint);
      ref.anim.flinch = 1;
    } else if (this.held.kind === 'vehicle') {
      this.world.traffic.moveHeld(ref, this.holdPoint, dt);
      ref.pos.copy(this.holdPoint);
    } else {
      this.world.props.hold(ref, this.holdPoint, dt);
      ref.pos.copy(this.holdPoint);
    }
    this.p.setAimPose(true);
    this.p.playAction(this.held.kind === 'actor' ? 'tkGrab' : 'carryOverhead', { hold: true });
  }

  /**
   * Ram whatever you're carrying into whatever you're flying at.
   *
   * The grip is out in front of you (or over your head), so it meets a wall or
   * the ground before you do — carrying someone into a building at speed
   * should hurt them, not pass through it.
   */
  _crashCheck (dt) {
    this.crashT = Math.max(0, this.crashT - dt);
    if (this.crashT > 0 || !this.held) return;
    const sp = this.p.speed;
    if (sp < 11) return;
    const city = this.world.city;
    const g = city.groundHeight(this.holdPoint.x, this.holdPoint.z, this.holdPoint.y + 1.2);
    let hit = this.holdPoint.y <= g + 0.7;
    if (!hit) {
      _c.copy(this.holdPoint);
      city.resolveCollision(_c, 0.7, _c.y - 0.5, _c.y + 0.5);
      hit = _c.distanceToSquared(this.holdPoint) > 0.01;
    }
    if (!hit) return;

    this.crashT = 0.45;
    const force = Math.min(sp, 70);
    const ref = this.held.ref;
    if (this.held.kind === 'actor') {
      this.p.dealDamage(ref, force * 1.9 * this.p.strength, _b.set(0, -1, 0), 0, false, 0, 1.2);
    } else if (this.held.kind === 'vehicle') {
      this.world.traffic.impact(ref, _b.set(0, -1, 0), force * 0.4, force * 2.2);
    }
    // and everything around the point of impact wears some of it
    this.world.applyImpact(this.holdPoint, 4.6, {
      damage: force * 1.2 * this.p.strength, knock: force * 0.5, up: 0.5, hitY: 1.1,
      vehicleDamage: force * 2, propForce: force, color: this.color,
      skip: this.held.kind === 'actor' ? ref : null
    });
    this.fx.burst(this.holdPoint, '#ffe0a0', 26, 12, 0.55, 0.4, { grav: -8 });
    this.fx.ring(this.holdPoint, this.color, 0.3, 5, 0.3);
    this.p.cam.addShake(0.4);
    this.p.vel.multiplyScalar(0.55);
  }

  /**
   * Let go. A plain release just hands over whatever momentum the grip had —
   * carry someone gently and they drop, sling them and they go. Only a left
   * click while holding actually hurls.
   */
  release (hurl = false) {
    this.closing = null;
    if (!this.held) return;
    const ref = this.held.ref;
    const dir = this.p.aimDirection(_b);
    const carried = Math.min(this.gripVel.length(), 60);

    if (hurl) {
      const power = 86 + this.p.strength * 26;
      if (this.held.kind === 'actor') ref.launch(dir, power * 0.5, 0.4, 1.4, 1.3);
      else if (this.held.kind === 'vehicle') this.world.traffic.launch(ref, dir, power);
      else this.world.props.launch(ref, dir, power);
      this.fx.burst(this.holdPoint, this.color, 26, 12, 0.6, 0.45);
      this.p.cam.addShake(0.3);
      this.p.playAction('throwR', { lock: 0.3 });
    } else if (carried > 6) {
      // released while moving: it keeps going the way it was already going
      _c.copy(this.gripVel).normalize();
      if (this.held.kind === 'actor') ref.launch(_c, carried * 0.55, 0.25, 1.0, 1.3);
      else if (this.held.kind === 'vehicle') this.world.traffic.launch(ref, _c, carried * 1.1);
      else this.world.props.launch(ref, _c, carried * 1.1);
    } else {
      if (this.held.kind === 'actor') ref.launch(_c.set(0, -1, 0), 4, 0, 0.4, 1.2);
      else if (this.held.kind === 'vehicle') this.world.traffic.setHeld(ref, false);
      else this.world.props.drop(ref);
    }
    this.held = null;
    this.gripVel.set(0, 0, 0);
    this.holdPrev.set(0, 0, 0);
    this.p.setAimPose(false);
  }

  secondaryUp () { this.release(false); }

  /* ---- ultimate: come down on it ---- */
  ultimate () {
    if (this.p.actionLock > 0) return;
    if (!this.cost(38)) return;
    if (this.p.flying && this.p.pos.y - this.p.groundY > 4) {
      // drive straight down and detonate on arrival
      this.p.slamDive = true;
      this.p.vel.set(0, -95, 0);
      this.p.playAction('dive', { hold: true });
      this.world.notify('SMASH');
      return;
    }
    // already down: a standing shockwave
    this.p.playAction('slam', { lock: 0.55 });
    this.p.pendingSlam = { radius: 20 * this.p.strength, damage: 150 * this.p.strength, color: this.color };
  }

  update () {}

  cancel () { this.release(false); this.closing = null; }
}

export function makePowers (player) {
  return [new Paragon(player), new Kinetic(player), new Solar(player),
          new Phantom(player), new Viltrum(player)];
}
