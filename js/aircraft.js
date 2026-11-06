import * as THREE from 'three';
import { RUNWAY_Y, terrainHeight, runwayAt } from './world.js?v=20261106162641';

// 單位：SI。機身座標：-Z 前、+Y 上、+X 右
const G = 9.81;
const MASS = 70000;
const WING_AREA = 122.6;
const MAX_THRUST = 2 * 120000;
const CL0 = 0.25, CLA = 5.5, ALPHA_STALL = 15 * Math.PI / 180;
const CD0 = 0.022, K_IND = 0.045;
export const GEAR_H = 3.4;  // 機身原點到輪胎底
const FLAP_STEPS = [0, 1, 2, 3, 4];           // 0 / 1 / 2 / 3 / FULL
const FLAP_CL = [0, 0.25, 0.45, 0.65, 0.85];
const FLAP_CD = [0, 0.004, 0.012, 0.025, 0.045];
export const FLAP_NAMES = ['UP', '1', '2', '3', 'FULL'];

export function airDensity(h) { return 1.225 * Math.exp(-Math.max(h, 0) / 8500); }

// 機身沿長度的剖面（z：機頭 -19 → 機尾 20.5，r：半徑）；點的間距決定 UV 的 v
const FUS = (() => {
  const pts = [];
  const nose = [[-19.2, 0.02], [-19.0, 0.45], [-18.6, 0.85], [-18.0, 1.22], [-17.2, 1.55], [-16.3, 1.78], [-15.3, 1.93], [-14.2, 2.0]];
  nose.forEach(([z, r]) => pts.push([z, r]));
  for (let z = -13; z <= 11; z += 1) pts.push([z, 2.0]);
  [[12.5, 1.95], [14, 1.8], [15.5, 1.55], [17, 1.22], [18.3, 0.9], [19.4, 0.62], [20.3, 0.4], [20.8, 0.18]].forEach((p) => pts.push(p));
  return pts;
})();
const upsweep = (z) => (z > 8 ? Math.pow(z - 8, 1.35) * 0.085 : 0);   // 機尾上揚

// 機身貼圖：白色機身、駕駛艙擋風玻璃、客艙窗戶、艙門（u：圓周、v：沿機身）
function fuselageTexture() {
  const W = 512, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f3f5f8'; g.fillRect(0, 0, W, H);
  const n = FUS.length - 1;
  const vOf = (z) => { for (let i = 0; i < n; i++) if (z <= FUS[i + 1][0]) return (i + (z - FUS[i][0]) / (FUS[i + 1][0] - FUS[i][0])) / n; return 1; };
  const uR = 0.305, uL = 0.695;   // 窗戶高度（左右兩側）
  // 擋風玻璃
  g.fillStyle = '#1b2633';
  const vw0 = vOf(-17.6) * H, vw1 = vOf(-16.4) * H;
  g.beginPath(); g.moveTo(W * 0.37, vw1); g.lineTo(W * 0.40, vw0); g.lineTo(W * 0.60, vw0); g.lineTo(W * 0.63, vw1); g.closePath(); g.fill();
  g.strokeStyle = '#f3f5f8'; g.lineWidth = 4;
  for (const u of [0.45, 0.5, 0.55]) { g.beginPath(); g.moveTo(W * u, vw0); g.lineTo(W * u, vw1); g.stroke(); }
  // 客艙窗戶
  g.fillStyle = '#26323f';
  for (let z = -12.5; z <= 10.5; z += 0.85) {
    if (Math.abs(z - 3.2) < 0.9) continue;            // 緊急出口位置留空
    const v = vOf(z) * H;
    for (const u of [uR, uL]) { g.beginPath(); g.ellipse(W * u, v, 6, 9, 0, 0, Math.PI * 2); g.fill(); }
  }
  // 艙門
  g.strokeStyle = '#9aa3ad'; g.lineWidth = 3;
  for (const z of [-13.6, 11.8]) for (const u of [uR, uL]) { const v = vOf(z) * H; g.strokeRect(W * u - 11, v - 22, 22, 44); }
  // 機腹灰色
  const grd = g.createLinearGradient(0, 0, W * 0.2, 0);
  grd.addColorStop(0, 'rgba(150,158,168,0.55)'); grd.addColorStop(1, 'rgba(150,158,168,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W * 0.2, H);
  const grd2 = g.createLinearGradient(W, 0, W * 0.8, 0);
  grd2.addColorStop(0, 'rgba(150,158,168,0.55)'); grd2.addColorStop(1, 'rgba(150,158,168,0)');
  g.fillStyle = grd2; g.fillRect(W * 0.8, 0, W * 0.2, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;
  return t;
}

function tailLogo() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.font = 'bold 190px -apple-system, "Helvetica Neue", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('S', 128, 140);
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.lineWidth = 14; g.strokeStyle = '#ffffff'; g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let FUS_TEX = null, LOGO_TEX = null, GLOW_TEX = null;
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function latheAlong(points, segs, phiStart, phiLen, scale = 1) {
  const geo = new THREE.LatheGeometry(points.map(([z, r]) => new THREE.Vector2(r * scale, z)), segs, phiStart, phiLen);
  geo.rotateX(Math.PI / 2);                // 讓旋轉軸沿機身 z 方向
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + upsweep(p.getZ(i)));
  geo.computeVertexNormals();
  return geo;
}

export function buildAircraftModel(livery = 0x1b4f9c) {
  const g = new THREE.Group();
  FUS_TEX ||= fuselageTexture(); LOGO_TEX ||= tailLogo(); GLOW_TEX ||= glowTexture();
  const body = new THREE.MeshLambertMaterial({ map: FUS_TEX });
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f7 });
  const blue = new THREE.MeshLambertMaterial({ color: livery });
  blue.userData.livery = true;
  const grey = new THREE.MeshLambertMaterial({ color: 0xaab2bc });
  const metal = new THREE.MeshLambertMaterial({ color: 0x6d747d });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c2026 });

  // 機身＋腹部塗裝（同樣的剖面，只取下半圈並稍微放大）
  g.add(new THREE.Mesh(latheAlong(FUS, 32, 0, Math.PI * 2), body));
  const belly = latheAlong(FUS.slice(6, FUS.length - 2), 20, -1.05, 2.1, 1.012);
  g.add(new THREE.Mesh(belly, blue));
  // 機翼腹部整流罩
  const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), grey);
  fair.scale.set(2.4, 0.9, 7); fair.position.set(0, -1.55, -0.5);
  g.add(fair);

  // 主翼（後掠）
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(16.5, 6.3); wingShape.lineTo(16.8, 7.9); wingShape.lineTo(0, 6.8); wingShape.lineTo(0, 0);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.38, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  wingGeo.rotateX(Math.PI / 2);
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, grey);
    w.scale.x = side;
    w.position.set(side * 1.5, -1.0, -4);
    w.rotation.z = side * 0.065;
    g.add(w);
    // 鯊鰭小翼（塗裝色）
    const wl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 1.5), blue);
    wl.position.set(side * 18.3, 0.35, 3.6); wl.rotation.z = side * -0.22;
    g.add(wl);
    // 襟翼滑軌整流罩
    for (const d of [5, 9, 13]) {
      const ft = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.6, 6), grey);
      ft.rotation.x = Math.PI / 2; ft.position.set(side * d, -1.25 + d * 0.065 * 0.5, 2.3 + d * 0.38);
      g.add(ft);
    }
    // 引擎：進氣口唇緣、風扇、尾錐、掛架
    const nac = new THREE.LatheGeometry([[0.98, -2.4], [1.16, -2.25], [1.2, -1.7], [1.15, 0.5], [0.88, 1.9], [0.62, 2.2]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
    nac.rotateX(Math.PI / 2);
    const eng = new THREE.Mesh(nac, blue);
    eng.position.set(side * 6, -2.15, -3.2);
    g.add(eng);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.12, 8, 24), metal);
    lip.position.set(side * 6, -2.15, -5.6);
    g.add(lip);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.98, 24), dark);
    fan.position.set(side * 6, -2.15, -5.35); fan.rotation.y = Math.PI;
    g.add(fan);
    const spin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 12), metal);
    spin.rotation.x = -Math.PI / 2; spin.position.set(side * 6, -2.15, -5.5);
    g.add(spin);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 12), metal);
    cone.rotation.x = Math.PI / 2; cone.position.set(side * 6, -2.15, -0.3);
    g.add(cone);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 3.6), grey);
    pylon.position.set(side * 6, -1.4, -2.6);
    g.add(pylon);
    // 水平尾翼
    const hsShape = new THREE.Shape();
    hsShape.moveTo(0, 0); hsShape.lineTo(5.8, 2.4); hsShape.lineTo(5.9, 3.4); hsShape.lineTo(0, 3.2); hsShape.lineTo(0, 0);
    const hsGeo = new THREE.ExtrudeGeometry(hsShape, { depth: 0.22, bevelEnabled: false });
    hsGeo.rotateX(Math.PI / 2);
    const hs = new THREE.Mesh(hsGeo, grey);
    hs.scale.x = side; hs.position.set(side * 0.6, 0.95, 16.6); hs.rotation.z = side * 0.09;
    g.add(hs);
  }
  // 垂直尾翼（塗裝色）＋標誌
  const vShape = new THREE.Shape();
  vShape.moveTo(0, 0); vShape.lineTo(5.6, 0); vShape.lineTo(7.4, 7.0); vShape.lineTo(5.2, 7.0); vShape.lineTo(0, 0);
  const vGeo = new THREE.ExtrudeGeometry(vShape, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
  vGeo.rotateY(-Math.PI / 2);
  const vt = new THREE.Mesh(vGeo, blue);
  vt.position.set(0.16, 1.9, 14.6);
  g.add(vt);
  for (const side of [1, -1]) {
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: LOGO_TEX, transparent: true, depthWrite: false }));
    logo.position.set(side * 0.27, 5.6, 19.0);
    logo.rotation.y = side * Math.PI / 2;
    g.add(logo);
  }

  // 起落架
  const gear = new THREE.Group();
  const wheel = new THREE.CylinderGeometry(0.58, 0.58, 0.42, 14);
  wheel.rotateZ(Math.PI / 2);
  const strut = new THREE.CylinderGeometry(0.16, 0.16, 1.9, 6);
  for (const [x, z] of [[-3, 0.5], [3, 0.5], [0, -14]]) {
    const st = new THREE.Mesh(strut, metal);
    st.position.set(x, -2.2, z);
    gear.add(st);
    for (const dx of [-0.36, 0.36]) {
      const w = new THREE.Mesh(wheel, dark);
      w.position.set(x + dx, -GEAR_H + 0.58, z);
      gear.add(w);
    }
  }
  g.add(gear);

  // 燈光：航行燈（紅左綠右）、頻閃、防撞燈、落地燈光暈
  const lamp = (color, x, y, z, size) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(size); m.add(glow);
    g.add(m);
    return m;
  };
  lamp(0xff2a2a, -18.4, 0.15, 3.0, 2.2);
  lamp(0x2aff5a, 18.4, 0.15, 3.0, 2.2);
  const strobe = new THREE.Group();
  for (const x of [-18.5, 18.5]) { const s = lamp(0xffffff, x, 0.1, 3.6, 4.5); strobe.add(s); }
  g.add(strobe);
  const beacon = new THREE.Group();
  beacon.add(lamp(0xff3b30, 0, 2.15, 1.5, 3.2), lamp(0xff3b30, 0, -2.2, 0, 3.2));
  g.add(beacon);
  const landing = new THREE.Group();
  for (const x of [-2.6, 2.6]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xfff2d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(6); s.position.set(x, -1.2, -5.2);
    landing.add(s);
  }
  g.add(landing);

  g.userData = { gear, strobe, beacon, landing };
  return g;
}

export class Aircraft {
  constructor() {
    this.mesh = buildAircraftModel();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();   // 機身角速度（x=俯仰, y=偏航, z=滾轉；右手座標）
    this.throttle = 0;
    this.flaps = 2;
    this.flapPos = 2;                   // 實際襟翼位置（平滑）
    this.gearDown = true;
    this.gearPos = 1;
    this.brakes = false;
    this.spoilers = false;
    this.onGround = true;
    this.crashed = false;
    this.crashReason = '';
    this.landed = null;                 // 落地資訊
    this.touchdown = null;
    this.input = { pitch: 0, roll: 0, yaw: 0 };
    this.t = 0;
    // 給 HUD / 自動駕駛
    this.alpha = 0; this.beta = 0; this.ias = 0; this.tas = 0; this.mach = 0; this.gLoad = 1;
    this.stall = false; this.CL = 0.5; this.CLmax = 1.5;
    this.rollRateMax = 0.26;   // 最大滾轉率（rad/s）；輕鬆模式會調高
    this.groundEffect = 0.35;
  }

  placeOnRunway(rw, fromEnd = -1) {
    const s = fromEnd * rw.halfLen * 0.45;   // 從靠近停機坪的滑行道口進跑道（仍有約 2.8 km 可用）
    this.pos.set(rw.cx + rw.dirX * s, RUNWAY_Y + GEAR_H, rw.cz + rw.dirZ * s);
    const hr = rw.heading * Math.PI / 180;
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -hr);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.onGround = true;
    this.crashed = false;
    this.landed = null;
    this.touchdown = null;
    this.throttle = 0;
    this.flaps = 2; this.flapPos = 2;
    this.gearDown = true; this.gearPos = 1;
    this.brakes = false; this.spoilers = false;
  }

  // 取得姿態角
  attitude() {
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    let hdg = (-e.y * 180 / Math.PI) % 360;
    if (hdg < 0) hdg += 360;
    return { heading: hdg, pitch: e.x, bank: -e.z };
  }

  step(dt) {
    if (this.crashed) return;
    this.t += dt;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);

    // 襟翼與起落架動畫
    this.flapPos += Math.sign(this.flaps - this.flapPos) * Math.min(Math.abs(this.flaps - this.flapPos), dt * 0.25);
    this.gearPos += Math.sign((this.gearDown ? 1 : 0) - this.gearPos) * Math.min(Math.abs((this.gearDown ? 1 : 0) - this.gearPos), dt * 0.12);
    const fi = Math.floor(this.flapPos), ff = this.flapPos - fi;
    const flapCL = FLAP_CL[fi] + (FLAP_CL[Math.min(fi + 1, 4)] - FLAP_CL[fi]) * ff;
    const flapCD = FLAP_CD[fi] + (FLAP_CD[Math.min(fi + 1, 4)] - FLAP_CD[fi]) * ff;

    const h = this.pos.y - GEAR_H;
    const rho = airDensity(h);
    const V = this.vel.length();
    const qbar = 0.5 * rho * V * V;
    this.tas = V;
    this.ias = V * Math.sqrt(rho / 1.225);
    this.mach = V / (340 - 0.0039 * Math.min(h, 11000));

    // 機身座標下的速度
    const inv = this.quat.clone().invert();
    const vb = this.vel.clone().applyQuaternion(inv);
    const alpha = V > 1 ? Math.atan2(-vb.y, -vb.z) : 0;
    const beta = V > 1 ? Math.atan2(vb.x, -vb.z) : 0;
    this.alpha = alpha; this.beta = beta;

    // 升力係數（含失速）
    let CL = CL0 + flapCL + CLA * alpha;
    const aStall = ALPHA_STALL - this.flapPos * 0.005;
    this.stall = alpha > aStall;
    if (alpha > aStall) CL = (CL0 + flapCL + CLA * aStall) * Math.max(0.35, 1 - (alpha - aStall) * 4);
    // 地面效應：離地小於約一個翼展時升力增加、誘導阻力減少，讓拉平落地更柔和
    const geH = Math.max(0, h - RUNWAY_Y);
    const ge = geH < 36 ? Math.pow(1 - geH / 36, 2) : 0;
    if (!this.onGround) CL *= 1 + this.groundEffect * ge;
    this.CL = Math.max(CL, 0.01); this.CLmax = CL0 + flapCL + CLA * aStall;
    if (this.spoilers) CL *= this.onGround ? 0.2 : 0.85;
    const CD = CD0 + K_IND * CL * CL + flapCD + this.gearPos * 0.018 + (this.spoilers ? 0.05 : 0);

    const force = new THREE.Vector3(0, -MASS * G, 0);
    if (V > 0.5) {
      const vDir = this.vel.clone().divideScalar(V);
      const liftDir = up.clone().addScaledVector(vDir, -up.dot(vDir)).normalize();
      force.addScaledVector(liftDir, qbar * WING_AREA * CL);
      force.addScaledVector(vDir, -qbar * WING_AREA * CD);
      force.addScaledVector(right, -qbar * WING_AREA * 0.6 * beta);
    }
    const thrust = this.throttle * MAX_THRUST * Math.pow(rho / 1.225, 0.7) * Math.max(0.6, 1 - this.mach * 0.25);
    force.addScaledVector(fwd, thrust);
    const liftAcc = (V > 0.5) ? qbar * WING_AREA * CL / MASS : 0;
    this.gLoad = liftAcc / G;

    // ───── 飛控律（線傳飛控） ─────
    const att = this.attitude();
    const eff = Math.min(1.3, qbar / 3000);
    const agl = h - terrainHeight(this.pos.x, this.pos.z);
    const target = new THREE.Vector3();  // 期望角速度 (x 俯仰上, y 偏航左, z 滾轉左)
    const inp = this.input;

    if (this.onGround) {
      // 地面：俯仰直接控制（抬輪），方向舵/前輪轉向
      target.x = inp.pitch * 0.07 * Math.min(1, eff * 1.5);
      const steer = Math.min(1, V / 8) * (V < 30 ? 0.25 : 0.05);
      target.y = -inp.yaw * steer;
      target.z = 0;
    } else {
      const gamma = V > 1 ? Math.asin(THREE.MathUtils.clamp(this.vel.y / V, -1, 1)) : 0;
      const cosB = Math.max(0.4, Math.cos(att.bank));
      // 航跡轉動率（前饋）：機身法向/側向加速度 ÷ 速度
      const pathRate = V > 20 ? force.dot(up) / MASS / V : 0;
      const yawRate = V > 20 ? force.dot(right) / MASS / V : 0;
      if (agl < 15 || V < 50) {
        // 低高度：姿態保持（起飛、拉平）
        target.x = inp.pitch * 0.08 * Math.min(1, eff);
      } else {
        const nCmd = Math.cos(gamma) / cosB + inp.pitch * (inp.pitch > 0 ? 1.4 : 1.25);
        const clReq = nCmd * MASS * G / Math.max(qbar * WING_AREA, 1);
        let aReq = (clReq - CL0 - flapCL) / CLA;
        aReq = THREE.MathUtils.clamp(aReq, -5 * Math.PI / 180, aStall - 2.5 * Math.PI / 180);
        target.x = pathRate + 2.0 * (aReq - alpha);
      }
      // 滾轉：桿量 = 滾轉率；放開則保持坡度，超過 33° 自動回正
      let rollRate = inp.roll * this.rollRateMax;
      if (Math.abs(inp.roll) < 0.05 && Math.abs(att.bank) > 0.576) rollRate = -Math.sign(att.bank) * 0.08;
      if (Math.abs(att.bank) > 1.15 && Math.sign(inp.roll) === Math.sign(att.bank)) rollRate = 0;
      target.z = -rollRate;
      // 偏航：自動協調（消除側滑）＋方向舵
      target.y = -yawRate - 2.5 * beta - inp.yaw * 0.06;
    }
    // 一階響應
    const k = Math.min(1, dt * 3.0);
    this.omega.lerp(target, k);

    // 積分姿態
    const ang = this.omega.length() * dt;
    if (ang > 0) {
      const dq = new THREE.Quaternion().setFromAxisAngle(this.omega.clone().normalize(), ang);
      this.quat.multiply(dq).normalize();
    }

    // ───── 地面 ─────
    const accel = force.divideScalar(MASS);
    if (this.onGround) {
      const N = Math.max(0, MASS * G - (liftAcc * MASS) * up.y);
      const mu = this.brakes ? 0.45 : 0.015;
      const vh = new THREE.Vector3(this.vel.x, 0, this.vel.z);
      const sp = vh.length();
      if (sp > 0.05) accel.addScaledVector(vh.normalize(), -mu * N / MASS);
      else if (this.throttle < 0.08) this.vel.multiplyScalar(0);
    }
    this.vel.addScaledVector(accel, dt);

    if (this.onGround) {
      // 輪胎：消除側向速度
      const fh = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const along = this.vel.x * fh.x + this.vel.z * fh.z;
      this.vel.x = fh.x * along; this.vel.z = fh.z * along;
      if (along < 0 && this.vel.y <= 0) { this.vel.x = 0; this.vel.z = 0; }
    }
    this.pos.addScaledVector(this.vel, dt);

    // 接地判定
    const groundY = RUNWAY_Y + GEAR_H;
    const terrain = terrainHeight(this.pos.x, this.pos.z);
    if (terrain > 5 && this.pos.y - 2 < terrain) return this.crash('撞山');
    if (this.pos.y <= groundY) {
      const rw = runwayAt(this.pos.x, this.pos.z);
      const vs = this.vel.y;
      if (!this.onGround) {
        const pitchDeg = att.pitch * 180 / Math.PI, bankDeg = att.bank * 180 / Math.PI;
        if (!rw) return this.crash(this.pos.y < 3 ? '墜入地面／海面（不在跑道上）' : '墜毀');
        if (!this.gearDown || this.gearPos < 0.95) return this.crash('未放起落架，機腹著地');
        if (vs < -4.5) return this.crash(`重落地 (${Math.round(vs * 196.85)} fpm)`);
        if (Math.abs(bankDeg) > 10) return this.crash('翼尖觸地');
        if (pitchDeg > 11.5) return this.crash('機尾擦地');
        if (pitchDeg < -3) return this.crash('前輪先著地，結構損壞');
        this.touchdown = { vs: vs * 196.85, rw, ias: this.ias * 1.94384 };
        this.onGround = true;
      }
      this.pos.y = groundY;
      if (this.vel.y < 0) this.vel.y = 0;
      // 機鼻不得低於水平、無滾轉
      const a2 = this.attitude();
      let pitch = a2.pitch;
      if (pitch < 0) pitch = 0;
      if (pitch > 11.5 * Math.PI / 180) return this.crash('機尾擦地');
      // 前輪落下（無升力時）
      if (pitch > 0 && this.omega.x <= 0.0001) pitch = Math.max(0, pitch - dt * 0.05);
      const e = new THREE.Euler(pitch, -a2.heading * Math.PI / 180, 0, 'YXZ');
      this.quat.setFromEuler(e);
      if (this.omega.x < 0 && pitch <= 0) this.omega.x = 0;
      this.omega.z = 0;
      if (!rw && this.vel.length() > 5) return this.crash('衝出跑道');
    } else if (this.onGround && this.pos.y > groundY + 0.3) {
      this.onGround = false;
    }

    // 落地完成：在成田跑道上停止
    if (this.onGround && this.touchdown && this.vel.length() < 3) {
      const rw = runwayAt(this.pos.x, this.pos.z);
      if (rw && rw.airport === (this.dest || 'NRT') && !this.landed) this.landed = { ...this.touchdown, time: this.t };
    }
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    const { gear, strobe } = this.mesh.userData;
    gear.visible = this.gearPos > 0.05;
    gear.scale.y = Math.max(0.05, this.gearPos);
    gear.position.y = (1 - this.gearPos) * 1.5;
    const ph = this.t % 1.2;
    strobe.visible = ph < 0.06 || (ph > 0.16 && ph < 0.22);   // 雙閃
    const { beacon, landing } = this.mesh.userData;
    if (beacon) beacon.visible = (this.t % 1.0) < 0.12;
    if (landing) landing.visible = this.gearDown && this.gearPos > 0.9;
  }
}
