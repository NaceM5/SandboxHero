// Central sandbox configuration. Everything the player can tune lives here,
// persists to localStorage, and is read live by the simulation each frame.

const KEY = 'sandboxhero.settings.v1';

export const DEFAULTS = {
  soundVolume: 0.7,
  ambienceVolume: 0.65,
  musicVolume: 0.5,
  radioVolume: 0.6,
  soundMuted: false,
  // ---- world ----
  timeOfDay: 17.5 / 24,   // 17:30 — 0 midnight -> .25 sunrise -> .5 noon -> .75 sunset
  pedestrians: 220,
  crowdRadius: 230,       // civilians are recycled to stay within this range
  vehicles: 64,
  trafficRadius: 420,     // cars are recycled to stay within this range
  bloom: 0.8,
  exposure: 0.95,
  ambient: 0.15,          // flat fill so nothing reads as pure black
  brightMode: false,      // lifts shadows + haze for maximum visibility
  renderScale: 1.0,
  drawDistance: 3200,

  // ---- crime ----
  crimeDensity: 0.5,      // how much crime the city generates
  crimeDifficulty: 0.4,   // shifts the enemy-tier roll upward
  maxActiveCrimes: 10,
  crimeInterval: 14,      // seconds between spawn attempts at density 1
  enemiesPerCrime: 1.0,   // multiplier on group size
  enemyAggression: 0.6,
  respawnCrime: true,

  // ---- hero ----
  hasHealth: true,
  invulnerable: false,
  maxHealth: 300,
  regen: 6,               // hp/sec
  strength: 1.0,
  jogSpeed: 1.0,
  sprintSpeed: 1.0,
  jumpPower: 1.0,
  flightSpeed: 1.0,
  flightAccel: 1.0,
  boostSpeed: 1.0,          // sprint flight, tuned separately from the cruise
  boostAccel: 1.0,
  energyEnabled: true,
  maxEnergy: 100,
  energyRegen: 14,
  flightMode: 'always',   // 'always' | 'paragon'
  startPower: 0,

  // ---- super suit ----
  suit: {
    primary:   '#1b47c9',
    secondary: '#d81f3d',
    accent:    '#ffd447',
    skin:      '#e0ac82',
    cape: true,
    capeColor: '#b0182f',
    emblem: true,
    emblemColor: '#ffd447',
    mask: 'domino',       // none | domino | full | visor
    glow: 0.38,
    build: 1.0,           // 0.7 lean -> 1.3 heavy
    height: 1.0
  },

  // ---- civilian ----
  civ: {
    shirt: '#3d4a63',
    pants: '#22262f',
    jacket: '#8d5b3f',
    hair:  '#2b2119',
    skin:  '#e0ac82',
    jacketOn: true,
    glasses: true
  }
};

function deepMerge (base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (out[k] && typeof out[k] === 'object' && typeof over[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], over[k]);
    } else if (over[k] !== undefined) out[k] = over[k];
  }
  return out;
}

export class Settings {
  constructor () {
    this.data = deepMerge(DEFAULTS, this._load());
    this._listeners = new Set();
  }
  _load () {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }
  save () {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }
  get (path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
  }
  set (path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    let node = this.data;
    for (const p of parts) node = node[p];
    node[last] = value;
    this.save();
    for (const fn of this._listeners) fn(path, value);
  }
  onChange (fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  reset () {
    this.data = deepMerge(DEFAULTS, {});
    this.save();
    for (const fn of this._listeners) fn('*', null);
  }
}

export const settings = new Settings();
