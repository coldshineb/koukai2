// nego_route.js — 海上 命令 交涉 (20a6d → 20127 / 2614f) 的差分测试设置: 依序运行 本档 → sea_depart_route.js → port_tests.js
// 以 sea_depart_route.js 出港 (里斯本, 一艘船); 舰队 65 (指挥者 人物 64, 国籍 6) 移到主角旁 (119, 357), 任务 +1b / 对象 +1c 依 S.NEGO 写入 (两边同时)。
//   "n8"      任务 8 → 0x9e (返回 1: 回到清单) → 再选一次 → 0x9e → Esc (清单) → Esc (命令菜单)
//   "nff"     任务 0xff → 0xd8「我是%s的%s」(国名 DS:08de[6]) → Esc → Esc
//   "n1"      任务 1、对象港 45 → 0x99 (港名)
//   "n5"      任务 5、对象 人物 9 (不是主角) → 0x9d (人物 9 的国名、名)
//   "map"     工作中 ([0d5e] = 1, [0d74] = 0x0b, [0d8a] = 64, [0d8c] = 0x5a): 2614f → 0x25c → 0x25d 是 → 0x25e → 随身物 0x50、现金 −1000
//   "mapno"   同上, 0x25d 选否 (Esc)
//   "maphave" 随身物已有 0x50 → 0x36f
//   "mappoor" 现金 500 → 0x25f
//   "n3" / "n4" / "n11"  任务 3 / 4 / 11 → 0x9b / 0x9c / 0xa1 → 谈完直接开战 navalBattle(对方, 主角) (对方发起: fa5b 开战对话 → 交战 / 撤离 / 投降)
//             之后的按键 S.NEGO_TAIL (默认: 0x331 等 → 交战 → 指令菜单后空动作); S.NEGO_FLEET = 舰队编号 (默认 65 海盗; 非海盗时 fa5b 走 0x332 / 0x333)
//             比对另加海战的 DS 工作区 (同 battle_route.js)
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
  keys = [...open, E, E, ...tail];                                         // 清单第 1 项 → 任务的台词 (等待) → 海战
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
