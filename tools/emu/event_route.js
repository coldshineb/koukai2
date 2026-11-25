// event_route.js — 剧本事件差分测试设置 (先运行本档, 再运行 port_tests.js)
// 新游戏 (约翰) → 里斯本港; 进港时把主角放到指定建筑入口正下方, 往上走进去, 之后一直按 Enter 推进对话。
//   S.EVENT_BUILDING = 建筑编号 (0 交易所 1 酒馆 2 造船厂 3 码头 4 旅馆 5 王宫 7 住宅 9 道具店 10 教会)
//   S.EVENT_ENTERS   = 进去之后按几次 Enter (默认 40)
//   S.EVENT_TAIL     = 最后再送的按键 (默认 ↓)
//   S.EVENT_POKE     = 额外写入 [[DS 地址, 值], ...]
//   S.EVENT_HERO     = 主角 (0 约翰 … 5; 默认 0): 主角选择画面先按 → 若干次 (S.NEWGAME 给 port_tests.js); 进港仍放到里斯本
// 入口座标 = ZA_DAT.DAT 里斯本 (DS:0904): 窗口左上 (vx, vy) 让主角在窗口内 (12, 12) 一带。
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d] };
const DOORS = [[41, 59], [54, 34], [79, 64], [54, 67], [36, 46], [48, 7], [38, 35], [69, 49], [31, 59], [14, 47], [12, 62]];
//   S.EVENT_SEQ = [[建筑, Enter 次数], ...] 依序拜访多栋建筑 (第二栋起以 S.TELEPORT 在送出「↑」之前把主角移到门口下方)
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
