// scenes/land.js — 上陆探索 (MAIN.EXE 2e09 段: 34d54 上陆、34ccc 发现物、3453b 修理、34734 搜索) — docs/RE_NOTES.md 第 36 节
// 由 SeaScene.landExplore() 创建 (34ec7 选好位置之后, 或 seaFlags2 & LANDED_MASK 时直接调用)。
// 原版运行期变量 (不在存盘内): [b8de] = sea.landFlag (34ec7 设置, 地图格 0x59 时 0)、[b8e0] 补水可行、[bc18] 雇用的向导 → ctx.landRT
import { DiscoveryFlag, GameConst, MenuId, SeaFlag2, ShipSlotFlag } from "../model/flags.ts";
import { createDomModal, hasDom } from "../ui/modals.ts";
import { decodeCleanCstr, toSimp } from "../ui/text_util.ts";

const ldS16 = v => (v << 16) >> 16;
const ldUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c (无号)

export class Land {
  constructor(sea) {
    this.sea = sea; this.c = sea.c; this.st = sea.st; this.b = sea.b; this.S = sea.SS;
    this.rt = (this.c.landRT ??= { b8e0: 0, bc18: 0 });
  }
  get m() { return this.st.model; }
  get flag() { return this.sea.landFlag ?? 0; }                         // [b8de] (BSS 初值 0)
  disc() { return this.m.discovery(this.m.globals.discoveryId); }       // seg0:5cce
  present(i) { return (this.st.u8(this.sea.slotOf(i) + 8) & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE; }
  // 909b + 消息 + 490b + 796d
  async talk(n, ...a) { this.b.crewSpeaks(); this.c.message(n, ...a); await this.c.menu.waitPrompt(); await this.c.win.close(); }
  // 909b + 消息 + 0fea:47fc + 796d
  async ask(n, ...a) { this.b.crewSpeaks(); this.c.message(n, ...a); const r = await this.c.menu.yesNo(); await this.c.win.close(); return !!r; }

  // ================= 34d54 上陆 =================
  async run() {
    const m = this.m, g = m.globals, { menu, message, win, sys, palette } = this.c;
    let si = 1;
    const items = this.c.menuItems(MenuId.LAND_ACT).slice(0, 4);        // 3383a: MENU #0x24
    const has = () => g.discoveryId !== GameConst.EMPTY_SLOT && !(this.disc().flags & DiscoveryFlag.FOUND);
    if (!(g.seaFlags2 & SeaFlag2.LANDED_MASK)) {
      this.b.crewSpeaks();
      if (has()) message(0x1b7);
      message(0x1b8);
      const ok = await menu.yesNo();
      await win.close();
      if (!ok) { g.discoveryId = GameConst.EMPTY_SLOT; return; }
    }
    const r = sys.rng.random(100);                                      // 4dc4
    this.rt.b8e0 = ((m.heroPerson().getStats(7) * this.flag) & 0xffff) > r ? 1 : 0;
    if (has()) { await this.discovery(); return; }                      // 34ccc
    g.seaFlags2 &= ~SeaFlag2.LANDED_MASK;
    while (si) {
      const sel = await menu.listMenu(0x40, 0x110, items, 0);           // 0fea:44c4 (不可取消)
      if (sel === 0) si = await this.leave();                           // 340c0
      else if (sel === 1) await this.repair();                          // 3453b
      else if (sel === 2) await this.search();                          // 34734
      else if (sel === 3) {                                             // [1004] |= [b8de] = 0 ? 0x3000 : 0x2800
        g.seaFlags2 = (g.seaFlags2 & 0x7f) | (this.flag ? 0x28 : 0x30);
        si = 0;
      }
    }
    await palette.fadeToTarget();                                       // 99e8
  }
  // 340c0 离开: 0x1a1 是 → 0 (离开), 否 → 1
  async leave() { return (await this.ask(0x1a1)) ? 0 : 1; }

  // ================= 34ccc 发现物 =================
  async discovery() {
    const g = this.m.globals, { menu } = this.c;
    let si = 1;
    this.sea.locationBits();                                            // 1fd9:333a
    this.rt.bc18 = 0;
    const items = this.c.menuItems(MenuId.DISCOVERY_ACT).slice(0, 5);
    g.seaFlags2 &= ~SeaFlag2.LANDED_MASK;
    while (si) {
      const sel = await menu.listMenu(0x40, 0xf0, items, 0);
      if (sel === 0) await this.investigate();                          // 34966
      else if (sel === 1) await this.guides();                          // 34aa5
      else if (sel === 2) await this.hunt();                            // 34b74
      else if (sel === 3) si = await this.leave();                      // 340c0
      else if (sel === 4) { g.seaFlags2 = (g.seaFlags2 & 0x7f) | 0x38; si = 0; }
    }
    await this.c.palette.fadeToTarget();                                // 99e8
  }
  // 348b4: 有一艘「在」的船船员配置 food ≠ 0
  anyFood() { const m = this.m; for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.present(i) && m.crewSlot(i).food) return 1; return 0; }
  // 34a5e / 34bd1: (100 − min(主角 +21 / 2 × +25 / 25 + +21 / 2, 100)) >> 1
  attackPct() {
    const hero = this.m.heroPerson(), a = hero.getStats(5) >> 1;
    const v = ldUmin((Math.trunc(ldS16((a * hero.battleLevel) & 0xffff) / 25) + a) & 0xffff, 100);
    return ((100 - v) & 0xffff) >> 1;
  }
  // 348ff: 各「在」的船 水手 += (水手 × p 的低 16 比特) / −100; show 时在目前的窗口印 0x1ab (损失合计)
  crewLoss(p, show) {
    const st = this.st; let sum = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      if (!this.present(i)) continue;
      const S = this.sea.slotOf(i), q = ldS16(Math.imul(p, ldS16(st.u16(S))) & 0xffff);
      sum = (sum + Math.trunc(q / 100)) & 0xffff;
      st.set16(S, (st.u16(S) + Math.trunc(q / -100)) & 0xffff);
    }
    if (show) this.c.message(0x1ab, ldS16(sum));
  }
  // 34966 调查
  async investigate() {
    const m = this.m, hero = m.heroPerson(), d = this.disc(), { message, menu, win, graph } = this.c;
    if (!this.anyFood()) return this.talk(0x1ac);
    if (d.flags & DiscoveryFlag.KNOWN) return this.talk(0x1b0);
    const v = (Math.trunc((7 * hero.getStats(3)) / 20) + Math.trunc((3 * hero.getStats(7)) / 20) + this.rt.bc18) & 0xff;
    if (v <= d.importance) return this.talk(0x1ad);
    const type = d.flags & DiscoveryFlag.KIND_MASK;
    if (!type) {                                                        // 2103 + 5b5d(GRAPH #0x40, 0xa0, 0x10) + 9768(0c18) / 9804(3c), 不放键
      this.sea.clearCache();
      graph.draw(0x40, 0xa0, 0x10);
      this.c.sfx?.voice(0x0c18); this.c.sfx?.note(0x3c);
    }
    this.b.crewSpeaks();
    const cat = this.b.BG.discCats[type];                               // DS:0952[种类]
    if (type === 1 || type === 5) { message(0x1ae, cat); this.crewLoss(this.attackPct(), 1); }   // 土人 / 怪物
    else message(0x1af, cat);
    d.flags |= DiscoveryFlag.KNOWN;
    await menu.waitPrompt(); await win.close();
    await this.b.discInfo(m.globals.discoveryId);                       // 347a0
  }
  // 34aa5 雇用向导
  async guides() {
    const m = this.m, sea = this.sea, { message, menu, win } = this.c;
    this.b.crewSpeaks(); message(0x1b1);
    if (!(await menu.yesNo())) { await win.close(); return; }
    await win.close();
    let found = -1;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.present(i) && ldS16(m.crewSlot(i).food) >= 20) { found = i; break; }
    if (found >= 0) {
      const cs = m.crewSlot(found);
      cs.food -= 20;
      sea.seaPanel();                                                   // 8067
      this.rt.bc18 = (this.rt.bc18 + 5) & 0xffff;
      this.b.crewSpeaks(); message(0x1b2, ldS16(this.rt.bc18));
    } else { this.b.crewSpeaks(); message(0x1b3); }
    await menu.waitPrompt(); await win.close();
  }
  // 34b74 狩猎
  async hunt() {
    const hero = this.m.heroPerson(), { message, menu, win, sys } = this.c;
    this.b.crewSpeaks(); message(0x1b4);
    if (!(await menu.yesNo())) { await win.close(); return; }
    await win.close();
    const si = ((sys.rng.random(5) + 2) * 10) & 0xffff;
    this.b.crewSpeaks(); message(0x1b5, si);
    if (sys.rng.random(4) === 0) { message(0x1b6); this.crewLoss(this.attackPct(), 1); }
    await menu.waitPrompt(); await win.close();
    const s6 = hero.getStats(6), s7 = hero.getStats(7);
    hero.setStats(6, s6 - ldUmin(2, (s6 - 50) & 0xffff));               // +22 < 50 时也减 2 (原版)
    hero.setStats(7, s7 - ldUmin(2, s7));
    this.rt.bc18 = 0;
    await this.giveFood(si);                                            // 34b42
    this.sea.seaPanel();                                                // 8067
  }
  // 34b42: 未装载货物 [粮食 0x81] × n → 0fea:e788 舰队表 + 0fea:fe57 分配
  async giveFood(n) {
    const goods = new Array(9).fill(0xff), amt = new Array(9).fill(0);
    goods[0] = 0x81; amt[0] = n & 0xffff;
    this.b.fleetTable();
    await this.b.distribute(goods, amt);
  }

  // ================= 3453b 修理 =================
  async repair() {
    const { menu, win } = this.c, sea = this.sea;
    for (;;) {
      const r = await this.b.listSel().select(0x8a, this.b.fleetShips());   // 340e5: 0fea:2dea + 清单 0x8a
      if (r < 0) break;
      const slot = this.c.persons[r] & 0xff, S = sea.slotOf(slot);
      if (this.c.scr.wideRenderer && hasDom()) {
        await this.repairDom(slot, S);
        continue;
      }
      if (!(await this.repairWin(S))) continue;                         // 340f5
      for (;;) {
        this.repairBars(S);                                             // 341cd
        const sel = await menu.customMenu(3, 1, 1);                     // 0fea:4684 ([a158] = 3)
        if (sel === 0xff) { await win.close(); break; }
        await this.repairDo(slot, sel);                                 // 343a6
      }
    }
    sea.fleetDurability(sea.fleet);                                     // 0fea:83f9
  }
  shipTypeOf(S) { const m = this.m; return m.shipType(m.ship(this.st.u8(S + 7)).type); }
  // 340f5 现代羊皮纸上陆修理弹窗
  async repairDom(slot, S) {
    const st = this.st, T = this.shipTypeOf(S);
    if (st.u8(S + 2) === st.u8(S + 3) && st.u8(S + 4) === T.turn && T.propulsion === st.u8(S + 5)) {
      await this.talk(0x1a2);
      return;
    }
    const shipRec = this.sea.shipRec(st.u8(S + 7));
    const shipName = toSimp(decodeCleanCstr(this.c.codec, st.cstr(shipRec)));
    for (;;) {
      const sel = await new Promise(resolve => {
        const h = createDomModal({
          title: `修理 · ${shipName}`,
          size: "sm",
          cancelable: true,
          closeLabel: "完成",
          onCancel: () => resolve(-1),
        });
        const rows = [
          ["耐久", st.u8(S + 2), st.u8(S + 3)],
          ["转向", st.u8(S + 4), T.turn],
          ["推进", st.u8(S + 5), T.propulsion],
        ];
        rows.forEach(([label, cur, max], idx) => {
          const btn = document.createElement("button");
          btn.className = "uw2-row-card";
          const pct = max > 0 ? Math.min(100, Math.round((cur * 100) / max)) : 100;
          btn.disabled = cur >= max;
          btn.innerHTML = `<span style="font-weight:700;min-width:44px;">${label}</span><div class="uw2-bar-track" style="flex:1;"><div class="uw2-bar-fill ${pct < 40 ? "red" : "green"}" style="width:${pct}%"></div></div><span style="font-weight:700;min-width:58px;text-align:right;">${cur}/${max}</span>`;
          btn.addEventListener("click", () => { h.close(); resolve(idx); });
          h.body.appendChild(btn);
        });
      });
      if (sel < 0) break;
      await this.repairDo(slot, sel);
    }
  }
  // 340f5: 三项都满 → 0x1a2 返回 0; 否则窗口与三个长条外框
  async repairWin(S) {
    const st = this.st, { win, con } = this.c, T = this.shipTypeOf(S), cm = this.sea.commandsObj();
    if (st.u8(S + 2) === st.u8(S + 3) && st.u8(S + 4) === T.turn && T.propulsion === st.u8(S + 5)) { await this.talk(0x1a2); return 0; }
    win.shadowedSaved(0x14, 0x60, 0x18, 0x80, 0);                       // 7849(0x14, 0x60, 0x18, 0x80, 0)
    con.right = 0x2b; con.left = 0x18;
    con.setCursor(0x18, 0x70); con.puts(this.S.landDur); cm.barFrame(con.left + 2, 0x84, 1);
    con.setCursor(con.left, 0x90); con.puts(this.S.landTurn); cm.barFrame(con.left + 2, 0xa4, 1);
    con.setCursor(con.left, 0xb0); con.puts(this.S.landProp); cm.barFrame(con.left + 2, 0xc4, 1);
    return 1;
  }
  // 341cd: 三项「%3d/%3d」与长条 (91a1), 点击区 [a158] = 3 + 窗口
  repairBars(S) {
    const st = this.st, { con, printf, menu } = this.c, T = this.shipTypeOf(S), cm = this.sea.commandsObj(), R = menu.rects;
    con.left = 0x18; con.right = 0x2b;
    con.puts(this.S.landHdr);                                           // DS:b8f1
    menu.count = 3;
    const L = con.left;
    const row = (k, y, fmt, cur, max) => {
      R[k] = { x0: L << 3, x1: (L + 4) << 3, y0: y, y1: y + 0x10 };
      con.setCursor(L + 0x0b, y); printf(fmt, cur, max);
      cm.bar(L + 2, y + 0x14, Math.trunc((100 * cur) / max), 1);        // 最大 = 0 时原版除以零
    };
    row(0, 0x70, this.S.landV1, st.u8(S + 2), st.u8(S + 3));
    row(1, 0x90, this.S.landV2, st.u8(S + 4), T.turn);
    row(2, 0xb0, this.S.landV3, st.u8(S + 5), T.propulsion);
    R[3] = { x0: 0xa0, x1: 0x160, y0: 0x60, y1: 0xe0 };
  }
  // 343a6: 以资材修理 (每 1 单位 +5)
  async repairDo(slot, sel) {
    const st = this.st, m = this.m, sea = this.sea, k = sel & 0xff;
    let total = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.present(i)) total = (total + m.crewSlot(i).material) & 0xffff;
    if (!total) return this.talk(0x1a3);
    const S = sea.slotOf(slot), T = this.shipTypeOf(S);
    const d = [st.u8(S + 3) - st.u8(S + 2), T.turn - st.u8(S + 4), T.propulsion - st.u8(S + 5)];
    if (!d[k]) return this.talk(0x1a4);
    const max = ldUmin(total, Math.trunc(ldS16(d[k] + 4) / 5));
    this.b.crewSpeaks(); this.c.message(0x1a5, ldS16(max));
    const n = (await this.b.numpad.input(0, ldS16(max))) & 0xffff;      // 592a
    await this.c.win.close();
    this.takeMaterials(n);                                              // 3434d
    sea.seaPanel();                                                     // 8067
    const add = Math.imul(5, n) & 0xffff;
    if (k === 0) st.set8(S + 2, ldUmin(st.u8(S + 3), st.u8(S + 2) + add));
    else if (k === 1) st.set8(S + 4, ldUmin(T.turn, st.u8(S + 4) + add));
    else if (k === 2) st.set8(S + 5, ldUmin(T.propulsion, st.u8(S + 5) + add));
  }
  // 3434d: 依船位顺序从「在」的船扣资材
  takeMaterials(n) {
    const m = this.m; let rem = n & 0xffff;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      if (!this.present(i)) continue;
      const cs = m.crewSlot(i), old = cs.material;
      cs.material = old - ldUmin(old, rem);
      rem = (rem + cs.material - old) & 0xffff;
      if (!rem) break;
    }
  }

  // ================= 34734 搜索 =================
  async search() {
    const g = this.m.globals;
    if (g.discoveryId !== GameConst.EMPTY_SLOT) {
      const d = this.disc();
      if ((d.flags & 0xf0) === 0xa0) { await this.treasure(d); d.flags |= 0x10; return; }   // 346d8
    }
    await this.water();                                                 // 3466c
  }
  // 346d8: 0x1af (道具名); 随身物第一格「值 − 道具 = 0xF6」时放进该道具 (原版的条件)
  async treasure(d) {
    const m = this.m, it = d.item;
    await this.talk(0x1af, m.item(it).nameBytes);
    for (let i = 0; i < GameConst.INV_SLOTS; i++) if (((m.inventory(i) - it) & 0xff) === 0xf6) { m.setInventory(i, it); break; }
  }
  // 3466c 补水
  async water() {
    if (!this.flag && !(await this.ask(0x1a8))) return;
    if (!this.rt.b8e0) return this.talk(0x1a9);
    await this.talk(0x1aa);
    await this.fillWater();                                             // 345b2
  }
  // 345b2: 清单 0x8b 选船 → 尚可装载量 → 计算机 → 水 = (水 / 10 + n) × 10
  async fillWater() {
    const m = this.m, sea = this.sea, { message, win } = this.c;
    for (;;) {
      const r = await this.b.listSel().select(0x8b, this.b.fleetShips());   // 345a2
      if (r < 0) return;
      const slot = this.c.persons[r] & 0xff, cs = m.crewSlot(slot), ship = m.ship(this.st.u8(sea.slotOf(slot) + 7));
      const free = (ship.maxCargo - this.b.cargoUsed(slot)) & 0xffff;   // 5d36
      if (!free) { await this.talk(0x1a6); continue; }
      this.b.crewSpeaks(); message(0x1a7, ship.nameBytes, ldS16(free));
      const n = await this.b.numpad.input(0, ldS16(free));              // 592a
      cs.water = Math.imul(Math.trunc(ldS16(cs.water) / 10) + n, 10) & 0xffff;
      await win.close();
      sea.seaPanel();                                                   // 8067
    }
  }
}
