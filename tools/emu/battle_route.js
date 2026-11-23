// battle_route.js — 海戰 (10f7e, scenes/battle.js) 的差分測試設定: 依序執行 本檔 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船); 艦隊 65 (指揮者 人物 64, 海盜) 移到主角旁 (119, 357) (兩邊同時), 進港時刻 0x18。
// 命令 → 戰鬥 → 清單 (Enter) → 人物資料 是 → 10f7e: 開戰 (fcf9: 淡出、編成、戰場、f972 對話 0x32b / 0x32d) → 主迴圈 → 主角旗艦的指令選單 (b8b1)
//   S.BATTLE = "open"   對話後停在指令選單 (之後的空動作數 S.BATTLE_IDLE, 預設 4)
//              "stop"   指令選單 → ↓ × 5 停船 → 0x307 是否 → → 否 → 回到指令選單 (b6f2 / bca4)
//              "tail"   指令選單之後接 S.BATTLE_TAIL 的按鍵 (移動 / 攻擊等路線, 見 docs/RE_NOTES.md 30.6 起的驗證)
// 比對: 存檔區 + 海戰的 DS 工作區 (S.EXTRA_DS: 8e14..97d4 戰場地圖、97e0..9bfe 各方 / 船 / 變數、9c2a..9c2d、9d3e..9d44 戰力);
//   97d4..97df (三個戰場緩衝的遠指標, 值是原版的段位址) 不比; 調色盤只比前 8 色 (S.DAC_N; 16ee 的循環由 IRQ0 驅動)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f3: [0x3d, 0] };
const E = K.enter, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v]), w16 = (a, v) => { b(a, v & 255); b(a + 1, (v >> 8) & 255); };
let mode = S.BATTLE || "open", preset = [], tail = S.BATTLE_TAIL;
// 砲擊路線 (RE_NOTES 30.8): 主角的船 水手 200、10 門砲、船位 +8 = 0x11 (射程 3)、耐久 50 / 50、轉向 120、推進 60、+6 = 100; 艦隊 65 移到與主角同一點 (118, 358)
//   指令選單 → 移動: 左上 1 步 → 轉向上 → 上 3 步 (移動力用完, 直接問 0x300) → 是 → 走到 (25, 20) → 攻擊 0x304: 選 (22, 19) 的敵方旗艦 → e8cc 砲擊
//   "gun_hit" 命中; "gun_sink" 目標 (艦隊 65 船位 0) 耐久 3 → 擊沉, 經驗 900 (等級 1 → 5); "gun_unmanned" 目標水手 2 → 無人船
//   砲擊之後下一次等待輸入前電腦方已經行動, 所以另以快照 S.PROBES (原版 e91a = e8cc 結束) 比對砲擊剛結束時的狀態、亂數與畫面
if (/^gun_/.test(mode)) {
  const SL = 0x2e76 + 0x2b, M = 0x52d4, Fs0 = 0x2e76 + 0x85 * 65 + 0x2b;
  preset = [[SL + 8, 0x11], [M + 6, 10], [M + 7, 0], [SL + 2, 50], [SL + 3, 50], [SL + 4, 120], [SL + 5, 60], [SL + 6, 100], [SL, 200], [SL + 1, 0],
    ...(mode === "gun_sink" ? [[Fs0 + 2, 3]] : mode === "gun_unmanned" ? [[Fs0, 2], [Fs0 + 1, 0]] : [])];
  tail = ["enter", "l", "up", "enter", "up", "enter", "up", "enter", "up", "enter", "enter", "l", "l", "l", "up", "enter", "i", "i", "i", "i"];
  S.PROBES = [{ name: "e8cc", ip: 0xe91a }];
  mode = "tail";
}
const F = 0x2e76 + 0x85 * 65;
if (/^gun_/.test(S.BATTLE || "")) { w16(F, 118); w16(F + 2, 358); } else { w16(F, 119); w16(F + 2, 357); }
const open = [...idle(2), K.f3, ...idle(2), K.down, K.down, E, E, E];   // 命令 → 戰鬥 → 清單第 1 項 → 是
let keys;
const K2 = { right: [0x4d, 0] };
if (mode === "open") keys = [...open, E, E, ...idle(S.BATTLE_IDLE ?? 4)];
else if (mode === "stop") keys = [...open, E, E, ...idle(2), K.down, K.down, K.down, K.down, K.down, E, ...idle(1), K2.right, E, ...idle(3)];
else if (mode === "tail") keys = [...open, E, E, ...idle(2), ...tail.map(k => typeof k === "string" ? (k[0] === "i" ? { mouse: {} } : { ...K, ...K2, l: [0x4b, 0] }[k]) : k)];   // S.BATTLE_TAIL: 指令選單之後的按鍵 ("down"/"up"/"right"/"l"(左)/"enter"/"esc"/"i" 空動作)
for (const [a, v] of [...preset, ...(S.BATTLE_POKE || [])]) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.BATTLE_KEYS || keys; S.SEA_TIME = S.BATTLE_TIME ?? 0x18;
S.EXTRA_DS = [[0x8e14, 0x97d4], [0x97e0, 0x9bfe], [0x9c2a, 0x9c2e], [0x9d3e, 0x9d44]];   // 9bfe..9c29 / 9c2e..9d2f 是 MAIN.EXE 的常數 (移植版在開戰時才建立 DS 鏡像)
S.DAC_N = 8;
})();
