import { CITY } from '../world/RoadNetwork.js';
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
      quickList: $('qtList')
    };
    this.ctx = this.el.map.getContext('2d');
    this.noticeT = 0;
    this.flashT = 0;
    this.mapRange = 460;
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
    g.fillStyle = '#080c14';
    g.fillRect(0, 0, W, H);

    g.save();
    g.translate(cx, cy);
    g.rotate(rot);

    /* crime density heat */
    const B = CITY.BLOCKS;
    const cell = CITY.CELL * sc;
    const amp = w.settings.get('crimeDensity');
    for (let bj = 0; bj < B; bj++) {
      for (let bi = 0; bi < B; bi++) {
        const d = w.crime.density[bj * B + bi] * amp;
        if (d < 0.03) continue;
        const wx = (bi - (B - 1) / 2) * CITY.CELL;
        const wz = (bj - (B - 1) / 2) * CITY.CELL;
        const x = rx(wx), y = ry(wz);
        if (Math.hypot(x, y) > RAD + cell) continue;
        g.fillStyle = `rgba(255,${Math.round(90 - d * 60)},${Math.round(80 - d * 50)},${0.06 + d * 0.30})`;
        g.fillRect(x - cell / 2, y - cell / 2, cell, cell);
      }
    }

    /* street grid */
    g.strokeStyle = 'rgba(140,190,255,0.20)';
    g.lineWidth = 1.5;
    g.beginPath();
    const G = CITY.GRID;
    for (let i = 0; i < G; i++) {
      const v = (i - (G - 1) / 2) * CITY.CELL;
      const x = rx(v), y = ry(v);
      if (Math.abs(x) < RAD) { g.moveTo(x, -RAD); g.lineTo(x, RAD); }
      if (Math.abs(y) < RAD) { g.moveTo(-RAD, y); g.lineTo(RAD, y); }
    }
    g.stroke();

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
