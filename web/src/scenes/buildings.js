// buildings.js — 港口建築共用框架與分派器 (MAIN.EXE 1fd9 段, 處理函式表 DS:a612)
// 各建築實作已拆分為獨立模組:
//   0 交易所 (market.js) / 1 酒館 (tavern.js + gamble.js) / 2 造船廠 (shipyard.js) / 3 碼頭 (wharf.js)
//   4 旅館 + 10 教會 + 11 占卜師 (church_inn_fortune.js) / 5 王宮 (palace.js) / 6 事務所 (office.js)
//   7 住宅 (house.js) / 8 銀行 (bank.js) / 9 道具店 (itemshop.js)
import { NumPad } from "../ui/numpad.js";
import { ListSelect } from "../ui/listsel.js";
import { NameInput } from "../ui/nameinput.js";
import { Market } from "./market.js";
import { Palace } from "./palace.js";
import { Office } from "./office.js";
import { House } from "./house.js";
import { Bank } from "./bank.js";
import { ItemShop } from "./itemshop.js";
import { installTavern } from "./tavern.js";
import { installWharf } from "./wharf.js";
import { installShipyard } from "./shipyard.js";
import { installChurchInnFortune } from "./church_inn_fortune.js";
import { DS, OFF } from "../model/schema_views.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { calcCargoUsed, calcShipLoadTotal, calcShipSpeed } from "../domain/fleet.ts";

const bHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const B_SPEECH = Uint8Array.of(0x1b, 0x43, 0x30, 0x01, 0x1b, 0x42, 0x37, 0);   // DS:8c12
const B_COLOR = Uint8Array.of(0x1b, 0x43, 0x30, 0x1b, 0x42, 0x37, 0);          // DS:a60a / 8b79
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
  todo(n) { bTodo(n); }
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
    const goods = [st.u8(M + 0x16), st.u8(M + 0x17), st.u8(M + 0x18), st.u8(M + 0x19), st.u8(M + 0x1a)];
    const amts = [st.u16(M + 0x0c), st.u16(M + 0x0e), st.u16(M + 0x10), st.u16(M + 0x12), st.u16(M + 0x14)];
    return calcCargoUsed(st.u16(M), st.u16(M + 2), st.u16(M + 4), st.u16(M + 6), goods, amts);
  }
  shipOf(slot) { return ListSelect.shipRec(this.st.u8(this.fleetSlot(slot) + 7)); }
  // 277c0 視窗 (不保存背景) + 文字顏色
  winText(x, y, w, h) { this.c.win.frame(x, y, w, h, 0); this.c.con.puts(this.WF.winColor); }
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
    const st = this.st, ship = this.shipOf(slot), T = domS16(st.u16(this.typeRec(st.u8(ship + 0x0f)) + 0x0a));
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
  // ---------- 折抵舊船剩餘貨物重新分配 (RE_NOTES 20.9) ----------
  get LO() {                                                              // port.json leftover
    if (!this._lo) {
      const d = this.p.P.data.leftover;
      this._lo = { goods: this.p.P.data.goods.map(bHex), speedRate: d.speedRate, gunWeight: d.gunWeight, supplies: d.supplies.map(bHex),
        fmt: Object.fromEntries(Object.entries(d.fmt).map(([k, v]) => [k, bHex(v)])) };
    }
    return this._lo;
  }
  // seg0:5db1 船位 slot 的總載重 = 已用載貨 + 砲重 + 水手 (寫到船員配置 +0a)
  loadTotal(slot) {
    const st = this.st, S = this.fleetSlot(slot);
    return calcShipLoadTotal(this.cargoUsed(slot), this.LO.gunWeight[st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7], st.u8(S + OFF.DOCK_SLOT.GUNS), st.u16(S));
  }
  // 1c0a8 船速
  shipSpeed(slot) {
    const st = this.st, S = this.fleetSlot(slot), ship = this.shipOf(slot), t = st.u8(ship + 0x0f), T = this.typeRec(t);
    const M = this.crewData(slot), P = st.personRecord(st.u8(M + 0x1b));
    return calcShipSpeed({
      speedRate: this.LO.speedRate[t], propulsion: st.u8(S + OFF.DOCK_SLOT.PROPULSION),
      sailRatio: st.u8(M + 9), crew: st.u16(S), minCrew: st.u8(T + 5),
      loadTotal: st.u16(M + 0x0a), capacity: st.u16(T + 6),
      captainNavLevel: st.u8(P + 0x24), captainSailing: st.u8(P + 0x1d),
    });
  }
  // 2c6c6 投資轉移各國支持度 (經濟 +8..+0d)
  investSupport(amount, ind = this.st.u16(this.eco + 4)) {                    // 交易所 24f92 以商業值 (+0) 為基準
    const st = this.st, E = this.eco, nat = st.u8(this.hero + 0x31) & 15;
    const q = Math.trunc(amount / ind);
    let v;
    if (nat !== 6) { v = domUmin16(q, 100 - st.u8(E + 8 + nat)) & 0xff; st.set8(E + 8 + nat, st.u8(E + 8 + nat) + v); }
    else v = domUmin16(q, 100) & 0xff;
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
    if (old !== 6 && owner !== old && old !== nat) { const a = D + 6 + old; st.set8(a, st.u8(a) - domUmin16(5, st.u8(a))); }
    if (old !== nat && owner === nat) {
      st.set16(D, st.u16(D) + domUmin16(50000 - st.u16(D), st.u16(E + 4) + st.u16(E)));
      st.set8(D + 6 + nat, domUmin16(st.u8(D + 6 + nat) + 5, 200));
    }
  }
}

installTavern(Buildings.prototype);
installWharf(Buildings.prototype);
installShipyard(Buildings.prototype);
installChurchInnFortune(Buildings.prototype);
