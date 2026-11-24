// menu.js — 原版選單系統 (MAIN.EXE 0FEA 段, 線性 0x131b2..0x1488f)
// 狀態變數與原版 DS 位址對照 (方便逐行比對):
//   disabled=a14c  mouseFlag=a14e  hit=a150  cancelable=a152  a154  level=a156
//   count=a158  prev=a15a  lineH=a15e  cur=a160  bracket=a162  table=a17c
//   levels[1]=a164.., levels[2]=a170.. {x,y,xmax,ymax}     rects=bdcc (每項 {x0,x1,y0,y1})
//   lastMouse=bd9a/bd9c
// 遊戲內按鍵碼: 0D 確定, 1B / 30('0') 取消, 1C → 1D ← 1E ↑ 1F ↓, 32/34/36/38 = 數字鍵 2/4/6/8
import { createWideMenuState, drawWideMenu, hitWideMenuItem, hitWideMenuBox } from "../canvas_ui/wide_menu.ts";
import { createWideYesNoState, drawWideYesNo, hitWideYesNo } from "../canvas_ui/wide_yesno.ts";
import { decodeCleanCstr } from "../canvas_ui/text_util.ts";
import { hasDom, runDomMenu, runDomYesNo } from "../modern/dom_ui.ts";

const HL_SOLID = 0x0000;      // 外框圖形 [0c86] 偏移 0: 640 bytes 全 FF, 用作高亮反白位圖
const GREY_PATTERN = 0x0280;  // AA 55 交錯點陣, 用於不可選項目
const WAIT_ICON = 0x20b0;     // 等待按鍵的閃爍游標 (2 欄 x 16 行)
const btImodM = (a, b) => a - Math.trunc(a / b) * b;               // 有號餘數 (idiv)
export const CURSOR_MENU = 0x2570, CURSOR_CROSS = 0x2840;

function strlen(s) { let n = 0; while (n < s.length && s[n]) n++; return n; }
const umin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b : a);       // seg0:4d7c (無號)
const tdiv8 = v => (v < 0 ? -((-v) >> 3) : v >> 3);                  // cwd/xor/sar 3: 向零取整

export class MenuSystem {
  constructor({ sys, scr, con, win, gfx, graph, codec = null }) {
    Object.assign(this, { sys, scr, con, win, gfx, graph, codec });
    this.wideAnchorCmd = -1;
    this.disabled = 0; this.mouseFlag = 0; this.hit = 0; this.cancelable = 0; this.a154 = 0; this.level = 0;
    this.count = 0; this.prev = 0; this.lineH = 0; this.cur = 0; this.bracket = 0; this.table = [];
    this.levels = [null, { x: 0x208, y: 0xd8, xmax: 0x210, ymax: 0x190 }, { x: 0x1e0, y: 0x150, xmax: 0x1f0, ymax: 0x158 }];
    this.rects = Array.from({ length: 120 }, () => ({ x0: 0, x1: 0, y0: 0, y1: 0 }));   // DS:bdcc (姓名鍵盤用到 117 項)
    this.lastX = -1; this.lastY = -1;
    this.flag8a25 = 0;
  }
  // ---------------- 輸入 ----------------
  source() { const s = this.sys; return s.mouseAny() ? 1 : s.kbhit() ? 2 : 0; }                 // 131b2
  async waitRelease() { while (this.source()) { this.sys.flush(); await this.sys.poll(); } }    // 131e3
  async waitPress() { while (!this.source()) { this.sys.flush(); await this.sys.poll(); } }     // 131cd
  readEvent() {                                                                               // 1320c
    const s = this.source();
    if (s === 1) { this.mouseFlag = 1; const e = this.sys.mouseEvent(); return e === 0x81 ? 0x0d : e === 0x82 ? 0x1b : 0; }
    if (s === 2) { this.mouseFlag = 0; return this.sys.getKey(); }
    return 0;
  }
  // 13253: 等待確定或取消 (1=確定)
  async waitConfirm() {
    await this.waitRelease();
    for (;;) { const k = this.readEvent(); if (k === 0x1b || k === 0x30) return 0; if (k === 0x0d) return 1; await this.sys.poll(); }
  }
  // ---------------- 項目 ----------------
  maxWidth(table) { let m = 0; for (let i = 0; i < this.count; i++) { const n = strlen(table[i]); if (n > m) m = n; } return m; }  // 13847
  // 1387a 繪製項目並建立點擊區域
  drawItems(x, y, w, table) {
    this.sys.setCursorShape(CURSOR_MENU);
    const R = this.rects, c = this.con, lh = this.lineH;
    R[this.count] = { x0: x << 3, x1: (x << 3) + ((w + 4) << 3), y0: y, y1: this.count * lh + y + 0x20 };
    const di = y + 16;
    for (let i = 0; i < this.count; i++) {
      const s = table[i], cx = ((w - strlen(s)) & 0xffff) >>> 1;
      c.setCursor(cx + c.left, lh * i + di);
      c.puts(s);
      if (this.disabled & (1 << i)) this.greyOut(c.left, lh * i + di, w, 7);
      const x0 = (x + 1) << 3;
      R[i] = { x0, x1: x0 + ((w + 2) << 3), y0: lh * i + di, y1: lh * i + di + 0x10 };
    }
  }
  // 6a67 以 AA55 點陣覆蓋 n 欄 (透明模式); HD 模式下繪製柔和半透明遮罩呈現停用項
  greyOut(col, y, n, color) {
    if (this.scr.hdCtx) {
      const S = 2, ctx = this.scr.hdCtx;
      this.scr.bakeFbToHd(col * 8, y, n * 8, 16);
      ctx.fillStyle = "rgba(235, 224, 198, 0.62)";
      ctx.fillRect(col * 8 * S, y * S, n * 8 * S, 16 * S);
      this.scr.dirty = true;
      return;
    }
    for (let k = 0; k < n; k++) this.scr.glyph(col + k, y, 1, 16, this.gfx.subarray(GREY_PATTERN), color, 4, 0);
  }
  // 13278 高亮 (ax=0: 畫; ax≠0: 以視窗堆疊還原)
  highlight(ax) {
    const r = this.rects[this.cur];
    this.sys.mouseHide();
    if (ax === 0) {
      if (this.bracket === 0) {
        if (this.scr.hdCtx) {
          const w = r.x1 - r.x0, h = r.y1 - r.y0;
          if (this.hdHl && this.hdHl.x === r.x0 && this.hdHl.y === r.y0 && this.hdHl.w === w && this.hdHl.h === h) {
            this.scr.restoreRegion(this.hdHl.snap, 0, r.y0, h);
            this.hdHl = null;
          } else {
            if (this.hdHl) {
              this.scr.restoreRegion(this.hdHl.snap, 0, this.hdHl.y, this.hdHl.h);
              this.hdHl = null;
            }
            const snap = this.scr.saveRegion(r.x0, r.y0, w, h);
            this.hdHl = { x: r.x0, y: r.y0, w, h, snap };
            const S = 2, ctx = this.scr.hdCtx;
            this.scr.bakeFbToHd(r.x0, r.y0, w, h);
            ctx.fillStyle = "rgba(188, 136, 40, 0.34)";
            ctx.fillRect(r.x0 * S, r.y0 * S, w * S, h * S);
            ctx.strokeStyle = "rgba(128, 84, 16, 0.8)";
            ctx.lineWidth = S;
            ctx.strokeRect(r.x0 * S + 1, r.y0 * S + 1, w * S - 2, h * S - 2);
            this.scr.dirty = true;
          }
        } else {
          const mode = 0x107 | ((this.flag8a25 & 0xf0) << 8);
          this.scr.glyphMode(tdiv8(r.x0), r.y0, tdiv8(r.x1 - r.x0), r.y1 - r.y0, this.gfx.subarray(HL_SOLID), mode);
        }
      } else {
        this.win.save(tdiv8(r.x0) - 1, r.y0 - 6, tdiv8(r.x1 - r.x0 + 1) + 2, r.y1 - r.y0 + 0x11);
        for (let k = 0; k < 4; k++) this.bracketBox(r.x0 - k - 2, r.y0 - k - 2, r.x1 + k + 2, r.y1 + k + 2, 4);
      }
    } else {
      if (this.hdHl) this.hdHl = null;
      this.win.closeNow();
    }
    this.sys.mouseShow();
  }
  // 1fd9:1f9d 四邊直線 (1fd9:1b63 Bresenham, 逐點 seg0:0ad1)
  bracketBox(x0, y0, x1, y1, color) { this.scr.rectOutline(x0, y0, x1, y1, color); }
  // 133f4 從 prev 移到 cur
  moveHighlight() { const si = this.cur; this.cur = this.prev; this.highlight(this.bracket); this.cur = si; this.highlight(0); }
  // 13374 滑鼠命中測試
  hitTest() {
    const { x, y } = this.sys.mousePos();
    if (x === this.lastX && y === this.lastY) return;
    this.lastX = x; this.lastY = y;
    for (let i = 0; i < this.count; i++) {
      const r = this.rects[i];
      if (r.x0 > x || r.x1 <= x || r.y0 > y || r.y1 <= y) continue;
      this.cur = i; this.hit = 1; return;
    }
    this.hit = 0;
  }
  inRect(r) { return !(r.x0 > this.lastX || r.x1 <= this.lastX || r.y0 > this.lastY || r.y1 <= this.lastY); }
  // 13cfb 點在項目以外 (only=0: 按下後第一次檢查; 之後拖動中傳 1, 直接回 0)
  async outsideClick(only) {
    if (only) return 0;
    let bx = this.count;
    if (this.cancelable) { if (!this.inRect(this.rects[bx])) return 0x1b; bx++; }
    if (this.level !== 0 && this.inRect(this.rects[bx])) await this.dragWindow();
    return 0;
  }
  // 13adc 拖曳第 1 / 2 層視窗 (RE_NOTES 38.1): 關掉視窗 → 按住期間 XOR 外框 (1fd9:1fed, 色 7) 跟隨滑鼠 → 放開後以該層的繪製函式在新位置重開
  //   層表 DS:a158 + 0x0c×層 = {x, y, x 上限, y 上限, 繪製}; 框寬 = 0x280 − x 上限, 框高 = 0x190 − y 上限
  async dragWindow() {
    const L = this.levels[this.level], s = this.sys;
    const si = this.lastX - L.x, di = this.lastY - L.y;
    if (!this.inRect(this.rects[this.count])) return;
    s.mouseHide(); await this.win.close(); s.mouseShow();                    // 4ee7 / 796d / 4ecf
    const w = 0x280 - L.xmax, h = 0x190 - L.ymax;
    let px = -1, py = -1;
    const box = () => { s.mouseHide(); this.scr.xorRect(px, py, px + w - 1, py + h - 1, 7); s.mouseShow(); };   // 1fd9:1fed
    while (s.mouseAny()) {                                                   // 507e (原版迴圈內沒有等待)
      const m = s.mousePos();                                                // 4efa
      const x = (m.x > si ? umin(m.x - si, L.xmax) : 0) & 0xfff8, y = m.y > di ? umin(m.y - di, L.ymax) : 0;
      if (x !== px || y !== py) {
        if (px >= 0) box();
        px = x; py = y; box();
      }
      await s.poll();
    }
    if (px >= 0) box();
    let { x, y } = s.mousePos();                                             // 放開後重新讀位置: x > si 才減 (否則保持滑鼠座標本身, 原版如此)
    if (x > si) x -= si;
    if (y > di) y -= di;
    L.x = umin(x, L.xmax); L.y = umin(y, L.ymax);                            // 不再對齊 8
    s.mouseHide();
    if (this.level === 1) this.drawPopup(); else this.drawYesNo();           // far [a160 + 0x0c×層]: 0fea:3ad4 = 13974 / 0fea:3ba7 = 13a47
    this.highlight(this.bracket);                                            // 13278([a162])
    s.mouseShow();
  }
  // 13d80 取得一個按鍵 (滑鼠按下時追蹤到放開)
  async getKey() {
    this.lastX = this.lastY = -1;
    for (;;) {
      this.sys.rng.random(100);
      let k = this.readEvent();
      if (this.mouseFlag && k === 0x0d) {
        let si = 0;
        do {
          this.prev = this.cur;
          this.hitTest();
          k = this.hit ? 0x0d : await this.outsideClick(si);
          si = 1;
          if (this.cur !== this.prev) this.moveHighlight();
          if (!this.sys.mouseAny()) break;
          await this.sys.poll();
        } while (true);
      }
      if (k) return k;
      await this.sys.poll();
    }
  }
  // 13412 取得一個按鍵 (自訂導覽用: 呼叫端自行處理方向鍵); 滑鼠按住時追蹤命中項目, 點在項目外的確定被忽略
  async getKeyFree() {
    this.lastX = this.lastY = -1;
    for (;;) {
      this.sys.rng.random(100);
      const k = this.readEvent();
      if (this.mouseFlag && k === 0x0d) {
        do {
          this.prev = this.cur;
          this.hitTest();
          if (this.cur !== this.prev) this.moveHighlight();
          if (!this.sys.mouseAny()) break;
          await this.sys.poll();
        } while (true);
      }
      if (k && !(this.mouseFlag && !this.hit && k === 0x0d)) return k;
      await this.sys.poll();
    }
  }
  // 13df0 導覽 (C=每行項目數, step=左右移動量)
  async navigate(C, step) {
    const k = await this.getKey();
    this.prev = this.cur;
    if (C === 13) return this.navigateGrid(k, C, step);
    const n = this.count;
    switch (k) {
      case 0x1c: case 0x36:   // →
        if ((this.cur + 1) % C !== 0 && this.cur + 1 < n) this.cur += step; else this.cur -= C - 1; break;
      case 0x1d: case 0x34:   // ←
        if (this.cur % C !== 0) this.cur -= step;
        else if (this.cur - n + 1 !== 0) this.cur += C - 1; else this.cur -= step; break;
      case 0x1e: case 0x38:   // ↑
        if (C <= this.cur) this.cur -= C; else this.cur += n - C; break;
      case 0x1f: case 0x32:   // ↓
        if (C + this.cur < n) this.cur += C; else this.cur += C - n; break;
    }
    if (this.cur < 0 || this.cur >= n) this.cur = 0;
    if ([0x32, 0x34, 0x36, 0x38, 0x1e, 0x1f, 0x1c, 0x1d].includes(k)) this.moveHighlight();
    this.sys.flush();
    return k;
  }
  // 13e0e C = 13 的六角格導覽 (海戰選格, 跳躍表 0fea:3f86): 斜向鍵 1 / 3 / 7 / 9 依 DS:9bef (海戰視窗左上欄, 呼叫端放在 hexX) 與欄的奇偶決定; 沒有範圍檢查
  navigateGrid(k, C, step) {
    const n = this.count, ev = !((this.hexX ?? 0) & 1), col = c => btImodM(btImodM(c, 0x0d), 2);
    let c = this.cur;
    switch (k) {
      case 0x1c: case 0x36: if (btImodM(c + 1, C) !== 0 && c + 1 < n) c += step; else c -= C - 1; break;
      case 0x1d: case 0x34: if (btImodM(c, C) !== 0) c -= step; else if (c - n + 1 !== 0) c += C - 1; else c -= step; break;
      case 0x1e: case 0x38: if (C <= c) c -= C; else c += n - C; break;
      case 0x1f: case 0x32: if (C + c < n) c += C; else c += C - n; break;
      case 0x31:                                                        // 左下
        if (btImodM(c, C) === 0 || (c < 0x9c && c >= 0x8f && btImodM(c, 2) === (ev ? 0 : 1))) c = 0x8f;
        else c += (col(c) !== 0) === ev ? 0x0c : -1;
        break;
      case 0x33:                                                        // 右下
        if (btImodM(Math.abs(c - 0x0c), C) === 0 || (c < 0x9c && c >= 0x8f && btImodM(c, 2) === (ev ? 0 : 1))) c = 0x9b;
        else c += (col(c) === 0) === ev ? 1 : 0x0e;
        break;
      case 0x37:                                                        // 左上
        if (btImodM(c, C) === 0 || (c < 0x0d && btImodM(c, 2) === (ev ? 0 : 1))) c = 0;
        else c -= (col(c) === 0) === ev ? 0x0e : 1;
        break;
      case 0x39:                                                        // 右上
        if (btImodM(Math.abs(c - 0x0c), C) === 0 || (c < 0x0d && btImodM(c, 2) === (ev ? 0 : 1))) c = 0x0c;
        else c += (col(c) === 0) === ev ? -0x0c : 1;
        break;
    }
    this.cur = c;
    if ([0x32, 0x38, 0x1c, 0x1d, 0x34, 0x36, 0x1e, 0x1f, 0x37, 0x31, 0x39, 0x33].includes(k)) this.moveHighlight();
    this.sys.flush();
    return k;
  }
  // 142cd 選擇迴圈: 回傳項目編號, 取消回傳 0xff
  async select(C) {
    this.sys.mouseShow();
    if (this.count <= this.cur) this.cur = 0;
    const step = C === 1 ? 0 : 1;
    this.highlight(0);
    let k;
    for (;;) {
      k = await this.navigate(C, step);
      if (k === 0x0d && this.cur >= 0 && this.cur < 16 && (this.disabled & (1 << this.cur))) continue;
      if (k === 0x0d || k === 0x1b || k === 0x30) break;
    }
    this.highlight(this.bracket);
    await this.waitRelease();
    this.sys.mouseHide();
    return (k === 0x1b || k === 0x30) ? 0xff : this.cur;
  }
  async selectLoop(C) { let r; do r = await this.select(C); while (!this.cancelable && r === 0xff); return r; }
  // ---------------- 各種選單入口 ----------------
  // 14364 帶陰影視窗的直式選單 (寬螢幕模式下直接繪製原生 16:9 現代 Canvas 浮動選單，絕不使用原版視窗)
  async listMenu(x, y, table, cancelable) {
    if (this.scr.wideRenderer && this.codec) {
      return this.wideListMenu(table, cancelable);
    }
    this.hdHl = null;
    await this.waitRelease();
    this.count = table.length; this.lineH = 0x10; this.cur = 0; this.level = 0; this.cancelable = cancelable;
    const w = this.maxWidth(table);
    this.win.shadowedSaved(x, y, w + 4, (this.count + 1) * 0x18, 0);
    this.con.left = x + 2; this.con.right = w + x + 1; this.lineH = 0x18;
    this.drawItems(x, y, w, table);
    const r = await this.selectLoop(1);
    await this.waitRelease();
    await this.win.close();
    this.disabled = 0; this.lineH = 0x10; this.con.bg = 0x0f;
    return r;
  }
  async wideListMenu(table, cancelable) {
    await this.waitRelease();
    const labels = table.map(bytes => decodeCleanCstr(this.codec, bytes));
    if (hasDom()) {
      const r = await runDomMenu(labels, this.disabled, !!cancelable);
      this.disabled = 0; this.lineH = 0x10; this.con.bg = 0x0f;
      await this.waitRelease();
      return r;
    }
    const state = createWideMenuState(labels, this.disabled, this.wideAnchorCmd);
    const drawFn = ctx => drawWideMenu(ctx, state);
    this.scr.wideOverlays.push(drawFn);
    this.scr.dirty = true;
    const findNext = (from, step) => {
      for (let k = 1; k <= labels.length; k++) {
        const i = (from + step * k + labels.length) % labels.length;
        if (!(state.disabledMask & (1 << i))) return i;
      }
      return from;
    };
    let result = 0xff;
    try {
      for (;;) {
        const vx = this.sys.mouse?.vx ?? -1;
        const vy = this.sys.mouse?.vy ?? -1;
        const hov = hitWideMenuItem(state, vx, vy);
        if (hov >= 0 && !(state.disabledMask & (1 << hov)) && hov !== state.selected) {
          state.selected = hov;
          this.scr.dirty = true;
        }
        const ev = this.readEvent();
        if (ev === 0x1e || ev === 0x38) { state.selected = findNext(state.selected, -1); this.scr.dirty = true; }
        else if (ev === 0x1f || ev === 0x32) { state.selected = findNext(state.selected, 1); this.scr.dirty = true; }
        else if (ev === 0x1b || ev === 0x30) { if (cancelable) { result = 0xff; break; } }
        else if (ev === 0x0d) {
          if (this.mouseFlag) {
            if (hov >= 0) {
              if (!(state.disabledMask & (1 << hov))) { result = hov; break; }
            } else if (!hitWideMenuBox(state, vx, vy) && cancelable) {
              result = 0xff; break;
            }
          } else if (!(state.disabledMask & (1 << state.selected))) {
            result = state.selected; break;
          }
        }
        await this.sys.poll();
      }
    } finally {
      const idx = this.scr.wideOverlays.indexOf(drawFn);
      if (idx >= 0) this.scr.wideOverlays.splice(idx, 1);
      this.scr.dirty = true;
      await this.waitRelease();
      this.disabled = 0;
      this.lineH = 0x10;
      this.con.bg = 0x0f;
    }
    return result;
  }
  // 14411 同上但不保存背景、不關閉
  async listMenuKeep(x, y, table, cancelable) {
    this.hdHl = null;
    await this.waitRelease();
    this.count = table.length; this.lineH = 0x10; this.cur = 0; this.level = 0; this.cancelable = cancelable;
    const w = this.maxWidth(table);
    this.win.shadowed(x, y, w + 4, (this.count + 1) * 0x18, 0);
    this.con.left = x + 2; this.con.right = w + x + 1; this.lineH = 0x18;
    this.drawItems(x, y, w, table);
    const r = await this.selectLoop(1);
    await this.waitRelease();
    this.disabled = 0; this.lineH = 0x10; this.con.bg = 0x0f;
    return r;
  }
  // 144b9 在現有視窗內列出項目
  async inlineMenu(x, y, table, cancelable, lineH) {
    await this.waitRelease();
    this.count = table.length; this.lineH = lineH & 0xff; this.cur = 0; this.level = 0; this.cancelable = cancelable;
    const w = this.maxWidth(table);
    this.drawItems(x, y, w, table);
    const r = await this.selectLoop(1);
    await this.waitRelease();
    this.disabled = 0; this.con.bg = 0x0f;
    return r;
  }
  // 14524 自訂版面選單 (呼叫端已設好 rects); flags: bit0 可取消, bit1 保留游標, bit7 框選高亮
  async customMenu(count, C, flags) {
    this.hdHl = null;
    await this.waitRelease();
    this.count = count & 0xff;
    if (!(flags & 2)) this.cur = 0;
    this.level = 0; this.cancelable = flags & 1;
    if (flags & 0x80) this.bracket = 1;
    const r = await this.selectLoop(C & 0xff);
    await this.waitRelease();
    this.disabled = 0; this.bracket = 0;
    return r;
  }
  // 1458c 在滑鼠位置彈出的選單 (第 1 層)
  async popupMenu(table, cancelable) {
    await this.waitRelease();
    const saveBg = this.con.bg;
    this.count = table.length; this.cur = 0; this.a154 = 1; this.level = 1; this.cancelable = cancelable; this.table = table;
    const w = this.maxWidth(table);
    let { x, y } = this.sys.mousePos();
    if ((w + 4) * 4 < x) x += -(w + 4) * 4;
    if (y > 0x18) y -= 0x18;
    const L = this.levels[1];
    L.xmax = (0x4b - w) << 3; L.ymax = 0x168 - (this.count << 4);
    L.x = umin(x, L.xmax); L.y = umin(y, L.ymax);
    this.drawPopup();
    const r = await this.selectLoop(1);
    await this.waitRelease();
    await this.win.close();
    this.disabled = 0; this.con.bg = saveBg; this.a154 = 0;
    return r;
  }
  // 13974 第 1 層繪製
  drawPopup() {
    const L = this.levels[this.level], x = L.x, y = L.y, w = this.maxWidth(this.table);
    this.lineH = 0x10;
    const col = tdiv8(x);
    this.win.shadowedSaved(col, y, w + 4, (this.count + 2) << 4, 0);
    this.con.left = col + 2; this.con.right = w + col + 1;
    this.drawItems(col, y, w, this.table);
    this.rects[this.count + 1] = { ...this.rects[this.count] };
  }
  // 1469c 是/否 確認框 (第 2 層), 回傳 1=是 0=否
  async yesNo() {
    if (this.scr.wideRenderer) {
      return this.wideYesNo();
    }
    this.hdHl = null;
    await this.waitRelease();
    this.disabled = 0;
    const saveBg = this.con.bg; this.con.bg = 7;
    this.count = 2; this.level = 2; this.cur = 0; this.cancelable = 0;
    let { x, y } = this.sys.mousePos();
    if (x === 0x27f && y === 0x18f) {
      x = (this.con.right + this.con.left - 10) << 2;
      y = this.con.x === this.con.left ? this.con.y : this.con.y + 0x18;
    } else { if (x > 0x28) x -= 0x28; if (y > 0x20) y -= 0x20; }
    const L = this.levels[2];
    L.x = umin(x, L.xmax); L.y = umin(y, L.ymax);
    this.sys.setCursorShape(CURSOR_MENU);
    this.drawYesNo();
    const r = await this.select(2);
    await this.waitRelease();
    await this.win.close();
    this.con.bg = saveBg;
    return r < 1 ? 1 : 0;
  }
  async wideYesNo() {
    await this.waitRelease();
    if (hasDom()) {
      const r = await runDomYesNo(this.scr.wideDialog?.text || "", "是", "否");
      await this.waitRelease();
      return r;
    }
    const state = createWideYesNoState();
    const drawFn = ctx => drawWideYesNo(ctx, state);
    this.scr.wideOverlays.push(drawFn);
    this.scr.dirty = true;
    let res = 0;
    try {
      for (;;) {
        const vx = this.sys.mouse?.vx ?? -1;
        const vy = this.sys.mouse?.vy ?? -1;
        const hov = hitWideYesNo(state, vx, vy);
        if (hov >= 0 && hov !== state.selected) {
          state.selected = hov;
          this.scr.dirty = true;
        }
        const ev = this.readEvent();
        if (ev === 0x1c || ev === 0x1d || ev === 0x34 || ev === 0x36) {
          state.selected = state.selected === 0 ? 1 : 0;
          this.scr.dirty = true;
        } else if (ev === 0x1b || ev === 0x30) {
          res = 0; break;
        } else if (ev === 0x0d) {
          if (this.mouseFlag) {
            if (hov >= 0) { res = hov === 0 ? 1 : 0; break; }
          } else {
            res = state.selected === 0 ? 1 : 0; break;
          }
        }
        await this.sys.poll();
      }
    } finally {
      const idx = this.scr.wideOverlays.indexOf(drawFn);
      if (idx >= 0) this.scr.wideOverlays.splice(idx, 1);
      this.scr.dirty = true;
      await this.waitRelease();
    }
    return res;
  }
  // 13a47 第 2 層繪製: GRAPH.DAT 第 0 張圖 (8 色入口 seg0:5a91)
  drawYesNo() {
    const L = this.levels[2], x = L.x, y = L.y;
    this.win.save(tdiv8(x), y, 0x12, 0x38);
    for (let i = 0; i < 2; i++) { const x0 = (i << 6) + x + 0x10; this.rects[i] = { x0, x1: x0 + 0x30, y0: y + 0x16, y1: y + 0x16 + 0x14 }; }
    this.graph.draw8(0, tdiv8(x) << 3, y);
    this.rects[2] = { x0: x, x1: x + 0x90, y0: y, y1: y + 0x10 };
  }
  // 147ab 等待按鍵: 寬螢幕模式下直接於現代底部對話欄顯示動畫提示三角並等待點擊/按鍵
  async waitPrompt() {
    await this.waitRelease();
    if (this.scr.wideRenderer && this.scr.wideDialog) {
      this.scr.wideDialog.waiting = true;
      this.scr.dirty = true;
      await this.waitPress();
      this.scr.wideDialog.waiting = false;
      this.scr.dirty = true;
      await this.waitRelease();
      return;
    }
    const c = this.con;
    let col = Math.trunc((c.right - c.left) / 2) + c.left;
    let y = c.x === c.left ? c.y : c.y + 0x18;
    if (col > 0x4e) col = 0x4e; if (y > 0x180) y = 0x180;
    this.sys.mouseHide();
    const saved = this.win.grab(col, y, 2, 16);
    await this.waitRelease();                 // 原版在保存背景後再呼叫一次 131e3 (0x14805)
    for (;;) {
      this.scr.glyph(col, y, 2, 16, this.gfx.subarray(WAIT_ICON), 2, 4, 0);
      if (await this.sys.waitOrKeyTenths(4)) { this.win.putBack(saved); break; }
      this.win.putBack(saved);
      if (await this.sys.waitOrKeyTenths(4)) break;
    }
    await this.waitRelease();
    this.sys.mouseShow();
  }
}
