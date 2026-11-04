// 機場生活感：停機坪上的飛機、空橋、地勤車輛，以及另一條跑道上起降的飛機
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildAircraftModel, GEAR_H } from './aircraft.js?v=20261104184102';
import { runways, RUNWAY_Y } from './world.js?v=20261104184102';

const D2R = Math.PI / 180;
const APRON_Y = 1.6;
const LIVERIES = [0xc8102e, 0x00843d, 0x6b2c91, 0xf0a020, 0x0a7bbd, 0x1b4f9c, 0x333333, 0xe4007f];
const VEHICLES = [
  { size: [2.4, 1.8, 4.5], color: 0xffd23f, speed: 7 },   // 拖車
  { size: [2.6, 3.2, 10], color: 0xf2f2f2, speed: 6 },    // 油罐車
  { size: [2.8, 3.2, 12], color: 0x2f6fd6, speed: 8 },    // 接駁巴士
  { size: [1.8, 1.4, 3.2], color: 0xff7b29, speed: 5 },   // 行李車
  { size: [2.2, 2.4, 5], color: 0xffffff, speed: 6 },     // 餐車
];

// 把飛機模型依材質合併成少數幾個幾何（給大量停機坪飛機用 InstancedMesh）
function bakedParts() {
  const g = buildAircraftModel(0xffffff);
  g.updateMatrixWorld(true);
  const byMat = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    const key = o.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, geos: [] });
    byMat.get(key).geos.push(geo);
  });
  return [...byMat.values()].map(({ mat, geos }) => ({ mat, geo: mergeGeometries(geos) }));
}

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    const spots = [];
    const bridges = [];
    this.vehicles = [];
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);

    for (const r of runways) {
      const px = -r.dirZ, pz = r.dirX;               // 跑道右側（航廈方向）
      const hr = r.heading * D2R;
      // 停機位：機頭朝向航廈
      const n = Math.floor(r.halfLen * 0.9 / 85);
      for (let k = 0; k < n; k++) {
        const s = -r.halfLen * 0.45 + k * 85;
        const x = r.cx + r.dirX * s + px * 482, z = r.cz + r.dirZ * s + pz * 482;
        spots.push({ x, z, yaw: -(hr + Math.PI / 2), livery: LIVERIES[(k + spots.length) % LIVERIES.length] });
        bridges.push({ x: r.cx + r.dirX * (s - 7) + px * 522, z: r.cz + r.dirZ * (s - 7) + pz * 522, yaw: -(hr + Math.PI / 2) });
      }
      // 地勤車：沿停機坪內繞行的矩形路線
      const L = r.halfLen * 0.42;
      const corner = (a, b) => new THREE.Vector3(r.cx + r.dirX * a + px * b, APRON_Y, r.cz + r.dirZ * a + pz * b);
      const path = [corner(-L, 260), corner(L, 260), corner(L, 420), corner(-L, 420)];
      const per = path.reduce((acc, p, i) => acc + p.distanceTo(path[(i + 1) % 4]), 0);
      for (let k = 0; k < 10; k++) {
        this.vehicles.push({ type: k % VEHICLES.length, path, per, t: Math.random() * per, dir: k % 3 ? 1 : -1 });
      }
    }

    // 停機坪飛機（Instanced）
    for (const { mat, geo } of bakedParts()) {
      const im = new THREE.InstancedMesh(geo, mat.userData.livery ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : mat, spots.length);
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.yaw);
        im.setMatrixAt(i, m.compose(new THREE.Vector3(sp.x, APRON_Y + GEAR_H, sp.z), q, one));
        if (mat.userData.livery) im.setColorAt(i, new THREE.Color(sp.livery));
      });
      scene.add(im);
    }
    // 空橋
    const bGeo = new THREE.BoxGeometry(4, 4, 34);
    const bridgeMesh = new THREE.InstancedMesh(bGeo, new THREE.MeshLambertMaterial({ color: 0xb8bcc4 }), bridges.length);
    bridges.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      bridgeMesh.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, 6, b.z), q, one));
    });
    scene.add(bridgeMesh);

    // 地勤車（每種一個 InstancedMesh，每幀更新位置）
    this.vMeshes = VEHICLES.map((v) => {
      const geo = new THREE.BoxGeometry(...v.size); geo.translate(0, v.size[1] / 2, 0);
      const count = this.vehicles.filter((x) => VEHICLES[x.type] === v).length;
      const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: v.color }), count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      return im;
    });

    // 另一條跑道上起降的飛機（每座機場一架）
    this.ai = [];
    for (const code of ['TPE', 'NRT']) {
      const r = runways.find((x) => x.airport === code && !x.ils && !x.id.startsWith('05R'));
      if (!r) continue;
      const mesh = buildAircraftModel(LIVERIES[this.ai.length * 3]);
      scene.add(mesh);
      this.ai.push({ r, mesh, phase: 'dep', t: 0, s: -r.halfLen + 100, v: 0, h: 0, pitch: 0, delay: code === 'TPE' ? 6 : 0 });
    }
  }

  update(dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    // 地勤車
    const idx = VEHICLES.map(() => 0);
    for (const v of this.vehicles) {
      const spec = VEHICLES[v.type];
      v.t = (v.t + spec.speed * dt * v.dir + v.per) % v.per;
      let d = v.t, i = 0;
      for (; i < 4; i++) {
        const segLen = v.path[i].distanceTo(v.path[(i + 1) % 4]);
        if (d <= segLen) break;
        d -= segLen;
      }
      i = Math.min(i, 3);
      const a = v.path[i], b = v.path[(i + 1) % 4];
      const dirv = b.clone().sub(a).normalize();
      const pos = a.clone().addScaledVector(dirv, d);
      const yaw = Math.atan2(-dirv.x * v.dir, -dirv.z * v.dir);
      q.setFromAxisAngle(up, yaw);
      this.vMeshes[v.type].setMatrixAt(idx[v.type]++, m.compose(pos, q, one));
    }
    for (const im of this.vMeshes) im.instanceMatrix.needsUpdate = true;

    // 起降的飛機
    for (const a of this.ai) {
      if (a.delay > 0) { a.delay -= dt; this.place(a); continue; }
      a.t += dt;
      const r = a.r;
      if (a.phase === 'dep') {
        if (a.h <= 0) a.v = Math.min(a.v + 2.3 * dt, 85);
        if (a.v > 72) { a.pitch = Math.min(a.pitch + dt * 0.05, 8 * D2R); a.h += a.v * Math.sin(Math.max(0, a.pitch - 2 * D2R)) * dt; }
        a.s += a.v * dt;
        if (a.t > 75) Object.assign(a, { phase: 'arr', t: 0, s: -r.halfLen - 9000, v: 72, h: 9000 * Math.tan(3 * D2R) + 15, pitch: 2.5 * D2R });
      } else {
        a.s += a.v * dt;
        const toThr = -r.halfLen + 350 - a.s;
        if (toThr > 0) a.h = Math.max(0, toThr * Math.tan(3 * D2R));
        else { a.h = 0; a.pitch = Math.max(0, a.pitch - dt * 0.05); a.v = Math.max(8, a.v - 2.6 * dt); }
        if (a.t > 220) Object.assign(a, { phase: 'dep', t: 0, s: -r.halfLen + 100, v: 0, h: 0, pitch: 0, delay: 20 });
      }
      this.place(a);
    }
  }

  place(a) {
    const r = a.r;
    a.mesh.position.set(r.cx + r.dirX * a.s, RUNWAY_Y + GEAR_H + a.h, r.cz + r.dirZ * a.s);
    a.mesh.quaternion.setFromEuler(new THREE.Euler(a.pitch, -r.heading * D2R, 0, 'YXZ'));
    const gear = a.mesh.userData.gear;
    gear.visible = a.phase === 'arr' || a.h < 300;
  }
}
