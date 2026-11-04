import { ROUTE, toWorld } from './geo.js?v=20261104213638';
import { runways, RUNWAY_Y, terrainHeight } from './world.js?v=20261104213638';
import { GEAR_H } from './aircraft.js?v=20261104213638';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const KT = 0.514444, FT = 0.3048;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrap180 = (d) => ((d % 360) + 540) % 360 - 180;

export class Autopilot {
  constructor() {
    this.ap = false;
    this.athr = false;
    this.lat = 'HDG';        // HDG | NAV | LOC
    this.vert = 'ALT';       // ALT | GS | FLARE
    this.appArmed = false;
    this.hdg = 53;
    this.alt = 35000;        // ft
    this.spd = 280;          // kt IAS
    this.vsMax = 2500;       // fpm
    this.wp = 1;             // 目前航路點
    this.route = ROUTE.map((p) => ({ ...p, ...toWorld(p.lon, p.lat) }));
    this.ils = null;
    this.msg = '';
    this.assist = { x: 0, y: 0 };   // 輕鬆模式玩家輸入（-1..1）
    this.assistGain = 0;
  }

  ilsRunway() {
    if (!this.ils) this.ils = runways.find((r) => r.ils);
    return this.ils;
  }

  // ILS 幾何：回傳距跑頭距離、偏離中心線、下滑道高度
  ilsData(ac) {
    const r = this.ilsRunway();
    if (!r) return null;
    const thrX = r.cx - r.dirX * r.halfLen, thrZ = r.cz - r.dirZ * r.halfLen;
    const dx = ac.pos.x - thrX, dz = ac.pos.z - thrZ;
    const dist = -(dx * r.dirX + dz * r.dirZ);       // 跑頭前方距離（m）
    const xtk = dx * -r.dirZ + dz * r.dirX;          // 右偏為正（m）
    const gsAlt = RUNWAY_Y + 15 + Math.max(dist, 0) * Math.tan(3 * D2R);
    const h = ac.pos.y - GEAR_H;
    const locDev = Math.atan2(xtk, Math.max(dist + r.halfLen * 2 + 300, 1)) * R2D; // 度
    const gsDev = Math.atan2(h - gsAlt, Math.max(dist, 300)) * R2D;                // 度（正 = 偏高）
    return { r, dist, xtk, gsAlt, locDev, gsDev, h };
  }

  toggleAP(ac) {
    const agl = ac.pos.y - GEAR_H - terrainHeight(ac.pos.x, ac.pos.z);
    if (!this.ap && (ac.onGround || agl < 120)) { this.msg = '自動駕駛需離地 400 ft 以上'; return; }
    this.ap = !this.ap;
    if (this.ap) {
      const att = ac.attitude();
      if (this.lat === 'HDG') this.hdg = Math.round(att.heading);
      this.vert = 'ALT';
    } else {
      this.appArmed = false;
      if (this.lat === 'LOC') this.lat = 'HDG';
    }
  }

  update(ac, dt) {
    // 航路點推進（不論 AP 是否接通）
    const w = this.route[this.wp];
    if (w) {
      const d = Math.hypot(w.x - ac.pos.x, w.z - ac.pos.z);
      if (d < 6000 && this.wp < this.route.length - 1) this.wp++;
    }
    if (!this.ap) return;
    if (ac.crashed) { this.ap = false; return; }

    const att = ac.attitude();
    const h = ac.pos.y - GEAR_H;
    const vs = ac.vel.y;
    const ias = ac.ias / KT;
    const ils = this.ilsData(ac);

    // ── ILS 截獲 ──
    if (this.appArmed && ils && ils.dist > 0 && ils.dist < 50000) {
      const hdgDiff = Math.abs(wrap180(att.heading - ils.r.heading));
      if (this.lat !== 'LOC' && Math.abs(ils.xtk) < 2500 && hdgDiff < 70) { this.lat = 'LOC'; this.msg = 'LOC 截獲'; }
      if (this.lat === 'LOC' && this.vert === 'ALT' && ils.gsDev > -0.1 && ils.gsDev < 1.5 && Math.abs(ils.locDev) < 2) { this.vert = 'GS'; this.msg = 'G/S 截獲'; }
    }

    // ── 側向 ──
    let hdgT = this.hdg;
    if (this.lat === 'NAV') {
      const wpt = this.route[this.wp];
      hdgT = (Math.atan2(wpt.x - ac.pos.x, -(wpt.z - ac.pos.z)) * R2D + 360) % 360;
    } else if (this.lat === 'LOC') {
      hdgT = ils.r.heading - clamp(ils.xtk * 0.025, -30, 30);
      // 修正側滑造成的航跡偏差
      const trk = Math.atan2(ac.vel.x, -ac.vel.z) * R2D;
      hdgT += wrap180(att.heading - trk);
    }
    const herr = wrap180(hdgT - att.heading);
    const bankLim = this.vert === 'FLARE' ? 3 : (this.lat === 'LOC' ? 15 : 25);
    let bankT = clamp(herr * 2.0, -bankLim, bankLim) * D2R;
    // 玩家輸入：直接指定坡度（最多 35°），放開後自動駕駛再把飛機帶回航線
    let ax = this.vert !== 'FLARE' ? this.assist.x * this.assistGain : 0;
    // 進場時別讓玩家把飛機帶離跑道太遠：離中心線超過 900m 時，忽略往外推的輸入
    if (this.lat === 'LOC' && ils) {
      const maxOff = clamp(ils.dist * 0.025, 20, 700);          // 越接近跑道，允許的偏移越小
      if (Math.abs(ils.xtk) > maxOff && ax * ils.xtk > 0) ax = 0;
      else if (Math.abs(ils.xtk) > maxOff * 0.6 && ax * ils.xtk > 0) ax *= 0.4;
    }
    if (Math.abs(ax) > 0.03) bankT = bankT * (1 - Math.abs(ax)) + ax * 35 * D2R;
    ac.input.roll = clamp((bankT - att.bank) * (Math.abs(ax) > 0.03 ? 2.2 : 1.6) - ac.omega.z * 0.0, -1, 1);
    ac.input.yaw = 0;

    // ── 縱向 ──
    let vsT;
    if (this.vert === 'ALT') {
      const altT = this.alt * FT;
      vsT = clamp((altT - h) * 0.06, -this.vsMax * 0.00508 * 0.9, this.vsMax * 0.00508);
      if (vsT > 0) vsT *= clamp((ias - (this.spd - 35)) / 20, 0.15, 1);  // 速度不足時減緩爬升
      // 玩家上下輸入：直接指定升降率（約 ±3500 fpm），而不是只微調
      let ay = this.assist.y * this.assistGain;
      // 離地不足 300m 時，下降輸入逐漸失效（最低約 100m），避免玩家把飛機壓到地上
      const aglA = h - Math.max(RUNWAY_Y, terrainHeight(ac.pos.x, ac.pos.z));
      if (ay < 0) ay *= clamp((aglA - 100) / 200, 0, 1);
      if (Math.abs(ay) > 0.05) vsT = clamp(vsT, -6, 6) * (1 - Math.abs(ay)) + ay * 18;
    } else if (this.vert === 'GS') {
      vsT = -ac.tas * Math.tan(3 * D2R) * Math.cos(0) + (ils.gsAlt - h) * 0.15;
      vsT = clamp(vsT, -8, 2);
      let ayg = this.assist.y * this.assistGain;
      if ((ayg > 0 && h - ils.gsAlt > 150) || (ayg < 0 && ils.gsAlt - h > 60)) ayg = 0;   // 偏離下滑道太多時不再加劇
      if (Math.abs(ayg) > 0.05) vsT = vsT * (1 - Math.abs(ayg)) + ayg * 10;
      const ra = h - RUNWAY_Y;
      if (ra < 18) { this.vert = 'FLARE'; this.msg = 'FLARE'; }
    }
    if (this.vert === 'FLARE') {
      const ra = h - RUNWAY_Y;
      vsT = -Math.max(0.7, ra * 0.24);
      let cmd = clamp((vsT - vs) * 0.15, -0.5, 0.5);
      if (att.pitch > 7 * D2R) cmd = Math.min(cmd, 0);
      ac.input.pitch = cmd;
      if (ra < 9) ac.throttle = Math.max(0, ac.throttle - dt * 0.15);
      if (ac.onGround) {
        this.ap = false; this.athr = false; this.appArmed = false;
        ac.spoilers = true; ac.brakes = true; ac.throttle = 0; ac.input.pitch = 0;
        this.msg = '接地！減速板與自動煞車啟動';
      }
      return;
    }
    const manualV = Math.abs(this.assist.y * this.assistGain) > 0.05 && !(this.assist.y < 0 && this.vert === 'ALT' && h - Math.max(RUNWAY_Y, terrainHeight(ac.pos.x, ac.pos.z)) < 110) && !(this.vert === 'GS' && ((this.assist.y > 0 && h - ils.gsAlt > 150) || (this.assist.y < 0 && ils.gsAlt - h > 60)));
    ac.input.pitch = manualV ? clamp((vsT - vs) * 0.06, -0.9, 0.9) : clamp((vsT - vs) * 0.025, -0.6, 0.6);

    // ── 自動油門 ──
    if (this.athr) {
      let spdT = this.spd;
      if (ac.mach > 0.3) spdT = Math.min(spdT, ias * 0.80 / ac.mach);   // 高空以 M0.80 為上限
      if (this.vert === 'GS') spdT = Math.min(spdT, ac.flaps >= 4 ? 140 : 160);
      this.spdTarget = spdT;
      const err = spdT - ias;
      const dIas = this.prevIas == null ? 0 : (ias - this.prevIas) / dt;
      this.prevIas = ias;
      ac.throttle = clamp(ac.throttle + (err * 0.01 - dIas * 0.12) * dt, 0, 1);
      if (err < -15 && ac.throttle < 0.02 && !ac.spoilers) {
        if (!this.warnedSpd) this.msg = '速度過快：放減速板 (H)';
        this.warnedSpd = true;
      } else if (err > -5) this.warnedSpd = false;
    } else this.prevIas = null;
  }
}
