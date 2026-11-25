// cmd_nav_route.js — 港口指令按钮「航海术」(1fd9:119e = 20f2e) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本 (与 market_route 相同位置), 进港时两边同时写入随身物 DS:2e57 (硬铠已装备)。
//   S.CMD_MODE = "items" (默认): F4 → 随身物: 匕首 佩戴 / 硬铠 除去 / 锁子甲 佩戴 (换掉同类) / 怀表 使用 (时刻) / 猫 使用 /
//                圣香油 使用 (用后消失, random(6)) / 王冠 使用 (用不了) / 王冠 佩戴 (不能装备) / 私掠许可书 使用 (种类 8 编号外) → Esc → Esc
//   S.CMD_MODE = "func": F4 → 功能 → 环境设置 (表示效果 OFF, BGM OFF, 鼠标 −/+ +, 海上移动值 +, 海上速度 +) → 保存文件 第 1 格 →
//                取出存盘 第 1 格 (读档后重新进港, 时间循环中止并从存盘日期重新开始) → F4 → 功能 → 结束游戏 → 标题
//   S.CMD_MODE = "mouse": 鼠标点四个指令按钮
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0] };
const poke = [], b = (a, v) => poke.push([a, v]);
const inv = [0x00, 0x10, 0x11, 0x17, 0x19, 0x2a, 0x2c, 0x1d];
for (let i = 0; i < 20; i++) b(0x2e57 + i, i < inv.length ? inv[i] : 0xff);
b(0x8248 + 0x10 * 0x14 + 0x13, 0x16);                                     // 硬铠 (种类 6) 已装备
for (const [a, v] of S.CMD_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down), E = K.enter;
const pick = (n, use) => [...D(n), E, ...(use ? [K.down] : []), E, E];   // 清单第 n 项 → 佩戴 / 使用 → 等待
const ITEMS = [K.f4, ...D(4), E,
  ...pick(0, 0), ...pick(1, 0), ...pick(2, 0), ...pick(3, 1), ...pick(4, 1), ...pick(5, 1),
  ...pick(5, 1), ...pick(5, 0), ...pick(6, 1),
  K.esc, K.esc];
const FUNC = [K.f4, ...D(5), E,
  E, E, K.down, E, K.down, E, K.right, E, E, K.down, E, K.down, E, K.esc,      // 环境设置
  K.down, E, E, E,                                                            // 保存文件 → 第 1 格 → 是
  K.down, K.down, E, E, E,                                                    // 取出存盘 → 第 1 格 → 是
  K.f4, ...D(5), E, K.down, K.down, K.down, E, E,                            // 功能 → 结束游戏 → 是
  K.down];
// "mouse": 以鼠标依序点 航海术 / 情报 / 经营 / 命令 四个按钮 (y 座标加 40 = 驱动座标), 各自 Esc 关闭
const M = (x, y, b) => ({ mouse: { x, y, b } }), click = y => [M(0x272, y + 40, 0), M(0x272, y + 40, 1), M(0x272, y + 40, 0), K.esc];
const MOUSE = [...click(0x160), ...click(0x70), ...click(0xc0), ...click(0x110)];
S.PORT_KEYS = S.CMD_KEYS || (S.CMD_MODE === "func" ? FUNC : S.CMD_MODE === "mouse" ? MOUSE : ITEMS);
S.NO_EVENTS = 1;
})();
