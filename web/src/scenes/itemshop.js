// itemshop.js — 道具店 (MAIN.EXE 1fd9:a06e = 線性 29dfe, 處理函式表 DS:a612[9]); 見 RE_NOTES 25
// MENU #5 (買進/賣出), 子功能 DS:b21e = 29afb / 29c4a
// 商品: 港口經濟記錄 +1d.. (0fea:3257 = 130f7: 一般 3 項, 時刻 [0535] 為 6..8 (夜間 2:00–3:00) 時 4 項, 跳過 FF)
// 隨身物: DS:2e57 (20 格, FF = 空), 道具記錄 seg0:5cde = 0x8248 + 0x14×n (+0 名稱, +10 價格/100, +12 數值, +13 低 4 位 種類 / bit4 已裝備)
// 原版怪行為 (照搬): 問候判斷夜市用的是 12 ≤ [0535] < 18 (而營業時間是 2:00–3:00 = 6..8 與 8:00–20:00), 所以「夜市」問候 0x2fc 實際上不會出現
const isHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const isS16 = v => (v << 16) >> 16;

export class ItemShop {
  constructor(b) { this.b = b; this.F = Object.fromEntries(Object.entries(b.p.P.data.bld2.fmt).map(([k, v]) => [k, isHex(v)])); }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  rec(it) { return 0x8248 + (it & 0xff) * 0x14; }                               // seg0:5cde

  // ================= 入口 29dfe =================
  async run() {
    const b = this.b, t = this.c.rt.time;
    if (b.noEvent()) b.greet(t >= 0x0c && t < 0x12 ? 0x2fc : 0xeb);
    const items = this.c.menuItems(5).slice(0, 2);
    let sel;
    do {
      sel = await b.menu(items);
      if (sel !== 0xff) await [() => this.buy(), () => this.sell()][sel]();
      b.after();
    } while (sel !== 0xff);
  }
  // 130f7 本店商品 → [0538]
  shopList() {
    const E = this.b.eco, t = this.c.rt.time, n = t >= 6 && t < 9 ? 4 : 3, L = [];
    for (let i = 0; i < n; i++) { const v = this.st.u8(E + 0x1d + i); if (v !== 0xff) L.push(v); }
    this.b.setPersons(L); return L.length;
  }
  // 0fea:32a6 = 13146 隨身物 → [0538]
  invList() {
    const L = []; for (let i = 0; i < 0x14; i++) { const v = this.st.u8(0x2e57 + i); if (v !== 0xff) L.push(v); }
    this.b.setPersons(L); return L.length;
  }
  // 29acd 能否再買: 沒錢 0xec / 已有 20 件 0xed
  async canBuy() {
    const b = this.b;
    if (this.money === 0) { b.greet(0xec); await b.wait(); return 0; }
    if (this.invList() === 0x14) { b.greet(0xed); await b.wait(); return 0; }
    return 1;
  }
  // 29afb 買進
  async buy() {
    const b = this.b, st = this.st, { menu, printf, message } = this.c;
    let first = 1;
    for (;;) {
      b.table();                                                                 // 0fea:b6bc
      if (!(await this.canBuy())) return;
      const n = this.shopList();
      b.greet(first ? 0xee : 0xf2);
      const di = await b.listSel().select(0x8d, n);
      if (di === -1) return;
      const it = this.c.persons[di] & 0xff, R = this.rec(it);
      let owned = 0;
      for (let i = 0; i < 0x14; i++) if (st.u8(0x2e57 + i) === it && (st.u8(R + 0x13) & 0x0f) < 7) { owned = 1; break; }
      if (owned) { b.greet(0x14c); await b.wait(); continue; }
      b.itemInfo(it, 0);                                                         // 29340
      const price = Math.imul(100, isS16(st.u16(R + 0x10)));
      b.greet(0xf0, st.cstr(R)); printf(this.F.ld, price); message(0xf1);
      if (!(await menu.yesNo())) continue;
      if (price > this.money) { b.greet(0xef); await b.wait(); continue; }
      this.money = (this.money - price) | 0;
      for (let i = 0; i < 0x14; i++) if (st.u8(0x2e57 + i) === 0xff) { st.set8(0x2e57 + i, it); first = 0; break; }
      this.b.p.panels();                                                         // 8894
    }
  }
  // 29c4a 賣出: 價格 = (價格/100 ÷ 2 向零取整) × 100; 拒絕時 random(100) ≤ 主角 +23 則加價 價格 × 主角 +22 / 200 再問一次
  async sell() {
    const b = this.b, st = this.st, { menu, printf, message, sys } = this.c;
    let first = 1;
    for (;;) {
      b.table();
      const n = this.invList();
      if (!n) { b.greet(0xf3); await b.wait(); return; }
      b.greet(first ? 0xf4 : 0xf8);
      const sel = await b.listSel().select(0x8d, n);
      if (sel === -1) return;
      const it = this.c.persons[sel] & 0xff, R = this.rec(it);
      b.itemInfo(it, 0);
      if (st.u8(R + 0x13) & 0x10) { b.greet(0x14d); await b.wait(); continue; }
      let price = Math.imul(isS16(Math.trunc(isS16(st.u16(R + 0x10)) / 2)), 100);
      if (st.u8(R + 0x12) === 0) { b.greet(0x3a1); await b.wait(); continue; }
      b.greet(0xf5, st.cstr(R)); printf(this.F.ld2, price); message(0xf7);
      if (!(await menu.yesNo())) {
        if (sys.rng.random(100) > st.u8(b.hero + 0x23)) continue;
        price = (price + Math.trunc(Math.imul(price, st.u8(b.hero + 0x22)) / 200)) | 0;
        b.greet(0xf6); printf(this.F.ld3, price); message(0xf7);
        if (!(await menu.yesNo())) continue;
      }
      let m = (this.money + price) | 0; if (m >= 600000000) m = 600000000;
      this.money = m;
      for (let i = 0; i < 0x14; i++) if (st.u8(0x2e57 + i) === it) { st.set8(0x2e57 + i, 0xff); first = 0; break; }
      this.b.p.panels();
    }
  }
}
