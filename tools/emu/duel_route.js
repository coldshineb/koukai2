// duel_route.js — 一騎打 (12998 以下, scenes/duel.js; docs/RE_NOTES.md 30.16..30.18) 的差分測試設定:
//   依序執行 本檔 → battle_route.js → sea_depart_route.js → port_tests.js
// 都以 battle_route.js 的海戰開始 (里斯本出港, 艦隊 65 = 指揮者 人物 64、海盜, 在主角旁邊)。比對時另加一騎打的 DS 工作區 (S.EXTRA_DS_MORE):
//   9d44..9d59 (雙方、出招歷史、位置、攻方、dx / dy)、9f5e..9fbd (精靈畫布的格表)、a01e..a02b (雙方裝備); [9c2a] 已在 battle_route 的比對範圍
//   S.DUEL = "cpu"   電腦發起 (e95e → 0fea:2d1a(0, T)): battle_route 的 cpu_long (主角每回合停船), 人物 64 的 +21 / +23 = 100、主角 +21 = 1,
//                    電腦方旗艦接舷主角旗艦時轉為一騎打; 一騎打中的選單由 cpu_long 原本的按鍵 (↓ × 5、Enter、Enter) 選招
//   S.DUEL_TURNS     cpu 的回合數 (battle_route 的 S.BATTLE_TURNS)
//   S.DUEL_TAIL      "tail" 模式: 指令選單之後的按鍵 (玩家發起: 攻擊 → 選敵方旗艦 → 0x302 是 → 一騎打)
//   S.DUEL_POKE      額外寫入
"use strict";
(function () {
const S = session;
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const hero = at(0x12b5), PR = n => 0x12b6 + 0x32 * n;
const mode = S.DUEL || "cpu", poke = [];
if (mode === "cpu") {
  S.BATTLE = "cpu_long"; if (S.DUEL_TURNS) S.BATTLE_TURNS = S.DUEL_TURNS;
  poke.push([PR(64) + 0x21, 100], [PR(64) + 0x23, 100], [PR(hero) + 0x21, 1]);
} else if (mode === "tail") {                                      // 砲擊路線的設定 (主角的船 水手 200 …), 按鍵整段換成 S.DUEL_TAIL
  S.BATTLE = "gun_duel"; S.BATTLE_TAIL_FULL = S.DUEL_TAIL || [];
}
S.BATTLE_POKE = [...poke, ...(S.DUEL_POKE || [])];
S.EXTRA_DS_MORE = [[0x9d44, 0x9d5a], [0x9f5e, 0x9fbe], [0xa01e, 0xa02c]];
S.DUEL_PROBES = [{ name: "11a4c", ip: 0x11b49 }, { name: "11b4d", ip: 0x11cb3 }];   // 一騎打每次畫到畫面上之後的快照 (11a4c / 11b4d 的 03d2 之後)
S.DUEL_HERO = hero;
})();
