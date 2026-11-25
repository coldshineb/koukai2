// mouse_route.js — 鼠标操作的差分测试设置 (RE_NOTES 第 38 节)。先运行本档, 再依模式接 battle_route.js → sea_depart_route.js 或直接 port_tests.js
//   鼠标事件 { mouse: { x, y, b } } 与按键排在同一串行 (y = 游戏座标 + 40 = 驱动座标); 拖拽 = 按下 → 连续移动 → 放开。
//   原版的软件光标画在显示内存里, 放开后光标可能留在旧位置直到下一次显示 (移植版在呈现时才画光标), 所以比对时遮住最近 CURSOR_LAG 个鼠标位置。
//   S.MOUSE_MODE = "list"   里斯本, 随身物放 16 件 (清单种类 0x0d, 一页 10 列): F4 → 随身物 → 拖拽标题列 (清单移到 col 32, y 174) → 点 ↓ 箭头 (按住重复)
//                           → 点 ↑ 箭头 → 拖拽滑块 → 点滑块上方空白 (翻页) → 点第 2 列 (子菜单) → Esc → 右键取消 → 重开清单 → 点清单外取消
//                  "yesno"  F4 → 功能 → 保存文件 → 第 1 格 → 是/否框 (第 2 层, 开在鼠标位置): 拖拽标题列到 (60, 43) → 再拖到左上
//                           (放开时 x ≤ 位移、y ≤ 位移 → 位置取鼠标座标本身 (10, 5)) → 点「否」→ Esc
//                  "popup"  海战指令菜单 (第 1 层弹出菜单 1458c, 开在鼠标位置): 拖拽窗口边框 → 再拖到左上 (同样的怪行为 → (3, 2)); 需接 battle_route.js
//                  "walk"   港口走路的鼠标操作 (S.MICKEY: 移动量 INT 33h fn 0Bh): 移动鼠标选方向 (> 8 mickey) → 按住左键前进 → 换方向 → 放开 → 小幅移动 (≤ 8, 不换方向)
//                           → 点指令按钮 (情报) → Esc
//                  "sea"    海上航行的鼠标操作 (21151 / 21008): 点地图窗口 (3×3 区块 → 数字键 1..9 的航向) → 点舵轮按钮 (DS:a9d8 0..7) → 点中央 (8)
//                           → 点「情报」按钮 (9) → Esc; 需接 sea_depart_route.js
"use strict";
(function () {
const S = session;
const mode = S.MOUSE_MODE || "list";
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f4: [0x3e, 0] };
const M = (x, y, b) => ({ mouse: { x, y: y + 40, b } }), I = { mouse: {} };
const D = n => Array(n).fill(K.down), E = K.enter;
const drag = pts => [M(...pts[0], 0), ...pts.map(p => M(...p, 1)), M(...pts[pts.length - 1], 0)];
S.CURSOR_LAG ??= 12;
S.NO_EVENTS = 1;
if (mode === "sea") {
  // 海上时刻的等待循环 (6e8c) 每次都查鼠标, 40 次查找很快就过去: 按下后要留几个空动作 (按住), 21151 读到 0x81 时才算点击
  const idle = n => Array(n).fill(I), click = (x, y) => [M(x, y, 0), M(x, y, 1), ...idle(3), M(x, y, 0)];
  S.FB_HASH ??= 10;
  S.SEA_KEYS = [...idle(2), ...click(150, 60), ...idle(4),              // 地图左上区块 → 航向 7
    ...click(590, 325), ...idle(4),                                      // 舵轮 东 (按钮 2: x 572..616, y 308..348, 键 '6')
    ...click(552, 280), ...idle(3),                                      // 舵轮 北 (按钮 0: x 532..572, y 256..304, 键 '8')
    ...click(630, 110), K.esc, ...idle(3)];                             // 情报 (按钮 9: x 618..642, y 72..152)
  return;
}
if (mode === "popup") {
  S.BATTLE = "tail";
  S.BATTLE_TAIL = [...drag([[575, 238], [500, 200], [400, 150], [300, 100]]), "i", ...drag([[290, 98], [100, 60], [3, 2]]), "i", "i"];
  return;
}
const poke = [], b = (a, v) => poke.push([a, v]);
if (mode === "list") for (let i = 0; i < 20; i++) b(0x2e57 + i, i < 16 ? i : 0xff);   // 随身物 16 件 (道具 0..15)
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const KEYS = {
  list: [K.f4, ...D(4), E,
    ...drag([[520, 118], [480, 130], [400, 150], [300, 180]]),   // 标题列 (col+2)×8 ≤ x < 滚动条 + 16, y .. y+16
    ...drag([[408, 365]]),                                       // ↓ 箭头 (滚动条栏, y ≥ 槽底 + 1)
    ...drag([[408, 205]]),                                       // ↑ 箭头 (y + 0x18 .. 槽顶 − 1)
    ...drag([[408, 225], [408, 255], [408, 285]]),               // 滑块
    ...drag([[408, 220]]),                                       // 滑块上方的槽 (翻一页)
    ...drag([[300, 238]]),                                       // 第 2 列
    K.esc,
    M(300, 238, 2), M(300, 238, 0),                              // 右键
    E, ...drag([[100, 100]]),                                    // 清单外
    K.esc, K.esc],
  yesno: [K.f4, ...D(5), E, K.down, E, M(300, 200, 0), E,
    ...drag([[300, 175], [200, 100], [120, 60], [100, 50]]),
    ...drag([[80, 50], [40, 20], [10, 5]]),
    ...drag([[110, 35]]),
    K.esc, K.esc, K.esc],
  walk: [M(300, 200, 0), I, M(340, 200, 0), I, M(340, 200, 1), I, I, I, I, I, M(340, 160, 1), I, I, I, M(340, 160, 0), I,
    M(344, 158, 0), I, M(344, 158, 1), I, I, M(344, 158, 0), I,
    ...drag([[0x272, 0x70]]), K.esc, I],
};
if (mode === "walk") S.MICKEY = 1;
S.PORT_KEYS = KEYS[mode];
})();
