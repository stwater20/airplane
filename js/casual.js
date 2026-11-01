// 輕鬆模式：自動起飛／巡航／降落，玩家只需拖曳讓飛機穿過金色圓環
import * as THREE from 'three';
import { RUNWAY_Y } from './world.js?v=20261101183315';
import { GEAR_H } from './aircraft.js?v=20261101183315';

const D2R = Math.PI / 180, KT = 0.514444, FT = 0.3048;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RINGS = { climb: 10, approach: 10 };
const HIT_R = 85;
// 隨機偏移（左右隨機），讓玩家必須操控才能穿過
const offset = (min, max) => (Math.random() < 0.5 ? -1 : 1) * (min + Math.random() * (max - min));

const STAGE_TEXT = {
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
};
// 盡量挑性別合適的英文語音（各裝置可用語音不同）
const FEMALE = /samantha|karen|victoria|zira|susan|moira|tessa|serena|allison|ava|female|google us english/i;
const MALE = /daniel|alex|fred|david|tom|aaron|mark|male|google uk english male/i;
function pickVoice(who, idx) {
  const v = speechSynthesis.getVoices().filter((x) => x.lang.startsWith('en'));
  if (!v.length) return null;
  const want = who === 'cabin' ? FEMALE : (who === 'captain' || who === 'pilot') ? MALE : null;
  const m = want && v.find((x) => want.test(x.name));
  return m || v[idx % v.length];
}

// 起飛前的空服員安全示範（英文＋中文字幕）
const BRIEFING = [
  ['captain', 'This flight experience is made and maintained by sectools dot T W.', '本遊戲由 sectools.tw 製作與維護。'],
  ['cabin', 'Ladies and gentlemen, welcome aboard SecTools Airlines flight one two three to Tokyo Narita. Our flight time today will be about three hours.',
    '各位旅客您好，歡迎搭乘資安航空 123 號班機前往東京成田，今天的飛行時間約三小時。'],
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
};

export class Casual {
  constructor(scene, sim, toast) {
    this.scene = scene; this.sim = sim; this.toast = toast;
    this.ringGeo = new THREE.TorusGeometry(60, 4, 8, 40);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffc83d, fog: false });
    this.reset();
  }

  reset() {
    if (this.ring) this.scene.remove(this.ring.mesh);
    this.ring = null;
    this.stage = 'briefing';
    this.sim.ac.rollRateMax = 0.5;
    this.brief = BRIEFING.slice(); this.briefBusy = false;
    this.belt = true; this.subZh = '';
    this.score = 0; this.hits = 0; this.total = 0; this.spawned = 0;
    this.flash = 0; this.flashText = '';
    this.said = new Set(); this.subtitle = ''; this.subT = 0;
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  // 只講一次的廣播。who：tower / atc / pilot / crew / captain / cabin / gpws；zh：中文字幕；onDone：講完時呼叫
  say(id, text, who = 'captain', zh = '', onDone = null) {
    if (this.said.has(id)) return;
    this.said.add(id);
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

  // 跳過安全示範
  skipBriefing() {
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
        this.say('gnd', `${CS}, welcome to Narita. Vacate at the next taxiway and contact Ground on one two one decimal eight five.`, 'tower');
        this.say('gndrb', `Next taxiway, Ground one two one decimal eight five, ${CS}. Thank you.`, 'pilot');
        const tokyo = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' });
        this.say('wel', `Ladies and gentlemen, welcome to Tokyo Narita International Airport. The local time is ${tokyo}. Please remain seated with your seatbelt fastened until the captain turns off the seatbelt sign. Thank you for flying SecTools Airlines.`, 'cabin',
          `各位旅客，歡迎來到東京成田國際機場，當地時間 ${new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' })}。在安全帶指示燈熄滅前請留在座位上，感謝您搭乘資安航空。`);
      }
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

    if (this.stage === 'climb') {
      ap.assistGain = clamp((agl - 20) / 50, 0, 1);
      if (ias > 185 && ac.flaps > 1) ac.flaps = 1;
      if (ias > 210) ac.flaps = 0;
      this.rings();
      if (!this.ring && this.spawned >= RINGS.climb) {
        Object.assign(ap, { alt: 35000, spd: 290 });
        this.sim.timeScale = 64;
        this.setStage('cruise', '巡航中…可按「跳到降落」');
        this.setBelt(false);
        this.say('belt', 'Ladies and gentlemen, the captain has turned off the seatbelt sign. You may now move about the cabin. We will shortly begin our meal service.', 'cabin',
          '各位旅客，機長已關閉安全帶指示燈，您可以在客艙內走動。我們即將開始供應餐點。');
        this.say('crz', 'Ladies and gentlemen, this is your captain speaking. We are climbing to our cruising altitude of thirty five thousand feet. Flight time to Tokyo Narita is about three hours. Sit back, relax, and enjoy the flight.', 'captain',
          '各位旅客，我是機長。我們正爬升至三萬五千呎的巡航高度，到東京成田約需三小時，請放鬆享受這趟旅程。');
      }
    } else if (this.stage === 'cruise') {
      ap.assistGain = 1;
      const dest = ap.route[ap.route.length - 1];
      // 沿途觀光廣播（以通過的航路點判斷）
      if (ap.wp >= 3) this.say('meal', 'Ladies and gentlemen, we will now be serving dinner. Today we have chicken with rice, or beef noodles. Please let us know if you need anything.', 'cabin',
        '各位旅客，我們現在開始供應晚餐，今天有雞肉飯和牛肉麵，有任何需要請告訴我們。');
      if (ap.wp >= 4) this.say('oki', 'Ladies and gentlemen, if you look out the left side of the aircraft, you can see the islands of Okinawa below us.', 'captain',
        '各位旅客，從飛機左側窗外可以看到下方的沖繩群島。');
      if (ap.wp >= 5) {
        this.setBelt(true);
        this.say('turb', 'Ladies and gentlemen, the captain has turned on the seatbelt sign. We are expecting some light turbulence. Please return to your seats and fasten your seatbelts.', 'cabin',
          '各位旅客，機長已開啟安全帶指示燈，前方可能有輕微亂流，請回座位並繫好安全帶。');
      }
      if (ap.wp >= 6) {
        this.say('yak', 'On the left, you may see Yakushima island and the southern coast of Kyushu.', 'captain', '左側可以看到屋久島與九州南部海岸。');
        this.say('smooth', 'We are through the turbulence. The seatbelt sign is now off.', 'captain', '我們已通過亂流區，安全帶指示燈已關閉。', () => this.setBelt(false));
      }
      if (ap.wp >= 7) this.say('duty', 'Ladies and gentlemen, our duty free service will begin shortly. Please refer to the catalog in your seat pocket.', 'cabin',
        '各位旅客，機上免稅品販售即將開始，請參考座椅前方口袋中的目錄。');
      if (ap.wp >= 7) this.say('sec', 'Ladies and gentlemen, for in-flight entertainment, please try the SecTools Airlines capsule toy game at gacha dash sho dot sectools dot T W. Thank you for flying SecTools Airlines.', 'cabin',
        '各位旅客，機上娛樂推薦「資安航空扭蛋」gacha-sho.sectools.tw，降落後歡迎去轉一顆！感謝您搭乘資安航空。');
      if (ap.wp >= 8) this.say('kii', 'We are now passing the Kii Peninsula. The city of Osaka is off to our left. About thirty minutes to landing.', 'captain',
        '我們正飛越紀伊半島，大阪在左側，大約三十分鐘後降落。');
      if (Math.hypot(dest.x - ac.pos.x, dest.z - ac.pos.z) < 70 * 1852) this.toApproach();
    } else if (this.stage === 'approach') {
      ap.assistGain = clamp((agl - 25) / 150, 0, 1);
      const il = ap.ilsData(ac);
      if (il.dist < 7 * 1852) ac.flaps = 4;
      if (il.dist < 9 * 1852) this.say('fuji', 'Ladies and gentlemen, on a clear day you can see Mount Fuji out the left windows.', 'captain', '天氣晴朗時，從左側窗外可以看到富士山。');
      if (il.dist < 7.5 * 1852) this.say('ccl', 'Cabin crew, please take your seats for landing.', 'captain', '空服員請就座，準備降落。');
      if (il.dist < 6 * 1852) {
        this.say('land', `${CS}, Narita Tower, runway three four left, wind three four zero at eight knots, cleared to land.`, 'tower');
        this.say('landrb', `Cleared to land, runway three four left, ${CS}.`, 'pilot');
      }
      const raFt = agl / FT;
      for (const c of CALLOUTS) if (raFt < c && this.prevRa >= c) this.say('ra' + c, CALLOUT_TEXT[c], 'gpws');
      if (raFt < 220 && this.prevRa >= 220) this.say('min', 'Minimums.', 'gpws');
      this.prevRa = raFt;
      this.rings();
    }
  }

  // 傳送到成田 34L 五邊 12 浬處
  toApproach() {
    const { ac, ap } = this;
    if (this.ring) { this.scene.remove(this.ring.mesh); this.ring = null; }
    const r = ap.ilsRunway();
    const d = 12 * 1852;
    const thrX = r.cx - r.dirX * r.halfLen, thrZ = r.cz - r.dirZ * r.halfLen;
    ac.onGround = false;
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
    this.prevRa = 99999;
    this.setStage('approach', '抵達成田！跟著圓環降落');
    this.say('app', `${CS}, Narita Approach. Cleared ILS runway three four left approach.`, 'atc');
    this.say('apprb', `Cleared ILS three four left, ${CS}.`, 'pilot');
    this.say('des', 'Ladies and gentlemen, this is your captain. We have started our approach into Tokyo Narita. Cabin crew, prepare for landing.', 'captain',
      '各位旅客，我是機長，我們已開始進場東京成田。空服員請準備降落。');
    this.say('prep', 'Ladies and gentlemen, please return to your seat and fasten your seatbelt. Make sure your seat back is upright, your tray table is stowed, and your window shade is open. Thank you.', 'cabin',
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
      this.resolve(off < HIT_R);
    } else if (rel.length() > 6000) this.resolve(false);
    else r.prevS = s;
  }

  spawn() {
    const { ac, ap } = this;
    let c, n;
    if (this.stage === 'climb') {
      const w = ap.route[ap.wp];
      const brg = Math.atan2(w.x - ac.pos.x, -(w.z - ac.pos.z));
      n = new THREE.Vector3(Math.sin(brg), 0, -Math.cos(brg));
      const D = 2200, V = Math.max(60, ac.vel.length());
      const side = new THREE.Vector3(-n.z, 0, n.x);
      c = ac.pos.clone().addScaledVector(n, D).addScaledVector(side, offset(70, 150));
      c.y = Math.max(250, Math.min(ac.pos.y + ac.vel.y * D / V, ap.alt * FT + GEAR_H) + offset(0, 45));
    } else {
      const il = ap.ilsData(this.ac);
      const r = il.r;
      const d = il.dist - 1800;
      if (d < 600) { this.spawned = RINGS.approach; return; }
      n = new THREE.Vector3(r.dirX, 0, r.dirZ);
      const side = new THREE.Vector3(-n.z, 0, n.x);
      const k = clamp((d - 1500) / 8000, 0, 1);
      c = new THREE.Vector3(r.cx - r.dirX * (r.halfLen + d), 0, r.cz - r.dirZ * (r.halfLen + d));
      c.addScaledVector(side, offset(60, 140) * k);
      c.y = RUNWAY_Y + 15 + d * Math.tan(3 * D2R) + GEAR_H + offset(0, 35) * k;
    }
    const mesh = new THREE.Mesh(this.ringGeo, this.ringMat);
    mesh.position.copy(c);
    mesh.lookAt(c.clone().add(n));
    this.scene.add(mesh);
    this.ring = { c, n, mesh, prevS: this.ac.pos.clone().sub(c).dot(n) };
    this.spawned++; this.total++;
  }

  resolve(hit) {
    this.scene.remove(this.ring.mesh);
    this.ring = null;
    if (hit) { this.hits++; this.score += 100; this.flashText = '+100'; navigator.vibrate?.(40); this.sim.audio?.ding(); }
    else this.flashText = '錯過';
    this.flash = 1;
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
    const alt = Math.max(0, Math.round((ac.pos.y - GEAR_H - RUNWAY_Y) / FT));
    const kmh = Math.round(Math.hypot(ac.vel.x, ac.vel.y, ac.vel.z) * 3.6);
    setText('hPts', String(this.score));
    setText('hRings', `圓環 ${this.hits} / ${this.total}`);
    setText('hKmh', String(kmh));
    setText('hAlt', `高度 ${alt.toLocaleString()} ft${this.sim.timeScale > 1 ? ` · ${this.sim.timeScale}×` : ''}`);
    if (setText('hStage', STAGE_TEXT[this.stage])) {
      const el = $('hStage'); el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 350);
    }
    $('hBelt').classList.toggle('on', this.belt);
    g.textAlign = 'center';

    // 命中提示
    if (this.flash > 0) {
      this.flash -= dt * 1.2;
      g.globalAlpha = Math.max(0, this.flash);
      g.font = font(small ? 34 : 44);
      g.fillStyle = this.flashText === '錯過' ? '#ff8080' : '#ffc83d';
      g.fillText(this.flashText, W / 2, H * 0.35 - (1 - this.flash) * 40);
      g.globalAlpha = 1;
    }

    // 操作提示
    if ((this.stage === 'climb' || this.stage === 'approach') && !stick.active && this.total <= 1) {
      g.font = font(15, 'normal'); g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(small ? '👆 按住拖曳操控' : '👆 按住螢幕拖曳：左右轉彎、上下爬升／下降', W / 2, H - (small ? 278 : 120) - safeBottom());
    }

    // 廣播字幕（標示說話者＋中文翻譯）
    if (this.subT > 0) this.subT -= dt;
    const showSub = this.subT > 0 && !!this.subtitle;
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
      setText('hLeft', `NRT ${Math.round(left / 1000)} km`);
    }

    // 搖桿位置提示（未觸控時）
    if (!stick.active && (this.stage === 'climb' || this.stage === 'approach') && W < 600) {
      const gx = W / 2, gy = H - 215 - safeBottom();
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
      g.beginPath(); g.arc(gx, gy, 46, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(gx, gy, 18, 0, Math.PI * 2); g.fill();
    }

    // 虛擬搖桿
    if (stick.active) {
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
      g.beginPath(); g.arc(stick.ox, stick.oy, 70, 0, Math.PI * 2); g.stroke();
      const dx = clamp(stick.x - stick.ox, -70, 70), dy = clamp(stick.y - stick.oy, -70, 70);
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
