// supply_route.js — 补给港 (港 100) 码头 命名 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 进港时两边同时写入: 港 100, 一艘船 (同 wharf_route.js); 从码头入口 (62,54) 正下方走进去 → MENU #57 第 3 项「命名」
//   S.SUP_MODE = "ok" (默认): 0x39e 等待 → 暱称键盘输入 1 字 → 决定 → 0x3a0 等待 → (有鼠标: 菜单结束) → 走一步
//   S.SUP_MODE = "cancel": 键盘直接「结束」→ 港名还原 → (返回港名地址 ≠ 0: 菜单结束) → 走一步
//   S.SUP_MODE = "dup": 同 "ok", 但先把港 101 的名字改成将要输入的字 (S.SUP_DUP = [字节...]) → 0x39f
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]); w16(0x5892 + 0x14, 100);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]); w16(M, 0); w16(M + 2, 0); w16(M + 4, 0); w16(M + 6, 0);
const mode = S.SUP_MODE || "ok";
if (mode === "dup") { const R = 0x5f54 + 101 * 0x16 + 4; (S.SUP_DUP || []).concat([0]).forEach((v, i) => poke.push([R + i, v])); }
const NAME = [K.esc, K.enter, K.esc, K.left, K.left, K.down, K.down, K.enter];   // 字表第 1 字 → 决定
const QUIT = [K.left, K.left, K.enter];                                          // 10 → 5 → 0「结束」
S.PORT_SETUP = { port: 100, vx: 50, vy: 43, hx: 12, hy: 12, poke };
S.PORT_KEYS = S.SUP_KEYS || [K.up, K.down, K.down, K.enter, K.enter, ...(mode === "cancel" ? QUIT : NAME), ...(mode === "cancel" ? [] : [K.enter]), K.down];
S.NO_EVENTS = 1;
})();
