// palace_route.js — 王宫 (1fd9:acda = 2aa6a) 差分测试设置 (先运行本档, 再运行 port_tests.js)
// 里斯本王宫入口 (48,7): 窗口 (36,0), 主角 (12,8); 塞维尔王宫 (48,8): 窗口 (36,0), 主角 (12,9); 时刻 0x18
// S.PALACE_MODE:
//   "commoner"   爵位 0 的本国平民 ([0d62] & 6 = 0) → 0x54 → 离开
//   "main"       爵位 1, 葡萄牙 资金援助 5 千、援助船 1 艘 (船型 2), 现金 3000:
//                晋见国王 → 势力状况 (同盟港数、欧洲 → 港口表 + 收益、新大陆 → 没有港口) → 私掠许可证 (海盗名声不足 0x363)
//                → (改写海盗名声 2000) 私掠许可证 (取得) → 私掠许可证 (已有 0x360) → 免税证 (6 万, 钱不够 0x36e) → (改写现金 10 万) 免税证 (取得)
//                → 资金援助 (5000) → 资金援助 (没有了 0x1cd) → 船舶援助 (船员 8 当船长; 船名键盘 1 字) → 船舶援助 (0x1cd) → 离开
//   "naturalize" 塞维尔, 爵位 2 (外国人): 晋见国王 (私掠许可证禁用) → 势力状况 东亚 (没有港口 0x1c7) → 申请国籍 否 → 申请国籍 是 (国籍改为西班牙) → 资金援助 → 离开
//   "arrest"     里斯本, 对葡萄牙声望 0、主角 +21 = 0 → 0x1bb → 被抓 (没收 4/5 现金与存款, 声望 = 100)
//   "escape"     同上但主角 +21 = 200 → 逃脱 (0x1be → 0x1c0)
//   "rank9"      里斯本, 爵位 9 且 [0ca4] bit1: 晋见国王后 2ac50 → 1764f(0x0f) 爵位 9 结局 (0x2ea ▽ → 保存进度 第 1 格 是 → 淡出 → INT 65h)
//                (晋见国王会停在势力状况的地区清单, 所以选资金援助)
//                原版运行到 17786 (INT 65h AH=01) 起记录 4 次 INT 65h 的值到 S.INT65 并结束; 移植版 game/endgame.js 以 MainExit 带出同样的值 (S.MAIN_EXIT)
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
  poke.push([0x2e1b, 8], [H + 8 * 0x32 + 0x2e, 3]);                // 船员 8 (职务 3) 可当船长; 主角 0 会被空船位的船长栏 (= 0) 当成已担任船长 (原版如此)
}
if (mode === "naturalize") poke.push([HD + 0x0d, 2]);
if (mode === "rank9") poke.push([HD + 0x0d, 9]);
if (mode === "arrest" || mode === "escape") { poke.push([HD + 6, 0], [H + 0x21, mode === "arrest" ? 0 : 200]); w16(0x12b2, 50); poke.push([0x12b4, 7]); }
for (const [a, v] of S.PALACE_POKE || []) poke.push([a, v]);
const E = K.enter, D = K.down, X = K.esc, L = K.left;
const NAME = [X, E, X, L, L, D, D, E];                              // 键盘: Esc 到字表 → 第 1 字 → Esc → 「结束」→「决定」
const MAIN = [E,                                                   // 0x1bc ▽
  E, E, E, E, E, E, D, E, E, D, D, D, D, D, E, E, X, E,            // 晋见国王 → 势力状况: 0x1c5 ▽ 0x373 ▽ 欧洲 → 收益 ▽ → 新大陆 (航路中断 0x1c8) ▽ → 东亚 (没有港口 0x1c7) ▽ → Esc → 0x1c6 ▽
  D, E, E, E,                                                      // 私掠许可证 → 0x362 ▽ → 0x363 ▽
  D, E, E, E, E, E,                                                // 私掠许可证 → 0x362 ▽ 0x365 ▽ 0x366 ▽ 0x367 ▽
  D, E, E,                                                         // 私掠许可证 → 0x360 ▽
  D, D, E, E, E, E, E, E, E,                                       // 免税证 → 0x369 ▽ 0x36b 是 0x365 ▽ 0x36c ▽ 0x36d 是 → 0x36e ▽
  D, D, E, E, E, E, E, E, E,                                       // 免税证 → … 0x36d 是 → 0x367 ▽
  X,
  D, D, E, E, E, D, D, E, E,                                       // 资金援助 ×2
  D, D, D, E, E, ...NAME, E, E,                                    // 船舶援助 → 0x1d0 ▽ → 船名 → 0x228 ▽ → 0x1cf ▽
  D, D, D, E, E,                                                   // 船舶援助 → 0x1cd ▽
  X, D];
const KEYS = {
  commoner: [E, D],
  main: MAIN,
  naturalize: [E, E, E, E, E, D, D, D, D, D, D, D, E, E, X, E, X, D, E, E, X, E, D, E, E, E, E, D, D, E, E, X, D],
  arrest: [E, E, E, E, E, E, D],
  escape: [E, E, E, D],
  rank9: [E, D, D, E, ...Array(20).fill(E)],                      // 0x1bc ▽ → 资金援助 → (消息 ▽) → 2ac50 结局: 0x2ea ▽ → 保存进度 第 1 格 → 是
};
S.PORT_SETUP = mode === "naturalize" ? { port: 1, vx: 36, vy: 0, hx: 12, hy: 9, time: 0x18, poke } : { port: 0, vx: 36, vy: 0, hx: 12, hy: 8, time: 0x18, poke };
S.PORT_KEYS = [K.up, ...(S.PALACE_KEYS || KEYS[mode])];
S.TELEPORT = undefined;
if (mode === "main") {                                               // 第 2 次私掠许可证 / 第 2 次免税证 之前改写
  const B = 11 + 1, idx = (from, n) => { let c = 0; for (let i = from; i < MAIN.length; i++) if (MAIN[i] === D && MAIN[i - 1] !== D && ++c === n) return i; };
  const p2 = idx(12, 2), p5 = idx(12, 5);
  S.TELEPORT = { [B + p2]: [[HD + 2, 2000 & 255], [HD + 3, 2000 >> 8]], [B + p5]: [[0x12ae, 100000 & 255], [0x12af, (100000 >> 8) & 255], [0x12b0, 100000 >> 16]] };
}
if (mode === "rank9") {
  S.PORT_SETUP.emuHook = (mem, d) => { mem[d + 0x0ca4] |= 2; };
  S.PORT_SETUP.jsHook = st => st.set8(0x0ca4, st.u8(0x0ca4) | 2);
  S.INT65 = []; S.MAIN_EXIT = null; S.EMU_DONE = false;
  S.EMU_TICK = Object.assign((cpu, a) => {
    if (a !== 0x17786 && a !== 0x1778e && a !== 0x17796 && a !== 0x1779e) return;
    const r = { ah: cpu.r[0] >> 8, bx: cpu.r[3] };
    if (a === 0x17786) { const p = cpu.r[1] * 16 + cpu.r[3]; r.str = Array.from(cpu.mem.slice(p, p + 0x15)); }
    S.INT65.push(r); if (a === 0x1779e) S.EMU_DONE = true;
  }, { palaceRank9: 1 });
} else if (S.EMU_TICK?.palaceRank9) { S.EMU_TICK = undefined; S.EMU_DONE = false; }   // 上一条 rank9 留下的设置
S.NO_EVENTS = 1;
})();
