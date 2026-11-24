// mouse_route.js — 滑鼠操作的差分測試設定 (RE_NOTES 第 38 節)。先執行本檔, 再依模式接 battle_route.js → sea_depart_route.js 或直接 port_tests.js
//   滑鼠事件 { mouse: { x, y, b } } 與按鍵排在同一序列 (y = 遊戲座標 + 40 = 驅動座標); 拖曳 = 按下 → 連續移動 → 放開。
//   原版的軟體游標畫在顯示記憶體裡, 放開後游標可能留在舊位置直到下一次顯示 (移植版在呈現時才畫游標), 所以比對時遮住最近 CURSOR_LAG 個滑鼠位置。
//   S.MOUSE_MODE = "list"   里斯本, 隨身物放 16 件 (清單種類 0x0d, 一頁 10 列): F4 → 隨身物 → 拖曳標題列 (清單移到 col 32, y 174) → 點 ↓ 箭頭 (按住重複)
//                           → 點 ↑ 箭頭 → 拖曳滑塊 → 點滑塊上方空白 (翻頁) → 點第 2 列 (子選單) → Esc → 右鍵取消 → 重開清單 → 點清單外取消
//                  "yesno"  F4 → 功能 → 儲存檔案 → 第 1 格 → 是/否框 (第 2 層, 開在滑鼠位置): 拖曳標題列到 (60, 43) → 再拖到左上
//                           (放開時 x ≤ 位移、y ≤ 位移 → 位置取滑鼠座標本身 (10, 5)) → 點「否」→ Esc
//                  "popup"  海戰指令選單 (第 1 層彈出選單 1458c, 開在滑鼠位置): 拖曳視窗邊框 → 再拖到左上 (同樣的怪行為 → (3, 2)); 需接 battle_route.js
//                  "walk"   港口走路的滑鼠操作 (S.MICKEY: 移動量 INT 33h fn 0Bh): 移動滑鼠選方向 (> 8 mickey) → 按住左鍵前進 → 換方向 → 放開 → 小幅移動 (≤ 8, 不換方向)
//                           → 點指令按鈕 (情報) → Esc
//                  "sea"    海上航行的滑鼠操作 (21151 / 21008): 點地圖視窗 (3×3 區塊 → 數字鍵 1..9 的航向) → 點舵輪按鈕 (DS:a9d8 0..7) → 點中央 (8)
//                           → 點「情報」按鈕 (9) → Esc; 需接 sea_depart_route.js
"use strict";
(function () {
const S = session;
const mode = S.MOUSE_MODE || "list";
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f4: [0x3e, 0] };
const M = (x, y, b) => ({ mouse: { x, y: y + 40, b } }), I = { mouse: {} };
const D = n => Array(n).fill(K.down), E = K.enter;
const drag = pts => [M(...pts[0], 0), ...pts.map(p => M(...p, 1)), M(...pts[pts.length - 1], 0)];
S.CURSOR_LAG ??= 12;
S.NO_EVENTS = 1;
if (mode === "sea") {
  // 海上時刻的等待迴圈 (6e8c) 每次都查滑鼠, 40 次查詢很快就過去: 按下後要留幾個空動作 (按住), 21151 讀到 0x81 時才算點擊
  const idle = n => Array(n).fill(I), click = (x, y) => [M(x, y, 0), M(x, y, 1), ...idle(3), M(x, y, 0)];
  S.FB_HASH ??= 10;
  S.SEA_KEYS = [...idle(2), ...click(150, 60), ...idle(4),              // 地圖左上區塊 → 航向 7
    ...click(590, 325), ...idle(4),                                      // 舵輪 東 (按鈕 2: x 572..616, y 308..348, 鍵 '6')
    ...click(552, 280), ...idle(3),                                      // 舵輪 北 (按鈕 0: x 532..572, y 256..304, 鍵 '8')
    ...click(630, 110), K.esc, ...idle(3)];                             // 情報 (按鈕 9: x 618..642, y 72..152)
  return;
}
if (mode === "popup") {
  S.BATTLE = "tail";
  S.BATTLE_TAIL = [...drag([[575, 238], [500, 200], [400, 150], [300, 100]]), "i", ...drag([[290, 98], [100, 60], [3, 2]]), "i", "i"];
  return;
}
const poke = [], b = (a, v) => poke.push([a, v]);
if (mode === "list") for (let i = 0; i < 20; i++) b(0x2e57 + i, i < 16 ? i : 0xff);   // 隨身物 16 件 (道具 0..15)
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const KEYS = {
  list: [K.f4, ...D(4), E,
    ...drag([[520, 118], [480, 130], [400, 150], [300, 180]]),   // 標題列 (col+2)×8 ≤ x < 捲軸 + 16, y .. y+16
    ...drag([[408, 365]]),                                       // ↓ 箭頭 (捲軸欄, y ≥ 槽底 + 1)
    ...drag([[408, 205]]),                                       // ↑ 箭頭 (y + 0x18 .. 槽頂 − 1)
    ...drag([[408, 225], [408, 255], [408, 285]]),               // 滑塊
    ...drag([[408, 220]]),                                       // 滑塊上方的槽 (翻一頁)
    ...drag([[300, 238]]),                                       // 第 2 列
    K.esc,
    M(300, 238, 2), M(300, 238, 0),                              // 右鍵
    E, ...drag([[100, 100]]),                                    // 清單外
    K.esc, K.esc],
  yesno: [K.f4, ...D(5), E, K.down, E, M(300, 200, 0), E,
    ...drag([[300, 175], [200, 100], [120, 60], [100, 50]]),
    ...drag([[80, 50], [40, 20], [10, 5]]),
    ...drag([[110, 35]]),
    K.esc, K.esc, K.esc],
  walk: [M(300, 200, 0), I, M(340, 200, 0), I, M(340, 200, 1), I, I, I, I, I, M(340, 160, 1), I, I, I, M(340, 160, 0), I,
    M(344, 158, 0), I, M(344, 158, 1), I, I, M(344, 158, 0), I,
    ...drag([[0x272, 0x70]]), K.esc, I],
};
if (mode === "walk") S.MICKEY = 1;
S.PORT_KEYS = KEYS[mode];
})();
