// 真實地形：USGS/NOAA 高程（公有領域）＋ NASA Blue Marble 地表顏色，近距離疊加程序細節
// 圖磚由 scripts/build_tiles.py 產生，放在 tiles/
import * as THREE from 'three';
import { toWorld, toLonLat, AIRPORTS } from './geo.js?v=20261106162641';

const BASE = 'tiles/';
const SEG = 32;                 // 每個圖磚網格分段數
const REFINE_DIST = 90000;      // 鏡頭距離小於此值時改用高解析度（z11）
const DROP_DIST = 160000;
const EXAG = 1.1;               // 高度略微誇大，讓山脈從高空更有立體感

const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180) / Math.PI;
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };

// 機場周邊壓平，讓手工跑道與停機坪正常顯示
// 內陸機場：圓形壓平；海上／臨海機場（flat: 'box'）：只在跑道周圍做出長方形陸地
const FLAT = Object.values(AIRPORTS).map((a) => {
  const r = a.runways[0], c = toWorld(r.lon, r.lat), hr = r.heading * Math.PI / 180;
  return { box: a.flat === 'box', x: c.x, z: c.z, dx: Math.sin(hr), dz: -Math.cos(hr), half: r.length / 2 + 900, wid: 1100 };
});
function flatten(wx, wz) {
  let f = 1;
  for (const p of FLAT) {
    let t;
    if (p.box) {
      const ox = wx - p.x, oz = wz - p.z;
      const e = Math.max(Math.abs(ox * p.dx + oz * p.dz) - p.half, Math.abs(-ox * p.dz + oz * p.dx) - p.wid);
      t = Math.min(1, Math.max(0, e / 500));
    } else {
      t = Math.min(1, Math.max(0, (Math.hypot(wx - p.x, wz - p.z) - 4000) / 4000));
    }
    f = Math.min(f, t * t * (3 - 2 * t));
  }
  return f;
}

function detailTexture() {
  const size = 256, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  const rnd = (x, y, o) => { const n = Math.sin(x * 127.1 + y * 311.7 + o * 74.7) * 43758.5453; return n - Math.floor(n); };
  const noise = (x, y, o, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const w = (a) => ((a % per) + per) % per;
    const a = rnd(w(xi), w(yi), o), b = rnd(w(xi + 1), w(yi), o), cc = rnd(w(xi), w(yi + 1), o), d = rnd(w(xi + 1), w(yi + 1), o);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let n = 0, amp = 0.5, f = 4;
    for (let o = 0; o < 5; o++) { n += amp * noise(x / size * f, y / size * f, o, f); amp *= 0.5; f *= 2; }
    // 田塊：加一點方格感
    const field = (Math.floor(x / 16) + Math.floor(y / 12)) % 2 ? 0.04 : -0.04;
    const v = Math.min(255, Math.max(0, (0.55 + (n - 0.5) * 0.7 + field) * 255));
    const k = (y * size + x) * 4;
    img.data[k] = v * 0.97; img.data[k + 1] = v; img.data[k + 2] = v * 0.92; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.ready = false;
    this.nodes9 = new Map();      // key -> { mesh, children, state }
    this.dem11 = new Map();       // key -> Int16Array (65x65)
    this.tex8 = new Map();
    this.loader = new THREE.TextureLoader();
    this.detail = detailTexture();
    this.material = new Map();    // 每張 z8 影像一個材質
    this.lastUpdate = 0;
    this.loading = 0;
  }

  async load() {
    const [idx, demBuf] = await Promise.all([
      fetch(BASE + 'index.json').then((r) => r.json()),
      fetch(BASE + 'dem9.bin').then((r) => r.arrayBuffer()),
    ]);
    this.index = idx;
    const dem9 = new Int16Array(demBuf);
    this.dem9 = new Map();
    idx.dem9.forEach((k, i) => this.dem9.set(k, dem9.subarray(i * 33 * 33, (i + 1) * 33 * 33)));
    this.img8 = new Set(idx.img8);
    this.set11 = new Set(idx.levels['11']);
    this.refine9 = new Set(idx.refine['9']);
    for (const k of idx.levels['9']) {
      const [x, y] = k.split(',').map(Number);
      const mesh = this.buildMesh(9, x, y, this.dem9.get(k), 33);
      if (!mesh) continue;
      this.scene.add(mesh);
      const c = toWorld(x2lon(x + 0.5, 9), y2lat(y + 0.5, 9));
      this.nodes9.set(k, { x, y, mesh, cx: c.x, cz: c.z, children: null, state: 'coarse', farSince: 0 });
    }
    this.ready = true;
    return this;
  }

  matFor(z, x, y) {
    const sx = Math.floor(x / 2 ** (z - 8)), sy = Math.floor(y / 2 ** (z - 8));
    const key = `${sx},${sy}`;
    if (!this.img8.has(key)) return null;
    if (!this.material.has(key)) {
      const tex = this.loader.load(`${BASE}img/8/${sx}_${sy}.jpg`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, color: new THREE.Color(1.35, 1.35, 1.35) });
      const detail = this.detail;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.detailMap = { value: detail };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nattribute float aFill;\nvarying float vFill;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFill = aFill;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying float vFill;\nuniform sampler2D detailMap;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            // 填海造陸處（衛星影像是海）改成草地色
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.40, 0.22), vFill);
            float dk = clamp(1.0 - length(cameraPosition - vWP) / 18000.0, 0.0, 1.0) * 0.75;
            vec3 det = texture2D(detailMap, vWP.xz / 1400.0).rgb * texture2D(detailMap, vWP.xz / 260.0).rgb * 3.2;
            diffuseColor.rgb *= mix(vec3(1.0), det, dk);`);
      };
      this.material.set(key, m);
    }
    return this.material.get(key);
  }

  // dem：(n x n) 高度格點，對應整個圖磚
  buildMesh(z, x, y, dem, n) {
    const mat = this.matFor(z, x, y);
    if (!mat || !dem) return null;
    const span = 1 / 2 ** (z - 8);
    const ox = (x % 2 ** (z - 8)) * span, oy = (y % 2 ** (z - 8)) * span;
    const N = SEG, step = (n - 1) / N;
    const pos = new Float32Array((N + 1) ** 2 * 3), uv = new Float32Array((N + 1) ** 2 * 2), col = new Float32Array((N + 1) ** 2 * 4), fill = new Float32Array((N + 1) ** 2);
    let k = 0;
    for (let j = 0; j <= N; j++) {
      const lat = y2lat(y + j / N, z);
      for (let i = 0; i <= N; i++) {
        const lon = x2lon(x + i / N, z);
        const w = toWorld(lon, lat);
        let h = dem[Math.round(j * step) * n + Math.round(i * step)];
        const f = flatten(w.x, w.z);
        const land = h > 0.5 || f < 1;
        const y3 = land ? (0.6 + (Math.max(h, 0) * EXAG + 1.5 - 0.6) * f) : 0.3;
        pos.set([w.x, y3, w.z], k * 3);
        uv.set([ox + span * i / N, 1 - (oy + span * j / N)], k * 2);
        const snow = h > 3100 ? 1.45 : 1;
        col.set([snow, snow, snow, land ? 1 : 0], k * 4);
        fill[k] = h <= 0.5 && f < 1 ? 1 : 0;
        k++;
      }
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('aFill', new THREE.BufferAttribute(fill, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, mat);
  }

  // 依鏡頭距離切換 z9 / z11
  update(cam, now) {
    if (!this.ready || now - this.lastUpdate < 0.3) return;
    this.lastUpdate = now;
    for (const [key, n] of this.nodes9) {
      if (!this.refine9.has(key)) continue;
      const d = Math.hypot(cam.x - n.cx, cam.z - n.cz);
      if (d < REFINE_DIST) {
        n.farSince = 0;
        if (n.state === 'coarse') this.loadChildren(key, n);
        else if (n.state === 'fine' && n.mesh.visible) { n.mesh.visible = false; n.children.forEach((c) => { c.visible = true; }); }
      } else if (n.state === 'fine') {
        n.mesh.visible = true;
        n.children.forEach((c) => { c.visible = false; });
        if (!n.farSince) n.farSince = now;
        else if (d > DROP_DIST && now - n.farSince > 10) {
          n.children.forEach((c) => { this.scene.remove(c); c.geometry.dispose(); });
          n.children = null; n.state = 'coarse';
        }
      }
    }
  }

  async loadChildren(key, n) {
    if (this.loading > 6) return;
    n.state = 'loading'; this.loading++;
    try {
      const kids = [];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = n.x * 4 + i, cy = n.y * 4 + j, ck = `${cx},${cy}`;
        if (this.set11.has(ck)) kids.push([cx, cy, ck]);
      }
      const meshes = [];
      await Promise.all(kids.map(async ([cx, cy, ck]) => {
        let dem = this.dem11.get(ck);
        if (!dem) {
          dem = new Int16Array(await fetch(`${BASE}dem/11/${ck.replace(',', '_')}.bin`).then((r) => r.arrayBuffer()));
          this.dem11.set(ck, dem);
        }
        const m = this.buildMesh(11, cx, cy, dem, 65);
        if (m) { m.visible = false; this.scene.add(m); meshes.push(m); }
      }));
      n.children = meshes;
      n.state = 'fine';
    } catch (e) {
      n.state = 'coarse';
    } finally {
      this.loading--;
    }
  }

  // 地形高度（公尺，世界座標），供碰撞、安全保護使用
  heightAt(wx, wz) {
    if (!this.ready) return 0;
    const { lon, lat } = toLonLat(wx, wz);
    const f = flatten(wx, wz);
    for (const [z, n, get] of [[11, 65, (k) => this.dem11.get(k)], [9, 33, (k) => this.dem9.get(k)]]) {
      const fx = lon2x(lon, z), fy = lat2y(lat, z);
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const dem = get(`${tx},${ty}`);
      if (!dem) continue;
      const u = (fx - tx) * (n - 1), v = (fy - ty) * (n - 1);
      const i = Math.min(n - 2, Math.floor(u)), j = Math.min(n - 2, Math.floor(v)), a = u - i, b = v - j;
      const h = dem[j * n + i] * (1 - a) * (1 - b) + dem[j * n + i + 1] * a * (1 - b) + dem[(j + 1) * n + i] * (1 - a) * b + dem[(j + 1) * n + i + 1] * a * b;
      return Math.max(0, h) * EXAG * f;
    }
    return 0;
  }
}
