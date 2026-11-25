// shipyard_route2.js — 造船厂 造新船 / 交船 / 买旧船 / 改造 差分测试设置 (先运行 shipyard_route.js 的舰队设置方式, 再运行 port_tests.js)
// 进港时两边同时写入: 现金 300000; 主角舰队 2 艘 (船位 0 = 船 0 船型 0 船长主角; 船位 1 = 船 1 船型 4 船长人物 8 水手 5);
// 里斯本船坞 1 艘 (船位 10 = 船 2); 人物 8 在船员栏 (职务 2)。
//   S.SY2_MODE = "build" (默认): 造新船 (第 1 个船型、材质 0、照价、船名键盘输入 1 字、水手 15、砲 2) → 再进造新船 (工期消息)
//                → 改造: 船首像 (船位 0, 第 2 种) → 武装 (船位 0, 第 1 种砲 2 门) → 积载比例 (船位 0, 水手 12 砲 1) → 船名变更 (船位 0) → 离开
//   S.SY2_MODE = "used": 预先放一艘造好的船 (船坞位 11 = 船 3, 状态 0x20, 经济 +23 = 0), 人物 9 在船员栏 (职务 3), 中古船表第 1 格 = 船型 4
//                → 造新船 = 交船 (是) → 买旧船 (没有职务 ≥ 3 的人 → 0xa6 → 0xa7 → 选舰队第 2 艘折抵 → 中古船第 1 艘 → 是 → 照价 → 船名) → 离开
//   S.SY2_MODE = "trade": 同 "used", 但折抵的船 (船位 1) 带着 水 57 / 粮食 123 / 资材 5 / 弹药 3 / 商品 3 ×20 → 买下后出现剩余货物分配 (0fea:e788 / fe57):
//                选舰队第 2 艘 → 水 装 3 → 空列 → 剩余清单第 5 项 (商品) 装 15 → Esc → Esc → 0xd3 (还有剩) 确认 → 回造船厂 → 离开
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  d1: [0x02, 0x31], d2: [0x03, 0x32], d3: [0x04, 0x33], d5: [0x06, 0x35] };
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
mkShip(2, 4); mkSlot(10, 2, 4, 0); mkCrew(10, 0x80, 0);
const P = n => 0x12b6 + n * 0x32;
b(P(8) + 0x2c, 0); b(P(8) + 0x2d, 0xff); b(P(8) + 0x2e, 2); b(P(8) + 0x2b, 100); b(0x2e1b, 8); b(0x2e39, 1);
const mode = S.SY2_MODE || "build";
const E = n => Array(n).fill(K.enter);
const NAME = [K.esc, K.enter, K.esc, K.left, K.left, K.down, K.down, K.enter];   // 键盘: Esc 到字表 → 第 1 字 → Esc 回 10 → 0「结束」→ 2「决定」
let keys;
if (mode === "build") {
  keys = [K.up,
    ...E(1), ...E(1),                       // 造新船 → 0xfc 等待
    ...E(1), ...E(1), ...E(1),              // 船型清单第 1 个 → 说明 等待 → 0xfd 是
    ...E(1), ...E(1),                       // 材质第 1 种 → 0xff 是
    ...E(1),                                // 0x100 照价 是
    ...NAME,                                // 0xc7 船名
    ...E(1),                                // 0x101 等待
    K.d1, K.d5, K.enter, K.d2, K.enter,     // 水手 15、砲 2
    ...E(1), ...E(1),                       // 0x104 是 → 0x106 等待
    ...E(1), ...E(1),                       // 再进造新船 → 0x105 等待
    K.down, K.down, K.down, K.down, K.enter,   // 改造
    K.enter, K.enter, K.down, K.enter, K.enter, K.esc,             // 船首像 → 船位 0 → 第 2 种 → 是 → (清单) Esc
    K.down, K.enter, K.enter, K.enter, K.d2, K.enter, K.enter, K.esc,   // 武装 → 船位 0 → 第 1 种 → 2 门 → 是 → Esc
    K.down, K.down, K.enter, K.enter, K.enter, K.d1, K.d2, K.enter, K.d1, K.enter, K.enter, K.esc,   // 积载比例 → 船位 0 → 是 → 水手 12 砲 1 → 是 → Esc
    K.down, K.down, K.down, K.enter, K.enter, ...NAME, K.esc,      // 船名变更 → 船位 0 → 键盘 → Esc
    K.esc, K.esc, K.down];
} else {
  if (mode === "trade") { w16(crew(1), 57); w16(crew(1) + 2, 123); w16(crew(1) + 4, 5); w16(crew(1) + 6, 3); b(crew(1) + 0x16, 3); w16(crew(1) + 0x0c, 20); }
  mkShip(3, 4); mkSlot(11, 3, 4, 0); b(slot(11) + 8, 0x20); mkCrew(11, 0x80, 0);
  b(0x6a80 + 0x23, 0);                                                   // 里斯本经济 +23 工期 = 0
  b(P(9) + 0x2c, 0); b(P(9) + 0x2d, 0xff); b(P(9) + 0x2e, 3); b(P(9) + 0x2b, 100); b(0x2e1c, 9); b(0x2e39, 2);
  b(0x7f74, 4); for (let i = 1; i < 5; i++) b(0x7f74 + i, 0xff);
  keys = [K.up,
    ...E(1), ...E(1), ...E(1),              // 造新船 → 0xfa 等待 → 0x107 是
    K.down, K.enter,                        // 买旧船
    ...E(1), ...E(1),                       // 0xa6 等待 → 0xa7 等待
    K.down, K.enter, K.enter,               // 折抵: 舰队第 2 艘 → 0xc9 是
    ...E(1), ...E(1), ...E(1),              // 中古船第 1 艘 → 说明 等待 → 0xc1 是
    ...E(1),                                // 0xc2 照价 是
    ...NAME,
    ...(mode === "trade" ? [
      K.down, K.enter,                      // 剩余货物: 舰队第 2 艘
      K.enter, K.d3, K.enter,               // 水 装 3
      K.down, K.down, K.down, K.down, K.enter,   // 空列
      K.down, K.down, K.down, K.down, K.enter, K.d1, K.d5, K.enter,   // 剩余清单第 5 项 (商品 3) 装 15
      K.esc, K.esc, K.enter] : []),         // 离开这艘 → 离开舰队清单 → 0xd3 确认
    K.esc, K.down];
}
for (const [a, v] of S.SY_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 67, vy: 53, hx: 12, hy: 12, poke };        // 造船厂 (79,64) 正下方
S.PORT_KEYS = S.SY_KEYS || keys;
S.NO_EVENTS = 1;
})();
