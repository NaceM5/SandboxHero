/**
 * Triangle heightfield.
 *
 * The Tideline map's ground is a Delaunay mesh (24 m spacing, refined along
 * the road edges) and its roads are triangle ribbons floating a few tens of
 * centimetres above it. Sampling the analytic terrain function would disagree
 * with the rendered triangles between vertices — feet in the grass on every
 * hillside — so ground queries read the exact same triangles the GPU draws.
 *
 * Triangles are bucketed on a uniform XZ grid; a lookup is a handful of
 * point-in-triangle tests and a barycentric interpolation.
 */
export class SurfaceField {
  constructor (cell = 16) {
    this.cell = cell;
    this.cells = new Map();
    this.tris = [];          // Float32Array(9) per triangle: ax ay az bx by bz cx cy cz
    this.count = 0;
  }

  /** Index every triangle of a BufferGeometry (indexed or not). */
  addGeometry (geometry) {
    const p = geometry.attributes.position;
    const idx = geometry.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      this.addTriangle(
        p.getX(a), p.getY(a), p.getZ(a),
        p.getX(b), p.getY(b), p.getZ(b),
        p.getX(c), p.getY(c), p.getZ(c));
    }
  }

  addTriangle (ax, ay, az, bx, by, bz, cx, cy, cz) {
    // degenerate (zero-area in plan) triangles can never contain a point
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(area) < 1e-4) return;
    const t = new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz]);
    const id = this.tris.length;
    this.tris.push(t);
    this.count++;
    const s = this.cell;
    const x0 = Math.floor(Math.min(ax, bx, cx) / s), x1 = Math.floor(Math.max(ax, bx, cx) / s);
    const z0 = Math.floor(Math.min(az, bz, cz) / s), z1 = Math.floor(Math.max(az, bz, cz) / s);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = x * 100003 + z;
        let l = this.cells.get(k);
        if (!l) { l = []; this.cells.set(k, l); }
        l.push(id);
      }
    }
  }

  /**
   * Highest surface at (x,z) that is at or below `ceiling`, or null when no
   * triangle covers the point (open water, the lake, off the map).
   */
  heightAt (x, z, ceiling = Infinity) {
    const s = this.cell;
    const l = this.cells.get(Math.floor(x / s) * 100003 + Math.floor(z / s));
    if (!l) return null;
    let best = null;
    for (let i = 0; i < l.length; i++) {
      const t = this.tris[l[i]];
      const ax = t[0], az = t[2], bx = t[3], bz = t[5], cx = t[6], cz = t[8];
      const v0x = bx - ax, v0z = bz - az, v1x = cx - ax, v1z = cz - az, v2x = x - ax, v2z = z - az;
      const den = v0x * v1z - v1x * v0z;
      const u = (v2x * v1z - v1x * v2z) / den;
      if (u < -1e-4) continue;
      const v = (v0x * v2z - v2x * v0z) / den;
      if (v < -1e-4 || u + v > 1 + 1e-4) continue;
      const y = t[1] + u * (t[4] - t[1]) + v * (t[7] - t[1]);
      if (y <= ceiling && (best === null || y > best)) best = y;
    }
    return best;
  }

  /** Surface normal at (x,z) (of the highest triangle under `ceiling`), or null. */
  normalAt (x, z, out, ceiling = Infinity) {
    const s = this.cell;
    const l = this.cells.get(Math.floor(x / s) * 100003 + Math.floor(z / s));
    if (!l) return null;
    let best = null, bestY = -Infinity;
    for (let i = 0; i < l.length; i++) {
      const t = this.tris[l[i]];
      const ax = t[0], az = t[2], bx = t[3], bz = t[5], cx = t[6], cz = t[8];
      const v0x = bx - ax, v0z = bz - az, v1x = cx - ax, v1z = cz - az, v2x = x - ax, v2z = z - az;
      const den = v0x * v1z - v1x * v0z;
      const u = (v2x * v1z - v1x * v2z) / den;
      if (u < -1e-4) continue;
      const v = (v0x * v2z - v2x * v0z) / den;
      if (v < -1e-4 || u + v > 1 + 1e-4) continue;
      const y = t[1] + u * (t[4] - t[1]) + v * (t[7] - t[1]);
      if (y <= ceiling && y > bestY) { bestY = y; best = t; }
    }
    if (!best) return null;
    const t = best;
    const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2];
    const e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const len = Math.hypot(nx, ny, nz) || 1;
    return out.set(nx / len, ny / len, nz / len);
  }
}
