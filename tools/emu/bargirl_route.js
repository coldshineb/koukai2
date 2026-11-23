// bargirl_route.js — 酒館 酒吧女郎 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 進港時兩邊同時寫入: 現金 3000; 女郎記錄 0 (DS:2bde) 放在里斯本 (+0e = 0, +12 bit3), 好感 S.GIRL_FAV (預設 85), 性格 S.GIRL_LVL (預設 0);
//   發現物 2 / 7 設為已知未發現 (+6 bit5); 隨身物前兩格放入第一個種類 0x0a 與 0x0b 的道具
// S.GIRL_MODE: "all" (預設) 航海見聞 → 送她禮物 → 調查結果 (委託) → 探聽情報 (喜好 / 芳齡)
//              "report"  已委託且天數 0 → 調查報告 (葡萄牙 商船隊 1..4)
//              "poor"    現金 5 → 付不出 10
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const ng = require("fs").readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"), at = a => ng[a - 0x0ca4];
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.GIRL_MODE || "all";
w16(0x12ae, mode === "poor" ? 5 : 3000); w16(0x12b0, 0);
const G = 0x2bde, lvl = S.GIRL_LVL ?? 0;
poke.push([G + 0x0d, 22], [G + 0x0e, 0], [G + 0x0f, S.GIRL_FAV ?? 85], [G + 0x12, (at(G + 0x12) & 0x81 & ~0x40) | 0x08 | (lvl << 4)]);
if (mode === "report") poke.push([G + 0x10, 0x00], [G + 0x11, 0]); else poke.push([G + 0x10, 0xff], [G + 0x11, 0xff]);
for (const i of [2, 7]) { const d = 0x7f8c + i * 7 + 6; poke.push([d, (at(d) | 0x20) & 0x7f]); }
const pick = t => { for (let n = 0; n < 100; n++) if ((at(0x8248 + n * 0x14 + 0x13) & 0x0f) === t) return n; return 0xff; };
S.girlItems = [pick(0x0a), pick(0x0b)];
poke.push([0x2e57, S.girlItems[0]], [0x2e58, S.girlItems[1]]);
for (const [a, v] of S.GIRL_POKE || []) poke.push([a, v]);
S.PORT_SETUP = { port: 0, vx: 42, vy: 24, hx: 12, hy: 11, poke };
const E = n => Array(n).fill(K.enter), D = n => Array(n).fill(K.down);
const head = [K.up, K.enter, ...D(4), K.enter, K.enter];                 // 進酒館 → 酒吧女郎 → 付 10 的招呼
S.PORT_KEYS = S.GIRL_KEYS || (mode === "report" ? [...head, ...D(2), K.enter, ...E(14), K.esc, K.esc, K.esc, K.esc, K.down]
  : mode === "poor" ? [...head, K.enter, K.esc, K.down]
  : [...head,
     K.enter, K.enter, K.enter, K.enter,                                  // 航海見聞: 清單第 1 筆 → 資料視窗 → 0x139
     K.down, K.enter, K.enter, K.enter, K.enter, K.enter,                 // 送她禮物: 清單第 1 筆 → 是 → 0x141/0x142 → 0x145
     ...D(2), K.enter, K.enter, K.enter, K.enter,                         // 調查結果: 好感足夠 → 葡萄牙 → 商船 → 天數
     ...D(3), K.enter, K.down, K.enter, K.enter, K.down, K.enter, K.enter, K.esc,   // 探聽情報: 兩項 → 離開
     K.esc, K.esc, K.down]);
S.NO_EVENTS = 1;
})();
