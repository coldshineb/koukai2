// sys.js — 現代底層服務: 亂數 / 原生計時器 (支援倍速與暫停) / 鍵盤 / 滑鼠
export const PIT_HZ = 1193181.67;
export const TICK_HZ = PIT_HZ / 4096 * 0x35 / 256;   // 60.309 Hz
export const TICK_MS = 1000 / TICK_HZ;                 // 16.581 ms
export const PIT_MS = 4096 / PIT_HZ * 1000;            // 3.433 ms

// seg0:4d92 rand(): 32 位元 LCG, state = state*0x41C64E6D + 0x3039, 回傳 (state>>16)&0x7fff
export class Rng {
  constructor(seed = 0) { this.state = seed >>> 0; }
  seed(v) { this.state = v & 0xffff; }
  rand() { this.state = (Math.imul(this.state, 0x41c64e6d) + 0x3039) >>> 0; return (this.state >>> 16) & 0x7fff; }
  random(n) { const r = this.rand(); return n ? r % n : 0; }
}

// 功能鍵/方向鍵掃描碼 -> 遊戲內碼
const SCAN_MAP = { 0x3b: 0x16, 0x3c: 0x14, 0x3d: 0x02, 0x3e: 0x19, 0x48: 0x1e, 0x49: 0x3f, 0x4b: 0x1d, 0x4d: 0x1c, 0x50: 0x1f, 0x51: 0x3e, 0x53: 0x7f };

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Timer {
  constructor(virtual = false, getScale = () => 1) {
    this.virtual = virtual;
    this.getScale = getScale;
    this.count = 0;
    this.remMs = 0;
    this.lastMs = 0;
  }
  set(n) {
    this.count = n & 0xffff;
    this.remMs = this.count * TICK_MS;
    this.lastMs = nowMs();
  }
  get() {
    if (this.virtual) { if (this.count) this.count--; return this.count; }
    const t = nowMs(), dt = Math.max(0, Math.min(200, t - this.lastMs));
    this.lastMs = t;
    const scale = this.getScale();
    if (scale > 0 && this.remMs > 0) this.remMs = Math.max(0, this.remMs - dt * scale);
    this.count = Math.ceil(this.remMs / TICK_MS);
    return this.count;
  }
}

function yieldFrame() {
  if (typeof requestAnimationFrame === "function") {
    return new Promise(r => requestAnimationFrame(() => r()));
  }
  return new Promise(r => setTimeout(r, 16));
}

export class Sys {
  constructor({ virtual = false, poll = null } = {}) {
    this.rng = new Rng();
    this.timeScale = 1;                  // 現代倍速: 0 = 暫停, 1 = 1x, 2 = 2x, 4 = 4x
    this.timer = new Timer(virtual, () => this.timeScale);
    this.keybuf = [];
    this.mouse = { x: 320, y: 240, buttons: 0, present: true, hotspot: 0, visible: 0, shape: 0x2570 };
    this.speed = 2;                      // 環境設定「顯示速度」
    this.poll = poll || yieldFrame;
    this.onIO = null;
  }
  // ---- 瀏覽器事件輸入 ----
  pushKey(scan, ascii) { if (this.keybuf.length < 15) this.keybuf.push((scan << 8) | ascii); }
  // ---- 鍵盤 ----
  kbhit() { this.onIO?.(this); return this.keybuf.length > 0; }
  readRaw() { const w = this.keybuf.shift() ?? 0; const al = w & 0xff; return al ? al : 0x100 | (w >> 8); }
  flush() { while (this.kbhit()) this.readRaw(); }
  translate() {
    const v = this.readRaw();
    if (v >= 0x100) { const m = SCAN_MAP[v & 0xff]; return m ?? 0xff; }
    return v === 0x20 ? 0x0d : v;
  }
  getKey() { const k = this.translate(); this.flush(); return k & 0xff; }
  // ---- 滑鼠 ----
  mouseLeft() { if (!this.mouse.present) return 0; this.onIO?.(this); return this.mouse.buttons & 1 ? 1 : 0; }
  mouseRight() { if (!this.mouse.present) return 0; this.onIO?.(this); return this.mouse.buttons & 2 ? 1 : 0; }
  mouseAny() { return this.mouseLeft() || this.mouseRight() ? 1 : 0; }
  mouseEvent() { return 0x80 | this.mouseLeft() | (this.mouseRight() << 1); }
  mousePos() {
    if (!this.mouse.present) return { x: 0, y: 0 };
    this.onIO?.(this);
    return { x: this.mouse.x + this.mouse.hotspot, y: this.mouse.y + this.mouse.hotspot - 0x28 };
  }
  mickeys() { const m = this.mouse, r = { h: m.mdx | 0, v: m.mdy | 0 }; m.mdx = 0; m.mdy = 0; return r; }
  setMousePos(x, y) { this.mouse.x = x - this.mouse.hotspot; this.mouse.y = y + 0x28 - this.mouse.hotspot; }
  setCursorShape(off) { this.mouse.shape = off; this.mouse.hotspot = off === 0x2840 ? 0x10 : 0; }
  mouseShow() { if (!this.mouse.present) return; const old = this.mouse.visible; this.mouse.visible = (old + 1) & 0xff; if (old === 0) this.onIO?.(this); }
  mouseHide() { if (!this.mouse.present) return; this.mouse.visible = (this.mouse.visible - 1) & 0xff; }
  // ---- 計時 ----
  async waitTicks(n) { this.timer.set(n); while (this.timer.get()) await this.poll(); }
  async waitTenths(n) { return this.waitTicks(6 * n); }
  async waitSpeed(n) { return this.waitTenths((this.speed * n * 2) & 0xffff); }
  async waitOrKey(n) {
    this.timer.set(n);
    for (;;) {
      if (!this.timer.get()) return 0;
      if (this.kbhit()) { const k = this.getKey(); if (k === 0x0d || k === 0x1b || k === 0x30) return 1; }
      if (this.mouseAny()) return 1;
      await this.poll();
    }
  }
  async waitOrKeyTenths(n) { return this.waitOrKey(6 * n); }
}
