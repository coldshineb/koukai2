// title_settings_route.js — 標題選單「環境設定」(16ff2 → 1fd9:173f = 214cf) 差分測試設定 (先執行本檔, 再執行 port_tests.js; RE_NOTES 38.7)
//   標題選單 ↓ ↓ Enter → 環境設定視窗 (2 欄 10 項: 0/1 表示效果, 2/3 BGM, 4..9 滑鼠靈敏度 / 海上移動值 / 海上速度 的 − / +)
//   14524 以「保留游標」呼叫: 游標沿用標題選單的位置 (第 2 項 = BGM), 所以第一個 Enter 切的是 BGM (原版如此)。
//   實際走到 (以 [0ca4] / [0ca6] / [0ca8] / [0ca9] 確認): BGM 關 → 開 (213c5: 9888 + 9712(5) 等到停止 / 9670([8c1e]) 重播標題曲)、滑鼠靈敏度 2 → 1 → 0、
//   海上移動值 5 → 4 → 5 → 6、海上速度 5 → 6、表示效果 關、滑鼠點 海上速度 + (6 → 7) → Esc 回到標題選單 → 照常開始新航海 (port_tests.js 的 NEWGAME) 進港走兩步
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const E = K.enter, M = (x, y, b) => ({ mouse: { x, y: y + 40, b } });
const NEWGAME = [K.down, K.enter, K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter];   // port_tests.js 的預設
const SETTINGS = [K.down, K.down, E,
  E, E, K.down, E, K.right, E, E, K.down, E, K.down, K.left, E,   // 鍵盤巡覽 (實際效果見檔頭)
  M(395, 180, 0), M(395, 180, 1), M(395, 180, 0),   // 滑鼠點 海上速度 + (點擊區 x 0x188..0x198, y 0xb0..0xc0)
  K.esc];
S.NEWGAME = [...SETTINGS, ...NEWGAME];
S.PORT_KEYS = [K.left, K.right];
})();
