// palace_route.js — 王宮 (1fd9:acda = 2aa6a) 差分測試設定 (先執行本檔, 再執行 port_tests.js)
// 里斯本王宮入口 (48,7): 視窗 (36,0), 主角 (12,8); 塞維爾王宮 (48,8): 視窗 (36,0), 主角 (12,9); 時刻 0x18
// S.PALACE_MODE:
//   "commoner"   爵位 0 的本國平民 ([0d62] & 6 = 0) → 0x54 → 離開
//   "main"       爵位 1, 葡萄牙 資金援助 5 千、援助船 1 艘 (船型 2), 現金 3000:
//                晉見國王 → 勢力狀況 (同盟港數、歐洲 → 港口表 + 收益、新大陸 → 沒有港口) → 私掠許可証 (海盜名聲不足 0x363)
//                → (改寫海盜名聲 2000) 私掠許可証 (取得) → 私掠許可証 (已有 0x360) → 免稅証 (6 萬, 錢不夠 0x36e) → (改寫現金 10 萬) 免稅証 (取得)
//                → 資金援助 (5000) → 資金援助 (沒有了 0x1cd) → 船舶援助 (船員 8 當船長; 船名鍵盤 1 字) → 船舶援助 (0x1cd) → 離開
//   "naturalize" 塞維爾, 爵位 2 (外國人): 晉見國王 (私掠許可証停用) → 勢力狀況 東亞 (沒有港口 0x1c7) → 申請國籍 否 → 申請國籍 是 (國籍改為西班牙) → 資金援助 → 離開
//   "arrest"     里斯本, 對葡萄牙聲望 0、主角 +21 = 0 → 0x1bb → 被抓 (沒收 4/5 現金與存款, 聲望 = 100)
//   "escape"     同上但主角 +21 = 200 → 逃脫 (0x1be → 0x1c0)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const poke = [], w16 = (a, v) => poke.push([a, v & 255], [a + 1, (v >> 8) & 255]);
const mode = S.PALACE_MODE || "main";
const money = mode.match(/arrest|escape/) ? 10000 : 3000; w16(0x12ae, money & 0xffff); w16(0x12b0, money >>> 16);
const HD = 0x125a, H = 0x12b6, N = n => 0x117a + n * 0x20;
if (mode === "main") {
  poke.push([HD + 0x0d, 1], [N(0) + 5, 5], [N(0) + 7, 2], [N(0) + 8, 1]);
  poke.push([0x2e1b, 8], [H + 8 * 0x32 + 0x2e, 3]);                // 船員 8 (職務 3) 可當船長; 主角 0 會被空船位的船長欄 (= 0) 當成已擔任船長 (原版如此)
}
if (mode === "naturalize") poke.push([HD + 0x0d, 2]);
if (mode === "arrest" || mode === "escape") { poke.push([HD + 6, 0], [H + 0x21, mode === "arrest" ? 0 : 200]); w16(0x12b2, 50); poke.push([0x12b4, 7]); }
for (const [a, v] of S.PALACE_POKE || []) poke.push([a, v]);
const E = K.enter, D = K.down, X = K.esc, L = K.left;
const NAME = [X, E, X, L, L, D, D, E];                              // 鍵盤: Esc 到字表 → 第 1 字 → Esc → 「結束」→「決定」
const MAIN = [E,                                                   // 0x1bc ▽
  E, E, E, E, E, E, D, E, E, D, D, D, D, D, E, E, X, E,            // 晉見國王 → 勢力狀況: 0x1c5 ▽ 0x373 ▽ 歐洲 → 收益 ▽ → 新大陸 (航路中斷 0x1c8) ▽ → 東亞 (沒有港口 0x1c7) ▽ → Esc → 0x1c6 ▽
  D, E, E, E,                                                      // 私掠許可証 → 0x362 ▽ → 0x363 ▽
  D, E, E, E, E, E,                                                // 私掠許可証 → 0x362 ▽ 0x365 ▽ 0x366 ▽ 0x367 ▽
  D, E, E,                                                         // 私掠許可証 → 0x360 ▽
  D, D, E, E, E, E, E, E, E,                                       // 免稅証 → 0x369 ▽ 0x36b 是 0x365 ▽ 0x36c ▽ 0x36d 是 → 0x36e ▽
  D, D, E, E, E, E, E, E, E,                                       // 免稅証 → … 0x36d 是 → 0x367 ▽
  X,
  D, D, E, E, E, D, D, E, E,                                       // 資金援助 ×2
  D, D, D, E, E, ...NAME, E, E,                                    // 船舶援助 → 0x1d0 ▽ → 船名 → 0x228 ▽ → 0x1cf ▽
  D, D, D, E, E,                                                   // 船舶援助 → 0x1cd ▽
  X, D];
const KEYS = {
  commoner: [E, D],
  main: MAIN,
  naturalize: [E, E, E, E, E, D, D, D, D, D, D, D, E, E, X, E, X, D, E, E, X, E, D, E, E, E, E, D, D, E, E, X, D],
  arrest: [E, E, E, E, E, E, D],
  escape: [E, E, E, D],
};
S.PORT_SETUP = mode === "naturalize" ? { port: 1, vx: 36, vy: 0, hx: 12, hy: 9, time: 0x18, poke } : { port: 0, vx: 36, vy: 0, hx: 12, hy: 8, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.PALACE_KEYS || KEYS[mode])];
S.TELEPORT = undefined;
if (mode === "main") {                                               // 第 2 次私掠許可証 / 第 2 次免稅証 之前改寫
  const B = 11 + 1, idx = (from, n) => { let c = 0; for (let i = from; i < MAIN.length; i++) if (MAIN[i] === D && MAIN[i - 1] !== D && ++c === n) return i; };
  const p2 = idx(12, 2), p5 = idx(12, 5);
  S.TELEPORT = { [B + p2]: [[HD + 2, 2000 & 255], [HD + 3, 2000 >> 8]], [B + p5]: [[0x12ae, 100000 & 255], [0x12af, (100000 >> 8) & 255], [0x12b0, 100000 >> 16]] };
}
S.NO_EVENTS = 1;
})();
