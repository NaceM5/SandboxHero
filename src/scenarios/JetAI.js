import * as THREE from 'three';
import { clamp, rand, pick } from '../core/Util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();

// Speeds are pitched against the hero's flight: 52 m/s cruising, 118 sprinting.
export const SPEED = { transport: 48, form: 52, attack: 64, brk: 70, evade: 82, leave: 100 };

/**
 * Shared combat flying for the Atlas 42: attack runs at the hero, the hard
 * turn back after a pass, evasion when badly hurt, and the cannon with its
 * degrading weapon systems. `guard` is the point the jet is protecting and
 * `leash` how far from it the jet will range.
 */

/** Press in, fire when lined up, fly through the target. */
export function attackRun (world, e, dt, player) {
  const map = world.city;
  _b.copy(player.pos).addScaledVector(player.vel, 0.9);
  _b.y = Math.max(_b.y + 4, map.groundHeight(_b.x, _b.z) + 30);
  e.steerTo(_b, dt, SPEED.attack);
  e.forward(_a);
  _c.copy(_b).sub(e.pos);
  const dist = _c.length();
  const aligned = _c.normalize().dot(_a);
  if (dist < 340 && aligned > 0.93) gun(world, e, dt, player);
  // committed to the pass: only break once it has flown through the target
  if (dist < 45 || aligned < -0.1) { e.mode = 'break'; e.modeT = 0; e.breakDir = pick([-1, 1]); }
  e.integrate(dt);
}

/** Overshoot, then a hard climbing turn that comes straight back onto the hero. */
export function breakOff (world, e, dt, player) {
  const map = world.city;
  const sx = Math.cos(e.heading) * e.breakDir, sz = -Math.sin(e.heading) * e.breakDir;
  const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
  const out = e.modeT < 0.8 ? 1 : 0.35;      // first: keep going; then: pull round
  _b.set(player.pos.x + sx * 180 + fx * 220 * out, Math.max(player.pos.y + 55, map.groundHeight(e.pos.x, e.pos.z) + 45), player.pos.z + sz * 180 + fz * 220 * out);
  e.steerTo(_b, dt, SPEED.brk, 1.3);
  if (e.modeT > 2.6) { e.mode = 'attack'; e.modeT = 0; }
  e.integrate(dt);
}

/**
 * Low on health: no more attack runs. Jink hard, keep the throttle open, put
 * distance between itself and the hero, throw in a barrel roll — but bend
 * back toward whatever it is guarding once it has strayed, so it never just
 * leaves.
 */
export function evade (world, e, dt, player, guard, leash) {
  const dp = e.pos.distanceTo(player.pos);
  e.evadeT = (e.evadeT || 0) + dt;
  if (e.jink === undefined) e.jink = 1;
  if (!(e.rollT >= 0)) e.rollT = 0;
  if (e.jinkNext === undefined) e.jinkNext = 0.5;
  if (e.evadeT > e.jinkNext) {
    e.jinkNext = e.evadeT + rand(0.8, 1.6);
    e.jink = -(e.jink || 1);
    if (Math.random() < 0.35 && e.rollT <= 0) e.rollT = 1.4;
  }
  if (e.rollT > 0) { e.rollT -= dt; e.rollExtra = Math.sin((1.4 - e.rollT) / 1.4 * Math.PI * 2) * 3.0; }
  _a.copy(e.pos).sub(player.pos).setY(0);
  if (_a.lengthSq() < 1) _a.set(Math.sin(e.heading), 0, Math.cos(e.heading));
  _a.normalize();
  if (guard) {
    const dG = e.pos.distanceTo(guard);
    if (dG > leash * 0.6) {
      _d.copy(guard).sub(e.pos).setY(0).normalize();
      _a.lerp(_d, clamp((dG - leash * 0.6) / (leash * 0.5), 0, 0.85)).normalize();
    }
  }
  const side = _c.set(-_a.z, 0, _a.x).multiplyScalar(e.jink * (dp < 320 ? 1.4 : 0.8));
  _b.copy(e.pos).addScaledVector(_a, 600).addScaledVector(side, 380);
  _b.y = clamp(e.pos.y + (dp < 250 ? 120 : rand(-40, 60)), 120, 600);
  _b.y = Math.max(_b.y, world.city.groundHeight(_b.x, _b.z) + 70);
  e.steerTo(_b, dt, SPEED.evade, 1.25);
  // once it has opened up some distance, it will snipe from range now and then
  if (dp > 420 && dp < 800 && Math.random() < dt * 0.15) {
    e.forward(_a);
    _c.copy(player.pos).sub(e.pos).normalize();
    if (_c.dot(_a) > 0.85) gun(world, e, dt, player, true);
  }
  e.integrate(dt);
}

/** Cannon bursts with weapon systems that fail as the airframe is shot up. */
export function gun (world, e, dt, player, single = false) {
  const w = e.weapon;
  e.gunT -= dt * w.rate;
  if (e.gunT > 0) return;
  e.gunT = single ? 3.5 : 1.7;
  const muzzle = e.group.localToWorld(_a.set(0, 3.4, 8.4));
  burst(world, e, muzzle, player, w, single ? 1 : w.burst);
  if (w.label === 'failing' && Math.random() < 0.5) {
    // misfires: sparks off the nose instead of a clean burst
    world.effects.burst(muzzle, '#ffe08a', 12, 8, 0.3, 0.3, { grav: -6 });
  }
}

export function burst (world, a, muzzle, player, w, rounds) {
  const fx = world.effects;
  const spread = 1.6 + (1 - w.accuracy) * 6;
  for (let k = 0; k < rounds; k++) {
    const to = _d.copy(player.pos).add(_c.set(rand(-spread, spread), 1 + rand(-spread * 0.5, spread * 0.5), rand(-spread, spread)));
    const hit = Math.random() < 0.42 * w.accuracy * (0.5 + world.settings.get('enemyAggression') * 0.7);
    const from = _b.copy(muzzle).add(_a.set(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)));
    fx.flashBeam(from, hit ? _d.copy(player.pos).setY(player.pos.y + 1) : to, '#ffd27a', 0.09, 0.14);
    fx.burst(from, '#ffe9b0', 3, 6, 0.25, 0.2);
    if (hit) { player.takeDamage(a.kind === 'titan' ? 4 : 5, a.pos); fx.burst(player.pos, '#ffd0a0', 5, 4, 0.22, 0.25, { grav: -4 }); }
    else fx.burst(to, '#c9d2dc', 4, 5, 0.25, 0.25, { grav: -8 });
  }
  fx.burst(muzzle, '#ffcf6a', 6, 8, 0.4, 0.25);
}

/** Flying into an aircraft at speed hurts it — and stops you. */
export function ram (world, a, player) {
  if (!player.flying || player.speed < 22 || !a.alive || !a.containsPoint(player.pos, 1.5)) return false;
  const dmg = player.speed * 2.2 * player.strength;
  a.owner.hurt(a, dmg, player.pos);
  world.effects.burst(player.pos, '#ffd27a', 24, 14, 0.5, 0.4, { grav: -6 });
  player.cam?.addShake(0.6);
  player.takeDamage(Math.min(30, player.speed * 0.25), a.pos);
  _a.copy(player.vel).normalize();
  player.pos.addScaledVector(_a, -6);
  player.vel.multiplyScalar(-0.35);
  return true;
}

/** The fireball and shockwave of an aircraft coming apart. */
export function explode (world, a) {
  const fx = world.effects;
  fx.burst(a.pos, '#ffb43a', 60, 22, 1.4, 1.0, { grav: -6, drag: 0.9 });
  fx.burst(a.pos, '#ff5a1e', 40, 12, 2.0, 1.4, { grav: -2, drag: 0.93, grow: 2 });
  fx.shockwave(a.pos, '#ffa030', a.kind === 'titan' ? 40 : 22, 0.7);
  world.player.cam?.addShake(a.kind === 'titan' ? 0.9 : 0.5);
  world.applyImpact(a.pos, a.kind === 'titan' ? 30 : 16, { damage: 40, knock: 16, up: 0.7, hitY: 1, propForce: 0, vehicleDamage: 0 });
}

/**
 * An Atlas that dies doesn't fall: it goes up in one big fireball where it
 * is — a double flash, a wide shockwave, a hail of burning debris and smoke
 * that hangs for a moment — and there is nothing left to hit the ground.
 * Everything inside the blast takes the hit.
 */
export function obliterate (world, a) {
  const fx = world.effects;
  const p = a.pos;
  fx.burst(p, '#fff3c0', 40, 30, 2.6, 0.5, { grav: -2, drag: 0.85, grow: 3 });
  fx.burst(p, '#ffb43a', 110, 34, 1.8, 1.3, { grav: -6, drag: 0.9 });
  fx.burst(p, '#ff5a1e', 80, 20, 2.6, 1.8, { grav: -2, drag: 0.93, grow: 2.5 });
  fx.burst(p, '#3a3a3a', 60, 14, 3.2, 3.2, { grav: 1.5, drag: 0.95, grow: 2 });
  fx.spawnDebris(p, '#5a5f68', 26, 26, 0.5);
  fx.shockwave(p, '#ffa030', 46, 0.9);
  fx.shockwave(p, '#ffd27a', 30, 0.6);
  // burning pieces streak out and fall away
  for (let i = 0; i < 14; i++) {
    const th = Math.random() * Math.PI * 2, s = rand(10, 26);
    fx.particle(p.x, p.y, p.z, Math.cos(th) * s, rand(4, 18), Math.sin(th) * s, '#ffcc66', 0.8, rand(1.4, 2.6), { grav: -12, drag: 0.98 });
  }
  world.player.cam?.addShake(0.8);
  world.applyImpact(p, 34, { damage: 70, knock: 22, up: 0.8, hitY: 1, propForce: 0, vehicleDamage: 40 });
}

/**
 * Split a dead aircraft into falling rigid chunks, appended to `chunks`. The
 * transport comes apart into nose, mid-body, tail, both wings and its four
 * engines (an escort never gets here — see `obliterate`).
 */
export function breakApart (world, a, chunks) {
  const groups = new Map();
  const box = new THREE.Box3(), c = new THREE.Vector3();
  const meshes = [];
  a.group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox).applyMatrix4(m.matrix);
    box.getCenter(c);
    let key = 'body';
    if (a.kind === 'titan') {
      if (Math.abs(c.x) > 4.6 && c.y < 8.2 && c.z > -8 && c.z < 8) key = 'engine' + (c.x > 0 ? 'R' : 'L') + (Math.abs(c.x) > 12 ? 'o' : 'i');
      else if (Math.abs(c.x) > 4.6) key = 'wing' + (c.x > 0 ? 'R' : 'L');
      else if (c.z < -13) key = 'tail';
      else if (c.z > 13) key = 'nose';
      else key = 'mid';
    }
    if (!groups.has(key)) groups.set(key, { meshes: [], center: new THREE.Vector3(), n: 0 });
    const g = groups.get(key);
    g.meshes.push(m); g.center.add(c); g.n++;
  }
  for (const [key, g] of groups) {
    g.center.divideScalar(g.n);
    const grp = new THREE.Group();
    grp.name = 'Wreck ' + key;
    grp.position.copy(a.group.localToWorld(g.center.clone()));
    grp.quaternion.copy(a.group.quaternion);
    for (const m of g.meshes) { m.position.sub(g.center); m.visible = true; grp.add(m); }
    world.scene.add(grp);
    const r = Math.max(2.5, Math.min(14, Math.cbrt(g.n) * 3.2));
    const out = _a.copy(grp.position).sub(a.pos).setY(0);
    if (out.lengthSq() < 1) out.set(rand(-1, 1), 0, rand(-1, 1));
    out.normalize();
    chunks.push({
      group: grp, pos: grp.position, quat: grp.quaternion, radius: r,
      vel: a.vel.clone().multiplyScalar(0.85).addScaledVector(out, rand(6, 22)).add(_b.set(rand(-6, 6), rand(4, 18), rand(-6, 6))),
      angVel: new THREE.Vector3(rand(-1.5, 1.5), rand(-1, 1), rand(-1.5, 1.5)),
      smokeT: 0, settled: false, life: 0, fireT: rand(3, 8), key
    });
  }
}

/** Tumble, bounce, land with a bang, burn for a while, then clear. */
export function updateChunks (world, chunks, dt) {
  const map = world.city, fx = world.effects;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const k = chunks[i];
    k.life += dt;
    if (k.sinking) {
      // gone under: drift down through the water, then vanish
      k.pos.y -= 1.4 * dt;
      k.vel.multiplyScalar(Math.pow(0.6, dt));
      k.pos.addScaledVector(k.vel, dt);
      const ang = k.angVel.length() * dt;
      if (ang > 1e-6) { _ax.copy(k.angVel).normalize(); _dq.setFromAxisAngle(_ax, ang); k.quat.premultiply(_dq); }
      k.angVel.multiplyScalar(Math.pow(0.5, dt));
      if (Math.random() < dt * 6) fx.particle(k.pos.x + rand(-k.radius, k.radius) * 0.5, k.waterY + 0.1, k.pos.z + rand(-k.radius, k.radius) * 0.5, rand(-0.3, 0.3), rand(0.5, 1.5), rand(-0.3, 0.3), '#dff2fb', rand(0.4, 0.9), rand(0.5, 0.9), { grav: -2, drag: 0.9 });
      k.group.position.copy(k.pos);
      k.group.quaternion.copy(k.quat);
      if (k.pos.y < k.waterY - k.radius * 3 || k.life > 25) { world.scene.remove(k.group); chunks.splice(i, 1); }
      continue;
    }
    if (k.settled) {
      if (k.life > 45) { world.scene.remove(k.group); chunks.splice(i, 1); }
      else if (k.fireT > 0) {
        k.fireT -= dt;
        if (Math.random() < dt * 8) fx.particle(k.pos.x + rand(-k.radius, k.radius) * 0.5, k.pos.y + rand(0, k.radius * 0.5), k.pos.z + rand(-k.radius, k.radius) * 0.5, rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5), '#3a3f47', rand(1.5, 3), rand(1.5, 2.5), { drag: 0.94, grow: 2.2, fade: 0.6 });
      }
      continue;
    }
    k.vel.y -= 20 * dt;
    k.vel.multiplyScalar(Math.pow(0.985, dt * 60));
    k.pos.addScaledVector(k.vel, dt);
    const ang = k.angVel.length() * dt;
    if (ang > 1e-6) { _ax.copy(k.angVel).normalize(); _dq.setFromAxisAngle(_ax, ang); k.quat.premultiply(_dq); }
    k.smokeT -= dt;
    if (k.smokeT <= 0) {
      k.smokeT = 0.06;
      fx.particle(k.pos.x, k.pos.y, k.pos.z, rand(-2, 2), rand(1, 3), rand(-2, 2), '#2f343a', rand(2, 4), rand(1.4, 2.4), { drag: 0.93, grow: 2.6, fade: 0.55 });
      if (Math.random() < 0.5) fx.particle(k.pos.x, k.pos.y, k.pos.z, rand(-3, 3), rand(1, 4), rand(-3, 3), '#ff8a2a', rand(1, 2), rand(0.4, 0.8), { drag: 0.9, grow: 1.6 });
    }
    if (map.bounceMoving(k.pos, k.vel, k.radius * 0.6, 0.25)) { k.angVel.multiplyScalar(0.6); fx.burst(k.pos, '#c9d2dc', 10, 8, 0.4, 0.3, { grav: -7 }); }
    // into the sea: a splash, a hiss of steam, and it goes under
    if (map.isWater(k.pos.x, k.pos.z)) {
      const wl = map.waterLevel(k.pos.x, k.pos.z);
      if (k.pos.y <= wl + k.radius * 0.6 && map.groundHeight(k.pos.x, k.pos.z, k.pos.y + 1) <= wl + 0.05) {
        k.sinking = true; k.waterY = wl; k.life = 0;
        fx.burst(_a.set(k.pos.x, wl, k.pos.z), '#dff2fb', 40, 12, 1.2, 0.9, { grav: -7, drag: 0.9 });
        fx.burst(_a, '#ffffff', 20, 6, 2.0, 1.4, { grav: -1, drag: 0.94, grow: 2.5 });
        fx.ring(_a, '#cfe8f2', 1, 9 + k.radius, 0.8);
        world.player.cam?.addShake(0.2);
        continue;
      }
    }
    // same clearance the wall bounce uses, so a chunk resting on a roof settles too
    const g = map.groundHeight(k.pos.x, k.pos.z, k.pos.y + 1) + k.radius * 0.6;
    if (k.pos.y <= g) {
      k.pos.y = g;
      k.settled = true;
      k.vel.set(0, 0, 0); k.angVel.set(0, 0, 0);
      k.life = 0;
      fx.burst(k.pos, '#ffb43a', 40, 16, 1.1, 0.9, { grav: -6, drag: 0.9 });
      fx.burst(k.pos, '#ff5a1e', 24, 9, 1.6, 1.2, { grav: -2, drag: 0.93, grow: 2 });
      fx.shockwave(k.pos, '#ffa030', 8 + k.radius, 0.55);
      fx.spawnDebris(k.pos, '#4a4f57', 10, 12, 0.3);
      world.player.cam?.addShake(clamp(0.2 + k.radius * 0.05, 0, 0.7));
      world.applyImpact(k.pos, 8 + k.radius * 1.2, { damage: 70, knock: 22, up: 0.7, hitY: 0.8, vehicleDamage: 120, propForce: 40, propRadius: 10 + k.radius });
      _dq.setFromEuler(new THREE.Euler(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)));
      k.quat.premultiply(_dq);
    }
    k.group.position.copy(k.pos);
    k.group.quaternion.copy(k.quat);
  }
}

export function clearChunks (world, chunks) {
  for (const k of chunks) world.scene.remove(k.group);
  chunks.length = 0;
}
