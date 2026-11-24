// ending.js — 結局 (原版 END.EXE 的移植)
//
// 原版流程: MAIN.EXE 1764f (爵位 9 / 劇本命令 F4 / 17004) 存檔後經 INT 65h 把 主角名字串、國籍 ×2、核對值 交給常駐的 KOUKAI2.COM,
//   以結束碼 1 結束; KOUKAI2.COM 見結束碼不是 0/2 就執行 END.EXE。本模組 = END.EXE, 參數與 INT 65h AH=2..5 的值相同。
// 逐函式翻譯自 END.EXE 反組譯 (tools/re/ending.py、ending_map.py → tools/work/re_end*.txt; docs/RE_NOTES.md 第 34 節);
//   註解中的位址 = END.EXE 載入映像線性偏移, [xxxx] = DGROUP (段 08dd) 變數, DS:xxxx 常數取自 assets/data/ending.json (tools/extract_end.py 原樣提取)。
//
// 顯示: END.EXE 的繪圖函式庫與 MAIN.EXE seg0 的是同一套 (遊戲區 640x400 = VRAM 第 40..439 行, 剪裁 03d36 = seg0:012e),
//   所以直接用 core/screen.js 的索引幀緩衝與原語 (putPlanar / tile / fillCols / glyphMode / glyph) 與 gfx/graphdec.js;
//   END.EXE 自己另有的平面操作 (選平面讀寫 4437/49d7、59ce 網點溶入、5a7b 左移、2c88 擷取、498c 存背景) 在這裡對索引幀緩衝的位元平面實作。
// 計時: FMDRV INT 66h 倒數 (F1 01 設定 / F1 00 讀取, 1 tick = 16.58 ms) → sys.timer。
// 音樂: END.EXE 內嵌 2 曲 (0771:0002, 00ecb 以 AH=00 登記); 359f(k) → AH=01 AL=k+1, 網頁版以 BGM playSong(k+1) (assets/data/bgm.json "ending")。

import { cprintf } from "../ui/printf.js";
import { decodeGraph } from "../gfx/graphdec.js";
// 劇本結局序幕 (DS:0e00 far 函式表)
import { PROLOGUES } from "./ending_pro.js";

const edS16 = v => (v << 16) >> 16;
const edRor16 = (v, n) => { n &= 15; return ((v >>> n) | (v << (16 - n))) & 0xffff; };


export class EndingExit extends Error { constructor(code) { super("ending exit"); this.code = code; } }

export class Ending {
  // ctx: { scr, sys, bgm, font }  data: { json (ending.json), endgrp, endput, events[7] }
  constructor(ctx, data) {
    this.ctx = ctx; this.scr = ctx.scr; this.sys = ctx.sys; this.bgm = ctx.bgm; this.font = ctx.font;
    this.data = data;
    this.m = new Uint8Array(0x10000);                       // DGROUP: 初值區 + 未初始化區 (0)
    const ds = data.json.ds; for (let i = 0; i < ds.length / 2; i++) this.m[i] = parseInt(ds.substr(i * 2, 2), 16);
    this.bufs = [null];                                     // 7513 配置的記憶體區塊 (handle = 索引)
    this.file = null; this.filePos = 0;                     // [025a] 目前開啟的 EVENT / ENDGRP
    this.dac = new Uint8Array(48);                          // DAC 0..15 (R,G,B 6 位元) — 測試比對用
    this.cs59ca = 0; this.cs59cc = 0;                       // 59ce 的 cs: 變數 (網點遮罩 / 平面)
    this.onMusic = null;                                    // 測試: (ah, al) → 記錄 INT 66h 樂曲呼叫
    this.onEndWait = null;                                  // 測試: 0eff 等待任意鍵 (結局播完)
  }
  // ---- DS ----
  b(o) { return this.m[o & 0xffff]; }
  w(o) { o &= 0xffff; return this.m[o] | (this.m[(o + 1) & 0xffff] << 8); }
  sb(o, v) { this.m[o & 0xffff] = v & 255; }
  sw(o, v) { o &= 0xffff; this.m[o] = v & 255; this.m[(o + 1) & 0xffff] = (v >> 8) & 255; }
  str(o) { let e = o; while (this.m[e]) e++; return this.m.subarray(o, e); }
  // ---- 記憶體區塊 (7513 配置 / 75e6 取段址 / 7569 釋放) ----
  alloc(paras) { this.bufs.push(new Uint8Array(paras * 16)); return this.bufs.length - 1; }   // 7513
  ptr(h) { return this.bufs[h]; }                                                          // 75e6
  // ---- 計時 / 輸入 ----
  async poll() { await this.sys.poll(); }
  timerSet(n) { this.sys.timer.set(n & 0xffff); }                 // 4b16 (F1 01)
  timerGet() { return this.sys.timer.get(); }                     // 4b23 (F1 00)
  async waitTicks(n) { this.timerSet(n); while (this.timerGet()) await this.poll(); }   // 291c
  kbhit() { return this.sys.kbhit() ? 1 : 0; }                    // 167c → 66f7 (BIOS NumLock 強制開)
  getch() { return this.sys.readRaw(); }                          // 6711: ASCII≠0 → ASCII, 否則 0x100|掃描碼
  flushKeys() { while (this.kbhit()) this.getch(); }              // 1682
  translateKey() {                                                // 1699 (功能鍵表 cs:16b9, 掃描碼 3b..53)
    const v = this.getch();
    if (v >= 0x100) {
      const T = { 0x3b: 0x16, 0x3c: 0x14, 0x3d: 0x02, 0x3e: 0x19, 0x47: 0x3e, 0x48: 0x1e, 0x4b: 0x1d, 0x4d: 0x1c, 0x4f: 0x3f, 0x50: 0x1f, 0x53: 0x7f };
      return T[v & 0xff] ?? 0xff;
    }
    return v === 0x20 ? 0x0d : v;
  }
  getKey() { const k = this.translateKey(); this.flushKeys(); return k & 0xff; }   // 1728
  mouseAny() { return this.sys.mouseLeft() || this.sys.mouseRight() ? 1 : 0; }   // 27f1 (2710 / 2747)
  inputState() { if (this.mouseAny()) return 1; if (this.kbhit()) return 2; return 0; }   // 0ee4
  async waitNoInput() { while (this.inputState()) { this.flushKeys(); await this.poll(); } }   // 0f15
  async waitInput() { this.onEndWait?.(); while (!this.inputState()) { this.flushKeys(); await this.poll(); } }   // 0eff (忙等)
  async waitOrKey(n) {                                            // 2945: 計時到 → 0; Enter/Esc/'0' 或滑鼠 → 1
    this.timerSet(n);
    for (;;) {
      if (!this.timerGet()) return 0;
      if (this.kbhit()) { const k = this.getKey(); if (k === 0x0d || k === 0x1b || k === 0x30) return 1; }
      if (this.mouseAny()) return 1;
      await this.poll();
    }
  }
  waitOrKeyTenths(n) { return this.waitOrKey((6 * n) & 0xffff); }   // 2989
  // ---- 音樂 (INT 66h, 經 69b4 int86) ----
  int66(ah, al) { this.onMusic?.(ah, al); }
  musicStatus() { this.int66(3, 0); return 0; }                    // 364a (fn 3): 網頁版無法取得驅動狀態, 視為未播放 (與差分測試的模擬器相同)
  async playSong(k) {                                              // 359f
    if (!this.b(0x1ff6) || k > 0x17) return;
    if (this.musicStatus()) {
      if (this.b(0x0e46) === k) return;
      this.musicFade(0x14);
      while (this.musicStatus()) await this.poll();
    }
    this.int66(1, k + 1); this.bgm?.playSong?.(k + 1);
    this.musicFlag(1);
    this.sb(0x0e46, k);
  }
  musicFlag(v) { if (!this.b(0x1ff6)) return; this.int66(4, v); if (this.bgm?.el) this.bgm.el.loop = !!v; }   // 35fc (fn 4)
  musicFade(speed) { if (!this.b(0x1ff6)) return; this.int66(2, speed); this.bgm?.fadeOut?.(); }            // 3623 (fn 2)
  async beep(n) { await this.waitTicks(n); }                                                                // 357c (喇叭 4b3e 開/關之間等待)
  // ---- 調色盤 (DS:1f92 目前 16 色 × B,R,G 4 位元; [200c] 單色反轉) ----
  setDac(i, word) {                                               // 56f8: AL 高半位元組 → R, AH 低 → G, AL 低 → B (各 ×4)
    const r = ((word & 0xf0) >> 4) << 2, g = ((word >> 8) & 0x0f) << 2, b = (word & 0x0f) << 2;
    i &= 15; this.dac[i * 3] = r; this.dac[i * 3 + 1] = g; this.dac[i * 3 + 2] = b;
    this.scr.setDac6(i, r, g, b);
  }
  palWord(si) {                                                   // 236b..23ac: 依 [200c] 取 (G<<8)|(R<<4)|B
    const m = this.m;
    if (m[0x200c]) return ((((0x0f - m[si + 2]) & 0xff) << 8) | ((((0x0f - m[si + 1]) & 0xffff) << 4) & 0xffff) | ((0x0f - m[si]) & 0xffff)) & 0xffff;
    return (m[si + 2] << 8) | (m[si + 1] << 4) | m[si];
  }
  writeAll() { for (let i = 0; i < 16; i++) this.setDac(i, this.palWord(0x1f92 + i * 3) & 0xffff); }
  palApproach(src) {                                              // 233b..235b: 48 個值各朝目標走 1, 回傳是否有變化
    const m = this.m; let ch = 0;
    for (let i = 0; i < 0x30; i++) { const t = src[i], c = m[0x1f92 + i]; if (c !== t) { ch = 1; m[0x1f92 + i] = c > t ? c - 1 : c + 1; } }
    return ch;
  }
  async palStep(src) { const ch = this.palApproach(src); if (ch) { this.writeAll(); await this.waitTicks(1); } return ch; }        // 232c
  async palStepAnim(src) { const ch = this.palApproach(src); if (ch) { this.writeAll(); await this.wait317a(6); } return ch; }    // 23d9
  async palFade(src) { while (await this.palStep(src)); }          // 2486
  async palFadeAnim(src) { while (await this.palStepAnim(src)); }  // 2499
  dsPal(o) { return this.m.slice(o, o + 0x18); }
  mkPal(lo, hi) { const p = new Uint8Array(0x30); p.set(lo); p.set(hi, 0x18); return p; }
  palUpper(src24) { return this.mkPal(this.m.subarray(0x1f92, 0x1faa), src24); }   // 24fe: 前 8 色 = 目前, 後 8 色 = src
  async fadeUpper(o) { await this.palFade(this.palUpper(this.dsPal(o))); }        // 2527
  async fadeUpperAnim(o) { await this.palFadeAnim(this.palUpper(this.dsPal(o))); }   // 2542
  async fadeBlackAll() { await this.palFade(new Uint8Array(0x30)); }             // 24b5
  async fadeTo048e() { await this.palFade(this.m.slice(0x048e, 0x048e + 0x30)); }   // 24ac (DS:048e 起 48 bytes 為目標)
  async dimLower() {                                              // 24d3: 前 8 色 >>1, 後 8 色不變
    const p = new Uint8Array(0x30);
    for (let i = 0; i < 0x18; i++) { p[i] = this.m[0x1f92 + i] >> 1; p[0x18 + i] = this.m[0x1faa + i]; }
    await this.palFade(p);
  }
  setUpperNow(o) {                                                 // 255d: 後 8 色立即設定
    for (let i = 0; i < 0x18; i++) this.m[0x1faa + i] = this.m[o + i];
    this.writeAll();
  }
  // ---- 畫面 (索引幀緩衝的位元平面存取; o = 列 × 80 + 欄, 遊戲區 0..31999) ----
  planeGet(p, o) {
    const fb = this.scr.fb, x = o * 8; let v = 0;
    for (let i = 0; i < 8; i++) v = (v << 1) | ((fb[x + i] >> p) & 1);
    return v;
  }
  planeSet(p, o, v) {
    const fb = this.scr.fb, x = o * 8, bit = 1 << p;
    for (let i = 0; i < 8; i++) { if ((v >> (7 - i)) & 1) fb[x + i] |= bit; else fb[x + i] &= ~bit; }
    this.scr.dirty = true;
  }
  clip(col, y, w, h) {                                            // 03d36: 成功 → 遊戲區內 VRAM 偏移 (不含 40 行), 失敗 -1
    if (col > 0x4f || !w || col + w > 0x50 || y > 0x18f || !h || y + h > 0x190) return -1;
    return y * 80 + col;
  }
  cls() { this.scr.fb.fill(0); this.scr.dirty = true; }          // 4410: 寫入模式 2 清整個 VRAM (480 行)
  fill(col, y, w, h, color) { this.scr.fillCols(col, y, w, h, color); }   // 451f (= seg0:0906)
  // 3fd6 / 4033 / 415e (= seg0:02ab / 0451): 4 平面交錯 (每欄 4 bytes) 貼到畫面; 模式 (低 15 位元, 跳躍表 cs:3ea5)
  //   0 覆寫 (bit15 = 每列畫兩次)、1 XOR / 2 AND / 3 OR (圖形控制器功能 18h / 08h / 10h, 以鎖存器運算)、4 透明 (位元遮罩 = 4 平面 OR, 色 0 不畫)
  put(col, y, w, h, mode, buf, off) {
    const m = mode & 0x7fff;
    if (m === 0) { this.scr.putPlanar(col, y, w, h, buf, off, !!(mode & 0x8000)); return; }
    if (m > 4 || this.clip(col, y, w, h) < 0) return;
    const fb = this.scr.fb;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++, off += 4) {
      const b0 = buf[off & 0xffff], b1 = buf[(off + 1) & 0xffff], b2 = buf[(off + 2) & 0xffff], b3 = buf[(off + 3) & 0xffff];
      const o = (y + r) * 640 + (col + c) * 8;
      for (let i = 0; i < 8; i++) {
        const s = 7 - i, v = ((b0 >> s) & 1) | (((b1 >> s) & 1) << 1) | (((b2 >> s) & 1) << 2) | (((b3 >> s) & 1) << 3);
        if (m === 1) fb[o + i] ^= v; else if (m === 2) fb[o + i] &= v; else if (m === 3) fb[o + i] |= v; else if (v) fb[o + i] = v;
      }
    }
    this.scr.dirty = true;
  }
  tile(col, y, w, h, buf, off) { this.scr.tile(col, y, w, h, buf, off); }   // 44bf (= seg0:08a6)
  // 415e → 4051 模式 0: 3 平面交錯 (每欄 3 bytes, 序列器遮罩 1 / 2 / 4), 平面 3 不動; bit15 = 每列畫兩次
  put3(col, y, w, h, buf, off, dbl = false) {
    if (this.clip(col, y, w, h) < 0) return;
    const fb = this.scr.fb;
    for (let r = 0; r < h; r++) {
      const rs = off;
      for (let k = 0; k < (dbl ? 2 : 1); k++) {
        off = rs; const o0 = (y + r * (dbl ? 2 : 1) + k) * 640 + col * 8;
        for (let c = 0; c < w; c++, off += 3) {
          const b0 = buf[off & 0xffff], b1 = buf[(off + 1) & 0xffff], b2 = buf[(off + 2) & 0xffff], o = o0 + c * 8;
          for (let i = 0; i < 8; i++) { const s = 7 - i; fb[o + i] = (fb[o + i] & 8) | ((b0 >> s) & 1) | (((b1 >> s) & 1) << 1) | (((b2 >> s) & 1) << 2); }
        }
      }
    }
    this.scr.dirty = true;
  }
  glyphMode(col, y, w, h, attr, buf, off) { this.scr.glyphMode(col, y, w, h, buf.subarray(off), attr); }   // 4236 / 423e (= seg0:0572)
  glyphOpaque(col, y, w, h, attr, buf, off) { this.scr.glyph(col, y, w, h, buf.subarray(off), attr & 0xff, 0, (attr >> 8) & 0xff); }   // 426c
  // 2c88: 畫面一個平面的矩形 → 緩衝 (逐列, w 為位元組數, 以字為單位複製 w>>1 個字)
  grabPlane(col, y, w, plane, buf, off, h) {
    const nw = w >> 1;
    for (let r = 0; r < h; r++) {
      const o = (y + r) * 80 + col;
      for (let k = 0; k < nw; k++) { buf[off++] = this.planeGet(plane, o + 2 * k); buf[off++] = this.planeGet(plane, o + 2 * k + 1); }
    }
  }
  grab3(col, y, w, buf, off, h) { const n = (h * w) & 0xffff; for (let p = 0; p < 3; p++) this.grabPlane(col, y, w, p, buf, (off + ((p * n) & 0xffff)) & 0xffff, h); }   // 2cff (buf 為段址 + off)
  grab4(col, y, w, buf, h) { const n = (h * w) & 0xffff; for (let p = 0; p < 4; p++) this.grabPlane(col, y, w, p, buf, (p * n) & 0xffff, h); }   // 2d73
  // 498c: 4 平面交錯 → 緩衝 (每位元組欄 4 bytes, 平面 0..3)
  getImage(col, y, w, h, buf, off) {
    if (this.clip(col, y, w, h) < 0) return -1;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const o = (y + r) * 80 + col + c; for (let p = 0; p < 4; p++) buf[off++] = this.planeGet(p, o); }
    return 0;
  }
  // 59ce: 網點溶入一個平面 (遮罩字 cs:59ca 每列旋轉 (剩餘列數 & 7) + 1, 呼叫結束再轉 5); setup ≠ 0 時只設定 遮罩 = setup、平面 = seg
  dissolve(col, y, w, h, seg, buf, off, setup) {
    if (setup) { this.cs59ca = setup; this.cs59cc = seg; return; }
    const base = this.clip(col, y, w, h); if (base < 0) return;
    const pl = { 0xa800: 0, 0xb000: 1, 0xb800: 2, 0xe000: 3 }[this.cs59cc];
    if (pl === undefined) throw new Error("59ce seg " + this.cs59cc.toString(16));
    const nw = w >> 1;
    let di = base;
    for (let rows = h; rows; rows--) {
      const dx = this.cs59ca, bx = ~dx & 0xffff;
      for (let k = 0; k < nw; k++) {
        const o = di + 2 * k, ax = buf[off] | (buf[off + 1] << 8); off += 2;
        const cur = this.planeGet(pl, o) | (this.planeGet(pl, o + 1) << 8);
        const v = (cur & bx) | (ax & dx);
        this.planeSet(pl, o, v & 0xff); this.planeSet(pl, o + 1, v >> 8);
      }
      this.cs59ca = edRor16(this.cs59ca, (rows & 7) + 1);
      di += 80;
    }
    this.cs59ca = edRor16(this.cs59ca, 5);
  }
  // 5a7b: 平面 0..2 的每列左移一個位元組欄 (最右補 0)
  shiftLeft(col, y, w, h) {
    let di = y * 80 + col;
    for (let r = 0; r < h; r++, di += 80) for (let p = 0; p < 3; p++) {
      for (let k = 0; k < w; k++) this.planeSet(p, di + k, this.planeGet(p, di + k + 1));
      this.planeSet(p, di + w, 0);
    }
  }
  // ---- 檔案 ([025a]: EVENT / ENDGRP) ----
  be32(o) { const f = this.file; return ((f[o] << 24) | (f[o + 1] << 16) | (f[o + 2] << 8) | f[o + 3]) >>> 0; }
  openEvent(n) { this.sb(0x04e1, 0x30 + n); this.file = this.data.events[n]; }   // DS:04e1 = "*.DAT" 的 '*'; 0e2c("B:EVENTn.DAT")
  // 2aa4: 圖像 n 畫在 (x 像素, y) (16 色有圖樣表 50c0; #0x3a 固定偏移 0x61232、8 色 50d4)
  drawGraph(n, x, y) {
    if (n === 0x3a) { decodeGraph(this.scr.fb, this.file, x, y, false, 0x61232); this.scr.dirty = true; return; }
    if (n * 4 + 4 > this.file.length) return;
    decodeGraph(this.scr.fb, this.file, x, y, true, this.be32(n * 4)); this.scr.dirty = true;
  }
  // 29ed: 第 n 項讀 0x8000 bytes 到 [200a] 緩衝, 以 50fc 解碼成 4 平面交錯 (每 8 像素 4 bytes) 到 dst
  loadPic(dst, n) {
    const tmp = this.ptr(this.w(0x200a)), o = this.be32(n * 4);
    const src = this.file.subarray(o, o + 0x8000); tmp.set(src);
    this.decodeToBuf(dst, tmp);
  }
  // 50fc: GRAPH 16 色格式 (graphdec.js) 解碼到記憶體 — 單位 n 在 (n>>1)*4 的 4 個位元組, n 偶數用高半位元組、奇數用低半位元組
  decodeToBuf(dst, src) {
    let p = 0;
    const rd = () => src[p++ & 0xffff];
    const w = rd() | ((rd() & 0x7f) << 8), h = rd() | (rd() << 8);
    const units = ((w + 3) & 0xffff) >> 2;
    const T = new Uint16Array(8); for (let i = 0; i < 8; i++) { const lo = rd(); T[i] = lo | (rd() << 8); }
    const get = n => { const o = (n >> 1) * 4, sh = (n & 1) ? 0 : 4; let P = 0; for (let k = 0; k < 4; k++) P |= ((dst[(o + k) & 0xffff] >> sh) & 15) << (4 * k); return P; };
    const put = (n, P) => { const o = (n >> 1) * 4; for (let k = 0; k < 4; k++) { const v = (P >> (4 * k)) & 15, a = (o + k) & 0xffff; dst[a] = (n & 1) ? (dst[a] & 0xf0) | v : (dst[a] & 0x0f) | (v << 4); } };
    let di = 0;
    for (let row = h & 0xffff; row; row--) {
      const rowStart = di; let rem = units;
      for (;;) {
        const c = rd(); let count;
        if (c & 0x80) {
          count = (c & 15) + 1;
          const back = (c & 0x40) ? units * (((c >> 4) & 3) + 1) : ((c >> 4) & 3) + 1;
          for (let k = 0; k < count; k++) put((di + k) & 0xffff, get((di + k - back) & 0xffff));
        } else {
          count = (c & 7) + 1;
          const s = c & 0x78; let P;
          if (s === 0) P = 0;
          else if (s & 0x40) P = T[(c >> 3) & 7];
          else if (s === 0x38) { const hi = rd(); P = (hi << 8) | rd(); }
          else {
            const b = rd();
            switch (s) {
              case 0x08: P = b; break;
              case 0x10: P = ((b >> 4) << 8) | (b & 15); break;
              case 0x18: P = ((b & 0xf0) << 8) | (b & 15); break;
              case 0x20: P = b << 4; break;
              case 0x28: P = ((b & 0xf0) << 8) | ((b & 15) << 4); break;
              case 0x30: P = b << 8; break;
            }
          }
          for (let k = 0; k < count; k++) put((di + k) & 0xffff, P);
        }
        di = (di + count) & 0xffff;
        if (rem <= count) break;
        rem -= count;
      }
      di = (rowStart + units) & 0xffff;
    }
  }
  // ---- 文字輸出 (1f74; 狀態 [0e24] 欄 [0e26] y [0e28] 行高 [0e2a] 左界 [0e2c] 右界 [0e30] 模式 [0e31] 前景 [0e32] 背景 [0e33] [0e34] 首碼 [0e36] 跳脫狀態) ----
  clampCursor() {                                                 // 1ac6
    let x = edS16(this.w(0x0e24)), y = edS16(this.w(0x0e26));
    x = x < 0 ? 0 : Math.min(x, 0x4f); y = y < 0 ? 0 : Math.min(y, 0x190);
    this.sw(0x0e24, x); this.sw(0x0e26, y);
  }
  setCursor(x, y) { if (edS16(x) >= 0) this.sw(0x0e24, x); if (edS16(y) >= 0) this.sw(0x0e26, y); this.clampCursor(); }   // 1b09
  newline() {                                                     // 1f1c: 已在行首時不動作
    if (this.w(0x0e2a) === this.w(0x0e24)) return;
    this.sw(0x0e24, this.w(0x0e2a));
    if (edS16(this.w(0x0e26) + this.w(0x0e28)) <= 0x190) this.sw(0x0e26, this.w(0x0e26) + this.w(0x0e28));
  }
  async control(ch) {                                             // 1f3f
    switch (ch) {
      case 0x07: await this.beep(3); break;
      case 0x08: if (edS16(this.w(0x0e24)) >= 1) this.sw(0x0e24, this.w(0x0e24) - 1); break;
      case 0x0a: this.newline(); break;
      case 0x0d: this.sw(0x0e24, this.w(0x0e2a)); break;
    }
  }
  loadGlyph(code) {                                               // 1dad → [200e..202d], [1f90] = 寬 (位元組)
    const m = this.m; m[0x202a] = m[0x202b] = m[0x202c] = m[0x202d] = 0;
    if ((code >= 0x8130 && code <= 0xaf68) || (code >= 0xb030 && code <= 0xd8c3)) {
      m.set(this.font.kanjiRows(code), 0x200e); this.sw(0x1f90, 2);
    } else if (code < 0x200) {
      const r = this.font.rom; for (let i = 0; i < 8; i++) { const v = (code & 0xff) < 128 ? r[(code & 0xff) * 8 + i] : 0; m[0x200e + 2 * i] = m[0x200f + 2 * i] = v; }
      this.sw(0x1f90, 1);
    }
  }
  async putc(ch) {                                                // 1f74
    ch &= 0xff;
    const st = this.w(0x0e36);
    if (st >= 1 && st <= 8) return this.escape(st, ch);
    let di;
    if (this.b(0x0e34)) { di = (this.b(0x0e34) << 8) + ch; this.sb(0x0e34, 0); }
    else {
      if ((ch >= 0x81 && ch <= 0xaf) || (ch >= 0xb0 && ch <= 0xd8)) { this.sb(0x0e34, ch); return; }
      if (ch === 0x1b) { this.sw(0x0e36, 1); return; }
      if (ch < 0x20) { await this.control(ch); return; }
      di = ch;
    }
    const limit = di >= 0x200 ? 0x4e : 0x4f;
    if (limit < edS16(this.w(0x0e24))) this.newline();
    const attr = ((this.b(0x0e32) || this.b(0x0e30)) << 8) | this.b(0x0e31);
    this.loadGlyph(di);
    const x = this.w(0x0e24), y = this.w(0x0e26), w = this.w(0x1f90);
    if (this.b(0x0e32)) this.glyphOpaque(x, y, w, 0x10, attr, this.m, 0x200e);   // 1ef3 → DS:0e18[1] = 426c
    else this.glyphMode(x, y, w, 0x10, attr, this.m, 0x200e);                    //            DS:0e18[0] = 4236
    this.sw(0x0e24, this.w(0x0e24) + (di >= 0x200 ? 2 : 1));
    if (edS16(this.w(0x0e24)) > edS16(this.w(0x0e2c))) this.newline();
  }
  escape(st, c) {                                                 // 1f86 跳躍表 cs:1f8b (狀態 1..8)
    switch (st) {
      case 1:                                                     // 2064
        if (c === 0x3d) this.sw(0x0e36, 2); else if (c === 0x42) this.sw(0x0e36, 7); else if (c === 0x43) this.sw(0x0e36, 4);
        else if (c === 0x46) this.sw(0x0e36, 8); else if (c === 0x4d) this.sw(0x0e36, 6); else if (c === 0x52) this.sw(0x0e36, 5);
        return;                                                   // 其他字元: 狀態不變 (原版如此)
      case 2: this.sw(0x0e26, ((c - 0x20) << 3) & 0xffff); this.clampCursor(); this.sw(0x0e36, 3); return;   // 20c0 (1b01)
      case 3: this.sw(0x0e24, (c - 0x20) & 0xffff); this.clampCursor(); break;                               // 20d8 (1af9)
      case 4: {                                                   // 20e6 ESC C
        let n = (c - 0x30) & 0xff;
        if (this.b(0x200c)) { if (n < 4) n = 0; else if (n < 7) n = 4; }
        if (n <= 0x0f) this.sb(0x0e31, n);                        // 1b1d
        break;
      }
      case 5: this.sw(0x0e2a, (c - 0x20) & 0xffff); break;        // 2112 ESC R
      case 6: this.sb(0x0e30, c - 0x30); break;                   // 211f ESC M
      case 7: this.sb(0x0e32, c - 0x30); break;                   // 2129 ESC B
      case 8: this.sb(0x0e33, c - 0x30); break;                   // 2133 ESC F
    }
    this.sw(0x0e36, 0);                                           // 213b
  }
  async puts(o) { const s = this.str(o); for (let i = 0; i < s.length; i++) await this.putc(s[i]); }   // 214a (DS 字串)
  // 215b / 1868: printf (格式與 MAIN.EXE seg0:4194 相同, ui/printf.js); 字串參數為 DS 偏移
  async printf(fmt, ...args) {
    const out = [];
    cprintf(this.str(fmt), args.map(a => (typeof a === "object" ? a : a)), ch => out.push(ch));
    for (const ch of out) await this.putc(ch);
  }
  dsArg(o) { return this.str(o); }
  async typeSlow(o) {                                             // 37cc: 逐字輸出, 每字 317a(3); 回傳字數
    const s = this.str(o); let n = 0;
    for (let i = 0; i < s.length; i++) { await this.putc(s[i]); await this.wait317a(3); n = (n + 1) & 0xff; }
    return n;
  }
  // ---- 動畫等待 ----
  anim3146() {                                                     // 3146: 兩格交替 (DS:1fe6[[0e3e]]) 於 (3c, 1e) 20×68
    const h = this.w(0x1fe6 + 2 * this.b(0x0e3e));
    this.put(0x3c, 0x1e, 0x14, 0x68, 0, this.ptr(h), 0);
    this.sb(0x0e3e, this.b(0x0e3e) ^ 1);
  }
  async wait317a(n) {                                             // 317a: n tick, 每 [0044]+1 tick 換一格
    for (let i = 0; i < edS16(n); i++) {
      this.timerSet(1);
      this.sb(0x0e3f, this.b(0x0e3f) + 1);
      if (this.b(0x0e3f) > this.b(0x0044)) { this.anim3146(); this.sb(0x0e3f, 0); }
      while (this.timerGet()) await this.poll();
    }
  }
  anim31bc() { if (this.b(0x0044) < this.b(0x0e3f)) { this.anim3146(); this.sb(0x0e3f, 0); } }   // 31bc
  // 31cf: 4 格循環 (圖 DS:1fd6[0a / 0c / 0a / 0b]) 於 (ax, dx) w × h
  animPut4(col, y, w, h) {
    const k = this.b(0x0e3e), idx = k === 1 ? 0x0c : k === 3 ? 0x0b : 0x0a;
    this.put(col, y, w, h, 0, this.ptr(this.w(0x1fd6 + 2 * idx)), 0);
    this.sb(0x0e3e, this.b(0x0e3e) + 1); if (this.b(0x0e3e) > 3) this.sb(0x0e3e, 0);
  }
  anim3239() {                                                     // 3239: 依主角 1..4
    switch (this.w(0x1fc2)) {
      case 1: this.animPut4(4, 0xb6, 3, 0x20); break;
      case 2: this.animPut4(3, 0xce, 3, 0x28); break;
      case 3: this.animPut4(4, 0x128, 2, 0x28); break;
      case 4: this.animPut4(4, 0xce, 2, 0x20); break;
    }
  }
  anim3282() {                                                     // 3282: 主角 5 的 4 格循環 (1fec / 1fee / 1fec / 1fea) 於 (1c, 56) 6×18
    const k = this.b(0x0e3e);
    const h = k === 0 || k === 2 ? this.w(0x1fec) : k === 1 ? this.w(0x1fee) : k === 3 ? this.w(0x1fea) : -1;
    if (h >= 0) this.put(0x1c, 0x56, 6, 0x18, 0, this.ptr(h), 0);
    this.sb(0x0e3e, this.b(0x0e3e) + 1); if (this.b(0x0e3e) > 3) this.sb(0x0e3e, 0);
  }
  // 303c: 工作人員名單捲動一步 (每 3 次呼叫一次; [0e42] 名單緩衝位置, [0e44] 出現中的高度)
  credits() {
    this.sb(0x0e40, this.b(0x0e40) + 1);
    if (this.b(0x0e40) < 3) return;
    this.sb(0x0e40, 0);
    const buf = this.ptr(this.w(0x2006));
    if (this.w(0x0e42) >= 0x4ce0) { this.fill(0x30, 0xd2, 0x1e, 1, 0); return; }
    if (this.w(0x0e44) < 0x12c0) {
      const hh = Math.floor(this.w(0x0e44) / 0x1e);
      this.glyphMode(0x30, (0x172 - hh) & 0xffff, 0x1e, hh, 7, buf, 0);
      this.sw(0x0e44, this.w(0x0e44) + 0x1e); return;
    }
    if (this.w(0x0e42) < 0x3a20) this.glyphMode(0x30, 0xd2, 0x1e, 0xa0, 7, buf, this.w(0x0e42));
    else {
      const hh = Math.floor((0x4ce0 - this.w(0x0e42)) / 0x1e);
      this.glyphMode(0x30, 0xd2, 0x1e, hh, 7, buf, this.w(0x0e42));
      this.fill(0x30, (hh + 0xd2) & 0xffff, 0x1e, 1, 0);
    }
    this.sw(0x0e42, this.w(0x0e42) + 0x1e);
  }
  async wait32d6(n) {                                             // 32d6 (主角 5): 每 2 tick 一步, 動畫間隔 [0045] 交替 0xf0 / 3
    for (let i = 0; i < (n & 0xff); i++) {
      this.timerSet(2);
      this.sb(0x0e3f, this.b(0x0e3f) + 1);
      if (this.b(0x0e3f) > this.b(0x0045)) { this.anim3282(); this.sb(0x0045, this.b(0x0e3e) < 1 ? 0xf0 : 3); this.sb(0x0e3f, 0); }
      this.credits();
      while (this.timerGet()) await this.poll();
    }
  }
  async wait332d(n) {                                             // 332d: 名單捲動中的等待 (每 2 tick 一步)
    if (this.w(0x1fc2) === 5) { await this.wait32d6(n); return; }
    for (let i = 0; i < (n & 0xff); i++) {
      this.timerSet(2);
      this.sb(0x0e3f, this.b(0x0e3f) + 1);
      if (this.b(0x0e3f) > this.b(0x0045)) { this.anim3239(); this.sb(0x0e3f, 0); }
      this.credits();
      while (this.timerGet()) await this.poll();
    }
  }
  async wait2dee() {                                              // 2dee: 溶入每一步之間的等待
    if (!this.w(0x0048)) { await this.waitTicks(5); return; }
    const v = this.w(0x0046);
    if (v === 0) await this.wait317a(5); else if (v === 1) await this.wait332d(3);
  }
  // 2e1a: 3 平面圖 (緩衝, 各平面 h×w) 以網點溶入 (col, y), 第 3 平面期間調色盤後 8 色朝 pal 走; 回傳 [bp+8]
  async dissolve3(col, y, w, pal, buf, off, h) {
    const P = this.palUpper(this.dsPal(pal)), n = (h * w) & 0xffff;
    this.dissolve(0, 0, 0, 0, 0xa800, null, 0, 0x8000);
    for (let i = 0; i < 0x10; i++) { this.dissolve(col, y, w, h, 0, buf, off, 0); await this.wait2dee(); }
    this.dissolve(0, 0, 0, 0, 0xb000, null, 0, 0x8000);
    for (let i = 0; i < 0x10; i++) { this.dissolve(col, y, w, h, 0, buf, (off + n) & 0xffff, 0); await this.wait2dee(); }
    this.dissolve(0, 0, 0, 0, 0xb800, null, 0, 0x8000);
    for (let i = 0; i < 0x10; i++) { this.dissolve(col, y, w, h, 0, buf, (off + 2 * n) & 0xffff, 0); await this.palStep(P); await this.wait2dee(); }
  }
  async dissolve4(col, y, w, buf, h) {                            // 2f11: 4 平面圖 (緩衝 0 起) 溶入
    const n = (h * w) & 0xffff;
    for (const [seg, k] of [[0xa800, 0], [0xb000, 1], [0xb800, 2], [0xe000, 3]]) {
      this.dissolve(0, 0, 0, 0, seg, null, 0, 0x8000);
      for (let i = 0; i < 0x10; i++) { this.dissolve(col, y, w, h, 0, buf, (k * n) & 0xffff, 0); await this.wait2dee(); }
    }
  }
  // ---- 視窗 (END_PUT.DAT = [1fc4]; 背景存在 [203c] 的堆疊, 指標 [1ffa]) ----
  mouseShow() {}                                                  // 2655 INT 33h fn 1 (網頁版不另外畫游標)
  mouseHide() {}                                                  // 2679 INT 33h fn 2
  saveBg(col, y, w, h) {                                          // 288e: 背景 → 堆疊, 再放 8 bytes 標頭 (欄, y, 寬, 高)
    this.mouseHide();
    const buf = this.ptr(this.w(0x203c)), at = this.w(0x1ffa);
    this.sw(0x1ffa, (at + ((h * w) & 0xffff) * 4) & 0xffff);
    this.getImage(col, y, w, h, buf, at);
    const p = this.w(0x1ffa);
    const put16 = (o, v) => { buf[o & 0xffff] = v & 255; buf[(o + 1) & 0xffff] = (v >> 8) & 255; };
    put16(p, col); put16(p + 2, y); put16(p + 4, w); put16(p + 6, h);
    this.sw(0x1ffa, this.w(0x1ffa) + 8);
    this.mouseShow();
  }
  async restoreBg() {                                             // 3ad6: 從中間往上下兩端逐 8 行還原, 每步 1 tick
    this.mouseHide();
    const buf = this.ptr(this.w(0x203c)), bx = this.w(0x1ffa);
    const g8 = o => buf[o & 0xffff], g16 = o => buf[o & 0xffff] | (buf[(o + 1) & 0xffff] << 8);
    const col = g8(bx - 8), y = g16(bx - 6), w = g8(bx - 4), h = g16(bx - 2);
    this.sw(0x1ffa, (this.w(0x1ffa) + (((-(((w * h) & 0xffff) - 0xfffe)) & 0xffff) << 2)) & 0xffff);
    let top = this.w(0x1ffa), bot = (((edS16((h - 8) & 0xffff) * w) << 2) + this.w(0x1ffa)) & 0xffff;
    const steps = Math.trunc(edS16(h) / 16) + 1;
    for (let k = 0; steps > k; k++) {
      this.put(col, (y + (k << 3)) & 0xffff, w, 8, 0, buf, top);
      this.put(col, (((0xffff - k) << 3) + h + y) & 0xffff, w, 8, 0, buf, bot);
      await this.waitTicks(1);
      top = (top + (w << 5)) & 0xffff; bot = (bot - (w << 5)) & 0xffff;
    }
    this.mouseShow();
  }
  async closeAll() { while (this.w(0x1ffa)) await this.restoreBg(); this.sb(0x1cd2, 0); }   // 3cfd
  // 3876: 開視窗動畫 (從中央向左右展開, END_PUT 框圖 style), 之後 [0e2a] = col+2、[0e2c] = col+w-3、游標 (?, y+0x10)
  async openWin(col, y, w, style, h) {
    const P = this.ptr(this.w(0x1fc4)), base = ((style << 7) - 0x61e0) & 0xffff;
    this.saveBg(col, y, w, h);
    await this.puts(0x1cc8);
    let L = (((Math.trunc(edS16((w - 1) & 0xffff) / 2)) + col - 1)) & 0xffff;
    let R = ((Math.trunc(edS16((1 - w) & 0xffff) / 2)) + w + col) & 0xffff;
    const half = Math.trunc(edS16((w - 1) & 0xffff) / 2);
    const si = y;
    for (let k = 0; half > k; k++) {
      this.put(L, si, 1, 8, 0, P, 0x9da0);
      const di = (1 + L) & 0xffff;
      this.put(di, si, 1, 8, 0, P, base);
      this.put(R, si, 1, 8, 0, P, 0x9dc0);
      const r1 = (R - 1) & 0xffff;
      this.put(r1, si, 1, 8, 0, P, base);
      const hh = (h - 0x10) & 0xffff;
      this.tile(L, si + 8, 1, hh, P, (base + 0x20) & 0xffff);
      this.tile(R, si + 8, 1, hh, P, (base + 0x40) & 0xffff);
      this.fill(di, si + 8, 1, hh, 7);
      this.fill(r1, si + 8, 1, hh, 7);
      const yb = (h + si - 8) & 0xffff;
      this.put(L, yb, 1, 8, 0, P, 0x9de0);
      this.put(di, yb, 1, 8, 0, P, (base + 0x60) & 0xffff);
      this.put(R, yb, 1, 8, 0, P, 0x9e00);
      this.put(r1, yb, 1, 8, 0, P, (base + 0x60) & 0xffff);
      await this.waitTicks(1);
      L = (L - 1) & 0xffff; R = (R + 1) & 0xffff;
    }
    this.sw(0x0e2c, (w + col - 3) & 0xffff);
    this.sw(0x0e2a, (col + 2) & 0xffff);
    this.setCursor((col + 2) & 0xffff, (y + 0x10) & 0xffff);
  }
  face(col, y, n) { this.put3(col, y, 8, 0x50, this.ptr(this.w(0x1fc4)), (n * 0x780) & 0xffff); }   // 3bd2 (415e)
  async talkTop(face, fmt, ...args) {                             // 3c01: 上方視窗 (頭像在左)
    if (!(this.b(0x1cd2) & 1)) await this.openWin(0x0d, 0x10, 0x27, 0, 0x90);
    this.face(0x0f, 0x20, face & 0xff);
    this.fill(0x18, 0x20, 0x1a, 0x70, 7);
    this.setCursor(0x18, 0x20);
    this.sw(0x0e2a, 0x18); this.sw(0x0e2c, 0x31);
    await this.printf(fmt, ...args);
    await this.prompt();
    this.sb(0x1cd2, this.b(0x1cd2) | 1);
  }
  async talkBottom(face, fmt, ...args) {                          // 3c7f: 下方視窗
    if (!(this.b(0x1cd2) & 2)) await this.openWin(0x14, 0xb0, 0x27, 0, 0x90);
    this.face(0x16, 0xc0, face & 0xff);
    this.fill(0x1f, 0xc0, 0x1a, 0x70, 7);
    this.setCursor(0x1f, 0xc0);
    this.sw(0x0e2a, 0x1f); this.sw(0x0e2c, 0x38);
    await this.printf(fmt, ...args);
    await this.prompt();
    this.sb(0x1cd2, this.b(0x1cd2) | 2);
  }
  // 0f34: ▽ 等待提示 (左右界中間、目前行或下一行; 每 0.4 秒亮滅, Enter/Esc/'0'/滑鼠 繼續)
  async prompt() {
    await this.waitNoInput();
    const di = (Math.trunc(edS16((this.w(0x0e2c) - this.w(0x0e2a)) & 0xffff) / 2) + this.w(0x0e2a)) & 0xffff;
    const si = this.w(0x0e2a) === this.w(0x0e24) ? this.w(0x0e26) : (this.w(0x0e26) + 0x18) & 0xffff;
    this.mouseHide();
    this.saveBg(di, si, 2, 0x10);
    this.sw(0x1ffa, this.w(0x1ffa) - 0x88);
    await this.waitNoInput();
    const P = this.ptr(this.w(0x1fc4)), S = this.ptr(this.w(0x203c));
    for (;;) {
      this.glyphMode(di, si, 2, 0x10, 0x402, P, 0x9d80);
      if (await this.waitOrKeyTenths(4)) { this.put(di, si, 2, 0x10, 0, S, this.w(0x1ffa)); break; }
      this.put(di, si, 2, 0x10, 0, S, this.w(0x1ffa));
      if (await this.waitOrKeyTenths(4)) break;
    }
    await this.waitNoInput();
    this.mouseShow();
  }
  // ---- 場景 ----
  async f160d() {                                                 // 0160d: 序幕 (樂曲 0、GRAPH #0x38、各主角的對話)
    await this.playSong(0);
    this.drawGraph(0x38, 0, 0);
    await this.palFade(this.m.slice(0x042e, 0x045e));
    if (this.w(0x0042)) await PROLOGUES[this.w(0x1fc2)](this);   // far call DS:0e00[[1fc2]]
    else await this.f155d();
    this.musicFade(0x14);
    await this.fadeBlackAll();
    this.cls();
    this.sw(0x0e2a, 0); this.sw(0x0e2c, 0x50); this.sw(0x0e28, 0x18);
  }
  async f155d() {                                                 // 0155d: 爵位 9 的對話
    const S = () => this.str(0x1fc6), N = () => this.str(0x202e);
    await this.talkTop(this.w(0x1fd4) + 6, 0x0cf7, S(), N());
    await this.talkBottom(this.w(0x1fc2), 0x0d24);
    await this.talkTop(this.w(0x1fd4) + 6, 0x0d2f, S());
    await this.talkBottom(this.w(0x1fc2), 0x0d81);
    await this.finalWords(0x0d8e, S(), N());
  }
  // 01509 / 0155d / 01008 … 共同的結尾: 關閉視窗、主角圖、最後一段話
  async finalWords(fmt, ...args) {
    await this.closeAll();
    this.put(0x1c, 0x60, 0x18, 0x90, 0, this.ptr(this.w(0x1fde)), 0);
    this.sw(0x0e2c, 0x36); this.sw(0x0e2a, 0x18); this.setCursor(0x18, 0xf8); this.sw(0x0e28, 0x14);
    await this.printf(fmt, ...args);
    await this.prompt();
  }
  loadPics3(table, n) { for (let i = 0; i < 3; i++) this.loadPic(this.ptr(this.w(table + 2 * i)), (n + i) & 0xffff); }   // 0600 / 058b
  f063e() {                                                       // 0063e
    this.loadPic(this.ptr(this.w(0x1fe6)), 8);
    this.loadPic(this.ptr(this.w(0x1fe8)), 9);
    const n = { 1: 0x14, 2: 0x1b, 3: 0x2a, 4: 0x22, 5: 0x32 }[this.w(0x1fc2)];
    if (n !== undefined) this.loadPics3(0x1fea, n);
  }
  f05c9() {                                                       // 005c9
    const n = [0x0c, 0x11, 0x18, 0x27, 0x1f, 0x2f][this.w(0x1fc2)];
    if (n !== undefined) this.loadPics3(0x1ff0, n);
  }
  async f0688() {                                                 // 00688: 序幕場景 (GRAPH #7 → 4 平面存到 [1fe4])
    this.drawGraph(7, 0, 0x1e);
    this.grab4(0x1a, 0x64, 0x22, this.ptr(this.w(0x1fe4)), 0xd0);
    await this.palFade(this.m.slice(0x027e, 0x02ae));
  }
  async wipeCols() {                                              // 02b94: 左側 12 × 12 行以色 8 由上往下蓋掉
    for (let a = 0; a < 0x0c; a++) {
      for (let b = 0; b < 0x0c; b++) this.fill(1, (a * 0x0c + b + 0x64) & 0xffff, 0x18, 1, 8);
      await this.wait317a(1);
    }
    this.anim31bc();
  }
  async revealPic(i) {                                            // 02bdd: 劇情插圖 i (4 平面交錯, 每列 0x60 bytes) 百葉窗式由下往上出現 (色 8 + OR)
    const buf = this.ptr(this.w(0x1fd6 + 2 * (i & 0xff)));
    for (let a = 0; a < 0x0c; a++) {
      for (let b = 0; b < 0x0c; b++) {
        const y = (0xf3 - a * 0x0c - b) & 0xffff;
        this.fill(1, y, 0x18, 1, 8);
        this.put(1, y, 0x18, 1, 3, buf, ((0x8f - a * 0x0c - b) * 0x60) & 0xffff);
      }
      await this.wait317a(1);
    }
    this.anim31bc();
  }
  async storyText(i) {                                            // 037f9: 9 行文字逐字打出 (DS:1a9e 表), 再等 (0x82 − 字數) × 3 tick
    let rest = 0x82;
    await this.puts(0x1cba);
    for (let j = 0; j < 9; j++) {
      this.setCursor(0x1a, (j * 0x18 + 0x64) & 0xffff);
      const si = (j + (this.w(0x1fc2) * 5 + (i & 0xff)) * 9) * 2;
      rest = (rest - await this.typeSlow(this.w(0x1a9e + si))) & 0xff;
    }
    await this.puts(0x1cc4);
    await this.wait317a((rest * 3) & 0xff);
  }
  async f06ba() {                                                 // 006ba: 序幕 5 段 (插圖 + 文字 + 場景溶回)
    for (let i = 0; i < 5; i++) {
      await this.wipeCols();
      this.setUpperNow(0x048e);
      await this.revealPic(i);
      await this.wait317a(0x78);
      await this.fadeUpperAnim(0x045e);
      await this.wait317a(0x3c);
      await this.storyText(i);
      await this.dissolve4(0x1a, 0x64, 0x22, this.ptr(this.w(0x1fe4)), 0xd0);
      await this.wait317a(0x3c);
    }
  }
  f0438() {                                                       // 00438
    this.fill(0, 0, 1, 0x190, 0); this.fill(0x19, 0, 0x37, 0x190, 0);
    this.fill(1, 0, 0x18, 0x64, 0); this.fill(1, 0xf4, 0x18, 0x9c, 0);
  }
  f07cc() {                                                       // 007cc: ENDGRP #0..6 畫在 (1a0, 0), 3 平面存到 [1fd6..1fe2]
    for (let i = 0; i < 7; i++) {
      this.drawGraph(i, 0x1a0, 0);
      this.grab3(0x34, 0, 0x1c, this.ptr(this.w(0x1fd6 + 2 * i)), 0, 0xa0);
    }
    this.fill(0x34, 0, 0x1c, 0xa0, 0);
  }
  async f0829() {                                                 // 00829: 工作人員名單 2 頁畫好後取平面 0 存到 [2006] (0 / 0x2670), 畫時色 7 設成黑
    const T = [0x6c, 0x8b, 0xaa, 0xb9, 0xd8, 0xef, 0x10e, 0x12d, 0x146, 0x165, 0x184, 0x1a3, 0x1c2, 0x1e1, 0x1ea, 0x209, 0x228];
    this.setDac(7, 0);
    await this.puts(0x0245);
    for (let si = 0; si < 0x0e; si++) { this.setCursor(0x32, ((si + 2) * 0x14) & 0xffff); await this.puts(T[si]); }
    const buf = this.ptr(this.w(0x2006));
    this.grabPlane(0x32, 0, 0x1e, 0, buf, 0, 0x148);
    this.fill(0x32, 0, 0x1e, 0x148, 0);
    for (let si = 0; si < 3; si++) { this.setCursor(0x32, (si * 0x14) & 0xffff); await this.puts(T[0x0e + si]); }
    this.grabPlane(0x32, 0, 0x1e, 0, buf, 0x2670, 0x148);
    this.fill(0x32, 0, 0x1e, 0x148, 0);
  }
  f0957() {                                                       // 00957: ENDGRP #0x35 → 3 平面存到 [2006]+0x4ce0
    this.drawGraph(0x35, 0x1c0, 0);
    this.grab3(0x38, 0, 0x18, this.ptr(this.w(0x2006)), 0x4ce0, 0x50);
    this.fill(0x38, 0, 0x18, 0x50, 0);
  }
  f072e() {                                                       // 0072e: 主角的圖 → 3 平面存到 [2008]
    const n = { 0: 0x0b, 1: 0x10, 3: 0x26, 5: 0x2e }[this.w(0x1fc2)];
    if (n !== undefined) this.drawGraph(n, 0x100, 0);
    const buf = this.ptr(this.w(0x2008));
    if (this.w(0x1fc2) !== 3) { this.grab3(0x20, 0, 0x30, buf, 0, 0x12c); this.fill(0x20, 0, 0x30, 0x12c, 0); }
    else { this.grab3(0x20, 0, 0x26, buf, 0, 0x180); this.fill(0x20, 0, 0x26, 0x180, 0); }
    this.sb(0x0e3f, 0);
  }
  f04d6(col, y, w, n, h) {                                        // 004d6: [025a] 第 n 項解到 [1fe4] 後畫出, 位置存 [0064..006a]
    const buf = this.ptr(this.w(0x1fe4));
    this.loadPic(buf, n & 0xff);
    this.put(col, y, w, h, 0, buf, 0);
    this.sw(0x0064, col); this.sw(0x0066, y); this.sw(0x0068, w); this.sw(0x006a, h);
  }
  f052a() {                                                       // 0052a
    switch (this.w(0x1fc2)) {
      case 0: this.f04d6(0x20, 0x1e, 0x30, 0x0a, 0x12c); break;
      case 1: this.f04d6(0x20, 0x1e, 0x30, 0x0f, 0x12c); break;
      case 2: this.f04d6(0x20, 0x1e, 0x30, 0x17, 0x12c); break;
      case 3: this.f04d6(0x2a, 0, 0x26, 0x25, 0x180); break;
      case 4: this.f04d6(0x20, 0x1e, 0x30, 0x1e, 0x12c); break;
      case 5: this.f04d6(0x20, 0x1e, 0x30, 0x2d, 0x12c); break;
    }
  }
  async f0499() {                                                 // 00499: 上面畫的圖每 tick 左移一欄, 共 [0064] 次
    for (let si = edS16(this.w(0x0064)) - 1; si >= 0; si--) {
      this.timerSet(1);
      this.shiftLeft(si, this.w(0x0066), this.w(0x0068), this.w(0x006a));
      while (this.timerGet()) await this.poll();
    }
  }
  async blink(col, y, w, h) {                                     // 03396: 眨眼 (1ff2 / 1ff4 / 1ff2 / 1ff0)
    for (const t of [0x1ff2, 0x1ff4, 0x1ff2, 0x1ff0]) { this.put(col, y, w, h, 0, this.ptr(this.w(t)), 0); await this.wait332d(3); }
  }
  async f3444() {                                                 // 03444
    switch (this.w(0x1fc2)) {
      case 0: await this.blink(0x1d, 0x56, 6, 0x18); break;
      case 1: await this.blink(0x18, 0x5e, 3, 0x20); break;
      case 2: await this.blink(0x1a, 0x4e, 7, 0x10); break;
      case 3: await this.blink(0x0a, 0x38, 6, 0x14); break;
      case 4: await this.blink(0x19, 0x96, 7, 0x18); break;
      case 5: await this.blink(0x12, 0x56, 8, 0x10); break;
    }
  }
  async f3565() {                                                 // 03565 (主角 2 / 4): 034b7 / 0350e 半眨眼
    const c = this.w(0x1fc2);
    if (c !== 2 && c !== 4) return;
    const [col, y, h] = c === 2 ? [0x1a, 0x4e, 0x10] : [0x19, 0x96, 0x18];
    for (const t of [0x1ff2, 0x1ff4]) { this.put(col, y, 7, h, 0, this.ptr(this.w(t)), 0); await this.wait332d(3); }
  }
  // ---- 00998 結局本體 ----
  async f0998() {
    const P = new Uint8Array(0x30);                               // [bp-32h] 48 bytes 調色盤
    await this.fadeTo048e();
    await this.fadeBlackAll();
    await this.f160d();
    this.f063e();
    this.f05c9();
    await this.playSong(1);
    if (this.w(0x0042)) {
      await this.f0688();
      await this.wait317a(0x384);
      await this.dimLower();
      await this.wait317a(0x12c);
      await this.f06ba();
      P.set(this.palUpper(this.dsPal(0x045e)));
      P.fill(0, 0, 0x18);
      while (await this.palStep(P)) await this.wait317a(5);
      this.f0438();
    }
    this.f07cc();
    await this.f0829();
    this.f0957();
    this.f072e();
    this.f052a();
    const c = this.w(0x1fc2);
    if (c <= 5) P.set(this.m.subarray([0x02ae, 0x02de, 0x048e, 0x048e, 0x030e, 0x048e][c], [0x02ae, 0x02de, 0x048e, 0x048e, 0x030e, 0x048e][c] + 0x18), 0);   // 0a38 → 21a0
    P.fill(0, 0x18, 0x30);
    while (await this.palStep(P)) await this.waitTicks(0x13);
    await this.waitTicks(0x14);
    this.fill(1, 0x64, 0x18, 0x90, 0);
    await this.f0499();
    this.sb(0x0e3f, 0); this.sb(0x0e3e, 0);
    this.sw(0x0046, 1);
    await this.fadeUpper(this.w(0x024c));
    this.fill(0x31, 0x32, 0x1c, 0xa0, 8);
    for (let i = 0; i < 6; i++) {
      await this.dissolve3(0x31, 0x32, 0x1c, this.w(0x024c + 2 * i), this.ptr(this.w(0x1fd6 + 2 * i)), 0, 0xa0);
      await this.wait332d(0x1e); await this.f3444();
      await this.wait332d(0x5a); await this.f3444();
      await this.wait332d(0x5a); await this.f3444();
      await this.wait332d(0x1e);
    }
    this.sw(0x0048, 0);
    const c2 = this.w(0x1fc2), buf2008 = this.ptr(this.w(0x2008));
    if (c2 >= 2 && c2 <= 4) {
      if (c2 === 3) await this.dissolve3(0, 0, 0x26, this.w(0x0256), buf2008, 0, 0x180);
      else await this.f3565();
    } else await this.dissolve3(0, 0x1e, 0x30, this.w(0x0256), buf2008, 0, 0x12c);
    await this.waitTicks(0x3c);
    P.set(this.palUpper(this.dsPal(this.w(0x0256))));
    P.fill(0, 0, 0x18);
    while (await this.palStep(P)) await this.waitTicks(0x0b);
    await this.dissolve3(0x31, 0x32, 0x1c, this.w(0x0258), this.ptr(this.w(0x1fe2)), 0, 0xa0);
    await this.waitTicks(0x3c);
    this.fill(0, 0, 0x30, 0x18f, 0);
    P.set(this.palUpper(this.dsPal(this.w(0x0258))));
    P.set(this.m.subarray(0x048e, 0x048e + 0x18), 0);
    await this.palFade(P);
    await this.dissolve3(0x35, 0xfa, 0x18, this.w(0x0258), this.ptr(this.w(0x2006)), 0x4ce0, 0x50);
    await this.waitTicks(0x3c);
    P.fill(0, 0x18, 0x30);
    while (await this.palStep(P)) await this.waitTicks(0x0b);
    P.fill(0, 0, 0x18);
    this.musicFade(0x78);
    while (await this.palStep(P)) await this.waitTicks(0x0b);
    this.cls();
    this.drawGraph(0x39, 0xd8, 0x50);
    await this.fadeTo048e();
    this.drawGraph(0x3a, 0xa0, 0xc8);
  }
  // ---- 01a8 main (INT 65h 的值直接作為參數: v3 = AH=3, v4 = AH=4, v5 = AH=5 核對值, name = AH=2 的字串 (名 + 空白 + 姓, 0 結尾)) ----
  async run({ v3 = 0, v4 = 0, v5 = 0, name = new Uint8Array([0]) } = {}) {
    // 001b8 / 001df 1.pat / 2.pat 開檔 (Font 已載入); 73f3 / 017a 磁碟代號與檔名
    this.sw(0x1fc2, v3); this.sw(0x1fd4, v4);
    const chk = v5 & 0xffff;
    let ax = (chk - 0x1465) & 0xffff;
    if (!(ax & 0x7f) && (ax >>= 6) <= 0x0e) {                       // 0273 跳躍表 (以位元組偏移)
      const c = [2, 3, 0, 1, -1, -1, 4, 5][ax >> 1];
      if (c >= 0) this.sw(0x1fc2, c);
    }
    for (const [k, nat, v] of [[0x9565, 0, 0x100], [0x95e4, 1, 0x101], [0x9466, 3, 0x102], [0x94e0, 5, 0x103], [0x9761, 4, 0x104], [0x97e7, 2, 0x105]])
      if (chk === k && this.w(0x1fd4) === nat) this.sw(0x1fc2, v);
    if (((((this.w(0x1fc2) << 7) | this.w(0x1fd4)) ^ 0x1565) & 0xffff) !== chk) {   // 核對失敗: 淡出、DOS 輸出 '*'、等一鍵、結束
      await this.fadeTo048e();
      this.flushKeys();
      await this.waitKeyBlocking();
      return { exit: "check" };
    }
    // 名、姓 (各最多 12 bytes, 以 2 bytes 為單位複製, 只在偶數位置檢查分隔)
    let p = 0, i = 0;
    while (name[p] !== 0x20 && (name[p] !== undefined)) { if (i >= 0x0c) break; this.sb(0x1fc6 + i, name[p]); p++; i++; this.sb(0x1fc6 + i, name[p] ?? 0); p++; i++; }
    this.sb(0x1fc6 + i, 0); p++;
    i = 0;
    while (name[p]) { if (i >= 0x0c) break; this.sb(0x202e + i, name[p]); p++; i++; this.sb(0x202e + i, name[p] ?? 0); p++; i++; }
    this.sb(0x202e + i, 0);
    if (this.b(0x1fc3)) { this.sw(0x0042, 0); this.sb(0x1fc3, 0); }
    // 0ea3 初始化: 中斷向量 / 顯示模式 / 淡黑 / 清畫面 / 磁碟代號 / 滑鼠 / 載入樂曲 (AH=00 → [1ff6] = 1)
    await this.fadeBlackAll();
    this.cls();
    this.sb(0x2004, 1);
    this.int66(0, 2); this.sb(0x1ff6, 1);
    this.f0d04();
    if (this.w(0x1fc2) === 5) this.sb(0x0045, 0x78);
    this.f0000();
    this.file = this.data.endgrp;                                  // 003f8 "A:ENDGRP.DAT"
    await this.f0998();
    this.file = null;
    if (this.b(0x2004)) { await this.waitNoInput(); await this.waitInput(); await this.fadeBlackAll(); this.cls(); }   // 0f2b / 24b5 / 4410
    return { exit: "end" };
  }
  async waitKeyBlocking() { this.onBlockKey?.(); while (!this.kbhit()) await this.poll(); return this.getKey(); }   // 1728 (INT 16h AH=0 等鍵)
  f0d04() {                                                       // 00d04: 配置記憶體, 讀 END_PUT.DAT (0x9fa0 bytes) 到 [1fc4]
    for (let i = 0; i < this.b(0x027c); i++) this.sw(0x1fd6 + 2 * i, this.alloc((this.w(0x025c + 2 * i) + 0x0f) >> 4));
    this.sw(0x203c, this.alloc(0x0ef0));
    this.sw(0x1fc4, this.alloc(0x09fa));
    this.sw(0x200a, this.alloc(0x0800));
    this.sw(0x2006, this.alloc(0x06ae));
    this.sw(0x2008, this.alloc(0x0e40));
    this.ptr(this.w(0x1fc4)).set(this.data.endput.subarray(0, 0x9fa0));
  }
  f0000() {                                                       // 00000: 各結局的 5 張劇情插圖 (EVENTn.DAT 第 k 項) → [1fd6..1fde]
    const FILE = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 0, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 0, 6, 6, 6, 6];   // [bp-20h + 5×結局 + i]
    const ENTRY = [0, 3, 1, 4, 2, 4, 0, 1, 5, 3, 0, 1, 0, 3, 2, 0, 1, 4, 3, 2, 2, 1, 4, 3, 0, 0, 1, 3, 2, 0];  // [bp-3eh + …]
    const c = this.w(0x1fc2) * 5, first = FILE[c];
    this.openEvent(first);
    for (let i = 0; i < 5; i++) {
      if (FILE[c + i] !== first) this.openEvent(FILE[c + i]);     // 與第一個不同就重新開檔 (比較對象一直是第一個, 原版如此)
      this.loadPic(this.ptr(this.w(0x1fd6 + 2 * i)), ENTRY[c + i]);
    }
  }
}

// 載入結局資源 (瀏覽器): DGROUP 初值、ENDGRP.DAT、END_PUT.DAT、EVENT0..6.DAT
export async function loadEndingData(ASSETS, loadBinary, loadJSON) {
  const [json, endgrp, endput, ...events] = await Promise.all([
    loadJSON(`${ASSETS}/data/ending.json`), loadBinary(`${ASSETS}/gfx/ENDGRP.DAT`), loadBinary(`${ASSETS}/gfx/END_PUT.DAT`),
    ...[0, 1, 2, 3, 4, 5, 6].map(i => loadBinary(`${ASSETS}/gfx/event/EVENT${i}.DAT`))]);
  return { json, endgrp, endput, events };
}
