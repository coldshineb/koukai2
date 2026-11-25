// title_settings_route.js — 标题菜单「环境设置」(16ff2 → 1fd9:173f = 214cf) 差分测试设置 (先运行本档, 再运行 port_tests.js; RE_NOTES 38.7)
//   标题菜单 ↓ ↓ Enter → 环境设置窗口 (2 栏 10 项: 0/1 表示效果, 2/3 BGM, 4..9 鼠标灵敏度 / 海上移动值 / 海上速度 的 − / +)
//   14524 以「保留光标」调用: 光标沿用标题菜单的位置 (第 2 项 = BGM), 所以第一个 Enter 切的是 BGM (原版如此)。
//   实际走到 (以 [0ca4] / [0ca6] / [0ca8] / [0ca9] 确认): BGM 关 → 开 (213c5: 9888 + 9712(5) 等到停止 / 9670([8c1e]) 重播标题曲)、鼠标灵敏度 2 → 1 → 0、
//   海上移动值 5 → 4 → 5 → 6、海上速度 5 → 6、表示效果 关、鼠标点 海上速度 + (6 → 7) → Esc 回到标题菜单 → 照常开始新航海 (port_tests.js 的 NEWGAME) 进港走两步
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const E = K.enter, M = (x, y, b) => ({ mouse: { x, y: y + 40, b } });
const NEWGAME = [K.down, K.enter, K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter];   // port_tests.js 的默认
const SETTINGS = [K.down, K.down, E,
  E, E, K.down, E, K.right, E, E, K.down, E, K.down, K.left, E,   // 键盘巡览 (实际效果见档头)
  M(395, 180, 0), M(395, 180, 1), M(395, 180, 0),   // 鼠标点 海上速度 + (点击区 x 0x188..0x198, y 0xb0..0xc0)
  K.esc];
S.NEWGAME = [...SETTINGS, ...NEWGAME];
S.PORT_KEYS = [K.left, K.right];
})();
