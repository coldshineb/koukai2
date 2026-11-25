// fmdrv_load.js — 量测 FMDRV.COM 的 IRQ0 处理 (CS:01d0, 291.3 Hz) 在 DOSBox 周期规则下占用多少 CPU (RE_NOTES 32.5)
// 在独立的 DOSEnv 里加载 FMDRV.COM (PSP 2000:0000, 程序 2000:0100) 运行到常驻 (INT 21h AH=31), OPL 用最小桩 (侦测时的计时器状态);
// 再把 D2.MML 放到 3000:0000, 以 INT 66h AH=00 登记、AH=01 播放第 n 曲, 之后模拟 N 次 IRQ0 并以 cycles.js 计数。
// 用法: 先加载 emu_boot.js (含 x86emu / dosenv) 与 cycles.js; S.FM_SONGS = [1, 2, ...], S.FM_SECONDS = 30 → S.fmLoad 结果
"use strict";
(function () {
const S = session, f = S.files;
const env = new S.DOSEnv(f, { romFont: S.rom }), c = env.cpu, m = c.mem;
c.onTick = null;                                                   // 不要模拟器自己的 IRQ0
const PSP = 0x2000, com = f["FMDRV.COM"];
m.fill(0, PSP * 16, PSP * 16 + 0x10000);
m[PSP * 16] = 0xcd; m[PSP * 16 + 1] = 0x20; m[PSP * 16 + 0x80] = 0; m[PSP * 16 + 0x81] = 0x0d;
m.set(com, PSP * 16 + 0x100);
// OPL 桩: 388h 写索引、389h 写数据; 计时器 1 启动 (reg 4 bit0) 后状态 = C0, reg 4 bit7 重设
let idx = 0, status = 0;
c.ports[0x388] = { in: () => status, out: (p, v) => { idx = v; } };
c.ports[0x389] = { in: () => 0xff, out: (p, v) => { if (idx === 4) { if (v & 0x80) status = 0; else if (v & 1) status = 0xc0; } } };
// INT 21h: AH=31 常驻 → 停止
const h21 = c.hooks[0x21];
c.hooks[0x21] = cpu => { if ((cpu.r[0] >> 8) === 0x31) { cpu.halted = true; S.fmTSR = true; return; } h21(cpu); };
c.s[0] = c.s[1] = c.s[2] = c.s[3] = PSP; c.r[4] = 0xfffe; c.ip = 0x100; c.flags = 0x202; c.halted = false;
S.fmTSR = false;
c.run(5e6);
const v66 = [c.rw(0x66 * 4 + 2), c.rw(0x66 * 4)], v8 = [c.rw(8 * 4 + 2), c.rw(8 * 4)];
const res = { tsr: S.fmTSR, int66: v66.map(x => x.toString(16)), int8: v8.map(x => x.toString(16)), opl: m[PSP * 16 + 0x128] };
// 以 INT n 调用 (返回点 F000:F000 = F1 FF 停止)
const callInt = (n, regs) => {
  for (const [k, v] of Object.entries(regs || {})) { if (k === "ds") c.s[3] = v; else if (k === "es") c.s[0] = v; else c.r[{ ax: 0, cx: 1, dx: 2, bx: 3, si: 6, di: 7 }[k]] = v; }
  c.r[4] = 0xfff0; c.s[2] = 0x1000;
  c.push(c.flags); c.push(0xf000); c.push(0xf000);
  c.ip = c.rw(n * 4); c.s[1] = c.rw(n * 4 + 2); c.halted = false;
  c.run(2e6);
};
const mml = f["D2.MML"]; m.set(mml, 0x30000);
callInt(0x66, { ax: 0x0000, ds: 0x3000, dx: 0 });
const songs = S.FM_SONGS || [0, 2, 3, 4, 5, 6, 7, 18, 11], secs = S.FM_SECONDS || 30, irqs = Math.round(291.304 * secs);
res.songs = [];
for (const n of songs) {
  if (n) { callInt(0x66, { ax: 0x0100 | n }); callInt(0x66, { ax: 0x0401 }); }
  else callInt(0x66, { ax: 0x0200 });                            // 0 = 停止
  const C = new S.DOSBoxCycles({ max: 10500 }); c.cyc = C;
  for (let i = 0; i < irqs; i++) { c.flags &= ~0x200; callInt(8, {}); }
  c.cyc = null;
  const perSec = C.game / secs;
  res.songs.push({ song: n, cyclesPerIrq: +(C.game / irqs).toFixed(1), cyclesPerSec: Math.round(perSec), load: +(perSec / 10500000).toFixed(5) });
}
S.fmLoad = res;
console.log(JSON.stringify(res));
})();
