import * as THREE from 'three';
import { clamp, smooth, approachAngle } from '../core/Util.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3();
const FP_DIST = 0.7;       // camera distance at which it becomes first person
const _pivot = new THREE.Vector3(), _look = new THREE.Vector3(), _back = new THREE.Vector3();

/**
 * Over-the-shoulder third-person rig.
 *
 * The camera does NOT look at the hero — it looks *along* the yaw/pitch axis
 * from a laterally offset pivot. That puts the crosshair at the centre of the
 * screen aiming at whatever you're pointing at, and pushes the character off to
 * one side, the way Fortnite and most modern third-person shooters frame it.
 * Aiming stays consistent because Player.aimPoint() casts from the camera along
 * exactly this same forward axis.
 */
export class CameraRig {
  constructor (camera, city) {
    this.cam = camera;
    this.city = city;
    this.yaw = 0;
    this.pitch = -0.12;
    this.dist = 6.2;
    this.fpBlend = 0;          // 0 third person, 1 first person
    this.distIdx = 1;
    this.distances = [FP_DIST, 4.2, 6.2, 9.0, 13.5];
    this.curDist = 6.2;
    this.focus = new THREE.Vector3();
    this.smoothFocus = new THREE.Vector3();
    this.sensitivity = 0.0021;
    this.baseFov = 62;
    this.fov = 62;
    this.shake = 0;
    this.shakeT = 0;
    this.offsetY = 1.52;
    // Shoulder offset as a FRACTION of camera distance, so the hero holds the
    // same spot on screen whether you're zoomed in close or pulled way out.
    this.shoulder = 0.26;
    this.curShoulder = 0.26;
    this.lookIdle = 99;        // seconds since the player last moved the mouse
    this.yawRate = 0;          // rad/s the player is whipping the view around
    this._lastYaw = 0;
    this._init = false;
  }

  cycleDistance () {
    this.distIdx = (this.distIdx + 1) % this.distances.length;
    this.dist = this.distances[this.distIdx];
  }

  addShake (a) { this.shake = Math.min(1.4, this.shake + a); }

  look (dx, dy) {
    if (dx || dy) this.lookIdle = 0;
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    this.pitch = clamp(this.pitch, -1.35, 1.30);
  }

  /** Unit vector the camera is looking along. */
  forward (out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  /** True right-hand vector: right = forward x up in a Y-up right-handed space. */
  right (out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  update (dt, target, opts = {}) {
    this.lookIdle += dt;
    let dy = (this.yaw - this._lastYaw) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.yawRate = smooth(this.yawRate, dy / Math.max(dt, 1e-3), 18 * dt);
    this._lastYaw = this.yaw;

    // chase-cam: swing back behind a vehicle once the player stops looking around
    if (opts.autoYaw !== undefined && this.lookIdle > 0.9) {
      const k = Math.min(1, (this.lookIdle - 0.9) * 1.2);
      this.yaw = approachAngle(this.yaw, opts.autoYaw, 2.6 * k, dt);
      this.pitch = smooth(this.pitch, -0.14, 1.6 * k * dt);
    }

    this.focus.copy(target);
    // Zoom all the way in and it goes first person — the same wheel that pulls
    // the camera out keeps going until it is behind your eyes.
    const wantFP = this.dist <= FP_DIST + 0.01 && !opts.noFirstPerson;
    this.fpBlend = smooth(this.fpBlend, wantFP ? 1 : 0, 9 * dt);
    this.focus.y += this.offsetY + this.fpBlend * 0.55;
    if (!this._init) { this.smoothFocus.copy(this.focus); this._init = true; }
    const follow = opts.snappy ? 30 : 14;
    this.smoothFocus.x = smooth(this.smoothFocus.x, this.focus.x, follow * dt);
    this.smoothFocus.y = smooth(this.smoothFocus.y, this.focus.y, (opts.flying ? 10 : 16) * dt);
    this.smoothFocus.z = smooth(this.smoothFocus.z, this.focus.z, follow * dt);

    const wantDist = this.dist * (opts.distMul ?? 1) * (1 - this.fpBlend) + this.fpBlend * 0.12;
    this.curDist = smooth(this.curDist, wantDist, 6 * dt);
    this.curShoulder = smooth(this.curShoulder,
      (opts.shoulder ?? this.shoulder) * (1 - this.fpBlend), 6 * dt);
    const lateral = this.curShoulder * this.curDist;

    this.forward(_d);
    this.right(_r);

    // The pivot is the hero nudged sideways, so the hero ends up off-centre.
    // That nudge can land it inside a wall or a staircase, and then the sweep
    // below starts from inside geometry and has nowhere legal to go — the
    // camera ends up stuck in the thing. Give up the offset rather than the
    // position: walk back toward the hero until the pivot is in open air.
    _pivot.copy(this.smoothFocus).addScaledVector(_r, lateral);
    if (this.city.pointInSolid(_pivot.x, _pivot.y, _pivot.z, 0.12)) {
      for (let k = 1; k <= 5; k++) {
        _pivot.copy(this.smoothFocus).addScaledVector(_r, lateral * (1 - k / 5));
        if (!this.city.pointInSolid(_pivot.x, _pivot.y, _pivot.z, 0.12)) break;
      }
    }
    _o.copy(_pivot).addScaledVector(_d, -this.curDist);

    // Pull in if anything solid is between the pivot and the camera. This has
    // to be a fine sweep: a coarse one steps straight over a floor slab, and
    // the camera ends up under the storey you are standing on.
    _back.copy(_d).negate();
    const room = this.city.cameraClearance(_pivot, _back, this.curDist);
    if (room < this.curDist) _o.copy(_pivot).addScaledVector(_back, room);
    // Keep the camera out of the ground — TERRAIN only. Using groundHeight
    // here looks two metres up as well and finds the floor of the storey
    // above, then lifts the camera to it: straight through the ceiling and
    // into the room overhead, which is exactly the clipping this was meant to
    // stop. Buildings are the sweep's job, and it has already done it.
    const terrain = this.city.groundSurface(_o.x, _o.z) + 0.4;
    if (_o.y < terrain && !this.city.pointInSolid(_o.x, terrain, _o.z, 0.2)) _o.y = terrain;

    // Last line of defence: if anything above has still left the camera inside
    // geometry, walk it back toward the pivot until it isn't.
    if (this.city.pointInSolid(_o.x, _o.y, _o.z, 0.15)) {
      for (let k = 1; k <= 8; k++) {
        _o.lerp(_pivot, 0.22);
        if (!this.city.pointInSolid(_o.x, _o.y, _o.z, 0.15)) break;
      }
    }

    if (this.shake > 0.001) {
      this.shakeT += dt;
      const a = this.shake * 0.42;
      _o.x += Math.sin(this.shakeT * 61) * a;
      _o.y += Math.cos(this.shakeT * 47) * a;
      _o.z += Math.sin(this.shakeT * 37) * a * 0.7;
      this.shake = Math.max(0, this.shake - dt * 2.6);
    }

    this.cam.position.copy(_o);
    // look ALONG the aim axis rather than at the hero
    _look.copy(_o).add(_d);
    this.cam.lookAt(_look);

    const targetFov = this.baseFov + (opts.fovBoost ?? 0);
    this.fov = smooth(this.fov, targetFov, 4 * dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
