// wharf.js — 码头 (补给 / 出航前检查 / 船坞 / 补给港命名 / 出航清除画面)
import { ListSelect } from "../ui/dos/listsel.js";
import { GameConst, OptionFlag, SeaFlag2, ShipSlotFlag, TreatyFlag } from "../model/flags.ts";
import {
  WorldConst,
  appendTradeLog,
  fleetByAddr,
  getPartySalaryUnit,
  getWorkState,
  heroOrDockSlot,
  heroShipSlot,
  setDaysAtSea,
  setPartySalaryUnit,
  setPortNpc,
  writePortName,
} from "../model/world_helpers.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { runDomTableSelect } from "../ui/modals.ts";
import { runDomWharfWorkbench } from "../ui/buildings/wharf.ts";
import { decodeCleanCstr } from "../ui/text_util.ts";

class WharfMixin {
  async wharf() {
    const m = this.m, g = m.globals, w = getWorkState(m), hero = m.heroPerson(), { menu } = this.c;
    if (this.port >= 0x64 && this.port < 0x82) {
      if (this.c.scr.wideRenderer && this.c.codec) return await runDomWharfWorkbench(this);
      return this.supplyPort();     // 286ac
    }
    this.guards();
    await this.crewDemands();
    const items = this.c.menuItems(9);
    let si = 1;
    if (!g.commonChap && (w.flags & 3) && !(w.flags & 4) && !(((m.port(this.port).region & 7) ^ hero.face) & 0x0f)) {
      this.greet(0x199); this.c.message(0x19a + (hero.face & 15)); this.c.message(0x1a0); await this.wait();
      w.flags |= 2; si = 0;
    }
    if (this.c.scr.wideRenderer && this.c.codec) {
      return await runDomWharfWorkbench(this);
    }
    if (si && this.noEvent()) this.greet(0x38);
    let sel;
    do {
      si = 0;
      if (!this.isCapital()) menu.disabled = 4;
      if (!this.fleetShips()) menu.disabled |= 3;
      sel = await this.menu(items);
      if (sel !== 0xff) si = await [() => this.departWrap(), () => this.supply(), () => this.dock()][sel]();
    } while (sel !== 0xff && !si);
  }
  // 28741: 夜间 (时刻 ≤ 0x12 或 ≥ 0x36) random(3)=0 且港口所属国与主角舰队国家敌对时, 站立行人 4..7 改成卫兵站在入口旁
  guards() {
    const m = this.m, t = this.c.rt.time, nation = m.port(this.port).region & WorldConst.PORT_OWNER_MASK;
    if (!(t <= 0x12 || t >= 0x36)) return;
    if (this.c.sys.rng.random(3)) return;
    if (nation >= WorldConst.TOTAL_COUNTRIES) return;
    const fn = Math.trunc(m.heroPerson().fleet / 10);
    if (!(m.country(nation).getTreaties(fn) & TreatyFlag.BLOCKADE)) return;
    for (let i = 0, extra = 0; i < 4; i++) {
      if (i === 3) extra++;
      const d = (i + extra) * 2;
      setPortNpc(m, 4 + i, 0, this.p.door[d] + 2);
      setPortNpc(m, 4 + i, 1, this.p.door[d + 1] + 1);
      setPortNpc(m, 4 + i, 2, i);
      if (i === 2) { setPortNpc(m, 4 + i, 0, 0xff); setPortNpc(m, 4 + i, 1, 0xff); }
    }
  }
  // 28809: 忠诚 (+2b) < 30 的船员 random(4 − (+2f & 3)) = 0 时要求加薪
  async crewDemands() {
    const m = this.m, { message, menu, sys } = this.c;
    const n = this.crewList();
    for (let di = 0; di < n; di++) {
      const who = this.c.persons[di], p = m.person(who);
      if (p.loyalty >= 0x1e) continue;
      if (sys.rng.random(4 - (p.flags & 3))) continue;
      for (let si = 0; si < GameConst.PARTY_SLOTS; si++) {
        if (this.c.persons[di] !== m.partyCrew(si) || getPartySalaryUnit(m, si) >= 0x13) continue;
        this.talkPerson(this.c.persons[di]); message(0x31e); await this.wait(); await this.closeTalk();
        if (this.crewSpeaks() === this.c.persons[di]) message(0x320); else message(0x31f, p.givenNameBytes);
        if (await menu.yesNo()) {
          await this.closeTalk();
          this.talkPerson(this.c.persons[di]); message(0x321, ((getPartySalaryUnit(m, si) + 1) * 10) & 0xffff);
          if (await menu.yesNo()) { await this.closeTalk(); setPartySalaryUnit(m, si, getPartySalaryUnit(m, si) + 1); p.loyalty = 0x1e; continue; }
        }
        await this.closeTalk();
        this.dismissMate(this.c.persons[di]);
      }
    }
  }
  // 2858b 船员离开舰队, 留在本港
  dismissMate(n) {
    const m = this.m;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) === n) { m.setPartyCrew(i, GameConst.EMPTY_SLOT); setPartySalaryUnit(m, i, 0); break; }
    const p = m.person(n); p.role = 0; p.fleet = GameConst.EMPTY_SLOT; p.stayPort = this.port;
  }
  // 286ac 港 100..129 (补给港): MENU #57 出航 / 补给 / 命名
  async supplyPort() {
    const items = this.c.menuItems(57);
    if (this.noEvent()) this.greet(0x38);
    let sel, si = 1;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff) si = await [() => this.departWrap(), () => this.supply(), () => this.namePort()][sel]();
    } while (sel !== 0xff && !si);
  }
  // ---------- 船只数据 (造船厂与船坞共用) ----------
  // ================= 码头 船坞 284ab =================
  async dock() {
    const { palette, win, con, menu, message } = this.c;
    palette.setTarget(palette.table("ships")); await palette.fadeToTarget();
    const items = this.c.menuItems(8);
    win.shadowedSaved(0x3c, 0xa0, 0x13, 0x88, 0);
    con.puts(this.SY.dockTitle);
    let sel;
    do {
      this.dockScan();
      if (this.b066) this.greet(0x114, this.b066); else this.greet(0x115);
      message(0x116, this.b068);
      sel = await menu.listMenu(0x3c, 0x40, items, 1);
      if (sel !== 0xff) await [() => this.dockKeep(), () => this.dockTake(), () => this.dockSwap()][sel]();
      this.after();
      this.compactSlots();
    } while (sel !== 0xff);
    await win.close();
    palette.selectTimePalette(this.c.rt.time, false, this.m.globals.weather);  // 0fea:98ce
    await this.p.interior(3);
    this.greet(0x38);
    return 0;
  }
  // 27fd5 本港船坞的船 → b06a[0..b066), 再补空船坞位到 b068 (最多 5)
  dockScan() {
    const m = this.m;
    this.b062 = this.fleetShips();
    this.b064 = domUmin16(this.captainPool(), 10);
    this.b06a = [0xff, 0xff, 0xff, 0xff, 0xff];
    this.freeSlots();
    this.b066 = 0;
    for (let i = 10; i < 0x28; i++) if (m.crewSlot(i).captain === (this.port | 0x80) && this.slotState(i) === ShipSlotFlag.ACTIVE) this.b06a[this.b066++] = i;
    this.b068 = this.b066;
    for (let i = 10; i < 0x28 && this.b068 < 5; i++) { const f = this.slotState(i); if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) this.b06a[this.b068++] = i; }
    this.c.scr.fillCols(0x3e, 0xc8, 0x10, 0x50, 7);
    this.dockList();
  }
  // 27f34 船坞列表与点击区
  dockList() {
    const m = this.m, { con, printf, menu } = this.c, R = menu.rects;
    con.left = 0x3e; con.right = 0x4d; con.puts(this.SY.dockColor);
    let i = 0;
    for (; i < this.b066; i++) {
      const y = (i << 4) + 0xc8;
      con.setCursor(0x3e, y);
      printf(this.SY.dockRow, m.ship(heroOrDockSlot(m, this.b06a[i]).ship).nameBytes);
      this.c.persons[i] = this.b06a[i];
      R[i] = { x0: 0x1f0, x1: 0x270, y0: y, y1: y + 0x10 };
    }
    R[i] = { x0: 0x1e0, x1: 0x280, y0: 0xa0, y1: 0x128 };
  }
  // 280ce 保管: 舰队船 → 第一个空船坞位
  async dockKeep() {
    const m = this.m, { message, menu } = this.c, list = this.listSel();
    if (!this.b062) return;
    const n = this.notHeroShips();
    if (!n) { this.crewSpeaks(); message(0x117); await this.wait(); await this.closeTalk(); return; }
    if (this.b068 === this.b066) { this.greet(0x120); await this.wait(); return; }
    for (;;) {
      this.table(); this.greet(0x118);
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const slot = this.c.persons[r], S = heroOrDockSlot(m, slot);
      this.shipData(S.ship, 3, slot); this.figurehead(slot);
      if (S.crew) this.greet(0x119, S.crew); else this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      const d = this.b06a[this.b066];
      this.swapSlots(slot, d);
      const Mf = m.crewSlot(slot), Md = m.crewSlot(d), Sf = heroOrDockSlot(m, slot), Sd = heroOrDockSlot(m, d);
      Mf.morale = 0; Md.morale = 0; Sf.crew = 0; Sd.crew = 0;
      Mf.captain = GameConst.EMPTY_SLOT; m.person(Md.captain).role = 6; Md.captain = this.port | 0x80;
      this.greet(0x11a); await this.wait();
      return;
    }
  }
  // 2820d 配备: 船坞船 → 第一个空舰队位
  async dockTake() {
    const m = this.m, { message, menu } = this.c;
    this.dockList();
    if (!this.b066) { this.greet(0x11b); await this.wait(); return; }
    if (this.b064 === this.b062) { this.crewSpeaks(); message(0x11d); await this.wait(); await this.closeTalk(); return; }
    for (;;) {
      this.after(); this.dockList(); this.greet(0x11c);
      const sel = await menu.customMenu(this.b066, 1, 1);
      if (sel === 0xff) return;
      const d = this.c.persons[sel];
      this.shipData(heroOrDockSlot(m, d).ship, 3, d); this.figurehead(d);
      this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      let f = 0; for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.slotState(i) !== ShipSlotFlag.ACTIVE) { f = i; break; }
      this.swapSlots(f, d);
      const Mf = m.crewSlot(f), Md = m.crewSlot(d), Sf = heroOrDockSlot(m, f), Sd = heroOrDockSlot(m, d);
      Mf.morale = 0; Md.morale = 0; Sf.crew = 0; Sd.crew = 0;
      this.crewList();
      Mf.captain = this.c.persons[0]; m.person(this.c.persons[0]).role = 2;
      Md.captain = this.port | 0x80;
      this.greet(0x11e); await this.wait();
      return;
    }
  }
  // 2834f 交换: 舰队船 ↔ 船坞船
  async dockSwap() {
    const m = this.m, { menu } = this.c, list = this.listSel();
    if (!this.b062) return;
    if (!this.b066) { this.greet(0x11b); await this.wait(); return; }
    for (;;) {
      this.after();
      const n = this.fleetShips();
      this.greet(0x118);
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const f = this.c.persons[r];
      this.shipData(heroOrDockSlot(m, f).ship, 3, f); this.figurehead(f);
      this.dockList(); this.greet(0x11c);
      const sel = await menu.customMenu(this.b066, 1, 1);
      if (sel === 0xff) return;
      const d = this.c.persons[sel], Sd = heroOrDockSlot(m, d), Sf = heroOrDockSlot(m, f);
      this.shipData(Sd.ship, 3, d); this.figurehead(d);
      const cap = domS16(m.ship(Sd.ship).maxCrew), have = domS16(Sf.crew);
      if (have > cap) this.greet(0x119, (have - cap) & 0xffff); else this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      this.swapSlots(f, d);
      const Mf = m.crewSlot(f), Md = m.crewSlot(d);
      Mf.morale = Md.morale; Md.morale = 0;
      Sf.crew = domUmin16(Sd.crew, cap); Sd.crew = 0;
      Mf.captain = Md.captain; Md.captain = this.port | 0x80;
      this.greet(0x11f); await this.wait();
      return;
    }
  }
  // 1fd9:85d9 (285d9) 补给港命名: 返回值决定补给港菜单是否结束 (取消 → 港名地址 ≠ 0; 完成 → 0fea:490b 的 AX)
  async namePort() {
    const m = this.m, { win, sys } = this.c, portRec = m.port(this.port), me = portRec.addr + 4;
    const old = portRec.nameBytes.slice();
    const restore = () => writePortName(portRec, old);
    this.greet(0x39e); await this.wait();
    const ni = this.nameInput();
    ni.prompt(3, 8);
    if ((await ni.run(me, 8)) !== 1) { await win.close(); restore(); return me; }
    await win.close();
    const cur = portRec.nameBytes;
    let dup = false;
    for (let n = 0; n < WorldConst.TOTAL_PORTS && !dup; n++) {
      if (n === this.port) continue;
      const o = m.port(n).nameBytes;
      if (o.length === cur.length && o.every((v, i) => v === cur[i])) dup = true;          // seg0:4bea strcmp
    }
    if (dup) { restore(); this.greet(0x39f); }
    else this.greet(0x3a0, portRec.nameBytes);
    await this.wait();
    // 0fea:490b 最后是 seg0:4ecf: 有鼠标时 AX = 显示计数旧值 (≠0) 或 3 (INT 33h fn 3); 没有鼠标时 AX = 131e3 的 0
    return sys.mouse.present ? 1 : 0;
  }
  // 27a63
  async departWrap() {
    if (!this.fleetShips()) return 0;
    const r = await this.depart();
    if (!r) await this.p.interior(3);
    return r;
  }
  // 清除地图画面区域 (栏 12..59, y 8..391)
  wipe() {
    this.c.scr.fillCols(0x0c, 8, 0x30, 0x180, 0);
    this.c.scr.dirty = true;
  }
  // 27802 出航: 舰队数据表 → 补给天数 → 是/否
  //   积载率 = 5d36 × 100 (imul cx → DX:AX 32 比特) / 船 +14 (cwd) 经 seg0:38ba 无号长整数除法 (2793a..2793e); 不是 16 比特截断
  async depart() {
    const m = this.m, g = m.globals, { con, printf, message, menu, palette, scr, codec } = this.c, anim = g.options & OptionFlag.ANIMATION;
    const n = this.fleetShips(), L = this.c.persons.slice(0, n);
    let noDriver = 0, crewT = 0, waterT = 0, foodT = 0;
    let wideDepartDraw = null;
    if (scr.wideRenderer && codec) {
      const dec = bts => decodeCleanCstr(codec, bts);
      const hdr = dec(this.WF.departHdr);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const slot = L[i], M = m.crewSlot(slot), S = heroShipSlot(m, slot), ship = m.ship(S.ship);
        const crew = domS16(S.crew);
        waterT = (waterT + M.water) & 0xffff; foodT = (foodT + M.food) & 0xffff; crewT = (crewT + S.crew) & 0xffff;
        const drv = Math.trunc(crew * M.navRatio / 100), look = Math.trunc(crew * M.lookRatio / 100);
        const deck = domS16(S.crew - look - drv);
        const loadPct = domS16(Math.floor((Math.imul(domS16(this.cargoUsed(slot)), 100) >>> 0) / (domS16(ship.maxCargo) >>> 0 || 1)) & 0xffff);
        const w = Math.trunc(domS16(M.water) / 10), f = Math.trunc(domS16(M.food) / 10);
        rows.push({ name: dec(ship.nameBytes), stat: `${drv}/${look}/${deck}  ${loadPct}%  ${w}  ${f}` });
        if (!drv) noDriver = 1;
      }
      wideDepartDraw = c2d => {
        c2d.save();
        const x = 540, y = 82, w = 704, h = Math.min(428, 64 + rows.length * 36);
        c2d.fillStyle = "rgba(10, 22, 40, 0.95)";
        c2d.strokeStyle = "rgba(214, 174, 96, 0.85)";
        c2d.lineWidth = 1.5;
        c2d.fillRect(x, y, w, h);
        c2d.strokeRect(x, y, w, h);
        c2d.font = '700 15px "Noto Serif TC", "Microsoft JhengHei", serif';
        c2d.fillStyle = "#f2d89b";
        c2d.textAlign = "left";
        c2d.textBaseline = "middle";
        c2d.fillText(hdr, x + 18, y + 24, w - 36);
        for (let i = 0; i < rows.length; i++) {
          const ry = y + 54 + i * 34;
          c2d.fillStyle = "#fff4d6";
          c2d.textAlign = "left";
          c2d.fillText(rows[i].name, x + 18, ry, 240);
          c2d.font = '600 14px "Consolas", monospace';
          c2d.fillStyle = "#d8e4f2";
          c2d.textAlign = "right";
          c2d.fillText(rows[i].stat, x + w - 18, ry);
          c2d.font = '700 15px "Noto Serif TC", "Microsoft JhengHei", serif';
        }
        c2d.restore();
      };
      scr.wideOverlays.push(wideDepartDraw);
      scr.dirty = true;
    } else {
      if (anim) this.wipe(); else { await palette.fadeBlack(); scr.fillCols(0x0c, 8, 0x30, 0x180, 0); }
      this.winText(0x0d, 0x20, 0x2e, ((n + 2) * 0x18) & 0xffff);
      con.setCursor(0x1e, 0x30); con.puts(this.WF.departHdr);
      for (let i = 0; i < n; i++) {
        const slot = L[i], M = m.crewSlot(slot), S = heroShipSlot(m, slot), ship = m.ship(S.ship);
        const crew = domS16(S.crew);
        waterT = (waterT + M.water) & 0xffff; foodT = (foodT + M.food) & 0xffff; crewT = (crewT + S.crew) & 0xffff;
        const drv = Math.trunc(crew * M.navRatio / 100), look = Math.trunc(crew * M.lookRatio / 100);
        con.setCursor(0x0f, ((i + 3) * 0x18) & 0xffff);
        printf(this.WF.departRow, ship.nameBytes, drv, look, domS16(S.crew - look - drv),
          domS16(Math.floor((Math.imul(domS16(this.cargoUsed(slot)), 100) >>> 0) / (domS16(ship.maxCargo) >>> 0 || 1)) & 0xffff), Math.trunc(domS16(M.water) / 10), Math.trunc(domS16(M.food) / 10));
        if (!drv) noDriver = 1;
      }
    }
    const clearDepartOverlay = () => {
      if (wideDepartDraw) {
        const idx = scr.wideOverlays.indexOf(wideDepartDraw);
        if (idx >= 0) scr.wideOverlays.splice(idx, 1);
        wideDepartDraw = null;
        scr.dirty = true;
      }
    };
    this.crewSpeaks();
    const fail = async msg => { message(msg); if (!anim && !wideDepartDraw) await palette.fadeToTarget(); await this.wait(); await this.closeTalk(); clearDepartOverlay(); return 0; };
    if (noDriver) return fail(0x39);
    const days = Math.trunc(domUmin16(waterT, foodT) / (crewT || 1));
    if (!days) return fail(0x3b);
    if (days >= 10 && days <= 0xb4) message(0x3d, days); else message(days >= 10 ? 0x3a : 0x3c);
    if (!anim && !wideDepartDraw) await palette.fadeToTarget();
    const ok = await menu.yesNo();
    await this.closeTalk();
    clearDepartOverlay();
    if (!ok) return 0;
    // 27a0c 出港: 0fea:e3e5 记录 (种类 1, +4 天数, +6 港口) → [2e18] = 0 (出港天数), 方位 = 8 (停船) → 4fe3 清鼠标移动量 → [1005] &= DF
    //   → 0fea:9348 / 9401 (扣一天的粮食与水) → 851f 进入海上 → [0caf] = FF, 返回 1 (码头菜单结束)
    appendTradeLog(m, this.c.rt, 1, days, 0, 0, this.port);
    setDaysAtSea(m, 0);
    const sea = this.p;
    fleetByAddr(m, sea.fleet).dir = 8;
    this.c.sys.mickeys();
    g.seaFlags2 &= ~SeaFlag2.STOPPED;
    sea.foodDaily(); sea.waterDaily();
    await sea.enterSea();
    g.lastPort = GameConst.EMPTY_SLOT;
    return 1;
  }
  // 27e31 补给
  async supply() {
    const m = this.m, { con, menu, scr, codec } = this.c, labels = [this.WF.load, this.WF.unload];
    const n = this.fleetShips();
    if (!n) return 0;
    if (scr.wideRenderer && codec) {
      const dec = bts => decodeCleanCstr(codec, bts);
      const hdr = dec(this.WF.supplyHdr);
      let mode = 0;
      for (;;) {
        const ships = this.fleetShips();
        const items = [];
        for (let i = 0; i < ships; i++) {
          const slot = this.c.persons[i], M = m.crewSlot(slot);
          const nm = dec(m.ship(heroShipSlot(m, slot).ship).nameBytes);
          const vals = [Math.trunc(domS16(M.water) / 10), Math.trunc(domS16(M.food) / 10), domS16(M.material), domS16(M.ammo)];
          items.push({ label: nm, rightText: vals.join(" / ") });
        }
        const sel = await runDomTableSelect({ title: hdr, items, toggleLabel: dec(labels[mode]) });
        if (sel === 0xff) break;
        if (sel === -2) { mode ^= 1; continue; }
        const slot = this.c.persons[sel];
        const supNames = hdr.split(/\s+/).filter(Boolean).slice(0, 4);
        const itemLabels = supNames.length === 4 ? supNames.map(s => this.c.font.encode(s + "{00}")) : this.c.menuItems(9).slice(0, 4);
        const item = await menu.listMenu(0x20, 0x60, itemLabels, 1);
        if (item !== 0xff && item < 4) {
          if (mode === 0) await this.load(slot, item); else await this.unload(slot, item);
          this.p.panels();
        }
      }
      this.greet(0x38);
      return 0;
    }
    this.c.win.frame(0x0d, 0x20, 0x2e, ((n + 2) * 0x18) & 0xffff, 0);
    con.setCursor(0x10, 0x30); con.puts(labels[0]);
    con.setCursor(0x23, 0x30); con.puts(this.WF.supplyHdr);
    menu.cur = 0;
    let mode = 0;
    for (;;) {
      this.supplyTable();
      const sel = await menu.customMenu(menu.count, 4, 1);
      if (sel === 0xff) break;
      if (((menu.count - 4) & 0xff) > sel) {
        const slot = this.c.persons[sel >> 2], item = sel & 3;
        if (mode === 0) await this.load(slot, item); else await this.unload(slot, item);
        this.p.panels();
      } else { con.setCursor(0x10, 0x30); mode ^= 1; con.puts(labels[mode]); }
    }
    await this.p.interior(3);
    this.greet(0x38);
    return 0;
  }
  // 27d00 补给表与点击区 (每船 4 格 + 装上/卸下切换钮 4 个相同区域 + 取消区)
  supplyTable() {
    const m = this.m, { con, printf, menu } = this.c, R = menu.rects;
    const n = this.fleetShips();
    con.puts(this.WF.supplyColor);
    for (let i = 0; i < n; i++) {
      const slot = this.c.persons[i], M = m.crewSlot(slot), y = ((i + 3) * 0x18) & 0xffff;
      con.setCursor(0x12, y);
      printf(this.WF.supplyRow, m.ship(heroShipSlot(m, slot).ship).nameBytes, Math.trunc(domS16(M.water) / 10), Math.trunc(domS16(M.food) / 10), domS16(M.material), domS16(M.ammo));
      for (let j = 0; j < 4; j++) { const x0 = j * 0x28 + 0x108; R[i * 4 + j] = { x0, x1: x0 + 0x20, y0: y, y1: y + 0x10 }; }
    }
    menu.count = n * 4;
    for (let k = 0; k < 4; k++) R[menu.count++] = { x0: 0x80, x1: 0xc0, y0: 0x30, y1: 0x40 };
    R[menu.count] = { x0: 0x68, x1: 0x1d8, y0: 0x20, y1: n * 0x18 + 0x20 };
  }
  // 27a83 装上 (0 水 1 食物 2 资材 3 砲弹)
  async load(slot, item) {
    const m = this.m, { message, win, scr } = this.c, M = m.crewSlot(slot), E = m.portEconomy(this.port);
    let space = domS16(m.ship(heroShipSlot(m, slot).ship).maxCargo - this.cargoUsed(slot)), price = 0;
    const calcPrice = () => {
      const [cx, idx] = [[0x14, 2], [0x5a, 9], [0x78, 2]][item - 1];
      price = Math.trunc(((E.getPrices(idx) + 0x32) * cx) / 100);
      let mx = Math.trunc(this.money / price);
      if (mx > space) mx = space;
      space = mx;
    };
    if (scr.wideRenderer) {
      if (item === 0) this.greet(0x3e, space);
      else { calcPrice(); this.greet(0x3e + item, price, space); }
    } else {
      win.save(0x15, 0x148, 0x1e, 0x40);
      this.winText(0x15, 0x148, 0x1e, 0x38);
      if (item === 0) message(0x3e, space);
      else { calcPrice(); message(0x3e + item, price, space); }
    }
    const v = await this.numpad.input(0, space);
    switch (item) {
      case 0: M.water += 10 * v; break;
      case 1: M.food += 10 * v; break;
      case 2: M.material += v; break;
      case 3: M.ammo += v; break;
    }
    if (item) this.money = (this.money - Math.imul(v, price)) | 0;
    if (!scr.wideRenderer) await this.closeTalk();
  }
  // 27c16 卸下
  async unload(slot, item) {
    const m = this.m, { printf, win, scr } = this.c, M = m.crewSlot(slot);
    const props = ["water", "food", "material", "ammo"], prop = props[item];
    const have = item < 2 ? Math.trunc(domS16(M[prop]) / 10) : domS16(M[prop]);
    if (scr.wideRenderer) {
      this.beginWideTalk(null);
      printf(this.WF.unloadAsk, have);
    } else {
      win.save(0x15, 0x148, 0x1e, 0x40);
      this.winText(0x15, 0x148, 0x1e, 0x38);
      printf(this.WF.unloadAsk, have);
    }
    const v = await this.numpad.input(0, have);
    M[prop] -= item < 2 ? 10 * v : v;
    await this.closeTalk();
  }
}

export function installWharf(proto) {
  const desc = Object.getOwnPropertyDescriptors(WharfMixin.prototype);
  delete desc.constructor;
  Object.defineProperties(proto, desc);
}
