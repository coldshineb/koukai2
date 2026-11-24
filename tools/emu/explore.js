// explore.js — 開發輔助: 一步一步驅動原版 (模擬器), 用來探索長路線的按鍵序列 (例: opening_route.js 的約翰開場)
// 與 port_tests.js 的 runEmu 用同一套規則 (makeScript gap 40、第一次 4d92 亂數時 sc.calls = 0), 所以探索出的按鍵在 port_tests 重播時結果相同。
//   S.X.start(keys, { fleetAI })  從標題畫面開始, 送出 keys 後停在「等下一個鍵」的時刻
//   S.X.step(keys)                接著送 keys, 一樣停在等下一個鍵的時刻 (中途不插入任何額外動作, 與一次送完等價)
//   S.X.png(file)                 目前畫面 → PNG (原版 DAC)
//   S.X.st()                      目前的主要狀態 (港、位置、時刻、現金、SNR1 旗標…)
//   S.X.log                       至今送出的所有按鍵 (= 重播用的完整序列)
"use strict";
(function () {
const S = session, L = 0x110 * 16;
const X = S.X = {};
// 等輸入的位置 (最後一次進入的函式 = 目前在等什麼): 走路 210f1、直式選單 14364、按鍵等待 147ab、是/否 1469c、清單 15a70、計算機 / 姓名鍵盤等其他 = "?"
const WATCH = { [L + 0x210f1]: "walk", [L + 0x14364]: "menu", [L + 0x147ab]: "wait", [L + 0x1469c]: "yesno", [L + 0x15a70]: "list", [L + 0x21151]: "sea" };
X.inside = () => X.ctx !== "walk";
X.start = (keys, o = {}) => {
  S.restoreTitle();
  const env = S.titleEnv, c = env.cpu;
  Object.assign(env.mouse, { x: 0x27f, y: 0x18f + 0x28, b: 0 });
  const sc = X.sc = S.makeScript([]);
  X.log = []; X.idle = false; X.shots = 0;
  const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;
  S.installEmuServices(sc, () => { X.shots++; });
  S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
  // 等下一個鍵的時刻: 腳本空且查詢次數已到 gap − 1 → 停下 (下一次查詢就是一次送完時送出下一鍵的那一次, 所以分段送與一次送完等價)
  for (const v of [0x16, 0x33]) { const h = c.hooks[v]; c.hooks[v] = cpu => { const k0 = sc.keys.length; h(cpu);
    if (!k0 && !sc.keys.length && sc.calls >= sc.gap - 1 && (v !== 0x16 || (cpu.r[0] >> 8) === 1) && (v !== 0x33 || cpu.r[0] === 3)) { X.idle = true; cpu.halted = true; } }; }
  if (!o.fleetAI) c.mem[L + 0x1ac19] = 0xcb;
  X.fleetAI = !!o.fleetAI;
  let synced = false;
  X.ctx = "?";
  c.onTick = cpu => { const lin = cpu.s[1] * 16 + cpu.ip; if (!synced && lin === L + 0x4d92) { synced = true; sc.calls = 0; } const n = WATCH[lin]; if (n) X.ctx = n; };
  return X.step(keys);
};
X.step = (keys, ms = 200000) => {
  const env = S.titleEnv, c = env.cpu, sc = X.sc;
  for (const k of keys) { sc.keys.push(k); X.log.push(k); }
  X.idle = false; c.halted = false;
  const t0 = Date.now();
  while (!X.idle && Date.now() - t0 < ms) c.run(2e7);
  if (!X.idle) console.log("[X] timeout, keys left", sc.keys.length);
  return X.st();
};
X.u8 = a => { const c = S.titleEnv.cpu; return c.mem[c.s[3] * 16 + a]; };
X.u16 = a => X.u8(a) | (X.u8(a + 1) << 8);
X.st = () => {
  const u8 = X.u8, u16 = X.u16, f = [];
  for (let i = 0; i < 16; i++) if (u8(0x0cd6 + (i >> 3)) & (1 << (i & 7))) f.push(i);
  return { shots: X.shots, keys: X.log.length, port: u8(0x0cae), pos: [u16(0x0cb4) + u16(0x0cb8), u16(0x0cb6) + u16(0x0cba)], view: [u16(0x0cb4), u16(0x0cb6)],
    date: [u8(0x0532), u8(0x0533), u8(0x0534), u8(0x0535)], money: (u16(0x12ae) | (u16(0x12b0) << 16)) >>> 0, snr1: [u8(0x0cd4), u8(0x0cd5)], snr0: [u8(0x0d5e), u8(0x0d5f)], f1: f.join(","),
    ctx: X.ctx, rng: (X.u16(0xbd88) | (X.u16(0xbd8a) << 16)) >>> 0 };
};
X.png = file => {
  const c = S.titleEnv.cpu, fb = S.emuFb480();
  S.png({ fb, dac: Array.from(c.vga.dac.slice(0, 48)) }, file, true);
};
})();
