// storm_route.js — 海上暴風雨的差分測試設定 (RE_NOTES 35.6): 依序執行 本檔 → sea_depart_route.js → port_tests.js
// 出港前兩邊同時寫入 [0cb3] (暴風雨): S.STORM_MODE "run" = 81 (進行中), "start" = 41 (剛開始: 19f48 先由船員報告, 2103 + GRAPH #0x3a)。
//   進港時 (PORT_SETUP) 寫入沒有用: 港內的 1a0c0 會把天候清掉, 所以在進港後第一鍵 (往碼頭走) 送出時寫入 (S.TELEPORT)。
// 851f 出海時 9768(DS:0c5a) + 9804(0x30) 持續音; 之後空動作與 Enter 交錯 (船員報告 / 損傷訊息的 ▽), 暴風雨結束時 19e33 9888。
// 效果音呼叫兩邊依序比對 (port_tests.js S.SFX_LOG)。S.STORM_N = 輪數 (預設 40)
"use strict";
(function () {
const S = session;
const E = [0x1c, 0x0d], idle = n => Array(n).fill({ mouse: {} });
S.TELEPORT = { [(S.NEWGAME || []).length || 11]: [[0x0cb3, S.STORM_MODE === "start" ? 0x41 : 0x81], ...(S.STORM_POKE || [])] };
S.SEA_KEYS = [...idle(2), ...Array.from({ length: S.STORM_N ?? 40 }, () => [...idle(3), E]).flat()];
S.SFX_LOG ??= 1;
})();
