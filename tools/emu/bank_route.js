// bank_route.js — 銀行 (1fd9:9511 = 292a1) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本銀行入口 (31,59): 視窗 (19,47), 主角 (12,13), 時刻 0x18 (8:00)。進港時兩邊同時寫入現金 S.BANK_MONEY (預設 3000)
// S.BANK_MODE:
//   "main"  存款 (沒存過 0x68) 1000 → 提款 350 → 貸款 (有餘額 0x6f) → 還款 (沒借 0x76) → 提款 全部 (?) → 貸款 全部 1000 (餘額 −1000: 存成 (−11, 100))
//           → 再貸 (信用不足 0x71) → 還款 300 → 存款 (先還款 0x66) → 離開 (0xa4)
//   "poor"  現金 500: 存款 (船員 0x64) → 提款 (0x68) → 貸款 (爵位 0: 額度 1000) 0 (直接返回) → 離開
//   "venice" 威尼斯本行 (港 13, 入口 (66,74)) 問候 0x61, 現金 2000000: 貸款 (錢夠多 0x70 仍可借) 1 → 還款 最大 → 離開
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], max: [0x35, 0x3f],
  d0: [0x0b, 0x30], d1: [0x02, 0x31], d3: [0x04, 0x33], d5: [0x06, 0x35] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.BANK_MODE || "main";
const money = S.BANK_MONEY ?? (mode === "poor" ? 500 : mode === "venice" ? 2000000 : 3000);
w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
for (const [a, v] of S.BANK_POKE || []) poke.push([a, v]);
const D = n => Array(n).fill(K.down), E = n => Array(n).fill(K.enter);
const MAIN = [
  K.enter, K.enter, K.d1, K.d0, K.d0, K.d0, K.enter, K.enter, K.enter,      // 存款: 0x68 ▽ → 1000 → 0x6a ▽ → 0x67 ▽
  K.down, K.enter, K.enter, K.d3, K.d5, K.d0, K.enter, K.enter, K.enter,    // 提款: 0x67 ▽ → 350 → 0x6e ▽ → 0x67 ▽
  ...D(2), K.enter, K.enter,                                                // 貸款: 0x6f ▽
  ...D(3), K.enter, K.enter,                                                // 還款: 0x76 ▽
  K.down, K.enter, K.enter, K.max, K.enter, K.enter, K.enter,               // 提款 全部 650
  ...D(2), K.enter, K.enter, K.max, K.enter, K.enter, K.enter,              // 貸款: 0x72 ▽ → 1000 → 0x74 ▽ → 0x75 ▽
  ...D(2), K.enter, K.enter,                                                // 貸款: 0x71 ▽
  ...D(3), K.enter, K.enter, K.d3, K.d0, K.d0, K.enter, K.enter, K.enter,   // 還款: 0x95 ▽ → 300 → 0x78 ▽ → 0x75 ▽
  K.enter, K.enter,                                                         // 存款: 0x66 ▽
  K.esc, K.enter, K.down];
const POOR = [K.enter, K.enter, K.down, K.enter, K.enter, ...D(2), K.enter, K.enter, K.enter, K.esc, K.enter, K.down];
const VENICE = [...D(2), K.enter, K.enter, K.enter, K.d1, K.enter, K.enter, K.enter,   // 貸款: 0x70 ▽ → 0x72 ▽ → 1 → 0x74 ▽ → 0x75 ▽
  ...D(3), K.enter, K.enter, K.max, K.enter, K.enter, K.enter, K.esc, K.enter, K.down];
S.PORT_SETUP = mode === "venice" ? { port: 13, vx: 54, vy: 62, hx: 12, hy: 13, time: 0x18, poke } : { port: 0, vx: 19, vy: 47, hx: 12, hy: 13, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.BANK_KEYS || (mode === "poor" ? POOR : mode === "venice" ? VENICE : MAIN))];
S.NO_EVENTS = 1;
})();
