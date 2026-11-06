// 速度感特效：氣流線（劃過鏡頭的空氣）＋高空凝結尾
import * as THREE from 'three';

const N = 140;
const ENGINES = [new THREE.Vector3(-6, -2.1, 1.5), new THREE.Vector3(6, -2.1, 1.5)];
const TRAIL_PTS = 140;

export class SpeedFX {
  constructor(scene) {
    // 氣流線：固定在世界座標，飛機前進時從鏡頭旁呼嘯而過
    this.pts = Array.from({ length: N }, () => new THREE.Vector3(Infinity, 0, 0));
    // 每條氣流線是一個面向鏡頭的細長四邊形（比 1px 線條明顯）
    this.streakGeo = new THREE.BufferGeometry();
    this.streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 12), 3));
    const col = new Float32Array(N * 16);
    for (let i = 0; i < N; i++) col.set([1, 1, 1, 0.85, 1, 1, 1, 0.85, 1, 1, 1, 0, 1, 1, 1, 0], i * 16);   // 頭亮尾淡
    this.streakGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const sidx = [];
    for (let i = 0; i < N; i++) { const a = i * 4; sidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.streakGeo.setIndex(sidx);
    this.streakMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.streaks = new THREE.Mesh(this.streakGeo, this.streakMat);
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);

    // 凝結尾：兩條面向鏡頭的帶狀網格
    this.trails = ENGINES.map(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_PTS * 6), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_PTS * 8), 4));
      const idx = [];
      for (let i = 0; i < TRAIL_PTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, geo, hist: [], acc: 0 };
    });
  }

  // 雨絲：固定在空氣中往下落，飛機前進時迎面打來
  initRain(scene) {
    const N = 900;
    this.rainPts = Array.from({ length: N }, () => new THREE.Vector3((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 80));
    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
  }

  updateRain(ac, camera, dtReal, timeScale, on) {
    if (!this.rain) return;
    this.rain.visible = on && timeScale <= 4;
    if (!this.rain.visible) return;
    const rel = new THREE.Vector3(0, -9, 0).sub(ac.vel);              // 雨滴相對鏡頭的速度
    const pos = this.rainGeo.attributes.position.array, cam = camera.position;
    const len = Math.min(6, 0.6 + rel.length() * 0.025);
    const d = rel.clone().normalize();
    this.rainPts.forEach((p, i) => {
      p.addScaledVector(rel, dtReal * timeScale * 0.2);
      for (const ax of ['x', 'y', 'z']) { const half = ax === 'y' ? 25 : 40; if (p[ax] < -half) p[ax] += half * 2; else if (p[ax] > half) p[ax] -= half * 2; }
      const x = cam.x + p.x, y = cam.y + p.y, z = cam.z + p.z;
      pos.set([x, y, z, x - d.x * len, y - d.y * len, z - d.z * len], i * 6);
    });
    this.rainGeo.attributes.position.needsUpdate = true;
  }

  reset() { for (const t of this.trails) t.hist.length = 0; for (const p of this.pts) p.x = Infinity; }

  update(ac, camera, dtReal, simDt, timeScale) {
    const speed = ac.vel.length();
    const dir = speed > 1 ? ac.vel.clone().divideScalar(speed) : new THREE.Vector3(0, 0, -1);
    const cam = camera.position;

    // ── 氣流線 ──
    const show = speed > 35 && timeScale <= 4;
    const target = show ? Math.min(0.42, (speed - 35) / 200) * (this.dim ?? 1) : 0;
    this.streakMat.opacity += (target - this.streakMat.opacity) * Math.min(1, dtReal * 3);
    this.streaks.visible = this.streakMat.opacity > 0.01;
    if (this.streaks.visible) {
      const pos = this.streakGeo.attributes.position.array;
      const len = Math.min(32, Math.max(6, speed * 0.09 * timeScale));
      const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const s1 = new THREE.Vector3().crossVectors(dir, up).normalize(), s2 = new THREE.Vector3().crossVectors(dir, s1);
      const rel = new THREE.Vector3();
      this.pts.forEach((p, i) => {
        rel.copy(p).sub(cam);
        const along = rel.dot(dir);
        if (!isFinite(p.x) || along < -20 || rel.length() > 260) {
          // 在鏡頭前方隨機位置重生，避開飛機所在的中央區域
          const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 45;
          p.copy(cam).addScaledVector(dir, 15 + Math.random() * 140)
            .addScaledVector(s1, Math.cos(a) * r).addScaledVector(s2, Math.sin(a) * r);
          if (ac.onGround) p.y = Math.max(p.y, ac.pos.y - 2);
        }
        const side = new THREE.Vector3().crossVectors(dir, rel.copy(p).sub(cam)).normalize().multiplyScalar(0.09 + rel.length() * 0.0012);
        const tx = p.x - dir.x * len, ty = p.y - dir.y * len, tz = p.z - dir.z * len;
        pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z,
          tx + side.x, ty + side.y, tz + side.z, tx - side.x, ty - side.y, tz - side.z], i * 12);
      });
      this.streakGeo.attributes.position.needsUpdate = true;
    }

    // ── 凝結尾（約 26,000 ft 以上）──
    const high = ac.pos.y > 8000;
    const camDir = new THREE.Vector3();
    this.trails.forEach((t, k) => {
      t.acc += simDt;
      if (high && t.acc > 0.12) {
        t.acc = 0;
        t.hist.unshift(ENGINES[k].clone().applyQuaternion(ac.quat).add(ac.pos));
        if (t.hist.length > TRAIL_PTS) t.hist.pop();
      }
      if (!high && t.hist.length && t.acc > 0.12) { t.acc = 0; t.hist.pop(); }
      const n = t.hist.length;
      t.mesh.visible = n > 2;
      if (!t.mesh.visible) return;
      const pos = t.geo.attributes.position.array, col = t.geo.attributes.color.array;
      const head = ENGINES[k].clone().applyQuaternion(ac.quat).add(ac.pos);
      for (let i = 0; i < TRAIL_PTS; i++) {
        const p = i === 0 ? head : t.hist[Math.min(i, n - 1)];
        const q = t.hist[Math.min(i + 1, n - 1)] || p;
        const seg = q.clone().sub(p);
        if (seg.lengthSq() < 1e-6) seg.copy(dir).negate();
        camDir.copy(p).sub(cam).normalize();
        const side = seg.cross(camDir).normalize();
        const f = i / TRAIL_PTS;
        const w = 0.6 + f * 9;                                  // 越後面越寬（擴散）
        const alpha = i >= n ? 0 : Math.min(1, i / 4) * (1 - f) * 0.75;
        pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6);
        col.set([1, 1, 1, alpha, 1, 1, 1, alpha], i * 8);
      }
      t.geo.attributes.position.needsUpdate = true;
      t.geo.attributes.color.needsUpdate = true;
    });
  }
}
