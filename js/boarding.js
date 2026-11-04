// 乘客登機：桃園機場遠端停機位，乘客從接駁巴士走上登機梯進入飛機
import * as THREE from 'three';
import { runways, RUNWAY_Y } from './world.js?v=20261104214437';
import { GEAR_H } from './aircraft.js?v=20261104214437';

const TOTAL = 180;            // 總乘客數
const WALKERS = 36;           // 同時在走的人數
const DOOR_LOCAL = new THREE.Vector3(-2.2, 0.4, -12.5);   // 左前門（機身座標）

export class Boarding {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const rw = runways.find((r) => r.airport === 'TPE' && r.id.startsWith('05R'));
    this.rw = rw;
    const dir = new THREE.Vector3(rw.dirX, 0, rw.dirZ), right = new THREE.Vector3(-rw.dirZ, 0, rw.dirX);
    // 遠端停機位：停機坪前排，機頭朝跑道方向
    this.standPos = new THREE.Vector3(rw.cx, 0, rw.cz).addScaledVector(dir, -rw.halfLen * 0.3).addScaledVector(right, 330);
    this.standPos.y = RUNWAY_Y + GEAR_H - 0.4;
    this.yaw = -rw.heading * Math.PI / 180;
    this.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const door = DOOR_LOCAL.clone().applyQuaternion(this.quat).add(this.standPos);
    this.door = door;
    const out = right.clone().negate();              // 門在左側＝朝跑道方向
    // 登機梯車
    const stairBase = door.clone().addScaledVector(out, 9);
    stairBase.y = 1.6;
    const stairMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const truck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 7), new THREE.MeshLambertMaterial({ color: 0xffd23f }));
    truck.position.copy(stairBase).addScaledVector(out, 1.5).setY(2.4);
    truck.lookAt(truck.position.clone().add(out));
    this.group.add(truck);
    const len = stairBase.distanceTo(door);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, len), stairMat);
    ramp.position.copy(stairBase).lerp(door, 0.5);
    ramp.lookAt(door);
    this.group.add(ramp);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, len), stairMat);
      rail.position.copy(ramp.position).addScaledVector(dir, side * 0.9).add(new THREE.Vector3(0, 0.6, 0));
      rail.quaternion.copy(ramp.quaternion);
      this.group.add(rail);
    }
    // 接駁巴士
    const busPos = stairBase.clone().addScaledVector(out, 28).addScaledVector(dir, -10);
    const bus = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 13), new THREE.MeshLambertMaterial({ color: 0x2f6fd6 }));
    bus.position.copy(busPos).setY(3.2);
    bus.lookAt(bus.position.clone().add(dir));
    this.group.add(bus);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1.1, 11), new THREE.MeshLambertMaterial({ color: 0x1a2a3a }));
    win.position.copy(bus.position).setY(3.9); win.quaternion.copy(bus.quaternion);
    this.group.add(win);
    // 乘客路徑：巴士門 → 梯腳 → 機門
    const busDoor = busPos.clone().addScaledVector(out.clone().negate(), 1.8).setY(1.6);
    this.path = [busDoor, stairBase.clone().setY(1.6), door.clone().setY(door.y - 1.6)];
    this.segLen = [this.path[0].distanceTo(this.path[1]), this.path[1].distanceTo(this.path[2])];
    // 乘客（身體＋頭＋行李，用 Instanced 降低負擔）
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.32, 1.2, 8); bodyGeo.translate(0, 0.6, 0);
    const headGeo = new THREE.SphereGeometry(0.17, 8, 6); headGeo.translate(0, 1.38, 0);
    const bagGeo = new THREE.BoxGeometry(0.35, 0.55, 0.22); bagGeo.translate(0.45, 0.28, 0);
    this.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), WALKERS);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xe8b98a }), WALKERS);
    this.bags = new THREE.InstancedMesh(bagGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), WALKERS);
    const shirts = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0x34495e, 0xff8fb8, 0xe67e22];
    const bagsC = [0x222222, 0x8b5a2b, 0xc0392b, 0x2c3e50, 0x7f8c8d, 0xd4a017];
    const c = new THREE.Color();
    for (let i = 0; i < WALKERS; i++) {
      this.bodies.setColorAt(i, c.setHex(shirts[i % shirts.length]));
      this.bags.setColorAt(i, c.setHex(bagsC[(i * 7) % bagsC.length]));
    }
    this.group.add(this.bodies, this.heads, this.bags);
    this.walkers = Array.from({ length: WALKERS }, (_, i) => ({ t: -i * 1.1, speed: 1.25 + ((i * 37) % 10) / 25 }));
    this.boarded = 0;
  }

  start(ac) {
    this.group.visible = true;
    this.boarded = 0;
    this.walkers.forEach((w, i) => { w.t = -i * 1.1; });
    ac.pos.copy(this.standPos);
    ac.quat.copy(this.quat);
    ac.vel.set(0, 0, 0); ac.omega.set(0, 0, 0);
    ac.onGround = true; ac.throttle = 0; ac.brakes = true;
  }

  stop() { this.group.visible = false; }

  // 回傳已登機人數（模擬到 180 人）
  update(dt, rate) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const total = this.segLen[0] + this.segLen[1];
    this.walkers.forEach((w, i) => {
      w.t += dt;
      let d = w.t * w.speed;
      if (d > total) { w.t = -Math.random() * 1.5; d = 0; this.boarded += 1; }
      const show = d > 0;
      let a, b, f;
      if (d < this.segLen[0]) { a = this.path[0]; b = this.path[1]; f = d / this.segLen[0]; }
      else { a = this.path[1]; b = this.path[2]; f = (d - this.segLen[0]) / this.segLen[1]; }
      p.copy(a).lerp(b, Math.max(0, f));
      p.y += Math.abs(Math.sin(w.t * 9)) * 0.05;                 // 走路上下晃
      const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      q.setFromAxisAngle(up, yaw);
      m.compose(p, q, show ? one : new THREE.Vector3(0, 0, 0));
      this.bodies.setMatrixAt(i, m); this.heads.setMatrixAt(i, m); this.bags.setMatrixAt(i, m);
    });
    this.bodies.instanceMatrix.needsUpdate = true; this.heads.instanceMatrix.needsUpdate = true; this.bags.instanceMatrix.needsUpdate = true;
    // 畫面上看得到的人有限，計數依時間比例加速，讓 180 人在數十秒內登機完成
    this.count = Math.min(TOTAL, Math.round(this.boarded * rate));
    return this.count;
  }

  get done() { return this.count >= TOTAL; }
  get total() { return TOTAL; }
}
