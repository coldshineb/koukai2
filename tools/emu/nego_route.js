// nego_route.js — 海上 命令 交涉 (20a6d → 20127 / 2614f) 的差分測試設定: 依序執行 本檔 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船); 艦隊 65 (指揮者 人物 64, 國籍 6) 移到主角旁 (119, 357), 任務 +1b / 對象 +1c 依 S.NEGO 寫入 (兩邊同時)。
//   "n8"      任務 8 → 0x9e (回傳 1: 回到清單) → 再選一次 → 0x9e → Esc (清單) → Esc (命令選單)
//   "nff"     任務 0xff → 0xd8「我是%s的%s」(國名 DS:08de[6]) → Esc → Esc
//   "n1"      任務 1、對象港 45 → 0x99 (港名)
//   "n5"      任務 5、對象 人物 9 (不是主角) → 0x9d (人物 9 的國名、名)
//   "map"     工作中 ([0d5e] = 1, [0d74] = 0x0b, [0d8a] = 64, [0d8c] = 0x5a): 2614f → 0x25c → 0x25d 是 → 0x25e → 隨身物 0x50、現金 −1000
//   "mapno"   同上, 0x25d 選否 (Esc)
//   "maphave" 隨身物已有 0x50 → 0x36f
//   "mappoor" 現金 500 → 0x25f
//   "n3" / "n4" / "n11"  任務 3 / 4 / 11 → 0x9b / 0x9c / 0xa1 → 談完直接開戰 navalBattle(對方, 主角) (對方發起: fa5b 開戰對話 → 交戰 / 撤離 / 投降)
//             之後的按鍵 S.NEGO_TAIL (預設: 0x331 等 → 交戰 → 指令選單後空動作); S.NEGO_FLEET = 艦隊編號 (預設 65 海盜; 非海盜時 fa5b 走 0x332 / 0x333)
//             比對另加海戰的 DS 工作區 (同 battle_route.js)
"use strict";
(function () {
const S = session;
const K = { down: [0x50, 0], up: [0x48, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], f3: [0x3d, 0] };
const E = K.enter, X = K.esc, idle = n => Array(n).fill({ mouse: {} });
const poke = [], b = (a, v) => poke.push([a, v]), w16 = (a, v) => { b(a, v & 255); b(a + 1, (v >> 8) & 255); };
const inv = list => { for (let i = 0; i < 20; i++) b(0x2e57 + i, i < list.length ? list[i] : 0xff); };
const mode = S.NEGO || "n8";
const FN = S.NEGO_FLEET ?? 65, F = 0x2e76 + 0x85 * FN;
w16(F, 119); w16(F + 2, 357);
const task = { n8: 8, nff: 0xff, n1: 1, n5: 5, n3: 3, n4: 4, n11: 11 }[mode] ?? 0;
b(F + 0x1b, task);
if (mode === "n1") b(F + 0x1c, 45);
if (mode === "n5") b(F + 0x1c, 9);
const open = [...idle(2), K.f3, ...idle(2), K.down, E];          // 命令 → 交涉
let keys;
if (mode === "n8") keys = [...open, E, E, E, E, X, X, ...idle(2)];
else if (mode === "nff" || mode === "n1" || mode === "n5") keys = [...open, E, E, X, X, ...idle(2)];
else if (mode === "n3" || mode === "n4" || mode === "n11") {
  const T = { down: K.down, up: K.up, enter: E, esc: X, l: [0x4b, 0], right: [0x4d, 0] };
  const tail = (S.NEGO_TAIL || ["enter", "i", "enter", "i", "i", "i", "i"]).map(k => k === "i" ? { mouse: {} } : T[k]);
  keys = [...open, E, E, ...tail];                                         // 清單第 1 項 → 任務的台詞 (等待) → 海戰
  S.EXTRA_DS = [[0x8e14, 0x97d4], [0x97e0, 0x9bfe], [0x9c2a, 0x9c2e], [0x9d3e, 0x9d44]]; S.DAC_N = 8;
}
else {
  b(0x0d5e, 1); w16(0x0d74, 0x0b); w16(0x0d8a, 64); w16(0x0d8c, 0x5a);
  inv(mode === "maphave" ? [0x50] : []);
  if (mode === "mappoor") w16(0x12ae, 500);
  keys = mode === "map" ? [...open, E, E, E, E, X, X, ...idle(2)]
    : mode === "mapno" ? [...open, E, E, X, X, X, ...idle(2)]
    : mode === "mappoor" ? [...open, E, E, E, E, X, X, ...idle(2)]
    : [...open, E, E, X, X, ...idle(2)];
}
for (const [a, v] of S.NEGO_POKE || []) b(a, v);
S.SEA_POKE = poke; S.SEA_KEYS = S.NEGO_KEYS || keys;
})();
