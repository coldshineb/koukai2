// house.js — 住宅 (MAIN.EXE 1fd9:e2a4 = 線性 2e034, 處理函式表 DS:a612[7]); 見 RE_NOTES 25
// 住宅記錄 nobles (前 20 筆; name, kind, portrait, flags, port)
//   找本港的第一筆 → DS:b4e4[種類]: 0 = 2d803 (發現物收購), 1 = 2dcae (地圖製作), 2 = 2ddb6 (測量技術), 3 = 2def5 (砲術); 沒有 → 船員說 0x3a5 (這房子鎖著)
// 記錄 10..15 是各國國王, 種類 FF 且港 = 0; 里斯本有種類 0 的第 0 筆在前面, 所以不會用到
import { ListSelect } from "../ui/listsel.js";
import { DiscoveryFlag, GameConst, NobleFlag, SkillFlag, WorkDS } from "../model/flags.ts";
import { hasDom, runDomStoryCard } from "../modern/dom_ui.ts";
import { runDomHouseWorkbench } from "../modern/dom_buildings.ts";
import { captureConsoleText, toSimp } from "../canvas_ui/text_util.ts";

const hsS16 = v => (v << 16) >> 16;
const hsUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c

export class House {
  constructor(b) { this.b = b; this.D = b.p.P.data.bld2; this.stats = this.D.stats.map(s => Uint8Array.from([...(s.match(/../g) || []).map(h => parseInt(h, 16)), 0])); }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  say(n, ...a) { this.b.talkMessage2(n, ...a); }                                 // seg0:7ffc
  async sayWait(n, ...a) { this.say(n, ...a); await this.b.wait(); }
  face() { this.b.talkGirl(this.noble.portrait, this.noble.addr); }              // seg0:7eac(+12, 記錄)

  // ================= 入口 2e034 =================
  async run() {
    const m = this.m, b = this.b;
    for (let i = 0; i < 20; i++) {
      const noble = m.noble(i);
      if (noble.port !== b.port) continue;
      this.noble = noble;                                                        // [bd80]
      const t = noble.kind;
      if (t > 3) { console.warn("住宅種類 " + t + " 沒有處理函式 (原版會跳到 DS:b4e4 表外)"); return; }
      if (hasDom() && this.c.codec) return runDomHouseWorkbench(this);
      return [() => this.collector(), () => this.mapper(), () => this.school(0), () => this.school(1)][t]();
    }
    b.crewSpeaks(); this.c.message(0x3a5); await b.wait(); await b.closeTalk();
  }

  // ---------------- 種類 0 2d803 發現物收購 ----------------
  async collector() {
    const b = this.b, m = this.m, noble = this.noble;
    if (b.noEvent()) { if (noble.flags & NobleFlag.CONTRACTED) b.greet(0x1de, m.heroPerson().familyNameBytes); else b.greet(0x1dd); }
    const items = this.c.menuItems(0x18).slice(0, 3);
    let sel;
    do {
      this.c.menu.disabled = noble.flags & NobleFlag.CONTRACTED ? 1 : 6;         // [a14c]
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
    const m = this.m;
    await this.sayWait(0x1e0, m.heroPerson().familyNameBytes);
    this.say(0x1e1);
    if (!(await this.c.menu.yesNo())) return this.sayWait(0x1e2);
    for (let i = 0; i < 20; i++) { const n = m.noble(i); if (n.kind === 0) n.flags &= ~NobleFlag.CONTRACTED; }
    this.noble.flags |= NobleFlag.CONTRACTED;
    await this.sayWait(0x1e3);
  }
  // 2d526 發現物報告: 已發現 (+6 bit5)、未報告 (非 bit4)、非 bit7 → 清單 0x12 → 酬金 = (5 − 等級) × (價值 = 100 ? 4 : 1) × 價值 × 50
  async discReport() {
    const m = this.m, b = this.b, L = [];
    for (let i = 0; i < 100; i++) { const f = m.discovery(i).flags; if (!(f & DiscoveryFlag.FOUND) && (f & DiscoveryFlag.KNOWN) && !(f & 0x10)) L.push(i); }
    if (!L.length) return this.sayWait(0x1e4);
    b.setPersons(L);
    this.say(0x1e5);
    const r = await b.listSel().select(0x92, L.length);
    if (r === -1) return;
    const n = this.c.persons[r] & 0xffff, d = m.discovery(n), v = d.importance;
    const k = hsS16(Math.imul(5 - (this.noble.flags & NobleFlag.REWARD_MASK), v === 100 ? 4 : 1));
    const pay = Math.imul(Math.imul(k, v), 50);
    const name = ListSelect.colonyRec(this.c, n);                               // 2e09:66d1 / 66f3 / 66e3
    await this.sayWait(0x1e6 + Math.trunc(v / 25), name, pay);
    let nextCash = (this.money + pay) | 0; if (nextCash > GameConst.MAX_CASH) nextCash = GameConst.MAX_CASH;
    this.money = nextCash;
    const hd = m.heroInfo(), add = ((v === 100 ? 15 : 8) * v) & 0xffff;
    hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, add)) & 0xffff;
    d.flags |= 0x10;
  }
  // 2d6b0 冒險傳聞: 第一個未發現 (+6 非 bit7、非 bit6) 的發現物 (前 50 筆); random(80) ≤ 運氣 時說真正位置 (以 5 度為單位), 否則亂說
  //   原版怪行為: 亂說時緯度方向用 random(27) ≥ 50 判斷, 永遠是「南緯」
  async rumor() {
    const m = this.m, { sys } = this.c, dir = this.c.menuItems(0x30);
    let d = null;
    for (let i = 0; i < 50; i++) { const c = m.discovery(i); if (!(c.flags & DiscoveryFlag.FOUND) && !(c.flags & 0x40)) { d = c; break; } }
    if (!d) return this.sayWait(0x1eb);
    let ew, lon, ns, lat;
    if ((sys.rng.random(0x50) & 0xff) > m.heroPerson().getStats(7)) {
      let di = sys.rng.random(0x48);
      ew = di >= 0x24 ? 1 : 0;
      lon = hsS16(Math.imul(Math.abs(hsS16(di - 0x24)), 5));
      const r = sys.rng.random(0x1b);
      ns = r >= 0x32 ? 2 : 3;
      lat = hsS16(Math.imul(Math.abs(hsS16(r - 10)), 5));
    } else {
      ew = 0;
      let di = (hsS16(d.x) + 0x7bd) % 0x870;
      if (di > 0x438) { ew = 1; di = 0x870 - di; }
      lon = Math.trunc(Math.trunc(di / 6) / 5) * 5;
      const v = hsS16(0x280 - d.y);
      ns = v >= 0 ? 2 : 3;
      lat = hsS16(Math.imul(Math.trunc(Math.trunc(hsS16(Math.abs(v) << 3) / 0x39) / 5), 5));
    }
    await this.sayWait(0x1ec, dir[ew], lon, dir[ns], lat);
  }

  // ---------------- 種類 1 2dcae 地圖製作 ----------------
  async mapper() {
    const b = this.b, m = this.m, noble = this.noble;
    let hasMap = 0;
    for (let i = 0; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (v >= 0x50 && v <= 0x59) hasMap = 1; }
    if (b.noEvent()) b.greet(noble.flags & NobleFlag.CONTRACTED ? 0x1ee : 0x1ed, m.heroPerson().familyNameBytes);
    const items = this.c.menuItems(0x19).slice(0, 4);
    let reported = 0, sel;
    do {
      let d = noble.flags & NobleFlag.CONTRACTED ? 1 : 4;
      if (reported) d |= 4;
      if (m.heroPerson().skills & SkillFlag.CARTOGRAPHY) d |= 2;
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
  // 2d8b7 地圖合約 (需要已學會地圖製作)
  async contract1() {
    const st = this.st, m = this.m;
    await this.sayWait(0x1ef);
    if (!(m.heroPerson().skills & SkillFlag.CARTOGRAPHY)) return this.sayWait(0x1f0);
    this.say(0x1f1);
    if (!(await this.c.menu.yesNo())) return this.sayWait(0x1f3);
    for (let i = 0; i < 20; i++) { const n = m.noble(i); if (n.kind === 1) n.flags &= ~NobleFlag.CONTRACTED; }
    this.noble.flags |= NobleFlag.CONTRACTED;
    await this.sayWait(0x1f4);
    st.set16(WorkDS.EXPLORE_UNREP, 0);
  }
  // 學費 = min((5000 / (主角 +22 / 5 + 1) + 200) × 100 (16 位元), 60000)
  fee() { return hsUmin(Math.imul(Math.trunc(5000 / (Math.trunc(this.m.heroPerson().getStats(6) / 5) + 1)) + 200, 100), 60000); }
  // 2d93a 技能學習 (地圖製作): 主角 +1c+{1,2,3} (MENU #0x2b 航海術/知識/直覺) 都要 ≥ 75
  async mapSkill() {
    const m = this.m, b = this.b, hero = m.heroPerson(), names = this.c.menuItems(0x2b);
    await this.sayWait(0x1f5);
    for (let i = 0; i < 3; i++) if (hero.getStats(this.D.mapSkills[i]) < 75) return this.sayWait(0x1f6, names[i]);
    const fee = this.fee();
    await this.sayWait(0x1f7, fee);
    if (this.money < fee) return this.sayWait(0x1f8);
    this.say(0x1f9);
    if (!(await this.c.menu.yesNo())) return;
    this.money = (this.money - fee) | 0;
    hero.skills |= SkillFlag.CARTOGRAPHY;
    b.p.panels();
  }
  // 2da2a 地理報告: 酬金 = (5 − 等級) × [1010] × 20; [100e] ≥ 3300 時世界地圖完成 (GRAPH.DAT #0x3f, 清除 DS:0de8 的 45×12 地圖記錄)
  async geoReport() {
    const st = this.st, m = this.m, { win, graph } = this.c;
    const unrep = st.u16(WorkDS.EXPLORE_UNREP);
    if (!unrep) return this.sayWait(0x1fa);
    const total = st.u16(WorkDS.EXPLORE_TOTAL);
    if (total >= 3300) {
      if (this.c.scr.wideRenderer && hasDom() && this.c.codec) {
        const txt = toSimp(captureConsoleText(this.c, () => this.c.message(0x1fb)));
        await runDomStoryCard(this.c.art, 0x3f, txt, "世界地图完成");
      } else {
        await win.open(0x15, 8, 0x20, 0xb0, 1);                                 // seg0:74f7
        graph.draw(0x3f, 0xb0, 0x10);                                           // seg0:5b5d
        await this.sayWait(0x1fb);
        await win.close();
      }
      for (let r = 0; r < 45; r++) { for (let k = 0; k < 11; k++) st.set8(WorkDS.EXPLORE_MAP + r * 12 + k, 0xff); st.set8(WorkDS.EXPLORE_MAP + r * 12 + 11, 0xc0); }
    }
    const pay = Math.imul(Math.imul(hsS16(5 - (this.noble.flags & NobleFlag.REWARD_MASK)), unrep), 20);
    await this.sayWait(0x1fc, pay);
    if (total < 3300) await this.sayWait(0x1fd);
    const hd = m.heroInfo();
    hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, Math.imul(5, unrep))) & 0xffff;
    const room = (GameConst.MAX_CASH - this.money) | 0;
    this.money = (this.money + (room > pay ? pay : room)) | 0;
    st.set16(WorkDS.EXPLORE_UNREP, 0);
  }
  // 2db6d 地圖確認 (藏寶圖 0x50..0x59 鑑定, 2 萬金幣): 位置以 5 度為單位, 各加 random(2) 格誤差; 付錢後不重畫面板 (原版如此)
  async appraise() {
    const m = this.m, { sys, message } = this.c;
    let i = 0;
    for (; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (v >= 0x50 && v <= 0x59) break; }
    const d = m.discovery(m.item(m.inventory(i)).power);
    let si = (hsS16(d.x) + 0x7bd) % 0x870, di = hsS16(0x280 - d.y), ew = 0x80;
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
    const m = this.m, b = this.b, hero = m.heroPerson();
    const M = k
      ? { ask: 0x2e7, done: 0x2e8, lack: 0x2e9, poor: 0x2eb, ok: 0x2ec, bye: 0x2ed, bit: SkillFlag.GUNNERY, req: [75, 65, 80], idx: this.D.gunSkills }
      : { ask: 0x2ee, done: 0x2ef, lack: 0x2f0, poor: 0x1f8, ok: 0x1f9, bye: 0x2f1, bit: SkillFlag.SURVEY, req: [70, 80, 70], idx: this.D.measureSkills };
    this.face();
    this.say(M.ask);
    const bye = async () => { await this.sayWait(M.bye); await b.closeTalk(); };   // 失敗時都先說原因, 再說 M.bye (原版跳回同一段)
    if (!(await this.c.menu.yesNo())) return bye();
    if (hero.skills & M.bit) { await this.sayWait(M.done); return bye(); }
    for (let i = 0; i < 3; i++) if (hero.getStats(M.idx[i]) < M.req[i]) { await this.sayWait(M.lack, this.stats[M.idx[i]], M.req[i]); return bye(); }
    const fee = this.fee();
    await this.sayWait(0x1f7, fee);
    if (this.money < fee) { await this.sayWait(M.poor); return bye(); }
    this.say(M.ok);
    if (!(await this.c.menu.yesNo())) return bye();
    await this.sayWait(M.bye);
    this.money = (this.money - fee) | 0;
    hero.skills |= M.bit;
    b.p.panels();
    await b.closeTalk();
  }
}
