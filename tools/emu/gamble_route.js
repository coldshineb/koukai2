// gamble_route.js — 酒馆 赌博 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 进港时两边同时写入现金 S.GAMBLE_MONEY (默认 3000) 与酒吧女郎 0 (让酒馆菜单 6 项都可选), 走进里斯本酒馆 → 赌博
// S.GAMBLE_MODE: "bj"   二十一点: 玩 → 赌 50 → 发牌 → 停牌 → 再一局 (赌 25, 停牌) → 不玩了
//                "dice" 骰子: 玩 → 赌 30 → (抬价) → 掷骰 / 换骰 → 不再玩; 之后再玩一局二十一点 (检查图形缓冲区)
//                "poor" 现金 0 → 「没钱怎么赌」
// S.GAMBLE_KEYS 可直接指定赌博内的按键
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  d0: [0x0b, 0x30], d1: [0x02, 0x31], d2: [0x03, 0x32], d3: [0x04, 0x33], d5: [0x06, 0x35] };
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.GAMBLE_MODE || "bj", money = mode === "poor" ? 0 : (S.GAMBLE_MONEY ?? 3000);
w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const G = 0x2bde;
poke.push([G + 0x0e, 0], [G + 0x0f, 50], [G + 0x12, (at(G + 0x12) & 0x81 & ~0x40) | 0x08], [G + 0x10, 0xff], [G + 0x11, 0xff]);
for (const [a, v] of S.GAMBLE_POKE || []) poke.push([a, v]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 24, hx: 12, hy: 11, poke };
const E = n => Array(n).fill(K.enter), D = n => Array(n).fill(K.down);
const head = [K.up, K.enter, ...D(5), K.enter];                          // 进酒馆 → 赌博
const BJ = [K.enter, K.enter,                                            // 二十一点 → 玩
  K.d5, K.d0, K.enter,                                                   // 赌 50
  K.enter, K.down, K.enter,                                              // 发牌 → 停牌 (若已爆牌, 多的键由 ▽ 等待吃掉)
  K.enter, K.enter, K.enter,                                             // 结算 ▽ → 再一局: 是
  K.d2, K.d5, K.enter, K.down, K.enter, K.enter, K.enter,                // 赌 25 → 停牌 → ▽
  K.esc, K.enter];                                                       // 再一局: 否 → (输赢消息 ▽)
const DICE = [K.down, K.enter, K.enter, K.enter,                         // 骰子 → 玩 → ▽
  K.d3, K.d0, K.enter,                                                   // 赌 30
  K.esc, K.enter,                                                        // 抬价 (30→45): 否 → 0fea:3359 按键
  K.esc, K.enter, K.right, K.enter, K.esc,                               // 满意吗: 否 → 换第 1 / 2 颗 → Esc (触发 [标志+0x1fe])
  K.enter, K.enter, K.esc];                                              // 第二次: 是 → 判定 ▽ → 再玩: 否
const BJ2 = [K.enter, K.enter, K.d5, K.d0, K.enter, K.down, K.enter, K.enter, K.esc];   // 再玩一局二十一点 (黑桃牌图)
S.PORT_KEYS = S.GAMBLE_KEYS ? [...head, ...S.GAMBLE_KEYS]
  : mode === "poor" ? [...head, K.enter, K.esc, K.down]
  : mode === "dice" ? [...head, ...DICE, ...BJ2, K.esc, K.esc, K.down]
  : [...head, ...BJ, K.esc, K.esc, K.down];
S.NO_EVENTS = 1;
})();
