// cmd_order_route.js — 港口指令按钮「命令」(1fd9:10a8 = 20e38) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本; 进港时两边同时写入: 主角舰队 2 艘 (船位 0 = 船 0 船型 0 船长主角; 船位 1 = 船 1 船型 4 船长人物 8, 与 shipyard_route 相同),
//   船员栏 [2e1b] = 人物 8 (职务 2, 忠诚 100, 酬金 10) / 9 (职务 3, 忠诚 30, 酬金 50) / 10 (职务 1, 忠诚 40, 酬金 30)
// F3 → 队形变更: 第 1 艘选第 2 项 → Esc 取消 → 再选第 2 项 → 剩下的 → 是 (船位 0 ↔ 1 交换)
//    → 粮食分配: 水 −1 +1 +1, 粮食 +1 −1 → Esc
//    → 酬金设置: 人物 8 (忠诚 ≥ 80: 0xdc) / 人物 9 (本人发言: 40 < 50 → 0xe0 → 60) / 人物 10 (船员 9 代言: 100) → Esc → Esc
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0], d0: [0x0b, 0x30], d1: [0x02, 0x31], d4: [0x05, 0x34], d6: [0x07, 0x36] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]), b = (a, v) => poke.push([a, v]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const slot = i => 0x2e76 + 0x2b + 9 * i, crew = i => 0x52d4 + 0x1e * i, ship = n => 0x5892 + 0x16 * n, T = t => 0x5e28 + 0x0c * t;
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const mkShip = (n, t) => { b(ship(n) + 0x0f, t); b(ship(n) + 0x10, 1); b(ship(n) + 0x11, 4); w16(ship(n) + 0x12, 30); w16(ship(n) + 0x14, 100); };
const mkSlot = (i, n, t, sailors) => { w16(slot(i), sailors); const d = Math.trunc(9 * at(T(t) + 1) / 10);
  b(slot(i) + 2, d); b(slot(i) + 3, d); b(slot(i) + 4, at(T(t) + 2)); b(slot(i) + 5, at(T(t) + 3)); b(slot(i) + 6, 0); b(slot(i) + 7, n); b(slot(i) + 8, 0x10); };
const mkCrew = (i, cap, fh) => { for (let k = 0; k < 0x16; k++) b(crew(i) + k, 0); for (let k = 0; k < 5; k++) b(crew(i) + 0x16 + k, 0xff);
  b(crew(i) + 8, 30); b(crew(i) + 9, 20); b(crew(i) + 0x1b, cap); b(crew(i) + 0x1c, 50); b(crew(i) + 0x1d, fh); };
mkShip(0, 0); mkSlot(0, 0, 0, 10); mkCrew(0, 0, 0);
mkShip(1, 4); mkSlot(1, 1, 4, 5); mkCrew(1, 8, 3);
const mate = (n, role, loyal, pay, k) => { const P = 0x12b6 + n * 0x32; b(P + 0x2c, 0); b(P + 0x2d, 0xff); b(P + 0x2e, role); b(P + 0x2b, loyal); b(0x2e1b + k, n); b(0x2e39 + k, pay); };
mate(8, 2, 100, 1, 0); mate(9, 3, 30, 5, 1); mate(10, 1, 40, 3, 2);
for (const [a, v] of S.CMD_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down), E = K.enter;
S.PORT_KEYS = S.CMD_KEYS || [K.f3,
  ...D(3), E, K.down, E, K.esc, K.down, E, E, E,                             // 队形变更 → 是
  ...D(4), E, E, K.right, E, E, K.down, E, K.left, E, K.esc,                 // 粮食分配
  ...D(5), E, E, E,                                                          // 酬金设置 → 人物 8
  K.down, E, K.d4, K.d0, E, E, K.d6, K.d0, E, E,                             // 人物 9
  K.down, K.down, E, K.d1, K.d0, K.d0, E, E,                                 // 人物 10
  K.esc, K.esc];
S.NO_EVENTS = 1;
})();
