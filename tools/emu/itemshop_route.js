// itemshop_route.js — 道具店 (1fd9:a06e = 29dfe) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本道具店入口 (14,47): 窗口 (2,35), 主角 (12,13), 时刻 0x18 (8:00); 商品 = 经济 +1d.. = 20 / 24 / 3
// S.SHOP_MODE:
//   "buy"   现金 12000: 买进 第 3 项 (武器 3000, 是) → 再选第 3 项 (已有 0x14c) → 第 1 项 否 → 第 1 项 是 ×2 (种类 7 可重复) → 第 2 项 (钱不够 0xef)
//           → 卖出 第 1 项 否 (random(100) ≤ 运气 时加价再问) → … → 离开
//   "sell"  现金 599990000, 随身物 16 (已装备) / 27 (数值 0) / 44: 卖出 16 (0x14d) → 27 (0x3a1) → 44 (150000, 上限 600000000) → 离开
//   "none"  现金 0: 买进 (0xec) → 卖出 (没带东西 0xf3) → 离开
//   "full"  随身物 20 件: 买进 (0xed) → 离开
//   "night" 塞维尔 (港 1, 入口 (12,43)) 时刻 7 (2:00 夜市): 买进 清单 4 项 → 第 4 项 否 → Esc → 离开
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.SHOP_MODE || "buy";
const money = { buy: 12000, sell: 599990000, none: 0, full: 3000, night: 3000 }[mode];
w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const inv = (L) => L.forEach((v, i) => poke.push([0x2e57 + i, v]));
if (mode === "sell") { inv([16, 27, 44]); poke.push([0x8248 + 16 * 0x14 + 0x13, 0x16]); }
if (mode === "full") inv(Array(20).fill(23));
for (const [a, v] of S.SHOP_POKE || []) poke.push([a, v]);
const D = n => Array(n).fill(K.down);
const BUY = [
  K.enter, ...D(2), K.enter, K.enter,                 // 买进 → 第 3 项 → 是
  ...D(2), K.enter, K.enter,                          // 第 3 项 → 0x14c ▽
  K.enter, K.esc,                                     // 第 1 项 → 否
  K.enter, K.enter, K.enter, K.enter,                 // 第 1 项 → 是 ×2
  K.down, K.enter, K.enter, K.enter,                  // 第 2 项 → 是 → 0xef ▽
  K.esc,                                              // 清单 Esc
  K.down, K.enter, K.enter, K.esc, K.enter, K.enter, K.enter, K.esc, K.esc, K.esc,   // 卖出
  K.esc, K.down];
const SELL = [K.down, K.enter, K.enter, K.enter, K.down, K.enter, K.enter, ...D(2), K.enter, K.enter, K.esc, K.esc, K.down];
const NONE = [K.enter, K.enter, K.down, K.enter, K.enter, K.esc, K.down];
const FULL = [K.enter, K.enter, K.esc, K.down];
const NIGHT = [K.enter, ...D(3), K.enter, K.esc, K.esc, K.esc, K.down];
S.PORT_SETUP = mode === "night" ? { port: 1, vx: 0, vy: 31, hx: 12, hy: 13, time: 7, poke } : { port: 0, vx: 2, vy: 35, hx: 12, hy: 13, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.SHOP_KEYS || { buy: BUY, sell: SELL, none: NONE, full: FULL, night: NIGHT }[mode])];
S.NO_EVENTS = 1;
})();
