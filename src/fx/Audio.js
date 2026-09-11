// Recorded Uppbeat effects. Source pages and download license IDs live in assets/audio/.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const CUES = {
  impact: { files: ['punch1', 'punch2', 'punch3'], gain: .65, cooldown: .065 },
  blast: { files: ['explosion'], gain: .72, range: 220, cooldown: .12 },
  boom: { files: ['sonicBoom'], gain: 1.15, rate: .9, range: 300, cooldown: .35 },   // the clipped 0.65 s burst only; louder, carries further
  metalCrash: { files: ['metalCrash'], gain: .58, range: 140, cooldown: .09 },
  woodCrash: { files: ['woodCrash'], gain: .55, range: 110, cooldown: .09 },
  stoneCrash: { files: ['stoneCrash'], gain: .6, range: 130, cooldown: .09 },
  carCrash: { files: ['carCrash'], gain: .65, range: 180, cooldown: .12 },
  splash: { files: ['splash'], gain: .5, range: 100, cooldown: .15 },
  slam: { files: ['landing'], gain: .8, range: 130, cooldown: .22 },   // flying into a building: the hero-landing hit
  shot: { files: ['shot'], gain: .4, cooldown: .08 },
  // a beam on a target: the laser excerpt slowed into a crackle, and the
  // punch hits at a lower pitch as the thump of it landing
  sear: { files: ['shot'], gain: .5, rate: .62, range: 90, cooldown: .1 },
  burn: { files: ['punch1', 'punch2', 'punch3'], gain: .55, rate: .8, range: 90, cooldown: .12 },
  gun: { files: ['gun'], gain: .32, cooldown: .07 },
  whoosh: { files: ['whoosh'], gain: .28, rate: 1.65 },
  jump: { files: ['takeoff'], gain: .16, rate: 1.35 },
  takeoff: { files: ['takeoff'], gain: .5 },
  land: { files: ['step1', 'step2'], gain: .4, rate: .78 },
  heroLand: { files: ['landing'], gain: .7, range: 150, cooldown: .2 },
  step: { files: ['step1', 'step2'], gain: .19, cooldown: .1 },
  hurt: { files: ['punch3'], gain: .28, rate: .8, cooldown: .25 },
  grunt: { files: ['grunt', 'grunt2'], gain: .55, range: 75, cooldown: .09 },   // two takes, never the same one twice; a panicking crowd staggers its yelps
  transform: { files: ['transform'], gain: .38, cooldown: .3 },
  success: { files: ['success'], gain: .32, cooldown: .5 },
  select: { files: ['select'], gain: .3, cooldown: .08 }
};
export const LOOP_FILES = ['wind', 'engine', 'beam', 'city', 'ocean', 'birds'];
// Streamed, not decoded: three full songs would be a hundred megabytes of PCM.
export const MUSIC = ['oscillations-antarctic-wastelands', 'after-school-abstract-aprils', 'liminal-love-sky-cassette'];
const MUSIC_NEAR = 70, MUSIC_FAR = 320;   // silent this close to trouble, full this far from it
const MUSIC_GAP = [5, 12];                // seconds of quiet between songs
// Battle music: for the scenarios and the carrier garrison, from the first hit you land.
export const BATTLE = ['cut-the-wire-avbe', 'adrenaline-roger-gabalda', 'bad-boyz-sky-cassette'];
const BATTLE_TITLES = {
  'cut-the-wire-avbe': 'Cut the Wire — AVBE',
  'adrenaline-roger-gabalda': 'Adrenaline — Roger Gabalda',
  'bad-boyz-sky-cassette': 'Bad Boyz — Sky Cassette'
};
// The car radio: its own station, heard only from the driver's seat.
export const RADIO = ['funky-smoothie-hybridas', 'hot-lava-west-valley-shakers', 'rock-your-surfboard-yeti-music', 'hipsters-soundroll', 'sunset-ballin-kid-taro'];
const RADIO_TITLES = {
  'funky-smoothie-hybridas': 'Funky Smoothie — Hybridas',
  'hot-lava-west-valley-shakers': 'Hot Lava — West Valley Shakers',
  'rock-your-surfboard-yeti-music': 'Rock Your Surfboard — Yeti Music',
  'hipsters-soundroll': 'Hipsters — Soundroll',
  'sunset-ballin-kid-taro': 'Sunset Ballin — Kid Taro'
};
const AMBIENCE = new Set(['city', 'ocean', 'birds']);

export class GameAudio {
  constructor (world) {
    this.world = world;
    this.ctx = null;
    this.voices = 0;
    this.last = new Map();
    this.previous = new Map();
    this.buffers = new Map();
    this.loops = new Map();
    this.steps = 0;
    this.active = false;
    this.failed = [];
    this.contacts = new WeakMap();
    this.environment = { urban: 0, shore: 0, land: 1, height: 0, sheltered: false };
    this.environmentTimer = 0;
    this.music = null;                   // { el, source, gain, order, index, gapT, level }
    this.radio = null;                   // the car stereo: same shape, plus the speaker chain
    this.battle = null;                  // the fight music: same shape again
    this.engaged = false;                // the hero has hit something that belongs to a battle
    this.calm = 1;                       // 1 = nothing going on nearby, 0 = trouble on top of you
    // Fetch during boot; decoding and playback wait for the first user gesture.
    const files = [...new Set(Object.values(CUES).flatMap(c => c.files)), ...LOOP_FILES];
    this.downloads = files.map(async name => {
      const ext = LOOP_FILES.includes(name) ? 'wav' : 'mp3';
      try {
        const response = await fetch(new URL(`../../assets/audio/${name}.${ext}`, import.meta.url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return [name, await response.arrayBuffer()];
      } catch (error) {
        this.failed.push(name);
        console.warn(`Sound unavailable: ${name}`, error);
        return null;
      }
    });
    const unlock = () => this.unlock();
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx?.suspend().catch(() => {});
      else if (this.world.input?.locked) this.unlock();
    });
  }

  unlock () {
    try {
      if (!this.ctx) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        const c = this.ctx = new Context();
        this.master = c.createGain();
        this.master.gain.value = 0;
        const limiter = c.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 8;
        limiter.ratio.value = 6;
        limiter.attack.value = .003;
        limiter.release.value = .18;
        this.master.connect(limiter).connect(c.destination);
        this._startMusic();
        this._startRadio();
        this._startBattle();
        this.ready = Promise.all(this.downloads.map(async download => {
          const item = await download;
          if (!item) return;
          const [name, bytes] = item;
          try { this.buffers.set(name, await c.decodeAudioData(bytes)); }
          catch (error) { this.failed.push(name); console.warn(`Invalid sound: ${name}`, error); }
        }));
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { /* Audio is optional when a browser or device disallows it. */ }
  }

  play (name, pos = null, strength = 1, rate = null) {
    const c = this.ctx, cue = CUES[name];
    if (!c || c.state !== 'running' || !this.active || !cue || this.voices >= 24 || this.world.settings.get('soundMuted')) return;
    const now = c.currentTime;
    if (now - (this.last.get(name) ?? -10) < (cue.cooldown ?? .08)) return;
    let level = clamp(strength, .1, 1.5) * cue.gain, pan = 0;
    if (pos && this.world.player) {
      const p = this.world.player.pos;
      const dx = pos.x - p.x, dy = pos.y - p.y, dz = pos.z - p.z;
      const distance = Math.hypot(dx, dy, dz), range = cue.range ?? 90;
      if (distance > range) return;
      level *= (1 - distance / range) / (1 + distance / 28);
      const yaw = this.world.cameraRig?.yaw || 0;
      // CameraRig's right vector is (-cos(yaw), 0, sin(yaw)).
      pan = clamp((-dx * Math.cos(yaw) + dz * Math.sin(yaw)) / Math.max(8, distance), -.85, .85);
    }
    const available = cue.files.filter(f => this.buffers.has(f));
    if (!available.length) return; // Never queue stale attacks while samples load.
    const alternatives = available.filter(f => f !== this.previous.get(name));
    const choices = alternatives.length ? alternatives : available;
    const file = choices[Math.floor(Math.random() * choices.length)];
    this.previous.set(name, file);
    this.last.set(name, now);
    const source = c.createBufferSource(); source.buffer = this.buffers.get(file);
    source.playbackRate.value = (rate ?? cue.rate ?? 1) * (name === 'select' || name === 'success' ? 1 : .96 + Math.random() * .08);
    const gain = c.createGain(); gain.gain.value = level;
    const panNode = c.createStereoPanner(); panNode.pan.value = pan;
    source.connect(gain).connect(panNode).connect(this.master);
    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect(); gain.disconnect(); panNode.disconnect();
    };
    source.start();
  }

  /* ---------------- music ---------------- */

  /**
   * One song at a time, shuffled, with a breather between them, streamed
   * through a media element into the same graph as everything else. Its
   * level follows how far the nearest trouble is: full when the city is
   * quiet around you, gone by the time you are on top of a crime.
   */
  _startMusic () {
    const c = this.ctx;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = false;
    const gain = c.createGain();
    gain.gain.value = 0;
    let source = null;
    try { source = c.createMediaElementSource(el); source.connect(gain).connect(this.master); }
    catch (error) { console.warn('Music unavailable', error); return; }
    const order = MUSIC.map((name, i) => i).sort(() => Math.random() - .5);
    this.music = { el, source, gain, order, index: -1, gapT: 2, level: 0, playing: false };
    el.addEventListener('ended', () => {
      this.music.playing = false;
      this.music.gapT = MUSIC_GAP[0] + Math.random() * (MUSIC_GAP[1] - MUSIC_GAP[0]);
    });
    el.addEventListener('error', () => { console.warn(`Music unavailable: ${el.src}`); this.music.playing = false; this.music.gapT = 30; });
  }

  _nextSong () {
    const m = this.music;
    m.index = (m.index + 1) % m.order.length;
    if (m.index === 0) m.order.sort(() => Math.random() - .5);
    m.el.src = new URL(`../../assets/music/${MUSIC[m.order[m.index]]}.mp3`, import.meta.url).href;
    m.playing = true;
    m.el.play().catch(() => { m.playing = false; m.gapT = 5; });
  }

  /**
   * The car radio. Five songs on shuffle, streamed like the music, but run
   * through a small-speaker chain so it sounds like it is coming out of the
   * dashboard: the lows and the air cut away, a mid-range presence bump, a
   * touch of saturation. It fades up when you get in and out when you get
   * out, pausing where it was so the same song picks up next time.
   */
  _startRadio () {
    const c = this.ctx;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = false;
    let source = null;
    const highpass = c.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 340; highpass.Q.value = .7;
    const lowpass = c.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 3600; lowpass.Q.value = .9;
    const presence = c.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 1700; presence.Q.value = 1.1; presence.gain.value = 5;
    const drive = c.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
    drive.curve = curve; drive.oversample = '2x';
    const gain = c.createGain(); gain.gain.value = 0;
    try { source = c.createMediaElementSource(el); source.connect(highpass).connect(lowpass).connect(presence).connect(drive).connect(gain).connect(this.master); }
    catch (error) { console.warn('Car radio unavailable', error); return; }
    const order = RADIO.map((name, i) => i).sort(() => Math.random() - .5);
    this.radio = { el, source, gain, order, index: -1, gapT: 0, level: 0, playing: false, on: false };
    el.addEventListener('ended', () => { this.radio.playing = false; this.radio.gapT = 1.5; });
    el.addEventListener('error', () => { console.warn(`Radio track unavailable: ${el.src}`); this.radio.playing = false; this.radio.gapT = 20; });
  }

  _nextRadioSong (step = 1) {
    const r = this.radio;
    r.index = (r.index + step + r.order.length) % r.order.length;
    if (step > 0 && r.index === 0) r.order.sort(() => Math.random() - .5);
    this._tuneRadio();
  }

  _tuneRadio () {
    const r = this.radio;
    r.el.src = new URL(`../../assets/music/car/${RADIO[r.order[r.index]]}.mp3`, import.meta.url).href;
    r.playing = true;
    r.userPaused = false;
    r.el.play().catch(() => { r.playing = false; r.gapT = 4; });
  }

  get radioTitle () {
    const r = this.radio;
    return r && r.index >= 0 ? RADIO_TITLES[RADIO[r.order[r.index]]] : null;
  }

  /* the dashboard buttons — only meaningful from the driver's seat */

  radioNext () {
    if (!this.radio) return null;
    this._nextRadioSong(1);
    return this.radioTitle;
  }

  /** Back: restart the song if it is under way, otherwise the one before. */
  radioPrev () {
    const r = this.radio;
    if (!r) return null;
    if (r.index >= 0 && r.el.currentTime > 3) { r.el.currentTime = 0; r.playing = true; r.userPaused = false; r.el.play().catch(() => {}); }
    else this._nextRadioSong(-1);
    return this.radioTitle;
  }

  /** Returns true when now playing, false when now paused. */
  radioToggle () {
    const r = this.radio;
    if (!r) return null;
    if (r.index < 0) { this._nextRadioSong(1); return true; }
    if (r.userPaused) { r.userPaused = false; r.playing = true; r.el.play().catch(() => {}); return true; }
    r.userPaused = true; r.el.pause();
    return false;
  }

  _updateRadio (dt, audible) {
    const r = this.radio;
    if (!r) return;
    const s = this.world.settings, p = this.world.player;
    const setting = Number(s.get('radioVolume'));
    const volume = audible ? clamp(Number.isFinite(setting) ? setting : .6, 0, 1) : 0;
    const inCar = !!p.vehicle && volume > 0;
    const target = inCar ? volume * .5 : 0;
    // quick up when you get in, a longer fade as you walk away
    r.gain.gain.setTargetAtTime(target, this.ctx.currentTime, target > r.level ? .25 : .55);
    r.level = target;
    if (inCar) {
      if (!r.on) { r.on = true; r.offT = 0; }
      if (r.userPaused) { /* the driver switched it off */ }
      else if (!r.playing) { r.gapT -= dt; if (r.gapT <= 0) this._nextRadioSong(); }
      else if (r.el.paused) r.el.play().catch(() => {});
    } else if (r.on) {
      // out of the car: let the fade run, then park the song where it is
      r.offT = (r.offT || 0) + dt;
      if (r.offT > 2.2) { r.on = false; if (!r.el.paused) r.el.pause(); }
    }
  }

  /**
   * Battle music. Three songs on shuffle, streamed like the rest. It starts
   * the moment the hero lands a hit on something that belongs to a battle —
   * a scenario's planes or crew, or the carrier garrison — and runs until
   * that battle is over: the scenario cleared or aborted, or the carrier
   * reset. The drive-by is an ordinary crime and gets no music of its own.
   */
  _startBattle () {
    const c = this.ctx;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = true;                       // one song per mission, round and round
    const gain = c.createGain();
    gain.gain.value = 0;
    let source = null;
    try { source = c.createMediaElementSource(el); source.connect(gain).connect(this.master); }
    catch (error) { console.warn('Battle music unavailable', error); return; }
    const order = BATTLE.map((name, i) => i).sort(() => Math.random() - .5);
    this.battle = { el, source, gain, order, index: -1, gapT: 0, level: 0, playing: false, on: false, offT: 0, userPaused: false };
    el.addEventListener('error', () => { console.warn(`Battle track unavailable: ${el.src}`); this.battle.playing = false; this.battle.gapT = 20; });
  }

  _nextBattleSong () {
    const b = this.battle;
    b.index = (b.index + 1) % b.order.length;
    if (b.index === 0) b.order.sort(() => Math.random() - .5);
    b.el.src = new URL(`../../assets/music/battle/${BATTLE[b.order[b.index]]}.mp3`, import.meta.url).href;
    b.playing = true;
    b.userPaused = false;
    b.el.play().catch(() => { b.playing = false; b.gapT = 4; });
  }

  get battleTitle () {
    const b = this.battle;
    return b && b.index >= 0 ? BATTLE_TITLES[BATTLE[b.order[b.index]]] : null;
  }

  /* playback controls for the fight — the same keys as the car radio, when you are not in a car */

  battleNext () {
    if (!this.battle?.on) return null;
    this._nextBattleSong();
    return this.battleTitle;
  }

  battleRestart () {
    const b = this.battle;
    if (!b?.on || b.index < 0) return null;
    b.el.currentTime = 0; b.userPaused = false; b.playing = true; b.el.play().catch(() => {});
    return this.battleTitle;
  }

  /** Returns true when now playing, false when now paused, null when there is no fight on. */
  battleToggle () {
    const b = this.battle;
    if (!b?.on) return null;
    if (b.userPaused) { b.userPaused = false; b.playing = true; b.el.play().catch(() => {}); return true; }
    b.userPaused = true; b.el.pause();
    return false;
  }

  /** The hero just hurt something that belongs to a battle. */
  engage () { this.engaged = true; this.engagedT = 1.5; }

  /** Whether there is a battle on for the music to follow. */
  _battleLive () {
    const s = this.world.scenarios;
    if (!s) return false;
    const a = s.active;
    if (a && a.def.id !== 'driveby' && !a.cleared) return true;
    return !!s.garrison?.engaged;
  }

  _updateBattle (dt, audible) {
    const b = this.battle;
    if (!b) return;
    const live = this._battleLive();
    // the next fight needs a fresh first hit — but a hit registers a frame
    // or so before the carrier raises its alarm, so give it a moment
    this.engagedT = (this.engagedT ?? 0) - dt;
    if (!live && this.engagedT <= 0) this.engaged = false;
    const s = this.world.settings;
    const setting = Number(s.get('musicVolume'));
    const volume = audible ? clamp(Number.isFinite(setting) ? setting : .5, 0, 1) : 0;
    const want = this.engaged && live && volume > 0;
    const target = want ? volume * .6 : 0;
    b.gain.gain.setTargetAtTime(target, this.ctx.currentTime, target > b.level ? .35 : .9);
    b.level = target;
    if (want) {
      if (!b.on) { b.on = true; b.offT = 0; }
      if (b.userPaused) { /* switched off for this fight */ }
      else if (!b.playing) { b.gapT -= dt; if (b.gapT <= 0) this._nextBattleSong(); }
      else if (b.el.paused) b.el.play().catch(() => {});
    } else if (b.on) {
      // fight over: let the fade run, then stop; the next fight gets a fresh song
      b.offT += dt;
      if (b.offT > 3.5) { b.on = false; b.playing = false; b.userPaused = false; b.gapT = 0; if (!b.el.paused) b.el.pause(); }
    }
  }

  /** How far the nearest trouble is, as 0 (on top of it) … 1 (none about). */
  sampleCalm () {
    const w = this.world, p = w.player;
    let d = Infinity;
    const near = w.crime?.nearestCrime(p.pos);
    if (near) d = near.dist;
    for (const e of w.enemies) {
      if (e.dead) continue;
      const de = e.pos.distanceTo(p.pos);
      if (de < d) d = de;
    }
    for (const a of w.scenarios?.targets ?? []) {
      const da = a.pos.distanceTo(p.pos) * .6;      // a jet overhead is trouble from further off
      if (da < d) d = da;
    }
    this.calm = clamp((d - MUSIC_NEAR) / (MUSIC_FAR - MUSIC_NEAR), 0, 1);
  }

  _updateMusic (dt, audible) {
    const m = this.music;
    if (!m) return;
    const s = this.world.settings;
    const setting = Number(s.get('musicVolume'));
    const volume = audible ? clamp(Number.isFinite(setting) ? setting : .5, 0, 1) : 0;
    const radioOn = this.radio?.on && this.world.player.vehicle;
    const battleOn = this.battle?.on;
    const target = radioOn || battleOn ? 0 : volume * this.calm * .55;
    m.gain.gain.setTargetAtTime(target, this.ctx.currentTime, target < m.level ? .9 : 1.6);
    m.level = target;
    if (!m.playing) {
      if (volume > 0 && this.calm > .5) { m.gapT -= dt; if (m.gapT <= 0) this._nextSong(); }
      return;
    }
    // the fight has come to you: let the song run out quietly rather than
    // pausing mid-bar, unless the player has turned music off altogether
    if (volume === 0 && !m.el.paused) m.el.pause();
    else if (volume > 0 && m.el.paused && audible) m.el.play().catch(() => {});
  }

  /**
   * A character's voice: one grunt recording doing every job — the hit, the
   * throw, the landing, the swing, the yelp — told apart by pitch and level.
   * Each body gets one grunt per quarter second so a beating isn't a stutter.
   */
  voice (actor, strength = 1, rate = 1) {
    if (!this.active || !this.ctx || !actor || !actor.pos) return;
    const now = this.ctx.currentTime;
    if (now - (this.contacts.get(actor) ?? -10) < .25) return;
    this.contacts.set(actor, now);
    this.play('grunt', actor.pos, strength, rate * (.92 + Math.random() * .16));
  }

  /**
   * A sustained beam landing on something: a steady crackle with a thump
   * every third of a second, so heat vision or a solar stream on an enemy
   * sounds like it is doing damage rather than passing through.
   */
  beamHit (pos, dt, strength = 1) {
    this.searT = (this.searT ?? 0) - dt;
    this.burnT = (this.burnT ?? 0) - dt;
    if (this.searT <= 0) { this.searT = .13; this.play('sear', pos, strength * (.8 + Math.random() * .3)); }
    if (this.burnT <= 0) { this.burnT = .3; this.play('burn', pos, strength); }
  }

  /** Collision speed is captured before physics removes the impact energy. */
  collision (kind, pos, speed, mass = 1, body = null) {
    if (!this.active || !this.ctx || speed < 2.5) return;
    const now = this.ctx.currentTime;
    if (body && now - (this.contacts.get(body) ?? -10) < .16) return;
    if (body) this.contacts.set(body, now);
    const cue = kind === 'water' ? 'splash' : kind === 'car' ? 'carCrash'
      : kind === 'tree' || kind === 'bush' || kind === 'bench' ? 'woodCrash'
      : kind === 'rock' ? 'stoneCrash' : 'metalCrash';
    this.play(cue, pos, clamp(speed / 23 * Math.sqrt(Math.max(.2, mass)), .16, 1.35));
  }

  sampleEnvironment () {
    const { city, player: p, roads } = this.world;
    if (!city) return;
    const x = p.pos.x, z = p.pos.z;
    const water = city.isWater(x, z);
    let shore = water ? 1 : 0;
    // Sample nearby coast rather than playing waves everywhere on an island.
    if (!water) for (const radius of [35, 85, 150]) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        if (city.isWater(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) {
          shore = Math.max(shore, 1 - radius / 190); break;
        }
      }
      if (shore) break;
    }
    const node = roads?.nearestWalkNode(x, z);
    const roadDistance = node ? Math.hypot(node.x - x, node.z - z) : Infinity;
    const urban = node ? clamp(node.busy * 1.5, 0, 1) * clamp(1 - roadDistance / 220, 0, 1) : 0;
    this.environment = {
      urban, shore, land: water ? 0 : 1,
      height: Math.max(0, p.pos.y - city.groundSurface(x, z)),
      sheltered: city.covered(x, z, p.pos.y, 30)
    };
  }

  setLoop (name, volume, rate = 1, cutoff = 12000) {
    const c = this.ctx;
    let loop = this.loops.get(name);
    if (!loop && volume > 0 && this.buffers.has(name)) {
      const source = c.createBufferSource(); source.buffer = this.buffers.get(name); source.loop = true;
      const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = .5;
      const gain = c.createGain(); gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start(0, AMBIENCE.has(name) ? Math.random() * source.buffer.duration : 0);
      loop = { source, filter, gain, silentAt: null };
      this.loops.set(name, loop);
    }
    if (!loop) return;
    loop.gain.gain.setTargetAtTime(volume, c.currentTime, AMBIENCE.has(name) ? .7 : .09);
    loop.source.playbackRate.setTargetAtTime(rate, c.currentTime, .15);
    loop.filter.frequency.setTargetAtTime(cutoff, c.currentTime, .12);
    if (volume > 0) loop.silentAt = null;
    else {
      loop.silentAt ??= c.currentTime;
      if (c.currentTime - loop.silentAt > (AMBIENCE.has(name) ? 4 : .65)) {
        loop.source.stop(); loop.source.disconnect(); loop.filter.disconnect(); loop.gain.disconnect();
        this.loops.delete(name);
      }
    }
  }

  update (dt) {
    this.active = !!this.world.input?.locked && !this.world.menu?.open && !document.hidden;
    if (!this.ctx) return;
    const c = this.ctx, p = this.world.player, s = this.world.settings;
    const volume = Number(s.get('soundVolume'));
    const audible = this.active && !s.get('soundMuted') && volume !== 0;
    this.master.gain.setTargetAtTime(audible ? clamp(Number.isFinite(volume) ? volume : .7, 0, 1) : 0, c.currentTime, .035);
    const speed = p.vel.length();
    this.environmentTimer -= dt;
    if (this.environmentTimer <= 0) { this.environmentTimer = .5; this.sampleEnvironment(); this.sampleCalm(); }
    this._updateBattle(dt, audible);
    this._updateMusic(dt, audible);
    this._updateRadio(dt, audible);
    const e = this.environment;
    const ambienceSetting = Number(s.get('ambienceVolume'));
    const ambience = audible ? clamp(Number.isFinite(ambienceSetting) ? ambienceSetting : .65, 0, 1) : 0;
    const elevation = 1 / (1 + e.height / 65);
    const shelter = e.sheltered ? .22 : 1;
    const daylight = 1 - clamp(this.world.sky?.night ?? 0, 0, 1);
    this.setLoop('city', ambience * .24 * e.urban * elevation * shelter * (1 - e.shore * .65), 1, 900 + 3500 * elevation);
    this.setLoop('ocean', ambience * .25 * e.shore * elevation * shelter, 1, 6500);
    this.setLoop('birds', ambience * .15 * e.land * (1 - e.urban) * elevation * shelter * daylight, 1, 9000);
    const ambientWind = ambience * (.025 + Math.min(e.height / 250, 1) * .08) * shelter;
    // Moving through the air: the rush grows with speed, well past cruising —
    // a sprint should roar. Falling gets the same rush from the drop speed,
    // pitched lower and darker than flight.
    const airborne = !p.grounded && !p.flying && !p.vehicle && !p.swimming && !p.downed;
    const fallSpeed = airborne ? Math.max(0, -p.vel.y) : 0;
    const flightWind = audible && p.flying ? .05 + clamp(speed / 120, 0, 1.6) * .3 : 0;
    const fallWind = audible && fallSpeed > 6 ? clamp((fallSpeed - 6) / 34, 0, 1.3) * .3 : 0;
    const rush = Math.max(flightWind, fallWind);
    const rate = p.flying ? 1 + Math.min(speed, 220) / 380 : fallWind ? .85 + Math.min(fallSpeed, 60) / 200 : 1;
    const cutoff = p.flying ? 700 + Math.min(speed, 220) * 42 : fallWind ? 500 + fallSpeed * 40 : 2200;
    this.setLoop('wind', Math.max(ambientWind, rush), rate, cutoff);
    this.setLoop('engine', audible && p.vehicle ? .36 : 0, .7 + Math.min(Math.abs(p.vehicle?.speed || 0), 80) / 55, 3500);
    const beams = this.world.effects.beams.some(b => b.live && b.persistent);
    this.setLoop('beam', audible && beams ? .2 : 0, 1 + p.powerIndex * .08, 6500);
    if (audible && p.grounded && !p.flying && !p.vehicle && !p.swimming && !p.downed && speed > 1.5) {
      this.steps += dt * speed;
      if (this.steps > 2.4) { this.steps = 0; this.play('step', null, Math.min(1, .5 + speed / 30)); }
    } else this.steps = 0;
  }
}
