// palace.js — 王宮 (MAIN.EXE 1fd9:acda = 線性 2aa6a, 處理函式表 DS:a612[5]); 見 RE_NOTES 25
// MENU #16 共 5 項, 但原版只傳 4 項 (bl = 4) 給選單, 所以「密會」不會出現 (DS:b258 也只有 4 個處理函式 2a523 / 2a5f6 / 2a713 / 2a79b)
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { mainEnding } from "../game/endgame.js";
import { GameConst, MenuId, OptionFlag, ShipSlotFlag, WorkDS } from "../model/flags.ts";
import { captureConsoleText, decodeCleanCstr } from "../canvas_ui/text_util.ts";
import { runWideInfoLinesModal } from "../canvas_ui/wide_panels.ts";

const plHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const plS16 = v => (v << 16) >> 16;
const plUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const plUmax = (a, b) => ((b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff);  // seg0:4d87

export class Palace {
  constructor(b) {
    this.b = b; const D = b.p.P.data.bld2;
    this.F = Object.fromEntries(Object.entries(D.fmt).map(([k, v]) => [k, plHex(v)]));
    this.div = D.regionDiv;
  }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  get nation() { return this.m.port(this.b.port).region & 7; }
  same(mask = 0x0f) { return ((this.nation ^ this.m.heroPerson().face) & mask) === 0; }   // 港口所屬國 = 主角國籍
  heroName() { return this.m.heroPerson().familyNameBytes; }
  async gw(n, ...a) { this.b.greet(n, ...a); await this.b.wait(); }
  // seg0:7e60 國王視窗
  king() {
    const { win, kao, scr, con, printf, art, codec } = this.c, K = this.kingRec;
    if (scr.wideRenderer && codec) {
      const fid = K.portrait & 0xff;
      if (art?.portraitUrl) void art.loadImage(art.portraitUrl(fid)).catch(() => {});
      this._kingPrefix = decodeCleanCstr(codec, K.nameBytes);
      this._kingPortrait = fid;
      scr.wideDialog = { text: this._kingPrefix, portraitId: fid, waiting: false };
      scr.dirty = true;
      return;
    }
    win.frame(0x0c, 0x120, 0x2f, 0x68, 0);
    kao.drawNamed(scr, K.portrait, 0x0e, 0x12c);
    con.right = 0x38; con.left = 0x17; con.setCursor(0x17, 0x128);
    printf(this.F.kingName, K.nameBytes);
  }
  // seg0:7fa8 國王說話
  kingSay(n, ...a) {
    const { sys, con, scr, message, codec } = this.c;
    if (scr.wideRenderer && codec) {
      const body = captureConsoleText(this.c, () => message(n, ...a));
      const text = this._kingPrefix ? `〔${this._kingPrefix}〕\n${body}` : body;
      scr.wideDialog = { text, portraitId: this._kingPortrait ?? null, waiting: false };
      scr.dirty = true;
      return;
    }
    sys.mouseHide();
    con.right = 0x38; con.left = 0x17; con.setCursor(0x17, 0x140);
    con.puts(this.F.kingTalk);
    scr.fillCols(0x16, 0x140, 0x24, 0x40, 7);
    message(n, ...a);
    sys.mouseShow();
  }
  async kingSayWait(n, ...a) { this.kingSay(n, ...a); await this.b.wait(); }
  async crewSays(n) { this.b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(n); await this.b.wait(); await this.b.closeTalk(); }   // seg0:9076
  // 2e09:5525 (共用) / 2e09:5678 (主角): 有事件就執行並回傳結果, 沒有回傳 1
  async event(env, building) {
    if (this.c.noEvents) return 1;
    const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.b.p;
    if (!(await sc.check(env, this.b.port, building))) return 1;
    return sc.run(env);
  }

  // ================= 入口 2aa6a =================
  async run() {
    const b = this.b, st = this.st, m = this.m, g = m.globals, hd = m.heroInfo(), { sys, menu } = this.c;
    this.kingRec = m.noble((this.nation + 10) & 0xff);                           // [bdbc]
    const standing = hd.getCountryStanding(this.nation);
    if (standing <= 80 && sys.rng.random(100) > standing) {                      // 惡名昭彰: 抓起來
      await this.gw(0x1bb, this.heroName());
      return this.arrest();
    }
    if (hd.rank === 0 && (m.heroPerson().face & 0x0f) !== 6) {                   // 平民
      if (!this.same() || !(st.u8(WorkDS.FLAGS) & 6)) return this.gw(0x54);
    }
    const t = hd.rank;
    if (t) b.greet(0x1bc, this.heroName(), g.hero === 5 ? b.T.ottomanTitles[t] : b.T.titles[t]);
    else b.greet(0x240);
    await b.wait();
    b.after();
    let sel;
    do {
      const items = this.c.menuItems(MenuId.PALACE).slice(0, 4);
      const c5e = g.commonChap, same = this.same(7);
      if (same || (c5e !== 0 && c5e !== 0xff && plS16(st.u16(WorkDS.CUR_KIND)) >= 6) || (st.u8(WorkDS.FLAGS) & 6)) menu.disabled = 2;
      if (!same) menu.disabled |= 0x0c;
      sel = await b.menu(items);
      if (sel !== 0xff) {
        await [() => this.audience(), () => this.naturalize(), () => this.funds(), () => this.shipAid()][sel]();
        if (hd.rank === 9 && (g.options & OptionFlag.ENDING_READY)) await mainEnding(this.b.p, 0x0f);   // 2ac50: 爵位 9 結局
      }
      b.after();
    } while (sel !== 0xff);
  }
  // 2a8e8 被抓: (主角 +25 × +21 / 100 + +21) & 0xff ≥ random(150) 時逃脫; 否則沒收 4/5 現金與存款, 對該國聲望 = 100
  async arrest() {
    const b = this.b, m = this.m, g = m.globals, hero = m.heroPerson(), { sys, palette } = this.c;
    const bal = g.bankBalance;
    const r = sys.rng.random(150) & 0xff;
    const stat5 = hero.getStats(5);
    const a = (Math.trunc((hero.battleLevel * stat5) / 100) + stat5) & 0xff;
    if (a >= r) {
      b.talkPerson(g.hero); this.c.message(0x1be); await b.wait(); await b.closeTalk();
      await palette.fadeBlack(); await sys.waitTenths(0x14); await palette.fadeToTarget();
      b.crewSpeaks(); this.c.message(0x1c0); await b.wait(); await b.closeTalk();
      return;
    }
    b.talkPerson(g.hero); this.c.message(0x1bd); await b.wait(); await b.closeTalk();
    await palette.fadeBlack(); b.after(); await sys.waitTenths(0x0f); await palette.fadeToTarget();
    this.king();
    await this.kingSayWait(0x1c1, this.heroName());
    await this.kingSayWait(0x1c2); await this.kingSayWait(0x1c3); await this.kingSayWait(0x1c4);
    this.money = (this.money + Math.trunc((this.money << 2) / -5)) | 0;          // _ldiv(現金 << 2, −5) (左移 32 位元回繞)
    const nb = (bal + Math.trunc((bal << 2) / -5)) | 0, q = Math.trunc(nb / 100);
    g.bankQuotient = q & 0xffff; g.bankRem = ((q & 0xff) * 0x9c + (nb & 0xff)) & 0xff;
    m.heroInfo().setCountryStanding(this.nation, 100);
    b.p.panels();
  }

  // ================= 晉見國王 2a523 =================
  async audience() {
    const b = this.b, st = this.st, g = this.m.globals, { menu } = this.c;
    if (this.same() && (st.u8(WorkDS.FLAGS) & 2)) {
      g.commonChap = st.u8(WorkDS.ROYAL_CHAP); g.commonSec = 0;
      await this.event(ENV_COMMON, 5);
    }
    if (!(await this.event(ENV_HERO, 0x15))) return;
    if (!(await this.event(ENV_COMMON, 0x15))) return;
    b.after();
    const items = this.c.menuItems(MenuId.PALACE_AUDIENCE).slice(0, 3);
    let sel;
    do {
      if (!this.same()) menu.disabled = 2;
      sel = await b.menu(items);
      if (sel !== 0xff) await [() => this.situation(), () => this.letterOfMarque(), () => this.taxFree()][sel]();
      b.after();
    } while (sel !== 0xff);
  }
  // 2a20c 勢力狀況
  async situation() {
    const m = this.m, n = this.nation;
    this.king();
    await this.kingSayWait(0x1c5, this.heroName());
    let cnt = 0; for (let q = 0; q < 100; q++) if ((m.port(q).region & 7) === n) cnt = (cnt + 1) & 0xff;   // 2a1bf
    await this.kingSayWait(0x373, cnt);
    for (;;) {
      const L = []; for (let i = 0; i < 8; i++) L.push(i);                       // 29e82
      this.b.setPersons(L);
      const r = await this.b.listSel().select(0x94, 8);
      if (r === -1) break;
      const sel = this.c.persons[r] & 0xff;
      if (await this.regionPorts(sel)) await this.regionEval(sel);
    }
    await this.kingSayWait(0x1c6);
  }
  // 29eb1 該地區的本國港口表
  async regionPorts(sel) {
    const m = this.m, b = this.b, { con, printf, message, scr, codec } = this.c, n = this.nation;
    if (scr.wideRenderer && codec) {
      const lines = [];
      for (let q = 0; q < 100; q++) {
        const P = m.port(q), E = m.portEconomy(q);
        if (E.regionGroup !== sel || (P.region & 7) !== n) continue;
        lines.push(captureConsoleText(this.c, () => printf(this.F.portRow, P.nameBytes, E.getInfluence(P.region & 7), E.industry, E.commerce)));
      }
      if (!lines.length) {
        const body = captureConsoleText(this.c, () => { message(0x1d1 + sel); message(0x1c7); });
        scr.wideDialog = { text: this._kingPrefix ? `〔${this._kingPrefix}〕\n${body}` : body, portraitId: this._kingPortrait ?? null, waiting: false };
        scr.dirty = true;
        await b.wait();
        return 0;
      }
      const hdr = captureConsoleText(this.c, () => message(0x1db));
      await runWideInfoLinesModal(this.c, hdr, lines);
      return 1;
    }
    con.left = 0x0e; con.right = 0x37;
    let cnt = 0, row = 0;
    for (let q = 0; q < 100; q++) {
      const P = m.port(q), E = m.portEconomy(q);
      if (E.regionGroup !== sel || (P.region & 7) !== n) continue;
      cnt = (cnt + 1) & 0xff;
      if (!row) { b.table(); con.setCursor(0x13, 0x90); message(0x1db); }
      con.setCursor(0x0f, (row + 10) << 4);
      printf(this.F.portRow, P.nameBytes, E.getInfluence(P.region & 7), E.industry, E.commerce);
      row++;
      if (row === 7 && q !== 99) { await b.wait(); row = 0; }
    }
    if (!cnt) { this.kingSay(0x1d1 + sel); message(0x1c7); await b.wait(); return 0; }
    return 1;
  }
  // 29fe7 地區收益: 各國各地區 A = Σ工業價值, B = Σ商業價值 × (港 +15 bit3 ? 2 : 1)
  async regionEval(sel) {
    const m = this.m, A = new Uint16Array(64), B = new Uint16Array(64), n = this.nation;
    for (let q = 0; q < 100; q++) {
      const P = m.port(q), E = m.portEconomy(q), k = ((P.region & 7) * 8 + E.regionGroup) & 63;
      A[k] += E.industry;
      B[k] += Math.imul(P.region & 8 ? 2 : 1, E.commerce);
    }
    const a = i => A[n * 8 + i] >= 300;
    let ok = false;
    if (sel <= 2) ok = a(sel);
    else if (sel === 3) ok = (a(2) || a(4)) && a(3);
    else if (sel <= 7) { ok = true; for (let i = 4; i <= sel; i++) if (!a(i)) ok = false; }
    if (this.c.scr.wideRenderer && this.c.codec) {
      const body = captureConsoleText(this.c, () => {
        this.c.message(0x1d1 + sel);
        if (ok) this.c.message(0x1c9, Math.trunc(B[n * 8 + sel] / this.div[sel]));
        else this.c.message(0x1c8);
      });
      this.c.scr.wideDialog = { text: this._kingPrefix ? `〔${this._kingPrefix}〕\n${body}` : body, portraitId: this._kingPortrait ?? null, waiting: false };
      this.c.scr.dirty = true;
      await this.b.wait();
      return;
    }
    this.kingSay(0x1d1 + sel);
    if (ok) this.c.message(0x1c9, Math.trunc(B[n * 8 + sel] / this.div[sel]));   // 29fc0
    else this.c.message(0x1c8);
    await this.b.wait();
  }
  // 隨身物中找 target; 回傳 -1 = 已有, -2 = 沒有空格, 否則 = 最後一個空格索引 (0..19)
  invSlot(target) {
    const m = this.m;
    let slot = -2;
    for (let i = 0; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (v === target) return -1; if (v === GameConst.EMPTY_SLOT) slot = i; }
    return slot;
  }
  // 2a27e 私掠許可証 (道具 0x1d + 國): 海盜名聲 ≥ 1000 且不低於商人/冒險家名聲
  async letterOfMarque() {
    const m = this.m, hd = m.heroInfo(), target = (this.nation + 0x1d) & 0xff, slot = this.invSlot(target);
    if (slot === -1) return this.crewSays(0x360);
    if (slot === -2) return this.crewSays(0x361);
    await this.gw(0x362);
    if (hd.pirateFame < 1000) return this.gw(0x363);
    if (hd.pirateFame < hd.tradeFame || hd.pirateFame < hd.adventureFame) return this.gw(0x364);
    await this.gw(0x365);
    this.king();
    await this.kingSayWait(0x366, this.heroName());
    await this.kingSayWait(0x367);
    m.setInventory(slot, target);
  }
  // 2a38a 免稅証 (道具 0x23 + 國): 本國人 爵位 < 6 時 (7 − 爵位) 萬, 外國人 (11 − 爵位) 萬; 付錢後不重畫面板 (原版如此)
  async taxFree() {
    const m = this.m, hd = m.heroInfo(), target = (this.nation + 0x23) & 0xff, slot = this.invSlot(target);
    if (slot === -1) return this.crewSays(0x368);
    if (slot === -2) return this.crewSays(0x361);
    await this.gw(0x369);
    if (this.c.rt.month % 6 < 3) await this.gw(0x36a);
    this.b.greet(0x36b);
    if (!(await this.c.menu.yesNo())) return;
    await this.gw(0x365);
    this.king();
    await this.kingSayWait(0x36c, this.heroName());
    const t = hd.rank;
    let si = 0;
    if (!this.same()) si = 11 - t; else if (t < 6) si = 7 - t;
    si = plS16(si);
    if (si) {
      this.kingSay(0x36d, si);
      if (!(await this.c.menu.yesNo())) return;
      if (plS16(Math.trunc(this.money / 10000)) < si) return this.crewSays(0x36e);
      this.money = (this.money + Math.imul(si, -10000)) | 0;
    }
    await this.kingSayWait(0x367);
    m.setInventory(slot, target);
  }

  // ================= 申請國籍 2a5f6 =================
  async naturalize() {
    const st = this.st, m = this.m, b = this.b, hero = m.heroPerson(), hd = m.heroInfo();
    this.king();
    await this.kingSayWait(0x1ca, this.heroName());
    if (!(await this.c.menu.yesNo())) return this.kingSayWait(0x1cb);
    await this.kingSayWait(0x1cc);
    const oldNat = hero.face & 7, newNat = this.nation;
    hero.face = (hero.face & 0xf0) | newNat;
    m.fleet(hero.fleet).homePort = b.port;
    const country = m.country(newNat);
    if (st.u8(country.addr + 2) === 7) st.set8(country.addr + 2, 6);
    country.aidMoneyK = 0; st.set8(country.addr + 6, 0); country.aidShipType = 0;
    const oldVal = hd.getCountryStanding(oldNat);
    if (oldVal >= 30) hd.setCountryStanding(oldNat, (oldVal - 30) & 0xff);
    hd.setCountryStanding(newNat, plUmax(100, plUmin(hd.getCountryStanding(newNat) + 10, 200)));
  }
  // ================= 資金援助 2a713 =================
  async funds() {
    const country = this.m.country(this.nation), v = country.aidMoneyK;
    if (!v) return this.gw(0x1cd);
    if (((this.money + v * 1000) | 0) > GameConst.MAX_CASH) return this.gw(0x212);
    await this.gw(0x1ce, v);
    this.money = (this.money + v * 1000) | 0;
    country.aidMoneyK = 0;
    this.b.p.panels();
    await this.gw(0x1cf);
  }
  // ================= 船舶援助 2a79b =================
  async shipAid() {
    const m = this.m, b = this.b, country = m.country(this.nation), tag = b.port | 0x80;
    if (!country.aidShipCount) return this.gw(0x1cd);
    b.freeSlots();                                                              // 12d0e
    if (plS16(this.c.persons[0]) < 10) return this.gw(0x213);                   // [0538] 不是船塢位 (沒有空位時沿用舊值)
    if (b.fleetShips() >= GameConst.FLEET_SHIPS) return this.gw(0x213);
    if (!this.mates()) return this.gw(0x214);
    for (let i = 0; i < 40; i++) if (m.crewSlot(i).captain === tag && b.slotState(i) === ShipSlotFlag.BUILDING) return this.gw(0x1cd);
    await this.gw(0x1d0, m.ship(country.aidShipType + 40).nameBytes);
    this.makeShip(country.aidShipType);                                         // 2e09:44bc
    country.aidShipCount--;
    for (let i = 0; i < 40; i++) {
      if (m.crewSlot(i).captain !== tag || b.slotState(i) !== ShipSlotFlag.BUILDING) continue;
      const ship = m.ship(this.st.u8(b.fleetSlot(i) + 7));
      b.greet(0x22b);
      const ni = b.nameInput();
      ni.prompt(2, 7);                                                          // 2e09:29a0
      while ((await ni.run(ship.addr, 7)) !== 1);                               // 2e09:26a5 (不重開提示視窗)
      await this.c.win.close();
      break;
    }
    await this.gw(0x228);
    await this.gw(0x1cf);
  }
  // 0fea:2f43 = 12de3 可當船長的人: 主角 (沒有擔任艦隊船長時) + 船員欄中職務 > 2 的人
  mates() {
    const m = this.m, heroId = m.globals.hero, L = [];
    let i = 0; for (; i < GameConst.FLEET_SHIPS; i++) if (m.crewSlot(i).captain === heroId) break;
    if (i === GameConst.FLEET_SHIPS) L.push(heroId);
    for (let k = 0; k < GameConst.PARTY_SLOTS; k++) {
      const n = m.partyCrew(k);
      if (n !== GameConst.EMPTY_SLOT && m.person(n).role > 2) L.push(n);
    }
    this.b.setPersons(L); return L.length;
  }
  // 2e09:44bc = 3254c 援助船 (船型 t): 放在第一個空的艦隊位, 狀態 0x20 (在造船所保管), 船員配置 captain = 本港 | 0x80
  makeShip(t) {
    const st = this.st, m = this.m, b = this.b, T = m.shipType(t), tmpl = m.ship(t + 40);
    let i = 0; for (; i < GameConst.FLEET_SHIPS; i++) { const f = b.slotState(i); if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) break; }
    const S = b.fleetSlot(0) + 9 * i;                                           // 找不到空位時 S 指到第 10 格之後 (原版如此)
    let n = 0; for (let k = 0; k < 40; k++) if (m.ship(k).type === GameConst.EMPTY_SLOT) { n = k; break; }
    const d = Math.trunc((9 * T.durability) / 10) & 0xff;
    st.set8(S + 3, d); st.set8(S + 2, d);
    st.set8(S + 4, T.turn); st.set8(S + 5, T.propulsion); st.set8(S + 6, 0); st.set16(S, 0);
    st.set8(S + 7, n); st.set8(S + 8, ShipSlotFlag.BUILDING);
    if (i >= GameConst.FLEET_SHIPS) console.warn("援助船: 艦隊沒有空位 (原版會寫到 DS:0000)");
    else {
      const cs = m.crewSlot(i);
      cs.water = 0; cs.food = 0; cs.material = 0; cs.ammo = 0;
      cs.navRatio = 25; cs.lookRatio = 50; cs.captain = b.port | 0x80; cs.loadTotal = 0;
      for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { cs.setCargoGoods(k, GameConst.EMPTY_SLOT); cs.setCargoAmts(k, 0); }
    }
    const R = m.ship(n);
    R.maxGuns = tmpl.maxGuns; R.type = t; R.flags = tmpl.flags;
    R.maxCrew = tmpl.maxCrew;
    R.maxCargo = (T.capacity - R.maxGuns - R.maxCrew) & 0xffff;
    st.set8(b.eco + 0x23, 0);                                                   // [c2dc] +23
  }
}
