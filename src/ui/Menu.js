const $ = id => document.getElementById(id);

/* Schema-driven settings panels. Each row reads and writes settings live. */
const PANELS = {
  world: [
    { grp: 'Sound' },
    { k: 'soundMuted', t: 'bool', label: 'Mute sound effects' },
    { k: 'soundVolume', t: 'range', min: 0, max: 1, step: 0.05, label: 'Sound volume', fmt: v => Math.round(v * 100) + '%' },
    { k: 'ambienceVolume', t: 'range', min: 0, max: 1, step: 0.05, label: 'Ambience volume', hint: 'City traffic, birds, shoreline and background wind', fmt: v => Math.round(v * 100) + '%' },
    { k: 'musicVolume', t: 'range', min: 0, max: 1, step: 0.05, label: 'Music volume', hint: 'Plays while the city is quiet around you; fades out as you close on trouble', fmt: v => Math.round(v * 100) + '%' },
    { k: 'radioVolume', t: 'range', min: 0, max: 1, step: 0.05, label: 'Car radio volume', hint: 'The station that plays while you are driving', fmt: v => Math.round(v * 100) + '%' },
    { grp: 'Environment' },
    { k: 'timeOfDay', t: 'range', min: 0, max: 1, step: 0.01, label: 'Time of day',
      hint: '0 midnight · 0.25 sunrise · 0.5 noon · 0.75 sunset', fmt: v => timeLabel(v) },
    { k: 'exposure', t: 'range', min: 0.6, max: 2.2, step: 0.02, label: 'Daylight',
      hint: 'Overall exposure — raise it if the city reads too dim' },
    { k: 'ambient', t: 'range', min: 0, max: 1.2, step: 0.02, label: 'Ambient fill',
      hint: 'Lifts shadowed faces and alleys without washing out the sun' },
    { k: 'brightMode', t: 'bool', label: 'Bright mode',
      hint: 'See-everything preset: lifts shadows, cuts haze, keeps windows lit' },
    { k: 'bloom', t: 'range', min: 0, max: 2.5, step: 0.05, label: 'Bloom', hint: 'Glow on lights, energy and windows' },
    { k: 'renderScale', t: 'range', min: 0.5, max: 1, step: 0.05, label: 'Render scale', hint: 'Lower this if the frame rate dips' },
    { k: 'drawDistance', t: 'range', min: 600, max: 7000, step: 100, label: 'Draw distance', fmt: v => v + ' m' },
    { grp: 'Population' },
    { k: 'pedestrians', t: 'range', min: 0, max: 450, step: 10, label: 'Crowd size',
      hint: 'Civilians kept alive at once — they stream to stay near you' },
    { k: 'crowdRadius', t: 'range', min: 110, max: 420, step: 10, label: 'Crowd radius',
      hint: 'Smaller = the same people packed closer around you', fmt: v => v + ' m' },
    { k: 'vehicles', t: 'range', min: 0, max: 160, step: 2, label: 'Vehicles', hint: 'Cars navigating and parking on their own — they stream to stay near you' },
    { k: 'trafficRadius', t: 'range', min: 150, max: 900, step: 10, label: 'Traffic radius',
      hint: 'Smaller = the same cars packed onto the streets around you', fmt: v => v + ' m' }
  ],
  crime: [
    { grp: 'How much crime' },
    { k: 'crimeDensity', t: 'range', min: 0, max: 1, step: 0.01, label: 'Crime density',
      hint: 'Scales the whole city-wide crime field', fmt: v => densityLabel(v) },
    { k: 'crimeInterval', t: 'range', min: 3, max: 60, step: 1, label: 'Spawn interval', hint: 'Base seconds between attempts', fmt: v => v + ' s' },
    { k: 'maxActiveCrimes', t: 'range', min: 1, max: 30, step: 1, label: 'Max active crimes' },
    { grp: 'How hard it is' },
    { k: 'crimeDifficulty', t: 'range', min: 0, max: 1, step: 0.01, label: 'Difficulty',
      hint: 'Shifts the enemy-tier roll: Thug → Enforcer → Syndicate → Warbringer', fmt: v => diffLabel(v) },
    { k: 'enemiesPerCrime', t: 'range', min: 0.3, max: 3, step: 0.1, label: 'Group size', fmt: v => '×' + v.toFixed(1) },
    { k: 'enemyAggression', t: 'range', min: 0, max: 1, step: 0.01, label: 'Aggression', hint: 'Fire rate and accuracy' }
  ],
  hero: [
    { grp: 'Survivability' },
    { k: 'hasHealth', t: 'bool', label: 'Health enabled', hint: 'Off = damage is ignored entirely' },
    { k: 'invulnerable', t: 'bool', label: 'Invulnerable' },
    { k: 'maxHealth', t: 'range', min: 50, max: 2000, step: 25, label: 'Max health' },
    { k: 'regen', t: 'range', min: 0, max: 80, step: 1, label: 'Regeneration', fmt: v => v + ' hp/s' },
    { grp: 'Characteristics' },
    { k: 'strength', t: 'range', min: 0.2, max: 6, step: 0.1, label: 'Strength', hint: 'Melee and blast damage, knockback', fmt: v => '×' + v.toFixed(1) },
    { k: 'jogSpeed', t: 'range', min: 0.3, max: 6, step: 0.1, label: 'Jog speed',
      hint: 'Normal movement — 6.4 m/s at ×1', fmt: v => '×' + v.toFixed(1) },
    { k: 'sprintSpeed', t: 'range', min: 0.3, max: 8, step: 0.1, label: 'Sprint speed',
      hint: 'Holding Shift — 16.5 m/s at ×1', fmt: v => '×' + v.toFixed(1) },
    { k: 'jumpPower', t: 'range', min: 0.5, max: 6, step: 0.1, label: 'Jump power', fmt: v => '×' + v.toFixed(1) },
    { k: 'flightSpeed', t: 'range', min: 0.3, max: 4, step: 0.1, label: 'Flight speed', fmt: v => '×' + v.toFixed(1) },
    { k: 'flightAccel', t: 'range', min: 0.3, max: 4, step: 0.1, label: 'Flight acceleration', fmt: v => '×' + v.toFixed(1) },
    { k: 'boostSpeed', t: 'range', min: 0.3, max: 4, step: 0.1, label: 'Sprint flight speed', hint: 'Shift while flying', fmt: v => '×' + v.toFixed(1) },
    { k: 'boostAccel', t: 'range', min: 0.3, max: 4, step: 0.1, label: 'Sprint flight acceleration', fmt: v => '×' + v.toFixed(1) },
    { grp: 'Energy' },
    { k: 'energyEnabled', t: 'bool', label: 'Energy cost', hint: 'Off = powers are free' },
    { k: 'maxEnergy', t: 'range', min: 20, max: 500, step: 10, label: 'Max energy' },
    { k: 'energyRegen', t: 'range', min: 1, max: 120, step: 1, label: 'Energy regen', fmt: v => v + '/s' },
    { grp: 'Flight' },
    { k: 'flightMode', t: 'select', label: 'Flight availability',
      options: [['always', 'Always available'], ['paragon', 'Only with PARAGON']] },
    { k: 'startPower', t: 'select', label: 'Starting powerset',
      options: [[0, 'Paragon'], [1, 'Kinetic'], [2, 'Solar'], [3, 'Phantom'], [4, 'Viltrum']], num: true }
  ],
  suit: [
    { grp: 'Colours' },
    { k: 'suit.primary', t: 'color', label: 'Primary', hint: 'Torso and arms' },
    { k: 'suit.secondary', t: 'color', label: 'Secondary', hint: 'Legs, boots, gloves' },
    { k: 'suit.accent', t: 'color', label: 'Accent', hint: 'Belt, trim, glow' },
    { k: 'suit.skin', t: 'color', label: 'Skin tone' },
    { grp: 'Cape & emblem' },
    { k: 'suit.cape', t: 'bool', label: 'Cape' },
    { k: 'suit.capeColor', t: 'color', label: 'Cape colour' },
    { k: 'suit.emblem', t: 'bool', label: 'Chest emblem' },
    { k: 'suit.emblemColor', t: 'color', label: 'Emblem colour' },
    { grp: 'Head & build' },
    { k: 'suit.mask', t: 'select', label: 'Mask',
      options: [['none', 'None'], ['domino', 'Domino'], ['visor', 'Visor'], ['full', 'Full cowl']] },
    { k: 'suit.glow', t: 'range', min: 0, max: 3, step: 0.05, label: 'Accent glow' },
    { k: 'suit.build', t: 'range', min: 0.7, max: 1.5, step: 0.02, label: 'Build', hint: 'Lean → heavy' },
    { k: 'suit.height', t: 'range', min: 0.85, max: 1.2, step: 0.01, label: 'Height', fmt: v => (v * 1.86).toFixed(2) + ' m' }
  ],
  civ: [
    { grp: 'Civilian identity' },
    { k: 'civ.shirt', t: 'color', label: 'Shirt' },
    { k: 'civ.pants', t: 'color', label: 'Trousers' },
    { k: 'civ.jacketOn', t: 'bool', label: 'Jacket' },
    { k: 'civ.jacket', t: 'color', label: 'Jacket colour' },
    { k: 'civ.hair', t: 'color', label: 'Hair' },
    { k: 'civ.skin', t: 'color', label: 'Skin tone' },
    { k: 'civ.glasses', t: 'bool', label: 'Glasses', hint: 'Nobody will ever work it out' }
  ]
};

const timeLabel = v => {
  const h = Math.floor(v * 24), m = Math.floor((v * 24 - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const densityLabel = v => v < 0.02 ? 'None' : v < 0.22 ? 'Low' : v < 0.45 ? 'Medium' : v < 0.72 ? 'High' : 'Anarchy';
const diffLabel = v => v < 0.15 ? 'Easy' : v < 0.4 ? 'Normal' : v < 0.65 ? 'Hard' : v < 0.85 ? 'Brutal' : 'Nightmare';

export class Menu {
  constructor (world) {
    this.world = world;
    this.s = world.settings;
    this.el = $('menu');
    this.open = false;
    this._build();
    this._wire();
  }

  _build () {
    for (const [name, rows] of Object.entries(PANELS)) {
      const host = this.el.querySelector(`[data-panel="${name}"]`);
      let group = null;
      for (const r of rows) {
        if (r.grp) {
          group = document.createElement('div');
          group.className = 'grp';
          group.innerHTML = `<h3>${r.grp}</h3>`;
          host.appendChild(group);
          continue;
        }
        if (!group) { group = document.createElement('div'); group.className = 'grp'; host.appendChild(group); }
        group.appendChild(this._row(r));
      }
    }
  }

  _row (r) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.innerHTML = r.label + (r.hint ? `<span class="hint">${r.hint}</span>` : '');
    row.appendChild(label);

    const mid = document.createElement('div');
    const val = document.createElement('div');
    val.className = 'val';
    const cur = this.s.get(r.k);

    if (r.t === 'range') {
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = r.min; inp.max = r.max; inp.step = r.step; inp.value = cur;
      const show = () => { val.textContent = r.fmt ? r.fmt(+inp.value) : (+inp.value).toFixed(r.step < 1 ? 2 : 0); };
      inp.addEventListener('input', () => { this.s.set(r.k, +inp.value); show(); });
      show();
      mid.appendChild(inp);
      this._reg(r.k, () => { inp.value = this.s.get(r.k); show(); });
    } else if (r.t === 'bool') {
      const sw = document.createElement('div');
      sw.className = 'switch' + (cur ? ' on' : '');
      sw.addEventListener('click', () => {
        const nv = !this.s.get(r.k);
        this.s.set(r.k, nv);
        sw.classList.toggle('on', nv);
      });
      mid.appendChild(sw);
      this._reg(r.k, () => sw.classList.toggle('on', !!this.s.get(r.k)));
    } else if (r.t === 'color') {
      const inp = document.createElement('input');
      inp.type = 'color'; inp.value = cur;
      inp.addEventListener('input', () => this.s.set(r.k, inp.value));
      mid.appendChild(inp);
      this._reg(r.k, () => { inp.value = this.s.get(r.k); });
    } else if (r.t === 'select') {
      const sel = document.createElement('select');
      for (const [v, t] of r.options) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        sel.appendChild(o);
      }
      sel.value = cur;
      sel.addEventListener('change', () => this.s.set(r.k, r.num ? +sel.value : sel.value));
      mid.appendChild(sel);
      this._reg(r.k, () => { sel.value = this.s.get(r.k); });
    }
    row.appendChild(mid);
    row.appendChild(val);
    return row;
  }

  _reg (k, fn) { (this.refresh ||= []).push(fn); }

  _wire () {
    const tabs = [...$('tabs').children];
    tabs.forEach(b => b.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('active', x === b));
      for (const p of this.el.querySelectorAll('[data-panel]')) {
        p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab);
      }
    }));
    $('btnClose').addEventListener('click', () => this.world.closeMenu());
    $('btnReset').addEventListener('click', () => {
      this.s.reset();
      for (const fn of this.refresh) fn();
      this.world.onSettingsBulkChange();
    });
    $('btnRebuild').addEventListener('click', () => this.world.rebuildPopulation());
  }

  setOpen (v) {
    this.open = v;
    this.el.classList.toggle('hidden', !v);
    if (v) for (const fn of this.refresh) fn();
  }
}
