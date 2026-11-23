// scenes/negotiate.js — 海上 命令 交涉 (MAIN.EXE 20a6d → 20127, 工作「找持有地圖的人」2614f)
// 依 docs/RE_NOTES.md 第 30.1 節。交涉沒有能力 / 好感判定, 結果完全由對方艦隊的任務 (艦隊 +1b) 決定; 任務 3 / 4 / 11 談完直接開戰 (10f7e)。
// 由 SeaScene 呼叫: seaNegotiate(sc) — sc 提供 st / c / b (Buildings: talkPerson 7f06、talkClear 7f6e、closeTalk 796d) / panels (8894) / nearFleets (12fea) / navalBattle (10f7e)

const negHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const negS16 = v => (v << 16) >> 16;

// 20a6d: 附近 (距離 ≤ 2) 沒有艦隊 → 0xe1, 回傳 1; 清單 0x8c 取消 → 1; 20127 回傳 ≠ 0 → 再來一次; = 0 → 回傳 0 (命令選單結束)
export async function seaNegotiate(sc) {
  for (;;) {
    const n = sc.nearFleets(2);                                          // 0fea:314a
    if (!n) { await sc.smallMsg(0xe1); return 1; }                       // 7849(0x14, 0x80, 0x1e, 0x60) + 490b + 796d
    const si = await sc.b.listSel().select(0x8c, n);                     // 0fea:5bd0
    if (si === -1) return 1;
    if (!(await ngTalk(sc, sc.c.persons[si]))) return 0;
  }
}

// 20127(p = 對方指揮者)
async function ngTalk(sc, p) {
  const st = sc.st, { message, menu } = sc.c, b = sc.b, hero = st.u8(0x12b5);
  const nations = (sc.negNations ??= sc.P.data.nations.map(negHex));      // DS:08de
  const nation = n => nations[st.u8(st.personRecord(n) + 0x31) & 0x0f];
  const F = 0x2e76 + ((0x85 * st.u8(st.personRecord(p) + 0x2c)) & 0xffff);   // seg0:5c28
  let task = st.u8(F + 0x1b);
  const target = st.u8(F + 0x1c);
  if (st.u8(0x0d5e) && st.u16(0x0d74) === 0x0b && st.u8(0x0d8a) === p) {     // 工作中、種類 0x0b、對象 (只比低位元組)
    b.talkPerson(p);                                                     // seg0:7f06
    await ngSellMap(sc);                                                   // 2614f
    await b.closeTalk();                                                 // seg0:796d
    return 1;
  }
  if (task === 0xff) {
    b.talkPerson(p);
    message(0xd8, nation(p), st.cstr(st.personRecord(p)));               // 「我是%s的%s．」
    await menu.waitPrompt();                                             // 0fea:490b
    await b.closeTalk();
    return 1;
  }
  if (task >= 5 && task <= 7 && target === hero) task = 0x0b;
  let si = 1;
  b.talkPerson(p);
  switch (task) {                                                        // cs:0451
    case 0: message(0x98); break;
    case 1: message(0x99, st.portName(target)); break;                   // 5c9a + 4
    case 2: message(0x9a, st.portName(target)); break;
    case 3: message(0x9b); si = 0; break;
    case 4: message(0x9c); si = 0; break;
    case 5: case 6: case 7: message(0x9d, nation(target), st.cstr(st.personRecord(target))); break;
    case 8: message(0x9e); break;
    case 9: message(0x9f); break;
    case 10: message(0xa0); break;
    case 11: message(0xa1); si = 0; break;
    default: break;
  }
  await menu.waitPrompt();
  await b.closeTalk();
  if (!si) await sc.navalBattle(p, hero, 0xff, 0xff);                  // 0fea:10de = 10f7e
  return si;
}

// 2614f 賣地圖 (工作 0x0b: [0d8c] = 地圖的道具編號)
async function ngSellMap(sc) {
  const st = sc.st, { message, menu } = sc.c, b = sc.b, it = st.u8(0x0d8c);
  const itemRec = n => 0x8248 + ((0x14 * (n & 0xff)) & 0xffff);         // seg0:5cde
  const end = async m => { message(m); await menu.waitPrompt(); };
  for (let i = 0; i < 0x14; i++) if (((st.u8(0x2e57 + i) - it) & 0xff) === 0xf6) return end(0x36f);
  message(0x25c, st.cstr(itemRec(it)));
  await menu.waitPrompt();
  b.talkClear();                                                         // seg0:7f6e
  message(0x25d);
  if (!(await menu.yesNo())) return;                                     // 0fea:47fc
  const hi = negS16(st.u16(0x12b0)), lo = st.u16(0x12ae);
  if (hi < 0 || (hi === 0 && lo < 1000)) { b.talkClear(); return end(0x25f); }
  b.talkClear(); message(0x25e); await menu.waitPrompt();
  for (let i = 0; i < 0x14; i++) {
    if (st.u8(0x2e57 + i) !== 0xff) continue;
    const v = (it - 10) & 0xff;
    st.set8(0x2e57 + i, v);
    const D = 0x7f8c + ((7 * st.u8(itemRec(v) + 0x12)) & 0xffff);       // seg0:5cce
    st.set8(D + 6, st.u8(D + 6) | 0x20);
    const m = ((st.u16(0x12b0) << 16) | lo) - 1000;
    st.set16(0x12ae, m & 0xffff); st.set16(0x12b0, (m >>> 16) & 0xffff);
    sc.panels();                                                         // seg0:8894
    return;
  }
  b.talkClear(); return end(0x370);
}
