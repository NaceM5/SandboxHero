import * as THREE from 'three';
import { rand, pick } from '../core/Util.js';

/* ------------------------------------------------------------------ *
 *  Procedural character construction.
 *
 *  Everything is built from lathed, tapered solids of revolution so the
 *  silhouette stays smooth and stylised — no boxy limbs anywhere. The
 *  skeleton is a plain Object3D hierarchy: every bone's geometry hangs
 *  down -Y from its pivot, so rotation.x swings forward/back and
 *  rotation.z swings out to the side. That makes the animation poses in
 *  Animations.js readable by hand.
 * ------------------------------------------------------------------ */

const geoCache = new Map();
const matCache = new Map();

function cachedGeo (key, build) {
  let g = geoCache.get(key);
  if (!g) { g = build(); geoCache.set(key, g); }
  return g;
}

function mat (color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.rough ?? 0.62,
      metalness: opts.metal ?? 0.0,
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      flatShading: false,
      ...(opts.transparent ? { transparent: true, opacity: opts.opacity ?? 1 } : {})
    });
    matCache.set(key, m);
  }
  return m;
}

/** Tapered capsule spanning y:0 (radius r0) down to y:-len (radius r1). */
function tapered (r0, r1, len, radial = 12, capSeg = 5, midSeg = 5) {
  const pts = [];
  for (let i = 0; i <= capSeg; i++) {
    const a = (i / capSeg) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.sin(a) * r0 + 1e-4, Math.cos(a) * r0 * 0.8));
  }
  for (let i = 1; i <= midSeg; i++) {
    const t = i / midSeg;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t, -len * t));
  }
  for (let i = 1; i <= capSeg; i++) {
    const a = (i / capSeg) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.cos(a) * r1 + 1e-4, -len - Math.sin(a) * r1 * 0.8));
  }
  const g = new THREE.LatheGeometry(pts, radial);
  g.computeVertexNormals();
  return g;
}

/** Solid of revolution from an explicit [radius, y] profile, flattened in Z. */
function lathe (profile, radial, squashZ) {
  const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(Math.max(p[0], 1e-4), p[1])), radial);
  if (squashZ !== 1) g.scale(1, 1, squashZ);
  g.computeVertexNormals();
  return g;
}

/* ---------------- proportions ---------------- */

export function proportions (build = 1, height = 1) {
  const b = build, h = height;
  return {
    h,
    hipY: 0.94 * h,
    pelvisH: 0.20 * h,
    chestY: 0.20 * h,
    chestH: 0.42 * h,
    neckY: 0.42 * h,
    neckH: 0.075 * h,
    headR: 0.113 * h,
    shoulderW: 0.222 * h * (0.80 + 0.20 * b),
    shoulderY: 0.345 * h,
    upperArm: 0.285 * h,
    foreArm: 0.255 * h,
    armR0: 0.068 * b, armR1: 0.053 * b, armR2: 0.046 * b,
    hipW: 0.093 * h,
    thigh: 0.44 * h,
    shin: 0.42 * h,
    legR0: 0.093 * b, legR1: 0.070 * b, legR2: 0.055 * b,
    torsoTop: 0.235 * b,
    torsoWaist: 0.152 * b,
    torsoHip: 0.155 * b
  };
}

/* ---------------- bone helper ---------------- */

function bone (parent, name, x, y, z) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  o.userData.rest = { x: 0, y: 0, z: 0 };
  parent.add(o);
  return o;
}
function setRest (b, x, y, z) {
  b.userData.rest = { x, y, z };
  b.rotation.set(x, y, z);
}
function attach (b, geo, material, y = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = false;
  b.add(m);
  return m;
}

/* ------------------------------------------------------------------ *
 *  buildCharacter(appearance) -> { group, bones, parts, appearance }
 * ------------------------------------------------------------------ */

export function buildCharacter (app) {
  const a = Object.assign({
    build: 1, height: 1, detail: 'high',
    skin: '#e0ac82', hair: '#2b2119', hairStyle: 'short',
    top: '#3d4a63', bottom: '#22262f', shoes: '#1a1c22',
    jacket: '#8d5b3f', jacketOn: false, glasses: false,
    suit: false, primary: '#1b47c9', secondary: '#d81f3d', accent: '#ffd447',
    emblem: false, emblemColor: '#ffd447', mask: 'none', glow: 0.5,
    belt: false, boots: false, gloves: false
  }, app);

  const hi = a.detail === 'high';
  const RAD = hi ? 14 : 8;
  // Crowd characters snap to a coarse size ladder so the geometry cache
  // actually hits — otherwise every pedestrian builds its own ~14 lathes.
  if (!hi) {
    a.build = Math.round(a.build / 0.07) * 0.07;
    a.height = Math.round(a.height / 0.05) * 0.05;
  }
  const P = proportions(a.build, a.height);
  const bKey = `${a.build.toFixed(2)}_${a.height.toFixed(2)}_${RAD}`;

  const group = new THREE.Group();
  group.userData.appearance = a;

  /* ---- materials by role ---- */
  const skinM  = mat(a.skin, { rough: 0.72 });
  const hairM  = mat(a.hair, { rough: 0.85 });
  const glowOpts = { rough: 0.35, metal: 0.15, emissive: a.accent, emissiveIntensity: a.glow };

  const torsoM = a.suit ? mat(a.primary, { rough: 0.42, metal: 0.12 }) : mat(a.top, { rough: 0.78 });
  const armM   = a.suit ? mat(a.primary, { rough: 0.42, metal: 0.12 }) : (a.jacketOn ? mat(a.jacket, { rough: 0.8 }) : skinM);
  const handM  = a.suit ? mat(a.secondary, { rough: 0.45 }) : skinM;
  const legM   = a.suit ? mat(a.secondary, { rough: 0.42, metal: 0.1 }) : mat(a.bottom, { rough: 0.8 });
  const shinM  = a.suit ? mat(a.secondary, { rough: 0.42, metal: 0.1 }) : mat(a.bottom, { rough: 0.8 });
  const footM  = a.suit ? mat(a.secondary, { rough: 0.3, metal: 0.25 }) : mat(a.shoes, { rough: 0.55 });
  const accM   = mat(a.accent, glowOpts);

  /* ---- skeleton ---- */
  const hips = bone(group, 'hips', 0, P.hipY, 0);
  const spine = bone(hips, 'spine', 0, P.pelvisH * 0.55, 0);
  const chest = bone(spine, 'chest', 0, P.pelvisH * 0.45, 0);
  const neck = bone(chest, 'neck', 0, P.chestH * 0.94, 0);
  const head = bone(neck, 'head', 0, P.neckH, 0);

  const mk = (side) => {
    const s = side === 'L' ? 1 : -1;
    const sh = bone(chest, 'shoulder' + side, s * P.shoulderW * 0.60, P.shoulderY, 0);
    const arm = bone(sh, 'arm' + side, s * P.shoulderW * 0.62, -0.030, 0);
    const fore = bone(arm, 'forearm' + side, 0, -P.upperArm, 0);
    const hand = bone(fore, 'hand' + side, 0, -P.foreArm, 0);
    setRest(arm, -0.05, 0, s * 0.10);
    setRest(fore, -0.12, 0, 0);
    const th = bone(hips, 'thigh' + side, s * P.hipW, -0.02, 0);
    const shn = bone(th, 'shin' + side, 0, -P.thigh, 0);
    const ft = bone(shn, 'foot' + side, 0, -P.shin, 0);
    setRest(th, 0, 0, -s * 0.015);
    return { sh, arm, fore, hand, th, shn, ft };
  };
  const L = mk('L'), R = mk('R');

  const bones = {
    hips, spine, chest, neck, head,
    shoulderL: L.sh, armL: L.arm, forearmL: L.fore, handL: L.hand,
    shoulderR: R.sh, armR: R.arm, forearmR: R.fore, handR: R.hand,
    thighL: L.th, shinL: L.shn, footL: L.ft,
    thighR: R.th, shinR: R.shn, footR: R.ft
  };

  /* ---- geometry ---- */
  const parts = {};

  // pelvis
  const pelvisGeo = cachedGeo('pelvis' + bKey, () => lathe([
    [0.01, P.pelvisH * 1.05], [P.torsoWaist * 0.92, P.pelvisH * 0.92],
    [P.torsoHip, P.pelvisH * 0.45], [P.torsoHip * 1.02, 0],
    [P.torsoHip * 0.94, -0.055 * P.h], [P.torsoHip * 0.55, -0.10 * P.h], [0.01, -0.115 * P.h]
  ], RAD, 0.78));
  parts.pelvis = attach(hips, pelvisGeo, legM, 0);

  // chest / torso — the heroic V-taper
  const torsoGeo = cachedGeo('torso' + bKey, () => lathe([
    [0.01, -0.075 * P.h], [P.torsoWaist * 0.9, -0.055 * P.h], [P.torsoWaist, 0.02 * P.h],
    [P.torsoWaist * 1.10, P.chestH * 0.30], [P.torsoTop * 0.93, P.chestH * 0.52],
    [P.torsoTop, P.chestH * 0.72], [P.torsoTop * 0.96, P.chestH * 0.88],
    [P.torsoTop * 0.70, P.chestH * 0.98], [0.01, P.chestH * 1.02]
  ], RAD, 0.70));
  parts.torso = attach(chest, torsoGeo, torsoM, 0);

  // deltoid caps hide the shoulder joint
  const deltGeo = cachedGeo('delt' + bKey + a.build, () =>
    new THREE.SphereGeometry(P.armR0 * 1.5, RAD, Math.max(6, RAD / 2)).scale(1, 1.05, 0.95));
  parts.deltL = attach(L.arm, deltGeo, armM, 0);
  parts.deltR = attach(R.arm, deltGeo, armM, 0);

  // arms
  const upGeo = cachedGeo('up' + bKey, () => tapered(P.armR0, P.armR1, P.upperArm, RAD));
  const foGeo = cachedGeo('fo' + bKey, () => tapered(P.armR1 * 1.04, P.armR2, P.foreArm, RAD));
  parts.armL = attach(L.arm, upGeo, armM);
  parts.armR = attach(R.arm, upGeo, armM);
  parts.foreL = attach(L.fore, foGeo, a.suit || !a.jacketOn ? armM : mat(a.jacket, { rough: 0.8 }));
  parts.foreR = attach(R.fore, foGeo, a.suit || !a.jacketOn ? armM : mat(a.jacket, { rough: 0.8 }));

  const handGeo = cachedGeo('hand' + bKey, () =>
    new THREE.SphereGeometry(P.armR2 * 1.28, RAD, 7).scale(0.85, 1.35, 0.72).translate(0, -P.armR2 * 1.1, 0));
  parts.handL = attach(L.hand, handGeo, handM);
  parts.handR = attach(R.hand, handGeo, handM);

  // legs
  const thGeo = cachedGeo('th' + bKey, () => tapered(P.legR0, P.legR1, P.thigh, RAD));
  const snGeo = cachedGeo('sn' + bKey, () => tapered(P.legR1 * 1.02, P.legR2, P.shin, RAD));
  parts.thighL = attach(L.th, thGeo, legM);
  parts.thighR = attach(R.th, thGeo, legM);
  parts.shinL = attach(L.shn, snGeo, shinM);
  parts.shinR = attach(R.shn, snGeo, shinM);

  const footGeo = cachedGeo('foot' + bKey, () => {
    const g = tapered(P.legR2 * 1.25, P.legR2 * 0.85, 0.235 * P.h, Math.max(8, RAD - 2));
    g.rotateX(-Math.PI / 2);           // point forward
    g.translate(0, -0.028 * P.h, 0.045 * P.h);
    g.scale(0.92, 0.72, 1);
    return g;
  });
  parts.footL = attach(L.ft, footGeo, footM);
  parts.footR = attach(R.ft, footGeo, footM);

  // neck + head
  parts.neck = attach(neck, cachedGeo('neck' + bKey, () =>
    tapered(P.headR * 0.52, P.headR * 0.46, -P.neckH * 1.35, RAD)), skinM);

  const headGeo = cachedGeo('head' + bKey, () => {
    const g = new THREE.SphereGeometry(P.headR, RAD + 4, RAD);
    g.scale(0.94, 1.14, 1.0);
    const pos = g.attributes.position;
    // gently square off the jaw and push the cranium back for a stylised skull
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      if (y < 0) pos.setZ(i, z + (-y / P.headR) * P.headR * 0.10);
      if (y < -P.headR * 0.4) pos.setX(i, pos.getX(i) * 0.90);
    }
    g.computeVertexNormals();
    return g.translate(0, P.headR * 0.86, 0);
  });
  parts.head = attach(head, headGeo, skinM);

  // eyes
  if (hi) {
    const eyeGeo = cachedGeo('eye' + bKey, () => new THREE.SphereGeometry(P.headR * 0.155, 8, 6));
    const eyeM = mat('#141821', { rough: 0.25 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeM);
      e.position.set(s * P.headR * 0.36, P.headR * 0.93, P.headR * 0.82);
      head.add(e);
    }
  }

  // hair
  if (a.hairStyle !== 'bald' && (a.mask === 'none' || a.mask === 'domino' || a.mask === 'visor')) {
    const hairGeo = cachedGeo('hair' + bKey + a.hairStyle, () => {
      const g = new THREE.SphereGeometry(P.headR * 1.045, RAD + 2, RAD,
        0, Math.PI * 2, 0, a.hairStyle === 'long' ? Math.PI * 0.72 : Math.PI * 0.52);
      g.scale(0.98, 1.16, 1.02);
      return g.translate(0, P.headR * 0.86, -P.headR * 0.03);
    });
    parts.hair = attach(head, hairGeo, hairM);
  }

  // masks
  if (a.mask === 'domino') {
    const g = cachedGeo('domino' + bKey, () => {
      const s = new THREE.SphereGeometry(P.headR * 1.035, 22, 14, Math.PI / 2 - 0.95, 1.9, 0.62, 0.52);
      return s.scale(0.96, 1.14, 1.02).translate(0, P.headR * 0.86, 0);
    });
    parts.mask = attach(head, g, mat(a.secondary, { rough: 0.4 }));
  } else if (a.mask === 'full') {
    const g = cachedGeo('fullmask' + bKey, () => {
      const s = new THREE.SphereGeometry(P.headR * 1.03, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.78);
      return s.scale(0.95, 1.15, 1.01).translate(0, P.headR * 0.86, 0);
    });
    parts.mask = attach(head, g, mat(a.primary, { rough: 0.45 }));
    const lens = cachedGeo('lens' + bKey, () => {
      const s = new THREE.SphereGeometry(P.headR * 1.06, 20, 10, Math.PI / 2 - 0.85, 1.7, 0.72, 0.30);
      return s.scale(0.96, 1.14, 1.03).translate(0, P.headR * 0.86, 0);
    });
    attach(head, lens, mat(a.accent, { rough: 0.15, metal: 0.5, emissive: a.accent, emissiveIntensity: a.glow * 1.4 }));
  } else if (a.mask === 'visor') {
    const g = cachedGeo('visor' + bKey, () => {
      const s = new THREE.SphereGeometry(P.headR * 1.07, 22, 8, Math.PI / 2 - 1.0, 2.0, 0.80, 0.22);
      return s.scale(0.97, 1.15, 1.04).translate(0, P.headR * 0.86, 0);
    });
    parts.mask = attach(head, g, mat(a.accent, { rough: 0.1, metal: 0.6, emissive: a.accent, emissiveIntensity: a.glow * 1.8 }));
  }

  if (a.glasses && a.mask === 'none') {
    const g = cachedGeo('glasses' + bKey, () => {
      const s = new THREE.SphereGeometry(P.headR * 1.04, 20, 8, Math.PI / 2 - 0.9, 1.8, 0.78, 0.20);
      return s.scale(0.97, 1.14, 1.03).translate(0, P.headR * 0.86, 0);
    });
    attach(head, g, mat('#101318', { rough: 0.2, metal: 0.4 }));
  }

  /* ---- suit dressing ---- */
  if (a.suit) {
    // chest emblem
    if (a.emblem) {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.085); sh.lineTo(0.062, 0.022); sh.lineTo(0.040, -0.085);
      sh.lineTo(0, -0.052); sh.lineTo(-0.040, -0.085); sh.lineTo(-0.062, 0.022); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.005, bevelSegments: 2 });
      const m = new THREE.Mesh(g, mat(a.emblemColor, { rough: 0.25, metal: 0.4, emissive: a.emblemColor, emissiveIntensity: a.glow * 0.7 }));
      m.position.set(0, P.chestH * 0.66, P.torsoTop * 0.70);
      m.scale.setScalar(P.h * 1.02);
      m.castShadow = true;
      chest.add(m);
      parts.emblem = m;
    }
    // belt
    const beltGeo = cachedGeo('belt' + bKey, () => {
      const g = new THREE.TorusGeometry(P.torsoWaist * 1.02, 0.028 * P.h, 8, RAD + 4);
      g.rotateX(Math.PI / 2); g.scale(1, 1, 0.74);
      return g;
    });
    const belt = attach(hips, beltGeo, accM, P.pelvisH * 0.72);
    parts.belt = belt;

    // shoulder / chest accent strip
    const stripGeo = cachedGeo('strip' + bKey, () => {
      const g = new THREE.TorusGeometry(P.torsoTop * 0.99, 0.017 * P.h, 6, RAD + 6, Math.PI);
      g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); g.scale(1, 1, 0.72);
      return g;
    });
    attach(chest, stripGeo, accM, P.chestH * 0.80);

    // gauntlet cuffs
    const cuffGeo = cachedGeo('cuff' + bKey, () => {
      const g = new THREE.TorusGeometry(P.armR2 * 1.22, 0.016 * P.h, 6, RAD + 2);
      g.rotateX(Math.PI / 2);
      return g;
    });
    attach(L.fore, cuffGeo, accM, -P.foreArm * 0.92);
    attach(R.fore, cuffGeo, accM, -P.foreArm * 0.92);

    // boot tops
    const bootGeo = cachedGeo('boot' + bKey, () => {
      const g = new THREE.TorusGeometry(P.legR1 * 1.12, 0.019 * P.h, 6, RAD + 2);
      g.rotateX(Math.PI / 2);
      return g;
    });
    attach(L.shn, bootGeo, accM, -P.shin * 0.42);
    attach(R.shn, bootGeo, accM, -P.shin * 0.42);
  }

  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });

  return { group, bones, parts, P, appearance: a, materials: { skinM, torsoM, legM, accM } };
}

/* ---------------- random NPC appearances ---------------- */

const SKINS = ['#f0c6a4', '#e0ac82', '#c98d63', '#a86c45', '#7d4c2d', '#5c3720', '#f7d7bb'];
const HAIRS = ['#20170f', '#3a2a1c', '#5c4023', '#8a6a3d', '#c8a45c', '#2a2a2e', '#6b3a2a', '#d8d5cf'];
const TOPS  = ['#3d4a63', '#7a3b4a', '#2e5a4c', '#6b5b3a', '#40405c', '#8a5a34', '#28323d', '#5c6470', '#9c4a3c'];
const PANTS = ['#22262f', '#2f3646', '#3a3128', '#1c1f26', '#454b58', '#2a3b4a'];
const JACK  = ['#8d5b3f', '#2c3540', '#553f5c', '#3f5548', '#6b2f38', '#1f2733'];

export function randomCivilian () {
  return {
    detail: 'low',
    build: rand(0.82, 1.16),
    height: rand(0.92, 1.07),
    skin: pick(SKINS), hair: pick(HAIRS),
    hairStyle: Math.random() < 0.12 ? 'bald' : (Math.random() < 0.3 ? 'long' : 'short'),
    top: pick(TOPS), bottom: pick(PANTS), shoes: '#1a1c22',
    jacket: pick(JACK), jacketOn: Math.random() < 0.45,
    glasses: Math.random() < 0.18
  };
}

const SUITS = ['#1f2733', '#23262e', '#2c3540', '#3a3a44', '#1a1d24', '#2f2a33'];

/** Office staff: a dark suit — jacket, matching trousers, black shoes, a few pairs of glasses. */
export function randomSuit () {
  const suit = pick(SUITS);
  return {
    ...randomCivilian(),
    top: suit, bottom: suit, jacket: suit, jacketOn: true, shoes: '#121316',
    hairStyle: Math.random() < 0.1 ? 'bald' : (Math.random() < 0.18 ? 'long' : 'short'),
    glasses: Math.random() < 0.35
  };
}

const GANG = [
  { name: 'Thug',      primary: '#2a2f3a', secondary: '#4a1f26', accent: '#ff5a3c' },
  { name: 'Enforcer',  primary: '#1d2b3a', secondary: '#26404f', accent: '#39e6ff' },
  { name: 'Syndicate', primary: '#2a1f38', secondary: '#3d2a52', accent: '#c65cff' },
  { name: 'Militia',   primary: '#2f3326', secondary: '#43482f', accent: '#c8e04a' }
];

export function randomEnemy (tier) {
  const g = GANG[Math.min(GANG.length - 1, tier)];
  return {
    detail: 'low',
    build: rand(1.0, 1.15) + tier * 0.07,
    height: rand(0.98, 1.06) + tier * 0.02,
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: 'short',
    suit: true,
    primary: g.primary, secondary: g.secondary, accent: g.accent,
    emblem: tier >= 2, emblemColor: g.accent,
    mask: tier >= 3 ? 'full' : (tier >= 1 ? 'visor' : 'none'),
    glow: 0.5 + tier * 0.35,
    gangName: g.name
  };
}

export function heroSuitAppearance (s) {
  return {
    detail: 'high', build: s.build, height: s.height,
    skin: s.skin, hair: '#2b2119', hairStyle: 'short',
    suit: true, primary: s.primary, secondary: s.secondary, accent: s.accent,
    emblem: s.emblem, emblemColor: s.emblemColor, mask: s.mask, glow: s.glow
  };
}

export function heroCivAppearance (c, build, height) {
  return {
    detail: 'high', build, height,
    skin: c.skin, hair: c.hair, hairStyle: 'short',
    top: c.shirt, bottom: c.pants, shoes: '#1a1c22',
    jacket: c.jacket, jacketOn: c.jacketOn, glasses: c.glasses
  };
}
