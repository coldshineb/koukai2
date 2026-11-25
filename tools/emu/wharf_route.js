// wharf_route.js — 码头差分测试设置 (先运行本档, 再运行 port_tests.js)
// 进港时两边同时写入现金 3000、一艘船 (船 0: 水手 10, 船型 0, 载货量 100, 船长 = 主角)、水/食物 0; 关闭剧本事件 (码头老板开场对白)。
// 从码头入口 (54,67) 正下方走进去:
//   补给: 水 装上 5 → 食物 装上 3 → ↓ 切换成卸下 → 水 卸下 2 → Esc
//   出航: 舰队表 → 天数消息 (3 天, 0x3c) → 是/否 按 Esc (否) → 回到码头菜单 → Esc 离开 → 走一步
// S.WHARF_KEYS 可覆写码头内的按键; S.WHARF_POKE 额外写入
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], d2: [0x03, 0x32], d3: [0x04, 0x33], d5: [0x06, 0x35] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]); w16(0x5892 + 0x14, 100);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]); w16(M, 0); w16(M + 2, 0); w16(M + 4, 0); w16(M + 6, 0);
for (const [a, v] of S.WHARF_POKE || []) poke.push([a, v]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 56, hx: 12, hy: 12, poke };
S.PORT_KEYS = [K.up, ...(S.WHARF_KEYS || [
  K.down, K.enter,                              // 补给
  K.enter, K.d5, K.enter,                       // 水 装上 5
  K.right, K.enter, K.d3, K.enter,              // 食物 装上 3
  K.down, K.enter,                              // 切换成卸下
  K.enter, K.d2, K.enter,                       // 水 卸下 2
  K.esc,                                        // 离开补给 → 码头菜单
  K.enter, K.esc,                               // 出航 → 是/否: 否
  K.esc]), K.down];
S.NO_EVENTS = 1;
})();
