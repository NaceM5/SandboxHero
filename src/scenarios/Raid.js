import * as THREE from 'three';
import { Aircraft } from './Aircraft.js';
import { Enemy, rollTier } from '../ai/Enemy.js';
import { burst, explode, breakApart, updateChunks, clearChunks, ram, SPEED } from './JetAI.js';
import { clamp, rand, randInt, pick, angleDelta } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const CRUISE = 330, PAD_CRUISE = 480, HOVER = 60;
const MAX_CARGO = 6;             // civilians per run
const RAIDERS = 4;               // crew per run
const LOAD_TIMEOUT = 55;         // seconds on the street before it leaves regardless
const GUARD_CAP = 12;            // helipad guards accumulate up to this many
// Aeris Tower: the projecting helipad, the way in, and the living room
const PAD = { x: -2150, y: 416, z: -180, r: 26 };
const DOOR_OUT = [-2118, -180], DOOR_IN = [-2098, -180], LIVING = [-2066, -168];
// guard posts around the pad, all clear of a parked airframe (which straddles x = -2150)
// (the access walkway at z ≈ -180, x > -2140 is fenced, so nothing stands in it)
const PAD_POSTS = [[-2170, -198], [-2170, -180], [-2170, -162], [-2162, -204], [-2162, -156], [-2138, -204], [-2138, -156], [-2130, -198], [-2130, -162], [-2128, -190], [-2128, -170], [-2172, -172]];
// off the ramp, round the tail, in at the walkway's open west end
const PAD_EXIT = [[-2128, -198], [-2143, -180]];
// two long, straight, wide streets the airlifter can put down on
const STRIPS = [
  { axis: 'z', x: -1950, from: -470, to: 340, heading: 0 },
  { axis: 'x', z: -60, from: -2650, to: -1560, heading: Math.PI / 2 }
];

/**
 * Airlift Raid. A Titan 60 lands on a city street, its crew fans out and
 * drags civilians aboard, then it lifts off for the Aeris Tower helipad,
 * unloads the hostages into the penthouse, leaves the crew guarding the pad,
 * and goes back for more — until you bring it down. Destroy it in the air
 * with people aboard and they all fall out.
 */
export class AirliftRaid {
  constructor (world, def) {
    this.world = world;
    this.def = def;
    this.t = 0;
    this.finished = false;
    this.cleared = false;
    this.aircraft = [];
    this.chunks = [];
    this.raiders = [];            // this run's crew, scripted until attacked
    this.cargo = [];              // civilians aboard
    this.hostages = [];           // delivered to the penthouse
    this.guards = [];             // crews left guarding the pad
    this.walkers = [];            // scripted walks in progress: { a, path, i, speed, then }
    this.crimes = [];
    this.cycle = 0;
    this.rescued = 0;

    const center = { x: -190, z: 200 };
    const ang = Math.random() * Math.PI * 2;
    const dir = { x: Math.sin(ang), z: Math.cos(ang) };
    this.approachName = compassName(-dir.x, -dir.z);
    const p = new Aircraft(world, 'titan');
    p.owner = this;
    p.pos.set(center.x + dir.x * 4300, CRUISE, center.z + dir.z * 4300);
    p.heading = Math.atan2(-dir.x, -dir.z);
    p.speed = p.desiredSpeed = SPEED.transport;
    p.gunT = 2;
    p.syncMesh();
    this.plane = p;
    this.aircraft.push(p);
    this.phase = 'inbound';
    this.phaseT = 0;
    this.site = this._pickSite();
  }

  /* ---------------- helpers ---------------- */

  _pickSite () {
    const pp = this.world.player.pos;
    let best = null, bd = Infinity;
    for (const s of STRIPS) {
      const x = s.axis === 'z' ? s.x : clamp(pp.x, s.from, s.to);
      const z = s.axis === 'z' ? clamp(pp.z, s.from, s.to) : s.z;
      const d = Math.hypot(x - pp.x, z - pp.z);
      if (d < bd) { bd = d; best = { x, z, heading: s.heading, y: this.world.city.groundHeight(x, z) }; }
    }
    return best;
  }

  /** The cargo ramp: behind the tail, on the ground. */
  _ramp (out = _c) {
    const p = this.plane;
    out.set(p.pos.x - Math.sin(p.heading) * 25, p.pos.y, p.pos.z - Math.cos(p.heading) * 25);
    out.y = this.world.city.groundHeight(out.x, out.z, p.pos.y + 1.4);
    return out;
  }

  _park () {
    const p = this.plane;
    p.colliders = p.asset.getColliders({ position: p.pos.toArray(), yaw: p.heading, scale: 1 });
    for (const r of p.colliders) this.world.city.colliders.add(r);
  }

  _unpark () {
    for (const r of this.plane.colliders || []) r.gone = true;
    this.plane.colliders = null;
  }

  _setPhase (ph) { this.phase = ph; this.phaseT = 0; }

  status () {
    const aboard = this.cargo.length;
    const guards = this.guards.filter(e => !e.dead).length;
    const crew = this.raiders.filter(e => !e.dead && !e.aboard).length;
    const p = this.plane;
    if (this.cleared) return null;
    if (!p.alive) return { title: 'AIRLIFT RAID — TRANSPORT DOWN', sub: `${this.rescued} civilians freed · ${guards} guards left on the helipad · ${this.hostages.length} in the penthouse` };
    const where = { inbound: 'inbound to the city', landing: 'landing', loading: 'on the ground, crew loading', takeoff: 'lifting off', toTower: 'bound for the Aeris helipad', padLanding: 'landing on the helipad', unloading: 'unloading on the helipad' }[this.phase] || this.phase;
    return {
      title: 'AIRLIFT RAID',
      sub: `transport ${Math.round(p.healthFrac * 100)}% ${where} · ${aboard} aboard · crew ${crew} · ${this.hostages.length} hostages · ${guards} pad guards · ${Math.round(p.pos.distanceTo(this.world.player.pos))} m`
    };
  }

  /* ---------------- damage ---------------- */

  hurt (a, amount, at) {
    if (!a.alive) return;
    if (a.damage(amount, at)) this._destroy(a);
    else if (a.healthFrac < 0.5 && !this._warned) { this._warned = true; this.world.notify('Transport losing systems — keep hitting it'); }
  }

  _destroy (p) {
    explode(this.world, p);
    this._unpark();
    // everyone aboard falls out
    for (const c of this.cargo) this._eject(c, true);
    this.rescued += this.cargo.length;
    this.cargo.length = 0;
    for (const r of this.raiders) {
      if (r.aboard) this._eject(r, false);
      else { if (r.captiveOf) this._release(r.captiveOf); r.captiveOf = null; r.scripted = false; }
    }
    this.world.notify(this.rescued ? `TRANSPORT DESTROYED — ${this.rescued} civilians fell clear` : 'TRANSPORT DESTROYED');
    this.world.player.stats.crimes++;
    // whoever is left in the penthouse is free to go
    for (const h of this.hostages) { h.hostage = false; h.state = 'flee'; h.timer = 6; h.fleeFrom = h.pos.clone(); }
    this.hostages.length = 0;
    for (const w of this.walkers) this._endWalk(w, false);
    this.walkers.length = 0;
    breakApart(this.world, p, this.chunks);
    p.dispose();
    this._setPhase('done');
  }

  /** Out of the airframe and into the air, tumbling. */
  _eject (a, civilian) {
    const p = this.plane;
    a.aboard = false;
    a.scripted = false;
    a.inVehicle = false;
    a.captive = null;
    a.setVisible(true);
    a.pos.set(p.pos.x + rand(-6, 6), p.pos.y + rand(2, 6), p.pos.z + rand(-6, 6));
    a.group.position.copy(a.pos);
    if (a.phys !== 'walk') a.resetPhysics();
    _a.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
    a.launch(_a, rand(6, 14), 0.4, 1.2, 1.1);
    if (civilian) a.panic?.(p.pos, 1);
  }

  /* ---------------- scripted walking ---------------- */

  /** Send an actor along a path of [x, z] points; `then` runs on arrival. */
  _walk (a, path, speed, then) {
    a.scripted = true;
    this.walkers.push({ a, path: path.map(p => ({ x: p[0], z: p[1] })), i: 0, speed, then });
  }

  _endWalk (w, arrived) {
    w.a.scripted = false;
    if (arrived) w.then?.(w.a);
  }

  _updateWalkers (dt) {
    const map = this.world.city;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i], a = w.a;
      // knocked flying, grabbed, killed or otherwise interrupted: the script is over
      if (a.dead || a.phys !== 'walk' || !a.scripted || (a.faction === 'enemy' && a.health < a.maxHealth)) {
        this._endWalk(w, false);
        this.walkers.splice(i, 1);
        continue;
      }
      const tgt = w.path[w.i];
      const dx = tgt.x - a.pos.x, dz = tgt.z - a.pos.z, d = Math.hypot(dx, dz);
      // wedged against something: call it arrived rather than stand there forever
      if (w.best === undefined || d < w.best - 0.2) { w.best = d; w.stall = 0; }
      else if ((w.stall = (w.stall || 0) + dt) > 4) { this._endWalk(w, true); this.walkers.splice(i, 1); continue; }
      if (d < 1.2) {
        w.best = undefined;
        w.i++;
        if (w.i >= w.path.length) { this._endWalk(w, true); this.walkers.splice(i, 1); continue; }
      }
      a.faceTowards(tgt.x, tgt.z, 8, dt);
      const step = Math.min(w.speed * dt, d);
      a.pos.x += Math.sin(a.heading) * step;
      a.pos.z += Math.cos(a.heading) * step;
      a.pos.y = map.groundHeight(a.pos.x, a.pos.z, a.pos.y + 1.4);
      map.resolveCollision(a.pos, a.radius, a.pos.y, a.pos.y + a.height, false, 0.5);
      a.group.position.copy(a.pos);
      a.group.rotation.set(0, a.heading, 0);
      a.speed = w.speed;
      a.anim.play(w.speed > 2.6 ? 'run' : 'walk', { fade: 0.18, speed: clamp(w.speed / (w.speed > 2.6 ? 4.2 : 1.6), 0.7, 1.7) });
      a.setVisible(true);
    }
  }

  /* ---------------- the crew on the street ---------------- */

  _spawnCrew () {
    const diff = this.world.settings.get('crimeDifficulty');
    const ramp = this._ramp(new THREE.Vector3());
    const crime = this.world.crime.addExternal({ label: 'Abduction crew', x: ramp.x, z: ramp.z, persistent: true });
    this.crimes.push(crime);
    this.raiders = [];
    for (let i = 0; i < RAIDERS; i++) {
      const x = ramp.x + rand(-3, 3), z = ramp.z + rand(-3, 3);
      const e = new Enemy(this.world, x, z, rollTier(diff), null);
      e.pos.y = this.world.city.groundHeight(x, z, ramp.y + 1.4);
      e.group.position.copy(e.pos);
      e.raid = this; e.task = 'seek'; e.scripted = true; e.aboard = false; e.captiveOf = null; e.seekT = rand(0, 1);
      this.world.crime.attach(crime, e);
      this.raiders.push(e);
      this.world.enemies.push(e);
    }
    // Make sure there is someone to take. The crowd lives around the hero,
    // so a street far from them may be empty — and anyone here would be
    // streamed back to the hero's neighbourhood within seconds. Pin the
    // locals for the length of the stop and bring people in to fill the gaps.
    const pin = LOAD_TIMEOUT + 15;
    let near = 0;
    for (const p of this.world.peds) {
      if (p.phys !== 'walk' || p.captive || p.aboard || p.hostage || p.pos.distanceTo(ramp) > 90) continue;
      p.pin = pin; near++;
    }
    for (let k = near; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(25, 70);
      const px = ramp.x + Math.cos(a) * r, pz = ramp.z + Math.sin(a) * r;
      const n = this.world.roads.nearestWalkNode(px, pz, ramp.y, 8);
      if (!n || Math.hypot(n.x - ramp.x, n.z - ramp.z) > 120) continue;
      this.world.placePedestrian(n.x, n.z, n.y, pin);
    }
  }

  _updateCrew (dt) {
    const map = this.world.city;
    const ramp = this._ramp(new THREE.Vector3());
    let busy = 0;
    for (const r of this.raiders) {
      if (r.aboard) continue;
      // attacked, thrown or dead: script over, captive released, ordinary enemy from here
      if (r.dead || r.phys !== 'walk' || r.health < r.maxHealth || !r.scripted) {
        if (r.captiveOf) this._release(r.captiveOf);
        r.captiveOf = null; r.scripted = false; r.task = 'free';
        continue;
      }
      busy++;
      if (r.task === 'seek') {
        r.seekT -= dt;
        if (r.seekT > 0) { r.anim.play('taunt', { fade: 0.25 }); r.updateAnim(dt); continue; }
        r.seekT = 0.6;
        const full = this.cargo.length + this.raiders.filter(x => x.captiveOf).length >= MAX_CARGO;
        if (!full) {
          let best = null, bd = 90 * 90;
          for (const p of this.world.peds) {
            if (p.phys !== 'walk' || p.captive || p.aboard || p.hostage || p.airborne) continue;
            const d = p.pos.distanceToSquared(ramp);
            if (d < bd) { bd = d; best = p; }
          }
          if (best) { r.task = 'fetch'; r.prey = best; best.marked = r; continue; }
        }
        if (full || this.phaseT > LOAD_TIMEOUT - 14) { r.task = 'board'; }
        else { r.anim.play('taunt', { fade: 0.25 }); r.updateAnim(dt); }
      }
      if (r.task === 'fetch') {
        const p = r.prey;
        // time to go: give up the chase and get back to the ramp
        if (this.phaseT > LOAD_TIMEOUT - 14) { if (p) p.marked = null; r.prey = null; r.task = 'board'; continue; }
        if (!p || p.phys !== 'walk' || p.captive || p.aboard || p.pos.distanceTo(ramp) > 140) { if (p) p.marked = null; r.prey = null; r.task = 'seek'; continue; }
        // faster than a fleeing civilian, so the chase actually ends
        this._step(r, p.pos.x, p.pos.z, 6.8, dt);
        if (Math.hypot(p.pos.x - r.pos.x, p.pos.z - r.pos.z) < 2.2) {
          p.captive = r; p.marked = null; r.captiveOf = p; r.prey = null; r.task = 'return';
          this.world.audio?.voice(p, .7, 1.25);
          p.state = 'cower'; p.timer = 999;
          this.world.effects.burst(p.pos, '#ffd0a0', 6, 4, 0.25, 0.3, { grav: -4 });
          for (const q of this.world.peds) if (q !== p && q.pos.distanceTo(p.pos) < 22) q.panic?.(r.pos, 1);
        }
        continue;
      }
      if (r.task === 'return') {
        const p = r.captiveOf;
        if (!p || p.captive !== r) { r.captiveOf = null; r.task = 'seek'; continue; }
        this._step(r, ramp.x, ramp.z, 3.6, dt);
        if (Math.hypot(ramp.x - r.pos.x, ramp.z - r.pos.z) < 3) {
          // up the ramp and into the hold
          p.captive = null; p.aboard = true; p.setVisible(false);
          this.cargo.push(p);
          r.captiveOf = null; r.task = 'seek';
        }
        continue;
      }
      if (r.task === 'board') {
        this._step(r, ramp.x, ramp.z, 3.6, dt);
        if (Math.hypot(ramp.x - r.pos.x, ramp.z - r.pos.z) < 3) { r.aboard = true; r.inVehicle = true; r.setVisible(false); }
      }
    }
    // keep the hold's occupants with the airframe
    for (const p of this.cargo) { p.pos.copy(this.plane.pos); p.group.position.copy(p.pos); }
    for (const r of this.raiders) if (r.aboard) { r.pos.copy(this.plane.pos); r.group.position.copy(r.pos); }
    return busy;
  }

  _release (p) {
    p.captive = null;
    p.state = 'flee'; p.timer = rand(4, 8); p.fleeFrom = this.plane.pos.clone();
    p.panic?.(this.plane.pos, 1, true);
  }

  /** One scripted stride toward a point, on the ground, through no walls. */
  _step (a, x, z, speed, dt) {
    const map = this.world.city;
    a.faceTowards(x, z, 8, dt);
    const d = Math.hypot(x - a.pos.x, z - a.pos.z);
    const step = Math.min(speed * dt, d);
    a.pos.x += Math.sin(a.heading) * step;
    a.pos.z += Math.cos(a.heading) * step;
    a.pos.y = map.groundHeight(a.pos.x, a.pos.z, a.pos.y + 1.4);
    map.resolveCollision(a.pos, a.radius, a.pos.y, a.pos.y + a.height, false, 0.5);
    a.group.position.copy(a.pos);
    a.group.rotation.set(0, a.heading, 0);
    a.speed = speed;
    a.anim.play(speed > 2.6 ? 'run' : 'walk', { fade: 0.18, speed: clamp(speed / (speed > 2.6 ? 4.2 : 1.6), 0.7, 1.7) });
    a.updateAnim(dt);
    a.setVisible(true);
  }

  /* ---------------- flight ---------------- */

  _flyTo (target, altitude, dt, speed = SPEED.transport) {
    const p = this.plane, map = this.world.city;
    p.forward(_a);
    const ahead = map.groundHeight(p.pos.x + _a.x * 320, p.pos.z + _a.z * 320);
    const here = map.groundHeight(p.pos.x, p.pos.z);
    _b.set(target.x, Math.max(altitude, ahead + 110, here + 90), target.z);
    const d = p.steerTo(_b, dt, speed);
    p.integrate(dt);
    return d;
  }

  /** Straight down onto a spot, swinging the nose to a heading. */
  _vtolDown (spot, groundY, heading, dt) {
    const p = this.plane;
    const k = Math.min(1, dt * 1.2);
    p.pos.x += (spot.x - p.pos.x) * k;
    p.pos.z += (spot.z - p.pos.z) * k;
    p.heading += angleDelta(p.heading, heading) * k;
    p.pitch += (0 - p.pitch) * k; p.roll += (0 - p.roll) * k;
    p.speed = p.desiredSpeed = 0; p.vel.set(0, 0, 0);
    p.pos.y = Math.max(groundY, p.pos.y - 8 * dt);
    if (p.pos.y > groundY + 1 && Math.random() < dt * 8) this.world.effects.burst(_a.set(p.pos.x + rand(-12, 12), groundY + 0.5, p.pos.z + rand(-12, 12)), '#cfd6e0', 6, 6, 0.7, 0.4, { grav: -3 });
    p.syncMesh();
    return p.pos.y <= groundY + 0.01;
  }

  _vtolUp (toY, dt) {
    const p = this.plane;
    p.pos.y += 9 * dt;
    p.pitch = clamp(p.pitch + 0.08 * dt, 0, 0.1);
    p.syncMesh();
    return p.pos.y >= toY;
  }

  /* ---------------- update ---------------- */

  update (dt, ctx) {
    this.t += dt; this.phaseT += dt;
    const p = this.plane, player = this.world.player, map = this.world.city;
    if (p.alive) {
      p.hitFlash = Math.max(0, p.hitFlash - dt);
      p.emitDamageFx(dt);
      ram(this.world, p, player);
      this._gun(dt, player);
    }
    switch (this.phase) {
      case 'inbound': {
        _b.set(this.site.x, 0, this.site.z);
        const d = this._flyTo(_b, this.site.y + HOVER + 20, dt);
        if (d < 30) { this._setPhase('landing'); p.setGear(true); }
        break;
      }
      case 'landing':
        if (this._vtolDown(this.site, this.site.y, this.site.heading, dt)) {
          this._park();
          this._setPhase('loading');
          this.cycle++;
          this._spawnCrew();
          this.world.notify('Transport down on the street — the crew is taking hostages');
          for (const q of this.world.peds) if (q.pos.distanceTo(p.pos) < 60) q.panic?.(p.pos, 1);
        }
        break;
      case 'loading': {
        const busy = this._updateCrew(dt);
        const allAboard = this.raiders.every(r => r.aboard || !r.scripted || r.dead);
        const crewLeft = this.raiders.some(r => r.scripted && !r.aboard && !r.dead);
        if ((allAboard && !crewLeft) || this.phaseT > LOAD_TIMEOUT) {
          // whoever is still out there is left behind
          for (const r of this.raiders) if (!r.aboard) { r.scripted = false; if (r.captiveOf) this._release(r.captiveOf); r.captiveOf = null; }
          this._unpark();
          p.setGear(false);
          this._setPhase('takeoff');
          this.world.notify(this.cargo.length ? `Transport lifting off with ${this.cargo.length} hostages aboard` : 'Transport lifting off empty');
        }
        break;
      }
      case 'takeoff':
        this._updateCrew(dt);
        if (this._vtolUp(this.site.y + HOVER, dt)) { this._setPhase('toTower'); p.speed = 15; }
        break;
      case 'toTower': {
        this._updateCrew(dt);
        // come in from the west, clear of the crown fin on the tower's east side
        _b.set(PAD.x - 60, 0, PAD.z);
        const d = this._flyTo(_b, PAD_CRUISE, dt, 40);
        // only start down once it is actually above the pad; too low, it goes round again
        if (d < 40 && p.pos.y > PAD.y + 35) { this._setPhase('padLanding'); p.setGear(true); }
        break;
      }
      case 'padLanding':
        this._updateCrew(dt);
        if (this._vtolDown(PAD, PAD.y, 0, dt)) {
          this._park();
          this._setPhase('unloading');
          this.unloadT = 0.5;
          this.world.notify(this.cargo.length ? 'Transport on the Aeris helipad — hostages going into the penthouse' : 'Transport on the Aeris helipad');
        }
        break;
      case 'unloading': {
        this.unloadT -= dt;
        if (this.unloadT <= 0) {
          this.unloadT = 0.9;
          const ramp = this._ramp(new THREE.Vector3());
          if (this.cargo.length) {
            const c = this.cargo.shift();
            c.aboard = false; c.setVisible(true);
            c.pos.set(ramp.x + rand(-1, 1), ramp.y, ramp.z + rand(-1, 1)); c.group.position.copy(c.pos);
            this._walk(c, [...PAD_EXIT, DOOR_OUT, DOOR_IN, [LIVING[0] + rand(-8, 8), LIVING[1] + rand(-8, 8)]], 2.2, (a) => {
              a.hostage = true; a.state = 'cower'; a.timer = 999; this.hostages.push(a);
            });
          } else {
            const r = this.raiders.find(x => x.aboard);
            if (r && this.guards.filter(g => !g.dead).length < GUARD_CAP) {
              r.aboard = false; r.inVehicle = false; r.setVisible(true);
              r.pos.set(ramp.x + rand(-1, 1), ramp.y, ramp.z + rand(-1, 1)); r.group.position.copy(r.pos);
              const post = PAD_POSTS[this.guards.length % PAD_POSTS.length];
              this.guards.push(r);
              this._walk(r, [post], 3.0, (e) => {
                e.posts = PAD_POSTS.map(([x, z]) => new THREE.Vector3(x, PAD.y, z));
                e.postIndex = randInt(0, PAD_POSTS.length - 1);
                e.home.set(e.pos.x, 0, e.pos.z);
                e.state = 'idle';
              });
            } else if (r) { r.aboard = false; r.inVehicle = false; r.dead = true; r.dispose(); const k = this.world.enemies.indexOf(r); if (k >= 0) this.world.enemies.splice(k, 1); }
            else if (!this.walkers.some(w => w.a.faction === 'enemy') && this.phaseT > 4) {
              this._unpark();
              p.setGear(false);
              this._setPhase('padTakeoff');
            }
          }
        }
        break;
      }
      case 'padTakeoff':
        if (this._vtolUp(PAD.y + HOVER + 20, dt)) {
          this.site = this._pickSite();
          this._setPhase('inbound');
          p.speed = 15;
          this.world.notify('Transport heading back for another load');
        }
        break;
      case 'done':
        break;
    }
    this._updateWalkers(dt);
    updateChunks(this.world, this.chunks, dt);
    // aboard: hidden, riding along
    if (p.alive) for (const c of this.cargo) { c.pos.copy(p.pos); c.group.position.copy(c.pos); }
    for (let i = this.crimes.length - 1; i >= 0; i--) if (!this.world.crime.crimes.includes(this.crimes[i])) this.crimes.splice(i, 1);
    // transport down and its crew and pad guards all dealt with: objective
    // complete, the readout goes and only the wreckage is left to burn out
    if (this.phase === 'done' && !this.cleared &&
        !this.guards.some(e => !e.dead) && !this.raiders.some(e => !e.dead)) {
      this.cleared = true;
      this.world.notify('AIRLIFT RAID — CLEARED');
    }
    if (this.phase === 'done' && !this.chunks.length) this.finished = true;
  }

  /** The tail turret takes potshots at a hero who gets close in the air. */
  _gun (dt, player) {
    const p = this.plane, w = p.weapon;
    p.gunT -= dt * w.rate;
    if (p.gunT > 0) return;
    if (!player.suited || p.pos.distanceTo(player.pos) > 260 || !player.flying) { p.gunT = 0.5; return; }
    p.gunT = 2.6;
    burst(this.world, p, p.group.localToWorld(_a.set(0, 7.5, -22)), player, w, 5);
  }

  end (hard) {
    if (this.plane.alive) { this._unpark(); this.plane.alive = false; this.plane.dispose(); }
    clearChunks(this.world, this.chunks);
    for (const w of this.walkers) this._endWalk(w, false);
    this.walkers.length = 0;
    for (const c of this.cargo) { c.aboard = false; c.setVisible(true); c.pos.y = this.world.city.streetHeight(c.pos.x, c.pos.z); }
    this.cargo.length = 0;
    for (const p of this.world.peds) { if (p.captive) this._release(p); if (p.hostage) { p.hostage = false; p.state = 'walk'; } }
    if (hard) {
      for (const c of this.crimes) this.world.crime.removeCrime(c);
      this.crimes.length = 0;
      for (const list of [this.raiders, this.guards]) for (const e of list) { const k = this.world.enemies.indexOf(e); if (k >= 0) { this.world.enemies.splice(k, 1); e.dispose(); } }
    } else {
      for (const r of this.raiders) { r.scripted = false; r.aboard = false; r.inVehicle = false; r.setVisible(true); }
    }
    this.finished = true;
  }
}

function compassName (x, z) {
  const ang = Math.atan2(x, -z);
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8];
}
