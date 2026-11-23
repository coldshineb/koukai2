// sea_depart_route.js — 出海差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本碼頭 (同 wharf_route 的位置與寫入: 現金 3000、一艘船 船 0 水手 10、船型 0、載貨量 100、船長 = 主角), 另寫入水 300 / 食物 300 (= 30 天)。
// 走進碼頭 → 出航 → 艦隊表 + 天數 0x3d → 是 → 出港 (0fea:e3e5 記錄、9348/9401、851f 進入海上) → 之後以空動作截取海上畫面
// S.SEA_KEYS 覆寫出海後的按鍵; S.SEA_POKE 額外寫入; S.SEA_IDLE 出海後空動作數 (預設 6); S.SEA_TIME 進港時刻
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]); w16(0x5892 + 0x14, 100);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]); w16(M, 300); w16(M + 2, 300); w16(M + 4, 0); w16(M + 6, 0);
for (const [a, v] of S.SEA_POKE || []) poke.push([a, v]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 56, hx: 12, hy: 12, poke, time: S.SEA_TIME };   // S.SEA_TIME: 進港時刻 (預設不改)
const idle = Array(S.SEA_IDLE ?? 6).fill({ mouse: {} });
S.PORT_KEYS = [K.up, K.enter, K.enter, ...(S.SEA_KEYS || idle)];
S.NO_EVENTS = 1;
S.NO_FLEETS = 1;                     // 他艦隊 (艦隊 AI) 兩邊都略過
})();
