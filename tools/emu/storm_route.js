// storm_route.js — 海上暴风雨的差分测试设置 (RE_NOTES 35.6): 依序运行 本档 → sea_depart_route.js → port_tests.js
// 出港前两边同时写入 [0cb3] (暴风雨): S.STORM_MODE "run" = 81 (进行中), "start" = 41 (刚开始: 19f48 先由船员报告, 2103 + GRAPH #0x3a)。
//   进港时 (PORT_SETUP) 写入没有用: 港内的 1a0c0 会把天候清掉, 所以在进港后第一键 (往码头走) 送出时写入 (S.TELEPORT)。
// 851f 出海时 9768(DS:0c5a) + 9804(0x30) 持续音; 之后空动作与 Enter 交错 (船员报告 / 损伤消息的 ▽), 暴风雨结束时 19e33 9888。
// 效果音调用两边依序比对 (port_tests.js S.SFX_LOG)。S.STORM_N = 轮数 (默认 40)
"use strict";
(function () {
const S = session;
const E = [0x1c, 0x0d], idle = n => Array(n).fill({ mouse: {} });
S.TELEPORT = { [(S.NEWGAME || []).length || 11]: [[0x0cb3, S.STORM_MODE === "start" ? 0x41 : 0x81], ...(S.STORM_POKE || [])] };
S.SEA_KEYS = [...idle(2), ...Array.from({ length: S.STORM_N ?? 40 }, () => [...idle(3), E]).flat()];
S.SFX_LOG ??= 1;
})();
