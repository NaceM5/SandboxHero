import * as THREE from 'three';
import { Enemy, rollTier, TIERS } from './Enemy.js';
import { CITY, blockCenter } from '../world/RoadNetwork.js';
import { Noise, rand, randInt, clamp, pick } from '../core/Util.js';

const _shot = new THREE.Vector3(), _shot2 = new THREE.Vector3();

const CRIME_TYPES = [
  { id: 'mugging',    label: 'Mugging',            min: 1, max: 2, victim: true },
  { id: 'robbery',    label: 'Armed robbery',      min: 2, max: 4, victim: true },
  { id: 'carjacking', label: 'Carjacking',         min: 1, max: 3, victim: false, hijack: true },
  { id: 'gangwar',    label: 'Gang shootout',      min: 3, max: 6, victim: false },
  { id: 'shakedown',  label: 'Extortion in progress', min: 2, max: 3, victim: true },
  // Needs a road under it and a car to steal, so it never runs at the fixed
  // sites out on the water or up a tower.
  { id: 'pursuit',    label: 'Drive-by in progress', min: 1, max: 1, victim: false,
    pursuit: true, roadOnly: true }
];

/**
 * Crime is distributed over a static density field rather than spawned
 * around the player: hot blocks downtown, quieter ones on the fringe. The
 * sandbox sliders scale the field's amplitude and the enemy-tier roll.
 */
export class CrimeSystem {
  constructor (world) {
    this.world = world;
    this.noise = new Noise(778812);
    this.crimes = [];
    this.spawnTimer = 4;
    this.resolved = 0;
    this.nextId = 1;

    this.density = new Float32Array(CITY.BLOCKS * CITY.BLOCKS);
    this._buildDensity();

    // shared marker assets
    this.beamGeo = new THREE.CylinderGeometry(0.9, 1.9, 80, 14, 1, true);
    this.beamGeo.translate(0, 40, 0);
    this.ringGeo = new THREE.RingGeometry(3.2, 4.0, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  _buildDensity () {
    const B = CITY.BLOCKS;
    let max = 0;
    for (let j = 0; j < B; j++) {
      for (let i = 0; i < B; i++) {
        const c = blockCenter(i, j);
        const zone = this.world.city.zoneAt(c.x, c.z);
        const n = this.noise.fbm(c.x * 0.0035 + 3.1, c.z * 0.0035 - 1.7, 4);
        const n2 = this.noise.fbm(c.x * 0.011, c.z * 0.011, 3);
        // hot spots cluster; downtown is busier but the rough edges of the
        // map get their own pockets so the whole city has something going on
        let v = Math.pow(n, 2.1) * 1.35 + n2 * 0.35 + zone * 0.30;
        v = Math.max(0, v - 0.18);
        this.density[j * B + i] = v;
        if (v > max) max = v;
      }
    }
    for (let k = 0; k < this.density.length; k++) this.density[k] /= (max || 1);
  }

  densityAt (x, z) {
    const B = CITY.BLOCKS;
    const bi = clamp(Math.round(x / CITY.CELL + (B - 1) / 2), 0, B - 1);
    const bj = clamp(Math.round(z / CITY.CELL + (B - 1) / 2), 0, B - 1);
    return this.density[bj * B + bi];
  }

  _pickCell () {
    const B = CITY.BLOCKS;
    const s = this.world.settings;
    const amp = s.get('crimeDensity');
    let total = 0;
    const w = [];
    for (let k = 0; k < this.density.length; k++) {
      const d = Math.pow(this.density[k], 1 + (1 - amp) * 2.6);
      w.push(d); total += d;
    }
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let k = 0; k < w.length; k++) {
      r -= w[k];
      if (r <= 0) return { bi: k % B, bj: Math.floor(k / B), d: this.density[k] };
    }
    return null;
  }

  update (dt, ctx) {
    const s = this.world.settings;
    const amp = s.get('crimeDensity');
    const maxActive = Math.round(s.get('maxActiveCrimes') * clamp(amp * 1.6, 0.15, 1.6));

    if (amp > 0.001) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const base = s.get('crimeInterval');
        this.spawnTimer = base / clamp(amp * 2.2, 0.12, 3) * rand(0.65, 1.4);
        if (this.crimes.length < maxActive) this.spawn();
      }
    }

    for (let i = this.crimes.length - 1; i >= 0; i--) {
      const c = this.crimes[i];
      this._updateCrime(c, dt, ctx);
      if (c.remove) { this._destroy(c); this.crimes.splice(i, 1); }
    }
  }

  /* ---------------- spawning ---------------- */

  spawnNear (x, z) {
    const B = CITY.BLOCKS;
    const bi = clamp(Math.round(x / CITY.CELL + (B - 1) / 2), 0, B - 1);
    const bj = clamp(Math.round(z / CITY.CELL + (B - 1) / 2), 0, B - 1);
    return this.spawn({ bi, bj, d: this.density[bj * B + bi] });
  }

  /**
   * Places that always have trouble, wherever the density field says.
   *
   * The warship is the busiest — it is a standing arena out in the water that
   * has to be reached by air or by sea. None of them run a pursuit: there is
   * no road out there to drive on.
   */
  _sites () {
    if (this._siteList) return this._siteList;
    const c = this.world.city;
    const out = [];
    if (c.battleship) {
      const B = c.battleship, L = B.len / 2;
      // Stations the length of the ship: forward turret, bow, waist, boat deck,
      // quarterdeck, stern. Spawning everyone in one place put the whole crew
      // amidships on a two-hundred-metre hull.
      const posts = [-0.86, -0.62, -0.3, 0.05, 0.42, 0.78].map(t =>
        new THREE.Vector3(B.x + (Math.random() < 0.5 ? -1 : 1) * rand(0, 7), B.deck, B.z + t * L));
      out.push({ name: 'warship', weight: 3.2, posts,
        pos: new THREE.Vector3(B.x, B.deck, B.z), spread: 8, along: L * 0.86 });
    }
    if (c.carrier) {
      const K = c.carrier, KL = K.len / 2;
      // stations up the flight deck, plus two down in the hangar
      const posts = [
        new THREE.Vector3(K.x - K.deckW * 0.28, K.deck, K.z - KL * 0.72),
        new THREE.Vector3(K.x + K.deckW * 0.20, K.deck, K.z - KL * 0.34),
        new THREE.Vector3(K.x - K.deckW * 0.24, K.deck, K.z + KL * 0.04),
        new THREE.Vector3(K.x + K.deckW * 0.26, K.deck, K.z + KL * 0.44),
        new THREE.Vector3(K.x - K.deckW * 0.18, K.deck, K.z + KL * 0.76),
        new THREE.Vector3(K.x, K.hangar, K.z - KL * 0.3),
        new THREE.Vector3(K.x, K.hangar, K.z + KL * 0.4)
      ];
      out.push({ name: 'carrier', weight: 2.6, posts,
        pos: new THREE.Vector3(K.x, K.deck, K.z), spread: 10, along: KL * 0.8 });
    }
    if (c.penthouse) {
      const P = c.penthouse;
      for (const f of P.floors) {
        // inside, and out on the porch at each corner
        const posts = [
          new THREE.Vector3(P.x - 8, f, P.z - 6),
          new THREE.Vector3(P.x + 8, f, P.z + 6),
          new THREE.Vector3(P.x + P.hw + 3, f, P.z - P.hd - 3),
          new THREE.Vector3(P.x - P.hw - 3, f, P.z + P.hd + 3)
        ];
        out.push({ name: 'penthouse', weight: 0.75, posts,
          pos: new THREE.Vector3(P.x, f, P.z), spread: 9 });
      }
    }
    if (c.mansionDoor) {
      const D = c.mansionDoor;
      const posts = [
        new THREE.Vector3(D.x - 10, D.y, D.z - 22),
        new THREE.Vector3(D.x + 10, D.y, D.z - 22),
        new THREE.Vector3(D.x, D.y, D.z - 6),
        new THREE.Vector3(D.x - 14, D.y, D.z - 34)
      ];
      out.push({ name: 'estate', weight: 0.6, posts,
        pos: new THREE.Vector3(D.x, D.y, D.z - 16), spread: 12 });
    }
    this._siteList = out;
    return out;
  }

  _pickSite () {
    const list = this._sites();
    if (!list.length) return null;
    let total = 0;
    for (const s of list) total += s.weight;
    let r = Math.random() * total;
    for (const s of list) { r -= s.weight; if (r <= 0) return s; }
    return list[0];
  }

  spawn (cell) {
    const s = this.world.settings;
    let px, pz, py = null, site = null, crimePosts = null, postBase = -1;

    // roughly a third of the time, use one of the fixed sites instead
    if (!cell && this._sites().length && Math.random() < 0.34) {
      site = this._pickSite();
      const sp = site.spread, al = site.along ?? sp;
      px = site.pos.x + rand(-sp, sp);
      pz = site.pos.z + rand(-al, al);
      py = site.pos.y;
      crimePosts = site.posts || null;
    } else {
      cell = cell || this._pickCell();
      if (!cell) return null;
      // place it on the sidewalk ring of that block so it's reachable on foot
      const ring = this.world.roads.ringAt(cell.bi, cell.bj);
      if (!ring) return null;                       // that block is river
      const spot = pick(ring);
      px = spot.x + rand(-3, 3); pz = spot.z + rand(-3, 3);
    }
    cell = cell || { d: 0.5 };

    // A fixed site takes neither a pursuit (no road out there) nor a crime
    // with a civilian victim — the estate and the warship are places the crowd
    // has no business being, and spawning a victim would put one there.
    const allowed = site ? CRIME_TYPES.filter(t => !t.roadOnly && !t.victim) : CRIME_TYPES;
    const type = pick(allowed);
    const diff = s.get('crimeDifficulty');
    const mult = s.get('enemiesPerCrime');
    const count = clamp(Math.round(randInt(type.min, type.max) * mult * (0.75 + cell.d * 0.6)), 1, 8);

    const crime = {
      id: this.nextId++,
      type: type.id,
      label: type.label,
      pos: new THREE.Vector3(px, 0, pz),
      enemies: [],
      victim: null,
      alive: 0,
      state: 'active',
      fade: 0,
      timer: 0,
      hijack: !!type.hijack,
      hijackDone: false,
      pursuit: !!type.pursuit,
      site: site ? site.name : null,
      vehicle: null,
      driver: null,
      shootT: 0,
      topTier: 0,
      onEnemyDown: (e) => {
        crime.alive--;
        if (crime.alive <= 0 && crime.state === 'active') {
          crime.state = 'resolved';
          crime.timer = 0;
          this.resolved++;
          this.world.onCrimeResolved?.(crime);
        }
      }
    };

    for (let i = 0; i < count; i++) {
      const tier = rollTier(diff);
      crime.topTier = Math.max(crime.topTier, tier);
      const a = Math.random() * Math.PI * 2, r = rand(1.2, 5.5);
      // At a site, start each of them at a different station — and start each
      // CRIME at a different point in the rota, or several small groups all
      // begin at post zero and the whole crew ends up at the bow.
      if (crimePosts && postBase < 0) postBase = randInt(0, crimePosts.length - 1);
      const st = crimePosts ? crimePosts[(postBase + i) % crimePosts.length] : null;
      const ex = st ? st.x + rand(-3, 3) : px + Math.cos(a) * r;
      const ez = st ? st.z + rand(-3, 3) : pz + Math.sin(a) * r;
      const e = new Enemy(this.world, ex, ez, tier, crime);
      if (crimePosts) { e.posts = crimePosts; e.postIndex = (postBase + i) % crimePosts.length; }
      // a fixed site knows its own floor; anywhere else, take the ground
      const floorY = st ? st.y : py;
      e.pos.y = floorY !== null && floorY !== undefined
        ? this.world.city.groundHeight(e.pos.x, e.pos.z, floorY + 1.4)
        : this.world.city.groundHeight(e.pos.x, e.pos.z);
      e.group.position.copy(e.pos);
      crime.enemies.push(e);
      this.world.enemies.push(e);
    }
    crime.alive = crime.enemies.length;

    if (type.victim) {
      const v = this.world.spawnPedestrian(px + rand(-2.5, 2.5), pz + rand(-2.5, 2.5));
      if (v) { v.panic(crime.pos, 1); v.state = 'cower'; v.timer = 999; crime.victim = v; }
    }

    if (crime.pursuit) this._startPursuit(crime);
    crime.markerY = py;
    this._makeMarker(crime);
    this.crimes.push(crime);
    this.world.onCrimeSpawned?.(crime);
    return crime;
  }

  _makeMarker (crime) {
    const col = new THREE.Color(TIERS[crime.topTier].color);
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.BackSide   // one wall only, so it doesn't double up
    }));
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    }));
    const y = crime.markerY ?? this.world.city.groundHeight(crime.pos.x, crime.pos.z);
    beam.position.set(crime.pos.x, y + 0.1, crime.pos.z);
    ring.position.set(crime.pos.x, y + 0.12, crime.pos.z);
    beam.frustumCulled = false;
    this.world.scene.add(beam, ring);
    crime.marker = { beam, ring, color: col };
    crime.pos.y = y;
  }

  /**
   * Put the driver in a car and send it tearing round the city.
   *
   * The enemy rides hidden inside — their body is parked on the car's position
   * so everything that looks for enemies still finds them — and the moment the
   * car is interfered with in any way at all, they bail out and fight on foot.
   */
  _startPursuit (crime) {
    const traffic = this.world.traffic;
    const driver = crime.enemies.find(e => !e.dead);
    if (!driver) return;
    // A parked car is as good as a moving one to steal, and the search has to
    // reach far enough that a quiet block still has something to take.
    const v = traffic.nearest(crime.pos, 220,
      x => x.driver === 'npc' && !x.destroyed && (x.state === 'drive' || x.state === 'parked'));
    if (!v) { crime.pursuit = false; return; }

    traffic.hijack(v, 'enemy', (veh) => {
      const p = this.world.spawnPedestrian(veh.pos.x + rand(-2, 2), veh.pos.z + rand(-2, 2));
      p?.panic(crime.pos, 1);
    });
    v.disturbed = false;                 // the hijack itself doesn't count
    v.pursuit = crime;
    v.onDisturbed = () => this._ejectDriver(crime);
    crime.vehicle = v;
    crime.driver = driver;
    driver.setVisible(false);
    driver.inVehicle = true;
    this.world.notify('Drive-by in progress — stop the car');
  }

  /** Interfered with: the driver bails out and it becomes an ordinary fight. */
  _ejectDriver (crime) {
    const v = crime.vehicle, d = crime.driver;
    crime.vehicle = null;
    if (v) { v.onDisturbed = null; v.pursuit = null; this.world.traffic.release(v); }
    if (!d || d.dead) return;
    d.inVehicle = false;
    d.setVisible(true);
    d.resetPhysics();
    const px = (v ? v.pos.x : crime.pos.x) + rand(-2.4, 2.4);
    const pz = (v ? v.pos.z : crime.pos.z) + rand(-2.4, 2.4);
    d.pos.set(px, this.world.city.groundHeight(px, pz), pz);
    d.group.position.copy(d.pos);
    d.state = 'chase';
    this.world.effects.burst(d.pos, '#ffd27a', 16, 8, 0.4, 0.4);
    this.world.notify('Driver bailed out');
  }

  /** The car is on the move, so the crime is wherever the car is. */
  _updatePursuit (crime, dt) {
    const v = crime.vehicle;
    if (!v) return;
    if (v.destroyed || v.state === 'wrecked' || v.driver !== 'enemy') { this._ejectDriver(crime); return; }
    const d = crime.driver;
    if (d && !d.dead) {
      d.pos.set(v.pos.x, v.pos.y, v.pos.z);
      d.group.position.copy(d.pos);
    }
    crime.pos.set(v.pos.x, this.world.city.groundHeight(v.pos.x, v.pos.z), v.pos.z);
    if (crime.marker) {
      crime.marker.beam.position.set(crime.pos.x, crime.pos.y + 0.1, crime.pos.z);
      crime.marker.ring.position.set(crime.pos.x, crime.pos.y + 0.12, crime.pos.z);
    }

    // shooting out of the window at whoever is on the pavement
    crime.shootT -= dt;
    if (crime.shootT <= 0) {
      crime.shootT = rand(0.5, 1.1);
      let victim = null, bd = 34;
      for (const a of this.world.peds) {
        if (a.phys !== 'walk') continue;
        const dd = a.pos.distanceTo(v.pos);
        if (dd < bd) { bd = dd; victim = a; }
      }
      const player = this.world.player;
      if (player.pos.distanceTo(v.pos) < 30) victim = player;
      if (victim) {
        const from = _shot.copy(v.pos); from.y += 1.1;
        const to = _shot2.copy(victim.pos); to.y += 1.0;
        // a quick streak of sparks along the line of fire
        const fx = this.world.effects;
        for (let k = 1; k <= 7; k++) {
          const t2 = k / 7;
          fx.particle(
            from.x + (to.x - from.x) * t2, from.y + (to.y - from.y) * t2,
            from.z + (to.z - from.z) * t2,
            0, 0, 0, '#ffd08a', 0.16, 0.09, { drag: 0.6 }
          );
        }
        fx.burst(from, '#ffd08a', 5, 7, 0.22, 0.18);
        if (victim === player) player.takeDamage(6, v.pos);
        else { victim.panic?.(v.pos, 1); victim.anim.flinch = 1; }
        for (const a of this.world.peds) {
          if (a.pos.distanceTo(v.pos) < 26) a.panic?.(v.pos, 1);
        }
      }
    }
  }

  _updateCrime (crime, dt, ctx) {
    crime.timer += dt;
    const m = crime.marker;
    if (m) {
      const pulse = 0.5 + Math.sin(crime.timer * 2.4) * 0.5;
      m.ring.scale.setScalar(1 + pulse * 0.25);
      m.ring.material.opacity = (crime.state === 'active' ? 0.18 + pulse * 0.22 : 0) * (1 - crime.fade);
      m.beam.material.opacity = (crime.state === 'active' ? 0.030 + pulse * 0.035 : 0) * (1 - crime.fade);
    }

    if (crime.pursuit && crime.vehicle) this._updatePursuit(crime, dt);

    // a carjacking crew actually takes a car
    if (crime.hijack && !crime.hijackDone && crime.timer > rand(2, 4)) {
      const traffic = this.world.traffic;
      const v = traffic.nearest(crime.pos, 40, x => x.driver === 'npc' && x.state !== 'player');
      const thief = crime.enemies.find(e => !e.dead);
      if (v && thief) {
        crime.hijackDone = true;
        traffic.hijack(v, 'enemy', (veh) => {
          const p = this.world.spawnPedestrian(veh.pos.x + rand(-2, 2), veh.pos.z + rand(-2, 2));
          p?.panic(crime.pos, 1);
        });
        this.world.notify(`Carjacking — ${TIERS[thief.tier].name} took a vehicle`);
      } else if (crime.timer > 12) crime.hijackDone = true;
    }

    if (crime.state === 'resolved') {
      crime.fade += dt * 0.6;
      if (crime.fade >= 1) {
        if (crime.victim) { crime.victim.state = 'flee'; crime.victim.timer = 4; crime.victim.fleeFrom = crime.pos.clone(); }
        crime.remove = true;
      }
      return;
    }

    // clean up crimes the player has ignored for a long time and is far from
    const dp = this.world.player.pos.distanceTo(crime.pos);
    if (dp > 620 && crime.timer > 150) {
      crime.state = 'expired';
      crime.remove = true;
    }
  }

  _destroy (crime) {
    if (crime.vehicle) {
      crime.vehicle.onDisturbed = null;
      crime.vehicle.pursuit = null;
      this.world.traffic.release(crime.vehicle);
      crime.vehicle = null;
    }
    for (const e of crime.enemies) {
      const i = this.world.enemies.indexOf(e);
      if (i >= 0) this.world.enemies.splice(i, 1);
      e.dispose();
    }
    if (crime.victim) {
      crime.victim.state = 'walk';
      crime.victim.timer = 3;
    }
    if (crime.marker) {
      this.world.scene.remove(crime.marker.beam, crime.marker.ring);
      crime.marker.beam.material.dispose();
      crime.marker.ring.material.dispose();
    }
  }

  nearestCrime (pos) {
    let best = null, bd = Infinity;
    for (const c of this.crimes) {
      if (c.state !== 'active') continue;
      const d = c.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { crime: best, dist: bd } : null;
  }

  clear () {
    for (const c of this.crimes) this._destroy(c);
    this.crimes.length = 0;
  }
}
