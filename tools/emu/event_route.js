// event_route.js — 劇本事件差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 新遊戲 (約翰) → 里斯本港; 進港時把主角放到指定建築入口正下方, 往上走進去, 之後一直按 Enter 推進對話。
//   S.EVENT_BUILDING = 建築編號 (0 交易所 1 酒館 2 造船廠 3 碼頭 4 旅館 5 王宮 7 住宅 9 道具店 10 教會)
//   S.EVENT_ENTERS   = 進去之後按幾次 Enter (預設 40)
//   S.EVENT_TAIL     = 最後再送的按鍵 (預設 ↓)
//   S.EVENT_POKE     = 額外寫入 [[DS 位址, 值], ...]
//   S.EVENT_HERO     = 主角 (0 約翰 … 5; 預設 0): 主角選擇畫面先按 → 若干次 (S.NEWGAME 給 port_tests.js); 進港仍放到里斯本
// 入口座標 = ZA_DAT.DAT 里斯本 (DS:0904): 視窗左上 (vx, vy) 讓主角在視窗內 (12, 12) 一帶。
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d] };
const DOORS = [[41, 59], [54, 34], [79, 64], [54, 67], [36, 46], [48, 7], [38, 35], [69, 49], [31, 59], [14, 47], [12, 62]];
//   S.EVENT_SEQ = [[建築, Enter 次數], ...] 依序拜訪多棟建築 (第二棟起以 S.TELEPORT 在送出「↑」之前把主角移到門口下方)
const below = k => { const [dx, dy] = DOORS[k], vx = Math.max(0, Math.min(72, dx - 12)), vy = Math.max(0, Math.min(72, dy + 1 - 12));
  return { vx, vy, hx: dx - vx, hy: dy + 1 - vy }; };
const seq = S.EVENT_SEQ || [[S.EVENT_BUILDING ?? 10, S.EVENT_ENTERS ?? 40]];
const p0 = below(seq[0][0]);
S.PORT_SETUP = { port: 0, ...p0, poke: S.EVENT_POKE || [] };
S.PORT_KEYS = []; S.TELEPORT = {};
const hero = S.EVENT_HERO || 0;
S.NEWGAME = hero ? [K.down, K.enter, ...Array(hero).fill(K.right), K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter] : undefined;
const NEWGAME_KEYS = 11 + hero;
const w16 = (a, v) => [[a, v & 255], [a + 1, (v >> 8) & 255]];
seq.forEach(([k, n], i) => {
  if (i) { const p = below(k); S.TELEPORT[NEWGAME_KEYS + S.PORT_KEYS.length] = [...w16(0x0cb4, p.vx), ...w16(0x0cb6, p.vy), ...w16(0x0cb8, p.hx), ...w16(0x0cba, p.hy)]; }
  S.PORT_KEYS.push(K.up, ...Array(n).fill(K.enter));
});
S.PORT_KEYS.push(S.EVENT_TAIL || K.down);
S.NO_EVENTS = 0;
})();
