// cmd_info_route.js — 港口指令按鈕「情報」(1fd9:0e33 = 20bc3) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本; 進港時兩邊同時寫入: 主角艦隊 2 艘 (同 cmd_manage_route; 船位 0 載 商品 0 ×20、商品 5 ×10, 船位 1 船首像 3),
//   船員 8 (船長) / 9 (助手) / 10 (會計, +30 bit1), 主角 +30 bit1 清除; 發現物 0..2 設為已知且已發現 (+6 = 0x60)
// F1 → 自艦隊情報 (全畫面, 之後重新進港) → 艦船情報 (第 1 艘、第 2 艘) → 人物情報 (主角、人物 8) → 主公情報 →
//      積載情報 (第 1 艘、第 2 艘 = 沒有商品) → 積載一覽表 (商品 0 → 會計發言) → 發現物情報 (第 1 項) → Esc
//   S.CMD_MODE = "log" / "map": 航海日誌 / 海港地圖 (另見檔尾)
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
b(slot(1) + 6, 4); b(slot(1) + 8, 0x12);                                   // 船位 1: 砲 4 門, 砲種 2
const mate = (n, role, loyal, pay, k) => { const P = 0x12b6 + n * 0x32; b(P + 0x2c, 0); b(P + 0x2d, 0xff); b(P + 0x2e, role); b(P + 0x2b, loyal); b(0x2e1b + k, n); b(0x2e39 + k, pay); };
mate(8, 2, 100, 1, 0); mate(9, 3, 90, 5, 1); mate(10, 4, 90, 3, 2);
b(0x12b6 + 10 * 0x32 + 0x30, at(0x12b6 + 10 * 0x32 + 0x30) | 2);
b(0x12b6 + 0x30, at(0x12b6 + 0x30) & 0xfd);
for (let i = 0; i < 3; i++) b(0x7f8c + i * 7 + 6, 0x60);
for (const [a, v] of S.CMD_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down), E = K.enter, Z = K.z;
const INFO = [K.f1,
  E, E, Z,                                                                    // 自艦隊情報
  K.down, E, E, K.down, E, K.esc, Z,                                          // 艦船情報
  ...D(2), E, E, K.down, E, K.esc, Z,                                         // 人物情報
  ...D(3), E, E, Z,                                                           // 主公情報
  ...D(4), E, E, E, Z, K.down, E, K.esc, Z,                                   // 積載情報
  ...D(5), E, E, E, Z,                                                        // 積載一覽表
  ...D(6), E, E, E, Z, K.esc, Z,                                              // 發現物情報
  K.esc];
S.PORT_KEYS = S.CMD_KEYS || INFO;
S.NO_EVENTS = 1;
})();
