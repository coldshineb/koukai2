// sys.js — 原版底層服務: 亂數 / 計時器 / 鍵盤 / 滑鼠 (MAIN.EXE 輸入與計時原語的移植)
//
// 計時器: 原版經 FMDRV.COM 的 INT 66h 服務 (F1 01 設定倒數, F1 00 讀取)。
//   FMDRV 把 PIT 設為 4096 分頻 (291.30 Hz), 每次 IRQ0 對累加器加 0x35, 溢位時倒數減一,
//   所以一個「tick」= 4096*256/(1193182*53) 秒 ≈ 16.58 ms (60.31 Hz)。
export const PIT_HZ = 1193181.67;
export const TICK_HZ = PIT_HZ / 4096 * 0x35 / 256;   // 60.309
export const TICK_MS = 1000 / TICK_HZ;                 // 16.581

// seg0:4d92 rand(): 32 位元 LCG, state = state*0x41C64E6D + 0x3039, 回傳 (state>>16)&0x7fff
export class Rng {
  constructor(seed = 0) { this.state = seed >>> 0; }
  seed(v) { this.state = v & 0xffff; }                                      // seg0:4dba
  rand() { this.state = (Math.imul(this.state, 0x41c64e6d) + 0x3039) >>> 0; return (this.state >>> 16) & 0x7fff; }
  random(n) { const r = this.rand(); return n ? r % n : 0; }               // seg0:4dc4 (n=0 時仍會消耗一次)
}

// 功能鍵/方向鍵掃描碼 -> 遊戲內碼 (seg0:3fc5 表 @3fe5, 掃描碼 0x3B..0x53)
const SCAN_MAP = { 0x3b: 0x16, 0x3c: 0x14, 0x3d: 0x02, 0x3e: 0x19, 0x48: 0x1e, 0x49: 0x3f, 0x4b: 0x1d, 0x4d: 0x1c, 0x50: 0x1f, 0x51: 0x3e, 0x53: 0x7f };

export class Timer {
  // virtual: 測試模式 — 每次讀取減一 (與模擬器的 INT 66h 測試樁相同)
  constructor(virtual = false) { this.virtual = virtual; this.count = 0; this.t0 = 0; this.n0 = 0; }
  set(n) { this.count = n & 0xffff; this.n0 = this.count; if (!this.virtual) this.t0 = performance.now(); }  // seg0:16a8
  get() {                                                                                 // seg0:16b5
    if (this.virtual) { if (this.count) this.count--; return this.count; }
    const el = Math.floor((performance.now() - this.t0) / TICK_MS);
    this.count = Math.max(0, this.n0 - el); return this.count;
  }
}

export class Sys {
  constructor({ virtual = false, poll = null } = {}) {
    this.rng = new Rng();
    this.timer = new Timer(virtual);
    this.keybuf = [];                    // BIOS 鍵盤緩衝 (word: scan<<8 | ascii), 最多 15
    this.mouse = { x: 320, y: 240, buttons: 0, present: true, hotspot: 0, visible: 0, shape: 0x2570 };
    this.speed = 2;                      // [0ca5] 環境設定「顯示速度」
    this.poll = poll || (() => new Promise(r => setTimeout(r, 1)));
    this.onIO = null;                    // 測試用: 每次 kbhit / INT33 fn3 等效呼叫的回呼
  }
  // ---- 瀏覽器事件輸入 ----
  pushKey(scan, ascii) { if (this.keybuf.length < 15) this.keybuf.push((scan << 8) | ascii); }
  // ---- 鍵盤 ----
  kbhit() { this.onIO?.(this); return this.keybuf.length > 0; }          // seg0:2aaf (並強制 NumLock 開)
  readRaw() { const w = this.keybuf.shift() ?? 0; const al = w & 0xff; return al ? al : 0x100 | (w >> 8); }   // seg0:2ac9
  flush() { while (this.kbhit()) this.readRaw(); }                         // seg0:3fae
  translate() {                                                            // seg0:3fc5
    const v = this.readRaw();
    if (v >= 0x100) { const m = SCAN_MAP[v & 0xff]; return m ?? 0xff; }
    return v === 0x20 ? 0x0d : v;
  }
  getKey() { const k = this.translate(); this.flush(); return k & 0xff; }   // seg0:4054
  // ---- 滑鼠 (INT 33h) ----
  mouseLeft() { if (!this.mouse.present) return 0; this.onIO?.(this); return this.mouse.buttons & 1 ? 1 : 0; }   // seg0:4f75
  mouseRight() { if (!this.mouse.present) return 0; this.onIO?.(this); return this.mouse.buttons & 2 ? 1 : 0; }  // seg0:4fac
  mouseAny() { return this.mouseLeft() || this.mouseRight() ? 1 : 0; }              // seg0:507e
  mouseEvent() { return 0x80 | this.mouseLeft() | (this.mouseRight() << 1); }       // seg0:5092
  mousePos() {                                                                      // seg0:4efa
    if (!this.mouse.present) return { x: 0, y: 0 };
    this.onIO?.(this);
    return { x: this.mouse.x + this.mouse.hotspot, y: this.mouse.y + this.mouse.hotspot - 0x28 };
  }
  // seg0:4fe3 INT 33h fn 0Bh: 自上次讀取以來的移動量 (mickey), 讀後歸零
  mickeys() { const m = this.mouse, r = { h: m.mdx | 0, v: m.mdy | 0 }; m.mdx = 0; m.mdy = 0; return r; }
  setMousePos(x, y) { this.mouse.x = x - this.mouse.hotspot; this.mouse.y = y + 0x28 - this.mouse.hotspot; }   // seg0:4f44
  setCursorShape(off) { this.mouse.shape = off; this.mouse.hotspot = off === 0x2840 ? 0x10 : 0; }  // seg0:5050
  // seg0:4ecf 顯示計數 [03d6] (位元組) +1; 由 0 變 1 時 seg0:2f9a 以 INT 33h fn 3 讀位置後畫游標 (算一次滑鼠查詢)
  mouseShow() { if (!this.mouse.present) return; const old = this.mouse.visible; this.mouse.visible = (old + 1) & 0xff; if (old === 0) this.onIO?.(this); }
  // seg0:4ee7 -1; 變成 0 時 seg0:2fc0 擦除游標
  mouseHide() { if (!this.mouse.present) return; this.mouse.visible = (this.mouse.visible - 1) & 0xff; }
  // ---- 計時 ----
  async waitTicks(n) { this.timer.set(n); while (this.timer.get()) await this.poll(); }        // seg0:5998
  async waitTenths(n) { return this.waitTicks(6 * n); }                                       // seg0:59af
  async waitSpeed(n) { return this.waitTenths((this.speed * n * 2) & 0xffff); }                // seg0:59c1
  async waitOrKey(n) {                                                                         // seg0:59d7
    this.timer.set(n);
    for (;;) {
      if (!this.timer.get()) return 0;
      if (this.kbhit()) { const k = this.getKey(); if (k === 0x0d || k === 0x1b || k === 0x30) return 1; }
      if (this.mouseAny()) return 1;
      await this.poll();
    }
  }
  async waitOrKeyTenths(n) { return this.waitOrKey(6 * n); }                                   // seg0:5a1b
}
