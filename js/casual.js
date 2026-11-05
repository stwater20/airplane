// 輕鬆模式：自動起飛／巡航／降落，玩家只需拖曳讓飛機穿過金色圓環
import * as THREE from 'three';
import { RUNWAY_Y, terrainHeight } from './world.js?v=20261105184350';
import { DESTS } from './geo.js?v=20261105184350';
import { GEAR_H } from './aircraft.js?v=20261105184350';

const D2R = Math.PI / 180, KT = 0.514444, FT = 0.3048;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RINGS = { climb: 8, approach: 8 };   // 手機一局約 4 分鐘
const HIT_R = 85;
// 隨機偏移（左右隨機），讓玩家必須操控才能穿過
const offset = (min, max, rnd = Math.random) => (rnd() < 0.5 ? -1 : 1) * (min + rnd() * (max - min));
// 可重現的亂數（今日挑戰：每天所有人圓環位置相同）
export function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const STAGE_TEXT = {
  boarding: '🧳 乘客登機中',
  briefing: '👩‍✈️ 安全示範中…',
  takeoff: '起飛中…準備！',
  climb: '穿過金色圓環！',
  cruise: '巡航中 ⏩ 欣賞風景',
  approach: '跟著圓環對準跑道',
  done: '降落成功！減速中…',
};

// 英文語音廣播（瀏覽器內建語音）
const CALLOUTS = [1000, 500, 100, 50, 30, 10];
const CALLOUT_TEXT = { 1000: 'One thousand', 500: 'Five hundred', 100: 'One hundred', 50: 'Fifty', 40: 'Forty', 30: 'Thirty', 20: 'Twenty', 10: 'Ten' };

const CS = 'SecTools one two three';
const SPEAKER = {
  tower: ['🗼 塔台 TOWER', '#7fd4ff'],
  atc: ['📡 管制 ATC', '#7fd4ff'],
  pilot: ['✈️ 機師（你）', '#ffc83d'],
  crew: ['👨‍✈️ 副機師', '#b8f5c8'],
  captain: ['🎙️ 機長廣播', '#ffffff'],
  cabin: ['👩‍✈️ 空服員', '#ffb3d1'],
  gpws: ['🔊 自動語音', '#ffb52e'],
  gate: ['🎫 登機門廣播', '#a0e0ff'],
};
// 盡量挑性別合適的英文語音（各裝置可用語音不同）
const FEMALE = /samantha|karen|victoria|zira|susan|moira|tessa|serena|allison|ava|female|google us english/i;
const MALE = /daniel|alex|fred|david|tom|aaron|mark|male|google uk english male/i;
function pickVoice(who, idx) {
  const v = speechSynthesis.getVoices().filter((x) => x.lang.startsWith('en'));
  if (!v.length) return null;
  const want = (who === 'cabin' || who === 'gate') ? FEMALE : (who === 'captain' || who === 'pilot') ? MALE : null;
  const m = want && v.find((x) => want.test(x.name));
  return m || v[idx % v.length];
}

// 起飛前的空服員安全示範（英文＋中文字幕）
const BRIEFING = [
  ['captain', 'This flight experience is made and maintained by sectools dot T W.', '本遊戲由 sectools.tw 製作與維護。'],
  ['cabin', 'Ladies and gentlemen, welcome aboard SecTools Airlines flight one two three to {CITY}. Our flight time today will be {TIME}.',
    '各位旅客您好，歡迎搭乘資安航空 123 號班機前往{ZH}，今天的飛行時間{TIMEZH}。'],
  ['cabin', 'Please take a moment to review the safety features of this aircraft. To fasten your seatbelt, insert the metal tip into the buckle and pull the strap tight. To release, lift the buckle.',
    '請注意本機的安全須知。繫上安全帶時，將金屬扣片插入扣環並拉緊；解開時，掀起扣環即可。'],
  ['cabin', 'In the unlikely event of a loss of cabin pressure, oxygen masks will drop from above. Pull the mask toward you, place it over your nose and mouth, and breathe normally. Secure your own mask before helping others.',
    '若機艙失壓，氧氣面罩會自動落下。請將面罩拉向自己，罩住口鼻並正常呼吸。請先戴好自己的面罩再協助他人。'],
  ['cabin', 'This aircraft has eight emergency exits. Please locate the exit nearest you. Your life vest is under your seat.',
    '本機共有八個緊急出口，請留意離您最近的出口。救生衣位於您的座椅下方。'],
  ['cabin', 'Please make sure your seatbelt is fastened, your seat back is upright, your tray table is stowed, and your window shade is open. Thank you.',
    '請確認安全帶已繫好、椅背豎直、餐桌收妥、遮陽板打開。謝謝您的合作。'],
  ['captain', 'Cabin crew, please be seated for takeoff.', '空服員請就座，準備起飛。'],
];

const VOICE = {
  tower: { voice: 0, rate: 1.15, pitch: 0.85 }, atc: { voice: 0, rate: 1.15, pitch: 0.85 },
  pilot: { voice: 2, rate: 1.1, pitch: 1.05 }, crew: { voice: 2, rate: 1.05, pitch: 1.05 },
  captain: { voice: 1, rate: 0.95, pitch: 1 }, cabin: { voice: 3, rate: 0.95, pitch: 1.1 },
  gpws: { voice: 0, rate: 1.0, pitch: 0.7 },
  gate: { voice: 3, rate: 1.0, pitch: 1.05 },
};

export class Casual {
  constructor(scene, sim, toast) {
    this.scene = scene; this.sim = sim; this.toast = toast;
    this.ringGeo = new THREE.TorusGeometry(60, 4, 8, 40);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffc83d, fog: false });
    this.boostMat = new THREE.MeshBasicMaterial({ color: 0x40c8ff, fog: false });
    this.coinGeo = new THREE.CylinderGeometry(7, 7, 1.6, 20); this.coinGeo.rotateX(Math.PI / 2);
    this.coinMat = new THREE.MeshLambertMaterial({ color: 0xffc83d, emissive: 0x7a4f00 });
    this.coins = [];
    this.reset();
  }

  reset() {
    if (this.ring) this.scene.remove(this.ring.mesh);
    for (const c of this.coins || []) this.scene.remove(c);
    this.coins = [];
    this.rnd = this.daily ? seeded(this.daily) : Math.random;
    this.comfort = 100; this.turbT = 0; this.turbDone = {}; this.steadyOK = false;
    this.combo = 0; this.mult = 1; this.perfects = 0; this.coinsGot = 0; this.boostT = 0; this.bestCombo = 0;
    this.ring = null;
    this.stage = this.short ? 'briefing' : 'boarding';   // 第二次起不再播登機
    this.boardT = 0;
    this.sim.ac.rollRateMax = 0.5;
    this.brief = this.short ? [BRIEFING[0], BRIEFING[1], BRIEFING[BRIEFING.length - 1]] : BRIEFING.slice();
    this.briefBusy = false;
    this.belt = true; this.subZh = '';
    this.score = 0; this.hits = 0; this.total = 0; this.spawned = 0;
    this.flash = 0; this.flashText = '';
    this.said = new Set(); this.subtitle = ''; this.subT = 0;
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  // 只講一次的廣播。who：tower / atc / pilot / crew / captain / cabin / gpws；zh：中文字幕；onDone：講完時呼叫
  get D() { return DESTS[this.sim.ap.dest] || DESTS.NRT; }

  // 把廣播裡的 {CITY}、{TOWER} 等換成目前目的地
  fill(t) {
    const D = this.D;
    const map = { FULL: D.full, FULLZH: D.fullZh, SHORT: D.tower.replace(' Tower', ''), TOWER: D.tower, APP: D.approach, RWY: D.rwy, CITY: D.city, TIME: D.time, TIMEZH: D.timeZh, ZH: D.zh };
    return (t || '').replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m);
  }

  say(id, text, who = 'captain', zh = '', onDone = null) {
    if (this.said.has(id)) return;
    this.said.add(id);
    text = this.fill(text); zh = this.fill(zh);
    const dur = Math.max(4, text.length / 13);
    const show = () => { this.subtitle = text; this.subZh = zh; this.speaker = who; this.subT = dur + 1; };
    let doneCalled = false;
    const done = () => { if (!doneCalled) { doneCalled = true; onDone?.(); } };
    if (!this.sim.voice || !window.speechSynthesis) { show(); if (onDone) setTimeout(done, dur * 1000); return; }
    // 副機師的短呼叫若語音正忙就只顯示字幕，避免延遲到時機之後才唸
    if (who === 'crew' && (speechSynthesis.speaking || speechSynthesis.pending)) { show(); done(); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/ILS/g, 'I L S'));
    u.lang = 'en-US';
    const style = VOICE[who] || VOICE.captain;
    const voice = pickVoice(who, style.voice);
    if (voice) u.voice = voice;
    u.rate = style.rate; u.pitch = style.pitch;
    u.onstart = () => { show(); if (onDone) setTimeout(done, (dur + 4) * 1000); };   // 字幕跟著語音出現；onend 偶爾不觸發時的保險
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  }

  setBelt(on) {
    if (this.belt === on) return;
    this.belt = on;
    this.sim.audio?.chime();
  }

  // 登機完成：淡出、滑行到跑道（直接切換），開始安全示範
  endBoarding() {
    if (this.stage !== 'boarding') return;
    this.stage = 'taxi';
    const go = () => {
      this.sim.boarding?.stop();
      const rw = this.sim.boarding?.rw || this.sim.runways.find((r) => r.id.startsWith('05R'));
      this.sim.ac.placeOnRunway(rw, -1);
      this.sim.resetCam = true; this.sim.briefT = 0;
      this.setStage('briefing', '登機完成，滑行到跑道 05R');
    };
    if (this.sim.fade) this.sim.fade(go); else go();
  }

  // 跳過安全示範
  skipBriefing() {
    if (this.stage === 'boarding') {
      if (window.speechSynthesis) speechSynthesis.cancel();
      this.endBoarding(); return;
    }
    if (this.stage !== 'briefing') return;
    if (window.speechSynthesis) speechSynthesis.cancel();
    this.brief = []; this.briefBusy = false;
    this.startTakeoff();
  }

  startTakeoff() {
    this.setStage('takeoff', '自動起飛中…離地後拖曳畫面操控！');
  }

  get ac() { return this.sim.ac; }
  get ap() { return this.sim.ap; }

  setStage(s, msg) {
    this.stage = s; this.spawned = 0;
    if (msg) this.toast(msg);
    document.body.dataset.stage = s;
  }

  step(dt) {
    const { ac, ap } = this;
    const att = ac.attitude();
    const agl = ac.pos.y - GEAR_H - RUNWAY_Y;
    const ias = ac.ias / KT;
    if (ac.touchdown) {
      if (this.stage !== 'done') {
        this.setStage('done');
        this.say('gnd', `${CS}, welcome to {SHORT}. Vacate at the next taxiway and contact Ground on one two one decimal eight five.`, 'tower');
        this.say('gndrb', `Next taxiway, Ground one two one decimal eight five, ${CS}. Thank you.`, 'pilot');
        const tokyo = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' });
        this.say('wel', `Ladies and gentlemen, welcome to {FULL}. The local time is ${tokyo}. Please remain seated with your seatbelt fastened until the captain turns off the seatbelt sign. Thank you for flying SecTools Airlines.`, 'cabin',
          `各位旅客，歡迎來到{FULLZH}，當地時間 ${new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' })}。在安全帶指示燈熄滅前請留在座位上，感謝您搭乘資安航空。`);
      }
      return;
    }

    if (this.stage === 'boarding') {
      const b = this.sim.boarding;
      if (!b) { this.endBoarding(); return; }
      ac.brakes = true; ac.throttle = 0;
      this.sim.timeScale = 1;
      if (this.boardT === 0) {
        b.start(ac);
        this.say('gate', 'Good afternoon, ladies and gentlemen. SecTools Airlines flight one two three to {CITY} is now boarding. Please have your boarding pass and passport ready.', 'gate',
          '各位旅客午安，資安航空 123 號班機飛往{ZH}，現在開始登機，請準備好登機證與護照。');
        this.say('seat', 'Welcome aboard. Please find your seat and place your carry-on bags in the overhead bins.', 'cabin', '歡迎登機，請找到您的座位，並將隨身行李放入上方置物櫃。');
      }
      this.boardT += dt;
      b.update(dt);
      const dur = this.short ? 9 : 16;
      this.boarded = Math.min(b.total, Math.round(b.total * this.boardT / dur));
      if (this.boardT > dur + 1) this.endBoarding();
      return;
    }

    if (this.stage === 'briefing') {
      ac.brakes = true; ac.throttle = 0;
      this.sim.timeScale = 1;
      if (!this.briefBusy) {
        const line = this.brief.shift();
        if (!line) { this.startTakeoff(); return; }
        this.briefBusy = true;
        const [who, text, zh] = line;
        this.say('brief' + this.brief.length, text, who, zh, () => { this.briefBusy = false; });
      }
      return;
    }

    if (this.stage === 'takeoff') {
      this.say('clr', `${CS}, Taipei Tower, runway zero five right, wind calm, cleared for takeoff.`, 'tower');
      this.say('clrrb', `Cleared for takeoff, runway zero five right, ${CS}.`, 'pilot');
      if (this.sim.timeScale < 3) this.sim.timeScale = 3;   // 縮短起飛時間
      if (ias > 80) this.say('80', 'Eighty knots.', 'crew');
      if (ias > 135) this.say('v1', 'V one.', 'crew');
      if (ias > 145) this.say('vr', 'Rotate.', 'crew');
      if (!ac.onGround && ac.vel.y > 2) this.say('pos', 'Positive rate. Gear up.', 'crew');
      ac.brakes = false; ac.spoilers = false;
      ac.throttle = Math.min(1, ac.throttle + dt * 0.4);
      ac.input.roll = clamp(-att.bank * 2, -1, 1); ac.input.yaw = 0;
      if (ac.onGround) ac.input.pitch = ias > 145 ? clamp((9 * D2R - att.pitch) * 5, 0, 1) : 0;
      else if (agl < 15) ac.input.pitch = clamp((9 * D2R - att.pitch) * 5, -0.5, 1);
      else ac.input.pitch = 0;
      if (!ac.onGround && agl > 12 && ac.vel.y > 1 && ac.gearDown) ac.gearDown = false;
      if (agl > 35) {
        Object.assign(ap, { ap: true, athr: true, lat: 'NAV', vert: 'ALT', alt: 9000, spd: 250 });
        this.sim.timeScale = 1;
        this.say('dep', `${CS}, Taipei Departure, radar contact. Climb and maintain flight level three five zero.`, 'atc');
        this.say('deprb', `Climb and maintain flight level three five zero, ${CS}.`, 'pilot');
        this.setStage('climb', '起飛成功！拖曳讓飛機穿過金色圓環');
      }
      return;
    }

    if (['climb', 'cruise', 'approach'].includes(this.stage)) this.passengers(dt, att);

    if (this.stage === 'climb') {
      ap.assistGain = clamp((agl - 20) / 50, 0, 1);
      // 地形保護：前方 20 秒內的山比飛機低不到 400m 時，忽略玩家輸入並拉高
      const ahead = ac.pos.clone().addScaledVector(ac.vel, 20);
      if (terrainHeight(ahead.x, ahead.z) > ac.pos.y - 400) { ap.assistGain = 0; ap.alt = Math.max(ap.alt, Math.ceil((terrainHeight(ahead.x, ahead.z) + 800) / FT / 1000) * 1000); }
      if (ias > 185 && ac.flaps > 1) ac.flaps = 1;
      if (ias > 210) ac.flaps = 0;
      this.rings();
      this.updateCoins(dt);
      if (this.spawned === 4) this.startTurbulence('climb', 7);
      if (!this.ring && this.spawned >= RINGS.climb) {
        Object.assign(ap, { alt: 35000, spd: 290 });
        this.sim.timeScale = 64;
        this.setStage('cruise', '巡航中…可按「跳到降落」');
        this.setBelt(false);
        this.say('belt', 'Ladies and gentlemen, the captain has turned off the seatbelt sign. You may now move about the cabin. We will shortly begin our meal service.', 'cabin',
          '各位旅客，機長已關閉安全帶指示燈，您可以在客艙內走動。我們即將開始供應餐點。');
        this.say('crz', 'Ladies and gentlemen, this is your captain speaking. We are climbing to our cruising altitude of thirty five thousand feet. Flight time to {CITY} is {TIME}. Sit back, relax, and enjoy the flight.', 'captain',
          '各位旅客，我是機長。我們正爬升至三萬五千呎的巡航高度，到{ZH}{TIMEZH}，請放鬆享受這趟旅程。');
      }
    } else if (this.stage === 'cruise') {
      ap.assistGain = 1;
      this.cruiseT = (this.cruiseT || 0) + dt / Math.max(1, this.sim.timeScale);
      if (this.cruiseT > 28) { this.cruiseT = 0; this.toApproach(); return; }   // 巡航自動快轉，避免一局太久
      const dest = ap.route[ap.route.length - 1];
      // 沿途觀光廣播（以通過的航路點判斷）
      if (ap.wp >= 3) this.say('meal', 'Ladies and gentlemen, we will now be serving dinner. Today we have chicken with rice, or beef noodles. Please let us know if you need anything.', 'cabin',
        '各位旅客，我們現在開始供應晚餐，今天有雞肉飯和牛肉麵，有任何需要請告訴我們。');
      if (ap.wp >= 4) if (ap.dest === 'NRT') this.say('oki', 'Ladies and gentlemen, if you look out the left side of the aircraft, you can see the islands of Okinawa below us.', 'captain',
        '各位旅客，從飛機左側窗外可以看到下方的沖繩群島。');
      if (ap.wp >= 5) {
        this.setBelt(true);
        this.say('turb', 'Ladies and gentlemen, the captain has turned on the seatbelt sign. We are expecting some light turbulence. Please return to your seats and fasten your seatbelts.', 'cabin',
          '各位旅客，機長已開啟安全帶指示燈，前方可能有輕微亂流，請回座位並繫好安全帶。');
      }
      if (ap.wp >= 6) {
        if (ap.dest === 'NRT') this.say('yak', 'On the left, you may see Yakushima island and the southern coast of Kyushu.', 'captain', '左側可以看到屋久島與九州南部海岸。');
        this.say('smooth', 'We are through the turbulence. The seatbelt sign is now off.', 'captain', '我們已通過亂流區，安全帶指示燈已關閉。', () => this.setBelt(false));
      }
      if (ap.wp >= 7) this.say('duty', 'Ladies and gentlemen, our duty free service will begin shortly. Please refer to the catalog in your seat pocket.', 'cabin',
        '各位旅客，機上免稅品販售即將開始，請參考座椅前方口袋中的目錄。');
      if (ap.wp >= 7) this.say('sec', 'Ladies and gentlemen, for in-flight entertainment, please try the SecTools Airlines capsule toy game at gacha dash sho dot sectools dot T W. Thank you for flying SecTools Airlines.', 'cabin',
        '各位旅客，機上娛樂推薦「資安航空扭蛋」gacha-sho.sectools.tw，降落後歡迎去轉一顆！感謝您搭乘資安航空。');
      if (ap.wp >= 8) if (ap.dest === 'NRT') this.say('kii', 'We are now passing the Kii Peninsula. The city of Osaka is off to our left. About thirty minutes to landing.', 'captain',
        '我們正飛越紀伊半島，大阪在左側，大約三十分鐘後降落。');
      if (Math.hypot(dest.x - ac.pos.x, dest.z - ac.pos.z) < 70 * 1852) this.toApproach();
    } else if (this.stage === 'approach') {
      ap.assistGain = clamp((agl - 120) / 180, 0, 1);   // 120m 以下交給自動駕駛對正跑道
      this.sim.timeScale = agl > 120 ? 1.6 : 1;   // 進場稍微加快，短五邊恢復正常速度
      const il = ap.ilsData(ac);
      if (il.dist < 7 * 1852) ac.flaps = 4;
      if (this.spawned === 2) this.startTurbulence('app', 5);
      if (il.dist < 9 * 1852) if (ap.dest === 'NRT') this.say('fuji', 'Ladies and gentlemen, on a clear day you can see Mount Fuji out the left windows.', 'captain', '天氣晴朗時，從左側窗外可以看到富士山。');
      if (il.dist < 7.5 * 1852) this.say('ccl', 'Cabin crew, please take your seats for landing.', 'captain', '空服員請就座，準備降落。');
      if (il.dist < 6 * 1852) {
        this.say('land', `${CS}, {TOWER}, runway {RWY}, wind three four zero at eight knots, cleared to land.`, 'tower');
        this.say('landrb', `Cleared to land, runway {RWY}, ${CS}.`, 'pilot');
      }
      const raFt = agl / FT;
      for (const c of CALLOUTS) if (raFt < c && this.prevRa >= c) this.say('ra' + c, CALLOUT_TEXT[c], 'gpws');
      if (raFt < 220 && this.prevRa >= 220) this.say('min', 'Minimums.', 'gpws');
      this.prevRa = raFt;
      this.rings();
      this.updateCoins(dt);
    }
  }

  // 跳到指定階段：takeoff / climb / cruise / approach
  jumpTo(stage) {
    const { ac, ap } = this;
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (this.ring) { this.scene.remove(this.ring.mesh); this.ring = null; }
    for (const c of this.coins) this.scene.remove(c);
    this.coins = []; this.turbT = 0;
    this.sim.boarding?.stop();
    if (stage === 'approach') { this.toApproach(); return; }
    const rw = this.sim.runways.find((r) => r.airport === 'TPE' && r.id.startsWith('05R'));
    if (stage === 'takeoff') {
      ac.placeOnRunway(rw, -1);
      Object.assign(ap, { ap: false, athr: false, lat: 'HDG', vert: 'ALT', appArmed: false, wp: 1 });
      this.sim.timeScale = 1; this.sim.resetCam = true;
      this.setStage('takeoff', '跳到起飛');
      return;
    }
    const R = ap.route;
    const i = stage === 'climb' ? 0 : Math.floor(R.length / 2) - 1;
    const a = R[i], b = R[i + 1];
    const n = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const p = new THREE.Vector3(a.x, 0, a.z).addScaledVector(n, stage === 'climb' ? 6000 : 0);
    const alt = stage === 'climb' ? 700 : 10668, spd = stage === 'climb' ? 150 : 230;
    const hdg = Math.atan2(n.x, -n.z);
    ac.onGround = false; ac.touchdown = null; ac.landed = null; ac.crashed = false;
    ac.pos.set(p.x, alt + GEAR_H, p.z);
    ac.quat.setFromEuler(new THREE.Euler(0.03, -hdg, 0, 'YXZ'));
    ac.vel.copy(n).multiplyScalar(spd); ac.omega.set(0, 0, 0);
    Object.assign(ac, { throttle: 0.7, flaps: 0, flapPos: 0, gearDown: false, gearPos: 0, brakes: false, spoilers: false });
    Object.assign(ap, { ap: true, athr: true, lat: 'NAV', vert: 'ALT', appArmed: false, wp: i + 1, alt: stage === 'climb' ? 9000 : 35000, spd: stage === 'climb' ? 250 : 290 });
    this.sim.resetCam = true;
    this.cruiseT = 0;
    this.sim.timeScale = stage === 'cruise' ? 64 : 1;
    this.setBelt(stage === 'climb');
    this.setStage(stage, stage === 'climb' ? '跳到爬升：穿過金色圓環！' : '跳到巡航');
  }

  // 傳送到目的地 ILS 跑道五邊 8 浬處
  toApproach() {
    const { ac, ap } = this;
    if (this.ring) { this.scene.remove(this.ring.mesh); this.ring = null; }
    for (const c of this.coins) this.scene.remove(c);
    this.coins = [];
    const r = ap.ilsRunway();
    const d = 8 * 1852;
    const thrX = r.cx - r.dirX * r.halfLen, thrZ = r.cz - r.dirZ * r.halfLen;
    // 落地柔和程度：一點隨機（當天風況）＋乘客滿意度越高越容易奶油落地
    ac.groundEffect = 0.44 + Math.random() * 0.09 + 0.05 * (this.comfort / 100);
    ac.onGround = false; ac.touchdown = null; ac.landed = null; ac.crashed = false;
    ac.pos.set(thrX - r.dirX * d, RUNWAY_Y + 15 + d * Math.tan(3 * D2R) + GEAR_H, thrZ - r.dirZ * d);
    ac.quat.setFromEuler(new THREE.Euler(0.04, -r.heading * D2R, 0, 'YXZ'));
    ac.vel.set(r.dirX, 0, r.dirZ).multiplyScalar(80);
    ac.vel.y = -80 * Math.tan(3 * D2R);
    ac.omega.set(0, 0, 0);
    Object.assign(ac, { throttle: 0.35, flaps: 3, flapPos: 3, gearDown: true, gearPos: 1, spoilers: false, brakes: false });
    Object.assign(ap, { ap: true, athr: true, lat: 'LOC', vert: 'GS', appArmed: true, spd: 150, wp: ap.route.length - 1 });
    this.sim.timeScale = 1;
    this.sim.resetCam = true;
    if (window.speechSynthesis) speechSynthesis.cancel();
    for (const k of ['oki', 'yak', 'kii', 'belt', 'crz', 'meal', 'turb', 'smooth', 'duty', 'sec']) this.said.add(k);
    this.setBelt(true);
    this.prevRa = 99999; this.cruiseT = 0;
    this.setStage('approach', `抵達${this.D.zh}！跟著圓環降落`);
    this.say('app', `${CS}, {APP}. Cleared ILS runway {RWY} approach.`, 'atc');
    this.say('apprb', `Cleared ILS {RWY}, ${CS}.`, 'pilot');
    this.say('des', 'Ladies and gentlemen, this is your captain. We have started our approach into {CITY}. Cabin crew, prepare for landing.', 'captain',
      '各位旅客，我是機長，我們已開始進場{ZH}。空服員請準備降落。');
    if (!this.short) this.say('prep', 'Ladies and gentlemen, please return to your seat and fasten your seatbelt. Make sure your seat back is upright, your tray table is stowed, and your window shade is open. Thank you.', 'cabin',
      '各位旅客，請回到座位繫好安全帶，豎直椅背、收好餐桌並打開遮陽板，謝謝。');
  }

  rings() {
    if (!this.ring && this.spawned < RINGS[this.stage]) this.spawn();
    const r = this.ring;
    if (!r) return;
    const rel = this.ac.pos.clone().sub(r.c);
    const s = rel.dot(r.n);
    if (r.prevS < 0 && s >= 0) {
      const off = rel.addScaledVector(r.n, -s).length();
      this.resolve(off < HIT_R, off);
    } else if (rel.length() > 6000) this.resolve(false);
    else r.prevS = s;
  }

  // 乘客滿意度（參考 Airline Commander）：大 G 值、大坡度、劇烈滾轉會讓乘客不舒服；平穩飛行慢慢恢復
  passengers(dt, att) {
    const ac = this.ac;
    if (this.stage === 'cruise') dt = Math.min(dt, 1 / 60);   // 快轉時不要放大扣分
    const g = Math.abs(ac.gLoad - 1), bank = Math.abs(att.bank), rr = Math.abs(ac.omega.z);
    let hurt = Math.max(0, g - 0.3) * 30 + Math.max(0, bank - 0.55) * 25 + Math.max(0, rr - 0.3) * 18;
    // 亂流：飛機顛簸，玩家若在亂流中大動作操控會更不舒服
    if (this.turbT > 0) {
      this.turbT -= dt;
      ac.omega.x += (Math.random() - 0.5) * 0.9 * dt * 60 * 0.004;
      ac.omega.z += (Math.random() - 0.5) * 1.4 * dt * 60 * 0.004;
      ac.vel.y += (Math.random() - 0.5) * 3.2 * dt * 60 * 0.05;
      const busy = Math.abs(this.ap.assist.x) + Math.abs(this.ap.assist.y);
      if (busy > 0.6) { hurt += 6; this.steadyOK = false; }
      if (this.turbT <= 0) {
        this.setBelt(false);
        if (this.steadyOK) { this.score += 200; this.flashText = '穩住了！+200'; this.flashCol = '#30d158'; this.flash = 1; }
      }
    }
    this.comfort = Math.max(0, Math.min(100, this.comfort - hurt * dt + (hurt < 0.1 ? 0.6 * dt : 0)));
  }

  startTurbulence(id, sec) {
    if (this.turbDone[id]) return;
    this.turbDone[id] = true;
    this.turbT = sec; this.steadyOK = true;
    this.setBelt(true);
    this.say('turbx' + id, 'Ladies and gentlemen, we are passing through some turbulence. Please remain seated with your seatbelt fastened.', 'captain',
      '各位旅客，我們正通過亂流區，請留在座位上並繫好安全帶。');
    this.toast('🌪️ 亂流！穩住別亂動，乘客會更安心');
  }

  // 金幣：每幀檢查是否吃到、旋轉動畫
  updateCoins(dt) {
    if (this.boostT > 0) this.boostT -= dt;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.rotation.y += dt * 4;
      if (c.position.distanceTo(this.ac.pos) < 32) {
        this.scene.remove(c); this.coins.splice(i, 1);
        this.coinsGot++; this.score += 10 * (this.boostT > 0 ? 2 : 1);
        this.sim.audio?.coin();
      }
    }
  }

  spawn() {
    const { ac, ap } = this;
    let c, n;
    if (this.stage === 'climb') {
      const w = ap.route[ap.wp];
      const brg = Math.atan2(w.x - ac.pos.x, -(w.z - ac.pos.z));
      n = new THREE.Vector3(Math.sin(brg), 0, -Math.cos(brg));
      const D = 1600, V = Math.max(60, ac.vel.length());
      const side = new THREE.Vector3(-n.z, 0, n.x);
      c = ac.pos.clone().addScaledVector(n, D).addScaledVector(side, offset(70, 150, this.rnd));
      c.y = Math.max(250, Math.min(ac.pos.y + ac.vel.y * D / V, ap.alt * FT + GEAR_H) + offset(0, 45, this.rnd));
    } else {
      const il = ap.ilsData(this.ac);
      const r = il.r;
      const d = il.dist - 1500;
      if (d < 600) { this.spawned = RINGS.approach; return; }
      n = new THREE.Vector3(r.dirX, 0, r.dirZ);
      const side = new THREE.Vector3(-n.z, 0, n.x);
      const k = clamp((d - 1500) / 8000, 0, 1);
      c = new THREE.Vector3(r.cx - r.dirX * (r.halfLen + d), 0, r.cz - r.dirZ * (r.halfLen + d));
      c.addScaledVector(side, offset(60, 140, this.rnd) * k);
      c.y = RUNWAY_Y + 15 + d * Math.tan(3 * D2R) + GEAR_H + offset(0, 35, this.rnd) * k;
    }
    const boost = this.total % 4 === 3;          // 每四個一個藍色加速環
    const mesh = new THREE.Mesh(this.ringGeo, boost ? this.boostMat : this.ringMat);
    mesh.position.copy(c);
    mesh.lookAt(c.clone().add(n));
    this.scene.add(mesh);
    this.ring = { c, n, mesh, boost, prevS: this.ac.pos.clone().sub(c).dot(n) };
    // 金幣軌跡：從前方一路引導到圓環中心
    const start = ac.pos.clone().lerp(c, 0.35);
    for (let k = 0; k < 7; k++) {
      const f = (k + 1) / 8;
      const coin = new THREE.Mesh(this.coinGeo, this.coinMat);
      coin.position.copy(start).lerp(c, f);
      coin.rotation.y = Math.atan2(n.x, n.z);
      this.scene.add(coin);
      this.coins.push(coin);
    }
    this.spawned++; this.total++;
  }

  // 命中：連擊倍率（最高 ×5）、PERFECT（穿過中心）、加速環
  resolve(hit, off = 999) {
    const wasBoost = this.ring.boost;
    this.scene.remove(this.ring.mesh);
    this.ring = null;
    for (const c of this.coins) this.scene.remove(c);
    this.coins = [];
    if (hit) {
      this.hits++; this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.mult = Math.min(5, this.combo);
      const perfect = off < 30;
      if (perfect) this.perfects++;
      let pts = 100 * this.mult + (perfect ? 100 : 0);
      if (this.boostT > 0) pts *= 2;
      this.score += pts;
      if (wasBoost) { this.boostT = 5; this.sim.audio?.boost(); }
      this.flashText = `${perfect ? 'PERFECT ' : ''}+${pts}${this.mult > 1 ? `  ×${this.mult}` : ''}`;
      this.flashCol = perfect ? '#64d2ff' : '#ffd60a';
      try { navigator.vibrate?.(perfect ? [30, 40, 30] : 40); } catch { /* 不支援 */ }
      this.sim.audio?.ding(this.mult);
    } else {
      this.combo = 0; this.mult = 1;
      this.flashText = '錯過';
      this.flashCol = '#ff6b6b';
    }
    this.flash = 1;
  }

  stars(vs) {
    const ratio = this.total ? this.hits / this.total : 0;
    return 1 + (ratio >= 0.5 ? 1 : 0) + (ratio >= 0.8 && vs > -350 ? 1 : 0);
  }

  landingBonus(vs) {
    if (vs > -200) return [500, '奶油般完美的落地！'];
    if (vs > -400) return [300, '漂亮的落地'];
    return [100, '有點重，但安全落地'];
  }

  drawHUD(hud, camera, stick, dt) {
    const g = hud.g, W = hud.w, H = hud.h;
    const { ac, ap } = this;
    g.setTransform(hud.dpr, 0, 0, hud.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const small = W < 600, short = H < 500;
    const font = (px, w = 'bold') => `${w} ${px}px ui-rounded, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;

    // 圓環指示
    if (this.ring) {
      const p = this.ring.c.clone().project(camera);
      const behind = p.z > 1;
      let x = (p.x + 1) / 2 * W, y = (1 - p.y) / 2 * H;
      if (behind) { x = W - x; y = H - y; }
      const m = 40;
      const dist = camera.position.distanceTo(this.ring.c);
      if (!behind && x > m && x < W - m && y > m && y < H - m) {
        const rad = Math.max(16, 60 / (dist * Math.tan(camera.fov * D2R / 2)) * H / 2);
        g.strokeStyle = 'rgba(255,200,61,0.9)'; g.lineWidth = 3;
        g.setLineDash([8, 6]); g.beginPath(); g.arc(x, y, rad + 8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      } else {
        const cx = W / 2, cy = H / 2;
        const ang = Math.atan2(y - cy, x - cx);
        const ex = cx + Math.cos(ang) * (W / 2 - m), ey = cy + Math.sin(ang) * (H / 2 - m);
        g.save(); g.translate(clamp(ex, m, W - m), clamp(ey, m + 60, H - m)); g.rotate(ang);
        g.fillStyle = '#ffc83d'; g.beginPath(); g.moveTo(18, 0); g.lineTo(-10, -13); g.lineTo(-10, 13); g.fill();
        g.restore();
      }
    }

    // 上方資訊（HTML 玻璃面板）
    const alt = Math.max(0, Math.round(ac.pos.y - GEAR_H - RUNWAY_Y));   // 公尺
    const kmh = Math.round(Math.hypot(ac.vel.x, ac.vel.y, ac.vel.z) * 3.6);
    setText('hPts', String(this.score));
    setText('hRings', `${this.combo > 1 ? `🔥×${this.mult} · ` : ''}圓環 ${this.hits}/${this.total} · 🪙${this.coinsGot}`);
    setText('hKmh', String(kmh));
    setText('hAlt', `高度 ${alt.toLocaleString()} 公尺${this.sim.timeScale > 1 ? ` · ${this.sim.timeScale}×` : ''}`);
    const stageLabel = this.boostT > 0 ? `⚡ 加速中 雙倍分數 ${Math.ceil(this.boostT)}`
      : this.stage === 'boarding' ? `🧳 登機中 ${this.boarded || 0} / 180` : (STAGE_TEXT[this.stage] || '');
    if (setText('hStage', stageLabel)) {
      const el = $('hStage'); el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 350);
    }
    $('hBelt').classList.toggle('on', this.belt);
    const cf = Math.round(this.comfort);
    if (setText('hComfort', `${cf >= 80 ? '😊' : cf >= 50 ? '😐' : '😣'} 乘客 ${cf}%`)) $('hComfortWrap').classList.toggle('bad', cf < 50);
    $('hComfortWrap').classList.toggle('turb', this.turbT > 0);
    g.textAlign = 'center';

    // 命中提示
    if (this.flash > 0) {
      this.flash -= dt * 1.2;
      g.globalAlpha = Math.max(0, this.flash);
      g.font = font(small ? 34 : 44);
      g.fillStyle = this.flashCol || '#ffd60a';
      g.fillText(this.flashText, W / 2, H * 0.35 - (1 - this.flash) * 40);
      g.globalAlpha = 1;
    }

    // 操作提示
    if ((this.stage === 'climb' || this.stage === 'approach') && !stick.active && this.total <= 1 && this.sim.ctrl !== 'buttons') {
      g.font = font(15, 'normal'); g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(small ? '👆 按住拖曳操控' : '👆 按住螢幕拖曳：左右轉彎、上下爬升／下降', W / 2, H - (small ? 278 : 120) - safeBottom());
    }

    // 廣播字幕（標示說話者＋中文翻譯）
    if (this.subT > 0) this.subT -= dt;
    const showSub = this.subT > 0 && !!this.subtitle;
    // 字幕放在上方資訊列（含安全帶圖示）下方，依實際高度自動調整，避免擋住
    this.layoutT = (this.layoutT || 0) - dt;
    if (this.layoutT <= 0) {
      this.layoutT = 0.5;
      const b = $('chud').getBoundingClientRect().bottom;
      if (b > 0) $('hSub').style.top = `${Math.round(b + 8)}px`;
    }
    $('hSub').classList.toggle('show', showSub);
    if (showSub) {
      const [name, col] = SPEAKER[this.speaker] || SPEAKER.captain;
      if (setText('hWho', name)) $('hWho').style.color = col;
      setText('hEn', this.subtitle);
      setText('hZh', this.subZh || '');
    }

    // 航程進度
    {
      const r0 = ap.route[0], r1 = ap.route[ap.route.length - 1];
      const total = Math.hypot(r1.x - r0.x, r1.z - r0.z);
      const left = Math.hypot(r1.x - ac.pos.x, r1.z - ac.pos.z);
      const f = (clamp(1 - left / total, 0, 1) * 100).toFixed(1) + '%';
      $('hFill').style.width = f; $('hPlane').style.left = f;
      setText('hLeft', `${this.D.code} ${Math.round(left / 1000)} km`);
    }

    // 搖桿位置提示（未觸控時）
    if (!stick.active && (this.stage === 'climb' || this.stage === 'approach') && W < 600 && this.sim.ctrl !== 'buttons') {
      const gx = W / 2, gy = H - 215 - safeBottom();
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
      g.beginPath(); g.arc(gx, gy, 46, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(gx, gy, 18, 0, Math.PI * 2); g.fill();
    }

    // 虛擬搖桿
    const R = this.sim.stickR || 60;
    if (stick.active) {
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
      g.beginPath(); g.arc(stick.ox, stick.oy, R, 0, Math.PI * 2); g.stroke();
      const dx = clamp(stick.x - stick.ox, -R, R), dy = clamp(stick.y - stick.oy, -R, R);
      g.fillStyle = 'rgba(79,227,255,0.55)';
      g.beginPath(); g.arc(stick.ox + dx, stick.oy + dy, 26, 0, Math.PI * 2); g.fill();
    }

    if (W >= 600 && !short && this.sim.started) hud.map(g, ac, ap, 1, true);
  }
}

function wrap(g, text, maxW) {
  const out = []; let line = '';
  for (const w of text.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// 讀取瀏覽器安全區域（瀏海、Home 指示條）
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;top:0;left:0;height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
document.body.appendChild(probe);
function safeTop() { return parseFloat(getComputedStyle(probe).paddingTop) || 0; }
function safeBottom() { return parseFloat(getComputedStyle(probe).paddingBottom) || 0; }

function wrapCJK(g, text, maxW) {
  const out = []; let line = '';
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

const $ = (id) => document.getElementById(id);
// 只在內容改變時更新 DOM，回傳是否有變
function setText(id, t) {
  const el = $(id);
  if (!el || el.textContent === t) return false;
  el.textContent = t;
  return true;
}
