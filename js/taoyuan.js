// 桃園機場特色：水門禮、地勤揮手道別、機場招牌、塔台、首航布條、觀音海岸風機、機場捷運
import * as THREE from 'three';
import { runways, RUNWAY_Y } from './world.js?v=20261105181329';
import { toWorld } from './geo.js?v=20261105181329';

const G = 9.81;

function textTexture(lines, w, h, bg, fg, font) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach(([text, size, color], i) => {
    g.font = `bold ${size}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
    g.fillStyle = color || fg;
    g.fillText(text, w / 2, h * (i + 0.5) / lines.length);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Taoyuan {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    const rw = runways.find((r) => r.airport === 'TPE' && r.id.startsWith('05R'));
    const tpe = runways.filter((r) => r.airport === 'TPE');
    const dir = new THREE.Vector3(rw.dirX, 0, rw.dirZ);
    const right = new THREE.Vector3(-rw.dirZ, 0, rw.dirX);   // 航廈那一側
    const yaw = -rw.heading * Math.PI / 180;
    const at = (s, lat, y = 0) => new THREE.Vector3(rw.cx, y, rw.cz).addScaledVector(dir, s).addScaledVector(right, lat);
    const s0 = -rw.halfLen * 0.45;                             // 玩家起點（與 aircraft.placeOnRunway 一致）

    // ── 航廈招牌、塔台 ──
    const signTex = textTexture([['臺灣桃園國際機場', 92, '#ffffff'], ['TAOYUAN INTERNATIONAL AIRPORT', 54, '#9fd3ff']], 1024, 256, '#16324f', '#fff');
    for (const r of tpe) {
      const rr = new THREE.Vector3(-r.dirZ, 0, r.dirX);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(260, 65), new THREE.MeshBasicMaterial({ map: signTex }));
      sign.position.set(r.cx, 0, r.cz).addScaledVector(rr, 538); sign.position.y = 34;
      sign.lookAt(sign.position.clone().sub(rr));
      scene.add(sign);
      // 航廈弧形屋頂：半圓柱沿跑道方向，壓扁成拱形
      const roofGeo = new THREE.CylinderGeometry(60, 60, r.halfLen * 2 * 0.48, 24, 1, false, 0, Math.PI);
      roofGeo.scale(0.22, 1, 1);
      roofGeo.rotateZ(Math.PI / 2);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xdfe6ee }));
      roof.rotation.y = Math.PI / 2 - r.heading * Math.PI / 180;
      roof.position.set(r.cx, 22, r.cz).addScaledVector(rr, 600);
      scene.add(roof);
    }
    const towerPos = at(rw.halfLen * 0.25, 520);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(13, 9, 9, 12), new THREE.MeshLambertMaterial({ color: 0x1d3c5c }));
    cab.position.copy(towerPos).setY(74); scene.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, 3, 12), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
    cabRoof.position.copy(towerPos).setY(80); scene.add(cabRoof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 6), new THREE.MeshLambertMaterial({ color: 0xff3b30 }));
    mast.position.copy(towerPos).setY(88); scene.add(mast);

    // ── 首航布條 ──
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(60, 12),
      new THREE.MeshBasicMaterial({ map: textTexture([['資安航空 SecTools Airlines 首航', 64, '#ffffff'], ['TPE ✈ NRT', 56, '#ffd60a']], 1024, 205, '#0a84ff', '#fff'), side: THREE.DoubleSide }));
    banner.position.copy(at(s0 + 170, rw.halfWid + 70, 14));
    banner.rotation.y = yaw - Math.PI / 2;   // 正面朝向跑道
    scene.add(banner);
    for (const d of [-28, 28]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 20, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      post.position.copy(banner.position).addScaledVector(dir, d).setY(10);
      scene.add(post);
    }

    // ── 水門禮：兩台消防車噴出水拱 ──
    this.salute = [];
    const truckMat = new THREE.MeshLambertMaterial({ color: 0xd7261e });
    const sS = s0 + 320;
    for (const side of [-1, 1]) {
      const lat = side * (rw.halfWid + 36);
      const truck = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 12), truckMat); body.position.y = 2.3; truck.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 })); cabin.position.set(0, 2.2, -6.5); truck.add(cabin);
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.5, 6), new THREE.MeshLambertMaterial({ color: 0x666666 }));
      turret.position.set(0, 5, -3); turret.rotation.x = Math.PI / 2; truck.add(turret);
      truck.position.copy(at(sS, lat, RUNWAY_Y));
      truck.rotation.y = yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      scene.add(truck);
      const nozzle = at(sS, lat * 0.93, RUNWAY_Y + 5.5);
      // 拋物線：在跑道中線上方約 34m 交會
      const h = 30, tUp = Math.sqrt(2 * h / G);
      const v = right.clone().multiplyScalar(-side * Math.abs(lat) / tUp).setY(G * tUp);
      this.salute.push({ nozzle, v });
    }
    const NP = 700;
    this.waterGeo = new THREE.BufferGeometry();
    this.waterGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 2 * 3), 3));
    this.water = new THREE.Points(this.waterGeo, new THREE.PointsMaterial({ color: 0xeaf7ff, size: 3.6, transparent: true, opacity: 0.8, depthWrite: false }));
    this.water.frustumCulled = false;
    scene.add(this.water);
    this.drops = [];
    for (let k = 0; k < 2; k++) for (let i = 0; i < NP; i++) this.drops.push({ k, age: Math.random() * 6, p: new THREE.Vector3(), v: new THREE.Vector3() });

    // ── 地勤人員揮手道別 ──
    this.wavers = [];
    const skin = new THREE.MeshLambertMaterial({ color: 0xf1c27d });
    const vest = new THREE.MeshLambertMaterial({ color: 0xff8c1a });
    const pants = new THREE.MeshLambertMaterial({ color: 0x23324a });
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.85, 0.25), pants); legs.position.y = 0.43; p.add(legs);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), vest); body.position.y = 1.2; p.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), skin); head.position.y = 1.72; p.add(head);
      const arm = new THREE.Group(); arm.position.set(0.3, 1.5, 0);
      const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.12), vest); armMesh.position.y = 0.3; arm.add(armMesh);
      p.add(arm);
      p.scale.setScalar(1.7);
      p.position.copy(at(s0 + 40 + i * 4, rw.halfWid + 22, RUNWAY_Y - 1));
      p.rotation.y = yaw - Math.PI / 2;   // 面向跑道
      scene.add(p);
      this.wavers.push({ arm, phase: i * 0.7 });
    }

    // ── 觀音海岸風力發電機 ──
    this.rotors = [];
    const white = new THREE.MeshLambertMaterial({ color: 0xf5f7fa });
    const a = toWorld(121.02, 25.085), b = toWorld(121.19, 25.145);
    for (let i = 0; i < 12; i++) {
      const f = i / 11;
      const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 90, 8), white);
      tower.position.set(x, 45, z); scene.add(tower);
      const rotor = new THREE.Group(); rotor.position.set(x, 91, z);
      const hub = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), white); rotor.add(hub);
      for (let k = 0; k < 3; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(2.2, 42, 0.6), white);
        blade.position.y = 21; const arm = new THREE.Group(); arm.rotation.z = k * Math.PI * 2 / 3; arm.add(blade); rotor.add(arm);
      }
      rotor.rotation.y = -0.6;   // 面向東北季風
      scene.add(rotor);
      this.rotors.push({ rotor, speed: 0.9 + Math.random() * 0.4, ang: Math.random() * 6 });
    }

    // ── 機場捷運（高架＋紫色列車）──
    const m0 = new THREE.Vector3(rw.cx, 0, rw.cz).addScaledVector(right, 800).addScaledVector(dir, 300);
    const tp = toWorld(121.36, 25.05);
    const m1 = new THREE.Vector3(tp.x, 0, tp.z);
    const len = m0.distanceTo(m1);
    const mdir = m1.clone().sub(m0).normalize();
    const mYaw = Math.atan2(-mdir.x, -mdir.z);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 1.5, len), new THREE.MeshLambertMaterial({ color: 0xb9bec7 }));
    deck.position.copy(m0).add(m1).multiplyScalar(0.5).setY(14);
    deck.rotation.y = mYaw;
    scene.add(deck);
    const pillarGeo = new THREE.BoxGeometry(2, 14, 2), pillarMat = new THREE.MeshLambertMaterial({ color: 0xa8adb6 });
    const nP = Math.floor(len / 40);
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, nP);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < nP; i++) pillars.setMatrixAt(i, mm.makeTranslation(m0.x + mdir.x * i * 40, 7, m0.z + mdir.z * i * 40));
    scene.add(pillars);
    this.train = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 90), new THREE.MeshLambertMaterial({ color: 0x8e44ad }));
    this.train.rotation.y = mYaw;
    scene.add(this.train);
    Object.assign(this, { m0, mdir, mlen: len, tpos: 0, tdir: 1 });
  }

  update(dt, showSalute) {
    this.t += dt;
    // 水門禮
    this.water.visible = showSalute;
    if (showSalute) {
      const pos = this.waterGeo.attributes.position.array;
      this.drops.forEach((d, i) => {
        d.age += dt;
        const s = this.salute[d.k];
        if (d.age > 6 || d.p.y < RUNWAY_Y) {
          d.age = 0;
          d.p.copy(s.nozzle);
          d.v.copy(s.v).multiplyScalar(0.93 + Math.random() * 0.12);
          d.v.x += (Math.random() - 0.5) * 1.5; d.v.z += (Math.random() - 0.5) * 1.5;
          // 第一次發射時隨機提前一段時間，讓水柱一開始就是完整的拱形而不是一團
          if (!d.started) {
            d.started = true;
            const t0 = Math.random() * 4.8;
            d.p.addScaledVector(d.v, t0); d.p.y -= 0.5 * G * t0 * t0; d.v.y -= G * t0;
          }
        }
        d.v.y -= G * dt;
        d.p.addScaledVector(d.v, dt);
        pos.set([d.p.x, d.p.y, d.p.z], i * 3);
      });
      this.waterGeo.attributes.position.needsUpdate = true;
    }
    // 地勤揮手
    for (const w of this.wavers) w.arm.rotation.z = Math.PI * 0.85 + Math.sin(this.t * 5 + w.phase) * 0.45;
    // 風機
    for (const r of this.rotors) { r.ang += r.speed * dt; r.rotor.rotation.z = r.ang; }
    // 捷運來回行駛
    this.tpos += this.tdir * 25 * dt;
    if (this.tpos > this.mlen - 50) this.tdir = -1;
    if (this.tpos < 50) this.tdir = 1;
    this.train.position.copy(this.m0).addScaledVector(this.mdir, this.tpos).setY(17);
  }
}
