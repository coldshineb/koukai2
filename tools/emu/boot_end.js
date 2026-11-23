// boot_end.js — 開發用: 以模擬器執行原版 END.EXE (結局), 逐 tick 記錄畫面 (VGA 4 平面 0..0x95ff = 640x480) 與 DAC
// 需先載入 x86emu.js, dosenv.js, boot_open.js (session.loadSea2 / hashPlanes)。不屬於移植版遊戲本體。
// 時間模型與 boot_open.js 相同: INT 66h F1 00 每讀一次倒數減一, 減一之前記錄一幀 (第 k 幀 = 第 k 個 tick 期間的畫面)。
// INT 65h = KOUKAI2.COM 的常駐服務 (RE_NOTES 第 34 節): MAIN.EXE 結束前存入的 主角名字串 (AH=2 → CX:BX) 與 AH=3..8 的值 (AL≠0 讀回)。
// 用法: session.runEnd({ v3, v4, v5, name: Uint8Array (名 + 0x20 + 姓, 0 結尾), keys: [{ tick, scan, ascii } | { tick, mouse }], keep: [tick...] })
"use strict";
(function () {
const S = session;
S.runEnd = function (opts = {}) {
  S.loadSea2();
  const env = new S.DOSEnv(S.files, { romFont: S.rom });
  env.loadEXE(S.files["END.EXE"], "C:\\END.EXE");
  const c = env.cpu, vga = c.vga;
  const keys = (opts.keys || []).slice().sort((a, b) => a.tick - b.tick);
  const keep = new Set(opts.keep || []);
  const out = { ticks: [], frames: {}, music: [], log: [], tick: 0, int65: [] };
  let count = 0, dirty = true, lastHash = 0;
  const w0 = vga.write.bind(vga); vga.write = (o, v) => { dirty = true; w0(o, v); };
  const record = () => {
    if (dirty) { lastHash = S.hashPlanes(vga.planes); dirty = false; }
    const dac = Array.from(vga.dac.subarray(0, 48)).join(",");
    out.ticks.push({ h: lastHash, dac, border: vga.attr[0x11] });
    if (keep.has(out.tick) || opts.keepAll) out.frames[out.tick] = { planes: vga.planes.map(p => p.slice(0, 0x9600)), dac: vga.dac.slice(0, 48) };
    out.tick++;
    if (opts.maxTicks && out.tick >= opts.maxTicks) { c.halted = true; out.cut = true; }
    while (keys.length && keys[0].tick <= out.tick) { const k = keys.shift(); if (k.mouse !== undefined) env.mouse.b = k.mouse; else env.bioskeys.push((k.scan << 8) | k.ascii); }
  };
  const h10 = c.hooks[0x10];
  c.hooks[0x10] = cpu => { if (cpu.r[0] === 0x1001) { env.ret(cpu); vga.attr[0x11] = cpu.r[3] >> 8; return; } h10(cpu); };
  c.hooks[0x66] = cpu => {
    env.ret(cpu); const ax = cpu.r[0], hi = ax >> 8, lo = ax & 255;
    if (hi === 0xf1) { if (lo === 1) count = cpu.r[3]; else { if (count) { record(); count--; } cpu.r[3] = count; } return; }
    if (hi === 0xf0) { out.log.push("F0 " + lo); return; }
    out.music.push({ tick: out.tick, ah: hi, al: lo, ds: cpu.s[3], dx: cpu.r[2] });
    cpu.r[0] = 0;
  };
  // KOUKAI2.COM INT 65h: 字串放在 9000:0000 (21 bytes, 與 KOUKAI2.COM 複製的長度相同)
  const STR_SEG = 0x9000, name = opts.name || new Uint8Array([0x41, 0x20, 0x42, 0]);
  for (let i = 0; i < 0x15; i++) c.mem[STR_SEG * 16 + i] = i < name.length ? name[i] : 0;
  const vals = { 3: opts.v3 | 0, 4: opts.v4 | 0, 5: opts.v5 | 0, 6: 0, 7: 0, 8: 0 };
  c.hooks[0x65] = cpu => {
    env.ret(cpu); const ah = cpu.r[0] >> 8, al = cpu.r[0] & 255;
    out.int65.push(cpu.r[0].toString(16));
    if (ah === 0) { cpu.r[0] = 0; return; }
    if (ah === 2) { cpu.r[3] = 0; cpu.r[1] = STR_SEG; return; }
    if (ah >= 3 && ah <= 8) { if (al) cpu.r[0] = vals[ah] & 0xffff; else vals[ah] = cpu.r[3]; return; }
  };
  c.run(opts.maxIns || 3e9);
  out.halted = c.halted; out.exitCode = c.exitCode; out.icount = c.icount;
  out.unhandled = [...env.unhandled.entries()];
  out.at = c.s[1].toString(16) + ":" + c.ip.toString(16);
  out.env = env;
  S.endRun = out;
  return out;
};
// MAIN.EXE 1764f 的核對值 (RE_NOTES 34): code 0..5 = 劇本結局 (國籍 0), 0x0f = 爵位 9 (code = 0x100 | 主角編號, 國籍 = 主角 +31 & 0x0f)
S.endParams = function (code, hero = 0, nation = 0) {
  let v = 0;
  if (code === 0x0f) { code = 0x100 | hero; v = nation; }
  return { v3: v, v4: v, v5: ((code << 7) | v) ^ 0x1565 };
};
})();
