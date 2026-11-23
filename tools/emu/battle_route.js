// battle_route.js — 海戰 (10f7e, scenes/battle.js) 的差分測試設定: 依序執行 本檔 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船); 艦隊 65 (指揮者 人物 64, 海盜) 移到主角旁 (119, 357) (兩邊同時), 進港時刻 0x18。
// 命令 → 戰鬥 → 清單 (Enter) → 人物資料 是 → 10f7e: 開戰 (fcf9: 淡出、編成、戰場、f972 對話 0x32b / 0x32d) → 主迴圈 → 主角旗艦的指令選單 (b8b1)
//   S.BATTLE = "open"   對話後停在指令選單 (之後的空動作數 S.BATTLE_IDLE, 預設 4)
//              "stop"   指令選單 → ↓ × 5 停船 → 0x307 是否 → → 否 → 回到指令選單 (b6f2 / bca4)
// 比對: 存檔區 + 海戰的 DS 工作區 (S.EXTRA_DS: 8e14..97d4 戰場地圖、97e0..9bfe 各方 / 船 / 變數、9c2a..9c2d、9d3e..9d44 戰力);
//   97d4..97df (三個戰場緩衝的遠指標, 值是原版的段位址) 不比; 調色盤只比前 8 色 (S.DAC_N; 16ee 的循環由 IRQ0 驅動)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f3: [0x3d, 0] };
const E = K.enter, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v]), w16 = (a, v) => { b(a, v & 255); b(a + 1, (v >> 8) & 255); };
const mode = S.BATTLE || "open";
const F = 0x2e76 + 0x85 * 65;
w16(F, 119); w16(F + 2, 357);
const open = [...idle(2), K.f3, ...idle(2), K.down, K.down, E, E, E];   // 命令 → 戰鬥 → 清單第 1 項 → 是
let keys;
const K2 = { right: [0x4d, 0] };
if (mode === "open") keys = [...open, E, E, ...idle(S.BATTLE_IDLE ?? 4)];
else if (mode === "stop") keys = [...open, E, E, ...idle(2), K.down, K.down, K.down, K.down, K.down, E, ...idle(1), K2.right, E, ...idle(3)];
for (const [a, v] of S.BATTLE_POKE || []) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.BATTLE_KEYS || keys; S.SEA_TIME = S.BATTLE_TIME ?? 0x18;
S.EXTRA_DS = [[0x8e14, 0x97d4], [0x97e0, 0x9bfe], [0x9c2a, 0x9c2e], [0x9d3e, 0x9d44]];   // 9bfe..9c29 / 9c2e..9d2f 是 MAIN.EXE 的常數 (移植版在開戰時才建立 DS 鏡像)
S.DAC_N = 8;
})();
