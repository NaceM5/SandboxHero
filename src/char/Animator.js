import { getClip } from './Animations.js';
import { lerp } from '../core/Util.js';

const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'armL', 'forearmL', 'handL',
  'shoulderR', 'armR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'
];
const ROOT_KEYS = ['_hipY', '_hipZ', '_rx', '_ry', '_rz'];

const tmpA = {}, tmpB = {}, cur = {}, prev = {};
for (const b of BONES) { tmpA[b] = [0, 0, 0]; tmpB[b] = [0, 0, 0]; cur[b] = [0, 0, 0]; prev[b] = [0, 0, 0]; }
for (const k of ROOT_KEYS) { tmpA[k] = 0; tmpB[k] = 0; cur[k] = 0; prev[k] = 0; }

/**
 * Plays the hand-authored pose clips onto a rig, with cross-fading and a
 * couple of additive layers (look-at, breathing, damage flinch) on top.
 */
export class Animator {
  constructor (rig) {
    this.rig = rig;
    this.bones = rig.bones;
    this.baseHipY = rig.P.hipY;
    this.rest = {};
    for (const b of BONES) {
      const r = this.bones[b]?.userData.rest || { x: 0, y: 0, z: 0 };
      this.rest[b] = [r.x, r.y, r.z];
    }
    this.clipName = 'idle';
    this.clip = getClip('idle');
    this.time = 0;
    this.speed = 1;
    this.fadeT = 0;
    this.fadeDur = 0;
    this.fired = false;
    this.onEvent = null;
    this.done = false;

    // additive layers
    this.look = [0, 0, 0];       // extra head rotation
    this.lookWeight = 1;
    this.torsoTwist = 0;
    this.flinch = 0;
    this.breathPhase = Math.random() * 10;
    this.rootLean = [0, 0, 0];   // applied to hips, used for banking / recoil
    // Sparse per-bone additive offsets, layered on top of whatever clip is
    // playing. The ragdoll uses this to fling limbs around with the tumble.
    this.additive = null;
  }

  play (name, opts = {}) {
    const fade = opts.fade ?? 0.16;
    if (name === this.clipName && !opts.restart) { this.speed = opts.speed ?? this.speed; return; }
    if (opts.fromBones) {
      // blend out of the pose the bones are actually in — used when handing
      // control back from the ragdoll, which never went through this animator
      for (const b of BONES) {
        const bone = this.bones[b];
        prev[b] = bone ? [bone.rotation.x, bone.rotation.y, bone.rotation.z] : [0, 0, 0];
      }
      for (const k of ROOT_KEYS) prev[k] = 0;
    } else {
      // snapshot the current output so we can blend out of it
      this._samplePose(this.clip, this.time, tmpA);
      if (this.fadeDur > 0 && this.fadeT < this.fadeDur) {
        const w = this.fadeT / this.fadeDur;
        for (const b of BONES) for (let i = 0; i < 3; i++) tmpA[b][i] = lerp(prev[b][i], tmpA[b][i], w);
        for (const k of ROOT_KEYS) tmpA[k] = lerp(prev[k], tmpA[k], w);
      }
      for (const b of BONES) prev[b] = [tmpA[b][0], tmpA[b][1], tmpA[b][2]];
      for (const k of ROOT_KEYS) prev[k] = tmpA[k];
    }

    this.clipName = name;
    this.clip = getClip(name);
    this.time = 0;
    this.speed = opts.speed ?? 1;
    this.fadeDur = fade;
    this.fadeT = 0;
    this.fired = false;
    this.done = false;
  }

  /** Where in the clip we are, 0..1 — handy for gating power effects. */
  get progress () { return Math.min(1, this.time / this.clip.duration); }

  _samplePose (clip, t, out) {
    const keys = clip.keys;
    let tt = clip.loop ? t % clip.duration : Math.min(t, clip.duration);
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= tt) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const span = Math.max(1e-5, b.t - a.t);
    let f = (tt - a.t) / span;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    f = f * f * (3 - 2 * f); // smoothstep between keys keeps poses from popping

    for (const name of BONES) {
      const r = this.rest[name];
      const pa = a.pose[name] || r;
      const pb = b.pose[name] || r;
      const o = out[name];
      o[0] = pa[0] + (pb[0] - pa[0]) * f;
      o[1] = pa[1] + (pb[1] - pa[1]) * f;
      o[2] = pa[2] + (pb[2] - pa[2]) * f;
    }
    for (const k of ROOT_KEYS) {
      const pa = a.pose[k] || 0, pb = b.pose[k] || 0;
      out[k] = pa + (pb - pa) * f;
    }
    return out;
  }

  update (dt) {
    const prevTime = this.time;
    this.time += dt * this.speed;
    if (!this.clip.loop && this.time >= this.clip.duration) {
      this.time = this.clip.duration;
      this.done = true;
    }
    // animation event (impact frame)
    if (this.clip.hitAt !== undefined && !this.fired && this.time >= this.clip.hitAt && prevTime <= this.clip.hitAt + 0.5) {
      this.fired = true;
      this.onEvent?.('hit', this.clipName);
    }

    this._samplePose(this.clip, this.time, tmpB);

    // cross-fade from the snapshot
    if (this.fadeDur > 0 && this.fadeT < this.fadeDur) {
      this.fadeT += dt;
      let w = Math.min(1, this.fadeT / this.fadeDur);
      w = w * w * (3 - 2 * w);
      for (const b of BONES) {
        const c = cur[b], p = prev[b], n = tmpB[b];
        c[0] = lerp(p[0], n[0], w); c[1] = lerp(p[1], n[1], w); c[2] = lerp(p[2], n[2], w);
      }
      for (const k of ROOT_KEYS) cur[k] = lerp(prev[k], tmpB[k], w);
    } else {
      for (const b of BONES) { const c = cur[b], n = tmpB[b]; c[0] = n[0]; c[1] = n[1]; c[2] = n[2]; }
      for (const k of ROOT_KEYS) cur[k] = tmpB[k];
    }

    /* ---- additive layers ---- */
    this.breathPhase += dt * 1.35;
    const breath = Math.sin(this.breathPhase) * 0.012;
    cur.chest[0] -= breath;
    cur.chest[1] += Math.sin(this.breathPhase * 0.41) * 0.01;

    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 4.5);
      const f = this.flinch;
      cur.chest[0] += f * 0.28;
      cur.head[0] -= f * 0.34;
      cur.spine[0] += f * 0.12;
    }

    const lw = this.lookWeight;
    cur.head[0] += this.look[0] * lw;
    cur.head[1] += this.look[1] * lw;
    cur.head[2] += this.look[2] * lw;
    cur.chest[1] += this.torsoTwist;
    cur.neck[1] += this.look[1] * 0.35 * lw;

    if (this.additive) {
      for (const name in this.additive) {
        const a = this.additive[name], c = cur[name];
        if (!c) continue;
        c[0] += a[0]; c[1] += a[1]; c[2] += a[2];
      }
    }

    /* ---- write to the skeleton ---- */
    const B = this.bones;
    for (const name of BONES) {
      const b = B[name];
      if (!b) continue;
      const c = cur[name];
      b.rotation.set(c[0], c[1], c[2]);
    }
    B.hips.position.y = this.baseHipY + cur._hipY;
    B.hips.position.z = cur._hipZ;
    B.hips.rotation.x += cur._rx + this.rootLean[0];
    B.hips.rotation.y += cur._ry + this.rootLean[1];
    B.hips.rotation.z += cur._rz + this.rootLean[2];
  }
}
