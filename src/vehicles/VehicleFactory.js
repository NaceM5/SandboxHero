import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Every car in the city is drawn from a handful of InstancedMeshes:
 *  one shell (tinted per instance), one glass/trim set, one emissive
 *  light set per body type, plus a single global wheel mesh. That keeps
 *  a hundred vehicles at roughly a dozen draw calls.
 * ------------------------------------------------------------------ */

function profileShape (pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

function extrudeSide (pts, width, bevel = 0.14, seg = 4) {
  const g = new THREE.ExtrudeGeometry(profileShape(pts), {
    depth: width - bevel * 2, bevelEnabled: true,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: seg, curveSegments: 3
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  // the profile is authored with the nose at -x, so rotating +90 deg puts the
  // hood at +Z — the direction the vehicle actually drives
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

const TYPES = {
  sedan: {
    w: 1.84, len: 4.62, wheelR: 0.34, wheelbase: 2.66, ride: 0.26, track: 0.80,
    body: [[-2.31, 0.14], [-2.34, 0.40], [-2.26, 0.60], [-1.98, 0.70], [-1.30, 0.74],
      [-0.92, 0.78], [-0.46, 1.24], [0.28, 1.32], [0.80, 1.30], [1.30, 0.88],
      [1.86, 0.82], [2.16, 0.78], [2.28, 0.56], [2.24, 0.14]],
    glass: [[-0.44, 1.19], [0.26, 1.26], [0.78, 1.24], [1.18, 0.90], [-0.82, 0.84]],
    speed: 16.5, roof: null
  },
  coupe: {
    w: 1.90, len: 4.48, wheelR: 0.33, wheelbase: 2.60, ride: 0.20, track: 0.84,
    body: [[-2.24, 0.10], [-2.30, 0.34], [-2.20, 0.50], [-1.85, 0.56], [-1.05, 0.62],
      [-0.42, 1.06], [0.36, 1.14], [1.02, 1.06], [1.72, 0.68], [2.06, 0.62],
      [2.18, 0.42], [2.14, 0.10]],
    glass: [[-0.40, 1.02], [0.34, 1.09], [0.98, 1.01], [1.52, 0.70], [-0.96, 0.66]],
    speed: 20, roof: null
  },
  suv: {
    w: 1.98, len: 4.86, wheelR: 0.40, wheelbase: 2.86, ride: 0.40, track: 0.86,
    body: [[-2.43, 0.16], [-2.47, 0.52], [-2.38, 0.80], [-2.05, 0.92], [-1.32, 0.98],
      [-0.94, 1.50], [0.30, 1.58], [1.28, 1.56], [1.60, 1.46], [1.80, 1.10],
      [2.32, 1.02], [2.44, 0.62], [2.40, 0.16]],
    glass: [[-0.90, 1.44], [0.30, 1.52], [1.24, 1.50], [1.52, 1.16], [-1.26, 1.02]],
    speed: 15, roof: { w: 1.24, h: 0.09, d: 2.5, y: 1.60, z: 0.15 }
  },
  van: {
    w: 2.06, len: 5.36, wheelR: 0.39, wheelbase: 3.18, ride: 0.36, track: 0.88,
    body: [[-2.68, 0.14], [-2.72, 0.56], [-2.60, 0.92], [-2.24, 1.06], [-2.00, 1.16],
      [-1.80, 1.80], [-0.20, 1.88], [1.60, 1.88], [2.30, 1.80], [2.52, 1.30],
      [2.62, 0.70], [2.58, 0.14]],
    glass: [[-1.78, 1.74], [-0.90, 1.78], [-0.86, 1.20], [-1.98, 1.14]],
    speed: 13, roof: { w: 1.30, h: 0.10, d: 3.0, y: 1.90, z: 0.35 }
  },
  hatch: {
    w: 1.76, len: 4.06, wheelR: 0.32, wheelbase: 2.44, ride: 0.26, track: 0.76,
    body: [[-2.03, 0.12], [-2.08, 0.38], [-1.98, 0.56], [-1.62, 0.64], [-1.02, 0.70],
      [-0.52, 1.16], [0.34, 1.26], [1.14, 1.22], [1.62, 0.92], [1.86, 0.74],
      [1.96, 0.46], [1.92, 0.12]],
    glass: [[-0.50, 1.11], [0.32, 1.21], [1.08, 1.17], [1.44, 0.94], [-0.92, 0.74]],
    speed: 17.5, roof: null
  },
  pickup: {
    w: 1.94, len: 5.10, wheelR: 0.40, wheelbase: 3.05, ride: 0.42, track: 0.86,
    body: [[-2.55, 0.16], [-2.59, 0.54], [-2.50, 0.84], [-2.12, 0.94], [-1.44, 1.00],
      [-1.06, 1.50], [0.10, 1.56], [0.46, 1.50], [0.52, 0.98], [2.36, 0.94],
      [2.48, 0.60], [2.44, 0.16]],
    glass: [[-1.02, 1.44], [0.08, 1.50], [0.42, 1.44], [-1.38, 1.02]],
    speed: 15.5, roof: null
  }
};

for (const T of Object.values(TYPES)) {
  // wing mirrors sit just behind the windscreen base
  T.mirrorY = T.glass[0][1] - 0.16;
  T.mirrorZ = T.glass[0][0] - 0.10;
}

export const VEHICLE_TYPES = Object.keys(TYPES);

const CAR_COLORS = [
  '#c9ced6', '#2c3138', '#8d2027', '#1f3d70', '#5c6570', '#0f1216',
  '#b8bcc2', '#2f5d4a', '#7a6a3f', '#a83b1e', '#3a3f52', '#d8d3c8',
  '#1b6b74', '#6b2f52', '#e0a92c', '#455a64'
];
export const randomCarColor = () => CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

export class VehicleFactory {
  constructor (scene, maxPerType = 40) {
    this.scene = scene;
    this.pools = {};
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1218, roughness: 0.06, metalness: 0.85 });
    const headMat  = new THREE.MeshStandardMaterial({ color: 0xfff4e2, emissive: 0xffe8c0, emissiveIntensity: 2.2, roughness: 0.2 });
    const tailMat  = new THREE.MeshStandardMaterial({ color: 0xff2a3c, emissive: 0xff1830, emissiveIntensity: 1.6, roughness: 0.2 });
    this.headMat = headMat; this.tailMat = tailMat;

    for (const name of VEHICLE_TYPES) {
      const T = TYPES[name];
      const shell = extrudeSide(T.body, T.w);
      shell.translate(0, T.ride, 0);

      const glass = extrudeSide(T.glass, T.w + 0.04, 0.03);
      glass.translate(0, T.ride + 0.005, 0);

      // lamp clusters + a suggestion of a driver behind the glass
      const mkBox = (w, h, d, x, y, z) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y + T.ride, z);
        return g;
      };
      const front = T.len / 2 - 0.10, back = -T.len / 2 + 0.10;
      const headGeo = mergeGeos([
        mkBox(0.46, 0.17, 0.16, T.w * 0.31, 0.60, front),
        mkBox(0.46, 0.17, 0.16, -T.w * 0.31, 0.60, front)
      ]);
      const tailGeo = mergeGeos([
        mkBox(0.40, 0.15, 0.13, T.w * 0.31, 0.68, back),
        mkBox(0.40, 0.15, 0.13, -T.w * 0.31, 0.68, back)
      ]);

      // seated driver, slightly forward and to the left
      const dTorso = new THREE.SphereGeometry(0.23, 10, 7);
      dTorso.scale(1.2, 1.15, 0.85); dTorso.translate(-0.32, T.ride + 0.86, 0.06);
      const dHead = new THREE.SphereGeometry(0.115, 10, 8);
      dHead.scale(1, 1.12, 1); dHead.translate(-0.32, T.ride + 1.20, 0.02);
      const driverGeo = mergeGeos([dTorso, dHead]);

      /* ---- body detailing ---- */
      const det = [];
      const half = T.wheelbase / 2;
      const bw = T.w / 2;
      // wheel arch lips
      for (const zz of [half, -half]) {
        for (const sx of [1, -1]) {
          const a = new THREE.TorusGeometry(T.wheelR * 1.34, 0.055, 6, 14, Math.PI);
          a.rotateY(Math.PI / 2);
          a.translate(sx * (bw - 0.015), T.ride + T.wheelR * 0.34, zz);
          det.push(a);
        }
      }
      // rocker sills down each flank
      for (const sx of [1, -1]) {
        const sill = new THREE.BoxGeometry(0.10, 0.13, T.wheelbase * 1.02);
        sill.translate(sx * (bw - 0.03), T.ride + 0.16, 0);
        det.push(sill);
      }
      // bumpers
      det.push(mkBox(T.w * 0.94, 0.17, 0.20, 0, 0.24, front - 0.02));
      det.push(mkBox(T.w * 0.94, 0.17, 0.20, 0, 0.26, back + 0.02));
      // wing mirrors
      for (const sx of [1, -1]) {
        const m = new THREE.BoxGeometry(0.20, 0.10, 0.09);
        m.translate(sx * (bw + 0.10), T.ride + T.mirrorY, T.mirrorZ);
        det.push(m);
      }
      if (T.roof) {
        det.push(mkBox(T.roof.w, T.roof.h, T.roof.d, 0, T.roof.y - T.ride, T.roof.z));
      }
      const detailGeo = mergeGeos(det);

      const trimGeo = mergeGeos([glass, driverGeo]);
      const shellFull = mergeGeos([shell, detailGeo]);

      const pool = {
        T,
        shell: new THREE.InstancedMesh(shellFull, shellMat, maxPerType),
        trim: new THREE.InstancedMesh(trimGeo, glassMat, maxPerType),
        head: new THREE.InstancedMesh(headGeo, headMat, maxPerType),
        tail: new THREE.InstancedMesh(tailGeo, tailMat, maxPerType),
        count: 0, max: maxPerType
      };
      pool.shell.castShadow = true; pool.shell.receiveShadow = true;
      pool.trim.castShadow = false;
      pool.shell.frustumCulled = false; pool.trim.frustumCulled = false;
      pool.head.frustumCulled = false; pool.tail.frustumCulled = false;
      pool.shell.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxPerType * 3).fill(1), 3);
      for (let i = 0; i < maxPerType; i++) {
        pool.shell.setMatrixAt(i, zero); pool.trim.setMatrixAt(i, zero);
        pool.head.setMatrixAt(i, zero); pool.tail.setMatrixAt(i, zero);
      }
      scene.add(pool.shell, pool.trim, pool.head, pool.tail);
      this.pools[name] = pool;
    }

    // one wheel mesh for the whole city
    const wg = new THREE.CylinderGeometry(1, 1, 1, 14);
    wg.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.88 });
    const maxWheels = maxPerType * VEHICLE_TYPES.length * 4;
    this.wheels = new THREE.InstancedMesh(mergeGeos([wg]), wheelMat, maxWheels);
    this.wheels.castShadow = true;
    this.wheels.frustumCulled = false;
    for (let i = 0; i < maxWheels; i++) this.wheels.setMatrixAt(i, zero);
    scene.add(this.wheels);
    this.wheelCount = 0;
    this.zero = zero;
  }

  alloc (type) {
    const p = this.pools[type];
    if (!p || p.count >= p.max) return -1;
    return p.count++;
  }

  setColor (type, idx, color) {
    const p = this.pools[type];
    const c = new THREE.Color(color).convertSRGBToLinear();
    p.shell.instanceColor.setXYZ(idx, c.r, c.g, c.b);
    p.shell.instanceColor.needsUpdate = true;
  }

  beginFrame () { this.wheelCount = 0; }

  writeVehicle (v, m4) {
    const p = this.pools[v.type];
    p.shell.setMatrixAt(v.idx, m4);
    p.trim.setMatrixAt(v.idx, m4);
    p.head.setMatrixAt(v.idx, v.headlights ? m4 : this.zero);
    p.tail.setMatrixAt(v.idx, v.braking || v.headlights ? m4 : this.zero);
  }

  writeWheel (m4) {
    if (this.wheelCount >= this.wheels.count) return;
    this.wheels.setMatrixAt(this.wheelCount++, m4);
  }

  endFrame () {
    for (const name of VEHICLE_TYPES) {
      const p = this.pools[name];
      p.shell.instanceMatrix.needsUpdate = true;
      p.trim.instanceMatrix.needsUpdate = true;
      p.head.instanceMatrix.needsUpdate = true;
      p.tail.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.wheelCount; i < this.wheels.count; i++) this.wheels.setMatrixAt(i, this.zero);
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  typeInfo (t) { return TYPES[t]; }
  setNight (n) {
    this.headMat.emissiveIntensity = 0.4 + n * 3.0;
    this.tailMat.emissiveIntensity = 0.9 + n * 1.6;
  }
}

/* minimal geometry merge — avoids pulling in the addons util for two attributes.
   Handles non-indexed sources (ExtrudeGeometry) by synthesising an index. */
function mergeGeos (list) {
  let vc = 0, ic = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    vc += n;
    ic += g.index ? g.index.count : n;
  }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.index) {
      const gi = g.index.array;
      for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
      io += gi.length;
    } else {
      for (let k = 0; k < count; k++) idx[io + k] = k + vo;
      io += count;
    }
    vo += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
