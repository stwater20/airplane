import * as THREE from 'three';
import { buildWorld, runways, terrainHeight } from './world.js';
import { Aircraft, GEAR_H, FLAP_NAMES } from './aircraft.js';
import { Autopilot } from './autopilot.js';
import { HUD } from './hud.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 2.5e6);
const { sun, sky } = buildWorld(scene);

const ac = new Aircraft();
scene.add(ac.mesh);
const ap = new Autopilot();
const hud = new HUD(document.getElementById('hud'));

const startRunway = runways.find((r) => r.airport === 'TPE' && r.id.startsWith('05R'));
ac.placeOnRunway(startRunway, -1);
ap.hdg = startRunway.heading;

const sim = { ac, ap, camera, timeScale: 1, paused: true, camMode: 0, started: false };
window.__sim = sim;
const SCALES = [1, 2, 4, 8, 16, 32, 64];
const CAM_NAMES = ['追蹤視角', '駕駛艙', '自由環繞', '塔台／地面'];

// ───── 輸入 ─────
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pageup', 'pagedown'].includes(k)) e.preventDefault();
  if (e.repeat) { keys.add(k); return; }
  keys.add(k);
  if (!sim.started && (k === 'enter' || k === ' ')) { startGame(); return; }
  if ((ac.crashed || ac.landed) && k === 'enter') { restart(); return; }
  switch (k) {
    case 'g': ac.gearDown = !ac.gearDown; toast(`起落架 ${ac.gearDown ? '放下' : '收起'}`); break;
    case 'z': ac.flaps = Math.max(0, ac.flaps - 1); toast(`襟翼 ${FLAP_NAMES[ac.flaps]}`); break;
    case 'x': ac.flaps = Math.min(4, ac.flaps + 1); toast(`襟翼 ${FLAP_NAMES[ac.flaps]}`); break;
    case 'b': ac.brakes = !ac.brakes; break;
    case 'h': ac.spoilers = !ac.spoilers; toast(`減速板 ${ac.spoilers ? '展開' : '收回'}`); break;
    case 'c': sim.camMode = (sim.camMode + 1) % 4; toast(CAM_NAMES[sim.camMode]); break;
    case 'p': sim.paused = !sim.paused; break;
    case 't': setScale(1); break;
    case 'y': setScale(-1); break;
    case 'm': hud.mapZoom = (hud.mapZoom + 1) % 4; break;
    case 'k': ap.toggleAP(ac); break;
    case 'u': ap.athr = !ap.athr; toast(`自動油門 ${ap.athr ? '接通' : '斷開'}`); break;
    case 'n': ap.lat = ap.lat === 'NAV' ? 'HDG' : 'NAV'; if (ap.lat === 'HDG') ap.hdg = Math.round(ac.attitude().heading); toast(`側向模式 ${ap.lat}`); break;
    case 'l': ap.appArmed = !ap.appArmed; toast(ap.appArmed ? 'APPR 待命（將截獲 34L ILS）' : 'APPR 取消'); break;
    case 'escape': if (sim.started) sim.paused = !sim.paused; break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function setScale(dir) {
  const i = SCALES.indexOf(sim.timeScale);
  sim.timeScale = SCALES[Math.max(0, Math.min(SCALES.length - 1, i + dir))];
  const agl = ac.pos.y - GEAR_H - terrainHeight(ac.pos.x, ac.pos.z);
  if (sim.timeScale > 4 && (ac.onGround || agl < 3000 * 0.3048)) { sim.timeScale = 4; toast('高度 3000 ft 以下最多 x4'); return; }
  toast(`時間加速 x${sim.timeScale}`);
}

// 滑鼠環繞
let orbit = { yaw: Math.PI, pitch: 0.15, dist: 70, drag: false, lx: 0, ly: 0 };
const view = renderer.domElement;
view.addEventListener('pointerdown', (e) => { orbit.drag = true; orbit.lx = e.clientX; orbit.ly = e.clientY; });
addEventListener('pointerup', () => { orbit.drag = false; });
addEventListener('pointermove', (e) => {
  if (!orbit.drag) return;
  orbit.yaw -= (e.clientX - orbit.lx) * 0.006;
  orbit.pitch = Math.max(-1.4, Math.min(1.4, orbit.pitch + (e.clientY - orbit.ly) * 0.006));
  orbit.lx = e.clientX; orbit.ly = e.clientY;
});
view.addEventListener('wheel', (e) => { orbit.dist = Math.max(25, Math.min(2000, orbit.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });

// 觸控/螢幕按鈕（行動裝置）
const touch = { pitch: 0, roll: 0 };
document.querySelectorAll('[data-key]').forEach((b) => {
  const k = b.dataset.key;
  const hold = b.dataset.hold !== undefined;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (hold) keys.add(k); else dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  });
  if (hold) for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => keys.delete(k));
});
const stick = document.getElementById('stick');
if (stick) {
  const knob = stick.querySelector('.knob');
  const move = (e) => {
    const r = stick.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = ((e.clientY - r.top) / r.height) * 2 - 1;
    touch.roll = Math.max(-1, Math.min(1, x)); touch.pitch = Math.max(-1, Math.min(1, y));
    knob.style.transform = `translate(${touch.roll * 40}px, ${touch.pitch * 40}px)`;
  };
  stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); move(e); });
  stick.addEventListener('pointermove', (e) => { if (e.buttons) move(e); });
  stick.addEventListener('pointerup', () => { touch.pitch = touch.roll = 0; knob.style.transform = ''; });
}

// AP 面板
function bindAdj(id, fn) {
  document.querySelectorAll(`[data-adj="${id}"]`).forEach((b) => b.addEventListener('click', () => { fn(Number(b.dataset.d)); updatePanel(); }));
}
bindAdj('spd', (d) => { ap.spd = Math.max(120, Math.min(340, ap.spd + d)); });
bindAdj('hdg', (d) => { ap.hdg = (ap.hdg + d + 360) % 360; if (ap.lat !== 'HDG' && ap.lat !== 'LOC') ap.lat = 'HDG'; });
bindAdj('alt', (d) => { ap.alt = Math.max(1000, Math.min(41000, ap.alt + d)); });
document.querySelectorAll('[data-btn]').forEach((b) => b.addEventListener('click', () => {
  dispatchEvent(new KeyboardEvent('keydown', { key: b.dataset.btn }));
  b.blur();
}));
function updatePanel() {
  document.getElementById('apSpd').textContent = ap.spd;
  document.getElementById('apHdg').textContent = ap.lat === 'NAV' ? 'NAV' : String(Math.round(ap.hdg)).padStart(3, '0');
  document.getElementById('apAlt').textContent = ap.alt >= 18000 ? `FL${Math.round(ap.alt / 100)}` : ap.alt;
  const set = (id, on) => document.getElementById(id).classList.toggle('on', on);
  set('bAP', ap.ap); set('bATHR', ap.athr); set('bNAV', ap.lat === 'NAV'); set('bAPPR', ap.appArmed || ap.lat === 'LOC');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function startGame() {
  sim.started = true;
  sim.paused = false;
  document.getElementById('menu').classList.add('hidden');
  toast('油門 R 推到 100%，速度 150 kt 時按 S/↓ 拉起');
}
document.getElementById('startBtn').addEventListener('click', startGame);

function restart() {
  ac.placeOnRunway(startRunway, -1);
  Object.assign(ap, { ap: false, athr: false, lat: 'HDG', vert: 'ALT', appArmed: false, wp: 1, hdg: startRunway.heading });
  sim.timeScale = 1;
  document.getElementById('result').classList.add('hidden');
  shownResult = false;
}
document.getElementById('againBtn').addEventListener('click', restart);

let shownResult = false;
function showResult() {
  if (shownResult) return;
  shownResult = true;
  sim.timeScale = 1;
  const el = document.getElementById('result');
  const title = el.querySelector('h2'), body = el.querySelector('p');
  if (ac.crashed) {
    title.textContent = '💥 墜機';
    body.textContent = ac.crashReason;
  } else {
    const t = ac.landed;
    const vs = Math.round(t.vs);
    const grade = vs > -120 ? '奶油般完美！' : vs > -240 ? '漂亮的落地' : vs > -400 ? '略重但安全' : '重落地，乘客受驚';
    const mins = Math.round(t.time / 60);
    title.textContent = '🛬 歡迎來到成田！';
    body.innerHTML = `${grade}<br>接地垂直速度 ${vs} fpm ・ 接地速度 ${Math.round(t.ias)} kt<br>跑道 ${t.rw.id} ・ 飛行時間 ${Math.floor(mins / 60)} 小時 ${mins % 60} 分`;
  }
  el.classList.remove('hidden');
}

// ───── 主迴圈 ─────
const clock = new THREE.Clock();
const FIXED = 1 / 120;
let acc = 0;
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
const smoothCam = new THREE.Vector3();
let camInit = false;

function readControls(dt) {
  const k = (...ks) => ks.some((x) => keys.has(x));
  const axis = (neg, pos) => (k(...pos) ? 1 : 0) - (k(...neg) ? 1 : 0);
  // S/↓ = 拉桿（機頭上），W/↑ = 推桿
  const pitch = axis(['w', 'arrowup'], ['s', 'arrowdown']) + touch.pitch;  // 搖桿往下拖 = 拉桿
  const roll = axis(['a', 'arrowleft'], ['d', 'arrowright']) + touch.roll;
  const yaw = axis(['q'], ['e']);
  const manual = Math.abs(pitch) > 0.05 || Math.abs(roll) > 0.05;
  if (ap.ap && manual) { ap.ap = false; toast('自動駕駛已斷開（手動操縱）'); }
  if (!ap.ap) {
    const s = (cur, tgt, rate) => cur + Math.max(-rate * dt, Math.min(rate * dt, tgt - cur));
    ac.input.pitch = s(ac.input.pitch, Math.max(-1, Math.min(1, pitch)), 3);
    ac.input.roll = s(ac.input.roll, Math.max(-1, Math.min(1, roll)), 4);
    ac.input.yaw = s(ac.input.yaw, yaw, 3);
  }
  if (k('r', 'shift')) { ac.throttle = Math.min(1, ac.throttle + dt * 0.5); if (ap.athr) { ap.athr = false; toast('自動油門斷開'); } }
  if (k('f', 'control')) { ac.throttle = Math.max(0, ac.throttle - dt * 0.5); if (ap.athr) { ap.athr = false; toast('自動油門斷開'); } }
  ac.brakesHeld = k(' ');
}

function updateCamera(dt) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ac.quat);
  const mode = sim.camMode;
  ac.mesh.visible = mode !== 1;
  if (mode === 0) {
    // 追蹤：位於飛機後上方，平滑跟隨航向
    const hdgFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const desired = ac.pos.clone().addScaledVector(hdgFwd, -orbit.dist).add(new THREE.Vector3(0, orbit.dist * 0.18 + 3, 0));
    if (!camInit || smoothCam.distanceTo(desired) > 800) { smoothCam.copy(desired); camInit = true; }
    smoothCam.lerp(desired, Math.min(1, dt * 4));
    camera.position.copy(smoothCam);
    camera.up.set(0, 1, 0);
    // 視線略往下，讓飛機位於畫面中上方、不被下方儀表遮住
    camera.lookAt(camTarget.copy(ac.pos).addScaledVector(hdgFwd, orbit.dist * 0.85).add(new THREE.Vector3(0, -orbit.dist * 0.36, 0)));
  } else if (mode === 1) {
    camera.position.copy(ac.pos.clone().add(new THREE.Vector3(0, 1.6, -17.5).applyQuaternion(ac.quat)));
    camera.quaternion.copy(ac.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.08));
  } else if (mode === 2) {
    const off = new THREE.Vector3(
      Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch),
    ).multiplyScalar(orbit.dist);
    camera.position.copy(ac.pos).add(off);
    camera.up.set(0, 1, 0);
    camera.lookAt(ac.pos);
  } else {
    // 地面觀察點：最近的跑道塔台，若太遠則放在前方
    let best = null, bd = Infinity;
    for (const r of runways) { const d = Math.hypot(r.cx - ac.pos.x, r.cz - ac.pos.z); if (d < bd) { bd = d; best = r; } }
    if (bd < 15000) camPos.set(best.cx - best.dirZ * 500, 75, best.cz + best.dirX * 500);
    else if (!camPos.userFly || camPos.distanceTo(ac.pos) > 4000) {
      camPos.copy(ac.pos).addScaledVector(fwd, 2500).add(new THREE.Vector3(150, -40, 0));
      camPos.userFly = true;
    }
    camera.position.copy(camPos);
    camera.position.y = Math.max(camera.position.y, terrainHeight(camera.position.x, camera.position.z) + 5);
    camera.up.set(0, 1, 0);
    camera.lookAt(ac.pos);
    camera.fov = THREE.MathUtils.clamp(65 * 300 / Math.max(300, camera.position.distanceTo(ac.pos)), 5, 65);
  }
  if (mode !== 3 && camera.fov !== 65) camera.fov = 65;
  camera.updateProjectionMatrix();
  // 防止鏡頭鑽入地面
  camera.position.y = Math.max(camera.position.y, 1.5);
  sky.position.copy(camera.position);
  sun.position.copy(camera.position).add(new THREE.Vector3(-0.5, 1, 0.3).multiplyScalar(1000));
  sun.target.position.copy(camera.position);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (sim.started && !sim.paused && !ac.crashed && !ac.landed) {
    readControls(dt);
    acc += dt * sim.timeScale;
    let n = 0;
    while (acc >= FIXED && n < 400) {
      ap.update(ac, FIXED);
      const br = ac.brakes;
      if (ac.brakesHeld) ac.brakes = true;
      ac.step(FIXED);
      if (ac.brakesHeld) ac.brakes = br;
      acc -= FIXED; n++;
      if (ac.crashed || ac.landed) break;
    }
    if (sim.timeScale > 4) {
      const agl = ac.pos.y - GEAR_H - terrainHeight(ac.pos.x, ac.pos.z);
      if (agl < 3000 * 0.3048) { sim.timeScale = 4; toast('低高度：時間加速降為 x4'); }
    }
    if (ap.msg) { toast(ap.msg); ap.msg = ''; }
  }
  if (ac.crashed || ac.landed) showResult();
  ac.syncMesh();
  updateCamera(dt);
  renderer.render(scene, camera);
  hud.draw(ac, ap, sim);
  updatePanel();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

frame();
