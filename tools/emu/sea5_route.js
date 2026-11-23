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
//   "scout"  命令 偵察 (1feae): 艦隊 65 / 66 (指揮者 64 / 65, 艦隊編號 66 → 61..69 的額外發言) 移到 (120, 356), 船員 9 的 +1e = 100 (發言必定出現)
//            游標 → 里斯本港 (港名訊息) → 艦隊 5 (單一艦隊) → 兩支艦隊的格 (清單 0x8c 選第 2 個 → 資料 → 0x2fe) → Esc;
//            再以滑鼠點艦隊 5 → 資料 → 點地圖視窗外 (= Esc)
if (mode === "scout") {
  mates([[8, 2], [9, 3]]); b(P(9) + 0x1e, 100);
  for (const k of [65, 66]) { const F = 0x2e76 + 0x85 * k; w16(F, 120); w16(F + 2, 356); }
  const R = K.right, L = K.left, U = K.up, M = (x, y, bt) => ({ mouse: { x, y, b: bt } });
  const click = (x, y) => [M(x, y + 40, 0), M(x, y + 40, 1), M(x, y + 40, 0)];
  keys = [...idle(2), K.f3, ...idle(2), E,
    R, R, E, E,                                   // 里斯本港
    ...Array(9).fill(L), ...Array(7).fill(U), E, E,   // 艦隊 5
    R, R, U, U, E, K.down, E, E, E,               // 兩支艦隊 → 第 2 個 → 資料 → 0x2fe
    X, X, ...idle(2),
    K.f3, ...idle(2), E, ...click(0x60 + 3 * 16 + 8, 8 + 5 * 16 + 8), E,   // 滑鼠點艦隊 5
    ...click(600, 300), X, ...idle(2)];
}
//   "dest"   舵輪中央 '5' (2e09:310b 指定目的地): 「請指定目的地」→ 游標左移 4 格 (114, 358) → 自動航行 (+0c = 6000) → 到達 →
//            靠港檢查 (附近沒有港口) → 再次指定目的地 → Esc (停船)。S.SEA5_IDLE = 自動航行的空動作數
//   "deleg"  航海術 委任 (船員 9 = 職務 3、+30 bit4): 已發現港口清單 → 第 2 項 塞維爾 → 地點路線 (232a6) + 區域內中途點 (240a7 / 23a97 模式 1)
//            → 到達 → 靠港「是」→ 進港
const K5 = [0x06, 0x35];
if (mode === "dest") {
  keys = [...idle(2), K5, ...idle(2), K.left, K.left, K.left, K.left, E, ...idle(S.SEA5_IDLE ?? 60), X, ...idle(4)];
}
if (mode === "deleg") {
  mates([[8, 2], [9, 3]]);
  keys = [...idle(2), K.f4, ...idle(2), E, K.down, E, ...idle(S.SEA5_IDLE ?? 300), E, ...idle(6)];
}
//   "deleg0" 委任到清單第 1 項 里斯本 (出港處): 起點與目的地的最近地點相同 → 直接駛向 (+0d |= 20); 目的地是陸地 → 23e19 換成附近的海 → 到達 → 靠港「是」
if (mode === "deleg0") {
  mates([[8, 2], [9, 3]]);
  keys = [...idle(2), K.f4, ...idle(2), E, E, ...idle(S.SEA5_IDLE ?? 40), E, ...idle(8)];
}
for (const [a, v] of S.SEA5_POKE || []) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.SEA5_KEYS || keys;
})();
