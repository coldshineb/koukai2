// enter_route.js — 进入建筑时的声望检查 (1b6ba → 1b5c1 入场被拒 / 909b 声望警告) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本道具店 (k = 9, 受检查) 入口 (14,47): 窗口 (2,35), 主角 (12,13), 时刻 0x18; 主角对葡萄牙声望 = S.ENTER_FAME (默认 0x10)
// random(3) = 0 且 random(100) > 声望 + 20 → 1b5c1 (船员 0x347 → 0x348 → 被包围: +21 + +25×+21/100 ≥ random(150) 逃脱 0x34a/0x34b, 否则 0x349/0x34d 没收 3/4 现金且声望 +20)
// 否则 909b 船员 0x346 后照常进店。路线重复「进店 → 按键 → 出店」S.ENTER_TIMES 次 (默认 8), 每次的分支由随机数决定, 事后以状态与拼图确认
// S.ENTER_H21 = 主角 +21 (默认不改; 0 = 必定被抓, 200 = 必定逃脱)
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
