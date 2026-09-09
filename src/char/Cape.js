import * as THREE from 'three';

/**
 * Verlet cloth cape. Points live in world space and the top row is pinned
 * between two shoulder anchors, so the cape trails naturally from whatever
 * the body is doing — the single biggest contributor to flight feeling right.
 */
export class Cape {
  constructor (scene, opts = {}) {
    this.cols = opts.cols ?? 7;
    this.rows = opts.rows ?? 11;
    this.width = opts.width ?? 0.46;
    this.length = opts.length ?? 1.38;
    this.color = opts.color ?? '#b0182f';

    const n = this.cols * this.rows;
    this.pos = new Float32Array(n * 3);
    this.old = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    for (let x = 0; x < this.cols; x++) this.pinned[x] = 1;

    this.restH = this.width / (this.cols - 1);
    this.restV = this.length / (this.rows - 1);
    // widen the rest spacing toward the hem so the cape flares instead of
    // hanging like a board
    this.flare = opts.flare ?? 0.85;
    this.restHRow = new Float32Array(this.rows);
    for (let y = 0; y < this.rows; y++) {
      this.restHRow[y] = this.restH * (1 + (y / (this.rows - 1)) * this.flare);
    }

    const geo = new THREE.PlaneGeometry(this.width, this.length, this.cols - 1, this.rows - 1);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.color),
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0.02
    }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.anchorL = new THREE.Vector3();
    this.anchorR = new THREE.Vector3();
    this.bodyCenter = new THREE.Vector3();
    this.bodyRadius = 0.30;
    this.forward = new THREE.Vector3(0, 0, 1);   // body facing, set by the owner
    this.wind = new THREE.Vector3();
    this.gravity = -13.5;
    this.time = 0;
    this._init = false;
  }

  setColor (c) { this.mesh.material.color.set(c); }
  setVisible (v) { this.mesh.visible = v; }
  dispose () { this.mesh.parent?.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); }

  /** Snap the whole sheet under the anchors — used on spawn and teleports. */
  reset () {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = (y * this.cols + x) * 3;
        const spread = this.restHRow[y] / this.restH;
        const t = 0.5 + (x / (this.cols - 1) - 0.5) * spread;
        this.pos[i]     = this.anchorL.x + (this.anchorR.x - this.anchorL.x) * t;
        this.pos[i + 1] = this.anchorL.y + (this.anchorR.y - this.anchorL.y) * t - y * this.restV;
        this.pos[i + 2] = this.anchorL.z + (this.anchorR.z - this.anchorL.z) * t;
        this.old[i] = this.pos[i]; this.old[i + 1] = this.pos[i + 1]; this.old[i + 2] = this.pos[i + 2];
      }
    }
    this._init = true;
  }

  update (dt, charVel, flying) {
    if (!this._init) { this.reset(); return; }
    dt = Math.min(dt, 1 / 45);
    this.time += dt;

    // a teleport leaves the cloth stranded across the map — start it over
    const dxa = this.pos[0] - this.anchorL.x;
    const dya = this.pos[1] - this.anchorL.y;
    const dza = this.pos[2] - this.anchorL.z;
    if (dxa * dxa + dya * dya + dza * dza > this.length * this.length * 4) { this.reset(); return; }

    // pin the top row across the shoulders
    for (let x = 0; x < this.cols; x++) {
      const i = x * 3, t = x / (this.cols - 1);
      this.pos[i]     = this.anchorL.x + (this.anchorR.x - this.anchorL.x) * t;
      this.pos[i + 1] = this.anchorL.y + (this.anchorR.y - this.anchorL.y) * t;
      this.pos[i + 2] = this.anchorL.z + (this.anchorR.z - this.anchorL.z) * t;
    }

    // air pushes back against however fast the hero is travelling
    const speed = charVel.length();
    const drag = flying ? 0.85 : 0.55;
    this.wind.copy(charVel).multiplyScalar(-drag);
    const gust = Math.sin(this.time * 2.1) * 0.9 + Math.sin(this.time * 5.3) * 0.35;
    this.wind.x += gust * (flying ? 1.4 : 0.8);
    this.wind.z += Math.cos(this.time * 1.7) * (flying ? 1.4 : 0.8);
    // a fast hero's cape streams out flat instead of hanging
    const g = this.gravity * (flying ? Math.max(0.12, 1 - speed / 34) : 1);

    const ax = this.wind.x, ay = g + this.wind.y * 0.25, az = this.wind.z;
    const damp = 0.976;
    const dt2 = dt * dt;

    for (let p = this.cols; p < this.cols * this.rows; p++) {
      const i = p * 3;
      for (let c = 0; c < 3; c++) {
        const cur = this.pos[i + c];
        const vel = (cur - this.old[i + c]) * damp;
        const acc = c === 0 ? ax : c === 1 ? ay : az;
        this.old[i + c] = cur;
        this.pos[i + c] = cur + vel + acc * dt2;
      }
    }

    for (let iter = 0; iter < 4; iter++) this._constrain();
    this._clampChain();
    this._collide();

    // write to geometry (mesh sits at world origin, verts are world-space)
    const arr = this.geo.attributes.position.array;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const src = (y * this.cols + x) * 3;
        const dst = (y * this.cols + x) * 3;
        arr[dst] = this.pos[src]; arr[dst + 1] = this.pos[src + 1]; arr[dst + 2] = this.pos[src + 2];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  _solve (a, b, rest, stiff) {
    if (this.pinned[a] && this.pinned[b]) return;
    const ia = a * 3, ib = b * 3;
    let dx = this.pos[ib] - this.pos[ia];
    let dy = this.pos[ib + 1] - this.pos[ia + 1];
    let dz = this.pos[ib + 2] - this.pos[ia + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = ((d - rest) / d) * 0.5 * stiff;
    dx *= diff; dy *= diff; dz *= diff;
    if (!this.pinned[a]) { this.pos[ia] += dx; this.pos[ia + 1] += dy; this.pos[ia + 2] += dz; }
    if (!this.pinned[b]) { this.pos[ib] -= dx; this.pos[ib + 1] -= dy; this.pos[ib + 2] -= dz; }
    if (this.pinned[a] !== this.pinned[b]) {
      // pinned partner takes none of the correction, so double the free side
      const f = this.pinned[a] ? ib : ia, s = this.pinned[a] ? -1 : 1;
      this.pos[f] += dx * s; this.pos[f + 1] += dy * s; this.pos[f + 2] += dz * s;
    }
  }

  _constrain () {
    const C = this.cols, R = this.rows;
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < C; x++) {
        const i = y * C + x;
        if (x < C - 1) this._solve(i, i + 1, this.restHRow[y], 0.92);
        if (y < R - 1) this._solve(i, i + C, this.restV, 1.0);
        if (x < C - 1 && y < R - 1) this._solve(i, i + C + 1, Math.hypot(this.restHRow[y], this.restV), 0.30);
        if (x > 0 && y < R - 1) this._solve(i, i + C - 1, Math.hypot(this.restHRow[y], this.restV), 0.30);
        if (y < R - 2) this._solve(i, i + C * 2, this.restV * 2, 0.22); // bend stiffness
      }
    }
  }

  /**
   * Hard length limit walked down each column. Relaxation alone can't keep up
   * when the shoulders move tens of metres per second, so without this the
   * sheet stretches into a plank at supersonic speed (or after a teleport).
   */
  _clampChain () {
    const C = this.cols, R = this.rows, maxLen = this.restV * 1.22;
    for (let x = 0; x < C; x++) {
      for (let y = 1; y < R; y++) {
        const i = (y * C + x) * 3, up = ((y - 1) * C + x) * 3;
        const dx = this.pos[i] - this.pos[up];
        const dy = this.pos[i + 1] - this.pos[up + 1];
        const dz = this.pos[i + 2] - this.pos[up + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxLen && d > 1e-6) {
          const k = maxLen / d;
          this.pos[i] = this.pos[up] + dx * k;
          this.pos[i + 1] = this.pos[up + 1] + dy * k;
          this.pos[i + 2] = this.pos[up + 2] + dz * k;
        }
      }
    }
  }

  _collide () {
    const c = this.bodyCenter, r = this.bodyRadius;
    // Hard half-space constraint: the cape hangs off the back, so no point may
    // end up in front of the shoulder plane. Without this a hard turn or a
    // steep climb can whip the whole sheet over the hero's head and leave it
    // draped down the chest.
    const f = this.forward;
    const ax = (this.anchorL.x + this.anchorR.x) * 0.5;
    const ay = (this.anchorL.y + this.anchorR.y) * 0.5;
    const az = (this.anchorL.z + this.anchorR.z) * 0.5;
    for (let p = this.cols; p < this.cols * this.rows; p++) {
      const i = p * 3;
      const d = (this.pos[i] - ax) * f.x + (this.pos[i + 1] - ay) * f.y + (this.pos[i + 2] - az) * f.z;
      if (d > -0.04) {
        const push = d + 0.04;
        this.pos[i] -= f.x * push;
        this.pos[i + 1] -= f.y * push;
        this.pos[i + 2] -= f.z * push;
      }
    }
    for (let p = this.cols; p < this.cols * this.rows; p++) {
      const i = p * 3;
      // body capsule
      const dy = this.pos[i + 1] - c.y;
      if (dy > -0.75 && dy < 0.55) {
        const dx = this.pos[i] - c.x, dz = this.pos[i + 2] - c.z;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-5) {
          const k = r / d;
          this.pos[i] = c.x + dx * k;
          this.pos[i + 2] = c.z + dz * k;
        }
      }
      if (this.pos[i + 1] < 0.03) this.pos[i + 1] = 0.03; // don't sink into the street
    }
  }
}
