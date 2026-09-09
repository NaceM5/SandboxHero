# SANDBOX HERO

An open-world superhero sandbox that runs in the browser. A procedurally generated
city with autonomous traffic, a pedestrian crowd, and a city-wide crime field you
tune yourself. No assets to download — every building, vehicle and character is
generated at load time.

## Running it

```bash
node server.js 8232
```

Then open <http://localhost:8232>. Any static file server works; `server.js` just
disables caching so edits show up immediately. Three.js is pulled from a CDN via
the import map in `index.html`, so the first load needs a network connection.

Click the page once to capture the mouse. **Tab** opens the sandbox menu.

## Controls

| | |
|---|---|
| `W A S D` | Move |
| `S` (in flight) | Thrust backwards |
| `Shift` | Sprint on foot (separate speed from jog) · **sprint flight** while flying |
| `Space` | Jump · hold to ascend · **double-tap in flight to disengage** |
| `Ctrl` / `C` | Descend · dive · land |
| `W A S D` (in water) | Swim · `Shift` to sprint · `Space` to take off |
| `Alt` + scroll | Quick-tune an attribute · `1`–`6` picks which |
| `F` | Toggle flight |
| `T` | **Transform** — civilian ⇄ super suit |
| `1` – `5` | Switch powerset |
| Left mouse | Primary power · **chucks the held object** while force-holding |
| Right mouse / `G` | Secondary power (hold) |
| `Q` | Ultimate |
| `E` | Enter / hijack the nearest vehicle |
| `V` / wheel | Camera distance |
| `P` | Spawn a crime nearby |
| `Tab` | Sandbox menu · `Esc` release mouse |

## The three powersets

**PARAGON** — the flight set. Superman-style: a fist-forward cruise that goes
head-first as you build speed, banks into turns, cracks a sonic boom past
~90 m/s, and lands in a three-point crouch that cratered the pavement. Primary is
a three-hit melee combo (jab, cross, uppercut), secondary is sustained heat
vision from the eyes, ultimate is a ground slam — or, in the air, a dive-bomb
that detonates on impact.

**KINETIC** — telekinesis. Primary fires force bolts. Secondary grabs whatever
the crosshair ray passes through, out to **85 m** — pedestrians, enemies, moving
cars, burnt-out wrecks, lamp posts, trees, and the air-conditioning units, water
tanks and antenna masts off the rooftops.

**The throw comes from the motion, not the button.** While you hold, the grip
tracks how fast it's actually being swung. Let go while the view is still and
the object simply drops at your feet; whip the camera and release and it's
hurled, with power scaled by the swing speed. Holding still also *reels the
object in* toward you rather than keeping it at arm's length.

That's expressive but hard to aim, so **left-click while holding chucks the
object straight down the crosshair** instead of firing a bolt — a flat, fast,
accurate throw when you want one, with the swing throw still there when you
want the arc.

Anything thrown **bounces off buildings** rather than sailing through them:
collision is a swept AABB push-out with reflection (`City.bounceMoving`), not a
ray march, so a fast object can't tunnel through a wall between two frames.

Anything already in the air — a tumbling body, a car mid-flight, falling debris
— gets a much more forgiving pick cone, so snatching things out of mid-air is
easy. Debris that has landed stays fully interactive and can be picked straight
back up. Ultimate is a repulsor nova that lifts everything in a 26 m radius.

**PHANTOM** — teleportation, with a shadow step that reaches about **240 m**.
**You can only go where you can see**: every blink
runs a line-of-sight check first, so it won't put you through a wall into the
next room or behind a target standing against one. Every jump is a shadow cloud you dissolve into and
re-form out of: a dense dark core that swells and hangs, a violet bloom through
it, and wisps curling away — `grow` is what sells it, the particles expand as
they die rather than shrinking to nothing. The body arrives folded in on itself
and snaps open through an over-extended flare before settling (`bamfIn`), with
the rig scaling up past full size and stretched tall as it forms. Scaling from
nothing on its own just reads as a pop; this gives the arrival a shape. Primary blinks you onto whatever the crosshair is
holding and cuts it in the same motion, so closing thirty metres and landing
the hit are one button. Secondary is a shadow step to wherever you're aiming,
out to 70 m; it refuses to put you inside a wall, pushing the landing spot clear
first and cancelling if that moved it far, because a teleport into solid
geometry is worse than one that fails. Ultimate is a flurry: one blink per
enemy through up to six of them, appearing beside each in turn.

**VILTRUM** — flight is the state you live in, not a move. Flying into the
ground doesn't put you down; you skim along it. The only ways out are holding
descend all the way to the floor, the flight toggle, or a double tap of jump.
Primary is a heavy melee. Secondary **flies you over and physically takes hold**
of whatever the crosshair has — a person by the throat in front of you, anything
else hoisted over your head. Ultimate is a smash: from height it drives you
straight down and detonates on arrival, from the ground it's a standing
shockwave.

Whatever you have hold of is *in your hands*, so it goes exactly where you go.
The shared hold helpers ease toward the grip at a fixed rate, which suits a
telekinetic tether but leaves a carried car fifteen metres behind you at flight
speed — so for this one the position is set outright.

Carrying something, **left click hurls it**; simply letting go hands over
whatever momentum the grip had, so carry someone gently and they drop, sling
them and they go. And you can **fly them into things** — the grip sits out in
front of you or over your head, so it meets a wall or the ground before you do,
and carrying somebody into a building at speed hurts them and everything around
the point of impact.

**SOLAR** — plasma. Primary throws bolts, secondary is a sustained flame stream,
ultimate is a slow meteor with a 20 m blast.

### What you can shove

Running or flying into a person or a car barges it out of the way. The impulse
is taken from the **closing speed at the moment of contact**, so brushing past
someone nudges them and hitting them at 40 m/s sends them properly flying — and
you shed a little speed yourself. Sprinting into a parked car at 17 m/s shoves
it about 17 m and dents it.

Anything still rooted to the ground is a different matter. Lamp posts, trees,
rooftop units, water tanks and the needles on top of the towers all carry slim
colliders — sprinting into a lamp post at 27 m/s stops you dead and the lamp
doesn't move a millimetre. They only become movable once a power tears them off
the ground; after that they're loose debris you can kick around by running into
them (about 11 m at a sprint).

### Everything hits everything

Every offensive power lands through one shared `World.applyImpact` call, so
there's no power that only works on some things. A punch, a slam, a plasma
bolt, a meteor, heat vision, a repulsor nova, an exploding car and a thrown
lamp post all knock people down, damage and shove vehicles, and tear loose
street furniture — lamp posts, trees, and the air-conditioning units and water
tanks on the rooftops, which are solid enough to stand on until something rips
them off. Cars carry health, so any sustained damage
source will eventually destroy one, and a burnt-out wreck is still a physical
object — it can be punched, blasted, thrown and blown around, it just doesn't
drive any more.

Melee aims at the crosshair rather than the direction the body happens to be
facing: it acquires the best target in a cone under the reticle, snaps the body
round to it, and takes a short step in so a swing at something just out of
reach still lands.

Flight is available from any powerset by default; the Hero tab can restrict it to
PARAGON only.

## Quick-tune

Hold **Alt** and a panel lists six raw attributes — strength, run speed, jump
power, flight speed, flight acceleration, max health. Scroll to change the
highlighted one, press `1`–`6` to pick a different one. Values go straight into
the same settings the menu writes, so they persist. Powers and camera zoom are
suppressed while Alt is down so you can't fire something by accident.

## Crowd

Civilians only enter the road at the mid-block crosswalks, and they check for
traffic before stepping off the kerb — the test projects each car forward along
its heading and asks whether it will reach the crossing within about two and a
half seconds, so someone waiting doesn't balk at traffic on a parallel street.
While they wait they look both ways. Walking into a wall makes them pick a side
and slide along it rather than grinding into the brickwork.

They also notice trouble: anyone within ~42 m of an active crime reacts, and
the split is deliberately weighted toward running — only people caught right on
top of it (inside ~14 m) may freeze and cower instead. Fleeing follows the
pavement graph rather than a straight line, so panicking crowds still use the
crossings.

Civilian population is driven by how much building is packed onto each block.
The city sums the built volume (footprint area × height) per block at
generation time and normalises it, so a downtown tower block has a busy
pavement and the low-rise fringe stays quiet — roughly a 1.8× difference in
people within 70 m.

Rather than spreading a fixed population thinly over three square kilometres,
the crowd **streams**: anyone who drifts (or is thrown) past ~1.35× the crowd
radius is recycled onto a density-weighted pavement node near you, biased
toward the near half of the radius and never inside your field of view. The
same 190 people therefore always read as a full city.

Cost is kept down two ways: posing 19 bones is the expensive part, so distant
pedestrians animate at a half or a third rate with accumulated time (so clips
still play at the right speed), and past ~70 m the small parts — hands, feet,
hair, neck — are hidden, cutting about a third of each character's draw calls.

## Flight

Upright hover until you're genuinely moving *horizontally* — the lean blend is
keyed off ground speed, so climbing straight up levitates rather than pitching
over. Past about 17 m/s the hero tips into the head-first cruise. Banking comes
from the turn rate, the strafe input and the camera yaw rate, so whipping the
view around rolls the hero into the turn, scaled by speed. `S` is an air brake
rather than reverse thrust, and a double-tap of `Space` drops out of flight
exactly like `F`.

The cape is verlet cloth with a hard half-space constraint against the shoulder
plane, which is what stops a fast turn or a steep climb whipping the whole sheet
over the hero's head and leaving it draped down the chest.

**Free fall** has real authority rather than a token drift: near-ground-level
acceleration, faster turning, and `Ctrl`/`C` tucks to drop faster while `Space`
spreads out and slows the descent to a glide.

### Two kinds of flying

A **normal flight** and a **sprint flight** (`Shift`) are deliberately
different things, not one speed slider:

|  | Normal flight | Sprint flight |
|---|---|---|
| Body | Upright, levitating | Tips head-first into the travel direction |
| Arms | Down and relaxed | Fist forward, then both fists at speed |
| Top speed | 52 m/s | 118 m/s |

The lean and the raised fist belong to the sprint alone — a normal flight stays
upright however fast it happens to be going.

### Rolling

Past a threshold, a hard whip of the view doesn't just lean the hero into the
turn, it throws them through a **barrel roll** — a full 360, or two if you whip
harder still. Once committed the roll runs to completion under its own
momentum rather than tracking the mouse, so it reads as a deliberate aerobatic
move instead of a twitch, and it holds the ruler-straight pose all the way
round. A gentle look never triggers one.

Hard turns also **scrub speed**. Cornering for free is what makes flight feel
weightless rather than fast.

Releasing `Shift` at speed drops the cap from 118 to 52 m/s. Snapping the
velocity to the new cap kills the momentum dead, so the excess bleeds off at a
fixed rate instead and you coast down out of the sprint. Letting go of the
controls entirely damps gently while you're still fast and only bites hard once
you're slow enough to want to park precisely.

### Diving

Falling is not flying, but a fast flat fall still reads as a dive. Past sprint
speed the body pitches into the direction of travel, and how far is set by how
lateral the fall is — skimming out flat puts you nearly horizontal, dropping
straight down leaves you upright, and it's biased so that any real lateral
component already reads as a dive. Arms sweep back; the raised fist stays with
the sprint flight.

## The map

**One fixed world, not a random one.** Every generation-time decision runs off a
single seeded PRNG (`Rng` in `core/Util.js`), so the map is identical on every
load — same skyline, same coastline, same bridge, same lamp posts.

Riverdale is **two islands in one sea**, joined by a single bridge.

| | West island | East island |
|---|---|---|
| Character | The city | The county |
| Districts | Pier, Harbor, **Downtown**, Stadium, Industrial, Midtown | Beach, Neighborhoods, University, Business Park, Countryside/Farms |
| Feel | Dense towers up to ~420 m, grey streets, docks | Low-rise, green, a wide sand beach on the ocean side |

Zoning is hand-authored block by block in `City.districtAt()` rather than
sampled from noise, and the ground itself is tinted per district — grey between
the downtown towers, green through the neighborhoods and farms, sand along the
coast. Without that the whole map reads from the air as parkland with towers
dropped on it.

### Land and sea

The coastline comes from two signed-distance island fields perturbed at three
scales: broad bays, then coves and headlands, then a fine fringe kept
deliberately longer than the 22 m ground mesh — at a shorter wavelength the
waterline aliases against the grid and turns into a sawtooth.

`landField()` is positive inland and negative at sea and doubles as a
distance-to-shore measure, so beaches, shallows and the seabed all fall out of
the same function. Roads only link two junctions when **both ends and the
midpoint** are on land, which keeps the network off the water without a
special case; the bridge row is the sole exception.

### Terrain

Elevation runs from a −16 m seabed to a ~100 m massif on the south-east. Hills
are broad cosine bumps whose amplitude-to-radius ratio is held near 0.15, and
the result is then **capped by distance from the shoreline** (`h = min(h, f *
114)`). Fading hills out with a smoothstep instead puts a cliff wherever a tall
hill reaches the coast, because the whole drop has to happen inside the fade
band; a linear cap bounds the coastal gradient directly and leaves the hill
alone inland. No land anywhere exceeds ~20°, which is what lets a 120 m city
block sit on a hillside at all.

Everything derives from the same heightfield: pavements and kerbs are
tessellated to follow the slope, road markings are laid onto it (sampled per
corner, so they sit 10 cm above the asphalt on a gradient rather than floating
over it), street furniture sits on it, and vehicles pitch to match the gradient
they're driving on.

### Roads are cut in, not draped over

A carriageway is **level across its width** and holds a **constant grade along
its length** between one intersection and the next. Sampling the raw terrain at
each corner of a road quad instead banks the road sideways on any cross-slope —
the road visibly leans with the hill and cars roll along tilted. So
`roadGrade()` returns the carriageway height and how strongly the road governs
the ground there, and `terrainY()` blends the hills toward it: full authority on
the asphalt, easing back to the natural slope across the verge. That is
cut-and-fill, and because every consumer reads `terrainY`, the ground mesh,
pavements, buildings, props and actors all agree about where the road is.

Worst cross-slope on any road is now under 3°, against 19° before; roads still
climb hills at up to about 19° along their length.

### The street layout

Junction positions are the lattice, **pulled off it** in the low-density areas.
Everything that lays something out along a street — the asphalt ribbon, lane
markings, kerbs, lamps, street trees, the pavement graph — steps along the real
segment and offsets to its own normal, rather than assuming a 140 m
axis-aligned run.
Downtown stays a clean grid, which is what a downtown is; out in the
neighbourhoods and the countryside the junctions wander up to ~32 m, so streets
meet at odd angles and run at different lengths. Street lengths now span
86-185 m and about a third of junction angles are more than 12 degrees off a
right angle.

Segments are still straight between junctions, so traffic, pedestrians, kerbs,
markings and street furniture all kept working unchanged — they were already
written against node positions rather than against the grid. Block interiors
come from `blockRect()`, the rectangle that clears all four bounding streets,
so pavements and houses stay off the road however the junctions moved.

### Breaking up the grid

A perfect lattice at one spacing everywhere is the single thing that most makes
a city read as generated. Downtown keeps its dense grid — that part is true to
life — but `_planCuts()` deletes a share of the segments elsewhere, weighted by
how built-up the area is, merging cells into larger blocks of varying size and
leaving lanes and cul-de-sacs behind. A repair pass puts back whatever that
stranded, so the network stays a single connected component and nothing ends up
marooned.

Junction degrees tell the story: what used to be almost entirely four-way
crossroads is now 21 dead ends, 42 through-points, 45 T-junctions and 29
crossroads. Asphalt, markings, kerbs, lamps, traffic routing and the pavement
graph all read `_linked`, so they follow from that one set of cuts.

### Pavements

A pavement is a footpath around the edge of a block, not a plaza covering it.
Paving the whole rectangle left every block as a slab of concrete with the
buildings stranded in the middle; the band is 7 m at the kerb and the interior
stays as ground for gardens and yards.

### Street furniture

Trees come in four canopy shapes crossed with four greens, with per-tree scale,
lean and trunk height on top, and they're thinned out at random — a street of
one repeated blob reads as copy-paste instantly, and so does a tree outside
every single door. Lamps and street trees are only placed along a frontage that
is actually built on, so neither turns up standing in the middle of a field.

Buildings are founded on the **lowest** ground under their footprint, not the
height at their centre — a centre sample leaves the downhill corner hanging in
the air. Sitting on the low corner buries the uphill side instead, which is what
a real foundation does.

### The penthouse

One of the tallest towers in the city and the only one with a shape of its own:
a broad podium, a shaft tapering through five setbacks with **chamfered corners
and vertical fins** running its full height, then a collar flaring back out to
carry the occupied floors, topped with a spire. The chamfers are what stop it
reading as another rectangular block — `box` is axis-aligned, so they are
45-degree prisms run up each corner with `beam`.

Its **top three floors you can walk through**, each ringed by a deep terrace
behind a solid parapet with a staircase between them, and a **large circular
helipad cantilevered clear of the east face** at about 380 m on raking struts,
with perimeter lights and a lit H. Enemies spawn on all three floors. Same
construction as the mansion — thin wall slabs with the doorways left as gaps —
with near floor-to-ceiling glazing divided by mullions into a run of separate
windows — one unbroken band per floor reads as a stripe, and the piers between
the panes are what make it read as windows at all. Its block
is marked as its own district so nothing procedural grows there, but it keeps
its pavement.

The pad is flush with the roof and overlaps it: raised even slightly it becomes
a ledge you can't climb onto. The roof parapet has a gap where the walkway
leaves, or the pad is fenced off from the building that carries it.

A porch slab has to be a **ring** between the walls and the parapet. Laid as one
full-footprint slab it also seals the stairwell in the floor above, and every
flight becomes a dead end.

### Materials indoors

The three walk-in buildings share a small family of materials rather than one
flat shade: matte for masonry and decks, a glossier one for glass and painted
steel that keeps a highlight, and a self-lit one for interiors, floors and
markings. After dark the lit and glossy surfaces hold their own light while the
matte shells only lift a little, so the mansion, the tower and the ship keep
their shape instead of all flattening into the same grey silhouette.

The tower's shaft also has to stop *under* the first floor slab rather than
flush with it: ending level puts the shaft's top face and the floor's top face
at exactly the same height, and the two z-fight.

### The warship

A battleship moored out in the channel: walkable main deck behind a solid
bulwark, superstructure, funnels, mast and turrets. It is the busiest place in
the game for enemies, and it can only be reached by air or by sea.

This needed a fix in `groundHeight`, which returned the sea as the floor the
moment it saw water and never looked further — so the deck was invisible to
everything that asks what the ground is, and you fell straight through it into
the channel. Water is now the starting floor rather than an early exit, and
anything moored on top of it still counts.

### The carrier

An aircraft carrier moored alongside the battleship, and the only ship with an
inside. The **flight deck is the roof of the hangar**: the deck slab is its
deckhead, the hull sides are its walls, and the stern is left open, so you walk
or fly straight in. Angled landing strip, arrestor wires, deck-edge lifts and a
starboard island above; a strip-lit hangar with a column rank and deck lines
below. Enemies work both levels — five stations up the flight deck and two down
in the hangar.

Side walls have to run nearly the full length. Covering only the middle leaves
the aft third open to the sea on both sides and it reads as a covered platform
rather than a hangar.

### The estate

A third, much smaller island sits out in the channel south of the bridge, with a
**mansion on it you can walk into** — the only building in the world with an
inside.

Every other building is a solid block: a box you collide with and stand on top
of. This one is built from thin wall slabs with gaps left in them, so the
existing collision handles the interior for free. You walk through a doorway
because there is nothing there, and a window is a band of nothing between a
sill and a head, which stops you at waist height without needing any glass.
Floors work because `groundHeight` only accepts surfaces at or below the ceiling
it is handed: standing downstairs the first-floor slab is over your head and is
ignored, and once you climb the stairs it becomes the floor.

Two storeys, a central hall with rooms either side, a staircase to the first
floor, a terrace with front steps, and a portico. The roof is solid, so you can
land on it. There is no road to it — fly or swim.

The island is deliberately expressed as distance-to-shore over the same 520 m
denominator as the two big ones. Reusing their form at a 96 m radius would make
the field fall off five times as fast, and the beach ramp and road grading that
hang off it are tuned to the main islands' gradient — the shore would come out
as a cliff.

It has no pavement graph, so the crowd never streams out to it and the island
stays yours. Enemies still turn up — it is one of the fixed crime sites — but
pedestrians never do.

### The bridge

A proper suspension bridge carrying the only crossing between the islands: two
steel towers with cross-bracing, a catenary main cable with vertical hangers, a
stiffening truss under the deck, kerbs, railings and lighting.

The deck is a quad ribbon whose ends carry the real deck height at each station.
Building it from the axis-aligned box helper is what turned the arch into a
flight of stairs: a box has a flat top, so every segment sat level and stepped
up to the next. The deck meets
land **exactly at grade** at both abutments and arches ~23 m over the channel in
between. Deck height is folded into `groundHeight()`, so cars, pedestrians and
the hero all cross with no special-casing. Painted crossings and stop lines are
suppressed on the span and its approaches — they are painted onto the terrain,
which on the bridge is the seabed twenty metres below.

The road graph and the pavement graph are both severed across the water, so
traffic and pedestrians are genuinely forced onto the bridge; pathfinding has no
other option.

### Crossings

The pavement graph links facing mid-edge nodes of neighbouring blocks, and that
link is only a **crossing** — something to paint a zebra on, and to check for
traffic before using — when a street actually runs between the two blocks.
Where the grid has a hole, or out on the beach, the two pavements simply join
up; marking those as crossings scattered zebra stripes across open ground.

The paint goes exactly where the crowd crosses. Painting crossings at the
junctions while the graph crossed mid-block meant pedestrians stepped into the
road over bare asphalt while the markings sat somewhere they never used.

### Swimming

The hero doesn't walk on water. Falling in triggers `enterWater()`: the body
settles until the torso is just **under** the waterline, holds horizontal and
face-down, and swims at 3.4 m/s
(7 m/s sprinting) with a wake trailing behind. Reaching anything solid you've been lifted level with — the shore, a deck, a
quay — climbs you out automatically.

Two things that made the water a trap. `pos` is the **feet**, and the mesh hangs
a metre above it, so floating the feet at the waterline leaves the whole body
out of the water, crawling across the top of it; the float height has to account
for that offset. And `Space` used to leave the water and *then* try to take off
— with a powerset that can't fly, and flight restricted to PARAGON, that dropped
you into the sea with `swimming` off, so you sank and re-entered every frame with
no way up. It now only leaves the water if flight actually engages, and
otherwise kicks you clear of the surface. Holding the ascend key also beats the
restoring force rather than losing to it, so you can always climb out.

Pedestrians and traffic avoid water entirely — anyone who ends up over it is
pulled back to the nearest pavement node.

## Crime

### Fixed sites

Enemies at a fixed site guard the **place**, not a spot on the pavement: each
one takes a station, holds it for several seconds, then moves to another. The
warship's six run the length of the hull, so a two-hundred-metre ship isn't
crewed entirely amidships; the penthouse has one inside and one out on the porch
per floor. Each crime also starts at a random point in the rota, or several
small groups all begin at post zero.

As well as the density field, trouble always finds three places: the **warship**
(much the busiest), the **penthouse** floors, and the **estate**. Roughly a
third of crimes go to one of them. A site never draws a pursuit — there is no
road out there to drive on — and never a crime with a civilian victim, because
spawning one would put a pedestrian somewhere the crowd has no business being.

### Pursuit

An enemy takes a car and tears around the city shooting at whoever is on the
pavement. They ride **inside** it — the body is parked on the car's position so
everything that hunts for enemies still finds them, and hidden, with their AI
suspended so they don't try to walk while being driven. The crime marker travels
with the car.

**Interfering with the car in any way at all makes them bail out**: ramming it,
shooting it, blasting it, or picking it up with telekinesis. That's a single
`onDisturbed` hook on the vehicle, fired from the traffic system's impact and
hijack paths and from the telekinetic grab, so anything that touches the car
counts without each power having to know about the crime. Once out, they are an
ordinary enemy on foot.



Crime is **not** spawned around the player. A static density field is built once
per world from layered noise plus the downtown zoning, normalised, and then
sampled to choose where each incident appears — so the city has permanent hot
blocks and quiet ones, and the minimap shows the field as a heat overlay.

- **Crime density** scales the field's amplitude and how sharply spawning favours
  hot blocks. At low density only the very hottest blocks ever produce anything.
- **Difficulty** shifts the enemy tier roll: Street Thug → Enforcer → Syndicate →
  Warbringer. Thugs brawl; the higher tiers shoot, take far more punishment, and
  wear heavier armour and cowls.
- Incident types: mugging, armed robbery, carjacking, gang shootout, extortion.
  A carjacking crew will actually steal a car from the traffic system and drive
  off recklessly in it, dumping the driver onto the pavement.

Group size, aggression, spawn interval and the active-incident cap are all
separate sliders.

## Vehicles

Six body types — sedan, coupe, hatchback, SUV, pickup and van — each built by
extruding a hand-authored side profile with a rounded bevel, then merged with
wheel-arch lips, rocker sills, bumpers, wing mirrors and (where appropriate) a
roof rack. Glass is a separate inset shell with a seated driver behind it.

Traffic runs on the intersection graph. Each car A\*s to a random destination,
follows right-hand lane offsets, obeys a city-wide signal cycle, brakes for the
car (or person) in front, and slows into corners via a bicycle steering model.
At the end of a trip it claims a kerb bay on the final block, pulls past it, and
reverses in along a Hermite curve — a real parallel-parking manoeuvre — then sits
for a while before pulling back out.

Buildings are solid — collision is tested at the front and rear axle so a long
car can't push its nose through a wall. Steering is limited by an implied
lateral-acceleration cap, so handling is speed-sensitive rather than pivoting on
the spot. The AI drives to a physical grip budget; the player gets an arcade one
plus a floor on steering authority, which puts the turn radius at roughly 16 m
at 16 m/s — tight enough to actually take a city corner. A deadlock breaker
re-routes anything that sits still without being held at a red light, and
relocates it if that doesn't clear, so mutual yielding can't gridlock the grid.
Wrecks are recycled back into traffic after ~26 s rather than blocking a lane
forever.

You can hijack any of them with `E`. So can the enemies. Telekinesis can pick one
up and throw it; anything thrown tumbles ballistically and explodes on impact.

## Surfaces line up with what you see

A long tail of clipping came from the collision surface and the rendered
surface disagreeing. All of these were real:

- **North-south road quads were wound backwards**, so every one of them was
  back-facing: invisible from above, and you saw the grass straight through the
  road.
- **Lamp posts and tree trunks were treated as floor.** They register colliders
  so you can walk into them, but `groundHeight` was returning the top of an
  invisible seven-metre lamp as standable ground.
- **Roof trim overhangs its wall by 0.25 m**, and the collider was sized to the
  wall — a lip you could see and stand on in the render but fell through in the
  physics.
- **`groundHeight` searched one block; collision searched nine.** A roof whose
  block differed from the sample point's was invisible, and you fell through it.
- **The 28 cm kerb lift was added to every off-road point in the world**, which
  put the standing surface a foot above the grass across the whole countryside.
  It only belongs where a pavement was actually built.
- **Rooftop props are drawn yawed but their colliders were not**, leaving the
  turned corners with nothing solid behind them.
- **Paint sitting on a surface z-fights with it.** The walk-in buildings build
  both faces on every slab, so a deck marking's underside lands exactly on the
  deck it is painted on. A few centimetres of daylight fixes it and is invisible
  from any angle you can stand at. Deck-edge lifts overlapping the flight deck
  had the same problem in plan.
- **Two surfaces built to the same height z-fight.** The battleship's twelve
  hull segments all ended exactly at deck level, as did the deck slab, so the
  renderer couldn't choose between them and the deck came out in bands. The
  same thing had the penthouse shaft fighting its first floor. Anything that
  carries something else now stops just under it.
- **Aiming was clamped to a fixed sea-level plane.** Fine in the street, wrong
  everywhere else: pointing down from a rooftop, a ship's deck or the penthouse,
  the ray was cut off at y = 0 far below the surface you were standing on, so a
  long-range aim landed in the sea a few metres away. It now follows the real
  ground under the ray.
- **The line-of-sight march gave up after 120 steps**, so anything past about
  108 m was "visible" by default — which a 240 m teleport very much notices.
- **The ground mesh was drawn at the same height as the road on top of it.** The
  terrain is now sunk beneath any made surface, over a ramp wide enough for the
  mesh to actually resolve.
- **A staircase was a wall.** The collider keeps your centre outside its
  footprint, so you could never get over a step to be lifted onto it.
  `resolveCollision` now takes a step-up allowance and ignores anything low
  enough to walk onto — a stride's worth for the hero, slightly less for the
  crowd.
- **A box's underside is never built**, which is invisible everywhere in a city
  of solid blocks and very visible indoors, where the ceiling came out as a hole
  to the sky. The mansion builds both faces, and has its own material with a
  floor of emissive: its interior surfaces face away from the sun and there are
  no real lights in the scene, so a ceiling lit only by the sky renders black.
- **Pavement rings could sit out over the water** where a block met the shore,
  and the crowd stood on the sea. Ring nodes are now pulled back onto land.

A second pass found more of the same, all found by raycasting the actual meshes
and comparing against `groundHeight`:

- **North-south road quads were offset along a world axis**, which only makes a
  24 m ribbon when the street happens to run along that axis. Once junctions
  came off the lattice it skewed the asphalt into a parallelogram.
- **Lane markings were axis-aligned rectangles**, so on a skewed street a dash
  became a big lozenge. Paint is now laid with an oriented `stripe()`.
- **The paint was wound face-down** and so was invisible from above.
- **Collision read the analytic terrain while the render drew flat triangles
  across it.** In every dip the chord sits above the curve, so the grass
  rendered above where characters stood and they sank into it — people hiding
  in the lawn. `groundSurface()` now walks the same two triangles the mesh is
  built from, off a baked lattice.
- **Nothing reconciled the three ground meshes.** Open ground, asphalt and
  footpath are each built their own way, so `groundHeight` takes the HIGHEST of
  whichever apply. Standing a few centimetres proud of a surface is barely
  noticeable; standing below one means sinking into it.
- **Wide buildings on a slope were founded on their lowest corner**, which
  never floats but buries the uphill side — a warehouse on a hillside lost its
  whole ground floor. They now sit on the middle of the footprint and carry the
  downhill side on a plinth, cut in at the back and built up at the front.

Walkable surfaces now agree with the render within 20 cm across **95%** of the
map, worst case about 0.8 m high or 2.6 m low, against a worst case of 109 m at
the start.

## First person

The zoom keeps going. Wheel the camera all the way in past the shoulder view and
it becomes first person — the hero is hidden once the camera is close enough to
be inside their head — and wheeling back out returns to third. `V` cycles
through the same set with first person as its first stop. Driving is excluded;
it reads badly from inside your own head.

## Keeping the camera out of the floor

Three separate things were putting the camera through floors, and the sweep was
only the first of them.

- **The collision march stepped every six metres**, straight over a
  thirty-centimetre floor slab. It now sweeps every 30 cm with a radius of
  clearance and stops short of the first surface.
- **The ground clamp looked two metres up.** It called `groundHeight` with a
  ceiling above the camera, found the floor of the storey *overhead*, and lifted
  the camera to it — through the ceiling and into the room above, which is the
  very thing it was supposed to prevent. It clamps against **terrain only** now;
  buildings are the sweep's job and it has already done them.
- **The shoulder offset could push the pivot inside a wall or a staircase.**
  With the sweep starting from inside geometry there is nowhere legal to go, so
  the camera stayed stuck in it. The offset is given up rather than the
  position: the pivot walks back toward the hero until it is in open air.

Across 2,700 orientations — every pitch, every yaw, several stances on each
floor of the mansion, the penthouse and the carrier's hangar — the camera now
ends up inside geometry **zero** times.

## Line of sight

Enemies can't see or shoot through walls. `raycastBuildings` steps every six
metres, which is fine for picking a target but walks straight through a
half-metre wall, so line of sight gets its own march at a step smaller than
anything you can hide behind. Awareness only builds while they can actually see
you and decays behind cover, so breaking line of sight really does break the
engagement. A window is not a wall — an opening you can see through is one they
can shoot through.

## Out of their depth

Knocked into water with no seabed within reach — off the warship, say —
characters tread water and strike out for the nearest shore instead of standing
on the bottom. They can't fight from out there, and an enemy has **thirty
seconds** before they go under. Civilians are invulnerable and simply swim back.

## Characters and ledges

Actors used to be clamped straight to `groundHeight` every frame, which is what
made someone who walked off a roof teleport down to the street: the surface
under them changed by fifty metres in one frame and they simply appeared there.
Anything taller than a kerb now hands them to gravity instead, carrying the
horizontal speed they walked off the edge with, until they meet a surface — and
a real drop puts them down in a ragdoll rather than landing neatly.

The hero had the mirror-image problem going **downhill**: the ground fell away
faster than gravity pulled him into it, so he left the surface and re-landed
every single frame and the whole descent juddered. He now stays glued while the
drop is no more than a stride's worth, and steps off anything bigger properly.

They also **look before they step**. Both pedestrians and enemies probe the
ground ahead and treat a drop as a wall: carried up onto a building their route
still points at a street node far below, so without it they'd march straight
over the parapet. Advancing into a ledge gets redirected along it, and if the
edge boxes them in they hold position. An enemy chasing you across a roof will
pull up at the edge instead of following you off it.

## Camera

Over-the-shoulder, framed like a modern third-person shooter: the camera looks
*along* the aim axis from a laterally offset pivot rather than looking at the
hero, so the crosshair sits at dead centre pointing at whatever you're aiming at
and the character is pushed about a quarter of the way toward the left edge. The
offset is a fraction of the camera distance, so the framing holds whether you're
zoomed in or pulled right out. Driving drops the offset to zero and the camera
swings back behind the car a moment after you stop moving the mouse.

## Minimap

The map turns under a fixed arrow, so it always reads "what's in front of me is
up". It follows the **camera**, not the hero's facing — the camera is where the
player is actually looking, and tying it to the body makes the map swing around
every time the character turns on the spot. North rides around the rim as the
map turns, and off-map crimes pin to the edge rather than vanishing.

## Sandbox settings

Everything persists to `localStorage`. **World**: time of day (full day/night
cycle with a physically-keyed sky, sun and window-light response), **Daylight**
(exposure), **Ambient fill** (lifts shadowed faces and alleys without washing
out the sun), **Bright mode** (a see-everything preset that lifts shadows, cuts
haze and holds the window lights up), bloom, render scale, draw distance,
**Crowd size** (how many civilians exist at once) and **Crowd radius** (smaller
packs the same people closer around you), and vehicle count.
**Crime**: as above.
Powers are the character's, not the costume's: all three powersets and flight
work in civilian clothes too. The suit is a look.

**Hero**: health on/off, invulnerability, max health, regeneration, and
multipliers for strength, **jog speed and sprint speed separately**, jump power,
and **cruise and sprint flight speed and acceleration separately** — they are
two different ways of flying, so one pair of multipliers can't serve both; energy can be disabled entirely. **Super Suit** and **Civilian**:
colours, cape, emblem, mask style (none / domino / visor / full cowl), accent
glow, build and height — both outfits are edited independently and the transform
swaps between them.

## How it's built

```
src/
  core/      settings (persisted), input, math + noise helpers
  world/     road graph & parking bays, city geometry, water, sky, props
  char/      procedural rig, hand-authored pose library, animator, verlet cape
  player/    locomotion + flight model, camera spring arm
  powers/    the three powersets and the projectile system
  ai/        actor base, pedestrians, enemies, crime density system
  vehicles/  instanced vehicle rendering, traffic & parking AI
  fx/        particles, beams, shockwaves, debris
  ui/        HUD + camera-up minimap, settings menu
```

A few things worth knowing if you want to extend it:

- **The value-noise hash must stay in int32.** The original version computed
  `x * A + y * B + seed * C` in floating point, where the seed term was ~1e25 —
  large enough that adding the ~1e8 coordinate terms was a no-op in float64. The
  hash returned the same number for every coordinate, so the entire noise field
  was flat and both the skyline and the crime map degenerated into plain radial
  gradients. `Math.imul` plus XOR mixing keeps the multiplies exact.
- **Ragdolls are articulated** (`char/Ragdoll.js`). Thirteen verlet particles
  sit at the real joints — hips, chest, head, both shoulders/elbows/hands, both
  knees/feet — held together by distance constraints, with minimum-distance
  pairs stopping limbs folding through the torso. Limbs swing, trail and fold
  on their own instead of the body rotating as one lump, and **every particle
  collides with the ground and with buildings individually**, which is what
  stops an arm or a shin sinking through the pavement when the pose disagrees
  with a single capsule hitbox. `applyToRig()` converts the point cloud back
  into bone rotations: the torso gets an orthonormal basis from the spine and
  shoulder axes, and each limb bone is aimed down the segment it represents.
  The doll is seeded from whatever pose the character was animating, so
  standing → flying is continuous; on recovery the animator cross-fades out of
  the physical pose rather than snapping. Bodies carry a mass, so a Street Thug
  flies further than a Warbringer. Civilians are flagged invulnerable: they can
  be thrown around all day, panic, and get back up, but never die.
- **Characters** are built from lathed, tapered solids of revolution, so limbs
  are smooth rather than boxy. Geometry is cached by a quantised build/height
  key — crowd characters snap to a coarse size ladder so 110 pedestrians share
  roughly two dozen geometries instead of building 1,500.
- **Animation** is a hand-authored pose library (`char/Animations.js`) with
  cross-fading and additive layers for look-at, breathing and damage flinch.
  Every bone's geometry hangs down −Y from its pivot, so negative `rotation.x`
  swings a limb forward. The comment block at the top of that file has the full
  sign convention.
- **Flight orientation** is built as an explicit basis rather than Euler angles:
  local +Y is aligned to the travel direction and rolled by the bank angle, then
  slerped against an upright hover pose by a speed-driven blend. That's what
  makes the transition from hovering to head-first cruising read correctly.
- **The city** merges building geometry per block into two draw calls (window
  facades and trim), which keeps the total low while still giving the renderer
  block-sized chunks to frustum-cull. Vehicles are instanced per body type with
  a single global wheel mesh.
- The whole simulation costs about 0.4 ms per step for 110 pedestrians, 48
  vehicles and a dozen active incidents, so the frame budget is essentially all
  rendering.

## Known rough edges

- Enemies path directly toward their target rather than navigating around
  buildings, so they can get hung up on a corner in dense blocks.
- Vehicles don't yield to each other at intersections beyond the signal cycle;
  two cars turning simultaneously can clip. The deadlock breaker cleans up after
  it rather than preventing it.
- Ragdoll limbs don't self-collide beyond a few minimum-distance pairs, so an
  arm can still pass through the torso in an extreme pose.
- The ragdoll is tuned for a fixed 60 Hz step; the impulse encoding assumes it.
- Crowd streaming teleports civilians when they're far away and behind you. It
  checks the view cone, but a fast enough turn can in principle catch one.
- Wrecks are recycled on a timer, so a car you deliberately parked somewhere as
  scenery will eventually vanish and rejoin traffic.
- **Objects that land are given a brief immunity before they can be launched
  again.** Without it a wrecked car is caught in its own explosion blast, gets
  re-thrown, lands, explodes again — bouncing forever. Any new destructible
  needs the same `skipVehicle`/`skipProp` exclusion and rest cooldown.
- The water is a flat shaded plane — it has waves in the shading but no real
  displacement, refraction or shoreline foam.
- The bridge is the only crossing, so wrecking traffic on it can back both
  islands up until the deadlock breaker clears it.
- The coastline is drawn on a 22 m ground mesh, so the waterline is visibly
  faceted close up. The shoreline noise is deliberately kept longer-wavelength
  than that grid to avoid aliasing, which also limits how ragged the coast can
  get.
- Swimming has no underwater state — you float at the surface and cannot dive.
- **Streets are straight between junctions.** Junction positions are irregular
  now, so streets meet at varied angles and lengths, but no road actually
  curves. Real curves need each segment to become a polyline that traffic and
  the pavement graph follow, not just the mesh — otherwise cars cut the corner.
- Suburban blocks are irregular quadrilaterals, but the pavement and the houses
  are placed in the largest axis-aligned rectangle inside them, so the corners
  of a skewed block are left as grass.
- Where a segment was cut, the two blocks either side are separated by a strip
  of open ground rather than being merged into one larger lot with buildings
  across the join.
- Road grading assumes the segment between two junctions is straight, which it
  always is here; a curved road would need the grade sampled along the curve.
- The over-the-shoulder camera means the aim ray runs about 1.6 m to the side of
  the hero's centreline. That's correct for the framing, but it does mean the
  crosshair is not aligned with where the character is standing.
- Detached props settle at a random flat angle rather than resolving their real
  resting orientation against the ground.
- Civilians can't be killed — they're knocked down and panic instead. That's
  deliberate for a sandbox, but it means enemy-vs-civilian violence never
  resolves.
