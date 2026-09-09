import * as THREE from 'three';
import { rand, randInt, Noise, Rng } from '../core/Util.js';

export const CITY = {
  GRID: 19,            // intersections per side
  CELL: 140,           // intersection spacing
  ROAD_W: 24,          // full carriageway width
  get BLOCK () { return this.CELL - this.ROAD_W; },
  LANE: 6,             // lane centre offset from road centreline
  CURB: 10,            // parking bay offset from road centreline
  get HALF () { return (this.GRID - 1) * this.CELL / 2; },
  get BLOCKS () { return this.GRID - 1; },
  SIDEWALK_INSET: 5,

  /* ---- fixed world layout: two islands, one bridge ---- */
  SEED: 20260908,
  WATER_Y: -1.4,
  WEST: { cx: -730, cz: -40, rx: 520, rz: 790 },
  EAST: { cx: 700, cz: 40, rx: 520, rz: 840 },
  BRIDGE_J: 8,         // node row that carries the crossing
  BRIDGE_I0: 7,        // west abutment
  BRIDGE_I1: 11,       // east abutment
  BRIDGE_W: 36,
  BRIDGE_Y: 22,        // deck height above sea level at mid-span
  /* a private estate on its own island, out in the channel south of the bridge */
  ISLE: { cx: 0, cz: 300, r: 96 },
  /* the block downtown that carries the penthouse tower */
  PENTHOUSE: { bi: 3, bj: 5, height: 330 },   // one of the tallest in the city
  /* a warship moored out in the channel, north of the bridge */
  SHIP: { x: -70, z: -560, len: 184, beam: 27 },
  /* an aircraft carrier moored alongside her, with a hangar you can walk into */
  CARRIER: { x: -200, z: -560, len: 300, beam: 30, deckW: 62 },
  get SHORE () { return this.HALF + this.CELL * 0.9; }
};

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clampIdx = (v, n) => Math.max(0, Math.min(n - 1, v));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * How much the road owns the ground at `d` metres from its centreline: all of
 * it out to the kerb, then easing back into the natural slope across the verge
 * so the cut blends in instead of ending at a step.
 */
/** Stable key for the segment between two adjacent nodes. */
const segKey = (a, b, G) => {
  const lo = a.id < b.id ? a : b, hi = a.id < b.id ? b : a;
  return lo.id * G * G + hi.id;
};

/**
 * How built-up a spot is: 1 in the two urban cores, falling to 0 out in the
 * countryside. Drives how much of the street grid actually gets built.
 */
function urbanity (x, z) {
  const d1 = Math.hypot((x + 780) / 500, (z + 120) / 660);   // west city core
  const d2 = Math.hypot((x - 690) / 450, (z + 250) / 520);   // east business park
  return clamp(1 - Math.min(d1, d2), 0, 1);
}

/** Distance from a point to a segment, plus where along it the foot lands. */
function segDist (x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L2 = dx * dx + dz * dz || 1e-6;
  let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = a.x + dx * t - x, pz = a.z + dz * t - z;
  return { d: Math.hypot(px, pz), t };
}

const JITTER = 32;        // how far a suburban junction can wander off the lattice
const GRADE_EDGE = CITY.ROAD_W / 2 + 20;
function ROAD_W_FALLOFF (d) {
  const flat = CITY.ROAD_W / 2 + 1.5;
  if (d <= flat) return 1;
  if (d >= GRADE_EDGE) return 0;
  const t = (d - flat) / (GRADE_EDGE - flat);
  return 1 - t * t * (3 - 2 * t);
}

export const nodeX = i => (i - (CITY.GRID - 1) / 2) * CITY.CELL;
export const blockCenter = (i, j) => ({
  x: (i - (CITY.BLOCKS - 1) / 2) * CITY.CELL,
  z: (j - (CITY.BLOCKS - 1) / 2) * CITY.CELL
});

/* ------------------------------------------------------------------ *
 *  Land, sea and terrain
 *
 *  Two island fields with a noise-perturbed coastline. `landField` is
 *  positive inland and negative at sea, which doubles as a distance-to-shore
 *  proxy — heights fade to zero at the coast and the seabed drops away, so
 *  beaches and shallows fall out of the same function instead of needing a
 *  separate shoreline pass.
 * ------------------------------------------------------------------ */

let _coast = null, _cove = null, _fringe = null;
function coastNoise (x, z) {
  if (!_coast) _coast = new Noise(CITY.SEED ^ 0x51ed);
  return _coast.fbm(x * 0.0019 + 7.3, z * 0.0019 - 2.1, 3);
}
/** Higher-frequency shoreline detail: the coves, spits and headlands. */
function coveNoise (x, z) {
  if (!_cove) _cove = new Noise(CITY.SEED ^ 0x2b7f);
  return _cove.fbm(x * 0.0071 - 3.4, z * 0.0071 + 5.9, 3);
}
/** The last few metres of raggedness, so the waterline isn't a clean curve. */
function fringeNoise (x, z) {
  if (!_fringe) _fringe = new Noise(CITY.SEED ^ 0x9c13);
  // Kept well below the ground mesh's 22 m quads: at a shorter wavelength the
  // coastline aliases against the grid and the waterline turns into a sawtooth.
  return _fringe.fbm(x * 0.009 + 1.7, z * 0.009 - 4.2, 2);
}

/**
 * The little estate island, as a field on the same scale as the two big ones.
 *
 * Reusing their form with a 96 m radius would make the field fall off five
 * times as fast, and the shore ramp and the grading that hang off it are tuned
 * to the main islands' gradient — the beach would come out as a cliff. So this
 * is expressed as distance-to-shore over the same 520 m denominator.
 */
function isleField (x, z) {
  const I = CITY.ISLE;
  const d = Math.hypot(x - I.cx, z - I.cz);
  const wob = (coveNoise(x, z) - 0.5) * 30;      // metres of coastline wobble
  return (I.r + wob - d) / 520;
}

/** True on the estate island (ignoring the coastline wobble). */
export const onIsle = (x, z) =>
  Math.hypot(x - CITY.ISLE.cx, z - CITY.ISLE.cz) < CITY.ISLE.r + 16;

export function landField (x, z) {
  // A plain radial field reads as a circular blob from the air, so the
  // coastline gets two scales of wobble: broad bays from the low-frequency
  // term and headlands and inlets from the finer one.
  const wob = (coastNoise(x, z) - 0.5) * 0.30
            + (coveNoise(x, z) - 0.5) * 0.155
            + (fringeNoise(x, z) - 0.5) * 0.05;
  const one = (I) => {
    const dx = (x - I.cx) / I.rx, dz = (z - I.cz) / I.rz;
    return 1 - Math.hypot(dx, dz) + wob;
  };
  return Math.max(one(CITY.WEST), one(CITY.EAST), isleField(x, z));
}

export const isLand = (x, z) => landField(x, z) > 0;

/** Ground height at a point. Negative offshore, so the seabed shelves away. */
export function hillsAt (x, z) {
  const f = landField(x, z);
  if (f <= 0) return Math.max(-16, f * 55 - 0.8);

  const bump = (cx, cz, r, amp) => {
    const d = Math.hypot(x - cx, z - cz) / r;
    return d >= 1 ? 0 : amp * Math.pow(Math.cos(d * Math.PI / 2), 2);
  };
  // Amplitude over radius sets a hill's own gradient (peak slope is
  // amp*PI/2r), so these are kept near 0.15 — about 13 degrees.
  let h = 0;
  h += bump(-800, -440, 660, 88);      // the west island heights
  h += bump(-920, -200, 470, 40);
  h += bump(640, -360, 600, 74);       // northern hill, east island
  h += bump(860, 200, 720, 104);       // the big south-east massif
  h += bump(380, 560, 470, 38);
  h -= bump(-700, 120, 500, 24);       // downtown sits low
  h += bump(CITY.ISLE.cx, CITY.ISLE.cz, CITY.ISLE.r * 1.7, 7);   // the estate's low rise

  // Then cap the height by distance from the shoreline. Fading the hills out
  // with a smoothstep instead puts a cliff wherever a tall hill reaches the
  // coast — the whole drop has to happen inside the fade band. A linear cap
  // bounds the coastal gradient directly and leaves the hill alone inland.
  // `f` is roughly (distance to shore) / 520, so 114 is about a 12 degree ramp.
  h = Math.min(h, f * 114);
  // The beach has to meet the seabed exactly, or the shoreline is a step you
  // can stand on top of: at f = 0 this is -0.8, the same value the water
  // branch above returns there, and it ramps up over the first few metres of
  // sand to the 0.8 the rest of the land sits at.
  const shore = -0.8 + 1.6 * smoothstep(0, 0.014, f);
  return Math.max(shore, h);
}

/**
 * How far inland the sand runs at this point, in `landField` units. The east
 * island's seaward side is the resort beach and gets a broad shelf; everywhere
 * else the waterline is a thin strip of sand backed by grass or rock.
 */
export function beachWidth (x, z) {
  const E = CITY.EAST;
  const out = (x - E.cx) / E.rx;
  const wide = smoothstep(0.0, 0.5, out);
  return 0.011 + 0.075 * wide;
}

/** Nodes that sit out over the channel and are carried by the bridge. */
export const isBridgeNode = (i, j) =>
  j === CITY.BRIDGE_J && i >= CITY.BRIDGE_I0 && i <= CITY.BRIDGE_I1;

/**
 * Deck height, or null off the bridge. The deck meets land at grade at both
 * abutments and arches over the channel in between.
 */
export function bridgeHeight (x, z) {
  const zc = nodeX(CITY.BRIDGE_J);
  if (Math.abs(z - zc) > CITY.BRIDGE_W / 2) return null;
  const x0 = nodeX(CITY.BRIDGE_I0), x1 = nodeX(CITY.BRIDGE_I1);
  if (x < x0 || x > x1) return null;
  const t = (x - x0) / (x1 - x0);
  const ends = hillsAt(x0, zc) * (1 - t) + hillsAt(x1, zc) * t;   // grade at each abutment
  return ends + CITY.BRIDGE_Y * Math.pow(Math.sin(Math.PI * t), 0.7);
}

/** A block is sea if its centre is off land. */
export function isWaterBlock (bi, bj) {
  const c = blockCenter(bi, bj);
  return !isLand(c.x, c.z);
}

export class RoadNetwork {
  constructor () {
    const G = CITY.GRID;
    this.G = G;
    // Node positions are the lattice, PULLED OFF it in the low-density areas.
    // Downtown stays a clean grid, which is what a downtown is; out in the
    // neighbourhoods and the countryside the junctions wander, so streets meet
    // at odd angles and run at different lengths and the whole thing stops
    // reading as graph paper. Segments are still straight between junctions,
    // so traffic, pedestrians, kerbs and markings all keep working unchanged —
    // they were already written against node positions rather than the grid.
    const jr = new Rng(CITY.SEED ^ 0x3c19);
    this.nodes = [];
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const bx = nodeX(i), bz = nodeX(j);
        let x = bx, z = bz;
        const edge = i === 0 || j === 0 || i === G - 1 || j === G - 1;
        if (!edge && !isBridgeNode(i, j) && !isBridgeNode(i - 1, j) && !isBridgeNode(i + 1, j)) {
          const amt = JITTER * Math.pow(1 - urbanity(bx, bz), 1.3);
          const ang = jr.next() * Math.PI * 2;
          const rad = Math.sqrt(jr.next()) * amt;
          x += Math.cos(ang) * rad;
          z += Math.sin(ang) * rad;
        }
        this.nodes.push({ id: j * G + i, i, j, x, z, bx, bz });
      }
    }
    // terrain sampled at every intersection
    this.nodeY = new Float32Array(G * G);
    for (const n of this.nodes) this.nodeY[n.j * G + n.i] = hillsAt(n.x, n.z);
    for (const n of this.nodes) {
      n.y = this.nodeY[n.j * G + n.i];
      n.land = isLand(n.x, n.z) || isBridgeNode(n.i, n.j);
    }

    this._planCuts();

    // only nodes that actually carry a road are useful for spawning or routing
    this.roadNodes = this.nodes.filter(n => this.neighbors(n).length > 0);

    // Link lookup tables. `_linked` runs `isLand`, which is three octaves of
    // noise; `roadGrade` is called for every terrain sample in the world so it
    // cannot afford that. linkH[i,j] is the segment from (i,j) to (i+1,j).
    this.linkH = new Uint8Array(G * G);
    this.linkV = new Uint8Array(G * G);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const n = this.node(i, j);
        if (i < G - 1) this.linkH[j * G + i] = this._linked(n, this.node(i + 1, j)) ? 1 : 0;
        if (j < G - 1) this.linkV[j * G + i] = this._linked(n, this.node(i, j + 1)) ? 1 : 0;
        // the bridge deck is not cut into the ground; it has its own height
        if (isBridgeNode(i, j) && isBridgeNode(i + 1, j)) this.linkH[j * G + i] = 0;
      }
    }

    this._rects = new Map();
    this.bays = [];
    this._buildBays();
    this._buildSidewalk();     // needs linkH/linkV, built above
  }

  /**
   * 1 on the carriageway, easing to 0 just outside it. Tighter than the
   * grading falloff: this marks where the asphalt physically covers the
   * ground, so the terrain can be sunk beneath it.
   */
  /**
   * Nearest road segment to a point, as {d, y}: perpendicular distance and the
   * carriageway height there.
   *
   * Junctions no longer sit on the lattice, so this can't be arithmetic on grid
   * coordinates any more. Displacement is capped well below half a cell, so any
   * segment near the point still has an endpoint among the nine lattice
   * neighbours of the rounded index — which keeps it a fixed, small search.
   */
  nearestRoad (x, z) {
    const G = this.G, C = CITY.CELL, H = CITY.HALF;
    const ci = Math.round((x + H) / C), cj = Math.round((z + H) / C);
    let bd = Infinity, by = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= G || j >= G) continue;
        const a = this.nodes[j * G + i];
        const ya = this.nodeY[j * G + i];
        if (i < G - 1 && this.linkH[j * G + i]) {
          const b = this.nodes[j * G + i + 1];
          const r = segDist(x, z, a, b);
          if (r.d < bd) { bd = r.d; by = ya + (this.nodeY[j * G + i + 1] - ya) * r.t; }
        }
        if (j < G - 1 && this.linkV[j * G + i]) {
          const b = this.nodes[(j + 1) * G + i];
          const r = segDist(x, z, a, b);
          if (r.d < bd) { bd = r.d; by = ya + (this.nodeY[(j + 1) * G + i] - ya) * r.t; }
        }
      }
    }
    return bd === Infinity ? null : { d: bd, y: by };
  }

  /**
   * 1 on the carriageway, easing to 0 just outside it. Tighter than the
   * grading falloff: this marks where the asphalt physically covers the
   * ground, so the terrain can be sunk beneath it.
   */
  roadCover (x, z) {
    const r = this.nearestRoad(x, z);
    if (!r) return 0;
    // wide enough for the ground mesh to resolve; narrower just aliases
    const edge = CITY.ROAD_W / 2, soft = edge + 9;
    return r.d <= edge ? 1 : r.d >= soft ? 0 : 1 - (r.d - edge) / (soft - edge);
  }

  /**
   * Height of the carriageway at a point, and how strongly the road governs
   * the ground there (1 on the asphalt, falling to 0 out in the block).
   *
   * Roads are CUT INTO the hillside, not draped over it: level across their
   * width, constant grade along their length between one intersection and the
   * next. Sampling raw terrain at each corner instead banks the carriageway
   * sideways on any cross-slope, which is what made the roads look like they
   * were leaning with the ground.
   */
  roadGrade (x, z) {
    const r = this.nearestRoad(x, z);
    if (!r) return null;
    const w = ROAD_W_FALLOFF(r.d);
    return w > 0 ? { y: r.y, w } : null;
  }

  /**
   * Ground height anywhere: the hills, graded to meet the roads. Everything
   * downstream — the ground mesh, pavements, buildings, props, actors — reads
   * this, so the cut-and-fill around a road is consistent for all of them.
   */
  terrainY (x, z) {
    const h = hillsAt(x, z);
    const g = this.roadGrade(x, z);
    return g ? h + (g.y - h) * g.w : h;
  }

  id (i, j) { return j * this.G + i; }
  node (i, j) { return this.nodes[this.id(i, j)]; }
  inBounds (i, j) { return i >= 0 && j >= 0 && i < this.G && j < this.G; }

  /**
   * The river severs every north-south link across it apart from the bridge,
   * so traffic and pathfinding are forced to use the crossing.
   */
  /**
   * Two nodes are joined only if both ends and the midpoint are on land — that
   * keeps roads off the water and out of the inlets. The bridge row is the one
   * exception, and it's the only way between the islands.
   */
  _linked (a, b) {
    if (a.j === b.j && a.j === CITY.BRIDGE_J &&
        Math.min(a.i, b.i) >= CITY.BRIDGE_I0 && Math.max(a.i, b.i) <= CITY.BRIDGE_I1) return true;
    if (!a.land || !b.land) return false;
    if (this.cut && this.cut.has(segKey(a, b, this.G))) return false;
    return isLand((a.x + b.x) / 2, (a.z + b.z) / 2);
  }

  /**
   * Decide which grid segments simply aren't streets.
   *
   * A perfect lattice at one spacing everywhere is the single thing that makes
   * the city read as generated. Downtown keeps its dense grid — that part is
   * true to life — but out in the neighbourhoods and the countryside a good
   * share of the segments are dropped, which merges cells into larger blocks
   * of varying size and leaves dead ends and lanes behind. Everything else
   * (asphalt, markings, kerbs, lamps, traffic routing, the pavement graph)
   * reads `_linked`, so it all follows from this one set.
   */
  _planCuts () {
    const G = this.G;
    const rng = new Rng(CITY.SEED ^ 0x7a11);
    this.cut = new Set();
    const cand = [];
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const a = this.node(i, j);
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (i + di >= G || j + dj >= G) continue;
          const b = this.node(i + di, j + dj);
          if (!a.land || !b.land) continue;
          if (isBridgeNode(a.i, a.j) || isBridgeNode(b.i, b.j)) continue;   // never the crossing
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          if (!isLand(mx, mz)) continue;
          const p = 0.40 * Math.pow(1 - urbanity(mx, mz), 1.5);
          if (rng.next() < p) { this.cut.add(segKey(a, b, G)); cand.push([a, b]); }
        }
      }
    }
    // Put back whatever that stranded: every junction has to stay reachable or
    // traffic and pedestrians end up marooned on their own little island.
    for (let pass = 0; pass < 8; pass++) {
      const comps = this._components();
      if (comps.length <= 1) break;
      comps.sort((x, y) => y.size - x.size);
      const main = comps[0];
      let repaired = false;
      for (const [a, b] of cand) {
        if (!this.cut.has(segKey(a, b, G))) continue;
        const inA = main.has(a.id), inB = main.has(b.id);
        if (inA !== inB) { this.cut.delete(segKey(a, b, G)); repaired = true; }
      }
      if (!repaired) break;
    }
  }

  /** Connected components of the road graph, as Sets of node ids. */
  _components () {
    const seen = new Set(), out = [];
    for (const n of this.nodes) {
      if (seen.has(n.id) || !this.neighbors(n).length) continue;
      const comp = new Set([n.id]);
      const stack = [n];
      seen.add(n.id);
      while (stack.length) {
        const q = stack.pop();
        for (const o of this.neighbors(q)) {
          if (seen.has(o.id)) continue;
          seen.add(o.id); comp.add(o.id); stack.push(o);
        }
      }
      out.push(comp);
    }
    return out;
  }

  neighbors (n) {
    const out = [];
    const add = (o) => { if (o && this._linked(n, o)) out.push(o); };
    if (n.i > 0) add(this.node(n.i - 1, n.j));
    if (n.i < this.G - 1) add(this.node(n.i + 1, n.j));
    if (n.j > 0) add(this.node(n.i, n.j - 1));
    if (n.j < this.G - 1) add(this.node(n.i, n.j + 1));
    return out;
  }

  /** A junction that is actually connected to the network. */
  randomNode () { return this.roadNodes[randInt(0, this.roadNodes.length - 1)]; }

  /** Nearest junction that is on the road network (never a stranded one). */
  nearestNode (x, z) {
    const i = clampIdx(Math.round(x / CITY.CELL + (this.G - 1) / 2), this.G);
    const j = clampIdx(Math.round(z / CITY.CELL + (this.G - 1) / 2), this.G);
    const direct = this.node(i, j);
    if (this.neighbors(direct).length) return direct;
    let best = this.roadNodes[0], bd = Infinity;
    for (const n of this.roadNodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** A* over the intersection grid. Returns an array of nodes, start first. */
  path (start, goal) {
    if (start === goal) return [start];
    const h = (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
    const open = [start];
    const came = new Map(), g = new Map(), f = new Map();
    g.set(start.id, 0); f.set(start.id, h(start, goal));
    const seen = new Set([start.id]);
    let guard = 0;
    while (open.length && guard++ < 6000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f.get(open[k].id) < f.get(open[bi].id)) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) {
        const out = [cur];
        let c = cur;
        while (came.has(c.id)) { c = came.get(c.id); out.unshift(c); }
        return out;
      }
      seen.delete(cur.id);
      for (const nb of this.neighbors(cur)) {
        const tentative = g.get(cur.id) + 1 + (nb.cost || 0);
        if (tentative < (g.get(nb.id) ?? Infinity)) {
          came.set(nb.id, cur);
          g.set(nb.id, tentative);
          f.set(nb.id, tentative + h(nb, goal));
          if (!seen.has(nb.id)) { seen.add(nb.id); open.push(nb); }
        }
      }
    }
    return [start];
  }

  /**
   * Lane-centre point for travelling from a -> b, offset to the right-hand
   * side of the carriageway. `t` walks the segment 0..1.
   */
  lanePoint (a, b, t, out = new THREE.Vector3()) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // right of the travel direction (right = forward x up)
    const rx = -uz, rz = ux;
    return out.set(
      a.x + dx * t + rx * CITY.LANE,
      0,
      a.z + dz * t + rz * CITY.LANE
    );
  }

  /* ---------------- parking ---------------- */

  _buildBays () {
    const G = this.G, step = 8.5, margin = 26;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const a = this.node(i, j);
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          if (!this.inBounds(i + di, j + dj)) continue;
          const b = this.node(i + di, j + dj);
          if (!this._linked(a, b)) continue;
          if (j === CITY.BRIDGE_J && di &&
              i >= CITY.BRIDGE_I0 && i < CITY.BRIDGE_I1) continue;   // no parking on the bridge
          const dx = b.x - a.x, dz = b.z - a.z;
          const len = Math.hypot(dx, dz);
          const ux = dx / len, uz = dz / len;
          const n = Math.floor((len - margin * 2) / step);
          for (let k = 0; k < n; k++) {
            const d = margin + k * step;
            for (const side of [1, -1]) {
              // a bay always sits on the right-hand curb of the car that uses it
              const dx2 = ux * side, dz2 = uz * side;
              const rx = -dz2 * CITY.CURB, rz = dx2 * CITY.CURB;
              this.bays.push({
                x: a.x + ux * d + rx,
                z: a.z + uz * d + rz,
                y: 0,
                heading: Math.atan2(dx2, dz2),
                occupied: false,
                a, b
              });
            }
          }
        }
      }
    }
  }

  /** A free bay on the a->b segment whose kerb matches that direction. */
  claimBayOnSegment (a, b) {
    const want = Math.atan2(b.x - a.x, b.z - a.z);
    const cands = [];
    for (const bay of this.bays) {
      if (bay.occupied) continue;
      if (!((bay.a === a && bay.b === b) || (bay.a === b && bay.b === a))) continue;
      let d = (bay.heading - want) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > 0.2) continue;
      cands.push(bay);
    }
    if (!cands.length) return null;
    const bay = cands[randInt(0, cands.length - 1)];
    bay.occupied = true;
    return bay;
  }

  /* ---------------- sidewalks ---------------- */

  /**
   * The buildable rectangle of a block, taken from where its four corner
   * junctions actually are.
   *
   * Suburban junctions sit off the lattice, so a fixed square on the nominal
   * block centre would have the streets running through the pavement. This is
   * the axis-aligned rectangle that clears all four bounding streets. The
   * pavement graph, the pavement mesh and the building lots all read it, which
   * is what keeps them agreeing with each other.
   */
  blockRect (bi, bj) {
    const key = bj * CITY.BLOCKS + bi;
    let r = this._rects.get(key);
    if (r) return r;
    const N = (i, j) => this.node(Math.min(i, this.G - 1), Math.min(j, this.G - 1));
    const n00 = N(bi, bj), n10 = N(bi + 1, bj), n01 = N(bi, bj + 1), n11 = N(bi + 1, bj + 1);
    const m = CITY.ROAD_W / 2 + 2;
    let minX = Math.max(n00.x, n01.x) + m, maxX = Math.min(n10.x, n11.x) - m;
    let minZ = Math.max(n00.z, n10.z) + m, maxZ = Math.min(n01.z, n11.z) - m;
    const c = blockCenter(bi, bj);
    if (maxX - minX < 16) { minX = c.x - 8; maxX = c.x + 8; }
    if (maxZ - minZ < 16) { minZ = c.z - 8; maxZ = c.z + 8; }
    r = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
          w: maxX - minX, d: maxZ - minZ };
    this._rects.set(key, r);
    return r;
  }

  _buildSidewalk () {
    const B = CITY.BLOCKS;
    this.walkNodes = [];
    this.blockRings = [];
    const idx = (bi, bj, k) => (bj * B + bi) * 8 + k;

    // 8 ring nodes per block: 4 corners + 4 edge midpoints
    const OFF = [
      [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]
    ];
    for (let bj = 0; bj < B; bj++) {
      for (let bi = 0; bi < B; bi++) {
        if (isWaterBlock(bi, bj)) { this.blockRings.push(null); continue; }
        // The estate is private: no pavement graph, so the crowd never streams
        // out to it and the island stays yours.
        const bc = blockCenter(bi, bj);
        if (onIsle(bc.x, bc.z)) { this.blockRings.push(null); continue; }
        // Ride the block's REAL rectangle. Built off blockCenter and a fixed
        // radius, the ring sat on the old lattice while the streets had moved,
        // and the crowd walked down the middle of the road.
        const rect = this.blockRect(bi, bj);
        const rx = Math.max(4, rect.w / 2 - CITY.SIDEWALK_INSET);
        const rz = Math.max(4, rect.d / 2 - CITY.SIDEWALK_INSET);
        const c = { x: rect.cx, z: rect.cz };
        const ring = [];
        for (let k = 0; k < 8; k++) {
          const n = {
            id: idx(bi, bj, k), bi, bj, k,
            x: c.x + OFF[k][0] * rx, z: c.z + OFF[k][1] * rz,
            links: []
          };
          this.walkNodes.push(n);
          ring.push(n);
        }
        // Keep every ring node on dry land. A block that meets the shore can
        // otherwise put a corner out over the water, and the crowd stands on
        // the sea.
        for (const n of ring) {
          for (let guard = 0; guard < 8 && !isLand(n.x, n.z); guard++) {
            n.x += (c.x - n.x) * 0.34;
            n.z += (c.z - n.z) * 0.34;
          }
        }
        this.blockRings.push(ring);
        for (let k = 0; k < 8; k++) {
          ring[k].links.push(ring[(k + 1) % 8]);
          ring[(k + 1) % 8].links.push(ring[k]);
        }
        // links within a block stay on the pavement
        for (const n of ring) n.crossing = new Set();
      }
    }
    // Link opposing mid-edge nodes of neighbouring blocks. It is only a
    // CROSSING — something to paint a zebra on and to check for traffic before
    // using — when a road actually runs between the two blocks. Where the grid
    // has a hole, or out on the beach, the two pavements simply join up, and
    // marking those as crossings scattered zebra stripes across open ground.
    const ringOf = (bi, bj) => this.blockRings[bj * B + bi];
    const G = this.G;
    for (let bj = 0; bj < B; bj++) {
      for (let bi = 0; bi < B; bi++) {
        const r0 = ringOf(bi, bj);
        if (!r0) continue;
        if (bi < B - 1) {
          const r1 = ringOf(bi + 1, bj);
          if (r1) {
            // the north-south street between these two blocks
            const road = this.linkV[bj * G + (bi + 1)];
            r0[3].links.push(r1[7]); r1[7].links.push(r0[3]);   // east mid <-> west mid
            if (road) { r0[3].crossing.add(r1[7]); r1[7].crossing.add(r0[3]); }
          }
        }
        if (bj < B - 1) {
          const r1 = ringOf(bi, bj + 1);
          if (r1) {
            // the east-west street between these two blocks
            const road = this.linkH[(bj + 1) * G + bi];
            r0[5].links.push(r1[1]); r1[1].links.push(r0[5]); // south mid <-> north mid
            if (road) { r0[5].crossing.add(r1[1]); r1[1].crossing.add(r0[5]); }
          }
        }
      }
    }
  }

  randomWalkNode () { return this.walkNodes[randInt(0, this.walkNodes.length - 1)]; }

  ringAt (bi, bj) { return this.blockRings[bj * CITY.BLOCKS + bi] || null; }

  nearestWalkNode (x, z) {
    let best = this.walkNodes[0], bd = Infinity;
    // narrow to the containing block first — the ring nodes are local to it
    const B = CITY.BLOCKS;
    const bi = Math.max(0, Math.min(B - 1, Math.round(x / CITY.CELL + (B - 1) / 2)));
    const bj = Math.max(0, Math.min(B - 1, Math.round(z / CITY.CELL + (B - 1) / 2)));
    let ring = this.blockRings[bj * B + bi];
    if (!ring) {
      // out over the water — spiral outward for the nearest block with pavement
      outer:
      for (let r = 1; r <= 4 && !ring; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const c = this.blockRings[clampIdx(bj + dj, B) * B + clampIdx(bi + di, B)];
            if (c) { ring = c; break outer; }
          }
        }
      }
    }
    if (!ring) return this.walkNodes[0];
    for (const n of ring) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** True when the point sits on the carriageway rather than a block. */
  onRoad (x, z) {
    const h = CITY.ROAD_W / 2;
    const fx = Math.abs(((x + CITY.HALF) % CITY.CELL + CITY.CELL) % CITY.CELL);
    const fz = Math.abs(((z + CITY.HALF) % CITY.CELL + CITY.CELL) % CITY.CELL);
    return fx < h || fx > CITY.CELL - h || fz < h || fz > CITY.CELL - h;
  }
}
