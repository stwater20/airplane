import * as THREE from 'three';
import { COASTLINES, MOUNTAINS, AIRPORTS, EXTRA_CITIES, toWorld } from './geo.js?v=20261101183315';

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
    // 著陸區標誌
    const yz = end ? H - 300 * pxPerM - 60 * pxPerM : 300 * pxPerM;
    g.fillRect(28, yz, 14, 60 * pxPerM);
    g.fillRect(W - 42, yz, 14, 60 * pxPerM);
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

  // 天空穹頂（漸層）
  const skyGeo = new THREE.SphereGeometry(1000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6fc4) }, bottom: { value: new THREE.Color(0xbcd6f0) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.6)), 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // 海洋
  const seaTex = noiseTexture(new THREE.Color(0x1d4f7a), new THREE.Color(0x24608f), 256, 32, 0.08);
  seaTex.repeat.set(4000, 4000);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(8e6, 8e6),
    new THREE.MeshLambertMaterial({ map: seaTex }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0, 0);
  scene.add(sea);

  // 陸地
  const landTex = noiseTexture(new THREE.Color(0x4f7a3a), new THREE.Color(0x8c8a55), 256, 16, 0.12);
  landTex.repeat.set(1 / 1500, 1 / 1500);
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
    // 海灘邊
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts.map(([lon, lat]) => { const w = toWorld(lon, lat); return new THREE.Vector3(w.x, LAND_Y + 0.5, w.z); })),
      new THREE.LineBasicMaterial({ color: 0xd9cf9a }),
    );
    scene.add(edge);
  }

  // 山
  const mtnMat = new THREE.MeshLambertMaterial({ color: 0x5b6e3e, flatShading: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xf4f6fa, flatShading: true });
  for (const [lon, lat, h, r, snow] of MOUNTAINS) {
    const w = toWorld(lon, lat);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9, 1), mtnMat);
    cone.position.set(w.x, h / 2, w.z);
    cone.rotation.y = Math.random() * Math.PI;
    scene.add(cone);
    if (snow) {
      const sh = h * 0.18;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.18 * 1.02, sh, 9, 1), snowMat);
      cap.position.set(w.x, h - sh / 2 + 5, w.z);
      cap.rotation.y = cone.rotation.y;
      scene.add(cap);
    }
    mountains.push({ x: w.x, z: w.z, h, r });
  }

  // 機場
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x6d8f4a });
  const apronMat = new THREE.MeshLambertMaterial({ color: 0x8d8d8a });
  const lights = { w: [], r: [], g: [] };
  const addLight = (kind, x, y, z, sc = 1) => lights[kind].push([x, y, z, sc]);
  for (const [code, ap] of Object.entries(AIRPORTS)) {
    for (const rw of ap.runways) {
      const c = toWorld(rw.lon, rw.lat);
      const hr = rw.heading * Math.PI / 180;
      const dirX = Math.sin(hr), dirZ = -Math.cos(hr);
      const rot = -hr; // 繞 Y 軸，使 -Z 指向跑道方向

      const grass = new THREE.Mesh(new THREE.PlaneGeometry(rw.width * 8, rw.length + 1200), grassMat);
      grass.rotation.set(-Math.PI / 2, 0, rot);
      grass.position.set(c.x, LAND_Y + 0.4, c.z);
      scene.add(grass);

      let [a, b] = rw.id.split('/');
      if (Math.abs(((parseInt(a, 10) * 10 - rw.heading + 540) % 360) - 180) > 90) [a, b] = [b, a];
      const tex = runwayTexture(rw.length, rw.width, [a, b]);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(rw.width, rw.length), new THREE.MeshLambertMaterial({ map: tex }));
      strip.rotation.set(-Math.PI / 2, 0, rot);
      strip.position.set(c.x, RUNWAY_Y, c.z);
      scene.add(strip);

      // 機坪與航廈
      const px = -dirZ, pz = dirX; // 右側法向
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, rw.length * 0.5), apronMat);
      apron.rotation.set(-Math.PI / 2, 0, rot);
      apron.position.set(c.x + px * 350, LAND_Y + 0.6, c.z + pz * 350);
      scene.add(apron);
      const term = new THREE.Mesh(new THREE.BoxGeometry(120, 22, rw.length * 0.48), new THREE.MeshLambertMaterial({ color: 0xc9ccd2 }));
      term.rotation.y = rot;
      term.position.set(c.x + px * 600, 11, c.z + pz * 600);
      scene.add(term);
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
          addLight('w', c.x + dirX * s, RUNWAY_Y + 3, c.z + dirZ * s, d % 150 === 0 ? 2.5 : 1.4);
        }
      }
      runways.push({ cx: c.x, cz: c.z, dirX, dirZ, halfLen, halfWid, heading: rw.heading, id: rw.id, airport: code, ils: rw.ils });
    }
  }

  const bulb = new THREE.SphereGeometry(1.2, 6, 4);
  const lightColors = { w: 0xffffee, r: 0xff3020, g: 0x30ff60 };
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
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      m4.compose(p, q, s);
      inst.setMatrixAt(idx, m4);
      const g = 0.6 + Math.random() * 0.35;
      inst.setColorAt(idx, col.setRGB(g, g * 0.98, g * 0.95));
      idx++;
    }
  }
  scene.add(inst);

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
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
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
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(map, vUv);
        gl_FragColor = vec4(c.rgb, c.a * 0.9);
        #include <fog_fragment>
      }`,
  });
  cloudMat.uniforms.map.value = softSprite();
  const clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cloudMat, puffList.length);
  const cm = new THREE.Matrix4();
  puffList.forEach(([x, y, z, sz], i) => clouds.setMatrixAt(i, cm.makeScale(sz, sz, sz).setPosition(x, y, z)));
  clouds.frustumCulled = false;
  scene.add(clouds);

  return { sun, sky };
}

// 地表高度（陸地/海平面皆以 0 估算，山以錐體計算）
export function terrainHeight(x, z) {
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
