// boot_title.js — 開發用: 以模擬器執行原版到標題選單 (跳過說明書密碼), 並保存狀態供後續測試重複使用
// 需先載入 x86emu.js, dosenv.js, harness.js (session.boot 用過的檔案), harness_menu.js
"use strict";
(function () {
const S = session, fs = require("fs");
S.bootTitle = function () {
  if (!S.files) {
    S.files = {}; for (const f of fs.readdirSync(S.W + "/uw2_remake/tools/work/sea2")) S.files[f] = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/sea2/" + f));
    S.rom = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/rom8x8.bin"));
  }
  const env = new S.DOSEnv(S.files, { romFont: S.rom });
  env.loadEXE(S.files["MAIN.EXE"]);
  const c = env.cpu, L = 0x110 * 16;
  [0x31, 0xc0, 0x90, 0x90, 0x90].forEach((b, i) => c.mem[L + 0x161f8 + i] = b);   // 跳過 call far 2e09:7cec (密碼)
  env.t66 = [0, 0];
  c.hooks[0x66] = cpu => { env.ret(cpu); const ax = cpu.r[0], hi = ax >> 8;
    if (hi === 0xf1 || hi === 0xf0) { const t = hi === 0xf1 ? 0 : 1; if ((ax & 0xff) === 1) env.t66[t] = cpu.r[3]; else { if (env.t66[t]) env.t66[t]--; cpu.r[3] = env.t66[t]; } }
    else cpu.r[0] = 0; };
  c.run(2.5e8);
  S.titleEnv = env;
  S.titleHooks = { ...c.hooks };              // 原始中斷處理 (restoreTitle 時恢復, 避免測試掛上的追踪殘留)
  S.titleState = { mem: c.mem.slice(), r: c.r.slice(), s: c.s.slice(), ip: c.ip, flags: c.flags, planes: c.vga.planes.map(p => p.slice()),
    gc: c.vga.gc.slice(), seq: c.vga.seq.slice(), dac: c.vga.dac.slice(), attr: c.vga.attr.slice(), t66: env.t66.slice(),
    handles: JSON.parse(JSON.stringify(env.handles)), next: env.nextHandle };
  return env;
};
S.restoreTitle = function () {
  const env = S.titleEnv, c = env.cpu, st = S.titleState;
  c.mem.set(st.mem); c.r.set(st.r); c.s.set(st.s); c.ip = st.ip; c.flags = st.flags;
  st.planes.forEach((p, i) => c.vga.planes[i].set(p)); c.vga.gc.set(st.gc); c.vga.seq.set(st.seq); c.vga.dac.set(st.dac); c.vga.attr.set(st.attr);
  env.t66 = st.t66.slice(); env.bioskeys = []; c.halted = false; c.pendingIRQ = [];
  env.handles = JSON.parse(JSON.stringify(st.handles)); env.nextHandle = st.next;
  if (S.titleHooks) { for (const k in c.hooks) delete c.hooks[k]; Object.assign(c.hooks, S.titleHooks); } c.onTick = null;
  env.files["KOUKAI2.DAT"] = S.files["KOUKAI2.DAT"];
};
S.emuStep = (sc, as, n = 1.2e8) => { S.titleEnv.bioskeys.push((sc << 8) | as); S.titleEnv.cpu.run(n); };
S.emuFb480 = () => S.titleEnv.cpu.vga.snapshotIndexed(480, 0).subarray(640 * 40, 640 * 440).slice();
})();
