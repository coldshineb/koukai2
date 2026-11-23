// tavern_route2.js — 酒館: 飲酒敘話 + 與航海者閒聊 的差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 進港時兩邊同時寫入現金 3000 與一艘船 (同 tavern_route.js); 走進里斯本酒館後:
//   飲酒敘話: 計算機輸入 3 杯 → 傳聞 (每個等待都按 Enter)
//   與航海者閒聊: 清單選第 1 人 → 自我介紹 → 請客喝酒 → 航海者情報 → 僱用 → 離開
// S.TAVERN2_DRINKS 可改杯數 (會改變傳聞的分支)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], d1: [0x02, 0x31], d3: [0x04, 0x33], d5: [0x06, 0x35], d9: [0x0a, 0x39] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]);
// S.TAVERN2_MATES = [人物編號...]: 把這些人物放進里斯本酒館 (+2d = 0, +31 bit5, +2f bit4), 其餘欄位維持新遊戲初值
if (S.TAVERN2_MATES) {
  const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
  for (const n of S.TAVERN2_MATES) { const P = 0x12b6 + n * 0x32; poke.push([P + 0x2d, 0], [P + 0x31, at(P + 0x31) | 0x20], [P + 0x2f, at(P + 0x2f) | 0x10]); }
}
for (const [a, v] of S.TAVERN2_POKE || []) poke.push([a, v]);        // 額外寫入 (例: 好感 +2b)
S.PORT_SETUP = { port: 0, vx: 42, vy: 24, hx: 12, hy: 11, poke };
const E = n => Array(n).fill(K.enter);
const cups = S.TAVERN2_DRINKS || [K.d3];
S.PORT_KEYS = S.TAVERN2_KEYS || [K.up, K.enter,
  K.down, K.down, K.enter, ...cups, K.enter, ...E(3),                // 飲酒敘話 (3 杯: 路人 0x24 → 港口位置 → 特產)
  K.down, K.down, K.down, K.enter, K.enter, ...E(2),                 // 與航海者閒聊 → 清單選第 1 人 → 介紹 2 次等待
  K.enter, K.enter,                                                  // 請客喝酒
  K.down, K.enter, K.enter,                                          // 航海者情報
  K.down, K.down, K.enter, ...E(3),                                  // 僱用
  K.esc, K.esc, K.esc, K.esc, K.down];
S.NO_EVENTS = 1;
})();
