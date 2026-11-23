// wharf_route.js — 碼頭差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 進港時兩邊同時寫入現金 3000、一艘船 (船 0: 水手 10, 船型 0, 載貨量 100, 船長 = 主角)、水/食物 0; 關閉劇本事件 (碼頭老闆開場對白)。
// 從碼頭入口 (54,67) 正下方走進去:
//   補給: 水 裝上 5 → 食物 裝上 3 → ↓ 切換成卸下 → 水 卸下 2 → Esc
//   出航: 艦隊表 → 天數訊息 (3 天, 0x3c) → 是/否 按 Esc (否) → 回到碼頭選單 → Esc 離開 → 走一步
// S.WHARF_KEYS 可覆寫碼頭內的按鍵; S.WHARF_POKE 額外寫入
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], d2: [0x03, 0x32], d3: [0x04, 0x33], d5: [0x06, 0x35] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]); w16(0x5892 + 0x14, 100);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]); w16(M, 0); w16(M + 2, 0); w16(M + 4, 0); w16(M + 6, 0);
for (const [a, v] of S.WHARF_POKE || []) poke.push([a, v]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 56, hx: 12, hy: 12, poke };
S.PORT_KEYS = [K.up, ...(S.WHARF_KEYS || [
  K.down, K.enter,                              // 補給
  K.enter, K.d5, K.enter,                       // 水 裝上 5
  K.right, K.enter, K.d3, K.enter,              // 食物 裝上 3
  K.down, K.enter,                              // 切換成卸下
  K.enter, K.d2, K.enter,                       // 水 卸下 2
  K.esc,                                        // 離開補給 → 碼頭選單
  K.enter, K.esc,                               // 出航 → 是/否: 否
  K.esc]), K.down];
S.NO_EVENTS = 1;
})();
