# Game sound sources

Downloaded from Uppbeat using the project owner’s account on 2026-09-10. These are licensed third-party assets, not original project audio or public-domain files. Download license IDs are recorded below and in `sources.json`.

| Game file | Artist / effect | Download license |
| --- | --- | --- |
| takeoff | [GFX Sounds — Superhero takeoff & flying](https://uppbeat.io/sfx/superhero-takeoff-flying/162600/42032) | 4024968 |
| landing | [GFX Sounds — Superhero flying & landing](https://uppbeat.io/sfx/superhero-flying-landing/162599/42029) | 4024970 |
| flight | [GFX Sounds — Superhero flying at super speed](https://uppbeat.io/sfx/superhero-flying-at-super-speed/162604/42038) | 4024971 |
| whoosh | [GFX Sounds — Superhero whoosh transition](https://uppbeat.io/sfx/superhero-whoosh-transition/162598/42028) | 4024972 |
| beam | [Jochi SFX — Laser eyes energy beam](https://uppbeat.io/sfx/laser-eyes-energy-beam/11833/30606) | 4024973 |
| explosion | [GFX Sounds — Explosion & debris crumbling](https://uppbeat.io/sfx/explosion-debris-crumbling/167215/58851) | 4024974 |
| step1 | [GFX Sounds — Footstep on concrete (Sneaker)](https://uppbeat.io/sfx/footstep-on-concrete-sneaker/166367/47465) | 4024976 |
| step2 | [GFX Sounds — Footstep on concrete (Sneaker)](https://uppbeat.io/sfx/footstep-on-concrete-sneaker/166367/47464) | 4024977 |
| wind | [SmartSound FX — Wind - light steady breeze](https://uppbeat.io/sfx/wind-light-steady-breeze/1666/1525) | 4024978 |
| punch1 | [betacut — Punch - classic impact](https://uppbeat.io/sfx/punch-classic-impact/11214/29569) | 4024979 |
| punch2 | [betacut — Punch - crunch impact](https://uppbeat.io/sfx/punch-crunch-impact/11225/29580) | 4024980 |
| punch3 | [betacut — Punch - dry impact](https://uppbeat.io/sfx/punch-dry-impact/11223/29578) | 4024981 |
| engine | [Sonic Bat — Car engine - mazda MX-5 idle (2000 RPM)](https://uppbeat.io/sfx/car-engine-mazda-mx-5-idle-2000-rpm/5672/20322) | 4024982 |
| gun | [FascinatedSound — Desert eagle pistol - single shot](https://uppbeat.io/sfx/desert-eagle-gun-single-shot-1/5024/19567) | 4024983 |
| select | [Davies Aguirre — UI click - soft tap](https://uppbeat.io/sfx/ui-click-soft-tap/167922/56503) | 4024985 |
| success | [Vadi Sound — Digital UI - software update success](https://uppbeat.io/sfx/digital-ui-software-update-success/165589/51370) | 4024990 |

| metalCrash | [Jochi SFX — Metal crash](https://uppbeat.io/sfx/metal-crash/9716/25811) | 4025094 |
| carCrash | [Jeff Kaale — Car crash - metal crunch](https://uppbeat.io/sfx/car-crash-metal-crunch/163984/46243) | 4025095 |
| city | [GFX Sounds — Distant city traffic ambience](https://uppbeat.io/sfx/distant-city-traffic-ambience/162578/41945) | 4025096 |
| woodCrash | [Jochi SFX — Wood smash impact](https://uppbeat.io/sfx/wood-smash-impact/8460/24817) | 4025097 |
| stoneCrash | [ZeroFrame Audio — Rubble collapse](https://uppbeat.io/sfx/rubble-collapse/167056/58249) | 4025098 |
| ocean | [Bosnow — Ocean waves - calm ambient loop](https://uppbeat.io/sfx/ocean-waves-calm-ambient-loop/162985/43251) | 4025099 |
| birds | [Ivo Vicic — Birds chirping in forest](https://uppbeat.io/sfx/birds-chirping-in-forest/7738/23685) | 4025101 |
| splash | [Jochi SFX — Splash - impact into water (Big)](https://uppbeat.io/sfx/splash-impact-into-water-big/3023/13243) | 4025102 |
| grunt | Joshua Chivers — Male grunt (soft) (Uppbeat; added 2026-09-10, downloaded with the project owner's account) | — |
| grunt2 | SmartSound FX — Grunt in pain, male (long 2) (Uppbeat; added 2026-09-10, downloaded with the project owner's account) | — |

Edits: mono conversion for positional playback, silence trimming, peak normalization and short edge fades. Wind, engine and beam WAVs use crossfaded loop seams. `shot.mp3` is a short excerpt from the laser beam; `transform.mp3` uses the superhero whoosh, while `whoosh.mp3` is shortened and accelerated for melee. Other variations in-game use modest playback-rate and volume changes.

The game loads these local files; no Uppbeat session, credentials or expiring download links are needed at runtime.

Sonic boom revision: `sonicBoom.mp3` retains only source seconds 0.10–0.82 of the superhero flight recording, with a low-pass filter and short fade; the electrical tail is not played. The older `flight.mp3` is retained as a source reference and is not loaded by the game.

City, ocean and bird ambience uses 22.05 kHz mono WAV excerpts with one-second crossfaded seams. Material crashes and splashes are normalized and trimmed. Ambience responds to local road density, coast proximity, altitude, cover and daylight; its volume can be set independently in the World menu.
