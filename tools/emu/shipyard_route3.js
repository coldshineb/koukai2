// shipyard_route3.js — 造船厂 买旧船: 中古船表 DS:7f74 读第 1 笔 (seg0:5cc4(0)) 的差分测试 (先运行本档, 再运行 port_tests.js)
// 中古船表是「最近到过的 3 个港」的缓存 (3 笔 × 8: +0..+4 船型, +5 港口; 到港 1bd16 把本港移到第 1 笔)。
// 原版 2be49 / 造船厂入口 / 64c6 都以 al = 0 调用 5cc4, 只读第 1 笔。以前移植版用 7f74 + 8 × 港口编号, 在里斯本 (港 0) 以外会读到别笔或表外。
// 在塞维尔 (港 1, 造船厂入口 (72,67)) 进行; 第 1 笔与第 2 笔放不同船型, 旧写法在港 1 会读到第 2 笔:
//   S.SY3_MODE = "used" (默认): 第 1 笔 = 船型 4 ×1 (港 1), 第 2 笔 = 船型 10 ×3 (港 0)
//                → 买旧船 (没有可当船长的人 → 0xa6 → 0xa7 → 舰队第 2 艘折抵 → 中古船第 1 艘 → 说明 → 是 → 照价 → 船名) → 离开
//   S.SY3_MODE = "empty": 第 1 笔全 FF (港 1), 第 2 笔 = 船型 10 ×3 → 菜单「买旧船」为灰色 → 离开
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]), b = (a, v) => poke.push([a, v]);
w16(0x12ae, 300000 & 0xffff); w16(0x12b0, 300000 >>> 16);
const slot = i => i < 10 ? 0x2e76 + 0x2b + 9 * i : 0x572a + 9 * i, crew = i => 0x52d4 + 0x1e * i, ship = n => 0x5892 + 0x16 * n;
const T = t => 0x5e28 + 0x0c * t;
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const mkShip = (n, t) => { b(ship(n) + 0x0f, t); b(ship(n) + 0x10, 1); b(ship(n) + 0x11, 4); w16(ship(n) + 0x12, 30); w16(ship(n) + 0x14, 100); };
const mkSlot = (i, n, t, sailors) => { w16(slot(i), sailors); const d = Math.trunc(9 * at(T(t) + 1) / 10);
  b(slot(i) + 2, d); b(slot(i) + 3, d); b(slot(i) + 4, at(T(t) + 2)); b(slot(i) + 5, at(T(t) + 3)); b(slot(i) + 6, 0); b(slot(i) + 7, n); b(slot(i) + 8, 0x10); };
const mkCrew = (i, cap, fh) => { for (let k = 0; k < 0x16; k++) b(crew(i) + k, 0); for (let k = 0; k < 5; k++) b(crew(i) + 0x16 + k, 0xff);
  b(crew(i) + 8, 30); b(crew(i) + 9, 20); b(crew(i) + 0x1b, cap); b(crew(i) + 0x1c, 50); b(crew(i) + 0x1d, fh); };
mkShip(0, 0); mkSlot(0, 0, 0, 10); mkCrew(0, 0, 0);
mkShip(1, 4); mkSlot(1, 1, 4, 5); mkCrew(1, 8, 3);
const P = n => 0x12b6 + n * 0x32;
b(P(8) + 0x2c, 0); b(P(8) + 0x2d, 0xff); b(P(8) + 0x2e, 2); b(P(8) + 0x2b, 100); b(0x2e1b, 8); b(0x2e39, 1);
const mode = S.SY3_MODE || "used";
const ent = (k, types, port) => { for (let i = 0; i < 5; i++) b(0x7f74 + 8 * k + i, types[i] ?? 0xff); b(0x7f74 + 8 * k + 5, port); };
ent(0, mode === "empty" ? [] : [4], 1);
ent(1, [10, 10, 10], 0);
ent(2, [], 0xff);
const E = n => Array(n).fill(K.enter);
const NAME = [K.esc, K.enter, K.esc, K.left, K.left, K.down, K.down, K.enter];
const keys = mode === "empty" ? [K.up, K.down, K.esc, K.down] : [K.up,
  K.down, K.enter,                        // 买旧船
  ...E(1), ...E(1),                       // 0xa6 等待 → 0xa7 等待
  K.down, K.enter, K.enter,               // 折抵: 舰队第 2 艘 → 0xc9 是
  ...E(1), ...E(1), ...E(1),              // 中古船第 1 艘 → 说明 等待 → 0xc1 是
  ...E(1),                                // 0xc2 照价 是
  ...NAME,
  K.esc, K.down];
for (const [a, v] of S.SY_POKE || []) b(a, v);
S.PORT_SETUP = { port: 1, vx: 60, vy: 56, hx: 12, hy: 12, poke };       // 塞维尔造船厂 (72,67) 正下方
S.PORT_KEYS = S.SY_KEYS || keys;
S.NO_EVENTS = 1;
})();
