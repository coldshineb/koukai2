// opening_route.js — 约翰开场剧情的完整差分测试路线 (RE_NOTES 37): 从标题画面「开始新航海」选约翰, 不写入任何内存、不瞬移,
//   在里斯本照剧本走完 (住宅 公爵 → 教会 恩里克 → 酒馆 1000 金币 → 造船厂 船命名 → 教会 主教 1000 金币 → 消磨时间到夜里 → 住宅 公爵夫人 纯银头饰
//   → 旅馆就寝 → 道具店卖头饰 → 码头 洛克 (请恩里克当会计) → 补给 水 30 / 食物 20 → 酒馆雇 20 名水手 → 码头出航), 出港往西航行,
//   第 1 天 (港 0xa0 = 出港天数) 剧本进入第 1 节、第 3 天多明戈搭船 → 第 1 章, 之后再航行一段。按键由 tools/emu/explore.js 在原版上探索得到。
//   S.OPEN_TO = n: 只送前 n 个按键 (分段比对用); 默认全部
//   S.OPEN_HERO = 1..5: 改走其他主角开场的第一段剧情 (新游戏 → 进港 → 第一段剧本对话结束, 再走出建筑):
//     1 卡塔莉娜 (塞维尔): 码头 (桑多中尉来找你) → 酒馆 (酒馆老板)  2 奥托 (伦敦): 王宫 (亨利 8 世, 授予士爵)
//     3 恩斯特 (阿姆斯特丹): 住宅 (地理学家梅尔卡特, 给 5000 金币与船)  4 皮耶特罗 (热那亚): 酒馆 (酒馆老板)
//     5 阿里 (伊斯坦堡): 酒馆 (老板娘) → 造船厂 (朋友萨达姆)
//   全程 (约翰, 1936 键) 在云端沙盒要配合 S.SLICE_MS 分次运行 (port_tests.js), 见 RE_NOTES 37
//   记号: U D L R = 方向键, E = Enter, X = Esc, M = 空动作 (鼠标不动, 只让时间前进), #d = 数字键 d; 后面的数字 = 重复次数
"use strict";
(function () {
const S = session;
const ROUTE = "D E3 L2 E L2 E2 L3 U2 L2 U15 R8 U R12 U E33 D L D10 L17 D2 L39 U E17 X E R6 U15 R U12 R24 U R11 U E23 D4 R4 D11 R14 D6 R4 D10 R2 U R U E4 D L3 U5 L25 D2 L39 U E4 X E U E X E R6 U15 L4 U E5 X R4 D15 L6 U E X E R6 U15 L4 U E X R4 D15 L6 U E X E R6 U15 L4 U E X R4 D15 L6 U E X E R6 U15 L4 U E X R4 D15 L6 U E X E U E X E R6 U3 R28 U9 R11 U R12 U E17 L11 U3 L22 U E D2 E D L22 U E D E3 X2 R22 D R13 D17 R2 D2 R3 U E22 D E2 #3 #0 E R E #2 #0 E X2 L3 U2 L2 U20 R U11 R4 U E6 #2 #0 E2 #2 #0 E2 X2 D7 L3 D21 L2 D3 R2 D2 R3 U E2 #4 M750 E17 M150";
const HERO_ROUTES = {
  1: "D E R E2 L2 E L2 E2 U E3 X R3 U8 L U D2 U L8 D U L19 U3 E3 X",
  2: "D E R2 E2 L2 E L2 E2 L3 U4 L U L U L4 U L16 U39 L U E34",
  3: "D E R3 E2 L2 E L2 E2 R5 U26 R15 U2 R8 U E34",
  4: "D E R4 E2 L2 E L2 E2 L3 U9 R9 U R D E L R D3 R U2 R4 U R U10 R20 D3 R4 U E2",
  5: "D E R5 E2 L2 E L2 E2 L D U D3 U D4 L U6 D8 L13 U3 E3 D11 R4 U E36",
};
const K = { U: [0x48, 0], D: [0x50, 0], L: [0x4b, 0], R: [0x4d, 0], E: [0x1c, 0x0d], X: [0x01, 0x1b] };
const keys = [];
for (const t of (S.OPEN_HERO ? HERO_ROUTES[S.OPEN_HERO] : ROUTE).split(" ")) {
  if (t[0] === "#") { const d = t.charCodeAt(1); keys.push([d === 0x30 ? 0x0b : d - 0x2f, d]); continue; }
  const n = t.length > 1 ? +t.slice(1) : 1;
  for (let i = 0; i < n; i++) keys.push(t[0] === "M" ? { mouse: {} } : K[t[0]]);
}
S.OPENING_KEYS = keys;
const all = keys.slice(0, S.OPEN_TO ?? keys.length);
S.NEWGAME = all.slice(0, 11 + (S.OPEN_HERO || 0));
S.PORT_KEYS = all.slice(11);
S.NO_EVENTS = 0;
S.FB_HASH ??= 25;
S.EMU_MS ??= 1500000;
})();
