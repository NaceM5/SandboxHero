import * as THREE from 'three';
import { Aircraft } from './Aircraft.js';
import { Enemy, rollTier, TIERS } from '../ai/Enemy.js';
import { attackRun, breakOff, evade, ram, obliterate, updateChunks, clearChunks, SPEED } from './JetAI.js';
import { clamp, rand, angleDelta } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const GUARD = 700;         // the jet fights only this close to the ship
const RESET = 1150;        // the hero this far away for a few seconds resets the ship
const HOVER = 45;          // metres above the deck for VTOL take-off and landing

/**
 * The carrier's standing garrison: an Atlas 42 parked on the flight deck and
 * six enemies on deck stations. Nothing marks it until you start something:
 * hurt one of the guards (or the jet) and the jet lifts off and fights you,
 * but only to protect the ship — it never ranges more than GUARD from the
 * deck — and from that moment the ship carries a battle marker, beam, ring
 * and objective readout, that follows the nearest guard (or the jet once
 * the guards are down) until every one of them is dead. Fly far enough
 * away and the ship quietly resets — jet back on deck, dead guards
 * replaced, the living healed and back on station, marker gone.
 */
export class CarrierGarrison {
  constructor (world) {
    this.world = world;
    const ship = world.city.landmarks.carrier;
    this.ship = ship;
    this.center = new THREE.Vector3(ship.x, ship.deckHeight, ship.z);
    const c = Math.cos(ship.rotation), s = Math.sin(ship.rotation);
    this.local = (x, z) => new THREE.Vector3(ship.x + c * x + s * z, ship.deckHeight, ship.z - s * x + c * z);
    // parked forward on the deck, nose toward the bow (the ship's local -z)
    this.parkPos = this.local(-9, -118);
    this.parkHeading = ship.rotation + Math.PI;
    this.posts = [[-18, -150], [8, -90], [-22, -30], [12, 30], [-26, 90], [6, 140]].map(([x, z]) => this.local(x, z));
    this.chunks = [];
    this.enemies = [];
    this.alert = false;
    this.awayT = 0;
    this.respawnT = 0;
    this.crime = null;         // the battle marker, only while the fight is on
    this.crimeLike = { pos: this.center.clone(), onEnemyDown: () => { this.alert = true; } };
    this._spawnJet();
    this._spawnGuards();
  }

  /* ---------------- setup / reset ---------------- */

  _spawnJet () {
    const j = new Aircraft(this.world, 'atlas');
    j.owner = this;
    j.pos.copy(this.parkPos);
    j.heading = this.parkHeading;
    j.speed = j.desiredSpeed = 0;
    j.mode = 'parked'; j.modeT = 0; j.gunT = 1; j.rollT = 0;
    j.setGear(true);
    j.syncMesh();
    this.jet = j;
    this._park(j);
  }

  _park (j) {
    j.colliders = j.asset.getColliders({ position: j.pos.toArray(), yaw: j.heading, scale: 1 });
    for (const r of j.colliders) this.world.city.colliders.add(r);
  }

  _unpark (j) {
    for (const r of j.colliders || []) r.gone = true;
    j.colliders = null;
  }

  _spawnGuards () {
    const diff = this.world.settings.get('crimeDifficulty');
    this.posts.forEach((p, i) => {
      const e = new Enemy(this.world, p.x, p.z, rollTier(diff), this.crimeLike);
      e.posts = this.posts; e.postIndex = i;
      e.pos.y = this.world.city.groundHeight(e.pos.x, e.pos.z, p.y + 1.4);
      e.group.position.copy(e.pos);
      e.garrison = this;
      this.enemies.push(e);
      this.world.enemies.push(e);
    });
  }

  _removeGuards () {
    for (const e of this.enemies) {
      const k = this.world.enemies.indexOf(e);
      if (k >= 0) this.world.enemies.splice(k, 1);
      e.dispose();
    }
    this.enemies.length = 0;
  }

  /** Anything left to fight: a living guard or the jet. */
  get engaged () { return this.alert && (this.enemies.some(e => !e.dead) || !!(this.jet && this.jet.alive)); }

  _raiseMarker () {
    if (this.crime) return;
    const tier = this.enemies.reduce((m, e) => Math.max(m, e.tier), 0);
    this.crime = this.world.crime.addExternal({ label: 'Carrier garrison', x: this.center.x, z: this.center.z, tier, persistent: true });
    if (this.crime.marker) this.crime.marker.color.set(TIERS[tier].color);
    this.world.notify('Carrier garrison engaged');
  }

  _dropMarker () {
    if (!this.crime) return;
    this.world.crime.removeCrime(this.crime);
    this.crime = null;
  }

  /** Keep the marker on the nearest living guard, or the jet once they are down. */
  _updateMarker (dt, player) {
    const c = this.crime;
    if (!c) return;
    let anchor = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceToSquared(player.pos);
      if (d < bd) { bd = d; anchor = e.pos; }
    }
    const guards = this.enemies.filter(e => !e.dead).length;
    const jet = this.jet && this.jet.alive ? 1 : 0;
    c.alive = guards + jet;
    if (!anchor && jet) anchor = this.jet.pos;
    if (!anchor) { this._dropMarker(); this.world.notify('Carrier garrison cleared'); return; }
    const k = Math.min(1, dt * 4);
    c.pos.x += (anchor.x - c.pos.x) * k;
    c.pos.z += (anchor.z - c.pos.z) * k;
    c.pos.y = this.world.city.groundHeight(c.pos.x, c.pos.z, anchor.y + 1.4);
    if (c.marker) {
      c.marker.beam.position.set(c.pos.x, c.pos.y + 0.1, c.pos.z);
      c.marker.ring.position.set(c.pos.x, c.pos.y + 0.12, c.pos.z);
    }
  }

  reset () {
    this.alert = false;
    this.awayT = 0;
    this._dropMarker();
    // guards: replace the dead, heal the living, back on station
    const dead = this.enemies.filter(e => e.dead);
    for (const e of dead) {
      const k = this.world.enemies.indexOf(e);
      if (k >= 0) this.world.enemies.splice(k, 1);
      e.dispose();
    }
    this.enemies = this.enemies.filter(e => !e.dead);
    const diff = this.world.settings.get('crimeDifficulty');
    for (let i = 0; i < this.posts.length; i++) {
      const p = this.posts[i];
      let e = this.enemies[i];
      if (!e) {
        e = new Enemy(this.world, p.x, p.z, rollTier(diff), this.crimeLike);
        e.garrison = this;
        this.enemies.push(e);
        this.world.enemies.push(e);
      }
      if (e.phys !== 'walk') e.resetPhysics();
      e.health = e.maxHealth; e.target = null; e.awareness = 0; e.state = 'idle';
      e.posts = this.posts; e.postIndex = i;
      e.pos.set(p.x, this.world.city.groundHeight(p.x, p.z, p.y + 1.4), p.z);
      e.group.position.copy(e.pos);
    }
    // the jet: ordered home if it is flying, replaced if it was shot down
    const j = this.jet;
    if (!j || !j.alive) { if (j) j.dispose(); this._spawnJet(); }
    else if (j.mode !== 'parked') { j.mode = 'return'; j.modeT = 0; }
    if (j && j.alive) j.hp = j.maxHp;
  }

  /* ---------------- damage ---------------- */

  hurt (a, amount, at) {
    if (!a.alive) return;
    this.alert = true;
    if (a.damage(amount, at)) {
      obliterate(this.world, a);
      this._unpark(a);
      a.dispose();
      this.world.notify('Carrier jet down');
      this.respawnT = 40;
    } else if (a.healthFrac < 0.35 && a.mode !== 'evade' && a.mode !== 'parked') {
      a.mode = 'evade'; a.modeT = 0; a.evadeT = 0;
      this.world.notify('Carrier jet damaged — breaking off');
    }
  }

  get targets () { return this.jet && this.jet.alive ? [this.jet] : []; }

  /* ---------------- update ---------------- */

  update (dt, ctx) {
    const player = this.world.player;
    const dShip = player.pos.distanceTo(this.center);
    // a guard that has been hurt raises the alarm even if it is not dead yet
    if (!this.alert) for (const e of this.enemies) if (e.health < e.maxHealth || e.phys !== 'walk') { this.alert = true; break; }
    if (this.alert && !this.crime && this.engaged) this._raiseMarker();
    this._updateMarker(dt, player);

    // far away long enough and the ship resets itself
    if (dShip > RESET) { this.awayT += dt; if (this.awayT > 5 && (this.alert || this.enemies.some(e => e.dead))) this.reset(); }
    else this.awayT = 0;

    if (this.jet && !this.jet.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0 && dShip > RESET) { this.jet.dispose(); this._spawnJet(); }
    }
    this._flyJet(dt, player, dShip);
    if (this.jet && this.jet.alive) ram(this.world, this.jet, player);
    updateChunks(this.world, this.chunks, dt);
  }

  _flyJet (dt, player, dShip) {
    const j = this.jet;
    if (!j || !j.alive) return;
    j.modeT += dt;
    j.hitFlash = Math.max(0, j.hitFlash - dt);
    j.rollExtra += (0 - j.rollExtra) * Math.min(1, dt * 2);
    if (j.mode !== 'parked') j.emitDamageFx(dt);
    const deckY = this.center.y;
    const dJet = j.pos.distanceTo(this.center);
    const threat = player.suited && !player.downed && dShip < GUARD;

    switch (j.mode) {
      case 'parked':
        if (this.alert) {
          j.mode = 'takeoff'; j.modeT = 0;
          this._unpark(j);
          j.setGear(false);
          this.world.notify('Carrier alert — Atlas 42 launching');
          this.world.effects.burst(j.pos, '#dfe6ea', 30, 8, 0.8, 0.8, { grav: -2, drag: 0.9 });
        }
        return;
      case 'takeoff': {
        // straight up on the lift fans, then away
        j.pos.y += 14 * dt;
        j.pitch = clamp(j.pitch + 0.1 * dt, 0, 0.12);
        if (j.modeT > 0.6 && Math.random() < dt * 6) this.world.effects.burst(_a.copy(j.pos).setY(deckY + 0.5), '#cfd6e0', 6, 6, 0.6, 0.4, { grav: -3 });
        if (j.pos.y >= deckY + HOVER) { j.mode = 'attack'; j.modeT = 0; j.speed = 20; }
        j.syncMesh();
        return;
      }
      case 'attack':
      case 'break':
        if (!threat || dJet > GUARD) { j.mode = 'return'; j.modeT = 0; }
        else if (j.mode === 'attack') attackRun(this.world, j, dt, player);
        else breakOff(this.world, j, dt, player);
        return;
      case 'evade':
        evade(this.world, j, dt, player, this.center, GUARD);
        if (dShip > GUARD * 1.3) { j.mode = 'return'; j.modeT = 0; }
        return;
      case 'return': {
        // back to a hover over the parking spot; re-engage if the fight comes back
        if (threat && j.healthFrac >= 0.35 && this.alert) { j.mode = 'attack'; j.modeT = 0; return; }
        _b.copy(this.parkPos); _b.y = deckY + HOVER;
        const d = j.steerTo(_b, dt, clamp(d3(j.pos, _b) * 0.3, 14, SPEED.form), 1.2);
        j.integrate(dt);
        if (d < 12) { j.mode = 'landing'; j.modeT = 0; j.speed = j.desiredSpeed = 0; j.vel.set(0, 0, 0); }
        return;
      }
      case 'landing': {
        // settle onto the spot, swinging the nose to the parked heading
        const k = Math.min(1, dt * 1.5);
        j.pos.x += (this.parkPos.x - j.pos.x) * k;
        j.pos.z += (this.parkPos.z - j.pos.z) * k;
        j.heading += angleDelta(j.heading, this.parkHeading) * k;
        j.pitch += (0 - j.pitch) * k; j.roll += (0 - j.roll) * k;
        j.pos.y = Math.max(deckY, j.pos.y - 9 * dt);
        if (j.pos.y > deckY + 1 && Math.random() < dt * 6) this.world.effects.burst(_a.copy(j.pos).setY(deckY + 0.5), '#cfd6e0', 5, 5, 0.5, 0.35, { grav: -3 });
        j.syncMesh();
        if (j.pos.y <= deckY + 0.01) {
          j.pos.copy(this.parkPos); j.heading = this.parkHeading; j.pitch = j.roll = 0;
          j.mode = 'parked'; j.modeT = 0; j.setGear(true); j.syncMesh();
          this._park(j);
          if (!this.alert) j.hp = j.maxHp;
        }
        return;
      }
    }
  }

  dispose () {
    this._dropMarker();
    this._removeGuards();
    if (this.jet) { this._unpark(this.jet); this.jet.dispose(); }
    clearChunks(this.world, this.chunks);
  }
}

function d3 (a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
