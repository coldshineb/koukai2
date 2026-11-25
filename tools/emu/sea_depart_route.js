// sea_depart_route.js — 出海差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本码头 (同 wharf_route 的位置与写入: 现金 3000、一艘船 船 0 水手 10、船型 0、载货量 100、船长 = 主角), 另写入水 300 / 食物 300 (= 30 天)。
// 走进码头 → 出航 → 舰队表 + 天数 0x3d → 是 → 出港 (0fea:e3e5 记录、9348/9401、851f 进入海上) → 之后以空动作截取海上画面
// S.SEA_KEYS 覆写出海后的按键; S.SEA_POKE 额外写入; S.SEA_IDLE 出海后空动作数 (默认 6); S.SEA_TIME 进港时刻
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
S.PORT_SETUP = { port: 0, vx: 42, vy: 56, hx: 12, hy: 12, poke, time: S.SEA_TIME };   // S.SEA_TIME: 进港时刻 (默认不改)
const idle = Array(S.SEA_IDLE ?? 6).fill({ mouse: {} });
S.PORT_KEYS = [K.up, K.enter, K.enter, ...(S.SEA_KEYS || idle)];
S.NO_EVENTS = 1;
S.NO_FLEETS = S.FLEET_AI ? 0 : 1;    // 他舰队 (舰队 AI) 两边都略过; S.FLEET_AI (fleet_route.js) 时两边都运行
})();
