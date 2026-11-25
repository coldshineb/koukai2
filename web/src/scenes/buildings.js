// buildings.js — 港口建筑共用框架与分派器 (MAIN.EXE 1fd9 段, 处理函数表 DS:a612)
// 各建筑实现已拆分为独立模块:
//   0 交易所 (market.js) / 1 酒馆 (tavern.js + gamble.js) / 2 造船厂 (shipyard.js) / 3 码头 (wharf.js)
//   4 旅馆 + 10 教会 + 11 占卜师 (church_inn_fortune.js) / 5 王宫 (palace.js) / 6 事务所 (office.js)
//   7 住宅 (house.js) / 8 银行 (bank.js) / 9 道具店 (itemshop.js)
import { NumPad } from "../ui/dos/numpad.js";
import { ListSelect } from "../ui/dos/listsel.js";
import { NameInput } from "../ui/dos/nameinput.js";
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
import { DS } from "../model/schema_views.ts";
import { FleetFlag, GameConst, ShipSlotFlag } from "../model/flags.ts";
import {
  WorldConst,
  getWorkState,
  heroFleet,
  heroOrDockSlot,
  heroShipSlot,
  personRawBytes,
  setHeroMoney,
  shipSlotByAddr,
  swapShipAndCrewSlots,
} from "../model/world_helpers.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { calcCargoUsed, calcShipLoadTotal, calcShipSpeed } from "../domain/fleet.ts";
import { captureConsoleText, createEscStripper, decodeCleanCstr, toSimp } from "../ui/text_util.ts";

const bHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const B_SPEECH = Uint8Array.of(0x1b, 0x43, 0x30, 0x01, 0x1b, 0x42, 0x37, 0);   // DS:8c12
const B_COLOR = Uint8Array.of(0x1b, 0x43, 0x30, 0x1b, 0x42, 0x37, 0);          // DS:a60a / 8b79
const bWarned = new Set();
const bTodo = n => { if (!bWarned.has(n)) { bWarned.add(n); console.warn("尚未移植: " + n); } };

export class Buildings {
  constructor(scene) {
    this.p = scene; this.c = scene.c; this.numpad = this.c.numpad ??= new NumPad(this.c); this.c.cargoUsed = s => this.cargoUsed(s); this.c.persons ??= new Array(0x50).fill(0);
    const T = scene.P.data.tavern, h = a => a.map(bHex);                 // port.json (tools/extract_port.py 由 MAIN.EXE 产生)
    this.T = { liquors: h(T.liquors), liquorPrice: T.liquorPrice, titles: h(T.titles), ottomanTitles: h(T.ottomanTitles),
      stats: h(T.stats), crewRoles: h(T.crewRoles), fmt: Object.fromEntries(Object.entries(T.fmt).map(([k, v]) => [k, bHex(v)])) };
    this.WF = Object.fromEntries(Object.entries(scene.P.data.wharf).map(([k, v]) => [k, bHex(v)]));   // 码头格式字符串
    this.SY = Object.fromEntries(Object.entries(scene.P.data.shipyard).map(([k, v]) => [k, bHex(v)])); // 造船厂/船坞格式字符串
    { const G = scene.P.data.bargirl, D = scene.P.data;                    // 酒吧女郎用表 (port.json bargirl / nations / goods)
      this.BG = { discCats: G.discCats.map(bHex), itemTypes: G.itemTypes.map(bHex), survey: G.surveyRange, nations: D.nations.map(bHex), goods: D.goods.map(bHex),
        ...Object.fromEntries(Object.entries(G.fmt).map(([k, v]) => [k, bHex(v)])) }; }
  }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  get port() { return this.m.globals.port; }
  get hero() { return this.m.heroPerson().addr; }                        // [c2ce] (待 tavern/shipyard 迁移后移除)
  get heroData() { return this.m.heroInfo().addr; }                      // seg0:5be8 (待 tavern/shipyard 迁移后移除)
  get money() { return this.m.globals.money; }
  set money(v) { setHeroMoney(this.m, v); }
  noEvent() { const w = getWorkState(this.m); return w.commonEvent === 0 && w.heroEvent === 0; }
  captureMessage(n, ...args) {
    return captureConsoleText(this.c, () => this.c.message(n, ...args));
  }
  // 解析人物头像规格：同时支持具名头像 (0..127)、人物拼合头像 (portrait & 0xc000) 与随机无名头像 (n >= 0x78)
  resolvePersonPortrait(n) {
    const { sys } = this.c, m = this.m;
    if (n >= 0x78) {
      return {
        portraitId: null,
        portraitComposed: { type: sys.rng.random(7), parts: sys.rng.random(0x3fff) | 0xc000 },
      };
    }
    const p = m.person(n), parts = p.portrait;
    if (parts & 0xc000) {
      return { portraitId: null, portraitComposed: { type: p.face & 15, parts } };
    }
    return { portraitId: parts & 0x7f, portraitComposed: null };
  }
  // ---------------- 共用 ----------------
  beginWideTalk(portrait = null, prefix = "") {
    const { con, scr, codec, win } = this.c;
    if (!scr.wideRenderer || !codec) return false;
    if (this._wideTalk) this.endWideTalk();
    const portraitId = typeof portrait === "number" ? portrait : (portrait?.portraitId ?? null);
    const portraitComposed = (portrait && typeof portrait === "object") ? (portrait.portraitComposed ?? null) : null;
    const origPutc = con.putc;
    const raw = [];
    const sync = () => {
      const body = toSimp(codec.decode(Uint8Array.from(raw)).replace(/\{[0-9A-F]{2}\}/g, "").trim());
      const text = prefix ? (body ? `${prefix}\n${body}` : prefix) : body;
      scr.wideDialog = { text, portraitId, portraitComposed, waiting: false };
      scr.dirty = true;
    };
    const marker = { wideTalk: true, onClose: () => this.endWideTalk() };
    win?.stack?.push(marker);
    con.putc = createEscStripper(b => { raw.push(b); sync(); });
    this._wideTalk = { origPutc, raw, portraitId, portraitComposed, prefix, sync, marker };
    sync();
    return true;
  }
  endWideTalk() {
    if (!this._wideTalk) return false;
    const wt = this._wideTalk;
    this._wideTalk = null;
    this.c.con.putc = wt.origPutc;
    const stack = this.c.win?.stack;
    if (stack && wt.marker) {
      const idx = stack.lastIndexOf(wt.marker);
      if (idx >= 0) stack.splice(idx, 1);
    }
    this.c.scr.wideDialog = null;
    this.c.scr.dirty = true;
    return true;
  }
  greet(n, ...args) {                                                    // seg0:8f03
    const { sys, win, con, message, scr } = this.c;
    if (scr.wideRenderer && this.c.codec) {
      this.beginWideTalk(null);
      message(n, ...args);
      return;
    }
    sys.mouseHide();
    win.frame(0x1e, 8, 0x1e, 0x80, 0);
    con.right = 0x38; con.left = 0x20; con.setCursor(0x20, 0x10);
    con.puts(B_SPEECH);
    message(n, ...args);
    sys.mouseShow();
  }
  async menu(items) {                                                    // 1b46e
    this.p.panels();
    const prev = this.c.menu.wideAnchorCmd;
    const prevTitle = this.c.menu.wideMenuTitle;
    this.c.menu.wideAnchorCmd = -3;
    if (this._curBuildingName) this.c.menu.wideMenuTitle = this._curBuildingName;
    try {
      const r = await this.c.menu.listMenu(0x3c, 0x68, items, 1);
      if (r === 0xff) {
        this.endWideTalk();
        if (this.c.scr.wideDialog) {
          this.c.scr.wideDialog = null;
          this.c.scr.dirty = true;
        }
      }
      return r;
    } finally {
      this.c.menu.wideAnchorCmd = prev;
      this.c.menu.wideMenuTitle = prevTitle;
    }
  }
  after() {                                                              // 1b580 → 1b496
    const s = this.c.scr, g = this.c.gfx;
    if (s.wideRenderer) return;
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
  // 人物对话窗口 seg0:7dac (col, y)
  talkWindow(col, y) {
    const { win, con } = this.c;
    win.save(col, y, 0x27, 0x90);
    win.frame(col, y, 0x27, 0x90, 0);
    con.right = col + 0x24; con.left = col + 0x0b; con.setCursor(col + 0x0b, y + 0x10);
  }
  // seg0:7f06 人物 n 发言 (>= 0x78 为随机无名人物)
  talkPerson(n) {
    const { kao, scr, sys } = this.c;
    if (scr.wideRenderer && this.c.codec) {
      this.beginWideTalk(this.resolvePersonPortrait(n));
      return;
    }
    if (n >= 0x78) { this.talkWindow(0x14, 0xc0); kao.drawRandomType(scr, sys.rng, sys.rng.random(0x3fff) | 0xc000, 0x16, 0xd0); return; }
    this.talkWindow(0x14, 0xc0);
    kao.drawPerson(scr, personRawBytes(this.m.person(n)), 0x16, 0xd0);
  }
  // seg0:7e35 指定种类与部件的无名人物
  talkFace(type, parts) {
    if (this.c.scr.wideRenderer && this.c.codec) {
      this.beginWideTalk({ portraitId: null, portraitComposed: { type, parts } });
      return;
    }
    this.talkWindow(0x14, 0xc0); this.c.kao.drawComposed(this.c.scr, type, parts, 0x16, 0xd0);
  }
  // seg0:909b → 9010: 依职位优先序 [3,4,5,2,6] 找舰队中的船员发言
  crewSpeaks(order = [3, 4, 5, 2, 6]) {
    const m = this.m; let who = GameConst.EMPTY_SLOT;
    for (let k = 0; k < 5; k++) {
      let found = false;
      for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
        const n = m.partyCrew(i); if (n === GameConst.EMPTY_SLOT) continue;
        who = n;
        if (m.person(n).role === order[k]) { found = true; break; }
      }
      if (found) break;
    }
    this.talkPerson(who);
    return who;
  }
  // 0fea:30a2 = 12f42: 本港可交谈的人物 → [0538]; 都被排除时 [0538] = FF 并返回原数量
  portPersons() {
    const m = this.m, L = this.portPersonsAll(), keep = L.filter(n => !(m.person(n).flags & 0x10));
    if (!keep.length) { this.setPersons(L); this.c.persons[0] = 0xff; return L.length; }
    this.setPersons(keep); return keep.length;
  }
  // 12e5a: 在本港的人物 (主角除外, +31 bit5): 停留港 = 本港, 或在主角舰队, 或所属舰队停泊在本港
  portPersonsAll() {
    const m = this.m, g = m.globals, P = m.port(this.port), hFleet = m.heroPerson().fleet, L = [];
    for (let i = 0; i < WorldConst.TOTAL_PERSONS; i++) {
      if (i === g.hero) continue;
      const p = m.person(i);
      if (!(p.face & 0x20)) continue;
      const f = p.fleet;
      if (p.stayPort === this.port || f === hFleet) { L.push(i); continue; }
      if (f >= WorldConst.TOTAL_FLEETS) continue;
      const fl = m.fleet(f);
      if ((fl.flags & FleetFlag.DOCKED) && fl.x === P.x && fl.y === P.y) L.push(i);
    }
    return L;
  }
  // ---------------- 建筑分派 ----------------
  async enter(k) {
    const bldNames = ["交易所", "酒馆", "造船厂", "码头", "旅馆", "王宫", "事务所", "住宅", "银行", "道具店", "教会", "占卜师"];
    this._curBuildingName = bldNames[k] ?? "";
    try {
      switch (k) {
        case 0: return await (this.marketM ??= new Market(this)).run();
        case 1: return await this.tavern();
        case 2: return await this.shipyard();
        case 3: return await this.wharf();
        case 4: return await this.inn();
        case 5: return await (this.palaceM ??= new Palace(this)).run();            // palace.js
        case 6: return await (this.officeM ??= new Office(this)).run();            // office.js
        case 7: return await (this.houseM ??= new House(this)).run();              // house.js
        case 8: return await (this.bankM ??= new Bank(this)).run();                // bank.js (夏洛克银行)
        case 9: return await (this.itemM ??= new ItemShop(this)).run();            // itemshop.js
        case 10: return await this.church();
        case 11: return await this.fortune();
        default: bTodo(["交易所", "酒館", "造船廠", "碼頭", "旅館", "王宮", "事務所", "住宅", "銀行?", "道具店", "教會", "占卜師"][k] + " (1fd9 段建築 " + k + ")");
      }
    } finally {
      this._curBuildingName = "";
      this.endWideTalk();
      this.c.scr.wideDialog = null;
      this.c.scr.dirty = true;
    }
  }
  // ================= 1 酒馆 1fd9:78f5 =================
  get eco() { return this.m.portEconomy(this.port).addr; }              // [c2dc] = seg0:5caa(港)
  fleetSlot(i) { return ListSelect.fleetSlot(this.st, i); }                // seg0:5c58
  // [0538] 是固定的字数组: 只覆写前 L.length 项, 后面保留旧值 (原版如此)
  setPersons(L) { const P = (this.c.persons ??= new Array(0x50).fill(0)); for (let i = 0; i < L.length; i++) P[i] = L[i]; }
  crewData(i) { return this.m.crewSlot(i).addr; }                        // seg0:5c38 (+08/+09 配置比例, +1b 船长, +1c 士气)
  // 0fea:2dea = 12c8a: 主角舰队有船的位置 → [0538]
  fleetShips() {
    const m = this.m, L = [];
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if ((heroShipSlot(m, i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE) L.push(i);
    this.setPersons(L); return L.length;
  }
  dstr(a) { return Buildings.inState(a) ? this.st.cstr(a) : Uint8Array.of(0); }
  static inState(a) { return a >= DS.OPTIONS && a < DS.TRADE_LOGS; }
  // seg0:8894 后的金钱增减 (2553b: 上限 600000000)
  addMoney(v) { let m = this.money + v; if (m > 600000000) m = 600000000; this.money = m; this.p.panels(); }
  payMoney(v) { if ((v >>> 0) > (this.money >>> 0)) return 0; this.money = (this.money - v) | 0; this.p.panels(); return 1; }   // 25515
  // seg0:7eac 酒吧女郎头像 (具名头像 face) 与姓名
  talkGirl(face, rec) {
    const { kao, scr, printf, codec } = this.c;
    if (scr.wideRenderer && codec) {
      const nm = decodeCleanCstr(codec, this.dstr(rec));
      this.beginWideTalk(face, nm);
      return;
    }
    this.talkWindow(0x14, 0xc0);
    kao.drawNamed(scr, face, 0x16, 0xd0);
    printf(this.T.fmt.girlName, this.dstr(rec));
  }
  // seg0:7ffc 对话窗口下半的消息
  talkMessage2(n, ...args) {
    const { sys, con, scr } = this.c;
    if (this._wideTalk) {
      this._wideTalk.raw.length = 0;
      this.c.message(n, ...args);
      return;
    }
    sys.mouseHide();
    con.right = 0x38; con.left = 0x1f; con.setCursor(0x1f, 0xe8);
    con.puts(this.T.fmt.talk2);
    scr.fillCols(0x1f, 0xe8, 0x1b, 0x58, 7);
    this.c.message(n, ...args);
    sys.mouseShow();
  }
  // seg0:7f6e 清除对话窗口文字区 (发言者不变)
  talkClear() {
    if (this._wideTalk) {
      this._wideTalk.raw.length = 0;
      this._wideTalk.sync();
      return;
    }
    const { con, scr } = this.c;
    con.right = 0x38; con.left = 0x1f; con.setCursor(0x1f, 0xd0);
    con.puts(B_COLOR);
    scr.fillCols(0x1f, 0xd0, 0x1b, 0x70, 7);
  }
  async closeTalk() {
    if (this.endWideTalk()) return;
    await this.c.win.close();
  }                           // seg0:796d
  todo(n) { bTodo(n); }
  // ---------- 对话窗口 (上方 = 主角/对象, 下方 = 店家/路人) ----------
  // seg0:7ed8 上方窗口 (0x0d, 0x10) 人物 n 发言; n >= 0x78 为随机无名人物 (7df5)
  talkTop(n) {
    const { kao, scr, sys } = this.c;
    if (scr.wideRenderer && this.c.codec) {
      this.beginWideTalk(this.resolvePersonPortrait(n));
      return;
    }
    this.talkWindow(0x0d, 0x10);
    if (n >= 0x78) kao.drawRandomType(scr, sys.rng, sys.rng.random(0x3fff) | 0xc000, 0x0f, 0x20);
    else kao.drawPerson(scr, personRawBytes(this.m.person(n)), 0x0f, 0x20);
  }
  // seg0:7f34 清除上方窗口文字区
  talkClearTop() {
    if (this._wideTalk) {
      this._wideTalk.raw.length = 0;
      this._wideTalk.sync();
      return;
    }
    const { con, scr } = this.c;
    con.right = 0x31; con.left = 0x18; con.setCursor(0x18, 0x20);
    con.puts(this.T.fmt.talk3);
    scr.fillCols(0x18, 0x20, 0x1b, 0x70, 7);
  }
  // seg0:7e15 下方窗口, 随机无名人物
  randomTalk() {
    const { kao, scr, sys } = this.c;
    if (scr.wideRenderer && this.c.codec) {
      this.beginWideTalk({
        portraitId: null,
        portraitComposed: { type: sys.rng.random(7), parts: sys.rng.random(0x3fff) | 0xc000 },
      });
      return;
    }
    this.talkWindow(0x14, 0xc0); kao.drawRandomType(scr, sys.rng, sys.rng.random(0x3fff) | 0xc000, 0x16, 0xd0);
  }
  async shipInfo(slot) {
    const m = this.m, { palette, con, printf, graph } = this.c;
    const M = m.crewSlot(slot), S = heroOrDockSlot(m, slot), ship = m.ship(S.ship), type = ship.type, T = m.shipType(type);
    palette.setTarget(palette.table("ships"));
    await palette.fadeToTarget();
    this.table();
    con.left = 0x22; con.right = 0x35;
    graph.draw(type + 0x1c, 0x10 << 3, 0xa0);                                // seg0:8050
    con.setCursor(0x22, 0x90);
    printf(this.T.fmt.shipName, ship.nameBytes);
    printf(this.T.fmt.captain, m.person(M.captain).givenNameBytes);
    printf(this.T.fmt.crewHdr);
    const crew = S.crew, a = Math.trunc(M.navRatio * crew / 100) & 0xffff, b = Math.trunc(M.lookRatio * crew / 100) & 0xffff;
    printf(this.T.fmt.crew, a, b, (crew - b - a) << 16 >> 16);
    printf(this.T.fmt.need, T.minCrew);
  }
  // ================= 3 码头 1fd9:8993 =================
  isCapital() { for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) if (this.m.country(i).capitalPort === this.port) return 1; return 0; }   // 0fea:b578
  // 0fea:2f43 = 12de3: 主角没有担任任何船的船长时列入主角, 再列入职务 > 2 的船员 → [0538]
  crewList() {
    const m = this.m, heroId = m.globals.hero, L = [];
    let k = 0; for (; k < GameConst.FLEET_SHIPS; k++) if (m.crewSlot(k).captain === heroId) break;
    if (k === GameConst.FLEET_SHIPS) L.push(heroId);
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) { const n = m.partyCrew(i); if (n !== GameConst.EMPTY_SLOT && m.person(n).role > 2) L.push(n); }
    this.c.persons ??= [];
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return L.length;
  }
  // seg0:5d36 船上已用的载货量
  cargoUsed(slot) {
    const M = this.m.crewSlot(slot);
    const goods = [0, 1, 2, 3, 4].map(k => M.getCargoGoods(k));
    const amts = [0, 1, 2, 3, 4].map(k => M.getCargoAmts(k));
    return calcCargoUsed(M.water, M.food, M.material, M.ammo, goods, amts);
  }
  shipOf(slot) { return this.m.ship(heroOrDockSlot(this.m, slot).ship).addr; }
  // 277c0 窗口 (不保存背景) + 文字颜色
  winText(x, y, w, h) { this.c.win.frame(x, y, w, h, 0); this.c.con.puts(this.WF.winColor); }
  typeRec(t) { return this.m.shipType(t).addr; }                             // seg0:5c8a
  listSel() { return (this.c.listSel ??= new ListSelect(this.c)); }
  // 2af30 船只数据: mode 0 = 船编号 al, 1 = 中古船 (船型 al), 2 = 新造设计 (船型 al), 3 = 船位 slot 的船 (slot ≥ 0x100 时是船位地址, 例: 海战掳获时对方的船位)
  shipData(al, mode, slot = 0) {
    const m = this.m, { con, printf, graph } = this.c, F = this.SY;
    let si, di, cur = 0, max = 0, turn = 0, prop = 0, load = 0, crew = 0, guns = 0;
    if (mode === 0) { si = m.ship(al); di = m.shipType(si.type); cur = max = Math.trunc(9 * di.durability / 10) & 0xff; }
    else if (mode === 1 || mode === 2) {
      di = m.shipType(al); si = m.ship(al + 0x28);
      const d = Math.trunc(9 * di.durability / 10) & 0xffff;
      if (mode === 1) cur = max = (d - Math.trunc((d & 0xff) / 15)) & 0xff;
      else { max = d & 0xff; cur = 0; }
    } else {
      const S = slot >= 0x100 ? shipSlotByAddr(m, slot) : heroOrDockSlot(m, slot);
      si = m.ship(S.ship); di = m.shipType(si.type); max = S.maxDurability; cur = S.durability;
    }
    turn = di.turn; prop = di.propulsion;
    if (mode === 2) { load = di.capacity; crew = 0; guns = 0; }
    else { load = si.maxCargo; crew = si.maxCrew; guns = si.maxGuns; }
    this.table();                                                            // bTable
    graph.draw(si.type + 0x1c, 0x0f << 3, 0xa0);                             // seg0:8050
    con.right = 0x3a; con.left = 0x20; con.setCursor(0x20, 0x90);
    printf(F.name, si.nameBytes, turn, prop);
    con.setCursor(0x20, 0xb8);
    printf(F.durability, cur, max);
    con.lineH = 0x10; con.setCursor(0x20, 0xd0);
    printf(F.load, di.capacity, load);
    printf(F.crew, di.maxCrewDiv10, crew);
    printf(F.need, di.minCrew, guns);
    printf(F.guns, di.maxGuns);
    con.lineH = 0x18;
  }
  // 2b119 船首像 (PNG)
  figurehead(slot) {
    const fh = this.m.crewSlot(slot).figurehead;
    if (!fh || fh >= 0x0b) return;
    this.c.art?.drawEntry(this.c.scr, this.c.art.figureheadEntry(fh), 0x33 * 8, 0x9c);
  }
  // 203e9 交换船位 a / b (9 bytes 船位 + 0x1e bytes 船员配置)
  swapSlots(a, b) { swapShipAndCrewSlots(this.m, a, b); }
  slotState(i) { return heroOrDockSlot(this.m, i).flags & ShipSlotFlag.STATE_MASK; }   // 0x10 有船, 0x20 建造中
  // 20468 整理船位
  compactSlots() {
    for (let i = 0; i < 9; i++) {
      if (this.slotState(i) === ShipSlotFlag.ACTIVE) continue;
      for (let j = i + 1; j < GameConst.FLEET_SHIPS; j++) if (this.slotState(j) === ShipSlotFlag.ACTIVE) { this.swapSlots(i, j); break; }
    }
    for (let i = 10; i < 0x27; i++) {
      const f = this.slotState(i); if (f === ShipSlotFlag.ACTIVE || f === ShipSlotFlag.BUILDING) continue;
      for (let j = i + 1; j < 0x28; j++) if (this.slotState(j) === ShipSlotFlag.ACTIVE) { this.swapSlots(i, j); break; }
    }
  }
  // 0fea:2e29 = 12cc9: 舰队中不是主角担任船长的船 → [0538]
  notHeroShips() {
    const m = this.m, heroId = m.globals.hero, n = this.fleetShips(), L = [];
    for (let i = 0; i < n; i++) if (m.crewSlot(this.c.persons[i]).captain !== heroId) L.push(this.c.persons[i]);
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return L.length;
  }
  // 0fea:2e6e = 12d0e: 空的船坞位 (10..39), 再加空的舰队位 (0..9) → [0538]
  freeSlots() {
    const L = [];
    for (let i = 10; i < 40; i++) { const f = this.slotState(i); if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) L.push(i); }
    for (let i = 0; i < 10; i++) { const f = this.slotState(i); if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) L.push(i); }
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return L.length;
  }
  // 0fea:2eec = 12d8c: 主角 + 船员栏 → [0538]
  captainPool() {
    const m = this.m; let n = 1; this.c.persons[0] = m.globals.hero;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) { const v = m.partyCrew(i); if (v !== GameConst.EMPTY_SLOT) this.c.persons[n++] = v; }
    return n;
  }
  // 0fea:83f9 舰队 +28 = (Σ 有船船位耐久 + 4) / 5; 为 0 时 +29 bit0 清除
  fleetRecalc() {
    const m = this.m, fl = heroFleet(m);
    let sum = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.slotState(i) === ShipSlotFlag.ACTIVE) sum += heroShipSlot(m, i).durability;
    fl.strength = Math.trunc((sum + 4) / 5);
    if (!sum) fl.flags &= ~FleetFlag.AT_SEA;
  }
  // 0fea:b5aa = 1b44a 本港物价指数 = Σ 经济 +0e..+17 / 10
  priceIndex() { const E = this.m.portEconomy(this.port); let v = 0; for (let i = 0; i < 10; i++) v += E.getPrices(i); return Math.trunc(v / 10); }
  // 2ac68 船价 = ((船型基价×4/5 + 基价×(船 +10 & 7)/10) × (物价指数+50) / 100) × 10
  shipPrice(slot) {
    const m = this.m, ship = m.ship(heroOrDockSlot(m, slot).ship), T = domS16(m.shipType(ship.type).price);
    const q = Math.trunc(T * 4 / 5), r = Math.trunc(T * (ship.flags & 7) / 10);
    return (Math.trunc(Math.imul(q + r, this.priceIndex() + 50) / 100) * 10) | 0;
  }
  // seg0:5deb 移除船位 slot 的船
  removeShip(slot) {
    const m = this.m, M = m.crewSlot(slot), S = heroOrDockSlot(m, slot), ship = m.ship(S.ship);
    ship.type = GameConst.EMPTY_SLOT; ship.maxGuns = 0; ship.flags = 0; ship.maxCargo = 0; ship.maxCrew = 0;
    S.propulsion = 0xff; S.turn = 0xff; S.maxDurability = 0xff; S.durability = 0xff; S.guns = 0xff;
    S.crew = 0; S.flags = 0;
    M.ammo = 0; M.material = 0; M.food = 0; M.water = 0;
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { M.setCargoGoods(k, GameConst.EMPTY_SLOT); M.setCargoAmts(k, 0); }
    M.loadTotal = 0;
    if (M.captain !== m.globals.hero) m.person(M.captain).role = 6;
    M.captain = GameConst.EMPTY_SLOT; M.morale = 0; M.figurehead = 0;
    M.navRatio = 0x19; M.navRatio = 0x32;                                    // 原版连写两次 navRatio (lookRatio 不变)
  }
  // ---------- 造新船 / 买旧船 / 改造 (RE_NOTES 20.6..20.8) ----------
  get BT() {                                                              // port.json build (DS:b268 / b2c0 / 080c / 07cc …)
    if (!this._bt) {
      const d = this.p.P.data.build;
      this._bt = { levels: d.levels, typeMsg: d.typeMsg, cannonPrice: d.cannonPrice, cannons: d.cannons.map(bHex),
        fmt: Object.fromEntries(Object.entries(d.fmt).map(([k, v]) => [k, bHex(v)])) };
    }
    return this._bt;
  }
  nameInput() { return (this.c.nameInput ??= new NameInput(this.c, this.c.newgameData)); }
  // seg0:5cee 担任职务 role 的船员 (船员栏 DS:2e1b), 没有 = FF
  roleMember(role) {
    const m = this.m;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) { const n = m.partyCrew(i); if (n !== GameConst.EMPTY_SLOT && m.person(n).role === role) return n; }
    return GameConst.EMPTY_SLOT;
  }
  noMoney() { this.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(0xcf); }  // seg0:9076 + 2e09:56ee(0xcf)
  // ---------- 折抵旧船剩余货物重新分配 (RE_NOTES 20.9) ----------
  get LO() {                                                              // port.json leftover
    if (!this._lo) {
      const d = this.p.P.data.leftover;
      this._lo = { goods: this.p.P.data.goods.map(bHex), speedRate: d.speedRate, gunWeight: d.gunWeight, supplies: d.supplies.map(bHex),
        fmt: Object.fromEntries(Object.entries(d.fmt).map(([k, v]) => [k, bHex(v)])) };
    }
    return this._lo;
  }
  // seg0:5db1 船位 slot 的总载重 = 已用载货 + 砲重 + 水手 (写到船员配置 +0a)
  loadTotal(slot) {
    const S = heroOrDockSlot(this.m, slot);
    return calcShipLoadTotal(this.cargoUsed(slot), this.LO.gunWeight[S.flags & 7], S.guns, S.crew);
  }
  // 1c0a8 船速
  shipSpeed(slot) {
    const m = this.m, S = heroOrDockSlot(m, slot), ship = m.ship(S.ship), t = ship.type, T = m.shipType(t);
    const M = m.crewSlot(slot), P = m.person(M.captain);
    return calcShipSpeed({
      speedRate: this.LO.speedRate[t], propulsion: S.propulsion,
      sailRatio: M.navRatio, crew: S.crew, minCrew: T.minCrew,
      loadTotal: M.loadTotal, capacity: T.capacity,
      captainNavLevel: P.navLevel, captainSailing: P.getStats(1),
    });
  }
  // 2c6c6 投资转移各国支持度 (经济 +8..+0d)
  investSupport(amount, ind = this.m.portEconomy(this.port).industry) {      // 交易所 24f92 以商业值 (+0) 为基准
    const m = this.m, E = m.portEconomy(this.port), nat = m.heroPerson().face & 15;
    const q = Math.trunc(amount / ind);
    let v;
    if (nat !== 6) { v = domUmin16(q, 100 - E.getInfluence(nat)) & 0xff; E.setInfluence(nat, E.getInfluence(nat) + v); }
    else v = domUmin16(q, 100) & 0xff;
    let others = 0; for (let i = 0; i < 6; i++) if (E.getInfluence(i) && i !== nat) others++;
    let each = 0, rest = 0;
    if (others) { each = Math.trunc(v / others) & 0xff; rest = (v % others) & 0xff; }
    for (let i = 0; i < 6; i++) {
      const x = E.getInfluence(i);
      if (!x || i === nat) continue;
      if (each <= x) E.setInfluence(i, x - each); else { rest = (rest + each - x) & 0xff; E.setInfluence(i, 0); }
    }
    let start;
    do {
      start = rest;
      for (let i = 0; i < 6 && rest; i++) { if (E.getInfluence(i) && i !== nat) { E.setInfluence(i, E.getInfluence(i) - 1); rest = (rest - 1) & 0xff; } }
    } while (rest !== start);
  }
  // 2c7ec 支持度 ≥ 75 的国家取得本港; 主角国家新取得时加声望
  investOwner() {
    const m = this.m, E = m.portEconomy(this.port), P = m.port(this.port), nat = m.heroPerson().face & 15, D = m.heroInfo();
    const old = P.region & WorldConst.PORT_OWNER_MASK;
    let owner = 6; for (let i = 0; i < 6; i++) if (E.getInfluence(i) >= 0x4b) owner = i;
    P.region = (P.region & 0xf8) | owner;
    if (old !== 6 && owner !== old && old !== nat) { D.setCountryStanding(old, D.getCountryStanding(old) - domUmin16(5, D.getCountryStanding(old))); }
    if (old !== nat && owner === nat) {
      D.tradeFame = (D.tradeFame + domUmin16(GameConst.MAX_FAME - D.tradeFame, E.industry + E.commerce)) & 0xffff;
      D.setCountryStanding(nat, domUmin16(D.getCountryStanding(nat) + 5, 200));
    }
  }
}

installTavern(Buildings.prototype);
installWharf(Buildings.prototype);
installShipyard(Buildings.prototype);
installChurchInnFortune(Buildings.prototype);
