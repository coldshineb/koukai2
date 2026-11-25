// cycles.js — 依 DOSBox 0.72 (core=normal, 固定 cycles) 的规则计算原版运行耗用的 CPU 周期 (量测用开发工具, 默认不加载)
// 规则 (DOSBox 0.72 源代码, 见 RE_NOTES 第 32 节):
//   - core_normal 每条指令 (含前缀) 扣 1 周期; cycles=N 表示每 1 毫秒 N 周期。
//   - REP MOVS/STOS/LODS/INS/OUTS: 先退回该指令的 1 周期; 重复次数 ≤ 本时间片剩余周期时不再扣 (等于 0 周期),
//     超过时做完剩余周期数的次数并结束时间片, 下一片重新运行该指令 (同样规则)。
//   - REP SCAS/CMPS: 先退回 1 周期, 之后每次重复扣 1 周期 (不切时间片)。
//   - I/O 端口 (IN/OUT, byte 或 word 都算一次): 读 −floor(N/1024)、写 −floor(N/1365) 周期 (N=10500: 10 / 7);
//     本时间片剩余 < 3 倍延迟时不扣。
//   - 时间片的边界 = 每 1 毫秒的开头 + PIC 事件 (PIT IRQ0、VGA 每格 6 个事件)。
// 用法: const C = new session.DOSBoxCycles({ max: 10500, pitDiv: 4096 }); cpu.cyc = C; ... C.game (游戏代码的周期)、C.T (总周期)
"use strict";
(function () {
const S = session;
const PIT_HZ = 1193181.6667;
class DOSBoxCycles {
  constructor(o = {}) {
    this.max = o.max || 10500;
    this.T = 0; this.sliceEnd = 0;
    this.game = 0; this.irq = 0;                         // 游戏代码 / 模拟器 IRQ0 处理 (F000:0900, 1C) 的周期
    this.rd = Math.floor(this.max / 1024); this.wr = Math.floor(this.max / Math.floor(1024 / 0.75));
    this.pitP = (o.pitDiv || 4096) / PIT_HZ * 1000 * this.max;        // IRQ0 间隔 (周期)
    const line = 800 / 25175000 * 1000 * this.max;                      // 640×480 (mode 12h): 800 点 × 525 行
    this.frameP = line * 525;
    this.vgaEv = [0, 120, 240, 360, 480, 490].map(l => l * line);       // VerticalTimer、4 个 DrawPart、VerticalDisplayEnd
    this.vr = [490 * line, 492 * line];                                  // 垂直同步 (3DAh bit3)
    this.hist = o.profile ? new Float64Array(0x100000) : null;           // 依指令位置 (线性) 累计的周期
    this.cur = 0; this.excl = false;
  }
  nextBoundary(T) {
    let b = (Math.floor(T / this.max) + 1) * this.max;
    const p = (Math.floor(T / this.pitP) + 1) * this.pitP; if (p < b) b = p;
    const f0 = Math.floor(T / this.frameP) * this.frameP;
    for (let k = 0; k < 2; k++) for (const e of this.vgaEv) { const t = f0 + k * this.frameP + e; if (t > T && t < b) { b = t; break; } }
    return Math.ceil(b);
  }
  add(n) {
    this.T += n;
    if (this.excl) { this.irq += n; if (this.curCS !== 0xf000) this.irqGame = (this.irqGame || 0) + n; } else { this.game += n; if (this.hist) this.hist[this.cur] += n; }
  }
  // 硬件中断 (模拟器的 IRQ0 频率是人为的) 期间运行的指令另计 (irq), 不算进游戏代码; 回到中断前的 CS:IP 与 SP 时结束
  irqEnter(cpu, ret) { if (!this.irqStack) this.irqStack = []; this.irqStack.push(ret); this.irqN = (this.irqN || 0) + 1; }
  begin(cpu) {
    if (this.T >= this.sliceEnd) this.sliceEnd = this.nextBoundary(this.T);
    const cs = cpu.s[1], ip = cpu.ip, Q = this.irqStack;
    if (Q && Q.length) { const r = Q[Q.length - 1]; if (cs === r[0] && ip === r[1] && cpu.r[4] === r[2] && cpu.s[2] === r[3]) Q.pop(); }
    this.excl = !!(Q && Q.length) || (cs === 0xf000 && ((ip >= 0x900 && ip < 0x920) || ip === 0xe0));
    this.cur = ((cs << 4) + ip) & 0xfffff; this.curCS = cs;
    this.add(1);
  }
  rep(cpu, base, it) {
    this.add(-1);
    if (base === 0xa6 || base === 0xae) { this.add(it); return; }
    let n = it;
    while (n > 0) {
      const rem = this.sliceEnd - this.T;
      if (n > rem) { n -= rem; this.add(rem); this.sliceEnd = this.nextBoundary(this.T); }
      else n = 0;
    }
  }
  io(cpu, w) {
    const d = w ? this.wr : this.rd;
    if (this.sliceEnd - this.T < 3 * d) return;
    this.add(d);
  }
  // 目前时间 (毫秒)
  ms() { return this.T / this.max; }
  // 垂直同步中? (3DAh bit3)
  vsync() { const t = this.T % this.frameP; return t >= this.vr[0] && t <= this.vr[1]; }
}
S.DOSBoxCycles = DOSBoxCycles;
})();
