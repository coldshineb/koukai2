// cmd_manage_route.js — 港口指令按鈕「經營」(1fd9:0fdc = 20d6c) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本; 進港時兩邊同時寫入: 主角艦隊 2 艘 (船位 0 = 船 0 船長主角, 水 100、商品 0 ×20; 船位 1 = 船 1 船長人物 8, 與 cmd_order_route 相同),
//   船員欄 [2e1b] = 人物 8 (職務 2) / 9 (職務 3 助手) / 10 (職務 4 會計)
// F2 → 船長變更: 第 2 艘 → 人物 10 → Esc (主角仍是船長)
//    → 人事變更: 會計 → 人物 8 (0xe4) / 助手 → 人物 10 (現為船長: 0xe3) → Esc
//    → 水手編組: 第 1 艘 4 名 → Esc (剩 6 名: 0xe7 否) → 第 2 艘 最大值 → Esc
//    → 水手比例: 第 1 艘 駕駛 −1 +1 +1, 瞭望 +1, 甲板 +1 −1 → Esc → Esc
//    → 艦船銷毀: 第 1 艘 (主角的船: 0xe9) → 第 2 艘 是 → Esc (船位清除)
//    → 積載分配: 第 1 艘 → Esc → Esc → 0xdb 是 → Esc
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0], d4: [0x05, 0x34], max: [0x35, 0x3f], z: [0x2c, 0x7a] };
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
w16(crew(0), 100); b(crew(0) + 0x16, 0); w16(crew(0) + 0x0c, 20);
const mate = (n, role, loyal, pay, k) => { const P = 0x12b6 + n * 0x32; b(P + 0x2c, 0); b(P + 0x2d, 0xff); b(P + 0x2e, role); b(P + 0x2b, loyal); b(0x2e1b + k, n); b(0x2e39 + k, pay); };
mate(8, 2, 100, 1, 0); mate(9, 3, 90, 5, 1); mate(10, 4, 90, 3, 2);
for (const [a, v] of S.CMD_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down), E = K.enter, Z = K.z;
S.PORT_KEYS = S.CMD_KEYS || [K.f2,
  E, K.down, E, K.down, K.down, K.down, E, K.esc,                              // 船長變更
  K.down, E, K.down, E, E, E, Z, E, K.down, K.down, E, E, Z, K.esc,           // 人事變更 (Z = 等待後可能被 131e3 清掉的空鍵)
  ...D(2), E, E, K.d4, E, Z, K.esc, K.right, E, Z, K.down, E, K.max, E, Z, K.esc,   // 水手編組
  ...D(3), E, E, E, K.right, E, E, K.down, E, K.down, E, K.left, E, K.esc, K.esc,   // 水手比例
  ...D(4), E, E, E, Z, K.down, E, E, Z, K.esc,                                 // 艦船銷毀
  ...D(5), E, E, K.esc, K.esc, E, Z,                                           // 積載分配
  K.esc];
S.NO_EVENTS = 1;
})();
