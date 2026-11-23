// itemshop_route.js — 道具店 (1fd9:a06e = 29dfe) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本道具店入口 (14,47): 視窗 (2,35), 主角 (12,13), 時刻 0x18 (8:00); 商品 = 經濟 +1d.. = 20 / 24 / 3
// S.SHOP_MODE:
//   "buy"   現金 12000: 買進 第 3 項 (武器 3000, 是) → 再選第 3 項 (已有 0x14c) → 第 1 項 否 → 第 1 項 是 ×2 (種類 7 可重複) → 第 2 項 (錢不夠 0xef)
//           → 賣出 第 1 項 否 (random(100) ≤ 運氣 時加價再問) → … → 離開
//   "sell"  現金 599990000, 隨身物 16 (已裝備) / 27 (數值 0) / 44: 賣出 16 (0x14d) → 27 (0x3a1) → 44 (150000, 上限 600000000) → 離開
//   "none"  現金 0: 買進 (0xec) → 賣出 (沒帶東西 0xf3) → 離開
//   "full"  隨身物 20 件: 買進 (0xed) → 離開
//   "night" 塞維爾 (港 1, 入口 (12,43)) 時刻 7 (2:00 夜市): 買進 清單 4 項 → 第 4 項 否 → Esc → 離開
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.SHOP_MODE || "buy";
const money = { buy: 12000, sell: 599990000, none: 0, full: 3000, night: 3000 }[mode];
w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const inv = (L) => L.forEach((v, i) => poke.push([0x2e57 + i, v]));
if (mode === "sell") { inv([16, 27, 44]); poke.push([0x8248 + 16 * 0x14 + 0x13, 0x16]); }
if (mode === "full") inv(Array(20).fill(23));
for (const [a, v] of S.SHOP_POKE || []) poke.push([a, v]);
const D = n => Array(n).fill(K.down);
const BUY = [
  K.enter, ...D(2), K.enter, K.enter,                 // 買進 → 第 3 項 → 是
  ...D(2), K.enter, K.enter,                          // 第 3 項 → 0x14c ▽
  K.enter, K.esc,                                     // 第 1 項 → 否
  K.enter, K.enter, K.enter, K.enter,                 // 第 1 項 → 是 ×2
  K.down, K.enter, K.enter, K.enter,                  // 第 2 項 → 是 → 0xef ▽
  K.esc,                                              // 清單 Esc
  K.down, K.enter, K.enter, K.esc, K.enter, K.enter, K.enter, K.esc, K.esc, K.esc,   // 賣出
  K.esc, K.down];
const SELL = [K.down, K.enter, K.enter, K.enter, K.down, K.enter, K.enter, ...D(2), K.enter, K.enter, K.esc, K.esc, K.down];
const NONE = [K.enter, K.enter, K.down, K.enter, K.enter, K.esc, K.down];
const FULL = [K.enter, K.enter, K.esc, K.down];
const NIGHT = [K.enter, ...D(3), K.enter, K.esc, K.esc, K.esc, K.down];
S.PORT_SETUP = mode === "night" ? { port: 1, vx: 0, vy: 31, hx: 12, hy: 13, time: 7, poke } : { port: 0, vx: 2, vy: 35, hx: 12, hy: 13, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.SHOP_KEYS || { buy: BUY, sell: SELL, none: NONE, full: FULL, night: NIGHT }[mode])];
S.NO_EVENTS = 1;
})();
