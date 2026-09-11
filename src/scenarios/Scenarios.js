import * as THREE from 'three';
import { Aircraft } from './Aircraft.js';
import { Enemy, rollTier } from '../ai/Enemy.js';
import { CarrierGarrison } from './Carrier.js';
import { AirliftRaid } from './Raid.js';
import { AegisTakeover } from './Takeover.js';
import { attackRun, breakOff, evade, gun, burst, ram, explode, obliterate, breakApart, updateChunks, clearChunks, SPEED } from './JetAI.js';
import { clamp, rand, randInt, pick, angleDelta } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * Battle scenarios. Hold M for the selector; a number key launches one.
 *
 * Sky Convoy: a Titan 60 airlifter crosses the map under escort from three
 * Atlas 42s, dropping paratroopers over land. Every aircraft takes sustained
 * damage to bring down, and its weapon systems degrade as it does; an escort
 * that is badly hurt stops attacking and flies evasively. The transport
 * breaks into large falling sections when it dies.
 *
 * Airlift Raid lives in Raid.js, Aegis Takeover in Takeover.js. Drive-by is
 * the crime system's own pursuit crime, raised on demand near the hero.
 *
 * A scenario reports `cleared` once its objective readout should go away and
 * `finished` once it has nothing left to animate (burning wreckage, say); the
 * manager keeps a cleared scenario ticking in the background until then.
 */
export const SCENARIOS = [
  {
    id: 'convoy', name: 'Sky Convoy', key: '1',
    desc: 'A Titan 60 airlifter and three Atlas 42 escorts sweep in from the sea, dropping paratroopers over the city. Bring the transport down.',
    create: (world, def) => new ConvoyScenario(world, def)
  },
  {
    id: 'raid', name: 'Airlift Raid', key: '2',
    desc: 'A Titan 60 lands on a city street, its crew drags civilians aboard, and it ferries them to the Aeris Tower helipad — again and again. Bring it down; anyone aboard falls clear.',
    create: (world, def) => new AirliftRaid(world, def)
  },
  {
    id: 'driveby', name: 'Drive-by', key: '3',
    desc: 'A gunman takes a car on a street near you and tears round the city shooting out of the window. Stop the car — touch it and the driver bails out to fight on foot.',
    create: (world, def) => new DriveByScenario(world, def)
  },
  {
    id: 'takeover', name: 'Aegis Takeover', key: '4',
    desc: 'A Titan 60 puts down on the Aegis helicarrier\'s flight deck under a three-jet escort; its boarding party spreads over the decks and down into headquarters while the jets circle the ship. Retake it.',
    create: (world, def) => new AegisTakeover(world, def)
  }
];

export class Scenarios {
  constructor (world) {
    this.world = world;
    this.active = null;         // the running scenario
    this.fading = [];           // cleared scenarios still animating their wreckage
    this.selectorOpen = false;
    // the carrier's standing garrison is always there, scenario or not
    this.garrison = new CarrierGarrison(world);
  }

  get list () { return SCENARIOS; }

  start (index) {
    const def = SCENARIOS[index];
    if (!def) return;
    if (this.active) this.active.end(true);
    this.active = def.create(this.world, def);
    if (this.active.failed) { this.world.notify(this.active.failed); this.active = null; return; }
    this.world.notify(`${def.name.toUpperCase()} — ${this.active.startMessage || `contacts inbound from the ${this.active.approachName}`}`);
  }

  abort () {
    if (!this.active) return;
    this.active.end(true);
    this.active = null;
    this.world.notify('Scenario aborted');
  }

  setSelectorVisible (v) {
    if (v === this.selectorOpen) return;
    this.selectorOpen = v;
    if (v) this.world.hud.showScenarioMenu(SCENARIOS, this.active?.def.id ?? null);
    else this.world.hud.hideScenarioMenu();
  }

  /** Aircraft that are still in one piece — for the minimap and the hit tests. */
  get targets () {
    const out = this.active ? this.active.aircraft.filter(a => a.alive) : [];
    return this.garrison ? out.concat(this.garrison.targets) : out;
  }

  /** The flying aircraft whose hull contains a point (padded), or null. */
  hitTest (p, pad = 0) {
    for (const a of this.targets) if (a.containsPoint(p, pad)) return a;
    return null;
  }

  /** Nearest aircraft along a ray, as { dist, target }, or null. */
  rayHit (origin, dir, maxDist) {
    let best = null;
    for (const a of this.targets) {
      const t = a.rayHit(origin, dir, maxDist);
      if (t !== null && (!best || t < best.dist)) best = { dist: t, target: a };
    }
    return best;
  }

  /** Damage bus hook: every power that hurts an actor can hurt a plane. */
  applyImpact (center, radius, o) {
    let hits = 0;
    const dmg = (o.vehicleDamage ?? o.damage ?? 0) * 1.1 + (o.knock ?? 0) * 1.5;
    if (dmg <= 0) return 0;
    for (const a of this.targets) {
      if (!a.containsPoint(center, radius)) continue;
      a.owner.hurt(a, dmg, center);
      hits++;
    }
    if (hits) this.world.audio?.engage();
    return hits;
  }

  update (dt, ctx) {
    this.garrison?.update(dt, ctx);
    for (let i = this.fading.length - 1; i >= 0; i--) {
      this.fading[i].update(dt, ctx);
      if (this.fading[i].finished) this.fading.splice(i, 1);
    }
    if (!this.active) return;
    this.active.update(dt, ctx);
    if (this.active.finished) this.active = null;
    else if (this.active.cleared) { this.fading.push(this.active); this.active = null; }
  }

  status () { return this.active ? this.active.status() : null; }
}

/* ================================================================== *
 *  Sky Convoy
 * ================================================================== */

const CRUISE = 330;             // transport altitude above sea level
const LEASH = 650;              // escorts never range further than this from the transport
const SLOTS = [[-110, 28, -80], [110, 28, -80], [0, 55, -170]];   // escort formation: right, up, back
const STICK_INTERVAL = 16;      // seconds between squads
const STICK_SIZE = [2, 4];      // troopers per squad
const MAX_TROOPS = 14;
const DROP_RANGE = 1000;        // squads are only released this close to the hero…
const DROP_PATIENCE = 45;       // …unless it has been this long since the last one
const TOWER = { x: -2090, z: -180, keepOut: 650 };

class ConvoyScenario {
  constructor (world, def) {
    this.world = world;
    this.def = def;
    this.t = 0;
    this.finished = false;
    this.cleared = false;         // objective met: readout goes away, wreckage keeps burning
    this.phase = 'inbound';       // inbound | patrol | collapse | done
    this.aircraft = [];
    this.chunks = [];
    this.troops = [];             // paratroopers still descending
    this.enemies = [];            // every enemy this scenario spawned
    this.dropT = 8;
    this.sinceDrop = 0;
    this.stick = null;            // the squad currently going out of the ramp
    this.crimes = [];             // one crime per squad, for markers and the objective readout
    this.kills = 0;

    // the fleet comes in from open water in a random compass direction
    const map = world.city;
    const center = { x: -190, z: 200 };
    const ang = Math.random() * Math.PI * 2;
    const dir = { x: Math.sin(ang), z: Math.cos(ang) };
    this.approachName = compassName(-dir.x, -dir.z);
    const spawnX = center.x + dir.x * 4300, spawnZ = center.z + dir.z * 4300;
    const heading = Math.atan2(-dir.x, -dir.z);

    this.transport = new Aircraft(world, 'titan');
    this.transport.owner = this;
    this.transport.pos.set(spawnX, CRUISE, spawnZ);
    this.transport.heading = heading;
    this.transport.speed = this.transport.desiredSpeed = SPEED.transport;
    this.transport.syncMesh();
    this.aircraft.push(this.transport);

    this.escorts = [];
    for (let i = 0; i < 3; i++) {
      const e = new Aircraft(world, 'atlas');
      e.owner = this;
      const s = SLOTS[i];
      e.pos.set(spawnX + Math.cos(heading) * s[0] + Math.sin(heading) * s[2], CRUISE + s[1], spawnZ - Math.sin(heading) * s[0] + Math.cos(heading) * s[2]);
      e.heading = heading;
      e.speed = e.desiredSpeed = SPEED.transport;
      e.slot = i; e.mode = 'form'; e.modeT = 0; e.gunT = rand(1, 3); e.burstLeft = 0; e.jink = 1; e.rollT = 0; e.evadeT = 0;
      e.syncMesh();
      this.aircraft.push(e); this.escorts.push(e);
    }
    this.transport.gunT = 2;
    this.transport.burstLeft = 0;

    // a patrol route over land, kept clear of the tallest tower
    this.route = this._buildRoute(center, dir);
    this.wp = 0;
    this.detour = null;           // a leg bent toward the hero, so the fight comes to you
  }

  _buildRoute (center, dir) {
    const roads = this.world.roads;
    const pts = [];
    // first leg: the nearest junction to the point the fleet crosses the coast
    const entry = roads.nearestNode(center.x + dir.x * 1400, center.z + dir.z * 1400);
    pts.push(new THREE.Vector3(entry.x, 0, entry.z));
    let last = pts[0];
    for (let i = 0; i < 9; i++) {
      let best = null;
      for (let t = 0; t < 30; t++) {
        const n = roads.randomNode();
        const d = Math.hypot(n.x - last.x, n.z - last.z);
        if (d < 900 || d > 2600) continue;
        if (Math.hypot(n.x - TOWER.x, n.z - TOWER.z) < TOWER.keepOut) continue;
        best = n; break;
      }
      if (!best) best = roads.randomNode();
      last = new THREE.Vector3(best.x, 0, best.z);
      pts.push(last);
    }
    return pts;
  }

  status () {
    if (this.cleared) return null;
    const alive = this.escorts.filter(e => e.alive).length;
    const troops = this.crimes.reduce((n, c) => n + c.enemies.filter(e => !e.dead).length, 0);
    if (this.phase === 'collapse' || this.phase === 'done') return { title: 'SKY CONVOY — TRANSPORT DOWN', sub: `escorts ${alive} left · ${troops} paratroopers still active` };
    const t = this.transport;
    return {
      title: 'SKY CONVOY',
      sub: `transport ${Math.round(t.healthFrac * 100)}% (${t.weapon.label}) · escorts ${alive}/3 · ${troops} paratroopers · ${Math.round(t.pos.distanceTo(this.world.player.pos))} m`
    };
  }

  /* ---------------- damage ---------------- */

  hurt (a, amount, at) {
    if (!a.alive) return;
    const killed = a.damage(amount, at);
    if (a !== this.transport) {
      // an escort that is hurt turns to face the fight; badly hurt, it runs
      if (a.mode === 'form') { a.mode = 'attack'; a.modeT = 0; }
      if (a.healthFrac < 0.35 && a.mode !== 'evade') { a.mode = 'evade'; a.modeT = 0; a.evadeT = 0; this.world.notify(`${a.name} escort damaged — breaking off`); }
    } else if (a.healthFrac < 0.5 && !this._warned) {
      this._warned = true;
      this.world.notify('Transport losing systems — keep hitting it');
    }
    if (killed) this._destroy(a);
  }

  _destroy (a) {
    if (a !== this.transport) {
      // an escort is blown to pieces where it flies; only the transport falls
      obliterate(this.world, a);
      this.world.notify('Escort down');
      a.dispose();
      return;
    }
    explode(this.world, a);
    {
      this.world.notify('TRANSPORT DESTROYED — escorts turning on you');
      this.phase = 'collapse';
      this.world.player.stats.crimes++;
      // nothing left to guard: the escorts come for whoever did it
      for (const e of this.escorts) if (e.alive && e.mode !== 'evade') { e.mode = 'attack'; e.modeT = 0; }
    }
    breakApart(this.world, a, this.chunks);
    a.dispose();
  }

  /* ---------------- update ---------------- */

  update (dt, ctx) {
    this.t += dt;
    const player = this.world.player;
    if (this.transport.alive) {
      this._flyTransport(dt);
      this._transportGun(dt, player);
      this._drops(dt);
      this.transport.emitDamageFx(dt);
      this.transport.hitFlash = Math.max(0, this.transport.hitFlash - dt);
    }
    for (const e of this.escorts) if (e.alive) this._flyEscort(e, dt, player);
    this._ramming(player);
    this._paratroopers(dt);
    this._chunks(dt);
    this._cleanupEnemies(dt);

    if (this.phase === 'collapse' && !this.escorts.some(e => e.alive)) this.phase = 'done';
    // the sky is clear and the last paratrooper is down: objective complete
    const troopsLeft = this.troops.length + this.crimes.reduce((n, c) => n + c.enemies.filter(e => !e.dead).length, 0);
    if (this.phase === 'done' && !troopsLeft && !this.cleared) { this.cleared = true; this.world.notify('SKY CONVOY — CLEARED'); }
    if (this.phase === 'done' && !this.chunks.length && !this.troops.length) this.finished = true;
    // if the whole fleet is gone before the transport, the scenario resolves too
    if (this.phase !== 'collapse' && this.phase !== 'done' && !this.transport.alive) this.phase = 'done';
  }

  _flyTransport (dt) {
    const t = this.transport;
    const target = this.detour || this.route[this.wp];
    const map = this.world.city;
    // altitude: cruise, but climb over whatever is ahead
    t.forward(_a);
    const ahead = map.groundHeight(t.pos.x + _a.x * 320, t.pos.z + _a.z * 320);
    const here = map.groundHeight(t.pos.x, t.pos.z);
    const want = Math.max(CRUISE, ahead + 110, here + 90);
    _b.set(target.x, want, target.z);
    const d = t.steerTo(_b, dt, SPEED.transport);
    if (d < 260) {
      if (this.phase === 'inbound') { this.phase = 'patrol'; this.sinceDrop = 0; }
      if (this.detour) { this.detour = null; this.wp = (this.wp + 1) % this.route.length; }
      else {
        // every other leg bends toward wherever the hero is, if that is over land
        const p = this.world.player.pos;
        if (Math.random() < 0.6 && !map.isWater(p.x, p.z)) {
          const a = Math.random() * Math.PI * 2, r = rand(150, 450);
          this.detour = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        } else this.wp = (this.wp + 1) % this.route.length;
      }
    }
    t.integrate(dt);
  }

  _transportGun (dt, player) {
    const t = this.transport;
    const w = t.weapon;
    t.gunT -= dt * w.rate;
    if (t.gunT > 0) return;
    const d = t.pos.distanceTo(player.pos);
    if (d > 300 || !player.suited) { t.gunT = 0.5; return; }
    t.gunT = 2.4;
    const muzzle = t.group.localToWorld(_a.set(0, 7.5, -22));
    burst(this.world, t, muzzle, player, w, 7);
  }

  _flyEscort (e, dt, player) {
    e.modeT += dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.emitDamageFx(dt);
    const map = this.world.city;
    const t = this.transport;
    const dp = e.pos.distanceTo(player.pos);
    const dT = t.alive ? e.pos.distanceTo(t.pos) : 0;
    // a threat is the hero anywhere near the transport; escorts guard it, they
    // don't hunt — until the transport is gone, when the hero is the mission
    const threat = player.suited && !player.downed && (!t.alive || t.pos.distanceTo(player.pos) < LEASH);
    // leash: whatever an escort is doing, it comes back if it has strayed
    if (t.alive && dT > LEASH && (e.mode === 'attack' || e.mode === 'break')) { e.mode = 'form'; e.modeT = 0; }

    // aerobatics decay back to level
    e.rollExtra += (0 - e.rollExtra) * Math.min(1, dt * 2);

    if (e.mode === 'leave') {
      // out to sea the way it came, then gone
      _b.set(e.pos.x + Math.sin(e.heading) * 1000, CRUISE + 120, e.pos.z + Math.cos(e.heading) * 1000);
      e.steerTo(_b, dt, SPEED.leave, 0.5);
      e.integrate(dt);
      if (Math.hypot(e.pos.x + 190, e.pos.z - 200) > 4600) { e.alive = false; e.dispose(); }
      return;
    }
    if (e.mode === 'evade') {
      // hurt escorts keep their distance but stay in the fight: bent back
      // toward the transport while it flies, toward the hero once it is gone
      evade(this.world, e, dt, player, t.alive ? t.pos : player.pos, LEASH);
      return;
    }
    if (e.mode === 'form' && threat && dT < LEASH * 0.7) { e.mode = 'attack'; e.modeT = 0; }
    if (e.mode === 'attack' && !threat && e.modeT > 6) { e.mode = 'form'; e.modeT = 0; }

    if (!t.alive && e.mode === 'form') {
      // transport down and the hero out of sight: circle high over where
      // they were last seen until they show themselves again
      const ang = this.t * 0.28 + e.slot * 2.1;
      _b.set(player.pos.x + Math.cos(ang) * 380, Math.max(player.pos.y + 160, map.groundHeight(player.pos.x, player.pos.z) + 200), player.pos.z + Math.sin(ang) * 380);
      e.steerTo(_b, dt, SPEED.form, 0.6);
      e.integrate(dt);
      return;
    }
    if (e.mode === 'form') {
      const s = SLOTS[e.slot];
      const h = t.alive ? t.heading : e.heading;
      const base = t.alive ? t.pos : e.pos;
      _b.set(base.x + Math.cos(h) * s[0] + Math.sin(h) * s[2], base.y + s[1], base.z - Math.sin(h) * s[0] + Math.cos(h) * s[2]);
      const d = e.steerTo(_b, dt, clamp(SPEED.form + d3(e.pos, _b) * 0.25, 45, 90), 0.7);
      // hold station: match the transport's speed once in the slot
      if (d < 40) e.desiredSpeed = t.alive ? t.speed : SPEED.form;
      e.integrate(dt);
      return;
    }

    if (e.mode === 'attack') attackRun(this.world, e, dt, player);
    else if (e.mode === 'break') breakOff(this.world, e, dt, player);
  }

  _ramming (player) {
    for (const a of this.aircraft) if (ram(this.world, a, player)) break;
  }

  /* ---------------- paratroopers ---------------- */

  /**
   * Squads go out of the ramp a man a second, each squad a crime of its own
   * so it gets a marker and shows in the objective readout. A squad is only
   * released within range of the hero — unless the transport has been away
   * so long that the map deserves some trouble regardless.
   */
  _drops (dt) {
    const t = this.transport, map = this.world.city;
    this.dropT -= dt;
    this.sinceDrop += dt;
    if (this.stick) {
      this.stick.nextT -= dt;
      if (this.stick.nextT <= 0 && !map.isWater(t.pos.x, t.pos.z)) {
        this._dropOne(this.stick.crime);
        this.stick.nextT = 1.0;
        if (--this.stick.left <= 0) this.stick = null;
      }
      return;
    }
    if (this.dropT > 0 || this.phase !== 'patrol') return;
    const live = this.crimes.reduce((n, c) => n + c.enemies.filter(e => !e.dead).length, 0);
    if (map.isWater(t.pos.x, t.pos.z) || live >= MAX_TROOPS) { this.dropT = 1; return; }
    const near = t.pos.distanceTo(this.world.player.pos) < DROP_RANGE;
    if (!near && this.sinceDrop < DROP_PATIENCE) { this.dropT = 1; return; }
    this.dropT = STICK_INTERVAL * rand(0.8, 1.3);
    this.sinceDrop = 0;
    const size = Math.min(randInt(STICK_SIZE[0], STICK_SIZE[1]), MAX_TROOPS - live);
    const crime = this.world.crime.addExternal({ label: 'Paratrooper squad', x: t.pos.x, z: t.pos.z });
    this.crimes.push(crime);
    this.stick = { crime, left: size, nextT: 0 };
    this.world.notify('Paratroopers away');
  }

  _dropOne (crime) {
    const t = this.transport;
    // dropped from the ramp, so from behind and below the airframe
    t.forward(_a);
    const x = t.pos.x - _a.x * 14 + rand(-3, 3), z = t.pos.z - _a.z * 14 + rand(-3, 3);
    const tier = rollTier(this.world.settings.get('crimeDifficulty'));
    const e = new Enemy(this.world, x, z, tier, null);
    e.pos.set(x, t.pos.y - 7, z);
    e.group.position.copy(e.pos);
    e.parachuting = true;
    e.home.set(x, 0, z);
    e.scenario = this;
    this.world.crime.attach(crime, e);
    const canopy = makeCanopy(this.world);
    this.world.scene.add(canopy);
    this.troops.push({ e, canopy, vy: -2, vx: t.vel.x * 0.5, vz: t.vel.z * 0.5, wind: rand(-1.5, 1.5), windZ: rand(-1.5, 1.5), open: 0, sway: rand(0, 6) });
    this.enemies.push(e);
    this.world.enemies.push(e);
    this.world.effects.burst(e.pos, '#dfe6ea', 6, 3, 0.4, 0.5, { grav: -2 });
  }

  _paratroopers (dt) {
    const map = this.world.city;
    for (let i = this.troops.length - 1; i >= 0; i--) {
      const p = this.troops[i], e = p.e;
      // dead, grabbed, shoved or ragdolling: the parachute is finished with
      if (e.dead || e.phys !== 'walk' || !e.parachuting) {
        e.parachuting = false;
        this._releaseCanopy(p);
        this.troops.splice(i, 1);
        this.world.effects.burst(e.pos, '#dfe6ea', 8, 4, 0.4, 0.4, { grav: -2 });
        continue;
      }
      p.open = Math.min(1, p.open + dt * 0.7);
      p.sway += dt;
      // the canopy opens over a second and slows the fall to a steady drift
      const targetVy = -7.5 * p.open - 20 * (1 - p.open);
      p.vy += (targetVy - p.vy) * Math.min(1, dt * 2.5);
      p.vx += (p.wind - p.vx) * Math.min(1, dt * 0.8);
      p.vz += (p.windZ - p.vz) * Math.min(1, dt * 0.8);
      e.pos.x += p.vx * dt; e.pos.z += p.vz * dt; e.pos.y += p.vy * dt;
      e.heading = Math.atan2(p.vx, p.vz);
      e.group.position.copy(e.pos);
      e.group.rotation.set(0, e.heading, 0);
      e.setVisible(true);
      const sx = Math.sin(p.sway * 1.3) * 0.12, sz = Math.cos(p.sway * 0.9) * 0.12;
      p.canopy.position.set(e.pos.x + sx * 4, e.pos.y + 5.6, e.pos.z + sz * 4);
      p.canopy.rotation.set(sz, e.heading, -sx);
      p.canopy.scale.setScalar(0.25 + 0.75 * p.open);
      const g = map.groundHeight(e.pos.x, e.pos.z, e.pos.y + 1);
      if (e.pos.y <= g) {
        e.pos.y = g;
        e.parachuting = false;
        e.home.set(e.pos.x, 0, e.pos.z);
        e.state = 'chase';
        e.awareness = 0.6;
        e.group.position.copy(e.pos);
        this._releaseCanopy(p);
        this.troops.splice(i, 1);
        this.world.effects.burst(e.pos, '#c9d3de', 8, 4, 0.3, 0.3, { grav: -8 });
        for (const a of this.world.peds) if (a.pos.distanceTo(e.pos) < 30) a.panic?.(e.pos, 1);
        if (map.isWater(e.pos.x, e.pos.z)) { /* landed in the sea: the actor's water logic takes over */ }
      }
    }
  }

  _releaseCanopy (p) {
    // the canopy drifts down on its own and is gone in a couple of seconds
    const c = p.canopy;
    const drop = { c, t: 0 };
    (this.canopies ||= []).push(drop);
  }

  /* ---------------- falling wreckage ---------------- */

  _chunks (dt) {
    updateChunks(this.world, this.chunks, dt);
    // released canopies flutter down and fade
    if (this.canopies) {
      for (let i = this.canopies.length - 1; i >= 0; i--) {
        const d = this.canopies[i];
        d.t += dt;
        d.c.position.y -= 3 * dt;
        d.c.rotation.z += dt * 0.6;
        d.c.scale.multiplyScalar(Math.pow(0.5, dt));
        if (d.t > 2.2) { this.world.scene.remove(d.c); this.canopies.splice(i, 1); }
      }
    }
  }

  _cleanupEnemies (dt) {
    // the crime system owns the squads now: it clears a resolved or expired
    // squad itself, so just forget the ones it has removed
    for (let i = this.crimes.length - 1; i >= 0; i--) {
      if (!this.world.crime.crimes.includes(this.crimes[i])) this.crimes.splice(i, 1);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.world.enemies.includes(this.enemies[i])) this.enemies.splice(i, 1);
    }
  }

  /** Tear everything down (abort or replacement). */
  end (hard) {
    for (const a of this.aircraft) if (a.alive) { a.alive = false; a.dispose(); }
    clearChunks(this.world, this.chunks);
    for (const p of this.troops) this.world.scene.remove(p.canopy);
    this.troops.length = 0;
    for (const d of this.canopies || []) this.world.scene.remove(d.c);
    if (hard) {
      for (const c of this.crimes) this.world.crime.removeCrime(c);
      this.crimes.length = 0;
      this.enemies.length = 0;
    }
    this.finished = true;
  }
}

/* ================================================================== *
 *  Drive-by
 * ================================================================== */

/**
 * The crime system's pursuit crime, started on purpose: a gunman on a street
 * a few blocks from the hero steals the nearest car and goes on a shooting
 * run. The crime system runs it exactly as it runs a random one — the marker
 * follows the car, any interference makes the driver bail out — and the
 * scenario only watches for the crime to resolve.
 */
class DriveByScenario {
  constructor (world, def) {
    this.world = world;
    this.def = def;
    this.aircraft = [];
    this.finished = false;
    this.cleared = false;
    this.crime = null;
    const p = world.player.pos, roads = world.roads, traffic = world.traffic, crime = world.crime;
    // a street a few blocks away with a car on it to take — spawnNear picks a
    // footway in that cell, and the pursuit looks 220 m around it for a car
    for (let t = 0; t < 24 && !this.crime; t++) {
      const lp = roads.randomLanePoint(p.x, p.z, t < 16 ? 160 : 60, t < 16 ? 380 : 700);
      if (!lp || lp.edge.cls === 'bridge' || lp.edge.cls === 'ramp' || lp.edge.cls === 'viaduct') continue;
      if (world.city.covered(lp.x, lp.z, lp.y)) continue;
      const car = traffic.nearest(_a.set(lp.x, lp.y, lp.z), 160, x => x.driver === 'npc' && !x.destroyed && (x.state === 'drive' || x.state === 'parked'));
      if (!car && t < 20) continue;
      const c = crime.spawnNear(lp.x, lp.z, 'pursuit');
      if (c) { c.scenario = this; this.crime = c; }
    }
    if (!this.crime) { this.failed = 'DRIVE-BY — no street nearby to start it on'; this.finished = true; return; }
    const d = Math.round(this.crime.pos.distanceTo(p));
    this.startMessage = this.crime.vehicle ? `gunman took a car ${d} m ${compassName(this.crime.pos.x - p.x, this.crime.pos.z - p.z)} of you` : `gunman ${d} m ${compassName(this.crime.pos.x - p.x, this.crime.pos.z - p.z)} of you, looking for a car`;
  }

  status () {
    const c = this.crime;
    if (!c || this.cleared) return null;
    const d = Math.round(c.pos.distanceTo(this.world.player.pos));
    const driver = c.driver && !c.driver.dead;
    const sub = c.vehicle ? `car on the move · ${d} m · stop it any way you like`
      : driver ? `driver bailed out — ${c.enemies.filter(e => !e.dead).length} on foot · ${d} m`
        : `${c.enemies.filter(e => !e.dead).length} on foot · ${d} m`;
    return { title: 'DRIVE-BY', sub };
  }

  update () {
    const c = this.crime;
    if (!c) { this.finished = true; return; }
    // resolved (or expired, if the hero ignored it) — the crime system fades it out
    if (c.state !== 'active' || !this.world.crime.crimes.includes(c)) {
      if (!this.cleared) { this.cleared = true; if (c.state === 'resolved') this.world.notify('DRIVE-BY — STOPPED'); }
      this.finished = true;
    }
  }

  end (hard) {
    if (hard && this.crime && this.world.crime.crimes.includes(this.crime)) this.world.crime.removeCrime(this.crime);
    this.finished = true;
  }
}

function d3 (a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function compassName (x, z) {
  // world +Z is south, -Z north
  const ang = Math.atan2(x, -z);          // 0 = north, clockwise
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8];
}

let _canopyGeo = null, _canopyMat = null, _lineMat = null;
function makeCanopy (world) {
  if (!_canopyGeo) {
    _canopyGeo = new THREE.SphereGeometry(3.4, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
    _canopyMat = new THREE.MeshStandardMaterial({ color: 0x6d7a62, roughness: 0.9, side: THREE.DoubleSide });
    _lineMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  }
  const g = new THREE.Group();
  const dome = new THREE.Mesh(_canopyGeo, _canopyMat);
  dome.castShadow = true;
  g.add(dome);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 6 * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t) * 3.3, 0.8, Math.sin(t) * 3.3), new THREE.Vector3(0, -5.2, 0));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), _lineMat));
  return g;
}
