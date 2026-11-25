// house_route.js — 住宅 (1fd9:e2a4 = 2e034) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// S.HOUSE_MODE:
//   "collector"  里斯本 (69,49) 种类 0 发现物收购: 合约 否 (0x1e2) → 合约 是 (0x1e3, 标志 bit4) → 发现物报告 (发现物 3 / 7 (价值 100)) 选第 2 件 (酬金 100000)
//                → 冒险传闻 (第一个未发现 = 发现物 1; random(80) ≤ 运气 → 真正位置) → 离开
//   "collector0" 同上, 但主角运气 (+23) = 0 → 冒险传闻乱说 (纬度永远「南纬」)
//   "mapper"     威尼斯 (19,90) 种类 1 地图制作, 现金 50000, 主角 +1e = 80: 合约 (还不会制图 0x1f0) → 技能学习 (47700, 是) → 合约 是 → 地理报告 (没有进展 0x1fa) → 离开
//   "geo"        威尼斯, 已签合约、已会制图、[1010] = 50、[100e] = 3300、随身物 0x50 (藏宝图 → 发现物 3), 现金 30000:
//                地理报告 (世界地图完成: GRAPH #0x3f, 清除 0de8 地图记录; 酬金 4000) → 地图确认 (2 万, 是) → 离开
//   "school2"    港 10 (76,22) 种类 2 测量技术: 能力不足 → (改写 +1e = 80) 钱不够 → (改写现金 60000) 学会 → 已经会了 → 否
//   "school3"    港 35 (83,40) 种类 3 砲术: 能力足够, 现金 60000 → 学会 → 否
//   "locked"     塞维尔 (83,8) 没有住宅记录 → 船员 0x3a5
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.HOUSE_MODE || "collector";
const money = { mapper: 50000, geo: 30000, school3: 60000 }[mode] ?? 3000; w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const H = 0x12b6, disc = i => 0x7f8c + 7 * i, rec = i => 0x2a26 + 0x16 * i;
if (mode.startsWith("collector")) { poke.push([disc(3) + 6, 0x20], [disc(7) + 5, 100], [disc(7) + 6, 0x20], [disc(1) + 6, 0]); if (mode === "collector0") poke.push([H + 0x23, 0]); }
if (mode === "mapper") poke.push([H + 0x1e, 80]);
if (mode === "geo") { poke.push([rec(5) + 0x14, 0x19], [H + 0x30, 0x09], [0x2e57, 0x50], [0x8248 + 0x50 * 0x14 + 0x12, 3]); w16(0x1010, 50); w16(0x100e, 0x0ce4); }
if (mode === "school3") poke.push([H + 0x1c, 90], [H + 0x1e, 90], [H + 0x20, 90]);
for (const [a, v] of S.HOUSE_POKE || []) poke.push([a, v]);
const E = K.enter, D = K.down, U = K.up, X = K.esc;
const KEYS = {
  collector: [E, E, X, E, E, E, E, E, D, E, D, E, E, D, D, E, E, X, D],
  mapper: [E, E, E, D, E, E, E, E, E, E, E, E, D, D, E, E, X, D],
  geo: [D, D, E, E, E, D, D, D, E, E, E, E, X, D],
  school2: [E, E, E, U, E, E, E, E, U, E, E, E, E, U, E, E, E, U, X, E, D],
  school3: [E, E, E, E, U, X, E, D],
  locked: [E, D],
};
KEYS.collector0 = KEYS.collector;
const SETUP = { collector: [0, 57, 37, 12, 13], mapper: [13, 7, 72, 12, 19], geo: [13, 7, 72, 12, 19], school2: [10, 64, 10, 12, 13], school3: [35, 71, 28, 12, 13], locked: [1, 71, 0, 12, 9] }[mode.replace(/0$/, "")];
S.PORT_SETUP = { port: SETUP[0], vx: SETUP[1], vy: SETUP[2], hx: SETUP[3], hy: SETUP[4], time: 0x18, poke };
S.PORT_KEYS = [U, ...(S.HOUSE_KEYS || KEYS[mode])];
S.TELEPORT = undefined;
if (mode === "school2") {                                      // 第 2 / 3 次进门前改写
  const B = 11, P = S.PORT_KEYS, ups = []; P.forEach((k, i) => { if (k === U) ups.push(B + i); });
  S.TELEPORT = { [ups[1]]: [[H + 0x1e, 80]], [ups[2]]: [[0x12ae, 60000 & 255], [0x12af, (60000 >> 8) & 255]] };
}
S.NO_EVENTS = 1;
})();
