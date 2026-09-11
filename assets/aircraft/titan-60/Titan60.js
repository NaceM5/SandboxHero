import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { makePrism } from '../../../src/world/Colliders.js';

/**
 * TITAN 60 — heavy strategic airlifter. Standalone parked prop.
 * Metres, +Y up, +Z nose, origin on the ground beneath the fuselage centre.
 * Same construction as the Atlas 42: convex-hull lofts and primitives, with a
 * separate set of conservative vertical prism colliders for gameplay.
 */
export function createTitan60 () {
  const group = new THREE.Group(); group.name = 'TITAN_60';
  const collisionParts = [];
  const mats = {
    hull: new THREE.MeshStandardMaterial({ color: 0x3b4147, metalness: 0.62, roughness: 0.5 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x484f56, metalness: 0.6, roughness: 0.46 }),
    belly: new THREE.MeshStandardMaterial({ color: 0x2f353a, metalness: 0.58, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c2124, metalness: 0.55, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x14262f, metalness: 0.85, roughness: 0.16 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x131617, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa3a6, metalness: 0.9, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8202a, metalness: 0.2, roughness: 0.55 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe9c141, metalness: 0.4, roughness: 0.45 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffe1a0, emissive: 0xffbb55, emissiveIntensity: 2 })
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function mesh (name, geo, mat) { const m = new THREE.Mesh(geo, mats[mat]); m.name = name; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; }
  function hull (name, points, mat = 'hull') { return mesh(name, new ConvexGeometry(points.map(p => V(...p))), mat); }
  function box (name, p, s, mat = 'hull') { const m = mesh(name, new THREE.BoxGeometry(...s), mat); m.position.set(...p); return m; }
  function rod (name, a, b, r, mat = 'steel', n = 10) {
    const d = V(...b).sub(V(...a));
    const m = mesh(name, new THREE.CylinderGeometry(r, r, d.length(), n), mat);
    m.position.copy(V(...a).add(V(...b)).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m;
  }
  function prism (name, outline, base, top, mat = 'hull', solid = true) {
    hull(name, outline.flatMap(([x, z]) => [[x, base, z], [x, top, z]]), mat);
    if (solid) collisionParts.push({ name, outline, base, top });
  }

  /* ---- fuselage: a fat circular loft with a deep belly, a swept-up tail and a domed nose ---- */
  // [z, half-width, belly y, top y]
  const S = [
    [-24.5, 0.55, 7.5, 8.7],
    [-21, 1.7, 6.3, 9.0],
    [-16.5, 2.7, 4.6, 9.2],
    [-11, 3.15, 3.2, 9.3],
    [-5, 3.25, 2.65, 9.3],
    [3, 3.25, 2.6, 9.3],
    [10, 3.2, 2.6, 9.25],
    [15.5, 3.05, 2.8, 9.0],
    [19.5, 2.55, 3.25, 8.4],
    [22.5, 1.6, 4.1, 7.1],
    [24.6, 0.45, 5.2, 5.9]
  ];
  const ring = ([z, w, lo, hi]) => {
    const h = hi - lo, cy = lo + h / 2, r = h / 2;
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 12 * Math.PI * 2;
      pts.push([Math.cos(t) * w, cy + Math.sin(t) * r, z]);
    }
    return pts;
  };
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    hull('Fuselage_' + i, [...ring(a), ...ring(b)], i % 2 ? 'hull' : 'panel');
    collisionParts.push({
      name: 'Fuselage_' + i,
      outline: [[-a[1], a[0] - 0.01], [a[1], a[0] - 0.01], [b[1], b[0] + 0.01], [-b[1], b[0] + 0.01]],
      base: Math.min(a[2], b[2]), top: Math.max(a[3], b[3])
    });
  }
  // radome and cockpit glazing
  hull('Radome', [[-1.4, 4.7, 22.6], [1.4, 4.7, 22.6], [-1.4, 6.6, 22.6], [1.4, 6.6, 22.6], [0, 5.55, 25.6], [-0.9, 5.0, 24.9], [0.9, 5.0, 24.9], [0, 6.3, 24.9]], 'dark');
  for (const s of [-1, 1]) {
    hull('Windshield_' + s, [[s * 0.15, 7.55, 20.6], [s * 1.35, 7.35, 20.4], [s * 1.15, 6.6, 22.1], [s * 0.15, 6.75, 22.4], [s * 0.15, 7.5, 20.6]], 'glass');
    hull('Side_window_' + s, [[s * 2.25, 7.15, 18.3], [s * 2.2, 6.4, 18.5], [s * 1.75, 6.5, 20.4], [s * 1.75, 7.1, 20.2], [s * 2.25, 7.1, 18.3]], 'glass');
    rod('Cockpit_frame_' + s, [s * 0.15, 6.7, 22.4], [s * 1.15, 6.6, 22.1], 0.06, 'panel');
  }
  // belly panels, cargo ramp seam and sponsons carrying the main gear
  hull('Belly_keel', [[-2.6, 2.55, -9], [2.6, 2.55, -9], [2.6, 2.55, 15], [-2.6, 2.55, 15], [-2.2, 2.85, -9.2], [2.2, 2.85, -9.2], [2.2, 2.85, 15.2], [-2.2, 2.85, 15.2]], 'belly');
  hull('Cargo_ramp', [[-2.5, 3.15, -11.5], [2.5, 3.15, -11.5], [2.2, 6.0, -20.5], [-2.2, 6.0, -20.5], [-2.3, 3.45, -11.6], [2.3, 3.45, -11.6], [2.0, 6.25, -20.4], [-2.0, 6.25, -20.4]], 'dark');
  for (const s of [-1, 1]) {
    hull('Sponson_' + s, [[s * 3.0, 2.2, -7.5], [s * 4.35, 2.4, -6.5], [s * 4.45, 2.4, 8.5], [s * 3.0, 2.2, 9.5], [s * 3.0, 4.9, -8.5], [s * 4.25, 4.6, -6.5], [s * 4.35, 4.6, 8.5], [s * 3.0, 4.9, 10.5]], 'belly');
    collisionParts.push({ name: 'Sponson_' + s, outline: [[s * 3.0, -8.5], [s * 4.45, -6.5], [s * 4.45, 8.5], [s * 3.0, 10.5]], base: 2.2, top: 4.9 });
  }
  box('Dorsal_spine', [0, 9.35, 0], [0.9, 0.3, 24], 'panel');
  for (const z of [-4, 1, 6]) box('Dorsal_antenna_' + z, [0, 9.75, z], [0.08, 0.5, 0.5], 'steel');

  /* ---- wings: high-mounted, 25° sweep, drooping (anhedral) with a fairing over the back ---- */
  const wingAt = (x) => {
    const t = x / 25;                              // 0 root .. 1 tip
    const le = 5.2 - x * 0.466, chord = 8.4 - 5.9 * t, y = 9.3 - 1.9 * t, th = 1.0 - 0.7 * t;
    return { le, te: le - chord, y, th };
  };
  hull('Wing_fairing', [[-3.6, 8.6, -4], [3.6, 8.6, -4], [3.6, 8.6, 7], [-3.6, 8.6, 7], [-2.4, 10.3, -3], [2.4, 10.3, -3], [2.4, 10.3, 6], [-2.4, 10.3, 6]], 'panel');
  collisionParts.push({ name: 'Wing_fairing', outline: [[-3.6, -4], [3.6, -4], [3.6, 7], [-3.6, 7]], base: 8.6, top: 10.3 });
  for (const s of [-1, 1]) {
    const stations = [0.8, 9, 17.5, 25];
    for (let i = 0; i < stations.length - 1; i++) {
      const a = wingAt(stations[i]), b = wingAt(stations[i + 1]), xa = s * stations[i], xb = s * stations[i + 1];
      hull('Wing_' + s + '_' + i, [
        [xa, a.y, a.le], [xa, a.y, a.te], [xa, a.y + a.th, a.le - 0.6], [xa, a.y + a.th * 0.6, a.te + 0.3],
        [xb, b.y, b.le], [xb, b.y, b.te], [xb, b.y + b.th, b.le - 0.4], [xb, b.y + b.th * 0.6, b.te + 0.2]
      ], i === 1 ? 'panel' : 'hull');
      collisionParts.push({
        name: 'Wing_' + s + '_' + i,
        outline: [[xa, a.le], [xb, b.le], [xb, b.te], [xa, a.te]],
        base: Math.min(a.y, b.y), top: Math.max(a.y + a.th, b.y + b.th)
      });
    }
    // flap track fairings and a wingtip light
    for (const x of [6.5, 12.5, 18.5]) {
      const w = wingAt(x);
      hull('Flap_track_' + s + '_' + x, [[s * (x - 0.35), w.y - 0.45, w.te + 1.6], [s * (x + 0.35), w.y - 0.45, w.te + 1.6], [s * x, w.y - 0.45, w.te - 1.2], [s * (x - 0.35), w.y + 0.05, w.te + 1.8], [s * (x + 0.35), w.y + 0.05, w.te + 1.8], [s * x, w.y + 0.05, w.te - 1.0]], 'panel');
    }
    const tip = wingAt(25);
    box('Wingtip_light_' + s, [s * 25.05, tip.y + 0.15, tip.le - 1.2], [0.15, 0.22, 0.5], 'lamp');

    /* ---- four underwing turbofans on pylons ---- */
    for (const ex of [8.6, 15.8]) {
      const w = wingAt(ex), cx = s * ex, cz = w.le + 0.6, cy = w.y - 2.55;
      const shroud = mesh('Engine_shroud_' + s + '_' + ex, new THREE.CylinderGeometry(1.32, 1.12, 6.4, 14, 1, true), 'hull');
      shroud.rotation.x = Math.PI / 2; shroud.position.set(cx, cy, cz);
      const lipF = mesh('Engine_lip_' + s + '_' + ex, new THREE.TorusGeometry(1.32, 0.14, 8, 26), 'panel'); lipF.position.set(cx, cy, cz + 3.2);
      const fan = mesh('Engine_fan_' + s + '_' + ex, new THREE.CylinderGeometry(1.15, 1.15, 0.12, 26), 'dark'); fan.rotation.x = Math.PI / 2; fan.position.set(cx, cy, cz + 2.9);
      for (let j = 0; j < 12; j++) { const t = j * Math.PI / 6; rod('Fan_blade', [cx + Math.cos(t) * 0.3, cy + Math.sin(t) * 0.3, cz + 2.95], [cx + Math.cos(t + 0.25) * 1.05, cy + Math.sin(t + 0.25) * 1.05, cz + 2.95], 0.055, 'steel', 6); }
      const spinner = mesh('Spinner_' + s + '_' + ex, new THREE.ConeGeometry(0.32, 0.7, 12), 'steel'); spinner.rotation.x = Math.PI / 2; spinner.position.set(cx, cy, cz + 3.3);
      const core = mesh('Engine_core_' + s + '_' + ex, new THREE.CylinderGeometry(0.75, 0.55, 2.0, 12), 'dark'); core.rotation.x = Math.PI / 2; core.position.set(cx, cy - 0.1, cz - 4.0);
      const cone = mesh('Exhaust_cone_' + s + '_' + ex, new THREE.ConeGeometry(0.42, 1.2, 12), 'steel'); cone.rotation.x = -Math.PI / 2; cone.position.set(cx, cy - 0.1, cz - 5.3);
      hull('Pylon_' + s + '_' + ex, [[cx - 0.3, cy + 0.9, cz + 1.5], [cx + 0.3, cy + 0.9, cz + 1.5], [cx - 0.3, cy + 0.9, cz - 2.2], [cx + 0.3, cy + 0.9, cz - 2.2], [cx - 0.3, w.y + 0.2, cz - 0.2], [cx + 0.3, w.y + 0.2, cz - 0.2], [cx - 0.3, w.y + 0.2, cz - 3.2], [cx + 0.3, w.y + 0.2, cz - 3.2]], 'panel');
      collisionParts.push({ name: 'Engine_' + s + '_' + ex, outline: [[cx - 1.35, cz - 5.2], [cx + 1.35, cz - 5.2], [cx + 1.35, cz + 3.4], [cx - 1.35, cz + 3.4]], base: cy - 1.35, top: w.y + 0.2 });
    }
  }

  /* ---- T-tail: a tall swept fin carrying the stabiliser on top ---- */
  hull('Vertical_fin', [
    [-0.55, 8.9, -15.5], [0.55, 8.9, -15.5], [-0.5, 8.9, -24.6], [0.5, 8.9, -24.6],
    [-0.35, 17.6, -21.3], [0.35, 17.6, -21.3], [-0.3, 17.6, -25.4], [0.3, 17.6, -25.4]
  ], 'panel');
  collisionParts.push({ name: 'Vertical_fin', outline: [[-0.55, -15.5], [0.55, -15.5], [0.55, -25.4], [-0.55, -25.4]], base: 8.9, top: 17.6 });
  hull('Fin_bullet', [[-0.5, 17.2, -20.8], [0.5, 17.2, -20.8], [-0.5, 18.2, -20.8], [0.5, 18.2, -20.8], [0, 17.7, -19.4], [-0.45, 17.4, -25.9], [0.45, 17.4, -25.9], [0, 18.0, -26.2]], 'hull');
  for (const s of [-1, 1]) {
    hull('Stabiliser_' + s, [[s * 0.5, 17.5, -20.6], [s * 0.5, 17.5, -25.0], [s * 11.5, 17.9, -23.9], [s * 11.5, 17.9, -25.8], [s * 0.5, 18.1, -21.0], [s * 0.5, 18.0, -24.7], [s * 11.5, 18.2, -24.1], [s * 11.5, 18.15, -25.7]], 'hull');
    collisionParts.push({ name: 'Stabiliser_' + s, outline: [[s * 0.5, -20.6], [s * 11.5, -23.9], [s * 11.5, -25.8], [s * 0.5, -25.0]], base: 17.5, top: 18.2 });
    // insignia on the fin
    const star = mesh('Fin_star_' + s, new THREE.CircleGeometry(0.75, 5), 'red');
    star.position.set(s * 0.58, 13.6, -19.6); star.rotation.y = s * Math.PI / 2; star.rotation.z = Math.PI / 10;
    const flash = box('Fin_flash_' + s, [s * 0.55, 12.2, -21.2], [0.04, 0.35, 3.2], 'gold');
  }

  /* ---- landing gear: twin-wheel nose leg, six-wheel main bogies each side ---- */
  function wheel (x, y, z, r, w) {
    const m = mesh('Tire', new THREE.CylinderGeometry(r, r, w, 18), 'rubber'); m.rotation.z = Math.PI / 2; m.position.set(x, y, z);
    for (const side of [-1, 1]) { const hub = mesh('Wheel_hub', new THREE.CylinderGeometry(r * 0.48, r * 0.48, 0.03, 12), 'steel'); hub.rotation.z = Math.PI / 2; hub.position.set(x + side * w * 0.51, y, z); }
  }
  for (const s of [-1, 1]) {
    for (const z of [-4.2, -0.2, 3.8]) {
      rod('Main_strut_' + s + '_' + z, [s * 3.5, 0.7, z], [s * 3.5, 2.6, z], 0.16);
      rod('Bogie_axle_' + s + '_' + z, [s * 2.7, 0.66, z], [s * 4.3, 0.66, z], 0.09);
      for (const dx of [-0.45, 0.45]) wheel(s * 3.5 + dx, 0.66, z, 0.66, 0.42);
    }
    box('Gear_door_' + s, [s * 4.55, 1.6, -0.2], [0.12, 1.4, 9.4], 'dark');
    collisionParts.push({ name: 'Main_gear_' + s, outline: [[s * 2.5, -5.2], [s * 4.6, -5.2], [s * 4.6, 4.8], [s * 2.5, 4.8]], base: 0, top: 2.6 });
  }
  rod('Nose_strut', [0, 0.5, 17.2], [0, 3.4, 17.2], 0.15);
  rod('Nose_brace', [0, 0.9, 17.2], [0, 3.0, 15.9], 0.09);
  for (const x of [-0.42, 0.42]) wheel(x, 0.5, 17.2, 0.5, 0.34);
  collisionParts.push({ name: 'Nose_gear', outline: [[-0.75, 16.5], [0.75, 16.5], [0.75, 17.9], [-0.75, 17.9]], base: 0, top: 3.4 });
  box('Landing_light', [0, 3.2, 16.5], [0.4, 0.2, 0.1], 'lamp');
  for (const s of [-1, 1]) box('Nav_light_' + s, [s * 2.6, 8.9, 13.5], [0.2, 0.12, 0.3], 'lamp');

  const raycast = (raycaster) => raycaster.intersectObject(group, true);
  function getColliders ({ position = [0, 0, 0], yaw = 0, scale = 1 } = {}) {
    if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('scale must be finite and positive');
    return collisionParts.map(p => makePrism({
      name: 'TITAN_60/' + p.name, x: position[0], z: position[2],
      outline: p.outline.map(([x, z]) => [x * scale, z * scale]),
      base: position[1] + p.base * scale, top: position[1] + p.top * scale, rotation: yaw
    }));
  }
  function createCollisionDebug () {
    const g = new THREE.Group(); g.name = 'TITAN_60_COLLIDERS';
    for (const p of collisionParts) {
      const geo = new ConvexGeometry(p.outline.flatMap(([x, z]) => [V(x, p.base, z), V(x, p.top, z)]));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3affe0, wireframe: true, transparent: true, opacity: 0.35 }));
      m.name = p.name; g.add(m);
    }
    return g;
  }
  return { group, collisionParts, getColliders, createCollisionDebug, raycast };
}
