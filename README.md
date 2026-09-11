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
| `]` / `[` / `P` | In a car: radio next song / back (restarts the song if it's under way, else the previous one) / play–pause. During a battle on foot: next battle song / restart / play–pause |
| `V` / wheel | Camera distance |
| `P` | Spawn a crime nearby (on foot; in a car it is the radio play/pause) |
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

Carrying someone into a building at speed hurts them, and the damage is
read inside the flight collision itself — from the speed you were doing
straight into the wall, before the wall takes it away. (The carry power's own
crash check runs after the flight step, by which time a wall has already
zeroed your speed; it still handles scraping the ground.)

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

### Meridian Campus

The gated office campus on the north of Harbor Island is nobody's business
but its own. Its access road is a **rare** route with no footway and no
parking bays, so no car or civilian is ever spawned on it, routed to it or
wanders up it, and crimes never spawn there; the crowd streaming, which only
ever drops people on footway nodes, has nowhere to put anyone inside the
fence. The people there are **staff in dark suits** — 57 of them, with an
appearance of their own (`randomSuit`) — stationed on posts rather than on
the footway graph: twenty-six around the grounds (the paths, the garden
walks, the outdoor terraces, the car park, the security gate), eight in the
research lobby, fourteen upstairs among the desks, the glass-walled
conference room and the managing director's office in the rear corners, and
thirteen in the secure basement split between the offices (which have a
conference room of their own at the west end) and mission control, so nobody
has to cross a locked door. The posts sit in the aisles between the desk rows and
in open floor, never on a desk. The car park holds **real cars** from the
traffic system, parked nose to the wheel stops in about six bays out of ten,
outside the fleet count and never streamed or recycled — take one and it is
yours like any other. Each drifts between the posts of their own group, stands a while,
gawks at a suited hero, panics and runs to the post furthest from trouble,
and gives up on a post it can't reach. They sit outside the crowd count, the
streaming leaves them alone, and "World repopulated" puts them back.

## Sound

Everything you hear is a recorded effect from Uppbeat (sources and licence
IDs in `assets/audio/`), played through one Web Audio graph in
`src/fx/Audio.js` behind a master gain and a soft limiter. Files are fetched
during boot but nothing is decoded or played until the first click or key —
browsers won't start audio before a gesture — and the whole thing is muted
whenever the pointer isn't locked, the menu is open or the tab is hidden.

**Cues** are named in one table: punches, beam shots, enemy gunfire, the
takeoff and the whoosh, jumps and landings (a slam landing gets its own
heavier cue through the shockwave), footsteps paced by your speed, hurt,
transform, the sonic boom (only the initial pressure burst of the recording;
the electrical tail is cut), explosions, and material crashes. Each cue has a
gain, an optional playback rate, a range and a cooldown, picks a random
variant that isn't the one it played last, and jitters its rate a few
percent so nothing sounds looped. Positional cues fall off with distance and
pan left–right against the camera's yaw. Twenty-four voices at most.

**Beams on a target** — heat vision or the solar stream held on an enemy,
a car or a plane — get a hit sound of their own from the existing samples:
the laser excerpt slowed to a crackle every 130 ms and a low-pitched punch
thump every third of a second, both at the point of contact, on top of the
target's own grunts. A beam that is only burning pavement stays quiet.

**Voices** are two grunt recordings doing every job for enemies and
civilians — the cue never plays the same take twice in a row — told apart
by pitch and level: a hit (lower for a heavy one), a
throw, the hard stop at the end of a throw (read off the ragdoll's speed
loss against ground, wall or car), the effort of a melee swing, a civilian's
yelp as panic starts, being dragged off the street by the airlift crew, and
a low last breath on death. Each body gets one grunt per quarter second, so
a beating is a rhythm rather than a stutter.

**Crashes** come off the physics rather than the visuals: a prop bouncing
off a wall or hitting the ground, a car landing, bouncing, being shunted or
scraping a wall, anything hitting water. The material picks the sample —
metal, wood (trees, benches, bushes), stone (rocks), car — and the impact
speed and mass set the volume, so a slow bounce is a soft knock and a
thrown truck is not. Each body gets one crash per 160 ms, a resting body is
silent, and ordinary traffic clipping a kerb or nudging along in a queue
doesn't count as a crash.

**Music** — three songs in `assets/music/`, streamed one at a time in a
shuffled order with a few seconds' quiet between them — plays while nothing
is going on around you. Twice a second the game measures the distance to the
nearest trouble: the nearest active crime, the nearest living enemy, and any
scenario aircraft (counted at 60 % of its distance, since a jet overhead is
trouble from further off). Beyond 320 m the music is at full level; inside
70 m it is gone; it fades between. A song that fades out keeps running
silently rather than stopping mid-bar, so a fight in the middle of a track
doesn't restart it, and a new song only starts when things are calm. Its
own slider lives in the World menu.

**Battle music** — three songs in `assets/music/battle/` — is for the
battle scenarios (Sky Convoy, Airlift Raid, Aegis Takeover; the drive-by is
an ordinary crime and gets none) and the carrier garrison. It doesn't start
when the scenario does: it starts the moment you land your first hit on
something that belongs to the fight — a plane through the aircraft damage
bus, or a crew member or carrier guard through the hero's damage call — and
it plays one song on repeat until that fight is over: the scenario cleared
or aborted, or the carrier reset once you've flown far enough away. The
ambient music ducks out while it plays, and the next fight picks a fresh
song. While a fight is on and you're not in a car, `]` skips to the next
song (which then repeats instead), `[` restarts it and `P` pauses and
resumes it for the rest of that fight.

**The car radio** — five more songs in `assets/music/car/` — plays from the
dashboard while you drive: it fades up the moment you get in, fades down
over a couple of seconds when you get out and pauses where it was, so the
same song picks up when you take the wheel again, and the ambient music
ducks out while it has the cabin. From the driver's seat `]` skips to the
next song, `[` restarts the current one (or, in its first three seconds,
goes back to the previous one) and `P` is play/pause — the station stays
off until you press it again. Outside a car those keys do what they always
did. It sounds like a car radio because it
goes through a small-speaker chain before the mix: a high-pass at 340 Hz
and a low-pass at 3.6 kHz take away the lows and the air, a +5 dB presence
bump at 1.7 kHz gives it that dashboard honk, and a gentle tanh waveshaper
adds the saturation of a speaker being pushed. Its own slider is in the
World menu.

**Flying into a building** has a sound of its own: the flight collision
resolver knows how fast you were going straight into the wall (brushing
along one doesn't count), and above about 9 m/s it plays the same hit as a
hero landing, scaled by that speed.

**Ambience** is sampled twice a second from where you are: distant traffic
scaled by how busy the nearest footway is and how close you are to it, birds
where it's green and quiet, waves where the coast is within 150 m or you're
over water, and background wind that grows with altitude. All of it thins
with height (halved at 65 m up, gone in the clouds), drops to a fifth under
cover — the bridge, an overhang, indoors — and the birds go quiet at night.
The wind loop doubles as the sound of moving through the air: in flight its
level, pitch and brightness all climb with your speed and keep climbing well
past cruising, so a sprint roars where a glide whispers; falling gets the
same rush from your drop speed, starting a couple of seconds into a fall,
pitched lower and darker than flight. The car engine follows your speed the
same way; the beam loop plays while a persistent beam is live. Ambience has its own slider in the World menu, separate from
effects.

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
While they wait they look both ways. Once off the kerb they have the right of
way: they never freeze in the lane, they hurry if a car is bearing down, and
it is the car that brakes — every driver looks up to thirty metres ahead for
anyone in its path or walking into it (a reckless driver doesn't bother).
Walking into a wall makes them pick a side and slide along it rather than
grinding into the brickwork.

They also notice trouble: anyone within ~42 m of an active crime reacts, and
the split is deliberately weighted toward running — only people caught right on
top of it (inside ~14 m) may freeze and cower instead. Fleeing follows the
pavement graph rather than a straight line, so panicking crowds still use the
crossings.

Civilian population is driven by how much building stands near each stretch of
pavement. Every walk node sums the built volume (footprint area × height,
capped) within about 95 m of it at load and normalises on a cube-root curve,
so the financial core has packed pavements, the Eastbank high street is busy,
and a lane of hillside houses gets the odd passer-by.

Rather than spreading a fixed population thinly over 28 square kilometres, the
crowd **streams**: anyone who drifts (or is thrown) past ~1.35× the crowd
radius is recycled onto a busyness-weighted pavement node near you, biased
toward the near half of the radius and never inside your field of view. The
same 220 people therefore always read as a full city.

Cost is kept down two ways: posing 19 bones is the expensive part, so distant
pedestrians animate at a half or a third rate with accumulated time (so clips
still play at the right speed), and past ~70 m the small parts — hands, feet,
hair, neck — are hidden, cutting about a third of each character's draw calls.

## Flight

Flight integrates in sub-metre steps — a sprint covers two metres a frame,
enough to skip clean through a floor slab, a thin interior wall or the face of
a hill between one collision test and the next. Each step checks the ceiling
(the underside of any storey, roof or slab overhead is a hard stop from below,
in flight and on a jump), the ground, and the walls. Terrain ignores the
ground query's ceiling: nothing is ever legitimately inside a hill, so a query
from inside one reports the hillside, and a step that ends more than a metre
under it means the ground rose faster than the hero could follow — a hillside
or a cliff face, which is treated as a wall (stay put, lose the speed) rather
than popping up onto the top of it.

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

### Free fall

A fall that isn't a dive — no real lateral speed, dropping more or less
straight down — plays the tumbling fall pose, and now and then the hero
throws in a **tuck-and-roll**: knees to chest, arms wrapped round the shins,
a full somersault (usually forward, one in five backward) over a second and
a quarter, then out into the fall again. It only happens with enough height
left to finish the roll a good second before the ground, never while diving,
flying, swimming, in a car or mid-action, and if anything interrupts the fall
the body straightens at once.

### Diving

Falling is not flying, but a fast flat fall still reads as a dive. Past sprint
speed the body pitches into the direction of travel, and how far is set by how
lateral the fall is — skimming out flat puts you nearly horizontal, dropping
straight down leaves you upright, and it's biased so that any real lateral
component already reads as a dive. Arms sweep back; the raised fist stays with
the sprint flight.

## The map — Tideline

**One fixed world, not a random one.** The game runs on the Tideline map that
lives in `GameMap/`: a deterministic coastal world about **7.3 × 3.9 km**, one
unit per metre, X east, Y up, Z south. Its generator is ported verbatim into
`src/world/tideline/` (with Delaunator vendored as an ES module, since the game
has no bundler), so every load rebuilds the same geometry and the same
collision manifest in about two seconds instead of downloading the 35 MB
GLB/JSON export. Nothing in the copied generator is game-specific; when the map
is revised, copy its `src/` over the top and the game follows.

Two islands in one sea, joined by a suspension bridge:

| | Harbor Island (west) | Eastbank Island (east) |
|---|---|---|
| Character | The city | The hills |
| Districts | Financial core, old town, quays, working waterfront, station, sports field, piers, two viaducts | Hillside neighbourhoods, town centre, high street, port apron, highlands, a lake at 35 m |
| Streets | A rectangular grid of avenues, cross streets and service lanes | 27 curved, graded centrelines (grades capped at 14%) |
| Skyline | ~930 principal buildings, the tallest to 760 m | 700 rotated houses, apartments and shops with pitched roofs |

The Golden Strait bridge carries 38 m of carriageway and, added by the game,
a raised 8 m footway on each side of the deck and both approaches, so the
crowd crosses on a kerb rather than sharing the lanes with the traffic.

Three landmarks have real interiors or decks: **Aeris Tower** (street lobby, a
walk-through penthouse at 416 m, a projecting helipad), **Headland House** (a
mansion on a 124 m headland at the end of a winding drive) and a **360 m
aircraft carrier** anchored offshore. All three are crime sites.

### What the map ships, and what the game adds

The manifest carries structure records (boxes with an optional Y rotation,
polygonal prisms for the carrier hull and the sculpted tower, pitched roofs),
graded ramp slabs, island outlines with the terrain parameters, curved road
centrelines with elevations, the rectangular street layout, housing lots and
driveways, reserved park and square zones, water, spawns and the landmark
rooms. It **deliberately leaves out** vegetation, street furniture, people,
cars and any navigation graph, so those can be gameplay objects. Everything in
that list is built by the game on top of the map:

- `world/Terrain.js` — a triangle heightfield over the rendered terrain and road
  ribbons, so ground queries agree with the mesh exactly.
- `world/Colliders.js` — a spatial set of rotated boxes, prisms, ramps and
  pitched roofs behind the same `groundHeight` / `resolveCollision` contract
  the rest of the game was written against.
- `world/Roads.js` — the junction graph, lane waypoints, parking bays and the
  sidewalk graph.
- `world/Furniture.js` — lamps, trees, benches, bins and hydrants.
- `world/Map.js` — ties it together, plus water, night-time windows, spawn
  rooftops, the crowd and crime density fields and the landmark crime sites.

### Ground

The terrain is a Delaunay mesh (24 m spacing, refined along every road edge)
and the roads are triangle ribbons laid a few tens of centimetres over it.
Sampling the analytic terrain function between vertices would disagree with
what is drawn — feet in the grass on every hillside — so `groundHeight()`
reads the **same triangles the GPU draws**, bucketed on a 16 m grid, then
takes the highest structure top that lies at or below the ceiling it is handed.
The ceiling is what makes bridges, viaducts and interiors work: under the
Golden Strait deck the deck is above your head and ignored; on it, it is the
floor.

Water is per body, not one plane: the sea at 0 m and the hill lake at 35 m.
Anywhere no terrain triangle covers — the sea, the lake's hole in the mesh —
is water, and the water surface is the starting floor so a carrier deck or a
pier moored over it still counts.

### Collision

Every solid in the manifest becomes a collider with a `kind`. Rotated houses
are tested in their own frame rather than as an enclosing box (an axis-aligned
box around a turned house leaves invisible corners you walk into). Prisms use
their outline polygon. Ramps have a sloping top, so the bridge approaches and
viaduct ramps are driveable and their guardrails still block the edges. Pitched
roofs report their surface height at the point you are standing, so you can
walk up a gable and off the eave. Sloping surfaces get a generous lip in the wall
test — a probe a few centimetres under a ramp ahead of the body is standing on
it, and treating that as contact shoved cars sideways off the bridge approach. Slabs under half a metre thick — kerbs,
pavements, road surfaces — count as floor only, and the step-up allowance
carries you onto them.

### Roads

The map's routes are layout metadata, not a graph, so `Roads` builds one:

1. Rectangular streets become straight centrelines. Where one runs into a ramp
   slab (the bridge approach at z = −60) the part under the ramp is cut away so
   the street hands over to the ramp instead of continuing beneath it.
2. Ramps and the bridge and viaduct decks are added with their real
   elevations; the curved centrelines come in with the elevations the map
   graded them to.
3. Dead ends within 36 m of another street are joined to it, and every
   crossing between two centrelines becomes a shared junction — **only when
   their elevations agree** within a few metres, so an avenue passing under a
   ramp stays grade-separated.
4. Junctions are the vertices where centrelines meet; the polylines between
   them are edges with a width, a lane offset (a quarter of the width, clamped)
   and a length. Short dead-end stubs are pruned and the largest connected
   component is kept: 158 junctions, 262 streets, 72 km of centreline, west
   city to the highlands to the headland drive.

Traffic A\*s over that graph and drives lane waypoints offset to the right of
the polyline, so cars follow the curves rather than cutting corners. Every
trip starts by finishing the street the car is on — a re-plan (after parking,
a knock, a stall) resumes from the car's own lane, never from a junction it
would have to cross open ground to reach, which matters where two streets
share both end junctions. A lane that leads to a dead end ends in a proper
three-point turn: nose across the road on full lock, back up on the opposite
lock, drive off the other way. Every
"nearest junction" and "nearest footway" lookup is elevation-aware: a car
passing under the bridge approach must not be steered by the junction on the
deck above it, and someone in the water under the span heads for the quay,
not the footway thirty metres overhead. Nothing spawns beneath an overhead
structure either, and a wreck that lands in the water sinks and is recycled.
The private drive up to the headland estate is a **rare route**: cars pay six
times its length to route over it, random destinations and lane placements
almost never land on it, and its footway has a crowd weight near zero — so the
mansion stays quiet unless you bring the trouble yourself. Parking
bays sit against the kerb of any street 11 m or wider. Signals live at
junctions with three or more streets, with the stop line set by that
junction's own half-width. Because the map is so much larger than the fleet,
traffic **streams** the way the crowd does: cars that drive beyond ~1.5× the
traffic radius are recycled onto the streets around you.

### Sidewalks

Every street with a footway gets two chains of walk nodes, one each side, at
the pavement offset (the wide city pavements, the 2.5 m paving beside the
curved roads, the bridge's footways; none on the viaducts or their ramps). At
each junction the chain ends are sorted by angle around it: neighbouring ends
with a carriageway between them are joined as a **crosswalk**, the rest as a
corner. Long streets get a mid-block crossing. Civilians only step off the kerb
at crossing links and check for traffic first, exactly as before.

### Street furniture

All of it is torn-out-and-thrown props. Lamps every ~38 m down both sides of
the city streets and the bridge walks, every ~46 m alternating sides on the
residential hill streets; street trees, benches, bins and hydrants on the wide
city pavements; a garden tree on most housing lots, set at a corner of the lot
clear of the house and the driveway; trees, benches and bins scattered through
the civic squares, the lake park and the highland common; benches facing the
water around the lake shore. Then **woodland** on both islands: open ground is
filled from a jittered 8.5 m lattice thinned by two octaves of noise, so it
reads as copses, tree lines and clearings rather than an orchard, with bushes
at the margins. Cover is raised across the whole of Harbor Island, so the city
sits inside a belt of forest, and again around the headland estate, which
stands in its own wood. Then **boulders**: a band along every natural shore,
outcrops wherever the ground is steep, a scattering across the open hills and
a thick ring around the headland cliffs. Rocks are solid — you can stand on
them — and heavy enough to be worth throwing. Around 77,000 trees, 24,000
bushes and 3,600 rocks, all grabbable. Nothing is placed on a carriageway, a
driveway, a housing lot, a paved slab, a building footprint or the water.

Fifty thousand props need care to draw. Each forest tree is one merged
trunk-and-canopy geometry with baked vertex colours, tinted per instance, so a
species is one draw call per 480 m tile; tiles are frustum-culled with real
bounding spheres; and beyond 700 m a tile switches to a single merged mesh of
low-poly canopies (`THREE.LOD`), so looking across the island from the air
costs a few dozen draws instead of a thousand.

### Landmarks

Crimes at the fixed sites use the posts the map defines — stations along the
carrier's flight deck, the penthouse living room, bedroom, study, terrace and
helipad, the tower lobby and plaza, the mansion's rooms, forecourt and terrace
— and every enemy in a crew starts at a different post. The penthouse and the
mansion are built from individual walls with real door openings, so the
existing capsule collision handles the interiors for free. The Aeris elevator
portals in the manifest are not wired up; fly.

### Swimming

The hero doesn't walk on water. Falling in triggers `enterWater()`: the body
settles until the torso is just **under** the waterline, holds horizontal and
face-down, and swims at 3.4 m/s (7 m/s sprinting) with a wake trailing behind.
Reaching anything solid you've been lifted level with — the shore, a deck, a
quay — climbs you out automatically. The waterline is whichever body of water
you are in, so the hill lake works the same as the sea.

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

## Battle scenarios

Hold **M** for the scenario selector and press a number to launch one;
Backspace (or 0) while holding M aborts the running scenario. Scenarios live in
`src/scenarios/` and use the standalone aircraft assets in `assets/aircraft/`.

Four so far: **Sky Convoy** (1), **Airlift Raid** (2), **Drive-by** (3) and
**Aegis Takeover** (4).
A scenario's objective readout disappears the moment its objective is met —
every aircraft and every trooper it put on the map is down — even while its
wreckage is still burning; the manager keeps a cleared scenario ticking in the
background until the last chunk is gone, and the selector no longer shows it as
active.

### Sky Convoy

A **Titan 60** heavy airlifter crosses the map under escort from three
**Atlas 42** VTOL jets. The fleet enters from open water in a random compass
direction, about four kilometres out, and the transport then flies a patrol
of nine junctions chosen over land (never within 650 m of the Aeris Tower),
climbing over whatever is ahead of it, and every other leg bends toward
wherever you are so the fight keeps coming back to you. Over land it drops
**paratrooper squads** from the ramp — two to four at a time, a man a second,
every sixteen seconds or so, and only within a kilometre of you unless it has
been a long while since the last drop. Each squad is a crime of its own: it
gets a marker beam that tracks the nearest trooper (under the canopy on the
way down, then wherever they go), the objective readout and a minimap dot.
Troopers are ordinary enemies rolled from the difficulty knob, hanging under a
canopy that opens over a second and slows them to a drift; they switch to
their normal AI the moment they touch down (up to fourteen active at once).

The escorts hold a formation off the transport's quarters until you are a
threat, then fly **attack runs**: aim a little ahead of you, never below the
ground, cannon bursts when aligned inside 340 m, break wide and climb, come
back around. Every aircraft is an oriented box for hit tests, so anything that
goes through the damage bus hurts it — blasts, beams (the aim ray stops on a
hull), projectiles, and flying into one at speed. They take a lot of bringing
down (900 hp for an escort, 2,600 for the transport), and **weapon systems
degrade with damage**: below 55 % health one gun is out (smaller bursts,
slower, wider spread), below 30 % the guns are failing (single rounds, half of
them misfiring as sparks off the nose). Damaged airframes trail smoke, then
fire.

An escort under 35 % health **stops attacking and goes evasive**: jinks side
to side, throttle open, climbs when you close in, keeps its distance, throws
in barrel rolls, and only snipes from range now and then — bent back toward
the transport while it flies, and toward you once it is gone, so it never
simply leaves.

When the transport dies it **breaks into large sections** — nose, mid-body,
tail, both wings and all four engines — each a rigid chunk that tumbles down
trailing smoke and fire, bounces off buildings, and detonates where it lands,
damaging whatever is underneath. The wreckage burns for a while and is
cleared after 45 s. A dead escort doesn't fall at all: it goes up in one big
fireball where it flies — double flash, wide shockwave, a hail of burning
debris, hanging smoke — and anything inside the blast takes the hit. With nothing
left to guard, surviving escorts **turn on you**: they hunt you anywhere on the
map, and if you drop out of sight they circle high over where you were until
you show yourself again. The scenario ends when the last of them is down.

### Airlift Raid

The second scenario. A **Titan 60** comes in from the sea and puts down on one
of the two wide straight streets in Harbor City, whichever is nearer you,
settling vertically onto the road with its gear down (it is solid while it
sits there; traffic has to stop). Four raiders come down the ramp — a crime
of their own, with a marker — and fan out after the nearest civilians,
sprinting them down, dragging them back and shoving them up the ramp. If the
crowd is elsewhere, a few civilians are brought in so there is someone to
take. After six are aboard, or after about a minute, the crew boards, the
transport lifts off and flies to the **Aeris Tower helipad**, lands on it,
and unloads: the hostages are walked off the ramp, round the tail, along the
fenced access walkway and into the penthouse, where they cower in the living
room; the raiders take up guard posts around the pad. Then it goes back for
more, and keeps going until you stop it. Pad guards accumulate, up to a
dozen.

The whole thing is **scripted only until you interfere**: a raider that is
hurt, thrown or grabbed drops whoever it was dragging and becomes an ordinary
enemy; a civilian you grab or blast is released. The transport is an
oriented box for hits like the convoy planes, with the same tail turret and
the same degrading weapons. **Destroy it with people aboard and they all fall
out** — civilians and crew alike tumble clear of the fireball as ragdolls (the
civilians survive; they always do) — and whoever was already in the penthouse
is free to leave. The readout clears once the transport, its crew and the pad
guards are all down.

### Drive-by

The crime system's own pursuit crime (see **Pursuit** below), raised on
demand: a gunman on a street a few blocks from you — never on a bridge or
under one — takes the nearest car and goes on a shooting run, with the crime
marker following the car. It is run by the crime system exactly like a random
drive-by, so touching the car in any way makes the driver bail out and fight
on foot; the readout tells you whether the car is still moving. The scenario
ends when the crime resolves. Ordinary traffic bumping into the getaway car,
or the car mowing someone down, does not count as interference — only you do.

### Aegis Takeover

The Aegis helicarrier hovers 900 m over the city. A Titan 60 and three Atlas
42 escorts come in from the sea and the transport drops straight down onto the
lower flight deck, nose to the bow, and stays there — engines idling, tail
turret live — as the objective. Its boarding party of sixteen comes down the
ramp a man at a time and fans out: six to stations on the lower deck, five up
the connecting ramp to the raised aft deck (routed round the lift cabin and
clear of the operations bridge), and five who take the lift down to
headquarters, one to each room — command centre, lab, briefing room, lounge,
medical bay. Once on station they stand guard the way the carrier garrison
does, shuffling between posts; hurt one and it is an ordinary enemy again.
The escorts circle the ship at about 300 m and engage you whenever you are
within 750 m of it, never ranging more than 850 m from the deck; badly hurt
they go evasive but stay tethered to the ship. Destroy the transport with
raiders still in the hold and they fall out of it. The readout clears once
the transport, all three jets and every raider are down.

The helicarrier is also why "ground" placement is deliberate now: a query for
the highest surface under a point anywhere beneath the Aegis returns its
flight deck, so crowd spawns, crimes, victims, hijack ejections and street
furniture all use a street-level query that ignores anything more than six
metres above the terrain. Nobody wanders onto the deck by accident.

### The carrier garrison

The aircraft carrier is not a crime site and carries no marker while it is
left alone. Instead it has a standing garrison: an **Atlas 42 parked forward on the flight deck**,
gear down and solid enough to stand on, and **six guards** rotating between
deck stations. Hurt any of them — or the jet — and the alarm goes: the jet
lifts straight up on its fans, tucks its gear and flies the same attack runs
as the convoy escorts, **but only to protect the ship**: it never ranges more
than 700 m from the deck, returns to a hover over its spot the moment you
leave that radius, and goes evasive under 35 % health like any other jet.
From the first hit the ship carries a **battle marker** — the same beam, ring,
minimap dot and objective readout a crime gets, labelled "Carrier garrison"
with a count of what's left — that follows the nearest living guard, then the
jet once the guards are down, and goes when the last of them dies or the
ship resets.

Get more than about 1.1 km from the ship for a few seconds and it **resets**:
the jet flies home, settles onto its spot and stows its gear; dead guards are
replaced, the living healed and put back on station; a shot-down jet is
replaced once you are out of sight. The aircraft AI shared by the escorts and
the carrier jet lives in `src/scenarios/JetAI.js`.

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

Traffic runs on the junction graph built from the map (see *Roads*). Each car
A\*s to a destination a few streets away, follows lane waypoints offset to the
right of the street's polyline, obeys the signal cycle at junctions, brakes for
the car (or person) in front, and slows into corners via a bicycle steering
model. A re-plan starts from the junction the car is actually driving toward,
never the nearest one behind it — beginning a route with a U-turn on a ten-metre
hillside lane is how cars jam. At the end of a trip it claims a kerb bay on the
final street, pulls past it, and reverses in along a Hermite curve — a real
parallel-parking manoeuvre — then sits for a while before pulling back out.

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

Cars are solid to what is in front of them. Driving into people bowls them
over — civilians go flying and panic, enemies take damage as well, and in the
hero's hands the car does the hero's damage. Driving into another car shoves
it and dents it; a violent enough closing speed launches it. A car the hero
has driven is theirs: it is never streamed away, relocated by the deadlock
breaker or recycled as a wreck (the last three, so they don't pile up), and a
wreck that came to rest against a wall in mid-air drops to the ground.

You can hijack any of them with `E`. So can the enemies. Telekinesis can pick one
up and throw it; anything thrown tumbles ballistically and explodes on impact.

## Surfaces line up with what you see

A long tail of clipping came from the collision surface and the rendered
surface disagreeing. Most of the list below was found on the original
procedural city, and every rule it produced carries over to the Tideline
adapter — read ground from the rendered triangles, take the highest applicable
surface, keep slim props out of the floor, honour a step-up, never treat a
whole building as one box. All of these were real:

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
map turns, and off-map crimes pin to the edge rather than vanishing. It draws
the coastline and the lake from the map's island outlines and the streets from
the real centrelines — elevated decks brighter — plus the crime heat for the
cells in view.

## Sandbox settings

Everything persists to `localStorage`. **World**: time of day (full day/night
cycle with a physically-keyed sky, sun and window-light response), **Daylight**
(exposure), **Ambient fill** (lifts shadowed faces and alleys without washing
out the sun), **Bright mode** (a see-everything preset that lifts shadows, cuts
haze and holds the window lights up), bloom, render scale, draw distance,
**Crowd size** (how many civilians exist at once) and **Crowd radius** (smaller
packs the same people closer around you), vehicle count and **Traffic radius**
(the same idea for cars).
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
  world/     tideline/ (the vendored map generator), Map (the map as the game
             sees it), Terrain (triangle heightfield), Colliders, Roads (junction
             + sidewalk graphs, bays), Furniture (street props), Props (loose
             prop physics), Sky
  char/      procedural rig, hand-authored pose library, animator, verlet cape
  player/    locomotion + flight model, camera spring arm
  powers/    the three powersets and the projectile system
  ai/        actor base, pedestrians, enemies, crime density system
  scenarios/ aircraft flight model, shared jet AI, Sky Convoy, Airlift Raid, the carrier garrison
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
- **The map** is merged into one draw call per material (about forty), with
  meter-scaled procedural textures generated at load; facade and house
  materials also carry an emissive window map that `setNightFactor` fades up
  after dark. Street furniture is one instanced mesh per (geometry, material)
  pair. Vehicles are instanced per body type with a single global wheel mesh.
- Ground and collision queries are cheap enough to call freely: a
  `groundHeight` is a few point-in-triangle tests plus the colliders in the
  40 m cells around the point — around 0.35 µs downtown — and the whole
  simulation step costs about 3 ms for 220 pedestrians, 64 vehicles and a
  handful of incidents.

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
- The coastline is drawn on a 24 m terrain mesh, so the waterline is visibly
  faceted close up.
- Swimming has no underwater state — you float at the surface and cannot dive.
- Cars pitch to the road grade but never roll, so on a cross-slope the wheels
  on one side float slightly. The map keeps carriageways level across their
  width, so this only shows off-road.
- The signal cycle is still one city-wide two-phase clock keyed to whether a
  car is heading more north–south or east–west; on the curved hill streets that
  is arbitrary, though harmless.
- Parking bays are laid along every wide street, including the residential
  ones, so a parked car can sit across a driveway.
- The crowd never streams onto the carrier, the penthouse or the mansion — no
  footways lead there — so only enemies turn up at the fixed sites.
- The Aeris Tower elevator (the map's portals) is not wired; the penthouse is
  reached by air.
- Debris from the effects system bounces off an invisible horizontal plane at
  the height it was spawned, so on a hillside it can hover or sink.
- A tree torn out of the woodland still shows in the far-distance canopy mesh
  of its tile, so from more than 700 m away a thrown tree appears to be back.
- The over-the-shoulder camera means the aim ray runs about 1.6 m to the side of
  the hero's centreline. That's correct for the framing, but it does mean the
  crosshair is not aligned with where the character is standing.
- Detached props settle at a random flat angle rather than resolving their real
  resting orientation against the ground.
- Civilians can't be killed — they're knocked down and panic instead. That's
  deliberate for a sandbox, but it means enemy-vs-civilian violence never
  resolves.
