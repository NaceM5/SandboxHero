# TITAN 60 — standalone parked heavy airlifter

Photo-inspired, stylised strategic transport in the same construction as the
Atlas 42: convex-hull lofts and primitives, dark grey panelled finish. NOT
registered with or imported by the game. All files are confined to this folder.

## Files
- `Titan60.js`: procedural Three.js factory `createTitan60()` with named components and collision helpers.
- `titan-60.glb`: portable visual model with PBR materials; no external textures. Collision solids are supplied separately.
- `collisions.json`: 29 named local-space collision prisms.
- `preview.html`: orbitable viewer with the default player rig, the Atlas 42 alongside for scale, and a collision overlay. `?view=hero|rear|scale|atlas|collision` selects a view on load.
- `previews/`: screenshots rendered from this asset.

Dimensions: 50.3 m wingspan × 51.8 m length × 18.2 m height — roughly twice
the Atlas 42 in every direction. Units are game metres; +Y up, +Z nose. Origin
is at ground level beneath the fuselage centre; the landing gear rests on y = 0.

## Layout
High-mounted swept wing with anhedral (the tips droop 1.9 m), a wing-root
fairing over the spine, four underwing turbofans on pylons with fan faces and
exhaust cones, a deep circular fuselage with a swept-up tail and closed cargo
ramp, main-gear sponsons carrying three twin-wheel bogies each side, a
twin-wheel nose leg, a tall swept fin with a T-tail stabiliser and an insignia.

## Claude handoff
Same contract as the Atlas 42:

```js
import { createTitan60 } from './assets/aircraft/titan-60/Titan60.js';
const plane = createTitan60();
const position = [x, groundY, z], yaw = 0, scale = 1;
plane.group.position.set(...position); plane.group.rotation.y = yaw; plane.group.scale.setScalar(scale);
scene.add(plane.group);
for (const record of plane.getColliders({ position, yaw, scale })) map.colliders.add(record);
```

`getColliders` returns `makePrism` records (translation, yaw, positive uniform
scale). The prisms are conservative verticals: the sloped fuselage roof, the
drooping wing segments and the stabiliser have extra collision space, and the
space beneath the wings and between the engines stays open. Fuselage sections
overlap by 2 cm so there is no seam. Use `plane.raycast(raycaster)` for exact
surface hits. `plane.createCollisionDebug()` returns the wireframe group.

Not implemented: cabin, cargo bay, boarding, flight, animated gear, destruction.

## Preview
`npm start`, then open `http://localhost:8232/assets/aircraft/titan-60/preview.html`.
