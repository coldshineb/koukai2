// enter_route.js — 進入建築時的聲望檢查 (1b6ba → 1b5c1 入場被拒 / 909b 聲望警告) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本道具店 (k = 9, 受檢查) 入口 (14,47): 視窗 (2,35), 主角 (12,13), 時刻 0x18; 主角對葡萄牙聲望 = S.ENTER_FAME (預設 0x10)
// random(3) = 0 且 random(100) > 聲望 + 20 → 1b5c1 (船員 0x347 → 0x348 → 被包圍: +21 + +25×+21/100 ≥ random(150) 逃脫 0x34a/0x34b, 否則 0x349/0x34d 沒收 3/4 現金且聲望 +20)
// 否則 909b 船員 0x346 後照常進店。路線重複「進店 → 按鍵 → 出店」S.ENTER_TIMES 次 (預設 8), 每次的分支由亂數決定, 事後以狀態與拼圖確認
// S.ENTER_H21 = 主角 +21 (預設不改; 0 = 必定被抓, 200 = 必定逃脫)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 10000); w16(0x12b0, 0);
poke.push([0x125a + 6, S.ENTER_FAME ?? 0x10]);
if (S.ENTER_H21 !== undefined) poke.push([0x12b6 + 0x21, S.ENTER_H21]);
const E = K.enter, X = K.esc, D = K.down, U = K.up;
const ONE = [U, E, E, E, E, X, X, E, D];
S.PORT_SETUP = { port: 0, vx: 2, vy: 35, hx: 12, hy: 13, time: 0x18, poke };
S.PORT_KEYS = S.ENTER_KEYS || [].concat(...Array(S.ENTER_TIMES || 8).fill(ONE));
S.TELEPORT = undefined;
S.NO_EVENTS = 1;
})();
