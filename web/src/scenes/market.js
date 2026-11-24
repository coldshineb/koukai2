// market.js — 交易所 (MAIN.EXE 1fd9:5569 = 252f9; MENU #6 子功能 DS:aed8 = 買進 24bd9 / 賣出 24dbf / 投資 250b6 / 物價 252cf), 見 RE_NOTES 21
import { DS } from "../model/schema_views.ts";
import { GameConst, MenuId, SkillFlag } from "../model/flags.ts";
import { domS16, domUmin16, domUmax16, goodsCategory, hasTradeLicense, calcBuyPrice, calcSellPrice, calcHaggleBounds, calcBuyPriceShift, calcSellPriceShift, clampPriceIndexUp, clampPriceIndexDown } from "../domain/economy.ts";
import { runWideTableSelect } from "../canvas_ui/wide_table.ts";

const mHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const mS16 = domS16, mUmin = domUmin16, mUmax = domUmax16;

// 0fea:e3e5 = 1e285 → 1e1ff 交易記錄: 緩衝 [0c8e] 48 筆 × 16 bytes (DS.TRADE_LOGS); 滿了就整體前移、寫在最後一筆
//   引數 (AX 種類, DX, BX, 堆疊 2 個): +0 日期 ((12×年 + 月) × 31 + 日)  +2 種類 (AX)  +4 DX  +6 BX  +8 / +a 堆疊的兩個值
//   交易所買進 = 種類 0x0c (+4 商品, +6 0, +8 價格, +a 數量); 出港 = 1 (+4 補給天數, +6 港口); 發現港口 = 9 (+4 港口)
export function marketTradeLog(st, rt, kind, g, price, amount, a6 = 0) {
  const B = DS.TRADE_LOGS, N = GameConst.TRADE_LOG_COUNT;
  let i = 0; while (i < N && st.u16(B + i * 16) !== 0xffff) i++;
  if (i === N) { st.b.copyWithin(B - DS.STATE_BASE, B - DS.STATE_BASE + 16, B - DS.STATE_BASE + 0x300); i = N - 1; }
  const a = B + i * 16;
  st.set16(a, (((((12 * rt.year) & 0xffff) + rt.month) * 31) & 0xffff) + rt.day);
  st.set16(a + 2, kind); st.set16(a + 4, g); st.set16(a + 6, a6); st.set16(a + 8, price); st.set16(a + 10, amount);
}

export class Market {
  constructor(b) {
    this.b = b;
    const M = b.p.P.data.market, D = b.p.P.data;
    this.T = { cats: M.cats.map(mHex), catEnd: M.catEnd, goods: D.goods.map(mHex), ...Object.fromEntries(Object.entries(M.fmt).map(([k, v]) => [k, mHex(v)])) };
  }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get eco() { return this.m.portEconomy(this.b.port); }
  get reg() { return this.m.regionPrice(this.eco.priceRegion); }
  get port() { return this.m.port(this.b.port); }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  wait() { return this.b.wait(); }
  greet(n, ...a) { this.b.greet(n, ...a); }
  async crewSays(n, ...a) { this.b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(n, ...a); await this.wait(); await this.b.closeTalk(); }   // seg0:9076 + 訊息
  goodsName(g) { return this.T.goods[g] ?? Uint8Array.of(0); }
  // 2441e 商品分類: 第一個 DS:0784[i] > g 的 i, 沒有 = 0
  cat(g) { return goodsCategory(g, this.T.catEnd); }
  sup(g) { return this.eco.getPrices(this.cat(g)); }
  // 24441 通商許可: 港口所屬國 n < 6 且隨身物 (DS.INVENTORY) 中有 n + 0x23
  license() {
    const m = this.m, inv = [];
    for (let i = 0; i < GameConst.INV_SLOTS; i++) inv.push(m.inventory(i));
    return hasTradeLicense(this.port.region, inv) ? 1 : 0;
  }
  // 2446d 買價 (i = 地區清單第 i 項; 超出或空 = 本港特產), 無許可時 ×12/10
  price(i) {
    const R = this.reg, E = this.eco;
    const isReg = (i & 0xff) < 9 && R.getBuyGoods(i) !== GameConst.EMPTY_SLOT;
    const good = isReg ? R.getBuyGoods(i) : E.specialtyGood;
    const base = isReg ? R.getBuyBase(i) : E.specialtyBase;
    return calcBuyPrice(this.sup(good), base, !!this.license());
  }
  // 24c88 賣價: 特產 = (物價指數 + 50) × 特產基價 / 200, 其他 = (物價指數 + 50) × 地區賣價基準[g] / 100
  sellPrice(g) {
    const E = this.eco, isSpec = E.specialtyGood === g;
    return calcSellPrice(this.sup(g), isSpec ? E.specialtyBase : this.reg.getSellBase(g), isSpec);
  }
  // 25178 地區清單中 g 的買價, 不在清單 = 0
  regionBuy(g) { const R = this.reg; for (let i = 0; i < 9; i++) if (R.getBuyGoods(i) === g) return this.price(i); return 0; }
  // 24340 船位 slot: bit0 = 尚有載貨空間, bit1 = 有空的貨物欄
  room(slot) {
    const m = this.m, b = this.b, cs = m.crewSlot(slot), shipId = this.st.u8(b.fleetSlot(slot) + 7), used = b.cargoUsed(slot);
    let r = mS16(m.ship(shipId).maxCargo) > mS16(used) ? 1 : 0;
    for (let j = 0; j < GameConst.CARGO_SLOTS; j++) if (cs.getCargoGoods(j) === GameConst.EMPTY_SLOT) { r |= 2; break; }
    return r;
  }
  // 0fea:e3e5 交易記錄 (見 marketTradeLog)
  tradeLog(kind, g, price, amount) { marketTradeLog(this.st, this.c.rt, kind, g, price, amount); }

  // ================= 入口 252f9 =================
  async run() {
    const m = this.m, b = this.b, hero = m.heroPerson(), menu = this.c.menu;
    if (b.noEvent()) this.greet(m.heroInfo().tradeFame >= 1000 ? 1 : 0, hero.givenNameBytes, hero.familyNameBytes);
    const items = this.c.menuItems(MenuId.MARKET);
    let sel;
    do {
      if (!b.fleetShips()) menu.disabled |= 3;
      sel = await b.menu(items);
      if (sel !== 0xff) { await [() => this.buy(), () => this.sell(), () => this.invest(), () => this.prices()][sel](); b.after(); }
    } while (sel !== 0xff);
  }

  // ================= 買進 24bd9 =================
  // 24399: 不能買 → 1
  async cannotBuy() {
    const m = this.m, b = this.b;
    if (!b.fleetShips()) return 1;
    let f = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (!(m.crewSlot(i).captain & 0x80)) f |= this.room(i);
    if (f !== 3) { b.crewSpeaks(); this.c.message(f === 1 ? 0x1b : 0x1a); await this.wait(); await b.closeTalk(); return 1; }
    if (this.money === 0) { await this.crewSays(0x1c); return 1; }
    return 0;
  }
  async buy() {
    if (await this.cannotBuy()) return;
    this.greet(this.license() ? 0x2fa : 0x2fb); await this.wait();
    await this.buyList();
  }
  // 2487a 商品清單 (兩欄) → 確認價錢 → 是: 買入 / 否: 殺價
  async buyList() {
    const b = this.b, E = this.eco, R = this.reg, { con, printf, menu } = this.c, T = this.T;
    let si = 0, di = 0;
    if (E.specialtyGood !== GameConst.EMPTY_SLOT && 10 * E.specialtyLevel <= E.commerce) { if (this.sup(E.specialtyGood) < 0x5a) si = 1; }
    else di = 1;
    const items = [];
    let g = 0;
    for (; g < 9; g++) {
      if (R.getBuyGoods(g) === GameConst.EMPTY_SLOT) break;
      if (10 * R.getBuyLevels(g) <= E.commerce) items.push(g);
    }
    const n = items.length;
    if (si) items.push(g);
    for (;;) {
      if (di) this.greet(3); else this.greet(si ? 5 : 4, this.goodsName(E.specialtyGood));
      let r;
      if (this.c.scr.wideRenderer && this.c.codec) {
        const dec = bts => { let e = bts.indexOf(0); if (e < 0) e = bts.length; return this.c.codec.decode(bts.subarray(0, e)).replace(/\{[0-9A-F]{2}\}/g, "").trim(); };
        const rows = items.map((v, k) => ({
          label: dec(k < n ? this.goodsName(R.getBuyGoods(v)) : this.goodsName(E.specialtyGood)),
          rightText: String(this.price(v)),
          accent: k >= n,
        }));
        r = await runWideTableSelect(this.c, { title: dec(T.buyHdr), columns: 2, items: rows });
      } else {
        b.table();
        let k = 0;
        for (; k < items.length; k++) {
          if (k < 2) { con.setCursor(k * 0x18 + 0x12, 0x90); con.puts(T.buyHdr); }
          const y = ((k & 0xfe) + 0x0e) * 0x0c, col = (k & 1) * 0x16 + 0x10, v = items[k];
          con.setCursor(col, y);
          if (k < n) printf(T.buyRow, this.goodsName(R.getBuyGoods(v)), this.price(v));
          else printf(T.buyRow2, this.goodsName(E.specialtyGood), this.price(v));
          const x0 = (k & 1) * 0xb0 + 0x80;
          menu.rects[k] = { x0, x1: x0 + 0x80, y0: y, y1: y + 0x10 };
        }
        menu.rects[k] = { x0: 0x68, x1: 0x1d8, y0: 0x88, y1: 0x128 };
        r = await menu.customMenu(k, 2, 1);
      }
      if (r === 0xff) return;
      const v = items[r], p = this.price(v);
      if ((p >>> 1) > this.money) { await this.crewSays(0x16); continue; }
      const code = (v < 9 && R.getBuyGoods(v) !== GameConst.EMPTY_SLOT) ? R.getBuyGoods(v) : E.specialtyGood;
      const s = this.sup(code);
      await this.crewSays(s > 0x28 ? (s > 0x3c ? 0x18 : 0x19) : 0x17);
      this.greet(0x96, this.goodsName(code), this.price(v));
      if (!(await menu.yesNo())) await this.haggle(v, code);
      else await this.buyQty(code, this.price(v));
      if (await this.cannotBuy()) return;
    }
  }
  // 246c2 殺價: 底價 di = 價 × (19 − 交涉) / 20 (港口所屬國 = 主角國家時才算爵位), 出價 ≥ (價 + di) / 2 就成交
  async haggle(v, code) {
    const m = this.m, b = this.b, R = this.reg, E = this.eco;
    let rev = 0, hp = m.heroPerson();
    const bonus = (((this.port.region & 7) ^ hp.face) & 0x0f) === 0 ? m.heroInfo().rank : 0;
    let at;
    for (;;) {
      const p = this.price(v);
      const { lo, mid } = calcHaggleBounds(p, bonus);
      this.greet(6);
      const x = await b.numpad.input(0, this.price(v));
      if (!x) return;
      if (x >= mid) { this.greet(0x0a); await this.wait(); at = x; break; }
      if (!(((mid - lo) & 0xffff) & 0xfffe)) { this.greet(0x0b); await this.wait(); continue; }
      this.greet(0x0c, mUmax(lo, (this.price(v) - (((mid - lo) & 0xffff) >>> 1)) & 0xffff)); await this.wait();
      let s = rev;
      if (hp.skills & SkillFlag.NEGOTIATE) { b.talkPerson(m.globals.hero); s = 2; }
      else { const n = b.roleMember(4); if (n !== GameConst.EMPTY_SLOT) { hp = m.person(n); if (hp.skills & SkillFlag.ACCOUNTING) { b.crewSpeaks([4, 3, 5, 2, 6]); s = 2; } } }
      if (s === 2) { this.c.message(0x353, lo); await this.wait(); await b.closeTalk(); s = 1; }
      rev = s;
      if (!s) continue;
      this.greet(0x354, lo); await this.wait(); at = lo; break;
    }
    this.greet(0x96, this.goodsName(code), at);
    const g = ((v & 0xff) < 9 && R.getBuyGoods(v) !== GameConst.EMPTY_SLOT) ? R.getBuyGoods(v) : E.specialtyGood;
    await this.buyQty(g, at);
  }
  // 244fd 買入: 選船 (清單 0x84) → 數量 (載貨空間與現金的較小者) → 寫入貨物欄, 物價指數上升
  async buyQty(code, price) {
    const m = this.m, b = this.b, E = this.eco, list = b.listSel();
    const n = b.fleetShips();
    let slot;
    for (;;) {
      const r = await list.select(0x84, n);
      if (r === -1) return;
      slot = this.c.persons[r] & 0xff;
      if (this.room(slot) === 3) break;
    }
    this.greet(9);
    const shipId = this.st.u8(b.fleetSlot(slot) + 7);
    const byMoney = Math.floor((this.money >>> 0) / (price || 1));
    const free = mS16(m.ship(shipId).maxCargo) - mS16(b.cargoUsed(slot));
    const v = await b.numpad.input(0, free <= byMoney ? free : byMoney);
    if (!v) return;
    const cs = m.crewSlot(slot);
    let j = 0; while (j < GameConst.CARGO_SLOTS && cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT && cs.getCargoGoods(j) !== code) j++;
    if (j < GameConst.CARGO_SLOTS) {
      this.tradeLog(0x0c, code, price, v);
      this.money = this.money - v * price;
      cs.setCargoGoods(j, code);
      cs.setCargoAmts(j, cs.getCargoAmts(j) + v);
    }
    const c = this.cat(code), { catDelta: d, allDelta: t } = calcBuyPriceShift(v * price, E.commerce);
    E.setPrices(c, clampPriceIndexUp(E.getPrices(c), d));
    for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexUp(E.getPrices(i), t));
    b.loadTotal(slot);                                                          // seg0:5db1 (原版只計算, 回傳值沒有使用)
    b.p.panels();                                                               // 8894
  }

  // ================= 賣出 24dbf =================
  // 24c01 艦隊中有貨物的船 → [0538]
  shipsWithCargo() {
    const m = this.m, b = this.b, P = this.c.persons, n = b.fleetShips();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const cs = m.crewSlot(P[i] & 0xff);
      for (let j = 0; j < GameConst.CARGO_SLOTS; j++) if (cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT) { P[k++] = P[i]; break; }
    }
    return k;
  }
  hasCargo(cs) { for (let j = 0; j < GameConst.CARGO_SLOTS; j++) if (cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT) return 1; return 0; }   // 24c6e
  // 24cea 一艘船的貨物清單 (商品 < 0x2e)
  cargoMenu(cs) {
    const { con, printf, menu } = this.c, T = this.T, P = this.c.persons;
    if (this.c.scr.wideRenderer && this.c.codec) {
      const dec = bts => { let e = bts.indexOf(0); if (e < 0) e = bts.length; return this.c.codec.decode(bts.subarray(0, e)).replace(/\{[0-9A-F]{2}\}/g, "").trim(); };
      const rows = [];
      let si = 0;
      for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
        const g = cs.getCargoGoods(j);
        if (g >= 46) continue;
        rows.push({ label: `${dec(this.goodsName(g))}   ×${mS16(cs.getCargoAmts(j))}`, rightText: String(this.sellPrice(g)) });
        P[si++] = j;
      }
      return runWideTableSelect(this.c, { title: dec(T.sellHdr), columns: 1, items: rows });
    }
    this.b.table();
    con.setCursor(0x19, 0x90); con.puts(T.sellHdr);
    let si = 0;
    for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
      const g = cs.getCargoGoods(j);
      if (g >= 46) continue;
      const y = si * 0x18 + 0xa0;
      con.setCursor(0x17, y);
      printf(T.sellRow, this.goodsName(g), mS16(cs.getCargoAmts(j)), this.sellPrice(g));
      menu.rects[si] = { x0: 0xb8, x1: 0x178, y0: y, y1: y + 0x10 };
      P[si] = j; si++;
    }
    menu.rects[si] = { x0: 0x68, x1: 0x1d8, y0: 0x88, y1: 0x128 };
    return menu.customMenu(si, 1, 1);
  }
  async sell() {
    const m = this.m, b = this.b, E = this.eco, list = b.listSel();
    if (!b.fleetShips()) return;
    let si = 1;
    for (;;) {
      const n = this.shipsWithCargo();
      if (!n) { if (si) await this.crewSays(0x15); return; }
      const r = await list.select(0x82, n);
      if (r === -1) return;
      const cs = m.crewSlot(this.c.persons[r] & 0xff);
      for (;;) {
        si = this.hasCargo(cs);
        if (!si) { await this.crewSays(0x15); break; }
        const k = await this.cargoMenu(cs);
        if (k === 0xff) break;
        const j = this.c.persons[k] & 0xff, g = cs.getCargoGoods(j);
        const amt = await b.numpad.input(0, mS16(cs.getCargoAmts(j)));
        const p = this.sellPrice(g);
        this.money = this.money + amt * p;
        cs.setCargoAmts(j, cs.getCargoAmts(j) - amt);
        const c = this.cat(g), { catDelta: d, allDelta: t } = calcSellPriceShift(amt * p, E.commerce);
        E.setPrices(c, clampPriceIndexDown(E.getPrices(c), d));
        for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexDown(E.getPrices(i), t));
        if (cs.getCargoAmts(j) === 0) cs.setCargoGoods(j, GameConst.EMPTY_SLOT);
        b.p.panels();
      }
    }
  }

  // ================= 投資 250b6 =================
  async invest() {
    const b = this.b, E = this.eco;
    if (b.isCapital()) { this.greet(2); await this.wait(); return; }
    if (E.commerceInvest >= GameConst.MAX_INVEST) { this.greet(7); await this.wait(); return; }
    this.greet(8);
    const di = this.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : this.money & 0xffff;
    const v = await b.numpad.input(0, mUmin(di, GameConst.MAX_INVEST - E.commerceInvest));
    if (!v) { this.greet(0x0d); await this.wait(); return; }
    this.greet(v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10); await this.wait();
    E.commerceInvest += v;
    this.money = this.money - v;
    b.investSupport(v, E.commerce);                                             // 24f92: 與 2c6c6 相同, 但以商業值為基準
    b.investOwner();                                                            // 2c7ec
    b.p.panels();
  }

  // ================= 物價 252cf =================
  async prices() {
    const list = this.b.listSel();
    this.b.setPersons([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (;;) { const r = await list.select(0x88, 10); if (r === -1) return; await this.priceTable(r); }
  }
  // 251a2 分類 c 的商品: 名稱、買價 (地區清單 / 本港特產 / 「 ----」)、賣價
  async priceTable(c) {
    const E = this.eco, { con, printf, scr, codec } = this.c, T = this.T;
    this.greet(0x97, T.cats[c], E.getPrices(c) + 50);
    if (scr.wideRenderer && codec) {
      const dec = b => codec.decode(b).replace(/\0.*$/, "").trim();
      const di = c ? T.catEnd[c - 1] : 0;
      const items = [];
      for (let si = 0; T.catEnd[c] - di > si; si++) {
        const g = (di + si) & 0xff;
        const r = this.regionBuy(g);
        const buyStr = r ? String(r) : g === E.specialtyGood ? String(this.price(g)) : dec(T.none);
        items.push({ label: dec(this.goodsName(g)), rightText: `${buyStr} / ${this.sellPrice(g)}` });
      }
      await runWideTableSelect(this.c, { title: dec(T.cats[c]), columns: 2, items }, { interactive: false });
      return;
    }
    this.b.table();
    const di = c ? T.catEnd[c - 1] : 0;
    for (let si = 0; T.catEnd[c] - di > si; si++) {
      if (si < 2) { con.setCursor(si * 0x17 + 0x0f, 0x90); con.puts(T.priceHdr); }
      con.setCursor((si % 2) * 0x17 + 0x0e, (Math.trunc(si / 2) + 7) * 0x18);
      const g = (di + si) & 0xff;
      printf(T.name, this.goodsName(g));
      const r = this.regionBuy(g);
      if (r) printf(T.n5b, r);
      else if (g === E.specialtyGood) printf(T.n5, this.price(g));              // 原版以商品碼當清單索引呼叫 2446d
      else con.puts(T.none);
      printf(T.sp5, this.sellPrice(g));
    }
  }
}
