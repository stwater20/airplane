// 玩家進度：金幣、最佳分數、塗裝收藏（存在本機瀏覽器，失敗時以記憶體運作）
const KEY = 'sectools-airlines-v1';

export const LIVERIES = [
  { id: 'classic', name: '經典藍', color: 0x1b4f9c, rarity: 'N' },
  { id: 'sunset', name: '夕陽橘', color: 0xff7a1a, rarity: 'N' },
  { id: 'sakura', name: '櫻花粉', color: 0xff8fb8, rarity: 'N' },
  { id: 'matcha', name: '抹茶綠', color: 0x4c8c4a, rarity: 'N' },
  { id: 'boba', name: '珍奶棕', color: 0x8b5a2b, rarity: 'R' },
  { id: 'midnight', name: '午夜黑', color: 0x1c1f26, rarity: 'R' },
  { id: 'hacker', name: '駭客綠', color: 0x00e05a, rarity: 'SR' },
  { id: 'gold', name: '黃金傳說', color: 0xd4a017, rarity: 'SSR' },
];
const WEIGHT = { N: 10, R: 5, SR: 2, SSR: 1 };
export const GACHA_COST = 300;

export const ACHIEVEMENTS = [
  { id: 'first', name: '首航成功', desc: '完成第一次飛行' },
  { id: 'butter', name: '奶油落地', desc: '以小於 150 fpm 的下降率接地' },
  { id: 'combo10', name: '連擊大師', desc: '單次飛行達成 10 連擊' },
  { id: 'allrings', name: '一環不漏', desc: '穿過所有圓環' },
  { id: 'perfect5', name: '神準機師', desc: '單次飛行 5 個 PERFECT' },
  { id: 'night', name: '夜航員', desc: '在夜晚完成一次飛行' },
  { id: 'dawn', name: '迎接日出', desc: '在日出時段完成一次飛行' },
  { id: 'daily', name: '每日飛行員', desc: '完成一次今日挑戰' },
  { id: 'collector', name: '塗裝收藏家', desc: '收集 4 款塗裝' },
  { id: 'ssr', name: '黃金傳說', desc: '轉到 SSR 黃金塗裝' },
  { id: 'photo', name: '空中攝影師', desc: '在飛行中拍一張照片' },
  { id: 'veteran', name: '資深機長', desc: '累積完成 10 次飛行' },
  { id: 'comfort', name: '五星服務', desc: '乘客滿意度 95% 以上完成飛行' },
];
export const todayKey = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // 以台灣時間換日
export const todaySeed = () => Number(todayKey().replace(/-/g, ''));

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && typeof d.coins === 'number') return { owned: ['classic'], livery: 'classic', best: 0, flights: 0, ach: [], daily: null, ...d };
  } catch { /* 隱私模式等情況 */ }
  return { coins: 300, best: 0, flights: 0, owned: ['classic'], livery: 'classic', ach: [], daily: null };   // 新玩家見面禮：可先轉一次扭蛋
}

export const progress = {
  data: load(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* 忽略 */ } },
  addCoins(n) { this.data.coins += n; this.save(); },
  livery() { return LIVERIES.find((l) => l.id === this.data.livery) || LIVERIES[0]; },
  select(id) { if (this.data.owned.includes(id)) { this.data.livery = id; this.save(); } },
  // 轉扭蛋：依稀有度權重抽一個塗裝；重複時退還部分金幣
  spin() {
    if (this.data.coins < GACHA_COST) return null;
    this.data.coins -= GACHA_COST;
    const pool = LIVERIES.flatMap((l) => Array(WEIGHT[l.rarity]).fill(l));
    const got = pool[Math.floor(Math.random() * pool.length)];
    const dup = this.data.owned.includes(got.id);
    if (dup) this.data.coins += 100;
    else { this.data.owned.push(got.id); this.data.livery = got.id; }
    this.save();
    return { got, dup };
  },
  // 解鎖成就：回傳成就物件（新解鎖）或 null
  unlock(id) {
    if (this.data.ach.includes(id)) return null;
    this.data.ach.push(id); this.save();
    return ACHIEVEMENTS.find((a) => a.id === id) || null;
  },
  dailyBest(score) {
    const k = todayKey();
    if (!this.data.daily || this.data.daily.date !== k) this.data.daily = { date: k, best: 0 };
    const isBest = score > this.data.daily.best;
    if (isBest) this.data.daily.best = score;
    this.save();
    return isBest;
  },
  finishFlight(score, coins) {
    this.data.flights++;
    const isBest = score > this.data.best;
    if (isBest) this.data.best = score;
    this.data.coins += coins;
    this.save();
    return isBest;
  },
};
