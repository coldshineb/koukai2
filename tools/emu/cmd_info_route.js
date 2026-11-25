// cmd_info_route.js — 港口指令按钮「情报」(1fd9:0e33 = 20bc3) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本; 进港时两边同时写入: 主角舰队 2 艘 (同 cmd_manage_route; 船位 0 载 商品 0 ×20、商品 5 ×10, 船位 1 船首像 3),
//   船员 8 (船长) / 9 (助手) / 10 (会计, +30 bit1), 主角 +30 bit1 清除; 发现物 0..2 设为已知且已发现 (+6 = 0x60)
// F1 → 自舰队情报 (全画面, 之后重新进港) → 舰船情报 (第 1 艘、第 2 艘) → 人物情报 (主角、人物 8) → 主公情报 →
//      积载情报 (第 1 艘、第 2 艘 = 没有商品) → 积载一览表 (商品 0 → 会计发言) → 发现物情报 (第 1 项) → Esc
//   S.CMD_MODE = "log" / "map": 航海日志 / 海港地图 (另见档尾)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0], z: [0x2c, 0x7a] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]), b = (a, v) => poke.push([a, v]);
w16(0x12ae, 23456); w16(0x12b0, 1);
const slot = i => 0x2e76 + 0x2b + 9 * i, crew = i => 0x52d4 + 0x1e * i, ship = n => 0x5892 + 0x16 * n, T = t => 0x5e28 + 0x0c * t;
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const mkShip = (n, t) => { b(ship(n) + 0x0f, t); b(ship(n) + 0x10, 1); b(ship(n) + 0x11, 4); w16(ship(n) + 0x12, 30); w16(ship(n) + 0x14, 100); };
const mkSlot = (i, n, t, sailors) => { w16(slot(i), sailors); const d = Math.trunc(9 * at(T(t) + 1) / 10);
  b(slot(i) + 2, d); b(slot(i) + 3, d); b(slot(i) + 4, at(T(t) + 2)); b(slot(i) + 5, at(T(t) + 3)); b(slot(i) + 6, 0); b(slot(i) + 7, n); b(slot(i) + 8, 0x10); };
const mkCrew = (i, cap, fh) => { for (let k = 0; k < 0x16; k++) b(crew(i) + k, 0); for (let k = 0; k < 5; k++) b(crew(i) + 0x16 + k, 0xff);
  b(crew(i) + 8, 30); b(crew(i) + 9, 20); b(crew(i) + 0x1b, cap); b(crew(i) + 0x1c, 50); b(crew(i) + 0x1d, fh); };
mkShip(0, 0); mkSlot(0, 0, 0, 10); mkCrew(0, 0, 0);
mkShip(1, 4); mkSlot(1, 1, 4, 5); mkCrew(1, 8, 3);
w16(crew(0), 100); w16(crew(0) + 2, 50); b(crew(0) + 0x16, 0); w16(crew(0) + 0x0c, 20); b(crew(0) + 0x17, 5); w16(crew(0) + 0x0e, 10);
b(slot(1) + 6, 4); b(slot(1) + 8, 0x12);                                   // 船位 1: 砲 4 门, 砲种 2
const mate = (n, role, loyal, pay, k) => { const P = 0x12b6 + n * 0x32; b(P + 0x2c, 0); b(P + 0x2d, 0xff); b(P + 0x2e, role); b(P + 0x2b, loyal); b(0x2e1b + k, n); b(0x2e39 + k, pay); };
mate(8, 2, 100, 1, 0); mate(9, 3, 90, 5, 1); mate(10, 4, 90, 3, 2);
b(0x12b6 + 10 * 0x32 + 0x30, at(0x12b6 + 10 * 0x32 + 0x30) | 2);
b(0x12b6 + 0x30, at(0x12b6 + 0x30) & 0xfd);
for (let i = 0; i < 3; i++) b(0x7f8c + i * 7 + 6, 0x60);
for (const [a, v] of S.CMD_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
// 航海日志: [0c8e] 缓冲 (原版: 内存区块 DS:bc36 + 7×handle 的 +1 = 段; 移植版: 状态 0x8a18) 写入 S.CMD_LOG 笔 (各种类轮流) + FFFF 结束
if (S.CMD_MODE === "log") {
  const L = [], n = S.CMD_LOG ?? 14, kinds = [0, 1, 2, 9, 0x0c, 2, 5];
  for (let i = 0; i < n; i++) {
    const t = kinds[i % kinds.length], date = 21 * 372 + (i % 12) * 31 + i * 2;
    const e = [date, t, t === 2 ? [0x3c + (i & 3), 13 + (i % 5) * 10, 5][i % 3] : t === 9 ? i : 30 + i, t === 2 ? i % 3 : i, i * 3, i, 0, 0];
    for (const w of e) L.push(w & 255, (w >> 8) & 255);
  }
  L.push(0xff, 0xff);
  S.PORT_SETUP.emuHook = (mem, d) => { const h = mem[d + 0x0c8e] | (mem[d + 0x0c8f] << 8), r = d + 0xbc36 + 7 * h, seg = mem[r + 1] | (mem[r + 2] << 8);
    L.forEach((v, k) => { mem[seg * 16 + k] = v; }); };
  S.PORT_SETUP.jsHook = st => L.forEach((v, k) => st.set8(0x8a18 + k, v));
}
const D = n => Array(n).fill(K.down), E = K.enter, Z = K.z;
const INFO = [K.f1,
  E, E, Z,                                                                    // 自舰队情报
  K.down, E, E, K.down, E, K.esc, Z,                                          // 舰船情报
  ...D(2), E, E, K.down, E, K.esc, Z,                                         // 人物情报
  ...D(3), E, E, Z,                                                           // 主公情报
  ...D(4), E, E, E, Z, K.down, E, K.esc, Z,                                   // 积载情报
  ...D(5), E, E, E, Z,                                                        // 积载一览表
  ...D(6), E, E, E, Z, K.esc, Z,                                              // 发现物情报
  K.esc];
const LOG = [K.f1, ...D(8), E, Z, K.right, E, Z, K.left, E, Z, K.esc, Z, K.esc];   // 航海日志: 前页 / 后页
const MAP = [K.f1, ...D(9), E, Z, E, Z];                                               // 海港地图 → 任意键 (菜单随即结束)
// S.CMD_MODE = "chart": 航海图 (1dace, 在港分支: 84de / 88e9 / 港口外框): [100e] = 1、里斯本附近的海域格 (第 13..15 列, 第 4..7 栏) 设为已探索
//   → 世界全图 → Enter (主角所在格) → 任意键 → 全图 → Esc → Esc
// S.CMD_MODE = "mapitem": 航海术 → 随身物 0x50 (地图, +12 = 发现物 0) 使用 (1dd76, 在港分支) → 任意键 → Esc → Esc
if (S.CMD_MODE === "chart") { w16(0x100e, 1); for (let r = 13; r <= 15; r++) b(0x0de8 + 12 * r, 0x0f); }
if (S.CMD_MODE === "mapitem") { for (let i = 0; i < 20; i++) b(0x2e57 + i, i ? 0xff : 0x50); b(0x8248 + 0x50 * 0x14 + 0x12, 0); }
const CHART = [K.f1, ...D(7), E, Z, E, Z, Z, K.esc, Z, K.esc, Z];
const MAPITEM = [K.f4, ...D(4), E, E, K.down, E, Z, Z, K.esc, K.esc, Z];
S.PORT_KEYS = S.CMD_KEYS || (S.CMD_MODE === "log" ? LOG : S.CMD_MODE === "map" ? MAP : S.CMD_MODE === "chart" ? CHART : S.CMD_MODE === "mapitem" ? MAPITEM : INFO);
S.NO_EVENTS = 1;
})();
