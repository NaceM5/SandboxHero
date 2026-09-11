import {updateCampus} from './world/Campus.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { settings } from './core/Settings.js';
import { Input } from './core/Input.js';
import { clamp, rand, randInt, pick } from './core/Util.js';
import { GameMap } from './world/Map.js';
import { ElevatorPrompt, useElevator } from './world/Elevators.js';
import { Roads } from './world/Roads.js';
import { PropSystem } from './world/Props.js';
import { Sky } from './world/Sky.js';
import { GameAudio } from './fx/Audio.js';
import { Effects } from './fx/Effects.js';
import { Traffic } from './vehicles/Traffic.js';
import { Pedestrian } from './ai/Pedestrian.js';
import { randomSuit } from './char/Rig.js';
import { CrimeSystem } from './ai/CrimeSystem.js';
import { Scenarios } from './scenarios/Scenarios.js';
import { Projectiles } from './powers/Powers.js';
import { CameraRig } from './player/CameraRig.js';
import { Player } from './player/Player.js';
import { HUD } from './ui/HUD.js';
import { Menu } from './ui/Menu.js';
import { QUICK_ATTRS } from './core/Attributes.js';

const _imp = new THREE.Vector3();

const boot = document.getElementById('boot');
const bootFill = document.getElementById('bootFill');
const bootMsg = document.getElementById('bootMsg');
const clickToPlay = document.getElementById('clickToPlay');

// Yields via timers rather than rAF so loading still completes in a
// background tab (rAF is throttled to zero when the document is hidden).
let _stageT = 0;
const BOOT_TIMINGS = [];
// Yields via timers rather than rAF so loading still completes in a
// background tab (rAF is throttled to zero when the document is hidden).
const step = async (pct, msg) => {
  const now = performance.now();
  if (_stageT) BOOT_TIMINGS.push(`${bootMsg.textContent}: ${Math.round(now - _stageT)}ms`);
  _stageT = now;
  bootFill.style.width = pct + '%';
  bootMsg.textContent = msg;
  // rAF gives a real repaint when the page is visible; a hidden page throttles
  // rAF to zero, so fall back to a timer and keep loading either way.
  await new Promise(r => document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => setTimeout(r, 0)));
};

class World {
  constructor () {
    this.settings = settings;
    this.peds = [];
    this.enemies = [];
    this.clock = new THREE.Clock();
    this.paused = false;
    this.time = 0;
    this._gridCell = 22;
    this._grid = new Map();
    this.quickIndex = 0;
  }

  async init () {
    const canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;   // overridden by applyLighting()
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 8000);
    this.camera.position.set(0, 6, -12);

    await step(8, 'surveying the coast');
    this.city = new GameMap(this.scene);

    await step(16, 'raising the skyline');
    this.city.buildVisuals();

    await step(38, 'laying the foundations');
    this.city.buildCollision();

    await step(46, 'laying out the streets');
    this.roads = new Roads(this.city.data);

    await step(52, 'planting the trees');
    this.city.buildFurniture(this.roads);
    this.city.buildWater();

    await step(58, 'hanging the sun');
    this.sky = new Sky(this.scene, this.renderer);

    await step(62, 'wiring effects');
    this.audio = new GameAudio(this);
    this.effects = new Effects(this.scene, this.audio);
    this.projectiles = new Projectiles(this);
    this.props = new PropSystem(this);

    await step(72, 'starting traffic');
    this.traffic = new Traffic(this.scene, this.roads, this.city, this.effects);
    this.traffic.world = this;
    this.traffic.onExplosion = (v, at) => {
      this.audio.play('blast', at);
      // skipVehicle is essential: without it the wreck is caught in its own
      // blast, gets re-launched, lands, explodes again — bouncing forever
      this.applyImpact(at, 10, {
        damage: 80, knock: 20, up: 0.8, hitY: 0.6,
        vehicleDamage: 60, propForce: 24, propRadius: 8, skipVehicle: v
      });
      if (this.player && this.player.pos.distanceTo(at) < 9) {
        this.player.takeDamage(30, at);
        this.cameraRig.addShake(0.7);
      }
    };

    await step(82, 'filling the sidewalks');
    this.cameraRig = new CameraRig(this.camera, this.city);
    this.player = new Player(this, this.cameraRig);
    this.player.cam = this.cameraRig;
    this.placePlayer();
    this.elevatorPrompt = new ElevatorPrompt(this);

    this.crime = new CrimeSystem(this);
    this.scenarios = new Scenarios(this);

    await step(90, 'compositing');
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.42, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.input = new Input(canvas);
    this.hud = new HUD(this);
    this.menu = new Menu(this);

    addEventListener('resize', () => this.resize());
    this.resize();

    this.applyAllSettings();
    settings.onChange((path) => this.onSettingChanged(path));

    await step(100, 'ready');
    console.log('[boot]', BOOT_TIMINGS.join(' | '));
    boot.style.transition = 'opacity .5s';
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 520);
    this.hud.show();
    clickToPlay.classList.remove('hidden');
    clickToPlay.addEventListener('click', () => {
      this.input.requestLock();
      clickToPlay.classList.add('hidden');
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && !this.menu.open) clickToPlay.classList.remove('hidden');
      else clickToPlay.classList.add('hidden');
    });

    this.hud.notify('Click to play — Tab for the sandbox menu');
    this.loop();
  }

  /** Open on a rooftop looking back over downtown — it frames the city and
   *  makes the first thing you do a jump or a takeoff. */
  placePlayer () {
    const C = this.city.downtown;
    let best = null, bestScore = -Infinity;
    for (const r of this.city.rooftops) {
      if (r.y < 34 || r.y > 95) continue;
      if (Math.min(r.w, r.d) < 22) continue;              // needs room to stand
      const d = Math.hypot(r.x - C.x, r.z - C.z);
      if (d < 260 || d > 620) continue;
      const score = r.y + Math.min(r.w, r.d) * 0.5 - Math.abs(d - 420) * 0.25;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    const p = this.player;
    if (!best) {
      // no suitable roof — stand on the pavement nearest the core instead
      const n = this.roads.nearestWalkNode(C.x, C.z);
      p.pos.set(n.x, this.city.groundHeight(n.x, n.z), n.z);
      this.cameraRig.yaw = Math.PI * 0.25;
      p.heading = this.cameraRig.yaw;
      p.grounded = true;
      return;
    }
    // stand on the outward edge facing the core, so the camera sits out
    // over the drop rather than behind a rooftop plant room
    const len = Math.hypot(best.x - C.x, best.z - C.z) || 1;
    const ox = (best.x - C.x) / len, oz = (best.z - C.z) / len;
    const edge = Math.min(best.w, best.d) / 2 - 2.2;
    p.pos.set(best.x + ox * edge, best.y, best.z + oz * edge);
    this.cameraRig.yaw = Math.atan2(-ox, -oz);           // face the city centre
    this.cameraRig.pitch = -0.10;
    p.heading = this.cameraRig.yaw;
    p.grounded = true;
  }

  resize () {
    // a hidden/collapsed pane can report 0x0; render targets must never be zero
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    const rs = settings.get('renderScale');
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * rs);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  /* ================= settings ================= */

  applyLighting () {
    const s = settings;
    this.sky.setTime(s.get('timeOfDay'));
    this.sky.setLighting(s.get('ambient'), s.get('brightMode'));
    this.city.setNightFactor(s.get('brightMode') ? Math.min(this.sky.night, 0.55) : this.sky.night);
    this.traffic.setNight(this.sky.night);
    this.renderer.toneMappingExposure = s.get('exposure') * (s.get('brightMode') ? 1.15 : 1);
  }

  applyAllSettings () {
    const s = settings;
    this.applyLighting();
    // bright mode already lifts exposure; keep bloom from blowing out road paint
    if (this.bloom) this.bloom.strength = s.get('bloom') * (s.get('brightMode') ? 0.55 : 1);
    this.camera.far = s.get('drawDistance') * 2.2;
    this.camera.updateProjectionMatrix();
    this.setPedCount(s.get('pedestrians'));
    this.traffic.setCount(s.get('vehicles'));
    this._parkCampusCars();
    this.player.health = Math.min(this.player.health, s.get('maxHealth'));
    this.player.energy = Math.min(this.player.energy, s.get('maxEnergy'));
  }

  onSettingChanged (path) {
    const s = settings;
    if (path === '*') { this.player.buildRigs(); this.applyAllSettings(); return; }
    if (path === 'trafficRadius' || path === 'crowdRadius') return;   // read live by the streamers
    if (path === 'timeOfDay' || path === 'ambient' || path === 'brightMode' || path === 'exposure') {
      this.applyLighting();
      if (this.bloom) this.bloom.strength = s.get('bloom') * (s.get('brightMode') ? 0.55 : 1);
    } else if (path === 'bloom') this.bloom.strength = s.get('bloom') * (s.get('brightMode') ? 0.55 : 1);
    else if (path === 'renderScale') this.resize();
    else if (path === 'drawDistance') {
      this.camera.far = s.get('drawDistance') * 2.2;
      this.camera.updateProjectionMatrix();
    } else if (path === 'pedestrians') this.setPedCount(s.get('pedestrians'));
    else if (path === 'vehicles') this.traffic.setCount(s.get('vehicles'));
    else if (path === 'maxHealth') this.player.health = Math.min(this.player.health, s.get('maxHealth'));
    else if (path === 'maxEnergy') this.player.energy = Math.min(this.player.energy, s.get('maxEnergy'));
    else if (path.startsWith('suit.') || path.startsWith('civ.')) {
      clearTimeout(this._rigTimer);
      this._rigTimer = setTimeout(() => this.player.buildRigs(), 130);
    }
  }

  onSettingsBulkChange () { this.player.buildRigs(); this.applyAllSettings(); }

  rebuildPopulation () {
    this.scenarios.abort();
    this.crime.clear();
    this.props.clear();
    for (const p of this.peds) p.dispose();
    this.peds.length = 0;
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.applyAllSettings();
    this.hud.notify('World repopulated');
  }

  /* ================= population ================= */

  setPedCount (n) {
    // the count is the crowd; a place's own staff are on top of it
    n = Math.max(0, Math.round(n));
    const crowd = () => this.peds.filter(a => !a.station).length;
    while (crowd() < n) this.peds.push(new Pedestrian(this, this._crowdNode()));
    while (crowd() > n) {
      const i = this.peds.findLastIndex(a => !a.station);
      this.peds.splice(i, 1)[0].dispose();
    }
    if (!this.peds.some(a => a.station)) this._populateCampus();
  }

  /** Real cars in the campus car park, nose to the wheel stops, most bays taken. */
  _parkCampusCars () {
    const c = this.city.data.campus;
    if (!c || !c.bays || this.traffic.vehicles.some(v => v.fixed)) return;
    for (const b of c.bays) if (Math.random() < 0.62) this.traffic.parkAt(b.x, b.z, b.heading, b.y);
  }

  /**
   * The Meridian campus is gated: no footway leads in, so the crowd never
   * does. Its people are its own — office staff in dark suits stationed on
   * posts around the grounds and on each floor of the research building,
   * drifting between desks, sofas and terraces and never leaving.
   */
  _populateCampus () {
    const c = this.city.data.campus;
    if (!c) return;
    const X = c.x, Z = c.z, F = c.floors.main, U = c.floors.upper, B = c.floors.basement;
    const L = (u, v) => [X + u, Z + v];
    // Posts sit in aisles and open floor, never on a desk: a desk at (x, z)
    // takes x ± 1.5 and z − 0.7 … z + 2.3 including the chair, so the rows at
    // z = −20, −12, −4, 4, 12, 20 leave aisles centred on −15, −7, 1, 9, 17.
    const groups = [
      // the grounds: the paths, the garden walks, the terraces, the car park, the gate
      { y: F, count: 26, posts: [[-2370, -1860], [-2370, -1780], [-2370, -1700], [-2370, -1600], [-2370, -1520], [-1906, -1860], [-1906, -1780], [-1906, -1700], [-1906, -1600], [-1906, -1520], [-2300, -1872], [-2200, -1872], [-2000, -1872], [-2300, -1508], [-2200, -1508], [-2000, -1508], [-2128, -1560], [-2128, -1640], [-2128, -1720], [-2128, -1800], [-2250, -1704], [-2060, -1704], [-2350, -1704], [-2220, -1548], [-2335, -1735], [-2070, -1855], [-2010, -1578], [-2060, -1628], [-1960, -1628], [-1975, -1470], [-1935, -1740], [-2300, -1596], [-2180, -1500], [-2100, -1500], [-2100, -1750]] },
      // the research building: lobby, upper offices, and the secure basement (offices and mission control keep to their own side of the doors)
      { y: F, count: 8, posts: [L(-15, -15), L(-9, -7), L(-21, 1), L(-15, 9), L(-3, -10), L(-3, 2), L(8, 6), L(8, 14), L(15, -6), L(15, -19), L(0, 20), L(-10, 6), L(-21, -7)] },
      { y: U, count: 14, posts: [L(0, -16), L(0, -8), L(0, 0), L(0, 8), L(0, 16), L(-12, -13), L(-15, 1), L(15, 1), L(-15, 9), L(-9, 17), L(9, 17), L(18, 8), L(-21, 17), L(21, 9), L(-19, -22), L(-27, -18), L(18.5, -13), L(10, -24), L(27, -14)] },
      { y: B, count: 7, posts: [L(-14, 4.8), L(0, 4.8), L(14, 4.8), L(-14, 10.8), L(5, 10.8), L(0, 15), L(-24.5, 12.5), L(-24.5, 1.5), L(-19.5, 9)] },
      { y: B, count: 6, posts: [L(-15, -13.2), L(-5, -13.2), L(5, -13.2), L(15, -13.2), L(-10, -24), L(10, -24), L(0, -5.5), L(-15, -5.5), L(15, -5.5)] }
    ];
    for (const g of groups) {
      for (let i = 0; i < g.count; i++) {
        const p = new Pedestrian(this, this.roads.nearestWalkNode(X, Z, F, 400) || this.roads.randomWalkNode(), {
          appearance: randomSuit(), station: { posts: g.posts, y: g.y }
        });
        this.peds.push(p);
      }
    }
  }

  /**
   * Pick a pavement node to drop a civilian on, weighted by how much building
   * is packed onto that block — dense downtown blocks get busy pavements, the
   * low-rise fringe stays quiet.
   */
  _crowdNode (nearPlayer = false) {
    const p = this.player;
    const radius = settings.get('crowdRadius');
    let best = null, bestW = -1;
    // weighted reservoir over a handful of candidates — far cheaper than
    // building a full CDF every time a pedestrian recycles. The whole crowd
    // lives around the player: a seven-kilometre map spread evenly would be
    // one person per street.
    for (let tries = 0; tries < 14; tries++) {
      let node;
      if (p) {
        // weight toward the near half so the immediate street feels busy
        const r = 34 + Math.pow(Math.random(), nearPlayer ? 2.2 : 1.2) * (radius - 34);
        node = this.roads.randomWalkNodeNear(p.pos.x, p.pos.z, Math.max(20, r - 40), r + 40, 4);
      } else node = this.roads.randomWalkNode();
      if (!node) continue;
      if (this.city.isWater(node.x, node.z)) continue;
      if (this.city.covered(node.x, node.z, node.y)) continue;   // never under the bridge
      if (nearPlayer && p) {
        const d = Math.hypot(node.x - p.pos.x, node.z - p.pos.z);
        if (d < 32 || d > radius) continue;
        // don't materialise someone inside the player's field of view
        if (d < 95) {
          const f = this.cameraRig.forward();
          const dot = ((node.x - p.pos.x) * f.x + (node.z - p.pos.z) * f.z) / d;
          if (dot > 0.35) continue;
        }
      }
      // squared so a downtown footway clearly outbids a hillside lane even
      // with the whole crowd packed into a small radius around the player
      const w = node.busy * node.busy * (0.3 + Math.random() * 0.7);
      if (w > bestW) { bestW = w; best = node; }
    }
    return best || this.roads.randomWalkNodeNear(p ? p.pos.x : 0, p ? p.pos.z : 0, 30, radius * 1.5, 30) || this.roads.randomWalkNode();
  }

  /**
   * Keep the crowd around the player. Civilians that wander (or get thrown)
   * out of range are recycled to a busy pavement nearby, so the same fixed
   * population always reads as a full city instead of being spread thin over
   * three square kilometres.
   */
  _streamCrowd (dt) {
    this._crowdT = (this._crowdT || 0) - dt;
    if (this._crowdT > 0) return;
    this._crowdT = 0.25;

    const p = this.player;
    const radius = settings.get('crowdRadius');
    const keep = radius * 1.35;
    let budget = 6;                       // recycle a few per tick, not all at once
    for (const a of this.peds) {
      if (budget <= 0) break;
      if (a.phys !== 'walk') continue;    // never teleport a body mid-tumble
      if (a.captive || a.aboard || a.hostage || a.scripted || a.station) continue;   // a scenario, or a place, has them
      if (a.pin > 0) { a.pin -= 0.25; continue; }                       // a scenario needs them where they are
      if (a.pos.distanceTo(p.pos) < keep) continue;
      const node = this._crowdNode(true);
      if (!node) continue;
      a.pos.set(node.x, this.city.groundHeight(node.x, node.z, node.y + 3), node.z);
      a.node = node;
      a.next = node.links[randInt(0, node.links.length - 1)];
      a.prev = null;
      a.state = 'walk';
      a.timer = rand(2, 10);
      a.fear = 0;
      a.heading = rand(-Math.PI, Math.PI);
      budget--;
    }
  }

  /**
   * A civilian for a scenario that needs one somewhere specific — a street
   * the airlifter has landed on, say, far from wherever the crowd is. A new
   * one if the crowd has room, otherwise the one furthest from the hero is
   * brought over; either way they are pinned so the crowd streaming doesn't
   * recycle them straight back to the hero's neighbourhood.
   */
  placePedestrian (x, z, y, pin = 60) {
    let a = this.spawnPedestrian(x, z, y);
    if (!a) {
      const pp = this.player.pos;
      let bd = -1;
      for (const c of this.peds) {
        if (c.phys !== 'walk' || c.captive || c.aboard || c.hostage || c.scripted || c.station || c.pin > 0) continue;
        const d = c.pos.distanceToSquared(pp);
        if (d > bd) { bd = d; a = c; }
      }
      if (!a) return null;
      const node = this.roads.nearestWalkNode(x, z, y, 8);
      a.pos.set(x, this.city.groundHeight(x, z, y + 3), z);
      a.node = node;
      a.next = node.links[randInt(0, node.links.length - 1)];
      a.prev = null;
      a.state = 'walk';
      a.timer = rand(2, 10);
      a.fear = 0;
      a.heading = rand(-Math.PI, Math.PI);
    }
    a.pin = pin;
    return a;
  }

  /** Drop a civilian at (x,z), on the level `y` if given, else at street level. */
  spawnPedestrian (x, z, y = null) {
    if (this.peds.length > 320) return null;
    y = y === null ? this.city.streetHeight(x, z) : this.city.groundHeight(x, z, y + 3);
    const p = new Pedestrian(this, this.roads.nearestWalkNode(x, z, y, 8));
    p.pos.set(x, y, z);
    this.peds.push(p);
    return p;
  }

  /* ================= queries ================= */

  _rebuildGrid () {
    this._grid.clear();
    const c = this._gridCell;
    const add = a => {
      const k = `${Math.floor(a.pos.x / c)},${Math.floor(a.pos.z / c)}`;
      let l = this._grid.get(k);
      if (!l) { l = []; this._grid.set(k, l); }
      l.push(a);
    };
    for (const p of this.peds) add(p);
    for (const e of this.enemies) add(e);
  }

  actorsNear (pos, r) {
    const out = [];
    const c = this._gridCell;
    const x0 = Math.floor((pos.x - r) / c), x1 = Math.floor((pos.x + r) / c);
    const z0 = Math.floor((pos.z - r) / c), z1 = Math.floor((pos.z + r) / c);
    const r2 = r * r;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const l = this._grid.get(`${x},${z}`);
        if (!l) continue;
        for (const a of l) {
          if (a.dead && a.faction === 'enemy') continue;
          const dx = a.pos.x - pos.x, dy = (a.pos.y + a.height * 0.5) - pos.y, dz = a.pos.z - pos.z;
          if (dx * dx + dz * dz + dy * dy * 0.35 < r2) out.push(a);
        }
      }
    }
    return out;
  }

  /**
   * Every offensive power lands here. Actors, vehicles (wrecks included),
   * standing street furniture and loose debris all react to the same call, so
   * anything that can hurt an enemy can also shove a car, uproot a lamp post
   * and scatter a crowd.
   */
  applyImpact (center, radius, o = {}) {
    const dmg = o.damage ?? 0;
    const knock = o.knock ?? 0;
    const up = o.up ?? 0.45;
    const hitY = o.hitY ?? 1.2;
    const k = o.falloff ?? 0.55;
    const p = this.player;
    let hits = 0;

    const dirTo = (pos, from) => {
      _imp.copy(pos).sub(from).setY(0);
      if (_imp.lengthSq() < 1e-4) _imp.set(rand(-1, 1), 0, rand(-1, 1));
      return _imp.normalize();
    };

    for (const a of this.actorsNear(center, radius)) {
      if (a === o.skip) continue;
      const f = 1 - clamp(a.pos.distanceTo(center) / radius, 0, 1) * k;
      const dir = dirTo(a.pos, center);
      if (a.faction === 'civilian') {
        a.panic?.(center, 1);
        if (knock > 0) a.applyKnockback(dir, knock * f * 0.85, up, hitY);
      } else {
        p.dealDamage(a, dmg * f, dir, knock * f, false, up, hitY);
      }
      hits++;
    }

    const vDmg = o.vehicleDamage ?? dmg;
    if (vDmg > 0 || knock > 0) {
      const vr = radius + 1.5;
      for (const v of this.traffic.vehicles) {
        if (v.driver === 'player' || v.state === 'held' || v === o.skipVehicle) continue;
        const d = v.pos.distanceTo(center);
        if (d > vr) continue;
        const f = 1 - clamp(d / vr, 0, 1) * k;
        this.traffic.impact(v, dirTo(v.pos, center), knock * f, vDmg * f);
        hits++;
      }
    }

    // aircraft: scenario fleets and the carrier's standing guard alike
    if (this.scenarios) hits += this.scenarios.applyImpact(center, radius, o);

    const pf = o.propForce ?? knock;
    if (pf > 4) {
      const pr = o.propRadius ?? radius;
      for (const prop of this.city.propsNear(center.x, center.z, pr)) {
        const item = this.props.grab(prop);
        if (!item) continue;
        const dir = dirTo(item.pos, center);
        this.props.launch(item, dir.setY(0.6).normalize(), pf * 0.8);
        hits++;
      }
      for (const it of this.props.items) {
        if (it === o.skipProp || it.state !== 'settled') continue;
        if (it.restT > 0 || it.pos.distanceTo(center) > pr) continue;
        it.smashed = false;
        this.props.launch(it, dirTo(it.pos, center).setY(0.55).normalize(), pf * 0.55);
      }
    }
    return hits;
  }

  /* ================= events ================= */

  notify (t) { this.hud?.notify(t); }
  flashTransform () { this.hud?.flashTransform(); this.audio.play('transform'); }
  onCrimeResolved () {
    this.player.stats.crimes++;
    this.notify('CRIME STOPPED');
    this.audio.play('success');
  }
  onCrimeSpawned (c) {
    const d = this.player.pos.distanceTo(c.pos);
    if (d < 260) this.notify(`${c.label} nearby`);
  }
  onPlayerHurt () { this.audio.play('hurt'); }
  onTakedown () {}

  closeMenu () {
    this.menu.setOpen(false);
    this.input.enabled = true;
    this.input.requestLock();
  }
  openMenu () {
    this.menu.setOpen(true);
    this.input.enabled = false;
    this.input.exitLock();
    this.player.power?.cancel?.();
  }

  /* ================= input ================= */

  gather () {
    const i = this.input;
    const p = this.player;
    if (i.hit('Tab')) { this.menu.open ? this.closeMenu() : this.openMenu(); }
    if (this.menu.open) return null;

    if (i.locked) this.cameraRig.look(i.mouse.dx, i.mouse.dy);

    /* ---- M: battle scenarios — hold for the selector, a number launches ---- */
    const scen = i.down('KeyM');
    this.scenarios.setSelectorVisible(scen);
    if (scen) {
      for (let k = 0; k < this.scenarios.list.length; k++) {
        if (i.hit('Digit' + (k + 1))) this.scenarios.start(k);
      }
      if (i.hit('Backspace') || i.hit('Digit0')) this.scenarios.abort();
    }

    /* ---- Alt: quick-tune an attribute with the wheel ---- */
    const alt = i.down('AltLeft') || i.down('AltRight');
    if (alt) {
      for (let k = 0; k < QUICK_ATTRS.length; k++) {
        if (i.hit('Digit' + (k + 1))) this.quickIndex = k;
      }
      if (i.mouse.wheel) this.tuneAttribute(-i.mouse.wheel);
      this.hud.showQuickTune(this.quickIndex);
    } else {
      this.hud.hideQuickTune();
      if (i.mouse.wheel) {
        // the low end runs past the shoulder view into first person
        this.cameraRig.dist = clamp(this.cameraRig.dist + i.mouse.wheel * 1.2, 0.7, 22);
      }
      for (let k = 0; k < p.powers.length && !scen; k++) {
        if (i.hit('Digit' + (k + 1)) && p.powerIndex !== k) {
          p.power?.cancel?.();
          p.powerIndex = k;
          this.audio.play('select');
          this.notify(p.powers[k].name + ' — ' + p.powers[k].desc);
        }
      }
    }

    if (i.hit('KeyV')) this.cameraRig.cycleDistance();
    if (i.hit('KeyT')) p.transform();
    if (i.hit('KeyE') && !useElevator(this)) p.tryEnterVehicle();
    if (p.vehicle) {
      // the dashboard: next, back (or restart), play/pause
      if (i.hit('BracketRight')) { const t = this.audio.radioNext(); if (t) this.notify(`Radio ▶ ${t}`); }
      if (i.hit('BracketLeft')) { const t = this.audio.radioPrev(); if (t) this.notify(`Radio ◀ ${t}`); }
      if (i.hit('KeyP')) { const on = this.audio.radioToggle(); if (on !== null) this.notify(on ? `Radio ▶ ${this.audio.radioTitle}` : 'Radio paused'); }
    } else if (this.audio.battle?.on) {
      // the same keys drive the battle music while a fight is on
      if (i.hit('BracketRight')) { const t = this.audio.battleNext(); if (t) this.notify(`Battle music ▶ ${t}`); }
      if (i.hit('BracketLeft')) { const t = this.audio.battleRestart(); if (t) this.notify(`Battle music ◀ ${t}`); }
      if (i.hit('KeyP')) { const on = this.audio.battleToggle(); if (on !== null) this.notify(on ? `Battle music ▶ ${this.audio.battleTitle}` : 'Battle music paused'); }
    } else if (i.hit('KeyP')) {
      const c = this.crime.spawnNear(p.pos.x + rand(-140, 140), p.pos.z + rand(-140, 140));
      this.notify(c ? 'Crime spawned nearby' : 'Could not place a crime');
    }

    const secondaryDown = i.mouse.rightPressed || i.hit('KeyG');
    const secondaryHeld = i.mouse.right || i.down('KeyG');
    const secondaryUp = (i.up('KeyG') || (!i.mouse.right && this._sPrev && !i.down('KeyG')));
    this._sPrev = secondaryHeld;

    const shift = i.down('ShiftLeft') || i.down('ShiftRight');
    const ctrl = i.down('ControlLeft') || i.down('ControlRight');

    return {
      move: i.moveAxis(),
      sprint: shift,                                   // sprint on foot, afterburn in flight
      jumpPressed: i.hit('Space'),
      up: i.down('Space'),
      down: ctrl || i.down('KeyC'),                    // descend / dive
      toggleFlight: i.hit('KeyF'),
      primaryPressed: !alt && i.mouse.leftPressed,
      secondaryPressed: !alt && secondaryDown,
      secondaryHeld: !alt && secondaryHeld,
      secondaryReleased: secondaryUp,
      ultPressed: !alt && i.hit('KeyQ')
    };
  }

  /** Nudge the selected quick-tune attribute by `dir` steps. */
  tuneAttribute (dir) {
    const a = QUICK_ATTRS[this.quickIndex];
    const cur = settings.get(a.k);
    const next = clamp(+(Math.round((cur + dir * a.step) / a.step) * a.step).toFixed(3), a.min, a.max);
    if (next === cur) return;
    settings.set(a.k, next);
    if (a.k === 'maxHealth') this.player.health = Math.min(this.player.health, next);
  }

  driveInput () {
    const i = this.input;
    const m = i.moveAxis();
    return { throttle: m.y, steer: m.x, brake: i.down('Space') };
  }

  /* ================= loop ================= */

  loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.time += dt;

    this.audio.update(dt);
    const input = this.gather();
    if (input) this.step(dt, input);
    else this.input.endFrame();

    this.sky.update(this.camera, this.player.pos, dt);
    this.city.updateWater(dt, this.sky.sunDir, this.sky.uniforms.uSunCol.value,
      this.sky.uniforms.uHorizon.value, this.scene.fog);
    this.elevatorPrompt.update();
    updateCampus(this, dt);
    this.composer.render();
  };

  step (dt, input) {
    const p = this.player;
    this._rebuildGrid();

    p.update(dt, input);

    const ctx = {
      player: p,
      peds: this.peds,
      enemies: this.enemies,
      driveInput: p.vehicle ? this.driveInput() : null,
      obstacles: [p.pos]
    };

    this.traffic.update(dt, ctx);

    // pedestrians (neighbours pulled from the spatial grid)
    this._streamCrowd(dt);
    for (const a of this.peds) {
      a.update(dt, { player: p, neighbors: this.actorsNear(a.pos, 1.4) });
    }
    for (const e of this.enemies) e.update(dt, ctx);

    this.scenarios.update(dt, ctx);
    this.crime.update(dt, ctx);
    this.projectiles.update(dt);
    this.props.update(dt);
    this.effects.update(dt);

    /* camera */
    const flying = p.flying;
    const drive = !!p.vehicle;
    const speed = drive ? Math.abs(p.vehicle.speed) : p.speed;
    this.cameraRig.update(dt, drive ? p.vehicle.pos : p.pos, {
      flying,
      snappy: speed > 40,
      distMul: drive ? 1.6 : flying ? 1.15 + p.speedRatio * 0.55 : 1,
      // cars look wrong off-centre, and at speed the hero should sit nearer
      // the middle of the frame so you can see what you're flying into
      shoulder: drive ? 0 : flying ? 0.26 - p.speedRatio * 0.18 : 0.26,
      autoYaw: drive && p.vehicle.speed > 2 ? p.vehicle.heading : undefined,
      fovBoost: clamp((speed - 22) / 90, 0, 1) * 30,
      // driving from inside your own head reads badly; everywhere else the
      // zoom decides
      noFirstPerson: drive
    });
    // hide the hero once the camera is essentially at their eyes — and
    // whenever they are in a car, where the body is behind the wheel
    p.holder.visible = !p.vehicle && this.cameraRig.fpBlend < 0.75;

    this.hud.update(dt);
    this.input.endFrame();
  }
}

const world = new World();
window.world = world;
world.init().catch(err => {
  console.error(err);
  bootMsg.textContent = 'failed to start — ' + err.message;
  bootMsg.style.color = '#ff6b86';
});
