// itemshop.js — 道具店 (MAIN.EXE 1fd9:a06e = 线性 29dfe, 处理函数表 DS:a612[9]); 见 RE_NOTES 25
// MENU #5 (买进/卖出), 子功能 DS:b21e = 29afb / 29c4a
// 商品: 港口经济记录 shopItems (0fea:3257 = 130f7: 一般 3 项, 时刻 [0535] 为 6..8 (夜间 2:00–3:00) 时 4 项, 跳过 FF)
// 随身物: DS:2e57 (20 格, FF = 空), 道具记录 items (+0 名称, +10 价格/100, +12 数值, +13 低 4 位 种类 / bit4 已装备)
// 原版怪行为 (照搬): 问候判断夜市用的是 12 ≤ [0535] < 18 (而营业时间是 2:00–3:00 = 6..8 与 8:00–20:00), 所以「夜市」问候 0x2fc 实际上不会出现
import { GameConst, ItemFlag, ItemKind, MenuId } from "../model/flags.ts";

const isHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const isS16 = v => (v << 16) >> 16;

export class ItemShop {
  constructor(b) { this.b = b; this.F = Object.fromEntries(Object.entries(b.p.P.data.bld2.fmt).map(([k, v]) => [k, isHex(v)])); }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }

  // ================= 入口 29dfe =================
  async run() {
    const b = this.b, t = this.c.rt.time;
    if (b.noEvent()) b.greet(t >= 12 && t < 18 ? 0x2fc : 0xeb);
    const items = this.c.menuItems(MenuId.ITEM_SHOP).slice(0, 2);
    let sel;
    do {
      sel = await b.menu(items);
      if (sel !== 0xff) await [() => this.buy(), () => this.sell()][sel]();
      b.after();
    } while (sel !== 0xff);
  }
  // 130f7 本店商品 → [0538]
  shopList() {
    const eco = this.m.portEconomy(this.b.port), t = this.c.rt.time, n = t >= 6 && t < 9 ? 4 : 3, L = [];
    for (let i = 0; i < n; i++) { const v = eco.getShopItems(i); if (v !== GameConst.EMPTY_SLOT) L.push(v); }
    this.b.setPersons(L); return L.length;
  }
  // 0fea:32a6 = 13146 随身物 → [0538]
  invList() {
    const m = this.m, L = [];
    for (let i = 0; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (v !== GameConst.EMPTY_SLOT) L.push(v); }
    this.b.setPersons(L); return L.length;
  }
  // 29acd 能否再买: 没钱 0xec / 已有 20 件 0xed
  async canBuy() {
    const b = this.b;
    if (this.money === 0) { b.greet(0xec); await b.wait(); return 0; }
    if (this.invList() === GameConst.INV_SLOTS) { b.greet(0xed); await b.wait(); return 0; }
    return 1;
  }
  // 29afb 买进
  async buy() {
    const b = this.b, m = this.m, { menu, printf, message } = this.c;
    let first = 1;
    for (;;) {
      b.table();                                                                // 0fea:b6bc
      if (!(await this.canBuy())) return;
      const n = this.shopList();
      b.greet(first ? 0xee : 0xf2);
      const di = await b.listSel().select(0x8d, n);
      if (di === -1) return;
      const it = this.c.persons[di] & 0xff, item = m.item(it);
      let owned = 0;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) {
        if (m.inventory(i) === it && (item.kindFlags & ItemFlag.KIND_MASK) < ItemKind.NAVI_TOOL) { owned = 1; break; }
      }
      if (owned) { b.greet(0x14c); await b.wait(); continue; }
      b.itemInfo(it, 0);                                                        // 29340
      const price = Math.imul(100, isS16(item.priceDiv100));
      b.greet(0xf0, item.nameBytes); printf(this.F.ld, price); message(0xf1);
      if (!(await menu.yesNo())) continue;
      if (price > this.money) { b.greet(0xef); await b.wait(); continue; }
      this.money = (this.money - price) | 0;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === GameConst.EMPTY_SLOT) { m.setInventory(i, it); first = 0; break; }
      this.b.p.panels();                                                        // 8894
    }
  }
  // 29c4a 卖出: 价格 = (价格/100 ÷ 2 向零取整) × 100; 拒绝时 random(100) ≤ 主角 +23 则加价 价格 × 主角 +22 / 200 再问一次
  async sell() {
    const b = this.b, m = this.m, { menu, printf, message, sys } = this.c;
    let first = 1;
    for (;;) {
      b.table();
      const n = this.invList();
      if (!n) { b.greet(0xf3); await b.wait(); return; }
      b.greet(first ? 0xf4 : 0xf8);
      const sel = await b.listSel().select(0x8d, n);
      if (sel === -1) return;
      const it = this.c.persons[sel] & 0xff, item = m.item(it);
      b.itemInfo(it, 0);
      if (item.kindFlags & ItemFlag.EQUIPPED) { b.greet(0x14d); await b.wait(); continue; }
      let price = Math.imul(isS16(Math.trunc(isS16(item.priceDiv100) / 2)), 100);
      if (item.power === 0) { b.greet(0x3a1); await b.wait(); continue; }
      b.greet(0xf5, item.nameBytes); printf(this.F.ld2, price); message(0xf7);
      if (!(await menu.yesNo())) {
        const hero = m.heroPerson();
        if (sys.rng.random(100) > hero.getStats(7)) continue;
        price = (price + Math.trunc(Math.imul(price, hero.getStats(6)) / 200)) | 0;
        b.greet(0xf6); printf(this.F.ld3, price); message(0xf7);
        if (!(await menu.yesNo())) continue;
      }
      let nextCash = (this.money + price) | 0; if (nextCash >= GameConst.MAX_CASH) nextCash = GameConst.MAX_CASH;
      this.money = nextCash;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === it) { m.setInventory(i, GameConst.EMPTY_SLOT); first = 0; break; }
      this.b.p.panels();
    }
  }
}
