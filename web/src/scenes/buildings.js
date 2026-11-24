// buildings.js — 港口建築內部 (MAIN.EXE 1fd9 段, 處理函式表 DS:a612)
// 共用框架:
//   seg0:8f03 greet(n, ...)  店主對白: 視窗 7358(0x1e,8,0x1e,0x80,0) (不保存背景), 文字區 0x20..0x38, MESSAGE n
//   0fea:b5ce = 1b46e menu()  先重畫左右面板 (8894), 再 14364 直式選單於 (0x3c, 0x68), 可取消
//   0fea:b6e0 = 1b580 after() 以點陣重畫地圖區下半 (1b496)
//   0fea:b6bc = 1b55c table() GRAPH.DAT #0x16 於 (0x68,0x88), 文字區 0x0e..0x3a
//   seg0:7dac/7f06/7e15/7e35/7f6e 人物對話視窗 (頭像於 0x16, 0xd0)   seg0:909b 船員發言
// 已移植: 0 交易所 (market.js) / 2 造船廠 (造新船、交船、買舊船、修理、賣船、改造、工業投資、折抵舊船剩餘貨物重新分配) / 3 碼頭 (補給、出航前檢查、船塢、補給港命名、出航 → scenes/sea.js) / 1 酒館 (全部; 賭博在 gamble.js) / 4 旅館 (全部) / 10 教會 / 11 占卜師 (全部)
// 5 王宮 (palace.js) / 6 事務所 (office.js) / 7 住宅 (house.js) / 8 銀行 (bank.js) / 9 道具店 (itemshop.js): 見 RE_NOTES 25
// 其他子功能: 尚未移植的在進入時顯示主控台警告
import { NumPad } from "../ui/numpad.js";
import { ListSelect } from "../ui/listsel.js";
import { NameInput } from "../ui/nameinput.js";
import { Gamble } from "./gamble.js";
import { Market, marketTradeLog } from "./market.js";
import { Palace } from "./palace.js";
import { Office } from "./office.js";
import { House } from "./house.js";
import { Bank } from "./bank.js";
import { ItemShop } from "./itemshop.js";
import { CPU } from "../core/cpucost.js";
import { COST_TABLE } from "../core/cpucost_table.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
const WIPE_CYC = COST_TABLE.find(r => r[0] === "Buildings" && r[1] === "wipe")?.[2].n || 0;   // seg0:2260 清除畫面的量測週期

const bHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const B_SPEECH = Uint8Array.of(0x1b, 0x43, 0x30, 0x01, 0x1b, 0x42, 0x37, 0);   // DS:8c12
const B_COLOR = Uint8Array.of(0x1b, 0x43, 0x30, 0x1b, 0x42, 0x37, 0);          // DS:a60a / 8b79
const B_SUPPORT_FMT = Uint8Array.of(0x25, 0x2d, 0x31, 0x34, 0x73, 0x20, 0x25, 0x33, 0x64, 0x25, 0x25, 0); // DS:b0ba "%-14s %3d%%"
const B_STAR = Uint8Array.of(0x2a, 0);                                           // DS:b0c6
const B_SUPPORT_HDR = bHex("9361995398f8"), B_ALLY_HDR = bHex("946da357a0aa");   // DS:b0ac「支持度」/ b0b3「同盟港」
const s16b = v => (v << 16) >> 16;
const umin16 = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const bWarned = new Set();
const bTodo = n => { if (!bWarned.has(n)) { bWarned.add(n); console.warn("尚未移植: " + n); } };

export class Buildings {
  constructor(scene) {
    this.p = scene; this.c = scene.c; this.numpad = this.c.numpad ??= new NumPad(this.c); this.c.cargoUsed = s => this.cargoUsed(s); this.c.persons ??= new Array(0x50).fill(0);
    const T = scene.P.data.tavern, h = a => a.map(bHex);                 // port.json (tools/extract_port.py 由 MAIN.EXE 產生)
    this.T = { liquors: h(T.liquors), liquorPrice: T.liquorPrice, titles: h(T.titles), ottomanTitles: h(T.ottomanTitles),
      stats: h(T.stats), crewRoles: h(T.crewRoles), fmt: Object.fromEntries(Object.entries(T.fmt).map(([k, v]) => [k, bHex(v)])) };
    this.WF = Object.fromEntries(Object.entries(scene.P.data.wharf).map(([k, v]) => [k, bHex(v)]));   // 碼頭格式字串
    this.SY = Object.fromEntries(Object.entries(scene.P.data.shipyard).map(([k, v]) => [k, bHex(v)])); // 造船廠/船塢格式字串
    { const G = scene.P.data.bargirl, D = scene.P.data;                    // 酒吧女郎用表 (port.json bargirl / nations / goods)
      this.BG = { discCats: G.discCats.map(bHex), itemTypes: G.itemTypes.map(bHex), survey: G.surveyRange, nations: D.nations.map(bHex), goods: D.goods.map(bHex),
        ...Object.fromEntries(Object.entries(G.fmt).map(([k, v]) => [k, bHex(v)])) }; }
  }
  get st() { return this.c.state; }
  get port() { return this.st.u8(DS.PORT); }
  get hero() { return this.st.personRecord(this.st.hero); }           // [c2ce]
  get heroData() { return DS.TBL_HERO_DATA + this.st.hero * 0x0e; }             // seg0:5be8
  get money() { return (this.st.u16(DS.MONEY) | (this.st.u16(0x12b0) << 16)) | 0; }
  set money(v) { this.st.set16(DS.MONEY, v & 0xffff); this.st.set16(0x12b0, (v >>> 16) & 0xffff); }
  noEvent() { return this.st.u16(0x0de6) === 0 && this.st.u16(0x0d5c) === 0; }
  // ---------------- 共用 ----------------
  greet(n, ...args) {                                                    // seg0:8f03
    const { sys, win, con, message } = this.c;
    sys.mouseHide();
    win.frame(0x1e, 8, 0x1e, 0x80, 0);
    con.right = 0x38; con.left = 0x20; con.setCursor(0x20, 0x10);
    con.puts(B_SPEECH);
    message(n, ...args);
    sys.mouseShow();
  }
  async menu(items) {                                                    // 1b46e
    this.p.panels();
    return this.c.menu.listMenu(0x3c, 0x68, items, 1);
  }
  after() {                                                              // 1b580 → 1b496
    const s = this.c.scr, g = this.c.gfx;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
      s.glyphMode(k * 16 + 12, r * 64 + 0x88, 8, 0x40, g.subarray(0x3ca0), 1);
      s.glyphMode(k * 16 + 20, r * 64 + 0xa8, 8, 0x20, g.subarray(0x3ca0), 1);
      s.glyphMode(k * 16 + 20, r * 64 + 0x88, 8, 0x20, g.subarray(0x3da0), 1);
    }
  }
  table() {                                                              // 1b55c
    const { graph, con } = this.c;
    graph.draw(0x16, 0x68, 0x88);
    con.puts(B_COLOR);
    con.left = 0x0e; con.right = 0x3a;
  }
  async wait() { await this.c.menu.waitPrompt(); }                       // 0fea:490b
  // 人物對話視窗 seg0:7dac (col, y)
  talkWindow(col, y) {
    const { win, con } = this.c;
    win.save(col, y, 0x27, 0x90);
    win.frame(col, y, 0x27, 0x90, 0);
    con.right = col + 0x24; con.left = col + 0x0b; con.setCursor(col + 0x0b, y + 0x10);
  }
  // seg0:7f06 人物 n 發言 (>= 0x78 為隨機無名人物)
  talkPerson(n) {
    const { kao, scr, sys, state: st } = this.c;
    if (n >= 0x78) { this.talkWindow(0x14, 0xc0); kao.drawRandomType(scr, sys.rng, sys.rng.random(0x3fff) | 0xc000, 0x16, 0xd0); return; }
    this.talkWindow(0x14, 0xc0);
    kao.drawPerson(scr, st.bytes(st.personRecord(n), 0x32), 0x16, 0xd0);
  }
  // seg0:7e35 指定種類與部件的無名人物
  talkFace(type, parts) { this.talkWindow(0x14, 0xc0); this.c.kao.drawComposed(this.c.scr, type, parts, 0x16, 0xd0); }
  // seg0:909b → 9010: 依職位優先序 [3,4,5,2,6] 找艦隊中的船員發言
  crewSpeaks(order = [3, 4, 5, 2, 6]) {
    const st = this.st; let who = 0xff;
    for (let k = 0; k < 5; k++) {
      let found = false;
      for (let i = 0; i < 0x1e; i++) {
        const n = st.u8(DS.PARTY_CREW + i); if (n === 0xff) continue;
        who = n;
        if (st.u8(st.personRecord(n) + 0x2e) === order[k]) { found = true; break; }
      }
      if (found) break;
    }
    this.talkPerson(who);
    return who;
  }
  // 0fea:30a2 = 12f42: 本港可交談的人物 → [0538]; 都被排除時 [0538] = FF 並回傳原數量
  portPersons() {
    const L = this.portPersonsAll(), keep = L.filter(n => !(this.st.u8(this.st.personRecord(n) + 0x2f) & 0x10));
    if (!keep.length) { this.setPersons(L); this.c.persons[0] = 0xff; return L.length; }
    this.setPersons(keep); return keep.length;
  }
  // 12e5a: 在本港的人物 (主角除外, +31 bit5): 停留港 = 本港, 或在主角艦隊, 或所屬艦隊停泊在本港
  portPersonsAll() {
    const st = this.st, P = DS.TBL_PORT + this.port * 0x16, heroFleet = st.u8(this.hero + 0x2c), L = [];
    for (let i = 0; i < 0x78; i++) {
      if (i === st.hero) continue;
      const p = st.personRecord(i);
      if (!(st.u8(p + 0x31) & 0x20)) continue;
      const f = st.u8(p + 0x2c);
      if (st.u8(p + 0x2d) === this.port || f === heroFleet) { L.push(i); continue; }
      if (f >= 0x46) continue;
      const F = DS.TBL_FLEET + f * 0x85;
      if ((st.u8(F + OFF.FLEET.FLAGS) & 0x10) && st.u16(F) === st.u16(P) && st.u16(F + OFF.FLEET.Y) === st.u16(P + 2)) L.push(i);
    }
    return L;
  }
  // ---------------- 建築分派 ----------------
  async enter(k) {
    switch (k) {
      case 0: return (this.marketM ??= new Market(this)).run();
      case 1: return this.tavern();
      case 2: return this.shipyard();
      case 3: return this.wharf();
      case 4: return this.inn();
      case 5: return (this.palaceM ??= new Palace(this)).run();            // palace.js
      case 6: return (this.officeM ??= new Office(this)).run();            // office.js
      case 7: return (this.houseM ??= new House(this)).run();              // house.js
      case 8: return (this.bankM ??= new Bank(this)).run();                // bank.js (夏洛克銀行)
      case 9: return (this.itemM ??= new ItemShop(this)).run();            // itemshop.js
      case 10: return this.church();
      case 11: return this.fortune();
      default: bTodo(["交易所", "酒館", "造船廠", "碼頭", "旅館", "王宮", "事務所", "住宅", "銀行?", "道具店", "教會", "占卜師"][k] + " (1fd9 段建築 " + k + ")");
    }
  }
  // ================= 1 酒館 1fd9:78f5 =================
  get eco() { return DS.TBL_PORT_ECONOMY + this.port * 0x25; }                         // [c2dc] = seg0:5caa(港)
  fleetSlot(i) { return ListSelect.fleetSlot(this.st, i); }                // seg0:5c58
  // [0538] 是固定的字陣列: 只覆寫前 L.length 項, 後面保留舊值 (原版如此)
  setPersons(L) { const P = (this.c.persons ??= new Array(0x50).fill(0)); for (let i = 0; i < L.length; i++) P[i] = L[i]; }
  crewData(i) { return DS.TBL_CREW_SLOT + i * 0x1e; }                               // seg0:5c38 (+08/+09 配置比例, +1b 船長, +1c 士氣)
  // 0fea:2dea = 12c8a: 主角艦隊有船的位置 → [0538]
  fleetShips() {
    const L = []; for (let i = 0; i < 10; i++) if ((this.st.u8(this.fleetSlot(i) + 8) & 0x30) === 0x10) L.push(i);
    this.setPersons(L); return L.length;
  }
  dstr(a) { return Buildings.inState(a) ? this.st.cstr(a) : Uint8Array.of(0); }
  static inState(a) { return a >= DS.OPTIONS && a < DS.TRADE_LOGS; }
  // seg0:8894 後的金錢增減 (2553b: 上限 600000000)
  addMoney(v) { let m = this.money + v; if (m > 600000000) m = 600000000; this.money = m; this.p.panels(); }
  payMoney(v) { if ((v >>> 0) > (this.money >>> 0)) return 0; this.money = (this.money - v) | 0; this.p.panels(); return 1; }   // 25515
  // seg0:7eac 酒吧女郎頭像 (具名頭像 face) 與姓名
  talkGirl(face, rec) {
    const { kao, scr, printf } = this.c;
    this.talkWindow(0x14, 0xc0);
    kao.drawNamed(scr, face, 0x16, 0xd0);
    printf(this.T.fmt.girlName, this.dstr(rec));
  }
  // seg0:7ffc 對話視窗下半的訊息
  talkMessage2(n, ...args) {
    const { sys, con, scr } = this.c;
    sys.mouseHide();
    con.right = 0x38; con.left = 0x1f; con.setCursor(0x1f, 0xe8);
    con.puts(this.T.fmt.talk2);
    scr.fillCols(0x1f, 0xe8, 0x1b, 0x58, 7);
    this.c.message(n, ...args);
    sys.mouseShow();
  }
  // seg0:7f6e 清除對話視窗文字區 (發言者不變)
  talkClear() {
    const { con, scr } = this.c;
    con.right = 0x38; con.left = 0x1f; con.setCursor(0x1f, 0xd0);
    con.puts(B_COLOR);
    scr.fillCols(0x1f, 0xd0, 0x1b, 0x70, 7);
  }
  async closeTalk() { await this.c.win.close(); }                           // seg0:796d
  // 27592 / 275d2 本港的酒吧女郎 (DS:2bde, 每筆 0x13)
  tavernGirlA() {
    if (this.st.u8(this.hero + 0x31) & 0x10) return 0;
    for (let i = 0; i < 0x1e; i++) { const g = DS.TBL_BARMAID + i * 0x13, f = this.st.u8(g + 0x12); if (this.st.u8(g + 0x0e) === this.port && (f & 8) && (f & 0x40)) return g; }
    return 0;
  }
  tavernGirl() {
    for (let i = 0; i < 0x1e; i++) {
      const g = DS.TBL_BARMAID + i * 0x13, f = this.st.u8(g + 0x12);
      if (this.st.u8(g + 0x0e) === this.port && (f & 8) && !(f & 0x40)) {
        if ((this.st.u8(this.hero + 0x31) & 0x10) && !(this.st.u8(g + 0x12) & 1)) return 0;
        return g;
      }
    }
    return 0;
  }
  async tavern() {
    const { menu, palette } = this.c, st = this.st;
    this.tvA = Math.trunc(st.u8(this.hero + 0x22) / 3) & 0xff;             // [aee8]
    const girlA = this.tavernGirlA();                                        // [aeec]
    this.girl = this.tavernGirl();                                           // [aeee]
    const drink = this.T.liquors[st.u8(this.eco + 0x24)];
    if (this.noEvent()) {
      if (girlA) {
        this.talkGirl(0x61, DS.TBL_BARMAID);
        this.talkMessage2(0x11, this.dstr(this.hero), drink);
        await this.wait(); await this.closeTalk();
      } else this.greet(0x12, drink);
      if (this.girl) await this.girlHello();
    }
    const items = this.c.menuItems(15);
    let sel;
    do {
      if (st.u8(DS.DAILY_FLAGS) & 1) menu.disabled |= 1;
      if (!this.girl) menu.disabled |= 0x10;
      if (!this.fleetShips()) menu.disabled |= 3;
      sel = await this.menu(items);
      if (sel !== 0xff) await [() => this.hire(), () => this.dismiss(), () => this.drink(),
        () => this.chat(), () => this.barGirl(), () => (this.gambleG ??= new Gamble(this)).run()][sel]();
      this.after();
    } while (sel !== 0xff);
    palette.selectTimePalette(st.u8(DS.TIME), false, st.weather);             // 0fea:98ce
  }
  tvTodo(n) { bTodo(n); }
  // ---------- 對話視窗 (上方 = 主角/對象, 下方 = 店家/路人) ----------
  // seg0:7ed8 上方視窗 (0x0d, 0x10) 人物 n 發言; n >= 0x78 為隨機無名人物 (7df5)
  talkTop(n) {
    const { kao, scr, sys, state: st } = this.c;
    this.talkWindow(0x0d, 0x10);
    if (n >= 0x78) kao.drawRandomType(scr, sys.rng, sys.rng.random(0x3fff) | 0xc000, 0x0f, 0x20);
    else kao.drawPerson(scr, st.bytes(st.personRecord(n), 0x32), 0x0f, 0x20);
  }
  // seg0:7f34 清除上方視窗文字區
  talkClearTop() {
    const { con, scr } = this.c;
    con.right = 0x31; con.left = 0x18; con.setCursor(0x18, 0x20);
    con.puts(this.T.fmt.talk3);
    scr.fillCols(0x18, 0x20, 0x1b, 0x70, 7);
  }
  // seg0:7e15 下方視窗, 隨機無名人物
  randomTalk() { const { kao, scr, sys } = this.c; this.talkWindow(0x14, 0xc0); kao.drawRandomType(scr, sys.rng, sys.rng.random(0x3fff) | 0xc000, 0x16, 0xd0); }
  // ================= 酒館: 飲酒敘話 1fd9:5f16 =================
  async drink() {
    const st = this.st, k = st.u8(this.eco + 0x24), price = this.T.liquorPrice[k];
    this.greet(0x13, this.T.liquors[k], price);
    let si = (this.money % 10000) & 0xffff;                                // _lmod
    if (this.money >= 10000) si = (si + 10000) & 0xffff;
    const v = await this.numpad.input(0, umin16(50, Math.trunc(s16b(si) / price)));
    if (!v) return;
    const heat = Math.trunc(((v * 200) & 0xffff) / st.u16(this.eco));       // div word [商業價值]
    const d = Math.trunc(s16b(heat * st.u8(this.hero + 0x22)) / 10) + this.tvA;
    this.tvA = umin16(100, d);
    this.payMoney(s16b(price * v));
    await this.rumor(heat);
  }
  // 25d99 傳聞 (heat = 飲酒量換算)
  async rumor(heat) {
    const st = this.st, { message, sys } = this.c, H = this.hero, D = this.heroData, kinds = this.c.menuItems(10);
    let fame = 0, di = 0;
    for (let i = 0; i < 3; i++) if (st.u16(D + i * 2) > fame) { di = i; fame = st.u16(D + i * 2); }
    this.randomTalk();
    if (fame < 1000) message(0x24);
    else if (fame < 5000) message(0x84, kinds[di], this.dstr(H), this.dstr(H + OFF.PERSON.FAMILY_NAME));
    else message(0x85, this.dstr(H), this.dstr(H + OFF.PERSON.FAMILY_NAME));
    await this.wait();
    let done = false;
    if (st.u8(DS.COMMON_CHAP)) done = await this.rumorScenario();
    else if ((st.u8(WorkDS.FLAGS) & 3) && !(st.u8(WorkDS.FLAGS) & 4)) { await this.rumorNation(); st.set8(WorkDS.FLAGS, st.u8(WorkDS.FLAGS) | 2); done = true; }
    if (!done) {
      let found = -1;
      if (sys.rng.random(200) < st.u8(H + 0x23))
        for (let i = 0; i < 7; i++) {
          if (!sys.rng.random(3)) continue;
          const v = st.u8(DS.TBL_COUNTRY + i * 0x20 + 3);
          if (v === 3 || v === 7) { found = i; break; }
        }
      if (found >= 0) { this.talkClear(); message(0x25); message(0x28, this.p.nations[found]); await this.wait(); }
      else if (sys.rng.random((0x514 - 12 * heat) & 0xffff) > st.u16(this.eco)) await this.rumorPort();
      else await this.rumorTrade();
    }
    await this.closeTalk();
  }
  // 25d56 本國的消息
  async rumorNation() {
    const { message } = this.c;
    this.talkClear(); message(0x199); message(0x19a + (this.st.u8(this.hero + 0x31) & 15)); message(0x1a0);
    await this.wait();
  }
  // 25a99 隨機鄰近港口 (本港 ± random(5), 跳過 +15 bit4 的港) 的情報, 最多試 10 次
  async rumorPort() {
    const st = this.st, rng = this.c.sys.rng, port = this.port;
    for (let n = 0; n < 10; n++) {
      const a = rng.random(5), b = rng.random(2);
      if (!b && a > port) continue;
      if (b && a + port > 0x63) continue;
      const q = (b ? port + a : port - a) & 0xff;
      if (st.u8(DS.TBL_PORT + q * 0x16 + 0x15) & 0x10) continue;
      return this.portInfo(q);
    }
  }
  // 25a1a 港口 q 的位置與特產
  async portInfo(q) {
    const st = this.st, { message } = this.c, P = DS.TBL_PORT + q * 0x16, E = DS.TBL_PORT_ECONOMY + q * 0x25;
    this.talkClear();
    message(0x25);
    this.latLong(st.u16(P), st.u16(P + 2));
    message(0x82, st.cstr(P + 4));
    await this.wait();
    this.talkClear();
    if (st.u8(E + 0x1a) !== 0xff) message(0x83, this.p.goods[st.u8(E + 0x1a)]); else message(0x2e6);
    await this.wait();
  }
  // 253b4 座標 → 緯度 (北/南 0x7e/0x7f) 與經度 (東/西 0x80/0x81)
  latLong(x, y) {
    const { message } = this.c, v = s16b(0x280 - s16b(y));
    let di = 0x80, si = (s16b(x) + 0x7bd) % 0x870;
    if (si > 0x438) { di = 0x81; si = 0x870 - si; }
    message(v >= 0 ? 0x7e : 0x7f, Math.trunc(s16b(Math.abs(v) << 3) / 0x39));
    message(di, Math.trunc(si / 6));
  }
  // 25ba4 隨機艦隊 (0x52d4 + 0x1e×random(10)) 的 +16..+1a 商品; 試 50 次都沒有就改說港口情報
  async rumorTrade() {
    const st = this.st, rng = this.c.sys.rng;
    let m = 0, k = 0;
    for (let n = 0; n < 0x32; n++) { m = DS.TBL_CREW_SLOT + rng.random(10) * 0x1e; k = rng.random(5); if (st.u8(m + 0x16 + k) !== 0xff) break; }
    if (st.u8(m + 0x16 + k) !== 0xff) await this.rumorGoods(st.u8(m + 0x16 + k)); else await this.rumorPort();
  }
  // 25b17 商品 g 最貴的地區 (物價表 0x78f4 + 0x80×地區, 8 區)
  async rumorGoods(g) {
    const st = this.st, rng = this.c.sys.rng, { message } = this.c;
    let top = 0, best = 0;
    for (let r = 0; r < 8; r++) { const v = s16b(st.u16(DS.TBL_REGION_PRICE + r * 0x80 + g * 2)); if (v > top && rng.random(8)) { top = v; best = r; } }
    this.talkClear(); message(0x34e, this.p.goods[g]); message(0x181 + best); message(0x34f);
    await this.wait();
  }
  // 25c01 劇本進行中 ([0d5e]) 的特別傳聞
  async rumorScenario() {
    const st = this.st, { message } = this.c, ev = s16b(st.u16(WorkDS.CUR_KIND)), who = st.u16(WorkDS.TARGET_PERSON), item = st.u16(WorkDS.TARGET_ITEM);
    if (ev === 0x0b && who !== 0xff)
      for (let i = 0; i < 0x14; i++) { const v = st.u8(DS.INVENTORY + i); if (((v - item) & 0xff) === 0xf6 || v === (item & 0xff)) return false; }
    if (!((ev === 0x0b && who !== 0xff) || ev === 5)) return false;
    if (s16b(who) % 3 !== this.port % 3) return false;
    const M = st.personRecord(who & 0xff);
    if (st.u8(M + 0x2d) !== 0xff) {
      const P = DS.TBL_PORT + st.u8(M + 0x2d) * 0x16;
      this.talkClear(); message(0x257, this.dstr(M), this.dstr(M + 0x0d), st.cstr(P + 4)); await this.wait();
      this.talkClear(); message(0x258, st.cstr(P + 4)); this.latLong(st.u16(P), st.u16(P + 2)); message(0x259);
    } else {
      const kinds = this.c.menuItems(11), f = st.u8(M + 0x2c), r = f % 10;
      this.talkClear(); message(0x25a, this.dstr(M), this.dstr(M + 0x0d), this.p.nations[Math.trunc(f / 10)], kinds[r ? Math.trunc(r / 5) + 1 : 0]);
      await this.wait();
      this.talkClear(); message(0x25b);
    }
    await this.wait();
    return true;
  }
  // ================= 酒館: 與航海者閒聊 1fd9:68ff =================
  async chat() {
    const st = this.st, list = (this.c.listSel ??= new ListSelect(this.c));
    for (;;) {
      const n = await this.chatList();
      if (!n) return;
      this.after();                                                        // 268d4
      const r = await list.select(0x86, n);
      const who = r === -1 ? 0xff : this.c.persons[r] & 0xff;
      if (who === 0xff) return;
      this.mate = st.personRecord(who);                                    // [aeea]
      this.talkPerson(who);
      this.mateNo = who;                                                   // [bb38]
      await this.chatMenu();
      await this.closeTalk();
    }
  }
  // 0fea:3048 = 12ee8: 本港人物中 +2f bit4 的 (酒館裡的航海者); 都沒有時 [0538] = FF 並回傳原數量
  tavernPersons() {
    const L = this.portPersonsAll(), keep = L.filter(n => this.st.u8(this.st.personRecord(n) + 0x2f) & 0x10);
    if (!keep.length) { this.setPersons(L); this.c.persons[0] = 0xff; return L.length; }
    this.setPersons(keep); return keep.length;
  }
  // 26890
  async chatList() {
    const { message } = this.c, n = this.tavernPersons();
    if (n && this.c.persons[0] !== 0xff) return n;
    if (this.tvA >= 0x32) { this.randomTalk(); message(0x26); } else { this.crewSpeaks(); message(0x27); }
    await this.wait(); await this.closeTalk();
    return 0;
  }
  // 2682c
  async chatMenu() {
    if (!(await this.chatIntro())) return;
    const items = this.c.menuItems(12).slice(0, 3);                      // 「決鬥」不在酒館 (bl = 3)
    let sel;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff && !(await [() => this.treat(), () => this.mateInfo(), () => this.mateHire(1)][sel]())) sel = 0xff;
    } while (sel !== 0xff);
  }
  // 26000 對象的自我介紹; 回傳 0 = 已是自己的船員
  async chatIntro() {
    const st = this.st, { message, sys } = this.c, M = this.mate;
    this.aef0 = 0;
    if (st.u8(this.hero + 0x2c) === st.u8(M + 0x2c)) { const r = sys.rng.random(3); message(r === 0 ? 0x86 : r === 1 ? 0x87 : 0x88); await this.wait(); return 0; }
    const f = st.u8(M + 0x2c);
    if (f < 0x46 && f >= 0x3c) { message(0x35b + sys.rng.random(2)); await this.wait(); this.aef0 = 1; return 1; }
    message(0x29); await this.wait();
    this.talkClear();
    if (f === 0xff) message(0x2b);
    else {
      const kinds = this.c.menuItems(11), r = f % 10, kind = kinds[r ? Math.trunc(r / 5) + 1 : 0], nation = this.p.nations[Math.trunc(f / 10)];
      message(0x2a);
      if (st.u8(M + 0x2e) === 1) message(0x89, nation, kind, this.dstr(M));
      else message(0x8a, nation, kind, this.T.crewRoles[st.u8(M + 0x2e)], this.dstr(M));
    }
    await this.wait();
    return 1;
  }
  // [0d5e] 劇本中, 對象是劇本人物時: 回傳 null = 沒有劇本動作
  async mateScenario(needItem) {
    const st = this.st, ev = s16b(st.u16(WorkDS.CUR_KIND));
    if (!st.u8(DS.COMMON_CHAP) || st.u8(WorkDS.TARGET_PERSON) !== this.mateNo) return null;
    if (ev === 0x0b && (!needItem || st.u16(WorkDS.TARGET_ITEM))) { this.talkPerson(this.mateNo); await this.questItem(); await this.closeTalk(); return 1; }
    if (ev === 5 && st.u16(WorkDS.TARGET_ITEM)) return this.questReward();
    return null;
  }
  // 2633b 請客喝酒
  async treat() {
    const st = this.st, { message } = this.c, k = st.u8(this.eco + 0x24), price = this.T.liquorPrice[k], M = this.mate, H = this.hero;
    if (this.money < price) { this.talkClear(); message(0x4c); await this.wait(); return 1; }
    this.payMoney(price);
    const sc = await this.mateScenario(true); if (sc !== null) return sc;
    this.talkClear();
    let mul;
    if (!((st.u8(H + OFF.PERSON.FLAGS) ^ st.u8(M + 0x2f)) & 3)) { message(0x331 * this.aef0 + 0x2c); mul = 3; } else { message(0x330 * this.aef0 + 0x2d); mul = 1; }
    await this.wait();
    st.set8(M + 0x2b, umin16(((st.u8(M + 0x2f) & 0x40 ? 2 : 1) * 6 * mul + st.u8(M + 0x2b)) & 0xffff, 100));
    let mx = 0, di = 0;
    for (let i = 0; i < 5; i++) if (st.u8(M + 0x1c + i) > mx) { di = i; mx = st.u8(M + 0x1c + i); }
    if (st.u8(M + 0x2b) > 0x1e && mx > 0x4b) { this.talkClear(); message(0x2e); message(0x8b, this.T.stats[di]); await this.wait(); }
    return 1;
  }
  // 264a0 航海者情報: 附近港口 (本港 + random(8) − random(4)) 停留的人物
  async mateInfo() {
    const st = this.st, { message, sys } = this.c;
    const sc = await this.mateScenario(false); if (sc !== null) return sc;
    let q = umin16(0x63, sys.rng.random(8) + this.port);
    q = (q - umin16(sys.rng.random(4), q)) & 0xff;
    let i = 0, rec = st.personRecord(0);
    for (; i < 0x78; i++, rec += 0x32) if (st.u8(rec + 0x2d) === q && (st.u8(rec + 0x31) & 0x20)) break;
    const P = DS.TBL_PORT + q * 0x16;
    this.talkClear();
    if (q === this.port) message(0x2f, this.T.liquors[st.u8(this.eco + 0x24)]);
    else if (i !== 0x78) message(0x23a, st.cstr(P + 4), this.dstr(rec + 0x0d));
    else message(0x23b, st.cstr(P + 4));
    await this.wait();
    return 1;
  }
  // 26708 僱用 (strict: 需要好感 > 30)
  async mateHire(strict) {
    const st = this.st, { message, sys } = this.c, M = this.mate, H = this.hero;
    const sc = await this.mateScenario(false); if (sc !== null) return sc;
    this.talkTop(st.hero); message(0x30); await this.wait(); await this.closeTalk();
    if (!(await this.mateHireCheck(strict))) return 1;
    let mx = 0, di = 0;
    for (let i = 0; i < 7; i++) if (st.u8(M + 0x1c + i) > mx) { di = i; mx = st.u8(M + 0x1c + i); }
    const worth = s16b(st.u8(M + 0x1c + di) * (st.u8(M + 0x24) + st.u8(M + 0x25)));
    let need = s16b(st.u8(H + OFF.PERSON.STATS + di) * (st.u8(H + OFF.PERSON.NAV_LEVEL) + st.u8(H + OFF.PERSON.BATTLE_LEVEL)));
    need = (need + Math.trunc(s16b(need * st.u8(this.heroData + 0x0d)) / 10)) & 0xffff;
    if (((sys.rng.random(0x14) + worth) & 0xffff) < need) return this.mateFee(worth);
    this.talkClear(); message(0x91); await this.wait();
    return 1;
  }
  // 265bd
  async mateHireCheck(strict) {
    const st = this.st, { message } = this.c, M = this.mate;
    const no = async n => { this.talkClear(); message(n); await this.wait(); return 0; };
    if (st.u8(M + 0x2e)) return no(0x31);
    let free = false; for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) === 0xff) free = true;
    if (!free) return no(0x8c);
    if (strict && st.u8(M + 0x2b) <= 0x1e) return no(0x8d);
    return 1;
  }
  // 26628 談薪水; 回傳 0 = 已僱用 (結束選單)
  async mateFee(worth) {
    const st = this.st, { message, menu, sys } = this.c, M = this.mate;
    const r = sys.rng.random(3);
    const fee = (umin16(Math.trunc(worth / 400) + r + 1, 0x14) * 10) & 0xff;
    this.talkClear(); message(0x8e, fee);
    if (!(await menu.yesNo())) { this.talkClear(); message(0x8f); await this.wait(); return 1; }
    this.talkClear(); message(0x90); await this.wait();
    st.set8(M + 0x2d, 0xff); st.set8(M + 0x2c, st.u8(this.hero + 0x2c)); st.set8(M + 0x2e, 6);
    st.set8(M + 0x2b, umin16(st.u8(M + 0x2b) + 10, 100));
    for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) === 0xff) { st.set8(DS.PARTY_CREW + i, this.mateNo); st.set8(0x2e39 + i, Math.trunc(fee / 10)); break; }
    return 0;
  }
  // 2614f 劇本: 向對象買劇本道具 [0d8c] (1000 金)
  async questItem() {
    const st = this.st, { message, menu } = this.c, item = st.u8(WorkDS.TARGET_ITEM);
    const end = async n => { message(n); await this.wait(); };
    for (let i = 0; i < 0x14; i++) if (((st.u8(DS.INVENTORY + i) - item) & 0xff) === 0xf6) return end(0x36f);
    message(0x25c, st.cstr(DS.TBL_ITEM + item * 0x14)); await this.wait();
    this.talkClear(); message(0x25d);
    if (!(await menu.yesNo())) return;
    if (this.money < 1000) { this.talkClear(); return end(0x25f); }
    this.talkClear(); message(0x25e); await this.wait();
    for (let i = 0; i < 0x14; i++) if (st.u8(DS.INVENTORY + i) === 0xff) {
      const v = (item - 10) & 0xff; st.set8(DS.INVENTORY + i, v);
      const Q = DS.TBL_DISCOVERY + st.u8(DS.TBL_ITEM + v * 0x14 + 0x12) * 7; st.set8(Q + 6, st.u8(Q + 6) | 0x20);
      this.money = (this.money - 1000) | 0; this.p.panels();
      return;
    }
    this.talkClear(); return end(0x370);
  }
  // 26246 劇本: 交付後的報酬 (或被騙)
  async questReward() {
    const st = this.st, { message, sys } = this.c, M = this.mate;
    this.talkTop(st.hero); message(0x260, this.dstr(M), this.dstr(M + 0x0d)); await this.wait();
    if (sys.rng.random(100) > st.u8(this.hero + 0x23) && !sys.rng.random(3)) {
      this.talkClear(); message(0x262); await this.wait();
      this.talkClearTop(); message(0x265); await this.wait(); await this.closeTalk();
      st.set8(M + 0x2d, st.u8(M + 0x2d) >= 0x2a ? sys.rng.random(0x3a) + 0x2a : sys.rng.random(0x2a));
      return 0;
    }
    const n = s16b(st.u16(0x0d8e));
    this.talkClear(); message(0x261, s16b(5 * n)); await this.wait();
    this.talkClearTop(); message(0x266); await this.wait(); await this.closeTalk();
    this.money = (this.money + 50000 * n) | 0;
    st.set16(WorkDS.TARGET_ITEM, 0); this.p.panels();
    return 1;
  }

  // 2761f 女郎招呼
  async girlHello() {
    if (!(this.st.u8(this.hero + 0x31) & 0x10)) return;
    const g = this.girl;
    this.talkGirl(Math.trunc((g - DS.TBL_BARMAID) / 0x13) + 0x61, g);
    this.talkMessage2(this.st.u8(g + 0x10) !== 0xff && this.st.u8(g + 0x11) === 0 ? 0x133 : 0x134);
    await this.wait(); await this.closeTalk();
  }
  // ================= 酒館: 酒吧女郎 1fd9:75a7 (RE_NOTES 17.8) =================
  // 先付 10 (不足 → 9076 + 0x93); MENU #14 (主角 +31 bit4 時沒有前兩項); 子功能 DS:af62 = 26941 / 26a64 / 26ece / 272c5
  // 女郎記錄 DS:2bde + 0x13×i: +0d 年齡 +0e 所在港 +0f 好感 +10 調查委託 (低 4 位 = 國家, 高 4 位 = 種類; FF = 無) +11 剩餘天數 +12 旗標 (bit0, bit4-5 = 性格)
  girlFace() { return Math.trunc((this.girl - DS.TBL_BARMAID) / 0x13) + 0x61; }
  async barGirl() {
    const st = this.st, g = this.girl, all = this.c.menuItems(14), items = [], kinds = [];
    if (!(st.u8(this.hero + 0x31) & 0x10)) { items.push(all[0], all[1]); kinds.push(0, 1); }
    items.push(all[2], all[3]); kinds.push(2, 3);
    this.greet(0x92, this.dstr(g));
    await this.wait();
    if (this.money < 10) { this.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(0x93); await this.wait(); await this.closeTalk(); return; }
    this.money = this.money - 10;
    for (;;) {
      const sel = await this.menu(items);
      if (sel === 0xff) return;
      const k = kinds[sel];
      if (k !== 1) this.talkGirl(this.girlFace(), g);
      await [() => this.girlVoyage(), () => this.girlGift(), () => this.girlSurvey(), () => this.girlInfo()][k]();
      if (k !== 1) await this.closeTalk();
    }
  }
  // 26941 航海見聞: 已知 (+6 bit5) 未發現 (+6 bit7) 的發現物 (DS:7f8c + 7×i, 90 筆) → 清單 0x12 → 發現物資料 → 好感 + (+5 / 10 + 1) (每天一次: [0cb0] bit6)
  async girlVoyage() {
    const st = this.st, g = this.girl, lvl = (st.u8(g + 0x12) & 0x30) >> 4, L = [];
    const MSG = [0x13a, 0x13b, 0x13c, 0x13d, 0x13e, 0x13f, 0x140, 0x13b];
    for (let i = 0; i < 0x5a; i++) { const f = st.u8(DS.TBL_DISCOVERY + i * 7 + 6); if (!(f & 0x80) && (f & 0x20)) L.push(i); }
    if (!L.length) { this.talkMessage2(0x138); await this.wait(); return; }
    this.setPersons(L);
    const r = await this.listSel().select(0x92, L.length);
    if (r === -1) return;
    const n = this.c.persons[r] & 0xff, d = DS.TBL_DISCOVERY + n * 7;
    await this.discInfo(n);
    let v = (Math.trunc(st.u8(d + 5) / 10) + 1) & 0xff;
    this.talkMessage2(0x139);
    if (lvl >= 2) { v = (v << 1) & 0xff; this.c.message(MSG[st.u8(d + 6) & 7]); st.set8(DS.DAILY_FLAGS, st.u8(DS.DAILY_FLAGS) & 0xbf); }
    await this.wait();
    if (!(st.u8(DS.DAILY_FLAGS) & 0x40)) { st.set8(g + 0x0f, umin16(st.u8(g + 0x0f) + v, 100)); st.set8(DS.DAILY_FLAGS, st.u8(DS.DAILY_FLAGS) | 0x40); }
  }
  // 2e09:681c (348ac → 347a0) 發現物資料視窗: COLONY.DAT 第 n 筆 (+0 名稱, +0f 圖, +10 說明), 種類 DS:0952[+6 & 7], 重要度 MENU #0x22[+5 / 25]
  async discInfo(n) {
    const st = this.st, { con, printf, kao, scr, win } = this.c, B = this.BG, d = DS.TBL_DISCOVERY + n * 7;
    st.set8(DS.DISCOVERY_ID, n);                                                      // 348ac: [8246] = 發現物編號
    const imp = this.c.menuItems(0x22), rec = ListSelect.colonyRec(this.c, n);
    await win.open(0x0f, 0x20, 0x1c, 0xd0, 0);                              // seg0:74f7
    kao.drawItem(scr, rec[0x0f], 0x11, 0x30);                               // seg0:7d4c
    con.puts(B.discHdr);
    con.setCursor(0x18, 0x30); printf(B.s, rec);
    con.setCursor(0x20, 0x48); printf(B.cat, B.discCats[st.u8(d + 6) & 7]);
    con.setCursor(0x18, 0x58); printf(B.imp, imp[Math.trunc(st.u8(d + 5) / 0x19)] ?? Uint8Array.of(0));
    con.left = 0x11; con.right = 0x28; con.lineH = 0x10;
    con.setCursor(0x13, 0x70); printf(B.s, rec.subarray(0x10));
    await this.wait(); await this.closeTalk();
    con.lineH = 0x18;
  }
  // 26a64 送她禮物: 隨身物 (DS:2e57, 20 格) 中種類 0x0a / 0x0b 的 (0fea:32ca) → 清單 0x0d → 道具資料 → 是/否
  async girlGift() {
    const st = this.st, g = this.girl, lvl = (st.u8(g + 0x12) & 0x30) >> 4, L = [];
    for (let i = 0; i < 0x14; i++) { const it = st.u8(DS.INVENTORY + i); if (it === 0xff) continue; const t = st.u8(DS.TBL_ITEM + it * 0x14 + 0x13) & 0x0f; if (t === 0x0a || t === 0x0b) L.push(it); }
    if (!L.length) {
      this.talkGirl(this.girlFace(), g);
      this.talkMessage2(st.u8(g + 0x12) & 1 ? 0x14a : 0x14b);
      await this.wait(); await this.closeTalk(); return;
    }
    this.setPersons(L);
    let it;
    for (;;) {
      const r = await this.listSel().select(0x8d, L.length);
      if (r === -1) return;
      this.table();                                                        // 0fea:b6bc
      it = this.c.persons[r] & 0xff;
      this.itemInfo(it, 0);
      if (await this.c.menu.yesNo()) break;
    }
    this.talkGirl(this.girlFace(), g);
    const R = DS.TBL_ITEM + it * 0x14, t = st.u8(R + 0x13) & 0x0f;
    this.talkMessage2(0x141);
    let add = umin16(st.u8(R + 0x12), 10), m = 0;
    if (lvl === 0) { if (t === 0x0a) m = 0x142; } else if (lvl === 1) { if (t === 0x0b) m = 0x143; } else if (lvl === 3) m = 0x144;
    if (m) {
      this.c.message(m); add = (add << 1) & 0xff;
      if (st.u8(g + 0x0f) >= 0x50) { await this.wait(); this.talkMessage2(0x145); }
    }
    await this.wait();
    st.set8(g + 0x0f, umin16(st.u8(g + 0x0f) + add, 100));
    for (let i = 0; i < 0x14; i++) if (st.u8(DS.INVENTORY + i) === it) { st.set8(DS.INVENTORY + i, 0xff); break; }
    await this.closeTalk();
  }
  // 29340 道具資料 (隨身物 it; flag ≠ 0 且已裝備 (+13 bit4) 時加「裝備」): 名稱 (種類), 圖 (KAO 小圖 +0f + 0x55), 攻擊力 / 防禦力 (MENU #0x22), ITEM.MES 說明
  itemInfo(it, flag) {
    const st = this.st, { con, printf, kao, scr, font } = this.c, B = this.BG, R = DS.TBL_ITEM + it * 0x14, t = st.u8(R + 0x13) & 0x0f, v = st.u8(R + 0x12);
    const desc = font.encode(this.c.portAssets.itemMes[it]);
    con.setCursor(0x10, 0x90); printf(B.itemHdr, st.cstr(R), B.itemTypes[t]);
    kao.drawItem(scr, st.u8(R + 0x0f) + 0x55, 0x10, 0xc0);
    if (flag && (st.u8(R + 0x13) & 0x10)) con.puts(B.equip);
    const lv = this.c.menuItems(0x22);
    con.setCursor(0x10, 0xa8);
    if (t <= 3) printf(B.atk, lv[v >= 0x23 ? 4 : Math.trunc((v - 5) / 6)]);
    if (t === 6) printf(B.def, lv[v > 0x28 ? 4 : Math.trunc((v - 10) / 10)]);
    con.puts(B.color0);
    con.right = 0x35; con.lineH = 0x10; con.left = 0x1e; con.setCursor(0x1e, 0xb0);
    con.puts(desc);
    con.lineH = 0x18;
  }
  // 26ece 調查結果: 已委託 → 還在調查 (0x219) 或報告 (26cb4); 未委託 → 好感需 ≥ 80 / (+12 bit0 + 1) (主角 +31 bit4 免) → 委託 (26bdc)
  async girlSurvey() {
    const st = this.st, g = this.girl;
    if (st.u8(g + 0x10) !== 0xff) {
      if (st.u8(g + 0x11)) { this.talkMessage2(0x219); await this.wait(); } else await this.surveyReport();
      return;
    }
    const f = st.u8(g + 0x12) & 1;
    if (!(st.u8(this.hero + 0x31) & 0x10) && (Math.trunc(0x50 / (f + 1)) & 0xff) > st.u8(g + 0x0f)) { this.talkMessage2(0x215); await this.wait(); return; }
    await this.surveyAsk();
  }
  // 26bdc 委託調查: 國家 (DS:08de) → 種類 (MENU #0x2c, 海盜為 #0x2d) → 天數 = random(3) + (110 − 好感) / ((主角 +31 bit4 + 1) × 5)
  async surveyAsk() {
    const st = this.st, g = this.girl;
    this.talkMessage2(0x216);
    const n = await this.menu(this.BG.nations);
    if (n === 0xff) return;
    st.set8(g + 0x10, n);
    this.talkMessage2(0x217);
    const k = await this.menu(this.c.menuItems(n === 6 ? 0x2d : 0x2c));
    if (k === 0xff) { st.set8(g + 0x10, 0xff); return; }
    st.set8(g + 0x10, st.u8(g + 0x10) | (k << 4));
    const r = this.c.sys.rng.random(3), div = ((st.u8(this.hero + 0x31) & 0x10) + 1) * 5;
    st.set8(g + 0x11, (r + Math.trunc(s16b(0x6e - st.u8(g + 0x0f)) / div)) & 0xff);
    this.talkMessage2(0x218, st.u8(g + 0x11));
    await this.wait();
  }
  // 26cb4 調查報告: 該國艦隊 nat×10 + [af52[k] .. af52[k+1]) (seg0:5c28 = DS:2e76 + 0x85×n): 提督、任務 (+1b, 跳躍表 cs:704b)、貨物 (+21)、位置
  async surveyReport() {
    const st = this.st, g = this.girl, { message } = this.c, v = st.u8(g + 0x10), nat = v & 0x0f, k = v >> 4;
    const items = this.c.menuItems(nat === 6 ? 0x2d : 0x2c);
    this.talkMessage2(0x21a); await this.wait();
    if (nat !== 6) { this.talkMessage2(0x21b, this.BG.nations[nat]); message(0x21c, items[k]); } else this.talkMessage2(0x21c, items[k]);
    await this.wait();
    const lo = this.BG.survey[k], hi = this.BG.survey[k + 1];
    for (let i = lo; i < hi; i++) {
      const F = DS.TBL_FLEET + ((nat * 10 + i) & 0xff) * 0x85;
      if (!(st.u8(F + OFF.FLEET.FLAGS) & 1)) { message(0x22c, i - lo + 1); await this.wait(); continue; }
      const t = st.u8(F + OFF.FLEET.MISSION), q = st.u8(F + OFF.FLEET.TARGET);
      const port = () => this.dstr(DS.TBL_PORT + q * 0x16 + 4), who = () => this.dstr(st.personRecord(q) + 0x0d);
      this.talkMessage2(0x21d, this.dstr(st.personRecord(st.u8(F + OFF.FLEET.ADMIRAL)) + 0x0d));
      if (t <= 2) message(0x21e, port()); else if (t === 3) message(0x226, port()); else if (t === 4) message(0x227);
      else if (t <= 7) message(0x21f, who()); else if (t === 8) message(0x225, who()); else if (t === 9) message(0x224, port());
      await this.wait();
      if (st.u8(F + OFF.FLEET.CARGO_GOOD) !== 0xff) { this.talkMessage2(0x220, this.BG.goods[st.u8(F + OFF.FLEET.CARGO_GOOD)]); await this.wait(); }
      this.talkMessage2(0x229); this.latLong(st.u16(F), st.u16(F + OFF.FLEET.Y)); message(0x22a);
      await this.wait();
    }
    st.set8(g + 0x10, 0xff); st.set8(g + 0x11, 0xff);
  }
  // 272c5 探聽情報: MENU #0x0d (工作的情報 / 她的喜好 / 她的芳齡), 劇本進行中 ([0d5e] 且 [0d5f]) 才能選第一項; 子功能 DS:af56 = 26f2f / 27224 / 27299
  async girlInfo() {
    const st = this.st, menu = this.c.menu, items = this.c.menuItems(0x0d);
    this.talkMessage2(0x18e);
    for (;;) {
      if (!st.u8(DS.COMMON_CHAP) || !st.u8(DS.COMMON_SEC)) menu.disabled = 1;
      const sel = await this.menu(items);
      if (sel === 0xff) return;
      await [() => this.girlWork(), () => this.girlLikes(), () => this.girlAge()][sel]();
    }
  }
  // 27224 她的喜好: random(50) < 好感 → 0x195 + 性格, 好感 + (性格 & ~1) + 2
  async girlLikes() {
    const st = this.st, g = this.girl, lvl = (st.u8(g + 0x12) & 0x30) >> 4, inc = (lvl & 0xfe) + 2;
    if (this.c.sys.rng.random(0x32) < st.u8(g + 0x0f)) { this.talkMessage2(0x195 + lvl); st.set8(g + 0x0f, umin16(st.u8(g + 0x0f) + inc, 100)); }
    else this.talkMessage2(0x193);
    await this.wait();
  }
  // 27299 她的芳齡: 好感 > 80 才說
  async girlAge() {
    const st = this.st, g = this.girl;
    if (st.u8(g + 0x0f) > 0x50) this.talkMessage2(0x194, st.u8(g + 0x0d)); else this.talkMessage2(0x193);
    await this.wait();
  }
  // 26f2f 工作的情報 (劇本): [0d74] 目前的劇本任務, [0d8a] 目標港 / [0d8c] 目標 (道具 / 商品 / 國家)
  async girlWork() {
    const st = this.st, g = this.girl, { message, sys } = this.c, t = st.u16(WorkDS.CUR_KIND), a = st.u8(WorkDS.TARGET_PERSON), c8 = st.u16(WorkDS.TARGET_ITEM);
    const end = async m => { this.talkMessage2(m); await this.wait(); };
    if (t === 0x0c || t === 4) return this.surveyAsk();
    if (t === 9) return end(0x24a);
    if (t === 0x0a) return end(0x24b);
    if (t === 0x0b) {
      for (let i = 0; i < 0x14; i++) {
        const it = st.u8(DS.INVENTORY + i);
        if (((it - c8) & 0xff) === 0xf6) { this.talkMessage2(0x3fa, this.dstr(DS.TBL_ITEM + it * 0x14)); return; }
        if (it === (c8 & 0xff)) {
          this.talkMessage2(0x3fb, this.dstr(DS.TBL_ITEM + it * 0x14));
          if (!(st.u8(DS.DAILY_FLAGS) & 0x40)) { st.set8(g + 0x0f, umin16(st.u8(g + 0x0f) + 10, 100)); st.set8(DS.DAILY_FLAGS, st.u8(DS.DAILY_FLAGS) | 0x40); }
          return;
        }
      }
      return end(st.u16(WorkDS.TARGET_PERSON) === 0xff ? 0x24c : 0x24d);
    }
    if (t === 5) return end(0x24d);
    const P = DS.TBL_PORT + a * 0x16, E = DS.TBL_PORT_ECONOMY + a * 0x25;
    const where = async () => { this.latLong(st.u16(P), st.u16(P + 2)); message(0x252); await this.wait(); };
    if (t === 3) { this.talkMessage2(0x24e); return where(); }
    if (t === 7 || t === 8) {
      if (a === st.u8(DS.PORT)) return end(0x249);
      this.talkMessage2(s16b(c8) >= 4 ? 0x250 : 0x24f, this.BG.nations[c8]);
      message(0x251, this.dstr(P + 4)); return where();
    }
    const lucky = () => { const r = sys.rng.random(0x96); return st.u8(this.hero + 0x22) + st.u8(g + 0x0f) > r || (st.u8(this.hero + 0x31) & 0x10); };
    if (t === 1) {
      if (a === st.u8(DS.PORT)) return end(0x249);
      if (!lucky()) return end(0x18f);
      this.talkMessage2(0x191, this.dstr(P + 4)); message(0x181 + st.u8(E + 0x21)); message(0x192); await this.wait(); return;
    }
    if (t === 2 || t === 6) {
      if (!lucky()) return end(0x18f);
      let found = 0xff;
      for (let i = 0; i < 0x28; i++) { const e = DS.TBL_PORT_ECONOMY + i * 0x25; if (st.u8(e + 0x1a) === c8 && st.u8(e + 0x1b) * 10 <= s16b(st.u16(e))) { found = i; break; } }
      if (found !== 0xff) { this.talkMessage2(0x190, this.BG.goods[c8], this.dstr(DS.TBL_PORT + found * 0x16 + 4)); await this.wait(); return; }
      for (let k = 0x0c; k >= 0; k--) { const R = DS.TBL_REGION_PRICE + k * 0x80; for (let j = 0; j < 9; j++) if (st.u8(R + 0x6e + j) === c8) { found = k; break; } }
      if (found === 0xff) return end(0x18f);
      this.talkMessage2(0xca, this.BG.goods[c8]); message(0x181 + found); message(0xcb); await this.wait(); return;
    }
    await this.wait();
  }
  // 1fd9:591f 水手僱用
  async hire() {
    const st = this.st, free = new Array(10).fill(0);
    if (!(await this.hireCheck(free))) return;
    const n = await this.hireNegotiate(free);
    if (!n) return;
    await this.assignCrew(n);
    for (let i = 0; i < 10; i++) {
      const S = this.fleetSlot(i), M = this.crewData(i);
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      const ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP)), old = ((st.u16(ship + 0x12) - free[i]) << 16) >> 16, now = (st.u16(S) << 16) >> 16;
      if (old >= now) continue;
      st.set8(M + 0x1c, Math.trunc(((now - old) * 0x3c + st.u8(M + 0x1c) * old) / now));
    }
    st.set8(DS.DAILY_FLAGS, st.u8(DS.DAILY_FLAGS) | 1);
  }
  // 1fd9:59ce 水手解僱: 257d6(0), 之後水手數為 0 的船士氣歸 0
  async dismiss() {
    await this.assignCrew(0);
    for (let i = 0; i < 10; i++) { const S = this.fleetSlot(i); if ((this.st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10 && !this.st.u16(S)) this.st.set8(this.crewData(i) + 0x1c, 0); }
  }
  // 25425 各船尚可補充的水手數
  roomCheck(free) {
    let r = 0;
    for (let i = 0; i < 10; i++) {
      free[i] = 0;
      const S = this.fleetSlot(i);
      if ((this.st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      free[i] = (this.st.u16(ListSelect.shipRec(this.st.u8(S + OFF.DOCK_SLOT.SHIP)) + 0x12) - this.st.u16(S)) & 0xffff;
      if (free[i]) r = 1;
    }
    return r;
  }
  // 25485
  async hireCheck(free) {
    const { menu } = this.c;
    if (!this.fleetShips()) return 0;
    const fail = async n => { this.crewSpeaks(); this.c.message(n); await this.wait(); await this.closeTalk(); return 0; };
    if (!this.roomCheck(free)) return fail(0x1d);
    if (this.money < 10) return fail(0x1e);
    if (this.tvA < 0x1e) {
      this.crewSpeaks(); this.c.message(0x1f); await this.wait();
      this.talkClear(); this.c.message(0x20);
      const ok = await menu.yesNo();
      await this.closeTalk();
      if (!ok) return 0;
    }
    return 1;
  }
  // 25568 交涉: 應募人數、工資、僱用數
  async hireNegotiate(free) {
    const st = this.st, { message } = this.c, eco0 = st.u16(this.eco), A = this.tvA;
    const apps = Math.trunc(((A * eco0) >>> 0) / 500) & 0xffff;
    const rank = st.u8(this.heroData + 0x0d);
    let si = umin16(((rank + 1) * A) & 0xffff, apps);
    this.talkPerson(st.hero);
    message(0x21, this.dstr(this.hero), (st.hero === 5 ? this.T.ottomanTitles : this.T.titles)[rank]);
    await this.wait(); await this.closeTalk();
    this.crewSpeaks();
    if (si >= 0x14) message(0x79, si);
    else if (si === 0) { message(0x7b); await this.wait(); await this.closeTalk(); return 0; }
    else message(0x7a, si);
    await this.wait();
    this.talkClear();
    const wage = Math.trunc(eco0 / 20) + 5;
    const byMoney = Math.trunc(this.money / wage) & 0xffff;
    const mx = umin16(byMoney, si);
    let sum = 0; for (let i = 0; i < 10; i++) sum = (sum + free[i]) & 0xffff;
    const lim = umin16(mx, sum);
    message(0x22); message(0x7c, wage); message(0x7d, lim);
    const v = await this.numpad.input(0, lim);
    await this.closeTalk();
    this.payMoney(((wage * v) << 16) >> 16);
    return v;
  }
  // 257d6 把水手分配到各船 (n = 新僱用人數; 0 = 水手解僱)
  async assignCrew(n) {
    const st = this.st, { menu, message } = this.c, list = (this.c.listSel ??= new ListSelect(this.c));
    const wage = Math.trunc(st.u16(this.eco) / 20) + 5;
    let pool = n;
    const cnt = this.fleetShips();
    for (;;) {
      const r = await list.select(0x87, cnt);
      if (r === -1) {
        if (n === 0 || pool === 0) return;
        this.crewSpeaks(); message(0x23);
        if (await menu.yesNo()) { await this.closeTalk(); this.addMoney(((umin16(n, pool) * wage) << 16) >> 16); return; }
        await this.closeTalk();
        continue;
      }
      const slot = this.c.persons[r], S = this.fleetSlot(slot), ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP));
      if (n) { await this.shipInfo(slot); pool = (pool + st.u16(S)) & 0xffff; }
      else { this.crewSpeaks(); message(0x359, this.dstr(ship), st.u16(S)); pool = st.u16(S); }
      const v = await this.numpad.input(0, umin16(pool, st.u16(ship + 0x12)));
      if (!n) {
        if (v === st.u16(S)) { await this.closeTalk(); continue; }
        this.talkClear(); message(0x35a, (st.u16(S) - v) & 0xffff);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        await this.closeTalk();
      }
      st.set16(S, v); pool = (pool - v) & 0xffff;
      if (!n) continue;
      await this.shipInfo(slot);
      await this.wait();
    }
  }
  // 256eb 船隻資料 (艦船調色盤)
  async shipInfo(slot) {
    const st = this.st, { palette, con, printf, graph } = this.c;
    const M = this.crewData(slot), S = this.fleetSlot(slot), ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP)), type = st.u8(ship + 0x0f), T = DS.TBL_SHIP_TYPE + type * 0x0c;
    palette.setTarget(palette.table("ships"));
    await palette.fadeToTarget();
    this.table();
    con.left = 0x22; con.right = 0x35;
    graph.draw(type + 0x1c, 0x10 << 3, 0xa0);                                // seg0:8050
    con.setCursor(0x22, 0x90);
    printf(this.T.fmt.shipName, this.dstr(ship));
    printf(this.T.fmt.captain, this.dstr(st.personRecord(st.u8(M + 0x1b))));
    printf(this.T.fmt.crewHdr);
    const crew = st.u16(S), a = Math.trunc(st.u8(M + 9) * crew / 100) & 0xffff, b = Math.trunc(st.u8(M + 8) * crew / 100) & 0xffff;
    printf(this.T.fmt.crew, a, b, (crew - b - a) << 16 >> 16);
    printf(this.T.fmt.need, st.u8(T + 5));
  }
  // ================= 3 碼頭 1fd9:8993 =================
  isCapital() { for (let i = 0; i < 6; i++) if (this.st.u8(DS.TBL_COUNTRY + i * 0x20 + 0x0a) === this.port) return 1; return 0; }   // 0fea:b578
  // 0fea:2f43 = 12de3: 主角沒有擔任任何船的船長時列入主角, 再列入職務 > 2 的船員 → [0538]
  crewList() {
    const st = this.st, L = [];
    let k = 0; for (; k < 10; k++) if (st.u8(this.crewData(k) + 0x1b) === st.hero) break;
    if (k === 10) L.push(st.hero);
    for (let i = 0; i < 0x1e; i++) { const n = st.u8(DS.PARTY_CREW + i); if (n !== 0xff && st.u8(st.personRecord(n) + 0x2e) > 2) L.push(n); }
    this.c.persons ??= [];
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return L.length;
  }
  // seg0:5d36 船上已用的載貨量
  cargoUsed(slot) {
    const st = this.st, M = this.crewData(slot);
    let v = Math.trunc(s16b(st.u16(M + 2)) / 10) + st.u16(M + 4) + st.u16(M + 6) + Math.trunc(s16b(st.u16(M)) / 10);
    for (let k = 0; k < 5; k++) if (st.u8(M + 0x16 + k) !== 0xff) v += st.u16(M + 0x0c + 2 * k);
    return v & 0xffff;
  }
  shipOf(slot) { return ListSelect.shipRec(this.st.u8(this.fleetSlot(slot) + 7)); }
  // 277c0 視窗 (不保存背景) + 文字顏色
  winText(x, y, w, h) { this.c.win.frame(x, y, w, h, 0); this.c.con.puts(this.WF.winColor); }
  async wharf() {
    const st = this.st, { sys, menu } = this.c;
    if (this.port >= 0x64 && this.port < 0x82) return this.supplyPort();     // 286ac
    this.guards();
    await this.crewDemands();
    const items = this.c.menuItems(9);
    let si = 1;
    if (!st.u8(DS.COMMON_CHAP) && (st.u8(WorkDS.FLAGS) & 3) && !(st.u8(WorkDS.FLAGS) & 4) && !(((st.u8(DS.TBL_PORT + this.port * 0x16 + 0x15) & 7) ^ st.u8(this.hero + 0x31)) & 0x0f)) {
      this.greet(0x199); this.c.message(0x19a + (st.u8(this.hero + 0x31) & 15)); this.c.message(0x1a0); await this.wait();
      st.set8(WorkDS.FLAGS, st.u8(WorkDS.FLAGS) | 2); si = 0;
    }
    if (si && this.noEvent()) this.greet(0x38);
    let sel;
    do {
      si = 0;
      if (!this.isCapital()) menu.disabled = 4;
      if (!this.fleetShips()) menu.disabled |= 3;
      sel = await this.menu(items);
      if (sel !== 0xff) si = await [() => this.departWrap(), () => this.supply(), () => this.dock()][sel]();
    } while (sel !== 0xff && !si);
  }
  // 28741: 夜間 (時刻 ≤ 0x12 或 ≥ 0x36) random(3)=0 且港口所屬國與主角艦隊國家敵對時, 站立行人 4..7 改成衛兵站在入口旁
  guards() {
    const st = this.st, t = this.c.rt.time, nation = st.u8(DS.TBL_PORT + this.port * 0x16 + 0x15) & 7;
    if (!(t <= 0x12 || t >= 0x36)) return;
    if (this.c.sys.rng.random(3)) return;
    if (nation >= 6) return;
    const fn = Math.trunc(st.u8(this.hero + 0x2c) / 10);
    if (!(st.u8(DS.TBL_COUNTRY + nation * 0x20 + 0x12 + fn) & 0x10)) return;
    for (let i = 0, extra = 0; i < 4; i++) {
      if (i === 3) extra++;
      const d = (i + extra) * 2, a = 0x0cc8 + i * 3;
      st.set8(a, st.u8(0x0904 + d) + 2); st.set8(a + 1, st.u8(0x0905 + d) + 1); st.set8(a + 2, i);
      if (i === 2) { st.set8(a, 0xff); st.set8(a + 1, 0xff); }
    }
  }
  // 28809: 忠誠 (+2b) < 30 的船員 random(4 − (+2f & 3)) = 0 時要求加薪
  async crewDemands() {
    const st = this.st, { message, menu, sys } = this.c;
    const n = this.crewList();
    for (let di = 0; di < n; di++) {
      const who = this.c.persons[di], P = st.personRecord(who);
      if (st.u8(P + 0x2b) >= 0x1e) continue;
      if (sys.rng.random(4 - (st.u8(P + 0x2f) & 3))) continue;
      for (let si = 0; si < 0x1e; si++) {
        if (this.c.persons[di] !== st.u8(DS.PARTY_CREW + si) || st.u8(0x2e39 + si) >= 0x13) continue;
        this.talkPerson(this.c.persons[di]); message(0x31e); await this.wait(); await this.closeTalk();
        if (this.crewSpeaks() === this.c.persons[di]) message(0x320); else message(0x31f, this.dstr(P));
        if (await menu.yesNo()) {
          await this.closeTalk();
          this.talkPerson(this.c.persons[di]); message(0x321, ((st.u8(0x2e39 + si) + 1) * 10) & 0xffff);
          if (await menu.yesNo()) { await this.closeTalk(); st.set8(0x2e39 + si, st.u8(0x2e39 + si) + 1); st.set8(P + 0x2b, 0x1e); continue; }
        }
        await this.closeTalk();
        this.dismissMate(this.c.persons[di]);
      }
    }
  }
  // 2858b 船員離開艦隊, 留在本港
  dismissMate(n) {
    const st = this.st;
    for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) === n) { st.set8(DS.PARTY_CREW + i, 0xff); st.set8(0x2e39 + i, 0); break; }
    const P = st.personRecord(n); st.set8(P + 0x2e, 0); st.set8(P + 0x2c, 0xff); st.set8(P + 0x2d, this.port);
  }
  // 286ac 港 100..129 (補給港): MENU #57 出航 / 補給 / 命名
  async supplyPort() {
    const items = this.c.menuItems(57);
    if (this.noEvent()) this.greet(0x38);
    let sel, si = 1;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff) si = await [() => this.departWrap(), () => this.supply(), () => this.namePort()][sel]();
    } while (sel !== 0xff && !si);
  }
  // ---------- 船隻資料 (造船廠與船塢共用) ----------
  typeRec(t) { return DS.TBL_SHIP_TYPE + t * 0x0c; }                                 // seg0:5c8a
  listSel() { return (this.c.listSel ??= new ListSelect(this.c)); }
  // 2af30 船隻資料: mode 0 = 船編號 al, 1 = 中古船 (船型 al), 2 = 新造設計 (船型 al), 3 = 船位 slot 的船 (slot ≥ 0x100 時是船位位址, 例: 海戰掳獲時對方的船位)
  shipData(al, mode, slot = 0) {
    const st = this.st, { con, printf, graph } = this.c, F = this.SY;
    let si, di, cur = 0, max = 0, turn = 0, prop = 0, load = 0, crew = 0, guns = 0;
    if (mode === 0) { si = ListSelect.shipRec(al); di = this.typeRec(st.u8(si + 0x0f)); cur = max = Math.trunc(9 * st.u8(di + 1) / 10) & 0xff; }
    else if (mode === 1 || mode === 2) {
      di = this.typeRec(al); si = ListSelect.shipRec(al + 0x28);
      const d = Math.trunc(9 * st.u8(di + 1) / 10) & 0xffff;
      if (mode === 1) cur = max = (d - Math.trunc((d & 0xff) / 15)) & 0xff;
      else { max = d & 0xff; cur = 0; }
    } else { const S = slot >= 0x100 ? slot : this.fleetSlot(slot); si = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP)); di = this.typeRec(st.u8(si + 0x0f)); max = st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY); cur = st.u8(S + OFF.DOCK_SLOT.DURABILITY); }
    turn = st.u8(di + 2); prop = st.u8(di + 3);
    if (mode === 2) { load = st.u16(di + 6); crew = 0; guns = 0; }
    else { load = st.u16(si + 0x14); crew = st.u16(si + 0x12); guns = st.u8(si + 0x11); }
    this.table();                                                            // bTable
    graph.draw(st.u8(si + 0x0f) + 0x1c, 0x0f << 3, 0xa0);                    // seg0:8050
    con.right = 0x3a; con.left = 0x20; con.setCursor(0x20, 0x90);
    printf(F.name, this.dstr(si), turn, prop);
    con.setCursor(0x20, 0xb8);
    printf(F.durability, cur, max);
    con.lineH = 0x10; con.setCursor(0x20, 0xd0);
    printf(F.load, st.u16(di + 6), load);
    printf(F.crew, st.u8(di + 4), crew);
    printf(F.need, st.u8(di + 5), guns);
    printf(F.guns, st.u8(di + 8));
    con.lineH = 0x18;
  }
  // 2b119 船首像 (TRANSIT.DAT)
  figurehead(slot) {
    const fh = this.st.u8(this.crewData(slot) + 0x1d);
    if (!fh || fh >= 0x0b) return;
    this.c.scr.putPlanar(0x33, 0x9c, 6, 0x30, this.p.P.transit, 0x1980 + 0x480 * fh);
  }
  // 203e9 交換船位 a / b (9 bytes 船位 + 0x1e bytes 船員配置)
  swapSlots(a, b) {
    const st = this.st;
    for (const [base, n] of [[i => this.fleetSlot(i), 9], [i => this.crewData(i), 0x1e]]) {
      const A = base(a), B = base(b);
      for (let k = 0; k < n; k++) { const t = st.u8(A + k); st.set8(A + k, st.u8(B + k)); st.set8(B + k, t); }
    }
  }
  slotState(i) { return this.st.u8(this.fleetSlot(i) + 8) & 0x30; }        // 0x10 有船, 0x20 建造中
  // 20468 整理船位
  compactSlots() {
    for (let i = 0; i < 9; i++) {
      if (this.slotState(i) === 0x10) continue;
      for (let j = i + 1; j < 10; j++) if (this.slotState(j) === 0x10) { this.swapSlots(i, j); break; }
    }
    for (let i = 10; i < 0x27; i++) {
      const f = this.slotState(i); if (f === 0x10 || f === 0x20) continue;
      for (let j = i + 1; j < 0x28; j++) if (this.slotState(j) === 0x10) { this.swapSlots(i, j); break; }
    }
  }
  // 0fea:2e29 = 12cc9: 艦隊中不是主角擔任船長的船 → [0538]
  notHeroShips() {
    const n = this.fleetShips(), L = [];
    for (let i = 0; i < n; i++) if (this.st.u8(this.crewData(this.c.persons[i]) + 0x1b) !== this.st.hero) L.push(this.c.persons[i]);
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return L.length;
  }
  // 0fea:2e6e = 12d0e: 空的船塢位 (10..39), 再加空的艦隊位 (0..9) → [0538]
  freeSlots() {
    const L = [];
    for (let i = 10; i < 40; i++) { const f = this.slotState(i); if (f !== 0x10 && f !== 0x20) L.push(i); }
    for (let i = 0; i < 10; i++) { const f = this.slotState(i); if (f !== 0x10 && f !== 0x20) L.push(i); }
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return L.length;
  }
  // 0fea:2eec = 12d8c: 主角 + 船員欄 → [0538]
  captainPool() {
    const st = this.st; let n = 1; this.c.persons[0] = st.hero;
    for (let i = 0; i < 0x1e; i++) { const v = st.u8(DS.PARTY_CREW + i); if (v !== 0xff) this.c.persons[n++] = v; }
    return n;
  }
  // 0fea:83f9 艦隊 +28 = (Σ 有船船位耐久 + 4) / 5; 為 0 時 +29 bit0 清除
  fleetRecalc() {
    const st = this.st, F = DS.TBL_FLEET + st.u8(this.hero + 0x2c) * 0x85;
    let sum = 0;
    for (let i = 0; i < 10; i++) if (this.slotState(i) === 0x10) sum += st.u8(this.fleetSlot(i) + 2);
    st.set8(F + OFF.FLEET.STRENGTH, Math.trunc((sum + 4) / 5));
    if (!sum) st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xfe);
  }
  // 0fea:b5aa = 1b44a 本港物價指數 = Σ 經濟 +0e..+17 / 10
  priceIndex() { let v = 0; for (let i = 0; i < 10; i++) v += this.st.u8(this.eco + 0x0e + i); return Math.trunc(v / 10); }
  // 2ac68 船價 = ((船型基價×4/5 + 基價×(船 +10 & 7)/10) × (物價指數+50) / 100) × 10
  shipPrice(slot) {
    const st = this.st, ship = this.shipOf(slot), T = s16b(st.u16(this.typeRec(st.u8(ship + 0x0f)) + 0x0a));
    const q = Math.trunc(T * 4 / 5), r = Math.trunc(T * (st.u8(ship + 0x10) & 7) / 10);
    return (Math.trunc(Math.imul(q + r, this.priceIndex() + 50) / 100) * 10) | 0;
  }
  // seg0:5deb 移除船位 slot 的船
  removeShip(slot) {
    const st = this.st, M = this.crewData(slot), S = this.fleetSlot(slot), ship = this.shipOf(slot);
    st.set8(ship + 0x0f, 0xff); st.set8(ship + 0x11, 0); st.set8(ship + 0x10, 0); st.set16(ship + 0x14, 0); st.set16(ship + 0x12, 0);
    for (const k of [5, 4, 3, 2, 6]) st.set8(S + k, 0xff);
    st.set16(S, 0); st.set8(S + OFF.DOCK_SLOT.FLAGS, 0);
    for (const k of [6, 4, 2, 0]) st.set16(M + k, 0);
    for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    st.set16(M + 0x0a, 0);
    if (st.u8(M + 0x1b) !== st.hero) st.set8(st.personRecord(st.u8(M + 0x1b)) + 0x2e, 6);
    st.set8(M + 0x1b, 0xff); st.set8(M + 0x1c, 0); st.set8(M + 0x1d, 0);
    st.set8(M + 8, 0x19); st.set8(M + 8, 0x32);                              // 原版連寫兩次 +8 (+9 不變)
  }
  // ================= 碼頭 船塢 284ab =================
  async dock() {
    const { palette, win, con, menu, message } = this.c;
    palette.setTarget(palette.table("ships")); await palette.fadeToTarget();
    const items = this.c.menuItems(8);
    win.shadowedSaved(0x3c, 0xa0, 0x13, 0x88, 0);
    con.puts(this.SY.dockTitle);
    let sel;
    do {
      this.dockScan();
      if (this.b066) this.greet(0x114, this.b066); else this.greet(0x115);
      message(0x116, this.b068);
      sel = await menu.listMenu(0x3c, 0x40, items, 1);
      if (sel !== 0xff) await [() => this.dockKeep(), () => this.dockTake(), () => this.dockSwap()][sel]();
      this.after();
      this.compactSlots();
    } while (sel !== 0xff);
    await win.close();
    palette.selectTimePalette(this.c.rt.time, false, this.st.weather);       // 0fea:98ce
    await this.p.interior(3);
    this.greet(0x38);
    return 0;
  }
  // 27fd5 本港船塢的船 → b06a[0..b066), 再補空船塢位到 b068 (最多 5)
  dockScan() {
    const st = this.st;
    this.b062 = this.fleetShips();
    this.b064 = umin16(this.captainPool(), 10);
    this.b06a = [0xff, 0xff, 0xff, 0xff, 0xff];
    this.freeSlots();
    this.b066 = 0;
    for (let i = 10; i < 0x28; i++) if (st.u8(this.crewData(i) + 0x1b) === (this.port | 0x80) && this.slotState(i) === 0x10) this.b06a[this.b066++] = i;
    this.b068 = this.b066;
    for (let i = 10; i < 0x28 && this.b068 < 5; i++) { const f = this.slotState(i); if (f !== 0x10 && f !== 0x20) this.b06a[this.b068++] = i; }
    this.c.scr.fillCols(0x3e, 0xc8, 0x10, 0x50, 7);
    this.dockList();
  }
  // 27f34 船塢列表與點擊區
  dockList() {
    const st = this.st, { con, printf, menu } = this.c, R = menu.rects;
    con.left = 0x3e; con.right = 0x4d; con.puts(this.SY.dockColor);
    let i = 0;
    for (; i < this.b066; i++) {
      const y = (i << 4) + 0xc8;
      con.setCursor(0x3e, y);
      printf(this.SY.dockRow, this.dstr(this.shipOf(this.b06a[i])));
      this.c.persons[i] = this.b06a[i];
      R[i] = { x0: 0x1f0, x1: 0x270, y0: y, y1: y + 0x10 };
    }
    R[i] = { x0: 0x1e0, x1: 0x280, y0: 0xa0, y1: 0x128 };
  }
  // 280ce 保管: 艦隊船 → 第一個空船塢位
  async dockKeep() {
    const st = this.st, { message, menu } = this.c, list = this.listSel();
    if (!this.b062) return;
    const n = this.notHeroShips();
    if (!n) { this.crewSpeaks(); message(0x117); await this.wait(); await this.closeTalk(); return; }
    if (this.b068 === this.b066) { this.greet(0x120); await this.wait(); return; }
    for (;;) {
      this.table(); this.greet(0x118);
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const slot = this.c.persons[r], S = this.fleetSlot(slot);
      this.shipData(st.u8(S + OFF.DOCK_SLOT.SHIP), 3, slot); this.figurehead(slot);
      if (st.u16(S)) this.greet(0x119, st.u16(S)); else this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      const d = this.b06a[this.b066];
      this.swapSlots(slot, d);
      const Mf = this.crewData(slot), Md = this.crewData(d);
      st.set8(Mf + 0x1c, 0); st.set8(Md + 0x1c, 0); st.set16(this.fleetSlot(slot), 0); st.set16(this.fleetSlot(d), 0);
      st.set8(Mf + 0x1b, 0xff); st.set8(st.personRecord(st.u8(Md + 0x1b)) + 0x2e, 6); st.set8(Md + 0x1b, this.port | 0x80);
      this.greet(0x11a); await this.wait();
      return;
    }
  }
  // 2820d 配備: 船塢船 → 第一個空艦隊位
  async dockTake() {
    const st = this.st, { message, menu } = this.c;
    this.dockList();
    if (!this.b066) { this.greet(0x11b); await this.wait(); return; }
    if (this.b064 === this.b062) { this.crewSpeaks(); message(0x11d); await this.wait(); await this.closeTalk(); return; }
    for (;;) {
      this.after(); this.dockList(); this.greet(0x11c);
      const sel = await menu.customMenu(this.b066, 1, 1);
      if (sel === 0xff) return;
      const d = this.c.persons[sel];
      this.shipData(st.u8(this.fleetSlot(d) + 7), 3, d); this.figurehead(d);
      this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      let f = 0; for (let i = 0; i < 10; i++) if (this.slotState(i) !== 0x10) { f = i; break; }
      this.swapSlots(f, d);
      const Mf = this.crewData(f), Md = this.crewData(d);
      st.set8(Mf + 0x1c, 0); st.set8(Md + 0x1c, 0); st.set16(this.fleetSlot(f), 0); st.set16(this.fleetSlot(d), 0);
      this.crewList();
      st.set8(Mf + 0x1b, this.c.persons[0]); st.set8(st.personRecord(this.c.persons[0]) + 0x2e, 2);
      st.set8(Md + 0x1b, this.port | 0x80);
      this.greet(0x11e); await this.wait();
      return;
    }
  }
  // 2834f 交換: 艦隊船 ↔ 船塢船
  async dockSwap() {
    const st = this.st, { menu } = this.c, list = this.listSel();
    if (!this.b062) return;
    if (!this.b066) { this.greet(0x11b); await this.wait(); return; }
    for (;;) {
      this.after();
      const n = this.fleetShips();
      this.greet(0x118);
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const f = this.c.persons[r];
      this.shipData(st.u8(this.fleetSlot(f) + 7), 3, f); this.figurehead(f);
      this.dockList(); this.greet(0x11c);
      const sel = await menu.customMenu(this.b066, 1, 1);
      if (sel === 0xff) return;
      const d = this.c.persons[sel];
      this.shipData(st.u8(this.fleetSlot(d) + 7), 3, d); this.figurehead(d);
      const cap = s16b(st.u16(this.shipOf(d) + 0x12)), have = s16b(st.u16(this.fleetSlot(f)));
      if (have > cap) this.greet(0x119, (have - cap) & 0xffff); else this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      this.swapSlots(f, d);
      const Mf = this.crewData(f), Md = this.crewData(d);
      st.set8(Mf + 0x1c, st.u8(Md + 0x1c)); st.set8(Md + 0x1c, 0);
      st.set16(this.fleetSlot(f), umin16(st.u16(this.fleetSlot(d)), cap)); st.set16(this.fleetSlot(d), 0);
      st.set8(Mf + 0x1b, st.u8(Md + 0x1b)); st.set8(Md + 0x1b, this.port | 0x80);
      this.greet(0x11f); await this.wait();
      return;
    }
  }
  // ================= 2 造船廠 1fd9:cc01 =================
  async shipyard() {
    const st = this.st, { palette, menu } = this.c;
    palette.setTarget(palette.table("ships")); await palette.fadeToTarget();
    if (st.u8(DS.DAILY_FLAGS) & 2) { this.greet(0xf9); await this.wait(); return; }
    this.greet(0x4d);
    let sel;
    do {
      const items = this.c.menuItems(22);
      let n = 0; for (let i = 0; i < 5; i++) if (st.u8(DS.TBL_USED_SHIP_CACHE + i) !== 0xff) n++;   // seg0:5cc4(0) 中古船表第 1 筆 (到港 1bd16 把本港移到第 1 筆; 原版各處都傳 al = 0)
      if (!n) menu.disabled |= 2;
      this.b2f4 = this.b2f5 = this.b2f6 = this.b2f7 = 0xff; this.b2f8 = 0;
      sel = await this.menu(items);
      if (sel !== 0xff) {
        await [() => this.newShip(), () => this.usedShip(), () => this.repair(), () => this.sellShip(),
          () => this.remodel(), () => this.invest()][sel]();
        this.after();
      }
    } while (sel !== 0xff && !(st.u8(DS.DAILY_FLAGS) & 2));
    this.fleetRecalc();
    palette.selectTimePalette(this.c.rt.time, false, st.weather);           // 0fea:98ce
    await palette.fadeToTarget();
  }
  sTodo(n) { bTodo(n); }
  // ---------- 造新船 / 買舊船 / 改造 (RE_NOTES 20.6..20.8) ----------
  get BT() {                                                              // port.json build (DS:b268 / b2c0 / 080c / 07cc …)
    if (!this._bt) {
      const d = this.p.P.data.build;
      this._bt = { levels: d.levels, typeMsg: d.typeMsg, cannonPrice: d.cannonPrice, cannons: d.cannons.map(bHex),
        fmt: Object.fromEntries(Object.entries(d.fmt).map(([k, v]) => [k, bHex(v)])) };
    }
    return this._bt;
  }
  nameInput() { return (this.c.nameInput ??= new NameInput(this.c, this.c.newgameData)); }
  // seg0:5cee 擔任職務 role 的船員 (船員欄 DS:2e1b), 沒有 = FF
  roleMember(role) {
    const st = this.st;
    for (let i = 0; i < 0x1e; i++) { const n = st.u8(DS.PARTY_CREW + i); if (n !== 0xff && st.u8(st.personRecord(n) + 0x2e) === role) return n; }
    return 0xff;
  }
  noMoney() { this.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(0xcf); }  // seg0:9076 + 2e09:56ee(0xcf)
  // 2bd77 造新船
  async newShip() {
    const st = this.st, E = this.eco, { sys, win, con } = this.c;
    this.b2f8 = 1; this.b2f5 = this.b2f4 = 0xff;
    if (st.u8(E + 0x23) !== 0xff) {                                       // 2b867 有船在造
      if (st.u8(E + 0x23)) { this.greet(0x105, st.u8(E + 0x23)); await this.wait(); return; }
      return this.delivery();
    }
    const t0 = this.BT.levels[st.u8(E + 0x22)][0];
    if (((10 * st.u8(this.typeRec(t0))) & 0xffff) > st.u16(E + 4)) { this.greet(0xfb); await this.wait(); return; }
    this.freeSlots();
    if (s16b(this.c.persons[0]) < 10) {                                   // 船塢已滿
      sys.mouseHide();
      await win.open(0x15, 0xc0, 0x1e, 0x48, 0);
      con.puts(this.BT.fmt.dockFull);
      await this.wait(); await win.close();
      sys.mouseShow();
      return;
    }
    if (!this.freeSlots()) {
      this.greet(0xa7); await this.wait();
      this.b2f6 = await this.sellSelect(0);
      if (this.b2f6 === 0xff) return;
    } else this.b2f6 = this.c.persons[0];
    this.greet(0xfc); await this.wait();
    await this.buildSelect();
  }
  // 2bb91 選船型 → 材質 → 交涉 → 開工
  async buildSelect() {
    const st = this.st, E = this.eco, { menu } = this.c, list = this.listSel(), P = this.c.persons;
    const row = this.BT.levels[st.u8(E + 0x22)];
    let n = 0;
    for (let i = 0; i < 8; i++) { const t = row[i]; if (t === 0xff) break; if (((10 * st.u8(this.typeRec(t))) & 0xffff) <= st.u16(E + 4)) P[n++] = t + 0x28; }
    for (;;) {
      const r = await list.select(0x8e, n);
      if (r === -1) return;
      const t = (P[r] - 0x28) & 0xff, T = this.typeRec(t);
      this.shipData(t, 2);
      this.greet(this.BT.typeMsg[t]); await this.wait();
      this.greet(0xfd);
      if (!(await menu.yesNo())) continue;
      const mat = await this.material(t);
      const base = s16b(st.u16(T + 0x0a));
      const price = (Math.trunc(base * 4 / 5) + Math.trunc(base * mat / 10)) & 0xffff;
      if (!(await this.negotiate(t, price))) return;
      this.greet(0x101); await this.wait();
      const S = this.fleetSlot(this.b2f6), ship = this.shipOf(this.b2f6), M = this.crewData(this.b2f6);
      st.set8(S + OFF.DOCK_SLOT.FLAGS, 0x20);
      st.set8(ship + 0x10, (st.u8(ship + 0x10) & 0xf8) | mat);
      const d = umin16(Math.trunc((mat + 8) * st.u8(T + 1) / 10), 100);
      st.set8(S + OFF.DOCK_SLOT.MAX_DURABILITY, d); st.set8(S + OFF.DOCK_SLOT.DURABILITY, d);
      st.set8(M + 0x1b, this.port | 0x80);
      this.shipData(t, 2);
      this.durPrint(st.u8(S + OFF.DOCK_SLOT.DURABILITY));
      await this.design(this.b2f6);
      const q = ((100 - Math.trunc(st.u16(E + 4) / 50)) & 0xffff) * st.u8(T + 1);
      st.set8(E + 0x23, Math.trunc(q / 100) & 0xff);
      this.greet(0x106, st.u8(E + 0x23)); await this.wait();
      return;
    }
  }
  // 2bad3 材質
  async material(t) {
    const st = this.st, E = this.eco, { menu } = this.c, list = this.listSel(), P = this.c.persons, T = this.typeRec(t);
    const ind = st.u16(E + 4);
    const n = t === 0x18 ? 6 : Math.trunc((ind - umin16(500, ind)) / 200) + 3;
    for (let i = 0; i < n; i++) P[i] = i;
    for (;;) {
      this.greet(0xfe);
      let r; do r = await list.select(0x8f, n); while (r === -1);
      const v = P[r];
      this.durPrint(umin16(Math.trunc((v + 8) * st.u8(T + 1) / 10), 100));
      this.greet(0xff);
      if (await menu.yesNo()) return v;
    }
  }
  // 2aebb 耐久度數字
  durPrint(v) {
    const { con, printf } = this.c;
    con.left = 0x1e; con.right = 0x39; con.setCursor(0x27, 0xb8);
    printf(this.BT.fmt.durNum, v);
  }
  // 2aeeb 最大載貨 / 水手數 / 武器數
  designPrint(cargo, crew, guns) {
    const { con, printf } = this.c;
    con.lineH = 0x10; con.right = 0x3a; con.left = 0x35; con.setCursor(0x35, 0xd0);
    printf(this.BT.fmt.designNums, s16b(cargo), s16b(crew), guns);
    con.lineH = 0x18; con.left = 0x1f;
  }
  // 2b19d 設計 (水手數與武器數)
  async design(slot) {
    const st = this.st, { menu, printf } = this.c, F = this.BT.fmt;
    const S = this.fleetSlot(slot), ship = this.shipOf(slot), T = this.typeRec(st.u8(ship + 0x0f));
    for (;;) {
      let cargo = st.u16(T + 6), crew;
      this.designPrint(cargo, 0, 0);
      this.greet(0x102); printf(F.crewRange, st.u8(T + 5), st.u8(T + 4));
      do crew = (await this.numpad.input(0, st.u8(T + 4) * 10)) & 0xffff; while (st.u8(T + 5) > s16b(crew));
      cargo = (cargo - crew) & 0xffff;
      this.designPrint(cargo, crew, 0);
      this.greet(0x103); printf(F.gunRange, st.u8(T + 8));
      const guns = (await this.numpad.input(0, st.u8(T + 8))) & 0xff;
      cargo = (cargo - guns) & 0xffff;
      this.designPrint(cargo, crew, guns);
      this.greet(0x104);
      if (!(await menu.yesNo())) continue;
      if (s16b(this.cargoUsed(slot)) > s16b(cargo)) { this.greet(0x14); await this.wait(); return 0; }
      st.set16(ship + 0x14, cargo); st.set16(ship + 0x12, crew); st.set8(ship + 0x11, guns);
      const c12 = s16b(st.u16(ship + 0x12)), s0 = s16b(st.u16(S));
      st.set16(S, c12 > s0 ? s0 : c12);
      st.set8(S + OFF.DOCK_SLOT.GUNS, umin16(st.u8(S + OFF.DOCK_SLOT.GUNS), st.u8(ship + 0x11)));
      return 1;
    }
  }
  // 2b88d 交涉與付款 (造新船 / 買舊船)
  async negotiate(t, price) {
    const st = this.st, { menu, message, sys } = this.c;
    let k = 5, avail = this.money;
    let cost = Math.imul(Math.trunc(Math.imul(this.priceIndex() + 50, price) / 100), 10) | 0;
    if (this.b2f4 !== 0xff) {
      avail = (avail + Math.trunc(this.shipPrice(this.b2f4) / 2)) | 0;
      this.b2f7 = st.u8(this.crewData(this.b2f4) + 0x1b);
    }
    this.greet(this.b2f8 ? 0x100 : 0xc2, cost);
    const floor = Math.trunc(Math.imul(500 - st.u8(this.hero + 0x22), cost) / 500) | 0;
    if (!(await menu.yesNo())) {
      const acc = this.roleMember(4);
      if (acc !== 0xff) {
        if (!(st.u8(st.personRecord(acc) + 0x30) & 2)) k = sys.rng.random(10);
        this.crewSpeaks([4, 3, 5, 2, 6]); message(0xc4, Math.trunc(Math.imul(k + 95, floor) / 100) | 0);
        await this.wait(); await this.closeTalk();
      }
      this.greet(0xc3);
      const offer = (await this.numpad.input(0, avail > cost ? cost : avail)) | 0;
      if (offer < floor) {
        if (!sys.rng.random(5)) { st.set8(DS.DAILY_FLAGS, st.u8(DS.DAILY_FLAGS) | 2); this.greet(0xc5); }
        else this.greet(0xc6);
        await this.wait();
        return 0;
      }
      this.greet(0x35f, offer); await this.wait();
      cost = offer;
    }
    if (avail < cost) { this.greet(0xef); await this.wait(); return 0; }
    this.money = (avail - cost) | 0;
    this.p.panels();
    const left = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
    if (this.b2f4 !== 0xff) this.transfer(0, left);
    await this.createShip(t);
    if (left.goods[0] !== 0xff) await this.leftovers(left);
    return 1;
  }
  // ---------- 折抵舊船剩餘貨物重新分配 (RE_NOTES 20.9) ----------
  get LO() {                                                              // port.json leftover
    if (!this._lo) {
      const d = this.p.P.data.leftover;
      this._lo = { goods: this.p.P.data.goods.map(bHex), speedRate: d.speedRate, gunWeight: d.gunWeight, supplies: d.supplies.map(bHex),
        fmt: Object.fromEntries(Object.entries(d.fmt).map(([k, v]) => [k, bHex(v)])) };
    }
    return this._lo;
  }
  // 0fea:e788 + 0fea:fe57 + 8ebc(2)
  async leftovers(left) {
    this.fleetTable();
    await this.distribute(left.goods, left.amt);
    await this.p.interior(2);
  }
  // seg0:5db1 船位 slot 的總載重 = 已用載貨 + 砲重 + 水手 (寫到船員配置 +0a)
  loadTotal(slot) {
    const st = this.st, S = this.fleetSlot(slot);
    const g = Math.trunc(Math.imul(s16b(this.LO.gunWeight[st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7] & 0xffff), st.u8(S + OFF.DOCK_SLOT.GUNS)) / 10);
    return (this.cargoUsed(slot) + g + st.u16(S)) & 0xffff;
  }
  // 1c0a8 船速
  shipSpeed(slot) {
    const st = this.st, S = this.fleetSlot(slot), ship = this.shipOf(slot), t = st.u8(ship + 0x0f), T = this.typeRec(t);
    const M = this.crewData(slot), P = st.personRecord(st.u8(M + 0x1b));
    let di = Math.trunc(s16b((this.LO.speedRate[t] * st.u8(S + OFF.DOCK_SLOT.PROPULSION) * 4) & 0xffff) / 150);
    const q = Math.trunc(Math.imul(st.u8(M + 9), s16b(st.u16(S))) / (st.u8(T + 5) || 1));   // seg0:3722 有號長整數除法
    const a = umin16(100, q & 0xffff);
    const c = umin16(150, (180 - Math.trunc(s16b(Math.imul(100, s16b(st.u16(M + 0x0a))) & 0xffff) / s16b(st.u16(T + 6)))) & 0xffff);
    const x = Math.trunc(s16b(Math.imul(a, di) & 0xffff) / 100) & 0xffff;
    di = Math.floor(((x * c) & 0xffff) / 100);
    const v = umin16(30, (Math.trunc(s16b((st.u8(P + 0x24) * di) & 0xffff) / 10) + di) & 0xffff);
    return umin16(40, Math.trunc(s16b((st.u8(P + 0x1d) * v) & 0xffff) / 75) & 0xffff);
  }
  // 1e628 艦隊表 (不保存背景)
  fleetTable() {
    const st = this.st, { win, con, printf } = this.c, F = this.LO.fmt;
    let n = 0;
    for (let i = 0; i < 10; i++) if ((st.u8(this.fleetSlot(i) + 8) & 0x30) === 0x10) n++;
    win.frame(0x0f, 0x20, 0x2b, ((n + 2) * 0x18) & 0xffff, 1);
    con.setCursor(0x20, 0x30); printf(F.fleetHdr);
    let row = 0;
    for (let i = 0; i < 10; i++) {
      const S = this.fleetSlot(i);
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      const ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP)), M = this.crewData(i);
      con.setCursor(0x11, (row + 3) * 0x18); con.puts(this.dstr(ship));
      con.setCursor(0x20, -1);
      if (st.u8(M + 0x1b) & 0x80) con.puts(F.fleetGone);
      else {
        const T = this.typeRec(st.u8(ship + 0x0f)), s0 = st.u16(S);
        const a = Math.floor(((st.u8(M + 9) * s0) & 0xffff) / 100), b = Math.floor(((st.u8(M + 8) * s0) & 0xffff) / 100);
        const c = (s0 - b - a) & 0xffff;
        const ld = s16b((this.cargoUsed(i) + st.u8(S + OFF.DOCK_SLOT.GUNS) + st.u16(S)) & 0xffff);          // seg0:5d8b
        const d = Math.floor((Math.imul(ld, 100) >>> 0) / (s16b(st.u16(T + 6)) >>> 0 || 1)) & 0xffff;   // seg0:38ba 無號長整數除法
        printf(F.fleetRow, a, b, s16b(c), s16b(d), (this.shipSpeed(i) + 1) >> 1);
      }
      row++;
    }
  }
  // 1f555 「未裝載的貨物」清單 (重新排緊)
  leftList(lg, la) {
    const { scr, con, printf } = this.c, F = this.LO.fmt, names = this.LO.goods;
    scr.fillCols(0x3c, 0x70, 0x10, 0x90, 7);
    con.right = 0x4b; con.left = 0x3c;
    con.setCursor(0x3c, 0x50); con.puts(F.title);
    const g = lg.slice(), a = la.slice();
    lg.fill(0xff); la.fill(0);
    let d = 0;
    for (let i = 0; i < 9; i++) {
      if (g[i] === 0xff) continue;
      con.setCursor(con.left, (d + 7) << 4);
      con.puts(g[i] & 0x80 ? this.LO.supplies[g[i] & 0x7f] : names[g[i]]);
      con.setCursor(con.left + 0x0c, -1);
      printf(F.num, s16b(a[i]));
      lg[d] = g[i]; la[d] = a[i]; d++;
    }
  }
  // 1f64a 一艘船的補給與貨物 → 暫存表 sg / sa (水與糧食 /10), 回傳筆數
  shipList(slot, sg, sa) {
    const st = this.st, { scr, con, printf } = this.c, F = this.LO.fmt, names = this.LO.goods, SUP = this.LO.supplies;
    scr.fillCols(0x18, 0x70, 0x10, 0x90, 7);
    sg.fill(0xff);
    con.left = 0x18; con.right = 0x27;
    const ship = this.shipOf(slot), M = this.crewData(slot);
    con.setCursor(0x18, 0x50); printf(F.shipName, this.dstr(ship));
    const sup = [Math.trunc(s16b(st.u16(M)) / 10), Math.trunc(s16b(st.u16(M + 2)) / 10), st.u16(M + 4), st.u16(M + 6)];
    for (let k = 0; k < 4; k++) {
      con.setCursor(0x18, 0x70 + 0x10 * k); con.puts(SUP[k]);
      con.setCursor(0x18 + 0x0c, -1); printf(F.num, s16b(sup[k] & 0xffff));
      sg[k] = 0x80 + k; sa[k] = sup[k] & 0xffff;
    }
    let d = 4;
    for (let i = 0; i < 5; i++) {
      const g = st.u8(M + 0x16 + i);
      if (g === 0xff) continue;
      con.setCursor(0x18, (d + 7) << 4); con.puts(names[g]);
      con.setCursor(0x18 + 0x0c, -1); printf(F.num, s16b(st.u16(M + 0x0c + 2 * i)));
      sg[d] = g; sa[d] = st.u16(M + 0x0c + 2 * i); d++;
    }
    return d;
  }
  // 1f851 暫存表寫回船員配置
  shipWrite(slot, sg, sa) {
    const st = this.st, M = this.crewData(slot);
    for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    let d = 0;
    for (let s = 0; s < 9; s++) {
      const g = sg[s];
      if (g === 0x80) st.set16(M, 10 * sa[s]);
      else if (g === 0x81) st.set16(M + 2, 10 * sa[s]);
      else if (g === 0x82) st.set16(M + 4, sa[s]);
      else if (g === 0x83) st.set16(M + 6, sa[s]);
      else if (g === 0xff || g >= 0x2e) { st.set8(M + 0x16 + d, 0xff); st.set16(M + 0x0c + 2 * d, 0); d++; }
      else { st.set8(M + 0x16 + d, g); st.set16(M + 0x0c + 2 * d, sa[s]); d++; }
    }
    st.set16(M + 0x0a, this.loadTotal(slot));
  }
  // 1f93d 選中船上第 sel 列: 空列 → 先從剩餘貨物選一種; 再用計算機決定裝在船上的數量
  async loadItem(slot, sel, sg, sa, lg, la) {
    const st = this.st, { menu } = this.c, R = menu.rects, ship = this.shipOf(slot);
    let total = 0;
    for (let i = 0; i < 9; i++) if (sg[i] !== 0xff) total = (total + sa[i]) & 0xffff;
    let g = sg[sel];
    if (g === 0xff) {
      let k = 0; while (k < 9 && lg[k] !== 0xff) k++;
      if (!k) return;
      for (let i = 0; i < k; i++) R[i] = { x0: 0x1e0, x1: 0x260, y0: (i + 7) << 4, y1: ((i + 7) << 4) + 0x10 };
      R[k] = { x0: 0x1d0, x1: 0x270, y0: 0x40, y1: 0x110 };
      const r = await menu.customMenu(k, 1, 1);
      if (r === 0xff) return;
      sa[sel] = 0;
      for (let j = 0; j < 9; j++) if (sg[j] === lg[r]) { sel = j; break; }
      sg[sel] = g = lg[r];
    }
    let cur = sa[sel], k = 0xff;
    for (let j = 0; j < 9; j++) {
      if (lg[j] === g) { cur = (cur + la[j]) & 0xffff; k = j; break; }
      if (k === 0xff && lg[j] === 0xff) k = j;
    }
    if (k === 0xff) return;
    const room = (sa[sel] + st.u16(ship + 0x14) - total) & 0xffff;
    const v = (await this.numpad.input(0, s16b(umin16(room, cur)))) & 0xffff;
    sa[sel] = v;
    lg[k] = sg[sel]; la[k] = (cur - v) & 0xffff;
    if (!sa[sel] && !(sg[sel] & 0x80)) sg[sel] = 0xff;
    if (!la[k]) lg[k] = 0xff;
  }
  // 1fb6e 一艘船的裝卸
  async shipLoad(slot, lg, la) {
    const { win, menu } = this.c, R = menu.rects, sg = new Array(9).fill(0xff), sa = new Array(9).fill(0);
    win.shadowedSaved(0x16, 0x40, 0x14, 0xd0, 1);
    for (;;) {
      const n = this.shipList(slot, sg, sa), m = n < 9 ? n + 1 : n;
      for (let i = 0; i < m; i++) R[i] = { x0: 0xc0, x1: 0x140, y0: (i + 7) << 4, y1: ((i + 7) << 4) + 0x10 };
      R[m] = { x0: 0xb0, x1: 0x150, y0: 0x40, y1: 0x110 };
      const r = await menu.customMenu(m, 1, 1);
      if (r === 0xff) { await win.close(); return; }
      await this.loadItem(slot, r, sg, sa, lg, la);
      this.shipWrite(slot, sg, sa);
      this.leftList(lg, la);
    }
  }
  // 1fcf7 (0fea:fe57) 剩餘貨物分配: 選艦隊的船 → 裝卸; Esc → 確認 (還有剩 0xd3 / 全部裝完 0xdb)
  async distribute(lg, la) {
    const { win, menu, con, message } = this.c, R = menu.rects;
    win.shadowedSaved(0x3a, 0x40, 0x14, 0xd0, 1);
    this.leftList(lg, la);
    for (;;) {
      const n = this.fleetShips();                                         // 1e8b5
      menu.count = n;
      for (let i = 0; i < n; i++) R[i] = { x0: 0x88, x1: 0x1b8, y0: (i + 3) * 0x18, y1: i * 0x18 + 0x58 };
      R[n] = { x0: 0x78, x1: 0x1d0, y0: 0x20, y1: (0x18 * n + 0x50) & 0xffff };
      con.bg = 0x0f;
      const sel = await menu.customMenu(n, 1, 1);
      if (sel === 0xff) {
        let sum = 0; for (let i = 0; i < 9; i++) sum = (sum + la[i]) & 0xffff;
        win.shadowedSaved(0x1e, 0x120, 0x1c, 0x48, 1);                     // 1edb5
        message(sum ? 0xd3 : 0xdb);
        if (await menu.yesNo()) { await win.close(); await win.close(); return; }
        await win.close();
        continue;
      }
      await this.shipLoad(this.c.persons[sel], lg, la);
      this.fleetTable();
    }
  }
  // 1fd9:85d9 (285d9) 補給港命名: 回傳值決定補給港選單是否結束 (取消 → 港名位址 ≠ 0; 完成 → 0fea:490b 的 AX)
  async namePort() {
    const st = this.st, { win, sys } = this.c, R = a => DS.TBL_PORT + a * 0x16 + 4, me = R(this.port);
    const old = st.cstr(me).slice();
    const restore = () => { for (let i = 0; i < old.length; i++) st.set8(me + i, old[i]); };
    this.greet(0x39e); await this.wait();
    const ni = this.nameInput();
    ni.prompt(3, 8);
    if ((await ni.run(me, 8)) !== 1) { await win.close(); restore(); return me; }
    await win.close();
    const cur = st.cstr(me);
    let dup = false;
    for (let n = 0; n < 0x82 && !dup; n++) {
      if (n === this.port) continue;
      const o = st.cstr(R(n));
      if (o.length === cur.length && o.every((v, i) => v === cur[i])) dup = true;          // seg0:4bea strcmp
    }
    if (dup) { restore(); this.greet(0x39f); }
    else this.greet(0x3a0, this.dstr(me));
    await this.wait();
    // 0fea:490b 最後是 seg0:4ecf: 有滑鼠時 AX = 顯示計數舊值 (≠0) 或 3 (INT 33h fn 3); 沒有滑鼠時 AX = 131e3 的 0
    return sys.mouse.present ? 1 : 0;
  }
  // 2b326 折抵船 (b2f4) 的砲、水手、補給與貨物 (原版目的船位也是 b2f4)
  transfer(flag, left) {
    const st = this.st, src = this.b2f4, dst = this.b2f4;
    const Md = this.crewData(dst), Ms = this.crewData(src), Sd = this.fleetSlot(dst), Ss = this.fleetSlot(src), shipD = this.shipOf(dst);
    left.goods.fill(0xff);
    st.set8(Sd + 6, umin16(st.u8(Ss + 6), st.u8(shipD + 0x11)));
    st.set8(Sd + 8, st.u8(Sd + 8) & 0xf8);
    if (st.u8(Sd + 6)) st.set8(Sd + 8, st.u8(Sd + 8) | (st.u8(Ss + 8) & 7));
    st.set16(Sd, umin16(st.u16(Ss), st.u16(shipD + 0x12)));
    if (flag && s16b(this.cargoUsed(src)) <= s16b(st.u16(shipD + 0x14))) {
      for (let k = 0; k < 8; k += 2) st.set16(Md + k, st.u16(Ms + k));
      for (let k = 0; k < 5; k++) { st.set8(Md + 0x16 + k, st.u8(Ms + 0x16 + k)); st.set16(Md + 0x0c + 2 * k, st.u16(Ms + 0x0c + 2 * k)); }
      return;
    }
    left.goods.fill(0xff);
    let c = 0;
    const add = (g, a) => { left.goods[c] = g; left.amt[c] = a & 0xffff; c++; };
    const w = Math.trunc(s16b(st.u16(Ms)) / 10); if (w) add(0x80, w);
    const f = Math.trunc(s16b(st.u16(Ms + 2)) / 10); if (f) add(0x81, f);
    if (st.u16(Ms + 4)) add(0x82, st.u16(Ms + 4));
    if (st.u16(Ms + 6)) add(0x83, st.u16(Ms + 6));
    for (let k = 0; k < 5; k++) { const g = st.u8(Ms + 0x16 + k); if (g !== 0xff) add(g, st.u16(Ms + 0x0c + 2 * k)); }
  }
  // 2ad12 建立新船記錄並命名
  async createShip(t) {
    const st = this.st, { win } = this.c, T = this.typeRec(t), tmpl = ListSelect.shipRec(t + 0x28);
    const S = this.fleetSlot(this.b2f6), M = this.crewData(this.b2f6), trade = this.b2f4 !== 0xff;
    let n = 0;
    for (let i = 0; i < 0x28; i++) if (st.u8(ListSelect.shipRec(i) + 0x0f) === 0xff) { n = i; break; }
    const si = ListSelect.shipRec(n);
    st.set8(si + 0x11, st.u8(T + 8)); st.set8(si + 0x0f, t);
    st.set8(si + 0x10, st.u8(tmpl + 0x10)); st.set16(si + 0x12, st.u16(tmpl + 0x12));
    st.set16(si + 0x14, (st.u16(T + 6) - st.u8(si + 0x11) - st.u16(si + 0x12)) & 0xffff);
    const d = Math.trunc(9 * st.u8(T + 1) / 10) & 0xffff;
    st.set8(S + OFF.DOCK_SLOT.MAX_DURABILITY, (d - Math.trunc((d & 0xff) / 15)) & 0xff); st.set8(S + OFF.DOCK_SLOT.DURABILITY, st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY));
    st.set8(S + OFF.DOCK_SLOT.TURN, st.u8(T + 2)); st.set8(S + OFF.DOCK_SLOT.PROPULSION, st.u8(T + 3));
    st.set8(S + OFF.DOCK_SLOT.GUNS, umin16(st.u8(S + OFF.DOCK_SLOT.GUNS), trade ? st.u8(si + 0x11) : 0));
    st.set16(S, umin16(st.u16(S), trade ? st.u16(si + 0x12) : 0));
    st.set8(S + OFF.DOCK_SLOT.SHIP, n);
    if (!trade) st.set8(S + OFF.DOCK_SLOT.FLAGS, 0x10);
    for (const k of [0, 2, 4, 6]) st.set16(M + k, 0);
    st.set8(M + 8, 0x19); st.set8(M + 9, 0x32); st.set8(M + 0x1b, this.b2f7);
    st.set16(M + 0x0a, 0); st.set8(M + 0x1d, 0);
    for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    this.greet(0xc7);
    const ni = this.nameInput();
    for (;;) {
      ni.prompt(2, 7);
      if ((await ni.run(si, 7)) === 1) break;
      await win.close();
    }
    await win.close();
  }
  // 2b2f2 船員欄第一個職務 ≥ 3 的人 → b2f7
  findMate() {
    const st = this.st;
    for (let i = 0; i < 0x1e; i++) { const n = st.u8(DS.PARTY_CREW + i); if (n !== 0xff && st.u8(st.personRecord(n) + 0x2e) >= 3) { this.b2f7 = n; return 1; } }
    return 0;
  }
  // 2b66a 決定新船的船長與船位
  async captainAndSlot() {
    this.b2f5 = this.b2f4 = 0xff;
    let need = 0;
    if (!this.findMate()) { this.greet(0xa6); await this.wait(); need = 1; }
    if (this.fleetShips() === 10) need = 1;
    if (need) {
      this.greet(0xa7); await this.wait();
      this.b2f6 = await this.sellSelect(0);
      return this.b2f6 === 0xff ? 0 : 1;
    }
    for (let i = 0; i < 10; i++) { const f = this.slotState(i); if (f !== 0x10 && f !== 0x20) { this.b2f6 = i; break; } }
    return 1;
  }
  // 2b701 交船
  async delivery() {
    const st = this.st, E = this.eco, { menu } = this.c;
    let slot = 0;
    for (let i = 0; i < 0x28; i++) if (st.u8(this.crewData(i) + 0x1b) === (this.port | 0x80) && this.slotState(i) === 0x20) { slot = i; break; }
    this.b2f6 = 0xff;
    this.greet(0xfa); await this.wait();
    this.greet(0x107); this.freeSlots();
    if (!(await menu.yesNo()) || !(await this.captainAndSlot())) { this.greet(0x109); await this.wait(); return; }
    const S = this.fleetSlot(slot), M = this.crewData(slot);
    st.set8(S + OFF.DOCK_SLOT.FLAGS, (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xdf) | 0x10);
    st.set8(M + 0x1b, this.b2f7);
    if (this.b2f7 !== st.hero) st.set8(st.personRecord(this.b2f7) + 0x2e, 2);
    st.set8(E + 0x23, 0xff);
    if (this.b2f6 !== 0xff) this.swapSlots(slot, this.b2f6);
    this.compactSlots();
    if (this.b2f4 !== 0xff) {
      this.b2f4 = slot;
      const left = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
      this.transfer(1, left);
      this.sellDone();
      if (left.goods[0] !== 0xff) await this.leftovers(left);
    }
    st.set8(st.personRecord(this.b2f7) + 0x2e, this.b2f7 !== st.hero ? 2 : 1);
  }
  // 2be49 買舊船
  async usedShip() {
    const st = this.st, { menu } = this.c, list = this.listSel(), P = this.c.persons;
    this.b2f8 = 0;
    if (!(await this.captainAndSlot())) return;
    const base = DS.TBL_USED_SHIP_CACHE, idx = [];                                        // seg0:5cc4(0): 2be62 / 2bf29 都是 sub al, al
    let n = 0;
    for (let i = 0; i < 5; i++) { const t = st.u8(base + i); if (t !== 0xff) { idx[n] = i; P[n++] = t + 0x28; } }
    for (;;) {
      const r = await list.select(0x8e, n);
      if (r === -1) return;
      const t = (P[r] - 0x28) & 0xff;
      this.shipData(t, 1);
      this.greet(this.BT.typeMsg[t]); await this.wait();
      this.greet(0xc1);
      if (!(await menu.yesNo())) continue;
      if (!(await this.negotiate(t, st.u16(this.typeRec(t) + 0x0a)))) return;
      if (this.b2f7 !== st.hero) st.set8(st.personRecord(this.b2f7) + 0x2e, 2);
      st.set8(base + idx[r], 0xff);
      return;
    }
  }
  // 2c664 改造
  async remodel() {
    if (!this.fleetShips()) return;
    let sel;
    do {
      sel = await this.menu(this.c.menuItems(23));
      if (sel !== 0xff) { await [() => this.rmFigure(), () => this.rmGuns(), () => this.rmRatio(), () => this.rmName()][sel](); this.after(); }
    } while (sel !== 0xff);
  }
  // 改造子功能共用: 選艦隊的船並顯示資料 (清單 0x80 → 2af30(3) + 2b119)
  async rmPick(msg) {
    this.greet(msg);
    const r = await this.listSel().select(0x80, this.fleetShips());
    if (r === -1) return -1;
    const slot = this.c.persons[r];
    this.shipData(this.st.u8(this.fleetSlot(slot) + 7), 3, slot); this.figurehead(slot);
    return slot;
  }
  // 2c371 船首像
  async rmFigure() {
    const st = this.st, E = this.eco, H = this.hero, rng = this.c.sys.rng;
    let n = umin16(Math.trunc(st.u16(E) / 100) + 1, 8);
    if (st.u16(E + 4) > 800 && st.u16(E) > 800 && st.u8(H + 0x23) > 80 && !rng.random(20)) {
      n++; if (rng.random(st.u8(H + 0x23)) >= 90) n++;
      this.greet(0x10a); await this.wait();
    }
    for (;;) {
      const slot = await this.rmPick(0x10b);
      if (slot === -1) return;
      await this.chooseFigure(slot, n);
      this.p.panels();
    }
  }
  // 2c11d
  async chooseFigure(slot, n) {
    const st = this.st, { menu } = this.c, P = this.c.persons, M = this.crewData(slot);
    for (let i = 0; i < n; i++) P[i] = i + 1;
    for (;;) {
      this.greet(0x10c);
      const r = await this.listSel().select(0x90, n);
      if (r === -1) return;
      const v = P[r] & 0xff, price = v * v * 500;
      this.greet(0x10d, price);
      if (!(await menu.yesNo())) continue;
      if (this.money < price) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - price) | 0;
      st.set8(M + 0x1d, v);
      this.p.panels();
      return;
    }
  }
  // 2c43d 武裝
  async rmGuns() {
    const st = this.st, E = this.eco, H = this.hero, rng = this.c.sys.rng;
    let n = umin16(Math.trunc(((st.u16(E + 4) + st.u16(E)) & 0xffff) / 200) + 1, 6);
    if (st.u16(E + 4) > 900 && st.u16(E) > 900 && st.u8(H + 0x23) > 90 && !rng.random(20)) {
      n++; this.greet(0x10a); await this.wait();
    }
    for (;;) {
      const slot = await this.rmPick(0x10e);
      if (slot === -1) return;
      await this.chooseGuns(slot, n);
      this.p.panels();
    }
  }
  // 2c1da
  async chooseGuns(slot, n) {
    const st = this.st, { menu } = this.c, P = this.c.persons, BT = this.BT;
    const S = this.fleetSlot(slot), ship = this.shipOf(slot);
    for (let i = 0; i < n; i++) P[i] = i + 1;
    for (;;) {
      this.greet(0x10c);
      const r = await this.listSel().select(0x91, n);
      if (r === -1) return;
      const v = P[r] & 0xff, kind = r + 1;
      let room = st.u8(ship + 0x11);
      if (!room) { this.greet(0x3fd); await this.wait(); continue; }
      const same = (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7) === kind;
      if (same) {
        room = (room - st.u8(S + OFF.DOCK_SLOT.GUNS)) & 0xffff;
        if (!room) { this.greet(0x3fc); await this.wait(); continue; }
        this.greet(0x14e, BT.cannons[v], st.u8(S + OFF.DOCK_SLOT.GUNS), room);
      } else this.greet(0x10f);
      let q = (await this.numpad.input(0, room)) & 0xff;
      if (!q) continue;
      const price = Math.imul(q, s16b(BT.cannonPrice[v])) | 0;
      this.greet(0x110, BT.cannons[v], q, price);
      if (!(await menu.yesNo())) continue;
      if (price > this.money) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - price) | 0;
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7) === kind) q = (q + st.u8(S + OFF.DOCK_SLOT.GUNS)) & 0xff;
      st.set8(S + OFF.DOCK_SLOT.GUNS, q);
      st.set8(S + OFF.DOCK_SLOT.FLAGS, (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xf8) | (kind & 0xff));
      this.p.panels();
      return;
    }
  }
  // 2c4f6 積載比例變更
  async rmRatio() {
    const st = this.st, { menu } = this.c;
    for (;;) {
      const slot = await this.rmPick(0x111);
      if (slot === -1) return;
      const cost = s16b(st.u16(this.typeRec(st.u8(this.shipOf(slot) + 0x0f)) + 0x0a));
      this.greet(0x112, cost);
      if (!(await menu.yesNo())) continue;
      if (cost > this.money) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      if (await this.design(slot)) { this.money = (this.money - cost) | 0; this.p.panels(); }
    }
  }
  // 2c5c2 船名變更
  async rmName() {
    const st = this.st, { win } = this.c;
    for (;;) {
      const slot = await this.rmPick(0x111);
      if (slot === -1) return;
      const ship = this.shipOf(slot);
      this.greet(0x113);
      const old = st.cstr(ship).slice(), n = old.indexOf(0) < 0 ? old.length : old.indexOf(0);
      const ni = this.nameInput();
      ni.prompt(2, 7);
      if ((await ni.run(ship, 7)) !== 1) { for (let i = 0; i < n; i++) st.set8(ship + i, old[i]); st.set8(ship + n, 0); }
      await win.close();
      this.p.panels();
    }
  }
  // 2bf40 修理
  async repair() {
    const st = this.st, { menu, message } = this.c, list = this.listSel();
    for (;;) {
      const n = this.fleetShips();
      if (!n) return;
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const S = this.fleetSlot(this.c.persons[r]), T = this.typeRec(st.u8(this.shipOf(this.c.persons[r]) + 0x0f));
      let cost = s16b(st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY) - st.u8(S + OFF.DOCK_SLOT.DURABILITY) - st.u8(S + OFF.DOCK_SLOT.TURN) - st.u8(S + OFF.DOCK_SLOT.PROPULSION) + st.u8(T + 2) + st.u8(T + 3));
      if (!cost) { this.greet(0xcc); await this.wait(); continue; }
      cost = s16b(cost * 20);
      this.greet(0xcd, cost);
      if (!(await menu.yesNo())) { this.greet(0xce); await this.wait(); continue; }
      if (cost > this.money) { this.crewSpeaks([4, 3, 5, 2, 6]); message(0xcf); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - cost) | 0;
      st.set8(S + OFF.DOCK_SLOT.DURABILITY, st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY)); st.set8(S + OFF.DOCK_SLOT.TURN, st.u8(T + 2)); st.set8(S + OFF.DOCK_SLOT.PROPULSION, st.u8(T + 3));
      this.p.panels();
    }
  }
  // 2b571 選擇要賣的船 (flag: 主角是該船船長時另選一艘當主角的船)
  async sellSelect(flag) {
    const st = this.st, { menu, message } = this.c, list = this.listSel();
    for (;;) {
      this.b2f5 = this.b2f4 = 0xff;
      this.greet(0xc8);
      const r = await list.select(0x80, this.fleetShips());
      if (r === -1) return this.b2f4;
      const slot = this.b2f4 = this.c.persons[r];
      this.shipData(st.u8(this.fleetSlot(slot) + 7), 3, slot); this.figurehead(slot);
      this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      const M = this.crewData(slot);
      if (st.u8(M + 0x1b) === st.hero) {
        this.crewSpeaks(); message(0xd1);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        if (flag) {
          this.talkClear(); message(0xd2);
          const r2 = await list.select(0x80, this.notHeroShips());
          if (r2 === -1) { await this.closeTalk(); continue; }
          this.b2f5 = this.c.persons[r2];
        }
        await this.closeTalk();
      }
      this.b2f7 = st.u8(M + 0x1b);
      return this.b2f4;
    }
  }
  // 2c043 賣船
  async sellShip() {
    const st = this.st, { menu, message } = this.c;
    for (;;) {
      const n = this.fleetShips();
      if (!n) return;
      if (n === 1) { this.greet(0xd0); await this.wait(); return; }
      if ((await this.sellSelect(1)) === 0xff) return;
      const slot = this.b2f4;
      if (this.cargoUsed(slot)) {
        this.crewSpeaks(); message(0xd3);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        await this.closeTalk();
      }
      if (st.u16(this.fleetSlot(slot))) {
        this.crewSpeaks(); message(0xd4);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        await this.closeTalk();
      }
      this.greet(0xd5, Math.trunc(this.shipPrice(slot) / 2));
      if (!(await menu.yesNo())) { this.greet(0xd6); await this.wait(); continue; }
      this.sellDone();
    }
  }
  // 2b4f2
  sellDone() {
    const st = this.st, M = this.crewData(this.b2f4);
    if (this.b2f5 !== 0xff) { const M2 = this.crewData(this.b2f5); st.set8(M + 0x1b, st.u8(M2 + 0x1b)); st.set8(M2 + 0x1b, st.hero); }
    st.set8(st.personRecord(st.u8(M + 0x1b)) + 0x2e, 6);
    let m = this.money + Math.trunc(this.shipPrice(this.b2f4) / 2);
    if (m > 600000000) m = 600000000;
    this.money = m;
    this.removeShip(this.b2f4);
    this.p.panels();
  }
  // 2c8d0 工業投資
  async invest() {
    const st = this.st, E = this.eco;
    if (this.isCapital()) { this.greet(2); await this.wait(); return; }
    if (st.u16(E + 6) >= 50000) { this.greet(7); await this.wait(); return; }
    this.greet(8);
    const di = this.money >= 50000 ? 50000 : this.money & 0xffff;
    const v = await this.numpad.input(0, umin16(di, 50000 - st.u16(E + 6)));
    if (!v) { this.greet(0x0d); await this.wait(); return; }
    this.greet(v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10); await this.wait();
    st.set16(E + 6, st.u16(E + 6) + v);
    this.investSupport(v);
    this.investOwner();
    this.money = (this.money - v) | 0;
    this.p.panels();
  }
  // 2c6c6 投資轉移各國支持度 (經濟 +8..+0d)
  investSupport(amount, ind = this.st.u16(this.eco + 4)) {                    // 交易所 24f92 以商業值 (+0) 為基準
    const st = this.st, E = this.eco, nat = st.u8(this.hero + 0x31) & 15;
    const q = Math.trunc(amount / ind);
    let v;
    if (nat !== 6) { v = umin16(q, 100 - st.u8(E + 8 + nat)) & 0xff; st.set8(E + 8 + nat, st.u8(E + 8 + nat) + v); }
    else v = umin16(q, 100) & 0xff;
    let others = 0; for (let i = 0; i < 6; i++) if (st.u8(E + 8 + i) && i !== nat) others++;
    let each = 0, rest = 0;
    if (others) { each = Math.trunc(v / others) & 0xff; rest = (v % others) & 0xff; }
    for (let i = 0; i < 6; i++) {
      const a = E + 8 + i, x = st.u8(a);
      if (!x || i === nat) continue;
      if (each <= x) st.set8(a, x - each); else { rest = (rest + each - x) & 0xff; st.set8(a, 0); }
    }
    let start;
    do {
      start = rest;
      for (let i = 0; i < 6 && rest; i++) { const a = E + 8 + i; if (st.u8(a) && i !== nat) { st.set8(a, st.u8(a) - 1); rest = (rest - 1) & 0xff; } }
    } while (rest !== start);
  }
  // 2c7ec 支持度 ≥ 75 的國家取得本港; 主角國家新取得時加聲望
  investOwner() {
    const st = this.st, E = this.eco, P = DS.TBL_PORT + this.port * 0x16, nat = st.u8(this.hero + 0x31) & 15, D = this.heroData;
    const old = st.u8(P + 0x15) & 7;
    let owner = 6; for (let i = 0; i < 6; i++) if (st.u8(E + 8 + i) >= 0x4b) owner = i;
    st.set8(P + 0x15, (st.u8(P + 0x15) & 0xf8) | owner);
    if (old !== 6 && owner !== old && old !== nat) { const a = D + 6 + old; st.set8(a, st.u8(a) - umin16(5, st.u8(a))); }
    if (old !== nat && owner === nat) {
      st.set16(D, st.u16(D) + umin16(50000 - st.u16(D), st.u16(E + 4) + st.u16(E)));
      st.set8(D + 6 + nat, umin16(st.u8(D + 6 + nat) + 5, 200));
    }
  }
  // 27a63
  async departWrap() {
    if (!this.fleetShips()) return 0;
    const r = await this.depart();
    if (!r) await this.p.interior(3);
    return r;
  }
  // seg0:2260 清除畫面 (欄 12..59, y 8..391): 16 步, 偶數行由每 16 像素組的第 7 像素往左、奇數行由第 8 像素往右逐點清成 0
  //   網頁版: 原版這 16 步之間沒有計時等待, 靠慢 CPU 逐步呈現 (約 0.3 秒, 記帳表 Buildings.wipe); 整段耗時已在呼叫時記帳,
  //   這裡把每步畫完的畫面依比例排在虛擬時間上 (CPU.hold) 讓瀏覽器逐步顯示。不改畫面內容, 測試模式 (capture = null) 不受影響
  wipe() {
    const fb = this.c.scr.fb;
    const total = CPU.active && CPU.khz ? WIPE_CYC / (CPU.khz * (1 - CPU.irqLoad)) : 0, t0 = CPU.v - total;
    let dx = 0xfffe, cx = 0x7fff;
    for (let step = 0; step < 16; step++) {
      for (let y = 8; y < 8 + 0x180; y++) {
        const m = (y - 8) & 1 ? cx : dx, row = y * 640;
        for (let col = 12; col < 60; col += 2)
          for (let b = 0; b < 2; b++) {
            const bits = b ? m >> 8 : m & 0xff;
            for (let px = 0; px < 8; px++) if (!((bits >> (7 - px)) & 1)) fb[row + (col + b) * 8 + px] = 0;
          }
      }
      dx = (dx << 1) & 0xffff; cx >>= 1;
      if (total) CPU.hold(t0 + total * (step + 1) / 16);
    }
    this.c.scr.dirty = true;
  }
  // 27802 出航: 艦隊資料表 → 補給天數 → 是/否
  //   積載率 = 5d36 × 100 (imul cx → DX:AX 32 位元) / 船 +14 (cwd) 經 seg0:38ba 無號長整數除法 (2793a..2793e); 不是 16 位元截斷
  async depart() {
    const st = this.st, { con, printf, message, menu, palette, scr } = this.c, anim = st.u8(DS.OPTIONS) & 1;
    const n = this.fleetShips(), L = this.c.persons.slice(0, n);
    if (anim) this.wipe(); else { await palette.fadeBlack(); scr.fillCols(0x0c, 8, 0x30, 0x180, 0); }
    this.winText(0x0d, 0x20, 0x2e, ((n + 2) * 0x18) & 0xffff);
    con.setCursor(0x1e, 0x30); con.puts(this.WF.departHdr);
    let noDriver = 0, crewT = 0, waterT = 0, foodT = 0;
    for (let i = 0; i < n; i++) {
      const slot = L[i], M = this.crewData(slot), S = this.fleetSlot(slot), ship = this.shipOf(slot);
      const crew = s16b(st.u16(S));
      waterT = (waterT + st.u16(M)) & 0xffff; foodT = (foodT + st.u16(M + 2)) & 0xffff; crewT = (crewT + st.u16(S)) & 0xffff;
      const drv = Math.trunc(crew * st.u8(M + 9) / 100), look = Math.trunc(crew * st.u8(M + 8) / 100);
      con.setCursor(0x0f, ((i + 3) * 0x18) & 0xffff);
      printf(this.WF.departRow, this.dstr(ship), drv, look, s16b(st.u16(S) - look - drv),
        s16b(Math.floor((Math.imul(s16b(this.cargoUsed(slot)), 100) >>> 0) / (s16b(st.u16(ship + 0x14)) >>> 0 || 1)) & 0xffff), Math.trunc(s16b(st.u16(M)) / 10), Math.trunc(s16b(st.u16(M + 2)) / 10));
      if (!drv) noDriver = 1;
    }
    this.crewSpeaks();
    const fail = async m => { message(m); if (!anim) await palette.fadeToTarget(); await this.wait(); await this.closeTalk(); return 0; };
    if (noDriver) return fail(0x39);
    const days = Math.trunc(umin16(waterT, foodT) / (crewT || 1));
    if (!days) return fail(0x3b);
    if (days >= 10 && days <= 0xb4) message(0x3d, days); else message(days >= 10 ? 0x3a : 0x3c);
    if (!anim) await palette.fadeToTarget();
    const ok = await menu.yesNo();
    await this.closeTalk();
    if (!ok) return 0;
    // 27a0c 出港: 0fea:e3e5 記錄 (種類 1, +4 天數, +6 港口) → [2e18] = 0 (出港天數), 方位 = 8 (停船) → 4fe3 清滑鼠移動量 → [1005] &= DF
    //   → 0fea:9348 / 9401 (扣一天的糧食與水) → 851f 進入海上 → [0caf] = FF, 回傳 1 (碼頭選單結束)
    marketTradeLog(st, this.c.rt, 1, days, 0, 0, this.port);
    st.set8(DS.DAYS_AT_SEA, 0);
    const sea = this.p;
    st.set8(sea.fleet + 0x1a, 8);
    this.c.sys.mickeys();
    st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0xdf);
    sea.foodDaily(); sea.waterDaily();
    await sea.enterSea();
    st.set8(DS.LAST_PORT, 0xff);
    return 1;
  }
  // 27e31 補給
  async supply() {
    const st = this.st, { con, menu } = this.c, labels = [this.WF.load, this.WF.unload];
    const n = this.fleetShips();
    if (!n) return 0;
    this.c.win.frame(0x0d, 0x20, 0x2e, ((n + 2) * 0x18) & 0xffff, 0);
    con.setCursor(0x10, 0x30); con.puts(labels[0]);
    con.setCursor(0x23, 0x30); con.puts(this.WF.supplyHdr);
    menu.cur = 0;
    let mode = 0;
    for (;;) {
      this.supplyTable();
      const sel = await menu.customMenu(menu.count, 4, 1);
      if (sel === 0xff) break;
      if (((menu.count - 4) & 0xff) > sel) {
        const slot = this.c.persons[sel >> 2], item = sel & 3;
        if (mode === 0) await this.load(slot, item); else await this.unload(slot, item);
        this.p.panels();
      } else { con.setCursor(0x10, 0x30); mode ^= 1; con.puts(labels[mode]); }
    }
    await this.p.interior(3);
    this.greet(0x38);
    return 0;
  }
  // 27d00 補給表與點擊區 (每船 4 格 + 裝上/卸下切換鈕 4 個相同區域 + 取消區)
  supplyTable() {
    const st = this.st, { con, printf, menu } = this.c, R = menu.rects;
    const n = this.fleetShips();
    con.puts(this.WF.supplyColor);
    for (let i = 0; i < n; i++) {
      const slot = this.c.persons[i], M = this.crewData(slot), y = ((i + 3) * 0x18) & 0xffff;
      con.setCursor(0x12, y);
      printf(this.WF.supplyRow, this.dstr(this.shipOf(slot)), Math.trunc(s16b(st.u16(M)) / 10), Math.trunc(s16b(st.u16(M + 2)) / 10), s16b(st.u16(M + 4)), s16b(st.u16(M + 6)));
      for (let j = 0; j < 4; j++) { const x0 = j * 0x28 + 0x108; R[i * 4 + j] = { x0, x1: x0 + 0x20, y0: y, y1: y + 0x10 }; }
    }
    menu.count = n * 4;
    for (let k = 0; k < 4; k++) R[menu.count++] = { x0: 0x80, x1: 0xc0, y0: 0x30, y1: 0x40 };
    R[menu.count] = { x0: 0x68, x1: 0x1d8, y0: 0x20, y1: n * 0x18 + 0x20 };
  }
  // 27a83 裝上 (0 水 1 食物 2 資材 3 砲彈)
  async load(slot, item) {
    const st = this.st, { message, win } = this.c, M = this.crewData(slot), E = this.eco;
    let space = s16b(st.u16(this.shipOf(slot) + 0x14) - this.cargoUsed(slot)), price = 0;
    win.save(0x15, 0x148, 0x1e, 0x40);
    this.winText(0x15, 0x148, 0x1e, 0x38);
    if (item === 0) message(0x3e, space);
    else {
      const [cx, off] = [[0x14, 0x10], [0x5a, 0x17], [0x78, 0x10]][item - 1];
      price = Math.trunc(((st.u8(E + off) + 0x32) * cx) / 100);
      let mx = Math.trunc(this.money / price);
      if (mx > space) mx = space;
      space = mx;
      message(0x3e + item, price, space);
    }
    const v = await this.numpad.input(0, space);
    const add = (o, d) => st.set16(M + o, st.u16(M + o) + d);
    switch (item) {
      case 0: add(0, 10 * v); break;
      case 1: add(2, 10 * v); break;
      case 2: add(4, v); break;
      case 3: add(6, v); break;
    }
    if (item) this.money = (this.money - Math.imul(v, price)) | 0;
    await this.closeTalk();
  }
  // 27c16 卸下
  async unload(slot, item) {
    const st = this.st, { printf, win } = this.c, M = this.crewData(slot);
    win.save(0x15, 0x148, 0x1e, 0x40);
    this.winText(0x15, 0x148, 0x1e, 0x38);
    const off = [0, 2, 4, 6][item], have = item < 2 ? Math.trunc(s16b(st.u16(M + off)) / 10) : s16b(st.u16(M + off));
    printf(this.WF.unloadAsk, have);
    const v = await this.numpad.input(0, have);
    st.set16(M + off, st.u16(M + off) - (item < 2 ? 10 * v : v));
    await this.closeTalk();
  }
  // ================= 4 旅館 1fd9:8f84 =================
  async inn() {
    const { sys } = this.c, st = this.st;
    if (this.noEvent()) this.greet(0x42);
    this.c.randomParts = sys.rng.random(0x3fff) | 0xc000;              // [bdc6]
    const items = this.c.menuItems(4);
    let sel;
    do {
      for (let i = 0; i < 6; i++) if (st.u8(DS.TBL_COUNTRY + i * 0x20 + 0x0a) === this.port) this.c.menu.disabled = 2;
      sel = await this.menu(items);
      if (sel !== 0xff) await [() => this.innChat(), () => this.innSupport(), () => this.innSleep()][sel]();
      this.after();
    } while (sel !== 0xff && sel !== 2);
  }
  // 1fd9:8e73 (線性 28c03) 與航海者閒聊: 清單 0x86 → 對象發言 (7f06) → 28a7b → 796d, 直到沒有人或 Esc
  async innChat() {
    const list = this.listSel();
    for (let n = await this.innChatList(); n; n = await this.innChatList()) {
      this.after();                                                        // 0fea:b6e0
      const r = await list.select(0x86, n);
      if (r === -1) return;
      const who = this.c.persons[r] & 0xff;
      this.talkPerson(who);
      await this.innTalk(who);
      await this.closeTalk();
    }
  }
  // 28a7b 旅館的航海者: 同艦隊 → 0x45..0x47; 艦隊 0x3c..0x45 → 0x35b/0x35c; 否則 0x48 → 自我介紹 (0x49 船長 / 0x4a 其他 / 0x4b 無所屬)
  //   → MENU #3 前兩項 (航海者情報 264a0 / 僱用 26708 (不要求好感)), DS:b0a4
  async innTalk(n) {
    const st = this.st, { message, sys } = this.c;
    this.mateNo = n; this.mate = st.personRecord(n);                       // [b0a2]→[bb38], [bd8c]→[aeea]
    const M = this.mate, f = st.u8(M + 0x2c);
    if (st.u8(this.hero + 0x2c) === f) { message(0x45 + sys.rng.random(3)); await this.wait(); return 0; }
    if (f < 0x46 && f >= 0x3c) { message(0x35b + sys.rng.random(2)); await this.wait(); return 1; }
    message(0x48); await this.wait();
    this.talkClear();
    if (f === 0xff) message(0x4b);
    else {
      const kinds = this.c.menuItems(2), r = f % 10, kind = kinds[r ? Math.trunc(r / 5) + 1 : 0], nation = this.p.nations[Math.trunc(f / 10)];
      if (st.u8(M + 0x2e) === 1) message(0x49, nation, kind, this.dstr(M));
      else message(0x4a, nation, kind, this.T.crewRoles[st.u8(M + 0x2e)], this.dstr(M));
    }
    const sel = await this.menu(this.c.menuItems(3).slice(0, 2));            // 「決鬥」不在旅館 (bl = 2)
    if (sel !== 0xff) await [() => this.mateInfo(), () => this.mateHire(0)][sel]();
    return 1;
  }
  // 28a16
  async innChatList() {
    const { win } = this.c;
    const n = this.portPersons();
    if (n && this.c.persons[0] !== 0xff) return n;
    if (!n) { this.crewSpeaks(); this.c.message(0x43); }
    else { this.talkFace(this.st.u8(DS.TBL_PORT + this.port * 0x16 + 0x15) & 7, this.c.randomParts); this.c.message(0x44); }
    await this.wait();
    await win.close();
    return 0;
  }
  // 1fd9:8ec3 海港支持度
  async innSupport() {
    const { con, printf } = this.c, st = this.st, E = DS.TBL_PORT_ECONOMY + this.port * 0x25, R = DS.TBL_PORT + this.port * 0x16;
    this.table();
    con.setCursor(0x23, 0x98); con.puts(B_SUPPORT_HDR);
    con.setCursor(0x2b, 0x98); con.puts(B_ALLY_HDR);
    for (let i = 0; i < 6; i++) {
      con.setCursor(0x15, (i + 11) << 4);
      printf(B_SUPPORT_FMT, this.p.nations[i], st.u8(E + 8 + i));
      if ((st.u8(R + 0x15) & 7) === i) { con.setCursor(0x2d, (i + 11) << 4); con.puts(B_STAR); }
    }
    await this.wait();
  }
  // 1fd9:8eb8 就寢
  async innSleep() { this.st.set8(DS.DAILY_FLAGS, this.st.u8(DS.DAILY_FLAGS) | 0x80); await this.c.palette.fadeBlack(); }
  // ================= 10 教會 1fd9:cede =================
  async church() {
    const st = this.st;
    this.worship = 1;                                                    // [c2d2]
    const nation = st.u8(this.hero + 0x31) & 15;
    this.mosque = this.p.colonyChurch() ? 1 : 0;                         // [bda0] = CHIP_NO.DAT[港] == 2
    if (!this.mosque && nation === 2) { this.greet(0x5a); await this.wait(); return; }
    if (this.mosque && nation !== 2) { this.greet(0x322); await this.wait(); return; }
    const base = this.mosque * 0x2c8, items = this.c.menuItems(7);    // 2cbdb
    if (this.noEvent()) this.greet(base + 0x5b);
    let sel;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff) await [() => this.pray(base), () => this.donate(base)][sel]();
      this.after();
    } while (sel !== 0xff);
    this.greet(base + 0x60);
    await this.wait();
    this.after();
  }
  async pray(base) {                                                     // 1fd9:ccfa
    this.greet(base + 0x5c);
    if (this.worship) {
      const H = this.hero, v = this.c.sys.rng.random(2) + this.st.u8(H + 0x23);
      this.st.set8(H + 0x23, Math.min(100, v));
      this.worship = 0;
    }
    await this.wait();
  }
  async donate(base) {                                                   // 1fd9:cd40
    this.greet(base + 0x5d);
    const amt = await this.numpad.input(0, this.money);
    if (!amt) return;
    const ratio = Math.trunc(this.money / amt) | 0;
    if (ratio > 10) this.greet(base + 0x5e);
    else {
      this.greet(base + 0x5f);
      const r = ((this.c.sys.rng.random(5) + 1) * 100) & 0xffff;
      if (amt >= r) { const H = this.hero; this.st.set8(H + 0x23, Math.min(100, (this.st.u8(H + 0x23) - ratio + 0x0b) & 0xffff)); }
    }
    this.money = (this.money - amt) | 0;
    await this.wait();
  }
  // ================= 11 占卜師 1fd9:d647 =================
  async fortune() {
    const { menu } = this.c;
    if (this.noEvent()) this.greet(0x12a);
    const items = this.c.menuItems(17);
    let sel;
    do {
      if (!this.crewCount()) menu.disabled |= 8;                         // 0fea:2f1b
      if (this.st.hero === 1) menu.disabled |= 4;
      sel = await this.menu(items);
      if (sel !== 0xff) {
        this.greet(0x12b);
        if (await menu.yesNo()) {
          if (this.money < 0x32) { this.greet(0x12c); await this.wait(); sel = 0xff; }
          else {
            this.money = (this.money - 0x32) | 0;
            this.greet(0x12d); await this.wait();
            await [() => this.fLife(), () => this.fCareer(), () => this.fLove(), () => this.fFriend()][sel]();
          }
        }
      }
      this.after();
    } while (sel !== 0xff);
  }
  // 0fea:2f1b = 12dbb: 艦隊船員 [2e1b] → [0538]
  crewCount() {
    const L = []; for (let i = 0; i < 0x1e; i++) { const v = this.st.u8(DS.PARTY_CREW + i); if (v !== 0xff) L.push(v); }
    this.setPersons(L); return L.length;
  }
  async fLife() { this.greet(Math.trunc(this.st.u8(this.hero + 0x23) / 0x19) + 0x12e); await this.wait(); }   // 1fd9:d480
  // 0fea:bce4 = 1bb84 下一級所需經驗 = min(等級, 18)² × 30
  static expNeed(lv) { const m = Math.min(lv, 0x12); return (m * m * 30) & 0xffff; }
  async fCareer() {                                                      // 1fd9:d49f
    const st = this.st, H = this.hero, D = this.heroData;
    this.greet(0x221, (Buildings.expNeed(st.u8(H + OFF.PERSON.NAV_LEVEL)) - st.u16(H + OFF.PERSON.NAV_EXP)) << 16 >> 16); await this.wait();
    this.greet(0x222, (Buildings.expNeed(st.u8(H + OFF.PERSON.BATTLE_LEVEL)) - st.u16(H + OFF.PERSON.BATTLE_EXP)) << 16 >> 16); await this.wait();
    if ((st.u8(H + OFF.PERSON.FACE) & 15) === 6) return;
    let fame = 0; for (let i = 0; i < 3; i++) if (st.u16(D + i * 2) > fame) fame = st.u16(D + i * 2);
    const need = this.p.P.data.titleFame[st.u8(D + 0x0d)];                // DS:b49a
    if (need > fame) this.greet(0x223, (need - fame) & 0xffff); else this.greet(0x2f2);
    await this.wait();
  }
  async fLove() {                                                        // 1fd9:d559
    const st = this.st; let found = -1, rec = 0;
    for (let i = 0; i < 0x1e; i++) {
      const m = DS.TBL_BARMAID + i * 0x13;
      if (st.u8(m + 0x0e) === this.port && (st.u8(m + 0x12) & 8) && !(st.u8(m + 0x12) & 0x40)) { found = i; rec = m; break; }
    }
    if (found < 0) this.greet(0x149);
    else if (st.u8(rec + 0x0f) >= 0x50) this.greet(0x146, st.cstr(rec));
    else this.greet(st.u8(rec + 0x0f) >= 0x32 ? 0x147 : 0x148);
    await this.wait();
  }
  // 1fd9:d5d4 (線性 2d364) 朋友運: 船員清單 0x89 → 0x4e + 運氣 (+23) / 25, 0x319 + 忠誠 (+2b) / 25
  async fFriend() {
    const st = this.st;
    this.greet(0x318); await this.wait();
    const n = this.crewCount();
    if (!n) return;
    const r = await this.listSel().select(0x89, n);
    if (r === -1) return;
    const P = st.personRecord(this.c.persons[r] & 0xff);
    this.greet(0x4e + Math.trunc(st.u8(P + 0x23) / 0x19)); await this.wait();
    this.greet(0x319 + Math.trunc(st.u8(P + 0x2b) / 0x19)); await this.wait();
  }
}
