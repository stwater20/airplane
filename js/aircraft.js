import * as THREE from 'three';
import { RUNWAY_Y, terrainHeight, runwayAt } from './world.js?v=20261105181329';

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

export function buildAircraftModel(livery = 0x1b4f9c) {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f7 });
  const blue = new THREE.MeshLambertMaterial({ color: livery });
  blue.userData.livery = true;
  const grey = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222831 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 34, 20), white);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.rotation.x = -Math.PI / 2;
  nose.scale.set(1, 1.8, 1);
  nose.position.z = -17;
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(2.0, 8, 20), white);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.5, 21);
  g.add(tail);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.02, 2.02, 34, 20, 1, true, Math.PI * 0.42, Math.PI * 0.16), blue);
  stripe.rotation.x = Math.PI / 2;
  stripe.rotation.y = Math.PI / 2;
  g.add(stripe);
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 1.2), glass);
  cockpit.position.set(0, 1.2, -18.6);
  cockpit.rotation.x = 0.5;
  g.add(cockpit);

  // 主翼（後掠）
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(17, 6.5); wingShape.lineTo(17, 8.2); wingShape.lineTo(0, 6.5); wingShape.lineTo(0, 0);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.35, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, grey);
    w.scale.x = side;
    w.position.set(side * 1.5, -1.0, -4);
    w.rotation.z = side * 0.06;
    g.add(w);
    const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 1.6), blue);
    winglet.position.set(side * 18.4, 0.3, 3.4);
    g.add(winglet);
    // 引擎
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.95, 4.2, 16), grey);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(side * 6, -2.1, -3.2);
    g.add(eng);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(1.0, 16), dark);
    intake.position.set(side * 6, -2.1, -5.32);
    intake.rotation.y = Math.PI;
    g.add(intake);
    // 水平尾翼
    const hs = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.25, 2.6), grey);
    hs.position.set(side * 3.6, 0.6, 20.5);
    hs.rotation.y = side * -0.35;
    g.add(hs);
  }
  // 垂直尾翼
  const vShape = new THREE.Shape();
  vShape.moveTo(0, 0); vShape.lineTo(5.5, 0); vShape.lineTo(7.2, 6.8); vShape.lineTo(5.0, 6.8); vShape.lineTo(0, 0);
  const vGeo = new THREE.ExtrudeGeometry(vShape, { depth: 0.3, bevelEnabled: false });
  vGeo.rotateY(-Math.PI / 2);
  const vt = new THREE.Mesh(vGeo, blue);
  vt.position.set(0.15, 1.6, 16.5);
  g.add(vt);

  // 起落架
  const gear = new THREE.Group();
  const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12);
  wheel.rotateZ(Math.PI / 2);
  const strut = new THREE.CylinderGeometry(0.15, 0.15, 1.9, 6);
  for (const [x, z] of [[-3, 0.5], [3, 0.5], [0, -14]]) {
    const s = new THREE.Mesh(strut, grey);
    s.position.set(x, -2.2, z);
    gear.add(s);
    for (const dx of [-0.35, 0.35]) {
      const w = new THREE.Mesh(wheel, dark);
      w.position.set(x + dx, -GEAR_H + 0.55, z);
      gear.add(w);
    }
  }
  g.add(gear);

  // 航行燈
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  red.position.set(-18.5, -0.4, 3.4);
  const green = red.clone(); green.material = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); green.position.x = 18.5;
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.set(0, 2.1, 2);
  g.add(red, green, strobe);

  g.userData = { gear, strobe };
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
    strobe.visible = (this.t % 1.2) < 0.08;
  }
}
