// ending_tests.js — 结局差分测试: 同一组参数驱动原版 END.EXE (模拟器) 与移植版 web/src/game/ending.js, 逐 tick 比对
//   每个 tick 比对: VGA 4 平面 (0..0x95ff = 640x480) 哈希、DAC 0..15 (6 比特 RGB)、外框色; 另比对音乐指令的时间点、结束码与总长度。
//   结局很长 (数万 tick), 两边都以「连续相同的 tick 合并」(游程) 记录, 避免内存不足。
// 需先加载: x86emu.js, dosenv.js, boot_open.js, boot_end.js; 移植版另需 tools/work/ui_bundle.js (make_test_bundle.py 产生, 含 game/ending.js)
// 用法: session.W = WORKSPACE_DIR; 运行本档; S.endEmuRL(name, opts) / await S.endTests(names)
"use strict";
(function () {
const S = session;
// 游程记录器: push(key) → [[key, count], ...]
S.rl = function () {
  const L = [];
  return { L, push(k) { const t = L[L.length - 1]; if (t && t[0] === k) t[1]++; else L.push([k, 1]); }, get n() { let s = 0; for (const t of L) s += t[1]; return s; } };
};
// 32 比特哈希 (4 平面 × 0x9600 bytes, 以 32 比特字计算; 两边共用, 比逐字节快 4 倍)
S.hashPlanes32 = function (P) {
  let h = 0x811c9dc5 | 0;
  for (let p = 0; p < 4; p++) { const a = P[p], w = new Int32Array(a.buffer, a.byteOffset, 0x9600 >> 2); for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193); }
  return h >>> 0;
};
// 原版: 与 boot_end.js 的 runEnd 同一时间模型, 以游程记录; 可分段运行 (S.endEmuStep), 跨多次调用保存在 session
S.endEmuStart = function (opts = {}) {
  S.loadSea2();
  const env = new S.DOSEnv(S.files, { romFont: S.rom });
  env.loadEXE(S.files["END.EXE"], "C:\\END.EXE");
  const c = env.cpu, vga = c.vga;
  for (let p = 0; p < 4; p++) if (vga.planes[p].byteOffset & 3) vga.planes[p] = new Uint8Array(vga.planes[p]);
  const keys = (opts.keys || []).slice().sort((a, b) => a.tick - b.tick);
  const keep = new Set(opts.keep || []);
  const rl = S.rl(), st = { env, rl, frames: {}, music: [], tick: 0, int65: [], target: 0 };
  let count = 0, dirty = true, lastHash = 0;
  const w0 = vga.write.bind(vga); vga.write = (o, v) => { dirty = true; w0(o, v); };
  const record = () => {
    if (dirty) { lastHash = S.vgaKey(vga.planes); dirty = false; }
    rl.push(lastHash + "|" + Array.from(vga.dac.subarray(0, 48)).join(",") + "|" + vga.attr[0x11]);
    if (keep.has(st.tick)) st.frames[st.tick] = { planes: vga.planes.map(p => p.slice(0, 0x9600)), dac: vga.dac.slice(0, 48) };
    st.tick++;
    if (st.tick >= st.target) c.halted = true;
    while (keys.length && keys[0].tick <= st.tick) { const k = keys.shift(); if (k.mouse !== undefined) env.mouse.b = k.mouse; else env.bioskeys.push((k.scan << 8) | k.ascii); }
  };
  const h10 = c.hooks[0x10];
  c.hooks[0x10] = cpu => { if (cpu.r[0] === 0x1001) { env.ret(cpu); vga.attr[0x11] = cpu.r[3] >> 8; return; } h10(cpu); };
  c.hooks[0x66] = cpu => {
    env.ret(cpu); const ax = cpu.r[0], hi = ax >> 8, lo = ax & 255;
    if (hi === 0xf1) { if (lo === 1) count = cpu.r[3]; else { if (count) { record(); count--; } cpu.r[3] = count; } return; }
    if (hi === 0xf0) return;
    st.music.push({ tick: st.tick, ah: hi, al: lo });
    cpu.r[0] = 0;
  };
  const STR_SEG = 0x9000, name = opts.name || new Uint8Array([0x41, 0x20, 0x42, 0]);
  for (let i = 0; i < 0x15; i++) c.mem[STR_SEG * 16 + i] = i < name.length ? name[i] : 0;
  const vals = { 3: opts.v3 | 0, 4: opts.v4 | 0, 5: opts.v5 | 0, 6: 0, 7: 0, 8: 0 };
  c.hooks[0x65] = cpu => {
    env.ret(cpu); const ah = cpu.r[0] >> 8, al = cpu.r[0] & 255;
    st.int65.push(cpu.r[0].toString(16));
    if (ah === 0) { cpu.r[0] = 0; return; }
    if (ah === 2) { cpu.r[3] = 0; cpu.r[1] = STR_SEG; return; }
    if (ah >= 3 && ah <= 8) { if (al) cpu.r[0] = vals[ah] & 0xffff; else vals[ah] = cpu.r[3]; return; }
  };
  // 等键 (INT 16h AH=0 且缓冲区空, 之后也没有排定的按键): 时间不再流逝 → 记录位置后结束
  // opts.autoPrompt = n: 「▽ 等待提示」(0f34 → 2945, 调用链含返回点 110:0fd7) 等待中且没有排定的按键时, 排定 n tick 后按 Enter, 并记入 st.autoKeys
  st.autoKeys = [];
  const inPrompt = cpu => { let b = cpu.r[5]; for (let k = 0; k < 6 && b; k++) { if (cpu.rw(cpu.lin(2, b + 2)) === 0x0fd7) return true; b = cpu.rw(cpu.lin(2, b)); } return false; };
  const h16 = c.hooks[0x16];
  c.hooks[0x16] = cpu => {
    const ah = cpu.r[0] >> 8;
    if (opts.autoPrompt && ah === 1 && !env.bioskeys.length && !keys.length && inPrompt(cpu)) {
      const k = { tick: st.tick + opts.autoPrompt, scan: 0x1c, ascii: 0x0d }; keys.push(k); st.autoKeys.push(k);
    }
    if (ah === 0 && !env.bioskeys.length && !keys.length) { st.waitKey = st.tick; st.done = true; cpu.halted = true; return; }
    // 0eff 「等任意键或鼠标」(忙等, 不读计时器; 0ee4 的返回点 110:0f0d 在堆栈上): 没有排定的输入 → 结局播完, 记录后结束
    if (ah === 1 && !env.bioskeys.length && !keys.length && !env.mouse.b) {
      for (let k = 0; k < 8; k++) if (cpu.rw(cpu.lin(2, cpu.r[4] + 2 * k)) === 0x0f0d) { st.endWait = st.tick; st.done = true; cpu.halted = true; return; }
    }
    h16(cpu);
  };
  const xit = c.hooks[0x21];
  c.hooks[0x21] = cpu => { if ((cpu.r[0] >> 8) === 0x4c) { st.exitCode = cpu.r[0] & 255; st.done = true; } xit(cpu); };
  return st;
};
S.endEmuStep = function (st, nTicks, maxIns = 2e9) {
  const c = st.env.cpu;
  st.target = st.tick + nTicks; c.halted = false;
  c.run(maxIns);
  if (c.halted && st.tick < st.target && !st.done) st.done = true;
  st.at = c.s[1].toString(16) + ":" + c.ip.toString(16); st.icount = c.icount;
  return st;
};
S.rlSummary = r => `ticks ${r.rl.n} runs ${r.rl.L.length} music ${r.music.map(m => m.ah + "." + m.al + "@" + m.tick).join(" ")}` +
  (r.waitKey !== undefined ? ` waitKey@${r.waitKey}` : "") + (r.endWait !== undefined ? ` endWait@${r.endWait}` : "") + (r.done ? " DONE" : " (running)") + ` exit=${r.exitCode} at ${r.at} ins ${r.icount}`;
// 比对两个游程
S.compareRL = function (a, b) {
  let i = 0, j = 0, ia = 0, jb = 0, t = 0, same = 0, first = -1;
  const A = a.L, B = b.L;
  while (i < A.length && j < B.length) {
    const ra = A[i][1] - ia, rb = B[j][1] - jb, k = Math.min(ra, rb);
    if (A[i][0] === B[j][0]) same += k; else if (first < 0) first = t;
    t += k; ia += k; jb += k;
    if (ia === A[i][1]) { i++; ia = 0; }
    if (jb === B[j][1]) { j++; jb = 0; }
  }
  return { same, n: Math.max(a.n, b.n), first, na: a.n, nb: b.n };
};
// 原版跑完一种结局, 结果存成 <dir>/<name>.json (游程 L、音乐、自动按键、结束点)
S.END_CASES = {
  s0: [0], s1: [1], s2: [2], s3: [3], s4: [4], s5: [5],
  r0: [0x0f, 0, 0], r1: [0x0f, 1, 1], r2: [0x0f, 2, 3], r3: [0x0f, 3, 5], r4: [0x0f, 4, 4], r5: [0x0f, 5, 2],   // 爵位 9: 主角 n, 该主角的国籍 (END main 的比对表)
  bad: [0x0f, 0, 1],                                                                                           // 核对失败 (主角 0 换了国籍)
};
S.endEmuCase = function (name, dir, opts = {}) {
  const fs = require("fs");
  const [code, hero, nation] = S.END_CASES[name];
  const st = S.endEmuStart({ ...S.endParams(code, hero, nation), autoPrompt: 30, ...opts });
  S.endEmuStep(st, opts.maxTicks || 40000, opts.maxIns || 2e9);
  const r = { name, L: st.rl.L, music: st.music, autoKeys: st.autoKeys, endWait: st.endWait, waitKey: st.waitKey, exitCode: st.exitCode, at: st.at, done: !!st.done, int65: st.int65 };
  if (dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(`${dir}/${name}.json`, JSON.stringify(r)); }
  st.env = null;
  return { st, r };
};

// 画面比对键: 游戏区 (VRAM 第 40..439 行) 转成 640x400 索引画面后的 32 比特哈希; 上下黑边有非 0 字节时加 "B"
S.FB = new Uint8Array(640 * 400);
S.hashFb = function (fb) { let h = 0x811c9dc5 | 0; const w = new Int32Array(fb.buffer, fb.byteOffset, fb.length >> 2); for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w[i], 0x01000193); return h >>> 0; };
S.vgaKey = function (P) {
  const fb = S.FB;
  for (let o = 0; o < 32000; o++) {
    const a = o + 40 * 80, b0 = P[0][a], b1 = P[1][a], b2 = P[2][a], b3 = P[3][a], x = o * 8;
    for (let i = 0; i < 8; i++) { const s = 7 - i; fb[x + i] = ((b0 >> s) & 1) | (((b1 >> s) & 1) << 1) | (((b2 >> s) & 1) << 2) | (((b3 >> s) & 1) << 3); }
  }
  let border = 0;
  for (let p = 0; p < 4 && !border; p++) for (const [s, e] of [[0, 3200], [35200, 38400]]) for (let o = s; o < e; o++) if (P[p][o]) { border = 1; break; }
  return S.hashFb(fb) + (border ? "B" : "");
};
// 移植版: 与原版相同的时间模型 (Timer 测试模式: 每读一次倒数减一; 减一之前记录一帧), 按键照原版结果的 autoKeys 在同一 tick 送出
S.endData = function () {
  if (S._endData) return S._endData;
  const fs = require("fs"), A = S.W + "/uw2_remake/web/assets", F = S.W + "/uw2_remake/tools/work/sea2";
  S._endData = {
    json: JSON.parse(fs.readFileSync(A + "/data/ending.json", "utf8")),
    endgrp: new Uint8Array(fs.readFileSync(F + "/ENDGRP.DAT")), endput: new Uint8Array(fs.readFileSync(F + "/END_PUT.DAT")),
    events: [0, 1, 2, 3, 4, 5, 6].map(i => new Uint8Array(fs.readFileSync(F + `/EVENT${i}.DAT`))),
  };
  return S._endData;
};
class EndStop extends Error {}
S.runEndJS = async function (name, emu, opts = {}) {
  const U = S.UI; S.loadSea2();
  const font = U.Font.fromRaw(S.files["1.PAT"], S.files["2.PAT"], S.rom);
  const scr = new U.Screen();
  let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 5e7) throw new Error("poll limit"); } });
  const [code, hero, nation] = S.END_CASES[name];
  const prm = S.endParams(code, hero, nation);
  const nm = opts.name || new Uint8Array([0x41, 0x20, 0x42, 0]);
  const rl = S.rl(), out = { name, rl, music: [], tick: 0 };
  const e = new U.Ending({ scr, sys, bgm: null, font }, S.endData());
  e.onMusic = (ah, al) => out.music.push({ tick: out.tick, ah, al });
  const keys = (emu.autoKeys || []).slice().sort((a, b) => a.tick - b.tick);
  let lastH = 0; scr.dirty = true;
  const record = () => {
    if (scr.dirty) { lastH = S.hashFb(scr.fb); scr.dirty = false; }
    rl.push(lastH + "|" + Array.from(e.dac).join(",") + "|0");
    if (opts.keep && opts.keep.includes(out.tick)) (out.frames ??= {})[out.tick] = scr.fb.slice();
    out.tick++;
    if (opts.maxTicks && out.tick >= opts.maxTicks) throw new EndStop();
    while (keys.length && keys[0].tick <= out.tick) { const k = keys.shift(); sys.pushKey(k.scan, k.ascii); }
  };
  const g = sys.timer.get.bind(sys.timer);
  sys.timer.get = () => { if (sys.timer.count) record(); return g(); };
  e.onEndWait = () => { if (!keys.length) { out.endWait = out.tick; throw new EndStop(); } };
  e.onBlockKey = () => { if (!keys.length) { out.waitKey = out.tick; throw new EndStop(); } };
  out.result = "end";
  try { out.ret = await e.run({ ...prm, name: nm }); } catch (err) { if (!(err instanceof EndStop)) { out.result = "error: " + err.message; out.stack = err.stack; } }
  out.e = e;
  return out;
};
S.compareEnd = function (emu, js) {
  const a = { L: emu.L, get n() { let s = 0; for (const t of emu.L) s += t[1]; return s; } };
  const c = S.compareRL(a, js.rl);
  const mE = emu.music.filter(m => m.ah !== 0).map(m => m.ah + (m.ah === 3 ? "" : "." + m.al) + "@" + m.tick).join(" ");
  const mJ = js.music.filter(m => m.ah !== 0).map(m => m.ah + (m.ah === 3 ? "" : "." + m.al) + "@" + m.tick).join(" ");
  const ok = c.same === c.n && c.na === c.nb && mE === mJ && emu.endWait === js.endWait && emu.waitKey === js.waitKey;
  return { ok, text: `${ok ? "OK  " : "FAIL"} ${js.name.padEnd(4)} ticks emu=${c.na} js=${c.nb} same=${c.same}/${c.n}` + (c.first >= 0 ? ` first@${c.first}` : "") +
    ` end emu=${emu.endWait ?? emu.waitKey} js=${js.endWait ?? js.waitKey} music ${mE === mJ ? "same" : "DIFF emu[" + mE + "] js[" + mJ + "]"} | js ${js.result}`, c };
};
// 第 t tick 的游程键 (调试)
S.rlAt = function (L, t) { let s = 0; for (const x of L) { if (t < s + x[1]) return x[0]; s += x[1]; } return null; };

// 原版某 tick 的 640x400 索引画面
S.emuFrames = function (name, ticks, maxTicks) {
  const [code, hero, nation] = S.END_CASES[name];
  const st = S.endEmuStart({ ...S.endParams(code, hero, nation), autoPrompt: 30, keep: ticks });
  S.endEmuStep(st, maxTicks || (Math.max(...ticks) + 2));
  const out = {};
  for (const t of ticks) { const P = st.frames[t]?.planes; if (!P) continue; S.vgaKey(P); out[t] = S.FB.slice(); }
  return out;
};
S.diffBox = function (a, b) {
  let x0 = 640, y0 = 400, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) { const i = y * 640 + x; if (a[i] !== b[i]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return { n, x0, y0, x1, y1 };
};

})();
