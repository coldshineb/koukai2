// cmd_nav_route.js — 港口指令按鈕「航海術」(1fd9:119e = 20f2e) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本 (與 market_route 相同位置), 進港時兩邊同時寫入隨身物 DS:2e57 (硬鎧已裝備)。
//   S.CMD_MODE = "items" (預設): F4 → 隨身物: 匕首 佩戴 / 硬鎧 除去 / 鎖子甲 佩戴 (換掉同類) / 懷錶 使用 (時刻) / 貓 使用 /
//                聖香油 使用 (用後消失, random(6)) / 王冠 使用 (用不了) / 王冠 佩戴 (不能裝備) / 私掠許可書 使用 (種類 8 編號外) → Esc → Esc
//   S.CMD_MODE = "func": F4 → 功能 → 環境設定 (表示效果 OFF, BGM OFF, 滑鼠 −/+ +, 海上移動值 +, 海上速度 +) → 儲存檔案 第 1 格 →
//                取出存檔 第 1 格 (讀檔後重新進港, 時間迴圈中止並從存檔日期重新開始) → F4 → 功能 → 結束遊戲 → 標題
//   S.CMD_MODE = "mouse": 滑鼠點四個指令按鈕
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b],
  f1: [0x3b, 0], f2: [0x3c, 0], f3: [0x3d, 0], f4: [0x3e, 0] };
const poke = [], b = (a, v) => poke.push([a, v]);
const inv = [0x00, 0x10, 0x11, 0x17, 0x19, 0x2a, 0x2c, 0x1d];
for (let i = 0; i < 20; i++) b(0x2e57 + i, i < inv.length ? inv[i] : 0xff);
b(0x8248 + 0x10 * 0x14 + 0x13, 0x16);                                     // 硬鎧 (種類 6) 已裝備
for (const [a, v] of S.CMD_POKE || []) b(a, v);
S.PORT_SETUP = { port: 0, vx: 30, vy: 48, hx: 11, hy: 12, poke };
const D = n => Array(n).fill(K.down), E = K.enter;
const pick = (n, use) => [...D(n), E, ...(use ? [K.down] : []), E, E];   // 清單第 n 項 → 佩戴 / 使用 → 等待
const ITEMS = [K.f4, ...D(4), E,
  ...pick(0, 0), ...pick(1, 0), ...pick(2, 0), ...pick(3, 1), ...pick(4, 1), ...pick(5, 1),
  ...pick(5, 1), ...pick(5, 0), ...pick(6, 1),
  K.esc, K.esc];
const FUNC = [K.f4, ...D(5), E,
  E, E, K.down, E, K.down, E, K.right, E, E, K.down, E, K.down, E, K.esc,      // 環境設定
  K.down, E, E, E,                                                            // 儲存檔案 → 第 1 格 → 是
  K.down, K.down, E, E, E,                                                    // 取出存檔 → 第 1 格 → 是
  K.f4, ...D(5), E, K.down, K.down, K.down, E, E,                            // 功能 → 結束遊戲 → 是
  K.down];
// "mouse": 以滑鼠依序點 航海術 / 情報 / 經營 / 命令 四個按鈕 (y 座標加 40 = 驅動座標), 各自 Esc 關閉
const M = (x, y, b) => ({ mouse: { x, y, b } }), click = y => [M(0x272, y + 40, 0), M(0x272, y + 40, 1), M(0x272, y + 40, 0), K.esc];
const MOUSE = [...click(0x160), ...click(0x70), ...click(0xc0), ...click(0x110)];
S.PORT_KEYS = S.CMD_KEYS || (S.CMD_MODE === "func" ? FUNC : S.CMD_MODE === "mouse" ? MOUSE : ITEMS);
S.NO_EVENTS = 1;
})();
