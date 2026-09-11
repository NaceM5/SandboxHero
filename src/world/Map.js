import * as THREE from 'three';
import { createMapData } from './tideline/map-data.js';
import { buildWorld } from './tideline/world.js';
import { setNight as setMaterialNight } from './tideline/materials.js';
import { SurfaceField } from './Terrain.js';
import { ColliderSet, makeBox, makePrism, makeRamp, inFootprint, topAt, baseAt, closestPoint, ejectInside } from './Colliders.js';
import { Furniture } from './Furniture.js';
import { clamp } from '../core/Util.js';

/**
 * World-scale constants shared by the gameplay systems. Populated from the
 * map manifest by `GameMap` before anything else is constructed; the cell
 * grid is only a coarse bookkeeping lattice (crime density, crowd density),
 * not a street grid.
 */
export const WORLD = {
  CELL: 140,
  BI: 1, BJ: 1, BLOCKS: 1,
  X0: 0, Z0: 0,
  WATER_Y: 0,
  CEILING: 1100,
  BOUNDS: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 },
  configure (data) {
    const [minX, , minZ] = data.bounds.min, [maxX, , maxZ] = data.bounds.max;
    this.X0 = minX - 200; this.Z0 = minZ - 200;
    this.BI = Math.ceil((maxX + 200 - this.X0) / this.CELL);
    this.BJ = Math.ceil((maxZ + 200 - this.Z0) / this.CELL);
    this.BLOCKS = this.BI * this.BJ;
    this.WATER_Y = data.water.height;
    this.BOUNDS = { minX: minX - 350, maxX: maxX + 350, minZ: minZ - 350, maxZ: maxZ + 350 };
    this.CEILING = data.bounds.max[1] + 340;
  },
  cellIndex (x, z) {
    const i = Math.floor((x - this.X0) / this.CELL), j = Math.floor((z - this.Z0) / this.CELL);
    if (i < 0 || j < 0 || i >= this.BI || j >= this.BJ) return -1;
    return j * this.BI + i;
  },
  cellCenter (i, j) {
    return { x: this.X0 + (i + 0.5) * this.CELL, z: this.Z0 + (j + 0.5) * this.CELL };
  }
};

const _cp = { x: 0, z: 0, inside: false };
const _n = { x: 0, z: 0 };
const _tmp = { x: 0, z: 0 };
const _nrm = new THREE.Vector3();

/**
 * The Tideline map as the game sees it: rendered geometry, exact ground
 * queries, collision against every solid in the manifest, street furniture,
 * water, and the spawn / density data the AI systems ask for.
 *
 * Built in stages so the boot screen can yield between them.
 */
export class GameMap {
  constructor (scene) {
    this.scene = scene;
    this.data = createMapData();
    this._addBridgeFootways(this.data);
    WORLD.configure(this.data);
    const pond = this.data.islands[1].pond;
    this.pond = { x: pond.x, z: pond.z, rx: pond.rx, rz: pond.rz, height: pond.height };
    this.landmarks = this.data.landmarks;
    this.props = [];
    this.group = new THREE.Group();
    this.group.name = 'Tideline';
    scene.add(this.group);
  }

  /**
   * The map's bridge footways are flush with the carriageway. Raise them onto
   * a kerb — a slab on the deck, graded strips on both approaches — so they
   * read as pavements and keep cars off them. Added to the manifest before
   * anything is built, so they get geometry and collision like everything
   * else.
   */
  _addBridgeFootways (data) {
    const deck = data.boxes.find(b => b.name === 'Bridge deck');
    if (!deck) return;
    const top = deck.y + deck.h / 2, lift = 0.3;
    let seq = 900000;
    for (const z of [deck.z - 24, deck.z + 24]) {
      data.boxes.push({ id: `game-${seq++}`, name: 'Bridge footway', x: deck.x, y: top + lift / 2, z, w: deck.w, h: lift, d: 8, material: 'sidewalk', solid: true, kind: 'surface' });
    }
    for (const r of [...data.ramps]) {
      if (!/bridge approach/i.test(r.name) || r.kind === 'barrier') continue;
      for (const side of [-1, 1]) {
        data.ramps.push({ id: `game-${seq++}`, name: r.name + ' footway', x1: r.x1, x2: r.x2, z: r.z + side * 24, width: 8, y1: r.y1 + lift, y2: r.y2 + lift, thickness: lift, material: 'sidewalk', kind: 'footway' });
      }
    }
  }

  /**
   * True when something solid — a bridge deck, a ramp, a canopy — hangs over
   * this point within `reach` metres above `y`. Spawning nothing under there
   * keeps the crowd and the traffic off the underside of the bridge.
   */
  covered (x, z, y, reach = 60) {
    const list = this.colliders.near(x, z, 0.5);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.slim || b.floorOnly || b.base <= y + 1.5 || b.base > y + reach) continue;
      if (!inFootprint(b, x, z)) continue;
      if (baseAt(b, x, z) > y + 1.5) return true;
    }
    return false;
  }

  /* ================= build stages ================= */

  buildVisuals () {
    this.world = buildWorld(this.data, { collision: false, water: false });
    this.group.add(this.world.group);
  }

  buildCollision () {
    // exact ground: the terrain triangles, then the road ribbons laid over them
    this.terrain = new SurfaceField(16);
    this.surfaces = new SurfaceField(16);
    for (const t of this.world.terrains) { this.terrain.addGeometry(t.geometry); this.surfaces.addGeometry(t.geometry); }
    for (const r of this.world.roadSurfaces) this.surfaces.addGeometry(r.geometry);

    this.colliders = new ColliderSet(40);
    for (const b of this.data.boxes) {
      if (!b.solid) continue;
      const base = b.y - b.h / 2, top = b.y + b.h / 2;
      const building = !!b.building || b.name === 'Downtown building';
      if (b.shape === 'prism') {
        this.colliders.add(makePrism({ x: b.x, z: b.z, outline: b.outline, base, top, rotation: b.rotation, name: b.name, building }));
      } else {
        this.colliders.add(makeBox({
          x: b.x, z: b.z, w: b.w, d: b.d, base, top, rotation: b.rotation, name: b.name, building, material: b.material,
          roof: b.roofShape && b.roofShape !== 'flat' ? b.roofShape : null,
          floorOnly: b.kind === 'surface' && b.h <= 0.5
        }));
      }
    }
    for (const r of this.data.ramps) this.colliders.add(makeRamp(r));
    this._buildDensity();
    this._buildRooftops();
    this._buildSites();
  }

  buildFurniture (roads) {
    this.roads = roads;
    this.furniture = new Furniture(this, roads);
    this.props = this.furniture.props;
    this._buildCellWalk(roads);
    this._weighWalkNodes(roads);
  }

  buildWater () {
    const uniforms = this.waterUniforms = {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x1b4655) },
      uDeep: { value: new THREE.Color(0x061a27) },
      uSky: { value: new THREE.Color(0x88a8d0) },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uFog: { value: new THREE.Color(0x8fa8c0) },
      uFogDensity: { value: 0.0009 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vW;
        void main () {
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vW;
        uniform float uTime;
        uniform vec3 uShallow, uDeep, uSky, uSun, uSunCol, uFog;
        uniform float uFogDensity;
        float wave (vec2 p, float t) {
          return sin(p.x * 0.07 + t * 0.9) * 0.5 + sin(p.y * 0.053 - t * 0.7) * 0.5
               + sin((p.x + p.y) * 0.031 + t * 1.3) * 0.35;
        }
        void main () {
          vec3 V = normalize(cameraPosition - vW);
          float t = uTime;
          float e = 1.5;
          float h = wave(vW.xz, t);
          float nx = wave(vW.xz + vec2(e, 0.0), t) - h;
          float nz = wave(vW.xz + vec2(0.0, e), t) - h;
          vec3 Nn = normalize(vec3(-nx * 0.35, 1.0, -nz * 0.35));
          float fres = pow(1.0 - max(dot(Nn, V), 0.0), 3.0);
          float depth = smoothstep(80.0, 700.0, abs(vW.x) * 0.9 + abs(vW.z + 60.0) * 0.3);
          vec3 base = mix(uShallow, uDeep, depth);
          vec3 col = mix(base, uSky, clamp(fres * 0.55 + 0.05, 0.0, 0.72));
          vec3 R = reflect(-V, Nn);
          float sd2 = max(dot(R, normalize(uSun)), 0.0);
          col += uSunCol * pow(sd2, 260.0) * 1.8;
          col += uSunCol * pow(sd2, 16.0) * 0.09;
          float dist = length(cameraPosition - vW);
          float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
          col = mix(col, uFog, clamp(f, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000, 1, 1), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-200, WORLD.WATER_Y, 200);
    sea.renderOrder = -5;
    sea.frustumCulled = false;
    this.group.add(sea);
    const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 72), mat);
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(this.pond.rx, this.pond.rz, 1);
    lake.position.set(this.pond.x, this.pond.height, this.pond.z);
    lake.renderOrder = -5;
    this.group.add(lake);
    this.water = sea;
    this.lake = lake;
  }

  /* ================= derived data ================= */

  /** Built volume per bookkeeping cell, 0..1 on a cube-root curve. */
  _buildDensity () {
    this.blockDensity = new Float32Array(WORLD.BLOCKS);
    for (const b of this.colliders.all) {
      if (!b.building) continue;
      const k = WORLD.cellIndex((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      if (k < 0) continue;
      this.blockDensity[k] += (b.maxX - b.minX) * (b.maxZ - b.minZ) * (b.top - b.base);
    }
    let max = 0;
    for (const v of this.blockDensity) if (v > max) max = v;
    if (max > 0) for (let i = 0; i < this.blockDensity.length; i++) this.blockDensity[i] = Math.pow(this.blockDensity[i] / max, 1 / 3);
  }

  /** Flat roofs the player can be dropped onto at the start. */
  _buildRooftops () {
    this.rooftops = [];
    for (const b of this.data.boxes) {
      if (!(b.building || b.name === 'Downtown building') || b.rotation || b.shape) continue;
      if (b.h < 24 || b.h > 110 || Math.min(b.w, b.d) < 22) continue;
      const y = this.groundHeight(b.x, b.z);
      this.rooftops.push({ x: b.x, z: b.z, y, w: b.w, d: b.d });
    }
    // where the hero first stands: a mid-rise roof near the downtown core
    this.downtown = { x: -1850, z: -170 };
  }

  /** Landmark interiors and decks where crimes stage themselves. */
  _buildSites () {
    const L = this.landmarks;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const sites = [];
    // the carrier is garrisoned by the scenario system instead (no marker)
    if (L.carrier && false) {
      const s = L.carrier, c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
      const local = (x, z) => [s.x + c * x + sn * z, s.z - sn * x + c * z];
      const posts = [[-18, -150], [8, -90], [-22, -30], [12, 30], [-26, 90], [6, 140], [-10, 165]].map(([x, z]) => {
        const [wx, wz] = local(x, z);
        return V(wx, s.deckHeight, wz);
      });
      sites.push({ name: 'carrier', label: 'Aircraft carrier', weight: 2.6, posts, floor: s.deckHeight });
    }
    if (L.tower) {
      const f = L.tower.penthouseFloor;
      sites.push({
        name: 'penthouse', label: 'Aeris penthouse', weight: 1.1, floor: f,
        posts: [V(-2060, f, -166), V(-2090, f, -201), V(-2036, f, -201), V(-2058, 416, -140), V(-2000, 416, -180), V(-2150, 416, -180)]
      });
      sites.push({
        name: 'lobby', label: 'Aeris lobby', weight: 0.6, floor: 8.3,
        posts: [V(-2090, 8.3, -200), V(-2070, 8.3, -170), V(-2110, 8.3, -170), V(-2090, 8.28, -240), V(-2050, 8.28, -250)]
      });
    }
    if (L.mansion) {
      const f = L.mansion.floor;
      sites.push({
        name: 'estate', label: 'Headland House', weight: 0.7, floor: f,
        posts: [V(-3270, f, 1010), V(-3280, f, 985), V(-3255, f, 985), V(-3270, 124.28, 1066), V(-3232, 124.3, 1000), V(-3250, 124.3, 1050)]
      });
    }
    this.crimeSites = sites;
  }

  _buildCellWalk (roads) {
    this.cellWalk = new Array(WORLD.BLOCKS).fill(null);
    for (const w of roads.walkNodes) {
      const k = WORLD.cellIndex(w.x, w.z);
      if (k < 0) continue;
      (this.cellWalk[k] ||= []).push(w);
    }
  }

  /** How busy a footway is: the built volume within a block or so of it. */
  _weighWalkNodes (roads) {
    let max = 0;
    for (const w of roads.walkNodes) {
      let v = 0;
      for (const b of this.colliders.near(w.x, w.z, 95)) {
        if (!b.building) continue;
        v += (b.maxX - b.minX) * (b.maxZ - b.minZ) * Math.min(b.top - b.base, 120);
      }
      w.busy = v;
      if (v > max) max = v;
    }
    for (const w of roads.walkNodes) w.busy = w.edge.rare ? 0.02 : 0.08 + 0.92 * Math.pow(w.busy / (max || 1), 1 / 3);
  }

  walkNodesInCell (bi, bj) {
    if (bi < 0 || bj < 0 || bi >= WORLD.BI || bj >= WORLD.BJ) return null;
    return this.cellWalk[bj * WORLD.BI + bi];
  }

  /** Built-up weight at a point, 0..1. */
  zoneAt (x, z) {
    const k = WORLD.cellIndex(x, z);
    return k < 0 ? 0 : this.blockDensity[k];
  }

  /* ================= lighting / water ================= */

  setNightFactor (n) {
    setMaterialNight(n);
    this.furniture?.setNight(n);
  }

  updateWater (dt, sunDir, sunCol, skyCol, fog) {
    this.world.updateHelicarrier(dt);
    const u = this.waterUniforms;
    if (!u) return;
    u.uTime.value += dt;
    if (sunDir) u.uSun.value.copy(sunDir);
    if (sunCol) u.uSunCol.value.copy(sunCol);
    if (skyCol) u.uSky.value.copy(skyCol);
    if (fog) { u.uFog.value.copy(fog.color); u.uFogDensity.value = fog.density; }
  }

  /* ================= ground ================= */

  /** Water surface height at a point — the sea, or the hill lake. */
  waterLevel (x, z) {
    const p = this.pond;
    const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz;
    return dx * dx + dz * dz < 1.05 ? p.height : WORLD.WATER_Y;
  }

  /** Open water: nowhere on the terrain mesh covers this point. */
  isWater (x, z) {
    return this.terrain.heightAt(x, z) === null;
  }

  /**
   * Where something placed "on the ground" at (x,z) goes: the highest surface
   * within a few metres of the terrain — pavement, road slab, plinth — but
   * never a roof, a bridge deck or the helicarrier hovering 900 m overhead.
   */
  streetHeight (x, z) {
    return this.groundHeight(x, z, this.groundSurface(x, z) + 6);
  }

  /** The rendered terrain only — no roads, no structures. */
  groundSurface (x, z) {
    const t = this.terrain.heightAt(x, z);
    return t === null ? this.waterLevel(x, z) : t;
  }

  /**
   * Highest standable surface under (x,z) at or below `ceiling`. The terrain
   * itself ignores the ceiling: nothing is ever legitimately under a hill, so
   * a query from inside one reports the hillside rather than the sea — which
   * is what lets flight treat a cliff face as a wall instead of tunnelling.
   */
  groundHeight (x, z, ceiling = Infinity) {
    let best = this.surfaces.heightAt(x, z, ceiling);
    if (best === null) {
      const t = this.terrain.heightAt(x, z);
      best = t !== null && t > ceiling ? t : this.waterLevel(x, z);
    }
    const list = this.colliders.near(x, z, 0.4);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.slim || b.top <= best) continue;
      if (!inFootprint(b, x, z)) continue;
      const t = topAt(b, x, z);
      if (t > best && t <= ceiling) best = t;
    }
    return best;
  }

  /**
   * Lowest solid underside over (x,z) at or above `y`, or null. Floor slabs
   * count — they are floors from above and ceilings from below — so nothing
   * can fly up through a storey or a roof.
   */
  ceilingHeight (x, z, y) {
    let best = null;
    const list = this.colliders.near(x, z, 0.4);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.slim || b.top <= y) continue;
      if (!inFootprint(b, x, z)) continue;
      const base = baseAt(b, x, z);
      if (base >= y && (best === null || base < best)) best = base;
    }
    return best;
  }

  /** Upward normal of whatever the ground is at (x,z). */
  groundNormal (x, z, out = _nrm) {
    return this.surfaces.normalAt(x, z, out) || out.set(0, 1, 0);
  }

  /* ================= collision ================= */

  /** Push a vertical capsule out of any solid it has entered. */
  resolveCollision (pos, radius, feetY, headY, skipSlim = false, stepUp = 0) {
    let hit = false;
    const list = this.colliders.near(pos.x, pos.z, radius + 0.6);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.floorOnly || (skipSlim && b.slim)) continue;
      if (feetY >= b.top - 0.05 || headY <= b.base) continue;
      closestPoint(b, pos.x, pos.z, _cp);
      let dx = 0, dz = 0, d2 = 0;
      if (!_cp.inside) {
        dx = pos.x - _cp.x; dz = pos.z - _cp.z; d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
      }
      const tx = _cp.inside ? pos.x : _cp.x, tz = _cp.inside ? pos.z : _cp.z;
      const top = topAt(b, tx, tz), base = baseAt(b, tx, tz);
      // A sloping surface is a floor, not a wall: a probe a few centimetres
      // below a ramp or roof ahead of the body is standing on it, and treating
      // that as contact ejected cars sideways off the bridge approaches.
      const lip = (b.kind === 'ramp' || b.roof) ? 0.6 : 0.05;
      if (feetY >= top - lip || headY <= base) continue;
      if (stepUp > 0 && top <= feetY + stepUp) continue;
      hit = true;
      if (!_cp.inside && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = _cp.x + (dx / d) * radius;
        pos.z = _cp.z + (dz / d) * radius;
      } else {
        _tmp.x = pos.x; _tmp.z = pos.z;
        ejectInside(b, _tmp, radius, _n);
        pos.x = _tmp.x; pos.z = _tmp.z;
      }
    }
    return hit;
  }

  /** Collide a moving sphere with the solids and reflect its velocity. */
  bounceMoving (pos, vel, radius, restitution = 0.42) {
    let hit = false;
    const feet = pos.y - radius, head = pos.y + radius;
    const list = this.colliders.near(pos.x, pos.z, radius + 0.6);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.floorOnly) continue;
      if (feet >= b.top || head <= b.base) continue;
      closestPoint(b, pos.x, pos.z, _cp);
      let dx = 0, dz = 0, d2 = 0;
      if (!_cp.inside) {
        dx = pos.x - _cp.x; dz = pos.z - _cp.z; d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
      }
      const tx = _cp.inside ? pos.x : _cp.x, tz = _cp.inside ? pos.z : _cp.z;
      const top = topAt(b, tx, tz), base = baseAt(b, tx, tz);
      if (feet >= top - ((b.kind === 'ramp' || b.roof) ? 0.4 : 0) || head <= base) continue;

      let nx = 0, ny = 0, nz = 0;
      if (!_cp.inside && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d;
        pos.x = _cp.x + nx * radius;
        pos.z = _cp.z + nz * radius;
      } else {
        _tmp.x = pos.x; _tmp.z = pos.z;
        ejectInside(b, _tmp, radius, _n);
        const side = Math.hypot(_tmp.x - pos.x, _tmp.z - pos.z) - radius;
        const up = top - pos.y;
        if (up <= side) { pos.y = top + radius; ny = 1; }
        else { pos.x = _tmp.x; pos.z = _tmp.z; nx = _n.x; nz = _n.z; }
      }
      const into = vel.x * nx + vel.y * ny + vel.z * nz;
      if (into < 0) {
        vel.x -= (1 + restitution) * into * nx;
        vel.y -= (1 + restitution) * into * ny;
        vel.z -= (1 + restitution) * into * nz;
        vel.multiplyScalar(0.86);
      }
      hit = true;
    }
    return hit;
  }

  /** True when this point is inside something solid (terrain excluded). */
  pointInSolid (x, y, z, pad = 0) {
    const list = this.colliders.near(x, z, pad + 0.3);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.slim || b.floorOnly) continue;
      if (y <= b.base - pad || y >= b.top + pad) continue;
      if (!inFootprint(b, x, z, pad)) continue;
      if (y > baseAt(b, x, z) - pad && y < topAt(b, x, z) + pad) return true;
    }
    return false;
  }

  /** True when nothing solid — structure or hillside — stands between two points. */
  hasLineOfSight (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.6) return true;
    const STEP = 0.9;
    const n = Math.min(420, Math.ceil(dist / STEP));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
      const g = this.terrain.heightAt(px, pz);
      if (g !== null && py < g) return false;
      if (this.pointInSolid(px, py, pz, 0)) return false;
    }
    return true;
  }

  /** How far the camera can pull back from `pivot` along `dir` before hitting anything. */
  cameraClearance (pivot, dir, maxDist, radius = 0.34) {
    const STEP = 0.3;
    const n = Math.ceil(maxDist / STEP);
    for (let k = 1; k <= n; k++) {
      const t = Math.min(maxDist, k * STEP);
      const px = pivot.x + dir.x * t, py = pivot.y + dir.y * t, pz = pivot.z + dir.z * t;
      const g = this.terrain.heightAt(px, pz);
      if (g !== null && py < g + radius) return Math.max(0, t - STEP - 0.05);
      if (this.pointInSolid(px, py, pz, radius)) return Math.max(0, t - STEP - 0.05);
    }
    return maxDist;
  }

  /** First solid along a ray (structures and terrain), or null. */
  raycastBuildings (origin, dir, maxDist) {
    const step = 3;
    const n = Math.ceil(maxDist / step);
    for (let k = 1; k <= n; k++) {
      const t = Math.min(maxDist, k * step);
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const g = this.terrain.heightAt(px, pz);
      if (g !== null && py < g) return { dist: t, building: null, terrain: true };
      const list = this.colliders.near(px, pz, 0.3);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.floorOnly || py <= b.base || py >= b.top) continue;
        if (!inFootprint(b, px, pz)) continue;
        if (py > baseAt(b, px, pz) && py < topAt(b, px, pz)) return { dist: t, building: b };
      }
    }
    return null;
  }

  /* ================= props ================= */

  propsNear (x, z, r) { return this.furniture ? this.furniture.propsNear(x, z, r) : []; }
  detachProp (prop) { return this.furniture ? this.furniture.detachProp(prop) : null; }
}
