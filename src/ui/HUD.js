import { WORLD } from '../world/Map.js';
import { clamp } from '../core/Util.js';
import { QUICK_ATTRS } from '../core/Attributes.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor (world) {
    this.world = world;
    this.el = {
      hud: $('hud'),
      healthWrap: $('healthWrap'),
      healthFill: $('healthFill'),
      energyFill: $('energyFill'),
      energyLabel: $('energyLabel'),
      powerbar: $('powerbar'),
      statline: $('statline'),
      notice: $('notice'),
      objective: $('objective'),
      objSub: $('objSub'),
      speed: $('speedlines'),
      vign: $('damageVignette'),
      flash: $('transformFlash'),
      cross: $('crosshair'),
      map: $('minimapCanvas'),
      quick: $('quicktune'),
      quickList: $('qtList'),
      scenMenu: $('scenarioMenu'),
      scenList: $('scenarioList'),
      scenStatus: $('scenarioStatus'),
      scenTitle: $('scenarioTitle'),
      scenSub: $('scenarioSub')
    };
    this.ctx = this.el.map.getContext('2d');
    this.noticeT = 0;
    this.flashT = 0;
    this.mapRange = 520;
    this.buildPowerBar();
    this.densityImage = null;
  }

  show () { this.el.hud.classList.remove('hidden'); }

  buildPowerBar () {
    const p = this.world.player;
    this.el.powerbar.innerHTML = '';
    p.powers.forEach((pw, i) => {
      const d = document.createElement('div');
      d.className = 'pcard';
      d.style.setProperty('--pc', pw.color);
      d.innerHTML = `<div class="pk">${i + 1}</div><div class="pn">${pw.name}</div><div class="pd">${pw.desc}</div>`;
      this.el.powerbar.appendChild(d);
    });
    this.cards = [...this.el.powerbar.children];
  }

  notify (text) {
    this.el.notice.textContent = text;
    this.el.notice.classList.add('show');
    this.noticeT = 2.4;
  }

  flashTransform () { this.flashT = 0.45; }

  /* ---------------- battle scenarios ---------------- */

  showScenarioMenu (list, activeId) {
    const el = this.el.scenList;
    el.innerHTML = '';
    list.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'qt-row sc-row' + (s.id === activeId ? ' sel' : '');
      row.innerHTML = `<i>${i + 1}</i><div><b class="sc-name">${s.name}</b><div class="sc-desc">${s.desc}</div></div><b>${s.id === activeId ? 'ACTIVE' : ''}</b>`;
      el.appendChild(row);
    });
    if (activeId) {
      const row = document.createElement('div');
      row.className = 'qt-row sc-row';
      row.innerHTML = '<i>⌫</i><div><b class="sc-name">Abort scenario</b></div><b></b>';
      el.appendChild(row);
    }
    this.el.scenMenu.classList.remove('hidden');
  }

  hideScenarioMenu () { this.el.scenMenu.classList.add('hidden'); }

  /* ---------------- Alt quick-tune ---------------- */

  showQuickTune (index) {
    const s = this.world.settings;
    if (!this._qtRows) {
      this._qtRows = QUICK_ATTRS.map((a, i) => {
        const row = document.createElement('div');
        row.className = 'qt-row';
        row.innerHTML = `<i>${i + 1}</i><div>${a.label}<div class="qt-bar"><u></u></div></div><b></b>`;
        this.el.quickList.appendChild(row);
        return { row, bar: row.querySelector('u'), val: row.querySelector('b'), a };
      });
    }
    for (let i = 0; i < this._qtRows.length; i++) {
      const r = this._qtRows[i];
      const v = s.get(r.a.k);
      r.row.classList.toggle('sel', i === index);
      r.val.textContent = r.a.fmt(v);
      r.bar.style.width = clamp((v - r.a.min) / (r.a.max - r.a.min), 0, 1) * 100 + '%';
    }
    this.el.quick.classList.remove('hidden');
    this._qtOpen = true;
  }

  hideQuickTune () {
    if (!this._qtOpen) return;
    this._qtOpen = false;
    this.el.quick.classList.add('hidden');
  }

  update (dt) {
    const w = this.world, p = w.player, s = w.settings;

    /* bars */
    const hasHp = s.get('hasHealth') && !s.get('invulnerable');
    this.el.healthWrap.style.opacity = hasHp ? '1' : '0.25';
    this.el.healthFill.style.width = (hasHp ? clamp(p.health / p.maxHealth, 0, 1) * 100 : 100) + '%';
    const eOn = s.get('energyEnabled');
    this.el.energyLabel.textContent = eOn ? 'ENERGY' : 'ENERGY · UNLIMITED';
    this.el.energyFill.style.width = (eOn ? clamp(p.energy / p.maxEnergy, 0, 1) * 100 : 100) + '%';

    /* powerset cards */
    this.cards.forEach((c, i) => c.classList.toggle('active', i === p.powerIndex));

    /* stat readout */
    const spd = Math.round(p.vehicle ? Math.abs(p.vehicle.speed) * 3.6 : p.speed * 3.6);
    const alt = Math.round(p.pos.y);
    const mode = p.vehicle ? 'DRIVING' : p.flying ? (p.speed > 88 ? 'SUPERSONIC' : 'FLIGHT')
      : p.swimming ? 'SWIMMING' : p.grounded ? 'GROUND' : 'AIRBORNE';
    this.el.statline.innerHTML =
      `<b>${mode}</b><br>${spd} km/h &nbsp;·&nbsp; ${alt} m<br>` +
      `crimes stopped <b>${p.stats.crimes}</b> &nbsp;·&nbsp; takedowns <b>${p.stats.takedowns}</b><br>` +
      `<span style="opacity:.55">${w.crime.crimes.length} active on the map</span>`;

    /* nearest crime */
    const near = w.crime.nearestCrime(p.pos);
    if (near && near.dist < 1200) {
      this.el.objective.classList.remove('hidden');
      const c = near.crime;
      this.el.objSub.textContent = `${c.label} — ${Math.round(near.dist)} m — ${c.alive} hostile${c.alive === 1 ? '' : 's'}`;
    } else this.el.objective.classList.add('hidden');

    /* effects */
    this.el.speed.style.opacity = String(p.speedRatio * 0.95);
    const lowHp = (s.get('hasHealth') && !s.get('invulnerable')) ? clamp(1 - p.health / p.maxHealth - 0.62, 0, 0.26) : 0;
    this.el.vign.style.opacity = String(clamp(p.hurtT * 0.75, 0, 0.42) + lowHp);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.el.flash.style.opacity = String(clamp(this.flashT / 0.45, 0, 1) * 0.85);
    } else this.el.flash.style.opacity = '0';

    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.el.notice.classList.remove('show');
    }

    /* running scenario */
    const st = w.scenarios?.status();
    if (st) {
      this.el.scenStatus.classList.remove('hidden');
      this.el.scenTitle.textContent = st.title;
      this.el.scenSub.textContent = st.sub;
    } else this.el.scenStatus.classList.add('hidden');

    const hot = near && near.dist < 40;
    this.el.cross.classList.toggle('hot', !!hot);
    this.el.cross.style.opacity = p.vehicle ? '0' : '0.75';

    this.drawMap();
  }

  /* ---------------- minimap ---------------- */

  drawMap () {
    const g = this.ctx, W = this.el.map.width, H = this.el.map.height;
    const w = this.world, p = w.player;
    const range = this.mapRange;
    const sc = W / (range * 2);
    const cx = W / 2, cy = H / 2;

    // The map turns under a fixed arrow, so it always reads "what's in front of
    // me is up". It follows the CAMERA, not the hero's facing — the camera is
    // where the player is actually looking, and tying it to the body makes the
    // map swing around every time the character turns on the spot.
    // Canvas +Y is world +Z, so pointing the camera's heading at screen-up
    // needs a half turn on top of the yaw.
    const rot = w.cameraRig.yaw + Math.PI;
    const rx = x => (x - p.pos.x) * sc;         // player-relative, pre-rotation
    const ry = z => (z - p.pos.z) * sc;
    const RAD = Math.hypot(W, H) / 2;           // covers the corners once rotated

    g.clearRect(0, 0, W, H);
    g.fillStyle = '#081420';                     // open water
    g.fillRect(0, 0, W, H);

    g.save();
    g.translate(cx, cy);
    g.rotate(rot);

    /* coastline */
    const city = w.city;
    g.fillStyle = '#131a24';
    for (const isl of city.data.islands) {
      const o = isl.outline;
      g.beginPath();
      g.moveTo(rx(o[0][0]), ry(o[0][1]));
      for (let i = 1; i < o.length; i++) g.lineTo(rx(o[i][0]), ry(o[i][1]));
      g.closePath();
      g.fill();
    }
    const pond = city.pond;
    if (Math.hypot(rx(pond.x), ry(pond.z)) < RAD + pond.rx * sc) {
      g.fillStyle = '#081420';
      g.beginPath();
      g.ellipse(rx(pond.x), ry(pond.z), pond.rx * sc, pond.rz * sc, 0, 0, Math.PI * 2);
      g.fill();
    }

    /* crime density heat — only the cells in view */
    const cell = WORLD.CELL * sc;
    const amp = w.settings.get('crimeDensity');
    const ci0 = Math.max(0, Math.floor((p.pos.x - range * 1.5 - WORLD.X0) / WORLD.CELL));
    const ci1 = Math.min(WORLD.BI - 1, Math.floor((p.pos.x + range * 1.5 - WORLD.X0) / WORLD.CELL));
    const cj0 = Math.max(0, Math.floor((p.pos.z - range * 1.5 - WORLD.Z0) / WORLD.CELL));
    const cj1 = Math.min(WORLD.BJ - 1, Math.floor((p.pos.z + range * 1.5 - WORLD.Z0) / WORLD.CELL));
    for (let bj = cj0; bj <= cj1; bj++) {
      for (let bi = ci0; bi <= ci1; bi++) {
        const d = w.crime.density[bj * WORLD.BI + bi] * amp;
        if (d < 0.03) continue;
        const c = WORLD.cellCenter(bi, bj);
        const x = rx(c.x), y = ry(c.z);
        if (Math.hypot(x, y) > RAD + cell) continue;
        g.fillStyle = `rgba(255,${Math.round(90 - d * 60)},${Math.round(80 - d * 50)},${0.06 + d * 0.30})`;
        g.fillRect(x - cell / 2, y - cell / 2, cell, cell);
      }
    }

    /* streets — the real centrelines, elevated ones brighter */
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const reach = range * 1.5;
    for (const e of w.roads.edges) {
      if (e.maxX < p.pos.x - reach || e.minX > p.pos.x + reach || e.maxZ < p.pos.z - reach || e.minZ > p.pos.z + reach) continue;
      const elevated = e.cls === 'bridge' || e.cls === 'viaduct' || e.cls === 'ramp';
      g.strokeStyle = elevated ? 'rgba(200,225,255,0.55)' : 'rgba(140,190,255,0.26)';
      g.lineWidth = clamp(e.width * sc * 0.9, 1, 4.5);
      g.beginPath();
      const pts = e.points;
      g.moveTo(rx(pts[0][0]), ry(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(rx(pts[i][0]), ry(pts[i][1]));
      g.stroke();
    }

    /* vehicles */
    g.fillStyle = 'rgba(190,215,240,0.55)';
    for (const v of w.traffic.vehicles) {
      const x = rx(v.pos.x), y = ry(v.pos.z);
      if (Math.hypot(x, y) > RAD) continue;
      g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }

    /* pedestrians */
    g.fillStyle = 'rgba(120,150,180,0.40)';
    for (const a of w.peds) {
      const x = rx(a.pos.x), y = ry(a.pos.z);
      if (Math.hypot(x, y) > RAD) continue;
      g.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }

    /* aircraft — arrowheads pointing their way, pinned to the rim when far */
    if (w.scenarios?.active) {
      for (const a of w.scenarios.targets) {
        let x = rx(a.pos.x), y = ry(a.pos.z);
        const d = Math.hypot(x, y), rim = Math.min(W, H) / 2 - 8;
        if (d > rim && d > 1e-3) { x = x / d * rim; y = y / d * rim; }
        g.save();
        g.translate(x, y);
        g.rotate(-a.heading + Math.PI);
        const s = a.kind === 'titan' ? 6 : 4;
        g.beginPath(); g.moveTo(0, -s); g.lineTo(-s * 0.7, s); g.lineTo(0, s * 0.45); g.lineTo(s * 0.7, s); g.closePath();
        g.fillStyle = a.kind === 'titan' ? '#ff8a5a' : '#ffd27a';
        g.fill();
        g.restore();
      }
    }

    /* crimes — off-map ones pin to the rim rather than vanishing */
    const t = performance.now() * 0.004;
    for (const c of w.crime.crimes) {
      if (c.state !== 'active') continue;
      let x = rx(c.pos.x), y = ry(c.pos.z);
      const d = Math.hypot(x, y);
      const rim = Math.min(W, H) / 2 - 6;
      const off = d > rim;
      if (off && d > 1e-3) { x = x / d * rim; y = y / d * rim; }
      const pulse = 0.5 + Math.sin(t + c.id) * 0.5;
      g.beginPath();
      g.arc(x, y, off ? 3 : 4 + pulse * 2.5, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,${off ? 140 : 70},${off ? 90 : 100},${off ? 0.75 : 0.35 + pulse * 0.5})`;
      g.fill();
      if (!off) {
        g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2);
        g.fillStyle = '#ffe0d0'; g.fill();
      }
    }
    g.restore();

    /* player — fixed at the centre, always pointing up */
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(-5, 6); g.lineTo(0, 3); g.lineTo(5, 6);
    g.closePath();
    g.fillStyle = p.flying ? '#7ee8ff' : '#ffffff';
    g.shadowColor = '#4fd1ff'; g.shadowBlur = 8;
    g.fill();
    g.restore();

    g.strokeStyle = 'rgba(140,190,255,0.28)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    /* compass: north rides around the rim as the map turns */
    // North is world -Z, which sits at canvas (0,-1) before the rotation and
    // so at (sin rot, -cos rot) after it.
    const nr = Math.min(W, H) / 2 - 9;
    g.fillStyle = 'rgba(200,225,255,0.6)';
    g.font = 'bold 9px system-ui';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', cx + Math.sin(rot) * nr, cy - Math.cos(rot) * nr);
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  }
}
