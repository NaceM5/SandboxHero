/* ------------------------------------------------------------------ *
 *  Hand-authored pose library.
 *
 *  Sign conventions (see Rig.js — every bone's geometry hangs down -Y):
 *    rotation.x  negative  -> limb swings FORWARD (+Z is the facing axis)
 *    shin.x      positive  -> knee bends (heel toward glute)
 *    forearm.x   negative  -> elbow bends (fist comes forward/up)
 *    foot.x      positive  -> toes point down
 *    arm.z       s*mag     -> arm lifts away from the body (s = +1 left)
 *
 *  Because the flight code pitches the whole body head-first, an arm at
 *  x ≈ -2.9 points along the body's +Y — i.e. straight out in front of
 *  the hero in world space. That's the classic fist-forward silhouette.
 *
 *  Special pose keys: _hipY (metres), _hipZ, _rx/_ry/_rz (root offset).
 * ------------------------------------------------------------------ */

const clip = (duration, loop, keys, opts = {}) => ({ duration, loop, keys, ...opts });
const K = (t, pose) => ({ t, pose });

const MIRROR_NEG = new Set(['y', 'z']);

export function mirrorPose (p) {
  const out = {};
  for (const k of Object.keys(p)) {
    if (k.startsWith('_')) {
      out[k] = (k === '_rz' || k === '_ry') ? -p[k] : p[k];
      continue;
    }
    const nk = k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k;
    out[nk] = [p[k][0], -p[k][1], -p[k][2]];
  }
  return out;
}
const mirrorKeys = keys => keys.map(k => K(k.t, mirrorPose(k.pose)));

/* ================================================================== *
 *  GROUND LOCOMOTION
 * ================================================================== */

const A = {};

A.idle = clip(5.2, true, [
  K(0.0, {
    chest: [0.01, 0.04, 0.01], head: [-0.02, -0.06, 0],
    armL: [-0.06, 0, 0.11], armR: [-0.04, 0, -0.09],
    forearmL: [-0.16, 0, 0.03], forearmR: [-0.13, 0, -0.03],
    thighL: [0, 0, 0.02], thighR: [0.02, 0, -0.03], shinL: [0.03, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0
  }),
  K(1.9, {
    chest: [0.03, -0.03, -0.02], head: [0.01, 0.07, 0.01],
    armL: [-0.02, 0, 0.09], armR: [-0.08, 0, -0.12],
    forearmL: [-0.12, 0, 0.02], forearmR: [-0.18, 0, -0.04],
    thighL: [0.02, 0, 0.03], thighR: [-0.01, 0, -0.02], shinL: [0.06, 0, 0], shinR: [0.02, 0, 0],
    _hipY: -0.012
  }),
  K(3.4, {
    chest: [0.02, 0.06, 0.02], head: [-0.04, -0.10, -0.01],
    armL: [-0.07, 0, 0.12], armR: [-0.03, 0, -0.08],
    forearmL: [-0.17, 0, 0.03], forearmR: [-0.11, 0, -0.02],
    thighL: [-0.01, 0, 0.02], thighR: [0.03, 0, -0.03], shinL: [0.02, 0, 0], shinR: [0.06, 0, 0],
    _hipY: -0.004
  }),
  K(5.2, {
    chest: [0.01, 0.04, 0.01], head: [-0.02, -0.06, 0],
    armL: [-0.06, 0, 0.11], armR: [-0.04, 0, -0.09],
    forearmL: [-0.16, 0, 0.03], forearmR: [-0.13, 0, -0.03],
    thighL: [0, 0, 0.02], thighR: [0.02, 0, -0.03], shinL: [0.03, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0
  })
]);

// Confident hero stance — chest out, fists loose, feet planted.
A.idleSuit = clip(4.4, true, [
  K(0.0, {
    chest: [-0.06, 0.02, 0], spine: [-0.02, 0, 0], head: [0.03, -0.03, 0],
    armL: [-0.05, 0, 0.18], armR: [-0.05, 0, -0.18],
    forearmL: [-0.22, 0, 0.05], forearmR: [-0.22, 0, -0.05],
    thighL: [0, 0, 0.06], thighR: [0, 0, -0.06], shinL: [0.04, 0, 0], shinR: [0.04, 0, 0],
    _hipY: 0
  }),
  K(2.2, {
    chest: [-0.09, -0.02, 0], spine: [-0.03, 0, 0], head: [0.05, 0.04, 0],
    armL: [-0.02, 0, 0.21], armR: [-0.02, 0, -0.21],
    forearmL: [-0.18, 0, 0.05], forearmR: [-0.18, 0, -0.05],
    thighL: [0, 0, 0.06], thighR: [0, 0, -0.06], shinL: [0.02, 0, 0], shinR: [0.02, 0, 0],
    _hipY: -0.018
  }),
  K(4.4, {
    chest: [-0.06, 0.02, 0], spine: [-0.02, 0, 0], head: [0.03, -0.03, 0],
    armL: [-0.05, 0, 0.18], armR: [-0.05, 0, -0.18],
    forearmL: [-0.22, 0, 0.05], forearmR: [-0.22, 0, -0.05],
    thighL: [0, 0, 0.06], thighR: [0, 0, -0.06], shinL: [0.04, 0, 0], shinR: [0.04, 0, 0],
    _hipY: 0
  })
]);

/* --- walk: contact / pass / contact / pass --- */
const walkContact = {
  chest: [0.02, 0.07, 0], head: [-0.01, -0.06, 0],
  thighL: [-0.40, 0, 0.02], shinL: [0.10, 0, 0], footL: [-0.10, 0, 0],
  thighR: [0.30, 0, -0.02], shinR: [0.26, 0, 0], footR: [0.30, 0, 0],
  armL: [0.30, 0, 0.10], forearmL: [-0.24, 0, 0.02],
  armR: [-0.34, 0, -0.10], forearmR: [-0.36, 0, -0.02],
  _hipY: -0.020
};
const walkPass = {
  chest: [0.02, 0, 0], head: [-0.01, 0, 0],
  thighL: [-0.06, 0, 0.02], shinL: [0.08, 0, 0], footL: [0.06, 0, 0],
  thighR: [0.02, 0, -0.02], shinR: [0.55, 0, 0], footR: [0.22, 0, 0],
  armL: [0.10, 0, 0.10], forearmL: [-0.20, 0, 0.02],
  armR: [-0.12, 0, -0.10], forearmR: [-0.26, 0, -0.02],
  _hipY: 0.014
};
A.walk = clip(1.06, true, [
  K(0.00, walkContact), K(0.265, walkPass),
  K(0.53, mirrorPose(walkContact)), K(0.795, mirrorPose(walkPass)),
  K(1.06, walkContact)
]);

const runContact = {
  chest: [-0.16, 0.10, 0], spine: [-0.07, 0, 0], head: [0.16, -0.08, 0],
  thighL: [-0.80, 0, 0.03], shinL: [0.34, 0, 0], footL: [-0.14, 0, 0],
  thighR: [0.62, 0, -0.03], shinR: [0.55, 0, 0], footR: [0.44, 0, 0],
  armL: [0.78, 0, 0.13], forearmL: [-1.28, 0, 0.05],
  armR: [-0.86, 0, -0.13], forearmR: [-1.42, 0, -0.05],
  _hipY: -0.055
};
const runPass = {
  chest: [-0.16, 0, 0], spine: [-0.07, 0, 0], head: [0.16, 0, 0],
  thighL: [-0.18, 0, 0.03], shinL: [0.22, 0, 0], footL: [0.10, 0, 0],
  thighR: [0.16, 0, -0.03], shinR: [1.65, 0, 0], footR: [0.35, 0, 0],
  armL: [0.28, 0, 0.13], forearmL: [-1.34, 0, 0.05],
  armR: [-0.34, 0, -0.13], forearmR: [-1.36, 0, -0.05],
  _hipY: 0.045
};
A.run = clip(0.68, true, [
  K(0.00, runContact), K(0.17, runPass),
  K(0.34, mirrorPose(runContact)), K(0.51, mirrorPose(runPass)),
  K(0.68, runContact)
]);

const sprintContact = {
  chest: [-0.34, 0.10, 0], spine: [-0.14, 0, 0], head: [0.36, -0.07, 0],
  thighL: [-1.05, 0, 0.03], shinL: [0.42, 0, 0], footL: [-0.20, 0, 0],
  thighR: [0.86, 0, -0.03], shinR: [0.80, 0, 0], footR: [0.55, 0, 0],
  armL: [1.05, 0, 0.16], forearmL: [-1.55, 0, 0.06],
  armR: [-1.18, 0, -0.16], forearmR: [-1.70, 0, -0.06],
  _hipY: -0.075
};
const sprintPass = {
  chest: [-0.34, 0, 0], spine: [-0.14, 0, 0], head: [0.36, 0, 0],
  thighL: [-0.24, 0, 0.03], shinL: [0.28, 0, 0], footL: [0.14, 0, 0],
  thighR: [0.22, 0, -0.03], shinR: [2.05, 0, 0], footR: [0.42, 0, 0],
  armL: [0.34, 0, 0.16], forearmL: [-1.60, 0, 0.06],
  armR: [-0.44, 0, -0.16], forearmR: [-1.62, 0, -0.06],
  _hipY: 0.060
};
A.sprint = clip(0.52, true, [
  K(0.00, sprintContact), K(0.13, sprintPass),
  K(0.26, mirrorPose(sprintContact)), K(0.39, mirrorPose(sprintPass)),
  K(0.52, sprintContact)
]);

A.crouch = clip(0.4, false, [
  K(0.0, {
    chest: [-0.30, 0, 0], head: [0.28, 0, 0],
    thighL: [-1.15, 0, 0.10], thighR: [-1.15, 0, -0.10],
    shinL: [1.55, 0, 0], shinR: [1.55, 0, 0], footL: [-0.45, 0, 0], footR: [-0.45, 0, 0],
    armL: [-0.50, 0, 0.16], armR: [-0.50, 0, -0.16],
    forearmL: [-0.70, 0, 0], forearmR: [-0.70, 0, 0],
    _hipY: -0.42
  })
]);

A.jumpUp = clip(0.42, false, [
  K(0.0, {
    chest: [-0.24, 0, 0], head: [0.20, 0, 0],
    thighL: [-0.95, 0, 0.10], thighR: [-0.95, 0, -0.10], shinL: [1.30, 0, 0], shinR: [1.30, 0, 0],
    armL: [0.60, 0, 0.20], armR: [0.60, 0, -0.20], forearmL: [-0.40, 0, 0], forearmR: [-0.40, 0, 0],
    _hipY: -0.30
  }),
  K(0.42, {
    chest: [-0.10, 0, 0], head: [0.06, 0, 0],
    thighL: [-0.28, 0, 0.06], thighR: [0.16, 0, -0.06], shinL: [0.62, 0, 0], shinR: [0.24, 0, 0],
    footL: [0.30, 0, 0], footR: [0.34, 0, 0],
    armL: [-1.55, 0, 0.30], armR: [-1.35, 0, -0.30], forearmL: [-0.55, 0, 0], forearmR: [-0.62, 0, 0],
    _hipY: 0.02
  })
]);

A.fall = clip(1.5, true, [
  K(0.0, {
    chest: [0.10, 0.03, 0], head: [-0.14, 0, 0],
    thighL: [-0.34, 0, 0.14], thighR: [-0.10, 0, -0.16], shinL: [0.70, 0, 0], shinR: [0.42, 0, 0],
    footL: [0.28, 0, 0], footR: [0.30, 0, 0],
    armL: [-1.95, 0, 0.55], armR: [-1.75, 0, -0.62], forearmL: [-0.85, 0, 0.1], forearmR: [-0.75, 0, -0.1]
  }),
  K(0.75, {
    chest: [0.13, -0.03, 0], head: [-0.10, 0, 0],
    thighL: [-0.24, 0, 0.16], thighR: [-0.20, 0, -0.14], shinL: [0.55, 0, 0], shinR: [0.60, 0, 0],
    footL: [0.30, 0, 0], footR: [0.26, 0, 0],
    armL: [-2.10, 0, 0.62], armR: [-1.90, 0, -0.54], forearmL: [-0.70, 0, 0.1], forearmR: [-0.90, 0, -0.1]
  }),
  K(1.5, {
    chest: [0.10, 0.03, 0], head: [-0.14, 0, 0],
    thighL: [-0.34, 0, 0.14], thighR: [-0.10, 0, -0.16], shinL: [0.70, 0, 0], shinR: [0.42, 0, 0],
    footL: [0.28, 0, 0], footR: [0.30, 0, 0],
    armL: [-1.95, 0, 0.55], armR: [-1.75, 0, -0.62], forearmL: [-0.85, 0, 0.1], forearmR: [-0.75, 0, -0.1]
  })
]);

// Free-fall tuck-and-roll. The somersault itself is the whole body turning
// over, driven by the player controller; this is just the ball it curls into
// and back out of.
const TUCK = {
  chest: [0.62, 0, 0], head: [0.55, 0, 0],
  thighL: [-2.25, 0, 0.16], thighR: [-2.25, 0, -0.16], shinL: [2.45, 0, 0], shinR: [2.45, 0, 0],
  footL: [0.45, 0, 0], footR: [0.45, 0, 0],
  armL: [-1.55, 0, 0.32], armR: [-1.55, 0, -0.32], forearmL: [-2.0, 0, 0.15], forearmR: [-2.0, 0, -0.15]
};
A.tuckRoll = clip(1.25, false, [
  K(0.0, A.fall.keys[0].pose),
  K(0.24, TUCK),
  K(0.92, TUCK),
  K(1.25, A.fall.keys[0].pose)
]);

A.land = clip(0.46, false, [
  K(0.0, {
    chest: [-0.34, 0, 0], head: [0.30, 0, 0],
    thighL: [-1.05, 0, 0.12], thighR: [-1.00, 0, -0.12], shinL: [1.45, 0, 0], shinR: [1.40, 0, 0],
    footL: [-0.38, 0, 0], footR: [-0.36, 0, 0],
    armL: [-0.70, 0, 0.34], armR: [-0.66, 0, -0.34], forearmL: [-0.95, 0, 0], forearmR: [-0.90, 0, 0],
    _hipY: -0.36
  }),
  K(0.46, {
    chest: [-0.04, 0, 0], head: [0.02, 0, 0],
    thighL: [0, 0, 0.04], thighR: [0, 0, -0.04], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    armL: [-0.06, 0, 0.14], armR: [-0.06, 0, -0.14], forearmL: [-0.20, 0, 0], forearmR: [-0.20, 0, 0],
    _hipY: 0
  })
]);

/**
 * Re-forming out of a teleport: the body arrives folded in on itself, snaps
 * open through an over-extended flare, then settles. Scaling the whole rig up
 * from nothing on its own reads as a pop; this gives the arrival a shape.
 */
A.bamfIn = clip(0.5, false, [
  K(0.0, {
    chest: [0.62, 0.30, 0], spine: [0.34, 0.18, 0], head: [-0.55, -0.26, 0],
    armL: [1.55, 0, 1.30], armR: [1.48, 0, -1.34],
    forearmL: [-2.10, 0, 0], forearmR: [-2.05, 0, 0],
    thighL: [-1.62, 0, 0.30], thighR: [-1.55, 0, -0.30],
    shinL: [2.05, 0, 0], shinR: [2.00, 0, 0],
    footL: [-0.30, 0, 0], footR: [-0.28, 0, 0],
    _hipY: -0.52
  }),
  K(0.20, {
    chest: [-0.30, -0.16, 0], spine: [-0.16, -0.10, 0], head: [0.26, 0.14, 0],
    armL: [-0.55, 0, 1.14], armR: [-0.50, 0, -1.18],
    forearmL: [-0.16, 0, 0], forearmR: [-0.14, 0, 0],
    thighL: [-0.30, 0, 0.22], thighR: [-0.26, 0, -0.22],
    shinL: [0.42, 0, 0], shinR: [0.40, 0, 0],
    footL: [-0.10, 0, 0], footR: [-0.09, 0, 0],
    _hipY: 0.10
  }),
  K(0.5, {
    chest: [-0.04, 0, 0], spine: [0, 0, 0], head: [0.02, 0, 0],
    armL: [-0.08, 0, 0.16], armR: [-0.08, 0, -0.16],
    forearmL: [-0.22, 0, 0], forearmR: [-0.22, 0, 0],
    thighL: [0, 0, 0.04], thighR: [0, 0, -0.04],
    shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    footL: [0, 0, 0], footR: [0, 0, 0],
    _hipY: 0
  })
]);

// The three-point superhero landing.
A.heroLand = clip(1.05, false, [
  K(0.0, {
    chest: [-0.55, 0.20, 0], spine: [-0.15, 0, 0], head: [0.45, -0.20, 0],
    thighL: [-1.55, 0, 0.22], thighR: [-0.30, 0, -0.30], shinL: [1.85, 0, 0], shinR: [1.30, 0, 0],
    footL: [-0.50, 0, 0], footR: [0.35, 0, 0],
    armL: [-1.00, 0, 0.10], forearmL: [-0.35, 0, 0],
    armR: [0.55, 0, -0.85], forearmR: [-0.55, 0, 0],
    _hipY: -0.50, _ry: 0.22
  }),
  K(0.30, {
    chest: [-0.52, 0.20, 0], spine: [-0.14, 0, 0], head: [0.42, -0.20, 0],
    thighL: [-1.50, 0, 0.22], thighR: [-0.28, 0, -0.30], shinL: [1.80, 0, 0], shinR: [1.28, 0, 0],
    footL: [-0.48, 0, 0], footR: [0.34, 0, 0],
    armL: [-0.98, 0, 0.10], forearmL: [-0.34, 0, 0],
    armR: [0.52, 0, -0.85], forearmR: [-0.52, 0, 0],
    _hipY: -0.48, _ry: 0.22
  }),
  K(1.05, {
    chest: [-0.06, 0, 0], head: [0.03, 0, 0],
    thighL: [0, 0, 0.06], thighR: [0, 0, -0.06], shinL: [0.04, 0, 0], shinR: [0.04, 0, 0],
    armL: [-0.05, 0, 0.18], armR: [-0.05, 0, -0.18], forearmL: [-0.22, 0, 0], forearmR: [-0.22, 0, 0],
    _hipY: 0, _ry: 0
  })
]);

/* ================================================================== *
 *  FLIGHT  — the body pitch is driven by the flight controller;
 *  these clips only shape the limbs.
 * ================================================================== */

A.takeoff = clip(0.55, false, [
  K(0.0, {
    chest: [-0.40, 0, 0], head: [0.34, 0, 0],
    thighL: [-1.15, 0, 0.12], thighR: [-1.10, 0, -0.12], shinL: [1.60, 0, 0], shinR: [1.55, 0, 0],
    armL: [0.50, 0, 0.22], armR: [0.50, 0, -0.22], forearmL: [-0.60, 0, 0], forearmR: [-0.60, 0, 0],
    _hipY: -0.42
  }),
  K(0.55, {
    chest: [-0.14, 0, 0], head: [0.10, 0, 0],
    thighL: [0.10, 0, 0.04], thighR: [0.12, 0, -0.04], shinL: [0.16, 0, 0], shinR: [0.14, 0, 0],
    footL: [0.55, 0, 0], footR: [0.55, 0, 0],
    armL: [-2.90, 0, 0.12], armR: [-2.90, 0, -0.12], forearmL: [-0.10, 0, 0], forearmR: [-0.10, 0, 0],
    _hipY: 0.05
  })
]);

// Upright hover — cape drifting, arms relaxed and slightly out.
A.hover = clip(3.6, true, [
  K(0.0, {
    chest: [-0.08, 0.03, 0], spine: [-0.03, 0, 0], head: [0.06, -0.04, 0],
    armL: [-0.12, 0, 0.34], armR: [-0.12, 0, -0.34],
    forearmL: [-0.30, 0, 0.06], forearmR: [-0.30, 0, -0.06],
    thighL: [0.06, 0, 0.05], thighR: [0.10, 0, -0.05],
    shinL: [0.22, 0, 0], shinR: [0.14, 0, 0], footL: [0.45, 0, 0], footR: [0.42, 0, 0],
    _hipY: 0
  }),
  K(1.8, {
    chest: [-0.11, -0.03, 0], spine: [-0.04, 0, 0], head: [0.08, 0.05, 0],
    armL: [-0.06, 0, 0.40], armR: [-0.06, 0, -0.40],
    forearmL: [-0.24, 0, 0.06], forearmR: [-0.24, 0, -0.06],
    thighL: [0.11, 0, 0.05], thighR: [0.05, 0, -0.05],
    shinL: [0.13, 0, 0], shinR: [0.24, 0, 0], footL: [0.50, 0, 0], footR: [0.46, 0, 0],
    _hipY: 0.03
  }),
  K(3.6, {
    chest: [-0.08, 0.03, 0], spine: [-0.03, 0, 0], head: [0.06, -0.04, 0],
    armL: [-0.12, 0, 0.34], armR: [-0.12, 0, -0.34],
    forearmL: [-0.30, 0, 0.06], forearmR: [-0.30, 0, -0.06],
    thighL: [0.06, 0, 0.05], thighR: [0.10, 0, -0.05],
    shinL: [0.22, 0, 0], shinR: [0.14, 0, 0], footL: [0.45, 0, 0], footR: [0.42, 0, 0],
    _hipY: 0
  })
]);

// Cruise — one fist forward, the other arm trailing at the hip.
A.cruise = clip(4.0, true, [
  K(0.0, {
    chest: [-0.10, 0.02, 0.02], spine: [-0.05, 0, 0], head: [-0.34, -0.03, 0],
    armR: [-2.86, 0, -0.13], forearmR: [-0.08, 0, 0],
    armL: [0.30, 0, 0.20], forearmL: [-0.18, 0, 0.04],
    thighL: [0.06, 0, 0.03], thighR: [0.03, 0, -0.03],
    shinL: [0.06, 0, 0], shinR: [0.10, 0, 0], footL: [0.72, 0, 0], footR: [0.70, 0, 0]
  }),
  K(2.0, {
    chest: [-0.13, -0.02, -0.02], spine: [-0.06, 0, 0], head: [-0.30, 0.03, 0],
    armR: [-2.94, 0, -0.10], forearmR: [-0.05, 0, 0],
    armL: [0.24, 0, 0.24], forearmL: [-0.22, 0, 0.04],
    thighL: [0.03, 0, 0.03], thighR: [0.07, 0, -0.03],
    shinL: [0.11, 0, 0], shinR: [0.05, 0, 0], footL: [0.68, 0, 0], footR: [0.74, 0, 0]
  }),
  K(4.0, {
    chest: [-0.10, 0.02, 0.02], spine: [-0.05, 0, 0], head: [-0.34, -0.03, 0],
    armR: [-2.86, 0, -0.13], forearmR: [-0.08, 0, 0],
    armL: [0.30, 0, 0.20], forearmL: [-0.18, 0, 0.04],
    thighL: [0.06, 0, 0.03], thighR: [0.03, 0, -0.03],
    shinL: [0.06, 0, 0], shinR: [0.10, 0, 0], footL: [0.72, 0, 0], footR: [0.70, 0, 0]
  })
]);

// Afterburn — both fists forward, body ruler-straight, toes pointed hard.
A.boost = clip(2.4, true, [
  K(0.0, {
    chest: [-0.14, 0, 0], spine: [-0.07, 0, 0], head: [-0.30, 0, 0],
    armL: [-2.98, 0, 0.07], armR: [-2.98, 0, -0.07],
    forearmL: [-0.04, 0, 0], forearmR: [-0.04, 0, 0],
    thighL: [0.02, 0, 0.015], thighR: [0.02, 0, -0.015],
    shinL: [0.02, 0, 0], shinR: [0.02, 0, 0], footL: [0.88, 0, 0], footR: [0.88, 0, 0]
  }),
  K(1.2, {
    chest: [-0.16, 0, 0], spine: [-0.08, 0, 0], head: [-0.27, 0, 0],
    armL: [-3.02, 0, 0.05], armR: [-3.02, 0, -0.05],
    forearmL: [-0.02, 0, 0], forearmR: [-0.02, 0, 0],
    thighL: [0.01, 0, 0.015], thighR: [0.01, 0, -0.015],
    shinL: [0.04, 0, 0], shinR: [0.04, 0, 0], footL: [0.92, 0, 0], footR: [0.92, 0, 0]
  }),
  K(2.4, {
    chest: [-0.14, 0, 0], spine: [-0.07, 0, 0], head: [-0.30, 0, 0],
    armL: [-2.98, 0, 0.07], armR: [-2.98, 0, -0.07],
    forearmL: [-0.04, 0, 0], forearmR: [-0.04, 0, 0],
    thighL: [0.02, 0, 0.015], thighR: [0.02, 0, -0.015],
    shinL: [0.02, 0, 0], shinR: [0.02, 0, 0], footL: [0.88, 0, 0], footR: [0.88, 0, 0]
  })
]);

// Rising vertically — one arm punched skyward.
A.flyUp = clip(2.6, true, [
  K(0.0, {
    chest: [-0.12, 0.04, 0], head: [0.02, -0.05, 0],
    armR: [-2.95, 0, -0.10], forearmR: [-0.06, 0, 0],
    armL: [0.42, 0, 0.26], forearmL: [-0.24, 0, 0.05],
    thighL: [0.10, 0, 0.04], thighR: [0.14, 0, -0.04],
    shinL: [0.16, 0, 0], shinR: [0.10, 0, 0], footL: [0.62, 0, 0], footR: [0.60, 0, 0]
  }),
  K(1.3, {
    chest: [-0.15, -0.04, 0], head: [0.04, 0.05, 0],
    armR: [-3.02, 0, -0.07], forearmR: [-0.03, 0, 0],
    armL: [0.36, 0, 0.30], forearmL: [-0.28, 0, 0.05],
    thighL: [0.14, 0, 0.04], thighR: [0.09, 0, -0.04],
    shinL: [0.10, 0, 0], shinR: [0.17, 0, 0], footL: [0.66, 0, 0], footR: [0.64, 0, 0]
  }),
  K(2.6, {
    chest: [-0.12, 0.04, 0], head: [0.02, -0.05, 0],
    armR: [-2.95, 0, -0.10], forearmR: [-0.06, 0, 0],
    armL: [0.42, 0, 0.26], forearmL: [-0.24, 0, 0.05],
    thighL: [0.10, 0, 0.04], thighR: [0.14, 0, -0.04],
    shinL: [0.16, 0, 0], shinR: [0.10, 0, 0], footL: [0.62, 0, 0], footR: [0.60, 0, 0]
  })
]);

// Power dive — arms swept back along the body like a stooping falcon.
A.dive = clip(2.0, true, [
  K(0.0, {
    chest: [0.10, 0, 0], head: [-0.42, 0, 0],
    armL: [0.34, 0, 0.10], armR: [0.34, 0, -0.10],
    forearmL: [-0.12, 0, 0], forearmR: [-0.12, 0, 0],
    thighL: [0.02, 0, 0.015], thighR: [0.02, 0, -0.015],
    shinL: [0.03, 0, 0], shinR: [0.03, 0, 0], footL: [0.90, 0, 0], footR: [0.90, 0, 0]
  }),
  K(1.0, {
    chest: [0.12, 0, 0], head: [-0.40, 0, 0],
    armL: [0.40, 0, 0.08], armR: [0.40, 0, -0.08],
    forearmL: [-0.08, 0, 0], forearmR: [-0.08, 0, 0],
    thighL: [0.01, 0, 0.015], thighR: [0.01, 0, -0.015],
    shinL: [0.05, 0, 0], shinR: [0.05, 0, 0], footL: [0.94, 0, 0], footR: [0.94, 0, 0]
  }),
  K(2.0, {
    chest: [0.10, 0, 0], head: [-0.42, 0, 0],
    armL: [0.34, 0, 0.10], armR: [0.34, 0, -0.10],
    forearmL: [-0.12, 0, 0], forearmR: [-0.12, 0, 0],
    thighL: [0.02, 0, 0.015], thighR: [0.02, 0, -0.015],
    shinL: [0.03, 0, 0], shinR: [0.03, 0, 0], footL: [0.90, 0, 0], footR: [0.90, 0, 0]
  })
]);

/* ================================================================== *
 *  COMBAT
 * ================================================================== */

A.punchR = clip(0.44, false, [
  K(0.00, {
    chest: [0, 0.34, 0], spine: [0, 0.12, 0], head: [0, -0.20, 0],
    armR: [0.55, 0, -0.30], forearmR: [-1.85, 0, 0],
    armL: [-0.60, 0, 0.20], forearmL: [-1.30, 0, 0],
    thighL: [-0.14, 0, 0.06], thighR: [0.10, 0, -0.06], shinL: [0.16, 0, 0], shinR: [0.14, 0, 0],
    _hipY: -0.05
  }),
  K(0.13, {
    chest: [-0.05, -0.42, 0], spine: [-0.03, -0.18, 0], head: [0.02, 0.26, 0],
    armR: [-1.62, 0, -0.10], forearmR: [-0.05, 0, 0],
    armL: [0.45, 0, 0.26], forearmL: [-1.55, 0, 0],
    thighL: [-0.20, 0, 0.06], thighR: [0.16, 0, -0.06], shinL: [0.22, 0, 0], shinR: [0.18, 0, 0],
    _hipY: -0.03, _hipZ: 0.10
  }),
  K(0.44, {
    chest: [-0.04, 0.06, 0], head: [0.02, -0.04, 0],
    armR: [-0.10, 0, -0.20], forearmR: [-0.45, 0, 0],
    armL: [-0.10, 0, 0.20], forearmL: [-0.45, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0, _hipZ: 0
  })
], { hitAt: 0.13 });

A.punchL = clip(0.44, false, mirrorKeys(A.punchR.keys), { hitAt: 0.13 });

A.uppercut = clip(0.60, false, [
  K(0.00, {
    chest: [0.20, 0.26, 0], spine: [0.10, 0.10, 0], head: [-0.16, -0.16, 0],
    armR: [0.85, 0, -0.24], forearmR: [-1.55, 0, 0],
    armL: [-0.35, 0, 0.24], forearmL: [-1.10, 0, 0],
    thighL: [-0.30, 0, 0.08], thighR: [0.10, 0, -0.08], shinL: [0.55, 0, 0], shinR: [0.20, 0, 0],
    _hipY: -0.20
  }),
  K(0.20, {
    chest: [-0.30, -0.24, 0], spine: [-0.14, -0.10, 0], head: [0.30, 0.16, 0],
    armR: [-2.70, 0, -0.22], forearmR: [-0.55, 0, 0],
    armL: [0.30, 0, 0.30], forearmL: [-1.40, 0, 0],
    thighL: [-0.10, 0, 0.05], thighR: [0.06, 0, -0.05], shinL: [0.10, 0, 0], shinR: [0.08, 0, 0],
    _hipY: 0.14
  }),
  K(0.60, {
    chest: [-0.04, 0.04, 0], head: [0.02, -0.03, 0],
    armR: [-0.10, 0, -0.20], forearmR: [-0.45, 0, 0],
    armL: [-0.10, 0, 0.20], forearmL: [-0.45, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0
  })
], { hitAt: 0.20 });

// Ground pound / shockwave slam.
A.slam = clip(0.85, false, [
  K(0.00, {
    chest: [-0.45, 0, 0], spine: [-0.20, 0, 0], head: [0.30, 0, 0],
    armL: [-2.75, 0, 0.45], armR: [-2.75, 0, -0.45],
    forearmL: [-0.35, 0, 0], forearmR: [-0.35, 0, 0],
    thighL: [-0.20, 0, 0.10], thighR: [-0.20, 0, -0.10], shinL: [0.30, 0, 0], shinR: [0.30, 0, 0],
    _hipY: 0.10
  }),
  K(0.26, {
    chest: [0.62, 0, 0], spine: [0.26, 0, 0], head: [-0.35, 0, 0],
    armL: [-0.30, 0, 0.18], armR: [-0.30, 0, -0.18],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    thighL: [-1.30, 0, 0.16], thighR: [-1.25, 0, -0.16], shinL: [1.65, 0, 0], shinR: [1.60, 0, 0],
    footL: [-0.40, 0, 0], footR: [-0.40, 0, 0],
    _hipY: -0.52
  }),
  K(0.85, {
    chest: [-0.05, 0, 0], head: [0.03, 0, 0],
    armL: [-0.08, 0, 0.18], armR: [-0.08, 0, -0.18],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0
  })
], { hitAt: 0.26 });

// Heat vision — head tilts back, fists clench, chest thrown open.
A.heatVision = clip(0.9, true, [
  K(0.0, {
    chest: [-0.24, 0, 0], spine: [-0.10, 0, 0], head: [-0.14, 0, 0],
    armL: [0.24, 0, 0.30], armR: [0.24, 0, -0.30],
    forearmL: [-0.70, 0, 0.10], forearmR: [-0.70, 0, -0.10],
    thighL: [0.02, 0, 0.07], thighR: [0.02, 0, -0.07], shinL: [0.04, 0, 0], shinR: [0.04, 0, 0]
  }),
  K(0.45, {
    chest: [-0.28, 0, 0], spine: [-0.12, 0, 0], head: [-0.17, 0, 0],
    armL: [0.30, 0, 0.35], armR: [0.30, 0, -0.35],
    forearmL: [-0.78, 0, 0.10], forearmR: [-0.78, 0, -0.10],
    thighL: [0.02, 0, 0.07], thighR: [0.02, 0, -0.07], shinL: [0.04, 0, 0], shinR: [0.04, 0, 0]
  }),
  K(0.9, {
    chest: [-0.24, 0, 0], spine: [-0.10, 0, 0], head: [-0.14, 0, 0],
    armL: [0.24, 0, 0.30], armR: [0.24, 0, -0.30],
    forearmL: [-0.70, 0, 0.10], forearmR: [-0.70, 0, -0.10],
    thighL: [0.02, 0, 0.07], thighR: [0.02, 0, -0.07], shinL: [0.04, 0, 0], shinR: [0.04, 0, 0]
  })
]);

// Two-handed beam — palms pressed forward, braced stance.
A.beamCast = clip(1.0, true, [
  K(0.0, {
    chest: [-0.10, 0, 0], spine: [-0.04, 0, 0], head: [0.06, 0, 0],
    armL: [-1.42, 0, 0.22], armR: [-1.42, 0, -0.22],
    forearmL: [-0.30, 0, 0.06], forearmR: [-0.30, 0, -0.06],
    thighL: [-0.32, 0, 0.10], thighR: [0.26, 0, -0.10], shinL: [0.45, 0, 0], shinR: [0.30, 0, 0],
    _hipY: -0.10
  }),
  K(0.5, {
    chest: [-0.13, 0, 0], spine: [-0.05, 0, 0], head: [0.08, 0, 0],
    armL: [-1.50, 0, 0.19], armR: [-1.50, 0, -0.19],
    forearmL: [-0.24, 0, 0.06], forearmR: [-0.24, 0, -0.06],
    thighL: [-0.34, 0, 0.10], thighR: [0.28, 0, -0.10], shinL: [0.47, 0, 0], shinR: [0.32, 0, 0],
    _hipY: -0.12
  }),
  K(1.0, {
    chest: [-0.10, 0, 0], spine: [-0.04, 0, 0], head: [0.06, 0, 0],
    armL: [-1.42, 0, 0.22], armR: [-1.42, 0, -0.22],
    forearmL: [-0.30, 0, 0.06], forearmR: [-0.30, 0, -0.06],
    thighL: [-0.32, 0, 0.10], thighR: [0.26, 0, -0.10], shinL: [0.45, 0, 0], shinR: [0.30, 0, 0],
    _hipY: -0.10
  })
]);

// Over-the-shoulder projectile throw.
A.throwR = clip(0.50, false, [
  K(0.00, {
    chest: [0, 0.40, 0], spine: [0, 0.16, 0], head: [0, -0.22, 0],
    armR: [-2.30, 0, -0.55], forearmR: [-1.60, 0, 0],
    armL: [-1.10, 0, 0.40], forearmL: [-0.70, 0, 0],
    thighL: [-0.18, 0, 0.07], thighR: [0.12, 0, -0.07], shinL: [0.22, 0, 0], shinR: [0.16, 0, 0]
  }),
  K(0.17, {
    chest: [-0.10, -0.44, 0], spine: [-0.04, -0.18, 0], head: [0.05, 0.26, 0],
    armR: [-1.75, 0, -0.16], forearmR: [-0.12, 0, 0],
    armL: [0.40, 0, 0.30], forearmL: [-1.30, 0, 0],
    thighL: [-0.26, 0, 0.07], thighR: [0.20, 0, -0.07], shinL: [0.28, 0, 0], shinR: [0.20, 0, 0]
  }),
  K(0.50, {
    chest: [-0.04, 0.05, 0], head: [0.02, -0.03, 0],
    armL: [-0.10, 0, 0.20], armR: [-0.10, 0, -0.20],
    forearmL: [-0.45, 0, 0], forearmR: [-0.45, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0]
  })
], { hitAt: 0.17 });

// Telekinetic grip — one hand open and clawed, body coiled.
/**
 * Hoisting something over your head — both arms straight up, weight braced back
 * through the hips. Loops with a small strain wobble so it doesn't read as a
 * frozen pose while you're carrying a car around.
 */
A.carryOverhead = clip(1.6, true, [
  K(0.0, {
    chest: [-0.20, 0, 0], spine: [-0.10, 0, 0], head: [0.20, 0, 0],
    armL: [-2.70, 0, 0.34], armR: [-2.70, 0, -0.34],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    handL: [-0.40, 0, 0], handR: [-0.40, 0, 0],
    thighL: [-0.14, 0, 0.16], thighR: [-0.12, 0, -0.16],
    shinL: [0.26, 0, 0], shinR: [0.24, 0, 0],
    _hipY: -0.10
  }),
  K(0.8, {
    chest: [-0.25, 0.03, 0], spine: [-0.13, 0.02, 0], head: [0.24, -0.02, 0],
    armL: [-2.78, 0, 0.30], armR: [-2.76, 0, -0.38],
    forearmL: [-0.24, 0, 0], forearmR: [-0.26, 0, 0],
    handL: [-0.44, 0, 0], handR: [-0.44, 0, 0],
    thighL: [-0.17, 0, 0.16], thighR: [-0.10, 0, -0.16],
    shinL: [0.30, 0, 0], shinR: [0.21, 0, 0],
    _hipY: -0.13
  }),
  K(1.6, {
    chest: [-0.20, 0, 0], spine: [-0.10, 0, 0], head: [0.20, 0, 0],
    armL: [-2.70, 0, 0.34], armR: [-2.70, 0, -0.34],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    handL: [-0.40, 0, 0], handR: [-0.40, 0, 0],
    thighL: [-0.14, 0, 0.16], thighR: [-0.12, 0, -0.16],
    shinL: [0.26, 0, 0], shinR: [0.24, 0, 0],
    _hipY: -0.10
  })
]);

A.tkGrab = clip(0.9, true, [
  K(0.0, {
    chest: [-0.06, -0.10, 0], spine: [-0.02, -0.04, 0], head: [0.04, 0.08, 0],
    armR: [-1.55, 0, -0.30], forearmR: [-0.22, 0, -0.08], handR: [-0.30, 0, 0],
    armL: [-0.45, 0, 0.42], forearmL: [-1.15, 0, 0.12],
    thighL: [-0.20, 0, 0.10], thighR: [0.16, 0, -0.10], shinL: [0.30, 0, 0], shinR: [0.22, 0, 0],
    _hipY: -0.06
  }),
  K(0.45, {
    chest: [-0.09, -0.12, 0], spine: [-0.03, -0.05, 0], head: [0.06, 0.09, 0],
    armR: [-1.63, 0, -0.26], forearmR: [-0.16, 0, -0.08], handR: [-0.38, 0, 0],
    armL: [-0.40, 0, 0.46], forearmL: [-1.22, 0, 0.12],
    thighL: [-0.22, 0, 0.10], thighR: [0.18, 0, -0.10], shinL: [0.32, 0, 0], shinR: [0.24, 0, 0],
    _hipY: -0.08
  }),
  K(0.9, {
    chest: [-0.06, -0.10, 0], spine: [-0.02, -0.04, 0], head: [0.04, 0.08, 0],
    armR: [-1.55, 0, -0.30], forearmR: [-0.22, 0, -0.08], handR: [-0.30, 0, 0],
    armL: [-0.45, 0, 0.42], forearmL: [-1.15, 0, 0.12],
    thighL: [-0.20, 0, 0.10], thighR: [0.16, 0, -0.10], shinL: [0.30, 0, 0], shinR: [0.22, 0, 0],
    _hipY: -0.06
  })
]);

// Both palms thrust out — the force push.
A.tkPush = clip(0.55, false, [
  K(0.00, {
    chest: [0.28, 0, 0], spine: [0.12, 0, 0], head: [-0.18, 0, 0],
    armL: [-0.75, 0, 0.30], armR: [-0.75, 0, -0.30],
    forearmL: [-1.90, 0, 0.10], forearmR: [-1.90, 0, -0.10],
    thighL: [-0.24, 0, 0.10], thighR: [0.18, 0, -0.10], shinL: [0.36, 0, 0], shinR: [0.26, 0, 0],
    _hipY: -0.12
  }),
  K(0.14, {
    chest: [-0.22, 0, 0], spine: [-0.10, 0, 0], head: [0.16, 0, 0],
    armL: [-1.52, 0, 0.20], armR: [-1.52, 0, -0.20],
    forearmL: [-0.14, 0, 0.06], forearmR: [-0.14, 0, -0.06],
    thighL: [-0.34, 0, 0.10], thighR: [0.28, 0, -0.10], shinL: [0.42, 0, 0], shinR: [0.32, 0, 0],
    _hipY: -0.14, _hipZ: 0.08
  }),
  K(0.55, {
    chest: [-0.05, 0, 0], head: [0.03, 0, 0],
    armL: [-0.10, 0, 0.20], armR: [-0.10, 0, -0.20],
    forearmL: [-0.45, 0, 0], forearmR: [-0.45, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0, _hipZ: 0
  })
], { hitAt: 0.14 });

A.block = clip(0.25, false, [
  K(0.0, {
    chest: [0.18, 0, 0], head: [-0.10, 0, 0],
    armL: [-1.15, 0, 0.30], armR: [-1.15, 0, -0.30],
    forearmL: [-2.10, 0, 0.20], forearmR: [-2.10, 0, -0.20],
    thighL: [-0.22, 0, 0.10], thighR: [0.16, 0, -0.10], shinL: [0.34, 0, 0], shinR: [0.24, 0, 0],
    _hipY: -0.10
  })
]);

A.hitReact = clip(0.36, false, [
  K(0.00, {
    chest: [0.34, 0.14, 0], spine: [0.16, 0.06, 0], head: [-0.30, -0.12, 0],
    armL: [0.42, 0, 0.44], armR: [0.38, 0, -0.40],
    forearmL: [-0.60, 0, 0], forearmR: [-0.55, 0, 0],
    thighL: [0.16, 0, 0.08], thighR: [-0.18, 0, -0.08], shinL: [0.24, 0, 0], shinR: [0.30, 0, 0],
    _hipY: -0.06, _hipZ: -0.08
  }),
  K(0.36, {
    chest: [-0.04, 0, 0], head: [0.02, 0, 0],
    armL: [-0.08, 0, 0.18], armR: [-0.08, 0, -0.18],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0, _hipZ: 0
  })
]);

A.knockdown = clip(1.1, false, [
  K(0.0, {
    chest: [0.40, 0.2, 0], head: [-0.35, 0, 0],
    armL: [0.60, 0, 0.60], armR: [0.55, 0, -0.55], forearmL: [-0.50, 0, 0], forearmR: [-0.50, 0, 0],
    thighL: [0.20, 0, 0.10], thighR: [0.10, 0, -0.10], shinL: [0.40, 0, 0], shinR: [0.50, 0, 0],
    _hipY: -0.10, _rx: -0.4
  }),
  K(0.45, {
    chest: [0.20, 0.1, 0], head: [-0.20, 0, 0],
    armL: [0.80, 0, 0.70], armR: [0.75, 0, -0.65], forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    thighL: [-0.60, 0, 0.14], thighR: [-0.50, 0, -0.14], shinL: [0.90, 0, 0], shinR: [1.00, 0, 0],
    _hipY: -0.70, _rx: -1.35
  }),
  K(1.1, {
    chest: [0.10, 0, 0], head: [-0.10, 0, 0],
    armL: [0.90, 0, 0.85], armR: [0.85, 0, -0.80], forearmL: [-0.20, 0, 0], forearmR: [-0.20, 0, 0],
    thighL: [-0.30, 0, 0.16], thighR: [-0.25, 0, -0.16], shinL: [0.55, 0, 0], shinR: [0.62, 0, 0],
    _hipY: -0.80, _rx: -1.52
  })
]);

A.getUp = clip(0.9, false, [
  K(0.0, A.knockdown.keys[2].pose),
  K(0.55, {
    chest: [-0.40, 0, 0], head: [0.34, 0, 0],
    armL: [-0.90, 0, 0.35], armR: [-0.85, 0, -0.35], forearmL: [-1.10, 0, 0], forearmR: [-1.05, 0, 0],
    thighL: [-1.30, 0, 0.16], thighR: [-0.90, 0, -0.16], shinL: [1.70, 0, 0], shinR: [1.40, 0, 0],
    _hipY: -0.48, _rx: -0.35
  }),
  K(0.9, {
    chest: [-0.05, 0, 0], head: [0.03, 0, 0],
    armL: [-0.08, 0, 0.18], armR: [-0.08, 0, -0.18], forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0, _rx: 0
  })
]);

/* ================================================================== *
 *  NPC / ENEMY
 * ================================================================== */

A.panicRun = clip(0.56, true, [
  K(0.00, {
    chest: [-0.20, 0.12, 0], head: [0.30, -0.10, 0],
    thighL: [-0.90, 0, 0.04], shinL: [0.40, 0, 0], footL: [-0.16, 0, 0],
    thighR: [0.70, 0, -0.04], shinR: [0.62, 0, 0], footR: [0.48, 0, 0],
    armL: [-2.30, 0, 0.55], forearmL: [-1.10, 0, 0.1],
    armR: [-2.20, 0, -0.60], forearmR: [-1.20, 0, -0.1],
    _hipY: -0.06
  }),
  K(0.14, {
    chest: [-0.20, 0, 0], head: [0.30, 0, 0],
    thighL: [-0.20, 0, 0.04], shinL: [0.26, 0, 0], footL: [0.12, 0, 0],
    thighR: [0.18, 0, -0.04], shinR: [1.80, 0, 0], footR: [0.36, 0, 0],
    armL: [-2.45, 0, 0.62], forearmL: [-1.00, 0, 0.1],
    armR: [-2.35, 0, -0.52], forearmR: [-1.30, 0, -0.1],
    _hipY: 0.05
  }),
  K(0.28, {
    chest: [-0.20, -0.12, 0], head: [0.30, 0.10, 0],
    thighL: [0.70, 0, 0.04], shinL: [0.62, 0, 0], footL: [0.48, 0, 0],
    thighR: [-0.90, 0, -0.04], shinR: [0.40, 0, 0], footR: [-0.16, 0, 0],
    armL: [-2.20, 0, 0.60], forearmL: [-1.20, 0, 0.1],
    armR: [-2.30, 0, -0.55], forearmR: [-1.10, 0, -0.1],
    _hipY: -0.06
  }),
  K(0.42, {
    chest: [-0.20, 0, 0], head: [0.30, 0, 0],
    thighL: [0.18, 0, 0.04], shinL: [1.80, 0, 0], footL: [0.36, 0, 0],
    thighR: [-0.20, 0, -0.04], shinR: [0.26, 0, 0], footR: [0.12, 0, 0],
    armL: [-2.35, 0, 0.52], forearmL: [-1.30, 0, 0.1],
    armR: [-2.45, 0, -0.62], forearmR: [-1.00, 0, -0.1],
    _hipY: 0.05
  }),
  K(0.56, {
    chest: [-0.20, 0.12, 0], head: [0.30, -0.10, 0],
    thighL: [-0.90, 0, 0.04], shinL: [0.40, 0, 0], footL: [-0.16, 0, 0],
    thighR: [0.70, 0, -0.04], shinR: [0.62, 0, 0], footR: [0.48, 0, 0],
    armL: [-2.30, 0, 0.55], forearmL: [-1.10, 0, 0.1],
    armR: [-2.20, 0, -0.60], forearmR: [-1.20, 0, -0.1],
    _hipY: -0.06
  })
]);

A.cower = clip(2.4, true, [
  K(0.0, {
    chest: [0.42, 0.10, 0], spine: [0.18, 0, 0], head: [-0.30, -0.08, 0],
    armL: [-1.85, 0, 0.30], armR: [-1.80, 0, -0.30],
    forearmL: [-2.05, 0, 0.15], forearmR: [-2.05, 0, -0.15],
    thighL: [-0.75, 0, 0.12], thighR: [-0.70, 0, -0.12], shinL: [1.05, 0, 0], shinR: [1.00, 0, 0],
    _hipY: -0.26
  }),
  K(1.2, {
    chest: [0.48, 0.06, 0], spine: [0.20, 0, 0], head: [-0.34, -0.05, 0],
    armL: [-1.92, 0, 0.34], armR: [-1.88, 0, -0.34],
    forearmL: [-2.12, 0, 0.15], forearmR: [-2.12, 0, -0.15],
    thighL: [-0.80, 0, 0.12], thighR: [-0.76, 0, -0.12], shinL: [1.12, 0, 0], shinR: [1.08, 0, 0],
    _hipY: -0.30
  }),
  K(2.4, {
    chest: [0.42, 0.10, 0], spine: [0.18, 0, 0], head: [-0.30, -0.08, 0],
    armL: [-1.85, 0, 0.30], armR: [-1.80, 0, -0.30],
    forearmL: [-2.05, 0, 0.15], forearmR: [-2.05, 0, -0.15],
    thighL: [-0.75, 0, 0.12], thighR: [-0.70, 0, -0.12], shinL: [1.05, 0, 0], shinR: [1.00, 0, 0],
    _hipY: -0.26
  })
]);

A.aim = clip(1.6, true, [
  K(0.0, {
    chest: [-0.04, -0.30, 0], spine: [0, -0.12, 0], head: [0.02, 0.26, 0],
    armR: [-1.48, 0, -0.26], forearmR: [-0.34, 0, -0.10],
    armL: [-1.20, 0, 0.55], forearmL: [-1.05, 0, 0.20],
    thighL: [-0.26, 0, 0.10], thighR: [0.20, 0, -0.10], shinL: [0.38, 0, 0], shinR: [0.28, 0, 0],
    _hipY: -0.08
  }),
  K(0.8, {
    chest: [-0.06, -0.32, 0], spine: [0, -0.13, 0], head: [0.03, 0.27, 0],
    armR: [-1.53, 0, -0.24], forearmR: [-0.30, 0, -0.10],
    armL: [-1.25, 0, 0.58], forearmL: [-1.10, 0, 0.20],
    thighL: [-0.27, 0, 0.10], thighR: [0.21, 0, -0.10], shinL: [0.39, 0, 0], shinR: [0.29, 0, 0],
    _hipY: -0.09
  }),
  K(1.6, {
    chest: [-0.04, -0.30, 0], spine: [0, -0.12, 0], head: [0.02, 0.26, 0],
    armR: [-1.48, 0, -0.26], forearmR: [-0.34, 0, -0.10],
    armL: [-1.20, 0, 0.55], forearmL: [-1.05, 0, 0.20],
    thighL: [-0.26, 0, 0.10], thighR: [0.20, 0, -0.10], shinL: [0.38, 0, 0], shinR: [0.28, 0, 0],
    _hipY: -0.08
  })
]);

A.shoot = clip(0.22, false, [
  K(0.0, {
    chest: [-0.14, -0.30, 0], head: [0.10, 0.26, 0],
    armR: [-1.30, 0, -0.26], forearmR: [-0.45, 0, -0.10],
    armL: [-1.10, 0, 0.55], forearmL: [-1.15, 0, 0.20],
    thighL: [-0.26, 0, 0.10], thighR: [0.20, 0, -0.10], shinL: [0.38, 0, 0], shinR: [0.28, 0, 0],
    _hipY: -0.08
  }),
  K(0.22, {
    chest: [-0.04, -0.30, 0], head: [0.02, 0.26, 0],
    armR: [-1.48, 0, -0.26], forearmR: [-0.34, 0, -0.10],
    armL: [-1.20, 0, 0.55], forearmL: [-1.05, 0, 0.20],
    thighL: [-0.26, 0, 0.10], thighR: [0.20, 0, -0.10], shinL: [0.38, 0, 0], shinR: [0.28, 0, 0],
    _hipY: -0.08
  })
], { hitAt: 0.0 });

A.meleeSwing = clip(0.55, false, [
  K(0.00, {
    chest: [0, 0.55, 0], spine: [0, 0.22, 0], head: [0, -0.30, 0],
    armR: [-1.10, 0, -0.95], forearmR: [-1.40, 0, 0],
    armL: [-0.30, 0, 0.30], forearmL: [-0.90, 0, 0],
    thighL: [-0.16, 0, 0.08], thighR: [0.12, 0, -0.08], shinL: [0.22, 0, 0], shinR: [0.18, 0, 0]
  }),
  K(0.20, {
    chest: [0, -0.60, 0], spine: [0, -0.24, 0], head: [0, 0.34, 0],
    armR: [-1.45, 0, 0.18], forearmR: [-0.30, 0, 0],
    armL: [0.35, 0, 0.35], forearmL: [-1.25, 0, 0],
    thighL: [-0.26, 0, 0.08], thighR: [0.22, 0, -0.08], shinL: [0.30, 0, 0], shinR: [0.24, 0, 0]
  }),
  K(0.55, {
    chest: [-0.04, 0.06, 0], head: [0.02, -0.04, 0],
    armL: [-0.10, 0, 0.22], armR: [-0.10, 0, -0.22],
    forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0],
    thighL: [0, 0, 0.06], thighR: [0, 0, -0.06], shinL: [0.06, 0, 0], shinR: [0.06, 0, 0]
  })
], { hitAt: 0.20 });

A.taunt = clip(1.5, true, [
  K(0.0, {
    chest: [-0.10, 0.14, 0], head: [0.06, -0.10, 0],
    armL: [-0.30, 0, 0.55], armR: [-0.55, 0, -0.42],
    forearmL: [-1.30, 0, 0.20], forearmR: [-1.60, 0, -0.20],
    thighL: [0, 0, 0.10], thighR: [0, 0, -0.10], shinL: [0.06, 0, 0], shinR: [0.06, 0, 0]
  }),
  K(0.75, {
    chest: [-0.16, -0.14, 0], head: [0.10, 0.10, 0],
    armL: [-0.55, 0, 0.42], armR: [-0.30, 0, -0.55],
    forearmL: [-1.60, 0, 0.20], forearmR: [-1.30, 0, -0.20],
    thighL: [0, 0, 0.10], thighR: [0, 0, -0.10], shinL: [0.06, 0, 0], shinR: [0.06, 0, 0]
  }),
  K(1.5, {
    chest: [-0.10, 0.14, 0], head: [0.06, -0.10, 0],
    armL: [-0.30, 0, 0.55], armR: [-0.55, 0, -0.42],
    forearmL: [-1.30, 0, 0.20], forearmR: [-1.60, 0, -0.20],
    thighL: [0, 0, 0.10], thighR: [0, 0, -0.10], shinL: [0.06, 0, 0], shinR: [0.06, 0, 0]
  })
]);

// Seated at a steering wheel.
A.drive = clip(3.0, true, [
  K(0.0, {
    chest: [-0.06, 0.02, 0], head: [0.04, -0.03, 0],
    thighL: [-1.52, 0, 0.16], thighR: [-1.50, 0, -0.16],
    shinL: [1.42, 0, 0], shinR: [1.40, 0, 0], footL: [0.20, 0, 0], footR: [0.24, 0, 0],
    armL: [-1.15, 0, 0.30], armR: [-1.15, 0, -0.30],
    forearmL: [-0.95, 0, 0.10], forearmR: [-0.95, 0, -0.10]
  }),
  K(1.5, {
    chest: [-0.05, -0.02, 0], head: [0.03, 0.03, 0],
    thighL: [-1.50, 0, 0.16], thighR: [-1.52, 0, -0.16],
    shinL: [1.40, 0, 0], shinR: [1.42, 0, 0], footL: [0.22, 0, 0], footR: [0.22, 0, 0],
    armL: [-1.18, 0, 0.28], armR: [-1.12, 0, -0.32],
    forearmL: [-0.92, 0, 0.10], forearmR: [-0.98, 0, -0.10]
  }),
  K(3.0, {
    chest: [-0.06, 0.02, 0], head: [0.04, -0.03, 0],
    thighL: [-1.52, 0, 0.16], thighR: [-1.50, 0, -0.16],
    shinL: [1.42, 0, 0], shinR: [1.40, 0, 0], footL: [0.20, 0, 0], footR: [0.24, 0, 0],
    armL: [-1.15, 0, 0.30], armR: [-1.15, 0, -0.30],
    forearmL: [-0.95, 0, 0.10], forearmR: [-0.95, 0, -0.10]
  })
]);

A.sit = clip(2.0, true, [
  K(0.0, {
    chest: [0.04, 0, 0], head: [-0.02, 0, 0],
    thighL: [-1.50, 0, 0.14], thighR: [-1.48, 0, -0.14],
    shinL: [1.45, 0, 0], shinR: [1.43, 0, 0],
    armL: [-0.30, 0, 0.22], armR: [-0.30, 0, -0.22],
    forearmL: [-0.75, 0, 0], forearmR: [-0.75, 0, 0]
  })
]);

/* ------------------------------------------------------------------ *
 *  RAGDOLL POSES
 *
 *  These carry no root rotation — Actor drives the body orientation with a
 *  quaternion while it tumbles, so the clips only have to look boneless.
 * ------------------------------------------------------------------ */

A.limp = clip(1.9, true, [
  K(0.0, {
    chest: [0.22, 0.09, 0.04], spine: [0.10, 0.03, 0], head: [-0.42, -0.12, 0.08],
    armL: [-2.35, 0, 0.62], armR: [-2.18, 0, -0.72],
    forearmL: [-0.55, 0, 0.12], forearmR: [-0.66, 0, -0.12],
    thighL: [-0.44, 0, 0.22], thighR: [-0.20, 0, -0.26],
    shinL: [0.72, 0, 0], shinR: [0.98, 0, 0], footL: [0.30, 0, 0], footR: [0.20, 0, 0]
  }),
  K(0.95, {
    chest: [0.16, -0.08, -0.05], spine: [0.07, -0.03, 0], head: [-0.32, 0.14, -0.09],
    armL: [-2.14, 0, 0.74], armR: [-2.38, 0, -0.60],
    forearmL: [-0.70, 0, 0.12], forearmR: [-0.48, 0, -0.12],
    thighL: [-0.24, 0, 0.26], thighR: [-0.40, 0, -0.21],
    shinL: [0.96, 0, 0], shinR: [0.70, 0, 0], footL: [0.20, 0, 0], footR: [0.31, 0, 0]
  }),
  K(1.9, {
    chest: [0.22, 0.09, 0.04], spine: [0.10, 0.03, 0], head: [-0.42, -0.12, 0.08],
    armL: [-2.35, 0, 0.62], armR: [-2.18, 0, -0.72],
    forearmL: [-0.55, 0, 0.12], forearmR: [-0.66, 0, -0.12],
    thighL: [-0.44, 0, 0.22], thighR: [-0.20, 0, -0.26],
    shinL: [0.72, 0, 0], shinR: [0.98, 0, 0], footL: [0.30, 0, 0], footR: [0.20, 0, 0]
  })
]);

// Lying still after the tumble has run out of energy.
A.sprawl = clip(3.6, true, [
  K(0.0, {
    chest: [0.05, 0.06, 0.02], spine: [0.02, 0, 0], head: [-0.14, 0.20, 0.05],
    armL: [-0.52, 0, 1.02], armR: [-0.36, 0, -0.92],
    forearmL: [-0.78, 0, 0.18], forearmR: [-0.58, 0, -0.16],
    thighL: [-0.12, 0, 0.28], thighR: [0.05, 0, -0.20],
    shinL: [0.32, 0, 0], shinR: [0.16, 0, 0], footL: [0.12, 0, 0], footR: [0.20, 0, 0]
  }),
  K(1.8, {
    chest: [0.08, 0.06, 0.02], spine: [0.03, 0, 0], head: [-0.16, 0.21, 0.05],
    armL: [-0.48, 0, 1.05], armR: [-0.33, 0, -0.95],
    forearmL: [-0.74, 0, 0.18], forearmR: [-0.55, 0, -0.16],
    thighL: [-0.10, 0, 0.29], thighR: [0.07, 0, -0.21],
    shinL: [0.30, 0, 0], shinR: [0.14, 0, 0], footL: [0.14, 0, 0], footR: [0.22, 0, 0]
  }),
  K(3.6, {
    chest: [0.05, 0.06, 0.02], spine: [0.02, 0, 0], head: [-0.14, 0.20, 0.05],
    armL: [-0.52, 0, 1.02], armR: [-0.36, 0, -0.92],
    forearmL: [-0.78, 0, 0.18], forearmR: [-0.58, 0, -0.16],
    thighL: [-0.12, 0, 0.28], thighR: [0.05, 0, -0.20],
    shinL: [0.32, 0, 0], shinR: [0.16, 0, 0], footL: [0.12, 0, 0], footR: [0.20, 0, 0]
  })
]);

// Sprawl -> braced push-up -> standing. Actor slerps the body upright across
// the same span, so this only needs the limbs to gather underneath.
A.riseUp = clip(0.95, false, [
  K(0.0, {
    chest: [0.05, 0.06, 0.02], head: [-0.14, 0.20, 0.05],
    armL: [-0.52, 0, 1.02], armR: [-0.36, 0, -0.92],
    forearmL: [-0.78, 0, 0.18], forearmR: [-0.58, 0, -0.16],
    thighL: [-0.12, 0, 0.28], thighR: [0.05, 0, -0.20],
    shinL: [0.32, 0, 0], shinR: [0.16, 0, 0]
  }),
  K(0.42, {
    chest: [-0.30, 0.10, 0], spine: [-0.12, 0, 0], head: [0.26, -0.08, 0],
    armL: [-1.15, 0, 0.42], armR: [-1.05, 0, -0.40],
    forearmL: [-1.35, 0, 0.10], forearmR: [-1.28, 0, -0.10],
    thighL: [-1.30, 0, 0.20], thighR: [-0.85, 0, -0.18],
    shinL: [1.75, 0, 0], shinR: [1.35, 0, 0], footL: [-0.35, 0, 0], footR: [0.15, 0, 0],
    _hipY: -0.52
  }),
  K(0.95, {
    chest: [-0.05, 0, 0], head: [0.03, 0, 0],
    armL: [-0.08, 0, 0.18], armR: [-0.08, 0, -0.18],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    thighL: [0, 0, 0.05], thighR: [0, 0, -0.05], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0],
    _hipY: 0
  })
]);

// Front crawl. The body is held horizontal by the swim controller, so this
// only has to do the stroke.
A.swim = clip(1.9, true, [
  K(0.0, {
    chest: [-0.10, 0.16, 0], spine: [-0.04, 0.06, 0], head: [-0.42, -0.10, 0],
    armR: [-2.85, 0, -0.18], forearmR: [-0.22, 0, 0],
    armL: [0.55, 0, 0.30], forearmL: [-0.95, 0, 0.10],
    thighL: [-0.22, 0, 0.06], thighR: [0.20, 0, -0.06],
    shinL: [0.34, 0, 0], shinR: [0.16, 0, 0], footL: [0.62, 0, 0], footR: [0.70, 0, 0]
  }),
  K(0.48, {
    chest: [-0.12, -0.02, 0], spine: [-0.05, 0, 0], head: [-0.36, 0.04, 0],
    armR: [-1.55, 0, -0.42], forearmR: [-0.70, 0, 0],
    armL: [-1.30, 0, 0.46], forearmL: [-0.55, 0, 0.10],
    thighL: [0.18, 0, 0.06], thighR: [-0.20, 0, -0.06],
    shinL: [0.18, 0, 0], shinR: [0.36, 0, 0], footL: [0.70, 0, 0], footR: [0.60, 0, 0]
  }),
  K(0.95, {
    chest: [-0.10, -0.16, 0], spine: [-0.04, -0.06, 0], head: [-0.42, 0.10, 0],
    armL: [-2.85, 0, 0.18], forearmL: [-0.22, 0, 0],
    armR: [0.55, 0, -0.30], forearmR: [-0.95, 0, -0.10],
    thighL: [-0.20, 0, 0.06], thighR: [0.22, 0, -0.06],
    shinL: [0.16, 0, 0], shinR: [0.34, 0, 0], footL: [0.70, 0, 0], footR: [0.62, 0, 0]
  }),
  K(1.43, {
    chest: [-0.12, 0.02, 0], spine: [-0.05, 0, 0], head: [-0.36, -0.04, 0],
    armL: [-1.55, 0, 0.42], forearmL: [-0.70, 0, 0],
    armR: [-1.30, 0, -0.46], forearmR: [-0.55, 0, -0.10],
    thighL: [0.20, 0, 0.06], thighR: [-0.18, 0, -0.06],
    shinL: [0.36, 0, 0], shinR: [0.18, 0, 0], footL: [0.60, 0, 0], footR: [0.70, 0, 0]
  }),
  K(1.9, {
    chest: [-0.10, 0.16, 0], spine: [-0.04, 0.06, 0], head: [-0.42, -0.10, 0],
    armR: [-2.85, 0, -0.18], forearmR: [-0.22, 0, 0],
    armL: [0.55, 0, 0.30], forearmL: [-0.95, 0, 0.10],
    thighL: [-0.22, 0, 0.06], thighR: [0.20, 0, -0.06],
    shinL: [0.34, 0, 0], shinR: [0.16, 0, 0], footL: [0.62, 0, 0], footR: [0.70, 0, 0]
  })
]);

// Treading water, upright, when you're not going anywhere.
A.tread = clip(2.6, true, [
  K(0.0, {
    chest: [0.06, 0.08, 0], head: [-0.06, -0.06, 0],
    armL: [-1.32, 0, 0.62], armR: [-1.32, 0, -0.62],
    forearmL: [-1.05, 0, 0.18], forearmR: [-1.05, 0, -0.18],
    thighL: [-0.72, 0, 0.16], thighR: [-0.42, 0, -0.16],
    shinL: [0.95, 0, 0], shinR: [0.55, 0, 0]
  }),
  K(1.3, {
    chest: [0.06, -0.08, 0], head: [-0.06, 0.06, 0],
    armL: [-1.42, 0, 0.52], armR: [-1.42, 0, -0.52],
    forearmL: [-0.92, 0, 0.18], forearmR: [-0.92, 0, -0.18],
    thighL: [-0.42, 0, 0.16], thighR: [-0.72, 0, -0.16],
    shinL: [0.55, 0, 0], shinR: [0.95, 0, 0]
  }),
  K(2.6, {
    chest: [0.06, 0.08, 0], head: [-0.06, -0.06, 0],
    armL: [-1.32, 0, 0.62], armR: [-1.32, 0, -0.62],
    forearmL: [-1.05, 0, 0.18], forearmR: [-1.05, 0, -0.18],
    thighL: [-0.72, 0, 0.16], thighR: [-0.42, 0, -0.16],
    shinL: [0.95, 0, 0], shinR: [0.55, 0, 0]
  })
]);

export const CLIPS = A;
export function getClip (name) { return A[name] || A.idle; }
