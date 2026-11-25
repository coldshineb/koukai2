// tavern_route.js — 酒馆差分测试的设置: 先运行本档, 再运行 port_tests.js
// 新游戏时主角没有船也没有钱 (开场剧本事件尚未移植), 所以在进港时两边同时写入: 现金 3000、舰队第 0 格 = 船 0 (水手 10, 船型 0)、
// 船员配置 (船长 = 主角, 比例 30/20, 士气 50)。主角放在里斯本酒馆入口 (54,34) 正下方, 往上走进入。
// 路线: 女郎问候 → 水手雇用 (0x1f 警告、是、0x21、0x7a、计算机 15 名) → 船只清单选第 1 艘 → 船只数据 + 计算机 19 名 → Esc → 退款「是」
//       → 水手解雇 → 选船 → 0x359 计算机 15 名 → 0x35a「是」→ Esc → 离开酒馆 → 走一步
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], d1: [0x02, 0x31], d5: [0x06, 0x35], d9: [0x0a, 0x39] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
w16(0x12ae, 3000); w16(0x12b0, 0);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 24, hx: 12, hy: 11, poke };
S.PORT_KEYS = [K.up, K.enter, K.enter, K.enter, K.enter, K.enter, K.enter, K.d1, K.d5, K.enter,
  K.enter, K.d1, K.d9, K.enter, K.enter, K.esc, K.enter,
  K.down, K.enter, K.enter, K.d1, K.d5, K.enter, K.enter, K.esc, K.esc, K.down];
S.NO_EVENTS = 1;
})();
