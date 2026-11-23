// fleet_route.js — 月末 / 年末結算與艦隊 AI 的差分測試設定 (docs/RE_NOTES.md 第 29 節)
// S.FLEET_MODE:
//   "month"   里斯本旅館 (門口同 inn_route): 3 月 31 日 ([0cab] = 2、[0cac] = 30) 時刻 0x20 進港 → 就寢 3 次
//             (第 1 晚跨月: 月末 18ff5 含換季 178a8、之後每晚 70 支艦隊各跑一次 1ac19) → 走兩步
//   "year"    同上但 12 月 31 日: 月末 + 年末 16126 → 再就寢 1 次
//   "seamonth" 由 sea_depart_route 出港 (3 月 31 日時刻 0x3a 進港), 船員 8 (薪水 5) → 海上跨月 (薪水訊息 0x23e) → 繼續航行
//   "launch"  同 "month", 另寫入: 艦隊 2 不在海上 (+29 = 0) 且有 5 艘船 (範本 0x28)、人物 110..119 的記錄釋放 (+31 = 0)
//             → 月末 1897e / 18824 / 18772 派提督出港、18aee / 185a7 產生新人物 (NAME.TBL)
// 執行順序: 本檔 → (seamonth 時) sea_depart_route.js → port_tests.js。都會設 S.FLEET_AI = 1 (兩邊都執行艦隊 AI)。
// S.FLEET_SLEEPS 覆寫就寢次數; S.FLEET_POKE 額外寫入
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const mode = S.FLEET_MODE || "month";
const poke = [], b = (a, v) => poke.push([a, v]);
const idle = n => Array(n).fill({ mouse: {} });
S.FLEET_AI = 1;
if (mode === "launch") {
  const F2 = 0x2e76 + 0x85 * 2; b(F2 + 0x29, 0);
  for (let j = 0; j < 10; j++) { const S2 = F2 + 0x2b + 9 * j; b(S2 + 8, j < 5 ? 0x10 : 0); b(S2 + 7, 0x28); b(S2 + 2, 10); b(S2 + 3, 10); }
  for (let p = 110; p < 120; p++) b(0x12b6 + 0x32 * p + 0x31, 0);
}
if (mode === "month" || mode === "year" || mode === "launch") {
  b(0x0cab, mode === "year" ? 11 : 2); b(0x0cac, 30);
  for (const [a, v] of S.FLEET_POKE || []) b(a, v);
  const SLEEP = [K.up, K.up, K.enter];                                // 進旅館 → 選單往上繞到「就寢」→ Enter
  const n = S.FLEET_SLEEPS ?? (mode === "year" ? 2 : 3);
  S.PORT_SETUP = { port: 0, vx: 24, vy: 35, hx: 12, hy: 12, time: 0x20, poke };
  S.PORT_KEYS = [...Array.from({ length: n }, () => SLEEP).flat(), K.down, K.down];
  S.NO_EVENTS = 1;
} else if (mode === "seamonth") {
  b(0x0cab, 2); b(0x0cac, 30);
  b(0x2e1b, 8); b(0x2e39, 5); for (let i = 1; i < 30; i++) b(0x2e1b + i, 0xff);   // 船員 8, 薪水 5 (× 10 = 50 金)
  const P8 = 0x12b6 + 8 * 0x32; b(P8 + 0x2c, 0); b(P8 + 0x2d, 0xff); b(P8 + 0x2e, 2);
  for (const [a, v] of S.FLEET_POKE || []) b(a, v);
  S.SEA_POKE = poke; S.SEA_TIME = 0x3a;
  S.SEA_KEYS = S.FLEET_KEYS || [...idle(60), K.enter, K.enter, ...idle(40)];
}
})();
