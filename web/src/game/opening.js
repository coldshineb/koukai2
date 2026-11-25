// opening.js — 片头 (原版 OPEN.EXE 的移植)
//
// 原版流程: KOUKAI2.COM 依序运行 FMDRV.COM → OPEN.EXE → MAIN.EXE; 本模块 = OPEN.EXE, 结束 (播完或被跳过) 后由 main.js 进入标题。
// 逐函数翻译自 OPEN.EXE 反汇编 (tools/re/opening*.py → tools/work/re_open*.txt); 注释中的地址 = OPEN.EXE 加载映像线性偏移,
//   [xxxx] = DGROUP (段 0a0b) 变量, DS:xxxx 常数表取自 assets/data/opening.json (tools/extract_open.py 原样提取)。
//
// 显示: VGA mode 12h (640x480 16 色平面)。原版直接操作 VRAM 与 VGA 寄存器 (游戏区 = 第 40..439 行, 片头还会写到上下黑边),
//   这里以 OpVGA 模拟 4 平面 + 锁存器 + 串行器映射遮罩 + 图形控制器 (硬件行为), 函数库逐句翻译成对它的读写;
//   呈现时把 480 行转成索引画面交给 Screen.full, DAC 以 Screen.setDac6 逐色设置 (与原版 17f0 相同)。
// 计时: FMDRV INT 66h 倒数 (F1 01 设置 / F1 00 读取, 1 tick = 16.58 ms) → sys.timer。
// 跳过: 4f0d 系等待中按 Enter/空白键/鼠标单键、4fd5 系等待中按 Esc → 4ee4 (音乐淡出、画面淡黑) → 8747 结束程序。
// 音乐: OPEN.EXE 内含自己的 FM 乐曲数据 (091a:0002, 以 INT 66h AH=0 加载), 场景 0 播放其中第 0 首 (驱动曲号 1)。
//   该曲与 D2.MML 乐曲 21 (= 游戏曲目 0) 逐字节相同 (RE_NOTES 第 23 节), 网页版以 BGM playSong(0) 播放。

import { loadIndexedPng, encodeNibblePlanar } from "../decoders/png_index.ts";

// ---------------- VGA 平面模型 (硬件行为, 与开发用模拟器 tools/emu/x86emu.js 的 VGA 相同) ----------------
export class OpVGA {
  constructor() {
    this.planes = [0, 1, 2, 3].map(() => new Uint8Array(0x10000));
    this.latch = new Uint8Array(4);
    this.seq = new Uint8Array(8); this.seq[2] = 0x0f;
    this.gc = new Uint8Array(16); this.gc[8] = 0xff;
    this.overscan = 0;                    // 属性控制器 0x11 (外框色)
    this.dirty = true;
  }
  outSeq(i, v) { this.seq[i & 7] = v & 255; }
  outGC(i, v) { this.gc[i & 15] = v & 255; }
  read(off) {
    off &= 0xffff;
    const L = this.latch, P = this.planes;
    L[0] = P[0][off]; L[1] = P[1][off]; L[2] = P[2][off]; L[3] = P[3][off];
    if (this.gc[5] & 8) {                 // 读取模式 1 (色彩比较)
      const cc = this.gc[2], cd = this.gc[7]; let res = 0;
      for (let b = 0; b < 8; b++) {
        let ok = true;
        for (let p = 0; p < 4; p++) if ((cd >> p) & 1) { if (((L[p] >> b) & 1) !== ((cc >> p) & 1)) { ok = false; break; } }
        if (ok) res |= 1 << b;
      }
      return res;
    }
    return L[this.gc[4] & 3];
  }
  write(off, val) {
    off &= 0xffff; val &= 255;
    const gc = this.gc, mode = gc[5] & 3, mask = this.seq[2], func = (gc[3] >> 3) & 3, rot = gc[3] & 7;
    const L = this.latch, P = this.planes;
    const v = rot ? ((val >> rot) | (val << (8 - rot))) & 255 : val;
    for (let p = 0; p < 4; p++) {
      if (!((mask >> p) & 1)) continue;
      let d, bm = gc[8];
      if (mode === 1) { P[p][off] = L[p]; continue; }
      if (mode === 0) d = ((gc[1] >> p) & 1) ? (((gc[0] >> p) & 1) ? 255 : 0) : v;
      else if (mode === 2) d = ((val >> p) & 1) ? 255 : 0;
      else { bm &= v; d = ((gc[0] >> p) & 1) ? 255 : 0; }
      const l = L[p];
      if (func === 1) d &= l; else if (func === 2) d |= l; else if (func === 3) d ^= l;
      P[p][off] = ((d & bm) | (l & ~bm)) & 255;
    }
    this.dirty = true;
  }
  // 640x480 索引画面
  toIndexed(out) {
    const P = this.planes;
    for (let o = 0; o < 0x9600; o++) {
      const b0 = P[0][o], b1 = P[1][o], b2 = P[2][o], b3 = P[3][o], x = o * 8;
      for (let i = 0; i < 8; i++) {
        const s = 7 - i;
        out[x + i] = ((b0 >> s) & 1) | (((b1 >> s) & 1) << 1) | (((b2 >> s) & 1) << 2) | (((b3 >> s) & 1) << 3);
      }
    }
    return out;
  }
}

export class OpeningExit extends Error { constructor() { super("opening exit"); } }

// 3df5 字码 → 字序 (与 MAIN.EXE seg0:4554 同一规则; 逐句翻译, 含首码 0x91 等边界的 8 比特回绕)
export function opCodeToGlyph(code) {
  const L = (code >> 8) & 255, T = code & 255;
  const digit = T >= 0x30 && T <= 0x39, upper = T >= 0x41 && T <= 0x5a, lower = T >= 0x61 && T <= 0x7a, hi = T >= 0x80 && T <= 0xfd;
  let si;
  if (L === 0x82) { if (T < 0xa0 || T > 0xf3) return 0x2228; return (((T + 0x60) & 255) + 0xeb) & 0xffff; }   // si = ((0x82+0x7e)&255)*0xbc = 0
  const common = () => {                         // 3e4d / 3e6c / 3f44 (1.pat 0x81 列与 2.pat)
    if (digit) return (T - 0x30 + si + 1) & 0xffff;
    if (upper) return (T - 0x41 + si + 0x0b) & 0xffff;
    if (lower) return (T - 0x61 + si + 0x25) & 0xffff;
    if (hi) return (((T + 0x80) & 255) + si + 0x3f) & 0xffff;
    return 0x2228;
  };
  if (L === 0x81) { si = 0; return common(); }
  if (L >= 0x81 && L <= 0xaf) {
    si = (((L - (L >= 0x91 ? 0x92 : 0x81)) & 255) * 0xbc) & 0xffff;
    if (digit) return (T - 0x30 + si + 0x24f) & 0xffff;
    if (upper) return (T - 0x41 + si + 0x259) & 0xffff;
    if (lower) return (T - 0x61 + si + 0x273) & 0xffff;
    if (hi) return (((T + 0x80) & 255) + si + 0x28d) & 0xffff;
    return 0x2228;
  }
  if (L >= 0xb0 && L <= 0xd8) { si = (((L + 0x50) & 255) * 0xbc) & 0xffff; return common(); }
  return 0x2228;
}

const s16 = v => (v << 16) >> 16;
const ror8 = (v, n) => { n &= 7; return ((v >> n) | (v << (8 - n))) & 255; };

export class Opening {
  // ctx: { scr, sys, bgm, font (g1/g2/rom), opening: { entries[14], tail, json } }
  constructor(ctx, data) {
    this.ctx = ctx; this.scr = ctx.scr; this.sys = ctx.sys; this.bgm = ctx.bgm; this.font = ctx.font;
    this.data = data;
    this.vga = new OpVGA();
    this.full = new Uint8Array(640 * 480);
    const ds = data.json.ds; this.ds = new Uint8Array(ds.length / 2);
    for (let i = 0; i < this.ds.length; i++) this.ds[i] = parseInt(ds.substr(i * 2, 2), 16);
    this.dsBase = data.json.dsBase; this.tailStart = data.json.tailStart;
    // 内存区块 (8713 → 863a: 6 块 0x1000 段 = 64KB; 原版 [004c][004e][0050] 一般内存, [0052][0054][0056] 优先 EMS)
    this.B4c = new Uint8Array(0x10000); this.B4e = new Uint8Array(0x10000); this.B50 = new Uint8Array(0x10000);
    this.B52 = new Uint8Array(0x20000); this.B54 = new Uint8Array(0x20000); this.B56 = new Uint8Array(0x10000);
    this.cur = new Uint8Array(48);         // [0e82] 目前调色盘 (16 色 × B,R,G 4 比特)
    this.dac = new Uint8Array(48);         // DAC 0..15 (R,G,B 6 比特) — 测试比对用
    this.invert = 0;                       // [005c] (此版本恒为 0)
    this.page = 0;                         // [0468]
    this.cyc = 0;                          // [0366]
    this.musicOn = 1;                      // [004a] 驱动加载乐曲成功
    this.flags = 0xff;                     // [0042]
    this.song = 0;                         // [00f4]
    this.glyph = new Uint8Array(32);       // [0ec0] 字形缓冲 (28 bytes + [0edc..0edf])
    this.T = new Uint16Array(8);           // cs:0da2 图样表 (11da)
    this.dpat = 0; this.d2pat = 0; this.d2sel = 0;   // cs:2774 / cs:2842 / cs:2840
  }
  // ---- DS 常数 ----
  b(off) { return this.ds[off - this.dsBase]; }
  w(off) { const i = off - this.dsBase; return this.ds[i] | (this.ds[i + 1] << 8); }
  pal(off) { const i = off - this.dsBase; return this.ds.subarray(i, i + 48); }
  sw(off, i) { return s16(this.w(off + 2 * i)); }

  async run() {
    this.scr.full = this.full; this.present(true);
    try { await this.main(); }
    catch (e) { if (!(e instanceof OpeningExit)) throw e; }
    finally {
      this.scr.full = null;
      this.scr.setPaletteRaw(new Uint8Array(48));   // 原版结束时调色盘已淡成全黑 (MAIN.EXE 开机时目前调色盘亦为 0)
      this.scr.clear(0);
    }
  }
  present(force = false) {
    if (!force && !this.vga.dirty) return;
    this.vga.toIndexed(this.full); this.vga.dirty = false;
    this.scr.border = this.vga.overscan; this.scr.dirty = true;
  }
  async poll() { this.present(); await this.sys.poll(); }

  // ================= 主程序 =================
  async main() {                                      // 85aa (1.pat / 2.pat 已由 Font 加载)
    await this.init();                                // 8565
    await this.setup();                               // 872d
    await this.play();                                // 8481
    await this.exit();                                // 8747
  }
  async init() {                                      // 8565
    this.flags = 0xff;                                // [0042]
    this.timerZero();                                 // 4836
    this.cls();                                       // 0810
    // 8e7f: 内存区块表初始化; 4bc2 → 1770: 属性寄存器 i → i (恒等)
    await this.palFade1(0x00f6);                      // 4dd9
    // 8525: 文件名加上目前磁盘代号; 8559: 打开 OPGRAPH.LZW
    this.musicOn = 1;                                 // 1756: INT 66h AH=0 加载乐曲数据 → [004a]
    await this.palFade1(0x0306);                      // 4de2
  }
  async setup() {                                     // 872d
    await this.palFade1(0x00f6);                      // 4dd9
    // 8713: 863a 配置内存; 4580 鼠标初始化; 4686(27f,18f) 鼠标位置 (光标不显示)
    await this.palFade1(0x00f6);                      // 4dd9
  }
  async play() {                                      // 8481
    this.flushKeys(); await this.waitNoInput();       // 2c57, 3856, 4e59
    this.page = 0;                                    // [0468]
    const S = [this.scene0, this.scene1, this.scene2, this.scene3, this.scene4, this.scene5, this.scene6, this.scene7, this.scene8, this.scene9, this.scene10, this.scene11];
    for (const f of S) await f.call(this);            // DS:0b9a 场景表
    this.border(0);                                   // 2d0e(0)
  }
  async exit() {                                      // 8747
    await this.palFade1(0x0306);                      // 4de2
    this.cls();                                       // 0810
    // 3cdd(0,0) 文字光标; 432c(DS:0c20 = ESC C7 ESC B0: 文字主控台颜色设置, 不输出字符); 873c 关档; 86dd 释放内存
    this.musicFade(0x14);                             // 4a0b(14h)
    throw new OpeningExit();                          // 2edb(0) 结束程序
  }
  async abort() {                                     // 4ee4
    this.musicFade(0x14);
    while (await this.palStep(0x0306)) await this.wait(4);
    await this.exit();
  }

  // ================= 计时 =================
  timerGet() { return this.sys.timer.get(); }                     // 186d (F1 00)
  timerSet(n) { this.sys.timer.set(n & 0xffff); }                 // 1860 (F1 01)
  timerZero() { this.timerSet(0); }                               // 4836
  timerAdd(n) { this.timerSet(this.timerGet() + n); }             // 4846
  async wait(n) { this.timerAdd(n); while (this.timerGet()) await this.poll(); }   // 485d
  // ================= 键盘 / 鼠标 =================
  kbhit() { return this.sys.kbhit() ? 1 : 0; }                    // 2ce1 (BIOS NumLock 强制开)
  getch() { return this.sys.readRaw(); }                          // 2cfb: ASCII≠0 → ASCII, 否则 0x100|扫描码
  flushKeys() { while (this.kbhit()) this.getch(); }              // 3856
  translateKey() {                                                // 386d
    const si = this.getch();
    if (si >= 0x100) {
      const T = { 0x3b: 0x16, 0x3c: 0x14, 0x3d: 0x02, 0x3e: 0x19, 0x47: 0x3e, 0x48: 0x1e, 0x4b: 0x1d, 0x4d: 0x1c, 0x4f: 0x3f, 0x50: 0x1f, 0x53: 0x7f };
      return T[si & 0xff] ?? 0xff;
    }
    return si === 0x20 ? 0x0d : si & 0xff;
  }
  readKey() { const k = this.translateKey(); this.flushKeys(); return k; }           // 38fc
  mouseLeft() { return this.sys.mouseLeft(); }                                       // 46b7
  mouseRight() { return this.sys.mouseRight(); }                                     // 46ee
  inputState() { if (this.mouseLeft() || this.mouseRight()) return 1; if (this.kbhit()) return 2; return 0; }   // 4e28 (4798 / 3850)
  input() {                                                                          // 4e82
    const r = this.inputState();
    if (r === 1) { const m = 0x80 | this.mouseLeft() | (this.mouseRight() << 1); return (m === 0x81 || m === 0x82) ? 0x0d : 0; }   // 47ac
    if (r === 2) return this.readKey();
    return 0;
  }
  async waitNoInput() { while (this.inputState()) { this.flushKeys(); await this.poll(); } }   // 4e59
  async prepWait() { this.flushKeys(); await this.waitNoInput(); }                   // 2c57 (磁盘重置), 3856, 4e59
  async waitSkip() {                                                                 // 4f0d
    do { const k = this.input(); if (k === 0x0d || k === 0x20) await this.abort(); await this.poll(); } while (this.timerGet());
  }
  async waitAddSkip(n) { await this.prepWait(); this.timerAdd(n); await this.waitSkip(); }   // 4f31
  async waitEsc(n) {                                                                 // 4fd5
    await this.prepWait(); this.timerAdd(n);
    do { const k = this.input(); if (k === 0x1b) await this.abort(); await this.poll(); } while (this.timerGet());
  }
  async fadeSkip(n, pal) {                                                           // 4f6d
    await this.prepWait();
    while (await this.palStep(pal)) { this.timerAdd(n); await this.waitSkip(); }
  }

  // ================= 调色盘 =================
  writeColor(i, word) {                                                              // 17f0
    i &= 15;
    const r = (word & 0xf0) >> 2, g = ((word >> 8) & 0x0f) << 2, b = (word & 0x0f) << 2;
    this.dac[i * 3] = r; this.dac[i * 3 + 1] = g; this.dac[i * 3 + 2] = b;
    this.scr.setDac6(i, r, g, b);
  }
  writeAll() {                                                                       // 4d52..4da9 / 4c11..4c6c
    const c = this.cur;
    for (let i = 0; i < 16; i++) {
      const b0 = c[i * 3], b1 = c[i * 3 + 1], b2 = c[i * 3 + 2];
      const w = this.invert ? (((15 - b2) & 255) << 8) | ((((15 - b1) & 0xffff) << 4) & 0xffff) | ((15 - b0) & 0xffff)
                            : (b2 << 8) | (b1 << 4) | b0;
      this.writeColor(i, w & 0xffff);
    }
  }
  async palStep(off) {                                                               // 4d0d: 每色每通道朝目标走 1, 有变化就写 DAC; 一律等 1 tick
    const t = this.pal(off), c = this.cur; let ch = 0;
    for (let i = 0; i < 48; i++) if (c[i] !== t[i]) { ch = 1; if (c[i] > t[i]) c[i]--; else c[i]++; }
    if (ch) this.writeAll();
    await this.wait(1);
    return ch;
  }
  palCycleStep(off) {                                                                // 4bc8: 只动 [0366]%12 起每隔 12 的 4 个字节, 写全部 16 色, 不等待
    const t = this.pal(off), c = this.cur, k = this.cyc % 12;
    for (let j = 0; j < 4; j++) { const i = k + 12 * j; if (c[i] !== t[i]) { if (c[i] > t[i]) c[i]--; else c[i]++; } }
    this.writeAll();
    this.cyc = (this.cyc + 1) & 0xffff;
  }
  async palFade1(off) { while (await this.palStep(off)) await this.wait(1); }      // 4dbc (4dd9 = f6, 4de2 = 306)
  async fadeIn2a6_2d6() {                                                            // 50a2
    while (await this.palStep(0x02a6)) await this.waitEsc(4);
    await this.waitEsc(0x3c);
    while (await this.palStep(0x02d6));
  }
  async fadeOutSlow() { while (await this.palStep(0x0306)) await this.waitEsc(4); }  // 50cd
  async fadeOut() { while (await this.palStep(0x0306)); }                            // 50e4
  async fadeOutSkipCls() { while (await this.palStep(0x0306)) await this.waitAddSkip(4); this.cls(); }   // 532c

  // ================= 音乐 (INT 66h) =================
  musicStatus() { return 0; }                                        // 4a32 (fn 3): 网页版无法取得驱动状态, 视为未播放 (与差分测试的模拟器相同)
  playSong(n) {                                                      // 4980
    if (!this.musicOn || !(this.flags & 4) || n > 0x17) return;
    if (this.musicStatus()) { if (this.song === n) return; this.musicFade(0x14); while (this.musicStatus()); }
    // fn 1 (FMDRV 乐曲 n+1) + 49e4(1) 打开重播: OPEN.EXE 内嵌乐曲 = D2.MML 乐曲 21 = 游戏曲目 0 (RE_NOTES 第 23 节) → BGM 曲目 0 (循环)
    this.bgm?.playSong?.(n);
    this.musicFlag(1);
    this.song = n;
  }
  musicFlag(v) { if (this.bgm?.el) this.bgm.el.loop = !!v; }        // 49e4 (fn 4: 重播标志; 0 = 本遍播完即停)
  musicFade(speed) { if (this.musicOn) this.bgm?.fadeOut?.(); }      // 4a0b (fn 2)

  // ================= 绘图函数库 (0000..1000 段, 与 MAIN.EXE 同一套汇编语言库) =================
  gcReset() { const v = this.vga; v.outGC(1, 0); v.outGC(3, 0); v.outGC(5, 0); v.outGC(8, 0xff); }   // 0118
  clip(col, y, w, h) {                                                            // 012e: 成功传回 VRAM 地址 (并 0118), 失败 -1
    col &= 0xffff; y &= 0xffff; w &= 0xffff; h &= 0xffff;
    if (col > 0x4f || !w || col + w > 0x50) return -1;
    if (y > 0x18f || !h || y + h > 0x190) return -1;
    this.gcReset();
    return (col + (y + 0x28) * 80) & 0xffff;
  }
  planeSel(bl) { if (bl < 4) { this.vga.outGC(4, bl); this.vga.outSeq(2, 1 << bl); } }   // 0837
  cls() {                                                                         // 0810
    const v = this.vga; this.gcReset(); v.outSeq(2, 0x0f); v.outGC(5, 2);
    for (let i = 0; i < 0x9600; i++) v.write(i, 0);
    return 0;
  }
  border(c) { this.vga.overscan = c & 255; this.vga.dirty = true; }               // 2d0e: INT 10h AX=1001h
  // 02a7 (经 03ce): 4 平面交错 (每 8 像素 plane0..3 各 1 byte); mode 0 覆写 (bit15 每行画两次) / 1 XOR / 2 AND / 3 OR / 4 透明
  put4(col, y, w, h, mode, off, buf) { return this.putN(4, col, y, w, h, mode & 0x7fff, mode, off, buf); }
  // 0449 (经 055e, mode 恒为 0): 3 平面交错
  put3(col, y, w, h, buf, off) { return this.putN(3, col, y, w, h, 0, 0, off, buf); }
  putN(np, col, y, w, h, m, mode, off, buf) {
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return -1;
    let si = off & 0xffff;
    if (m > 4) return -1;
    const movs = () => { for (let p = 0; p < np; p++) { v.outSeq(2, 1 << p); v.write(di, buf[si]); si = (si + 1) & 0xffff; } di = (di + 1) & 0xffff; };
    if (m === 0) {
      do {
        const dx = di, rs = si;
        for (let c = 0; c < w; c++) movs();
        if (mode & 0x8000) { si = rs; di = (dx + 0x50) & 0xffff; for (let c = 0; c < w; c++) movs(); }
        di = (dx + 0x50 + ((mode & 0x8000) ? 0x50 : 0)) & 0xffff;
      } while ((h = (h - 1) & 0xffff));
      return 0;
    }
    if (m <= 3) {
      const ah = [0, 0x18, 0x08, 0x10][m];
      v.outGC(3, ah);
      do {
        const d0 = di;
        for (let c = 0; c < w; c++) { v.read(di); v.outSeq(2, ah); movs(); }
        di = (d0 + 0x50) & 0xffff;
      } while ((h = (h - 1) & 0xffff));
      return 0;
    }
    do {                                                                          // mode 4
      for (let c = 0; c < w; c++) {
        let mask = buf[si] | buf[(si + 1) & 0xffff] | buf[(si + 2) & 0xffff]; if (np === 4) mask |= buf[(si + 3) & 0xffff];
        v.outGC(8, mask); v.read(di);
        if (np === 4) movs();
        else { for (let p = 0; p < 3; p++) { v.outSeq(2, 1 << p); v.write(di, buf[si]); si = (si + 1) & 0xffff; } v.outSeq(2, 8); v.write(di, 0); di = (di + 1) & 0xffff; }
      }
      di = (di - w + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
    return 0;
  }
  // 2aec: 3 平面 (来源为 4 平面交错, 平面 3 保留), 不裁切、不重设图形控制器; 来源到 lim 时回到 0 (循环滚动)
  put3stride(col, y, w, h, off, lim, buf) {
    const v = this.vga;
    let di = (col + (y + 0x28) * 80) & 0xffff, si = off & 0xffff;
    do {
      const s0 = si;
      for (let bl = 0; bl < 3; bl++) {
        this.planeSel(bl);
        let s = si, d = di, cx = w;
        do { v.write(d, buf[s]); d = (d + 1) & 0xffff; s = (s + 4) & 0xffff; } while ((cx = (cx - 1) & 0xffff));
        si = (si + 1) & 0xffff;
      }
      si = (s0 + w * 4) & 0xffff;
      di = (di + 0x50) & 0xffff;
      if (!(lim > si)) si = 0;
    } while ((h = (h - 1) & 0xffff));
  }
  // 2b5e: 画面左移 8 像素 (平面 0..2); buf 不为 null 时右端补入 buf 的 1 byte/平面 (每行来源加 rowInc)
  scrollCopy(col, y, w, h, off, buf, rowInc) {
    const v = this.vga;
    let di = (col + (y + 0x28) * 80) & 0xffff, si = (di + 1) & 0xffff, bx = h;
    let a = off & 0xffff, bp = a;                    // cs:2b5a / cs:2b5c
    do {
      for (let bl = 0; bl < 3; bl++) {
        this.planeSel(bl);
        let s = si, d = di, cx = (w - 1) & 0xffff;
        do { v.write(d, v.read(s)); d = (d + 1) & 0xffff; s = (s + 1) & 0xffff; } while ((cx = (cx - 1) & 0xffff));
        if (buf) { v.write(d, buf[bp]); bp = (bp + 1) & 0xffff; }
      }
      if (buf) { a = (a + rowInc) & 0xffff; bp = a; }
      di = (di + 0x50) & 0xffff; si = (si + 0x50) & 0xffff;
    } while ((bx = (bx - 1) & 0xffff));
  }
  planeFill(plane, off, count, val) {                                             // 2c15
    this.planeSel(plane);
    let di = off & 0xffff, cx = count & 0xffff;
    do { this.vga.write(di, val); di = (di + 1) & 0xffff; } while ((cx = (cx - 1) & 0xffff));
  }
  fillRect(col, y, w, h, color) {                                                 // 091f: 写入模式 2 填色 (不还原)
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return -1;
    v.outSeq(2, 0x0f); v.outGC(5, 2);
    do { for (let c = 0; c < w; c++) { v.write(di, color); di = (di + 1) & 0xffff; } di = (di + 0x50 - w) & 0xffff; } while ((h = (h - 1) & 0xffff));
    return 0;
  }
  getImage(col, y, w, h, off, buf) {                                              // 29fe: 画面 → 4 平面交错缓冲
    const v = this.vga;
    let si = this.clip(col, y, w, h); if (si < 0) return;
    let di = off & 0xffff;
    do {
      const s0 = si;
      for (let c = 0; c < w; c++) { for (let bl = 0; bl < 4; bl++) { this.planeSel(bl); buf[di] = v.read(si); di = (di + 1) & 0xffff; } si = (si + 1) & 0xffff; }
      si = (s0 + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
  }
  ditherPut(col, y, w, h, off, buf, setup) {                                      // 2775: 以 cs:2774 网点图样逐列混入 (4 平面)
    if (setup) { this.dpat = setup & 255; return; }
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return;
    let si = off & 0xffff;
    do {
      for (let pl = 0; pl < 4; pl++) {
        this.planeSel(pl);
        const s0 = si, d0 = di, dl = this.dpat;
        for (let c = 0; c < w; c++) {
          const ah = buf[si] | buf[(si + 1) & 0xffff] | buf[(si + 2) & 0xffff] | buf[(si + 3) & 0xffff];
          const bl = ~(dl & ah) & 255;
          si = (si + pl) & 0xffff; const al = buf[si] & dl; si = (si + 1) & 0xffff;
          v.write(di, v.read(di) & bl);
          v.write(di, v.read(di) | al);
          si = (si + 3 - pl) & 0xffff; di = (di + 1) & 0xffff;
        }
        si = s0; di = d0;
      }
      si = (si + w * 4) & 0xffff;
      this.dpat = ror8(this.dpat, (h & 3) + 1);
      di = (di + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
    this.dpat |= ror8(this.dpat, 5);
  }
  ditherPlane(col, y, w, h, off, buf, setup, sel) {                               // 2843: 单一平面网点混入 (cs:2840 平面选择, cs:2842 图样)
    if (setup) { this.d2pat = setup & 255; this.d2sel = sel; return; }
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return;
    let si = off & 0xffff;
    const pl = { 0xa800: 0, 0xb000: 1, 0xb800: 2, 0xe000: 3 }[this.d2sel];
    this.planeSel(pl);
    do {
      const dl = this.d2pat, bl = ~dl & 255, d0 = di;
      for (let c = 0; c < w; c++) {
        const al = buf[si] & dl; si = (si + 1) & 0xffff;
        v.write(di, v.read(di) & bl); v.write(di, v.read(di) | al);
        di = (di + 1) & 0xffff; si = (si + 3) & 0xffff;
      }
      this.d2pat = ror8(this.d2pat, (h & 3) + 1);
      di = (d0 + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
    this.d2pat |= ror8(this.d2pat, 5);
  }
  planeCopy(col, y, w, h, off, buf, sel) {                                        // 28f3: 4 平面交错缓冲的一个平面 → 画面平面 (sel a800/b000/b800/e000)
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return;
    let si = off & 0xffff;
    this.planeSel({ 0xa800: 0, 0xb000: 1, 0xb800: 2, 0xe000: 3 }[sel]);
    do {
      const d0 = di;
      for (let c = 0; c < w; c++) { v.write(di, buf[si]); di = (di + 1) & 0xffff; si = (si + 4) & 0xffff; }
      di = (d0 + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
  }
  clear3(col, y, w, h) {                                                          // 2a5e: 平面 0..2 清 0
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return;
    do {
      const d0 = di;
      for (let c = 0; c < w; c++) { for (let bl = 0; bl < 3; bl++) { this.planeSel(bl); v.write(di, 0); } di = (di + 1) & 0xffff; }
      di = (d0 + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
  }
  clearPlane3(col, y, w, h) {                                                     // 2aaf: 平面 3 清 0
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return;
    this.planeSel(3);
    do { const d0 = di; for (let c = 0; c < w; c++) { v.write(di, 0); di = (di + 1) & 0xffff; } di = (d0 + 0x50) & 0xffff; } while ((h = (h - 1) & 0xffff));
  }

  // ================= OPGRAPH (PNG 索引图) =================
  loadEntry(buf, idx, limit = 0) {
    const e = this.data.entries[idx];
    if (e instanceof Uint8Array) {
      let n = e.length; if (limit && limit < n) n = limit;
      buf.set(e.subarray(0, n), 0);
      buf._pngPack = null; buf._pngTail = null;
      return n;
    }
    buf._pngPack = e;
    buf._pngTail = null;
    return 0;
  }
  graphOfs(buf, n) {
    if (buf._pngPack) return n;
    const o = n * 4; return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  }
  rawRead(fileOfs, buf, bufOff, len) {
    if (Array.isArray(this.data.tail)) {
      const idx = { 0x72d91: 0, 0x730c9: 1, 0x6f7fd: 2 }[fileOfs];
      buf._pngTail = idx !== undefined ? this.data.tail[idx] : null;
      return;
    }
    const s = fileOfs - this.tailStart, t = this.data.tail;
    for (let i = 0; i < len && s + i < t.length; i++) buf[(bufOff + i) & 0xffff] = t[s + i];
  }
  // 11da (经 4905): 16 色 GRAPH 格式 → 4 平面交错内存缓冲 (每单位 4 像素 = 4 个字节的同一半字节; 偶数单位在高半字节)
  dec4(src, so, dst, doff = 0) { return this.decN(4, src, so, dst, doff); }
  // 1513 (经 492d): 8 色格式 → 3 平面交错缓冲
  dec3(src, so, dst, doff = 0) { return this.decN(3, src, so, dst, doff); }
  decN(np, src, so, dst, doff) {
    if (np === 3 && src._pngTail) {
      encodeNibblePlanar(src._pngTail, 3, dst, doff);
      return 0;
    }
    if (src._pngPack) {
      const img = src._pngPack[so];
      if (img) encodeNibblePlanar(img, np, dst, doff);
      return 0;
    }
    let sp = so;
    const rd = () => src[sp++];                                                   // 11c5
    let bx = rd(); bx |= (np === 4 ? (rd() & 0x7f) : rd()) << 8;
    let cx = rd(); cx |= rd() << 8;
    bx = ((bx + 3) >> 2) & 0xffff; const dx = bx;
    if (np === 4) for (let i = 0; i < 8; i++) { const lo = rd(), hi = rd(); this.T[i] = lo | (hi << 8); }
    const grp = u => doff + (((u >> 1) * np) & 0xffff);                           // 单位 → 字节组的起点 (段内 16 比特回绕)
    const getU = (u, p) => { const b = dst[(grp(u) + p) & 0x1ffff]; return (u & 1) ? b & 0x0f : b >> 4; };
    const setU = (u, p, nib) => { const a = (grp(u) + p) & 0x1ffff; dst[a] = (u & 1) ? (dst[a] & 0xf0) | (nib & 0x0f) : (dst[a] & 0x0f) | ((nib & 0x0f) << 4); };
    let di = 0;
    let rows = cx;
    do {
      const row0 = di;
      let rem = bx;
      for (;;) {
        const al = rd(); let cnt;
        const d0 = di;
        if (al & 0x80) {
          cnt = (al & 0x0f) + 1;
          if (al & 0x40) {                                                        // 1333 上方拷贝: 只依目的单位奇偶取来源字节的同一半
            let si = di, k = ((al & 0x30) >> 4) + 1; do { si = (si - dx) & 0xffff; } while (--k);
            const sbase = (si & ~1) | (di & 1);
            for (let i = 0; i < cnt; i++) for (let p = 0; p < np; p++) setU(di + i, p, getU(((sbase + i) & 0xffff), p));
          } else {                                                                // 1252 同行回溯 (奇偶分 4 种, 等于逐单位拷贝)
            const si = (di - (((al & 0x30) >> 4) + 1)) & 0xffff;
            for (let i = 0; i < cnt; i++) for (let p = 0; p < np; p++) setU(di + i, p, getU((si + i) & 0xffff, p));
          }
        } else {
          let pat;
          if (np === 4) {                                                         // 13d0
            cnt = (al & 7) + 1;
            const s = al & 0x78;
            if (!s) pat = 0;
            else if (al & 0x40) pat = this.T[(al >> 3) & 7];
            else if (s === 0x38) { const a = rd(), b = rd(); pat = (a << 8) | b; }
            else {
              const b = rd();
              switch ((s - 8) >> 3) {
                case 0: pat = b; break;                                           // 1457
                case 1: pat = (b & 0x0f) | ((b & 0xf0) << 4); break;              // 1412
                case 2: pat = ((b << 8) & 0xf000) | (b & 0x0f); break;            // 1427
                case 3: pat = (b << 4) & 0xffff; break;                           // 1434
                case 4: pat = ((b << 8) & 0xf000) | ((b & 0x0f) << 4); break;     // 143e
                case 5: pat = b << 8; break;                                      // 1453
              }
            }
          } else {                                                                // 16a5
            const b = rd(); cnt = ((al >> 4) & 7) + 1; pat = ((al & 0x0f) << 8) | b;
          }
          for (let i = 0; i < cnt; i++) for (let p = 0; p < np; p++) setU(di + i, p, (pat >> (4 * p)) & 0x0f);
        }
        di = (d0 + cnt) & 0xffff;
        if (rem <= cnt) break;
        rem -= cnt;
      }
      di = (row0 + dx) & 0xffff;
    } while ((rows = (rows - 1) & 0xffff));
    return 0;
  }

  // ================= 文字 (1.pat / 2.pat / ROM 8x8) =================
  loadGlyph(code) {                                                               // 3f81 → [0ec0]
    const g = this.glyph; g[28] = g[29] = g[30] = g[31] = 0;
    const F = this.font;
    const fromPat = (arr) => {
      const n = opCodeToGlyph(code);                                              // (n-1)*28 + (n-1)/18*8 的文件位置读 28 bytes; 超出档尾时读不到 (缓冲保留)
      const cnt = arr.length / 28;
      if (n >= 1 && n <= cnt) g.set(arr.subarray((n - 1) * 28, n * 28), 0);
    };
    if (code >= 0x8130 && code <= 0xaf68) { fromPat(F.g1); this.glyphKind = 2; }
    else if (code >= 0xb030 && code <= 0xd8c3) { fromPat(F.g2); this.glyphKind = 2; }
    else if (code < 0x200) {                                                      // 0d71: F000:FA6E + ch*8
      for (let i = 0; i < 8; i++) { const v = code < 128 ? F.rom[code * 8 + i] : 0; g[i * 2] = v; g[i * 2 + 1] = v; }
      this.glyphKind = 1;
    }
  }
  glyph2x(x, y, buf, w) {                                                         // 5bf1: 字形放大 2 倍 (32x32) → 4 平面交错缓冲 (色 7)
    const g = this.glyph, A = new Uint16Array(64);
    for (let r = 0; r < 32; r++) {
      let v = 0;
      for (let b = 0; b < 8; b++) { const bit = (g[r] >> (7 - b)) & 1; v = ((v << 2) | bit | (bit << 1)) & 0xffff; }
      A[r] = v;
    }
    for (let bx = 31; bx >= 0; bx--) { const v = A[bx]; if (!(bx & 1)) { A[2 * bx + 2] = v; A[2 * bx] = v; } else { A[2 * bx - 1] = v; A[2 * bx + 1] = v; } }
    let si = ((w * y + x) * 4) & 0xffff;
    for (let r = 0; r < 32; r++) {
      let o = si;
      for (let k = 0; k < 4; k++) {
        const wv = A[r * 2 + (k >> 1)], al = (k & 1) ? wv & 255 : wv >> 8;
        buf[o] = al; buf[(o + 1) & 0xffff] = al; buf[(o + 2) & 0xffff] = al; buf[(o + 3) & 0xffff] = 0; o = (o + 4) & 0xffff;
      }
      si = (si + w * 4) & 0xffff;
    }
  }
  glyph1x(x, y, buf, w, inv) {                                                    // 5b6f / 5af3 (反白): 16x16 → 4 平面交错缓冲
    const g = this.glyph;
    let o0 = ((w * y + x) * 4) & 0xffff;
    for (let r = 0; r < 16; r++) {
      let o = o0;
      for (let k = 0; k < 2; k++) {
        const al = inv ? ~g[r * 2 + k] & 255 : g[r * 2 + k];
        buf[o] = al; buf[(o + 1) & 0xffff] = al; buf[(o + 2) & 0xffff] = al; buf[(o + 3) & 0xffff] = inv ? 0xff : 0; o = (o + 4) & 0xffff;
      }
      o0 = (o0 + w * 4) & 0xffff;
    }
  }
  textToBuf(buf, idx, w, h) {                                                     // 5d49: DS:0898[idx] (放大字) + DS:08ae[idx] (一般字) → 缓冲
    const n = (h * w * 4) & 0xffff;
    for (let i = 0; i < n; i++) buf[i] = 0;
    let y = 0, x = 0;
    let si = this.w(0x0898 + idx * 2);
    while (this.b(si)) {
      const c = this.b(si);
      if (c >= 0x81 && c <= 0xd8) { si++; this.loadGlyph((c << 8) + this.b(si)); this.glyph2x(x, y, buf, w); x += 4; }
      else if (c === 0x0a) { y += 0x24; x = 0; }
      else { this.loadGlyph(c); this.glyph2x(x, y, buf, w); x += 4; }
      si++;
    }
    y += 0x24;
    if (idx === 5 || idx === 6 || idx === 8 || idx === 9) y = 0;
    si = this.w(0x08ae + idx * 2); let di = 0;
    while (this.b(si)) {
      const c = this.b(si);
      if (c === 0x0a) { y += 0x14; di = 0; }
      else {
        let code = c;
        if (c >= 0x81 && c <= 0xd8) { si++; code = (c << 8) | this.b(si); }
        this.loadGlyph(code);
        this.glyph1x(di, y, buf, w, idx === 8 || idx === 9);
        di += 2;
      }
      si++;
    }
  }

  // ================= 场景 (DS:0b9a 表) =================
  async scene0() {                                                                // 5348
    const { B4c, B50, B52 } = this;
    await this.palFade1(0x0306);
    this.cls();
    this.loadEntry(B4c, 0); this.loadEntry(B50, 0x0d);
    this.dec4(B4c, this.graphOfs(B4c, 0), B52);
    this.put4(0x1b, 0x60, 0x1a, 0x70, 0, 0, B52);
    this.timerZero();
    this.playSong(0);
    await this.fadeIn2a6_2d6();
    this.dec4(B4c, this.graphOfs(B4c, 1), B52);
    this.put4(0x1b, 0xe0, 0x1a, 0x18, 0, 0, B52);
    await this.waitEsc(0x78);
    await this.fadeOutSlow();
    this.cls();
    this.dec4(B4c, this.graphOfs(B4c, 3), B52);
    this.put4(0x0f, 0xae, 0x32, 0x18, 0, 0, B52);
    await this.palFade1(0x00f6);
    await this.waitEsc(0x78);
    await this.fadeOut();
    this.cls();
    this.rawRead(0x72d91, B4c, 0x3c, 0x338);
    this.dec3(B4c, 0x3c, B52);
    this.put3(0x1f, 0x84, 0x12, 0x38, B52, 0);
    this.rawRead(0x730c9, B4c, 0x3c, 0x57b);
    this.dec3(B4c, 0x3c, B52);
    this.put3(0x10, 0xbc, 0x30, 0x28, B52, 0);
    await this.fadeIn2a6_2d6();
    await this.waitEsc(0x78);
    await this.fadeOut();
    this.cls();
    await this.waitEsc(0x3c);
  }
  async scene1() {                                                                // 55ce
    const { B4c, B4e, B52, B54 } = this;
    this.timerZero();
    this.timerAdd(4);
    this.dec4(B4c, this.graphOfs(B4c, 4), B52);
    this.put4(5, 0x78, 0x43, 0x80, 0, 0, B52);
    this.dec4(B4c, this.graphOfs(B4c, 5), B52);
    await this.waitSkip();
    this.cyc = 0;
    await this.waitSkip();
    for (let si = 0; si < 0x6a; si++) {
      this.timerAdd(5);
      this.page ^= 1;
      const di = si % 0x78;
      this.put3stride(5, 0x7c, 0x43, 0x78, (di * 0x10c) & 0xffff, 0x7da0, B52);
      if (si < 0x5a) { this.palCycleStep(0x01b6); this.palCycleStep(0x01b6); }
      else await this.palStep(0x01e6);
      await this.waitSkip();
    }
    this.timerAdd(4);
    this.dec4(B4c, this.graphOfs(B4c, 6), B52);
    this.put4(5, 0x78, 0x45, 0x80, 0, 0, B52);
    await this.waitSkip();
    while (await this.palStep(0x0216));
    this.timerAdd(0x3c);
    this.dec4(B4c, this.graphOfs(B4c, 7), B54);
    await this.waitSkip();
    for (let si = 0; si < 5; si++) {
      this.timerAdd(4); this.page ^= 1;
      this.scrollCopy(0, 0x78, 0x4a, 0x80, 0, null, 0);
      await this.waitSkip();
    }
    this.timerAdd(0x38);
    this.page ^= 1;
    this.put4(0, 0x78, 0x45, 0x80, 0, 0, B52);
    this.dec4(B4c, this.graphOfs(B4c, 8), B52);
    this.put4(0x42, 0x70, 0x0e, 0x98, 0, 0, B52);
    for (let si = 0; si < 5; si++) this.dec4(B4c, this.graphOfs(B4c, si + 0x0a), B54, si << 9);
    await this.waitSkip();
    while (await this.palStep(0x0276));
    for (let si = 0; si < 5; si++) {
      this.timerAdd(2); this.page ^= 1;
      this.put4(0x42, 0x70, 0x0e, 0x98, 0, 0, B52);
      const ax = (si << 9) & 0xffff;
      this.put4((si + 0x21) * 2, 0x70, 4, 0x20, 4, ax, B54);
      this.put4((0x26 - si) * 2, 0xe8, 4, 0x20, 4, ax, B54);
      await this.waitSkip();
    }
    for (let si = 1; si < 0x0e; si++) {
      this.timerAdd(2); this.page ^= 1;
      this.put4(0x42, 0x70, 0x0e, 0x98, 0, 0, B52);
      const ax = ((si & 3) << 9) & 0xffff;
      this.put4(0x4c, 0x70, 4, 0x20, 4, ax, B54);
      this.put4(0x42, 0xe8, 4, 0x20, 4, ax, B54);
      await this.waitSkip();
    }
    this.timerAdd(7); this.page ^= 1;
    this.put4(0x42, 0x70, 0x0e, 0x98, 0, 0, B52);
    this.page ^= 1;
    this.planeFill(3, 0, 0x2bc0, 0xff);
    this.planeFill(3, 0x6a40, 0x2bc0, 0xff);
    this.border(8);
    this.rawRead(0x6f7fd, B4c, 0x3c, 0x3594);
    this.dec3(B4c, 0x3c, B52);
    this.put3(0, 0x78, 0x50, 0x80, B52, 0);
    this.loadEntry(B4c, 1); this.loadEntry(B4e, 2);
    await this.waitSkip();
    await this.fadeSkip(4, 0x0246);
  }
  async scene2() {                                                                // 5e7a
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    this.timerAdd(0x78); this.page ^= 1;
    this.dec4(B50, this.graphOfs(B50, 0), B56);
    await this.waitSkip();
    await this.fadeSkip(4, 0x0336);
    this.fillRect(0, 0x64, 0x50, 0xc8, 7);
    this.getImage(4, 0xb4, 0x48, 0x28, 0x2d00, B56);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    for (let si = 0; si < 8; si++) {
      this.textToBuf(B56, 8, 0x48, 0x28);
      this.ditherPut(4, 0xb4, 0x48, 0x28, 0, B56, 0);
      await this.waitAddSkip(4);
    }
    this.timerAdd(0xb4);
    this.dec4(B4c, this.graphOfs(B4c, 0), B52);
    this.dec4(B4c, this.graphOfs(B4c, 1), B54);
    await this.waitSkip();
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    for (let si = 0; si < 8; si++) {
      this.ditherPut(4, 0xb4, 0x48, 0x28, 0x2d00, B56, 0);
      await this.waitAddSkip(4);
    }
    this.timerAdd(0x0c); this.page ^= 1;
    this.put4(0, 0x64, 0x50, 0xc8, 0, 0, B52);
    await this.waitSkip();
    await this.fadeSkip(8, 0x0126);
    this.timerAdd(0x78);
    this.dec4(B4e, this.graphOfs(B4e, 0), B52);
    this.dec4(B4e, this.graphOfs(B4e, 1), B54);
    this.loadEntry(B4e, 3);
    await this.waitSkip();
    for (let si = 0; si < 0x50; si++) {
      this.timerAdd(8); this.page ^= 1;
      if (si & 1) this.scrollCopy(0, 0x64, 0x50, 0xc8, ((si & 0xfe) << 1) & 0xffff, B52, 0xa0);
      await this.waitSkip();
      if (si >= 0x40) await this.palStep(0x0306);
    }
    this.border(0);
  }
  async dissolve(col, y, w, h, buf) {                                             // 51a9: 平面 0→1→2 依序网点溶入, 最后平面 3 直接拷贝
    this.ditherPlane(0, 0, 0, 0, 0, null, 0x8080, 0xa800);
    let di = w;
    for (let si = 0; si < 4; si++) { this.ditherPlane(col, y, di, h, 0, buf, 0); await this.waitAddSkip(1); }
    this.timerAdd(1);
    this.planeCopy(col, y, di, h, 0, buf, 0xa800);
    this.ditherPlane(0, 0, 0, 0, 0, null, 0x8080, 0xb000);
    await this.waitSkip();
    for (let k = 0; k < 4; k++) { this.ditherPlane(col, y, w, h, 1, buf, 0); await this.waitAddSkip(1); }
    di = w;
    this.timerAdd(1);
    this.planeCopy(col, y, di, h, 1, buf, 0xb000);
    this.ditherPlane(0, 0, 0, 0, 0, null, 0x8080, 0xb800);
    await this.waitSkip();
    for (let k = 0; k < 4; k++) { this.ditherPlane(col, y, di, h, 2, buf, 0); await this.waitAddSkip(1); }
    this.timerAdd(2);
    this.planeCopy(col, y, di, h, 2, buf, 0xb800);
    this.planeCopy(col, y, di, h, 3, buf, 0xe000);
    await this.waitSkip();
  }
  async scene3() {                                                                // 614e
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    const A = new Int16Array(7), X = new Int16Array(14), Y = new Int16Array(14);   // [bp-14h] / [bp-4ch] / [bp-30h]
    this.timerAdd(0x3c);
    this.dec4(B50, this.graphOfs(B50, 1), B56);
    this.dec4(B4e, this.graphOfs(B4e, 5), B52);
    for (let si = 0; si < 5; si++) this.dec4(B4e, this.graphOfs(B4e, si), B54, si << 9);
    this.cls();
    this.planeCopy(0x0b, 0x30, 0x3a, 0x118, 0, B52, 0xe000);
    for (let si = 0; si < 7; si++) { A[si] = this.sw(0x08f6, si); X[si] = X[si + 7] = Y[si] = Y[si + 7] = 0; }
    while (await this.palStep(0x00f6));
    await this.waitSkip();
    for (let k = 0; k < 0x19; k++) {
      this.timerAdd(2);
      for (let si = 0; si < 7; si++) {
        let di = 7 * this.page + si;
        this.clear3(X[di] & 0xffff, Y[di] & 0xffff, 4, 0x20);
        if (A[si] >= this.sw(0x0904, si)) {
          if (A[si] >= this.sw(0x0920, si)) { A[si] = this.sw(0x0920, si); di = this.sw(0x092e, si); }
          else {
            const w912 = this.sw(0x0912, si), w904 = this.sw(0x0904, si);
            const cx = s16(w912 - this.sw(0x092e, si)), dv = s16(this.sw(0x0920, si) - w904);
            const prod = s16(Math.imul(s16(w904 - A[si]), cx));                 // imul 后 cwd: 只用乘积低 16 比特
            di = s16(Math.trunc(prod / dv) + w912);
          }
          this.put4(A[si] & 0xffff, di & 0xffff, 4, 0x20, 3, (this.w(0x08c4 + 2 * k) << 9) & 0xffff, B54);
          const d2 = 7 * this.page + si; X[d2] = A[si]; Y[d2] = di;
        }
        A[si] += 2;
      }
      if (k >= 0x0c) await this.palStep(0x0156);
      await this.waitSkip();
    }
    this.timerAdd(0x14);
    for (let si = 0; si < 7; si++) { const di = 7 * this.page + si; this.clear3(X[di] & 0xffff, Y[di] & 0xffff, 4, 0x20); }
    this.put4(0x0b, 0x30, 0x3a, 0x118, 0, 0, B52);
    this.dec4(B4e, this.graphOfs(B4e, 6), B52);
    await this.waitSkip();
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    this.timerAdd(0x78);
    while (await this.palStep(0x00f6));
    this.dec4(B4e, this.graphOfs(B4e, 7), B52);
    for (let si = 0; si < 3; si++) this.dec4(B4e, this.graphOfs(B4e, si + 8), B54, (si * 0x2a0) & 0xffff);
    this.loadEntry(B4c, 4);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    await this.dissolve(0x13, 0x40, 0x0c, 0x78, B52);
    for (let si = 0; si < 0x5a; si++) {
      this.timerAdd(2);
      if (si < 8) {
        this.textToBuf(B56, 0, 0x24, 0xd8);
        this.ditherPut(0x24, 0x40, 0x24, 0xd8, 0, B56, 0);
      }
      const di = (si + 0x28) % 0x32;
      if (di < 5) {
        const t = -(Math.abs(di - 2) - 2);
        this.put4(0x17, 0x68, 7, 0x18, 0, (0x2a0 * t) & 0xffff, B54);
      }
      await this.waitSkip();
    }
  }
  // 场景 4..7 共用的结尾: 文字网点溶入 (前 8 次) + 每 0x32 次眨眼 5 格 (DS:0898/08ae[idx])
  async intro(idx, tcol, ty, tw, th, ecol, ey, ew, eh, estep, ebuf, eoff = 0) {
    for (let si = 0; si < 0x5a; si++) {
      this.timerAdd(2);
      if (si < 8) {
        this.textToBuf(this.B56, idx, tw, th);
        this.ditherPut(tcol, ty, tw, th, 0, this.B56, 0);
      }
      const di = (si + 0x28) % 0x32;
      if (di < 5) {
        const t = -(Math.abs(di - 2) - 2);
        this.put4(ecol, ey, ew, eh, 0, (eoff + estep * t) & 0xffff, ebuf);
      }
      await this.waitSkip();
    }
  }
  async scene4() {                                                                // 65af
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    const X = [0, 0], Y = [0, 0];                                                 // [bp-8] / [bp-0ch] (以 [0468] 为索引)
    this.timerAdd(0x3c);
    for (let si = 0; si < 3; si++) this.dec4(B4c, this.graphOfs(B4c, si), B54, (si * 0x3720) & 0xffff);
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x0156));
    this.dec4(B50, this.graphOfs(B50, 2), B56);
    this.dec4(B4c, this.graphOfs(B4c, 3), B52);
    await this.waitSkip();
    const p = () => this.page & 0xff;
    for (let si = 0; si < 0x19; si++) {
      this.timerAdd(2);
      this.clearPlane3(X[p()], Y[p()], 0x15, 0xa8);
      this.planeCopy(0x26, 0x20, 0x15, 0xa8, (((si & 7) < 4 ? 1 : 2) * 0x3720 + (si & 3)) & 0xffff, B54, 0xe000);
      X[p()] = 0x26; Y[p()] = 0x20;
      await this.waitSkip();
    }
    for (let si = 0; si < 0x0c; si++) {
      this.timerAdd(2);
      this.clearPlane3(X[p()], Y[p()], 0x15, 0xa8);
      const cx = this.w(0x0942 + 2 * si), cy = this.w(0x095a + 2 * si);
      this.planeCopy(cx, cy, 0x15, 0xa8, ((((si + 1) & 7) < 4 ? 1 : 2) * 0x3720 + ((si + 1) & 3)) & 0xffff, B54, 0xe000);
      X[p()] = cx; Y[p()] = cy;
      await this.waitSkip();
    }
    for (let si = 0; si < 4; si++) {
      this.timerAdd(4);
      this.clearPlane3(X[p()], Y[p()], 0x15, 0xa8);
      this.planeCopy(0x15, 0x38, 0x15, 0xa8, ((((si - 3) & 7) < 4 ? 1 : 2) * 0x3720 + ((si + 1) & 3)) & 0xffff, B54, 0xe000);
      X[p()] = 0x15; Y[p()] = 0x38;
      await this.waitSkip();
    }
    this.timerAdd(4);
    this.clearPlane3(X[p()], Y[p()], 0x15, 0xa8);
    this.put4(0x15, 0x38, 0x15, 0xa8, 0, 0, B54);
    while (await this.palStep(0x00f6));
    await this.waitSkip();
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    this.timerAdd(0x78);
    this.dec4(B4c, this.graphOfs(B4c, 4), B52);
    for (let si = 0; si < 3; si++) this.dec4(B4c, this.graphOfs(B4c, si + 5), B54, si * 0x240);
    this.loadEntry(B4e, 5);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    await this.dissolve(0x18, 0x30, 0x2a, 0xe8, B52);
    await this.intro(1, 6, 0x40, 0x24, 0xb0, 0x36, 0x78, 6, 0x18, 0x240, B54);
  }
  // 场景 5..7 前半: 头像以平面 3 逐格移动 (位置表 tcol/trow, 格号表 tfrm), 每格前清掉上一格
  async walk(n, wait, tfrm, tcol, trow, w, h, stride, X, Y) {
    const p = () => this.page & 0xff;
    for (let si = 0; si < n; si++) {
      this.timerAdd(wait);
      const f = this.sw(tfrm, si), di = f % 4;
      this.clearPlane3(X[p()], Y[p()], w, h);
      const base = ((f >= 4 ? 2 : 1) * stride) & 0xffff;
      const cx = this.w(tcol + 2 * si), cy = this.w(trow + 2 * si);
      this.planeCopy(cx, cy, w, h, (base + di) & 0xffff, this.B54, 0xe000);
      X[p()] = cx; Y[p()] = cy;
      await this.waitSkip();
    }
  }
  async scene5() {                                                                // 6a58
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    const X = [0, 0], Y = [0, 0];
    this.timerAdd(0x4b);
    for (let si = 0; si < 3; si++) this.dec4(B4e, this.graphOfs(B4e, si), B54, (si * 0x1200) & 0xffff);
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x0156));
    this.dec4(B50, this.graphOfs(B50, 3), B56);
    this.dec4(B4e, this.graphOfs(B4e, 3), B52);
    await this.waitSkip();
    await this.walk(0x1a, 4, 0x0972, 0x09a6, 0x09da, 0x0c, 0x60, 0x1200, X, Y);
    this.timerAdd(4);
    this.clearPlane3(X[this.page & 0xff], Y[this.page & 0xff], 0x0c, 0x60);
    this.put4(7, 0xe8, 0x0c, 0x60, 0, 0, B54);
    while (await this.palStep(0x00f6));
    await this.waitSkip();
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    this.timerAdd(0x78);
    this.dec4(B4e, this.graphOfs(B4e, 4), B52);
    for (let si = 0; si < 3; si++) this.dec4(B4e, this.graphOfs(B4e, si + 5), B54, si * 0x180);
    this.loadEntry(B4c, 6);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    await this.dissolve(0x17, 0x40, 0x0f, 0x78, B52);
    await this.intro(2, 0x24, 0x40, 0x2a, 0xb0, 0x1a, 0x70, 6, 0x10, 0x180, B54);
  }
  async scene6() {                                                                // 6e0c
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    const X = [0, 0], Y = [0, 0];
    const p = () => this.page & 0xff;
    this.timerAdd(0x4b);
    for (let si = 0; si < 3; si++) this.dec4(B4c, this.graphOfs(B4c, si), B54, (si * 0x700) & 0xffff);
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x0156));
    this.dec4(B50, this.graphOfs(B50, 4), B56);
    this.dec4(B4c, this.graphOfs(B4c, 3), B52);
    await this.waitSkip();
    await this.walk(0x13, 3, 0x0a0e, 0x0a34, 0x0a5a, 7, 0x40, 0x700, X, Y);
    for (let si = 0; si < 0x19; si++) {
      this.timerAdd(Math.abs((si >> 2) - 1) * 2 + 1);
      this.clearPlane3(X[p()], Y[p()], 7, 0x40);
      this.planeCopy(0x3a, 0xb0, 7, 0x40, 0x0700 | (si & 3), B54, 0xe000);
      X[p()] = 0x3a; Y[p()] = 0xb0;
      await this.waitSkip();
    }
    this.timerAdd(4);
    this.clearPlane3(X[p()], Y[p()], 7, 0x40);
    this.put4(0x3a, 0xb0, 7, 0x40, 0, 0, B54);
    while (await this.palStep(0x00f6));
    await this.waitSkip();
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    this.timerAdd(0x78);
    this.dec4(B4c, this.graphOfs(B4c, 4), B52);
    for (let si = 0; si < 3; si++) this.dec4(B4c, this.graphOfs(B4c, si + 5), B54, si * 0x180);
    this.loadEntry(B4e, 7);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    await this.dissolve(0x2d, 0x50, 0x0c, 0x78, B52);
    await this.intro(3, 6, 0x40, 0x2a, 0xc0, 0x2f, 0x80, 6, 0x10, 0x180, B54);
  }
  async scene7() {                                                                // 7240
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    const X = [0, 0], Y = [0, 0];
    const p = () => this.page & 0xff;
    this.timerAdd(0x4b);
    for (let si = 0; si < 3; si++) this.dec4(B4e, this.graphOfs(B4e, si), B54, (si * 0x2420) & 0xffff);
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x0156));
    this.dec4(B50, this.graphOfs(B50, 5), B56);
    this.dec4(B4e, this.graphOfs(B4e, 3), B52);
    await this.waitSkip();
    for (let si = 0; si < 0x19; si++) {
      this.timerAdd(2);
      this.clearPlane3(X[p()], Y[p()], 0x11, 0x88);
      this.planeCopy(0x30, 0x10, 0x11, 0x88, (((si & 7) < 4 ? 1 : 2) * 0x2420 + (si & 3)) & 0xffff, B54, 0xe000);
      X[p()] = 0x30; Y[p()] = 0x10;
      await this.waitSkip();
    }
    await this.walk(0x1f, 2, 0x0a80, 0x0abe, 0x0afc, 0x11, 0x88, 0x2420, X, Y);
    this.timerAdd(4);
    this.clearPlane3(X[p()], Y[p()], 0x11, 0x88);
    this.put4(0x12, 0xe8, 0x11, 0x88, 0, 0, B54);
    while (await this.palStep(0x00f6));
    await this.waitSkip();
    await this.dissolve(0x0b, 0x30, 0x3a, 0x128, B52);
    this.timerAdd(0x78);
    this.dec4(B4e, this.graphOfs(B4e, 4), B52);
    for (let si = 0; si < 3; si++) this.dec4(B4e, this.graphOfs(B4e, si + 5), B54, si * 0x180);
    this.loadEntry(B4c, 8);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    await this.dissolve(0x14, 0x30, 0x0d, 0x80, B52);
    await this.intro(4, 0x24, 0x40, 0x26, 0xf0, 0x19, 0x58, 6, 0x10, 0x180, B54);
  }
  async scene8() {                                                                // 7681
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    this.timerAdd(0x4b);
    this.dec4(B4c, this.graphOfs(B4c, 5), B52);
    for (let si = 0; si < 5; si++) this.dec4(B4c, this.graphOfs(B4c, si), B54, si << 11);
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x00f6));
    this.dec4(B50, this.graphOfs(B50, 6), B56);
    await this.waitSkip();
    for (let si = 0; si < 0x2a; si++) {
      this.timerAdd(2); this.page ^= 1;
      const off = (this.w(0x0b3a + 2 * (si & 7)) << 11) & 0xffff;
      if (si < 0x19) this.put4(0x2a, 0x60, 8, 0x40, 0, off, B54); else this.clear3(0x2a, 0x60, 8, 0x40);
      if (si > 7 && si < 0x21) this.put4(0x2d, 0xb0, 8, 0x40, 0, off, B54); else this.clear3(0x2d, 0xb0, 8, 0x40);
      if (si > 0x0f && si < 0x29) this.put4(0x35, 0x58, 8, 0x40, 0, off, B54); else this.clear3(0x35, 0x58, 8, 0x40);
      await this.waitSkip();
    }
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    this.timerAdd(0x50);
    // 缓冲段 [0052]: +0 / +48h / +b4h 段 (字节 0 / 0x480 / 0xb40) 三组 3 格
    for (let si = 0; si < 3; si++) {
      this.dec4(B4c, this.graphOfs(B4c, si + 6), B52, si * 0x180);
      this.dec4(B4c, this.graphOfs(B4c, si + 9), B52, 0x480 + si * 0x240);
      this.dec4(B4c, this.graphOfs(B4c, si + 0x0c), B52, 0xb40 + si * 0x180);
    }
    this.loadEntry(B4e, 9);
    await this.waitSkip();
    const e1 = B52, e2 = B52.subarray(0x480), e3 = B52.subarray(0xb40);
    for (let si = 0; si < 0x5a; si++) {
      this.timerAdd(2);
      if (si < 8) {
        this.textToBuf(B56, 5, 0x28, 0x40);
        this.ditherPut(6, 0xb0, 0x28, 0x40, 0, B56, 0);
      }
      const t = d => -(Math.abs(d - 2) - 2);
      let di = si % 0x32;
      if (di < 5) this.put4(0x2b, 0x78, 6, 0x10, 0, (t(di) * 0x180) & 0xffff, e1);
      di = (si + 0x28) % 0x3c;
      if (di < 5) this.put4(0x2e, 0xc0, 6, 0x18, 0, (t(di) * 0x240) & 0xffff, e2);
      di = (si + 0x34) % 0x37;
      if (di < 5) this.put4(0x37, 0x70, 6, 0x10, 0, (t(di) * 0x180) & 0xffff, e3);
      await this.waitSkip();
    }
  }
  async scene9() {                                                                // 7a7e
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    this.timerAdd(0x4b);
    this.dec4(B4e, this.graphOfs(B4e, 0x0a), B52);
    for (let si = 0; si < 5; si++) {                                              // 缓冲段 [0054] +0 / +1c2h 段
      this.dec4(B4e, this.graphOfs(B4e, si), B54, si * 0x5a0);
      this.dec4(B4e, this.graphOfs(B4e, si + 5), B54, 0x1c20 + si * 0x780);
    }
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x0186));
    this.dec4(B50, this.graphOfs(B50, 7), B56);
    await this.waitSkip();
    const e2 = B54.subarray(0x1c20);
    for (let si = 0; si < 0x10; si++) {
      this.timerAdd(4);
      const v = this.w(0x0b4a + 2 * si), di = (v & 0xf0) >> 4, a = v & 0x0f;
      if (a !== 0x0f) this.put4(0x1b, 0x48, 9, 0x28, 0, (0x5a0 * a) & 0xffff, B54);
      if (di !== 0x0f) this.put4(0x11, 0xc8, 0x0a, 0x30, 0, (di * 0x780) & 0xffff, e2);
      await this.waitSkip();
    }
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    for (let si = 0; si < 0x28; si++) {
      this.timerAdd(3);
      if (si < 8) {
        this.textToBuf(B56, 6, 0x28, 0x68);
        this.ditherPut(0x24, 0x80, 0x28, 0x68, 0, B56, 0);
      }
      await this.waitSkip();
    }
    this.timerAdd(0x3c);
    this.loadEntry(B4c, 0x0a);
    await this.waitSkip();
  }
  async scene10() {                                                               // 7cb0
    const { B4c, B4e, B50, B52, B54, B56 } = this;
    const X = [0, 0], Y = [0, 0];                                                 // [bp-0ah] / [bp-0eh]
    const p = () => this.page & 0xff;
    this.timerAdd(0x1a4);
    this.dec4(B50, this.graphOfs(B50, 8), B56);
    this.dec4(B4c, this.graphOfs(B4c, 0), B52);
    await this.waitSkip();
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x00f6));
    this.loadEntry(B4e, 3, 0);                                                    // 上限 = 前面循环结束时的 ax (0)
    for (let si = 0; si < 5; si++) this.dec4(B4e, this.graphOfs(B4e, si), B56, 0x76c0 + (si << 9));   // [0056] +76ch 段
    for (let si = 0; si < 3; si++) this.dec4(B4c, this.graphOfs(B4c, si + 1), B56, 0x80c0 + si * 0x180);   // [0056] +80ch 段
    await this.waitSkip();
    const s1 = B56.subarray(0x76c0), s2 = B56.subarray(0x80c0);
    for (let si = 0; si < 8; si++) {
      this.timerAdd(2);
      this.clear3(X[p()], Y[p()], 4, 0x20);
      const cx = this.w(0x0b7a + 2 * si), cy = this.w(0x0b8a + 2 * si);
      this.put4(cx, cy, 4, 0x20, 0, (this.w(0x0b6a + 2 * si) << 9) & 0xffff, s1);
      X[p()] = cx; Y[p()] = cy;
      await this.waitSkip();
    }
    for (let si = 0; si < 0x20; si++) {
      this.timerAdd(2);
      this.clear3(X[p()], Y[p()], 4, 0x20);
      this.put4(0x2a, 0x88, 4, 0x20, 0, (this.w(0x0b6a + 2 * (si & 7)) << 9) & 0xffff, s1);
      X[p()] = 0x2a; Y[p()] = 0x88;
      await this.waitSkip();
    }
    this.timerAdd(2);
    await this.waitSkip();
    this.timerAdd(2);
    this.clear3(0x2a, 0x88, 4, 0x20);
    await this.waitSkip();
    await this.dissolve(0x0b, 0x30, 0x3a, 0x118, B52);
    this.timerAdd(2);
    this.getImage(6, 0x40, 0x26, 0xc8, 0, B52);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    await this.intro(7, 6, 0x40, 0x26, 0xc8, 0x2e, 0x78, 6, 0x10, 0x180, s2);
    this.timerAdd(0x78);
    this.dec4(B4c, this.graphOfs(B4c, 4), B56);
    this.loadEntry(B4c, 0x0b); this.loadEntry(B4e, 0x0c);
    this.dec4(B4c, this.graphOfs(B4c, 1), B54);
    this.dec4(B4e, this.graphOfs(B4e, 1), B54);
    await this.waitSkip();
    await this.dissolve(6, 0x40, 0x26, 0xc8, B52);
    await this.dissolve(0x26, 0x48, 0x14, 0x90, B56);
    this.timerAdd(0x3c);
    this.dec4(B4c, this.graphOfs(B4c, 0), B52);
    this.dec4(B50, this.graphOfs(B50, 9), B56);
    await this.waitSkip();
  }
  async scene11() {                                                               // 8204
    const { B4e, B52, B54, B56 } = this;
    await this.fadeOutSkipCls();
    this.timerAdd(0x3c);
    while (await this.palStep(0x0306)) await this.waitAddSkip(4);
    this.put4(0, 0x64, 0x50, 0xc8, 0, 0, B52);
    while (await this.palStep(0x0126)) await this.waitAddSkip(4);
    await this.waitSkip();
    this.timerAdd(0x3c);
    this.planeFill(3, 0, 0x2bc0, 0xff);
    this.planeFill(3, 0x6a40, 0x2bc0, 0xff);
    this.border(8);
    this.dec4(B4e, this.graphOfs(B4e, 0), B52);
    await this.waitSkip();
    for (let si = 0; si < 0x40; si++) {
      this.timerAdd(0x0a); this.page ^= 1;
      if (si & 1) this.scrollCopy(0, 0x64, 0x50, 0xc8, ((si & 0xfe) << 1) & 0xffff, B52, 0x80);
      await this.waitSkip();
      if (si >= 0x30) await this.palStep(0x0336);
    }
    this.timerAdd(8);
    this.fillRect(0, 0x64, 0x50, 0xc8, 7);
    await this.waitSkip();
    this.timerAdd(0x78);
    this.getImage(4, 0xb4, 0x48, 0x28, 0, B54);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    await this.waitSkip();
    for (let si = 0; si < 8; si++) {
      this.textToBuf(B56, 0x0a, 0x2f, 0x28);
      this.textToBuf(B56, 9, 0x2f, 0x28);
      this.ditherPut(0x10, 0xb4, 0x2f, 0x28, 0, B56, 0);
      await this.waitAddSkip(2);
    }
    this.musicFlag(0);
    await this.waitAddSkip(0x12c);
    this.ditherPut(0, 0, 0, 0, 0, null, 0x8080);
    for (let si = 0; si < 8; si++) {
      this.ditherPut(4, 0xb4, 0x48, 0x28, 0, B54, 0);
      await this.waitAddSkip(2);
    }
    this.musicFade(0x28);
    while (await this.palStep(0x0306)) await this.wait(4);
  }
}

// 加载片头资源 (浏览器：读取 ArtRegistry 标准 PNG 与 opening.json)
export async function loadOpeningData(ASSETS, _loadBinary, loadJSON, art = null) {
  const [manifest, json] = await Promise.all([
    art?.manifest ? Promise.resolve(art.manifest) : loadJSON(`${ASSETS}/art/manifest.json`),
    loadJSON(`${ASSETS}/data/opening.json`),
  ]);
  const op = manifest.opening;
  const loadPack = list => Promise.all((list ?? []).map(e => loadIndexedPng(`${ASSETS}/art/${e.path}`)));
  const entries = await Promise.all([...Array(14)].map((_, i) => loadPack(op[`op${String(i).padStart(2, "0")}`])));
  const tail = await loadPack(op.tail);
  return { entries, tail, json };
}
