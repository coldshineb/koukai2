// boot_open.js — 开发用: 以模拟器运行原版 OPEN.EXE (片头), 逐 tick 记录画面 (VGA 4 平面 0..0x95ff = 640x480) 与 DAC
// 需先加载 x86emu.js, dosenv.js (session.X86 / session.DOSEnv)。不属于移植版游戏本体。
// 时间模型与其他差分测试相同: INT 66h F1 00 每读一次倒数减一 (倒数不为 0 时才减), 每减一次 = 经过 1 tick;
//   在「减一之前」记录一帧, 所以第 k 帧 = 第 k 个 tick 期间显示的画面。
// 用法: session.W = WORKSPACE_DIR; 运行本档; 再 session.runOpen({ keys: [{ tick, scan, ascii }], keep: [tick...] })
"use strict";
(function () {
const S = session, fs = require("fs");
const LOAD = 0x110, DGROUP = 0x0a0b;
S.OPEN_DS = LOAD + DGROUP;
S.loadSea2 = function () {
  if (S.files) return;
  S.files = {}; for (const f of fs.readdirSync(S.W + "/uw2_remake/tools/work/sea2")) S.files[f] = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/sea2/" + f));
  S.rom = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/rom8x8.bin"));
};
// FNV-1a (平面 0..3 各 0x9600 bytes)
S.hashPlanes = function (P, n = 0x9600) {
  let h = 0x811c9dc5 | 0;
  for (let p = 0; p < 4; p++) { const a = P[p]; for (let i = 0; i < n; i++) h = Math.imul(h ^ a[i], 0x01000193); }
  return h >>> 0;
};
S.runOpen = function (opts = {}) {
  S.loadSea2();
  const env = new S.DOSEnv(S.files, { romFont: S.rom });
  env.loadEXE(S.files["OPEN.EXE"], "C:\\OPEN.EXE");
  const c = env.cpu, vga = c.vga;
  const keys = (opts.keys || []).slice().sort((a, b) => a.tick - b.tick);
  const keep = new Set(opts.keep || []);
  const out = { ticks: [], frames: {}, music: [], log: [], tick: 0 };
  let count = 0, dirty = true, lastHash = 0;
  const w0 = vga.write.bind(vga); vga.write = (o, v) => { dirty = true; w0(o, v); };
  const record = () => {
    if (dirty) { lastHash = S.hashPlanes(vga.planes); dirty = false; }
    const dac = Array.from(vga.dac.subarray(0, 48)).join(",");
    out.ticks.push({ h: lastHash, dac, border: vga.attr[0x11] });
    if (keep.has(out.tick) || opts.keepAll) out.frames[out.tick] = { planes: vga.planes.map(p => p.slice(0, 0x9600)), dac: vga.dac.slice(0, 48) };
    out.tick++;
    while (keys.length && keys[0].tick <= out.tick) { const k = keys.shift(); if (k.mouse !== undefined) env.mouse.b = k.mouse; else env.bioskeys.push((k.scan << 8) | k.ascii); }
  };
  // INT 10h AX=1001h (设置外框色) — dosenv.js 未处理, 这里记录到属性寄存器 0x11
  const h10 = c.hooks[0x10];
  c.hooks[0x10] = cpu => { if (cpu.r[0] === 0x1001) { env.ret(cpu); vga.attr[0x11] = cpu.r[3] >> 8; return; } h10(cpu); };
  c.hooks[0x66] = cpu => {
    env.ret(cpu); const ax = cpu.r[0], hi = ax >> 8, lo = ax & 255;
    if (hi === 0xf1) { if (lo === 1) count = cpu.r[3]; else { if (count) { record(); count--; } cpu.r[3] = count; } return; }
    if (hi === 0xf0) { out.log.push("F0 " + lo); return; }
    out.music.push({ tick: out.tick, ah: hi, al: lo, ds: cpu.s[3], dx: cpu.r[2] });
    cpu.r[0] = 0;                                  // 加载成功 / 状态 = 未播放
  };
  c.run(opts.maxIns || 3e9);
  out.halted = c.halted; out.exitCode = c.exitCode; out.icount = c.icount;
  out.unhandled = [...env.unhandled.entries()];
  out.at = c.s[1].toString(16) + ":" + c.ip.toString(16);
  out.env = env;
  S.openRun = out;
  return out;
};
})();
