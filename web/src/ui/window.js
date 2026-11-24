// window.js — 原版視窗繪製 (MAIN.EXE seg0:7358 / 74f7 / 773c / 7779)
// 外框圖形來自 DATA1.LZW 第 14 項 (載入 MAIN.EXE 的緩衝區 [0c86], seg0:1743c), 位移:
//   2c20 左上  2c40 右上  2c60 左下  2c80 右下 (各 8x8, 平面交錯)
//   2ca0 + style*0x80: +00 上邊 +20 左邊 +40 右邊 +60 下邊 (8 行平鋪圖樣)
// x / w 以 8 像素欄為單位, y / h 以像素為單位。
export const FRAME_TL = 0x2c20, FRAME_TR = 0x2c40, FRAME_BL = 0x2c60, FRAME_BR = 0x2c80, FRAME_EDGES = 0x2ca0;
export const WINDOW_FILL = 7;
// DS:8b4a / 8b52 / 8b5a 陰影圖樣 (2 行 x 4 平面), 以 AND 模式 (seg0:034d) 疊加
const SHADOW_A = Uint8Array.of(0xfa, 0xfa, 0xfa, 0xfa, 0xf5, 0xf5, 0xf5, 0xf5);
const SHADOW_B = Uint8Array.of(0xaa, 0xaa, 0xaa, 0xaa, 0x55, 0x55, 0x55, 0x55);
const SHADOW_C = Uint8Array.of(0xaf, 0xaf, 0xaf, 0xaf, 0x5f, 0x5f, 0x5f, 0x5f);

export class WindowSystem {
  // gfx: DATA1 第 14 項位元組; con: TextConsole; wait(n): 原版 seg0:5998 延遲
  // sys: 滑鼠游標隱藏/顯示 (seg0:4ee7 / 4ecf); 50c4, 7358, 796d, 7a8e 都在開頭隱藏、結尾顯示游標
  constructor(scr, con, gfx, { wait = () => {}, options = { animate: true }, sys = null } = {}) {
    this.scr = scr; this.con = con; this.gfx = gfx; this.wait = wait; this.options = options; this.sys = sys;
    this.stack = [];          // 原版 [0c88] 緩衝區 + 堆疊頂 [0536]
  }
  // seg0:50c4 保存視窗底下的畫面 (x,w 欄; y,h 像素) — 同時保存 fb 與 HD 2D 真彩圖層
  save(x, y, w, h) {
    this.sys?.mouseHide();
    const snap = this.scr.saveRegion(x * 8, y, w * 8, h);
    this.stack.push({ x, y, w, h, snap });
    this.sys?.mouseShow();
  }
  restoreRows(win, fromRow, toY, rows) {
    this.scr.restoreRegion(win.snap, fromRow, toY, rows);
  }
  // seg0:796d 關閉最上層視窗; 高度>16 且開啟動畫時, 由上下兩端每次各還原 8 行向中間收合
  async close() {
    this.sys?.mouseHide();
    const win = this.stack.pop(); if (!win) { this.sys?.mouseShow(); return; }
    if (win.h > 16 && this.options.animate) {
      const n = (Math.abs(win.h) >> 4) + 1;
      for (let i = 0; i < n; i++) {
        this.restoreRows(win, i * 8, win.y + i * 8, 8);
        this.restoreRows(win, win.h - 8 - i * 8, win.y + win.h - 8 * (i + 1), 8);
        await this.wait(1);
      }
    } else this.restoreRows(win, 0, win.y, win.h);
    this.sys?.mouseShow();
  }
  // seg0:7a8e 關閉最上層視窗 (永不動畫)
  closeNow() { this.sys?.mouseHide(); const win = this.stack.pop(); if (win) this.restoreRows(win, 0, win.y, win.h); this.sys?.mouseShow(); }
  // 取出一塊畫面但不放入堆疊 (seg0:50c4 後立即 [0536]-=size 的用法, 例: 等待游標)
  grab(x, y, w, h) { this.save(x, y, w, h); return this.stack.pop(); }
  // seg0:042f 把 grab/save 的畫面放回
  putBack(win) { this.restoreRows(win, 0, win.y, win.h); }
  // seg0:7849 保存 (w+1)x(h+4) 背景後畫帶陰影視窗
  shadowedSaved(x, y, w, h, style = 0) {
    this.save(x, y, w + 1, h + 4);
    const top = this.stack[this.stack.length - 1];
    if (top) { top.frameW = w; top.frameH = h; top.hasShadow = true; }
    this.shadowed(x, y, w, h, style);
  }
  put(col, y, off) { this.scr.putPlanar(col, y, 1, 8, this.gfx, off); }
  // seg0:7925 標籤框 (x, w 欄; y, h 像素): 文字區 x+2..x+w−3、游標 (x+2, y+8) → 50c4 保存 → 7878: 以 DS:8b52 (AA×4 / 55×4) 每 2 行逐欄
  //   AND 疊加 (03ca → 02a7 模式 2 = 034d, 底圖變暗), 再以 7264 (水平 / 垂直線 = 09aa 填矩形) 畫 下邊、右邊 色 0, 上邊、左邊 色 7 (3119b「請指定目的地」)
  labelBox(x, y, w, h) {
    const c = this.con, s = this.scr;
    c.right = w + x - 3; c.left = x + 2; c.setCursor(x + 2, y + 8);
    this.save(x, y, w, h);
    for (let r = 0; r < h; r += 2) for (let i = 0; i < w; i++) this.andPattern(x + i, y + r, SHADOW_B);
    const X0 = x << 3, X1 = ((x + w) << 3) - 1, Y1 = h + y - 1;
    s.fillRectPx(X0, Y1, X1, Y1, 0);
    s.fillRectPx(X1, y, X1, Y1, 0);
    s.fillRectPx(X0, y, X1, y, 7);
    s.fillRectPx(X0, y, X0, Y1, 7);
  }
  // AND 模式 2 行圖樣
  andPattern(col, y, pat) {
    const s = this.scr; if (!s.inBounds(col, y, 1, 2)) return;
    for (let r = 0; r < 2; r++) {
      const o = (y + r) * 640 + col * 8, p = r * 4;
      for (let i = 0; i < 8; i++) {
        const sh = 7 - i;
        const m = ((pat[p] >> sh) & 1) | (((pat[p + 1] >> sh) & 1) << 1) | (((pat[p + 2] >> sh) & 1) << 2) | (((pat[p + 3] >> sh) & 1) << 3);
        s.fb[o + i] &= m;
      }
    }
    s.dirty = true;
  }
  // seg0:7358 畫視窗 (無動畫); 之後文字邊界 = x+1..x+w-2, 游標 (x+1, y+8), 文字色 黑/底 7
  frame(x, y, w, h, style = 0, { shadow = false } = {}) {
    this.sys?.mouseHide();
    const s = this.scr;
    if (!s.drawWindowHd?.(x, y, w, h, style, { shadow })) {
      const e = FRAME_EDGES + style * 0x80, g = this.gfx;
      this.put(x, y, FRAME_TL);
      s.tile(x + 1, y, w - 2, 8, g, e);
      this.put(x + w - 1, y, FRAME_TR);
      s.tile(x, y + 8, 1, h - 16, g, e + 0x20);
      s.fillCols(x + 1, y + 8, w - 2, h - 16, WINDOW_FILL);
      s.tile(x + w - 1, y + 8, 1, h - 16, g, e + 0x40);
      this.put(x, y + h - 8, FRAME_BL);
      s.tile(x + 1, y + h - 8, w - 2, 8, g, e + 0x60);
      this.put(x + w - 1, y + h - 8, FRAME_BR);
    }
    const c = this.con;
    c.left = x + 1; c.right = x + w - 2; c.setCursor(x + 1, y + 8);
    c.puts(Uint8Array.of(0x1b, 0x43, 0x30, 0x1b, 0x42, 0x37, 0));       // DS:8b3b  ESC C0 ESC B7
    this.sys?.mouseShow();
  }
  // seg0:74f7 開視窗: 若「動畫效果」開啟, 由中央向左右展開, 每步 wait(1)
  async open(x, y, w, h, style = 0) {
    this.save(x, y, w, h);
    this.con.puts(Uint8Array.of(0x1b, 0x43, 0x30, 0x1b, 0x42, 0x37, 0)); // DS:8b42
    if (!this.options.animate) { this.padded(x, y, w, h, style); return; }
    const s = this.scr;
    if (s.hdCtx) {
      const steps = Math.min(6, Math.max(2, Math.trunc(w / 4)));
      const midX = x + Math.trunc(w / 2);
      for (let i = 1; i <= steps; i++) {
        const curW = i === steps ? w : Math.max(4, Math.round((w * i) / steps));
        const curX = i === steps ? x : Math.max(x, midX - Math.trunc(curW / 2));
        s.drawWindowHd(curX, y, curW, h, style);
        await this.wait(1);
      }
    } else {
      const g = this.gfx, e = FRAME_EDGES + style * 0x80;
      const half = Math.trunc((w - 1) / 2);
      let L = x + half - 1, R = x + w - half;
      for (let i = 0; half > i; i++, L--, R++) {
        this.put(L, y, FRAME_TL);
        s.putPlanar(L + 1, y, 1, 8, g, e);
        this.put(R, y, FRAME_TR);
        s.putPlanar(R - 1, y, 1, 8, g, e);
        s.tile(L, y + 8, 1, h - 16, g, e + 0x20);
        s.tile(R, y + 8, 1, h - 16, g, e + 0x40);
        s.fillCols(L + 1, y + 8, 1, h - 16, WINDOW_FILL);
        s.fillCols(R - 1, y + 8, 1, h - 16, WINDOW_FILL);
        this.put(L, y + h - 8, FRAME_BL);
        s.putPlanar(L + 1, y + h - 8, 1, 8, g, e + 0x60);
        this.put(R, y + h - 8, FRAME_BR);
        s.putPlanar(R - 1, y + h - 8, 1, 8, g, e + 0x60);
        await this.wait(1);
      }
    }
    const c = this.con; c.right = x + w - 3; c.left = x + 2; c.setCursor(x + 2, y + 16);
  }
  // seg0:773c 視窗 + 內邊距: 文字區 x+2..x+w-3, 游標 (x+2, y+16)
  padded(x, y, w, h, style = 0) {
    this.frame(x, y, w, h, style);
    const c = this.con; c.right = x + w - 3; c.left = x + 2; c.setCursor(x + 2, y + 16);
  }
  // seg0:7779 帶陰影視窗
  shadowed(x, y, w, h, style = 0) {
    if (this.scr.hdCtx) {
      this.frame(x, y, w, h, style, { shadow: true });
      const c = this.con; c.right = x + w - 3; c.left = x + 2; c.setCursor(x + 2, y + 16);
      return;
    }
    this.frame(x, y, w, h, style);
    const c = this.con; c.right = x + w - 3; c.left = x + 2; c.setCursor(x + 2, y + 16);
    let sy = y;
    for (let i = 0; Math.trunc(h / 2) > i; i++, sy += 2) this.andPattern(x + w, sy + 4, SHADOW_C);
    for (let k = 0; k < 2; k++, sy += 2) {
      this.andPattern(x, sy, SHADOW_A);
      for (let n = w - 1, cx = x; n > 0; n--) this.andPattern(++cx, sy, SHADOW_B);
    }
  }
}
