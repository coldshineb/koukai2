// sea5_route.js — 出海與航海 階段 5 後半 (海上指令) 的差分測試設定: 依序執行 本檔 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船), 之後依 S.SEA5 送出海上的按鍵; 兩邊同時寫入的資料放在 S.SEA_POKE。
//   "navi"   隨身物 測量 (298a5): 主角沒有技能 → 0x2f5 → 船員清單 (人物 8 沒有技能 → 0x2f3) → Esc → 主角發言、誤差 random(100)+1;
//            再用 精度 1 的 → 選人物 9 (有技能) → 經緯度
//   "navi2"  主角有測量技能 (+30 bit4): 直接顯示 (精度 5)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0] };
const D = n => Array(n).fill(K.down), E = K.enter, X = K.esc, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v]), w16 = (a, v) => { b(a, v & 255); b(a + 1, (v >> 8) & 255); };
const P = n => 0x12b6 + n * 0x32;
const inv = list => { for (let i = 0; i < 20; i++) b(0x2e57 + i, i < list.length ? list[i] : 0xff); };
const mates = list => { for (let i = 0; i < 30; i++) b(0x2e1b + i, i < list.length ? list[i][0] : 0xff);
  for (const [n, role] of list) { b(P(n) + 0x2c, 0); b(P(n) + 0x2d, 0xff); b(P(n) + 0x2e, role); } };
const mode = S.SEA5 || "navi";
let keys;
if (mode === "navi" || mode === "navi2") {
  inv([0x14, 0x16]); mates([[8, 2], [9, 3]]);
  if (mode === "navi2") b(P(0) + 0x30, 0x11);
  keys = mode === "navi"
    ? [...idle(2), K.f4, ...idle(2), ...D(4), E, E, K.down, E, E, E, E, X, E, E, K.down, E, K.down, E, E, K.down, E, E, X, X, ...idle(2)]
    : [...idle(2), K.f4, ...idle(2), ...D(4), E, E, K.down, E, E, X, X, ...idle(2)];
}
for (const [a, v] of S.SEA5_POKE || []) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.SEA5_KEYS || keys;
})();
