// opening.js — 片頭 (原版 OPEN.EXE 的移植)
//
// 原版流程: KOUKAI2.COM 依序執行 FMDRV.COM → OPEN.EXE → MAIN.EXE; 本模組 = OPEN.EXE, 結束 (播完或被跳過) 後由 main.js 進入標題。
// 逐函式翻譯自 OPEN.EXE 反組譯 (tools/re/opening*.py → tools/work/re_open*.txt); 註解中的位址 = OPEN.EXE 載入映像線性偏移,
//   [xxxx] = DGROUP (段 0a0b) 變數, DS:xxxx 常數表取自 assets/data/opening.json (tools/extract_open.py 原樣提取)。
//
// 顯示: VGA mode 12h (640x480 16 色平面)。原版直接操作 VRAM 與 VGA 暫存器 (遊戲區 = 第 40..439 行, 片頭還會寫到上下黑邊),
//   這裡以 OpVGA 模擬 4 平面 + 鎖存器 + 序列器映射遮罩 + 圖形控制器 (硬體行為), 函式庫逐句翻譯成對它的讀寫;
//   呈現時把 480 行轉成索引畫面交給 Screen.full, DAC 以 Screen.setDac6 逐色設定 (與原版 17f0 相同)。
// 計時: FMDRV INT 66h 倒數 (F1 01 設定 / F1 00 讀取, 1 tick = 16.58 ms) → sys.timer。
// 跳過: 4f0d 系等待中按 Enter/空白鍵/滑鼠單鍵、4fd5 系等待中按 Esc → 4ee4 (音樂淡出、畫面淡黑) → 8747 結束程式。
// 音樂: OPEN.EXE 內含自己的 FM 樂曲資料 (091a:0002, 以 INT 66h AH=0 載入), 場景 0 播放其中第 0 首 (驅動曲號 1)。
//   網頁版以 BGM 介面播放 bgm.map.opening (對應的 PS 版音檔由 BGM 對齊工作決定)。

// ---------------- VGA 平面模型 (硬體行為, 與開發用模擬器 tools/emu/x86emu.js 的 VGA 相同) ----------------
export class OpVGA {
  constructor() {
    this.planes = [0, 1, 2, 3].map(() => new Uint8Array(0x10000));
    this.latch = new Uint8Array(4);
    this.seq = new Uint8Array(8); this.seq[2] = 0x0f;
    this.gc = new Uint8Array(16); this.gc[8] = 0xff;
    this.overscan = 0;                    // 屬性控制器 0x11 (外框色)
    this.dirty = true;
  }
  outSeq(i, v) { this.seq[i & 7] = v & 255; }
  outGC(i, v) { this.gc[i & 15] = v & 255; }
  read(off) {
    off &= 0xffff;
    const L = this.latch, P = this.planes;
    L[0] = P[0][off]; L[1] = P[1][off]; L[2] = P[2][off]; L[3] = P[3][off];
    if (this.gc[5] & 8) {                 // 讀取模式 1 (色彩比較)
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
  // 640x480 索引畫面
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

// 3df5 字碼 → 字序 (與 MAIN.EXE seg0:4554 同一規則; 逐句翻譯, 含首碼 0x91 等邊界的 8 位元回繞)
export function opCodeToGlyph(code) {
  const L = (code >> 8) & 255, T = code & 255;
  const digit = T >= 0x30 && T <= 0x39, upper = T >= 0x41 && T <= 0x5a, lower = T >= 0x61 && T <= 0x7a, hi = T >= 0x80 && T <= 0xfd;
  let si;
  if (L === 0x82) { if (T < 0xa0 || T > 0xf3) return 0x2228; return (((T + 0x60) & 255) + 0xeb) & 0xffff; }   // si = ((0x82+0x7e)&255)*0xbc = 0
  const common = () => {                         // 3e4d / 3e6c / 3f44 (1.pat 0x81 列與 2.pat)
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
    // 記憶體區塊 (8713 → 863a: 6 塊 0x1000 段 = 64KB; 原版 [004c][004e][0050] 一般記憶體, [0052][0054][0056] 優先 EMS)
    this.B4c = new Uint8Array(0x10000); this.B4e = new Uint8Array(0x10000); this.B50 = new Uint8Array(0x10000);
    this.B52 = new Uint8Array(0x20000); this.B54 = new Uint8Array(0x20000); this.B56 = new Uint8Array(0x10000);
    this.cur = new Uint8Array(48);         // [0e82] 目前調色盤 (16 色 × B,R,G 4 位元)
    this.dac = new Uint8Array(48);         // DAC 0..15 (R,G,B 6 位元) — 測試比對用
    this.invert = 0;                       // [005c] (此版本恆為 0)
    this.page = 0;                         // [0468]
    this.cyc = 0;                          // [0366]
    this.musicOn = 1;                      // [004a] 驅動載入樂曲成功
    this.flags = 0xff;                     // [0042]
    this.song = 0;                         // [00f4]
    this.glyph = new Uint8Array(32);       // [0ec0] 字形緩衝 (28 bytes + [0edc..0edf])
    this.T = new Uint16Array(8);           // cs:0da2 圖樣表 (11da)
    this.dpat = 0; this.d2pat = 0; this.d2sel = 0;   // cs:2774 / cs:2842 / cs:2840
  }
  // ---- DS 常數 ----
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
      this.scr.setPaletteRaw(new Uint8Array(48));   // 原版結束時調色盤已淡成全黑 (MAIN.EXE 開機時目前調色盤亦為 0)
      this.scr.clear(0);
    }
  }
  present(force = false) {
    if (!force && !this.vga.dirty) return;
    this.vga.toIndexed(this.full); this.vga.dirty = false;
    this.scr.border = this.vga.overscan; this.scr.dirty = true;
  }
  async poll() { this.present(); await this.sys.poll(); }

  // ================= 主程式 =================
  async main() {                                      // 85aa (1.pat / 2.pat 已由 Font 載入)
    await this.init();                                // 8565
    await this.setup();                               // 872d
    await this.play();                                // 8481
    await this.exit();                                // 8747
  }
  async init() {                                      // 8565
    this.flags = 0xff;                                // [0042]
    this.timerZero();                                 // 4836
    this.cls();                                       // 0810
    // 8e7f: 記憶體區塊表初始化; 4bc2 → 1770: 屬性暫存器 i → i (恆等)
    await this.palFade1(0x00f6);                      // 4dd9
    // 8525: 檔名加上目前磁碟代號; 8559: 開啟 OPGRAPH.LZW
    this.musicOn = 1;                                 // 1756: INT 66h AH=0 載入樂曲資料 → [004a]
    await this.palFade1(0x0306);                      // 4de2
  }
  async setup() {                                     // 872d
    await this.palFade1(0x00f6);                      // 4dd9
    // 8713: 863a 配置記憶體; 4580 滑鼠初始化; 4686(27f,18f) 滑鼠位置 (游標不顯示)
    await this.palFade1(0x00f6);                      // 4dd9
  }
  async play() {                                      // 8481
    this.flushKeys(); await this.waitNoInput();       // 2c57, 3856, 4e59
    this.page = 0;                                    // [0468]
    const S = [this.scene0, this.scene1, this.scene2, this.scene3, this.scene4, this.scene5, this.scene6, this.scene7, this.scene8, this.scene9, this.scene10, this.scene11];
    for (const f of S) await f.call(this);            // DS:0b9a 場景表
    this.border(0);                                   // 2d0e(0)
  }
  async exit() {                                      // 8747
    await this.palFade1(0x0306);                      // 4de2
    this.cls();                                       // 0810
    // 3cdd(0,0) 文字游標; 432c(DS:0c20 = ESC C7 ESC B0: 文字主控台顏色設定, 不輸出字元); 873c 關檔; 86dd 釋放記憶體
    this.musicFade(0x14);                             // 4a0b(14h)
    throw new OpeningExit();                          // 2edb(0) 結束程式
  }
  async abort() {                                     // 4ee4
    this.musicFade(0x14);
    while (await this.palStep(0x0306)) await this.wait(4);
    await this.exit();
  }

  // ================= 計時 =================
  timerGet() { return this.sys.timer.get(); }                     // 186d (F1 00)
  timerSet(n) { this.sys.timer.set(n & 0xffff); }                 // 1860 (F1 01)
  timerZero() { this.timerSet(0); }                               // 4836
  timerAdd(n) { this.timerSet(this.timerGet() + n); }             // 4846
  async wait(n) { this.timerAdd(n); while (this.timerGet()) await this.poll(); }   // 485d
  // ================= 鍵盤 / 滑鼠 =================
  kbhit() { return this.sys.kbhit() ? 1 : 0; }                    // 2ce1 (BIOS NumLock 強制開)
  getch() { return this.sys.readRaw(); }                          // 2cfb: ASCII≠0 → ASCII, 否則 0x100|掃描碼
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
  async prepWait() { this.flushKeys(); await this.waitNoInput(); }                   // 2c57 (磁碟重置), 3856, 4e59
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

  // ================= 調色盤 =================
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
  async palStep(off) {                                                               // 4d0d: 每色每通道朝目標走 1, 有變化就寫 DAC; 一律等 1 tick
    const t = this.pal(off), c = this.cur; let ch = 0;
    for (let i = 0; i < 48; i++) if (c[i] !== t[i]) { ch = 1; if (c[i] > t[i]) c[i]--; else c[i]++; }
    if (ch) this.writeAll();
    await this.wait(1);
    return ch;
  }
  palCycleStep(off) {                                                                // 4bc8: 只動 [0366]%12 起每隔 12 的 4 個位元組, 寫全部 16 色, 不等待
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

  // ================= 音樂 (INT 66h) =================
  musicStatus() { return 0; }                                        // 4a32 (fn 3): 網頁版無法取得驅動狀態, 視為未播放 (與差分測試的模擬器相同)
  playSong(n) {                                                      // 4980
    if (!this.musicOn || !(this.flags & 4) || n > 0x17) return;
    if (this.musicStatus()) { if (this.song === n) return; this.musicFade(0x14); while (this.musicStatus()); }
    const f = this.bgm?.map?.opening;                                // fn 1 (曲號 n+1) / fn 4(1)
    if (f && this.bgm.playFile) this.bgm.playFile(f);
    this.song = n;
  }
  musicFlag(v) { }                                                   // 49e4 (fn 4: 驅動旗標 [05d6], 網頁版無對應)
  musicFade(speed) { if (this.musicOn) this.bgm?.fadeOut?.(); }      // 4a0b (fn 2)

  // ================= 繪圖函式庫 (0000..1000 段, 與 MAIN.EXE 同一套組合語言庫) =================
  gcReset() { const v = this.vga; v.outGC(1, 0); v.outGC(3, 0); v.outGC(5, 0); v.outGC(8, 0xff); }   // 0118
  clip(col, y, w, h) {                                                            // 012e: 成功傳回 VRAM 位址 (並 0118), 失敗 -1
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
  // 02a7 (經 03ce): 4 平面交錯 (每 8 像素 plane0..3 各 1 byte); mode 0 覆寫 (bit15 每行畫兩次) / 1 XOR / 2 AND / 3 OR / 4 透明
  put4(col, y, w, h, mode, off, buf) { return this.putN(4, col, y, w, h, mode & 0x7fff, mode, off, buf); }
  // 0449 (經 055e, mode 恆為 0): 3 平面交錯
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
  // 2aec: 3 平面 (來源為 4 平面交錯, 平面 3 保留), 不裁切、不重設圖形控制器; 來源到 lim 時回到 0 (循環捲動)
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
  // 2b5e: 畫面左移 8 像素 (平面 0..2); buf 不為 null 時右端補入 buf 的 1 byte/平面 (每行來源加 rowInc)
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
  fillRect(col, y, w, h, color) {                                                 // 091f: 寫入模式 2 填色 (不還原)
    const v = this.vga;
    let di = this.clip(col, y, w, h); if (di < 0) return -1;
    v.outSeq(2, 0x0f); v.outGC(5, 2);
    do { for (let c = 0; c < w; c++) { v.write(di, color); di = (di + 1) & 0xffff; } di = (di + 0x50 - w) & 0xffff; } while ((h = (h - 1) & 0xffff));
    return 0;
  }
  getImage(col, y, w, h, off, buf) {                                              // 29fe: 畫面 → 4 平面交錯緩衝
    const v = this.vga;
    let si = this.clip(col, y, w, h); if (si < 0) return;
    let di = off & 0xffff;
    do {
      const s0 = si;
      for (let c = 0; c < w; c++) { for (let bl = 0; bl < 4; bl++) { this.planeSel(bl); buf[di] = v.read(si); di = (di + 1) & 0xffff; } si = (si + 1) & 0xffff; }
      si = (s0 + 0x50) & 0xffff;
    } while ((h = (h - 1) & 0xffff));
  }
  ditherPut(col, y, w, h, off, buf, setup) {                                      // 2775: 以 cs:2774 網點圖樣逐列混入 (4 平面)
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
  ditherPlane(col, y, w, h, off, buf, setup, sel) {                               // 2843: 單一平面網點混入 (cs:2840 平面選擇, cs:2842 圖樣)
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
  planeCopy(col, y, w, h, off, buf, sel) {                                        // 28f3: 4 平面交錯緩衝的一個平面 → 畫面平面 (sel a800/b000/b800/e000)
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

  // ================= OPGRAPH.LZW =================
  loadEntry(buf, idx, limit = 0) {                                                // 8be3: 解壓第 idx 項到緩衝 0 起 (limit≠0 時最多 limit bytes)
    const e = this.data.entries[idx];
    let n = e.length; if (limit && limit < n) n = limit;
    buf.set(e.subarray(0, n), 0);
    return n;
  }
  graphOfs(buf, n) { const o = n * 4; return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0; }   // 504e
  rawRead(fileOfs, buf, bufOff, len) {                                            // 00aa lseek + 005b read (檔尾未壓縮部分)
    const s = fileOfs - this.tailStart, t = this.data.tail;
    for (let i = 0; i < len && s + i < t.length; i++) buf[(bufOff + i) & 0xffff] = t[s + i];
  }
  // 11da (經 4905): 16 色 GRAPH 格式 → 4 平面交錯記憶體緩衝 (每單位 4 像素 = 4 個位元組的同一半位元組; 偶數單位在高半位元組)
  dec4(src, so, dst, doff = 0) { return this.decN(4, src, so, dst, doff); }
  // 1513 (經 492d): 8 色格式 → 3 平面交錯緩衝
  dec3(src, so, dst, doff = 0) { return this.decN(3, src, so, dst, doff); }
  decN(np, src, so, dst, doff) {
    let sp = so;
    const rd = () => src[sp++];                                                   // 11c5
    let bx = rd(); bx |= (np === 4 ? (rd() & 0x7f) : rd()) << 8;
    let cx = rd(); cx |= rd() << 8;
    bx = ((bx + 3) >> 2) & 0xffff; const dx = bx;
    if (np === 4) for (let i = 0; i < 8; i++) { const lo = rd(), hi = rd(); this.T[i] = lo | (hi << 8); }
    const grp = u => doff + (((u >> 1) * np) & 0xffff);                           // 單位 → 位元組組的起點 (段內 16 位元回繞)
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
          if (al & 0x40) {                                                        // 1333 上方複製: 只依目的單位奇偶取來源位元組的同一半
            let si = di, k = ((al & 0x30) >> 4) + 1; do { si = (si - dx) & 0xffff; } while (--k);
            const sbase = (si & ~1) | (di & 1);
            for (let i = 0; i < cnt; i++) for (let p = 0; p < np; p++) setU(di + i, p, getU(((sbase + i) & 0xffff), p));
          } else {                                                                // 1252 同行回溯 (奇偶分 4 種, 等於逐單位複製)
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
      const n = opCodeToGlyph(code);                                              // (n-1)*28 + (n-1)/18*8 的檔案位置讀 28 bytes; 超出檔尾時讀不到 (緩衝保留)
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
  glyph2x(x, y, buf, w) {                                                         // 5bf1: 字形放大 2 倍 (32x32) → 4 平面交錯緩衝 (色 7)
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
  glyph1x(x, y, buf, w, inv) {                                                    // 5b6f / 5af3 (反白): 16x16 → 4 平面交錯緩衝
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
  textToBuf(buf, idx, w, h) {                                                     // 5d49: DS:0898[idx] (放大字) + DS:08ae[idx] (一般字) → 緩衝
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

  // ================= 場景 (DS:0b9a 表) =================
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
  async dissolve(col, y, w, h, buf) {                                             // 51a9: 平面 0→1→2 依序網點溶入, 最後平面 3 直接複製
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
            const prod = s16(Math.imul(s16(w904 - A[si]), cx));                 // imul 後 cwd: 只用乘積低 16 位元
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
  async scene4() { }
  async scene5() { }
  async scene6() { }
  async scene7() { }
  async scene8() { }
  async scene9() { }
  async scene10() { }
  async scene11() { }
}

// 載入片頭資源 (瀏覽器)
export async function loadOpeningData(ASSETS, loadBinary, loadJSON) {
  const entries = await Promise.all([...Array(14)].map((_, i) => loadBinary(`${ASSETS}/gfx/opgraph/${String(i).padStart(2, "0")}.dat`)));
  const [tail, json] = await Promise.all([loadBinary(`${ASSETS}/gfx/opgraph/tail.dat`), loadJSON(`${ASSETS}/data/opening.json`)]);
  return { entries, tail, json };
}
