// tavern_route.js — 酒館差分測試的設定: 先執行本檔, 再執行 port_tests.js
// 新遊戲時主角沒有船也沒有錢 (開場劇本事件尚未移植), 所以在進港時兩邊同時寫入: 現金 3000、艦隊第 0 格 = 船 0 (水手 10, 船型 0)、
// 船員配置 (船長 = 主角, 比例 30/20, 士氣 50)。主角放在里斯本酒館入口 (54,34) 正下方, 往上走進入。
// 路線: 女郎問候 → 水手僱用 (0x1f 警告、是、0x21、0x7a、計算機 15 名) → 船隻清單選第 1 艘 → 船隻資料 + 計算機 19 名 → Esc → 退款「是」
//       → 水手解僱 → 選船 → 0x359 計算機 15 名 → 0x35a「是」→ Esc → 離開酒館 → 走一步
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], d1: [0x02, 0x31], d5: [0x06, 0x35], d9: [0x0a, 0x39] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 24, hx: 12, hy: 11, poke };
S.PORT_KEYS = [K.up, K.enter, K.enter, K.enter, K.enter, K.enter, K.enter, K.d1, K.d5, K.enter,
  K.enter, K.d1, K.d9, K.enter, K.enter, K.esc, K.enter,
  K.down, K.enter, K.enter, K.d1, K.d5, K.enter, K.enter, K.esc, K.esc, K.down];
S.NO_EVENTS = 1;
})();
