// portmove_route.js — 擴充功能「港內移動」(非原版, 仿外傳; scenes/portmove.js, RE_NOTES 第 33 節) 的測試設定 (先執行本檔, 再執行 port_tests.js)
//
// 一、一致性 (S.PM_DOOR = 入口編號): 原版沒有這個功能, 改成比較「瞬移 + 原版進門流程」與「原版直接把主角寫到門口 + 原版進門流程」。
//   兩邊都從同一位置開始, 送出第一個方向鍵 (↑) 時:
//     原版: 走路迴圈呼叫 66be (移動) 的那一刻, 改成寫入主角/視窗 (DS:0cb4..0cba, [bdba], 規則同 PortMove.teleport), 再跳到 1b1a3 (重畫, retf 回到走路迴圈) → 1b6ba 進門
//     移植版: 同一次 move() 改成呼叫 PortMove.teleport() → 原版流程 tryEnter (1b6ba)
//   之後的按鍵 (建築內、出門、再走幾步) 兩邊照常執行, 每次送鍵比對畫面、調色盤、亂數、狀態。
//   S.PM_NPC = 行人編號: 瞬移那一刻兩邊同時把這個行人寫到門口那一格 (主角與行人重疊)
//
// 二、移植版自測 (S.PM_ENABLE = 1): 移植版開啟擴充 (ctx.portMove), 用 F4 → 第 7 項打開設施清單; 原版沒有這個功能, 畫面從 F4 之後就不同 (預期)。
//   清單內容記錄在 S.pmLog (每次打開清單一筆: [{ k, ok }])
//
// S.PM_MODE:
//   "market"     里斯本 白天 0x20: 造船廠門下 → 瞬移 交易所 (0) → 選單 Esc → 出門 → 走 4 步
//   "tavern"     里斯本 夜間 0x40: → 瞬移 酒館 (1) → Esc × 3 → 走 3 步
//   "closed"     塞維爾 白天 0x20: 碼頭門下 → 瞬移 占卜師 (11, 0x30 前關門) → 關門訊息 → 停在門口 → 走 3 步
//   "overlap"    港 2 白天 0x20: 碼頭門下 → 瞬移 造船廠 (2), 行人 0 站在門口 → 進門 → Esc → 出門 → 走 5 步
//   "overlap_closed" 港 2 白天 0x10: 瞬移 酒館 (1, 0x18 前關門), 行人 0 站在門口 → 關門 → 停在門口 (原版: 主角與行人互卡; 移植版先把行人挪開) → 走 5 步
//   "event"      里斯本 劇本開啟 (約翰開場): 交易所門下 → 瞬移 教會 (10) → 主教劇情 Enter × 40 → ↓
//   "menu"       (自測) 里斯本 白天: F4 → 港內移動 → 清單 → Esc (回到航海術選單) → Esc
//   "guard"      (自測) 里斯本 白天: 主角在碼頭門下, 3 名衛兵 (站立種類 2) 照 8b3b 的位置圍住 → F4 → 港內移動 (只有「港」能選) → 選「港」→ 瞬移進碼頭 → Esc
//   "guard_door" (自測) 里斯本 白天: 1 名衛兵站在交易所門右下 (x+1, y+1) → F4 → 港內移動 (交易所灰) → Esc → Esc
//   "night_guard"(自測) 里斯本 夜間 0x40: 同 guard 的 3 名衛兵 → 清單全部可選 (夜間沒有碰撞)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f4: [0x3e, 0] };
const DOORS = {
  0: [[41, 59], [54, 34], [79, 64], [54, 67], [36, 46], [48, 7], [38, 35], [69, 49], [31, 59], [14, 47], [12, 62]],
  1: [[65, 56], [17, 57], [72, 67], [42, 67], [27, 57], [48, 8], [41, 57], [83, 8], [25, 43], [12, 43], [60, 43], [79, 56]],
  2: [[63, 46], [60, 58], [64, 69], [75, 52], [44, 70], [32, 15], [46, 46], [11, 46], [12, 58], [14, 70], [28, 66], [31, 49]] };
const clamp = v => Math.max(0, Math.min(0x48, v));
const below = (port, k) => { const [dx, dy] = DOORS[port][k], vx = clamp(dx - 12), vy = clamp(dy - 13); return { vx, vy, hx: dx - vx, hy: dy + 1 - vy }; };
const D = n => Array(n).fill(K.down), E = n => Array(n).fill(K.enter), NAV = [K.f4, ...D(6), K.enter];
const mode = S.PM_MODE || "market";
const poke = [...(S.PM_POKE || [])];
const npcAt = (i, x, y, d) => poke.push([0x0cbc + i * 3, x], [0x0cbd + i * 3, y], [0x0cbe + i * 3, d]);
let setup, keys, door, npc, ev = 0, enable = 0;
switch (mode) {
  case "market":   setup = { port: 0, ...below(0, 2), time: 0x20 }; door = 0; keys = [K.up, K.esc, K.esc, K.down, K.down, K.left, K.right]; break;
  case "tavern":   setup = { port: 0, ...below(0, 3), time: 0x40 }; door = 1; keys = [K.up, K.esc, K.esc, K.esc, K.down, K.down, K.left]; break;
  case "closed":   setup = { port: 1, ...below(1, 3), time: 0x20 }; door = 11; keys = [K.up, K.enter, K.down, K.down, K.left]; break;
  case "overlap":  setup = { port: 2, ...below(2, 3), time: 0x20 }; door = 2; npc = 0; keys = [K.up, K.esc, K.esc, K.down, K.down, K.left, K.left, K.up]; break;
  case "overlap_closed": setup = { port: 2, ...below(2, 3), time: 0x10 }; door = 1; npc = 0; keys = [K.up, K.enter, K.down, K.down, K.left, K.right, K.up]; break;
  case "event":    setup = { port: 0, ...below(0, 0) }; door = 10; ev = 1; keys = [K.up, ...E(40), K.down]; break;
  case "menu":     setup = { port: 0, ...below(0, 3), time: 0x20 }; enable = 1; keys = [...NAV, K.esc, K.esc, K.down]; break;
  case "guard": {
    setup = { port: 0, ...below(0, 3), time: 0x20 }; enable = 1;
    const [wx, wy] = DOORS[0][3];
    npcAt(4, wx - 2, wy + 2, 2); npcAt(5, wx, wy + 3, 2); npcAt(6, wx + 2, wy + 2, 2);     // 8b3b 的 3 名衛兵
    keys = [...NAV, K.down, K.down, K.down, K.enter, K.esc, K.esc, K.down]; break;      // 清單第 4 項「港」→ 瞬移進碼頭 → Esc
  }
  case "guard_door": {
    setup = { port: 0, ...below(0, 3), time: 0x20 }; enable = 1;
    const [mx, my] = DOORS[0][0]; npcAt(4, mx + 1, my + 1, 2);
    keys = [...NAV, K.enter, K.esc, K.esc, K.down]; break;                                   // 清單第 1 項 (交易所) 是灰的: Enter 沒反應
  }
  case "night_guard": {
    setup = { port: 0, ...below(0, 3), time: 0x40 }; enable = 1;
    const [wx, wy] = DOORS[0][3];
    npcAt(4, wx - 2, wy + 2, 2); npcAt(5, wx, wy + 3, 2); npcAt(6, wx + 2, wy + 2, 2);
    keys = [...NAV, K.esc, K.esc, K.down]; break;
  }
  default: throw new Error("PM_MODE " + mode);
}
setup.poke = poke;
S.PORT_SETUP = setup;
S.PORT_KEYS = S.PM_KEYS || keys;
S.NO_EVENTS = ev ? 0 : 1;
S.PM_DOOR = door; S.PM_NPC = npc;
const U = S.UI;
// 移植版: 擴充開關 (只在自測開啟) 與清單記錄
S._pmWalk0 ??= U.PortScene.prototype.walk;
U.PortScene.prototype.walk = function () { this.c.portMove = !!enable; return S._pmWalk0.call(this); };
S._pmFac0 ??= U.PortMove.facilities;
S.pmLog = [];
U.PortMove.facilities = function (p) { const r = S._pmFac0.call(this, p); S.pmLog.push(r.map(e => ({ k: e.k, ok: e.ok }))); return r; };
// 一致性: 第一次 move() → 瞬移
S._pmMove0 ??= U.PortScene.prototype.move;
let armedJ = door !== undefined;
U.PortScene.prototype.move = async function (dir) {
  if (!armedJ) return S._pmMove0.call(this, dir);
  armedJ = false;
  if (npc !== undefined) { const [x, y] = [this.door[door * 2], this.door[door * 2 + 1]]; this.setNpc(npc, 0, x); this.setNpc(npc, 1, y); }
  U.PortMove.teleport(this, door);
  return 1;
};
// 原版: 第一次 66be → 寫入主角/視窗 → 1b1a3 (0fea:b303)
let armedE = door !== undefined;
S.EMU_TICK = armedE ? (cpu, ip) => {
  if (!armedE || ip !== 0x66be) return;
  armedE = false;
  const d = cpu.s[3] * 16, m = cpu.mem, w16 = (o, v) => { m[d + o] = v & 255; m[d + o + 1] = (v >> 8) & 255; };
  const ex = m[d + 0x0904 + door * 2], ey = m[d + 0x0905 + door * 2];
  if (npc !== undefined) { m[d + 0x0cbc + npc * 3] = ex; m[d + 0x0cbd + npc * 3] = ey; }
  const vx = clamp(ex - 12), vy = clamp(ey - 13);
  w16(0x0cb4, vx); w16(0x0cb6, vy); w16(0x0cb8, ex - vx); w16(0x0cba, ey - vy); w16(0xbdba, vy * 96 + vx);
  cpu.s[1] = cpu.s[1] + 0x0fea; cpu.ip = 0xb303;                        // 66be 在 seg0; 1b1a3 = 0fea:b303, 堆疊上是走路迴圈的 far 返回位址
} : undefined;
})();
