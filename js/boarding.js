// 乘客登機：桃園機場遠端停機位
// 接駁巴士 → 登機梯車 → 左前門；地面有導引線、機位編號、安全錐，引導員揮棒，右側有行李輸送帶車、行李拖車與空廚車
import * as THREE from 'three';
import { runways, RUNWAY_Y } from './world.js?v=20261105230830';
import { GEAR_H } from './aircraft.js?v=20261105230830';

const TOTAL = 180;
const WALKERS = 30;
const APRON = 1.62;                         // 停機坪地面高度

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class Boarding {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const rw = runways.find((r) => r.airport === 'TPE' && r.id.startsWith('05R'));
    this.rw = rw;
    const F = new THREE.Vector3(rw.dirX, 0, rw.dirZ), R = new THREE.Vector3(-rw.dirZ, 0, rw.dirX), U = new THREE.Vector3(0, 1, 0);
    const O = new THREE.Vector3(rw.cx, APRON, rw.cz).addScaledVector(F, -rw.halfLen * 0.3).addScaledVector(R, 330);
    this.standPos = O.clone().setY(RUNWAY_Y + GEAR_H - 0.4);
    this.yaw = -rw.heading * Math.PI / 180;
    this.quat = new THREE.Quaternion().setFromAxisAngle(U, this.yaw);
    // 機身座標（x 右、h 離地高、z 往機尾）→ 世界座標
    const W = (x, h, z) => O.clone().addScaledVector(R, x).addScaledVector(F, -z).setY(APRON + h);
    this.W = W;
    const add = (geo, mat, x, h, z, rotY = 0) => { const m = new THREE.Mesh(geo, mat); m.position.copy(W(x, h, z)); m.rotation.y = this.yaw + rotY; this.group.add(m); return m; };
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    const white = lam(0xf4f5f7), grey = lam(0x8d939b), dark = lam(0x22262c), yellow = lam(0xffc61a), orange = lam(0xff7a1a), glass = lam(0x2b3b4d);

    // ── 地面標線：導引線、停止線、機位編號、機位邊界 ──
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd21f });
    const flat = (w, l, mat, x, z, rot = 0) => { const g = new THREE.PlaneGeometry(w, l); g.rotateX(-Math.PI / 2); const m = add(g, mat, x, 0.02, z, rot); return m; };
    flat(0.3, 70, lineMat, 0, 8);
    flat(5, 0.5, lineMat, 0, -22);
    const standTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#ffd21f'; g.font = 'bold 150px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A5', w / 2, h / 2); });
    const sn = flat(6, 6, new THREE.MeshBasicMaterial({ map: standTex, transparent: true, depthWrite: false }), 0, -28);
    sn.rotation.z = Math.PI;
    const redMat = new THREE.MeshBasicMaterial({ color: 0xb8343a, transparent: true, opacity: 0.7 });
    for (const x of [-24, 24]) flat(0.15, 66, redMat, x, 4);
    for (const z of [-29, 37]) flat(48, 0.15, redMat, 0, z);

    // ── 安全錐、輪檔 ──
    const coneGeo = new THREE.ConeGeometry(0.22, 0.7, 10); coneGeo.translate(0, 0.35, 0);
    for (const [x, z] of [[-18.8, 3.4], [18.8, 3.4], [0, -21], [0, 23], [-6, -7], [6, -7]]) {
      add(coneGeo, orange, x, 0, z);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.12, 10), white); band.position.copy(W(x, 0.42, z)); this.group.add(band);
    }
    for (const dz of [-0.9, 0.9]) add(new THREE.BoxGeometry(0.9, 0.3, 0.35), yellow, 0, 0.15, -14 + dz);

    // ── 登機梯車（左前門）──
    const doorX = -2.05, doorZ = -13.6, sill = 3.1;
    this.door = W(doorX, sill + 0.9, doorZ);
    const topX = -3.9, botX = -11.4, steps = 14;
    add(new THREE.BoxGeometry(1.6, 0.12, 2.2), grey, (doorX + topX) / 2 - 0.3, sill, doorZ);            // 頂部平台
    for (let i = 0; i < steps; i++) {                                                                // 一階一階的樓梯
      const f = (i + 0.5) / steps;
      add(new THREE.BoxGeometry(0.55, 0.06, 1.7), grey, topX + (botX - topX) * f, sill * (1 - f), doorZ);
    }
    const len = Math.hypot(topX - botX, sill);
    for (const dz of [-0.95, 0.95]) {
      const side = add(new THREE.BoxGeometry(len, 0.35, 0.08), white, (topX + botX) / 2, sill / 2 + 0.1, doorZ + dz);
      side.rotateZ(Math.atan2(sill, topX - botX) * -1);
      const rail = add(new THREE.CylinderGeometry(0.04, 0.04, len, 6), white, (topX + botX) / 2, sill / 2 + 1.05, doorZ + dz);
      rail.rotation.order = 'YXZ'; rail.rotation.z = Math.PI / 2 - Math.atan2(sill, botX - topX);
      for (let k = 0; k <= 4; k++) { const f = k / 4; add(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), white, topX + (botX - topX) * f, sill * (1 - f) + 0.6, doorZ + dz); }
    }
    add(new THREE.BoxGeometry(2.2, 0.08, 2.6), white, topX + 0.2, sill + 2.3, doorZ);                    // 頂棚
    for (const dz of [-1.1, 1.1]) add(new THREE.BoxGeometry(0.08, 2.3, 0.08), white, topX + 0.9, sill + 1.15, doorZ + dz);
    add(new THREE.BoxGeometry(8.5, 0.7, 2.4), yellow, -8.6, 0.75, doorZ);                                // 車架
    add(new THREE.BoxGeometry(2.2, 1.9, 2.4), white, -13.7, 1.2, doorZ);                                 // 車頭
    add(new THREE.BoxGeometry(1.3, 0.8, 2.42), glass, -14.2, 1.7, doorZ);
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14); wheel.rotateX(Math.PI / 2);
    for (const x of [-6, -12.6]) for (const dz of [-1.2, 1.2]) add(wheel, dark, x, 0.42, doorZ + dz, Math.PI / 2);

    // ── 接駁巴士（側面有「資安航空」字樣）──
    const busTex = canvasTex(1024, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2f7be0'); gr.addColorStop(1, '#174f9e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b2b3d'; g.fillRect(30, 40, w - 60, 90);                               // 車窗帶
      g.fillStyle = 'rgba(255,255,255,0.18)'; for (let x = 60; x < w - 60; x += 120) g.fillRect(x, 44, 50, 20);
      g.fillStyle = '#d7dee8'; g.fillRect(330, 40, 90, 200); g.fillRect(700, 40, 90, 200);   // 車門
      g.fillStyle = '#1b2b3d'; g.fillRect(345, 55, 25, 170); g.fillRect(380, 55, 25, 170); g.fillRect(715, 55, 25, 170); g.fillRect(750, 55, 25, 170);
      g.fillStyle = '#fff'; g.font = 'bold 44px -apple-system, "PingFang TC", sans-serif'; g.fillText('資安航空 SecTools Airlines', 60, 190);
    });
    const busMat = new THREE.MeshLambertMaterial({ map: busTex });
    const busEnd = lam(0x2563c0);
    const bx = -30, bz = -7;
    const bus = add(new THREE.BoxGeometry(2.6, 3.0, 12.5), [busMat, busMat, lam(0xdfe3e8), dark, busEnd, busEnd], bx, 1.85, bz);
    void bus;
    for (const z of [-4, 3.8]) for (const dx of [-1.3, 1.3]) add(wheel, dark, bx + dx, 0.45, bz + z, Math.PI / 2);
    const busDoor = W(bx + 1.6, 0, bz - 2.2);

    // ── 右側：行李輸送帶車、行李拖車隊、空廚車 ──
    const holdX = 2.1, holdZ = 8.5;
    const belt = add(new THREE.BoxGeometry(7.5, 0.25, 1.1), dark, holdX + 3.4, 1.3, holdZ);
    belt.rotateZ(Math.atan2(2.3, 7.0));
    add(new THREE.BoxGeometry(6, 0.8, 1.8), yellow, holdX + 4.2, 0.55, holdZ);
    this.beltBags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.35, 0.8), lam(0xffffff), 7);
    const bagC = [0x2c3e50, 0xc0392b, 0x8e44ad, 0x16a085, 0x7f8c8d, 0xd35400, 0x34495e], cc = new THREE.Color();
    for (let i = 0; i < 7; i++) this.beltBags.setColorAt(i, cc.setHex(bagC[i]));
    this.beltBags.frustumCulled = false;
    this.group.add(this.beltBags);
    this.beltA = W(holdX + 7.2, 0.4, holdZ); this.beltB = W(holdX + 0.4, 2.7, holdZ);
    add(new THREE.BoxGeometry(1.6, 1.2, 2.4), yellow, 14, 0.75, 4);                                       // 拖車
    for (let k = 0; k < 3; k++) {
      const z = 8 + k * 4.2;
      add(new THREE.BoxGeometry(1.8, 0.25, 3.4), grey, 14, 0.55, z);
      for (let j = 0; j < 5; j++) add(new THREE.BoxGeometry(0.5, 0.35 + (j % 2) * 0.15, 0.75), lam(bagC[(k * 5 + j) % 7]), 13.5 + (j % 2) * 0.9, 0.85, z - 1.2 + Math.floor(j / 2) * 0.9);
    }
    add(new THREE.BoxGeometry(2.6, 2.6, 5), white, 6.2, 3.6, -12.2);                                      // 空廚車車廂（升起）
    add(new THREE.BoxGeometry(2.4, 2.2, 0.3), grey, 6.2, 1.2, -12.2);                                     // 剪式升降
    add(new THREE.BoxGeometry(2.4, 1.8, 2), white, 6.2, 1.1, -16.2);
    add(new THREE.BoxGeometry(2.42, 0.7, 1.2), glass, 6.2, 1.5, -16.9);

    // ── 照明燈塔 ──
    const glowTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
    this.lamps = [];
    for (const [x, z] of [[34, -36], [34, 44]]) {
      add(new THREE.CylinderGeometry(0.3, 0.45, 26, 8), grey, x, 13, z);
      add(new THREE.BoxGeometry(3, 0.8, 1.2), dark, x, 26, z);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1c9, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(14); s.position.copy(W(x, 25.6, z)); this.group.add(s); this.lamps.push(s);
    }

    // ── 引導員（揮紅色指揮棒）──
    this.marshal = [];
    const vest = lam(0xff8c1a), pants = lam(0x23324a), skin = lam(0xe8b98a);
    for (const x of [-2.5, 2.5]) {
      const p = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.24), pants); leg.position.y = 0.43; p.add(leg);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.3), vest); body.position.y = 1.18; p.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), skin); head.position.y = 1.66; p.add(head);
      const arms = [];
      for (const side of [-1, 1]) {
        const arm = new THREE.Group(); arm.position.set(side * 0.3, 1.45, 0);
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.6, 0.11), vest); a.position.y = 0.28; arm.add(a);
        const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 })); wand.position.y = 0.8; arm.add(wand);
        const wg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3b30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); wg.scale.setScalar(1.2); wg.position.y = 0.85; arm.add(wg);
        p.add(arm); arms.push({ arm, side });
      }
      p.scale.setScalar(1.15);
      p.position.copy(W(x, 0, -24));
      p.rotation.y = this.yaw + Math.PI;
      this.group.add(p);
      this.marshal.push(arms);
    }

    // ── 乘客路徑：巴士門 → 梯腳 → 梯頂 → 機門 ──
    this.path = [busDoor, W(botX - 0.6, 0, doorZ), W(topX, sill, doorZ), W(doorX - 0.2, sill, doorZ)];
    this.segLen = this.path.slice(1).map((p, i) => p.distanceTo(this.path[i]));
    this.totalLen = this.segLen.reduce((a, b) => a + b, 0);

    // ── 乘客（Instanced：軀幹、頭、頭髮、雙腿、雙臂、行李箱＋拉桿）──
    const box = (w, h, d, ty = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, ty, 0); return g; };
    const mk = (geo, color) => { const m = new THREE.InstancedMesh(geo, lam(color), WALKERS); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; this.group.add(m); return m; };
    this.parts = {
      torso: mk(box(0.44, 0.62, 0.26, 0.31), 0xffffff),
      head: mk(new THREE.SphereGeometry(0.13, 10, 8), 0xe8b98a),
      hair: mk(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), 0xffffff),
      legL: mk(box(0.17, 0.82, 0.2, -0.41), 0xffffff), legR: mk(box(0.17, 0.82, 0.2, -0.41), 0xffffff),
      armL: mk(box(0.11, 0.58, 0.11, -0.29), 0xffffff), armR: mk(box(0.11, 0.58, 0.11, -0.29), 0xffffff),
      bag: mk(box(0.36, 0.5, 0.22, 0.25), 0xffffff), handle: mk(box(0.03, 0.5, 0.03, 0.25), 0x333333),
    };
    const shirts = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0x34495e, 0xff8fb8, 0xe67e22, 0x1abc9c];
    const trousers = [0x2c3e50, 0x34495e, 0x5d4037, 0x1f2a44, 0x7f8c8d, 0xbdc3c7];
    const hairs = [0x1b1b1b, 0x3e2723, 0x5d4037, 0x9e9e9e, 0x212121, 0x795548];
    const bags = [0x222222, 0xc0392b, 0x2980b9, 0x8e44ad, 0xd4a017, 0x7f8c8d, 0xff8fb8];
    for (let i = 0; i < WALKERS; i++) {
      const sh = cc.setHex(shirts[i % shirts.length]).clone();
      this.parts.torso.setColorAt(i, sh); this.parts.armL.setColorAt(i, sh); this.parts.armR.setColorAt(i, sh);
      const tr = cc.setHex(trousers[(i * 3) % trousers.length]).clone();
      this.parts.legL.setColorAt(i, tr); this.parts.legR.setColorAt(i, tr);
      this.parts.hair.setColorAt(i, cc.setHex(hairs[(i * 5) % hairs.length]));
      this.parts.bag.setColorAt(i, cc.setHex(bags[(i * 7) % bags.length]));
    }
    this.walkers = Array.from({ length: WALKERS }, (_, i) => ({ t: -i * 1.25, speed: 1.15 + ((i * 37) % 10) / 22, size: 0.88 + ((i * 53) % 20) / 100 }));
    this.t = 0;
  }

  start(ac) {
    this.group.visible = true;
    this.walkers.forEach((w, i) => { w.t = -i * 1.25; });
    ac.pos.copy(this.standPos);
    ac.quat.copy(this.quat);
    ac.vel.set(0, 0, 0); ac.omega.set(0, 0, 0);
    ac.onGround = true; ac.throttle = 0; ac.brakes = true;
    ac.gearDown = true; ac.gearPos = 1; ac.flaps = 2; ac.flapPos = 2;
  }

  stop() { this.group.visible = false; }

  update(dt, night = false) {
    if (!this.group.visible) return;
    this.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
    const local = new THREE.Matrix4(), part = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const P = this.parts;
    this.walkers.forEach((w, i) => {
      w.t += dt;
      let d = w.t * w.speed;
      if (d > this.totalLen) { w.t = -Math.random() * 1.2; d = 0; }
      if (d <= 0) { for (const k in P) P[k].setMatrixAt(i, zero); return; }
      let s = 0; while (s < this.segLen.length - 1 && d > this.segLen[s]) { d -= this.segLen[s]; s++; }
      const a = this.path[s], b = this.path[s + 1];
      p.copy(a).lerp(b, Math.min(1, d / this.segLen[s]));
      const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      q.setFromAxisAngle(up, yaw);
      const phase = w.t * w.speed * 5.2;
      p.y += Math.abs(Math.sin(phase)) * 0.04;
      m.compose(p, q, new THREE.Vector3(w.size, w.size, w.size));
      const swing = Math.sin(phase) * 0.5;
      const set = (mesh, x, y, z, rx = 0) => { local.makeRotationX(rx).setPosition(x, y, z); part.multiplyMatrices(m, local); mesh.setMatrixAt(i, part); };
      set(P.legL, -0.11, 0.84, 0, swing); set(P.legR, 0.11, 0.84, 0, -swing);
      set(P.torso, 0, 0.84, 0); set(P.head, 0, 1.62, 0); set(P.hair, 0, 1.64, 0.01);
      set(P.armL, -0.29, 1.42, 0, -swing * 0.8); set(P.armR, 0.29, 1.42, 0, 0.35);          // 右手拉行李
      set(P.bag, 0.42, 0, 0.55); set(P.handle, 0.38, 0.5, 0.42, 0.5);
    });
    for (const k in P) P[k].instanceMatrix.needsUpdate = true;
    // 輸送帶上的行李往上送
    for (let i = 0; i < 7; i++) {
      const f = ((this.t * 0.18 + i / 7) % 1);
      p.copy(this.beltA).lerp(this.beltB, f).y += 0.25;
      m.compose(p, q.setFromAxisAngle(up, -this.yaw), new THREE.Vector3(1, 1, 1));
      this.beltBags.setMatrixAt(i, m);
    }
    this.beltBags.instanceMatrix.needsUpdate = true;
    // 引導員揮棒
    for (const arms of this.marshal) for (const { arm, side } of arms) arm.rotation.z = side * (2.4 + Math.sin(this.t * 3.2) * 0.45);
    for (const l of this.lamps) l.visible = night;
  }

  get total() { return TOTAL; }
}
