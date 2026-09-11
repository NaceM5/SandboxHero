import * as THREE from 'three';
import { clamp, rand, randInt, pick } from '../core/Util.js';

/**
 * Road and sidewalk graph for the Tideline map.
 *
 * The map ships layout metadata — rectangular city streets, graded ramp
 * slabs, the bridge and viaduct decks, and curved hillside centrelines — but
 * explicitly no navigation graph. This module stitches all of that into:
 *
 *  - a junction graph (nodes) joined by polyline edges with width, elevation
 *    and a lane offset, used by traffic for A* routing and lane waypoints;
 *  - kerbside parking bays along the wider streets;
 *  - a sidewalk graph (walk nodes) running down both sides of every street
 *    that has a footway, joined at corners and across the road at crosswalks.
 *
 * Grade-separated crossings (an avenue under a bridge ramp) are kept apart:
 * two centrelines only form a junction where their elevations agree.
 */

const HASH = 100003;
const SNAP_TOL = 36;        // a street that dead-ends this close to another is joined to it
const LEVEL_TOL = 3.5;      // max elevation difference for two crossing roads to be a junction
const STUB_LEN = 30;        // dead-end edges shorter than this are pruned

const keyOf = (x, z) => `${Math.round(x * 4)},${Math.round(z * 4)}`;

function angleIn (a, t, b) {
  // is angle t inside the CCW interval from a to b?
  const TAU = Math.PI * 2;
  const d1 = ((t - a) % TAU + TAU) % TAU, d2 = ((b - a) % TAU + TAU) % TAU;
  return d1 < d2;
}

export class Roads {
  constructor (data) {
    this.lines = this._collectLines(data);
    this._snapEndpoints();
    this._splitCrossings();
    this._buildGraph();
    this._prune();
    this._keepLargestComponent();
    this._indexNodes();
    this._buildBays();
    this._buildWalk();
    this._indexWalk();
    this._edgeLengthCdf();
  }

  /* ================= centreline collection ================= */

  _collectLines (data) {
    const lines = [];
    const push = (name, pts, width, o = {}) => {
      if (pts.length < 2) return;
      lines.push({
        name, points: pts.map(p => [p[0], p[1], p[2] ?? 8]), width,
        lane: clamp(width * 0.24, 1.9, 6.5),
        sidewalk: o.sidewalk ?? null, cls: o.cls || 'street',
        walk: o.walk !== false, bays: o.bays !== false, rare: !!o.rare
      });
    };
    const ramps = data.ramps.filter(r => r.kind !== 'barrier' && r.kind !== 'footway' && !r.name.startsWith('Platform'));

    // Rectangular streets. Where one runs straight into a ramp slab the part
    // under the ramp is cut away so the street hands over to the ramp instead
    // of continuing underneath a slab that is physically in the way.
    for (const r of data.routes) {
      if (r.type !== 'road') continue;
      const along = r.width > r.depth;
      const w = along ? r.depth : r.width;
      if (along) {
        let segs = [[r.x - r.width / 2, r.x + r.width / 2]];
        for (const rp of ramps) {
          if (Math.abs(rp.z - r.z) > 2) continue;
          const next = [];
          for (const [a, b] of segs) {
            if (b <= rp.x1 || a >= rp.x2) { next.push([a, b]); continue; }
            if (a < rp.x1) next.push([a, rp.x1]);
            if (b > rp.x2) next.push([rp.x2, b]);
          }
          segs = next;
        }
        for (const [a, b] of segs) if (b - a > 8) push(r.name, [[a, r.z, r.y], [b, r.z, r.y]], w, { sidewalk: w / 2 + 3, cls: 'city' });
      } else if (r.name === 'Meridian access road') {
        // the gated campus: no footway (nobody strolls up to a security gate),
        // no bays, and rare — never a random destination or spawn for cars
        push(r.name, [[r.x, r.z - r.depth / 2, r.y], [r.x, r.z + r.depth / 2, r.y]], w, { sidewalk: null, walk: false, bays: false, cls: 'city', rare: true });
      } else {
        push(r.name, [[r.x, r.z - r.depth / 2, r.y], [r.x, r.z + r.depth / 2, r.y]], w, { sidewalk: w / 2 + 3, cls: 'city' });
      }
    }
    // Graded ramps: the bridge approaches carry 38 m of lanes plus footways,
    // the viaduct ramps are 26 m of pure carriageway with guardrails.
    for (const rp of ramps) {
      const bridge = /bridge/i.test(rp.name);
      push(rp.name, [[rp.x1, rp.z, rp.y1], [rp.x2, rp.z, rp.y2]], bridge ? 38 : rp.width,
        { sidewalk: bridge ? 21.5 : null, cls: 'ramp', walk: bridge, bays: false });
    }
    // Elevated decks are slabs, not routes, in the manifest.
    for (const b of data.boxes) {
      if (b.name === 'Bridge deck') {
        push('Golden Strait bridge', [[b.x - b.w / 2, b.z, b.y + b.h / 2], [b.x + b.w / 2, b.z, b.y + b.h / 2]], 38,
          { sidewalk: 21.5, cls: 'bridge', bays: false });
      } else if (b.name === 'City overpass' || b.name === 'Northern overpass') {
        push(b.name, [[b.x - b.w / 2, b.z, b.y + b.h / 2], [b.x + b.w / 2, b.z, b.y + b.h / 2]], 26,
          { sidewalk: null, cls: 'viaduct', walk: false, bays: false });
      }
    }
    // Curved centrelines carry their own graded elevations.
    for (const r of data.curvedRoads) {
      push(r.name, r.points, r.width, {
        sidewalk: r.width / 2 + 1.5, cls: r.classification,
        bays: ['residential', 'high-street', 'collector', 'arterial'].includes(r.classification),
        // the private drive up to the headland estate: almost nobody goes there
        rare: r.name === 'Headland estate drive'
      });
    }
    return lines;
  }

  /** Join dead ends that stop just short of another street onto it. */
  _snapEndpoints () {
    const L = this.lines;
    for (const line of L) {
      for (const endIdx of [0, line.points.length - 1]) {
        const p = line.points[endIdx];
        let best = null;
        for (const t of L) {
          if (t === line) continue;
          for (let j = 0; j < t.points.length - 1; j++) {
            const a = t.points[j], b = t.points[j + 1];
            const dx = b[0] - a[0], dz = b[1] - a[1];
            const len2 = dx * dx + dz * dz || 1;
            const u = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2, 0, 1);
            const px = a[0] + dx * u, pz = a[1] + dz * u, py = a[2] + (b[2] - a[2]) * u;
            const d = Math.hypot(p[0] - px, p[1] - pz);
            if (d < SNAP_TOL && Math.abs(py - p[2]) < LEVEL_TOL && (!best || d < best.d)) best = { d, t, j, u, px, pz, py };
          }
        }
        if (!best || best.d < 0.05) continue;
        const { t, j, u } = best;
        if (u < 0.02) { p[0] = t.points[j][0]; p[1] = t.points[j][1]; p[2] = t.points[j][2]; }
        else if (u > 0.98) { p[0] = t.points[j + 1][0]; p[1] = t.points[j + 1][1]; p[2] = t.points[j + 1][2]; }
        else {
          p[0] = best.px; p[1] = best.pz; p[2] = best.py;
          t.points.splice(j + 1, 0, [best.px, best.pz, best.py]);   // make it a vertex of the target
        }
      }
    }
  }

  /** Split every level crossing between two centrelines into a shared vertex. */
  _splitCrossings () {
    const L = this.lines;
    const buckets = new Map(), segs = [];
    for (let li = 0; li < L.length; li++) {
      const pts = L[li].points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], seg = { li, i, a, b, id: segs.length };
        segs.push(seg);
        for (let x = Math.floor(Math.min(a[0], b[0]) / 100); x <= Math.floor(Math.max(a[0], b[0]) / 100); x++) {
          for (let z = Math.floor(Math.min(a[1], b[1]) / 100); z <= Math.floor(Math.max(a[1], b[1]) / 100); z++) {
            const k = x * HASH + z;
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(seg);
          }
        }
      }
    }
    const cuts = new Map(), checked = new Set();
    for (const list of buckets.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const s = list[i], t = list[j];
          if (s.li === t.li) continue;
          const key = s.id < t.id ? s.id * 1e6 + t.id : t.id * 1e6 + s.id;
          if (checked.has(key)) continue;
          checked.add(key);
          const ax = s.b[0] - s.a[0], az = s.b[1] - s.a[1], bx = t.b[0] - t.a[0], bz = t.b[1] - t.a[1];
          const den = ax * bz - az * bx;
          if (Math.abs(den) < 1e-9) continue;
          const cx = t.a[0] - s.a[0], cz = t.a[1] - s.a[1];
          const u = (cx * bz - cz * bx) / den, v = (cx * az - cz * ax) / den;
          if (u < -1e-6 || u > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) continue;
          const ya = s.a[2] + (s.b[2] - s.a[2]) * u, yb = t.a[2] + (t.b[2] - t.a[2]) * v;
          if (Math.abs(ya - yb) > LEVEL_TOL) continue;       // grade separated
          const p = [s.a[0] + u * ax, s.a[1] + u * az, (ya + yb) / 2];
          for (const [seg, f] of [[s, u], [t, v]]) {
            if (f > 1e-4 && f < 1 - 1e-4) {
              const k = seg.li * 100000 + seg.i;
              if (!cuts.has(k)) cuts.set(k, []);
              cuts.get(k).push({ f, p });
            }
          }
        }
      }
    }
    for (let li = 0; li < L.length; li++) {
      const pts = L[li].points, next = [];
      for (let i = 0; i < pts.length - 1; i++) {
        next.push(pts[i]);
        const cs = (cuts.get(li * 100000 + i) || []).sort((a, b) => a.f - b.f);
        for (const c of cs) {
          const last = next[next.length - 1];
          if (Math.hypot(c.p[0] - last[0], c.p[1] - last[1]) > 0.25 &&
              Math.hypot(c.p[0] - pts[i + 1][0], c.p[1] - pts[i + 1][1]) > 0.25) next.push([...c.p]);
        }
      }
      next.push(pts[pts.length - 1]);
      L[li].points = next;
    }
  }

  /* ================= graph ================= */

  _buildGraph () {
    const verts = new Map();
    const vert = (p, line) => {
      const k = keyOf(p[0], p[1]);
      let v = verts.get(k);
      if (!v) { v = { x: p[0], z: p[1], y: p[2], adj: new Set(), lines: new Set(), node: null }; verts.set(k, v); }
      v.lines.add(line);
      return v;
    };
    // vertices and adjacency
    for (const line of this.lines) {
      line.verts = line.points.map(p => vert(p, line));
      for (let i = 0; i < line.verts.length - 1; i++) {
        const a = line.verts[i], b = line.verts[i + 1];
        if (a === b) continue;
        a.adj.add(b); b.adj.add(a);
      }
    }
    const nodes = [], edges = [];
    const nodeFor = v => {
      if (!v.node) { v.node = { id: nodes.length, x: v.x, z: v.z, y: v.y, links: [], edges: [], halfWidth: 0, junction: false }; nodes.push(v.node); }
      return v.node;
    };
    const isGraphNode = v => v.adj.size !== 2 || v.lines.size >= 2;
    for (const line of this.lines) {
      let chain = null;
      for (let i = 0; i < line.verts.length; i++) {
        const v = line.verts[i];
        if (chain && chain.verts[chain.verts.length - 1] === v) continue;
        if (!chain) { chain = { verts: [v] }; continue; }
        chain.verts.push(v);
        if (isGraphNode(v) || i === line.verts.length - 1) {
          this._makeEdge(line, chain.verts, nodeFor, edges);
          chain = { verts: [v] };
        }
      }
    }
    this.nodes = nodes;
    this.edges = edges;
  }

  _makeEdge (line, verts, nodeFor, edges) {
    if (verts.length < 2) return;
    const a = nodeFor(verts[0]), b = nodeFor(verts[verts.length - 1]);
    const points = verts.map(v => [v.x, v.z, v.y]);
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const len = cum[cum.length - 1];
    if (len < 0.5) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    const e = {
      id: edges.length, a, b, points, cum, len, name: line.name, width: line.width, lane: line.lane,
      sidewalk: line.walk ? line.sidewalk : null, cls: line.cls, baysOK: line.bays, bays: [], chains: null, rare: line.rare,
      minX, maxX, minZ, maxZ
    };
    edges.push(e);
    a.edges.push(e); b.edges.push(e);
    if (!a.links.includes(b)) a.links.push(b);
    if (!b.links.includes(a)) b.links.push(a);
  }

  _removeEdge (e) {
    const drop = (n) => {
      n.edges = n.edges.filter(x => x !== e);
      const other = e.a === n ? e.b : e.a;
      if (!n.edges.some(x => x.a === other || x.b === other)) n.links = n.links.filter(x => x !== other);
    };
    drop(e.a); drop(e.b);
    e.dead = true;
  }

  /** Drop short dead-end stubs left over from overlapping collinear streets. */
  _prune () {
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of this.edges) {
        if (e.dead) continue;
        const deadEnd = (e.a.edges.length === 1) || (e.b.edges.length === 1);
        if (deadEnd && e.len < STUB_LEN) { this._removeEdge(e); changed = true; }
      }
    }
    this.edges = this.edges.filter(e => !e.dead);
    this.nodes = this.nodes.filter(n => n.edges.length > 0);
  }

  _keepLargestComponent () {
    const seen = new Set();
    let best = [];
    for (const n of this.nodes) {
      if (seen.has(n)) continue;
      const comp = [], stack = [n];
      seen.add(n);
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        for (const l of c.links) if (!seen.has(l)) { seen.add(l); stack.push(l); }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Set(best);
    this.nodes = best;
    this.edges = this.edges.filter(e => keep.has(e.a) && keep.has(e.b));
    this.nodes.forEach((n, i) => {
      n.id = i;
      n.edges = n.edges.filter(e => keep.has(e.a) && keep.has(e.b));
      n.links = n.links.filter(l => keep.has(l));
      n.halfWidth = n.edges.reduce((m, e) => Math.max(m, e.width / 2), 0);
      n.junction = n.links.length >= 3;
      n.rare = n.edges.every(e => e.rare);
    });
    this.edges.forEach((e, i) => { e.id = i; });
  }

  _indexNodes () {
    this._nodeCell = 120;
    this._nodeGrid = new Map();
    const s = this._nodeCell;
    for (const n of this.nodes) {
      const k = Math.floor(n.x / s) * HASH + Math.floor(n.z / s);
      if (!this._nodeGrid.has(k)) this._nodeGrid.set(k, []);
      this._nodeGrid.get(k).push(n);
    }
  }

  _edgeLengthCdf () {
    this._cdf = [];
    let t = 0;
    for (const e of this.edges) { t += e.len; this._cdf.push(t); }
    this.totalLength = t;
  }

  /* ================= geometry helpers ================= */

  /** Point and unit tangent at arc distance `d` along an edge (a→b order). */
  pointAlong (e, d, out = {}) {
    const pts = e.points, cum = e.cum;
    d = clamp(d, 0, e.len);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const a = pts[i - 1], b = pts[i];
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / segLen;
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    out.y = a[2] + (b[2] - a[2]) * t;
    out.ux = (b[0] - a[0]) / segLen;
    out.uz = (b[1] - a[1]) / segLen;
    return out;
  }

  edgeBetween (a, b) {
    for (const e of a.edges) if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    return null;
  }

  /* ================= traffic API ================= */

  randomNode () {
    for (let t = 0; t < 8; t++) {
      const n = this.nodes[randInt(0, this.nodes.length - 1)];
      if (!n.rare) return n;
    }
    return this.nodes[0];
  }

  /** A random junction node within an annulus of a point (falls back to any). */
  randomNodeNear (x, z, minR, maxR, tries = 24) {
    const s = this._nodeCell;
    for (let t = 0; t < tries; t++) {
      const a = Math.random() * Math.PI * 2, r = rand(minR, maxR);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const l = this._nodeGrid.get(Math.floor(px / s) * HASH + Math.floor(pz / s));
      if (!l || !l.length) continue;
      const n = l[randInt(0, l.length - 1)];
      if (n.rare) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d >= minR * 0.8 && d <= maxR * 1.2) return n;
    }
    return null;
  }

  /**
   * Nearest junction. With `y` given, only junctions within `tol` metres of
   * that elevation count — a car under the bridge must not be steered by the
   * junction on the deck thirty metres above it.
   */
  nearestNode (x, z, junctionsOnly = false, y = null, tol = 6) {
    const s = this._nodeCell;
    const cx = Math.floor(x / s), cz = Math.floor(z / s);
    let best = null, bd = Infinity;
    for (let ring = 0; ring <= 6; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const l = this._nodeGrid.get((cx + dx) * HASH + (cz + dz));
          if (!l) continue;
          for (const n of l) {
            if (junctionsOnly && !n.junction) continue;
            if (y !== null && Math.abs(n.y - y) > tol) continue;
            const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
      if (best && Math.sqrt(bd) < ring * s) break;
    }
    if (!best && y !== null) return this.nearestNode(x, z, junctionsOnly);
    return best || this.nodes[0];
  }

  neighbors (n) { return n.links; }

  /**
   * The junction a traveller at (x,z) facing `heading` is heading toward —
   * the nearest node in the forward half-space, so a re-plan never begins
   * with a U-turn on a ten-metre lane. Falls back to the nearest node.
   */
  nodeAhead (x, z, heading, maxDist = 140, y = null, tol = 6) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const s = this._nodeCell;
    const cx = Math.floor(x / s), cz = Math.floor(z / s);
    const rings = Math.ceil(maxDist / s);
    let best = null, bd = Infinity;
    for (let dx = -rings; dx <= rings; dx++) {
      for (let dz = -rings; dz <= rings; dz++) {
        const l = this._nodeGrid.get((cx + dx) * HASH + (cz + dz));
        if (!l) continue;
        for (const n of l) {
          const ox = n.x - x, oz = n.z - z;
          const d = Math.hypot(ox, oz);
          if (d > maxDist || d < 1e-3) continue;
          if (y !== null && Math.abs(n.y - y) > tol) continue;
          const ahead = (ox * fx + oz * fz) / d;
          if (ahead < 0.5) continue;
          // prefer close and straight ahead
          const score = d * (1.6 - ahead);
          if (score < bd) { bd = score; best = n; }
        }
      }
    }
    return best || this.nearestNode(x, z, false, y);
  }

  /** A* over the junction graph. Returns the node list, start first. */
  path (start, goal) {
    const stamp = (this._pathStamp = (this._pathStamp || 0) + 1);
    const open = [start];
    start._g = 0; start._f = Math.hypot(goal.x - start.x, goal.z - start.z); start._from = null; start._st = stamp; start._closed = false;
    let guard = 0;
    while (open.length && guard++ < 20000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i]._f < open[bi]._f) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal) break;
      cur._closed = true;
      for (const e of cur.edges) {
        const nb = e.a === cur ? e.b : e.a;
        if (nb._st !== stamp) { nb._st = stamp; nb._g = Infinity; nb._closed = false; nb._from = null; }
        if (nb._closed) continue;
        const g = cur._g + e.len * (e.rare ? 25 : 1);
        if (g < nb._g) {
          nb._g = g; nb._from = cur;
          nb._f = g + Math.hypot(goal.x - nb.x, goal.z - nb.z);
          if (!open.includes(nb)) open.push(nb);
        }
      }
    }
    const out = [];
    if (goal._st !== stamp || goal._from === null && goal !== start) return [start];
    for (let n = goal; n; n = n._from) out.push(n);
    return out.reverse();
  }

  /**
   * Lane waypoints for driving from node `a` to node `b` along their edge,
   * offset to the right of the direction of travel. Appended to `out`.
   */
  laneWaypoints (a, b, out) {
    const e = this.edgeBetween(a, b);
    if (!e) return out;
    return this.laneWaypointsAlong(e, b, -Infinity, out);
  }

  /**
   * Lane waypoints along edge `e` towards its node `toNode`, starting after
   * `fromAlong` metres of travel in that direction (so a car part-way down a
   * street only gets the part still ahead of it). Each waypoint remembers its
   * edge, its travel distance and the node it leads to.
   */
  laneWaypointsAlong (e, toNode, fromAlong, out) {
    const a = toNode === e.b ? e.a : e.b, b = toNode;
    const fwd = e.a === a;
    const len = e.len;
    const startD = Math.min(len * 0.45, Math.max(5, a.halfWidth + 3));
    const endD = len - Math.min(len * 0.45, Math.max(5, b.halfWidth + 3));
    const spacing = (e.cls === 'city' || e.cls === 'bridge' || e.cls === 'ramp' || e.cls === 'viaduct') ? 30 : 12;
    const span = Math.max(0, endD - startD);
    const count = Math.max(1, Math.round(span / spacing));
    const p = {};
    for (let k = 0; k <= count; k++) {
      const d = span > 0 ? startD + span * k / count : len / 2;
      if (d < fromAlong && !(k === count && fromAlong < endD)) continue;
      const dd = fwd ? d : len - d;
      this.pointAlong(e, dd, p);
      let ux = p.ux, uz = p.uz;
      if (!fwd) { ux = -ux; uz = -uz; }
      const wp = new THREE.Vector3(p.x - uz * e.lane, p.y, p.z + ux * e.lane);
      wp.edge = e; wp.along = d;                        // where on which street
      wp.dir = Math.atan2(ux, uz);                     // which way the lane runs here
      wp.toNode = b;                                   // where this lane leads
      wp.arrive = clamp(e.width * 0.3, 2.5, 4.5);      // tighter on narrow roads: no corner cutting onto the verge
      out.push(wp);
      if (span <= 0) break;
    }
    return out;
  }

  /**
   * The lane a vehicle at (x,z) is driving in: its edge, the node that lane
   * leads to given its heading, and how far along the edge it is. Near a
   * junction several streets are close, so alignment with the heading breaks
   * ties. Returns null when nothing is within `maxDist` of the carriageway.
   */
  nearestLane (x, z, heading, y = null, maxDist = 12, tol = 6) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let best = null, bs = Infinity;
    for (const e of this.edges) {
      if (x < e.minX - maxDist - e.width || x > e.maxX + maxDist + e.width ||
          z < e.minZ - maxDist - e.width || z > e.maxZ + maxDist + e.width) continue;
      const pts = e.points, cum = e.cum;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
        const px = a[0] + dx * t, pz = a[1] + dz * t;
        const dist = Math.max(0, Math.hypot(x - px, z - pz) - e.width / 2);
        if (dist > maxDist) continue;
        if (y !== null && Math.abs(a[2] + (b[2] - a[2]) * t - y) > tol) continue;
        const l = Math.sqrt(l2);
        const dot = (dx * fx + dz * fz) / l;
        const score = dist + (1 - Math.abs(dot)) * 14;
        if (score < bs) {
          bs = score;
          const along = cum[i] + l * t;
          best = { edge: e, toNode: dot >= 0 ? e.b : e.a, along: dot >= 0 ? along : e.len - along, dist };
        }
      }
    }
    return best;
  }

  randomLanePoint (x = null, z = null, minR = 0, maxR = Infinity, tries = 30) {
    for (let t = 0; t < tries; t++) {
      const r = Math.random() * this.totalLength;
      let lo = 0, hi = this._cdf.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (this._cdf[m] < r) lo = m + 1; else hi = m; }
      const e = this.edges[lo];
      if (e.rare) continue;
      const fwd = Math.random() < 0.5;
      const d = rand(e.len * 0.15, e.len * 0.85);
      const p = this.pointAlong(e, d, {});
      if (x !== null) {
        const dist = Math.hypot(p.x - x, p.z - z);
        if (dist < minR || dist > maxR) continue;
      }
      let ux = p.ux, uz = p.uz;
      if (!fwd) { ux = -ux; uz = -uz; }
      return {
        x: p.x - uz * e.lane, y: p.y, z: p.z + ux * e.lane,
        heading: Math.atan2(ux, uz), edge: e, along: fwd ? d : e.len - d,
        a: fwd ? e.a : e.b, b: fwd ? e.b : e.a
      };
    }
    return null;
  }

  /* ================= parking ================= */

  _buildBays () {
    const p = {};
    for (const e of this.edges) {
      if (!e.baysOK || e.width < 11 || e.len < 45) continue;
      const margin = Math.max(16, Math.max(e.a.halfWidth, e.b.halfWidth) + 10);
      const step = 9.5;
      for (const side of [-1, 1]) {
        for (let d = margin; d < e.len - margin; d += step) {
          this.pointAlong(e, d, p);
          const off = e.width / 2 - 1.55;
          const bx = p.x - p.uz * side * off, bz = p.z + p.ux * side * off;
          const heading = side > 0 ? Math.atan2(p.ux, p.uz) : Math.atan2(-p.ux, -p.uz);
          e.bays.push({ x: bx, z: bz, y: p.y, heading, occupied: false, edge: e, dir: side, along: side > 0 ? d : e.len - d });
        }
      }
    }
  }

  /** Claim a free kerbside bay on the traveller's own side of the a→b edge. */
  claimBayOnSegment (a, b) {
    const e = this.edgeBetween(a, b);
    if (!e || !e.bays.length) return null;
    const dir = e.a === a ? 1 : -1;
    const free = e.bays.filter(x => x.dir === dir && !x.occupied);
    if (!free.length) return null;
    const bay = pick(free);
    bay.occupied = true;
    bay.a = a; bay.b = b;
    return bay;
  }

  /* ================= sidewalks ================= */

  _buildWalk () {
    this.walkNodes = [];
    const p = {};
    const link = (m, n, crossing) => {
      if (m === n || m.links.includes(n)) return;
      m.links.push(n); n.links.push(m);
      if (crossing) { m.crossing.add(n); n.crossing.add(m); }
    };
    const mk = (x, z, e, side) => {
      const wn = { id: this.walkNodes.length, x, z, y: 0, links: [], crossing: new Set(), edge: e, side, busy: 0.3 };
      this.walkNodes.push(wn);
      return wn;
    };
    for (const e of this.edges) {
      if (e.sidewalk === null) continue;
      const d0 = clamp(e.a.halfWidth + 2.5, 3, e.len * 0.3);
      const d1 = e.len - clamp(e.b.halfWidth + 2.5, 3, e.len * 0.3);
      const spacing = e.cls === 'city' ? 26 : 16;
      const count = Math.max(1, Math.round((d1 - d0) / spacing));
      e.chains = {};
      for (const side of [-1, 1]) {
        const chain = [];
        for (let k = 0; k <= count; k++) {
          const d = d0 + (d1 - d0) * k / count;
          this.pointAlong(e, d, p);
          const wn = mk(p.x - p.uz * side * e.sidewalk, p.z + p.ux * side * e.sidewalk, e, side);
          wn.y = p.y;
          if (chain.length) link(chain[chain.length - 1], wn, false);
          chain.push(wn);
        }
        e.chains[side] = chain;
      }
      // a mid-block crosswalk on anything long enough to need one
      if (e.len > 60) {
        const mid = Math.floor(count / 2);
        link(e.chains[-1][mid], e.chains[1][mid], true);
      }
    }
    // around every junction: corner links between neighbouring footways,
    // crosswalks wherever a carriageway lies between them
    for (const n of this.nodes) {
      const ends = [];
      const dirs = [];
      for (const e of n.edges) {
        const pts = e.points;
        const d = e.a === n ? [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]
          : [pts[pts.length - 2][0] - pts[pts.length - 1][0], pts[pts.length - 2][1] - pts[pts.length - 1][1]];
        dirs.push(Math.atan2(d[1], d[0]));
        if (!e.chains) continue;
        for (const side of [-1, 1]) {
          const chain = e.chains[side];
          const end = e.a === n ? chain[0] : chain[chain.length - 1];
          ends.push({ wn: end, ang: Math.atan2(end.z - n.z, end.x - n.x) });
        }
      }
      if (ends.length < 2) continue;
      ends.sort((u, v) => u.ang - v.ang);
      if (ends.length === 2) { link(ends[0].wn, ends[1].wn, true); continue; }
      for (let i = 0; i < ends.length; i++) {
        const u = ends[i], v = ends[(i + 1) % ends.length];
        const crossing = dirs.some(th => angleIn(u.ang, th, v.ang));
        link(u.wn, v.wn, crossing);
      }
    }
  }

  _indexWalk () {
    this._walkCell = 60;
    this._walkGrid = new Map();
    const s = this._walkCell;
    for (const w of this.walkNodes) {
      const k = Math.floor(w.x / s) * HASH + Math.floor(w.z / s);
      if (!this._walkGrid.has(k)) this._walkGrid.set(k, []);
      this._walkGrid.get(k).push(w);
    }
  }

  randomWalkNode () {
    for (let t = 0; t < 12; t++) {
      const w = this.walkNodes[randInt(0, this.walkNodes.length - 1)];
      if (!w.edge.rare) return w;
    }
    return this.walkNodes[0];
  }

  /** Walk nodes within `r` of a point. Returns a fresh array. */
  walkNodesNear (x, z, r) {
    const out = [];
    const s = this._walkCell;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s), z1 = Math.floor((z + r) / s);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const l = this._walkGrid.get(cx * HASH + cz);
        if (!l) continue;
        for (const w of l) {
          const dx = w.x - x, dz = w.z - z;
          if (dx * dx + dz * dz <= r2) out.push(w);
        }
      }
    }
    return out;
  }

  /** A random walk node in an annulus around a point, or null. */
  randomWalkNodeNear (x, z, minR, maxR, tries = 16) {
    const s = this._walkCell;
    for (let t = 0; t < tries; t++) {
      const a = Math.random() * Math.PI * 2, r = rand(minR, maxR);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const l = this._walkGrid.get(Math.floor(px / s) * HASH + Math.floor(pz / s));
      if (!l || !l.length) continue;
      const w = l[randInt(0, l.length - 1)];
      if (w.edge.rare) continue;
      const d = Math.hypot(w.x - x, w.z - z);
      if (d >= minR && d <= maxR) return w;
    }
    return null;
  }

  /**
   * Nearest footway node. With `y` given, only nodes within `tol` metres of
   * that elevation count, so someone in the water under the bridge heads for
   * the quay and not for the footway on the deck above them.
   */
  nearestWalkNode (x, z, y = null, tol = 8) {
    const s = this._walkCell;
    const cx = Math.floor(x / s), cz = Math.floor(z / s);
    let best = null, bd = Infinity;
    for (let ring = 0; ring <= 12; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const l = this._walkGrid.get((cx + dx) * HASH + (cz + dz));
          if (!l) continue;
          for (const w of l) {
            if (y !== null && Math.abs(w.y - y) > tol) continue;
            const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
            if (d < bd) { bd = d; best = w; }
          }
        }
      }
      if (best && Math.sqrt(bd) < ring * s) break;
    }
    if (!best && y !== null) return this.nearestWalkNode(x, z);
    return best || this.walkNodes[0];
  }
}
