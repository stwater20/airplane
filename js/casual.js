// 輕鬆模式：自動起飛／巡航／降落，玩家只需拖曳讓飛機穿過金色圓環
import * as THREE from 'three';
import { RUNWAY_Y } from './world.js';
import { GEAR_H } from './aircraft.js';

const D2R = Math.PI / 180, KT = 0.514444, FT = 0.3048;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RINGS = { climb: 10, approach: 10 };
const HIT_R = 85;
// 隨機偏移（左右隨機），讓玩家必須操控才能穿過
const offset = (min, max) => (Math.random() < 0.5 ? -1 : 1) * (min + Math.random() * (max - min));

const STAGE_TEXT = {
  takeoff: '起飛中…準備！',
  climb: '穿過金色圓環！',
  cruise: '巡航中 ⏩ 欣賞風景',
  approach: '跟著圓環對準跑道',
  done: '降落成功！減速中…',
};

// 英文語音廣播（瀏覽器內建語音）
const CALLOUTS = [1000, 500, 100, 50, 30, 10];
const CALLOUT_TEXT = { 1000: 'One thousand', 500: 'Five hundred', 100: 'One hundred', 50: 'Fifty', 40: 'Forty', 30: 'Thirty', 20: 'Twenty', 10: 'Ten' };

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
    this.stage = 'takeoff';
    this.score = 0; this.hits = 0; this.total = 0; this.spawned = 0;
    this.flash = 0; this.flashText = '';
    this.said = new Set(); this.subtitle = ''; this.subT = 0;
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  // 只講一次的廣播；radio = 無線電（較快、較低沉）
  say(id, text, radio = false) {
    if (this.said.has(id)) return;
    this.said.add(id);
    this.subtitle = text.replace('I L S', 'ILS'); this.subT = 6;
    if (!this.sim.voice || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const v = speechSynthesis.getVoices().filter((x) => x.lang.startsWith('en'));
    if (v.length) u.voice = v[radio ? 0 : Math.min(1, v.length - 1)];
    u.rate = radio ? 1.15 : 0.95;
    u.pitch = radio ? 0.9 : 1;
    speechSynthesis.speak(u);
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
        this.say('wel', 'Ladies and gentlemen, welcome to Tokyo Narita International Airport. Please remain seated with your seatbelt fastened until the captain turns off the seatbelt sign. Thank you for flying Skyline.');
      }
      return;
    }

    if (this.stage === 'takeoff') {
      this.say('clr', 'Skyline one two three, runway zero five right, wind calm, cleared for takeoff.', true);
      if (this.sim.timeScale < 3) this.sim.timeScale = 3;   // 縮短起飛時間
      if (ias > 80) this.say('80', 'Eighty knots.');
      if (ias > 135) this.say('v1', 'V one.');
      if (ias > 145) this.say('vr', 'Rotate.');
      if (!ac.onGround && ac.vel.y > 2) this.say('pos', 'Positive rate. Gear up.');
      ac.brakes = false; ac.spoilers = false;
      ac.throttle = Math.min(1, ac.throttle + dt * 0.4);
      ac.input.roll = clamp(-att.bank * 2, -1, 1); ac.input.yaw = 0;
      if (ac.onGround) ac.input.pitch = ias > 145 ? clamp((9 * D2R - att.pitch) * 5, 0, 1) : 0;
      else if (agl < 15) ac.input.pitch = clamp((9 * D2R - att.pitch) * 5, -0.5, 1);
      else ac.input.pitch = 0;
      if (!ac.onGround && agl > 12 && ac.vel.y > 1 && ac.gearDown) ac.gearDown = false;
      if (agl > 90) {
        Object.assign(ap, { ap: true, athr: true, lat: 'NAV', vert: 'ALT', alt: 9000, spd: 250 });
        this.sim.timeScale = 1;
        this.say('dep', 'Skyline one two three, Taipei Departure, radar contact. Climb and maintain flight level three five zero.', true);
        this.setStage('climb', '起飛成功！拖曳讓飛機穿過金色圓環');
      }
      return;
    }

    if (this.stage === 'climb') {
      ap.assistGain = clamp((agl - 60) / 200, 0, 1);
      if (ias > 185 && ac.flaps > 1) ac.flaps = 1;
      if (ias > 210) ac.flaps = 0;
      this.rings();
      if (!this.ring && this.spawned >= RINGS.climb) {
        Object.assign(ap, { alt: 35000, spd: 290 });
        this.sim.timeScale = 64;
        this.setStage('cruise', '巡航中…可按「跳到降落」');
        this.say('crz', 'Ladies and gentlemen, this is your captain speaking. We are climbing to our cruising altitude of thirty five thousand feet. Flight time to Tokyo Narita is about three hours. Sit back, relax, and enjoy the flight.');
      }
    } else if (this.stage === 'cruise') {
      ap.assistGain = 1;
      const dest = ap.route[ap.route.length - 1];
      if (Math.hypot(dest.x - ac.pos.x, dest.z - ac.pos.z) < 70 * 1852) this.toApproach();
    } else if (this.stage === 'approach') {
      ap.assistGain = clamp((agl - 40) / 200, 0, 1);
      const il = ap.ilsData(ac);
      if (il.dist < 7 * 1852) ac.flaps = 4;
      if (il.dist < 6 * 1852) this.say('land', 'Skyline one two three, Narita Tower, runway three four left, cleared to land.', true);
      const raFt = agl / FT;
      for (const c of CALLOUTS) if (raFt < c && this.prevRa >= c) this.say('ra' + c, CALLOUT_TEXT[c]);
      if (raFt < 220 && this.prevRa >= 220) this.say('min', 'Minimums.');
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
    this.prevRa = 99999;
    this.setStage('approach', '抵達成田！跟著圓環降落');
    this.say('app', 'Skyline one two three, Narita Approach. Cleared I L S runway three four left approach.', true);
    setTimeout(() => this.say('des', 'Ladies and gentlemen, we are on final approach into Tokyo Narita. Please make sure your seatbelt is securely fastened.'), 5500);
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
    if (hit) { this.hits++; this.score += 100; this.flashText = '+100'; }
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
    const small = W < 600;
    const font = (px, w = 'bold') => `${w} ${px}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;

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

    // 頂部資訊
    const pad = 12, top = 12 + (small ? 0 : 0);
    const box = (x, y, w, h) => { g.fillStyle = 'rgba(8,18,32,0.6)'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill(); };
    box(pad, top, 132, 56);
    g.fillStyle = '#ffc83d'; g.font = font(22); g.textAlign = 'left';
    g.fillText(`⭐ ${this.score}`, pad + 12, top + 25);
    g.fillStyle = '#e8eef6'; g.font = font(13, 'normal');
    g.fillText(`圓環 ${this.hits} / ${this.total}`, pad + 12, top + 46);

    const alt = Math.max(0, Math.round((ac.pos.y - GEAR_H - RUNWAY_Y) / FT));
    const kmh = Math.round(Math.hypot(ac.vel.x, ac.vel.y, ac.vel.z) * 3.6);
    box(W - pad - 160, top, 160, 56);
    g.textAlign = 'right'; g.fillStyle = '#4fe3ff'; g.font = font(20);
    g.fillText(`${kmh} km/h`, W - pad - 12, top + 25);
    g.fillStyle = '#e8eef6'; g.font = font(13, 'normal');
    g.fillText(`高度 ${alt.toLocaleString()} ft${this.sim.timeScale > 1 ? `  ⏩x${this.sim.timeScale}` : ''}`, W - pad - 12, top + 46);
    g.textAlign = 'left'; g.fillStyle = '#9fb3c8'; g.font = font(11, 'normal');
    g.fillText('時速', W - pad - 150, top + 23);

    // 階段
    g.textAlign = 'center';
    g.font = font(small ? 16 : 19);
    const label = STAGE_TEXT[this.stage] + (this.ring || this.spawned ? `` : '');
    const lw = g.measureText(label).width + 28;
    const ly = small ? top + 72 : top;
    box(W / 2 - lw / 2, ly, lw, 34);
    g.fillStyle = '#ffffff'; g.fillText(label, W / 2, ly + 23);

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
      g.fillText('👆 按住螢幕拖曳：左右轉彎、上下爬升／下降', W / 2, H - 120);
    }

    // 英文廣播字幕
    if (this.subT > 0) {
      this.subT -= dt;
      g.globalAlpha = Math.min(1, this.subT);
      g.font = font(small ? 13 : 15, 'normal');
      const lines = wrap(g, `🎙️ ${this.subtitle}`, Math.min(W - 40, 560));
      const lh = small ? 18 : 21, bh = lines.length * lh + 14, by = small ? 128 : 58;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect(W / 2 - Math.min(W - 24, 580) / 2, by, Math.min(W - 24, 580), bh, 10); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center';
      lines.forEach((l, i) => g.fillText(l, W / 2, by + 7 + lh * (i + 0.75)));
      g.globalAlpha = 1;
    }

    // 虛擬搖桿
    if (stick.active) {
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
      g.beginPath(); g.arc(stick.ox, stick.oy, 70, 0, Math.PI * 2); g.stroke();
      const dx = clamp(stick.x - stick.ox, -70, 70), dy = clamp(stick.y - stick.oy, -70, 70);
      g.fillStyle = 'rgba(79,227,255,0.55)';
      g.beginPath(); g.arc(stick.ox + dx, stick.oy + dy, 26, 0, Math.PI * 2); g.fill();
    }

    if (W >= 600) hud.map(g, ac, ap, 1);
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
