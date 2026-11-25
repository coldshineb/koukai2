// battle_route.js — 海战 (10f7e, scenes/battle.js) 的差分测试设置: 依序运行 本档 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船); 舰队 65 (指挥者 人物 64, 海盗) 移到主角旁 (119, 357) (两边同时), 进港时刻 0x18。
// 命令 → 战斗 → 清单 (Enter) → 人物数据 是 → 10f7e: 开战 (fcf9: 淡出、编成、战场、f972 对话 0x32b / 0x32d) → 主循环 → 主角旗舰的指令菜单 (b8b1)
//   S.BATTLE = "open"   对话后停在指令菜单 (之后的空动作数 S.BATTLE_IDLE, 默认 4)
//              "stop"   指令菜单 → ↓ × 5 停船 → 0x307 是否 → → 否 → 回到指令菜单 (b6f2 / bca4)
//              "tail"   指令菜单之后接 S.BATTLE_TAIL 的按键 (移动 / 攻击等路线, 见 docs/RE_NOTES.md 30.6 起的验证)
//   砲击 / 接舷 / 电脑路线之后再接 S.BATTLE_POST 的按键 (战后处理 10bdf, 30.12)
// 比对: 存盘区 + 海战的 DS 工作区 (S.EXTRA_DS: 8e14..97d4 战场地图、97e0..9bfe 各方 / 船 / 变量、9c2a..9c2d、9d3e..9d44 战力);
//   97d4..97df (三个战场缓冲的远指针, 值是原版的段地址) 不比; 调色盘只比前 8 色 (S.DAC_N; 16ee 的循环由 IRQ0 驱动)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f3: [0x3d, 0] };
const E = K.enter, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v]), w16 = (a, v) => { b(a, v & 255); b(a + 1, (v >> 8) & 255); };
let mode = S.BATTLE || "open", preset = [], tail = S.BATTLE_TAIL;
// 砲击路线 (RE_NOTES 30.8): 主角的船 水手 200、10 门砲、船位 +8 = 0x11 (射程 3)、耐久 50 / 50、转向 120、推进 60、+6 = 100; 舰队 65 移到与主角同一点 (118, 358)
//   指令菜单 → 移动: 左上 1 步 → 转向上 → 上 3 步 (移动力用完, 直接问 0x300) → 是 → 走到 (25, 20) → 攻击 0x304: 选 (22, 19) 的敌方旗舰 → e8cc 砲击
//   "gun_hit" 命中; "gun_sink" 目标 (舰队 65 船位 0) 耐久 3 → 击沉, 经验 900 (等级 1 → 5); "gun_unmanned" 目标水手 2 → 无人船
//   砲击之后下一次等待输入前电脑方已经行动, 所以另以快照 S.PROBES (原版 e91a = e8cc 结束) 比对砲击刚结束时的状态、随机数与画面
// 接舷路线 (RE_NOTES 30.9): 同样的设置; 移动 左上 × 3 → 左下 (移动力用完) → 是 → (22, 23) → 攻击: 选相邻的 (21, 22) (舰队 65 船位 1, 不是旗舰) → e95e 接舷
//   "board" 白刃战; "board_unmanned" 目标水手 3 → 无人船; 快照 S.PROBES = 原版 ea2e (e95e 结束)
if (/^(gun|board|cpu)_?/.test(mode) && mode !== "open") {
  const SL = 0x2e76 + 0x2b, M = 0x52d4, Fs0 = 0x2e76 + 0x85 * 65 + 0x2b;
  preset = [[SL + 8, 0x11], [M + 6, 10], [M + 7, 0], [SL + 2, 50], [SL + 3, 50], [SL + 4, 120], [SL + 5, 60], [SL + 6, 100], [SL, 200], [SL + 1, 0],
    ...(mode === "gun_sink" ? [[Fs0 + 2, 3]] : mode === "gun_unmanned" ? [[Fs0, 2], [Fs0 + 1, 0]] : mode === "board_unmanned" ? [[Fs0 + 9, 3], [Fs0 + 10, 0]] : [])];
  if (mode === "cpu_long") {                                         // 电脑行动长路线: 主角每回合 停船 (↓ × 5 → 是), 打到战斗结束 (S.BATTLE_TURNS 回合, 默认 12)
    tail = []; for (let i = 0; i < (S.BATTLE_TURNS ?? 12); i++) tail.push("down", "down", "down", "down", "down", "enter", "enter");
    tail.push("i", "i", "i");
    S.PROBES = [{ name: "e8cc", ip: 0xe91a }, { name: "e95e", ip: 0xea2e }];
  } else if (/^gun/.test(mode)) {
    tail = ["enter", "l", "up", "enter", "up", "enter", "up", "enter", "up", "enter", "enter", "l", "l", "l", "up", "enter", "i", "i", "i", "i"];
    S.PROBES = [{ name: "e8cc", ip: 0xe91a }];
  } else {
    tail = ["enter", "l", "up", "enter", "l", "enter", "l", "up", "enter", "l", "down", "enter", "enter", "l", "up", "enter", "i", "i", "i", "i"];
    S.PROBES = [{ name: "e95e", ip: 0xea2e }];
  }
  tail = tail.concat(S.BATTLE_POST || []);                         // 战后处理的按键 (RE_NOTES 30.12 起的验证)
  if (S.BATTLE_TAIL_FULL) tail = S.BATTLE_TAIL_FULL;                // 整段换掉 (duel_route.js: 同样的设置, 另一串按键)
  if (S.DUEL_PROBES) S.PROBES = [...(S.PROBES || []), ...S.DUEL_PROBES];   // duel_route.js 的一骑打快照点
  mode = "tail";
}
const F = 0x2e76 + 0x85 * 65;
if (/^(gun|board|cpu)/.test(S.BATTLE || "")) { w16(F, 118); w16(F + 2, 358); } else { w16(F, 119); w16(F + 2, 357); }
const open = [...idle(2), K.f3, ...idle(2), K.down, K.down, E, E, E];   // 命令 → 战斗 → 清单第 1 项 → 是
let keys;
const K2 = { right: [0x4d, 0] };
if (mode === "open") keys = [...open, E, E, ...idle(S.BATTLE_IDLE ?? 4)];
else if (mode === "stop") keys = [...open, E, E, ...idle(2), K.down, K.down, K.down, K.down, K.down, E, ...idle(1), K2.right, E, ...idle(3)];
else if (mode === "tail") keys = [...open, E, E, ...idle(2), ...tail.map(k => typeof k === "string" ? (k[0] === "i" ? { mouse: {} } : { ...K, ...K2, l: [0x4b, 0] }[k]) : k)];   // S.BATTLE_TAIL: 指令菜单之后的按键 ("down"/"up"/"right"/"l"(左)/"enter"/"esc"/"i" 空动作)
for (const [a, v] of [...preset, ...(S.BATTLE_POKE || [])]) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.BATTLE_KEYS || keys; S.SEA_TIME = S.BATTLE_TIME ?? 0x18;
S.EXTRA_DS = [[0x8e14, 0x97d4], [0x97e0, 0x9bfe], [0x9c2a, 0x9c2e], [0x9d3e, 0x9d44], ...(S.EXTRA_DS_MORE || [])];   // EXTRA_DS_MORE: duel_route.js   // 9bfe..9c29 / 9c2e..9d2f 是 MAIN.EXE 的常数 (移植版在开战时才创建 DS 镜像)
S.DAC_N = 8;
})();
