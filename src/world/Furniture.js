import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, Noise } from '../core/Util.js';
import { insidePolygon } from './tideline/terrain.js';
import { makeBox, inFootprint } from './Colliders.js';

const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);
const _invM = new THREE.Matrix4(), _pivotM = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s1 = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/**
 * Street furniture for the Tideline map.
 *
 * The map deliberately ships without trees, lamps, benches, bins or hydrants
 * so they can be gameplay objects rather than baked scenery. Everything here
 * is a prop the player can knock over, pick up with telekinesis and throw:
 * each one registers a slim collider and keeps a handle on its instanced-mesh
 * slot so it can be torn out of the batch and handed to the physics system.
 *
 * Placement reads the road graph (footways), the housing lots, the parks and
 * squares reserved in the manifest, and the lake shore — and stays off
 * carriageways, driveways and building footprints. Open ground on both
 * islands is then filled with woodland — copses and clearings shaped by
 * noise, thickest around the city fringe and the headland estate — and
 * boulders are scattered along the shores, across steep slopes and around the
 * headland cliffs.
 */
export class Furniture {
  constructor (map, roads) {
    this.map = map;
    this.roads = roads;
    this.scene = map.scene;
    this.props = [];
    this.rng = new Rng(20260909);
    this._grid = new Map();     // 4 m occupancy cells, keeps props apart
    this._buildAssets();
    this._indexLots();
    this._streets();
    this._lots();
    this._parks();
    this._lakeShore();
    this._rocks();
    this._woodland();
    this._batch();
  }

  /* ================= geometry ================= */

  _buildAssets () {
    const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const cyl = (rt, rb, h, n, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, n).translate(x, y, z);
    const merge = (...g) => mergeGeometries(g.map(x => x.toNonIndexed()), false);

    this.lampGeo = merge(box(0.26, 7.4, 0.26, 0, 3.7, 0), box(0.2, 0.36, 2.0, 0, 7.0, 0.9));
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.65, metalness: 0.5 });
    this.bulbGeo = new THREE.SphereGeometry(0.34, 10, 7).scale(1.5, 0.6, 1.9);
    this.bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0cf, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 2.4, roughness: 0.3
    });

    this.trunkGeo = box(0.42, 3.0, 0.42, 0, 1.5, 0);
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 });
    this.species = [
      { geo: new THREE.IcosahedronGeometry(1.9, 1), trunk: 3.2, r: 2.3 },
      { geo: new THREE.IcosahedronGeometry(2.5, 0), trunk: 2.3, r: 2.8 },
      { geo: new THREE.ConeGeometry(1.75, 5.6, 7), trunk: 2.0, r: 2.0 },
      { geo: new THREE.DodecahedronGeometry(1.75, 0), trunk: 4.0, r: 2.1 }
    ];
    this.leafMats = ['#3e6b34', '#4a7a3a', '#33582c', '#5c8442'].map(c =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.92, flatShading: true }));
    // Woodland is tens of thousands of trees, so each one is a single merged
    // trunk-and-canopy geometry with baked vertex colours, drawn with one
    // material and tinted per instance — one draw call per species per tile.
    const tint = (g, hex) => {
      const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const woodTree = (canopy, trunkH, r) => ({
      geo: merge(
        tint(box(0.42, trunkH, 0.42, 0, trunkH / 2, 0), '#4a3826'),
        tint(canopy.translate(0, trunkH * 1.05, 0), '#4a7a3a')),
      trunk: trunkH, r
    });
    this.woodSpecies = [
      woodTree(new THREE.IcosahedronGeometry(2.0, 0), 3.0, 2.4),
      woodTree(new THREE.ConeGeometry(1.9, 6.2, 6), 2.1, 2.1),
      woodTree(new THREE.DodecahedronGeometry(1.8, 0), 3.8, 2.1)
    ];
    this.woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, flatShading: true });
    this.bushGeo = tint(new THREE.IcosahedronGeometry(1, 0).scale(1.15, 0.85, 1.15).translate(0, 0.7, 0), '#4d7d3c');
    this.bushMat = this.woodMat;


    // Boulders: jittered icosahedra with baked grey vertex colours, tinted per instance.
    this.rockGeos = [0, 1, 2].map(k => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position, seed = 17 + k * 31;
      const jit = i => { const v = Math.sin(i * 12.9898 + seed) * 43758.5453; return v - Math.floor(v); };
      for (let i = 0; i < p.count; i++) {
        const r = 0.72 + jit(i) * 0.4;
        p.setXYZ(i, p.getX(i) * r * 1.15, p.getY(i) * r * 0.68 + 0.3, p.getZ(i) * r);
      }
      g.computeVertexNormals();
      return tint(g, '#8a8578');
    });
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true });

    this.benchGeo = merge(
      box(1.8, 0.08, 0.5, 0, 0.45, 0), box(1.8, 0.5, 0.06, 0, 0.72, -0.24),
      box(0.08, 0.45, 0.45, -0.8, 0.225, 0), box(0.08, 0.45, 0.45, 0.8, 0.225, 0));
    this.benchMat = new THREE.MeshStandardMaterial({ color: 0x6d4f36, roughness: 0.85 });

    this.binGeo = merge(cyl(0.32, 0.29, 0.95, 10, 0, 0.475, 0), cyl(0.35, 0.35, 0.06, 10, 0, 0.98, 0));
    this.binMat = new THREE.MeshStandardMaterial({ color: 0x2f4a36, roughness: 0.7, metalness: 0.3 });

    this.hydrantGeo = merge(cyl(0.15, 0.17, 0.75, 8, 0, 0.375, 0),
      new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.78, 0), box(0.5, 0.12, 0.12, 0, 0.45, 0));
    this.hydrantMat = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6, metalness: 0.25 });
  }

  /* ================= placement helpers ================= */

  _occupied (x, z, r) {
    const c = 4;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const l = this._grid.get(cx * 100003 + cz);
        if (!l) continue;
        for (const p of l) if (Math.hypot(p.x - x, p.z - z) < r) return true;
      }
    }
    return false;
  }

  _occupy (x, z) {
    const k = Math.floor(x / 4) * 100003 + Math.floor(z / 4);
    if (!this._grid.has(k)) this._grid.set(k, []);
    this._grid.get(k).push({ x, z });
  }

  /** Bucket the housing lots so woodland can stay out of gardens. */
  _indexLots () {
    this._lotGrid = new Map();
    for (const lot of this.map.data.lots) {
      lot.radius = Math.hypot(lot.w, lot.d) / 2;
      const k = Math.floor(lot.x / 100) * 100003 + Math.floor(lot.z / 100);
      if (!this._lotGrid.has(k)) this._lotGrid.set(k, []);
      this._lotGrid.get(k).push(lot);
    }
  }

  _onLot (x, z, pad = 2) {
    const cx = Math.floor(x / 100), cz = Math.floor(z / 100);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const l = this._lotGrid.get((cx + dx) * 100003 + (cz + dz));
        if (!l) continue;
        for (const lot of l) {
          if (Math.hypot(x - lot.x, z - lot.z) > lot.radius + pad) continue;
          const c = Math.cos(lot.rotation), s = Math.sin(lot.rotation);
          const u = c * (x - lot.x) - s * (z - lot.z), v = s * (x - lot.x) + c * (z - lot.z);
          if (Math.abs(u) < lot.w / 2 + pad && Math.abs(v) < lot.d / 2 + pad) return true;
        }
      }
    }
    return false;
  }

  /** On a made surface — a slab of paving, a pier, a freight apron? */
  _onPaving (x, z) {
    for (const b of this.map.colliders.near(x, z, 0.3)) {
      if (!b.floorOnly || b.slim) continue;
      if (['lawn', 'grass', 'dryLawn', 'gravel', 'track'].includes(b.material)) continue;
      if (inFootprint(b, x, z)) return true;
    }
    return false;
  }

  /** Inside any structure footprint (buildings, walls, piers, decks…)? */
  _inStructure (x, z, pad = 0.8) {
    for (const b of this.map.colliders.near(x, z, pad + 0.3)) {
      if (b.slim || b.floorOnly) continue;
      if (inFootprint(b, x, z, pad)) return true;
    }
    return false;
  }

  /** Within a carriageway (any road edge, plus `extra` metres)? */
  _onRoad (x, z, extra = 1.5) {
    if (!this._edgeGrid) {
      // bucket the streets on a 200 m grid: this is asked a hundred thousand times
      this._edgeGrid = new Map();
      for (const e of this.roads.edges) {
        const m = e.width / 2 + 8;
        for (let cx = Math.floor((e.minX - m) / 200); cx <= Math.floor((e.maxX + m) / 200); cx++) {
          for (let cz = Math.floor((e.minZ - m) / 200); cz <= Math.floor((e.maxZ + m) / 200); cz++) {
            const k = cx * 100003 + cz;
            if (!this._edgeGrid.has(k)) this._edgeGrid.set(k, []);
            this._edgeGrid.get(k).push(e);
          }
        }
      }
    }
    const list = this._edgeGrid.get(Math.floor(x / 200) * 100003 + Math.floor(z / 200));
    if (!list) return false;
    for (const e of list) {
      const m = e.width / 2 + extra;
      if (x < e.minX - m || x > e.maxX + m || z < e.minZ - m || z > e.maxZ + m) continue;
      const pts = e.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < m) return true;
      }
    }
    return false;
  }

  _nearDriveway (x, z, r = 3.5) {
    if (!this._dwGrid) {
      this._dwGrid = new Map();
      for (const d of this.map.data.driveways) {
        const a = d.points[0];
        const k = Math.floor(a[0] / 100) * 100003 + Math.floor(a[1] / 100);
        if (!this._dwGrid.has(k)) this._dwGrid.set(k, []);
        this._dwGrid.get(k).push(d);
      }
    }
    const cx = Math.floor(x / 100), cz = Math.floor(z / 100);
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const dws = this._dwGrid.get((cx + gx) * 100003 + (cz + gz));
        if (!dws) continue;
        for (const d of dws) {
          const a = d.points[0], b = d.points[1];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
          if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < r) return true;
        }
      }
    }
    return false;
  }

  /** Can a prop stand here? */
  _free (x, z, r = 2.4, o = {}) {
    if (this.map.isWater(x, z)) return false;
    if (this._occupied(x, z, r)) return false;
    if (this._inStructure(x, z, o.pad ?? 0.8)) return false;
    if (o.road !== false && this._onRoad(x, z, o.roadPad ?? 1.5)) return false;
    if (o.driveway !== false && this._nearDriveway(x, z)) return false;
    if (o.lots && this._onLot(x, z)) return false;
    if (o.paving && this._onPaving(x, z)) return false;
    const p = this.map.pond;
    if (Math.hypot((x - p.x) / (p.rx + 14), (z - p.z) / (p.rz + 14)) < 1) return false;
    return true;
  }

  /* ================= prop factories ================= */

  _register (x, z, r, base, top, kind) {
    return this.map.colliders.add(makeBox({ x, z, w: r * 2, d: r * 2, base, top, slim: true, name: kind }));
  }

  _lamp (x, z, yaw, y) {
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _p.set(x, y, z);
    const base = new THREE.Matrix4().compose(_p, _q, _s1);
    const bulbP = _p.clone();
    bulbP.y += 7.05; bulbP.x += Math.sin(yaw) * 1.75; bulbP.z += Math.cos(yaw) * 1.75;
    this.props.push({
      kind: 'lamp', yaw, alive: true, collider: this._register(x, z, 0.5, y, y + 7.4, 'lamp'),
      pos: _p.clone(), center: new THREE.Vector3(x, y + 3.7, z),
      pivotY: 3.7, radius: 1.6, mass: 1.0, base,
      parts: [
        { geo: this.lampGeo, mat: this.lampMat, matrix: base },
        { geo: this.bulbGeo, mat: this.bulbMat, matrix: new THREE.Matrix4().compose(bulbP, _q, _s1) }
      ]
    });
    this._occupy(x, z);
  }

  /** A forest tree: one instance, one merged geometry, a random tint. */
  _woodTree (x, z, y, scale = 1.18) {
    const rng = this.rng;
    const sp = this.woodSpecies[rng.int(0, this.woodSpecies.length - 1)];
    const grow = rng.range(0.8, 1.3) * scale;
    const trunkH = sp.trunk * grow;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.05, 0.05), rng.range(0, Math.PI * 2), rng.range(-0.05, 0.05)));
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q,
      new THREE.Vector3(grow * rng.range(0.85, 1.15), grow * rng.range(0.9, 1.2), grow * rng.range(0.85, 1.15)));
    const k = rng.range(0.78, 1.12);
    const color = new THREE.Color(k * rng.range(0.85, 1.05), k, k * rng.range(0.8, 1.0));
    this.props.push({
      kind: 'tree', yaw: 0, alive: true, collider: this._register(x, z, 0.7 * grow, y, y + trunkH, 'tree'),
      pos: new THREE.Vector3(x, y, z), center: new THREE.Vector3(x, y + trunkH * 1.05, z),
      pivotY: trunkH, radius: sp.r * grow, mass: 1.4, base,
      far: { r: sp.r * grow * 1.05, color: new THREE.Color(0x4a7a3a).multiply(color) },
      parts: [{ geo: sp.geo, mat: this.woodMat, matrix: base, color }]
    });
    this._occupy(x, z);
  }

  _tree (x, z, y, scale = 1) {
    const rng = this.rng;
    const sp = this.species[rng.int(0, this.species.length - 1)];
    const leafMat = this.leafMats[rng.int(0, this.leafMats.length - 1)];
    const grow = rng.range(0.82, 1.26) * scale;
    const trunkH = sp.trunk * grow;
    const tp = new THREE.Vector3(x, y, z);
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.05, 0.05), rng.range(0, Math.PI * 2), rng.range(-0.05, 0.05)));
    const base = new THREE.Matrix4().compose(tp, lean, new THREE.Vector3(grow, trunkH / 3.0, grow));
    const lp = tp.clone(); lp.y += trunkH * 1.05;
    const ls = new THREE.Vector3(grow * rng.range(0.85, 1.15), grow * rng.range(0.9, 1.25), grow * rng.range(0.85, 1.15));
    const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18)));
    this.props.push({
      kind: 'tree', yaw: 0, alive: true, collider: this._register(x, z, 0.7 * grow, y, y + trunkH, 'tree'),
      pos: tp, center: new THREE.Vector3(x, y + trunkH * 1.05, z),
      pivotY: trunkH, radius: sp.r * grow, mass: 1.4, base,
      far: { r: sp.r * grow, color: leafMat.color },
      parts: [
        { geo: this.trunkGeo, mat: this.trunkMat, matrix: base },
        { geo: sp.geo, mat: leafMat, matrix: new THREE.Matrix4().compose(lp, lq, ls) }
      ]
    });
    this._occupy(x, z);
  }

  _registerSolid (x, z, r, base, top, kind) {
    return this.map.colliders.add(makeBox({ x, z, w: r * 2, d: r * 2, base, top, name: kind }));
  }

  /** A boulder: solid enough to stand on, heavy enough to be a weapon. */
  _rock (x, z, y, s) {
    const rng = this.rng;
    const geo = this.rockGeos[rng.int(0, this.rockGeos.length - 1)];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.25, 0.25), rng.range(0, Math.PI * 2), rng.range(-0.25, 0.25)));
    const sc = new THREE.Vector3(s * rng.range(0.8, 1.3), s * rng.range(0.7, 1.1), s * rng.range(0.8, 1.3));
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.15 * s, z), q, sc);
    const k = rng.range(0.7, 1.15);
    const color = new THREE.Color(k * rng.range(0.95, 1.05), k, k * rng.range(0.95, 1.08));
    const h = 0.95 * sc.y, r = 0.95 * Math.max(sc.x, sc.z);
    this.props.push({
      kind: 'rock', yaw: 0, alive: true, collider: this._registerSolid(x, z, r * 0.8, y - 0.2, y + h, 'rock'),
      pos: new THREE.Vector3(x, y, z), center: new THREE.Vector3(x, y + h * 0.5, z),
      pivotY: h * 0.5, radius: r, mass: 1.6 + s * 1.4, base,
      far: s >= 1.6 ? { r: r * 0.9, color: new THREE.Color(0x8a8578).multiply(color) } : null,
      parts: [{ geo, mat: this.rockMat, matrix: base, color }]
    });
    this._occupy(x, z);
  }

  _bush (x, z, y) {
    const rng = this.rng;
    const sc = rng.range(0.7, 1.5);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc * rng.range(0.85, 1.2), sc, sc * rng.range(0.85, 1.2)));
    const k = rng.range(0.75, 1.15);
    const color = new THREE.Color(k * rng.range(0.85, 1.05), k, k * rng.range(0.8, 1.0));
    this.props.push({
      kind: 'bush', yaw: 0, alive: true, collider: this._register(x, z, 0.55 * sc, y, y + 1.4 * sc, 'bush'),
      pos: new THREE.Vector3(x, y, z), center: new THREE.Vector3(x, y + 0.7 * sc, z),
      pivotY: 0.7 * sc, radius: 1.1 * sc, mass: 0.6, base,
      parts: [{ geo: this.bushGeo, mat: this.bushMat, matrix: base, color }]
    });
    this._occupy(x, z);
  }

  _small (kind, x, z, yaw, y) {
    const geo = kind === 'bench' ? this.benchGeo : kind === 'bin' ? this.binGeo : this.hydrantGeo;
    const mat = kind === 'bench' ? this.benchMat : kind === 'bin' ? this.binMat : this.hydrantMat;
    const h = kind === 'bench' ? 0.95 : kind === 'bin' ? 1.0 : 0.9;
    const r = kind === 'bench' ? 0.95 : kind === 'bin' ? 0.38 : 0.26;
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _p.set(x, y, z);
    const base = new THREE.Matrix4().compose(_p, _q, _s1);
    this.props.push({
      kind, yaw, alive: true, collider: this._register(x, z, r, y, y + h, kind),
      pos: _p.clone(), center: new THREE.Vector3(x, y + h / 2, z),
      pivotY: h / 2, radius: kind === 'bench' ? 1.1 : 0.6, mass: kind === 'bench' ? 0.9 : 0.5, base,
      parts: [{ geo, mat, matrix: base }]
    });
    this._occupy(x, z);
  }

  /* ================= placement passes ================= */

  /** Lamps, kerbside trees and small furniture along every footway. */
  _streets () {
    const rng = this.rng;
    const p = {};
    for (const e of this.roads.edges) {
      if (e.sidewalk === null) continue;
      const city = e.cls === 'city', bridge = e.cls === 'bridge' || e.cls === 'ramp';
      const lit = city || bridge || ['residential', 'high-street', 'collector', 'arterial'].includes(e.cls);
      if (!lit) continue;
      const spacing = city ? 38 : bridge ? 44 : 46;
      const inner = e.width / 2 + (city ? 1.3 : bridge ? 1.6 : 1.1);   // lamps, bins, hydrants
      const outer = e.width / 2 + (city ? 3.7 : 0);                    // trees and benches on wide pavements
      const d0 = Math.max(e.a.halfWidth, 6) + 8, d1 = e.len - Math.max(e.b.halfWidth, 6) - 8;
      if (d1 - d0 < spacing * 0.5) continue;
      const count = Math.max(1, Math.floor((d1 - d0) / spacing));
      let alt = rng.int(0, 1);
      for (let k = 0; k <= count; k++) {
        const d = d0 + (d1 - d0) * (count ? k / count : 0.5);
        this.roads.pointAlong(e, d, p);
        const sides = city || bridge ? [-1, 1] : [alt ? 1 : -1];
        alt ^= 1;
        for (const side of sides) {
          const nx = -p.uz * side, nz = p.ux * side;              // away from the road
          const yaw = Math.atan2(-nx, -nz);                         // face the road
          // Everything here still passes the carriageway test (own street
          // included: the offsets clear its edge), so nothing lands in a cross
          // street at a junction.
          const lx = p.x + nx * inner, lz = p.z + nz * inner;
          if (this._free(lx, lz, 2.2, { roadPad: 0.8 })) this._lamp(lx, lz, yaw, this.map.streetHeight(lx, lz));
          if (!city) continue;
          // trees and benches sit between lamp stations, but never past the
          // last one — beyond it is the junction
          const shift = Math.min(spacing * 0.5 + rng.range(-3, 3), Math.max(0, d1 - d - 4));
          const tx = p.x + nx * outer + p.ux * shift, tz = p.z + nz * outer + p.uz * shift;
          const roll = rng.next();
          if (k % 2 === 0 && roll < 0.68) {
            if (this._free(tx, tz, 3, { roadPad: 1.5 })) this._tree(tx, tz, this.map.streetHeight(tx, tz));
          } else if (roll < 0.80) {
            if (this._free(tx, tz, 2.5, { roadPad: 1.5 })) this._small('bench', tx, tz, yaw, this.map.streetHeight(tx, tz));
          }
          const bx = p.x + nx * inner + p.ux * 2.2, bz = p.z + nz * inner + p.uz * 2.2;
          const roll2 = rng.next();
          if (roll2 < 0.16 && this._free(bx, bz, 1.6, { roadPad: 0.8 })) this._small('bin', bx, bz, yaw, this.map.streetHeight(bx, bz));
          else if (roll2 < 0.24 && this._free(bx, bz, 1.6, { roadPad: 0.8 })) this._small('hydrant', bx, bz, yaw, this.map.streetHeight(bx, bz));
        }
      }
    }
  }

  /** A garden tree on most housing lots, the odd bench out front. */
  _lots () {
    const rng = this.rng;
    for (const lot of this.map.data.lots) {
      const c = Math.cos(lot.rotation), s = Math.sin(lot.rotation);
      const world = (u, v) => [lot.x + c * u + s * v, lot.z - s * u + c * v];
      const trees = rng.next() < 0.78 ? 1 : 0;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].sort(() => rng.next() - 0.5);
      let placed = 0;
      for (const [su, sv] of corners) {
        if (placed >= trees) break;
        const [x, z] = world(su * (lot.w / 2 - 2.6), sv * (lot.d / 2 - 3.0));
        if (!this._free(x, z, 3, { pad: 1.2 })) continue;
        this._tree(x, z, this.map.streetHeight(x, z) + 0.12);
        placed++;
      }
      if (rng.next() < 0.08) {
        const [x, z] = world(0, lot.d / 2 - 2.2);
        if (this._free(x, z, 2.2, { pad: 1.0 })) this._small('bench', x, z, lot.rotation + Math.PI, this.map.streetHeight(x, z) + 0.12);
      }
    }
  }

  /** Parks and civic squares reserved in the manifest. */
  _parks () {
    const rng = this.rng;
    for (const zone of this.map.data.zones) {
      if (zone.type === 'sports') continue;
      const area = zone.width * zone.depth;
      const trees = Math.round(area / 1500), benches = Math.round(area / 7000), bins = Math.round(benches * 0.6);
      const spot = () => [zone.x + rng.range(-zone.width / 2 + 4, zone.width / 2 - 4), zone.z + rng.range(-zone.depth / 2 + 4, zone.depth / 2 - 4)];
      for (let i = 0, tries = 0; i < trees && tries < trees * 6; tries++) {
        const [x, z] = spot();
        if (!this._free(x, z, 4.5, { roadPad: 3 })) continue;
        this._tree(x, z, this.map.streetHeight(x, z));
        i++;
      }
      for (let i = 0, tries = 0; i < benches && tries < benches * 8; tries++) {
        const [x, z] = spot();
        if (!this._free(x, z, 3, { roadPad: 3 })) continue;
        const yaw = Math.atan2(zone.x - x, zone.z - z) + rng.range(-0.6, 0.6);
        this._small('bench', x, z, yaw, this.map.streetHeight(x, z));
        i++;
      }
      for (let i = 0, tries = 0; i < bins && tries < bins * 8; tries++) {
        const [x, z] = spot();
        if (!this._free(x, z, 2, { roadPad: 3 })) continue;
        this._small('bin', x, z, rng.range(0, Math.PI * 2), this.map.streetHeight(x, z));
        i++;
      }
    }
  }

  /** Benches facing the water and a ring of trees around the hill lake. */
  _lakeShore () {
    const p = this.map.pond, rng = this.rng;
    const ring = (rx, rz, spacing, fn) => {
      const circ = Math.PI * (rx + rz);
      const n = Math.max(6, Math.round(circ / spacing));
      for (let i = 0; i < n; i++) {
        const t = i / n * Math.PI * 2 + rng.range(-0.05, 0.05);
        fn(p.x + Math.cos(t) * rx, p.z + Math.sin(t) * rz, t);
      }
    };
    ring(p.rx + 58, p.rz + 51, 55, (x, z, t) => {
      if (!this._free(x, z, 2.5, { roadPad: 2 })) return;
      const yaw = Math.atan2(p.x - x, p.z - z);
      this._small('bench', x, z, yaw, this.map.streetHeight(x, z));
    });
    ring(p.rx + 74, p.rz + 66, 34, (x, z) => {
      const jx = x + rng.range(-4, 4), jz = z + rng.range(-4, 4);
      if (!this._free(jx, jz, 4, { roadPad: 3 })) return;
      this._tree(jx, jz, this.map.streetHeight(jx, jz));
    });
  }

  /**
   * Woodland across Eastbank's open ground. A jittered lattice is thinned by
   * two octaves of noise, so the hillsides read as copses, tree lines and
   * clearings rather than an even orchard; bushes fill in at the margins.
   */
  _woodland () {
    const rng = this.rng, noise = new Noise(4471);
    const estate = this.map.data.islands[0].estate || { x: -3270, z: 1000 };
    for (const island of this.map.data.islands) {
      const o = island.outline;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of o) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      const STEP = 8.5;
      for (let gx = minX; gx < maxX; gx += STEP) {
        for (let gz = minZ; gz < maxZ; gz += STEP) {
          const x = gx + rng.range(-5, 5), z = gz + rng.range(-5, 5);
          // broad stands of woodland, broken by a finer pattern of clearings
          const stand = noise.fbm(x * 0.0022 + 7.3, z * 0.0022 - 2.1, 3);
          const detail = noise.fbm(x * 0.012, z * 0.012, 2);
          let cover = stand * 0.72 + detail * 0.28;
          // the open ground around the city is thickly wooded, and the
          // headland estate sits in its own forest
          if (!island.hilly) cover += 0.14;
          const de = Math.hypot(x - estate.x, z - estate.z);
          if (de < 520) cover += 0.24 * (1 - de / 520);
          if (cover < 0.33) continue;
          if (rng.next() > (cover - 0.33) * 4.2) continue;
          if (!insidePolygon(x, z, o)) continue;
          if (this._nearShore(x, z, o, 9)) continue;
          const bush = rng.next() < 0.22;
          if (!this._free(x, z, bush ? 2.0 : 3.6, { roadPad: 3.5, lots: true, paving: true, pad: 1.4 })) continue;
          const y = this.map.streetHeight(x, z);
          if (bush) this._bush(x, z, y); else this._woodTree(x, z, y);
        }
      }
    }
  }

  /**
   * Boulders: a band along every natural shore, outcrops wherever the ground
   * is steep, a scattering across the open hills, and a thick ring of them
   * around the headland cliffs.
   */
  _rocks () {
    const rng = this.rng, n = new THREE.Vector3();
    const estate = this.map.data.islands[0].estate || { x: -3270, z: 1000 };
    const place = (x, z, s) => {
      if (!this._free(x, z, s * 1.6 + 1, { roadPad: 3, lots: true, paving: true, pad: 1.2 })) return false;
      this._rock(x, z, this.map.streetHeight(x, z), s);
      return true;
    };
    for (const island of this.map.data.islands) {
      const o = island.outline;
      const cx = island.hilly ? 1800 : -1700, cz = 0;
      // shoreline band
      for (let i = 0; i < o.length; i++) {
        const a = o[i], b = o[(i + 1) % o.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = rng.range(0, 9); d < len; d += 9) {
          if (rng.next() > 0.5) continue;
          const t = d / len;
          const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
          // step inland toward the middle of the island
          const dx = cx - px, dz = cz - pz, dl = Math.hypot(dx, dz) || 1;
          const inl = rng.range(6, 38);
          const x = px + dx / dl * inl + rng.range(-4, 4), z = pz + dz / dl * inl + rng.range(-4, 4);
          if (!insidePolygon(x, z, o)) continue;
          place(x, z, rng.next() < 0.12 ? rng.range(2.2, 3.6) : rng.range(0.6, 2.0));
        }
      }
      // slopes and open hills
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of o) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      for (let gx = minX; gx < maxX; gx += 20) {
        for (let gz = minZ; gz < maxZ; gz += 20) {
          const x = gx + rng.range(-9, 9), z = gz + rng.range(-9, 9);
          if (!insidePolygon(x, z, o) || this.map.isWater(x, z)) continue;
          const normal = this.map.groundNormal(x, z, n);
          const steep = normal.y < 0.90;
          const de = Math.hypot(x - estate.x, z - estate.z);
          const headland = de > 110 && de < 460;
          const p = steep ? 0.55 : headland ? 0.22 : 0.05;
          if (rng.next() > p) continue;
          place(x, z, steep || headland ? rng.range(0.8, 3.2) : rng.range(0.6, 2.2));
        }
      }
    }
  }

  _nearShore (x, z, outline, r) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      if (Math.min(a[0], b[0]) - r > x || Math.max(a[0], b[0]) + r < x || Math.min(a[1], b[1]) - r > z || Math.max(a[1], b[1]) + r < z) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < r) return true;
    }
    return false;
  }

  /* ================= instancing ================= */

  /**
   * One instanced mesh per (geometry, material, 320 m tile). Tiling is what
   * keeps fifty thousand props affordable: a map-wide batch cannot be frustum
   * culled, so every tree on the island would be drawn — twice, with the
   * shadow pass — wherever you looked. Per-tile batches with bounding spheres
   * let the renderer skip everything behind you and beyond the shadow box.
   */
  _batch () {
    const TILE = 480, FAR = 700;
    const tiles = new Map();
    for (const prop of this.props) {
      const tx = Math.floor(prop.pos.x / TILE), tz = Math.floor(prop.pos.z / TILE);
      const tk = tx * 100003 + tz;
      let tile = tiles.get(tk);
      if (!tile) { tile = { tx, tz, batches: new Map(), trees: [] }; tiles.set(tk, tile); }
      if (prop.far) tile.trees.push(prop);
      for (const part of prop.parts) {
        const key = part.geo.uuid + '|' + part.mat.uuid;
        let bt = tile.batches.get(key);
        if (!bt) { bt = { geo: part.geo, mat: part.mat, list: [], colors: [] }; tile.batches.set(key, bt); }
        part.batch = bt;
        part.idx = bt.list.length;
        bt.list.push(part.matrix);
        bt.colors.push(part.color || null);
      }
    }
    this.group = new THREE.Group();
    this.group.name = 'Street furniture';
    this.farMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true });
    this.batchCount = 0;
    for (const tile of tiles.values()) {
      const cx = (tile.tx + 0.5) * TILE, cz = (tile.tz + 0.5) * TILE;
      // near: the real props, one instanced draw per (geometry, material)
      const near = new THREE.Group();
      near.position.set(-cx, 0, -cz);
      for (const bt of tile.batches.values()) {
        const im = new THREE.InstancedMesh(bt.geo, bt.mat, bt.list.length);
        bt.list.forEach((m, k) => im.setMatrixAt(k, m));
        im.instanceMatrix.needsUpdate = true;
        if (bt.colors.some(c => c)) bt.colors.forEach((c, k) => im.setColorAt(k, c || WHITE));
        im.castShadow = bt.mat !== this.bulbMat && bt.geo !== this.bushGeo;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.frustumCulled = true;
        near.add(im);
        bt.im = im;
        this.batchCount++;
      }
      const lod = new THREE.LOD();
      lod.position.set(cx, 0, cz);
      lod.addLevel(near, 0);
      // far: every tree canopy in the tile as one merged mesh of octahedra
      if (tile.trees.length) {
        const far = new THREE.Mesh(this._farCanopies(tile.trees), this.farMat);
        far.position.set(-cx, 0, -cz);
        far.receiveShadow = false;
        far.castShadow = false;
        far.frustumCulled = true;
        lod.addLevel(far, FAR);
        this.batchCount++;
      }
      this.group.add(lod);
    }
    for (const prop of this.props) for (const part of prop.parts) part.im = part.batch.im;
    this.map.group.add(this.group);
    // spatial index for propsNear
    this._propGrid = new Map();
    for (const prop of this.props) {
      const k = Math.floor(prop.pos.x / 40) * 100003 + Math.floor(prop.pos.z / 40);
      if (!this._propGrid.has(k)) this._propGrid.set(k, []);
      this._propGrid.get(k).push(prop);
    }
  }

  /** Low-poly canopy blobs for a whole tile, for viewing from a distance. */
  _farCanopies (trees) {
    const n = trees.length;
    const pos = new Float32Array(n * 18), col = new Float32Array(n * 18), idx = new Uint32Array(n * 24);
    const V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const F = [0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0, 4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5];
    for (let i = 0; i < n; i++) {
      const t = trees[i], c = t.center, r = t.far.r, k = t.far.color;
      for (let v = 0; v < 6; v++) {
        const o = i * 18 + v * 3;
        pos[o] = c.x + V[v][0] * r; pos[o + 1] = c.y + V[v][1] * r * 0.9; pos[o + 2] = c.z + V[v][2] * r;
        col[o] = k.r; col[o + 1] = k.g; col[o + 2] = k.b;
      }
      for (let f = 0; f < 24; f++) idx[i * 24 + f] = i * 6 + F[f];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Standing props whose centre is within `r` of a point. */
  propsNear (x, z, r) {
    const out = [];
    const r2 = r * r;
    const x0 = Math.floor((x - r) / 40), x1 = Math.floor((x + r) / 40);
    const z0 = Math.floor((z - r) / 40), z1 = Math.floor((z + r) / 40);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const l = this._propGrid.get(cx * 100003 + cz);
        if (!l) continue;
        for (const p of l) {
          if (!p.alive) continue;
          const dx = p.center.x - x, dz = p.center.z - z;
          if (dx * dx + dz * dz <= r2) out.push(p);
        }
      }
    }
    return out;
  }

  /**
   * Pull a prop out of its instanced batch and return a free-standing Group
   * with its origin at the prop's centre of mass.
   */
  detachProp (prop) {
    if (!prop || !prop.alive) return null;
    prop.alive = false;
    if (prop.collider) prop.collider.gone = true;
    const g = new THREE.Group();
    const inv = _invM.copy(prop.base).invert();
    for (const part of prop.parts) {
      part.im.setMatrixAt(part.idx, ZERO_M);
      part.im.instanceMatrix.needsUpdate = true;
      const m = new THREE.Mesh(part.geo, part.mat);
      if (part.color) { m.material = part.mat.clone(); m.material.color.copy(part.color); }
      m.matrixAutoUpdate = false;
      m.matrix.multiplyMatrices(inv, part.matrix);
      m.matrix.premultiply(_pivotM.makeTranslation(0, -prop.pivotY, 0));
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(prop.pos.x, prop.pos.y + prop.pivotY, prop.pos.z);
    g.quaternion.setFromEuler(new THREE.Euler(0, prop.yaw, 0));
    this.scene.add(g);
    return g;
  }

  setNight (n) {
    this.bulbMat.emissiveIntensity = 0.10 + n * 2.4;
  }
}
