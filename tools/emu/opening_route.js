// opening_route.js — 約翰開場劇情的完整差分測試路線 (RE_NOTES 37): 從標題畫面「開始新航海」選約翰, 不寫入任何記憶體、不瞬移,
//   在里斯本照劇本走完 (住宅 公爵 → 教會 恩里克 → 酒館 1000 金幣 → 造船廠 船命名 → 教會 主教 1000 金幣 → 消磨時間到夜裡 → 住宅 公爵夫人 純銀頭飾
//   → 旅館就寢 → 道具店賣頭飾 → 碼頭 洛克 (請恩里克當會計) → 補給 水 30 / 食物 20 → 酒館雇 20 名水手 → 碼頭出航), 出港往西航行,
//   第 1 天 (港 0xa0 = 出港天數) 劇本進入第 1 節、第 3 天多明戈搭船 → 第 1 章, 之後再航行一段。按鍵由 tools/emu/explore.js 在原版上探索得到。
//   S.OPEN_TO = n: 只送前 n 個按鍵 (分段比對用); 預設全部
//   S.OPEN_HERO = 1..5: 改走其他主角開場的第一段劇情 (新遊戲 → 進港 → 第一段劇本對話結束, 再走出建築):
//     1 卡塔莉娜 (塞維爾): 碼頭 (桑多中尉來找你) → 酒館 (酒館老闆)  2 奧托 (倫敦): 王宮 (亨利 8 世, 授予士爵)
//     3 恩斯特 (阿姆斯特丹): 住宅 (地理學家梅爾卡特, 給 5000 金幣與船)  4 皮耶特羅 (熱那亞): 酒館 (酒館老闆)
//     5 阿里 (伊斯坦堡): 酒館 (老闆娘) → 造船廠 (朋友薩達姆)
//   全程 (約翰, 1936 鍵) 在雲端沙盒要配合 S.SLICE_MS 分次執行 (port_tests.js), 見 RE_NOTES 37
//   記號: U D L R = 方向鍵, E = Enter, X = Esc, M = 空動作 (滑鼠不動, 只讓時間前進), #d = 數字鍵 d; 後面的數字 = 重複次數
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
