// nameinput.js — 姓名輸入鍵盤 (MAIN.EXE 2e09 段, 線性 0x2fdbc..0x30b1c)
//   2e09:2a38 (30ac8) 主角改名: 先「名字」後「姓氏」, 各 6 字
//   30a30 提示視窗, 30735 鍵盤主迴圈, 2ff48 鍵盤畫面, 30100/301bb 點擊區域, 304e6 字表一頁, 3030d 姓名欄游標
// 狀態變數對照: cur=a160 prev=a15a  page=b5da[60]  pageStart=bb5c rangeStart=bb5e rangeEnd=bb5a
//   gapFrom=bb3c gapTo=bb3e (字碼跳躍)  filled=bb56  len=bb40  max2=bb42  buf=bb44  pos=bb54 oldPos=bb58
//   col0=bb60 y0=bb62
// 游標編號: 0..29 為 6 直行 x 5 列 (編號 = 行*5+列): 第 0,1 行是功能 (MENU #31), 第 2..5 行是筆畫 (MENU #32);
//   30..89 為字表 12 欄 x 5 列 (30 + 列*12 + 欄); 90 = «, 91 = »
const kbHex = s => Uint8Array.from(s.match(/../g).map(h => parseInt(h, 16)));
const kbCstr = s => { const b = kbHex(s), o = new Uint8Array(b.length + 1); o.set(b); return o; };

// 2fdbc: 字碼 → 字序; 無效碼回傳 0x2228 (這裡只判斷有效與否, 規則與 seg0:4554 略有不同: 0x91 首碼視為有效)
function tvalid(T) { return (T >= 0x30 && T <= 0x39) || (T >= 0x41 && T <= 0x5a) || (T >= 0x61 && T <= 0x7a) || (T >= 0x80 && T <= 0xfd); }
export function kbValid(code) {
  const L = (code >> 8) & 0xff, T = code & 0xff;
  if (L === 0x82) return T >= 0xa0 && T <= 0xf3;
  if (L >= 0x81 && L <= 0xaf) return tvalid(T);
  if (L >= 0xb0 && L <= 0xd8) return tvalid(T);
  return false;
}

export class NameInput {
  // data: assets/data/newgame.json
  constructor(ctx, data) {
    this.c = ctx; this.d = data;
    const S = data.strings; this.S = {}; for (const k in S) this.S[k] = kbCstr(S[k]);
    this.S.kbDot = kbHex(S.kbDot);
    this.labels = data.labels.map(kbCstr);
    this.K = data.keyboard;
    this.page = new Uint16Array(60);
  }
  // 30a30 提示視窗: kind 0..3 = 名字？/姓氏？/船名？/暱稱？, n 字
  prompt(kind, n) {
    const { win, con } = this.c;
    this.y0 = 0x130;
    this.col0 = 0x1d - n * 2;
    win.shadowedSaved(this.col0 - 3, 0x100, (n + 3) * 2, 0x50, 0);       // seg0:7849
    con.setCursor(this.col0, this.y0 - 0x20);
    if (kind <= 3) con.puts(this.labels[kind]);
    for (let i = 0; i < n; i++) { con.setCursor(i * 2 + this.col0, this.y0 + 2); con.puts(this.S.slot); }
  }
  // 30100 + 301bb 點擊區域
  setRects() {
    const R = this.c.menu.rects;
    for (let c = 0; c <= 1; c++) for (let r = 0; r <= 4; r++)
      R[c * 5 + r] = { x0: c * 0x28 + 0x10, x1: c * 0x28 + 0x30, y0: r * 0x18 + 0x10, y1: r * 0x18 + 0x20 };
    for (let c = 0; c <= 3; c++) for (let r = 0; r <= 4; r++)
      R[10 + c * 5 + r] = { x0: (c + 3) << 5, x1: (c + 4) << 5, y0: r * 0x18 + 0x10, y1: r * 0x18 + 0x20 };
    for (let r = 0; r <= 4; r++) for (let c = 0; c <= 11; c++)
      R[30 + r * 12 + c] = { x0: (c + 2) << 4, x1: (c + 3) << 4, y0: (r + 9) << 4, y1: (r + 10) << 4 };
    R[90] = { x0: 0x10, x1: 0x20, y0: 0x90, y1: 0xa0 };
    R[91] = { x0: 0xe0, x1: 0xf0, y0: 0xd0, y1: 0xe0 };
  }
  // 2ff48 鍵盤畫面
  drawKeyboard() {
    const { con, scr } = this.c;
    con.puts(this.S.kbColor2);
    const m31 = this.c.menuItems(31);
    for (let r = 0; r <= 2; r++) for (let c = 0; c <= 1; c++) { con.setCursor(c * 5 + 2, r * 0x18 + 0x10); con.puts(m31[c * 3 + r]); }
    scr.fillCols(2, 0x58, 4, 0x10, 7);                                   // seg0:0906
    con.setCursor(2, 0x58); con.puts(this.S.kbSpaces);
    scr.glyphMode(2, 0x58, 1, 3, this.S.kbDot, 0x406);                   // seg0:0636
    con.puts(this.S.kbColor0);
    const m32 = this.c.menuItems(32);
    for (let c = 0; c <= 3; c++) for (let r = 0; r <= 4; r++) { con.setCursor((c + 3) * 4, r * 0x18 + 0x10); con.puts(m32[c * 5 + r]); }
    scr.fillCols(2, 0x88, 0x1c, 0x60, 1);
    scr.fillRectPx(0x12, 0xe8, 0xf1, 0xe8, 0);                           // seg0:7264 → 09aa
    scr.fillRectPx(0x14, 0xe9, 0xf1, 0xe9, 0);
    scr.fillRectPx(0xf0, 0x8a, 0xf0, 0xe8, 0);
    scr.fillRectPx(0xf1, 0x8c, 0xf1, 0xe8, 0);
    con.setCursor(2, 0x90); con.puts(this.S.kbPrev);
    con.setCursor(0x1c, 0xd0); con.puts(this.S.kbNext);
  }
  // 3027e / 3028a 下一個 / 上一個字碼 (遇到 gapFrom/gapTo 跳躍)
  next(v) { return this.gapFrom === v ? this.gapTo : (v + 1) & 0xffff; }
  prevCode(v) { return this.gapTo === v ? this.gapFrom : (v - 1) & 0xffff; }
  // 30296 / 302c6 前進 / 後退 60 個有效字
  skip(v, back) {
    for (let n = 0; n < 0x3c; n++) { do v = back ? this.prevCode(v) : this.next(v); while (!kbValid(v)); }
    return v;
  }
  // 筆畫格 / 英數 的範圍 (3023c..30273)
  setStroke(cur) {
    const K = this.K, i = cur - 10;
    this.rangeStart = K.start[i]; this.gapTo = K.gapTo[i]; this.pageStart = this.rangeStart;
    this.rangeEnd = K.end[i]; this.gapFrom = K.gapFrom[i];
  }
  // 304e6 畫一頁字表 (從 start 起最多 60 個有效字)
  drawPage(start) {
    const { scr, con, sys, menu } = this.c;
    if (this.page[0] === this.rangeStart && menu.cur < 0x1e) return;
    sys.mouseHide();
    scr.fillCols(4, 0x90, 0x18, 0x50, 1);
    let drew = 0, si = start;
    for (let row = 0; row < 5; row++) {
      let di = 0;
      while (di < 12) {
        if (kbValid(si)) {
          con.drawCharAt((di + 2) * 2, (row + 9) << 4, 0x0107, si);
          this.page[row * 12 + di] = si; drew = 1;
        }
        si = this.next(si);
        if (this.gapFrom === si && this.gapTo !== this.rangeStart) si = this.gapTo;
        if (this.rangeEnd <= si) { this.filled = row * 12 + di; sys.mouseShow(); return; }
        if (drew === 1) { di++; drew = 0; }
      }
      start = si;
    }
    this.filled = 0x3b;
    sys.mouseShow();
  }
  // 3030d 姓名欄游標: 舊位置畫黑底線、新位置畫紫底線 (各自先存背景再立即還原, 只留下保存範圍外的最下 2 行)
  async drawCursor() {
    const { con, win } = this.c;
    con.puts(this.S.nameBg7);
    const max = Math.trunc((this.max2 - 1) / 2);
    if (max <= this.pos) return 0;
    if (this.oldPos === this.pos) return 0;
    win.save(this.oldPos * 2 + this.col0, this.y0, 2, 0x10);
    con.setCursor(this.oldPos * 2 + this.col0, this.y0 + 2); con.puts(this.S.markOld);
    await win.close();             // seg0:796d (高度 16, 不播動畫)
    win.save(this.pos * 2 + this.col0, this.y0, 2, 0x10);
    con.setCursor(this.pos * 2 + this.col0, this.y0 + 2); con.puts(this.S.markNew);
    await win.close();
    return 1;
  }
  // 303ae 在游標處放一個字並前進
  async insert(code) {
    this.c.con.drawCharAt(this.pos * 2 + this.col0, this.y0, 0x0700, code);
    this.buf[this.pos * 2] = code >> 8; this.buf[this.pos * 2 + 1] = code & 0xff;
    this.oldPos = this.pos;
    const max = Math.trunc((this.max2 - 1) / 2);
    if (max - 1 > this.pos) this.pos++;
    if (this.pos === this.oldPos && max - this.pos - 1 === 0) this.len = max;
    else if (this.pos > this.len) this.len++;
    await this.drawCursor();
    await this.c.menu.waitRelease();                                   // 0fea:3343
  }
  async prevPage() {                                                     // 305d3
    const v = this.skip(this.pageStart, true);
    if (!(this.rangeStart > v)) { this.pageStart = v; this.drawPage(v); await this.c.menu.waitRelease(); }
  }
  async nextPage() {                                                     // 305f1
    const v = this.skip(this.pageStart, false);
    if (this.rangeEnd > v) { this.pageStart = v; this.drawPage(v); await this.c.menu.waitRelease(); }
  }
  // 3060f 確定鍵: 回傳 1 = 決定, 2 = 結束, 0 = 繼續
  async enter() {
    const menu = this.c.menu, cur = menu.cur;
    if (cur < 10) {
      switch (cur) {
        case 0: return 2;                                                // 結束
        case 1:                                                          // 英數 (gapFrom/gapTo 保持原值)
          this.rangeStart = this.pageStart = this.K.eisu[0]; this.rangeEnd = this.K.eisu[1];
          this.drawPage(this.rangeStart); break;
        case 2: return 1;                                                // 決定
        case 5: if (this.pos > 0) { this.oldPos = this.pos; this.pos--; await this.drawCursor(); } break;   // 左移
        case 6: {                                                        // 右移
          const max = Math.trunc((this.max2 - 1) / 2);
          if (this.len > this.pos && max - 1 > this.pos) { this.oldPos = this.pos; this.pos++; await this.drawCursor(); }
          break; }
        case 7: await this.insert(0x8130); break;                              // 空格
      }
      await menu.waitRelease();
      return 0;
    }
    if (cur < 0x1e) { this.setStroke(cur); this.drawPage(this.rangeStart); }
    else if (cur < 0x5a) { if (this.filled + 0x1e >= cur) await this.insert(this.page[cur - 0x1e]); }
    else if (cur === 0x5a) await this.prevPage();
    else await this.nextPage();
    return 0;
  }
  // 方向鍵 (307de..309dc)
  move(k) {
    const m = this.c.menu; let c = m.cur;
    switch (k) {
      case 0x1b: case 0x30: c = c < 0x1e ? 0x1e : 0x0a; break;
      case 0x1c: case 0x36:
        if (c === 0x59) c = 0x5b; else if (c === 0x5a) c = 0x1e; else if (c === 0x5b) c = 0x5a;
        else if (c >= 0x1e) c = (c - 0x1e) % 12 === 11 ? c - 11 : c + 1;
        else c = c > 0x18 ? c - 0x19 : c + 5;
        break;
      case 0x1d: case 0x34:
        if (c === 0x1e) c = 0x5a; else if (c === 0x5a) c = 0x5b; else if (c === 0x5b) c = 0x59;
        else if (c >= 0x1e) c = (c - 0x1e) % 12 === 0 ? c + 11 : c - 1;
        else c = c >= 5 ? c - 5 : c + 0x19;
        break;
      case 0x1e: case 0x38:
        if (c > 0x59) break;
        if (c >= 0x1e) c = c >= 0x2a ? c - 12 : c + 0x30;
        else c = c % 5 === 0 ? c + 4 : c - 1;
        break;
      case 0x1f: case 0x32:
        if (c > 0x59) break;
        if (c >= 0x1e) c = c > 0x4d ? c - 0x30 : c + 12;
        else c = c % 5 === 4 ? c - 4 : c + 1;
        break;
      default: return false;
    }
    m.cur = c; return true;
  }
  // 30735 鍵盤主迴圈: 輸入結果寫回 dest (GameState 位址); 回傳 1 = 已輸入, 2 = 結束 (取消), 3 = 未輸入任何字
  async run(dest, max) {
    const { win, menu, sys, state } = this.c;
    menu.count = 0x75;
    this.setRects();
    win.shadowedSaved(0, 0, 0x20, 0xf8, 1);
    this.drawKeyboard();
    this.max2 = max * 2 + 1;
    this.buf = new Uint8Array(0x20); this.buf.set(this.S.blank);
    menu.cur = menu.prev = 0x0a;
    this.page[0] = 0xffff;
    this.setStroke(0x0a);
    this.drawPage(this.rangeStart);
    menu.highlight(0);
    this.pos = 0; this.oldPos = 1;
    await this.drawCursor();
    this.len = 0;
    sys.mouseShow();
    for (;;) {
      const k = await menu.getKeyFree();
      menu.prev = menu.cur;
      if (k === 0x0d) {
        const r = await this.enter();
        if (r === 1) {                                                   // 309f0 決定
          while (this.byteAt(this.len * 2 - 2) === 0x81 && this.byteAt(this.len * 2 - 1) === 0x30) this.len--;   // 30709 去掉結尾全形空白
          this.buf[this.len * 2] = 0;
          if (this.len) {
            this.buf[this.len * 2] = 0;
            const n = this.buf.indexOf(0);
            for (let i = 0; i <= n; i++) state.set8(dest + i, this.buf[i]);
            sys.mouseHide(); await win.close(); return 1;
          }
          sys.mouseHide(); await win.close(); return 3;
        }
        if (r === 2) { sys.mouseHide(); await win.close(); return 2; }
      } else if (k === 0x31) { menu.highlight(0); await this.prevPage(); menu.highlight(0); }
      else if (k === 0x33) { menu.highlight(0); await this.nextPage(); menu.highlight(0); }
      else this.move(k);
      if (menu.cur !== menu.prev) menu.moveHighlight();
    }
  }
  // 30709 的位元組讀取 (索引 -2/-1 時讀到 DS:bb42 的 max2 低/高位元組)
  byteAt(i) { return i >= 0 ? this.buf[i] : i === -2 ? this.max2 & 0xff : (this.max2 >> 8) & 0xff; }
  // 2e09:2a38 (30ac8) 主角改名: 回傳 0 = 中途結束, 1 = 完成
  async renameHero(personDS, n = 6) {
    const { win } = this.c;
    this.prompt(0, n);
    if (await this.run(personDS, n) === 2) { await win.close(); return 0; }
    await win.close();
    this.prompt(1, n);
    if (await this.run(personDS + 13, n) === 2) { await win.close(); return 0; }
    await win.close();
    return 1;
  }
}
