// house.js — 住宅 (MAIN.EXE 1fd9:e2a4 = 線性 2e034, 處理函式表 DS:a612[7]); 見 RE_NOTES 25
// 住宅記錄 seg0:5c08 = 0x2a26 + 0x16×i (前 20 筆; +0 名稱, +11 種類, +12 頭像字 (KAO 具名), +14 旗標 (bit4 = 已簽合約, 低 2 位 = 酬金等級), +15 所在港)
//   找本港的第一筆 → DS:b4e4[種類]: 0 = 2d803 (發現物收購: 合約/發現物報告/冒險傳聞), 1 = 2dcae (地圖製作: 合約/技能學習/地理報告/地圖確認),
//   2 = 2ddb6 (測量技術), 3 = 2def5 (砲術); 沒有 → 船員說 0x3a5 (這房子鎖著)
// 記錄 10..15 是各國國王 (王宮 [bdbc] = 5c08(國家 + 10)), 種類 FF 且港 = 0; 里斯本有種類 0 的第 0 筆在前面, 所以不會用到
import { ListSelect } from "../ui/listsel.js";
const hsS16 = v => (v << 16) >> 16;
const hsUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c

export class House {
  constructor(b) { this.b = b; this.D = b.p.P.data.bld2; this.stats = this.D.stats.map(s => Uint8Array.from([...(s.match(/../g) || []).map(h => parseInt(h, 16)), 0])); }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  rec(i) { return 0x2a26 + i * 0x16; }
  disc(n) { return 0x7f8c + (n & 0xff) * 7; }                                    // seg0:5cce 發現物記錄 (+0 x, +2 y, +5 價值, +6 旗標)
  say(n, ...a) { this.b.talkMessage2(n, ...a); }                                 // seg0:7ffc
  async sayWait(n, ...a) { this.say(n, ...a); await this.b.wait(); }
  face() { this.b.talkGirl(this.st.u16(this.H + 0x12), this.H); }               // seg0:7eac(+12, 記錄)

  // ================= 入口 2e034 =================
  async run() {
    const st = this.st, b = this.b;
    for (let i = 0; i < 0x14; i++) {
      const R = this.rec(i);
      if (st.u8(R + 0x15) !== b.port) continue;
      this.H = R;                                                                // [bd80]
      const t = st.u8(R + 0x11);
      if (t > 3) { console.warn("住宅種類 " + t + " 沒有處理函式 (原版會跳到 DS:b4e4 表外)"); return; }
      return [() => this.collector(), () => this.mapper(), () => this.school(0), () => this.school(1)][t]();
    }
    b.crewSpeaks(); this.c.message(0x3a5); await b.wait(); await b.closeTalk();
  }

  // ---------------- 種類 0 2d803 發現物收購 ----------------
  async collector() {
    const b = this.b, st = this.st, H = this.H;
    if (b.noEvent()) { if (st.u8(H + 0x14) & 0x10) b.greet(0x1de, b.dstr(b.hero + 0x0d)); else b.greet(0x1dd); }
    const items = this.c.menuItems(0x18).slice(0, 3);
    let sel;
    do {
      this.c.menu.disabled = st.u8(H + 0x14) & 0x10 ? 1 : 6;                     // [a14c]
      sel = await b.menu(items);
      if (sel !== 0xff) {
        this.face();
        await [() => this.contract0(), () => this.discReport(), () => this.rumor()][sel]();
        await b.closeTalk();
      }
      b.after();
    } while (sel !== 0xff);
  }
  // 2d4b8 合約: 同種類的其他住宅取消合約
  async contract0() {
    const st = this.st, b = this.b;
    await this.sayWait(0x1e0, b.dstr(b.hero + 0x0d));
    this.say(0x1e1);
    if (!(await this.c.menu.yesNo())) return this.sayWait(0x1e2);
    for (let i = 0; i < 0x14; i++) { const R = this.rec(i); if (st.u8(R + 0x11) === 0) st.set8(R + 0x14, st.u8(R + 0x14) & 0xef); }
    st.set8(this.H + 0x14, st.u8(this.H + 0x14) | 0x10);
    await this.sayWait(0x1e3);
  }
  // 2d526 發現物報告: 已發現 (+6 bit5)、未報告 (非 bit4)、非 bit7 → 清單 0x12 → 酬金 = (5 − 等級) × (價值 = 100 ? 4 : 1) × 價值 × 50
  async discReport() {
    const st = this.st, b = this.b, L = [];
    for (let i = 0; i < 0x64; i++) { const f = st.u8(this.disc(i) + 6); if (!(f & 0x80) && (f & 0x20) && !(f & 0x10)) L.push(i); }
    if (!L.length) return this.sayWait(0x1e4);
    b.setPersons(L);
    this.say(0x1e5);
    const r = await b.listSel().select(0x92, L.length);
    if (r === -1) return;
    const n = this.c.persons[r] & 0xffff, D = this.disc(n), v = st.u8(D + 5);
    const k = hsS16(Math.imul(5 - (st.u8(this.H + 0x14) & 3), v === 100 ? 4 : 1));
    const pay = Math.imul(Math.imul(k, v), 50);
    const name = ListSelect.colonyRec(this.c, n);                               // 2e09:66d1 / 66f3 / 66e3
    await this.sayWait(0x1e6 + Math.trunc(v / 25), name, pay);
    let m = (this.money + pay) | 0; if (m > 600000000) m = 600000000;
    this.money = m;
    const HD = b.heroData, add = ((v === 100 ? 15 : 8) * v) & 0xffff;
    st.set16(HD + 4, (st.u16(HD + 4) + hsUmin((50000 - st.u16(HD + 4)) & 0xffff, add)) & 0xffff);   // 冒險家名聲 (上限 50000)
    st.set8(D + 6, st.u8(D + 6) | 0x10);
  }
  // 2d6b0 冒險傳聞: 第一個未發現 (+6 非 bit7、非 bit6) 的發現物 (前 50 筆); random(80) ≤ 運氣 時說真正位置 (以 5 度為單位), 否則亂說
  //   原版怪行為: 亂說時緯度方向用 random(27) ≥ 50 判斷, 永遠是「南緯」
  async rumor() {
    const st = this.st, { sys } = this.c, dir = this.c.menuItems(0x30);
    let D = -1;
    for (let i = 0; i < 0x32; i++) { const f = st.u8(this.disc(i) + 6); if (!(f & 0x80) && !(f & 0x40)) { D = this.disc(i); break; } }
    if (D < 0) return this.sayWait(0x1eb);
    let ew, lon, ns, lat;
    if ((sys.rng.random(0x50) & 0xff) > st.u8(this.b.hero + 0x23)) {
      let di = sys.rng.random(0x48);
      ew = di >= 0x24 ? 1 : 0;
      lon = hsS16(Math.imul(Math.abs(hsS16(di - 0x24)), 5));
      const r = sys.rng.random(0x1b);
      ns = r >= 0x32 ? 2 : 3;
      lat = hsS16(Math.imul(Math.abs(hsS16(r - 10)), 5));
    } else {
      ew = 0;
      let di = (hsS16(st.u16(D)) + 0x7bd) % 0x870;
      if (di > 0x438) { ew = 1; di = 0x870 - di; }
      lon = Math.trunc(Math.trunc(di / 6) / 5) * 5;
      const v = hsS16(0x280 - st.u16(D + 2));
      ns = v >= 0 ? 2 : 3;
      lat = hsS16(Math.imul(Math.trunc(Math.trunc(hsS16(Math.abs(v) << 3) / 0x39) / 5), 5));
    }
    await this.sayWait(0x1ec, dir[ew], lon, dir[ns], lat);
  }

  // ---------------- 種類 1 2dcae 地圖製作 ----------------
  async mapper() {
    const b = this.b, st = this.st, H = this.H;
    let hasMap = 0;
    for (let i = 0; i < 0x14; i++) { const v = st.u8(0x2e57 + i); if (v >= 0x50 && v <= 0x59) hasMap = 1; }
    if (b.noEvent()) b.greet(st.u8(H + 0x14) & 0x10 ? 0x1ee : 0x1ed, b.dstr(b.hero + 0x0d));
    const items = this.c.menuItems(0x19).slice(0, 4);
    let reported = 0, sel;
    do {
      let d = st.u8(H + 0x14) & 0x10 ? 1 : 4;
      if (reported) d |= 4;
      if (st.u8(b.hero + 0x30) & 8) d |= 2;
      if (!hasMap) d |= 8;
      this.c.menu.disabled = d;
      sel = await b.menu(items);
      if (sel !== 0xff) {
        if (sel === 2) reported = 1;
        this.face();
        await [() => this.contract1(), () => this.mapSkill(), () => this.geoReport(), () => this.appraise()][sel]();
        await b.closeTalk();
      }
      b.after();
    } while (sel !== 0xff);
  }
  // 2d8b7 地圖合約 (需要已學會地圖製作 主角 +30 bit3)
  async contract1() {
    const st = this.st, b = this.b;
    await this.sayWait(0x1ef);
    if (!(st.u8(b.hero + 0x30) & 8)) return this.sayWait(0x1f0);
    this.say(0x1f1);
    if (!(await this.c.menu.yesNo())) return this.sayWait(0x1f3);
    for (let i = 0; i < 0x14; i++) { const R = this.rec(i); if (st.u8(R + 0x11) === 1) st.set8(R + 0x14, st.u8(R + 0x14) & 0xef); }
    st.set8(this.H + 0x14, st.u8(this.H + 0x14) | 0x10);
    await this.sayWait(0x1f4);
    st.set16(0x1010, 0);
  }
  // 學費 = min((5000 / (主角 +22 / 5 + 1) + 200) × 100 (16 位元), 60000)
  fee() { return hsUmin(Math.imul(Math.trunc(5000 / (Math.trunc(this.st.u8(this.b.hero + 0x22) / 5) + 1)) + 200, 100), 60000); }
  // 2d93a 技能學習 (地圖製作): 主角 +1c+{1,2,3} (MENU #0x2b 航海術/知識/直覺) 都要 ≥ 75
  async mapSkill() {
    const st = this.st, b = this.b, names = this.c.menuItems(0x2b);
    await this.sayWait(0x1f5);
    for (let i = 0; i < 3; i++) if (st.u8(b.hero + 0x1c + this.D.mapSkills[i]) < 0x4b) return this.sayWait(0x1f6, names[i]);
    const fee = this.fee();
    await this.sayWait(0x1f7, fee);
    if (this.money < fee) return this.sayWait(0x1f8);
    this.say(0x1f9);
    if (!(await this.c.menu.yesNo())) return;
    this.money = (this.money - fee) | 0;
    st.set8(b.hero + 0x30, st.u8(b.hero + 0x30) | 8);
    b.p.panels();
  }
  // 2da2a 地理報告: 酬金 = (5 − 等級) × [1010] × 20; [100e] ≥ 3300 時世界地圖完成 (GRAPH.DAT #0x3f, 清除 DS:0de8 的 45×12 地圖記錄)
  async geoReport() {
    const st = this.st, b = this.b, { win, graph } = this.c;
    if (!st.u16(0x1010)) return this.sayWait(0x1fa);
    if (st.u16(0x100e) >= 0xce4) {
      await win.open(0x15, 8, 0x20, 0xb0, 1);                                    // seg0:74f7
      graph.draw(0x3f, 0xb0, 0x10);                                              // seg0:5b5d
      await this.sayWait(0x1fb);
      await win.close();
      for (let r = 0; r < 0x2d; r++) { for (let k = 0; k < 0x0b; k++) st.set8(0x0de8 + r * 12 + k, 0xff); st.set8(0x0de8 + r * 12 + 0x0b, 0xc0); }
    }
    const pay = Math.imul(Math.imul(hsS16(5 - (st.u8(this.H + 0x14) & 3)), st.u16(0x1010)), 20);
    await this.sayWait(0x1fc, pay);
    if (st.u16(0x100e) < 0xce4) await this.sayWait(0x1fd);
    const HD = b.heroData;
    st.set16(HD + 4, (st.u16(HD + 4) + hsUmin((50000 - st.u16(HD + 4)) & 0xffff, Math.imul(5, st.u16(0x1010)))) & 0xffff);
    const room = (600000000 - this.money) | 0;
    this.money = (this.money + (room > pay ? pay : room)) | 0;
    st.set16(0x1010, 0);
  }
  // 2db6d 地圖確認 (藏寶圖 0x50..0x59 鑑定, 2 萬金幣): 位置以 5 度為單位, 各加 random(2) 格誤差; 付錢後不重畫面板 (原版如此)
  async appraise() {
    const st = this.st, { sys, message } = this.c;
    let i = 0;
    for (; i < 0x14; i++) { const v = st.u8(0x2e57 + i); if (v >= 0x50 && v <= 0x59) break; }
    const D = this.disc(st.u8(0x8248 + st.u8(0x2e57 + i) * 0x14 + 0x12));
    let si = (hsS16(st.u16(D)) + 0x7bd) % 0x870, di = hsS16(0x280 - st.u16(D + 2)), ew = 0x80;
    if (si > 0x438) { ew = 0x81; si = 0x870 - si; }
    const ns = di >= 0 ? 0x7e : 0x7f;
    di = Math.trunc(hsS16(Math.abs(di) << 3) / 0x39);
    si = hsS16(Math.imul(Math.trunc(Math.trunc(si / 6) / 5) + sys.rng.random(2), 5));
    di = hsS16(Math.imul(Math.trunc(di / 5) + sys.rng.random(2), 5));
    this.say(0x311);
    if (!(await this.c.menu.yesNo())) return;
    if (this.money <= 20000) return this.sayWait(0xef);
    this.money = (this.money - 20000) | 0;
    await this.sayWait(0x312);
    this.say(0x30f); message(ns, di); message(ew, si); message(0x310);
    await this.b.wait();
  }

  // ---------------- 種類 2 2ddb6 測量技術 / 種類 3 2def5 砲術 ----------------
  async school(k) {
    const st = this.st, b = this.b;
    const M = k ? { ask: 0x2e7, done: 0x2e8, lack: 0x2e9, poor: 0x2eb, ok: 0x2ec, bye: 0x2ed, bit: 4, req: [0x4b, 0x41, 0x50], idx: this.D.gunSkills }
      : { ask: 0x2ee, done: 0x2ef, lack: 0x2f0, poor: 0x1f8, ok: 0x1f9, bye: 0x2f1, bit: 0x10, req: [0x46, 0x50, 0x46], idx: this.D.measureSkills };
    this.face();
    this.say(M.ask);
    const bye = async () => { await this.sayWait(M.bye); await b.closeTalk(); };   // 失敗時都先說原因, 再說 M.bye (原版跳回同一段)
    if (!(await this.c.menu.yesNo())) return bye();
    const H = b.hero;
    if (st.u8(H + 0x30) & M.bit) { await this.sayWait(M.done); return bye(); }
    for (let i = 0; i < 3; i++) if (st.u8(H + 0x1c + M.idx[i]) < M.req[i]) { await this.sayWait(M.lack, this.stats[M.idx[i]], M.req[i]); return bye(); }
    const fee = this.fee();
    await this.sayWait(0x1f7, fee);
    if (this.money < fee) { await this.sayWait(M.poor); return bye(); }
    this.say(M.ok);
    if (!(await this.c.menu.yesNo())) return bye();
    await this.sayWait(M.bye);
    this.money = (this.money - fee) | 0;
    st.set8(H + 0x30, st.u8(H + 0x30) | M.bit);
    b.p.panels();
    await b.closeTalk();
  }
}
