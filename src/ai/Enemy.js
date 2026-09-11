import * as THREE from 'three';
import { Actor } from './Actor.js';
import { randomEnemy } from '../char/Rig.js';
import { rand, clamp, pick, angleDelta } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

export const TIERS = [
  { name: 'Street Thug', hp: 70,  dmg: 7,  ranged: false, speed: 3.2, reach: 2.3, cd: 1.5, mass: 1.00, color: '#ff5a3c' },
  { name: 'Enforcer',    hp: 130, dmg: 10, ranged: true,  speed: 3.6, reach: 26,  cd: 1.5, mass: 1.20, color: '#39e6ff' },
  { name: 'Syndicate',   hp: 240, dmg: 15, ranged: true,  speed: 4.0, reach: 32,  cd: 1.1, mass: 1.55, color: '#c65cff' },
  { name: 'Warbringer',  hp: 460, dmg: 26, ranged: false, speed: 4.8, reach: 3.0, cd: 1.1, mass: 2.30, color: '#c8e04a' }
];

/** Roll a tier from the sandbox difficulty knob (0 easy .. 1 brutal). */
export function rollTier (difficulty) {
  const r = Math.random();
  const d = clamp(difficulty, 0, 1);
  const w = [
    Math.max(0.03, 1 - d * 1.25),
    0.35 + d * 0.30,
    Math.max(0, d * 0.85 - 0.08),
    Math.max(0, d * d * 0.85 - 0.12)
  ];
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < 4; i++) { acc += w[i] / total; if (r < acc) return i; }
  return 0;
}

const DROWN_TIME = 30;    // seconds an enemy can keep their head above water

export class Enemy extends Actor {
  constructor (world, x, z, tier, crime) {
    const T = TIERS[tier];
    super(world, randomEnemy(tier), {
      moveSpeed: T.speed, health: T.hp, faction: 'enemy', cull: 240, mass: T.mass
    });
    this.tier = tier;
    this.T = T;
    this.crime = crime;
    this.pos.set(x, world.city.streetHeight(x, z), z);
    this.group.position.copy(this.pos);
    this.home = new THREE.Vector3(x, 0, z);
    this.state = 'idle';
    this.timer = rand(0, 2);
    this.cool = rand(0, T.cd);
    this.target = null;
    this.victim = null;
    this.radius = 0.42;
    this.awareness = 0;
    this.anim.play('idle');
    this.anim.time = rand(0, 3);
    this.anim.onEvent = (e) => { if (e === 'hit') this._landHit(); };
    this.deathT = 0;
    this.aggression = 0.6;
    this.posts = null;          // stations to rotate between, at a fixed site
    this.postIndex = 0;
  }

  get aggro () { return this.world.settings.get('enemyAggression'); }

  /* ---------------- combat ---------------- */

  _landHit () {
    const fx = this.world.effects;
    if (this.state === 'shoot') {
      const from = _a.copy(this.pos);
      from.y += this.height * 0.72;
      const tgt = this.target;
      if (!tgt) return;
      const to = _b.copy(tgt.pos);
      to.y += tgt === this.world.player ? 1.0 : 0.9;
      to.x += rand(-0.8, 0.8) * (1 - this.aggro * 0.4);
      to.y += rand(-0.5, 0.5);
      to.z += rand(-0.8, 0.8) * (1 - this.aggro * 0.4);
      this.world.audio.play('gun', from);
      fx.flashBeam(from, to, this.T.color, 0.055, 0.10);
      fx.burst(from, this.T.color, 4, 5, 0.28, 0.22);
      const hit = Math.random() < 0.30 + this.aggro * 0.42 + this.tier * 0.05;
      if (hit && tgt === this.world.player) this.world.player.takeDamage(this.T.dmg, this.pos);
      else if (hit && tgt.panic) tgt.panic(this.pos, 1);
      fx.burst(to, '#ffd0a0', 5, 4, 0.22, 0.25, { grav: -4 });
    } else if (this.state === 'melee') {
      const tgt = this.target;
      if (!tgt) return;
      const d = this.pos.distanceTo(tgt.pos);
      if (d < this.T.reach + 1.1) {
        const dir = _d.copy(tgt.pos).sub(this.pos).setY(0).normalize();
        const p = _a.copy(this.pos).addScaledVector(dir, 0.9);
        p.y += this.height * 0.62;
        fx.burst(p, '#ffcf8a', 9, 6, 0.32, 0.3, { grav: -6 });
        if (tgt === this.world.player) this.world.player.takeDamage(this.T.dmg, this.pos);
        else if (tgt.panic) { tgt.panic(this.pos, 1); tgt.applyKnockback(dir, 4, 0.5); }
      }
    }
  }

  damage (amount, from) {
    if (this.dead) return false;
    this.health -= amount;
    this.world.audio?.voice(this, Math.min(1.2, .5 + amount / 60), amount > 40 ? .85 : 1);
    if (this.phys !== 'walk') {
      // still register the hit while airborne, just don't re-enter the AI
      this.world.effects.burst(
        _a.copy(this.pos).setY(this.pos.y + 0.7), '#ff6a4a', 6, 5, 0.28, 0.28, { grav: -8 }
      );
      if (this.health <= 0) { this.health = 0; this.onDeath(from); return true; }
      return false;
    }
    this.anim.flinch = 1;
    this.world.effects.burst(
      _a.copy(this.pos).setY(this.pos.y + this.height * 0.6),
      '#ff6a4a', 7, 5, 0.3, 0.3, { grav: -8 }
    );
    this.awareness = 1;
    this.target = this.world.player;
    if (this.health <= 0) { this.onDeath(from); return true; }
    if (this.stagger <= 0 && Math.random() < 0.55) { this.stagger = 0.36; this.state = 'stagger'; }
    return false;
  }

  onDeath (from) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.world.audio?.contacts.delete(this);            // the death cry always gets through
    this.world.audio?.voice(this, 1.2, .7);
    this.state = 'down';
    this.staysDown = true;
    this.deathT = 0;
    this.world.effects.burst(
      _a.copy(this.pos).setY(this.pos.y + 1.0), this.T.color, 22, 7, 0.45, 0.8, { grav: -9 }
    );
    if (this.phys === 'walk') {
      // hurl them off their feet away from whatever put them down
      const src = (from && from.pos) ? from.pos : this.world.player.pos;
      _b.copy(this.pos).sub(src).setY(0);
      if (_b.lengthSq() < 1e-4) _b.set(rand(-1, 1), 0, rand(-1, 1));
      this.launch(_b.normalize(), 6.5 + this.tier * 1.4, 0.5, 1.1);
    }
    this.crime?.onEnemyDown(this);
  }

  getUpDelay () { return this.staysDown ? Infinity : rand(2.0, 3.4); }

  /* ---------------- brains ---------------- */

  /** Can this enemy actually see `a` from where it is standing? */
  canSee (a) {
    return this.world.city.hasLineOfSight(
      this.pos.x, this.pos.y + this.height * 0.85, this.pos.z,
      a.pos.x, a.pos.y + 1.1, a.pos.z
    );
  }

  _pickTarget (ctx) {
    const player = this.world.player;
    const dp = this.pos.distanceTo(player.pos);
    const range = this.T.ranged ? 46 : 34;
    // Awareness only builds while they can actually see you. Without this they
    // track you through walls and open fire the moment you're in range, which
    // makes every building transparent.
    if (player.suited && dp < range && !player.downed && this.canSee(player)) {
      this.awareness = clamp(this.awareness + 0.02, 0, 1);
      if (dp < 16 || this.awareness > 0.5) return player;
    } else {
      this.awareness = clamp(this.awareness - 0.012, 0, 1);
    }
    // otherwise harass a nearby civilian
    if (!this.victim || this.victim.dead || this.pos.distanceTo(this.victim.pos) > 26 ||
        !this.canSee(this.victim)) {
      this.victim = null;
      let bd = 22 * 22;
      for (const p of ctx.peds) {
        const d = this.pos.distanceToSquared(this.pos.clone().set(p.pos.x, this.pos.y, p.pos.z));
        if (d < bd && this.canSee(p)) { bd = d; this.victim = p; }
      }
    }
    return this.victim;
  }

  update (dt, ctx) {
    // riding in a getaway car: the crime moves the body, and they must stay
    // hidden — the visibility line below would put them back on show
    if (this.inVehicle) { this.updateAnim(dt); return; }
    // on a scripted errand for a scenario (dragging a hostage, walking to a
    // post): the scenario moves the body — until it is hurt, thrown or grabbed,
    // at which point it is an ordinary enemy again
    if (this.scripted) {
      if (this.dead || this.phys !== 'walk' || this.health < this.maxHealth) this.scripted = false;
      else { this.updateAnim(dt); return; }
    }
    // hanging under a parachute: the scenario moves the body until it lands —
    // unless a power has taken hold of it or knocked it flying, in which case
    // the canopy is gone and physics owns the body from here on
    if (this.parachuting) {
      if (this.dead || this.phys !== 'walk') this.parachuting = false;
      else {
        this.anim.play('fall', { fade: 0.25 });
        this.updateAnim(dt);
        return;
      }
    }

    // Treading water: no fighting from out there, and thirty seconds before
    // they go under.
    if (this.inWater && this.phys === 'walk') {
      this.setVisible(this.pos.distanceTo(this.world.player.pos) < this.cull);
      this.anim.play(this.drownT > 22 ? 'panicRun' : 'tread', { fade: 0.25 });
      this.updateAnim(dt);
      this.integrate(dt);
      if (this.drownT > DROWN_TIME && !this.dead) {
        this.world.effects.burst(this.pos, '#cfe8f2', 22, 7, 0.5, 0.6, { grav: -3 });
        this.health = 0;
        this.onDeath?.(null);
      }
      return;
    }

    const player = this.world.player;
    const distToPlayer = this.pos.distanceTo(player.pos);
    this.setVisible(distToPlayer < this.cull);
    this.setLOD(distToPlayer > 85);

    // thrown, held or getting back up — physics owns the frame
    if (this.phys !== 'walk') { this.updateRagdoll(dt); return; }
    if (this.airborne) {
      // walked or was knocked off an edge — fall, don't steer
      this.integrate(dt);
      this.anim.play('fall', { fade: 0.18 });
      this.updateAnim(dt);
      return;
    }
    if (this.dead) { this.updateAnim(dt); this.integrate(dt); return; }
    if (distToPlayer > this.cull + 60) return;

    this.cool -= dt;
    this.timer -= dt;
    if (this.stagger > 0) {
      this.stagger -= dt;
      this.anim.play('hitReact', { fade: 0.06 });
      this.updateAnim(dt);
      this.integrate(dt);
      if (this.stagger <= 0) this.state = 'chase';
      return;
    }
    const tgt = this._pickTarget(ctx);
    this.target = tgt;
    let moving = false;
    let speedMul = 1;

    if (!tgt) {
      // mill about the crime scene
      if (this.state !== 'patrol' && this.state !== 'idle') this.state = 'idle';
      if (this.timer <= 0) {
        this.state = Math.random() < 0.55 ? 'patrol' : 'idle';
        this.timer = rand(2.5, 6);
        // Guarding a place rather than a spot on the pavement: take up one of
        // its posts, stand there a while, then move to another. Wandering a
        // few metres from where they spawned leaves a warship with everyone
        // huddled amidships.
        if (this.posts && this.posts.length) {
          this.postIndex = (this.postIndex + 1 + (Math.random() < 0.4 ? 1 : 0)) % this.posts.length;
          const q = this.posts[this.postIndex];
          this.wander = new THREE.Vector3(q.x + rand(-2.5, 2.5), q.y, q.z + rand(-2.5, 2.5));
          this.timer = rand(6, 14);
          this.state = 'patrol';
        } else {
          this.wander = new THREE.Vector3(
            this.home.x + rand(-10, 10), 0, this.home.z + rand(-10, 10)
          );
        }
      }
      if (this.state === 'patrol' && this.wander) {
        if (Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) > 1.6) {
          this.faceTowards(this.wander.x, this.wander.z, 4, dt);
          moving = true; speedMul = this.posts ? 0.62 : 0.42;
        }
      }
    } else {
      const d = this.pos.distanceTo(tgt.pos);
      const isPlayer = tgt === player;
      const reach = this.T.ranged ? this.T.reach : this.T.reach;
      this.faceTowards(tgt.pos.x, tgt.pos.z, 7, dt);

      if (this.T.ranged) {
        const ideal = clamp(reach * 0.55, 9, 22);
        if (d > ideal + 4) { moving = true; speedMul = 1; }
        else if (d < ideal - 6) { moving = true; speedMul = -0.7; }
        else if (Math.random() < dt * 0.7) { this.strafe = pick([-1, 1]); }
        // never fire through a wall, however good the angle looks
        if (d < reach && this.cool <= 0 && this.canSee(tgt)) {
          this.state = 'shoot';
          this.anim.play('shoot', { fade: 0.05, restart: true });
          this.cool = this.T.cd * rand(0.75, 1.3) / (0.6 + this.aggro * 0.8);
        } else if (this.state !== 'shoot' || this.anim.done) {
          this.state = d < reach ? 'aim' : 'chase';
        }
      } else {
        if (d > reach) { moving = true; this.state = 'chase'; }
        else if (this.cool <= 0) {
          this.state = 'melee';
          this.world.audio?.voice(this, .7, .9);       // the effort of the swing
          this.anim.play(this.tier >= 3 && Math.random() < 0.35 ? 'slam' : 'meleeSwing', { fade: 0.07, restart: true });
          this.cool = this.T.cd * rand(0.8, 1.3) / (0.6 + this.aggro * 0.8);
        } else if (this.anim.done) this.state = 'chase';
      }

      // hostage-taking: shove civilians around
      if (!isPlayer && d < 3 && this.cool > this.T.cd * 0.5 && Math.random() < dt * 2) {
        tgt.panic?.(this.pos, 1);
      }
    }

    /* movement */
    if (moving && this.state !== 'melee' && this.state !== 'shoot') {
      const sp = this.moveSpeed * speedMul;
      // Chasing the hero off a roof is not bravery. Advancing into a drop gets
      // redirected along the ledge, and if the edge boxes them in they hold.
      let h = this.heading;
      let go = true;
      if (this.ledgeAhead(sp > 0 ? h : h + Math.PI)) {
        const a = h + Math.PI / 2, b = h - Math.PI / 2;
        if (!this.ledgeAhead(a)) h = a;
        else if (!this.ledgeAhead(b)) h = b;
        else go = false;
        if (go) this.heading = h;
      }
      if (go) {
        const fx = Math.sin(h), fz = Math.cos(h);
        this.pos.x += fx * sp * dt;
        this.pos.z += fz * sp * dt;
        if (this.strafe && speedMul > 0 && !this.ledgeAhead(h + Math.sign(this.strafe) * Math.PI / 2)) {
          this.pos.x += Math.cos(h) * this.strafe * dt * 1.4;
          this.pos.z += -Math.sin(h) * this.strafe * dt * 1.4;
        }
      }
      this.speed = go ? Math.abs(sp) : 0;
    } else this.speed = 0;

    // separation
    if (ctx.enemies) {
      for (const o of ctx.enemies) {
        if (o === this || o.dead) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.1 && d2 > 1e-5) {
          const dd = Math.sqrt(d2), push = (1.05 - dd) * 0.55;
          this.pos.x += (dx / dd) * push; this.pos.z += (dz / dd) * push;
        }
      }
    }

    /* animation */
    if (this.state === 'melee' || this.state === 'shoot') {
      // clip is already playing; let it finish
    } else if (this.speed > 0.25) {
      this.anim.play(this.speed > 2.6 ? 'run' : 'walk', {
        fade: 0.18, speed: clamp(this.speed / (this.speed > 2.6 ? 4.2 : 1.6), 0.7, 1.7)
      });
    } else if (this.state === 'aim') {
      this.anim.play('aim', { fade: 0.2 });
    } else if (this.target) {
      this.anim.play('taunt', { fade: 0.25 });
    } else {
      this.anim.play('idle', { fade: 0.3 });
    }

    if (this.target) {
      const dy = (this.target.pos.y + 1) - (this.pos.y + this.height * 0.85);
      const dist = Math.max(2, this.pos.distanceTo(this.target.pos));
      this.anim.look[0] = clamp(-dy / dist * 0.9, -0.75, 0.75);
    } else this.anim.look[0] *= 0.9;

    this.updateAnim(dt);
    this.integrate(dt);
  }
}
