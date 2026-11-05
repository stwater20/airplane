import { COASTLINES, ROUTE, toLonLat } from './geo.js?v=20261105230830';
import { FLAP_NAMES, GEAR_H } from './aircraft.js?v=20261105230830';
import { terrainHeight } from './world.js?v=20261105230830';
import { wrap180 } from './autopilot.js?v=20261105230830';

const R2D = 180 / Math.PI;
const GREEN = '#3dff8a', CYAN = '#4fe3ff', MAG = '#ff5cf0', AMBER = '#ffb52e', WHITE = '#f4f7fb';

export class HUD {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.mapZoom = 1;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.dpr = dpr;
    this.c.width = innerWidth * dpr;
    this.c.height = innerHeight * dpr;
    this.w = innerWidth; this.h = innerHeight;
  }

  draw(ac, ap, sim) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const att = ac.attitude();
    const alt = (ac.pos.y - GEAR_H - 2) * 3.28084;
    const ias = ac.ias * 1.94384;
    const vs = ac.vel.y * 196.85;
    const compact = this.w < 700;
    const cockpit = sim.camMode === 1;
    // 駕駛艙視角：置中大型 HUD；其他視角：縮小置於下方
    const S = cockpit ? (compact ? 0.7 : 1) : Math.max(0.5, Math.min(0.72, (this.w - 560) / 600, (this.h - 120) / 640));
    const cx = this.w / 2;
    const cy = cockpit ? this.h * 0.42 : this.h - 250 * S - (compact ? 150 : 8);
    g.globalAlpha = cockpit ? 1 : 0.95;
    this.horizon(g, cx, cy, att, 150 * S, ac, ap);
    this.tape(g, cx - 210 * S, cy, ias, 10, 'SPD', ap.ap || ap.athr ? Math.round(ap.spdTarget ?? ap.spd) : null, S, ac);
    this.tape(g, cx + 210 * S, cy, alt, 100, 'ALT', ap.ap ? ap.alt : null, S);
    this.vsi(g, cx + 275 * S, cy, vs, S);
    this.compass(g, cx, cy + 190 * S, att.heading, ap, S);

    // ── 狀態面板（左下） ──
    const lines = [
      [`THR ${Math.round(ac.throttle * 100)}%`, ac.throttle > 0.95 ? AMBER : WHITE],
      [`FLAPS ${FLAP_NAMES[ac.flaps]}`, WHITE],
      [`GEAR ${ac.gearDown ? (ac.gearPos > 0.99 ? 'DOWN' : 'TRANSIT') : (ac.gearPos < 0.01 ? 'UP' : 'TRANSIT')}`, ac.gearDown ? GREEN : WHITE],
      [`BRK ${ac.brakes ? 'ON' : 'OFF'}   SPLR ${ac.spoilers ? 'ON' : 'OFF'}`, ac.brakes ? AMBER : WHITE],
      [`GS ${Math.round(Math.hypot(ac.vel.x, ac.vel.z) * 1.94384)} kt   TAS ${Math.round(ac.tas * 1.94384)}   M${ac.mach.toFixed(2)}`, WHITE],
      [`G ${ac.gLoad.toFixed(2)}   AoA ${(ac.alpha * R2D).toFixed(1)}°`, WHITE],
      [`TIME x${sim.timeScale}${sim.paused ? '  PAUSED' : ''}`, sim.timeScale > 1 ? AMBER : WHITE],
    ];
    g.font = `${13 * S}px ui-monospace, Menlo, monospace`;
    g.textAlign = 'left';
    const px = 14, py = this.h - 14 - lines.length * 17 * S;
    g.fillStyle = 'rgba(0,10,20,0.55)';
    g.fillRect(px - 8, py - 18 * S, 300 * S, lines.length * 17 * S + 14);
    lines.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, px, py + i * 17 * S); });

    // ── FMA（自動駕駛模式）──
    g.font = `bold ${14 * S}px ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    const fx = cx, fy = compact ? 150 : 22 * S;
    g.fillStyle = 'rgba(0,10,20,0.55)';
    g.fillRect(fx - 230 * S, fy - 16 * S, 460 * S, 24 * S);
    const fma = [
      [ap.athr ? 'SPEED' : '', GREEN],
      [ap.ap ? (ap.vert === 'GS' ? 'G/S' : ap.vert === 'FLARE' ? 'FLARE' : 'ALT') : '', GREEN],
      [ap.ap ? ap.lat : (ap.appArmed ? 'APP' : ''), GREEN],
      [ap.ap ? 'AP1' : '', WHITE],
      [ap.athr ? 'A/THR' : '', WHITE],
    ];
    fma.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, fx - 184 * S + i * 92 * S, fy); });
    if (ap.appArmed && ap.lat !== 'LOC') { g.fillStyle = CYAN; g.font = `${11 * S}px ui-monospace, monospace`; g.fillText('LOC  G/S armed', fx + 92 * S, fy + 16 * S); }

    // ── ILS 偏差 ──
    const ils = ap.ilsData(ac);
    if (ils && ils.dist > -500 && ils.dist < 60000 && Math.abs(wrap180(att.heading - ils.r.heading)) < 90) {
      this.ilsDiamonds(g, cx, cy, ils, 150 * S);
      g.fillStyle = MAG; g.font = `${13 * S}px ui-monospace, monospace`; g.textAlign = 'left';
      g.fillText(`ILS 34L  ${(ils.dist / 1852).toFixed(1)} NM`, cx - 150 * S, cy - 160 * S);
    }
    // 無線電高度
    const ra = (ac.pos.y - GEAR_H - Math.max(2, terrainHeight(ac.pos.x, ac.pos.z))) * 3.28084;
    if (ra < 2500 && !ac.onGround) {
      g.fillStyle = ra < 500 ? AMBER : GREEN; g.font = `bold ${18 * S}px ui-monospace, monospace`; g.textAlign = 'center';
      g.fillText(Math.max(0, Math.round(ra)), cx, cy + 120 * S);
    }

    // ── 警告 ──
    const warns = [];
    if (ac.stall) warns.push('STALL');
    if (!ac.onGround && ra < 800 && vs < -2000) warns.push('SINK RATE');
    if (!ac.onGround && ra < 1000 && !ac.gearDown && ias < 190) warns.push('TOO LOW — GEAR');
    if (ias > 350 && alt < 25000 || ac.mach > 0.86) warns.push('OVERSPEED');
    if (warns.length) {
      g.font = `bold ${22 * S}px ui-monospace, monospace`; g.textAlign = 'center';
      g.fillStyle = (performance.now() % 600) < 350 ? '#ff3030' : AMBER;
      g.fillText(warns.join('  '), cx, cy - 190 * S);
    }

    g.globalAlpha = 1;
    this.map(g, ac, ap, S);
  }

  horizon(g, cx, cy, att, R, ac, ap) {
    const pxPerDeg = R / 22;
    g.save();
    g.beginPath(); g.rect(cx - R, cy - R, R * 2, R * 2); g.clip();
    g.translate(cx, cy);
    g.rotate(-att.bank);
    const off = att.pitch * R2D * pxPerDeg;
    g.fillStyle = 'rgba(40,120,220,0.35)'; g.fillRect(-R * 2, -R * 4 + off, R * 4, R * 4);
    g.fillStyle = 'rgba(140,90,40,0.35)'; g.fillRect(-R * 2, off, R * 4, R * 4);
    g.strokeStyle = WHITE; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-R * 2, off); g.lineTo(R * 2, off); g.stroke();
    g.font = '11px ui-monospace, monospace'; g.fillStyle = WHITE; g.textAlign = 'right';
    g.lineWidth = 1.2;
    for (let p = -30; p <= 30; p += 2.5) {
      if (p === 0) continue;
      const y = off - p * pxPerDeg;
      const wdt = (p % 10 === 0 ? 50 : p % 5 === 0 ? 30 : 12) * R / 150;
      g.beginPath(); g.moveTo(-wdt, y); g.lineTo(wdt, y); g.stroke();
      if (p % 10 === 0) { g.fillText(Math.abs(p), -wdt - 4, y + 4); }
    }
    // 飛行路徑向量
    const V = ac.vel.length();
    if (V > 20) {
      const gamma = Math.asin(ac.vel.y / V) * R2D;
      const trk = Math.atan2(ac.vel.x, -ac.vel.z) * R2D;
      const dh = wrap180(trk - att.heading);
      const fx = dh * pxPerDeg, fy = off - gamma * pxPerDeg;
      g.strokeStyle = GREEN; g.lineWidth = 2;
      g.beginPath(); g.arc(fx, fy, 7, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(fx - 18, fy); g.lineTo(fx - 7, fy); g.moveTo(fx + 7, fy); g.lineTo(fx + 18, fy); g.moveTo(fx, fy - 7); g.lineTo(fx, fy - 14); g.stroke();
    }
    g.restore();

    // 坡度刻度
    g.save(); g.translate(cx, cy);
    g.strokeStyle = WHITE; g.lineWidth = 1.5;
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (b - 90) * Math.PI / 180;
      const r1 = R * 0.95, r2 = R * (Math.abs(b) % 30 === 0 ? 0.86 : 0.9);
      g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); g.stroke();
    }
    g.rotate(-att.bank);
    g.fillStyle = Math.abs(att.bank * R2D) > 35 ? AMBER : WHITE;
    g.beginPath(); g.moveTo(0, -R * 0.85); g.lineTo(-8, -R * 0.75); g.lineTo(8, -R * 0.75); g.fill();
    g.restore();

    // 機體符號
    g.strokeStyle = AMBER; g.lineWidth = 4 * R / 150;
    g.beginPath();
    const u = R / 150;
    g.moveTo(cx - 90 * u, cy); g.lineTo(cx - 35 * u, cy); g.lineTo(cx - 35 * u, cy + 10 * u);
    g.moveTo(cx + 90 * u, cy); g.lineTo(cx + 35 * u, cy); g.lineTo(cx + 35 * u, cy + 10 * u);
    g.stroke();
    g.fillStyle = AMBER; g.fillRect(cx - 4, cy - 4, 8, 8);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.strokeRect(cx - R, cy - R, R * 2, R * 2);
  }

  tape(g, x, cy, value, step, label, bug, S, ac) {
    const H = 300 * S, W = 74 * S, pxPerUnit = (label === 'SPD' ? 4 : 0.12) * S;
    g.save();
    g.fillStyle = 'rgba(0,10,20,0.55)';
    g.fillRect(x - W / 2, cy - H / 2, W, H);
    g.beginPath(); g.rect(x - W / 2, cy - H / 2, W, H); g.clip();
    g.strokeStyle = WHITE; g.fillStyle = WHITE; g.lineWidth = 1;
    g.font = `${12 * S}px ui-monospace, monospace`;
    const major = label === 'SPD' ? 20 : 500;
    const minor = label === 'SPD' ? 10 : 100;
    const range = H / 2 / pxPerUnit;
    const side = label === 'SPD' ? 1 : -1;
    const edge = x + side * W / 2;
    for (let v = Math.floor((value - range) / minor) * minor; v <= value + range; v += minor) {
      if (label === 'SPD' && v < 30) continue;
      const y = cy - (v - value) * pxPerUnit;
      const len = v % major === 0 ? 12 : 6;
      g.beginPath(); g.moveTo(edge, y); g.lineTo(edge - side * len, y); g.stroke();
      if (v % major === 0) {
        g.textAlign = side > 0 ? 'right' : 'left';
        g.fillText(v, edge - side * 16, y + 4);
      }
    }
    if (label === 'SPD' && ac) {
      // 失速速度帶（估算）
      const vs1g = ac.onGround ? 0 : ac.ias * 1.94384 * Math.sqrt(Math.max(0.01, ac.CL / ac.CLmax));
      const ys = cy - (vs1g - value) * pxPerUnit;
      g.fillStyle = 'rgba(255,40,40,0.6)';
      g.fillRect(edge - 5, ys, 5, H);
    }
    if (bug != null) {
      const y = THREE_clamp(cy - (bug - value) * pxPerUnit, cy - H / 2 + 6, cy + H / 2 - 6);
      g.fillStyle = CYAN;
      g.beginPath(); g.moveTo(edge, y); g.lineTo(edge + side * 9, y - 7); g.lineTo(edge + side * 9, y + 7); g.fill();
    }
    g.restore();
    // 讀數窗
    g.fillStyle = '#000'; g.strokeStyle = AMBER; g.lineWidth = 2;
    g.fillRect(x - W / 2 - 4, cy - 15 * S, W + 8, 30 * S);
    g.strokeRect(x - W / 2 - 4, cy - 15 * S, W + 8, 30 * S);
    g.fillStyle = GREEN; g.textAlign = 'center';
    g.font = `bold ${17 * S}px ui-monospace, monospace`;
    g.fillText(Math.round(value), x, cy + 6 * S);
    g.fillStyle = CYAN; g.font = `${12 * S}px ui-monospace, monospace`;
    g.fillText(bug != null ? Math.round(bug) : label, x, cy - H / 2 - 8);
  }

  vsi(g, x, cy, vs, S) {
    const H = 220 * S;
    g.fillStyle = 'rgba(0,10,20,0.55)';
    g.fillRect(x - 14 * S, cy - H / 2, 34 * S, H);
    const y = cy - Math.sign(vs) * Math.min(1, Math.sqrt(Math.abs(vs) / 6000)) * H / 2;
    g.strokeStyle = Math.abs(vs) > 4000 ? AMBER : GREEN; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - 10 * S, y); g.lineTo(x + 18 * S, cy); g.stroke();
    g.fillStyle = WHITE; g.font = `${11 * S}px ui-monospace, monospace`; g.textAlign = 'center';
    if (Math.abs(vs) > 200) g.fillText(Math.round(vs / 100) * 100, x + 3 * S, vs > 0 ? cy - H / 2 - 6 : cy + H / 2 + 14);
  }

  compass(g, cx, y, hdg, ap, S) {
    const W = 300 * S, pxPerDeg = 3 * S;
    g.save();
    g.fillStyle = 'rgba(0,10,20,0.55)';
    g.fillRect(cx - W / 2, y - 12, W, 34 * S);
    g.beginPath(); g.rect(cx - W / 2, y - 12, W, 40 * S); g.clip();
    g.strokeStyle = WHITE; g.fillStyle = WHITE; g.font = `${12 * S}px ui-monospace, monospace`; g.textAlign = 'center';
    for (let d = Math.floor(hdg - 60); d <= hdg + 60; d++) {
      if (d % 5) continue;
      const xx = cx + (d - hdg) * pxPerDeg;
      g.beginPath(); g.moveTo(xx, y - 12); g.lineTo(xx, y - 12 + (d % 10 ? 5 : 9)); g.stroke();
      if (d % 30 === 0) {
        const n = ((d % 360) + 360) % 360;
        g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0'), xx, y + 12 * S);
      }
    }
    if (ap.ap && ap.lat === 'HDG') {
      const xx = cx + wrap180(ap.hdg - hdg) * pxPerDeg;
      g.fillStyle = CYAN; g.fillRect(xx - 4, y - 12, 8, 6);
    }
    const wpt = ap.route[ap.wp];
    if (wpt) {
      // 航路點方位
      g.fillStyle = MAG;
      const sim = window.__sim;
      if (sim) {
        const brg = (Math.atan2(wpt.x - sim.ac.pos.x, -(wpt.z - sim.ac.pos.z)) * R2D + 360) % 360;
        const xx = cx + THREE_clamp(wrap180(brg - hdg), -48, 48) * pxPerDeg;
        g.beginPath(); g.moveTo(xx, y - 12); g.lineTo(xx - 5, y - 20); g.lineTo(xx + 5, y - 20); g.fill();
      }
    }
    g.restore();
    g.fillStyle = AMBER;
    g.beginPath(); g.moveTo(cx, y - 10); g.lineTo(cx - 6, y - 22); g.lineTo(cx + 6, y - 22); g.fill();
    g.fillStyle = '#000'; g.fillRect(cx - 24 * S, y + 20 * S, 48 * S, 20 * S);
    g.fillStyle = GREEN; g.font = `bold ${14 * S}px ui-monospace, monospace`; g.textAlign = 'center';
    g.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, y + 35 * S);
  }

  ilsDiamonds(g, cx, cy, ils, R) {
    g.strokeStyle = WHITE; g.lineWidth = 1.5;
    // 刻度點
    for (let i = -2; i <= 2; i++) {
      if (!i) continue;
      g.beginPath(); g.arc(cx + i * R * 0.35, cy + R + 14, 3, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx + R + 14, cy + i * R * 0.35, 3, 0, Math.PI * 2); g.stroke();
    }
    const dot = (v, scale) => THREE_clamp(v / scale, -2.3, 2.3) * R * 0.35;
    g.fillStyle = MAG;
    const lx = cx - dot(ils.locDev, 0.8);  // 1 dot ≈ 0.8°
    const gy = cy + dot(ils.gsDev, 0.35);  // 1 dot ≈ 0.35°
    diamond(g, lx, cy + R + 14);
    diamond(g, cx + R + 14, gy);
  }

  // apple = 輕鬆模式的圓角玻璃風格
  map(g, ac, ap, S, apple = false) {
    const size = apple ? 190 : (this.w < 700 ? 150 : 230);
    const x0 = this.w - size - (apple ? 12 : 14), y0 = this.h - size - (apple ? 12 : 14);
    g.save();
    g.fillStyle = apple ? 'rgba(28,28,30,0.62)' : 'rgba(5,20,40,0.82)';
    g.beginPath();
    if (apple) g.roundRect(x0, y0, size, size, 22); else g.rect(x0, y0, size, size);
    g.fill(); g.clip();
    const me = toLonLat(ac.pos.x, ac.pos.z);
    const spanDeg = [24, 8, 2, 0.5][this.mapZoom];
    const cxm = this.mapZoom === 0 ? 131 : me.lon, cym = this.mapZoom === 0 ? 30.3 : me.lat;
    const k = size / spanDeg;
    const P = (lon, lat) => [x0 + size / 2 + (lon - cxm) * k * Math.cos(30 * Math.PI / 180), y0 + size / 2 - (lat - cym) * k];
    g.fillStyle = apple ? '#3d4a3c' : '#2e4b2a'; g.strokeStyle = apple ? 'rgba(255,255,255,0.18)' : '#6f8f5a'; g.lineWidth = 1;
    for (const pts of Object.values(COASTLINES)) {
      g.beginPath();
      pts.forEach(([lo, la], i) => { const [px, py] = P(lo, la); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath(); g.fill(); g.stroke();
    }
    const ROUTE_C = apple ? '#0a84ff' : MAG;
    g.strokeStyle = ROUTE_C; g.lineWidth = apple ? 2.5 : 1.5; g.lineCap = 'round'; g.beginPath();
    ap.route.forEach((p, i) => { const [px, py] = P(p.lon, p.lat); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
    g.font = apple ? '600 10px -apple-system, sans-serif' : '9px ui-monospace, monospace'; g.textAlign = 'left';
    ap.route.forEach((p, i) => {
      const [px, py] = P(p.lon, p.lat);
      g.fillStyle = i === ap.wp ? (apple ? '#ffd60a' : MAG) : WHITE;
      if (apple) { if (i === 0 || i === ap.route.length - 1 || i === ap.wp) { g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill(); } } else g.fillRect(px - 2, py - 2, 4, 4);
      if (apple && !(i === 0 || i === ap.route.length - 1)) return;
      if (this.mapZoom > 0 || i === 0 || i === ap.route.length - 1) g.fillText(p.name, px + 4, py - 3);
    });
    const [ax, ay] = P(me.lon, me.lat);
    const hd = ac.attitude().heading * Math.PI / 180;
    g.save(); g.translate(ax, ay); g.rotate(hd);
    g.fillStyle = apple ? '#ffffff' : AMBER; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.fill();
    g.restore();
    g.restore();
    if (apple) return;
    // 剩餘距離
    const dest = ap.route[ap.route.length - 1];
    const dist = Math.hypot(dest.x - ac.pos.x, dest.z - ac.pos.z) / 1852;
    const wpt = ap.route[ap.wp];
    const wd = Math.hypot(wpt.x - ac.pos.x, wpt.z - ac.pos.z) / 1852;
    const gs = Math.max(1, Math.hypot(ac.vel.x, ac.vel.z) * 1.94384);
    const ete = dist / gs * 60;
    g.fillStyle = 'rgba(5,20,40,0.82)'; g.fillRect(x0, y0 - 38, size, 36);
    g.font = '11px ui-monospace, monospace'; g.textAlign = 'left'; g.fillStyle = MAG;
    g.fillText(`→ ${wpt.name}  ${wd.toFixed(0)} NM`, x0 + 6, y0 - 24);
    g.fillStyle = WHITE;
    g.fillText(`NRT ${dist.toFixed(0)} NM  ETE ${Math.floor(ete / 60)}:${String(Math.floor(ete % 60)).padStart(2, '0')}`, x0 + 6, y0 - 9);
    g.font = '9px ui-monospace, monospace'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.textAlign = 'right';
    g.fillText('M 切換縮放', x0 + size - 4, y0 + size - 4);
  }
}

function diamond(g, x, y) {
  g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y); g.lineTo(x, y + 7); g.lineTo(x - 6, y); g.closePath(); g.fill();
}
function THREE_clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
