// office_route.js — 事務所 (1fd9:d40f = 2d19f) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本事務所入口 (38,35): 視窗 (26,23), 主角 (12,13), 時刻 0x18 (8:00); 工作清單 [0d68] = 0 / 2 / 4
// S.OFFICE_MODE:
//   "main"   現金 150: 工作介紹 → 選第 2 件 (S.NO_EVENTS: 劇本 SNR0 不觸發, 回到清單) → Esc → 各國情報 西班牙 否 (0x57)
//            → 各國情報 葡萄牙 是 (付 100, 國家表 + 0x58/0x355 + 0x59) → 各國情報 義大利 是 (錢不夠 0xa3) → 離開
//   "status" 以 S.TELEPORT 在各次按鍵前改寫工作狀態: [0d62]=3 (國王在找你 0x19a+國籍 / 0x3a4) → 工作中 [0d74]=2 本港 (0x3a3)
//            → 目標港 = 塞維爾 (0x152) → 工作 0x0b 目標港 = FF (random(42) 決定港 → 0x256/0x258 座標/0x259)
//            → 目標港 = 本港、人物 = FF (random 選人物 → 0x254/0x255) → 隨身物已有目標道具 (0x253) → 離開
//   "event"  不關閉劇本 (S.NO_EVENTS = 0), 主角劇本章 [0cd4] = FF (否則約翰一進門就觸發 SNR1 劇情並離開):
//            工作介紹 → 第 1 件 (商品輸送, SNR0 第 0 章第 1 節: 說明 + 是/否) → 接受 ([0d5e] = [0d74] = 2) → 再選工作介紹 (0x152) … → 離開
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.OFFICE_MODE || "main";
const money = mode === "main" ? 150 : 3000; w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
w16(0x0d68, 0); w16(0x0d6a, 2); w16(0x0d6c, 4);
if (mode !== "event") { w16(0x0d6e, 0x1234); w16(0x0d70, 0x55); w16(0x0d72, 7); }
if (mode === "status") poke.push([0x0d62, 3]);
if (mode === "event") poke.push([0x0cd4, 0xff]);
for (const [a, v] of S.OFFICE_POKE || []) poke.push([a, v]);
const D = n => Array(n).fill(K.down), E = n => Array(n).fill(K.enter);
const MAIN = [K.enter, K.down, K.enter, K.esc,
  K.down, K.enter, K.down, K.enter, K.esc, K.enter,           // 各國情報 → 西班牙 → 否 → 0x57 ▽
  K.down, K.enter, K.enter, K.enter, K.enter, K.enter,        // 各國情報 → 葡萄牙 → 是 → 0x58 ▽ → 0x59 ▽
  K.down, K.enter, ...D(4), K.enter, K.enter, K.enter,        // 各國情報 → 義大利 → 是 → 0xa3 ▽
  K.esc, K.down];
const STATUS = [...E(15), K.esc, K.down];
const EVENT = [K.enter, K.enter, ...E(14), K.esc, K.esc, K.esc, K.down];
S.PORT_SETUP = { port: 0, vx: 26, vy: 23, hx: 12, hy: 13, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.OFFICE_KEYS || (mode === "status" ? STATUS : mode === "event" ? EVENT : MAIN))];
if (mode === "status") {
  const B = 11 + 1, tp = {};                                  // 開始新航海 11 鍵 + 走進去 1 鍵; tp[p] = 在第 p 個建築內按鍵之前寫入
  const t16 = (L, a, v) => L.push([a, v & 255], [a + 1, (v >> 8) & 255]);
  tp[2] = []; t16(tp[2], 0x0d62, 0); tp[2].push([0x0d5e, 1]); t16(tp[2], 0x0d74, 2); t16(tp[2], 0x0d88, 0);
  tp[4] = []; t16(tp[4], 0x0d88, 1);
  tp[6] = []; t16(tp[6], 0x0d74, 0x0b); t16(tp[6], 0x0d88, 0xff); t16(tp[6], 0x0d8a, 0xff); t16(tp[6], 0x0d8c, 0x14);
  tp[9] = []; t16(tp[9], 0x0d88, 0); t16(tp[9], 0x0d8a, 0xff); t16(tp[9], 0x0d96, 3);
  tp[12] = [[0x2e57, 0x14]];
  S.TELEPORT = {}; for (const k in tp) S.TELEPORT[B + +k] = tp[k];
} else S.TELEPORT = undefined;
S.NO_EVENTS = mode === "event" ? 0 : 1;
})();
