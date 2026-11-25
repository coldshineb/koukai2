// inn_route.js — 旅馆 与航海者闲聊 / 占卜师 朋友运 差分测试设置 (先运行本档, 再运行 port_tests.js)
// S.INN_MODE:
//   "chat"   里斯本旅馆 (36,46): 人物 8 (第 3 舰队船长) 与人物 12 (无所属) 放在里斯本 (+2d = 0, +2f bit4 清除)
//            闲聊 → 人物 8: 0x48 ▽ → 0x49 → 航海者情报 ▽ → 人物 12: 0x48 ▽ → 0x4b → 雇用 (不要求好感) → … → Esc → 离开
//   "none"   里斯本旅馆, 没有人 (0x43)
//   "friend" 塞维尔占卜师 (79,56), 时刻 0x34 (傍晚): 船员 8 (运气 86, 忠诚 10) / 9 (第 1 号舰船长, 忠诚 60) → 朋友运 两次
// S.INN_KEYS 直接指定建筑内的按键; S.INN_POKE 额外写入
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.INN_MODE || "chat";
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]);
const person = (n, f) => { const P = 0x12b6 + n * 0x32; for (const [o, v] of f) poke.push([P + o, v]); };
if (mode === "chat") {
  person(8, [[0x2d, 0], [0x2f, at(0x12b6 + 8 * 0x32 + 0x2f) & ~0x10], [0x31, at(0x12b6 + 8 * 0x32 + 0x31) | 0x20]]);
  person(12, [[0x2c, 0xff], [0x2d, 0], [0x2e, 0], [0x2f, at(0x12b6 + 12 * 0x32 + 0x2f) & ~0x10], [0x31, at(0x12b6 + 12 * 0x32 + 0x31) | 0x20]]);
}
if (mode === "friend") {
  poke.push([0x2e1b, 8], [0x2e1c, 9]);
  person(8, [[0x23, 86], [0x2b, 10], [0x2e, 3]]); person(9, [[0x23, 30], [0x2b, 60]]);
  const S1 = SL + 9; w16(S1, 5); poke.push([S1 + 7, 1], [S1 + 8, 0x10]); poke.push([M + 0x1e + 0x1b, 9]);
}
for (const [a, v] of S.INN_POKE || []) poke.push([a, v]);
S.PORT_SETUP = mode === "friend" ? { port: 1, vx: 67, vy: 45, hx: 12, hy: 12, time: 0x34, poke } : { port: 0, vx: 24, vy: 35, hx: 12, hy: 12, poke };
const E = n => Array(n).fill(K.enter), D = n => Array(n).fill(K.down);
const CHAT = [K.enter,                                   // 与航海者闲聊 → 清单
  K.enter, K.enter, K.enter, K.enter,                    // 人物 8 → 0x48 ▽ → 航海者情报 → ▽
  K.down, K.enter, K.enter, K.down, K.enter, ...E(6),    // 人物 12 → 0x48 ▽ → 雇用 → (0x30 ▽ / 交涉 …)
  K.esc, K.esc, K.esc, K.esc];
const NONE = [K.enter, K.enter, K.esc, K.esc];
const FRIEND = [...D(3), K.enter, K.enter, K.enter, K.enter,   // 朋友运 → 是 → 0x12d ▽ → 0x318 ▽
  K.enter, K.enter, K.enter,                             // 船员 8 → 运气 ▽ → 忠诚 ▽
  ...D(3), K.enter, K.enter, K.enter, K.enter,           // 再一次
  K.down, K.enter, K.enter, K.enter,                     // 船员 9 (船长, 显示船名)
  K.esc];
S.PORT_KEYS = [K.up, ...(S.INN_KEYS || (mode === "friend" ? FRIEND : mode === "none" ? NONE : CHAT)), K.down];
S.NO_EVENTS = 1;
})();
