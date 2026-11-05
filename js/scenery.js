// 額外場景：海上船隻與航跡、落地輪胎煙、夜間進場「兔子燈」
import * as THREE from 'three';
import { ROUTES, toWorld } from './geo.js?v=20261105184350';
import { runways, RUNWAY_Y } from './world.js?v=20261105184350';

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function wakeTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(26, 0); g.lineTo(38, 0); g.lineTo(64, 256); g.lineTo(0, 256); g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
}

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.soft = softTex();

    // ── 落地輪胎煙 ──
    this.puffs = Array.from({ length: 16 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, color: 0xd9d9d9, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s);
      return { s, age: 99, v: new THREE.Vector3() };
    });

    // ── 夜間進場兔子燈：沿進場燈由遠到近連續閃光 ──
    this.rabbits = runways.filter((r) => r.ils || r.id.startsWith('05')).map((r) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(22); s.visible = false; scene.add(s);
      // 進場端：ILS 跑道是著陸方向的反方向端；桃園 05 跑道從西南端進場
      return { s, r, phase: Math.random() };
    });
    this.night = false;
  }

  // 船隻要等地形載入後才知道哪裡是海
  spawnShips(heightAt) {
    const hull = new THREE.BoxGeometry(1, 1, 1); hull.translate(0, 0.5, 0);
    const colors = [0x8a2b2b, 0x2b4a8a, 0x2f2f2f, 0xd9d9d9, 0x1f6f5a];
    const pts = [];
    let tries = 0;
    const routes = Object.values(ROUTES);
    while (pts.length < 46 && tries++ < 800) {
      const R = routes[tries % routes.length];
      const i = Math.floor(Math.random() * (R.length - 1));
      const a = R[i], b = R[i + 1], f = Math.random();
      const lon = a.lon + (b.lon - a.lon) * f + (Math.random() - 0.5) * 1.6;
      const lat = a.lat + (b.lat - a.lat) * f + (Math.random() - 0.5) * 1.2;
      const w = toWorld(lon, lat);
      // 離岸 3 km 以上才放船
      let sea = true;
      for (const [dx, dz] of [[0, 0], [3000, 0], [-3000, 0], [0, 3000], [0, -3000]]) if (heightAt(w.x + dx, w.z + dz) > 0) { sea = false; break; }
      if (sea) pts.push({ x: w.x, z: w.z, yaw: Math.random() * Math.PI * 2, len: 140 + Math.random() * 230, speed: 6 + Math.random() * 6 });
    }
    this.ships = pts;
    const hulls = new THREE.InstancedMesh(hull, new THREE.MeshLambertMaterial({ color: 0xffffff }), pts.length);
    const deck = new THREE.InstancedMesh(hull, new THREE.MeshLambertMaterial({ color: 0xffffff }), pts.length);
    const wakes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ map: wakeTex(), transparent: true, depthWrite: false, opacity: 0.8 }), pts.length);
    const c = new THREE.Color();
    pts.forEach((p, i) => {
      hulls.setColorAt(i, c.setHex(colors[i % colors.length]));
      deck.setColorAt(i, c.setHex([0xd35400, 0x2980b9, 0xc0392b, 0x27ae60, 0xf1c40f][(i * 3) % 5]));
    });
    this.hulls = hulls; this.deck = deck; this.wakes = wakes;
    this.scene.add(hulls, deck, wakes);
    this.updateShips(0);
  }

  updateShips(dt) {
    if (!this.ships) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    this.ships.forEach((p, i) => {
      p.x += Math.sin(p.yaw) * p.speed * dt; p.z -= Math.cos(p.yaw) * p.speed * dt;
      q.setFromAxisAngle(up, -p.yaw);
      const L = p.len, Wd = L * 0.15;
      this.hulls.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(Wd, 14, L)));
      this.deck.setMatrixAt(i, m.compose(new THREE.Vector3(p.x - Math.sin(p.yaw) * L * 0.05, 14, p.z + Math.cos(p.yaw) * L * 0.05), q, new THREE.Vector3(Wd * 0.85, 12, L * 0.7)));
      this.wakes.setMatrixAt(i, m.compose(new THREE.Vector3(p.x - Math.sin(p.yaw) * L * 0.5, 0.6, p.z + Math.cos(p.yaw) * L * 0.5), q, new THREE.Vector3(Wd * 5, 1, L * 6)));
    });
    this.hulls.instanceMatrix.needsUpdate = this.deck.instanceMatrix.needsUpdate = this.wakes.instanceMatrix.needsUpdate = true;
  }

  // 主輪接地：噴出輪胎煙
  touchdown(ac) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat);
    for (const side of [-3, 3]) {
      const base = new THREE.Vector3(side, -3.2, 0.5).applyQuaternion(ac.quat).add(ac.pos);
      for (let k = 0; k < 8; k++) {
        const p = this.puffs.find((x) => x.age > 2.2);
        if (!p) return;
        p.age = -k * 0.03;
        p.s.position.copy(base);
        p.v.copy(fwd).multiplyScalar(-6 - Math.random() * 8).add(new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3));
      }
    }
  }

  update(dt, env) {
    this.t += dt;
    this.updateShips(dt);
    for (const p of this.puffs) {
      p.age += dt;
      const a = p.age;
      p.s.visible = a > 0 && a < 2.2;
      if (!p.s.visible) continue;
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 1.5);
      p.s.scale.setScalar(3 + a * 9);
      p.s.material.opacity = Math.max(0, 0.6 * (1 - a / 2.2));
    }
    // 兔子燈：只在日出與夜晚顯示
    const show = env.mode !== 'day';
    for (const rb of this.rabbits) {
      rb.s.visible = show;
      if (!show) continue;
      const r = rb.r;
      const f = ((this.t * 2 + rb.phase) % 1);                // 每 0.5 秒從 900m 外跑到跑道頭
      const d = r.halfLen + 900 * (1 - f);
      rb.s.position.set(r.cx - r.dirX * d, RUNWAY_Y + 3, r.cz - r.dirZ * d);
      rb.s.material.opacity = 0.9;
    }
  }
}
