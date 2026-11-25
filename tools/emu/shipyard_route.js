// shipyard_route.js — 船坞 / 造船厂 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 进港时两边同时写入: 现金 3000; 主角舰队 2 艘 (船位 0 = 船 0 船型 0, 船长 = 主角; 船位 1 = 船 1 船型 4, 船长 = 人物 8, 水手 5, 船首像 3);
// 里斯本船坞 1 艘 (船位 10 = 船 2 船型 4, 船员配置 +1b = 0x80); 人物 8 在船员栏 (职务 2, 忠诚 100, 以免码头要求加薪)。
//   S.SY_MODE = "dock" (默认): 码头 → 船坞 → 保管 (船位 1) → 配备 (船坞第 1 艘) → 交换 (舰队第 1 艘 ↔ 船坞第 1 艘) → 离开
//   S.SY_MODE = "yard": 造船厂 → 修理 (船位 0, 耐久 10/20) → 卖船 (船位 1) → 工业投资 (里斯本是首都 → 消息 2) → 离开
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]), b = (a, v) => poke.push([a, v]);
w16(0x12ae, 3000); w16(0x12b0, 0);
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
const P8 = 0x12b6 + 8 * 0x32; b(P8 + 0x2c, 0); b(P8 + 0x2d, 0xff); b(P8 + 0x2e, 2); b(P8 + 0x2b, 100); b(0x2e1b, 8); b(0x2e39, 1);
const mode = S.SY_MODE || "dock";
if (mode === "yard") { b(slot(0) + 2, 10); b(slot(0) + 3, 20); }
for (const [a, v] of S.SY_POKE || []) b(a, v);
const E = n => Array(n).fill(K.enter);
if (mode === "dock") {
  S.PORT_SETUP = { port: 0, vx: 42, vy: 56, hx: 12, hy: 12, poke };            // 码头 (54,67) 正下方
  S.PORT_KEYS = S.SY_KEYS || [K.up, K.down, K.down, K.enter,                   // 码头 → 船坞
    ...E(4),                                                                     // 保管 → 清单第 1 艘 → 是 → 等待
    K.down, ...E(4),                                                             // 配备 → 船坞第 1 艘 → 是 → 等待
    K.down, K.down, ...E(5),                                                     // 交换 → 舰队第 1 艘 → 船坞第 1 艘 → 是 → 等待
    K.esc, K.esc, K.down];
} else {
  S.PORT_SETUP = { port: 0, vx: 67, vy: 53, hx: 12, hy: 12, poke };            // 造船厂 (79,64) 正下方
  S.PORT_KEYS = S.SY_KEYS || [K.up,
    K.down, K.down, K.enter, K.enter, K.enter, K.esc,                            // 修理 → 船位 0 → 是 → (清单) Esc
    K.down, K.down, K.down, K.enter, K.down, K.enter, K.enter, K.enter, K.enter, K.enter,   // 卖船 → 第 2 艘 → 是 → 0xd4 是 → 0xd5 是 → 0xd0 等待
    K.down, K.down, K.down, K.down, K.down, K.enter, K.enter,                    // 工业投资 → 消息 2 等待
    K.esc, K.down];
}
S.NO_EVENTS = 1;
})();
