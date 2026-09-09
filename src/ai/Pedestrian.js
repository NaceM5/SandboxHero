import * as THREE from 'three';
import { Actor } from './Actor.js';
import { randomCivilian } from '../char/Rig.js';
import { rand, randInt, pick, clamp, angleDelta } from '../core/Util.js';

/**
 * Sidewalk crowd.
 *
 * Walks the block-ring graph, only steps into the road at the mid-block
 * crosswalks (and looks both ways before committing), gawps at the hero, and
 * scatters when a crime kicks off nearby — mostly by running, occasionally by
 * cowering if it's happening right on top of them.
 */
export class Pedestrian extends Actor {
  constructor (world, node) {
    // bystanders can be thrown around all day but never die — this is a
    // sandbox, not a massacre simulator
    super(world, randomCivilian(), {
      moveSpeed: rand(1.25, 1.85), health: 60, faction: 'civilian', cull: 190, invulnerable: true
    });
    this.node = node || world.roads.randomWalkNode();
    this.next = pick(this.node.links);
    // Sit on the terrain from the outset: a pedestrian spawned beyond the cull
    // radius returns from update() before integrate() runs, so a y of 0 would
    // leave them buried in any ground that isn't at sea level.
    this.pos.set(this.node.x, world.city.groundHeight(this.node.x, this.node.z), this.node.z);
    this.group.position.copy(this.pos);
    this.state = 'walk';
    this.timer = rand(0, 4);
    this.fear = 0;
    this.gawk = 0;
    this.crossWait = 0;
    this.lookT = 0;
    this.avoid = 0;
    this.avoidDir = 1;
    this.crimeCheck = rand(0, 1.5);
    this.heading = rand(-Math.PI, Math.PI);
    this.anim.play('walk');
    this.anim.time = rand(0, 1);
    this._animPhase = randInt(0, 3);
    this._animAcc = 0;
  }

  panic (from, amount = 1, preferFlee = false) {
    if (this.phys !== 'walk') return;
    this.fear = Math.max(this.fear, amount);
    if (this.state !== 'flee' && this.state !== 'cower') {
      // most people run; only those caught right in it freeze up
      this.state = (preferFlee || Math.random() < 0.85) ? 'flee' : 'cower';
      this.fleeFrom = from ? from.clone() : this.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)));
      this.timer = rand(4, 9);
      if (this.state === 'flee') this._pickFleeNode();
    }
  }

  /** Head for whichever neighbouring pavement node leads away from danger. */
  _pickFleeNode () {
    const links = this.node.links;
    let best = null, bestScore = -Infinity;
    for (const l of links) {
      if (this.node.crossing?.has(l) && !this._crossingClear(l)) continue;
      const d = Math.hypot(l.x - this.fleeFrom.x, l.z - this.fleeFrom.z);
      const score = d + (l === this.prev ? -12 : 0);
      if (score > bestScore) { bestScore = score; best = l; }
    }
    this.next = best || pick(links);
  }

  /**
   * True when nothing is bearing down on the crosswalk between here and `to`.
   * Cars are checked against the span itself rather than a plain radius, so
   * someone on the kerb doesn't balk at traffic on a parallel street.
   */
  _crossingClear (to) {
    const traffic = this.world.traffic;
    if (!traffic) return true;
    const mx = (this.node.x + to.x) * 0.5, mz = (this.node.z + to.z) * 0.5;
    const span = Math.hypot(to.x - this.node.x, to.z - this.node.z) * 0.5 + 3;
    for (const v of traffic.vehicles) {
      if (v.speed < 1.2 || v.state === 'wrecked') continue;
      const dx = mx - v.pos.x, dz = mz - v.pos.z;
      if (dx * dx + dz * dz > 42 * 42) continue;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * -fz + dz * fx);
      // roughly: will this car reach the crossing within ~2.5 seconds?
      if (ahead > -3 && ahead < Math.max(14, v.speed * 2.5) && side < span) return false;
    }
    return true;
  }

  _advanceNode () {
    this.prev = this.node;
    this.node = this.next || this.node;
    const links = this.node.links;
    // prefer staying on this block; only cross at a crosswalk, and not often
    const onBlock = links.filter(l => !(this.node.crossing?.has(l)) && l !== this.prev);
    const crossings = links.filter(l => this.node.crossing?.has(l));
    if (crossings.length && Math.random() < 0.3) this.next = pick(crossings);
    else this.next = onBlock.length ? pick(onBlock) : pick(links);
  }

  update (dt, ctx) {
    if (this.phys !== 'walk') { this.updateRagdoll(dt); return; }
    if (this.airborne) {
      // off an edge — gravity owns the frame, no steering in mid-air
      this.integrate(dt);
      this.anim.play('fall', { fade: 0.18 });
      this.anim.update(dt);
      return;
    }

    const player = ctx.player;
    const distToPlayer = this.pos.distanceTo(player.pos);
    this.setVisible(distToPlayer < this.cull);
    this.setLOD(distToPlayer > 70);
    if (distToPlayer > this.cull + 40) { this.timer -= dt; return; }

    /* ---- notice trouble nearby ---- */
    this.crimeCheck -= dt;
    if (this.crimeCheck <= 0) {
      this.crimeCheck = rand(0.6, 1.4);
      const near = this.world.crime?.nearestCrime(this.pos);
      if (near && near.dist < 42) {
        // caught right in it -> some freeze; further out -> everyone runs
        this.panic(near.crime.pos, 1, near.dist > 14);
      }
    }

    this.fear = Math.max(0, this.fear - dt * 0.22);
    this.lookT += dt;
    let moving = false;
    let speedMul = 1;
    let waiting = false;

    switch (this.state) {
      case 'idle': {
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'walk'; this.timer = rand(6, 22); }
        break;
      }
      case 'gawk': {
        this.timer -= dt;
        this.faceTowards(player.pos.x, player.pos.z, 6, dt);
        if (this.timer <= 0) { this.state = 'walk'; this.timer = rand(8, 20); }
        break;
      }
      case 'cower': {
        this.timer -= dt;
        if (this.timer <= 0 && this.fear < 0.25) { this.state = 'walk'; this.timer = rand(4, 10); }
        break;
      }
      case 'flee': {
        this.timer -= dt;
        speedMul = 2.5;
        const tgt = this.next || this.node;
        if (Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z) < 1.8) {
          this._advanceNode();
          this._pickFleeNode();
        }
        this.faceTowards(tgt.x, tgt.z, 7, dt);
        moving = true;
        if (this.timer <= 0) { this.state = 'walk'; this.timer = rand(6, 16); }
        break;
      }
      default: { // walk
        const tgt = this.next || this.node;
        const d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
        if (d < 1.6) {
          this._advanceNode();
          if (Math.random() < 0.14) { this.state = 'idle'; this.timer = rand(2, 7); break; }
        }
        // step off the kerb only once the crosswalk is clear
        if (this.node.crossing?.has(this.next) && !this._crossingClear(this.next)) {
          this.crossWait += dt;
          waiting = true;
          this.faceTowards(this.next.x, this.next.z, 5, dt);
          if (this.crossWait < 9) break;      // give up eventually so nobody sticks
        } else this.crossWait = 0;

        this.faceTowards(tgt.x, tgt.z, 5.5, dt);
        moving = true;
        if (this.gawk <= 0 && distToPlayer < 14 && player.suited && Math.random() < dt * 0.55) {
          this.state = 'gawk'; this.timer = rand(1.5, 4); this.gawk = 12;
        }
        break;
      }
    }
    this.gawk -= dt;

    if (this.avoid > 0) this.avoid -= dt;

    if (moving) {
      const sp = this.moveSpeed * speedMul;
      // while sliding along a wall, walk at an angle to the blocked heading
      let h = this.heading + (this.avoid > 0 ? this.avoidDir * 1.15 : 0);
      // Don't walk off a roof. Carried onto a building, their route still
      // points at a street node far below, so without this they march straight
      // over the parapet. Turn along the edge instead, and stop if both ways
      // are also drops.
      if (this.ledgeAhead(h)) {
        const a = h + Math.PI / 2, b = h - Math.PI / 2;
        if (!this.ledgeAhead(a)) h = a;
        else if (!this.ledgeAhead(b)) h = b;
        else moving = false;
        this.heading = h;
      }
      if (moving) {
        this.pos.x += Math.sin(h) * sp * dt;
        this.pos.z += Math.cos(h) * sp * dt;
      }
      this.speed = moving ? sp : 0;
    } else this.speed = 0;

    if (ctx.neighbors) {
      for (const o of ctx.neighbors) {
        if (o === this) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.62 && d2 > 1e-5) {
          const d = Math.sqrt(d2), push = (0.79 - d) * 0.5;
          this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
        }
      }
    }

    /* ---- animation ---- */
    if (this.state === 'cower') this.anim.play('cower', { fade: 0.25 });
    else if (this.state === 'flee') this.anim.play('panicRun', { fade: 0.14, speed: 1.05 });
    else if (this.speed > 0.2) this.anim.play('walk', { fade: 0.2, speed: clamp(this.speed / 1.55, 0.7, 1.6) });
    else this.anim.play('idle', { fade: 0.3 });

    if (waiting) {
      // look both ways while stuck at the kerb
      this.anim.look[1] = Math.sin(this.lookT * 1.9) * 0.75;
      this.anim.look[0] = 0;
    } else if (this.state === 'gawk') {
      const yaw = angleDelta(this.heading, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z));
      this.anim.look[1] = clamp(yaw, -0.7, 0.7);
      this.anim.look[0] = clamp(-(player.pos.y - this.pos.y) * 0.05, -0.5, 0.5);
    } else {
      this.anim.look[0] *= 0.9; this.anim.look[1] *= 0.9;
    }

    // Animation LOD — posing 19 bones is the expensive part of a crowd, and at
    // distance nobody can tell it's running at a third of the rate. Time is
    // accumulated so the clips still play at the correct speed.
    this._animAcc += dt;
    const step = distToPlayer < 45 ? 1 : distToPlayer < 95 ? 2 : 3;
    this._animPhase = (this._animPhase + 1) % step;
    if (this._animPhase === 0) { this.anim.update(this._animAcc); this._animAcc = 0; }

    // never step into the water — back off and pick a new heading. Only at
    // ground level: up on a roof the nearest walk node is fifty metres down.
    if (this.pos.y < 6 && this.world.city.isWater(this.pos.x, this.pos.z)) {
      const n = this.world.roads.nearestWalkNode(this.pos.x, this.pos.z);
      this.pos.x += (n.x - this.pos.x) * 0.25;
      this.pos.z += (n.z - this.pos.z) * 0.25;
      this.node = n; this.next = pick(n.links);
    }

    if (this.integrate(dt)) {
      // walked into a building — pick a side and slide along it for a moment
      if (this.avoid <= 0) { this.avoid = rand(0.5, 1.1); this.avoidDir = Math.random() < 0.5 ? -1 : 1; }
    }
  }

  /** Took a hit but can't be hurt — react to it anyway. */
  onHarmless (from) { this.panic(from && from.pos ? from.pos : null, 1); }

  /** Back on their feet after being thrown — leave in a hurry. */
  onRecovered () {
    this.node = this.world.roads.nearestWalkNode(this.pos.x, this.pos.z);
    this.state = 'flee';
    this.timer = rand(4, 8);
    this.fleeFrom = this.world.player.pos.clone();
    this._pickFleeNode();
  }

  getUpDelay () { return rand(1.4, 2.6); }
}
