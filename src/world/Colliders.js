import { clamp } from '../core/Util.js';

/**
 * Static collision set for the Tideline map.
 *
 * The gameplay code was written against axis-aligned boxes: everything asks
 * "what solids are near this point" and then tests footprints, tops and
 * bases. The new map has rotated houses, polygonal landmark solids (the
 * carrier hull, the sculpted tower), graded ramp slabs and pitched roofs, so
 * every record here carries a `kind` and the tests below dispatch on it. The
 * public shape callers rely on is preserved:
 *
 *   { minX, maxX, minZ, maxZ, base, top, slim?, gone? }
 *
 * plus `topAt(b, x, z)` for surfaces that are not flat (ramps, roofs).
 */

const HASH = 100003;

export function makeBox (o) {
  // o: { x, z, w, d, base, top, rotation?, slim?, floorOnly?, name?, building? }
  const rot = o.rotation || 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = o.w / 2, hd = o.d / 2;
  const ex = Math.abs(c) * hw + Math.abs(s) * hd;
  const ez = Math.abs(s) * hw + Math.abs(c) * hd;
  return {
    kind: rot ? 'rbox' : 'box', name: o.name || '',
    cx: o.x, cz: o.z, hw, hd, c, s, rot,
    minX: o.x - ex, maxX: o.x + ex, minZ: o.z - ez, maxZ: o.z + ez,
    base: o.base, top: o.top,
    roof: o.roof || null,            // 'gable' | 'hip'
    slim: !!o.slim, floorOnly: !!o.floorOnly, building: !!o.building, material: o.material || '',
    gone: false, _stamp: 0
  };
}

export function makePrism (o) {
  // o: { x, z, outline:[[x,z]...] (local), base, top, rotation?, name? }
  const rot = o.rotation || 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [lx, lz] of o.outline) {
    const wx = o.x + c * lx + s * lz, wz = o.z - s * lx + c * lz;
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
  }
  return {
    kind: 'prism', name: o.name || '',
    cx: o.x, cz: o.z, c, s, rot, outline: o.outline,
    minX, maxX, minZ, maxZ, base: o.base, top: o.top,
    roof: null, slim: false, floorOnly: false, building: !!o.building, gone: false, _stamp: 0
  };
}

export function makeRamp (r) {
  // r: { x1, x2, z, width, y1, y2, thickness, name }
  return {
    kind: 'ramp', name: r.name || '', axis: r.axis || 'x',
    x1: r.x1, x2: r.x2, z: r.z, y1: r.y1, y2: r.y2, thickness: r.thickness,
    minX: r.axis==='z'?r.z-r.width/2:r.x1, maxX: r.axis==='z'?r.z+r.width/2:r.x2, minZ: r.axis==='z'?r.x1:r.z-r.width/2, maxZ: r.axis==='z'?r.x2:r.z+r.width/2,
    base: Math.min(r.y1, r.y2) - r.thickness, top: Math.max(r.y1, r.y2),
    roof: null, slim: false, floorOnly: false, building: false, gone: false, _stamp: 0
  };
}

/* ---------------- per-record geometry ---------------- */

/** Local coordinates of a world point relative to a rotated record. */
function local (b, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  _l.x = b.c * dx - b.s * dz;
  _l.z = b.s * dx + b.c * dz;
  return _l;
}
const _l = { x: 0, z: 0 };
const _cp = { x: 0, z: 0, inside: false };

/** Is the plan-view point inside the footprint (expanded by `pad`)? */
export function inFootprint (b, x, z, pad = 0) {
  if (x <= b.minX - pad || x >= b.maxX + pad || z <= b.minZ - pad || z >= b.maxZ + pad) return false;
  switch (b.kind) {
    case 'box': case 'ramp': return true;
    case 'rbox': {
      const l = local(b, x, z);
      return Math.abs(l.x) < b.hw + pad && Math.abs(l.z) < b.hd + pad;
    }
    case 'prism': {
      const l = local(b, x, z);
      if (polyInside(l.x, l.z, b.outline)) return true;
      return pad > 0 && polyEdgeDistance(l.x, l.z, b.outline) < pad;
    }
  }
  return false;
}

/** Height of the record's upper surface at a plan point (assumes inFootprint). */
export function topAt (b, x, z) {
  if (b.kind === 'ramp') {
    const t = clamp(((b.axis==='z'?z:x) - b.x1) / (b.x2 - b.x1), 0, 1);
    return b.y1 + (b.y2 - b.y1) * t;
  }
  if (b.roof) {
    const l = local(b, x, z);
    const fx = Math.min(1, Math.abs(l.x) / b.hw);
    const f = b.roof === 'hip' ? Math.max(fx, Math.min(1, Math.abs(l.z) / b.hd)) : fx;
    return b.top - (b.top - b.base) * f;
  }
  return b.top;
}

/** Height of the record's underside at a plan point. */
export function baseAt (b, x, z) {
  if (b.kind === 'ramp') return topAt(b, x, z) - b.thickness;
  return b.base;
}

function polyInside (x, z, o) {
  let c = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const a = o[i], b = o[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function polyEdgeDistance (x, z, o) {
  let best = Infinity;
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    if (d < best) best = d;
  }
  return best;
}
/** Closest point on the polygon boundary to (x,z), and whether (x,z) is inside. */
function polyClosest (x, z, o, out) {
  let best = Infinity, bx = x, bz = z;
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = a[0] + t * dx, pz = a[1] + t * dz;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  out.x = bx; out.z = bz; out.inside = polyInside(x, z, o);
  return out;
}

/**
 * Closest point of the footprint boundary/interior to (x,z), in WORLD space,
 * with `inside` set when the point is within the footprint. For boxes this is
 * the familiar clamp; for prisms the nearest boundary point.
 */
export function closestPoint (b, x, z, out) {
  if (b.kind === 'box' || b.kind === 'ramp') {
    out.x = clamp(x, b.minX, b.maxX); out.z = clamp(z, b.minZ, b.maxZ);
    out.inside = x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
    return out;
  }
  const l = local(b, x, z);
  if (b.kind === 'rbox') {
    const lx = clamp(l.x, -b.hw, b.hw), lz = clamp(l.z, -b.hd, b.hd);
    out.inside = Math.abs(l.x) < b.hw && Math.abs(l.z) < b.hd;
    out.x = b.cx + b.c * lx + b.s * lz; out.z = b.cz - b.s * lx + b.c * lz;
    return out;
  }
  const lx = l.x, lz = l.z;
  polyClosest(lx, lz, b.outline, _cp);
  out.inside = _cp.inside;
  out.x = b.cx + b.c * _cp.x + b.s * _cp.z; out.z = b.cz - b.s * _cp.x + b.c * _cp.z;
  return out;
}

/**
 * Eject a point that is INSIDE the footprint through the nearest side.
 * Returns the outward normal in `n` and moves (x,z) in `p`.
 */
export function ejectInside (b, p, radius, n) {
  if (b.kind === 'box' || b.kind === 'ramp') {
    const l = p.x - b.minX, r = b.maxX - p.x, u = p.z - b.minZ, dn = b.maxZ - p.z;
    const m = Math.min(l, r, u, dn);
    n.x = 0; n.z = 0;
    if (m === l) { p.x = b.minX - radius; n.x = -1; }
    else if (m === r) { p.x = b.maxX + radius; n.x = 1; }
    else if (m === u) { p.z = b.minZ - radius; n.z = -1; }
    else { p.z = b.maxZ + radius; n.z = 1; }
    return;
  }
  const lc = local(b, p.x, p.z);
  let nx = 0, nz = 0, lx = lc.x, lz = lc.z;
  if (b.kind === 'rbox') {
    const l = lx + b.hw, r = b.hw - lx, u = lz + b.hd, dn = b.hd - lz;
    const m = Math.min(l, r, u, dn);
    if (m === l) { lx = -b.hw - radius; nx = -1; }
    else if (m === r) { lx = b.hw + radius; nx = 1; }
    else if (m === u) { lz = -b.hd - radius; nz = -1; }
    else { lz = b.hd + radius; nz = 1; }
  } else {
    polyClosest(lx, lz, b.outline, _cp);
    let dx = _cp.x - lx, dz = _cp.z - lz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    lx = _cp.x + dx * radius; lz = _cp.z + dz * radius;
    nx = dx; nz = dz;
  }
  p.x = b.cx + b.c * lx + b.s * lz; p.z = b.cz - b.s * lx + b.c * lz;
  n.x = b.c * nx + b.s * nz; n.z = -b.s * nx + b.c * nz;
}

/* ---------------- the spatial set ---------------- */

export class ColliderSet {
  constructor (cell = 40) {
    this.cell = cell;
    this.cells = new Map();
    this.all = [];
    this._out = [];
    this._stamp = 1;
  }

  add (b) {
    this.all.push(b);
    const s = this.cell;
    const x0 = Math.floor(b.minX / s), x1 = Math.floor(b.maxX / s);
    const z0 = Math.floor(b.minZ / s), z1 = Math.floor(b.maxZ / s);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = x * HASH + z;
        let l = this.cells.get(k);
        if (!l) { l = []; this.cells.set(k, l); }
        l.push(b);
      }
    }
    return b;
  }

  /**
   * Records whose bounds overlap the square of radius `r` around (x,z).
   * Returns a SHARED scratch array — consume it before the next call.
   */
  near (x, z, r = 2) {
    const out = this._out;
    out.length = 0;
    const s = this.cell;
    const stamp = ++this._stamp;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s), z1 = Math.floor((z + r) / s);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const l = this.cells.get(cx * HASH + cz);
        if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const b = l[i];
          if (b._stamp === stamp || b.gone) continue;
          b._stamp = stamp;
          if (b.maxX < x - r || b.minX > x + r || b.maxZ < z - r || b.minZ > z + r) continue;
          out.push(b);
        }
      }
    }
    return out;
  }
}
