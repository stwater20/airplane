import * as THREE from 'three';
import { buildWorld, runways, terrainHeight } from './world.js?v=20261104214437';
import { Aircraft, GEAR_H, FLAP_NAMES } from './aircraft.js?v=20261104214437';
import { Autopilot } from './autopilot.js?v=20261104214437';
import { HUD } from './hud.js?v=20261104214437';
import { Casual } from './casual.js?v=20261104214437';
import { GameAudio } from './audio.js?v=20261104214437';
import { SpeedFX } from './effects.js?v=20261104214437';
import { Taoyuan } from './taoyuan.js?v=20261104214437';
import { Boarding } from './boarding.js?v=20261104214437';
import { progress, LIVERIES, GACHA_COST, ACHIEVEMENTS, todaySeed, todayKey } from './progress.js?v=20261104214437';
import { Terrain } from './terrain.js?v=20261104214437';
import { Traffic } from './traffic.js?v=20261104214437';

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 2.5e6);
const env = buildWorld(scene);
const { sun, sky } = env;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const terrain = new Terrain(scene);
terrain.load().then(() => env.useTerrain((x, z) => terrain.heightAt(x, z))).catch((e) => console.warn('真實地形載入失敗，使用手工地形', e));
const traffic = new Traffic(scene);
const taoyuan = new Taoyuan(scene);
const boarding = new Boarding(scene);
const fx = new SpeedFX(scene);
const ac = new Aircraft();
scene.add(ac.mesh);
const ap = new Autopilot();
const hud = new HUD(document.getElementById('hud'));

const startRunway = runways.find((r) => r.airport === 'TPE' && r.id.startsWith('05R'));
ac.placeOnRunway(startRunway, -1);
ap.hdg = startRunway.heading;

const sim = { ac, ap, camera, taoyuan, env, terrain, boarding, timeScale: 1, paused: true, camMode: 0, started: false, casual: true, voice: true, tilt: false };
sim.audio = new GameAudio();
sim.runways = runways;
window.__sim = sim;
const casual = new Casual(scene, sim, (m) => toast(m));
sim.casualGame = casual;
const SCALES = [1, 2, 4, 8, 16, 32, 64];
const CAM_NAMES = ['追蹤視角', '駕駛艙', '自由環繞', '塔台／地面'];

// ───── 輸入 ─────
const keys = new Set();
const tapped = new Set();   // 本幀內按過的鍵（快速點按也能生效）
// 以實體按鍵位置判斷，避免中文輸入法影響 e.key
function keyName(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Arrow')) return c.toLowerCase();
  if (c === 'Space') return ' ';
  if (c.startsWith('Shift')) return 'shift';
  if (c.startsWith('Control')) return 'control';
  if (c === 'Enter' || c === 'NumpadEnter') return 'enter';
  if (c === 'Escape') return 'escape';
  return (e.key || '').toLowerCase();
}
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = keyName(e);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'pageup', 'pagedown'].includes(k)) e.preventDefault();
  if (e.repeat) { keys.add(k); return; }
  keys.add(k); tapped.add(k);
  if (!sim.started && (k === 'enter' || k === ' ')) { startGame(true); return; }
  if ((ac.crashed || ac.landed) && k === 'enter') { restart(); return; }
  if (sim.casual) {
    if (k === 'c') cycleCam();
    if (k === 'p' || k === 'escape') sim.paused = !sim.paused;
    return;
  }
  switch (k) {
    case 'r': case 'shift': ac.throttle = Math.min(1, ac.throttle + 0.05); break;
    case 'f': case 'control': ac.throttle = Math.max(0, ac.throttle - 0.05); break;
    case 'g': ac.gearDown = !ac.gearDown; toast(`起落架 ${ac.gearDown ? '放下' : '收起'}`); break;
    case 'z': ac.flaps = Math.max(0, ac.flaps - 1); toast(`襟翼 ${FLAP_NAMES[ac.flaps]}`); break;
    case 'x': ac.flaps = Math.min(4, ac.flaps + 1); toast(`襟翼 ${FLAP_NAMES[ac.flaps]}`); break;
    case 'b': ac.brakes = !ac.brakes; break;
    case 'h': ac.spoilers = !ac.spoilers; toast(`減速板 ${ac.spoilers ? '展開' : '收回'}`); break;
    case 'c': cycleCam(); break;
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
addEventListener('keyup', (e) => keys.delete(keyName(e)));

function cycleCam() {
  const order = sim.casual ? [0, 1, 3] : [0, 1, 2, 3];
  sim.camMode = order[(order.indexOf(sim.camMode) + 1) % order.length];
  toast(CAM_NAMES[sim.camMode]);
}
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
// 輕鬆模式：在畫面任意處按住拖曳＝虛擬搖桿
const drag = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
view.style.touchAction = 'none';
view.addEventListener('pointerdown', (e) => {
  if (sim.casual && sim.ctrl === 'buttons') return;   // 按鈕模式不使用拖曳
  if (sim.casual) {
    Object.assign(drag, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
    view.setPointerCapture(e.pointerId);
    return;
  }
  orbit.drag = true; orbit.lx = e.clientX; orbit.ly = e.clientY;
});
const endDrag = (e) => { if (e.pointerId === drag.id) drag.active = false; orbit.drag = false; };
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('pointermove', (e) => {
  if (drag.active && e.pointerId === drag.id) { drag.x = e.clientX; drag.y = e.clientY; return; }
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
    if (hold) { keys.add(k); b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch { /* 舊瀏覽器 */ } } else dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  });
  if (hold) for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { keys.delete(k); b.classList.remove('held'); });
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

// 傾斜手機操控
const tilt = { x: 0, y: 0, b0: null, g0: null };
function onOrient(e) {
  const ang = (screen.orientation?.angle ?? window.orientation ?? 0) % 360;
  let lr, fb;
  if (ang === 90) { lr = e.beta; fb = -e.gamma; } else if (ang === 270 || ang === -90) { lr = -e.beta; fb = e.gamma; } else { lr = e.gamma; fb = e.beta; }
  if (tilt.b0 === null) tilt.b0 = fb;
  tilt.x = Math.max(-1, Math.min(1, lr / 22));
  tilt.y = Math.max(-1, Math.min(1, (fb - tilt.b0) / 18));   // 手機上緣往自己傾＝爬升
}
async function toggleTilt(b) {
  if (!sim.tilt) {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') { toast('未取得傾斜感應權限'); return; }
      }
    } catch { toast('此裝置不支援傾斜操控'); return; }
    tilt.b0 = null;
    addEventListener('deviceorientation', onOrient);
    sim.tilt = true; toast('傾斜操控：左右傾＝轉彎，上緣往自己＝爬升');
  } else {
    removeEventListener('deviceorientation', onOrient);
    sim.tilt = false; tilt.x = tilt.y = 0; toast('改回拖曳操控');
  }
  b.classList.toggle('on', sim.tilt);
}
// 切到別的 App 時自動暫停
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (sim.started && !sim.paused) { sim.paused = true; sim.autoPaused = true; }
    window.speechSynthesis?.pause(); sim.audio.suspend();
  } else {
    window.speechSynthesis?.resume(); sim.audio.resume();
    if (sim.autoPaused) { sim.paused = false; sim.autoPaused = false; }
  }
});

sim.fade = (cb) => {
  const f = document.getElementById('fade');
  f.classList.add('on');
  setTimeout(() => { cb(); setTimeout(() => f.classList.remove('on'), 150); }, 480);
};
function achieve(id) {
  const a = progress.unlock(id);
  if (a) { setTimeout(() => toast(`🏆 成就解鎖：${a.name}`), 400); sim.audio.chime(); }
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// 拍照：把當下畫面加上浮水印，可分享或下載
function takePhoto() {
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const w = src.width, h = src.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const k = w / 1000;
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, h - 64 * k, w, 64 * k);
  g.fillStyle = '#fff'; g.font = `600 ${22 * k}px -apple-system, "PingFang TC", sans-serif`; g.textBaseline = 'middle';
  g.fillText('✈️ 資安航空 SecTools Airlines・桃園 → 東京成田', 20 * k, h - 32 * k);
  g.textAlign = 'right'; g.font = `${18 * k}px -apple-system, sans-serif`; g.fillStyle = '#9fd3ff';
  g.fillText('airplane.sectools.tw', w - 20 * k, h - 32 * k);
  document.getElementById('flash').classList.remove('on'); void document.getElementById('flash').offsetWidth;
  document.getElementById('flash').classList.add('on');
  sim.audio.shutter();
  achieve('photo');
  c.toBlob(async (blob) => {
    const file = new File([blob], `sectools-airlines-${Date.now()}.jpg`, { type: 'image/jpeg' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '資安航空', text: '我在資安航空飛向東京 ✈️ https://airplane.sectools.tw/' }); return; }
    } catch { /* 取消分享時改為下載 */ }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('照片已儲存');
  }, 'image/jpeg', 0.9);
}

function applyLivery() {
  const col = progress.livery().color;
  ac.mesh.traverse((o) => { if (o.material?.userData?.livery) o.material.color.setHex(col); });
}
applyLivery();

const TODS = ['day', 'dawn', 'night'];
function pickTime() {
  const t = progress.data.tod || 'day';
  env.setTime(t === 'random' ? TODS[Math.floor(Math.random() * 3)] : t);
}
pickTime();

function startGame(easy, daily = false) {
  sim.casual = easy;
  document.body.classList.toggle('casual', easy);
  document.body.classList.toggle('pro', !easy);
  sim.started = true;
  sim.paused = false;
  ac.rollRateMax = easy ? 0.5 : 0.26;
  document.body.classList.add('playing');
  document.getElementById('menu').classList.add('hidden');
  if (easy && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(''));   // iOS 需在點擊時解鎖語音
  sim.audio.init();
  sim.daily = daily;
  casual.daily = daily ? todaySeed() : 0;
  if (daily) env.setTime(['day', 'dawn', 'night'][todaySeed() % 3]); else pickTime();
  applyLivery();
  casual.short = progress.data.flights > 0;
  if (easy) { casual.reset(); casual.setStage(casual.stage, daily ? '📅 今日挑戰開始！' : casual.stage === 'boarding' ? '乘客登機中…（可按「跳過」）' : '空服員安全示範（可按「跳過」）'); } else toast('油門 R 推到 100%，速度 150 kt 時按 S/↓ 拉起');
}
document.getElementById('startBtn').addEventListener('click', () => startGame(true));
document.getElementById('proBtn').addEventListener('click', () => startGame(false));
document.getElementById('dailyBtn').addEventListener('click', () => startGame(true, true));
{
  const d = progress.data.daily;
  if (d && d.date === todayKey() && d.best) document.getElementById('dailyInfo').textContent = `今天最佳 ${d.best.toLocaleString()} 分・每天固定的圓環路線`;
}
document.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
  const c = b.dataset.c;
  if (c === 'cam') cycleCam();
  if (c === 'skip') { if (casual.stage === 'cruise') casual.toApproach(); else if (casual.stage === 'briefing') casual.skipBriefing(); }
  if (c === 'music') { sim.audio.musicOn = !sim.audio.musicOn; b.classList.toggle('off', !sim.audio.musicOn); }
  if (c === 'tilt') toggleTilt(b);
  if (c === 'photo') takePhoto();
  if (c === 'pause') { sim.paused = !sim.paused; b.classList.toggle('paused', sim.paused); }
  if (c === 'menu') location.reload();
  if (c === 'voice') {
    sim.voice = !sim.voice; b.classList.toggle('off', !sim.voice);
    if (!sim.voice && window.speechSynthesis) speechSynthesis.cancel();
  }
  b.blur();
}));

function restart() {
  ac.placeOnRunway(startRunway, -1);
  Object.assign(ap, { ap: false, athr: false, lat: 'HDG', vert: 'ALT', appArmed: false, wp: 1, hdg: startRunway.heading, assistGain: 0 });
  sim.timeScale = 1;
  sim.resetCam = true;
  fx.reset();
  if (sim.casual) { if (!sim.daily) pickTime(); applyLivery(); casual.short = true; casual.reset(); casual.setStage(casual.stage); sim.briefT = 0; }
  document.getElementById('result').classList.add('hidden');
  shownResult = false;
}
document.getElementById('againBtn').addEventListener('click', restart);

let shownResult = false;
let lastShare = '';
document.getElementById('shareBtn').addEventListener('click', async () => {
  const url = 'https://airplane.sectools.tw/';
  try {
    if (navigator.share) await navigator.share({ title: '飛向東京｜資安航空', text: lastShare, url });
    else { await navigator.clipboard.writeText(`${lastShare} ${url}`); toast('已複製分享文字'); }
  } catch { /* 使用者取消分享 */ }
});

// ───── 機庫：塗裝與資安航空扭蛋 ─────
const RARITY_COL = { N: '#8e8e93', R: '#0a84ff', SR: '#bf5af2', SSR: '#ffd60a' };
function refreshCoins() {
  document.querySelectorAll('.coinBal').forEach((e) => { e.textContent = progress.data.coins.toLocaleString(); });
  document.querySelectorAll('.bestVal').forEach((e) => { e.textContent = progress.data.best.toLocaleString(); });
  const grid = document.getElementById('livGrid');
  grid.innerHTML = LIVERIES.map((l) => {
    const own = progress.data.owned.includes(l.id), sel = progress.data.livery === l.id;
    return `<button class="liv ${own ? '' : 'locked'} ${sel ? 'sel' : ''}" data-liv="${l.id}" ${own ? '' : 'disabled'}>
      <i style="background:#${l.color.toString(16).padStart(6, '0')}"></i><span>${own ? l.name : '？？？'}</span><em style="color:${RARITY_COL[l.rarity]}">${l.rarity}</em></button>`;
  }).join('');
  document.getElementById('ownCount').textContent = `${progress.data.owned.length}/${LIVERIES.length}`;
  document.getElementById('achCount').textContent = `${progress.data.ach.length}/${ACHIEVEMENTS.length}`;
  document.getElementById('achList').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = progress.data.ach.includes(a.id);
    return `<div class="${got ? '' : 'lock'}"><b>${got ? '🏆' : '🔒'}</b><span>${a.name}<small>${a.desc}</small></span></div>`;
  }).join('');
  const spin = document.getElementById('spinBtn');
  spin.disabled = progress.data.coins < GACHA_COST;
  spin.textContent = progress.data.coins < GACHA_COST ? `金幣不足（需要 ${GACHA_COST}）` : `轉一次扭蛋（🪙 ${GACHA_COST}）`;
}
document.getElementById('livGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-liv]');
  if (!b) return;
  progress.select(b.dataset.liv); applyLivery(); refreshCoins();
});
document.getElementById('spinBtn').addEventListener('click', () => {
  sim.audio.init();
  const r = progress.spin();
  if (!r) return;
  const out = document.getElementById('spinOut');
  out.className = 'capsule shake';
  out.innerHTML = '<div class="ball"></div>';
  setTimeout(() => {
    out.className = 'capsule open';
    out.innerHTML = `<div class="prize" style="--c:#${r.got.color.toString(16).padStart(6, '0')}"><i></i><b>${r.got.name}</b>
      <em style="color:${RARITY_COL[r.got.rarity]}">${r.got.rarity}</em><small>${r.dup ? '已擁有，退還 🪙100' : '新塗裝已套用！'}</small></div>`;
    sim.audio.chime();
    if (progress.data.owned.length >= 4) achieve('collector');
    if (r.got.id === 'gold') achieve('ssr');
    applyLivery(); refreshCoins();
  }, 1100);
});
document.querySelectorAll('[data-open="hangar"]').forEach((b) => b.addEventListener('click', () => {
  refreshCoins(); document.getElementById('spinOut').innerHTML = ''; document.getElementById('hangar').classList.remove('hidden');
}));
document.getElementById('hangarClose').addEventListener('click', () => document.getElementById('hangar').classList.add('hidden'));
// 操控方式：拖曳／按鈕
function setCtrl(mode) {
  sim.ctrl = mode;
  progress.data.ctrl = mode; progress.save();
  document.body.classList.toggle('btnmode', mode === 'buttons');
  document.querySelectorAll('[data-ctrl]').forEach((x) => x.classList.toggle('on', x.dataset.ctrl === mode));
}
setCtrl(progress.data.ctrl || 'drag');
document.querySelectorAll('[data-ctrl]').forEach((b) => b.addEventListener('click', () => setCtrl(b.dataset.ctrl)));

// 時段選擇
document.querySelectorAll('[data-tod]').forEach((b) => {
  b.classList.toggle('on', (progress.data.tod || 'day') === b.dataset.tod);
  b.addEventListener('click', () => {
    progress.data.tod = b.dataset.tod; progress.save();
    document.querySelectorAll('[data-tod]').forEach((x) => x.classList.toggle('on', x === b));
    pickTime();
  });
});
refreshCoins();
function showResult() {
  if (shownResult) return;
  shownResult = true;
  sim.timeScale = 1;
  const el = document.getElementById('result');
  const title = el.querySelector('h2'), body = el.querySelector('p');
  document.getElementById('rExtra').innerHTML = '';
  document.getElementById('rStars').innerHTML = '';
  if (sim.casual && !ac.crashed) {
    const vs = Math.round(ac.landed.vs);
    const [bonus, grade] = casual.landingBonus(vs);
    const comfortBonus = Math.round(casual.comfort * 5);
    const total = casual.score + bonus + comfortBonus;
    const stars = casual.stars(vs);
    const coins = casual.coinsGot + Math.floor(total / 200);
    const best = progress.finishFlight(total, coins);
    const dailyBest = sim.daily ? progress.dailyBest(total) : false;
    if (vs > -300) sim.audio.applause(vs > -150 ? 5 : 3);
    achieve('first');
    if (vs > -150) achieve('butter');
    if (casual.bestCombo >= 10) achieve('combo10');
    if (casual.total && casual.hits === casual.total) achieve('allrings');
    if (casual.perfects >= 5) achieve('perfect5');
    if (env.mode === 'night') achieve('night');
    if (env.mode === 'dawn') achieve('dawn');
    if (sim.daily) achieve('daily');
    if (progress.data.flights >= 10) achieve('veteran');
    if (casual.comfort >= 95) achieve('comfort');
    title.textContent = '歡迎來到東京成田！';
    body.innerHTML = `${grade}・乘客滿意 +${comfortBonus}<b>${total.toLocaleString()}</b>`;
    document.getElementById('rStars').innerHTML = `
      <div class="stars">${[1, 2, 3].map((i) => `<span class="${i <= stars ? 'on' : ''}" style="animation-delay:${i * 0.18}s">★</span>`).join('')}</div>`;
    document.getElementById('rExtra').innerHTML = `
      ${sim.daily ? `<div class="badge">📅 今日挑戰${dailyBest ? ' 新紀錄！' : `・今天最佳 ${progress.data.daily.best.toLocaleString()}`}</div>` : best ? '<div class="badge">🏆 新紀錄！</div>' : `<div class="muted">最佳紀錄 ${progress.data.best.toLocaleString()}</div>`}
      <div class="stats">
        <div><b>${casual.hits}/${casual.total}</b><span>圓環</span></div>
        <div><b>${casual.perfects}</b><span>PERFECT</span></div>
        <div><b>×${casual.bestCombo || 0}</b><span>最高連擊</span></div>
        <div><b>${Math.round(casual.comfort)}%</b><span>😊 乘客滿意</span></div>
        <div><b>+${coins}</b><span>🪙 金幣</span></div>
      </div>`;
    lastShare = `${sim.daily ? `📅 今日挑戰（${todayKey()}）` : ''}我開資安航空從桃園飛到東京成田，拿到 ${'★'.repeat(stars)} ${total.toLocaleString()} 分！你也來試試 👉`;
    document.getElementById('shareBtn').classList.remove('hidden');
    refreshCoins();
  } else if (ac.crashed) {
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
  if (!sim.casual || ac.crashed) document.getElementById('shareBtn').classList.add('hidden');
  el.classList.remove('hidden');
}

// ───── 主迴圈 ─────
const clock = new THREE.Clock();
const FIXED = 1 / 120;
let acc = 0;
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
const smoothCam = new THREE.Vector3();
let camInit = false;
let camRoll = 0;

function readControls(dt) {
  const k = (...ks) => ks.some((x) => keys.has(x) || tapped.has(x));
  if (sim.casual) {
    let x = (k('d', 'arrowright') ? 1 : 0) - (k('a', 'arrowleft') ? 1 : 0);
    let y = (k('w', 'arrowup') ? 1 : 0) - (k('s', 'arrowdown') ? 1 : 0);
    const portrait = innerHeight > innerWidth;
    const R = sim.stickR = portrait ? 46 : 60;           // 直式手機：拇指移動距離小，搖桿更靈敏
    if (drag.active) {
      // 浮動搖桿：拇指拖超過範圍時，中心跟著移動，反向操作不用拖回原點
      const dx = drag.x - drag.ox, dy = drag.y - drag.oy;
      if (Math.abs(dx) > R) drag.ox = drag.x - Math.sign(dx) * R;
      if (Math.abs(dy) > R) drag.oy = drag.y - Math.sign(dy) * R;
      const dead = (v) => Math.sign(v) * Math.max(0, (Math.abs(v) - 0.08) / 0.92);
      x += dead((drag.x - drag.ox) / R);
      y += dead(-(drag.y - drag.oy) / R) * (portrait ? 0.8 : 1);   // 往上拖＝爬升
    }
    if (sim.tilt) { x += tilt.x; y += tilt.y; }
    // 瞄準輔助：操控時把飛機拉向圓環；直式手機高度輔助更強，玩家專心左右轉就好
    const steering = drag.active || sim.tilt || x || y;
    if (steering && casual.ring) {
      const r = casual.ring, rel = r.c.clone().sub(ac.pos);
      const lat = rel.x * -r.n.z + rel.z * r.n.x;
      const latV = ac.vel.x * -r.n.z + ac.vel.z * r.n.x;           // 側向速度，用來阻尼避免左右來回晃
      x += Math.max(-0.3, Math.min(0.3, lat / 250 - latV / 45));
      const vk = portrait ? 0.7 : 0.4;
      y += Math.max(-vk, Math.min(vk, rel.y / 70 - ac.vel.y / 30));
    }
    const sm = (cur, tgt) => cur + (Math.max(-1, Math.min(1, tgt)) - cur) * Math.min(1, dt * 10);
    ap.assist.x = sm(ap.assist.x, x);
    ap.assist.y = sm(ap.assist.y, y);
    tapped.clear();
    return;
  }
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
  tapped.clear();
}

function updateCamera(dt) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ac.quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ac.quat);
  const mode = sim.camMode;
  ac.mesh.visible = mode !== 1;
  if (sim.casual && (casual.stage === 'boarding' || casual.stage === 'taxi')) {
    // 登機：從停機坪側面看著乘客走上登機梯
    sim.boardCamT = (sim.boardCamT || 0) + dt;
    const b = boarding;
    // 從步行路線（巴士 → 登機梯 → 機門）的側面拍，整條路線與機門都入鏡
    const mid = b.path[0].clone().lerp(b.path[2], 0.55);
    const L = b.path[1].clone().sub(b.path[0]).setY(0).normalize();
    let P = new THREE.Vector3(-L.z, 0, L.x);
    if (P.dot(mid.clone().sub(ac.pos)) < 0) P.negate();
    const sw = Math.sin(sim.boardCamT * 0.15);
    camera.position.copy(mid).addScaledVector(P, 34).addScaledVector(L, sw * 8).setY(mid.y + 11);
    camera.up.set(0, 1, 0);
    camera.lookAt(mid.x, mid.y + 3, mid.z);
    camInit = false;
  } else if (mode === 0 && sim.casual && casual.stage === 'briefing') {
    // 安全示範時鏡頭緩慢環繞，看看機場、停機坪與起飛的飛機
    sim.briefT = (sim.briefT || 0) + dt;
    // 鏡頭在飛機左後方，背景是右側的航廈與停機坪
    const f = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), rgt = new THREE.Vector3(-f.z, 0, f.x);
    const a = 0.5 + 0.55 * Math.sin(sim.briefT * 0.07);
    const dist = 110;
    camera.position.copy(ac.pos).addScaledVector(rgt, -dist * Math.cos(a)).addScaledVector(f, -dist * Math.sin(a));
    camera.position.y = ac.pos.y + 30;
    camera.up.set(0, 1, 0);
    camera.lookAt(camTarget.copy(ac.pos).addScaledVector(f, 260).addScaledVector(rgt, 200).add(new THREE.Vector3(0, -10, 0)));
    camInit = false;
  } else if (mode === 0) {
    // 追蹤：位於飛機後上方，平滑跟隨航向
    const hdgFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const desired = ac.pos.clone().addScaledVector(hdgFwd, -orbit.dist).add(new THREE.Vector3(0, orbit.dist * 0.18 + 3, 0));
    if (!camInit || sim.resetCam || smoothCam.distanceTo(desired) > 800) { smoothCam.copy(desired); camInit = true; sim.resetCam = false; }
    const ky = sim.casual && sim.timeScale <= 2 ? 1.6 : 4;          // 高度方向跟得慢一點，爬升／下降時飛機會在畫面上移動
    const kk = Math.min(1, dt * 4 * Math.max(1, sim.timeScale));
    const prevY = smoothCam.y;
    smoothCam.lerp(desired, kk);
    smoothCam.y = prevY + (desired.y - prevY) * Math.min(1, dt * ky * Math.max(1, sim.timeScale));
    camera.position.copy(smoothCam);
    camera.up.set(0, 1, 0);
    // 視線略往下，讓飛機位於畫面中上方、不被下方儀表遮住
    camera.lookAt(camTarget.copy(ac.pos).addScaledVector(hdgFwd, orbit.dist * 0.85).add(new THREE.Vector3(0, -orbit.dist * (!sim.casual ? 0.36 : camera.aspect < 1 ? -0.05 : 0.12), 0)));
    // 鏡頭跟著坡度微微傾斜，轉彎更有感
    if (sim.casual) { camRoll += (-ac.attitude().bank * 0.2 - camRoll) * Math.min(1, dt * 3); camera.rotateZ(camRoll); }
    // 直式手機：視線抬高，飛機在畫面下方、前方空間較多
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
  const baseFov = camera.aspect < 1 ? 80 : 65;   // 直式手機視野放寬
  // 速度越快視野越寬，增加衝刺感
  const spd = ac.vel.length();
  const wantFov = baseFov + Math.min(1, Math.max(0, (spd - 50) / 180)) * 7 + (sim.casual && casual.boostT > 0 ? 9 : 0);
  if (mode !== 3) camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 2);
  // 起飛滾行與低空高速時輕微晃動
  if (mode !== 3 && sim.started && !sim.paused && sim.timeScale <= 4) {
    const agl = ac.pos.y - GEAR_H - 2;
    const k = (ac.onGround ? Math.min(1, spd / 70) * 0.12 : agl < 300 ? Math.min(1, spd / 150) * 0.05 : 0) + (sim.casual && casual.turbT > 0 ? 0.45 : 0);
    if (k > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k));
  }
  camera.updateProjectionMatrix();
  // 防止鏡頭鑽入地面
  camera.position.y = Math.max(camera.position.y, 1.5);
  sky.position.copy(camera.position);
  sun.position.copy(camera.position).addScaledVector(env.sunDir, 1000);
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
      if (sim.casual) casual.step(FIXED);
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
      if (agl < 3000 * 0.3048 && casual.stage !== 'takeoff') { sim.timeScale = 4; if (!sim.casual) toast('低高度：時間加速降為 x4'); }
    }
    if (ap.msg) { if (!sim.casual) toast(ap.msg); ap.msg = ''; }
  }
  if (ac.crashed || ac.landed) showResult();
  if (!sim.paused) taoyuan.update(Math.min(0.1, dt * (sim.started ? Math.min(sim.timeScale, 4) : 1)), !sim.started || (sim.casual && ['briefing', 'takeoff'].includes(casual.stage)) || (!sim.casual && ac.onGround && !ac.touchdown));
  if (!sim.paused) traffic.update(Math.min(1, dt * (sim.started ? sim.timeScale : 1)));
  env.update(clock.elapsedTime);
  terrain.update(camera.position, clock.elapsedTime);
  renderer.toneMappingExposure = env.exposure;
  ac.syncMesh();
  updateCamera(dt);
  fx.dim = (env.mode === 'night' ? 0.35 : 1) * (sim.casual && casual.boostT > 0 ? 2.2 : 1);
  fx.update(ac, camera, dt, sim.started && !sim.paused ? dt * sim.timeScale : 0, sim.timeScale);
  renderer.render(scene, camera);
  sim.audio.update(ac.throttle, ac.vel.length(), sim.started && !sim.paused && !ac.crashed && !ac.landed);
  if (sim.casual) casual.drawHUD(hud, camera, drag, dt);
  else { hud.draw(ac, ap, sim); updatePanel(); }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

frame();
