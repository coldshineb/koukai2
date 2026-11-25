// scenes/negotiate.js — 海上 命令 交涉 (MAIN.EXE 20a6d → 20127, 工作「找持有地图的人」2614f)
// 依 docs/RE_NOTES.md 第 30.1 节。交涉没有能力 / 好感判定, 结果完全由对方舰队的任务 (fleet.mission) 决定; 任务 3 / 4 / 11 谈完直接开战 (10f7e)。
import { DiscoveryFlag, GameConst } from "../model/flags.ts";
import { getWorkState } from "../model/world_helpers.ts";

const negHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };

// 20a6d: 附近 (距离 ≤ 2) 没有舰队 → 0xe1, 返回 1; 清单 0x8c 取消 → 1; 20127 返回 ≠ 0 → 再来一次; = 0 → 返回 0 (命令菜单结束)
export async function seaNegotiate(sc) {
  for (;;) {
    const n = sc.nearFleets(2);                                          // 0fea:314a
    if (!n) { await sc.smallMsg(0xe1); return 1; }                       // 7849(0x14, 0x80, 0x1e, 0x60) + 490b + 796d
    const si = await sc.b.listSel().select(0x8c, n);                     // 0fea:5bd0
    if (si === -1) return 1;
    if (!(await ngTalk(sc, sc.c.persons[si]))) return 0;
  }
}

// 20127(p = 对方指挥者)
async function ngTalk(sc, p) {
  const m = sc.st.model, g = m.globals, w = getWorkState(m), { message, menu } = sc.c, b = sc.b, hero = g.hero;
  const nations = (sc.negNations ??= sc.P.data.nations.map(negHex));      // DS:08de
  const nation = n => nations[m.person(n).face & 0x0f];
  const fleet = m.fleet(m.person(p).fleet);
  let task = fleet.mission;
  const target = fleet.target;
  if (g.commonChap && w.curKind === 0x0b && (w.targetPerson & 0xff) === p) {   // 工作中、种类 0x0b、对象 (只比低字节)
    b.talkPerson(p);                                                     // seg0:7f06
    await ngSellMap(sc);                                                 // 2614f
    await b.closeTalk();                                                 // seg0:796d
    return 1;
  }
  if (task === 0xff) {
    b.talkPerson(p);
    message(0xd8, nation(p), m.person(p).givenNameBytes);                // 「我是%s的%s．」
    await menu.waitPrompt();                                             // 0fea:490b
    await b.closeTalk();
    return 1;
  }
  if (task >= 5 && task <= 7 && target === hero) task = 0x0b;
  let si = 1;
  b.talkPerson(p);
  switch (task) {                                                        // cs:0451
    case 0: message(0x98); break;
    case 1: message(0x99, m.port(target).nameBytes); break;
    case 2: message(0x9a, m.port(target).nameBytes); break;
    case 3: message(0x9b); si = 0; break;
    case 4: message(0x9c); si = 0; break;
    case 5: case 6: case 7: message(0x9d, nation(target), m.person(target).givenNameBytes); break;
    case 8: message(0x9e); break;
    case 9: message(0x9f); break;
    case 10: message(0xa0); break;
    case 11: message(0xa1); si = 0; break;
    default: break;
  }
  await menu.waitPrompt();
  await b.closeTalk();
  if (!si) await sc.navalBattle(p, hero, 0xff, 0xff);                    // 0fea:10de = 10f7e
  return si;
}

// 2614f 卖地图 (工作 0x0b: TARGET_ITEM = 地图的道具编号)
async function ngSellMap(sc) {
  const m = sc.st.model, g = m.globals, { message, menu } = sc.c, b = sc.b, it = getWorkState(m).targetItem;
  const end = async msg => { message(msg); await menu.waitPrompt(); };
  for (let i = 0; i < GameConst.INV_SLOTS; i++) if (((m.inventory(i) - it) & 0xff) === 0xf6) return end(0x36f);
  message(0x25c, m.item(it).nameBytes);
  await menu.waitPrompt();
  b.talkClear();                                                         // seg0:7f6e
  message(0x25d);
  if (!(await menu.yesNo())) return;                                     // 0fea:47fc
  if (g.money < 1000) { b.talkClear(); return end(0x25f); }
  b.talkClear(); message(0x25e); await menu.waitPrompt();
  for (let i = 0; i < GameConst.INV_SLOTS; i++) {
    if (m.inventory(i) !== GameConst.EMPTY_SLOT) continue;
    const v = (it - 10) & 0xff;
    m.setInventory(i, v);
    m.discovery(m.item(v).power).flags |= DiscoveryFlag.KNOWN;
    g.money = (g.money - 1000) | 0;
    sc.panels();                                                         // seg0:8894
    return;
  }
  b.talkClear(); return end(0x370);
}
