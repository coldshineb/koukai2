// duel_route.js — 一骑打 (12998 以下, scenes/duel.js; docs/RE_NOTES.md 30.16..30.18) 的差分测试设置:
//   依序运行 本档 → battle_route.js → sea_depart_route.js → port_tests.js
// 都以 battle_route.js 的海战开始 (里斯本出港, 舰队 65 = 指挥者 人物 64、海盗, 在主角旁边)。比对时另加一骑打的 DS 工作区 (S.EXTRA_DS_MORE):
//   9d44..9d59 (双方、出招历史、位置、攻方、dx / dy)、9f5e..9fbd (精灵画布的格表)、a01e..a02b (双方装备); [9c2a] 已在 battle_route 的比对范围
//   S.DUEL = "cpu"   电脑发起 (e95e → 0fea:2d1a(0, T)): battle_route 的 cpu_long (主角每回合停船), 人物 64 的 +21 / +23 = 100、主角 +21 = 1,
//                    电脑方旗舰接舷主角旗舰时转为一骑打; 一骑打中的菜单由 cpu_long 原本的按键 (↓ × 5、Enter、Enter) 选招
//   S.DUEL_TURNS     cpu 的回合数 (battle_route 的 S.BATTLE_TURNS)
//   S.DUEL_TAIL      "tail" 模式: 指令菜单之后的按键 (玩家发起: 攻击 → 选敌方旗舰 → 0x302 是 → 一骑打)
//   S.DUEL_POKE      额外写入
"use strict";
(function () {
const S = session;
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const hero = at(0x12b5), PR = n => 0x12b6 + 0x32 * n;
const mode = S.DUEL || "cpu", poke = [];
if (mode === "cpu") {
  S.BATTLE = "cpu_long"; if (S.DUEL_TURNS) S.BATTLE_TURNS = S.DUEL_TURNS;
  poke.push([PR(64) + 0x21, 100], [PR(64) + 0x23, 100], [PR(hero) + 0x21, 1]);
} else if (mode === "tail") {                                      // 砲击路线的设置 (主角的船 水手 200 …), 按键整段换成 S.DUEL_TAIL
  S.BATTLE = "gun_duel"; S.BATTLE_TAIL_FULL = S.DUEL_TAIL || [];
}
S.BATTLE_POKE = [...poke, ...(S.DUEL_POKE || [])];
S.EXTRA_DS_MORE = [[0x9d44, 0x9d5a], [0x9f5e, 0x9fbe], [0xa01e, 0xa02c]];
S.DUEL_PROBES = [{ name: "11a4c", ip: 0x11b49 }, { name: "11b4d", ip: 0x11cb3 }];   // 一骑打每次画到画面上之后的快照 (11a4c / 11b4d 的 03d2 之后)
S.DUEL_HERO = hero;
})();
