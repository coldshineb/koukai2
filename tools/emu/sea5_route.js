// sea5_route.js — 出海与航海 阶段 5 后半 (海上指令) 的差分测试设置: 依序运行 本档 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船), 之后依 S.SEA5 送出海上的按键; 两边同时写入的数据放在 S.SEA_POKE。
//   "navi"   随身物 测量 (298a5): 主角没有技能 → 0x2f5 → 船员清单 (人物 8 没有技能 → 0x2f3) → Esc → 主角发言、误差 random(100)+1;
//            再用 精度 1 的 → 选人物 9 (有技能) → 经纬度
//   "navi2"  主角有测量技能 (+30 bit4): 直接显示 (精度 5)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0] };
const D = n => Array(n).fill(K.down), E = K.enter, X = K.esc, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v]), w16 = (a, v) => { b(a, v & 255); b(a + 1, (v >> 8) & 255); };
const P = n => 0x12b6 + n * 0x32;
const inv = list => { for (let i = 0; i < 20; i++) b(0x2e57 + i, i < list.length ? list[i] : 0xff); };
const mates = list => { for (let i = 0; i < 30; i++) b(0x2e1b + i, i < list.length ? list[i][0] : 0xff);
  for (const [n, role] of list) { b(P(n) + 0x2c, 0); b(P(n) + 0x2d, 0xff); b(P(n) + 0x2e, role); } };
const mode = S.SEA5 || "navi";
let keys;
if (mode === "navi" || mode === "navi2") {
  inv([0x14, 0x16]); mates([[8, 2], [9, 3]]);
  if (mode === "navi2") b(P(0) + 0x30, 0x11);
  keys = mode === "navi"
    ? [...idle(2), K.f4, ...idle(2), ...D(4), E, E, K.down, E, E, E, E, X, E, E, K.down, E, K.down, E, E, K.down, E, E, X, X, ...idle(2)]
    : [...idle(2), K.f4, ...idle(2), ...D(4), E, E, K.down, E, E, X, X, ...idle(2)];
}
//   "scout"  命令 侦察 (1feae): 舰队 65 / 66 (指挥者 64 / 65, 舰队编号 66 → 61..69 的额外发言) 移到 (120, 356), 船员 9 的 +1e = 100 (发言必定出现)
//            光标 → 里斯本港 (港名消息) → 舰队 5 (单一舰队) → 两支舰队的格 (清单 0x8c 选第 2 个 → 数据 → 0x2fe) → Esc;
//            再以鼠标点舰队 5 → 数据 → 点地图窗口外 (= Esc)
if (mode === "scout") {
  mates([[8, 2], [9, 3]]); b(P(9) + 0x1e, 100);
  for (const k of [65, 66]) { const F = 0x2e76 + 0x85 * k; w16(F, 120); w16(F + 2, 356); }
  const R = K.right, L = K.left, U = K.up, M = (x, y, bt) => ({ mouse: { x, y, b: bt } });
  const click = (x, y) => [M(x, y + 40, 0), M(x, y + 40, 1), M(x, y + 40, 0)];
  keys = [...idle(2), K.f3, ...idle(2), E,
    R, R, E, E,                                   // 里斯本港
    ...Array(9).fill(L), ...Array(7).fill(U), E, E,   // 舰队 5
    R, R, U, U, E, K.down, E, E, E,               // 两支舰队 → 第 2 个 → 数据 → 0x2fe
    X, X, ...idle(2),
    K.f3, ...idle(2), E, ...click(0x60 + 3 * 16 + 8, 8 + 5 * 16 + 8), E,   // 鼠标点舰队 5
    ...click(600, 300), X, ...idle(2)];
}
//   "dest"   舵轮中央 '5' (2e09:310b 指定目的地): 「请指定目的地」→ 光标左移 4 格 (114, 358) → 自动航行 (+0c = 6000) → 到达 →
//            靠港检查 (附近没有港口) → 再次指定目的地 → Esc (停船)。S.SEA5_IDLE = 自动航行的空动作数
//   "deleg"  航海术 委任 (船员 9 = 职务 3、+30 bit4): 已发现港口清单 → 第 2 项 塞维尔 → 地点路线 (232a6) + 区域内中途点 (240a7 / 23a97 模式 1)
//            → 到达 → 靠港「是」→ 进港
const K5 = [0x06, 0x35];
if (mode === "dest") {
  keys = [...idle(2), K5, ...idle(2), K.left, K.left, K.left, K.left, E, ...idle(S.SEA5_IDLE ?? 60), X, ...idle(4)];
}
if (mode === "deleg") {
  mates([[8, 2], [9, 3]]);
  keys = [...idle(2), K.f4, ...idle(2), E, K.down, E, ...idle(S.SEA5_IDLE ?? 300), E, ...idle(6)];
}
//   "deleg0" 委任到清单第 1 项 里斯本 (出港处): 起点与目的地的最近地点相同 → 直接驶向 (+0d |= 20); 目的地是陆地 → 23e19 换成附近的海 → 到达 → 靠港「是」
if (mode === "deleg0") {
  mates([[8, 2], [9, 3]]);
  keys = [...idle(2), K.f4, ...idle(2), E, E, ...idle(S.SEA5_IDLE ?? 40), E, ...idle(8)];
}
//   "chart"  情报 航海图 (1dace): 世界全图 → Enter (主角所在格) → 2 × 2 海域格 → 按键 → 全图 → 上移 10 格 (未探索 → 重选) → Enter → Esc;
//            再开一次以鼠标点全图上主角附近 → 按键 → 点全图外 (= Esc) → Esc
//   "mapitem" 随身物 种类 0x0c 地图 (1dd76): 随身物 0x50 (+12 = 发现物 S.SEA5_DISC, 默认 0) → 使用 → X 记号的 2 × 2 海域格 → 按键 → Esc
if (mode === "chart") {
  const M = (x, y, bt) => ({ mouse: { x, y, b: bt } }), click = (x, y) => [M(x, y + 40, 0), M(x, y + 40, 1), M(x, y + 40, 0)];
  keys = [...idle(2), K.f1, ...idle(2), ...D(7), E, ...idle(2), E, ...idle(2), E, ...idle(2),
    ...Array(10).fill(K.up), E, ...idle(2), X, ...idle(2), X, ...idle(2),
    K.f1, ...idle(2), ...D(7), E, ...idle(2), ...click(0x32 + 6 * 35 + 3, 0x32 + 6 * 15 + 3), ...idle(2), E, ...idle(2), ...click(10, 380), ...idle(2), X, ...idle(3)];
}
if (mode === "mapitem") {
  inv([0x50]); b(0x8248 + 0x50 * 0x14 + 0x12, S.SEA5_DISC ?? 0);
  keys = [...idle(2), K.f4, ...idle(2), ...D(4), E, E, K.down, E, ...idle(2), E, ...idle(2), X, X, ...idle(3)];
}
for (const [a, v] of S.SEA5_POKE || []) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.SEA5_KEYS || keys;
})();
