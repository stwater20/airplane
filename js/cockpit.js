// 駕駛艙內裝：儀表板、遮光板、窗框，以及即時繪製的 PFD / ND / 引擎顯示器
import * as THREE from 'three';
import { GEAR_H } from './aircraft.js?v=20261106162641';

const R2D = 180 / Math.PI;

function screen(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d'), tex };
}

export class Cockpit {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.visible = false;
    camera.add(this.group);
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    const panelMat = basic(0x23272e), shieldMat = basic(0x14171b), frameMat = basic(0x1b1e23), bezel = basic(0x0b0d10);
    // 主儀表板（略為後傾）
    this.panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.62, 0.06), panelMat);
    this.panel.position.set(0, -0.44, -0.92); this.panel.rotation.x = -0.32;
    this.group.add(this.panel);
    // 遮光板
    this.shield = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.34), shieldMat);
    this.shield.position.set(0, -0.16, -0.84);
    this.group.add(this.shield);
    // 窗框：左右斜柱、中柱、上框
    this.pillars = [];
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.6, 0.06), frameMat);
      p.position.set(side * 0.78, 0.25, -0.9); p.rotation.z = side * 0.42;
      this.group.add(p); this.pillars.push(p);
    }
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), frameMat); mid.position.set(0, 0.12, -0.95); this.group.add(mid);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.06), frameMat); top.position.set(0, 0.5, -0.92); this.group.add(top);
    this.mid = mid; this.top = top;
    // 三個顯示器
    this.pfd = screen(256, 256); this.nd = screen(256, 256); this.eng = screen(256, 256);
    this.screens = [this.pfd, this.nd, this.eng].map((sc) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.33, 0.02), bezel);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: sc.tex }));
      m.position.z = 0.012; frame.add(m);
      frame.rotation.x = -0.32;
      this.group.add(frame);
      return frame;
    });
    this.timer = 0;
  }

  layout(aspect) {
    // 直式手機視野窄：把顯示器往中間收
    const k = Math.min(1, Math.max(0.45, aspect / 1.4));
    const xs = [-0.36, 0, 0.36].map((x) => x * k);
    this.screens.forEach((s, i) => s.position.set(xs[i], -0.35, -0.885));
    this.pillars.forEach((p, i) => p.position.x = (i ? 1 : -1) * (0.78 * Math.max(0.55, k)));
  }

  update(dt, ac, ap, camera, show) {
    this.group.visible = show;
    if (!show) return;
    this.layout(camera.aspect);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.drawPFD(ac, ap); this.drawND(ac, ap); this.drawENG(ac);
  }

  drawPFD(ac, ap) {
    const { g, tex } = this.pfd, W = 256, cx = 128, cy = 120;
    const att = ac.attitude();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    g.save(); g.beginPath(); g.rect(40, 30, 176, 180); g.clip();
    g.translate(cx, cy); g.rotate(-att.bank);
    const off = att.pitch * R2D * 4;
    g.fillStyle = '#2f80d8'; g.fillRect(-200, -400 + off, 400, 400);
    g.fillStyle = '#8a5a2b'; g.fillRect(-200, off, 400, 400);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-200, off); g.lineTo(200, off); g.stroke();
    g.lineWidth = 1; g.font = '10px sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'right';
    for (let p = -20; p <= 20; p += 5) { if (!p) continue; const y = off - p * 4, w = p % 10 ? 10 : 22; g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke(); if (!(p % 10)) g.fillText(Math.abs(p), -w - 3, y + 4); }
    g.restore();
    g.strokeStyle = '#ffcc00'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 44, cy); g.lineTo(cx - 14, cy); g.lineTo(cx - 14, cy + 7); g.moveTo(cx + 44, cy); g.lineTo(cx + 14, cy); g.lineTo(cx + 14, cy + 7); g.stroke();
    g.fillStyle = '#ffcc00'; g.fillRect(cx - 3, cy - 3, 6, 6);
    // 速度與高度帶
    const kt = Math.round(ac.ias * 1.94384), ft = Math.round((ac.pos.y - GEAR_H - 2) * 3.28084);
    g.fillStyle = 'rgba(40,44,52,0.9)'; g.fillRect(0, 30, 38, 180); g.fillRect(218, 30, 38, 180);
    g.fillStyle = '#000'; g.fillRect(0, cy - 11, 40, 22); g.fillRect(214, cy - 11, 42, 22);
    g.strokeStyle = '#ffcc00'; g.lineWidth = 1.5; g.strokeRect(0, cy - 11, 40, 22); g.strokeRect(214, cy - 11, 42, 22);
    g.fillStyle = '#3dff8a'; g.font = 'bold 13px monospace'; g.textAlign = 'center';
    g.fillText(kt, 20, cy + 5); g.fillText(ft > 9999 ? Math.round(ft / 100) * 100 : ft, 235, cy + 5);
    g.fillStyle = '#9fb3c8'; g.font = '9px monospace'; g.fillText('KT', 20, 26); g.fillText('FT', 236, 26);
    // 航向與 FMA
    g.fillStyle = '#000'; g.fillRect(96, 216, 64, 22); g.fillStyle = '#3dff8a'; g.font = 'bold 13px monospace';
    g.fillText(String(Math.round(att.heading) % 360).padStart(3, '0'), 128, 232);
    g.fillStyle = '#3dff8a'; g.font = '9px monospace';
    g.fillText(`${ap.athr ? 'SPEED' : ''}  ${ap.ap ? (ap.vert === 'GS' ? 'G/S' : ap.vert) : ''}  ${ap.ap ? ap.lat : ''}  ${ap.ap ? 'AP1' : ''}`, 128, 14);
    tex.needsUpdate = true;
  }

  drawND(ac, ap) {
    const { g, tex } = this.nd, W = 256, cx = 128, cy = 170;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const hdg = ac.attitude().heading * Math.PI / 180, scale = 1 / 900;   // 每像素 900m
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    for (const r of [50, 100, 150]) { g.beginPath(); g.arc(cx, cy, r, Math.PI, 2 * Math.PI); g.stroke(); }
    const P = (x, z) => { const dx = (x - ac.pos.x) * scale, dz = (z - ac.pos.z) * scale; const c = Math.cos(hdg), s = Math.sin(hdg); return [cx + dx * c + dz * s, cy + dz * c - dx * s]; };
    g.strokeStyle = '#ff5cf0'; g.lineWidth = 2; g.beginPath();
    ap.route.forEach((p, i) => { const [x, y] = P(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = '#fff'; g.font = '9px monospace'; g.textAlign = 'left';
    ap.route.forEach((p, i) => { const [x, y] = P(p.x, p.z); if (x > 0 && x < W && y > 0 && y < W) { g.fillStyle = i === ap.wp ? '#ff5cf0' : '#fff'; g.fillRect(x - 2, y - 2, 4, 4); g.fillText(p.name, x + 4, y - 3); } });
    g.fillStyle = '#ffcc00'; g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx - 7, cy + 8); g.lineTo(cx + 7, cy + 8); g.closePath(); g.fill();
    g.fillStyle = '#3dff8a'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
    const w = ap.route[ap.wp];
    if (w) g.fillText(`${w.name}  ${(Math.hypot(w.x - ac.pos.x, w.z - ac.pos.z) / 1852).toFixed(0)} NM`, cx, 16);
    g.fillStyle = '#9fb3c8'; g.font = '9px monospace'; g.fillText(`GS ${Math.round(Math.hypot(ac.vel.x, ac.vel.z) * 1.94384)}  TAS ${Math.round(ac.tas * 1.94384)}`, cx, 248);
    tex.needsUpdate = true;
  }

  drawENG(ac) {
    const { g, tex } = this.eng, W = 256;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const n1 = 20 + ac.throttle * 78;
    for (const [i, x] of [[0, 70], [1, 186]]) {
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(x, 80, 42, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
      g.strokeStyle = '#3dff8a'; g.lineWidth = 6; g.beginPath(); g.arc(x, 80, 42, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * n1 / 100)); g.stroke();
      g.fillStyle = '#3dff8a'; g.font = 'bold 15px monospace'; g.textAlign = 'center'; g.fillText(n1.toFixed(1), x, 86);
      g.fillStyle = '#9fb3c8'; g.font = '10px monospace'; g.fillText(`N1  ENG${i + 1}`, x, 140);
    }
    g.fillStyle = '#fff'; g.font = '12px monospace'; g.textAlign = 'left';
    g.fillText(`FLAPS  ${['UP', '1', '2', '3', 'FULL'][ac.flaps]}`, 24, 186);
    g.fillStyle = ac.gearDown ? '#3dff8a' : '#9fb3c8';
    g.fillText(`GEAR   ${ac.gearDown ? 'DOWN ▼▼▼' : 'UP'}`, 24, 208);
    g.fillStyle = ac.spoilers ? '#ffb52e' : '#9fb3c8';
    g.fillText(`SPLR   ${ac.spoilers ? 'ARMED' : 'RET'}`, 24, 230);
    tex.needsUpdate = true;
  }
}
