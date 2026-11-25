// market_route.js — 交易所 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 进港时两边同时写入: 现金 S.MARKET_MONEY (默认 3000)、舰队第 0 格 = 船 0 (水手 10, 船型 0, 载重 100, 船长 = 主角), 船上补给与货物清空
// S.MARKET_MODE:
//   "lis"  里斯本 (首都, 有许可时免税): 买进 第 1 项 5 个 → 再买第 1 项: 否 → 杀价 1 (被回绝) → 杀价 最大值 (成交) 3 个
//          → 卖出 2 个 → Esc → 投资 (首都: 不允许) → 物价 分类 0 / 1 → 离开
//   "bar"  巴塞隆纳 (非首都, 西班牙): 投资 1000 → 买进 (课税) 第 2 项 4 个 → 物价 分类 3 → 离开
//   "full" 里斯本, 船已装满 (载重 = 已用) → 买进被拒 (0x1b)
//   "big"  里斯本, 现金 60000: 物价 (食品) → 买进第 1 项 最大值 100 个 → 物价 (食品) → 卖出 最大值 → 物价 (食品)
//          (交易额够大, 供给 (= 物价水准) 才会变动: 该分类 + 金额 / (商业值 + 500), 全分类 + 金额 / 1000)
// S.MARKET_KEYS 直接指定交易所内的按键; S.MARKET_POKE 额外写入
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], max: [0x35, 0x3f],
  d0: [0x0b, 0x30], d1: [0x02, 0x31], d2: [0x03, 0x32], d3: [0x04, 0x33], d4: [0x05, 0x34], d5: [0x06, 0x35] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.MARKET_MODE || "lis";
const money = S.MARKET_MONEY ?? (mode === "big" ? 60000 : 3000); w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const SL = 0x2e76 + 0x2b; w16(SL, 10); poke.push([SL + 7, 0], [SL + 8, 0x10]);
poke.push([0x5892 + 0x0f, 0]); w16(0x5892 + 0x14, mode === "full" ? 1 : 100);
const M = 0x52d4; poke.push([M + 0x1b, 0], [M + 8, 30], [M + 9, 20], [M + 0x1c, 50]);
for (let i = 0; i < 0x0c; i++) poke.push([M + i, 0]);
for (let j = 0; j < 5; j++) { poke.push([M + 0x16 + j, 0xff]); w16(M + 0x0c + j * 2, 0); }
if (mode === "full") w16(M + 4, 1);                                       // 资材 1 → 已用 = 载重
for (const [a, v] of S.MARKET_POKE || []) poke.push([a, v]);
S.PORT_SETUP = mode === "bar" ? { port: 3, vx: 44, vy: 38, hx: 12, hy: 12, poke } : { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down);
const LIS = [
  K.enter, K.enter,                                   // 买进 → 0x2fa/0x2fb ▽
  K.enter, K.enter, K.enter,                          // 清单第 1 项 → 船员评价 ▽ → 0x96 是
  K.enter, K.d5, K.enter,                             // 选船 → 5 个
  K.enter, K.enter, K.esc,                            // 再选第 1 项 → ▽ → 0x96 否 → 杀价
  K.d1, K.enter, K.enter,                             // 出价 1 → 0x0c ▽
  K.max, K.enter, K.enter,                            // 出价 最大值 → 0x0a ▽
  K.enter, K.d3, K.enter,                             // 选船 → 3 个
  K.esc,                                              // 清单 Esc
  K.down, K.enter, K.enter, K.enter, K.d2, K.enter,   // 卖出 → 选船 → 第 1 项 → 2 个
  K.esc, K.esc,                                       // 货物清单 Esc → 船清单 Esc
  ...D(2), K.enter, K.enter,                          // 投资 → 0x02 ▽
  ...D(3), K.enter, K.enter, K.down, K.enter, K.esc,  // 物价 → 分类 0 → 分类 1 → Esc
  K.esc, K.down];
const BAR = [
  ...D(2), K.enter, K.d1, K.d0, K.d0, K.d0, K.enter, K.enter,   // 投资 1000 → 0x0f ▽
  K.enter, K.enter,                                   // 买进 → 0x2fb ▽
  K.down, K.enter, K.enter, K.enter,                  // 第 2 项 → ▽ → 是
  K.enter, K.d4, K.enter, K.esc,                      // 选船 → 4 个 → 清单 Esc
  ...D(3), K.enter, ...D(3), K.enter, K.esc,          // 物价 分类 3
  K.esc, K.down];
const FULL = [K.enter, K.enter, K.esc, K.down];
const PRICE = [...D(3), K.enter, K.down, K.down, K.enter, K.esc];          // 物价 → 分类 2 (食品) → Esc
const BIG = [...PRICE,
  K.enter, K.enter, K.enter, K.enter, K.enter, K.enter, K.max, K.enter, K.esc,   // 买进 第 1 项 → 是 → 选船 → 最大值
  ...PRICE,
  K.down, K.enter, K.enter, K.enter, K.max, K.enter, K.esc, K.esc,             // 卖出 → 选船 → 第 1 项 → 最大值
  ...PRICE, K.esc, K.down];
S.PORT_KEYS = [K.up, ...(S.MARKET_KEYS || (mode === "bar" ? BAR : mode === "full" ? FULL : mode === "big" ? BIG : LIS))];
S.NO_EVENTS = 1;
})();
