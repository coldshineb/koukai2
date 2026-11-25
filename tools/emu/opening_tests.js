// opening_tests.js — 片头差分测试: 同一串按键/时间驱动原版 OPEN.EXE (模拟器) 与移植版 web/src/game/opening.js, 逐 tick 比对
//   每个 tick 比对: VGA 4 平面 (0..0x95ff = 640x480 全部可见范围) 哈希、DAC 0..15 (6 比特 RGB)、外框色; 另比对音乐指令的时间点与总长度。
// 需先加载: x86emu.js, dosenv.js, boot_open.js, tools/work/ui_bundle.js (make_test_bundle.py 产生, 含 game/opening.js)
// 用法: session.W = WORKSPACE_DIR; 运行本档; await session.openTests(routes)  (routes 省略 = 全部)
"use strict";
(function () {
const S = session, fs = require("fs");
const R = () => S.W + "/uw2_remake";
S.openData = function () {
  const W = R();
  return {
    entries: [...Array(14)].map((_, i) => new Uint8Array(fs.readFileSync(`${W}/tools/work/gfx/opgraph/${String(i).padStart(2, "0")}.dat`))),
    tail: new Uint8Array(fs.readFileSync(`${W}/tools/work/gfx/opgraph/tail.dat`)),
    json: JSON.parse(fs.readFileSync(`${W}/web/assets/data/opening.json`, "utf8")),
  };
};
// 移植版: 与 boot_open.js 的 runOpen 相同的时间模型 (Timer 测试模式: 每读一次倒数减一; 减一之前记录一帧)
S.runOpenJS = async function (opts = {}) {
  const U = S.UI; S.loadSea2();
  const font = U.Font.fromRaw(S.files["1.PAT"], S.files["2.PAT"], S.rom);
  const scr = new U.Screen();
  let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 2e8) throw new Error("poll limit"); } });
  const out = { ticks: [], frames: {}, music: [], tick: 0 };
  const bgm = { playSong(n) { out.music.push({ tick: out.tick, op: "play", n }); }, fadeOut() { out.music.push({ tick: out.tick, op: "fade" }); } };
  const op = new U.Opening({ scr, sys, bgm, font }, opts.data || S.openData());
  const keys = (opts.keys || []).slice().sort((a, b) => a.tick - b.tick);
  const keep = new Set(opts.keep || []);
  const vga = op.vga; let lastHash = 0, dirty = true;
  const w0 = vga.write.bind(vga); vga.write = (o, v) => { dirty = true; w0(o, v); };
  const record = () => {
    if (dirty) { lastHash = S.hashPlanes(vga.planes); dirty = false; }
    out.ticks.push({ h: lastHash, dac: Array.from(op.dac).join(","), border: vga.overscan });
    if (keep.has(out.tick) || opts.keepAll) out.frames[out.tick] = { planes: vga.planes.map(p => p.slice(0, 0x9600)), dac: op.dac.slice() };
    out.tick++;
    while (keys.length && keys[0].tick <= out.tick) { const k = keys.shift(); if (k.mouse !== undefined) sys.mouse.buttons = k.mouse; else sys.pushKey(k.scan, k.ascii); }
  };
  const g = sys.timer.get.bind(sys.timer);
  sys.timer.get = () => { if (sys.timer.count) record(); return g(); };
  out.result = "end";
  try { await op.run(); } catch (e) { out.result = "error: " + e.message; out.stack = e.stack; }
  out.op = op;
  return out;
};
S.compareOpen = function (name, e, j) {
  const n = Math.max(e.ticks.length, j.ticks.length);
  let same = 0, first = -1, dacDiff = 0, vramDiff = 0, bdDiff = 0;
  for (let i = 0; i < n; i++) {
    const a = e.ticks[i], b = j.ticks[i];
    if (a && b && a.h === b.h && a.dac === b.dac && a.border === b.border) { same++; continue; }
    if (first < 0) first = i;
    if (a && b) { if (a.h !== b.h) vramDiff++; if (a.dac !== b.dac) dacDiff++; if (a.border !== b.border) bdDiff++; }
  }
  const mE = e.music.filter(m => m.ah === 1 || m.ah === 2).map(m => (m.ah === 1 ? "play@" : "fade@") + m.tick).join(" ");
  const mJ = j.music.map(m => m.op + "@" + m.tick).join(" ");
  const ok = same === n && e.ticks.length === j.ticks.length;
  return `${ok ? "OK  " : "FAIL"} ${name.padEnd(22)} ticks emu=${e.ticks.length} js=${j.ticks.length} same=${same}/${n}` +
    (first >= 0 ? ` first@${first} (vram ${vramDiff}, dac ${dacDiff}, border ${bdDiff})` : "") + ` | music emu[${mE}] js[${mJ}] | js ${j.result}`;
};
// 以索引图存盘 (640x480, 1 byte/像素) 供查看
S.saveIdx = function (planes, path) {
  const out = new Uint8Array(640 * 480);
  for (let o = 0; o < 0x9600; o++) for (let i = 0; i < 8; i++) { const s = 7 - i; out[o * 8 + i] = ((planes[0][o] >> s) & 1) | (((planes[1][o] >> s) & 1) << 1) | (((planes[2][o] >> s) & 1) << 2) | (((planes[3][o] >> s) & 1) << 3); }
  fs.writeFileSync(path, Buffer.from(out));
};
S.OPEN_ROUTES = {
  full: [],
  "esc@300": [{ tick: 300, scan: 0x01, ascii: 0x1b }],                 // 场景 0 的 4fd5 等待 (Esc 才有效)
  "enter@300": [{ tick: 300, scan: 0x1c, ascii: 0x0d }],               // 同上: Enter 被读掉但不跳过
  "enter@2600": [{ tick: 2600, scan: 0x1c, ascii: 0x0d }],             // 4f0d 系等待: Enter 跳过
  "esc@2600": [{ tick: 2600, scan: 0x01, ascii: 0x1b }],               // 同上: Esc 被读掉但不跳过
  "space@6000": [{ tick: 6000, scan: 0x39, ascii: 0x20 }],
  "click@4200": [{ tick: 4200, mouse: 1 }, { tick: 4201, mouse: 0 }],
};
S.openTests = async function (names) {
  names = names || Object.keys(S.OPEN_ROUTES);
  const rep = [];
  S.openEmuCache = S.openEmuCache || {};
  for (const nm of names) {
    const keys = S.OPEN_ROUTES[nm];
    const e = S.openEmuCache[nm] || (S.openEmuCache[nm] = (() => { const r = S.runOpen({ keys }); delete r.env; return r; })());
    const j = await S.runOpenJS({ keys });
    rep.push(S.compareOpen(nm, e, j));
    S.lastJS = j;
  }
  console.log(rep.join("\n"));
  return rep;
};
})();
