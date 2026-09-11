import * as THREE from 'three';
import { Aircraft } from './Aircraft.js';
import { Enemy, rollTier } from '../ai/Enemy.js';
import { attackRun, breakOff, evade, burst, ram, explode, obliterate, breakApart, updateChunks, clearChunks, SPEED } from './JetAI.js';
import { clamp, rand, randInt, angleDelta } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const HOVER = 60;              // metres over the deck the transport hovers before dropping in
const GUARD = 750;             // the jets engage the hero this close to the ship
const LEASH = 850;             // and never range further than this from it
const ORBIT_R = 300, ORBIT_H = 115;   // the patrol circle, and its height over the deck
const CREW = 16;               // six on the lower deck, five aft, one in each room below
const SLOTS = [[-110, 28, -80], [110, 28, -80], [0, 55, -170]];   // inbound formation: right, up, back

/*
 * The Aegis in its own frame (see tideline/helicarrier.js — it is unrotated,
 * so local (x, z) is world (X + x, Z + z)): the lower flight deck runs from
 * the bow at z = -156 to the connecting ramp at z = -20, the raised aft deck
 * from z = 50 to the stern at 147, and the headquarters floor sits under it
 * all at 904 m with the lift landing at (0, 100) on both levels.
 */
const LAND = [0, -80];                      // the transport puts down here, nose to the bow
const LOWER_POSTS = [[-30, -135], [30, -135], [-36, -70], [36, -70], [-30, -25], [30, -25]];
// aft deck posts all keep clear of the operations bridge (starboard, z 72–112)
// and the lift cabin (x ±3, z 96–102), so a guard can walk between any two
const UPPER_POSTS = [[-26, 62], [-28, 90], [-22, 120], [0, 140], [10, 135]];
const TO_UPPER = [[0, -20], [0, 55], [-14, 75]];      // up the ramp, then round the lift on the port side
const ROOMS = [
  { name: 'Command center', post: [0, -58], path: [[0, 80], [0, -58]] },
  { name: 'Science lab', post: [-15, -22], path: [[0, 80], [0, -22], [-15, -22]] },
  { name: 'Briefing room', post: [14, 13], path: [[0, 80], [0, 13], [14, 13]] },
  { name: 'Crew lounge', post: [-15, 50], path: [[0, 80], [0, 50], [-15, 50]] },
  { name: 'Medical bay', post: [15, 50], path: [[0, 80], [0, 50], [15, 50]] }
];
// from the ramp up the deck ramp to the lift on the aft deck (its door faces the stern)
const TO_LIFT = [[0, -20], [0, 55], [6, 90], [6, 106], [0, 106], [0, 100]];
// out of the lift at headquarters level, round the cabin, into the spine
const FROM_LIFT = [[0, 106], [6, 104], [6, 90]];

/**
 * Aegis Takeover. A Titan 60 and three Atlas 42 escorts come in from the sea
 * and the transport puts down on the helicarrier's lower flight deck. Its
 * boarding party fans out over both decks and takes the lift down into the
 * headquarters, one to each room, while the escorts circle the ship and
 * engage anyone who comes near. The transport stays on deck as a target.
 * Cleared when the transport, every jet and every raider is down.
 */
export class AegisTakeover {
  constructor (world, def) {
    this.world = world;
    this.def = def;
    this.t = 0;
    this.finished = false;
    this.cleared = false;
    this.aircraft = [];
    this.chunks = [];
    this.raiders = [];
    this.walkers = [];
    this.crimes = [];
    this.unloadT = 0;
    this.unloaded = 0;

    const ship = world.city.landmarks.helicarrier;
    this.ship = ship;
    this.local = (x, z, y) => new THREE.Vector3(ship.x + x, y, ship.z + z);
    this.center = this.local(0, 0, ship.deck);
    this.site = this.local(LAND[0], LAND[1], ship.deck);
    this.siteHeading = Math.PI;                 // nose toward the bow (local -z)

    // the fleet comes in from open water in a random compass direction
    const ang = Math.random() * Math.PI * 2;
    const dir = { x: Math.sin(ang), z: Math.cos(ang) };
    this.approachName = compassName(-dir.x, -dir.z);
    const heading = Math.atan2(-dir.x, -dir.z);
    const alt = ship.deck + HOVER + 60;

    const p = new Aircraft(world, 'titan');
    p.owner = this;
    p.pos.set(ship.x + dir.x * 4300, alt, ship.z + dir.z * 4300);
    p.heading = heading;
    p.speed = p.desiredSpeed = SPEED.transport;
    p.gunT = 2;
    p.syncMesh();
    this.plane = p;
    this.aircraft.push(p);

    this.jets = [];
    SLOTS.forEach((s, i) => {
      const j = new Aircraft(world, 'atlas');
      j.owner = this;
      j.slot = i;
      j.pos.set(p.pos.x + Math.cos(heading) * s[0] + Math.sin(heading) * s[2], p.pos.y + s[1], p.pos.z - Math.sin(heading) * s[0] + Math.cos(heading) * s[2]);
      j.heading = heading;
      j.speed = j.desiredSpeed = SPEED.transport;
      j.mode = 'form'; j.modeT = 0; j.gunT = 1; j.rollT = 0;
      j.syncMesh();
      this.aircraft.push(j); this.jets.push(j);
    });
    this.phase = 'inbound';       // inbound | landing | unloading | occupied | down
    this.phaseT = 0;
  }

  /* ---------------- helpers ---------------- */

  _setPhase (ph) { this.phase = ph; this.phaseT = 0; }

  /** The cargo ramp: behind the tail, on the deck. */
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

  /** Raiders still to be dealt with: alive, and still in the world. */
  _living () { return this.raiders.filter(e => !e.dead && this.world.enemies.includes(e)); }

  status () {
    if (this.cleared) return null;
    const p = this.plane, player = this.world.player;
    const jets = this.jets.filter(j => j.alive).length;
    const living = this._living();
    const inHold = living.filter(e => e.aboard).length;
    const onShip = living.length - inHold;
    const d = Math.round(this.center.distanceTo(player.pos));
    if (!p.alive) return { title: 'AEGIS TAKEOVER — TRANSPORT DOWN', sub: `${onShip} raiders left on the Aegis · ${jets} jets on patrol · ${d} m` };
    const hp = `${Math.round(p.healthFrac * 100)}%`;
    const sub = {
      inbound: `transport ${hp} inbound to the Aegis with ${CREW} raiders aboard, ${jets} escorts · ${Math.round(p.pos.distanceTo(player.pos))} m`,
      landing: `transport ${hp} putting down on the flight deck · ${jets} jets circling · ${d} m`,
      unloading: `transport ${hp} on deck — boarding party unloading: ${onShip} out, ${inHold} in the hold · ${jets} jets circling · ${d} m`,
      occupied: `transport ${hp} on deck · ${onShip} raiders hold the Aegis · ${jets} jets circling · ${d} m`
    }[this.phase] || this.phase;
    return { title: 'AEGIS TAKEOVER', sub };
  }

  /* ---------------- damage ---------------- */

  hurt (a, amount, at) {
    if (!a.alive) return;
    const killed = a.damage(amount, at);
    if (a === this.plane) {
      if (!killed && a.healthFrac < 0.5 && !this._warned) { this._warned = true; this.world.notify('Transport losing systems — keep hitting it'); }
      if (killed) this._destroyPlane();
      return;
    }
    if (killed) {
      obliterate(this.world, a);
      a.dispose();
      this.world.notify('Aegis escort down');
    } else if (a.healthFrac < 0.35 && a.mode !== 'evade') {
      a.mode = 'evade'; a.modeT = 0; a.evadeT = 0;
      this.world.notify(`${a.name} escort damaged — breaking off`);
    } else if (a.mode === 'patrol' || a.mode === 'form') { a.mode = 'attack'; a.modeT = 0; }
  }

  _destroyPlane () {
    const p = this.plane;
    explode(this.world, p);
    this._unpark();
    // anyone still in the hold falls out
    let fell = 0;
    for (const r of this.raiders) if (r.aboard) { this._eject(r); fell++; }
    this.world.notify(fell ? `TRANSPORT DESTROYED — ${fell} raiders fell clear` : 'TRANSPORT DESTROYED');
    this.world.player.stats.crimes++;
    breakApart(this.world, p, this.chunks);
    p.dispose();
    this._setPhase('down');
  }

  _eject (a) {
    const p = this.plane;
    a.aboard = false; a.scripted = false; a.inVehicle = false;
    a.setVisible(true);
    a.pos.set(p.pos.x + rand(-6, 6), p.pos.y + rand(2, 6), p.pos.z + rand(-6, 6));
    a.group.position.copy(a.pos);
    if (a.phys !== 'walk') a.resetPhysics();
    _a.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
    a.launch(_a, rand(6, 14), 0.4, 1.2, 1.1);
  }

  /* ---------------- the boarding party ---------------- */

  _spawnCrew () {
    const diff = this.world.settings.get('crimeDifficulty');
    const crime = this.world.crime.addExternal({ label: 'Aegis boarding party', x: this.site.x, z: this.site.z, persistent: true });
    this.crimes.push(crime);
    for (let i = 0; i < CREW; i++) {
      const e = new Enemy(this.world, this.site.x, this.site.z, rollTier(diff), null);
      e.pos.copy(this.plane.pos); e.group.position.copy(e.pos);
      e.aboard = true; e.inVehicle = true; e.scripted = true;
      e.setVisible(false);
      this.world.crime.attach(crime, e);
      this.raiders.push(e);
      this.world.enemies.push(e);
    }
  }

  /** Down the ramp and off to a station: decks first, then the rooms below. */
  _unloadOne () {
    const r = this.raiders.find(x => x.aboard);
    if (!r) return false;
    const ramp = this._ramp(new THREE.Vector3());
    r.aboard = false; r.inVehicle = false; r.setVisible(true);
    r.pos.set(ramp.x + rand(-1, 1), ramp.y, ramp.z + rand(-1, 1)); r.group.position.copy(r.pos);
    const k = this.unloaded++;
    const ship = this.ship;
    const L = (pt) => [ship.x + pt[0], ship.z + pt[1]];
    if (k < LOWER_POSTS.length) {
      const post = LOWER_POSTS[k];
      this._walk(r, [L(post)], 3.2, (e) => this._station(e, LOWER_POSTS, ship.deck, k));
    } else if (k < LOWER_POSTS.length + UPPER_POSTS.length) {
      const i = k - LOWER_POSTS.length, post = UPPER_POSTS[i];
      this._walk(r, [...TO_UPPER, post].map(L), 3.2, (e) => this._station(e, UPPER_POSTS, ship.upperDeck, i));
    } else {
      const room = ROOMS[(k - LOWER_POSTS.length - UPPER_POSTS.length) % ROOMS.length];
      this._walk(r, TO_LIFT.map(L), 3.2, (e) => {
        // the lift: down to headquarters
        e.pos.set(ship.x, ship.floor, ship.z + 100); e.group.position.copy(e.pos);
        this.world.effects.burst(e.pos, '#8fe7ff', 8, 4, 0.3, 0.3, { grav: -2 });
        this._walk(e, [...FROM_LIFT, ...room.path].map(L), 2.6, (f) => this._station(f, [room.post], ship.floor, 0));
      });
    }
    return true;
  }

  /** Arrived: hold this station, shuffling between its posts like any garrison. */
  _station (e, posts, y, index) {
    e.posts = posts.map(([x, z]) => this.local(x, z, y));
    e.postIndex = index;
    e.home.set(e.pos.x, 0, e.pos.z);
    e.state = 'idle';
    e.timer = rand(1, 4);
  }

  /* ---------------- scripted walking ---------------- */

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
      // hurt, thrown, grabbed or killed: the script is over, they fight where they stand
      if (a.dead || a.phys !== 'walk' || !a.scripted || a.health < a.maxHealth) {
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
      a.updateAnim(dt);
      a.setVisible(true);
    }
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

  /** Straight down onto the deck, swinging the nose to the parked heading. */
  _vtolDown (dt) {
    const p = this.plane, spot = this.site, deckY = this.site.y;
    const k = Math.min(1, dt * 1.2);
    p.pos.x += (spot.x - p.pos.x) * k;
    p.pos.z += (spot.z - p.pos.z) * k;
    p.heading += angleDelta(p.heading, this.siteHeading) * k;
    p.pitch += (0 - p.pitch) * k; p.roll += (0 - p.roll) * k;
    p.speed = p.desiredSpeed = 0; p.vel.set(0, 0, 0);
    p.pos.y = Math.max(deckY, p.pos.y - 8 * dt);
    if (p.pos.y > deckY + 1 && Math.random() < dt * 8) this.world.effects.burst(_a.set(p.pos.x + rand(-12, 12), deckY + 0.5, p.pos.z + rand(-12, 12)), '#cfd6e0', 6, 6, 0.7, 0.4, { grav: -3 });
    p.syncMesh();
    return p.pos.y <= deckY + 0.01;
  }

  _flyJet (j, dt, player) {
    j.modeT += dt;
    j.hitFlash = Math.max(0, j.hitFlash - dt);
    j.emitDamageFx(dt);
    j.rollExtra += (0 - j.rollExtra) * Math.min(1, dt * 2);
    const p = this.plane;
    const dShip = this.center.distanceTo(player.pos);
    const dJet = this.center.distanceTo(j.pos);
    const threat = player.suited && !player.downed && dShip < GUARD;

    if (j.mode === 'form') {
      // escorting the transport in; once it starts down, take up the patrol
      if (this.phase !== 'inbound' || !p.alive) { j.mode = 'patrol'; j.modeT = 0; }
      else {
        const s = SLOTS[j.slot], h = p.heading;
        _b.set(p.pos.x + Math.cos(h) * s[0] + Math.sin(h) * s[2], p.pos.y + s[1], p.pos.z - Math.sin(h) * s[0] + Math.cos(h) * s[2]);
        const d = j.steerTo(_b, dt, clamp(SPEED.form + d3(j.pos, _b) * 0.25, 45, 90), 0.7);
        if (d < 40) j.desiredSpeed = p.speed;
        j.integrate(dt);
        return;
      }
    }
    if (j.mode === 'evade') {
      evade(this.world, j, dt, player, this.center, LEASH);
      return;
    }
    if (j.mode === 'patrol' && threat) { j.mode = 'attack'; j.modeT = 0; }
    if ((j.mode === 'attack' || j.mode === 'break') && (dJet > LEASH || (!threat && j.modeT > 6))) { j.mode = 'patrol'; j.modeT = 0; }

    if (j.mode === 'patrol') {
      // round and round the ship, each jet on its own stretch of the circle
      const ang = Math.atan2(j.pos.z - this.center.z, j.pos.x - this.center.x) + 0.55;
      _b.set(this.center.x + Math.cos(ang) * ORBIT_R, this.center.y + ORBIT_H + j.slot * 18, this.center.z + Math.sin(ang) * ORBIT_R);
      j.steerTo(_b, dt, SPEED.form, 0.8);
      j.integrate(dt);
      return;
    }
    if (j.mode === 'attack') attackRun(this.world, j, dt, player);
    else if (j.mode === 'break') breakOff(this.world, j, dt, player);
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

  /* ---------------- update ---------------- */

  update (dt, ctx) {
    this.t += dt; this.phaseT += dt;
    const p = this.plane, player = this.world.player;
    if (p.alive) {
      p.hitFlash = Math.max(0, p.hitFlash - dt);
      p.emitDamageFx(dt);
      ram(this.world, p, player);
      this._gun(dt, player);
    }
    for (const j of this.jets) if (j.alive) { this._flyJet(j, dt, player); ram(this.world, j, player); }

    switch (this.phase) {
      case 'inbound': {
        const d = this._flyTo(this.site, this.site.y + HOVER + 20, dt);
        if (d < 30) { this._setPhase('landing'); p.setGear(true); this.world.notify('Transport over the Aegis flight deck — coming down'); }
        break;
      }
      case 'landing':
        if (this._vtolDown(dt)) {
          this._park();
          this._spawnCrew();
          this._setPhase('unloading');
          this.unloadT = 1.5;
          this.world.notify('Transport down on the Aegis — boarding party coming out');
        }
        break;
      case 'unloading':
        this.unloadT -= dt;
        if (this.unloadT <= 0) {
          this.unloadT = 1.1;
          if (!this._unloadOne()) { this._setPhase('occupied'); this.world.notify('The Aegis is in enemy hands'); }
        }
        break;
      case 'occupied':
      case 'down':
        break;
    }
    // aboard: hidden, riding along
    if (p.alive) for (const r of this.raiders) if (r.aboard) { r.pos.copy(p.pos); r.group.position.copy(r.pos); }
    this._updateWalkers(dt);
    updateChunks(this.world, this.chunks, dt);
    for (let i = this.crimes.length - 1; i >= 0; i--) if (!this.world.crime.crimes.includes(this.crimes[i])) this.crimes.splice(i, 1);

    // transport, escorts and boarding party all down: the ship is yours again
    if (!this.cleared && !p.alive && !this.jets.some(j => j.alive) && !this._living().length) {
      this.cleared = true;
      this.world.notify('AEGIS TAKEOVER — SHIP RETAKEN');
    }
    if (this.cleared && !this.chunks.length) this.finished = true;
  }

  end (hard) {
    for (const a of this.aircraft) if (a.alive) { if (a === this.plane) this._unpark(); a.alive = false; a.dispose(); }
    clearChunks(this.world, this.chunks);
    for (const w of this.walkers) this._endWalk(w, false);
    this.walkers.length = 0;
    if (hard) {
      for (const c of this.crimes) this.world.crime.removeCrime(c);
      this.crimes.length = 0;
      for (const e of this.raiders) { const k = this.world.enemies.indexOf(e); if (k >= 0) { this.world.enemies.splice(k, 1); e.dispose(); } }
      this.raiders.length = 0;
    } else {
      for (const r of this.raiders) if (r.aboard) this._eject(r);
    }
    this.finished = true;
  }
}

function d3 (a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function compassName (x, z) {
  const ang = Math.atan2(x, -z);
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8];
}
