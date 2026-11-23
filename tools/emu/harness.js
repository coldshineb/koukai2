// harness.js — 差分測試輔助 (在 Quick 沙盒以 session 共享狀態; 需先載入 x86emu.js, dosenv.js)
// 開機到原版的第一個等待輸入畫面, 之後可以直接呼叫 MAIN.EXE 內任一函式並比對畫面。
// 用法 (沙盒): 依序執行 x86emu.js, dosenv.js, harness.js, 再執行 session.boot(W)
"use strict";
(function () {
const S = session;
const SEGS = [0x2e09, 0x1fd9, 0x0fea, 0];        // MAIN.EXE 四個程式碼段 (未重定位值)
const LOAD = 0x110, DGROUP = 0x3815;

S.lsUnpack = function (b) {
  const dic = b.subarray(16, 272), out = []; let p = 0x110;
  const be32 = o => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
  for (;;) {
    const cl = be32(p), ul = be32(p + 4), of = be32(p + 8); if (!cl) break; p += 12;
    if (cl === ul) { out.push(b.slice(of, of + ul)); continue; }
    const o = new Uint8Array(ul); let n = 0, bp = of * 8;
    const bit = () => { const v = (b[bp >> 3] >> (7 - (bp & 7))) & 1; bp++; return v; };
    const code = () => { let k = 0; while (bit()) k++; let v = 0; for (let i = 0; i <= k; i++) v = (v << 1) | bit(); return v + (1 << (k + 1)) - 2; };
    while (n < ul) { const cd = code(); if (cd < 256) o[n++] = dic[cd]; else { const d = cd - 256, L = code() + 3; for (let i = 0; i < L && n < ul; i++) { o[n] = o[n - d]; n++; } } }
    out.push(o);
  }
  return out;
};

S.boot = function (W) {
  const fs = require("fs");
  const files = {};
  for (const f of fs.readdirSync(W + "/uw2_remake/tools/work/sea2")) files[f] = new Uint8Array(fs.readFileSync(W + "/uw2_remake/tools/work/sea2/" + f));
  S.files = files; S.W = W;
  S.rom = new Uint8Array(fs.readFileSync(W + "/uw2_remake/tools/work/rom8x8.bin"));
  const env = new S.DOSEnv(files, { romFont: S.rom });
  env.loadEXE(files["MAIN.EXE"]); env.cpu.run(3e7);          // 執行到第一個鍵盤等待
  S.env = env; S.DSEG = LOAD + DGROUP; S.D1 = S.lsUnpack(files["DATA1.LZW"]);
  const c = env.cpu;
  S.saveState = () => ({ mem: c.mem.slice(), r: c.r.slice(), s: c.s.slice(), ip: c.ip, flags: c.flags,
    planes: c.vga.planes.map(p => p.slice()), gc: c.vga.gc.slice(), seq: c.vga.seq.slice(), dac: c.vga.dac.slice(), attr: c.vga.attr.slice() });
  S.loadState = st => { c.mem.set(st.mem); c.r.set(st.r); c.s.set(st.s); c.ip = st.ip; c.flags = st.flags;
    st.planes.forEach((p, i) => c.vga.planes[i].set(p)); c.vga.gc.set(st.gc); c.vga.seq.set(st.seq); c.vga.dac.set(st.dac); c.vga.attr.set(st.attr);
    c.halted = false; c.pendingIRQ = []; };
  S.base = S.saveState();
  return env;
};
// 以「映像線性位址」呼叫 MAIN.EXE 函式 (自動換算段:偏移)
S.call = (lin, o = {}) => {
  const env = S.env, c = env.cpu, sv = { r: c.r.slice(), s: c.s.slice(), ip: c.ip, flags: c.flags };
  const sg = SEGS.find(s => s * 16 <= lin); c.s[3] = S.DSEG; c.s[0] = S.DSEG; c.flags &= ~0x400;
  try { env.callFar(LOAD + sg, lin - sg * 16, o); }
  finally { S.last = { ax: c.r[0], dx: c.r[2] }; c.r.set(sv.r); c.s.set(sv.s); c.ip = sv.ip; c.flags = sv.flags; c.halted = false; }
  return S.last;
};
// 準備視窗所需緩衝: [0c86]=DATA1#14 外框圖形, [0c88]=視窗堆疊 (直接寫入原版記憶體管理表 DS:bc36)
S.setupFrameGfx = () => {
  const c = S.env.cpu, D = S.DSEG;
  c.mem.set(S.D1[14], 0x8000 * 16);
  const H = (i, seg, size) => { const h = D * 16 + 0xbc36 + i * 7; c.mem[h] = 0; c.mem[h + 1] = seg & 255; c.mem[h + 2] = seg >> 8; c.mem[h + 3] = size & 255; c.mem[h + 4] = size >> 8; c.mem[h + 5] = 0xff; c.mem[h + 6] = 0xff; };
  H(0, 0x8000, 0x3ea); H(1, 0x9000, 0xe40);
  c.ww(D * 16 + 0xc86, 0); c.ww(D * 16 + 0xc88, 1); c.ww(D * 16 + 0x536, 0);
};
S.bgcol = (x, y) => ((x / 3 | 0) + (y / 5 | 0)) & 15;
S.emuFillBG = () => {
  const P = S.env.cpu.vga.planes; for (const p of P) p.fill(0);
  for (let y = 0; y < 400; y++) for (let xb = 0; xb < 80; xb++) {
    const o = (y + 40) * 80 + xb;
    for (let p = 0; p < 4; p++) { let v = 0; for (let i = 0; i < 8; i++) v = (v << 1) | ((S.bgcol(xb * 8 + i, y) >> p) & 1); P[p][o] = v; }
  }
};
S.emuFB = () => S.env.cpu.vga.snapshotIndexed(480, 0).subarray(640 * 40, 640 * 440);
S.emuStr = bytes => { const c = S.env.cpu, a = S.DSEG * 16 + 0xe000; for (let i = 0; i < bytes.length; i++) c.mem[a + i] = bytes[i]; c.mem[a + bytes.length] = 0; };
S.emuVars = () => { const c = S.env.cpu, r = o => c.rw(S.DSEG * 16 + o), b = o => c.mem[S.DSEG * 16 + o];
  return { x: r(0x8a1a), y: r(0x8a1c), lineH: r(0x8a1e), left: r(0x8a20), right: r(0x8a22), mode: b(0x8a26), fg: b(0x8a27), bg: b(0x8a28), f29: b(0x8a29), lead: b(0x8a2a), esc: r(0x8a2c) }; };
S.jsVars = con => ({ x: con.x, y: con.y, lineH: con.lineH, left: con.left, right: con.right, mode: con.mode, fg: con.fg, bg: con.bg, f29: con.f29, lead: con.lead, esc: con.esc });
S.cmp = (a, b) => { let n = 0, first = -1; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (first < 0) first = i; n++; } return { n, first: first < 0 ? null : [first % 640, (first / 640) | 0] }; };
// 在原版延遲函式 seg0:5998 處截取畫面並跳過延遲
S.withDelayHook = (fn) => {
  const c = S.env.cpu, frames = [], old = c.onTick;
  c.onTick = cpu => { old(cpu); if (cpu.s[1] === LOAD && cpu.ip === 0x5998) { frames.push(S.emuFB().slice()); cpu.ip = cpu.pop(); cpu.s[1] = cpu.pop(); } };
  try { fn(); } finally { c.onTick = old; }
  return frames;
};
})();
