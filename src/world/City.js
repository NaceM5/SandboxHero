import * as THREE from 'three';
import { CITY, blockCenter, nodeX, isWaterBlock, bridgeHeight, isLand, landField, beachWidth, onIsle } from './RoadNetwork.js';
import { Noise, Rng, clamp } from '../core/Util.js';

/* ------------------------------------------------------------------ *
 *  Raw-buffer mesh builder. Buildings are emitted straight into typed
 *  arrays and merged per city block, which keeps draw calls low while
 *  still giving the renderer block-sized chunks to frustum-cull.
 * ------------------------------------------------------------------ */

const TILE_W = 25.6, TILE_H = 28.8;  // metres covered by one facade tile (8 windows x 8 floors)

class MeshBuilder {
  constructor () { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; }
  /** Verts 0,1 are the lower edge and 2,3 the upper, so `colB` shades the base. */
  quad (a, b, c, d, nx, ny, nz, ur, vr, col, colB) {
    const P = this.p, N = this.n, U = this.uv, C = this.c;
    const lo = colB || col;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let k = 0; k < 4; k++) N.push(nx, ny, nz);
    C.push(lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, col.r, col.g, col.b, col.r, col.g, col.b);
    U.push(0, 0, ur, 0, ur, vr, 0, vr);
    const v = this.v;
    this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  /** Four walls (and optionally a cap) of an axis-aligned box. */
  box (cx, cy, cz, w, h, d, col, opts = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy, y1 = cy + h, z0 = cz - d / 2, z1 = cz + d / 2;
    const tw = opts.tw ?? TILE_W, th = opts.th ?? TILE_H;
    const uw = Math.max(1, Math.round(w / tw)), ud = Math.max(1, Math.round(d / tw));
    const vh = Math.max(1, Math.round(h / th));
    // Stylised vertical falloff: streets read darker, tops catch the sky.
    // Scaled by height and base elevation so a 3 m rooftop unit doesn't get
    // the same shading ramp as a 200 m tower.
    const g = opts.grad ?? Math.min(0.98, 0.60 + (1 - Math.min(h, 45) / 45) * 0.34 + cy / 240);
    const lo = _shadeLo(col, g), hi = _shadeHi(col, opts.gradTop ?? 1.10);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, uw, vh, hi, lo);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, uw, vh, hi, lo);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, ud, vh, hi, lo);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, ud, vh, hi, lo);
    if (opts.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, 1, 1, hi);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, 1, 1, lo);
  }
  /**
   * A square prism between two arbitrary points. `box` is axis-aligned, which
   * can't follow a sloped member — a suspension cable built from boxes comes
   * out as a row of disconnected vertical bars.
   */
  beam (ax, ay, az, bx, by, bz, r, col) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 1e-6;
    dx /= L; dy /= L; dz /= L;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; uz = 0; }
    let sx = dy * uz - dz * uy, sy = dz * ux - dx * uz, sz = dx * uy - dy * ux;
    const sl = Math.hypot(sx, sy, sz) || 1e-6;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = sy * dz - sz * dy, ty = sz * dx - sx * dz, tz = sx * dy - sy * dx;
    const ring = (px, py, pz) => [
      [px + (sx + tx) * r, py + (sy + ty) * r, pz + (sz + tz) * r],
      [px + (sx - tx) * r, py + (sy - ty) * r, pz + (sz - tz) * r],
      [px + (-sx - tx) * r, py + (-sy - ty) * r, pz + (-sz - tz) * r],
      [px + (-sx + tx) * r, py + (-sy + ty) * r, pz + (-sz + tz) * r]
    ];
    const A = ring(ax, ay, az), B = ring(bx, by, bz);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      this.quad(A[k], A[k2], B[k2], B[k], 0, 1, 0, 1, 1, col);
    }
  }

  slab (cx, cy, cz, w, h, d, col) { this.box(cx, cy, cz, w, h, d, col, { top: true, tw: 1e9, th: 1e9 }); }
  /**
   * A ground decal. `hf` samples the surface height per corner — a flat quad
   * laid on a slope visibly floats at one end, which is what made the road
   * markings hover.
   */
  flat (cx, cy, cz, w, d, col, hf = null) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const y = hf ? (x, z) => hf(x, z) + cy : () => cy;
    this.quad(
      [x0, y(x0, z1), z1], [x1, y(x1, z1), z1],
      [x1, y(x1, z0), z0], [x0, y(x0, z0), z0], 0, 1, 0, 1, 1, col
    );
  }
  /**
   * A flat rectangle lying on the ground, oriented along (ux, uz) rather than
   * along the world axes. Streets no longer run north-south and east-west, so
   * axis-aligned paint turns into big lozenges on any street that doesn't.
   */
  stripe (cx, cz, ux, uz, len, wid, y, col, hf) {
    const hx = ux * len / 2, hz = uz * len / 2;      // half-vector along
    const px = -uz * wid / 2, pz = ux * wid / 2;     // half-vector across
    const P = [
      [cx - hx - px, 0, cz - hz - pz],
      [cx - hx + px, 0, cz - hz + pz],
      [cx + hx + px, 0, cz + hz + pz],
      [cx + hx - px, 0, cz + hz - pz]
    ];
    for (const q of P) q[1] = (hf ? hf(q[0], q[2]) : 0) + y;
    // wound so the face points up for any orientation
    this.quad(P[0], P[1], P[2], P[3], 0, 1, 0, 1, 1, col);
  }
  empty () { return this.v === 0; }
  build () {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const LIN = hex => new THREE.Color(hex).convertSRGBToLinear();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const _invM = new THREE.Matrix4(), _pivotM = new THREE.Matrix4();
const _shA = new THREE.Color(), _shB = new THREE.Color();
const _shadeLo = (c, k) => _shA.setRGB(c.r * k, c.g * k, c.b * k);
const _shadeHi = (c, k) => _shB.setRGB(c.r * k, c.g * k, c.b * k);

/* ------------------------------------------------------------------ *
 *  Facade textures
 * ------------------------------------------------------------------ */

function facadeTextures (variant) {
  const S = 512;
  const cols = variant === 'tower' ? 8 : 6;
  const rows = variant === 'tower' ? 8 : 8;
  const cw = S / cols, ch = S / rows;

  const base = document.createElement('canvas'); base.width = base.height = S;
  const bc = base.getContext('2d');
  const emis = document.createElement('canvas'); emis.width = emis.height = S;
  const ec = emis.getContext('2d');

  bc.fillStyle = variant === 'tower' ? '#b9bfc7' : '#c8bfb2';
  bc.fillRect(0, 0, S, S);
  ec.fillStyle = '#000'; ec.fillRect(0, 0, S, S);

  // faint horizontal floor banding
  bc.fillStyle = 'rgba(0,0,0,0.10)';
  for (let r = 0; r < rows; r++) bc.fillRect(0, r * ch, S, Math.max(2, ch * 0.10));

  const inset = variant === 'tower' ? 0.08 : 0.22;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * inset, y = r * ch + ch * (inset + 0.10);
      const w = cw * (1 - inset * 2), h = ch * (1 - inset * 2 - 0.10);
      const lit = Math.random() < 0.42;
      bc.fillStyle = variant === 'tower' ? '#4c5866' : '#3d4450';
      bc.fillRect(x, y, w, h);
      // glass gradient so the panes aren't flat
      const gr = bc.createLinearGradient(x, y, x, y + h);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.02)');
      gr.addColorStop(1, 'rgba(0,0,0,0.18)');
      bc.fillStyle = gr; bc.fillRect(x, y, w, h);
      if (lit) {
        const b = 0.45 + Math.random() * 0.55;
        const warm = Math.random();
        ec.fillStyle = warm < 0.72
          ? `rgba(255,${Math.round(196 + 40 * b)},${Math.round(130 + 60 * b)},${b})`
          : `rgba(${Math.round(150 + 60 * b)},${Math.round(215 + 30 * b)},255,${b})`;
        ec.fillRect(x, y, w, h);
        bc.fillStyle = `rgba(255,236,200,${0.30 * b})`;
        bc.fillRect(x, y, w, h);
      }
    }
  }

  const mk = cv => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const m = mk(base); m.colorSpace = THREE.SRGBColorSpace;
  const e = mk(emis); e.colorSpace = THREE.SRGBColorSpace;
  return { map: m, emissiveMap: e };
}

/* ------------------------------------------------------------------ *
 *  City
 * ------------------------------------------------------------------ */

const TOWER_TINTS = ['#9fb3c8', '#8fa6bd', '#b6c2cf', '#7d94ad', '#a9bcc9', '#6f8aa3'];
const BRICK_TINTS = ['#a8815f', '#96694b', '#b89272', '#8d6f57', '#a97b62', '#7f6650'];
const TRIM_TINTS  = ['#8b929b', '#767d86', '#9aa1aa'];

/**
 * Per-district rules, laid out to match the reference map. `pad` means the
 * block gets a raised pavement; open country and beaches don't.
 */
const DISTRICTS = {
  downtown:    { tower: 0.90, hMin: 90, hMax: 255, lots: 'single', landmark: 0.16, pad: true },
  midtown:     { tower: 0.52, hMin: 26, hMax: 84,  lots: 'mixed',  pad: true },
  harbor:      { tower: 0.02, hMin: 10, hMax: 26,  lots: 'wide',   pad: true },
  pier:        { tower: 0.05, hMin: 7,  hMax: 18,  lots: 'mixed',  pad: true },
  industrial:  { tower: 0.03, hMin: 9,  hMax: 20,  lots: 'wide',   pad: true },
  stadium:     { tower: 0,    hMin: 0,  hMax: 0,   lots: 'none',   pad: true, special: 'stadium' },
  neighborhoods: { tower: 0.01, hMin: 6, hMax: 12, lots: 'houses', pad: true },
  university:  { tower: 0.10, hMin: 16, hMax: 44,  lots: 'campus', pad: true },
  business:    { tower: 0.30, hMin: 18, hMax: 58,  lots: 'mixed',  pad: true },
  farms:       { tower: 0,    hMin: 5,  hMax: 11,  lots: 'farm',   pad: false },
  beach:       null,
  park:        null,
  estate:      null,
  water:       null,
  // the tower's own block: keeps its pavement, grows nothing of its own
  penthouse:   { tower: 0, hMin: 0, hMax: 0, lots: 'none', pad: true }
};
const D_COVER = {
  farms: ['#7d8a45', '#8f9450', '#6f7d3c'],
  university: ['#4e7040'],
  neighborhoods: ['#4f6c42']
};
/**
 * Ground colour under each district. Without this the whole map is one shade
 * of grass and the built-up island reads from the air as parkland with towers
 * dropped on it; the city needs grey between its buildings.
 */
const GROUND_TINT = {
  downtown: '#4c4d53', midtown: '#565760', business: '#5a5c62',
  harbor: '#6b6760', pier: '#6f6a61', industrial: '#605e59',
  stadium: '#4f6b43', neighborhoods: '#53663c', university: '#4e7040',
  // The sand itself is its own mesh; the 'beach' district covers a much wider
  // band of land behind it, and tinting that sand-colour left a stripe of mud
  // between the grass and the shore. It should read as dune grass.
  farms: '#7d8a45', beach: '#66753f', park: '#4d6a3b', water: '#6d6a55',
  estate: '#4f7038',         // kept lawn
  penthouse: '#4c4d53'
};
const DEFAULT_TINT = '#53663c';
const WALK_BAND = 7;      // width of the kerbside footpath, metres

const ZONE_WEIGHT = {
  downtown: 1.0, midtown: 0.62, harbor: 0.45, pier: 0.40, industrial: 0.34,
  stadium: 0.5, neighborhoods: 0.26, university: 0.42, business: 0.5,
  farms: 0.12, beach: 0.1, park: 0.12, estate: 0.05, penthouse: 1.0, water: 0
};

export class City {
  constructor (scene, roads) {
    this.scene = scene;
    this.roads = roads;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);

    // The whole city is generated from one fixed seed, so the map — skyline,
    // river, bridge, every lamp post — is identical on every load.
    this.rng = new Rng(CITY.SEED);
    this.noise = new Noise(CITY.SEED);
    this.buildings = [];                       // AABBs for collision / landing
    this.blockBuildings = new Map();           // blockKey -> AABB[]
    this.rooftops = [];                        // nice perch points
    this.blockDensity = new Float32Array(CITY.BLOCKS * CITY.BLOCKS);  // 0..1 built volume
    this.props = [];                           // grabbable street & rooftop furniture
    this.dispose = [];

    this._materials();
    this._water();
    this._ground();
    this._markings();
    this._blocks();
    this._normaliseDensity();
    this._bridge();
    this._props();
    this._mansion();
    this._penthouse();
    this._battleship();
    this._carrier();
  }

  /* ---------------- materials ---------------- */

  _materials () {
    const t1 = facadeTextures('tower');
    const t2 = facadeTextures('brick');
    const mk = t => new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissiveMap,
      emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.0,
      vertexColors: true, roughness: 0.62, metalness: 0.06
    });
    this.matTower = mk(t1);
    this.matBrick = mk(t2);
    this.matTrim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.03, emissive: new THREE.Color(0, 0, 0) });
    this.matRoad = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.94, metalness: 0.0, emissive: new THREE.Color(0, 0, 0) });
    this.matGround = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, vertexColors: true, emissive: new THREE.Color(0, 0, 0) });
    this.matSand = new THREE.MeshStandardMaterial({ color: 0xc8b184, roughness: 0.95, vertexColors: true, emissive: new THREE.Color(0, 0, 0) });
    this.matWalk = new THREE.MeshStandardMaterial({ color: 0x6a707a, roughness: 0.92, emissive: new THREE.Color(0, 0, 0) });
    // The walk-in buildings. One flat material for all of them turns the whole
    // mansion, tower and warship into a single silhouette after dark, so they
    // get a small family instead: matte render for masonry and decks, a
    // glossier one for glass and painted steel that keeps a highlight, and a
    // self-lit one for interiors and lit surfaces so rooms read at night.
    this.matHouse = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.02,
      emissive: new THREE.Color(0.05, 0.047, 0.042)
    });
    this.matHouseGloss = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.26, metalness: 0.55,
      emissive: new THREE.Color(0.05, 0.055, 0.07)
    });
    this.matHouseLit = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0.02,
      emissive: new THREE.Color(0.22, 0.20, 0.16)
    });
    this.matPaint = new THREE.MeshStandardMaterial({
      color: 0xb5b0a2, roughness: 0.85, emissive: 0x222018, emissiveIntensity: 0.35
    });
    this.facadeEmissive = 1.0;

    // rooftop furniture: unit primitives, scaled per instance
    this.acGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tankGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    this.mastGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 8);
    this.matRoofProp = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.82, metalness: 0.2 });
    this.matTank = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.9 });
  }

  /** Advance the water and keep it lit by the same sun as everything else. */
  updateWater (dt, sunDir, sunCol, skyCol, fog) {
    if (!this.waterUniforms) return;
    this.waterUniforms.uTime.value += dt;
    if (sunDir) this.waterUniforms.uSun.value.copy(sunDir);
    if (sunCol) this.waterUniforms.uSunCol.value.copy(sunCol);
    if (skyCol) this.waterUniforms.uSky.value.copy(skyCol);
    if (fog) {
      this.waterUniforms.uFog.value.copy(fog.color);
      this.waterUniforms.uFogDensity.value = fog.density;
    }
  }

  setNightFactor (n) {
    // windows glow harder after dark; the street reads cooler
    this.matTower.emissiveIntensity = 0.05 + n * 0.95;
    this.matBrick.emissiveIntensity = 0.04 + n * 0.85;
    this.matPaint.emissiveIntensity = 0.06 + n * 0.30;
    if (this.lampMat) this.lampMat.emissiveIntensity = 0.10 + n * 2.4;
    // the street lamps are emissive geometry, not real lights — fake their
    // spill so the road and pavement stay readable after dark
    this.matRoad.emissive.setRGB(0.055, 0.043, 0.030).multiplyScalar(n);
    this.matGround.emissive.setRGB(0.028, 0.032, 0.022).multiplyScalar(n);
    this.matSand.emissive.setRGB(0.05, 0.044, 0.034).multiplyScalar(n);
    this.matWalk.emissive.setRGB(0.062, 0.052, 0.040).multiplyScalar(n);
    this.matTrim.emissive.setRGB(0.030, 0.026, 0.021).multiplyScalar(n);
    // The mansion keeps a floor of its own light. Its interior faces point away
    // from the sun and there are no real lights in the scene, so lit only by
    // the sky a ceiling seen from underneath comes out pure black.
    // Interiors and glass hold their own light after dark; the matte shells
    // only lift a little, so the buildings keep their shape instead of all
    // flattening to the same grey.
    if (this.matHouse) this.matHouse.emissive.setRGB(0.05, 0.047, 0.042).multiplyScalar(0.7 + n * 1.5);
    if (this.matHouseGloss) this.matHouseGloss.emissive.setRGB(0.045, 0.05, 0.075).multiplyScalar(0.6 + n * 2.6);
    if (this.matHouseLit) this.matHouseLit.emissive.setRGB(0.22, 0.20, 0.16).multiplyScalar(0.55 + n * 1.8);
  }

  /* ---------------- ground & road paint ---------------- */

  _ground () {
    const S = CITY.SHORE;
    const T = (x, z) => this.roads.terrainY(x, z);
    const STEP = 11;

    // Which blocks get a pavement has to be settled first: the ground lattice
    // is sunk wherever a made surface will cover it, so it needs to know.
    this.sidewalkY = 0.28;
    this.padBlocks = new Set();
    for (let bj = 0; bj < CITY.BLOCKS; bj++) {
      for (let bi = 0; bi < CITY.BLOCKS; bi++) {
        const d = this.districtAt(bi, bj);
        if (DISTRICTS[d] && DISTRICTS[d].pad) this.padBlocks.add(bj * CITY.BLOCKS + bi);
      }
    }

    /**
     * Sink the natural ground wherever a made surface covers it. Asphalt sits
     * 6 cm and pavement 28 cm above the terrain, while the ground mesh samples
     * on a 22 m grid — so interpolation across a quad pushes grass up through
     * the road, which is the grass-over-tarmac clipping. Dropping the ground
     * under them guarantees the made surface wins, and the step is hidden
     * beneath the road edge and the kerb.
     */
    const covered = (x, z) => {
      let c = this.roads.roadCover(x, z);
      if (c < 1 && this.padAt(x, z)) c = 1;
      return c;
    };
    const TG = (x, z) => T(x, z) - 0.5 * covered(x, z);

    // Bake the whole ground lattice once. Collision reproduces this surface
    // exactly, and evaluating the terrain function four times per query — each
    // of which searches the road network — cost more than the rest of the
    // frame put together.
    this._gS = S; this._gStep = STEP;
    this._gN = Math.floor((2 * S) / STEP) + 1;
    this._gGrid = new Float32Array((this._gN + 1) * (this._gN + 1));
    for (let j = 0; j <= this._gN; j++) {
      const gz = Math.min(-S + j * STEP, S);
      for (let i = 0; i <= this._gN; i++) {
        this._gGrid[j * (this._gN + 1) + i] = TG(Math.min(-S + i * STEP, S), gz);
      }
    }

    // one continuous surface. It dips below the waterline offshore, so the
    // coast, the beaches and the shallows all come straight out of the
    // heightfield rather than needing a separate shoreline pass.
    const g = new MeshBuilder(), sand = new MeshBuilder();
    const beach = LIN('#ffffff');
    const tints = {};
    for (const k in GROUND_TINT) tints[k] = LIN(GROUND_TINT[k]);
    const fallback = LIN(DEFAULT_TINT);
    const B = (CITY.BLOCKS - 1) / 2;
    const tintAt = (x, z) => {
      const bi = Math.round(x / CITY.CELL + B), bj = Math.round(z / CITY.CELL + B);
      if (bi < 0 || bj < 0 || bi >= CITY.BLOCKS || bj >= CITY.BLOCKS) return fallback;
      return tints[this.districtAt(bi, bj)] || fallback;
    };
    for (let x = -S; x < S - 0.1; x += STEP) {
      const xb = Math.min(x + STEP, S);
      for (let z = -S; z < S - 0.1; z += STEP) {
        const zb = Math.min(z + STEP, S);
        const ya = TG(x, zb), yb = TG(xb, zb), yc = TG(xb, z), yd = TG(x, z);
        // Sand is chosen by distance to the shoreline, not by height: the
        // coastal plain sits flat just above sea level for a long way inland,
        // so a height test paints the whole thing as beach.
        const cx = x + STEP / 2, cz = z + STEP / 2;
        const f = landField(cx, cz);
        const target = (f < beachWidth(cx, cz) && f > -0.13) ? sand : g;
        target.quad([x, ya, zb], [xb, yb, zb], [xb, yc, z], [x, yd, z], 0, 1, 0, 1, 1,
          target === sand ? beach : tintAt(cx, cz));
      }
    }
    const ground = new THREE.Mesh(g.build(), this.matGround);
    ground.receiveShadow = true;
    ground.geometry.computeVertexNormals();
    this.group.add(ground);

    const shore = new THREE.Mesh(sand.build(), this.matSand);
    shore.receiveShadow = true;
    shore.geometry.computeVertexNormals();
    this.group.add(shore);

    // roads: a ribbon of asphalt along every linked segment
    const r = new MeshBuilder(), rc = LIN('#ffffff');
    const G = CITY.GRID, HW = CITY.ROAD_W / 2;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const a0 = this.roads.node(i, j);
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (i + di >= G || j + dj >= G) continue;
          const b0 = this.roads.node(i + di, j + dj);
          if (!this.roads._linked(a0, b0)) continue;
          if (dj === 0 && j === CITY.BRIDGE_J &&
              i >= CITY.BRIDGE_I0 && i < CITY.BRIDGE_I1) continue;  // the bridge deck
          const gx = b0.x - a0.x, gz = b0.z - a0.z;
          const gl = Math.hypot(gx, gz) || 1;
          const ux = gx / gl, uz = gz / gl;
          const n = 8;
          for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n;
            const ax = a0.x + gx * t0, az = a0.z + gz * t0;
            const bx2 = a0.x + gx * t1, bz = a0.z + gz * t1;
            // Offset along the SEGMENT'S OWN normal. Offsetting along a world
            // axis only makes a 24 m ribbon when the street runs along that
            // axis; once junctions are off the lattice it skews the asphalt
            // into a parallelogram that no longer covers the road.
            const ox = -uz * HW, oz = ux * HW;
            r.quad(
              [ax - ox, T(ax - ox, az - oz) + 0.06, az - oz],
              [ax + ox, T(ax + ox, az + oz) + 0.06, az + oz],
              [bx2 + ox, T(bx2 + ox, bz + oz) + 0.06, bz + oz],
              [bx2 - ox, T(bx2 - ox, bz - oz) + 0.06, bz - oz],
              0, 1, 0, 1, 1, rc
            );
          }
        }
      }
    }
    const roads = new THREE.Mesh(r.build(), this.matRoad);
    roads.receiveShadow = true;
    this.group.add(roads);

    // pavement pads on built blocks, tessellated onto the slope with a kerb
    const b = new MeshBuilder(), col = LIN('#ffffff');
    for (let bj = 0; bj < CITY.BLOCKS; bj++) {
      for (let bi = 0; bi < CITY.BLOCKS; bi++) {
        if (!this.padBlocks.has(bj * CITY.BLOCKS + bi)) continue;
        const rct = this.blockRect(bi, bj);
        // A pavement is a footpath around the edge of the block, not a plaza
        // covering the whole thing. Paving the full rectangle left every block
        // as a slab of concrete with the buildings stranded in the middle of
        // it; this leaves the interior as ground for gardens and yards.
        const n = 14, stepX = rct.w / n, stepZ = rct.d / n;
        for (let p1 = 0; p1 < n; p1++) {
          for (let p2 = 0; p2 < n; p2++) {
            const x = rct.minX + p1 * stepX, z = rct.minZ + p2 * stepZ;
            const xb = x + stepX, zb = z + stepZ;
            if (!this._onWalkBand(rct, (x + xb) / 2, (z + zb) / 2)) continue;
            b.quad([x, T(x, zb) + 0.28, zb], [xb, T(xb, zb) + 0.28, zb],
              [xb, T(xb, z) + 0.28, z], [x, T(x, z) + 0.28, z], 0, 1, 0, 1, 1, col);
          }
        }
        // kerb faces around the rim of the pad
        for (let p1 = 0; p1 < n; p1++) {
          const t0 = rct.minX + p1 * stepX, t1 = t0 + stepX;
          for (const zz of [rct.minZ, rct.maxZ]) {
            const nz = zz < rct.cz ? -1 : 1;
            b.quad([t0, T(t0, zz) + 0.28, zz], [t1, T(t1, zz) + 0.28, zz],
              [t1, T(t1, zz), zz], [t0, T(t0, zz), zz], 0, 0, nz, 1, 1, col);
          }
          const s0 = rct.minZ + p1 * stepZ, s1 = s0 + stepZ;
          for (const xx of [rct.minX, rct.maxX]) {
            const nx = xx < rct.cx ? -1 : 1;
            b.quad([xx, T(xx, s0) + 0.28, s0], [xx, T(xx, s1) + 0.28, s1],
              [xx, T(xx, s1), s1], [xx, T(xx, s0), s0], nx, 0, 0, 1, 1, col);
          }
        }
      }
    }
    const pads = new THREE.Mesh(b.build(), this.matWalk);
    pads.receiveShadow = true;
    pads.geometry.computeVertexNormals();
    this.group.add(pads);
  }

  /** The block's buildable rectangle — owned by the road network. */
  blockRect (bi, bj) { return this.roads.blockRect(bi, bj); }

  /**
   * The height of the RENDERED ground at a point.
   *
   * The mesh is flat triangles across an 11 m lattice; the analytic terrain
   * underneath it is a curve. Reading the curve for collision while drawing the
   * chord means that in every dip the grass renders above where characters
   * actually stand, and they sink into it — which is people disappearing into
   * the lawn. This walks the same two triangles the mesh is built from, so the
   * surface you collide with is the surface you can see.
   */
  groundSurface (x, z) {
    const S = this._gS, STEP = this._gStep, G = this._gGrid;
    if (!G) return this.roads.terrainY(x, z);
    const N = this._gN, W = N + 1;
    const cx = Math.min(Math.max(x, -S), S), cz = Math.min(Math.max(z, -S), S);
    const i = Math.min(Math.floor((cx + S) / STEP), N - 1);
    const j = Math.min(Math.floor((cz + S) / STEP), N - 1);
    const x0 = -S + i * STEP, z0 = -S + j * STEP;
    const x1 = Math.min(x0 + STEP, S), z1 = Math.min(z0 + STEP, S);
    const fx = x1 > x0 ? (cx - x0) / (x1 - x0) : 0;
    const fz = z1 > z0 ? (cz - z0) / (z1 - z0) : 0;
    // corners as the builder lays them: A(x0,z1) B(x1,z1) C(x1,z0) D(x0,z0),
    // split along the A-C diagonal
    const A = G[(j + 1) * W + i], B = G[(j + 1) * W + i + 1];
    const C = G[j * W + i + 1], D = G[j * W + i];
    if (fx + fz >= 1) {
      // triangle A,B,C  — barycentric on (fx, fz)
      const u = 1 - fx, v = 1 - fz;          // toward A and toward C
      return B + (A - B) * u + (C - B) * v;
    }
    // triangle A,C,D
    return D + (A - D) * fz + (C - D) * fx;
  }

  /** Inside the block rectangle and within the kerbside footpath band. */
  _onWalkBand (r, x, z) {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return false;
    const d = Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z);
    return d <= WALK_BAND;
  }

  /** True inside a block that has a pavement, on the paved part of it. */
  padAt (x, z) {
    const B = CITY.BLOCKS;
    const bi = Math.round(x / CITY.CELL + (B - 1) / 2);
    const bj = Math.round(z / CITY.CELL + (B - 1) / 2);
    if (bi < 0 || bj < 0 || bi >= B || bj >= B) return false;
    if (!this.padBlocks.has(bj * B + bi)) return false;
    return this._onWalkBand(this.blockRect(bi, bj), x, z);
  }

  /** Lane dashes, crosswalk ladders and stop bars, laid onto the terrain. */
  _markings () {
    const b = new MeshBuilder();
    const col = LIN('#ffffff');
    const G = CITY.GRID;
    const half = CITY.ROAD_W / 2;
    const surf = (x, z) => this.roads.terrainY(x, z);
    const dash = (x, z, ux, uz, len, wid) => b.stripe(x, z, ux, uz, len, wid, 0.1, col, surf);
    const linked = (i, j, di, dj) => {
      if (i + di >= G || j + dj >= G || i + di < 0 || j + dj < 0) return false;
      return this.roads._linked(this.roads.node(i, j), this.roads.node(i + di, j + dj));
    };
    const onBridge = (i, j, di) =>
      di && j === CITY.BRIDGE_J && i >= CITY.BRIDGE_I0 && i < CITY.BRIDGE_I1;

    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const x0 = nodeX(i), z0 = nodeX(j);

        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (!linked(i, j, di, dj) || onBridge(i, j, di)) continue;
          // Junctions are off the lattice in the suburbs, so step along the
          // real segment rather than assuming a 140 m axis-aligned run.
          const na = this.roads.node(i, j), nb = this.roads.node(i + di, j + dj);
          const sx = nb.x - na.x, sz = nb.z - na.z;
          const len = Math.hypot(sx, sz) || 1;
          const ux = sx / len, uz = sz / len;
          const n = 9;
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            const px = na.x + sx * t, pz = na.z + sz * t;
            if (Math.hypot(px - na.x, pz - na.z) < half + 2) continue;
            if (Math.hypot(px - nb.x, pz - nb.z) < half + 2) continue;
            dash(px, pz, ux, uz, len / n * 0.44, 0.4);
          }
        }

        // Crossings and stop lines are painted onto the terrain, so they only
        // belong at junctions that sit on the ground. On the bridge the road
        // is a deck tens of metres up and the paint would end up on the seabed
        // below it, so skip the span and both of its approaches.
        if (!isLand(x0, z0)) continue;
        const me = this.roads.node(i, j);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!linked(i, j, dx, dz)) continue;
          if (dx > 0 ? onBridge(i, j, 1) : dx < 0 ? onBridge(i - 1, j, 1) : false) continue;
          // the direction of the street LEAVING this junction, not of the axis
          const to = this.roads.node(i + dx, j + dz);
          const ex = to.x - me.x, ez = to.z - me.z;
          const el = Math.hypot(ex, ez) || 1;
          const ux = ex / el, uz = ez / el;
          const cx = me.x + ux * (half + 2.6), cz = me.z + uz * (half + 2.6);
          // zebra bars run ACROSS the street, spaced along it
          for (let k = -2; k <= 2; k++) {
            dash(cx - uz * k * 4.2, cz + ux * k * 4.2, uz, -ux, 3.6, 1.5);
          }
          // stop line on our own side of the centreline
          const sx = me.x + ux * (half + 6.4) + uz * CITY.LANE;
          const sz = me.z + uz * (half + 6.4) - ux * CITY.LANE;
          dash(sx, sz, uz, -ux, 10, 0.9);
        }
      }
    }
    // Zebra crossings where the CROWD actually crosses. The pavement graph
    // links facing mid-edge nodes of neighbouring blocks, which is mid-block —
    // painting them only at the junctions left pedestrians stepping into the
    // road over bare asphalt while the paint sat somewhere they never used.
    const seen = new Set();
    for (const wn of this.roads.walkNodes) {
      if (!wn.crossing) continue;
      for (const to of wn.crossing) {
        const key = Math.min(wn.id, to.id) + ':' + Math.max(wn.id, to.id);
        if (seen.has(key)) continue;
        seen.add(key);
        const ex = to.x - wn.x, ez = to.z - wn.z;
        const el = Math.hypot(ex, ez) || 1;
        const ux = ex / el, uz = ez / el;                 // across the road
        const mx = (wn.x + to.x) / 2, mz = (wn.z + to.z) / 2;
        const width = Math.min(el, CITY.ROAD_W + 6);
        for (let k = -2; k <= 2; k++) {
          b.stripe(mx - uz * k * 2.4, mz + ux * k * 2.4, ux, uz, width, 1.2, 0.1, col, surf);
        }
      }
    }

    const m = new THREE.Mesh(b.build(), this.matPaint);
    m.receiveShadow = false;
    m.frustumCulled = false;
    this.group.add(m);
  }

  /* ---------------- water & bridge ---------------- */

  _water () {
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    g.rotateX(-Math.PI / 2);
    this.waterUniforms = {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x1b4655) },
      uDeep: { value: new THREE.Color(0x061a27) },
      uSky: { value: new THREE.Color(0x88a8d0) },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uFog: { value: new THREE.Color(0x8fa8c0) },
      uFogDensity: { value: 0.0009 }
    };
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
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
          // cheap analytic normal from the wave field
          float e = 1.5;
          float h = wave(vW.xz, t);
          float nx = wave(vW.xz + vec2(e, 0.0), t) - h;
          float nz = wave(vW.xz + vec2(0.0, e), t) - h;
          vec3 Nn = normalize(vec3(-nx * 0.35, 1.0, -nz * 0.35));
          float fres = pow(1.0 - max(dot(Nn, V), 0.0), 3.0);
          float depth = smoothstep(60.0, 900.0, length(vW.xz));
          vec3 base = mix(uShallow, uDeep, depth);
          vec3 col = mix(base, uSky, clamp(fres * 0.55 + 0.05, 0.0, 0.72));
          // sun glitter
          vec3 R = reflect(-V, Nn);
          float sd2 = max(dot(R, normalize(uSun)), 0.0);
          col += uSunCol * pow(sd2, 260.0) * 1.8;
          col += uSunCol * pow(sd2, 16.0) * 0.09;
          // match the scene's exponential fog so the horizon blends away
          float dist = length(cameraPosition - vW);
          float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
          col = mix(col, uFog, clamp(f, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`
    }));
    mesh.position.y = CITY.WATER_Y;
    mesh.renderOrder = -5;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.water = mesh;
  }

  /**
   * The single crossing. Deck, ramps, parapets and pylons; the deck height is
   * folded into groundHeight() so cars, pedestrians and the hero all walk and
   * drive over it without any special-casing.
   */
  /**
   * The crossing. A proper suspension bridge: two towers, a catenary main
   * cable with vertical hangers, a stiffening truss under the deck, kerbs,
   * railings and lighting. Deck height is folded into groundHeight() so
   * everything drives and walks over it without special-casing.
   */
  /**
   * The crossing. An east-west suspension bridge over the channel: two towers
   * rising from the water, a catenary main cable with hangers, a stiffening
   * truss, kerbs, railings and lighting. The deck meets land at grade at both
   * abutments; its height is folded into groundHeight(), so traffic and
   * pedestrians use it with no special-casing.
   */
  _bridge () {
    const b = new MeshBuilder();
    const deckCol = LIN('#7b8189'), steel = LIN('#a8362c'), light = LIN('#b9c0c8');
    const zc = nodeX(CITY.BRIDGE_J);
    const W = CITY.BRIDGE_W;
    const x0 = nodeX(CITY.BRIDGE_I0), x1 = nodeX(CITY.BRIDGE_I1);
    const span = x1 - x0;
    const deckY = (x) => bridgeHeight(x, zc) ?? this.roads.terrainY(x, zc);
    const N = 56;

    /* ---- deck ---- */
    // A ribbon that follows the arch, not a row of boxes. `box` is
    // axis-aligned, so a flat-topped slab per segment turns a curved deck into
    // a flight of stairs — each segment sits level and steps up to the next.
    // These are quads whose ends carry the real deck height at each station.
    const T = 1.3;                       // deck slab thickness
    const zL = zc - W / 2, zR = zc + W / 2;
    for (let k = 0; k < N; k++) {
      const xa = x0 + span * (k / N), xb = x0 + span * ((k + 1) / N);
      const ya = deckY(xa), yb = deckY(xb);
      // road surface (wound high-z to low-z, so the face points up)
      b.quad([xa, ya, zR], [xb, yb, zR], [xb, yb, zL], [xa, ya, zL], 0, 1, 0, 1, 1, deckCol);
      // soffit
      b.quad([xa, ya - T, zL], [xb, yb - T, zL], [xb, yb - T, zR], [xa, ya - T, zR], 0, -1, 0, 1, 1, deckCol);
      // the two fascias
      b.quad([xa, ya, zL], [xb, yb, zL], [xb, yb - T, zL], [xa, ya - T, zL], 0, 0, -1, 1, 1, deckCol);
      b.quad([xa, ya - T, zR], [xb, yb - T, zR], [xb, yb, zR], [xa, ya, zR], 0, 0, 1, 1, 1, deckCol);
    }
    for (const sz of [-1, 1]) {
      for (let k = 0; k < N; k++) {
        const xa = x0 + span * (k / N), xb = x0 + span * ((k + 1) / N);
        b.beam(xa, deckY(xa) - 2.1, zc + sz * (W / 2 - 0.4),
          xb, deckY(xb) - 2.1, zc + sz * (W / 2 - 0.4), 0.4, steel);
      }
    }
    for (let x = x0 + 14; x < x1 - 14; x += 10) {
      b.beam(x, deckY(x) - 1.5, zc - W / 2 + 0.8, x + 5, deckY(x + 5) - 2.8, zc + W / 2 - 0.8, 0.24, steel);
      b.beam(x + 5, deckY(x + 5) - 2.8, zc - W / 2 + 0.8, x + 10, deckY(x + 10) - 1.5, zc + W / 2 - 0.8, 0.24, steel);
    }

    /* ---- towers ---- */
    const towerX = [x0 + span * 0.28, x0 + span * 0.72];
    const TH = 62;
    for (const tx of towerX) {
      const dy = deckY(tx);
      for (const sz of [-1, 1]) {
        const pz = zc + sz * (W / 2 - 1.8);
        b.box(tx, CITY.WATER_Y - 10, pz, 5.2, dy - CITY.WATER_Y + 10, 6.0, steel, { top: true });
        b.box(tx, dy, pz, 3.4, TH, 3.8, steel, { top: true });
      }
      for (const yy of [dy + TH * 0.40, dy + TH * 0.74, dy + TH * 0.96]) {
        b.box(tx, yy, zc, 2.8, 1.7, W - 2.6, steel, { top: true });
      }
    }

    /* ---- main cable + hangers ---- */
    const topY = deckY((x0 + x1) / 2) + TH * 0.98;
    const cableY = (x) => {
      const a0 = towerX[0], a1 = towerX[1];
      if (x < a0) {
        const t = (a0 - x) / (a0 - x0);
        return deckY(x0) + (topY - deckY(x0)) * (1 - t * t);
      }
      if (x > a1) {
        const t = (x - a1) / (x1 - a1);
        return deckY(x1) + (topY - deckY(x1)) * (1 - t * t);
      }
      const t = (x - a0) / (a1 - a0) * 2 - 1;
      const sagBase = deckY((x0 + x1) / 2) + 8;
      return sagBase + (topY - sagBase) * (t * t);
    };
    const step = 6;
    for (const sz of [-1, 1]) {
      const pz = zc + sz * (W / 2 - 1.8);
      for (let x = x0; x < x1; x += step) {
        const xb = Math.min(x + step, x1);
        b.beam(x, cableY(x), pz, xb, cableY(xb), pz, 0.34, steel);
        if (x > towerX[0] && x < towerX[1]) {
          const ya = cableY(x);
          if (ya > deckY(x) + 1.5) b.beam(x, ya, pz, x, deckY(x), pz, 0.11, steel);
        }
      }
    }

    /* ---- kerbs, railings, lamps ---- */
    for (const sz of [-1, 1]) {
      for (let k = 0; k < N; k++) {
        const xa = x0 + span * (k / N), xb = x0 + span * ((k + 1) / N);
        b.beam(xa, deckY(xa) + 0.6, zc + sz * (W / 2 - 0.5),
          xb, deckY(xb) + 0.6, zc + sz * (W / 2 - 0.5), 0.48, light);
        b.beam(xa, deckY(xa) + 0.12, zc + sz * (W / 2 - 3.4),
          xb, deckY(xb) + 0.12, zc + sz * (W / 2 - 3.4), 0.24, light);
      }
      for (let x = x0 + 20; x < x1 - 16; x += 34) {
        b.box(x, deckY(x) + 1.2, zc + sz * (W / 2 - 1.2), 0.24, 7.0, 0.24, light, { top: true });
      }
    }

    const geo = b.build();
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.matTrim);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);

    this.bridgeWalls = [];
    for (const sz of [-1, 1]) {
      this.bridgeWalls.push({
        minX: x0, maxX: x1,
        minZ: zc + sz * (W / 2 - 0.5) - 0.6, maxZ: zc + sz * (W / 2 - 0.5) + 0.6,
        top: deckY((x0 + x1) / 2) + 2, base: 0
      });
      for (const tx of towerX) {
        const pz = zc + sz * (W / 2 - 1.8);
        this.bridgeWalls.push({
          minX: tx - 1.9, maxX: tx + 1.9, minZ: pz - 2.1, maxZ: pz + 2.1,
          top: deckY(tx) + TH, base: 0
        });
      }
    }
  }

  /* ---------------- buildings ---------------- */

  /* ------------------------------------------------------------------ *
   *  Hand-authored zoning
   *
   *  Districts are laid out explicitly rather than sampled from noise, so the
   *  city reads like somewhere that was planned: a tower core, a mid-rise ring
   *  around it, terraced housing at the edges, warehouses out west, low-rise
   *  along both riverbanks, and a handful of parks.
   * ------------------------------------------------------------------ */

  districtAt (bi, bj) {
    const c = blockCenter(bi, bj);
    if (!isLand(c.x, c.z)) return 'water';
    if (onIsle(c.x, c.z)) return 'estate';   // hand-built, nothing procedural here
    if (bi === CITY.PENTHOUSE.bi && bj === CITY.PENTHOUSE.bj) return 'penthouse';
    const x = c.x, z = c.z;
    const shore = landField(x, z);
    if (shore < 0.085) return 'beach';                 // the coastal strip

    if (x < -180) {
      /* ---- WEST ISLAND: the built-up one ---- */
      if (z < -640) return 'pier';
      if (x < -1010) return 'harbor';
      if (z > 430) return 'industrial';
      if (bi === 4 && bj === 11) return 'stadium';
      if (z > 250 || x > -420) return 'midtown';
      return 'downtown';
    }

    /* ---- EAST ISLAND: green, low, spread out ---- */
    if (z < -700) return 'beach';
    if (z < -250) return 'neighborhoods';
    if (x > 760 && z > -250 && z < 130) return 'university';
    if (z > 330 && x > 700) return 'farms';
    if (z > 200) return 'business';
    if ((bi === 14 && bj === 5)) return 'park';
    return 'neighborhoods';
  }

  /** 0..1 "how built-up is this", used by the crime density field. */
  zoneAt (x, z) {
    const B = CITY.BLOCKS;
    const bi = clamp(Math.round(x / CITY.CELL + (B - 1) / 2), 0, B - 1);
    const bj = clamp(Math.round(z / CITY.CELL + (B - 1) / 2), 0, B - 1);
    return ZONE_WEIGHT[this.districtAt(bi, bj)] ?? 0.3;
  }

  _blocks () {

    for (let bj = 0; bj < CITY.BLOCKS; bj++) {
      for (let bi = 0; bi < CITY.BLOCKS; bi++) {
        const key = bj * CITY.BLOCKS + bi;
        const district = this.districtAt(bi, bj);
        if (district === 'water') {
          this.blockBuildings.set(key, []);
          this.blockDensity[key] = 0;
          continue;
        }
        const rct = this.blockRect(bi, bj);
        const c = { x: rct.cx, z: rct.cz };
        // build inside whatever the streets actually left us
        const usableHere = Math.max(14, Math.min(rct.w, rct.d) - WALK_BAND * 2 - 4);
        const wallT = new MeshBuilder(), wallB = new MeshBuilder(), trim = new MeshBuilder();
        const list = [];

        if (district === 'park' || district === 'beach' || district === 'estate') {
          if (district === 'park') this._park(c, trim);
        } else if (D_COVER[district]) {
          this._cover(c, trim, D_COVER[district]);
          const D = DISTRICTS[district];
          for (const lot of this._lots(c.x, c.z, usableHere, D)) {
            this._building(lot, D, wallT, wallB, trim, list);
          }
        } else {
          const D = DISTRICTS[district];
          for (const lot of this._lots(c.x, c.z, usableHere, D)) {
            this._building(lot, D, wallT, wallB, trim, list);
          }
        }

        this.blockBuildings.set(key, list);
        this.buildings.push(...list);

        let vol = 0;
        for (const b of list) {
          vol += (b.maxX - b.minX) * (b.maxZ - b.minZ) * (b.top - b.base);
        }
        this.blockDensity[key] = vol;

        for (const [mb, mat] of [[wallT, this.matTower], [wallB, this.matBrick], [trim, this.matTrim]]) {
          if (mb.empty()) continue;
          const mesh = new THREE.Mesh(mb.build(), mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
      }
    }
  }

  /**
   * Register a piece of rooftop furniture. It goes into the prop list (so
   * telekinesis can rip it off the roof) and into the block's collider list
   * (so you can stand on it and it blocks movement) — the collider is
   * disabled the moment the prop is detached.
   */
  _roofProp (kind, geo, mat, x, y, z, w, h, d, list) {
    const yaw = this.rng.range(-0.4, 0.4);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    // The mesh is yawed but the collider is an AABB, so it has to cover the
    // ROTATED footprint — sized to w x d it leaves the turned corners sticking
    // out with nothing solid behind them, and you walk into the box.
    const ca = Math.abs(Math.cos(yaw)), sa = Math.abs(Math.sin(yaw));
    const ex = (w * ca + d * sa) / 2, ez = (w * sa + d * ca) / 2;
    const box = {
      minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez,
      top: y + h, base: y
    };
    list.push(box);
    this.props.push({
      kind, yaw, alive: true, collider: box,
      pos: new THREE.Vector3(x, y, z),
      center: new THREE.Vector3(x, y + h / 2, z),
      pivotY: h / 2, radius: Math.max(w, d, h * 0.35) * 0.6,
      mass: kind === 'tank' ? 1.5 : kind === 'mast' ? 1.8 : 1.1,
      base,
      parts: [{
        geo, mat,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, y + h / 2, z), q, new THREE.Vector3(w, h, d))
      }]
    });
  }

  /** Normalise the raw volumes into 0..1 once every block has been built. */
  _normaliseDensity () {
    let max = 0;
    for (const v of this.blockDensity) if (v > max) max = v;
    if (max <= 0) return;
    for (let i = 0; i < this.blockDensity.length; i++) {
      // a cube-root curve keeps low-rise blocks from reading as empty
      this.blockDensity[i] = Math.pow(this.blockDensity[i] / max, 1 / 3);
    }
  }

  /** How busy the pavement should be at a point, 0..1. */
  crowdDensityAt (x, z) {
    const B = CITY.BLOCKS;
    const bi = clamp(Math.round(x / CITY.CELL + (B - 1) / 2), 0, B - 1);
    const bj = clamp(Math.round(z / CITY.CELL + (B - 1) / 2), 0, B - 1);
    return this.blockDensity[bj * B + bi];
  }

  _lots (cx, cz, size, D) {
    const lots = [];
    const half = size / 2;
    const R = this.rng;

    if (D.lots === 'single') {
      lots.push({ x: cx, z: cz, w: size, d: size });
      return lots;
    }
    if (D.lots === 'wide') {
      // warehouses: one or two big sheds
      if (R.chance(0.55)) { lots.push({ x: cx, z: cz, w: size, d: size }); return lots; }
      const s1 = R.range(0.42, 0.58);
      lots.push({ x: cx, z: cz - half + size * s1 / 2, w: size, d: size * s1 - 4 });
      lots.push({ x: cx, z: cz + half - size * (1 - s1) / 2, w: size, d: size * (1 - s1) - 4 });
      return lots;
    }
    if (D.lots === 'none') return lots;
    if (D.lots === 'houses') {
      // detached suburban plots on a loose grid
      const n = R.int(2, 3);
      const cell = size / n;
      for (let a2 = 0; a2 < n; a2++) {
        for (let b2 = 0; b2 < n; b2++) {
          if (R.chance(0.18)) continue;                 // gardens and gaps
          lots.push({
            x: cx - half + cell * (a2 + 0.5) + R.range(-3, 3),
            z: cz - half + cell * (b2 + 0.5) + R.range(-3, 3),
            w: cell * R.range(0.5, 0.68), d: cell * R.range(0.5, 0.68)
          });
        }
      }
      return lots;
    }
    if (D.lots === 'campus') {
      // a few free-standing blocks in open lawn
      const n = R.int(2, 3);
      for (let k = 0; k < n; k++) {
        lots.push({
          x: cx + R.range(-half * 0.45, half * 0.45),
          z: cz + R.range(-half * 0.45, half * 0.45),
          w: R.range(24, 42), d: R.range(20, 36)
        });
      }
      return lots;
    }
    if (D.lots === 'farm') {
      // mostly open field; the odd barn or farmhouse
      if (R.chance(0.55)) {
        lots.push({
          x: cx + R.range(-half * 0.5, half * 0.5),
          z: cz + R.range(-half * 0.5, half * 0.5),
          w: R.range(14, 26), d: R.range(10, 20)
        });
      }
      return lots;
    }
    if (D.lots === 'row') {
      // terraces: a run of narrow houses down each long side
      const n = R.int(4, 6);
      const w = size / n;
      for (let k = 0; k < n; k++) {
        const x = cx - half + w * (k + 0.5);
        lots.push({ x, z: cz - half + size * 0.24, w: w - 1.2, d: size * 0.44 });
        lots.push({ x, z: cz + half - size * 0.24, w: w - 1.2, d: size * 0.44 });
      }
      return lots;
    }
    // mixed
    const r = R.next();
    if (r < 0.22) {
      lots.push({ x: cx, z: cz, w: size, d: size });
    } else if (r < 0.6) {
      const split = R.range(0.38, 0.62);
      const w1 = size * split, w2 = size - w1;
      lots.push({ x: cx - half + w1 / 2, z: cz, w: w1 - 3, d: size });
      lots.push({ x: cx + half - w2 / 2, z: cz, w: w2 - 3, d: size });
    } else {
      const sx = R.range(0.38, 0.62), sz = R.range(0.38, 0.62);
      const w1 = size * sx, w2 = size - w1, d1 = size * sz, d2 = size - d1;
      lots.push({ x: cx - half + w1 / 2, z: cz - half + d1 / 2, w: w1 - 3, d: d1 - 3 });
      lots.push({ x: cx + half - w2 / 2, z: cz - half + d1 / 2, w: w2 - 3, d: d1 - 3 });
      lots.push({ x: cx - half + w1 / 2, z: cz + half - d2 / 2, w: w1 - 3, d: d2 - 3 });
      lots.push({ x: cx + half - w2 / 2, z: cz + half - d2 / 2, w: w2 - 3, d: d2 - 3 });
    }
    return lots;
  }

  _building (lot, D, wallT, wallB, trim, list) {
    const R = this.rng;
    const inset = R.range(1.2, 3.4);
    let w = Math.max(8, lot.w - inset), d = Math.max(8, lot.d - inset);
    const x = lot.x + R.range(-0.8, 0.8), z = lot.z + R.range(-0.8, 0.8);

    const isTower = R.chance(D.tower);
    const wall = isTower ? wallT : wallB;
    const tint = LIN(R.pick(isTower ? TOWER_TINTS : BRICK_TINTS));
    const trimCol = LIN(R.pick(TRIM_TINTS));

    let h = R.range(D.hMin, D.hMax);
    if (D.landmark && R.chance(D.landmark)) h *= R.range(1.35, 1.9);
    h = clamp(h, 7, 420);

    // Found the building on the LOWEST ground under its footprint, not the
    // height at its centre — on a slope a centre sample leaves the downhill
    // corner hanging in the air. Sitting on the low corner buries the uphill
    // side instead, which is what a real foundation does.
    const gy = (px, pz) => this.roads.terrainY(px, pz);
    const cor = [
      gy(x - w / 2, z - d / 2), gy(x + w / 2, z - d / 2),
      gy(x - w / 2, z + d / 2), gy(x + w / 2, z + d / 2), gy(x, z)
    ];
    const lo = Math.min(...cor), hi = Math.max(...cor);
    // Sitting on the LOWEST corner never floats, but on a slope it buries the
    // uphill side — a wide warehouse on a hillside loses its whole ground
    // floor. Sit on the middle instead and carry the downhill side on a
    // plinth, which is what a real building on a slope does: cut in at the
    // back, built up at the front.
    const foot = (lo + hi) / 2;
    let y = foot + 0.28, cw = w, cd = d, remaining = h;
    if (hi - lo > 1.2) {
      const pcol = LIN(this.rng.pick(TRIM_TINTS));
      trim.box(x, lo - 0.6, z, w + 0.4, (y - lo) + 0.6, d + 0.4, pcol, { top: false });
    }
    const tiers = h > 150 ? R.int(3, 5) : h > 90 ? R.int(2, 4) : h > 45 ? R.int(1, 3) : 1;
    const tops = [];

    for (let t = 0; t < tiers && remaining > 5; t++) {
      const seg = t === tiers - 1 ? remaining : remaining * R.range(0.42, 0.68);
      wall.box(x, y, z, cw, seg, cd, tint, { gradTop: 1.12 });
      trim.box(x, y + seg, z, cw + 0.5, 0.75, cd + 0.5, trimCol, { top: true });
      // The trim cap is drawn 0.25 m proud of the wall on every side, and the
      // collider has to match it or that lip is roof you can see and stand on
      // in the render but fall straight through in the physics.
      list.push({
        minX: x - cw / 2 - 0.25, maxX: x + cw / 2 + 0.25,
        minZ: z - cd / 2 - 0.25, maxZ: z + cd / 2 + 0.25,
        top: y + seg + 0.75, base: t === 0 ? lo - 0.6 : y
      });
      tops.push({ x, z, y: y + seg + 0.75, w: cw, d: cd });
      y += seg;
      remaining -= seg;
      const taper = h > 140 ? R.range(0.80, 0.94) : R.range(0.66, 0.88);
      cw *= taper; cd *= taper;
      if (cw < 6 || cd < 6) break;
    }

    const top = tops[tops.length - 1];
    if (top) {
      this.rooftops.push({ x: top.x, z: top.z, y: top.y, w: top.w, d: top.d });
      const n = R.int(1, 3);
      for (let k = 0; k < n; k++) {
        const bw = Math.min(top.w * 0.30, R.range(2.5, 6)), bd = Math.min(top.d * 0.30, R.range(2.5, 6));
        const bh = R.range(1.4, 3.4);
        this._roofProp('ac', this.acGeo, this.matRoofProp,
          top.x + R.range(-top.w / 2 + bw, top.w / 2 - bw), top.y,
          top.z + R.range(-top.d / 2 + bd, top.d / 2 - bd), bw, bh, bd, list);
      }
      if (isTower && h > 70 && R.chance(0.7)) {
        // the needle is a prop too — solid, and rippable
        const mh = R.range(12, 48);
        this._roofProp('mast', this.mastGeo, this.matRoofProp,
          top.x, top.y, top.z, 1.15, mh, 1.15, list);
      }
      if (h > 26 && R.chance(0.5)) {
        const tx = top.x + R.range(-top.w / 4, top.w / 4), tz = top.z + R.range(-top.d / 4, top.d / 4);
        this._roofProp('tank', this.tankGeo, this.matTank, tx, top.y, tz, 3.0, 3.2, 3.0, list);
      }
    }

    if (R.chance(0.6)) {
      trim.box(x, this.roads.terrainY(x, z) + 3.6, z, w + 1.6, 0.4, d + 1.6, trimCol, { top: true, bottom: true });
    }
  }

  /** Flat ground cover — lawns, fields — laid onto the slope. */
  _cover (c, trim, palette) {
    const R = this.rng;
    const T = (x, z) => this.roads.terrainY(x, z);
    const h = CITY.BLOCK / 2 - 3, n = 3, step = (h * 2) / n;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const col = LIN(R.pick(palette));
        const x = c.x - h + a * step, z = c.z - h + b * step;
        const xb = x + step, zb = z + step;
        trim.quad([x, T(x, zb) + 0.3, zb], [xb, T(xb, zb) + 0.3, zb],
          [xb, T(xb, z) + 0.3, z], [x, T(x, z) + 0.3, z], 0, 1, 0, 1, 1, col);
      }
    }
  }

  _park (c, trim) {
    const y = this.roads.terrainY(c.x, c.z);
    const col = LIN('#3f5c3a');
    trim.box(c.x, y + 0.28, c.z, CITY.BLOCK - 14, 0.14, CITY.BLOCK - 14, col, { top: true });
    const path = LIN('#7a7364');
    trim.box(c.x, y + 0.42, c.z, CITY.BLOCK - 14, 0.06, 5, path, { top: true });
    trim.box(c.x, y + 0.42, c.z, 5, 0.06, CITY.BLOCK - 14, path, { top: true });
    this.parks = this.parks || [];
    this.parks.push({ x: c.x, z: c.z });
  }

  /* ---------------- street props ---------------- */

  _props () {
    const lampGeo = (() => {
      const b = new MeshBuilder(), col = LIN('#ffffff');
      b.box(0, 0, 0, 0.26, 7.4, 0.26, col, { top: true });
      b.box(0, 7.0, 0.9, 0.2, 0.36, 2.0, col, { top: true });
      return b.build();
    })();
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.65, metalness: 0.5, vertexColors: true });

    const bulbGeo = new THREE.SphereGeometry(0.34, 10, 7).scale(1.5, 0.6, 1.9);
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff0cf, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 2.4, roughness: 0.3
    });

    const trunkGeo = (() => {
      const b = new MeshBuilder(), col = LIN('#ffffff');
      b.box(0, 0, 0, 0.42, 3.0, 0.42, col, { top: true });   // unit trunk, scaled per species
      return b.build();
    })();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95, vertexColors: true });

    // A street of one repeated blob reads as copy-paste immediately. Four
    // canopy shapes crossed with four greens, plus per-tree scale, lean and
    // trunk height, is enough that no two neighbours look alike.
    const SPECIES = [
      { geo: new THREE.IcosahedronGeometry(1.9, 1),  trunk: 3.2, r: 2.3 },   // round broadleaf
      { geo: new THREE.IcosahedronGeometry(2.5, 0),  trunk: 2.3, r: 2.8 },   // low and chunky
      { geo: new THREE.ConeGeometry(1.75, 5.6, 7),   trunk: 2.0, r: 2.0 },   // conifer
      { geo: new THREE.DodecahedronGeometry(1.75, 0), trunk: 4.0, r: 2.1 }   // tall and slim
    ];
    const LEAF_MATS = ['#3e6b34', '#4a7a3a', '#33582c', '#5c8442'].map(c =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.92, flatShading: true }));

    /* Build the prop list first, then fill the instanced meshes from it. Each
       prop keeps a handle on its instance slots so telekinesis can pluck it
       out of the batch and hand it to the physics system. */
    const q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const e = new THREE.Euler();

    const G = CITY.GRID;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const x0 = nodeX(i), z0 = nodeX(j);
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (i + di >= G || j + dj >= G) continue;
          const na = this.roads.node(i, j), nb = this.roads.node(i + di, j + dj);
          if (!this.roads._linked(na, nb)) continue;
          if (di && j === CITY.BRIDGE_J && i >= CITY.BRIDGE_I0 && i < CITY.BRIDGE_I1) continue;
          // Which blocks does this segment run between? Lamps and street trees
          // belong along a made-up frontage, not out in a field, so each side
          // is only furnished if the block it faces is actually built on.
          const built = (bi, bj) =>
            bi >= 0 && bj >= 0 && bi < CITY.BLOCKS && bj < CITY.BLOCKS &&
            this.padBlocks.has(bj * CITY.BLOCKS + bi);
          const sideBuilt = (side) => di
            ? built(i, side > 0 ? j : j - 1)
            : built(side > 0 ? i : i - 1, j);

          // step along the actual segment and offset to its own normal, so
          // furniture still lines the kerb once junctions leave the lattice
          const sx = nb.x - na.x, sz = nb.z - na.z;
          const slen = Math.hypot(sx, sz) || 1;
          const ux = sx / slen, uz = sz / slen;
          const nxv = -uz, nzv = ux;                       // left-hand normal
          const n = 4;
          for (let k = 1; k <= n; k++) {
            const t = k / (n + 1);
            const px = na.x + sx * t, pz = na.z + sz * t;
            for (const side of [1, -1]) {
              if (!sideBuilt(side)) continue;
              const ox = nxv * side * (CITY.ROAD_W / 2 + 2.2);
              const oz = nzv * side * (CITY.ROAD_W / 2 + 2.2);
              const yaw = Math.atan2(-nxv * side, -nzv * side);
              e.set(0, yaw, 0); q.setFromEuler(e);
              p.set(px + ox, this.roads.terrainY(px + ox, pz + oz) + 0.28, pz + oz);

              const base = new THREE.Matrix4().compose(p, q, s1);
              const lampBox = this._registerCollider(p.x, p.z, 0.55, p.y, p.y + 7.4);
              const bulbP = p.clone();
              bulbP.y += 7.05;
              bulbP.x += Math.sin(yaw) * 1.75; bulbP.z += Math.cos(yaw) * 1.75;
              this.props.push({
                kind: 'lamp', yaw, alive: true, collider: lampBox,
                pos: p.clone(),
                center: new THREE.Vector3(p.x, p.y + 3.7, p.z),
                pivotY: 3.7, radius: 1.6, mass: 1.0,
                base,
                parts: [
                  { geo: lampGeo, mat: lampMat, matrix: base },
                  { geo: bulbGeo, mat: this.lampMat, matrix: new THREE.Matrix4().compose(bulbP, q, s1) }
                ]
              });

              // Street trees on alternate lamp stations, and not on every
              // street — a tree outside every door looks as mechanical as no
              // trees at all.
              if (k % 2 === 0 && this.rng.chance(0.72)) {
                const jit = this.rng.range(-2.4, 2.4);
                const tx = px + nxv * side * (CITY.ROAD_W / 2 + 6.5) + ux * jit;
                const tz = pz + nzv * side * (CITY.ROAD_W / 2 + 6.5) + uz * jit;
                const sp = SPECIES[this.rng.int(0, SPECIES.length - 1)];
                const leafMat = LEAF_MATS[this.rng.int(0, LEAF_MATS.length - 1)];
                const grow = this.rng.range(0.82, 1.24);
                const trunkH = sp.trunk * grow;
                const tp = new THREE.Vector3(tx, this.roads.terrainY(tx, tz) + 0.28, tz);
                const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                  this.rng.range(-0.05, 0.05), this.rng.range(0, Math.PI * 2), this.rng.range(-0.05, 0.05)));
                const tBase = new THREE.Matrix4().compose(
                  tp, lean, new THREE.Vector3(grow, trunkH / 3.0, grow));
                const treeBox = this._registerCollider(tp.x, tp.z, 0.7 * grow, tp.y, tp.y + trunkH);
                const lp = tp.clone(); lp.y += trunkH * 1.05;
                const ls = new THREE.Vector3(grow * this.rng.range(0.85, 1.15), grow * this.rng.range(0.9, 1.25),
                  grow * this.rng.range(0.85, 1.15));
                const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                  this.rng.range(-0.18, 0.18), this.rng.range(0, Math.PI * 2), this.rng.range(-0.18, 0.18)));
                this.props.push({
                  kind: 'tree', yaw: 0, alive: true, collider: treeBox,
                  pos: tp.clone(),
                  center: new THREE.Vector3(tp.x, tp.y + trunkH, tp.z),
                  pivotY: trunkH, radius: sp.r * grow, mass: 1.4,
                  base: tBase,
                  parts: [
                    { geo: trunkGeo, mat: trunkMat, matrix: tBase },
                    { geo: sp.geo, mat: leafMat, matrix: new THREE.Matrix4().compose(lp, lq, ls) }
                  ]
                });
              }
            }
          }
        }
      }
    }

    // one instanced mesh per (geometry, material) pair, indexed back into props
    const batches = new Map();
    for (const prop of this.props) {
      for (const part of prop.parts) {
        // keyed on the PAIR: the same canopy geometry is reused across several
        // leaf colours, and keying on geometry alone would collapse them all
        // onto whichever material happened to be seen first
        const key = part.geo.uuid + '|' + part.mat.uuid;
        let bt = batches.get(key);
        if (!bt) { bt = { geo: part.geo, mat: part.mat, list: [] }; batches.set(key, bt); }
        part.batch = bt;
        part.idx = bt.list.length;
        bt.list.push(part.matrix);
      }
    }
    for (const bt of batches.values()) {
      const im = new THREE.InstancedMesh(bt.geo, bt.mat, bt.list.length);
      bt.list.forEach((m, k) => im.setMatrixAt(k, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = bt.mat !== this.lampMat;
      im.frustumCulled = false;
      this.group.add(im);
      bt.im = im;
      if (bt.mat === this.lampMat) this.bulbMesh = im;
    }
    for (const prop of this.props) for (const part of prop.parts) part.im = part.batch.im;
  }

  /* ---------------- street props ---------------- */

  /**
   * Pull a prop out of its instanced batch and return a free-standing Group
   * the physics system can throw around. The group's origin sits at the prop's
   * centre of mass so it tumbles about the middle rather than its base.
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

  /**
   * Add a slim collider for a piece of street furniture, filed under whichever
   * block is nearest. Lamp posts and trees stand outside both the traffic lanes
   * and the pavement ring, so this blocks the player without snagging the
   * crowd or the cars.
   */
  _registerCollider (x, z, r, base, top) {
    const B = CITY.BLOCKS;
    const bi = clamp(Math.round(x / CITY.CELL + (B - 1) / 2), 0, B - 1);
    const bj = clamp(Math.round(z / CITY.CELL + (B - 1) / 2), 0, B - 1);
    const list = this.blockBuildings.get(bj * B + bi);
    if (!list) return null;
    const box = { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top, base, slim: true };
    list.push(box);
    return box;
  }

  /** Standing props whose centre is within `r` of a point. */
  propsNear (x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const p of this.props) {
      if (!p.alive) continue;
      const dx = p.center.x - x, dz = p.center.z - z;
      if (dx * dx + dz * dz < r2) out.push(p);
    }
    return out;
  }


  /* ---------------- the estate ---------------- */

  /**
   * A mansion on the island in the channel that you can actually walk into.
   *
   * Every other building in the city is a solid block: a box you collide with
   * and stand on top of. This one is built out of thin wall slabs with gaps
   * left in them, so the existing collision handles the interior for free —
   * you walk through a doorway because there is nothing there, and a window is
   * a horizontal band of nothing between a low wall and a high one, which
   * stops you at waist height without needing any glass.
   *
   * Floors work because `groundHeight` only accepts surfaces at or below the
   * ceiling it is handed: standing downstairs the first-floor slab is over your
   * head and is ignored, and once you climb the stairs it becomes the floor.
   */
  /**
   * A scratch builder for a structure with an inside.
   *
   * Returns `solid` (draws a slab and makes it collide), `decor` (draws only)
   * and `finish` (builds the mesh and hands every slab to the block it stands
   * in, so the ordinary collision and ground lookups pick them up with no
   * special cases). Both faces are built on everything: elsewhere a box's
   * underside is never seen so it isn't made, but indoors you spend the whole
   * time standing under a floor slab, and without a soffit the ceiling is a
   * hole to the sky.
   */
  _interior () {
    const b = new MeshBuilder();          // matte shell
    const gl = new MeshBuilder();         // glass and painted steel
    const lt = new MeshBuilder();         // interiors and lit surfaces
    const pick = (m) => (m === 'gloss' ? gl : m === 'lit' ? lt : b);
    const FACES = { top: true, bottom: true };
    const parts = [];
    const solid = (cx, y, cz, w, h, d, col, mat) => {
      pick(mat).box(cx, y, cz, w, h, d, col, FACES);
      parts.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
                   base: y, top: y + h });
    };
    const decor = (cx, y, cz, w, h, d, col, mat) => pick(mat).box(cx, y, cz, w, h, d, col, FACES);
    const finish = () => {
      for (const [mb, mat] of [[b, this.matHouse], [gl, this.matHouseGloss], [lt, this.matHouseLit]]) {
        if (mb.empty()) continue;
        const mesh = new THREE.Mesh(mb.build(), mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      for (const p of parts) {
        const key = this._blockKey((p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2);
        if (key < 0) continue;
        let list = this.blockBuildings.get(key);
        if (!list) { list = []; this.blockBuildings.set(key, list); }
        list.push(p);
        this.buildings.push(p);
      }
    };
    return { b, gl, lt, solid, decor, finish, parts };
  }

  /** Volumes that count as "indoors" — the camera goes first person in them. */
  _addInterior (minX, maxX, minY, maxY, minZ, maxZ) {
    (this.interiors = this.interiors || []).push({ minX, maxX, minY, maxY, minZ, maxZ });
  }

  /** True when this point is inside one of the walk-in buildings. */
  insideInterior (x, y, z) {
    const list = this.interiors;
    if (!list) return false;
    for (const v of list) {
      if (x > v.minX && x < v.maxX && z > v.minZ && z < v.maxZ &&
          y > v.minY && y < v.maxY) return true;
    }
    return false;
  }

  _mansion () {
    const I = CITY.ISLE;
    const stone = LIN('#cfc6b0'), trimc = LIN('#8e8776'), roofc = LIN('#3b4048');
    const floorc = LIN('#9b8a72');
    const { b, solid, decor, finish } = this._interior();

    // Sit the house on a terrace so it doesn't have to follow the lawn.
    const HW = 17, HD = 13;
    let g = -Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        g = Math.max(g, this.roads.terrainY(I.cx + dx * HW, I.cz + dz * HD));
      }
    }
    const F0 = g + 0.9;
    const STOREY = 4.2, WALL = 3.9, T = 0.45;
    const F1 = F0 + STOREY, ROOF = F0 + STOREY * 2;
    this.mansionDoor = new THREE.Vector3(I.cx, F0, I.cz + HD + 7);

    const TZ = HD + 6;                            // terrace half-depth
    solid(I.cx, F0 - 2.2, I.cz, HW * 2 + 12, 2.2, TZ * 2, trimc);
    // Steps down the FRONT of the terrace, outside its edge — put inside they
    // are buried under the slab and the terrace is just a lip you can't climb.
    for (let k = 0; k < 3; k++) {
      solid(I.cx, F0 - 3, I.cz + TZ + 0.85 + k * 1.7, 13, 3 - 0.4 * (k + 1), 1.7, trimc);
    }

    /* ---- walls ---- */
    const wallRun = (x0, z0, x1, z1, y, gaps) => {
      const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const lo = Math.min(horiz ? x0 : z0, horiz ? x1 : z1);
      const hi = Math.max(horiz ? x0 : z0, horiz ? x1 : z1);
      const spans = [];
      let cur = lo;
      for (const [ga, gb] of (gaps || []).slice().sort((p, q) => p[0] - q[0])) {
        if (ga > cur) spans.push([cur, ga]);
        cur = Math.max(cur, gb);
      }
      if (cur < hi) spans.push([cur, hi]);
      // Emit one piece of wall covering [a,b] along the run.
      const emit = (a2, b2, yb, h) => {
        const len = b2 - a2;
        if (len <= 0.02) return;
        const mid = (a2 + b2) / 2;
        const cx = horiz ? mid : x0, cz = horiz ? z0 : mid;
        solid(cx, yb, cz, horiz ? len : T, h, horiz ? T : len, stone);
      };
      for (const [s0, s1] of spans) {
        const L = s1 - s0;
        if (L < 3.4) { emit(s0, s1, y, WALL); continue; }
        // Punch individual windows: piers of full-height wall with a sill and
        // a head over each opening. A single band across the whole run leaves
        // the house open at eye level all the way round — you can see clean
        // through it and it reads as a frame, not a building.
        const n = Math.max(1, Math.round(L / 4.6));
        const cell = L / n, openW = Math.min(2.3, cell * 0.5);
        let cur = s0;
        for (let k = 0; k < n; k++) {
          const oc = s0 + (k + 0.5) * cell;
          const oa = oc - openW / 2, ob = oc + openW / 2;
          emit(cur, oa, y, WALL);                  // pier
          emit(oa, ob, y, 1.05);                   // sill
          emit(oa, ob, y + 2.75, WALL - 2.75);     // head
          cur = ob;
        }
        emit(cur, s1, y, WALL);
      }
    };

    for (const y of [F0, F1]) {
      wallRun(I.cx - HW, I.cz + HD, I.cx + HW, I.cz + HD, y,
        y === F0 ? [[I.cx - 1.6, I.cx + 1.6]] : []);          // front door
      wallRun(I.cx - HW, I.cz - HD, I.cx + HW, I.cz - HD, y,
        y === F0 ? [[I.cx - 1.3, I.cx + 1.3]] : []);          // back door
      wallRun(I.cx - HW, I.cz - HD, I.cx - HW, I.cz + HD, y, []);
      wallRun(I.cx + HW, I.cz - HD, I.cx + HW, I.cz + HD, y, []);
      wallRun(I.cx - 5, I.cz - HD, I.cx - 5, I.cz + HD, y, [[I.cz + 1, I.cz + 4]]);
      wallRun(I.cx + 5, I.cz - HD, I.cx + 5, I.cz + HD, y, [[I.cz + 1, I.cz + 4]]);
      wallRun(I.cx - HW, I.cz - 3, I.cx - 5, I.cz - 3, y, [[I.cx - 12, I.cx - 9]]);
      wallRun(I.cx + 5, I.cz - 3, I.cx + HW, I.cz - 3, y, [[I.cx + 9, I.cx + 12]]);
    }

    /* ---- stairs, up the east side of the hall ---- */
    // Rising away from the front door, so you meet the bottom step first. The
    // other way round the top of the flight is over your head as you approach
    // and you simply walk underneath the whole staircase.
    const STEPS = 14, RISE = STOREY / STEPS, RUN = 0.62;
    for (let k = 0; k < STEPS; k++) {
      solid(I.cx + 2.6, F0 + RISE * k, I.cz + 1.2 - k * RUN, 4.4, RISE + 0.03, RUN, floorc, 'lit');
    }

    /* ---- first floor, stairwell left open ---- */
    // Exactly the stairs' own footprint. Any bigger and you walk off the top
    // step into the hole and drop straight back down to the ground floor.
    const hx0 = I.cx + 0.2, hx1 = I.cx + 5;
    const hz1 = I.cz + 1.2 + RUN / 2;
    const hz0 = I.cz + 1.2 - (STEPS - 1) * RUN - RUN / 2;
    // Four slabs around the stairwell rather than a grid of small tiles: the
    // tiles were seven hundred separate colliders for one floor.
    const slab = (x0, x1, z0, z1) => {
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
      solid((x0 + x1) / 2, F1 - 0.3, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0, floorc, 'lit');
    };
    const bx0 = I.cx - HW, bx1 = I.cx + HW, bz0 = I.cz - HD, bz1 = I.cz + HD;
    slab(bx0, bx1, bz0, hz0);            // beyond the head of the stairs
    slab(bx0, bx1, hz1, bz1);            // beyond the foot
    slab(bx0, hx0, hz0, hz1);            // west of the well
    slab(hx1, bx1, hz0, hz1);            // east of the well

    /* ---- roof ---- */
    solid(I.cx, ROOF - 0.4, I.cz, HW * 2 + 1.4, 0.4, HD * 2 + 1.4, roofc, 'gloss');
    for (const sgn of [-1, 1]) {
      decor(I.cx + sgn * (HW + 0.5), ROOF, I.cz, 0.5, 0.9, HD * 2 + 1.4, trimc);
      decor(I.cx, ROOF, I.cz + sgn * (HD + 0.5), HW * 2 + 1.4, 0.9, 0.5, trimc);
    }

    /* ---- portico ---- */
    for (const px of [-5.4, -2.1, 2.1, 5.4]) {
      solid(I.cx + px, F0, I.cz + HD + 3.4, 1.0, WALL + 0.7, 1.0, stone);
    }
    solid(I.cx, F0 + WALL + 0.7, I.cz + HD + 3.4, 14.5, 0.9, 2.6, trimc);

    this._addInterior(I.cx - HW, I.cx + HW, F0 - 0.5, ROOF - 0.2, I.cz - HD, I.cz + HD);
    finish();
  }


  /**
   * A tower downtown whose top three floors you can walk through, each with a
   * deep wrap-around porch, and a helipad on the roof.
   *
   * Same trick as the mansion: thin wall slabs with gaps, so doorways are
   * simply the absence of wall and each floor slab becomes the floor once you
   * are above it. The shaft underneath is one solid block like any other
   * building — there is nothing to see inside it.
   */
  _penthouse () {
    const bc = blockCenter(CITY.PENTHOUSE.bi, CITY.PENTHOUSE.bj);
    const S = { x: bc.x, z: bc.z, base: this.roads.terrainY(bc.x, bc.z) + CITY.PENTHOUSE.height };
    const conc = LIN('#8d8f95'), glassc = LIN('#5d7488'), deckc = LIN('#6f727a');
    const railc = LIN('#3d444c'), padc = LIN('#2c3138');
    const { solid, decor, finish } = this._interior();

    const HW = 15, HD = 12, PORCH = 5.5;          // porch depth beyond the walls
    const STOREY = 4.4, WALL = 4.0, T = 0.5;
    const g = this.roads.terrainY(S.x, S.z);
    const F = [S.base, S.base + STOREY, S.base + STOREY * 2];
    const ROOF = S.base + STOREY * 3;
    const RUN = 0.66, STEPS = 14, RISE = STOREY / STEPS;
    this.penthouse = { x: S.x, z: S.z, floors: F, roof: ROOF, hw: HW, hd: HD, porch: PORCH };

    // The shaft. Built into its own batch with the tower facade material so it
    // reads as one of the city's skyscrapers rather than a bare concrete post,
    // and stepped back on the way up like the procedural towers are.
    // ---- the tower itself ----
    // A broad podium, a shaft that tapers in setbacks with chamfered corners
    // and vertical fins running the full height, then a collar that flares back
    // out to carry the occupied floors. The chamfers are what keep it from
    // reading as another rectangular block: `box` is axis-aligned, so they are
    // 45-degree prisms run up each corner with `beam`.
    const tb = new MeshBuilder();
    const tint = LIN(TOWER_TINTS[2]);
    const finc = LIN(TRIM_TINTS[0]);
    {
      const top = S.base - 0.36;      // stop UNDER the first floor slab, or the
                                      // two top faces are coplanar and z-fight
      const H = top - g;
      // podium, then five setbacks tapering to the collar
      const plan = [
        { f: 0.00, w: 52, d: 44 },
        { f: 0.14, w: 46, d: 39 },
        { f: 0.34, w: 40, d: 34 },
        { f: 0.55, w: 35, d: 30 },
        { f: 0.74, w: 31, d: 26 },
        { f: 0.89, w: 28, d: 23 },
        { f: 1.00, w: 26, d: 21 }
      ];
      for (let k = 0; k < plan.length - 1; k++) {
        const a = plan[k], b2 = plan[k + 1];
        const y0 = g + H * a.f, y1 = g + H * b2.f;
        const h = y1 - y0;
        tb.box(S.x, y0, S.z, a.w, h, a.d, tint, { gradTop: 1.16 });
        this._registerBox(S.x, y0, S.z, a.w, h, a.d);
        // chamfer each corner of this tier
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            tb.beam(S.x + sx * a.w / 2, y0, S.z + sz * a.d / 2,
              S.x + sx * a.w / 2, y1, S.z + sz * a.d / 2, 1.5, finc);
          }
        }
        // a lit setback band, so the steps read at night
        tb.box(S.x, y1 - 0.9, S.z, a.w + 0.8, 0.9, a.d + 0.8, finc, { top: true });
        this._registerBox(S.x, y1 - 0.9, S.z, a.w + 0.8, 0.9, a.d + 0.8);
      }
      // vertical fins up the long faces
      for (const fx of [-0.34, -0.12, 0.12, 0.34]) {
        tb.beam(S.x + fx * 52, g, S.z - 22, S.x + fx * 26, g + H, S.z - 11, 0.9, finc);
        tb.beam(S.x + fx * 52, g, S.z + 22, S.x + fx * 26, g + H, S.z + 11, 0.9, finc);
      }
    }

    /** Where flight `k` runs, and the hole it needs in the floor it arrives at. */
    const flight = (k) => {
      const sx = S.x + (k % 2 ? -9.5 : 9.5);
      const z0 = S.z + (k % 2 ? -8 : 8);
      const dir = k % 2 ? 1 : -1;
      const zEnd = z0 + dir * (STEPS - 1) * RUN;
      return { sx, z0, dir,
        hx0: sx - 2.5, hx1: sx + 2.5,
        hz0: Math.min(z0, zEnd) - RUN, hz1: Math.max(z0, zEnd) + RUN };
    };

    // A porch slab is a RING between the walls and the parapet. Laid as one
    // full-footprint slab it also seals the stairwell in the floor above, and
    // every flight becomes a dead end.
    const ring = (y, th) => {
      const oX = HW + PORCH, oZ = HD + PORCH;
      const bit = (x0, x1, z0, z1) => {
        if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
        solid((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, th, z1 - z0, deckc);
      };
      bit(S.x - oX, S.x + oX, S.z - oZ, S.z - HD);
      bit(S.x - oX, S.x + oX, S.z + HD, S.z + oZ);
      bit(S.x - oX, S.x - HW, S.z - HD, S.z + HD);
      bit(S.x + HW, S.x + oX, S.z - HD, S.z + HD);
    };

    const wallRun = (x0, z0, x1, z1, y, gaps) => {
      const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const lo = Math.min(horiz ? x0 : z0, horiz ? x1 : z1);
      const hi = Math.max(horiz ? x0 : z0, horiz ? x1 : z1);
      const spans = [];
      let cur = lo;
      for (const [ga, gb] of (gaps || []).slice().sort((p, q) => p[0] - q[0])) {
        if (ga > cur) spans.push([cur, ga]);
        cur = Math.max(cur, gb);
      }
      if (cur < hi) spans.push([cur, hi]);
      const emit = (a, b2, yb, h, col, mat) => {
        const len = b2 - a;
        if (len <= 0.02) return;
        const mid = (a + b2) / 2;
        const cx = horiz ? mid : x0, cz = horiz ? z0 : mid;
        solid(cx, yb, cz, horiz ? len : T, h, horiz ? T : len, col, mat);
      };
      for (const [s0, s1] of spans) {
        // Near floor-to-ceiling glazing, divided by mullions into a run of
        // separate windows. One unbroken band per floor reads as a stripe; the
        // piers between the panes are what make it read as windows at all.
        const SILL = 0.55, HEAD = 0.45;
        emit(s0, s1, y, SILL, conc);                          // spandrel
        emit(s0, s1, y + WALL - HEAD, HEAD, conc);            // head
        const L = s1 - s0;
        const bays = Math.max(1, Math.round(L / 3.1));
        const bw = L / bays, mull = 0.26;
        for (let k = 0; k < bays; k++) {
          const a0 = s0 + k * bw, a1 = a0 + bw;
          emit(a0 + mull / 2, a1 - mull / 2, y + SILL, WALL - SILL - HEAD, glassc, 'gloss');
          if (k) emit(a0 - mull / 2, a0 + mull / 2, y + SILL, WALL - SILL - HEAD, conc);
        }
      }
    };

    for (let k = 0; k < 3; k++) {
      const y = F[k];
      ring(y - 0.35, 0.35);
      // interior floor: solid at the bottom, cut for the flight below it above
      if (k === 0) {
        solid(S.x, y - 0.35, S.z, HW * 2, 0.35, HD * 2, deckc, 'lit');
      } else {
        const f = flight(k - 1);
        this._floorWithWell(solid, S.x, S.z, HW, HD, y - 0.35, 0.35, deckc,
          f.hx0, f.hx1, f.hz0, f.hz1);
      }
      // parapet round the porch — solid, since it's the only thing between you
      // and three hundred metres of nothing
      for (const sgn of [-1, 1]) {
        solid(S.x + sgn * (HW + PORCH), y, S.z, 0.36, 1.2, (HD + PORCH) * 2, railc, 'gloss');
        solid(S.x, y, S.z + sgn * (HD + PORCH), (HW + PORCH) * 2, 1.2, 0.36, railc, 'gloss');
      }
      // glazed envelope with a way out onto the porch on each side
      wallRun(S.x - HW, S.z + HD, S.x + HW, S.z + HD, y, [[S.x - 2, S.x + 2]]);
      wallRun(S.x - HW, S.z - HD, S.x + HW, S.z - HD, y, [[S.x - 2, S.x + 2]]);
      wallRun(S.x - HW, S.z - HD, S.x - HW, S.z + HD, y, [[S.z - 2, S.z + 2]]);
      wallRun(S.x + HW, S.z - HD, S.x + HW, S.z + HD, y, [[S.z - 2, S.z + 2]]);
      // one partition per floor, so it isn't a single open box
      wallRun(S.x - 4, S.z - HD, S.x - 4, S.z + HD, y, [[S.z + 2, S.z + 6]]);

      // the flight up out of this level
      const f = flight(k);
      for (let i = 0; i < STEPS; i++) {
        solid(f.sx, y + RISE * i, f.z0 + f.dir * i * RUN, 4.2, RISE + 0.03, RUN, deckc, 'lit');
      }
    }

    // roof: ring plus an interior deck with the last stairwell left open
    ring(ROOF - 0.4, 0.4);
    {
      const f = flight(2);
      this._floorWithWell(solid, S.x, S.z, HW, HD, ROOF - 0.4, 0.4, deckc,
        f.hx0, f.hx1, f.hz0, f.hz1);
    }
    // Roof parapet, with a gap on the east side where the walkway leaves for
    // the helipad — a continuous rail there fences the pad off completely.
    solid(S.x - (HW + PORCH), ROOF, S.z, 0.36, 1.2, (HD + PORCH) * 2, railc);
    solid(S.x, ROOF, S.z + (HD + PORCH), (HW + PORCH) * 2, 1.2, 0.36, railc);
    solid(S.x, ROOF, S.z - (HD + PORCH), (HW + PORCH) * 2, 1.2, 0.36, railc);
    for (const sgn of [-1, 1]) {
      const zc = S.z + sgn * ((HD + PORCH) + 3.2) / 2 + sgn * 1.6;
      const len = (HD + PORCH) - 3.2;
      solid(S.x + (HW + PORCH), ROOF, S.z + sgn * ((HD + PORCH) + 3.2) / 2,
        0.36, 1.2, len, railc);
    }

    // the enclosed part of each floor counts as indoors
    for (const fy of F) this._addInterior(S.x - HW, S.x + HW, fy - 0.5, fy + WALL, S.z - HD, S.z + HD);

    // Helipad: a big circular deck cantilevered clear of the tower on raking
    // struts, the way Stark Tower carries its own. Flush with the roof and
    // overlapping it, so you can walk straight out — raised even a little and
    // it becomes a ledge you can't climb.
    const R = 15;
    const PX = S.x + HW + PORCH + R - 3;         // hangs off the east face
    const PY = ROOF;
    // the disc, built as a ring of wedges so it reads round rather than square
    const SEG = 20;
    for (let k = 0; k < SEG; k++) {
      const a0 = k / SEG * Math.PI * 2, a1 = (k + 1) / SEG * Math.PI * 2;
      const mx = PX + Math.cos((a0 + a1) / 2) * R * 0.5;
      const mz = S.z + Math.sin((a0 + a1) / 2) * R * 0.5;
      const wq = R * 0.62, dq = R * 0.62;
      decor(mx, PY - 0.5, mz, wq, 0.5, dq, deckc, 'gloss');
    }
    solid(PX, PY - 0.5, S.z, R * 1.5, 0.5, R * 1.5, deckc, 'gloss');
    for (const sgn of [-1, 1]) {
      solid(PX + sgn * R * 0.62, PY - 0.5, S.z, R * 0.85, 0.5, R * 1.15, deckc, 'gloss');
      solid(PX, PY - 0.5, S.z + sgn * R * 0.62, R * 1.15, 0.5, R * 0.85, deckc, 'gloss');
    }
    // markings
    decor(PX, PY + 0.04, S.z, R * 1.35, 0.1, R * 1.35, padc, 'gloss');
    decor(PX - 3.0, PY + 0.1, S.z, 1.3, 0.1, 9, LIN('#e8e2c8'), 'lit');
    decor(PX + 3.0, PY + 0.1, S.z, 1.3, 0.1, 9, LIN('#e8e2c8'), 'lit');
    decor(PX, PY + 0.1, S.z, 4.8, 0.1, 1.3, LIN('#e8e2c8'), 'lit');
    // perimeter lights
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      decor(PX + Math.cos(a) * (R - 1.4), PY + 0.15, S.z + Math.sin(a) * (R - 1.4),
        0.7, 0.22, 0.7, LIN('#ffe6a8'), 'lit');
    }
    // Raking struts back to the shaft. Kept slim and dark: heavy pale ones read
    // as a great white X painted across the front of the building rather than
    // as the structure holding the pad up.
    const strutc = LIN('#4a5058');
    for (const sgn of [-1, 1]) {
      tb.beam(S.x + HW + 1, ROOF - 20, S.z + sgn * 8,
        PX + R * 0.45, PY - 0.7, S.z + sgn * 8, 0.42, strutc);
    }
    tb.beam(S.x + HW + 1, ROOF - 26, S.z, PX - R * 0.2, PY - 0.7, S.z, 0.48, strutc);

    // crown spire
    decor(S.x, ROOF + 0.4, S.z - HD - 1, 1.4, 26, 1.4, LIN(TRIM_TINTS[0]), 'gloss');
    decor(S.x, ROOF + 26, S.z - HD - 1, 0.7, 9, 0.7, LIN('#ffd9a0'), 'lit');

    // built last: the struts and the crown are added to this batch after the
    // shaft, so it can't be closed off when the shaft finishes
    const tm = new THREE.Mesh(tb.build(), this.matTower);
    tm.castShadow = true; tm.receiveShadow = true;
    this.group.add(tm);
    finish();
  }


  /**
   * An aircraft carrier moored alongside the battleship.
   *
   * The flight deck is the roof of a hangar you can actually walk into: the
   * deck slab IS the hangar's ceiling, the hull sides are its walls, and the
   * stern is left open so you can fly or walk straight in. Same trick as the
   * mansion — the interior is the space left between slabs, so the ordinary
   * collision handles it without knowing anything about ships.
   */
  _carrier () {
    const S = CITY.CARRIER;
    const hullc = LIN('#39424b'), deckc = LIN('#3a3d40'), superc = LIN('#767b81');
    const stripec = LIN('#d8d2bc'), redc = LIN('#5e2b24'), gunc = LIN('#2b3138');
    const { solid, decor, finish } = this._interior();

    const L = S.len / 2, W = S.beam / 2, DW = S.deckW / 2;
    // Deck paint has both faces built, so its underside lands exactly on the
    // deck it sits on and the two z-fight. A few centimetres of daylight fixes
    // it and is invisible from any angle you can stand at.
    const MARK = 0.04;
    const HANGAR = CITY.WATER_Y + 5.0;          // hangar floor
    const HHEAD = 7.5;                          // hangar headroom
    const DECK = HANGAR + HHEAD;                // flight deck level
    this.carrier = { x: S.x, z: S.z, deck: DECK, hangar: HANGAR, len: S.len, beam: S.beam, deckW: S.deckW };

    /* ---- hull ---- */
    const N = 16;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const zc = S.z - L + (t0 + t1) / 2 * S.len;
      const e = Math.min((t0 + t1) / 2, 1 - (t0 + t1) / 2) * 2;
      const hw = W * (0.30 + 0.70 * Math.pow(Math.min(1, e * 1.7), 0.55));
      // stops under the hangar floor so their top faces aren't coplanar
      solid(S.x, CITY.WATER_Y - 5.5, zc, hw * 2, (HANGAR - 0.42) - (CITY.WATER_Y - 5.5),
        S.len / N, hullc);
      decor(S.x, CITY.WATER_Y - 0.25, zc, hw * 2 + 0.5, 0.8, S.len / N, redc, 'gloss');
    }

    /* ---- hangar: floor, side walls, and the deck overhead ---- */
    // Floor, walls and the deckhead all in one tone leave the hangar a flat
    // void with no depth to it, so they are separated and the overhead is
    // strip-lit down its length.
    const hangarFloor = LIN('#7e8288'), hangarWall = LIN('#2c3339');
    solid(S.x, HANGAR - 0.42, S.z, W * 2 - 1, 0.42, S.len * 0.86, hangarFloor, 'lit');
    // deck lines on the hangar floor
    for (const sgn of [-1, 1]) {
      decor(S.x + sgn * (W - 4), HANGAR + MARK, S.z, 0.5, 0.06, S.len * 0.78, LIN('#c8bf94'), 'lit');
    }
    for (const sgn of [-1, 1]) {
      // Run nearly the whole length: covering only the middle leaves the aft
      // third open to the sea on both sides, and it reads as a covered
      // platform rather than a hangar. Only the stern is a door.
      solid(S.x + sgn * (W - 0.5), HANGAR, S.z - L * 0.04, 1.0, HHEAD, S.len * 0.80, hangarWall);
    }
    solid(S.x, HANGAR, S.z - L * 0.86, W * 2, HHEAD, 1.2, hangarWall);  // forward bulkhead
    // a rank of columns down the middle, so it reads as a hangar not a tunnel
    for (let k = -4; k <= 4; k++) {
      decor(S.x, HANGAR, S.z + k * 24, 1.1, HHEAD, 1.1, superc, 'gloss');
      // strip lights overhead, either side of the columns
      for (const sgn of [-1, 1]) {
        decor(S.x + sgn * (W * 0.55), HANGAR + HHEAD - 0.45, S.z + k * 24,
          1.6, 0.3, 13, LIN('#ffe9bd'), 'lit');
      }
    }

    /* ---- flight deck ---- */
    solid(S.x, DECK - 0.5, S.z, DW * 2, 0.5, S.len, deckc, 'lit');
    // the angled landing strip, offset to port
    decor(S.x - DW * 0.34, DECK + MARK, S.z - L * 0.12, 2.0, 0.08, S.len * 0.62, stripec, 'lit');
    for (let k = -7; k <= 7; k++) {
      decor(S.x - DW * 0.34, DECK + MARK, S.z + k * 16, 5.0, 0.08, 2.0, stripec, 'lit');
    }
    // centreline down the bow
    decor(S.x + DW * 0.18, DECK + MARK, S.z - L * 0.62, 1.6, 0.08, S.len * 0.3, stripec, 'lit');
    // arrestor wires aft
    for (let k = 0; k < 4; k++) {
      decor(S.x - DW * 0.34, DECK + 0.1, S.z + L * 0.36 + k * 7, DW * 1.1, 0.1, 0.35, gunc, 'gloss');
    }
    // deck edge, low enough to fly over but enough to stop a walk off the side
    for (const sgn of [-1, 1]) {
      solid(S.x + sgn * DW, DECK, S.z, 0.5, 0.85, S.len, hullc, 'gloss');
    }
    solid(S.x, DECK, S.z - L, DW * 2, 0.85, 0.5, hullc, 'gloss');
    // stern is left open — that is how you get in and out of the hangar

    /* ---- island, starboard side ---- */
    const IX = S.x + DW - 7;
    solid(IX, DECK, S.z + L * 0.1, 11, 9, 34, superc);
    solid(IX, DECK + 9, S.z + L * 0.06, 8.5, 6, 20, superc, 'lit');
    solid(IX, DECK + 15, S.z + L * 0.04, 6, 4.5, 12, superc, 'lit');
    decor(IX, DECK + 19.5, S.z + L * 0.04, 0.7, 16, 0.7, gunc, 'gloss');
    decor(IX - 1.5, DECK + 30, S.z + L * 0.04, 7, 0.4, 0.5, gunc, 'gloss');
    for (const dz of [-6, 6]) {
      decor(IX, DECK + 24, S.z + L * 0.04 + dz, 3.4, 3.0, 3.0, gunc, 'gloss');
    }

    /* ---- deck-edge lifts ---- */
    for (const dz of [-L * 0.30, L * 0.22]) {
      solid(S.x - DW - 4, DECK - 0.5, S.z + dz, 8, 0.5, 16, deckc, 'gloss');
    }

    // the hangar counts as indoors
    this._addInterior(S.x - W + 1, S.x + W - 1, HANGAR - 0.5, DECK - 0.6,
      S.z - L * 0.82, S.z + L * 0.74);
    finish();
  }

  /** Register a solid box that was drawn into some other mesh. */
  _registerBox (cx, y, cz, w, h, d) {
    const box = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
                  base: y, top: y + h };
    const key = this._blockKey(cx, cz);
    if (key >= 0) {
      let list = this.blockBuildings.get(key);
      if (!list) { list = []; this.blockBuildings.set(key, list); }
      list.push(box);
      this.buildings.push(box);
    }
    return box;
  }

  /** A floor slab covering a footprint with a rectangular stairwell left out. */
  _floorWithWell (solid, cx, cz, hw, hd, y, th, col, hx0, hx1, hz0, hz1) {
    const x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd;
    const slab = (a, b2, c2, d2) => {
      if (b2 - a < 0.05 || d2 - c2 < 0.05) return;
      solid((a + b2) / 2, y, (c2 + d2) / 2, b2 - a, th, d2 - c2, col, 'lit');
    };
    slab(x0, x1, z0, Math.max(z0, hz0));
    slab(x0, x1, Math.min(z1, hz1), z1);
    slab(x0, Math.max(x0, hx0), Math.max(z0, hz0), Math.min(z1, hz1));
    slab(Math.min(x1, hx1), x1, Math.max(z0, hz0), Math.min(z1, hz1));
  }

  /**
   * A warship moored off the harbour. The main deck is walkable, so it makes a
   * standing arena out in the water that has to be reached by air or by sea.
   */
  _battleship () {
    const S = CITY.SHIP;
    const hullc = LIN('#3f4750'), deckc = LIN('#6b6f72'), superc = LIN('#7d8288');
    const gunc = LIN('#2f353c'), redc = LIN('#5e2b24');
    const { solid, decor, finish } = this._interior();

    const L = S.len / 2, W = S.beam / 2;
    const DECK = CITY.WATER_Y + 7.5;
    this.battleship = { x: S.x, z: S.z, deck: DECK, len: S.len, beam: S.beam };

    // hull, tapering to a bow and a stern
    const N = 12;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const zc = S.z - L + (t0 + t1) / 2 * S.len;
      const taper = (t) => {
        const e = Math.min(t, 1 - t) * 2;              // 0 at the ends, 1 amidships
        return W * (0.28 + 0.72 * Math.pow(Math.min(1, e * 1.6), 0.6));
      };
      const hw = taper((t0 + t1) / 2);
      // The hull has to stop UNDER the deck slab. Running it up to the same
      // height puts twelve hull tops and the deck at exactly one plane, and the
      // renderer can't choose between them — which is the banding across the
      // deck. The segments also butt rather than overlap, so their sides don't
      // fight each other where the taper makes two of them the same width.
      const hullTop = DECK - 0.42;
      solid(S.x, CITY.WATER_Y - 3.4, zc, hw * 2, hullTop - (CITY.WATER_Y - 3.4), S.len / N, hullc);
      decor(S.x, CITY.WATER_Y - 0.2, zc, hw * 2 + 0.5, 0.7, S.len / N, redc, 'gloss');
    }
    // main deck
    solid(S.x, DECK - 0.4, S.z, W * 2 * 0.94, 0.4, S.len * 0.96, deckc, 'lit');
    // Bulwark. Has to be solid, not decoration, or it is a painted line and
    // you walk over the side into the sea.
    for (const sgn of [-1, 1]) {
      solid(S.x + sgn * W * 0.94, DECK, S.z, 0.5, 1.3, S.len * 0.96, hullc, 'gloss');
    }
    // and caps across the bow and stern
    for (const sgn of [-1, 1]) {
      solid(S.x, DECK, S.z + sgn * S.len * 0.48, W * 2 * 0.94, 1.3, 0.5, hullc, 'gloss');
    }

    // superstructure: a stack of blocks with a walkable bridge deck
    solid(S.x, DECK, S.z + 6, W * 1.15, 7.5, 26, superc);
    solid(S.x, DECK + 7.5, S.z + 2, W * 0.85, 5.5, 16, superc);
    solid(S.x, DECK + 13, S.z, W * 0.5, 4.0, 9, superc, 'lit');
    decor(S.x, DECK + 17, S.z, 0.6, 12, 0.6, gunc, 'gloss');     // mast
    decor(S.x, DECK + 24, S.z, 5, 0.4, 0.5, gunc);

    // funnels
    for (const dz of [12, 19]) {
      decor(S.x, DECK + 7.5, S.z + dz, 5.5, 6.5, 5, gunc);
    }
    // turrets fore and aft
    for (const dz of [-L * 0.62, -L * 0.36, L * 0.66]) {
      const ty = DECK;
      solid(S.x, ty, S.z + dz, 11, 3.2, 11, superc);
      const bar = dz > 0 ? -1 : 1;
      for (const off of [-2.2, 0, 2.2]) {
        decor(S.x + off, ty + 2.2, S.z + dz + bar * 8, 0.75, 0.75, 13, gunc, 'gloss');
      }
    }
    finish();
  }

  /* ---------------- queries ---------------- */

  _blockKey (x, z) {
    const B = CITY.BLOCKS;
    const bi = Math.round(x / CITY.CELL + (B - 1) / 2);
    const bj = Math.round(z / CITY.CELL + (B - 1) / 2);
    if (bi < 0 || bj < 0 || bi >= B || bj >= B) return -1;
    return bj * B + bi;
  }

  /** Open water — no ground, and nothing should be spawned here. */
  /** Open water: anywhere the ground sits below the waterline. */
  isWater (x, z) {
    if (bridgeHeight(x, z) !== null) return false;
    return this.roads.terrainY(x, z) < CITY.WATER_Y + 0.25;
  }

  buildingsNear (x, z) {
    const out = [];
    if (this.bridgeWalls) out.push(...this.bridgeWalls);
    const B = CITY.BLOCKS;
    const bi = Math.round(x / CITY.CELL + (B - 1) / 2);
    const bj = Math.round(z / CITY.CELL + (B - 1) / 2);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = bi + di, j = bj + dj;
        if (i < 0 || j < 0 || i >= B || j >= B) continue;
        const l = this.blockBuildings.get(j * B + i);
        if (l) out.push(...l);
      }
    }
    return out;
  }

  /** Highest solid surface under (x,z) at or below `ceiling`. */
  groundHeight (x, z, ceiling = Infinity) {
    const bh = bridgeHeight(x, z);
    if (bh !== null && bh <= ceiling) return bh;
    // Several meshes can be the top surface here — open ground, the asphalt,
    // the kerbside footpath — and each is built its own way, so none of them
    // can be derived from the others. Take the HIGHEST of whichever apply
    // rather than trying to pick one: standing a few centimetres proud of a
    // surface is barely noticeable, whereas standing below one means sinking
    // into it, which is how characters ended up hidden in the grass and buried
    // in the road.
    // Over open water the sea is the floor — but keep going, because something
    // may still be moored on top of it. Returning here meant the warship's deck
    // was invisible to everything that asks what the ground is.
    let best = this.isWater(x, z) ? CITY.WATER_Y : this.groundSurface(x, z);
    // Only where the asphalt is actually laid. roadCover eases off over the
    // verge so the ground mesh can be sunk smoothly, but out there the surface
    // is grass, and lifting to road level floated characters above the verge.
    if (this.roads.roadCover(x, z) > 0.98) best = Math.max(best, this.roads.terrainY(x, z) + 0.06);
    if (this.padAt(x, z)) best = Math.max(best, this.roads.terrainY(x, z) + this.sidewalkY);
    // Search the same 3x3 neighbourhood that resolveCollision does. Looking at
    // one block only meant a roof whose block differed from the sample point's
    // was invisible here, and you fell straight through it.
    for (const b of this.buildingsNear(x, z)) {
      // `slim` colliders are lamp posts and tree trunks. They are solid to walk
      // into, but they are not FLOOR — treating them as ground put the standing
      // surface on top of an invisible seven-metre lamp cap.
      if (b.gone || b.slim) continue;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.top > best && b.top <= ceiling) best = b.top;
    }
    return best;
  }

  /** Push a vertical capsule out of any building it has entered. */
  resolveCollision (pos, radius, feetY, headY, skipSlim = false, stepUp = 0) {
    let hit = false;
    for (const b of this.buildingsNear(pos.x, pos.z)) {
      if (b.gone || (skipSlim && b.slim)) continue;
      if (feetY >= b.top - 0.05 || headY <= b.base) continue;
      // Low enough to step onto. Without this a staircase is a deadlock: the
      // collider keeps your centre outside its footprint, so you can never get
      // over it to be lifted onto it, and every flight of steps is a wall.
      if (stepUp > 0 && b.top <= feetY + stepUp) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // centre is inside the box — eject along the shallowest axis
        const l = pos.x - b.minX, r = b.maxX - pos.x;
        const u = pos.z - b.minZ, dn = b.maxZ - pos.z;
        const m = Math.min(l, r, u, dn);
        if (m === l) pos.x = b.minX - radius;
        else if (m === r) pos.x = b.maxX + radius;
        else if (m === u) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
    return hit;
  }

  /**
   * Collide a moving sphere against the building set and reflect it.
   *
   * Ray-marching a thrown object misses buildings whenever the step is larger
   * than the wall is thick, which is why things used to sail straight through
   * them. This does an actual AABB push-out and derives the surface normal
   * from the ejection direction, so anything thrown bounces off properly.
   *
   * Returns true when it hit something.
   */
  bounceMoving (pos, vel, radius, restitution = 0.42) {
    let hit = false;
    const feet = pos.y - radius, head = pos.y + radius;
    for (const b of this.buildingsNear(pos.x, pos.z)) {
      if (b.gone) continue;
      if (feet >= b.top || head <= b.base) continue;
      const cx = clamp(pos.x, b.minX, b.maxX);
      const cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;

      let nx = 0, nz = 0, ny = 0;
      if (d2 > 1e-6) {
        if (d2 > radius * radius) continue;
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d;
        pos.x = cx + nx * radius;
        pos.z = cz + nz * radius;
      } else {
        // centre inside the box — eject through the nearest face, roof included
        const l = pos.x - b.minX, r = b.maxX - pos.x;
        const u = pos.z - b.minZ, dn = b.maxZ - pos.z;
        const up = b.top - pos.y;
        const m = Math.min(l, r, u, dn, up);
        if (m === up) { pos.y = b.top + radius; ny = 1; }
        else if (m === l) { pos.x = b.minX - radius; nx = -1; }
        else if (m === r) { pos.x = b.maxX + radius; nx = 1; }
        else if (m === u) { pos.z = b.minZ - radius; nz = -1; }
        else { pos.z = b.maxZ + radius; nz = 1; }
      }
      const into = vel.x * nx + vel.y * ny + vel.z * nz;
      if (into < 0) {
        vel.x -= (1 + restitution) * into * nx;
        vel.y -= (1 + restitution) * into * ny;
        vel.z -= (1 + restitution) * into * nz;
        // scrub tangential speed on the scrape
        vel.multiplyScalar(0.86);
      }
      hit = true;
    }
    return hit;
  }

  /** First building hit along a ray — used by flight collision and beams. */
  /**
   * True when nothing solid stands between two points.
   *
   * `raycastBuildings` steps every six metres, which is fine for picking a
   * target but walks straight through a half-metre wall — so line of sight
   * needs its own march at a step smaller than anything you can hide behind.
   */
  hasLineOfSight (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.6) return true;
    // The cap has to be generous enough for a long-range check: at 120 steps
    // of 0.9 m the march silently gave up past ~108 m, so anything further was
    // "visible" by default.
    const STEP = 0.9;
    const n = Math.min(420, Math.ceil(dist / STEP));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
      const bh = bridgeHeight(px, pz);
      if (bh !== null && py < bh && py > bh - 2) return false;
      for (const b of this.buildingsNear(px, pz)) {
        if (b.gone || b.slim) continue;      // lamp posts don't block a shot
        if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ &&
            py > b.base && py < b.top) return false;
      }
    }
    return true;
  }

  /**
   * How far the camera can pull back from `pivot` along `dir` before it enters
   * anything solid.
   *
   * `raycastBuildings` steps every six metres, so an arm swinging back through
   * a thirty-centimetre floor slab never touches it — which is why the camera
   * dropped through the floors of the penthouse. This marches finely and keeps
   * a radius of clearance, so the camera stops short of a surface rather than
   * sitting flush in it.
   */
  /** True when this point is inside something solid. */
  pointInSolid (x, y, z, pad = 0) {
    for (const b of this.buildingsNear(x, z)) {
      if (b.gone || b.slim) continue;
      if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad &&
          y > b.base - pad && y < b.top + pad) return true;
    }
    return false;
  }

  cameraClearance (pivot, dir, maxDist, radius = 0.34) {
    const STEP = 0.3;
    const n = Math.ceil(maxDist / STEP);
    for (let k = 1; k <= n; k++) {
      const t = Math.min(maxDist, k * STEP);
      const px = pivot.x + dir.x * t, py = pivot.y + dir.y * t, pz = pivot.z + dir.z * t;
      for (const b of this.buildingsNear(px, pz)) {
        if (b.gone || b.slim) continue;
        if (px > b.minX - radius && px < b.maxX + radius &&
            pz > b.minZ - radius && pz < b.maxZ + radius &&
            py > b.base - radius && py < b.top + radius) {
          return Math.max(0, t - STEP - 0.05);
        }
      }
    }
    return maxDist;
  }

  raycastBuildings (origin, dir, maxDist) {
    let best = maxDist, hitB = null;
    const step = 6;
    const n = Math.ceil(maxDist / step);
    const p = new THREE.Vector3();
    for (let k = 1; k <= n; k++) {
      const t = Math.min(maxDist, k * step);
      p.copy(dir).multiplyScalar(t).add(origin);
      for (const b of this.buildingsNear(p.x, p.z)) {
        if (b.gone) continue;
        if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y > b.base && p.y < b.top) {
          if (t < best) { best = t; hitB = b; }
          break;
        }
      }
      if (hitB) break;
    }
    return hitB ? { dist: best, building: hitB } : null;
  }
}
