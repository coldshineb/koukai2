// land_route.js — 上陆探索 / 海上特殊地点 的差分测试设置 (RE_NOTES 第 36 节): 依序运行 本档 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 舰队 (118, 358), 窗口 (107, 347)); 两边同时写入的数据放在 S.SEA_POKE。
// 登陆用的路线在出港后第 2 个空动作时把舰队移到 (118, 355) (S.TELEPORT[新游戏按键数 + 4], 两边同时): 东 2 格是草地 0x41 (可上陆)。
// 登陆: F4 航海术 → ↓×3 登陆 → 选位置 (点击区从 [a160] = 3 开始 = 右下 (2, 1); 数字键 6 × k 往后) → Enter
//   k = 0 → 窗口 (13, 9) 草地 0x41 → 34d54; k = 6 → (12, 7) 海 → 0x1b9「这里不能上陆」
// 共同写入: 船 0 耐久 20 / 40、转向 50 (船型 70)、推进 80 (船型 80)、砲 0、资材 30; 主角 +23 = S.LAND_H23 (默认 100 → [b8e0] = 1)
// 发现物 0 放在 (120, 356) (k = 0 的位置): +4 道具 S.LAND_ITEM、+5 难度、+6 标志 (种类 / 0x20 已调查 / 0x40 海上已看见 (否则出港时先出现「发现」消息) / 0x80 + 0xa0 宝物)
// S.LAND_MODE:
//   "cant"     k = 2 → 0x1b9「这里不能上陆」
//   "no"       确认 0x1b8 → 否 ([8246] = FF)
//   "leave"    上陆菜单 → 回船上 (0x1a1 否 → 再选 → 是)
//   "camp"     上陆菜单 第 4 项 → [1005] |= 0x28 → 再登陆 (直接进菜单) → 回船上
//   "repair"   修理: 清单 0x8a → 耐久 (计算机 4) → 转向 (计算机 4) → 推进 (已满 0x1a4) → Esc → 船 (已满 0x1a2) → Esc → 回船上
//   "nomat"    资材 0 → 修理 耐久 → 0x1a3
//   "water"    搜索 → 补水 (0x1aa) → 清单 0x8b → 计算机 14 (= 尚可装载量) → Esc → 回船上
//   "water0"   主角 +23 = 0 ([b8e0] = 0) → 搜索 → 0x1a9
//   "treasure" 发现物 +6 = 0xa0 (宝物, bit7: 走上陆菜单) 道具 9 → 搜索 → 346d8 (随身物「值 − 道具 = F6」= 空格 FF) → 再搜索 (+6 bit4)
//   "disc_ok"  发现物 种类 0 难度 0 → 0x1b7 → 34ccc 调查 (GRAPH #0x40 + 效果音 0c18、0x1af、数据窗口) → 再调查 (0x1b0) → 离开
//   "disc_fail" 难度 255 → 0x1ad → 雇用向导 (0x1b2) → 狩猎 (0x1b5 → 粮食分配 → Esc → 0xd3 是) → 留在岸上 (第 5 项)
//   "disc_native" 种类 1 (土人) 难度 0 → 0x1ae + 损失 (348ff, 0x1ab)
//   "nofood"   粮食 0 → 调查 → 0x1ac → 雇用向导 (没有粮食 ≥ 20 → 0x1b3) → 离开
// 海上特殊地点: S.LAND_MODE = "ev0".."ev9" → 地点 0 放在 (118, 358)、DS:103a[0] = n; 出港后第一个时刻触发 (之后 31047 读 MONSTER.DAT 第 [1044] 笔)
//   "ev2b" / "ev5b" / "ev8b": 再加一艘船长不是主角的船 (船位 1, 人物 8) — 没有这艘船时事件 2 / 5 / 8 返回 0 (不显示)
"use strict";
(function () {
const S = session;
S.landRoute = function () {
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f4: [0x3e, 0],
  six: [0x07, 0x36], d1: [0x02, 0x31], d4: [0x05, 0x34] };
const D = n => Array(n).fill(K.down), E = K.enter, X = K.esc, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v & 255]), w16 = (a, v) => { b(a, v); b(a + 1, v >> 8); };
const SL = 0x2e76 + 0x2b, M = 0x52d4, H = 0x12b6, DISC = 0x7f8c;
const mode = S.LAND_MODE || "leave";
b(SL + 2, 20); b(SL + 3, 40); b(SL + 4, 50); b(SL + 5, 80); b(SL + 6, 0); w16(M + 4, S.LAND_MAT ?? 30);
b(H + 0x23, S.LAND_H23 ?? (mode === "water0" ? 0 : 100));
const disc = (flags, diff, item = 0) => { w16(DISC, 120); w16(DISC + 2, 356); b(DISC + 4, item); b(DISC + 5, diff); b(DISC + 6, flags); };
const LAND = (k = 0) => [K.f4, ...idle(2), ...D(3), E, ...idle(1), ...Array(k).fill(K.six), E, ...idle(1)];
const MENU = n => [...D(n), E];                       // 上陆菜单 / 发现物菜单 (每次从第 0 项开始)
const LEAVE = [E, E];                                 // 第 0 项 → 0x1a1 是
let keys;
if (mode === "cant") keys = [...idle(2), ...LAND(6), E, ...idle(2)];
if (mode === "no") keys = [...idle(2), ...LAND(0), X, ...idle(2)];
if (mode === "leave") keys = [...idle(2), ...LAND(0), E, ...idle(1), E, X, ...idle(1), ...LEAVE, ...idle(2)];
if (mode === "camp") keys = [...idle(2), ...LAND(0), E, ...idle(1), ...MENU(3), ...idle(2), ...LAND(0), ...LEAVE, ...idle(2)];
if (mode === "repair") keys = [...idle(2), ...LAND(0), E, ...idle(1), ...MENU(1), E, ...idle(1),
  E, K.d4, E, ...idle(1),                             // 耐久: 0x1a5 (0〜4) → 计算机 4 → Enter
  K.down, E, K.d4, E, ...idle(1),                     // 转向 (0〜4)
  K.down, K.down, E, E, ...idle(1),                   // 推进 (已满 → 0x1a4)
  X, ...idle(1), E, E, X, ...idle(1), ...LEAVE, ...idle(2)];
if (mode === "nomat") { poke.length = 0; b(SL + 2, 20); b(SL + 3, 40); b(SL + 4, 50); b(SL + 5, 80); b(SL + 6, 0); w16(M + 4, 0); b(H + 0x23, 100);
  keys = [...idle(2), ...LAND(0), E, ...idle(1), ...MENU(1), E, E, E, ...idle(1), X, X, ...idle(1), ...LEAVE, ...idle(2)]; }
if (mode === "water") keys = [...idle(2), ...LAND(0), E, ...idle(1), ...MENU(2), E, ...idle(1), E, K.d1, K.d4, E, ...idle(1), X, ...idle(1), ...LEAVE, ...idle(2)];
if (mode === "water0") keys = [...idle(2), ...LAND(0), E, ...idle(1), ...MENU(2), E, ...idle(1), ...LEAVE, ...idle(2)];
if (mode === "treasure") { disc(0xa0, 10, S.LAND_ITEM ?? 9);
  keys = [...idle(2), ...LAND(0), E, ...idle(1), ...MENU(2), E, ...idle(1), ...MENU(2), E, ...idle(1), ...LEAVE, ...idle(2)]; }
if (mode === "disc_ok") { disc(0x40, 0);
  keys = [...idle(2), ...LAND(0), E, ...idle(1), E, ...idle(1), E, ...idle(1), E, ...idle(1), E, ...idle(1), ...MENU(3), E, ...idle(2)]; }
if (mode === "disc_fail") { disc(0x42, 255);
  keys = [...idle(2), ...LAND(0), E, ...idle(1), E, E, ...idle(1), ...MENU(1), E, E, ...idle(1), ...MENU(2), E, ...idle(1), E, ...idle(1), X, E, ...idle(2), ...MENU(4), ...idle(2)]; }
if (mode === "disc_native") { disc(0x41, 0);
  keys = [...idle(2), ...LAND(0), E, ...idle(1), E, ...idle(1), E, ...idle(1), E, ...idle(1), ...MENU(3), E, ...idle(2)]; }
if (mode === "nofood") { disc(0x42, 0); w16(M + 2, 0);
  keys = [...idle(2), ...LAND(0), E, ...idle(1), E, E, ...idle(1), ...MENU(1), E, E, ...idle(1), ...MENU(3), E, ...idle(2)]; }
const ev = /^ev(\d)(b?)$/.exec(mode);
if (ev) {
  w16(0x1012, 118); w16(0x1014, 358); b(0x103a, +ev[1]);
  if (ev[2]) {                                        // 船位 1: 船记录 1 (船型 0), 水手 8, 船长 人物 8
    const S1 = SL + 9, M1 = M + 0x1e; w16(S1, 8); b(S1 + 2, 30); b(S1 + 3, 40); b(S1 + 4, 60); b(S1 + 5, 70); b(S1 + 6, 0); b(S1 + 7, 1); b(S1 + 8, 0x10);
    b(0x5892 + 0x16 + 0x0f, 0); w16(0x5892 + 0x16 + 0x14, 100); w16(0x5892 + 0x16 + 0x12, 30);
    b(M1 + 0x1b, 8); b(M1 + 8, 30); b(M1 + 9, 20); b(M1 + 0x1c, 50); w16(M1, 100); w16(M1 + 2, 100); w16(M1 + 4, 0); w16(M1 + 6, 0);
    b(H + 8 * 0x32 + 0x2c, 0); b(H + 8 * 0x32 + 0x2e, 1);
  }
  keys = [...idle(2), E, ...idle(1), E, ...idle(1), E, ...idle(1), E, ...idle(3)];
}
for (const [a, v] of S.LAND_POKE || []) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.LAND_KEYS || keys;
if (!ev) S.TELEPORT = { [((S.NEWGAME || []).length || 11) + 4]: [[0x2e76 + 2, 355 & 255], [0x2e76 + 3, 355 >> 8]] };
};
S.landRoute();
})();
