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
  constructor (world, node, opts = {}) {
    // bystanders can be thrown around all day but never die — this is a
    // sandbox, not a massacre simulator
    super(world, opts.appearance || randomCivilian(), {
      moveSpeed: rand(1.25, 1.85), health: 60, faction: 'civilian', cull: 190, invulnerable: true
    });
    this.node = node || world.roads.randomWalkNode();
    this.next = pick(this.node.links);
    // Staff of a place rather than passers-by: they live on a set of posts —
    // a floor of an office, a courtyard — and never touch the footway graph,
    // so the crowd streaming leaves them alone and they never wander off.
    this.station = opts.station ? { posts: opts.station.posts, y: opts.station.y, target: null } : null;
    // Sit on the terrain from the outset: a pedestrian spawned beyond the cull
    // radius returns from update() before integrate() runs, so a y of 0 would
    // leave them buried in any ground that isn't at sea level.
    this.pos.set(this.node.x, world.city.groundHeight(this.node.x, this.node.z, this.node.y + 3), this.node.z);
    if (this.station) {
      const start = pick(this.station.posts);
      this.pos.set(start[0] + rand(-1, 1), world.city.groundHeight(start[0], start[1], this.station.y + 1.4), start[1] + rand(-1, 1));
      this.state = 'idle';
    }
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
      if (Math.random() < 0.5) this.world.audio?.voice(this, .55, 1.3);
      // most people run; only those caught right in it freeze up
      this.state = (preferFlee || Math.random() < 0.85) ? 'flee' : 'cower';
      this.fleeFrom = from ? from.clone() : this.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)));
      this.timer = rand(4, 9);
      if (this.state === 'flee') this._pickFleeNode();
    }
  }

  /** Staff: the next post to drift to — nearby for preference, never the one they are on. */
  _nextPost () {
    const st = this.station;
    const here = st.target;
    const others = st.posts.filter(q => q !== here);
    const near = others.filter(q => Math.hypot(q[0] - this.pos.x, q[1] - this.pos.z) < 60);
    // a short stroll for preference; otherwise one of the three closest, never a hike across the whole site
    const pool = near.length ? near : others.sort((a, b) => Math.hypot(a[0] - this.pos.x, a[1] - this.pos.z) - Math.hypot(b[0] - this.pos.x, b[1] - this.pos.z)).slice(0, 3);
    const q = pick(pool.length ? pool : st.posts);
    st.target = q;
    st.best = Infinity; st.stall = 0;
    this.wanderTo = { x: q[0] + rand(-1.2, 1.2), z: q[1] + rand(-1.2, 1.2) };
  }

  /** Staff state machine: idle at a post, drift to another, flee to the far one. */
  _stationStep (dt, player, distToPlayer) {
    let moving = false, speedMul = 1;
    const st = this.station;
    switch (this.state) {
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) { this._nextPost(); this.state = 'walk'; this.timer = rand(6, 22); }
        break;
      case 'gawk':
        this.timer -= dt;
        this.faceTowards(player.pos.x, player.pos.z, 6, dt);
        if (this.timer <= 0) { this.state = 'idle'; this.timer = rand(2, 6); }
        break;
      case 'cower':
        this.timer -= dt;
        if (this.timer <= 0 && this.fear < 0.25) { this.state = 'idle'; this.timer = rand(2, 6); }
        break;
      case 'flee': {
        this.timer -= dt;
        speedMul = 2.2;
        const t = this.wanderTo;
        if (!t || Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 1.5) { this.state = 'cower'; this.timer = rand(3, 7); break; }
        this.faceTowards(t.x, t.z, 7, dt);
        moving = true;
        if (this.timer <= 0) { this.state = 'idle'; this.timer = rand(2, 5); }
        break;
      }
      default: { // walk
        const t = this.wanderTo;
        if (!t) { this._nextPost(); break; }
        const d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
        if (d < 1.1) { this.state = 'idle'; this.timer = rand(5, 18); break; }
        // wedged behind a desk or a planter: give up on this post and pick another later
        if (d < st.best - 0.15) { st.best = d; st.stall = 0; }
        else if ((st.stall = (st.stall || 0) + dt) > 4) { this.state = 'idle'; this.timer = rand(2, 6); break; }
        this.faceTowards(t.x, t.z, 5.5, dt);
        moving = true;
        if (this.gawk <= 0 && distToPlayer < 14 && player.suited && Math.random() < dt * 0.55) {
          this.state = 'gawk'; this.timer = rand(1.5, 4); this.gawk = 12;
        }
      }
    }
    return { moving, speedMul };
  }

  /** Head for whichever neighbouring pavement node leads away from danger. */
  _pickFleeNode () {
    if (this.station) {
      // staff run to whichever of their posts is furthest from the trouble
      let best = null, bd = -Infinity;
      for (const q of this.station.posts) {
        const d = Math.hypot(q[0] - this.fleeFrom.x, q[1] - this.fleeFrom.z);
        if (d > bd) { bd = d; best = q; }
      }
      this.station.target = best;
      this.wanderTo = best ? { x: best[0], z: best[1] } : null;
      return;
    }
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
    // a rare footway (the private drive up to the estate) is not somewhere
    // the crowd wanders unless it is already on it
    const links = this.node.links.filter(l => !l.edge?.rare || this.node.edge?.rare);
    if (!links.length) { this.next = pick(this.node.links); return; }
    // prefer staying on this block; only cross at a crosswalk, and not often
    const onBlock = links.filter(l => !(this.node.crossing?.has(l)) && l !== this.prev);
    const crossings = links.filter(l => this.node.crossing?.has(l));
    if (crossings.length && Math.random() < 0.3) this.next = pick(crossings);
    else this.next = onBlock.length ? pick(onBlock) : pick(links);
  }

  update (dt, ctx) {
    if (this.phys !== 'walk') {
      // a grab or a blast breaks any hold on them
      if (this.captive) this.captive = null;
      this.updateRagdoll(dt);
      return;
    }
    // in the hold of an aircraft: hidden and inert until it lands or dies
    if (this.aboard) return;
    // held in the penthouse: cower where they were put
    if (this.hostage) {
      this.anim.play('cower', { fade: 0.25 });
      this.anim.look[0] *= 0.9; this.anim.look[1] *= 0.9;
      this.updateAnim(dt);
      this.group.position.copy(this.pos);
      return;
    }
    // being dragged along by a raider: stumble behind them
    if (this.captive) {
      const r = this.captive;
      if (r.dead || r.phys !== 'walk' || !r.scripted) { this.captive = null; this.panic(r.pos, 1, true); }
      else {
        const bx = r.pos.x - Math.sin(r.heading) * 0.95, bz = r.pos.z - Math.cos(r.heading) * 0.95;
        this.pos.x += (bx - this.pos.x) * Math.min(1, dt * 10);
        this.pos.z += (bz - this.pos.z) * Math.min(1, dt * 10);
        this.pos.y = this.world.city.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.4);
        this.heading = r.heading;
        this.group.position.copy(this.pos);
        this.group.rotation.set(0, this.heading, 0);
        this.setVisible(true);
        this.anim.play(r.speed > 2.6 ? 'panicRun' : 'walk', { fade: 0.2, speed: 1.1 });
        this.anim.flinch = Math.max(this.anim.flinch, 0.4);
        this.updateAnim(dt);
        return;
      }
    }
    // walking a scripted path: the scenario moves the body, we only animate
    if (this.scripted) { this.updateAnim(dt); return; }
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

    if (this.station) {
      const r = this._stationStep(dt, player, distToPlayer);
      moving = r.moving; speedMul = r.speedMul;
    } else switch (this.state) {
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
        // step off the kerb only once the crosswalk is clear — but once in
        // the road, keep going: it is the cars' job to stop, and someone who
        // sees one coming hurries rather than freezing in the lane
        const crossing = this.node.crossing?.has(this.next);
        const offKerb = crossing && Math.hypot(this.pos.x - this.node.x, this.pos.z - this.node.z) > 2.2;
        if (crossing && !offKerb && !this._crossingClear(this.next)) {
          this.crossWait += dt;
          waiting = true;
          this.faceTowards(this.next.x, this.next.z, 5, dt);
          if (this.crossWait < 9) break;      // give up eventually so nobody sticks
        } else this.crossWait = 0;
        if (offKerb && !this._crossingClear(this.next)) speedMul = 1.45;

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
      // where they are heading, for cars deciding whether to brake
      this.walkX = moving ? Math.sin(h) * sp : 0;
      this.walkZ = moving ? Math.cos(h) * sp : 0;
    } else { this.speed = 0; this.walkX = 0; this.walkZ = 0; }

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
    const city = this.world.city;
    if (!this.station && city.isWater(this.pos.x, this.pos.z) && this.pos.y < city.waterLevel(this.pos.x, this.pos.z) + 6) {
      const n = this.world.roads.nearestWalkNode(this.pos.x, this.pos.z, city.waterLevel(this.pos.x, this.pos.z), 14);
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
    this.node = this.world.roads.nearestWalkNode(this.pos.x, this.pos.z, this.pos.y, 8);
    this.state = 'flee';
    this.timer = rand(4, 8);
    this.fleeFrom = this.world.player.pos.clone();
    this._pickFleeNode();
  }

  getUpDelay () { return rand(1.4, 2.6); }
}
