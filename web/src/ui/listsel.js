// listsel.js — 清单选择组件 (MAIN.EXE 0fea:5bd0 = 线性 15a70 及其子函数 14d36 / 14de7 / 14e9b / 153aa / 153f3 / 155f4 / 158c4 / 15946)
// 调用: select(al, count) — al 低 6 位 = 种类 k, bit7 = 结束后关闭清单窗口本身 (796d), bit6 = 返回 persons[i] 而非索引 i
//       项目值放在 ctx.persons ([0538] 字数组)。Esc / 点在清单外 = -1。
//       (笔记里的「种类 0x85 / 0x8c / 0x89」= 种类 5 / 12 / 9 加 bit7)
// 参数表 DS:10a8 + 10×k = {col, y, 宽, 可见列数, 滚动起点} 位于游戏状态内 (随存盘保存); 拖拽标题列会改写 col / y。
// 列格式化函数 DS:a1d8[k] (far 指针, AX = 项目值, 返回已输出字数)。
// 沿用菜单引擎的状态: cur=a160 prev=a15a count=a158 mouseFlag=a14e hit=a150 bracket=a162 rects=bdcc

import { captureConsoleText, decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";
import { hasDom, runDomList } from "../modern/dom_ui.ts";
import { UI_STR } from "../modern/ui_strings.ts";

const lsUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c (无号)
const lsDiv = (a, b) => Math.trunc(a / b);                                          // idiv
const lsS16 = v => (v << 16) >> 16;
const lsHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const lsStrlen = s => { let n = 0; while (n < s.length && s[n]) n++; return n; };
const FMT_TITLE = lsHex("1b43301b42372573");     // DS:a22c
const B_ESCB7 = lsHex("1b4237");                  // DS:a235
const SPACE = lsHex("20");                        // DS:a1bb
const FMT_SHIPROW = lsHex("2534642f253464");      // DS:a1bd "%4d/%4d"
const FMT_PERSONROW = lsHex("257381352573");    // DS:a1a6 "%s　%s"
const FMT_SHIPROW0 = lsHex("2573a3bf");          // DS:a17e "%s号"
const CREW_CAPTAIN = lsHex("1b4336");             // DS:a1ad
const CREW_NORMAL = lsHex("1b4330");              // DS:a1b1 / a1b7
const MARK_EQUIP = lsHex("2a");                   // DS:a1cf "*" 已装备
const MARK_NONE = lsHex("20");                    // DS:a1d1 " "

export class ListSelect {
  constructor(ctx) { this.c = ctx; this.k = 0; this.total = 0; this.titles = null; }
  get st() { return this.c.state; }
  get m() { return this.c.menu; }
  // ---- 参数表 DS:10a8 ----
  pa(i) { return 0x10a8 + this.k * 10 + i * 2; }
  get col() { return lsS16(this.st.u16(this.pa(0))); } set col(v) { this.st.set16(this.pa(0), v); }
  get y() { return lsS16(this.st.u16(this.pa(1))); } set y(v) { this.st.set16(this.pa(1), v); }
  get w() { return lsS16(this.st.u16(this.pa(2))); }
  get vis() { return lsS16(this.st.u16(this.pa(3))); }
  get start() { return lsS16(this.st.u16(this.pa(4))); } set start(v) { this.st.set16(this.pa(4), v); }

  // 0fea:5bd0
  async select(al, count) {
    if (this.c.scr.wideRenderer && this.c.codec) {
      return this.wideSelect(al, count);
    }
    const { sys, win } = this.c, m = this.m;
    this.total = count; m.cur = 0;                                     // [bcd2], [a160]
    this.k = al & 0x3f;
    // 种类 0x12 原版先打开 COLONY.DAT (2e09:66d1), 结束后关闭; 移植版改读 assets/text/colony.json
    sys.mouseHide(); this.drawFrame(); sys.mouseShow();
    const x0 = (this.col + 1) << 3;
    let y = this.y + 0x20;
    m.count = lsUmin(this.vis, count);                                   // [a158]
    if (this.start + m.count > count) this.start = count - m.count;
    for (let i = 0; i < m.count; i++) { m.rects[i] = { x0, x1: x0 + (this.w << 3), y0: y, y1: y + 0x10 }; y += 0x10; }
    let r = await this.loop();
    if (al & 0x80) { sys.mouseHide(); await win.close(); sys.mouseShow(); }
    if ((al & 0x40) && r !== -1) r = this.c.persons[r];
    return r;
  }
  captureRowText(val) {
    return captureConsoleText(this.c, () => this.format(val));
  }
  async wideSelect(al, count) {
    const { sys, scr, codec } = this.c, m = this.m;
    this.total = count;
    this.k = al & 0x3f;
    const titleBytes = (this.titles ??= this.c.menuItems(0x2f))[this.k] ?? Uint8Array.of(0);
    const title = UI_STR.listTitles[this.k] ?? toSimp(decodeCleanCstr(codec, titleBytes));
    const rows = [];
    for (let i = 0; i < count; i++) rows.push(this.captureRowText(this.c.persons[i]));
    if (hasDom()) {
      await m.waitRelease();
      const sel = await runDomList(title, rows);
      await m.waitRelease();
      return (al & 0x40) && sel !== -1 ? this.c.persons[sel] : sel;
    }
    return -1;
  }
  // 14e9b 外框、滚动条槽、标题
  drawFrame() {
    const { win, scr, con, gfx } = this.c;
    const X = this.col, Y = this.y, H = (this.vis << 4) + 0x28;
    let W2 = this.w + 4;
    win.save(X, Y, W2, H);
    con.left = X + 1; con.right = W2 + X;                              // [8a20] = col+1, [8a22] = 宽+4+col
    W2 -= 2;
    this.track = H - 0x3a;                                             // [bda4]
    this.thumb = this.vis >= this.total ? this.track : (lsDiv(this.vis * this.track, this.total) || 1);   // [bd86]
    this.range = Math.max(0, this.total - this.vis);                   // [bd98]
    this.sbx = (W2 + X) << 3;                                          // [bd8e]
    this.sby = Y + 0x29;                                               // [bd90]
    scr.fillCols(X, Y, W2 + 2, H, 7);
    const L = con.left, put = (cx, cy, off) => win.put(cx, cy, off);
    put(X, Y, 0x39a0);
    for (let i = 0; i < W2; i++) put(L + i, Y, 0x39c0);
    put(W2 + X + 1, Y, 0x39e0);
    for (let si = 0; si < H - 0x10; si += 8) put(X, Y + si + 8, 0x3a00);
    put(W2 + X + 1, Y + 8, 0x3a20);
    put(X, Y + 0x10, 0x3a40);
    for (let i = 0; i < W2; i++) put(L + i, Y + 0x10, 0x3a60);
    put(W2 + X + 1, Y + 0x10, 0x3a80);
    put(X, Y + 0x18, 0x3aa0);
    for (let i = 0; i < W2 - 2; i++) put(L + i, Y + 0x18, 0x3ac0);
    put(W2 + X - 1, Y + 0x18, 0x3ae0);
    for (let si = 0; si < H - 0x28; si += 8) put(W2 + X - 1, Y + si + 0x20, 0x3b00);
    put(X, H + Y - 8, 0x3b20);
    for (let i = 0; i < W2 - 2; i++) put(L + i, H + Y - 8, 0x3a60);
    put(W2 + X - 1, H + Y - 8, 0x3b40);
    for (let t = 0; t < H - 0x38; t += 8) { put(W2 + X, Y + t + 0x28, 0x3b60); put(W2 + X + 1, Y + t + 0x28, 0x3b80); }
    scr.putPlanar(W2 + X, Y + 0x18, 2, 16, gfx, 0x3ba0);
    scr.putPlanar(W2 + X, H + Y - 0x10, 2, 16, gfx, 0x3c20);
    const title = (this.titles ??= this.c.menuItems(0x2f))[this.k];    // MENU.DAT 第 0x2f 条 (2e09:5700)
    con.setCursor((((W2 - lsStrlen(title) + 2) & 0xffff) >>> 1) + X, Y + 4);
    this.c.printf(FMT_TITLE, title);
  }
  // 14d36 滚动条滑块 (1fd9:2261 = 只写平面 0..2 的像素矩形)
  scrollbar() {
    const { sys, scr } = this.c, x0 = this.sbx + 5, x1 = this.sbx + 0x0a, T = this.sby;
    sys.mouseHide();
    this.pos = this.range > 0 ? lsDiv(this.start * (this.track - this.thumb), this.range) : 0;     // [bd9e]
    if (this.pos) scr.fillRectPxPlanes(x0, T, x1, T + this.pos - 1, 0, 3);
    scr.fillRectPxPlanes(x0, T + this.pos, x1, T + this.pos + this.thumb - 1, 7, 3);
    if (this.pos + this.thumb < this.track) scr.fillRectPxPlanes(x0, T + this.pos + this.thumb, x1, T + this.track - 1, 0, 3);
    sys.mouseShow();
  }
  // 14de7 各列
  rows() {
    const { sys, con } = this.c, m = this.m;
    m.highlight(m.bracket);
    sys.mouseHide();
    let y = this.y + 0x20, n = this.vis, i = this.start;
    while (n-- !== 0) {
      if (this.total <= i) break;
      con.setCursor(this.col + 1, y);
      let pad = this.w - this.format(this.c.persons[i]);
      while (pad-- > 0) con.putc(0x20);
      y += 0x10; i++;
    }
    sys.mouseShow();
    m.highlight(0);
  }
  // DS:a1d8[k]
  format(v) {
    switch (this.k) {
      case 0: return this.fmtShipName(v);
      case 1: return this.fmtGoodsTotal(v);
      case 6: return this.fmtPerson(v);
      case 3: case 12: return this.fmtPerson(v);         // 1497e (DS:a190 与 a1a6 同为「%s•%s」; 战斗对象 / 交涉对象 = 舰队指挥者)
      case 2: { const s = this.st.cstr(ListSelect.shipRec(this.st.u8(ListSelect.fleetSlot(this.st, v) + 7))); this.c.con.puts(s); return lsStrlen(s); }   // 14954 船名
      case 5: { const s = this.st.cstr(0x5f54 + (((v & 0xff) * 0x16) & 0xffff) + 4); this.c.con.puts(s); return lsStrlen(s); }   // 14a3a 港口名 (seg0:5c9a(al) + 4; 委任目的地)
      case 4: return this.fmtCapacity(v);
      case 7: return this.fmtShip(v);
      case 9: return this.fmtCrew(v);
      case 8: { const s = (this.cats ??= this.c.portAssets.data.market.cats.map(lsHex))[v & 0xffff]; this.c.con.puts(s); return lsStrlen(s); }   // 14c4b DS:078e 分类
      case 10: return this.fmtRepair(v);
      case 11: return this.fmtWater(v);
      case 13: return this.fmtItem(v);
      case 14: { const s = this.st.cstr(ListSelect.shipRec(v)); this.c.con.puts(s); return lsStrlen(s); }   // 14930 船记录名 (造船清单: 样板船 0x28+船型)
      case 15: return this.fmtTable("materials", v);    // 14c96 DS:0930[v] 材质
      case 16: return this.fmtTable("figureheads", v);  // 14cb3 DS:093c[v] 船首像
      case 17: return this.fmtTable("cannons", v);      // 14cd0 DS:07cc[v] 砲
      case 18: return this.fmtDisc(v);
      case 20: this.c.message(0x1d1 + (v & 0xffff)); return 10;   // 14d28 地区名 (MESSAGE 0x1d1 + v; 返回固定 10, 王宫 势力状况)
      default: console.warn("尚未移植: 清單列格式 " + this.k); return 0;
    }
  }
  // 种类 15..17: 指针表字符串 (port.json build.*, tools/extract_port.py)
  fmtTable(name, v) {
    const T = (this.tables ??= {})[name] ??= this.c.portAssets.data.build[name].map(lsHex);
    const s = T[v & 0xffff];
    if (!s) { console.warn("清單列格式: " + name + "[" + v + "] 超出已提取的指標表"); return 0; }
    this.c.con.puts(s);
    return lsStrlen(s);
  }
  // 14a87 种类 9: 船员「名 (补空白到 15) 船名或职务」; 担任舰队船长的以颜色 6 显示 (DS:a1ad / a1b1 / a1b5 / a1b7)
  fmtCrew(n) {
    const st = this.st, con = this.c.con, P = st.personRecord(n & 0xff);
    let slot = 0xff;
    for (let i = 0; i < 10; i++) if (st.u8(0x52d4 + i * 0x1e + 0x1b) === (n & 0xff)) slot = i;
    con.puts(slot !== 0xff ? CREW_CAPTAIN : CREW_NORMAL);
    const name = st.cstr(P); con.puts(name);
    let si = lsStrlen(name);
    for (; si < 0x0f; si++) con.puts(SPACE);
    const s = slot !== 0xff ? st.cstr(ListSelect.shipRec(st.u8(ListSelect.fleetSlot(st, slot) + 7)))
      : (this.roles ??= this.c.portAssets.data.tavern.crewRoles.map(lsHex))[st.u8(P + 0x2e)];
    con.puts(s); si += lsStrlen(s);
    con.puts(CREW_NORMAL);
    return si;
  }
  // 149f4 种类 4: 「船名 尚可装载量」 (DS:a19d "%15s %5d"; 已用载货 seg0:5d36)
  fmtCapacity(slot) {
    const st = this.st, S = ListSelect.fleetSlot(st, slot), ship = ListSelect.shipRec(st.u8(S + 7));
    this.c.printf(this.capFmt ??= lsHex(this.c.portAssets.data.market.fmt.listCap), st.cstr(ship), lsS16(st.u16(ship + 0x14) - this.c.cargoUsed(slot)));
    return 0x15;
  }
  // 148c1 种类 0x0a: 船名 (上陆 修理 3453b; 耐久 < 最大、转向 < 船型 +2 或推进 < 船型 +3 时以 DS:a183 颜色 2), DS:a187「%s？」, DS:a18c 颜色 0; 返回 名称长 + 2
  fmtRepair(slot) {
    const st = this.st, S = ListSelect.fleetSlot(st, slot), ship = ListSelect.shipRec(st.u8(S + 7)), T = 0x5e28 + st.u8(ship + 0x0f) * 0x0c;
    const s = (this.seaStr ??= Object.fromEntries(Object.entries(this.c.portAssets.sea.str).map(([k, h]) => [k, lsHex(h)])));
    if (st.u8(S + 2) < st.u8(S + 3) || st.u8(T + 2) > st.u8(S + 4) || st.u8(T + 3) > st.u8(S + 5)) this.c.con.puts(s.lsMark);
    this.c.printf(s.lsShip, st.cstr(ship));
    this.c.con.puts(s.lsColor0);
    return lsStrlen(st.cstr(ship)) + 2;
  }
  // 14bc1 种类 0x0b: 船名 (舰队船位 [c2d4] + 2b + 9×n, 不经 5c58) 以 DS:a1c5 补到 0x11 字, DS:a1c7「%4d/%4d」= 水 / 10、水 / 10 + 尚可装载量; 返回 0x1a (上陆 补水 345b2)
  fmtWater(slot) {
    const st = this.st, con = this.c.con, M = 0x52d4 + (slot & 0xff) * 0x1e;
    const S = (0x2e76 + st.u8(st.personRecord(st.hero) + 0x2c) * 0x85 + 0x2b + Math.imul(9, lsS16(slot))) & 0xffff, ship = ListSelect.shipRec(st.u8(S + 7));
    const s = (this.seaStr ??= Object.fromEntries(Object.entries(this.c.portAssets.sea.str).map(([k, h]) => [k, lsHex(h)])));
    con.puts(st.cstr(ship));
    for (let n = lsStrlen(st.cstr(ship)); n < 0x11; n++) con.puts(s.lsPad);
    const free = lsS16(-(this.c.cargoUsed(slot) - st.u16(ship + 0x14))), w = lsDiv(lsS16(st.u16(M)), 10);
    this.c.printf(s.lsWater, w, lsS16(w + free));
    return 0x1a;
  }
  // 14c68 种类 0x0d: 随身物 (DS:8248 + 0x14×n), 已装备 (+13 bit4) 前面加「*」
  fmtItem(n) {
    const st = this.st, R = 0x8248 + (n & 0xff) * 0x14, name = st.cstr(R);
    this.c.con.puts(st.u8(R + 0x13) & 0x10 ? MARK_EQUIP : MARK_NONE); this.c.con.puts(name);
    return lsStrlen(name) + 1;
  }
  // 14ced 种类 0x12: 发现物名 (COLONY.DAT 第 n 笔, 2e09:66f3)
  fmtDisc(n) { const r = ListSelect.colonyRec(this.c, n & 0xffff); this.c.con.puts(r); return lsStrlen(r); }
  // COLONY.DAT 第 n 笔 (0xb1 bytes: +00 名称, +0f 图号, +10 说明), 由 colony.json 编码回原版字节
  static colonyRec(c, n) { return ((c._colony ??= [])[n] ??= c.font.encode(c.portAssets.colony[n])); }
  // 149b0 种类 1: 商品名 (DS:0728, 以 DS:a197 空白补到 11 字) + 「%6d」(DS:a199) 总数 [0538 + 0x32×2 + 商品×2] (积载一览表 1cf02)
  fmtGoodsTotal(g) {
    const name = (this.goods ??= this.c.portAssets.data.goods.map(lsHex))[g & 0xffff], con = this.c.con;
    con.puts(name);
    for (let n = lsStrlen(name); n < 0x0b; n++) con.puts(SPACE);
    this.c.printf(lsHex("253664"), this.c.persons[0x32 + (g & 0xffff)]);
    return 0x11;
  }
  // 14890 种类 0: 「船名号」
  fmtShipName(slot) {
    const st = this.st, ship = ListSelect.shipRec(st.u8(ListSelect.fleetSlot(st, slot) + 7));
    this.c.printf(FMT_SHIPROW0, st.cstr(ship));
    return lsStrlen(st.cstr(ship)) + 2;
  }
  // 14a55 种类 6: 人物 「名　姓」
  fmtPerson(n) {
    const st = this.st, P = st.personRecord(n & 0xff);
    this.c.printf(FMT_PERSONROW, st.cstr(P), st.cstr(P + 0x0d));
    return lsStrlen(st.cstr(P + 0x0d)) + lsStrlen(st.cstr(P)) + 2;
  }
  // 14b5c 种类 7: 舰队船只 「船名 (补空白到 17) 水手/最多水手」
  fmtShip(slot) {
    const st = this.st, { con, printf } = this.c;
    const S = ListSelect.fleetSlot(st, slot), ship = 0x5892 + st.u8(S + 7) * 0x16;
    const name = st.cstr(ship);
    con.puts(name);
    for (let n = lsStrlen(name); n < 0x11; n++) con.puts(SPACE);
    printf(FMT_SHIPROW, lsS16(st.u16(S)), lsS16(st.u16(ship + 0x12)));
    return 0x1a;
  }
  // seg0:5c58: 0..9 = 主角舰队 ([c2d4] = 0x2e76 + 舰队编号×0x85) 第 slot 艘船, 10..39 = 各港船坞 (DS:572a + 9×slot) (+0 水手数, +7 船编号, +8 bit4-5 = 1 有船)
  static fleetSlot(st, slot) { return slot < 10 ? 0x2e76 + st.u8(st.personRecord(st.hero) + 0x2c) * 0x85 + 0x2b + slot * 9 : 0x572a + slot * 9; }   // 10..39 = 船坞
  static shipRec(n) { return 0x5892 + n * 0x16; }                                    // seg0:5c7a
  // 153aa XOR 外框 (拖拽时)
  xorBox(col, y) {
    const { sys, scr } = this.c;
    sys.mouseHide();
    scr.xorRect(col << 3, y, ((col + this.w) << 3) + 0x1f, (this.vis << 4) + y + 0x27, 0x0f);
    sys.mouseShow();
  }
  // 153f3 拖拽标题列移动整个清单
  async titleDrag(k) {
    const { sys, win } = this.c, m = this.m;
    if (!m.mouseFlag || k !== 0x0d) return k;
    let { x, y } = sys.mousePos();
    if (!(((this.col + 2) << 3) <= x && this.sbx + 0x10 > x && this.y <= y && this.y + 0x10 > y)) return k;
    let si = this.col, di = this.y;
    const dx = si - lsDiv(x, 8), dy = this.y - y;
    m.highlight(m.bracket);
    this.xorBox(si, di);
    while (m.readEvent() === 0x0d) {
      ({ x, y } = sys.mousePos());
      x = lsDiv(x, 8) + dx; y += dy;
      if (x < 0) x = 0; else if (this.w + x + 4 > 0x50) x = 0x4c - this.w;
      if (y < 0) y = 0; else if ((this.vis << 4) + y + 0x28 > 0x190) y = 0x168 - (this.vis << 4);
      if (x !== si || y !== di) { this.xorBox(si, di); di = y; si = x; this.xorBox(si, di); }
      await sys.poll();
    }
    this.xorBox(si, di);
    const ddx = si - this.col, ddy = di - this.y;
    if (ddx || ddy) {
      this.col += ddx; this.y += ddy;
      sys.mouseHide(); await win.close(); this.drawFrame(); sys.mouseShow();
      for (let i = 0; i < m.count; i++) { const r = m.rects[i]; r.x0 += ddx << 3; r.x1 += ddx << 3; r.y0 += ddy; r.y1 += ddy; }
    }
    m.highlight(0);
    this.scrollbar();
    this.rows();
    return 0;
  }
  // 155f4 滚动条 / 滚动键
  async scroll(k) {
    const { sys } = this.c, m = this.m;
    if (m.mouseFlag && k === 0x0d) {
      let { x, y } = sys.mousePos();
      if (this.col << 3 > x || this.sbx + 0x10 <= x) return 0x1b;
      if (this.y > y || (this.vis << 4) + this.y + 0x28 <= y) return 0x1b;
      const inCol = this.sbx <= x && this.sbx + 0x10 > x;
      const inSlot = this.sbx + 5 <= x && this.sbx + 0x0b > x;
      const T = this.sby;
      if (this.range >= 1 && inSlot && T + this.pos <= y && T + this.pos + this.thumb > y) {
        const off = T - y + this.pos;
        while (m.readEvent() === 0x0d) {
          ({ x, y } = sys.mousePos());
          y += off;
          if (y < T) y = T;
          if (T - this.thumb + this.track < y) y = T - this.thumb + this.track;
          const ns = lsDiv((y - T) * this.range, this.track - this.thumb);
          if (ns !== this.start) { this.pos = y - T; this.start = ns; this.scrollbar(); this.rows(); }
          await sys.poll();
        }
        return 0;
      }
      if (inCol) {
        if (this.y + 0x18 <= y && T - 1 > y) k = 0x38;
        else if (T + this.track + 1 <= y) k = 0x32;
      }
      if (inSlot) {
        if (T <= y && T + this.pos > y) k = 0x34;
        else if (T + this.pos + this.thumb <= y && T + this.track > y) k = 0x36;
      }
      if (k === 0x0d) return 0x0d;
    }
    let d;
    switch (k) {
      case 0x38: case 0x1e: d = -1; break;
      case 0x32: case 0x1f: d = 1; break;
      case 0x34: case 0x1d: d = -this.vis; break;
      case 0x36: case 0x1c: d = this.vis; break;
      default: d = 0;
    }
    let ns = this.start + d;
    if (ns < 0) ns = 0; else if (ns > this.range) ns = this.range;
    if (this.start !== ns) { this.start = ns; this.scrollbar(); this.rows(); }
    if (k !== 0x0d && k !== 0x1b) k = 0;
    return k;
  }
  // 158c4 取得按键
  async getKey() {
    const { sys } = this.c, m = this.m;
    m.lastX = m.lastY = -1;
    for (;;) {
      sys.rng.random(100);
      let k = m.readEvent();
      if (m.mouseFlag) { k = await this.titleDrag(k & 0xff); k = await this.scroll(k & 0xff); }
      if (m.mouseFlag && k === 0x0d) {
        do {
          m.prev = m.cur;
          m.hitTest();
          if (m.cur !== m.prev) m.moveHighlight();
          if (!sys.mouseAny()) break;
          await sys.poll();
        } while (true);
      }
      if (k && !(m.mouseFlag && !m.hit && k === 0x0d)) return k;
      await sys.poll();
    }
  }
  // 15946 选择循环
  async loop() {
    const { sys, con } = this.c, m = this.m;
    this.scrollbar();
    con.bg = 7;                                                        // [8a28] = 7
    m.highlight(0);
    this.rows();
    sys.mouseShow();
    let k;
    for (;;) {
      k = await this.getKey();
      let di = 0;
      m.prev = m.cur;
      switch (k) {
        case 0x36: case 0x1c: if (this.start !== this.range) di = 1; else k = 0x32; break;
        case 0x1d: case 0x34: if (this.start !== 0) di = 1; else k = 0x38; break;
        case 0x30: k = 0x1b; break;
      }
      switch (k) {
        case 0x38: case 0x1e: if (m.cur === 0) di = 1; else m.cur--; break;
        case 0x1f: case 0x32: if (m.count - m.cur - 1 === 0) di = 1; else m.cur++; break;
      }
      if (m.cur !== m.prev) m.moveHighlight();
      if (di && !m.mouseFlag) { k = await this.titleDrag(k); k = await this.scroll(k); }
      sys.flush();
      if (k === 0x1b) break;
      if (k === 0x0d && (m.hit || !m.mouseFlag)) break;
    }
    m.highlight(m.bracket);
    sys.mouseHide();
    if (k === 0x1b) return -1;
    con.puts(B_ESCB7);
    return this.start + m.cur;
  }
}
