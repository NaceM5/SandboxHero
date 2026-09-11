# ATLAS 42 — standalone parked aircraft

Photo-inspired, stylized armored transport. NOT registered with or imported by the game. All new files are confined to this folder.

## Files
- `Atlas42.js`: editable procedural Three.js factory, with named components and collision helpers.
- `atlas-42.glb`: portable visual model with PBR materials; no external textures. Collision solids are supplied separately.
- `collisions.json`: 19 named local-space collision prisms.
- `preview.html`: independent orbitable viewer, actual default player rig comparison, and collision overlay.
- `previews/`: screenshots rendered from this asset, not generated concept images.

Dimensions: 26.7 m wingspan × 17.13 m length × 9.6 m height. Units follow game units (metres); +Y up, +Z nose. Origin is at ground level beneath the fuselage center. The default player rig measures about 1.855 m visually, with a 1.88 m gameplay collider. Preview uses the real rig at its default scale, without the separately simulated cape.

## Claude handoff

Read this README and `Atlas42.js` before integration. Prefer the procedural factory in this repository; use the GLB when a portable mesh is needed. Do not load both visuals.

```js
import { createAtlas42 } from './assets/aircraft/atlas-42/Atlas42.js'; // adjust import relative to caller
const plane = createAtlas42();
const position = [100, 0, 100];
const yaw = Math.PI / 4;
const scale = 1;
plane.group.position.set(...position);
plane.group.rotation.y = yaw;
plane.group.scale.setScalar(scale);
// At integration time: scene.add(plane.group).
const solids = plane.getColliders({ position, yaw, scale });
// Register these records with the map's existing collider collection / spatial index.
// See src/world/Colliders.js and src/world/Map.js for the registration path.
```

`getColliders` returns existing `makePrism` records. It supports translation, yaw and positive uniform scale; pass the same transform used by the visual. It does not register records automatically. Rebuild/reindex records after changing a transform. Pitch, roll, nonuniform scale, flight physics and animated landing gear are not implemented.

Solids cover fuselage sections, wings, engines, tail fins and all landing gear assemblies. They preserve open space under the wings. These are conservative vertical prisms: sloped fuselage roofs and canted fins have extra collision space. For exact projectile/picking surface intersections, use `plane.raycast(threeRaycaster)` or raycast the GLB mesh. Walkable tops follow prism tops, not the exact visual slope. Small trim, lights, fans and seams intentionally have no individual solid.

`plane.createCollisionDebug()` returns the local turquoise wireframe group. Apply the aircraft transform to its parent before inspecting a placed instance. Debug geometry is not included in the GLB.

## Preview
Run the repository's normal static server (`npm start`) and open:
`http://localhost:8232/assets/aircraft/atlas-42/preview.html`

The preview uses the same Three.js 0.169.0 CDN imports as the game. It does not start or modify gameplay. Four view buttons and mouse orbit controls are provided.

This is an exterior parked prop, with no cabin, boarding logic, flight controls or destruction behavior. Integration remains for Claude.
