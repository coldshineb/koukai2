// sys.js — 原版底层服务: 随机数 / 计时器 / 键盘 / 鼠标 (MAIN.EXE 输入与计时原语的移植)
//
// 计时器: 原版经 FMDRV.COM 的 INT 66h 服务 (F1 01 设置倒数, F1 00 读取)。
//   FMDRV 把 PIT 设为 4096 分频 (291.30 Hz), 每次 IRQ0 对累加器加 0x35, 溢出时倒数减一,
//   所以一个「tick」= 4096*256/(1193182*53) 秒 ≈ 16.58 ms (60.31 Hz)。
export const PIT_HZ = 1193181.67;
export const TICK_HZ = PIT_HZ / 4096 * 0x35 / 256;   // 60.309
export const TICK_MS = 1000 / TICK_HZ;                 // 16.581
export const PIT_MS = 4096 / PIT_HZ * 1000;            // IRQ0 间隔 3.433 ms
import { CPU } from "./cpucost.js";

// seg0:4d92 rand(): 32 比特 LCG, state = state*0x41C64E6D + 0x3039, 返回 (state>>16)&0x7fff
export class Rng {
  constructor(seed = 0) { this.state = seed >>> 0; }
  seed(v) { this.state = v & 0xffff; }                                      // seg0:4dba
  rand() { this.state = (Math.imul(this.state, 0x41c64e6d) + 0x3039) >>> 0; return (this.state >>> 16) & 0x7fff; }
  random(n) { const r = this.rand(); return n ? r % n : 0; }               // seg0:4dc4 (n=0 时仍会消耗一次)
}

// 功能键/方向键扫描码 -> 游戏内码 (seg0:3fc5 表 @3fe5, 扫描码 0x3B..0x53)
const SCAN_MAP = { 0x3b: 0x16, 0x3c: 0x14, 0x3d: 0x02, 0x3e: 0x19, 0x48: 0x1e, 0x49: 0x3f, 0x4b: 0x1d, 0x4d: 0x1c, 0x50: 0x1f, 0x51: 0x3e, 0x53: 0x7f };

export class Timer {
  // virtual: 测试模式 — 每次读取减一 (与模拟器的 INT 66h 测试桩相同)
  constructor(virtual = false) { this.virtual = virtual; this.count = 0; this.t0 = 0; this.n0 = 0; }
  // 实际时间 (RE_NOTES 32.2): FMDRV F1 01 设置时累加器 [0123] 归零, 之后每次 IRQ0 (全域相位, 3.433 ms) +35h, 进位时减一;
  //   时间取 core/cpucost.js 的虚拟时钟 (含原版 CPU 运行时间), 连续等待不会因轮询延迟而累积误差
  set(n) { this.count = n & 0xffff; this.n0 = this.count; if (!this.virtual) this.k0 = Math.floor(CPU.now() / PIT_MS); }  // seg0:16a8
  get() {                                                                                 // seg0:16b5
    if (this.virtual) { if (this.count) this.count--; return this.count; }
    const k = Math.floor(CPU.now() / PIT_MS) - this.k0, dec = Math.floor(k * 0x35 / 256);
    this.count = Math.max(0, this.n0 - dec);
    if (this.count) CPU.wakeAt = (this.k0 + Math.ceil((dec + 1) * 256 / 0x35)) * PIT_MS;   // 下一次减一的时间 (Sys.poll 准时醒来)
    return this.count;
  }
}

export class Sys {
  constructor({ virtual = false, poll = null } = {}) {
    this.rng = new Rng();
    this.timer = new Timer(virtual);
    this.keybuf = [];                    // BIOS 键盘缓冲 (word: scan<<8 | ascii), 最多 15
    this.mouse = { x: 320, y: 240, buttons: 0, present: true, hotspot: 0, visible: 0, shape: 0x2570 };
    this.speed = 2;                      // [0ca5] 环境设置「显示速度」
    this.poll = poll || (() => CPU.sync());   // 轮询点: 先等真实时间追上虚拟时钟 (core/cpucost.js)
    this.onIO = null;                    // 测试用: 每次 kbhit / INT33 fn3 等效调用的回呼
  }
  // ---- 浏览器事件输入 ----
  pushKey(scan, ascii) { if (this.keybuf.length < 15) this.keybuf.push((scan << 8) | ascii); }
  // ---- 键盘 ----
  kbhit() { this.onIO?.(this); return this.keybuf.length > 0; }          // seg0:2aaf (并强制 NumLock 开)
  readRaw() { const w = this.keybuf.shift() ?? 0; const al = w & 0xff; return al ? al : 0x100 | (w >> 8); }   // seg0:2ac9
  flush() { while (this.kbhit()) this.readRaw(); }                         // seg0:3fae
  translate() {                                                            // seg0:3fc5
    const v = this.readRaw();
    if (v >= 0x100) { const m = SCAN_MAP[v & 0xff]; return m ?? 0xff; }
    return v === 0x20 ? 0x0d : v;
  }
  getKey() { const k = this.translate(); this.flush(); return k & 0xff; }   // seg0:4054
  // ---- 鼠标 (INT 33h) ----
  mouseLeft() { if (!this.mouse.present) return 0; this.onIO?.(this); return this.mouse.buttons & 1 ? 1 : 0; }   // seg0:4f75
  mouseRight() { if (!this.mouse.present) return 0; this.onIO?.(this); return this.mouse.buttons & 2 ? 1 : 0; }  // seg0:4fac
  mouseAny() { return this.mouseLeft() || this.mouseRight() ? 1 : 0; }              // seg0:507e
  mouseEvent() { return 0x80 | this.mouseLeft() | (this.mouseRight() << 1); }       // seg0:5092
  mousePos() {                                                                      // seg0:4efa
    if (!this.mouse.present) return { x: 0, y: 0 };
    this.onIO?.(this);
    return { x: this.mouse.x + this.mouse.hotspot, y: this.mouse.y + this.mouse.hotspot - 0x28 };
  }
  // seg0:4fe3 INT 33h fn 0Bh: 自上次读取以来的移动量 (mickey), 读后归零
  mickeys() { const m = this.mouse, r = { h: m.mdx | 0, v: m.mdy | 0 }; m.mdx = 0; m.mdy = 0; return r; }
  setMousePos(x, y) { this.mouse.x = x - this.mouse.hotspot; this.mouse.y = y + 0x28 - this.mouse.hotspot; }   // seg0:4f44
  setCursorShape(off) { this.mouse.shape = off; this.mouse.hotspot = off === 0x2840 ? 0x10 : 0; }  // seg0:5050
  // seg0:4ecf 显示计数 [03d6] (字节) +1; 由 0 变 1 时 seg0:2f9a 以 INT 33h fn 3 读位置后画光标 (算一次鼠标查找)
  mouseShow() { if (!this.mouse.present) return; const old = this.mouse.visible; this.mouse.visible = (old + 1) & 0xff; if (old === 0) this.onIO?.(this); }
  // seg0:4ee7 -1; 变成 0 时 seg0:2fc0 擦除光标
  mouseHide() { if (!this.mouse.present) return; this.mouse.visible = (this.mouse.visible - 1) & 0xff; }
  // ---- 计时 ----
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
