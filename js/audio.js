// 音效：程式產生的背景音樂、引擎聲、安全帶「叮咚」聲（不需音檔）
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.duck = 1;
  }

  // 必須在使用者點擊時呼叫（手機瀏覽器限制）
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);

    // 音樂匯流排：低通＋回音
    this.music = ctx.createGain(); this.music.gain.value = 0.22;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.375;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    this.music.connect(lp); lp.connect(this.master);
    lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.master);

    // 引擎聲：棕噪音 → 低通
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 300;
    this.engine = ctx.createGain(); this.engine.gain.value = 0;
    noise.connect(this.engFilter); this.engFilter.connect(this.engine); this.engine.connect(this.master);
    noise.start();

    this.beat = 0;
    this.nextTime = ctx.currentTime + 0.1;
    setInterval(() => this.schedule(), 100);
  }

  // 和弦進行：Cmaj7 – Am7 – Fmaj7 – G6（輕鬆的旅行感）
  static CHORDS = [
    [48, 55, 59, 64, 67], [45, 52, 55, 60, 64], [41, 48, 52, 57, 60], [43, 50, 55, 59, 64],
  ];

  schedule() {
    const ctx = this.ctx;
    const spb = 60 / 84 / 2;   // 八分音符
    while (this.nextTime < ctx.currentTime + 0.4) {
      const t = this.nextTime;
      const bar = Math.floor(this.beat / 8) % 4;
      const chord = GameAudio.CHORDS[bar];
      if (this.musicOn) {
        if (this.beat % 8 === 0) {
          // 襯底和弦
          for (const n of chord.slice(0, 4)) this.note(n, t, spb * 8, 0.05, 'triangle', 0.9);
          this.note(chord[0] - 12, t, spb * 8, 0.08, 'sine', 0.5);
        }
        // 琶音：隨機略過幾個音，讓旋律自然一點
        const step = this.beat % 8;
        if (step % 2 === 0 || Math.random() < 0.35) {
          const pick = chord[[1, 2, 3, 4, 3, 2, 4, 3][step]] + 12;
          this.note(pick, t, spb * 1.6, 0.06, 'sine', 0.02);
        }
      }
      this.nextTime += spb;
      this.beat++;
    }
  }

  note(midi, t, dur, vol, type, attack) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // 每幀更新：引擎聲隨油門，語音播放時音樂自動降低音量
  update(throttle, speed, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const speaking = window.speechSynthesis?.speaking;
    this.music.gain.setTargetAtTime(this.musicOn ? (speaking ? 0.08 : 0.22) : 0, t, 0.3);
    this.engine.gain.setTargetAtTime(active ? 0.05 + throttle * 0.1 : 0, t, 0.3);
    this.engFilter.frequency.setTargetAtTime(180 + throttle * 500 + speed * 0.6, t, 0.3);
  }

  // 安全帶指示燈「叮咚」
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1318, t, 0.9, 0.18);
    this.tone(1046, t + 0.45, 1.1, 0.18);
  }

  // 穿過圓環：連擊越高音越高
  ding(mult = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.pow(2, (Math.min(mult, 5) - 1) * 2 / 12);
    this.tone(1568 * k, t, 0.25, 0.1);
    this.tone(2093 * k, t + 0.07, 0.35, 0.08);
  }

  // 吃到金幣
  coin() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1976, t, 0.08, 0.05);
    this.tone(2637, t + 0.05, 0.18, 0.05);
  }

  // 加速：向上滑音
  boost() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.5);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.65);
  }

  tone(freq, t, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
