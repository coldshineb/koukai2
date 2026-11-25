// market.js — 交易所 (MAIN.EXE 1fd9:5569 = 252f9; MENU #6 子功能 DS:aed8 = 买进 24bd9 / 卖出 24dbf / 投资 250b6 / 物价 252cf), 见 RE_NOTES 21
import { GameConst, MenuId, SkillFlag } from "../model/flags.ts";
import { appendTradeLog, heroShipSlot } from "../model/world_helpers.ts";
import { domS16, domUmin16, domUmax16, goodsCategory, hasTradeLicense, calcBuyPrice, calcSellPrice, calcHaggleBounds, calcBuyPriceShift, calcSellPriceShift, clampPriceIndexUp, clampPriceIndexDown } from "../domain/economy.ts";
import { runDomTableSelect } from "../ui/modals.ts";
import { runDomMarketWorkbench } from "../ui/buildings/market.ts";
import { decodeCleanCstr } from "../ui/text_util.ts";

const mHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const mS16 = domS16, mUmin = domUmin16, mUmax = domUmax16;

// 0fea:e3e5 = 1e285 → 1e1ff 交易记录: 缓冲 [0c8e] 48 笔 × 16 bytes (DS.TRADE_LOGS); 满了就整体前移、写在最后一笔
//   参数 (AX 种类, DX, BX, 堆栈 2 个): +0 日期 ((12×年 + 月) × 31 + 日)  +2 种类 (AX)  +4 DX  +6 BX  +8 / +a 堆栈的两个值
//   交易所买进 = 种类 0x0c (+4 商品, +6 0, +8 价格, +a 数量); 出港 = 1 (+4 补给天数, +6 港口); 发现港口 = 9 (+4 港口)
export function marketTradeLog(st, rt, kind, g, price, amount, a6 = 0) {
  appendTradeLog(st.model, rt, kind, g, price, amount, a6);
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
  async crewSays(n, ...a) { this.b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(n, ...a); await this.wait(); await this.b.closeTalk(); }   // seg0:9076 + 消息
  goodsName(g) { return this.T.goods[g] ?? Uint8Array.of(0); }
  // 2441e 商品分类: 第一个 DS:0784[i] > g 的 i, 没有 = 0
  cat(g) { return goodsCategory(g, this.T.catEnd); }
  sup(g) { return this.eco.getPrices(this.cat(g)); }
  // 24441 通商许可: 港口所属国 n < 6 且随身物 (DS.INVENTORY) 中有 n + 0x23
  license() {
    const m = this.m, inv = [];
    for (let i = 0; i < GameConst.INV_SLOTS; i++) inv.push(m.inventory(i));
    return hasTradeLicense(this.port.region, inv) ? 1 : 0;
  }
  // 2446d 买价 (i = 地区清单第 i 项; 超出或空 = 本港特产), 无许可时 ×12/10
  price(i) {
    const R = this.reg, E = this.eco;
    const isReg = (i & 0xff) < 9 && R.getBuyGoods(i) !== GameConst.EMPTY_SLOT;
    const good = isReg ? R.getBuyGoods(i) : E.specialtyGood;
    const base = isReg ? R.getBuyBase(i) : E.specialtyBase;
    return calcBuyPrice(this.sup(good), base, !!this.license());
  }
  // 24c88 卖价: 特产 = (物价指数 + 50) × 特产基价 / 200, 其他 = (物价指数 + 50) × 地区卖价基准[g] / 100
  sellPrice(g) {
    const E = this.eco, isSpec = E.specialtyGood === g;
    return calcSellPrice(this.sup(g), isSpec ? E.specialtyBase : this.reg.getSellBase(g), isSpec);
  }
  // 25178 地区清单中 g 的买价, 不在清单 = 0
  regionBuy(g) { const R = this.reg; for (let i = 0; i < 9; i++) if (R.getBuyGoods(i) === g) return this.price(i); return 0; }
  // 24340 船位 slot: bit0 = 尚有载货空间, bit1 = 有空的货物栏
  room(slot) {
    const m = this.m, b = this.b, cs = m.crewSlot(slot), shipId = heroShipSlot(m, slot).ship, used = b.cargoUsed(slot);
    let r = mS16(m.ship(shipId).maxCargo) > mS16(used) ? 1 : 0;
    for (let j = 0; j < GameConst.CARGO_SLOTS; j++) if (cs.getCargoGoods(j) === GameConst.EMPTY_SLOT) { r |= 2; break; }
    return r;
  }
  // 0fea:e3e5 交易记录 (见 marketTradeLog)
  tradeLog(kind, g, price, amount) { appendTradeLog(this.m, this.c.rt, kind, g, price, amount); }

  // ================= 入口 252f9 =================
  async run() {
    const m = this.m, b = this.b, hero = m.heroPerson(), menu = this.c.menu;
    if (this.c.scr.wideRenderer && this.c.codec) {
      await runDomMarketWorkbench(this);
      return;
    }
    if (b.noEvent()) this.greet(m.heroInfo().tradeFame >= 1000 ? 1 : 0, hero.givenNameBytes, hero.familyNameBytes);
    const items = this.c.menuItems(MenuId.MARKET);
    let sel;
    do {
      if (!b.fleetShips()) menu.disabled |= 3;
      sel = await b.menu(items);
      if (sel !== 0xff) { await [() => this.buy(), () => this.sell(), () => this.invest(), () => this.prices()][sel](); b.after(); }
    } while (sel !== 0xff);
  }

  // ================= 买进 24bd9 =================
  // 24399: 不能买 → 1
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
  // 2487a 商品清单 (两栏) → 确认价钱 → 是: 买入 / 否: 杀价
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
        const dec = bts => decodeCleanCstr(this.c.codec, bts);
        const rows = items.map((v, k) => ({
          label: dec(k < n ? this.goodsName(R.getBuyGoods(v)) : this.goodsName(E.specialtyGood)),
          rightText: String(this.price(v)),
          accent: k >= n,
        }));
        r = await runDomTableSelect({ title: dec(T.buyHdr), columns: 2, items: rows });
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
  // 246c2 杀价: 底价 di = 价 × (19 − 交涉) / 20 (港口所属国 = 主角国家时才算爵位), 出价 ≥ (价 + di) / 2 就成交
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
  // 244fd 买入: 选船 (清单 0x84) → 数量 (载货空间与现金的较小者) → 写入货物栏, 物价指数上升
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
    const shipId = heroShipSlot(m, slot).ship;
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
    b.loadTotal(slot);                                                          // seg0:5db1 (原版只计算, 返回值没有使用)
    b.p.panels();                                                               // 8894
  }

  // ================= 卖出 24dbf =================
  // 24c01 舰队中有货物的船 → [0538]
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
  // 24cea 一艘船的货物清单 (商品 < 0x2e)
  cargoMenu(cs) {
    const { con, printf, menu } = this.c, T = this.T, P = this.c.persons;
    if (this.c.scr.wideRenderer && this.c.codec) {
      const dec = bts => decodeCleanCstr(this.c.codec, bts);
      const rows = [];
      let si = 0;
      for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
        const g = cs.getCargoGoods(j);
        if (g >= 46) continue;
        rows.push({ label: `${dec(this.goodsName(g))}   ×${mS16(cs.getCargoAmts(j))}`, rightText: String(this.sellPrice(g)) });
        P[si++] = j;
      }
      return runDomTableSelect({ title: dec(T.sellHdr), columns: 1, items: rows });
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

  // ================= 投资 250b6 =================
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
    b.investSupport(v, E.commerce);                                             // 24f92: 与 2c6c6 相同, 但以商业值为基准
    b.investOwner();                                                            // 2c7ec
    b.p.panels();
  }

  // ================= 物价 252cf =================
  async prices() {
    const list = this.b.listSel();
    this.b.setPersons([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (;;) { const r = await list.select(0x88, 10); if (r === -1) return; await this.priceTable(r); }
  }
  // 251a2 分类 c 的商品: 名称、买价 (地区清单 / 本港特产 / 「 ----」)、卖价
  async priceTable(c) {
    const E = this.eco, { con, printf, scr, codec } = this.c, T = this.T;
    this.greet(0x97, T.cats[c], E.getPrices(c) + 50);
    if (scr.wideRenderer && codec) {
      const dec = b => decodeCleanCstr(codec, b);
      const di = c ? T.catEnd[c - 1] : 0;
      const items = [];
      for (let si = 0; T.catEnd[c] - di > si; si++) {
        const g = (di + si) & 0xff;
        const r = this.regionBuy(g);
        const buyStr = r ? String(r) : g === E.specialtyGood ? String(this.price(g)) : dec(T.none);
        items.push({ label: dec(this.goodsName(g)), rightText: `${buyStr} / ${this.sellPrice(g)}` });
      }
      await runDomTableSelect({ title: dec(T.cats[c]), columns: 2, items }, { interactive: false });
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
      else if (g === E.specialtyGood) printf(T.n5, this.price(g));              // 原版以商品码当清单索引调用 2446d
      else con.puts(T.none);
      printf(T.sp5, this.sellPrice(g));
    }
  }
}
