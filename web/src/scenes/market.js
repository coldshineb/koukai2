// market.js — 交易所 (MAIN.EXE 1fd9:5569 = 252f9; MENU #6 子功能 DS:aed8 = 買進 24bd9 / 賣出 24dbf / 投資 250b6 / 物價 252cf), 見 RE_NOTES 21
// 港口經濟記錄 E = DS:6a80 + 0x25×港 ([c2dc]): +00 商業值, +02 商業投資累計, +0e..+17 各分類物價指數 (0..100; 物價畫面顯示 指數 + 50), +18 特產基價, +1a 特產, +1b 特產所需等級
// 地區物價表 R = DS:78f4 + 0x80×(E +21) ([c2cc]): +00 各商品 (46 種) 賣價基準 (字), +5c 9 種買價基準 (字), +6e 9 種商品, +77 9 種所需等級
const mHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const mS16 = v => (v << 16) >> 16;
const mUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const mUmax = (a, b) => ((b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff);  // seg0:4d87

export class Market {
  constructor(b) {
    this.b = b;
    const M = b.p.P.data.market, D = b.p.P.data;
    this.T = { cats: M.cats.map(mHex), catEnd: M.catEnd, goods: D.goods.map(mHex), ...Object.fromEntries(Object.entries(M.fmt).map(([k, v]) => [k, mHex(v)])) };
  }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get E() { return this.b.eco; }                                                   // [c2dc]
  get R() { return 0x78f4 + this.st.u8(this.E + 0x21) * 0x80; }                   // [c2cc] seg0:5cba
  get P() { return 0x5f54 + this.b.port * 0x16; }                                  // [bda2] seg0:5c9a
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  wait() { return this.b.wait(); }
  greet(n, ...a) { this.b.greet(n, ...a); }
  async crewSays(n, ...a) { this.b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(n, ...a); await this.wait(); await this.b.closeTalk(); }   // seg0:9076 + 訊息
  goodsName(g) { return this.T.goods[g] ?? Uint8Array.of(0); }
  // 2441e 商品分類: 第一個 DS:0784[i] > g 的 i, 沒有 = 0
  cat(g) { for (let i = 0; i < 10; i++) if (this.T.catEnd[i] > (g & 0xff)) return i; return 0; }
  sup(g) { return this.st.u8(this.E + 0x0e + this.cat(g)); }
  // 24441 通商許可: 港口所屬國 n < 6 且隨身物 (DS:2e57) 中有 n + 0x23
  license() {
    const st = this.st, n = st.u8(this.P + 0x15) & 7;
    if (n >= 6) return 0;
    for (let i = 0; i < 0x14; i++) if (((st.u8(0x2e57 + i) - n) & 0xff) === 0x23) return 1;
    return 0;
  }
  // 2446d 買價 (i = 地區清單第 i 項; 超出或空 = 本港特產), 無許可時 ×12/10
  price(i) {
    const st = this.st, R = this.R, E = this.E;
    let v;
    if ((i & 0xff) < 9 && st.u8(R + 0x6e + i) !== 0xff) v = Math.trunc((this.sup(st.u8(R + 0x6e + i)) + 50) * mS16(st.u16(R + 0x5c + i * 2)) / 100);
    else v = Math.trunc((this.sup(st.u8(E + 0x1a)) + 50) * mS16(st.u16(E + 0x18)) / 100);
    return Math.trunc(((v & 0xffff) * (this.license() ? 10 : 12)) / 10) & 0xffff;
  }
  // 24c88 賣價: 特產 = (物價指數 + 50) × 特產基價 / 200, 其他 = (物價指數 + 50) × 地區賣價基準[g] / 100
  sellPrice(g) {
    const st = this.st, E = this.E;
    if (st.u8(E + 0x1a) === g) return Math.trunc((this.sup(g) + 50) * mS16(st.u16(E + 0x18)) / 200) & 0xffff;
    return Math.trunc((this.sup(g) + 50) * mS16(st.u16(this.R + g * 2)) / 100) & 0xffff;
  }
  // 25178 地區清單中 g 的買價, 不在清單 = 0
  regionBuy(g) { const st = this.st; for (let i = 0; i < 9; i++) if (st.u8(this.R + 0x6e + i) === g) return this.price(i); return 0; }
  // 24340 船位 slot: bit0 = 尚有載貨空間, bit1 = 有空的貨物欄
  room(slot) {
    const st = this.st, b = this.b, M = b.crewData(slot), S = b.fleetSlot(slot), used = b.cargoUsed(slot);
    let r = mS16(st.u16(0x5892 + st.u8(S + 7) * 0x16 + 0x14)) > mS16(used) ? 1 : 0;
    for (let j = 0; j < 5; j++) if (st.u8(M + 0x16 + j) === 0xff) { r |= 2; break; }
    return r;
  }
  // 0fea:e3e5 交易記錄: 緩衝 [0c8e] 0x30 筆 × 0x10 bytes (存檔時接在遊戲資料後, 本移植版在狀態的 0x8a18); 滿了就整體前移
  //   +0 日期 ((12×年 + 月) × 31 + 日)  +2 種類  +4 商品  +6 0  +8 價格  +a 數量
  tradeLog(kind, g, price, amount) {
    const st = this.st, B = 0x8a18, rt = this.c.rt;
    let i = 0; while (i < 0x30 && st.u16(B + i * 0x10) !== 0xffff) i++;
    if (i === 0x30) { st.b.copyWithin(B - 0x0ca4, B - 0x0ca4 + 0x10, B - 0x0ca4 + 0x300); i = 0x2f; }
    const a = B + i * 0x10;
    st.set16(a, (((((12 * rt.year) & 0xffff) + rt.month) * 0x1f) & 0xffff) + rt.day);
    st.set16(a + 2, kind); st.set16(a + 4, g); st.set16(a + 6, 0); st.set16(a + 8, price); st.set16(a + 10, amount);
  }

  // ================= 入口 252f9 =================
  async run() {
    const st = this.st, b = this.b, H = b.hero, menu = this.c.menu;
    if (b.noEvent()) this.greet(st.u16(b.heroData) >= 1000 ? 1 : 0, b.dstr(H), b.dstr(H + 0x0d));
    const items = this.c.menuItems(6);
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
    const st = this.st, b = this.b;
    if (!b.fleetShips()) return 1;
    let f = 0;
    for (let i = 0; i < 10; i++) if (!(st.u8(b.crewData(i) + 0x1b) & 0x80)) f |= this.room(i);
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
    const st = this.st, b = this.b, E = this.E, R = this.R, { con, printf, menu } = this.c, T = this.T;
    let si = 0, di = 0;
    if (st.u8(E + 0x1a) !== 0xff && 10 * st.u8(E + 0x1b) <= st.u16(E)) { if (this.sup(st.u8(E + 0x1a)) < 0x5a) si = 1; }
    else di = 1;
    const items = [];
    let g = 0;
    for (; g < 9; g++) {
      if (st.u8(R + 0x6e + g) === 0xff) break;
      if (10 * st.u8(R + 0x77 + g) <= st.u16(E)) items.push(g);
    }
    const n = items.length;
    if (si) items.push(g);
    for (;;) {
      if (di) this.greet(3); else this.greet(si ? 5 : 4, this.goodsName(st.u8(E + 0x1a)));
      b.table();
      let k = 0;
      for (; k < items.length; k++) {
        if (k < 2) { con.setCursor(k * 0x18 + 0x12, 0x90); con.puts(T.buyHdr); }
        const y = ((k & 0xfe) + 0x0e) * 0x0c, col = (k & 1) * 0x16 + 0x10, v = items[k];
        con.setCursor(col, y);
        if (k < n) printf(T.buyRow, this.goodsName(st.u8(R + 0x6e + v)), this.price(v));
        else printf(T.buyRow2, this.goodsName(st.u8(E + 0x1a)), this.price(v));
        const x0 = (k & 1) * 0xb0 + 0x80;
        menu.rects[k] = { x0, x1: x0 + 0x80, y0: y, y1: y + 0x10 };
      }
      menu.rects[k] = { x0: 0x68, x1: 0x1d8, y0: 0x88, y1: 0x128 };
      const r = await menu.customMenu(k, 2, 1);
      if (r === 0xff) return;
      const v = items[r], p = this.price(v);
      if ((p >>> 1) > this.money) { await this.crewSays(0x16); continue; }
      const code = (v < 9 && st.u8(R + 0x6e + v) !== 0xff) ? st.u8(R + 0x6e + v) : st.u8(E + 0x1a);
      const s = this.sup(code);
      await this.crewSays(s > 0x28 ? (s > 0x3c ? 0x18 : 0x19) : 0x17);
      this.greet(0x96, this.goodsName(code), this.price(v));
      if (!(await menu.yesNo())) await this.haggle(v, code);
      else await this.buyQty(code, this.price(v));
      if (await this.cannotBuy()) return;
    }
  }
  // 246c2 殺價: 底價 di = 價 × (19 − 交涉) / 20 (港口所屬國 = 主角國家時才算主角資料 +0d), 出價 ≥ (價 + di) / 2 就成交
  async haggle(v, code) {
    const st = this.st, b = this.b, R = this.R, E = this.E;
    let rev = 0, hp = b.hero;                                                      // [bp-0a] [bp-6]
    const bonus = (((st.u8(this.P + 0x15) & 7) ^ st.u8(b.hero + 0x31)) & 0x0f) === 0 ? st.u8(b.heroData + 0x0d) : 0;
    let at;
    for (;;) {
      const p = this.price(v);
      const lo = Math.trunc((p * ((0x13 - bonus) & 0xffff)) / 0x14) & 0xffff;
      const mid = (p - (((p - lo) & 0xffff) >>> 1)) & 0xffff;
      this.greet(6);
      const x = await b.numpad.input(0, this.price(v));
      if (!x) return;
      if (x >= mid) { this.greet(0x0a); await this.wait(); at = x; break; }
      if (!(((mid - lo) & 0xffff) & 0xfffe)) { this.greet(0x0b); await this.wait(); continue; }
      this.greet(0x0c, mUmax(lo, (this.price(v) - (((mid - lo) & 0xffff) >>> 1)) & 0xffff)); await this.wait();
      let s = rev;
      if (st.u8(hp + 0x30) & 1) { b.talkPerson(st.hero); s = 2; }
      else { const n = b.roleMember(4); if (n !== 0xff) { hp = st.personRecord(n); if (st.u8(hp + 0x30) & 2) { b.crewSpeaks([4, 3, 5, 2, 6]); s = 2; } } }
      if (s === 2) { this.c.message(0x353, lo); await this.wait(); await b.closeTalk(); s = 1; }
      rev = s;
      if (!s) continue;
      this.greet(0x354, lo); await this.wait(); at = lo; break;
    }
    this.greet(0x96, this.goodsName(code), at);
    const g = ((v & 0xff) < 9 && st.u8(R + 0x6e + v) !== 0xff) ? st.u8(R + 0x6e + v) : st.u8(E + 0x1a);
    await this.buyQty(g, at);
  }
  // 244fd 買入: 選船 (清單 0x84) → 數量 (載貨空間與現金的較小者) → 寫入貨物欄, 物價指數上升
  async buyQty(code, price) {
    const st = this.st, b = this.b, E = this.E, list = b.listSel();
    const n = b.fleetShips();
    let slot;
    for (;;) {
      const r = await list.select(0x84, n);
      if (r === -1) return;
      slot = this.c.persons[r] & 0xff;
      if (this.room(slot) === 3) break;
    }
    this.greet(9);
    const S = b.fleetSlot(slot);
    const byMoney = Math.floor((this.money >>> 0) / (price || 1));
    const free = mS16(st.u16(0x5892 + st.u8(S + 7) * 0x16 + 0x14)) - mS16(b.cargoUsed(slot));
    const v = await b.numpad.input(0, free <= byMoney ? free : byMoney);
    if (!v) return;
    const M = b.crewData(slot);
    let j = 0; while (j < 5 && st.u8(M + 0x16 + j) !== 0xff && st.u8(M + 0x16 + j) !== code) j++;
    if (j < 5) {
      this.tradeLog(0x0c, code, price, v);
      this.money = this.money - v * price;
      st.set8(M + 0x16 + j, code);
      st.set16(M + 0x0c + j * 2, st.u16(M + 0x0c + j * 2) + v);
    }
    const c = this.cat(code), si = (v * price) & 0xffff;
    const d = mUmin(10, Math.floor(si / ((st.u16(E) + 500) & 0xffff)));
    st.set8(E + 0x0e + c, mUmin(100, st.u8(E + 0x0e + c) + d));
    const t = mUmin(3, Math.floor(si / 1000));
    for (let i = 0; i < 10; i++) st.set8(E + 0x0e + i, mUmin(100, st.u8(E + 0x0e + i) + t));
    b.loadTotal(slot);                                                             // seg0:5db1 (原版只計算, 回傳值沒有使用)
    b.p.panels();                                                                  // 8894
  }

  // ================= 賣出 24dbf =================
  // 24c01 艦隊中有貨物的船 → [0538]
  shipsWithCargo() {
    const st = this.st, b = this.b, P = this.c.persons, n = b.fleetShips();
    let k = 0;
    for (let i = 0; i < n; i++) { const M = b.crewData(P[i] & 0xff); for (let j = 0; j < 5; j++) if (st.u8(M + 0x16 + j) !== 0xff) { P[k++] = P[i]; break; } }
    return k;
  }
  hasCargo(M) { for (let j = 0; j < 5; j++) if (this.st.u8(M + 0x16 + j) !== 0xff) return 1; return 0; }   // 24c6e
  // 24cea 一艘船的貨物清單 (商品 < 0x2e)
  cargoMenu(M) {
    const st = this.st, { con, printf, menu } = this.c, T = this.T, P = this.c.persons;
    this.b.table();
    con.setCursor(0x19, 0x90); con.puts(T.sellHdr);
    let si = 0;
    for (let j = 0; j < 5; j++) {
      const g = st.u8(M + 0x16 + j);
      if (g >= 0x2e) continue;
      const y = si * 0x18 + 0xa0;
      con.setCursor(0x17, y);
      printf(T.sellRow, this.goodsName(g), mS16(st.u16(M + 0x0c + j * 2)), this.sellPrice(g));
      menu.rects[si] = { x0: 0xb8, x1: 0x178, y0: y, y1: y + 0x10 };
      P[si] = j; si++;
    }
    menu.rects[si] = { x0: 0x68, x1: 0x1d8, y0: 0x88, y1: 0x128 };
    return menu.customMenu(si, 1, 1);
  }
  async sell() {
    const st = this.st, b = this.b, E = this.E, list = b.listSel();
    if (!b.fleetShips()) return;
    let si = 1;
    for (;;) {
      const n = this.shipsWithCargo();
      if (!n) { if (si) await this.crewSays(0x15); return; }
      const r = await list.select(0x82, n);
      if (r === -1) return;
      const M = b.crewData(this.c.persons[r] & 0xff);
      for (;;) {
        si = this.hasCargo(M);
        if (!si) { await this.crewSays(0x15); break; }
        const k = await this.cargoMenu(M);
        if (k === 0xff) break;
        const j = this.c.persons[k] & 0xff, g = st.u8(M + 0x16 + j);
        const amt = await b.numpad.input(0, mS16(st.u16(M + 0x0c + j * 2)));
        const p = this.sellPrice(g);
        this.money = this.money + amt * p;
        st.set16(M + 0x0c + j * 2, st.u16(M + 0x0c + j * 2) - amt);
        const c = this.cat(g);
        const d = mUmin(10, Math.trunc((amt * p) / ((st.u16(E) + 500) & 0xffff)) & 0xffff);
        st.set8(E + 0x0e + c, st.u8(E + 0x0e + c) - mUmin(st.u8(E + 0x0e + c), d));
        const t = mUmin(3, Math.floor(((p * amt) & 0xffff) / 1000));
        for (let i = 0; i < 10; i++) st.set8(E + 0x0e + i, st.u8(E + 0x0e + i) - mUmin(st.u8(E + 0x0e + i), t));
        if (st.u16(M + 0x0c + j * 2) === 0) st.set8(M + 0x16 + j, 0xff);
        b.p.panels();
      }
    }
  }

  // ================= 投資 250b6 =================
  async invest() {
    const st = this.st, b = this.b, E = this.E;
    if (b.isCapital()) { this.greet(2); await this.wait(); return; }
    if (st.u16(E + 2) >= 50000) { this.greet(7); await this.wait(); return; }
    this.greet(8);
    const di = this.money >= 50000 ? 50000 : this.money & 0xffff;
    const v = await b.numpad.input(0, mUmin(di, 50000 - st.u16(E + 2)));
    if (!v) { this.greet(0x0d); await this.wait(); return; }
    this.greet(v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10); await this.wait();
    st.set16(E + 2, st.u16(E + 2) + v);
    this.money = this.money - v;
    b.investSupport(v, st.u16(E));                                                 // 24f92: 與 2c6c6 相同, 但以商業值為基準
    b.investOwner();                                                               // 2c7ec
    b.p.panels();
  }

  // ================= 物價 252cf =================
  async prices() {
    const list = this.b.listSel();
    this.b.setPersons([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (;;) { const r = await list.select(0x88, 10); if (r === -1) return; this.priceTable(r); }
  }
  // 251a2 分類 c 的商品: 名稱、買價 (地區清單 / 本港特產 / 「 ----」)、賣價
  priceTable(c) {
    const st = this.st, E = this.E, { con, printf } = this.c, T = this.T;
    this.greet(0x97, T.cats[c], st.u8(E + 0x0e + c) + 50);
    this.b.table();
    const di = c ? T.catEnd[c - 1] : 0;
    for (let si = 0; T.catEnd[c] - di > si; si++) {
      if (si < 2) { con.setCursor(si * 0x17 + 0x0f, 0x90); con.puts(T.priceHdr); }
      con.setCursor((si % 2) * 0x17 + 0x0e, (Math.trunc(si / 2) + 7) * 0x18);
      const g = (di + si) & 0xff;
      printf(T.name, this.goodsName(g));
      const r = this.regionBuy(g);
      if (r) printf(T.n5b, r);
      else if (g === st.u8(E + 0x1a)) printf(T.n5, this.price(g));                  // 原版以商品碼當清單索引呼叫 2446d
      else con.puts(T.none);
      printf(T.sp5, this.sellPrice(g));
    }
  }
}
