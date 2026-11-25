// office_route.js — 事务所 (1fd9:d40f = 2d19f) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本事务所入口 (38,35): 窗口 (26,23), 主角 (12,13), 时刻 0x18 (8:00); 工作清单 [0d68] = 0 / 2 / 4
// S.OFFICE_MODE:
//   "main"   现金 150: 工作介绍 → 选第 2 件 (S.NO_EVENTS: 剧本 SNR0 不触发, 回到清单) → Esc → 各国情报 西班牙 否 (0x57)
//            → 各国情报 葡萄牙 是 (付 100, 国家表 + 0x58/0x355 + 0x59) → 各国情报 意大利 是 (钱不够 0xa3) → 离开
//   "status" 以 S.TELEPORT 在各次按键前改写工作状态: [0d62]=3 (国王在找你 0x19a+国籍 / 0x3a4) → 工作中 [0d74]=2 本港 (0x3a3)
//            → 目标港 = 塞维尔 (0x152) → 工作 0x0b 目标港 = FF (random(42) 决定港 → 0x256/0x258 座标/0x259)
//            → 目标港 = 本港、人物 = FF (random 选人物 → 0x254/0x255) → 随身物已有目标道具 (0x253) → 离开
//   "event"  不关闭剧本 (S.NO_EVENTS = 0), 主角剧本章 [0cd4] = FF (否则约翰一进门就触发 SNR1 剧情并离开):
//            工作介绍 → 第 1 件 (商品输送, SNR0 第 0 章第 1 节: 说明 + 是/否) → 接受 ([0d5e] = [0d74] = 2) → 再选工作介绍 (0x152) … → 离开
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.OFFICE_MODE || "main";
const money = mode === "main" ? 150 : 3000; w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
w16(0x0d68, 0); w16(0x0d6a, 2); w16(0x0d6c, 4);
if (mode !== "event") { w16(0x0d6e, 0x1234); w16(0x0d70, 0x55); w16(0x0d72, 7); }
if (mode === "status") poke.push([0x0d62, 3]);
if (mode === "event") poke.push([0x0cd4, 0xff]);
for (const [a, v] of S.OFFICE_POKE || []) poke.push([a, v]);
const D = n => Array(n).fill(K.down), E = n => Array(n).fill(K.enter);
const MAIN = [K.enter, K.down, K.enter, K.esc,
  K.down, K.enter, K.down, K.enter, K.esc, K.enter,           // 各国情报 → 西班牙 → 否 → 0x57 ▽
  K.down, K.enter, K.enter, K.enter, K.enter, K.enter,        // 各国情报 → 葡萄牙 → 是 → 0x58 ▽ → 0x59 ▽
  K.down, K.enter, ...D(4), K.enter, K.enter, K.enter,        // 各国情报 → 意大利 → 是 → 0xa3 ▽
  K.esc, K.down];
const STATUS = [...E(15), K.esc, K.down];
const EVENT = [K.enter, K.enter, ...E(14), K.esc, K.esc, K.esc, K.down];
S.PORT_SETUP = { port: 0, vx: 26, vy: 23, hx: 12, hy: 13, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.OFFICE_KEYS || (mode === "status" ? STATUS : mode === "event" ? EVENT : MAIN))];
if (mode === "status") {
  const B = 11 + 1, tp = {};                                  // 开始新航海 11 键 + 走进去 1 键; tp[p] = 在第 p 个建筑内按键之前写入
  const t16 = (L, a, v) => L.push([a, v & 255], [a + 1, (v >> 8) & 255]);
  tp[2] = []; t16(tp[2], 0x0d62, 0); tp[2].push([0x0d5e, 1]); t16(tp[2], 0x0d74, 2); t16(tp[2], 0x0d88, 0);
  tp[4] = []; t16(tp[4], 0x0d88, 1);
  tp[6] = []; t16(tp[6], 0x0d74, 0x0b); t16(tp[6], 0x0d88, 0xff); t16(tp[6], 0x0d8a, 0xff); t16(tp[6], 0x0d8c, 0x14);
  tp[9] = []; t16(tp[9], 0x0d88, 0); t16(tp[9], 0x0d8a, 0xff); t16(tp[9], 0x0d96, 3);
  tp[12] = [[0x2e57, 0x14]];
  S.TELEPORT = {}; for (const k in tp) S.TELEPORT[B + +k] = tp[k];
} else S.TELEPORT = undefined;
S.NO_EVENTS = mode === "event" ? 0 : 1;
})();
