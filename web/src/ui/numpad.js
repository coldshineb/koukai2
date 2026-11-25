// numpad.js — 数量输入计算机 (MAIN.EXE seg0:5151..5994)
//   seg0:592a input(min, max)  外框图 GRAPH.DAT #1, 位置 DS:8a9c/8a9e (初值 0x1F8, 0xF8; 拖拽数值显示区可移动)
//   seg0:5597 计算机本体: 0-9 + - * / = (含先乘除), ',' 正负号, '>' 清除, '?' 最大值, 'B' 滑杆, Enter 确定
//   seg0:54d2 显示 (滑杆 + "%9ld")   seg0:527a 鼠标点击   seg0:542e 取得按键 ('.' 视为 '=')
// 32 比特算术: 乘法取低 32 比特 (_lmul), 除法向零取整 (_ldiv), 与原版相同
import { runWideNumPad } from "../canvas_ui/wide_numpad.ts";
import { hasDom, runDomNumPad } from "../modern/dom_ui.ts";

const NP_KEYS = "789*?456/>123-,0=+\r";                      // DS:8aa0
const NP_STR_COLOR = Uint8Array.of(0x1b, 0x43, 0x30, 0x1b, 0x42, 0x37, 0);   // DS:8ab3
const NP_FMT = Uint8Array.of(0x25, 0x39, 0x6c, 0x64, 0);                       // DS:8aba "%9ld"
const NP_MAX = 99999999, NP_MIN = -99999999;
const lmul = (a, b) => Math.imul(a | 0, b | 0);
const ldiv = (a, b) => (b | 0) === 0 ? 0 : Math.trunc((a | 0) / (b | 0)) | 0;
const nDiv8 = v => (v < 0 ? -((-v) >> 3) : v >> 3);

export class NumPad {
  // ctx: scr, sys, con, win, graph, menu, printf, gfx
  constructor(ctx) { this.c = ctx; this.ox = 0x1f8; this.oy = 0xf8; this.rects = []; }
  // 5151 / 517e 保存与还原文字主控台状态
  saveCon() { const c = this.c.con; this.saved = { x: c.x, y: c.y, mode: c.mode, fg: c.fg, bg: c.bg, left: c.left, right: c.right }; }
  restoreCon() { Object.assign(this.c.con, this.saved); }
  // 51a9 画计算机并创建点击区域
  draw() {
    const { win, graph, con, sys } = this.c, ox = this.ox, oy = this.oy;
    win.save(nDiv8(ox), oy, 0x11, 0x98);
    graph.draw(1, ox, oy);
    con.puts(NP_STR_COLOR);
    sys.mouseShow();
    const R = this.rects;
    for (let i = 0; i < 19; i++) {
      const x0 = (i % 5) * 24 + ox + 8, y0 = (Math.trunc(i / 5) + 2) * 24 + oy;
      R[i] = { x0, x1: x0 + 24, y0, y1: y0 + 24 };
    }
    R[18].x1 = R[18].x0 + 0x30;
    R[19] = { x0: ox + 0x12, x1: ox + 0x2a, y0: oy + 0x18, y1: oy + 0x28 };     // 数值显示区 (拖拽)
    R[20] = { x0: ox + 0x15, x1: ox + 0x79, y0: oy + 8, y1: oy + 0x10 };       // 滑杆
  }
  // 54d2 显示数值与滑杆 (pos = 鼠标 x; -1 = 依数值计算)
  show(v, pos) {
    const { scr, con, sys, printf } = this.c, S = this.rects[20];
    let si = v < 0 ? S.x0 : pos;
    if (si === -1 && this.max !== 0) si = ldiv(lmul(v, 100), this.max) + S.x0;
    if (S.x0 > si || S.x1 < si) si = S.x1;
    sys.mouseHide();
    scr.fillRectPx(S.x0, S.y0, S.x1, S.y1, 0);
    scr.fillRectPx(S.x0, S.y0, si, S.y1, 2);
    con.setCursor(nDiv8(this.ox) + 6, this.oy + 0x18);
    printf(NP_FMT, v | 0);
    sys.mouseShow();
  }
  inRect(r, x, y) { return r.x0 <= x && r.x1 > x && r.y0 <= y && r.y1 > y; }
  // 527a 鼠标点击
  async click() {
    const { sys, scr, gfx, menu, win } = this.c;
    let { x, y } = sys.mousePos();
    for (let i = 0; i < 19; i++) {
      const r = this.rects[i];
      if (!this.inRect(r, x, y)) continue;
      const col = nDiv8(r.x0), w = nDiv8(r.x1) - col;
      sys.mouseHide();
      scr.glyphMode(col, r.y0, w, 0x18, gfx, 0x107);
      await menu.waitRelease();
      scr.glyphMode(col, r.y0, w, 0x18, gfx, 0x107);
      sys.mouseShow();
      return NP_KEYS.charCodeAt(i);
    }
    const dx = x - this.ox, dy = y - this.oy;
    if (this.inRect(this.rects[19], x, y)) {
      sys.mouseHide(); await win.close(); sys.mouseShow();
      while (sys.mouseAny()) await sys.poll();
      sys.mouseHide();
      ({ x, y } = sys.mousePos());
      if (dx < x) x -= dx;
      if (y > dy) y -= dy;
      this.ox = Math.min(x & 0xffff, 0x1f8) & 0x7f8;
      this.oy = Math.min(y & 0xffff, 0xf8);
      this.draw();
    }
    const S = this.rects[20];
    if (S.x0 <= x && S.x1 > x && y >= S.y0 && y < S.y1) return 0x42;
    return 0;
  }
  // 542e
  async key() {
    const { menu, sys } = this.c;
    await menu.waitRelease();
    for (;;) {
      const s = menu.source();
      if (s === 1) return this.click();
      if (s === 2) { const k = sys.getKey(); return k === 0x2e ? 0x3d : k; }
      await sys.poll();
    }
  }
  // 5465 四则运算
  static apply(op, a, b) {
    switch (op) {
      case 0x2a: return lmul(a, b);
      case 0x2b: return (b + a) | 0;
      case 0x2d: return (a - b) | 0;
      case 0x2f: return b === 0 ? 0 : ldiv(a, b);
      default: return b | 0;
    }
  }
  // 5597
  async calc(max) {
    const { sys } = this.c;
    let pend = 0, cur = 0, acc1 = 0, acc2 = 0, op1 = 0, op2 = 0, k;
    this.max = max;
    this.show(0, -1);
    do {
      k = await this.key();
      if (k !== 0x2a && k !== 0x2f && k !== 0x2b && k !== 0x2d) pend = 0;
      if (k === 0x42) {
        let px = -1, py = -1;
        while (sys.mouseAny()) {
          const { x, y } = sys.mousePos();
          if (x === px && y === py) { await sys.poll(); continue; }
          const S = this.rects[20];
          if (S.x0 > x || S.x1 < x) { await sys.poll(); continue; }
          py = y;
          cur = ldiv(lmul(x - this.ox - 0x15, max), 100);
          px = x;
          this.show(cur, x);
          await sys.poll();
        }
      }
      if (k === 0x3e) { cur = acc1 = acc2 = 0; op1 = op2 = 0; k = 0x30; }
      if (k === 0x3f) { cur = max; this.show(cur, -1); }
      if (k === 0x2c) { cur = -cur | 0; this.show(cur, -1); }
      if (k >= 0x30 && k <= 0x39) {
        if (op2 === 0x3d) { cur = 0; acc2 = 0; op2 = 0; }
        const d = k - 0x30, p = lmul(cur, 10);
        if (cur >= 0) cur = (p >= 99999990 || p < cur) ? NP_MAX : (p + d) | 0;
        else cur = (p <= -99999990 || p > cur) ? NP_MIN : (p - d) | 0;
        this.show(cur, -1);
      }
      let si = pend;
      if (k === 0x2b || k === 0x2d || k === 0x3d) {
        if (si) { op2 = k; if (op1) { acc2 = acc1; op1 = 0; } }
        else {
          const t = NumPad.apply(op1, acc1, cur);
          acc2 = NumPad.apply(op2, acc2, t);
          cur = 0; acc1 = 0; op2 = k; op1 = 0;
          if (acc2 > NP_MAX) acc2 = NP_MAX;
          if (acc2 < NP_MIN) acc2 = NP_MIN;
          this.show(acc2, -1);
          if (k === 0x3d) { cur = acc2; pend = 0; continue; }
          si = 1;
        }
      }
      if (k === 0x2f || k === 0x2a) {
        if (!si) { acc1 = NumPad.apply(op1, acc1, cur); this.show(acc1, -1); cur = 0; op1 = k; si = 1; }
        else { if (op2) { acc1 = acc2; op2 = 0; } op1 = k; }
      }
      pend = si;
    } while (k !== 0x0d);
    return acc2 !== 0 ? acc2 : cur;
  }
  // 592a 输入 min..max 之间的数 (负数返回 0); 16:9 模式下使用纯 Canvas 现代滑杆步进器 (零 DOM)
  async input(min, max) {
    if (this.c.scr?.wideRenderer) {
      if (hasDom()) return runDomNumPad(min, max, this.c.scr.wideDialog?.text || "", {
        art: this.c.scr.wideArt,
        portraitId: this.c.scr.wideDialog?.portraitId ?? null,
        portraitComposed: this.c.scr.wideDialog?.portraitComposed ?? null,
      });
      return runWideNumPad(this.c, min, max);
    }
    const { con, sys, win } = this.c;
    this.saveCon();
    con.left = 0; con.right = 0x4e;
    this.draw();
    let v;
    do v = await this.calc(max); while (v < min || v > max);
    sys.mouseHide();
    await win.close();
    this.restoreCon();
    return v < 0 ? 0 : v;
  }
}
