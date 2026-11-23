// cycles.js — 依 DOSBox 0.72 (core=normal, 固定 cycles) 的規則計算原版執行耗用的 CPU 週期 (量測用開發工具, 預設不載入)
// 規則 (DOSBox 0.72 原始碼, 見 RE_NOTES 第 32 節):
//   - core_normal 每條指令 (含前綴) 扣 1 週期; cycles=N 表示每 1 毫秒 N 週期。
//   - REP MOVS/STOS/LODS/INS/OUTS: 先退回該指令的 1 週期; 重複次數 ≤ 本時間片剩餘週期時不再扣 (等於 0 週期),
//     超過時做完剩餘週期數的次數並結束時間片, 下一片重新執行該指令 (同樣規則)。
//   - REP SCAS/CMPS: 先退回 1 週期, 之後每次重複扣 1 週期 (不切時間片)。
//   - I/O 埠 (IN/OUT, byte 或 word 都算一次): 讀 −floor(N/1024)、寫 −floor(N/1365) 週期 (N=10500: 10 / 7);
//     本時間片剩餘 < 3 倍延遲時不扣。
//   - 時間片的邊界 = 每 1 毫秒的開頭 + PIC 事件 (PIT IRQ0、VGA 每格 6 個事件)。
// 用法: const C = new session.DOSBoxCycles({ max: 10500, pitDiv: 4096 }); cpu.cyc = C; ... C.game (遊戲程式碼的週期)、C.T (總週期)
"use strict";
(function () {
const S = session;
const PIT_HZ = 1193181.6667;
class DOSBoxCycles {
  constructor(o = {}) {
    this.max = o.max || 10500;
    this.T = 0; this.sliceEnd = 0;
    this.game = 0; this.irq = 0;                         // 遊戲程式碼 / 模擬器 IRQ0 處理 (F000:0900, 1C) 的週期
    this.rd = Math.floor(this.max / 1024); this.wr = Math.floor(this.max / Math.floor(1024 / 0.75));
    this.pitP = (o.pitDiv || 4096) / PIT_HZ * 1000 * this.max;        // IRQ0 間隔 (週期)
    const line = 800 / 25175000 * 1000 * this.max;                      // 640×480 (mode 12h): 800 點 × 525 行
    this.frameP = line * 525;
    this.vgaEv = [0, 120, 240, 360, 480, 490].map(l => l * line);       // VerticalTimer、4 個 DrawPart、VerticalDisplayEnd
    this.vr = [490 * line, 492 * line];                                  // 垂直同步 (3DAh bit3)
    this.hist = o.profile ? new Float64Array(0x100000) : null;           // 依指令位置 (線性) 累計的週期
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
  // 硬體中斷 (模擬器的 IRQ0 頻率是人為的) 期間執行的指令另計 (irq), 不算進遊戲程式碼; 回到中斷前的 CS:IP 與 SP 時結束
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
  // 目前時間 (毫秒)
  ms() { return this.T / this.max; }
  // 垂直同步中? (3DAh bit3)
  vsync() { const t = this.T % this.frameP; return t >= this.vr[0] && t <= this.vr[1]; }
}
S.DOSBoxCycles = DOSBoxCycles;
})();
