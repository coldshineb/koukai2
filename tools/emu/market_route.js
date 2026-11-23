// market_route.js — 交易所 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 進港時兩邊同時寫入: 現金 S.MARKET_MONEY (預設 3000)、艦隊第 0 格 = 船 0 (水手 10, 船型 0, 載重 100, 船長 = 主角), 船上補給與貨物清空
// S.MARKET_MODE:
//   "lis"  里斯本 (首都, 有許可時免稅): 買進 第 1 項 5 個 → 再買第 1 項: 否 → 殺價 1 (被回絕) → 殺價 最大值 (成交) 3 個
//          → 賣出 2 個 → Esc → 投資 (首都: 不允許) → 物價 分類 0 / 1 → 離開
//   "bar"  巴塞隆納 (非首都, 西班牙): 投資 1000 → 買進 (課稅) 第 2 項 4 個 → 物價 分類 3 → 離開
//   "full" 里斯本, 船已裝滿 (載重 = 已用) → 買進被拒 (0x1b)
// S.MARKET_KEYS 直接指定交易所內的按鍵; S.MARKET_POKE 額外寫入
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], max: [0x35, 0x3f],
  d0: [0x0b, 0x30], d1: [0x02, 0x31], d2: [0x03, 0x32], d3: [0x04, 0x33], d4: [0x05, 0x34], d5: [0x06, 0x35] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.MARKET_MODE || "lis";
const money = S.MARKET_MONEY ?? 3000; w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]); w16(0x5892 + 0x14, mode === "full" ? 1 : 100);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]);
for (let i = 0; i < 0x0c; i++) poke.push([M + i, 0]);
for (let j = 0; j < 5; j++) { poke.push([M + 0x16 + j, 0xff]); w16(M + 0x0c + j * 2, 0); }
if (mode === "full") w16(M + 4, 1);                                       // 資材 1 → 已用 = 載重
for (const [a, v] of S.MARKET_POKE || []) poke.push([a, v]);
S.PORT_SETUP = mode === "bar" ? { port: 3, vx: 44, vy: 38, hx: 12, hy: 12, poke } : { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down);
const LIS = [
  K.enter, K.enter,                                   // 買進 → 0x2fa/0x2fb ▽
  K.enter, K.enter, K.enter,                          // 清單第 1 項 → 船員評價 ▽ → 0x96 是
  K.enter, K.d5, K.enter,                             // 選船 → 5 個
  K.enter, K.enter, K.esc,                            // 再選第 1 項 → ▽ → 0x96 否 → 殺價
  K.d1, K.enter, K.enter,                             // 出價 1 → 0x0c ▽
  K.max, K.enter, K.enter,                            // 出價 最大值 → 0x0a ▽
  K.enter, K.d3, K.enter,                             // 選船 → 3 個
  K.esc,                                              // 清單 Esc
  K.down, K.enter, K.enter, K.enter, K.d2, K.enter,   // 賣出 → 選船 → 第 1 項 → 2 個
  K.esc, K.esc,                                       // 貨物清單 Esc → 船清單 Esc
  ...D(2), K.enter, K.enter,                          // 投資 → 0x02 ▽
  ...D(3), K.enter, K.enter, K.down, K.enter, K.esc,  // 物價 → 分類 0 → 分類 1 → Esc
  K.esc, K.down];
const BAR = [
  ...D(2), K.enter, K.d1, K.d0, K.d0, K.d0, K.enter, K.enter,   // 投資 1000 → 0x0f ▽
  K.enter, K.enter,                                   // 買進 → 0x2fb ▽
  K.down, K.enter, K.enter, K.enter,                  // 第 2 項 → ▽ → 是
  K.enter, K.d4, K.enter, K.esc,                      // 選船 → 4 個 → 清單 Esc
  ...D(3), K.enter, ...D(3), K.enter, K.esc,          // 物價 分類 3
  K.esc, K.down];
const FULL = [K.enter, K.enter, K.esc, K.down];
S.PORT_KEYS = [K.up, ...(S.MARKET_KEYS || (mode === "bar" ? BAR : mode === "full" ? FULL : LIS))];
S.NO_EVENTS = 1;
})();
