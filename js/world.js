import * as THREE from 'three';
import { COASTLINES, MOUNTAINS, AIRPORTS, EXTRA_CITIES, toWorld } from './geo.js?v=20261107130638';

export const RUNWAY_Y = 2.0;      // 跑道表面高度
const LAND_Y = 1.0;

// 地表碰撞與跑道資訊
export const runways = [];        // { cx, cz, dirX, dirZ, halfLen, halfWid, heading, id, airport }
export const mountains = [];      // { x, z, h, r }

function noiseTexture(base, vary, size = 256, cells = 16, speckle = 0.15) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cs = size / cells;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const t = Math.random();
    const col = base.clone().lerp(vary, t);
    g.fillStyle = `#${col.getHexString()}`;
    g.fillRect(i * cs, j * cs, cs + 1, cs + 1);
  }
  const img = g.getImageData(0, 0, size, size);
  for (let k = 0; k < img.data.length; k += 4) {
    const n = (Math.random() - 0.5) * 255 * speckle;
    img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 平滑分形雜訊貼圖（多層次田野、林地、裸土），比方塊雜訊自然
function fbmTexture(size, stops, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = (x, y, o) => { const n = Math.sin(x * 127.1 + y * 311.7 + o * 74.7 + seed * 19.3) * 43758.5453; return n - Math.floor(n); };
  const noise = (x, y, o, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const w = (a) => ((a % per) + per) % per;
    const a = rnd(w(xi), w(yi), o), b = rnd(w(xi + 1), w(yi), o), cc = rnd(w(xi), w(yi + 1), o), d = rnd(w(xi + 1), w(yi + 1), o);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  const cols = stops.map(([t, hex]) => [t, new THREE.Color(hex)]);
  const tmp = new THREE.Color();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let n = 0, amp = 0.5, f = 4;
    for (let o = 0; o < 5; o++) { n += amp * noise(x / size * f, y / size * f, o, f); amp *= 0.5; f *= 2; }
    let i = 0; while (i < cols.length - 2 && n > cols[i + 1][0]) i++;
    const [t0, c0] = cols[i], [t1, c1] = cols[i + 1];
    tmp.copy(c0).lerp(c1, Math.min(1, Math.max(0, (n - t0) / (t1 - t0))));
    const k = (y * size + x) * 4;
    img.data[k] = tmp.r * 255; img.data[k + 1] = tmp.g * 255; img.data[k + 2] = tmp.b * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ── 機場地面材質 ──
function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speckle(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${alpha * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
// 水泥停機坪：每格 25m 的接縫、深淺不一、油漬
const concreteTex = () => canvasTexture(512, 512, (g, w, h) => {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 150 + Math.random() * 22; g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(i * 128, j * 128, 128, 128);
  }
  speckle(g, w, h, 9000, 0.12);
  for (let k = 0; k < 7; k++) {
    const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,38,34,0.28)'); gr.addColorStop(1, 'rgba(40,38,34,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.fillStyle = 'rgba(70,70,68,0.7)';
  for (let k = 0; k <= 4; k++) { g.fillRect(k * 128 - 1, 0, 2, h); g.fillRect(0, k * 128 - 1, w, 2); }
});
// 草地：割草條紋＋深淺斑塊
const grassTex = () => canvasTexture(512, 512, (g, w, h) => {
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#62903f' : '#6f9d48'; g.fillRect(i * 64, 0, 64, h); }
  for (let k = 0; k < 40; k++) {
    const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    gr.addColorStop(0, dark ? 'rgba(40,70,25,0.25)' : 'rgba(160,170,90,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(g, w, h, 14000, 0.15);
});
// 滑行道柏油：黃色中心線
const taxiTex = () => canvasTexture(128, 512, (g, w, h) => {
  g.fillStyle = '#46474a'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 3000, 0.1);
  g.fillStyle = '#e8b81c'; g.fillRect(w / 2 - 3, 0, 6, h);
  g.fillStyle = 'rgba(232,184,28,0.9)'; g.fillRect(4, 0, 3, h); g.fillRect(w - 7, 0, 3, h);
});
// 航廈玻璃帷幕：橫向玻璃帶、窗框、反光
const facadeTex = () => canvasTexture(512, 256, (g, w, h) => {
  g.fillStyle = '#d9dde3'; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 40, 0, 220); gr.addColorStop(0, '#5c7894'); gr.addColorStop(0.5, '#2f4a66'); gr.addColorStop(1, '#3d5a78');
  g.fillStyle = gr; g.fillRect(0, 40, w, 180);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.moveTo(60, 40); g.lineTo(160, 40); g.lineTo(80, 220); g.lineTo(-20, 220); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(330, 40); g.lineTo(380, 40); g.lineTo(300, 220); g.lineTo(250, 220); g.closePath(); g.fill();
  g.fillStyle = '#c5cad1';
  for (let x = 0; x <= w; x += 32) g.fillRect(x - 2, 40, 4, 180);
  g.fillRect(0, 128, w, 4);
  g.fillStyle = '#9aa1aa'; g.fillRect(0, 220, w, 36);
});
function scaleUV(geo, sx, sy) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return geo;
}

function runwayTexture(lengthM, widthM, labels) {
  const W = 128, H = 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3a3d';
  g.fillRect(0, 0, W, H);
  // 雜訊
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const pxPerM = H / lengthM;
  g.fillStyle = '#e8e8e8';
  // 中心線
  for (let y = 80 * pxPerM; y < H - 80 * pxPerM; y += 50 * pxPerM) g.fillRect(W / 2 - 1.5, y, 3, 30 * pxPerM);
  // 邊線
  g.fillRect(3, 0, 2, H); g.fillRect(W - 5, 0, 2, H);
  // 兩端
  for (const end of [0, 1]) {
    const y0 = end ? H - 6 - 45 * pxPerM : 6;
    for (let s = 0; s < 8; s++) {
      const x = 10 + s * 7 + (s >= 4 ? 18 : 0);
      g.fillRect(x, y0, 4, 45 * pxPerM);
    }
    // 瞄準點（兩條粗白塊）
    const yz = end ? H - 400 * pxPerM - 60 * pxPerM : 400 * pxPerM;
    g.fillRect(26, yz, 16, 60 * pxPerM);
    g.fillRect(W - 42, yz, 16, 60 * pxPerM);
    // 著陸區標線：150m 起每 150m 一組（3、2、2、1 條）
    [[150, 3], [300, 2], [550, 2], [700, 1], [850, 1]].forEach(([d, n]) => {
      const y = end ? H - (d + 22) * pxPerM : d * pxPerM;
      for (let k = 0; k < n; k++) { g.fillRect(14 + k * 7, y, 4, 22 * pxPerM); g.fillRect(W - 18 - k * 7, y, 4, 22 * pxPerM); }
    });
    // 輪胎磨痕
    for (let k = 0; k < 70; k++) {
      const d = 250 + Math.random() * 650, y = end ? H - d * pxPerM : d * pxPerM;
      g.fillStyle = `rgba(15,15,15,${0.08 + Math.random() * 0.12})`;
      g.fillRect(W / 2 - 22 + Math.random() * 44, y, 2 + Math.random() * 3, (8 + Math.random() * 30) * pxPerM);
    }
    g.fillStyle = '#e8e8e8';
  }
  // 跑道號碼
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.save(); g.translate(W / 2, H - 70 * pxPerM - 4); g.fillText(labels[0], 0, 0); g.restore();
  g.save(); g.translate(W / 2, 70 * pxPerM + 4); g.rotate(Math.PI); g.fillText(labels[1], 0, 0); g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function softSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 手工地形（真實地形載入失敗時的備援）
const legacy = { land: [], mountains: [], cities: null, cityLights: null };

export function buildWorld(scene) {
  // 天空與霧
  scene.background = new THREE.Color(0x8fbbe8);
  scene.fog = new THREE.Fog(0xa9c8ea, 8000, 160000);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x445533, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
  sun.position.set(-0.5, 1, 0.3).normalize();
  scene.add(sun);
  scene.add(sun.target);

  // 天空穹頂：漸層＋太陽光暈＋夜晚星空
  const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() },
      sunSize: { value: 1 }, stars: { value: 0 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform vec3 top, bottom, sunDir, sunCol; uniform float sunSize, stars; varying vec3 vP;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.55));
        if (d.y < 0.0) col = mix(bottom, bottom * 0.7, clamp(-d.y * 4.0, 0.0, 1.0));
        float s = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(s, 6.0) * 0.18 + pow(s, 60.0) * 0.45) * sunSize;
        col += sunCol * smoothstep(0.99955, 0.9998, s) * 4.0;
        if (stars > 0.0 && d.y > 0.02) {
          vec3 c = floor(d * 380.0);
          float st = step(0.9975, hash(c));
          col += vec3(st * stars * (0.6 + 0.4 * hash(c + 1.0)));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // 海洋：程式波浪法線＋菲涅耳反射＋太陽反光
  const seaMat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, deep: { value: new THREE.Color() }, skyCol: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, sunInt: { value: 1 },
    }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      uniform float time, sunInt; uniform vec3 deep, skyCol, sunDir, sunCol;
      varying vec3 vW;
      void main(){
        #include <logdepthbuf_fragment>
        vec2 p = vW.xz; float t = time;
        vec2 d1 = normalize(vec2(1.0, 0.3)), d2 = normalize(vec2(-0.4, 1.0)), d3 = normalize(vec2(0.7, -0.8)), d4 = normalize(vec2(-1.0, -0.2));
        vec2 g = d1 * cos(dot(d1, p) * 0.021 + t * 1.1) * 0.6 + d2 * cos(dot(d2, p) * 0.037 + t * 1.5) * 0.4
               + d3 * cos(dot(d3, p) * 0.093 + t * 2.2) * 0.25 + d4 * cos(dot(d4, p) * 0.21 + t * 3.1) * 0.15;
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        float k = 0.32 * clamp(1800.0 / dist, 0.04, 1.0);
        vec3 N = normalize(vec3(-g.x * k, 1.0, -g.y * k));
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 col = mix(deep, skyCol, 0.12 + 0.78 * fres);
        vec3 R = reflect(-V, N);
        float sd = max(dot(R, sunDir), 0.0);
        col += sunCol * (pow(sd, 220.0) * 2.5 + pow(sd, 18.0) * 0.12) * sunInt;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(8e6, 8e6), seaMat);
  sea.rotation.x = -Math.PI / 2;
  scene.add(sea);

  // 陸地
  const landTex = fbmTexture(512, [[0.25, 0x4f8239], [0.42, 0x6a9a45], [0.52, 0x93ad59], [0.6, 0xb0ab72], [0.7, 0x83a052], [0.8, 0x4d7a3a]]);
  landTex.repeat.set(1 / 6000, 1 / 6000);
  const landMat = new THREE.MeshLambertMaterial({ map: landTex });
  for (const pts of Object.values(COASTLINES)) {
    const shape = new THREE.Shape(pts.map(([lon, lat]) => {
      const w = toWorld(lon, lat);
      return new THREE.Vector2(w.x, -w.z);
    }));
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, landMat);
    m.position.y = LAND_Y;
    scene.add(m);
    legacy.land.push(m);
    // 海灘邊
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts.map(([lon, lat]) => { const w = toWorld(lon, lat); return new THREE.Vector3(w.x, LAND_Y + 0.5, w.z); })),
      new THREE.LineBasicMaterial({ color: 0xd9cf9a }),
    );
    scene.add(edge);
    legacy.land.push(edge);
  }

  // 山：低多邊形山峰，有稜線起伏與高度分層顏色（綠坡 → 岩石 → 積雪）
  const mtnMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const cGreen = new THREE.Color(0x4a6e33), cGreen2 = new THREE.Color(0x5f7d3c), cRock = new THREE.Color(0x7a7262), cRock2 = new THREE.Color(0x8c877c), cSnow = new THREE.Color(0xf3f6fa);
  for (const [lon, lat, h, r, snow] of MOUNTAINS) {
    const w = toWorld(lon, lat);
    const geo = new THREE.ConeGeometry(r, h, 26, 9, true).toNonIndexed();
    const pos = geo.attributes.position;
    const seed = Math.random() * 100;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const f = (v.y + h / 2) / h;                         // 0 山腳 → 1 山頂
      const ang = Math.atan2(v.z, v.x);
      const ridge = 1 + 0.22 * Math.sin(ang * 3 + seed) + 0.12 * Math.sin(ang * 7 + seed * 1.7) + 0.06 * Math.sin(ang * 13 + seed * 0.3);
      const bulge = 1 + 0.25 * Math.sin(f * Math.PI);       // 山腰略為飽滿
      v.x *= ridge * bulge; v.z *= ridge * bulge;
      v.y += (Math.sin(ang * 5 + seed) * 0.03 + (Math.random() - 0.5) * 0.02) * h * (1 - f) * (f > 0.02 ? 1 : 0);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      // 以三角形平均高度上色，維持低多邊形風格
      const fy = ((pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 + h / 2) / h;
      const jitter = Math.random() * 0.08;
      if (snow && fy > 0.74 + jitter) tmp.copy(cSnow);
      else if (fy > 0.5 + jitter) tmp.copy(cRock).lerp(cRock2, Math.random());
      else tmp.copy(cGreen).lerp(cGreen2, Math.random());
      for (let k = 0; k < 3; k++) colors.set([tmp.r, tmp.g, tmp.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mtnMat);
    legacy.mountains.push(m);
    m.position.set(w.x, h / 2, w.z);
    scene.add(m);
    mountains.push({ x: w.x, z: w.z, h, r });
  }

  // 機場
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex() });
  const apronMat = new THREE.MeshLambertMaterial({ map: concreteTex() });
  const taxiMat = new THREE.MeshLambertMaterial({ map: taxiTex() });
  const facade = facadeTex();
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8f969f });
  let rwIndex = 0;
  const lights = { w: [], r: [], g: [], b: [] };
  const addLight = (kind, x, y, z, sc = 1) => lights[kind].push([x, y, z, sc]);
  for (const [code, ap] of Object.entries(AIRPORTS)) {
    for (const rw of ap.runways) {
      const c = toWorld(rw.lon, rw.lat);
      const hr = rw.heading * Math.PI / 180;
      const dirX = Math.sin(hr), dirZ = -Math.cos(hr);
      const rot = -hr; // 繞 Y 軸，使 -Z 指向跑道方向

      const gW = 1300, gL = rw.length + 1600;
      const grass = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(gW, gL), gW / 96, gL / 96), grassMat);
      grass.rotation.set(-Math.PI / 2, 0, rot);
      grass.position.set(c.x - dirZ * 120, LAND_Y + 0.4 - rwIndex * 0.05, c.z + dirX * 120);
      grass.receiveShadow = true;
      scene.add(grass);
      rwIndex++;

      let [a, b] = rw.id.split('/');
      if (Math.abs(((parseInt(a, 10) * 10 - rw.heading + 540) % 360) - 180) > 90) [a, b] = [b, a];
      const tex = runwayTexture(rw.length, rw.width, [a, b]);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(rw.width, rw.length), new THREE.MeshLambertMaterial({ map: tex }));
      strip.rotation.set(-Math.PI / 2, 0, rot);
      strip.position.set(c.x, RUNWAY_Y, c.z);
      strip.receiveShadow = true;
      scene.add(strip);
      // 跑道肩（淺色鋪面）
      const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(rw.width + 16, rw.length + 60), new THREE.MeshLambertMaterial({ color: 0x8a8b86 }));
      shoulder.rotation.set(-Math.PI / 2, 0, rot);
      shoulder.position.set(c.x, RUNWAY_Y - 0.15, c.z);
      shoulder.receiveShadow = true;
      scene.add(shoulder);

      // 機坪與航廈
      const px = -dirZ, pz = dirX; // 右側法向
      const apron = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(400, rw.length * 0.5), 400 / 100, rw.length * 0.5 / 100), apronMat);
      apron.rotation.set(-Math.PI / 2, 0, rot);
      apron.position.set(c.x + px * 350, LAND_Y + 0.6, c.z + pz * 350);
      apron.receiveShadow = true;
      scene.add(apron);
      // 滑行道：從跑道連到停機坪（三條），加上停止線
      for (const f of [-0.36, 0, 0.36]) {
        const tl = 150 - (rw.width / 2 + 4);
        const tw = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(23, tl), 1, tl / 40), taxiMat);
        tw.rotation.set(-Math.PI / 2, 0, rot + Math.PI / 2);
        const sAl = f * rw.length, mid = rw.width / 2 + 4 + tl / 2;
        tw.position.set(c.x + dirX * sAl + px * mid, LAND_Y + 0.62, c.z + dirZ * sAl + pz * mid);
        tw.receiveShadow = true;
        scene.add(tw);
        for (let k = 0; k <= tl; k += 30) for (const side of [-1, 1]) {
          const lx = c.x + dirX * (sAl + side * 13) + px * (rw.width / 2 + 4 + k), lz = c.z + dirZ * (sAl + side * 13) + pz * (rw.width / 2 + 4 + k);
          addLight('b', lx, LAND_Y + 1.1, lz, 0.7);
        }
      }
      // 航廈：玻璃帷幕＋屋頂
      const tL = rw.length * 0.48;
      const fTex = facade.clone(); fTex.repeat.set(tL / 60, 1); fTex.needsUpdate = true;
      const fEnd = facade.clone(); fEnd.repeat.set(2, 1); fEnd.needsUpdate = true;
      const fm = new THREE.MeshLambertMaterial({ map: fTex }), fe = new THREE.MeshLambertMaterial({ map: fEnd });
      const term = new THREE.Mesh(new THREE.BoxGeometry(120, 22, tL), [fm, fm, roofMat, roofMat, fe, fe]);
      term.rotation.y = rot;
      term.position.set(c.x + px * 600, 11, c.z + pz * 600);
      term.castShadow = true; term.receiveShadow = true;
      scene.add(term);
      const eave = new THREE.Mesh(new THREE.BoxGeometry(136, 1.2, tL + 12), new THREE.MeshLambertMaterial({ color: 0xe4e7eb }));
      eave.rotation.y = rot; eave.position.set(c.x + px * 600, 22.6, c.z + pz * 600); eave.castShadow = true;
      scene.add(eave);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 70, 8), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
      tower.position.set(c.x + px * 520 + dirX * rw.length * 0.25, 35, c.z + pz * 520 + dirZ * rw.length * 0.25);
      scene.add(tower);

      // 跑道燈與進場燈
      const halfLen = rw.length / 2, halfWid = rw.width / 2;
      for (let s = -halfLen; s <= halfLen; s += 60) {
        for (const side of [-1, 1]) {
          addLight('w', c.x + dirX * s + px * side * (halfWid + 2), RUNWAY_Y + 0.8, c.z + dirZ * s + pz * side * (halfWid + 2));
        }
      }
      for (const end of [-1, 1]) {
        for (let k = -halfWid; k <= halfWid; k += 6) {
          addLight(end < 0 ? 'g' : 'r', c.x + dirX * end * halfLen + px * k, RUNWAY_Y + 0.8, c.z + dirZ * end * halfLen + pz * k);
        }
        // 進場燈（延伸 900m）
        for (let d = 30; d <= 900; d += 30) {
          const s = end * (halfLen + d);
          addLight('w', c.x + dirX * s, RUNWAY_Y + 3, c.z + dirZ * s, d % 150 === 0 ? 3.2 : 2);
        }
      }
      runways.push({ cx: c.x, cz: c.z, dirX, dirZ, halfLen, halfWid, heading: rw.heading, id: rw.id, airport: code, ils: rw.ils });
    }
  }

  const bulb = new THREE.SphereGeometry(0.42, 8, 6);
  const lightColors = { w: 0xffffee, r: 0xff3020, g: 0x30ff60, b: 0x3a7bff };
  for (const [kind, list] of Object.entries(lights)) {
    const im = new THREE.InstancedMesh(bulb, new THREE.MeshBasicMaterial({ color: lightColors[kind] }), list.length);
    const mm = new THREE.Matrix4();
    list.forEach(([x, y, z, sc], i) => im.setMatrixAt(i, mm.makeScale(sc, sc, sc).setPosition(x, y, z)));
    scene.add(im);
  }

  // 城市（InstancedMesh）
  const cityList = [...Object.values(AIRPORTS).map((a) => a.city), ...EXTRA_CITIES];
  let total = 0;
  for (const cy of cityList) total += cy.count;
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  const bMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(bGeo, bMat, total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let idx = 0;
  const lightPts = [];
  const nearRunway = (x, z) => runways.some((r) => {
    const dx = x - r.cx, dz = z - r.cz;
    const along = dx * r.dirX + dz * r.dirZ;
    const across = dx * -r.dirZ + dz * r.dirX;
    return Math.abs(along) < r.halfLen + 3000 && Math.abs(across) < 1200;
  });
  for (const cy of cityList) {
    const c = toWorld(cy.lon, cy.lat);
    for (let i = 0; i < cy.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * cy.radius;
      const x = c.x + Math.cos(ang) * rad, z = c.z + Math.sin(ang) * rad;
      if (nearRunway(x, z)) { s.set(0, 0, 0); } else {
        const centre = 1 - rad / cy.radius;
        const h = 8 + Math.random() * 30 + Math.pow(Math.random(), 3) * 180 * centre;
        s.set(30 + Math.random() * 50, h, 30 + Math.random() * 50);
      }
      p.set(x, LAND_Y, z);
      if (s.x > 0 && i % 2 === 0) lightPts.push(x, LAND_Y + 6 + Math.random() * 20, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      m4.compose(p, q, s);
      inst.setMatrixAt(idx, m4);
      const g = 0.6 + Math.random() * 0.35;
      inst.setColorAt(idx, col.setRGB(g, g * 0.98, g * 0.95));
      idx++;
    }
  }
  scene.add(inst);
  legacy.cities = inst;
  // 夜晚城市燈光
  const cityGeo = new THREE.BufferGeometry();
  cityGeo.setAttribute('position', new THREE.Float32BufferAttribute(lightPts, 3));
  const cityLights = new THREE.Points(cityGeo, new THREE.PointsMaterial({ color: 0xffcf85, size: 22, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  cityLights.visible = false;
  legacy.cityLights = cityLights;
  scene.add(cityLights);

  // 雲（Instanced billboard）
  const a = toWorld(119, 22), b = toWorld(143, 38);
  const puffList = [];
  const cloudCount = matchMedia('(pointer: coarse)').matches ? 450 : 900;
  for (let i = 0; i < cloudCount; i++) {
    const cx = a.x + Math.random() * (b.x - a.x);
    const cz = b.z + Math.random() * (a.z - b.z);
    const cyY = 1500 + Math.random() * 2500;
    const puffs = 3 + Math.floor(Math.random() * 5);
    for (let k = 0; k < puffs; k++) {
      const size = 1200 + Math.random() * 1800;
      puffList.push([cx + (Math.random() - 0.5) * 2500, cyY + Math.random() * 300, cz + (Math.random() - 0.5) * 2500, size]);
    }
  }
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, lit: { value: new THREE.Color(1, 1, 1) }, shade: { value: new THREE.Color(0.75, 0.8, 0.88) } }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sx = length(instanceMatrix[0].xyz);
        mvPosition.xy += position.xy * vec2(sx, sx * 0.55);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map; uniform vec3 lit, shade;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(map, vUv);
        vec3 col = mix(shade, lit, smoothstep(0.15, 0.85, vUv.y));   // 雲底較暗、雲頂受光
        gl_FragColor = vec4(col, c.a * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  cloudMat.uniforms.map.value = softSprite();
  const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cloudMat, puffList.length);
  const cm = new THREE.Matrix4();
  puffList.forEach(([x, y, z, sz], i) => clouds.setMatrixAt(i, cm.makeScale(sz, sz, sz).setPosition(x, y, z)));
  clouds.frustumCulled = false;
  scene.add(clouds);

  const PRESETS = {
    day: { top: 0x0f45a8, bottom: 0x9fc6ee, fog: 0x9cc0e6, sunDir: [-0.5, 1, 0.3], sunCol: 0xfff1d6, sunI: 2.9, sunSize: 0.6,
      hemiSky: 0xdfefff, hemiGround: 0x445533, hemiI: 1.0, deep: 0x0d3554, lit: 0xffffff, shade: 0xb4c0d2, stars: 0, city: false, exposure: 1.0 },
    dawn: { top: 0x24386f, bottom: 0xffb27a, fog: 0xeaa985, sunDir: [0.85, 0.1, -0.5], sunCol: 0xffa860, sunI: 2.0, sunSize: 1.3,
      hemiSky: 0xffd2b0, hemiGround: 0x5a4a50, hemiI: 1.3, deep: 0x1a2440, lit: 0xffd3ad, shade: 0x8d6a86, stars: 0, city: true, exposure: 1.05 },
    night: { top: 0x01030b, bottom: 0x0c1834, fog: 0x0b1530, sunDir: [-0.3, 0.55, -0.6], sunCol: 0x9fb4ff, sunI: 0.35, sunSize: 0.25,
      hemiSky: 0x5a6a9a, hemiGround: 0x101018, hemiI: 0.45, deep: 0x040a18, lit: 0x39436a, shade: 0x161c33, stars: 1, city: true, exposure: 1.25 },
  };
  const env = {
    sun, sky, sunDir: new THREE.Vector3(-0.5, 1, 0.3).normalize(), exposure: 1, mode: 'day',
    setTime(mode) {
      const P = PRESETS[mode] || PRESETS.day;
      this.mode = mode;
      this.sunDir.set(...P.sunDir).normalize();
      skyMat.uniforms.top.value.set(P.top); skyMat.uniforms.bottom.value.set(P.bottom);
      skyMat.uniforms.sunDir.value.copy(this.sunDir); skyMat.uniforms.sunCol.value.set(P.sunCol);
      skyMat.uniforms.sunSize.value = P.sunSize; skyMat.uniforms.stars.value = P.stars;
      scene.fog.color.set(P.fog); scene.background.set(P.bottom);
      sun.color.set(P.sunCol); sun.intensity = P.sunI;
      hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
      seaMat.uniforms.deep.value.set(P.deep); seaMat.uniforms.skyCol.value.set(P.bottom);
      seaMat.uniforms.sunDir.value.copy(this.sunDir); seaMat.uniforms.sunCol.value.set(P.sunCol); seaMat.uniforms.sunInt.value = P.sunI / 2.4;
      cloudMat.uniforms.lit.value.set(P.lit); cloudMat.uniforms.shade.value.set(P.shade);
      cityLights.visible = P.city;
      cityLights.material.opacity = mode === 'night' ? 0.95 : 0.35;
      this.exposure = P.exposure;
      // 雨天：天空與海面變灰暗、能見度降低、陽光減弱
      const rain = this.weather === 'rain';
      scene.fog.near = rain ? 1200 : 8000; scene.fog.far = rain ? 32000 : 160000;
      if (rain) {
        const gray = new THREE.Color(mode === 'night' ? 0x0a0e16 : 0x6d7682);
        skyMat.uniforms.top.value.lerp(gray, 0.75); skyMat.uniforms.bottom.value.lerp(gray, 0.6);
        skyMat.uniforms.sunSize.value = 0; skyMat.uniforms.stars.value = 0;
        scene.fog.color.lerp(gray, 0.7); scene.background.copy(skyMat.uniforms.bottom.value);
        sun.intensity *= 0.35; hemi.intensity *= 0.8;
        seaMat.uniforms.deep.value.lerp(new THREE.Color(0x15212c), 0.5); seaMat.uniforms.skyCol.value.copy(scene.fog.color);
        seaMat.uniforms.sunInt.value *= 0.15;
        cloudMat.uniforms.lit.value.lerp(gray, 0.6); cloudMat.uniforms.shade.value.lerp(new THREE.Color(0x3a414b), 0.7);
        this.exposure *= 1.05;
      }
    },
    setWeather(w) { this.weather = w; this.setTime(this.mode); },
    update(t) { seaMat.uniforms.time.value = t; },
    // 真實地形就緒：隱藏手工陸地與山，把建築與城市燈光放到地形高度上
    useTerrain(heightAt) {
      provider = heightAt;
      for (const m of [...legacy.land, ...legacy.mountains]) m.visible = false;
      const inst = legacy.cities, mm = new THREE.Matrix4(), pp = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, mm); mm.decompose(pp, qq, ss);
        pp.y = heightAt(pp.x, pp.z) + 0.5;
        inst.setMatrixAt(i, mm.compose(pp, qq, ss));
      }
      inst.instanceMatrix.needsUpdate = true;
      const lp = legacy.cityLights.geometry.attributes.position;
      for (let i = 0; i < lp.count; i++) lp.setY(i, heightAt(lp.getX(i), lp.getZ(i)) + 12 + (i % 7) * 3);
      lp.needsUpdate = true;
    },
  };
  env.setTime('day');
  return env;
}

// 地表高度（陸地/海平面皆以 0 估算，山以錐體計算）
let provider = null;
export function terrainHeight(x, z) {
  if (provider) return provider(x, z);
  let h = 0;
  for (const m of mountains) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < m.r) h = Math.max(h, m.h * (1 - d / m.r));
  }
  return h;
}

// 若位置在跑道上，回傳該跑道
export function runwayAt(x, z) {
  for (const r of runways) {
    const dx = x - r.cx, dz = z - r.cz;
    const along = dx * r.dirX + dz * r.dirZ;
    const across = dx * -r.dirZ + dz * r.dirX;
    if (Math.abs(along) <= r.halfLen + 60 && Math.abs(across) <= r.halfWid + 15) return r;
  }
  return null;
}
