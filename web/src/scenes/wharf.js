// wharf.js — 碼頭 (補給 / 出航前檢查 / 船塢 / 補給港命名 / 出航清除畫面)
import { ListSelect } from "../ui/listsel.js";
import { marketTradeLog } from "./market.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { runWideTableSelect } from "../canvas_ui/wide_table.ts";
import { decodeCleanCstr } from "../canvas_ui/text_util.ts";

class WharfMixin {
  async wharf() {
    const st = this.st, { sys, menu } = this.c;
    if (this.port >= 0x64 && this.port < 0x82) return this.supplyPort();     // 286ac
    this.guards();
    await this.crewDemands();
    const items = this.c.menuItems(9);
    let si = 1;
    if (!st.u8(DS.COMMON_CHAP) && (st.u8(WorkDS.FLAGS) & 3) && !(st.u8(WorkDS.FLAGS) & 4) && !(((st.u8(DS.TBL_PORT + this.port * 0x16 + 0x15) & 7) ^ st.u8(this.hero + 0x31)) & 0x0f)) {
      this.greet(0x199); this.c.message(0x19a + (st.u8(this.hero + 0x31) & 15)); this.c.message(0x1a0); await this.wait();
      st.set8(WorkDS.FLAGS, st.u8(WorkDS.FLAGS) | 2); si = 0;
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
  // 28741: 夜間 (時刻 ≤ 0x12 或 ≥ 0x36) random(3)=0 且港口所屬國與主角艦隊國家敵對時, 站立行人 4..7 改成衛兵站在入口旁
  guards() {
    const st = this.st, t = this.c.rt.time, nation = st.u8(DS.TBL_PORT + this.port * 0x16 + 0x15) & 7;
    if (!(t <= 0x12 || t >= 0x36)) return;
    if (this.c.sys.rng.random(3)) return;
    if (nation >= 6) return;
    const fn = Math.trunc(st.u8(this.hero + 0x2c) / 10);
    if (!(st.u8(DS.TBL_COUNTRY + nation * 0x20 + 0x12 + fn) & 0x10)) return;
    for (let i = 0, extra = 0; i < 4; i++) {
      if (i === 3) extra++;
      const d = (i + extra) * 2, a = 0x0cc8 + i * 3;
      st.set8(a, st.u8(0x0904 + d) + 2); st.set8(a + 1, st.u8(0x0905 + d) + 1); st.set8(a + 2, i);
      if (i === 2) { st.set8(a, 0xff); st.set8(a + 1, 0xff); }
    }
  }
  // 28809: 忠誠 (+2b) < 30 的船員 random(4 − (+2f & 3)) = 0 時要求加薪
  async crewDemands() {
    const st = this.st, { message, menu, sys } = this.c;
    const n = this.crewList();
    for (let di = 0; di < n; di++) {
      const who = this.c.persons[di], P = st.personRecord(who);
      if (st.u8(P + 0x2b) >= 0x1e) continue;
      if (sys.rng.random(4 - (st.u8(P + 0x2f) & 3))) continue;
      for (let si = 0; si < 0x1e; si++) {
        if (this.c.persons[di] !== st.u8(DS.PARTY_CREW + si) || st.u8(0x2e39 + si) >= 0x13) continue;
        this.talkPerson(this.c.persons[di]); message(0x31e); await this.wait(); await this.closeTalk();
        if (this.crewSpeaks() === this.c.persons[di]) message(0x320); else message(0x31f, this.dstr(P));
        if (await menu.yesNo()) {
          await this.closeTalk();
          this.talkPerson(this.c.persons[di]); message(0x321, ((st.u8(0x2e39 + si) + 1) * 10) & 0xffff);
          if (await menu.yesNo()) { await this.closeTalk(); st.set8(0x2e39 + si, st.u8(0x2e39 + si) + 1); st.set8(P + 0x2b, 0x1e); continue; }
        }
        await this.closeTalk();
        this.dismissMate(this.c.persons[di]);
      }
    }
  }
  // 2858b 船員離開艦隊, 留在本港
  dismissMate(n) {
    const st = this.st;
    for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) === n) { st.set8(DS.PARTY_CREW + i, 0xff); st.set8(0x2e39 + i, 0); break; }
    const P = st.personRecord(n); st.set8(P + 0x2e, 0); st.set8(P + 0x2c, 0xff); st.set8(P + 0x2d, this.port);
  }
  // 286ac 港 100..129 (補給港): MENU #57 出航 / 補給 / 命名
  async supplyPort() {
    const items = this.c.menuItems(57);
    if (this.noEvent()) this.greet(0x38);
    let sel, si = 1;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff) si = await [() => this.departWrap(), () => this.supply(), () => this.namePort()][sel]();
    } while (sel !== 0xff && !si);
  }
  // ---------- 船隻資料 (造船廠與船塢共用) ----------
  // ================= 碼頭 船塢 284ab =================
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
    palette.selectTimePalette(this.c.rt.time, false, this.st.weather);       // 0fea:98ce
    await this.p.interior(3);
    this.greet(0x38);
    return 0;
  }
  // 27fd5 本港船塢的船 → b06a[0..b066), 再補空船塢位到 b068 (最多 5)
  dockScan() {
    const st = this.st;
    this.b062 = this.fleetShips();
    this.b064 = domUmin16(this.captainPool(), 10);
    this.b06a = [0xff, 0xff, 0xff, 0xff, 0xff];
    this.freeSlots();
    this.b066 = 0;
    for (let i = 10; i < 0x28; i++) if (st.u8(this.crewData(i) + 0x1b) === (this.port | 0x80) && this.slotState(i) === 0x10) this.b06a[this.b066++] = i;
    this.b068 = this.b066;
    for (let i = 10; i < 0x28 && this.b068 < 5; i++) { const f = this.slotState(i); if (f !== 0x10 && f !== 0x20) this.b06a[this.b068++] = i; }
    this.c.scr.fillCols(0x3e, 0xc8, 0x10, 0x50, 7);
    this.dockList();
  }
  // 27f34 船塢列表與點擊區
  dockList() {
    const st = this.st, { con, printf, menu } = this.c, R = menu.rects;
    con.left = 0x3e; con.right = 0x4d; con.puts(this.SY.dockColor);
    let i = 0;
    for (; i < this.b066; i++) {
      const y = (i << 4) + 0xc8;
      con.setCursor(0x3e, y);
      printf(this.SY.dockRow, this.dstr(this.shipOf(this.b06a[i])));
      this.c.persons[i] = this.b06a[i];
      R[i] = { x0: 0x1f0, x1: 0x270, y0: y, y1: y + 0x10 };
    }
    R[i] = { x0: 0x1e0, x1: 0x280, y0: 0xa0, y1: 0x128 };
  }
  // 280ce 保管: 艦隊船 → 第一個空船塢位
  async dockKeep() {
    const st = this.st, { message, menu } = this.c, list = this.listSel();
    if (!this.b062) return;
    const n = this.notHeroShips();
    if (!n) { this.crewSpeaks(); message(0x117); await this.wait(); await this.closeTalk(); return; }
    if (this.b068 === this.b066) { this.greet(0x120); await this.wait(); return; }
    for (;;) {
      this.table(); this.greet(0x118);
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const slot = this.c.persons[r], S = this.fleetSlot(slot);
      this.shipData(st.u8(S + OFF.DOCK_SLOT.SHIP), 3, slot); this.figurehead(slot);
      if (st.u16(S)) this.greet(0x119, st.u16(S)); else this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      const d = this.b06a[this.b066];
      this.swapSlots(slot, d);
      const Mf = this.crewData(slot), Md = this.crewData(d);
      st.set8(Mf + 0x1c, 0); st.set8(Md + 0x1c, 0); st.set16(this.fleetSlot(slot), 0); st.set16(this.fleetSlot(d), 0);
      st.set8(Mf + 0x1b, 0xff); st.set8(st.personRecord(st.u8(Md + 0x1b)) + 0x2e, 6); st.set8(Md + 0x1b, this.port | 0x80);
      this.greet(0x11a); await this.wait();
      return;
    }
  }
  // 2820d 配備: 船塢船 → 第一個空艦隊位
  async dockTake() {
    const st = this.st, { message, menu } = this.c;
    this.dockList();
    if (!this.b066) { this.greet(0x11b); await this.wait(); return; }
    if (this.b064 === this.b062) { this.crewSpeaks(); message(0x11d); await this.wait(); await this.closeTalk(); return; }
    for (;;) {
      this.after(); this.dockList(); this.greet(0x11c);
      const sel = await menu.customMenu(this.b066, 1, 1);
      if (sel === 0xff) return;
      const d = this.c.persons[sel];
      this.shipData(st.u8(this.fleetSlot(d) + 7), 3, d); this.figurehead(d);
      this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      let f = 0; for (let i = 0; i < 10; i++) if (this.slotState(i) !== 0x10) { f = i; break; }
      this.swapSlots(f, d);
      const Mf = this.crewData(f), Md = this.crewData(d);
      st.set8(Mf + 0x1c, 0); st.set8(Md + 0x1c, 0); st.set16(this.fleetSlot(f), 0); st.set16(this.fleetSlot(d), 0);
      this.crewList();
      st.set8(Mf + 0x1b, this.c.persons[0]); st.set8(st.personRecord(this.c.persons[0]) + 0x2e, 2);
      st.set8(Md + 0x1b, this.port | 0x80);
      this.greet(0x11e); await this.wait();
      return;
    }
  }
  // 2834f 交換: 艦隊船 ↔ 船塢船
  async dockSwap() {
    const st = this.st, { menu } = this.c, list = this.listSel();
    if (!this.b062) return;
    if (!this.b066) { this.greet(0x11b); await this.wait(); return; }
    for (;;) {
      this.after();
      const n = this.fleetShips();
      this.greet(0x118);
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const f = this.c.persons[r];
      this.shipData(st.u8(this.fleetSlot(f) + 7), 3, f); this.figurehead(f);
      this.dockList(); this.greet(0x11c);
      const sel = await menu.customMenu(this.b066, 1, 1);
      if (sel === 0xff) return;
      const d = this.c.persons[sel];
      this.shipData(st.u8(this.fleetSlot(d) + 7), 3, d); this.figurehead(d);
      const cap = domS16(st.u16(this.shipOf(d) + 0x12)), have = domS16(st.u16(this.fleetSlot(f)));
      if (have > cap) this.greet(0x119, (have - cap) & 0xffff); else this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      this.swapSlots(f, d);
      const Mf = this.crewData(f), Md = this.crewData(d);
      st.set8(Mf + 0x1c, st.u8(Md + 0x1c)); st.set8(Md + 0x1c, 0);
      st.set16(this.fleetSlot(f), domUmin16(st.u16(this.fleetSlot(d)), cap)); st.set16(this.fleetSlot(d), 0);
      st.set8(Mf + 0x1b, st.u8(Md + 0x1b)); st.set8(Md + 0x1b, this.port | 0x80);
      this.greet(0x11f); await this.wait();
      return;
    }
  }
  // 1fd9:85d9 (285d9) 補給港命名: 回傳值決定補給港選單是否結束 (取消 → 港名位址 ≠ 0; 完成 → 0fea:490b 的 AX)
  async namePort() {
    const st = this.st, { win, sys } = this.c, R = a => DS.TBL_PORT + a * 0x16 + 4, me = R(this.port);
    const old = st.cstr(me).slice();
    const restore = () => { for (let i = 0; i < old.length; i++) st.set8(me + i, old[i]); };
    this.greet(0x39e); await this.wait();
    const ni = this.nameInput();
    ni.prompt(3, 8);
    if ((await ni.run(me, 8)) !== 1) { await win.close(); restore(); return me; }
    await win.close();
    const cur = st.cstr(me);
    let dup = false;
    for (let n = 0; n < 0x82 && !dup; n++) {
      if (n === this.port) continue;
      const o = st.cstr(R(n));
      if (o.length === cur.length && o.every((v, i) => v === cur[i])) dup = true;          // seg0:4bea strcmp
    }
    if (dup) { restore(); this.greet(0x39f); }
    else this.greet(0x3a0, this.dstr(me));
    await this.wait();
    // 0fea:490b 最後是 seg0:4ecf: 有滑鼠時 AX = 顯示計數舊值 (≠0) 或 3 (INT 33h fn 3); 沒有滑鼠時 AX = 131e3 的 0
    return sys.mouse.present ? 1 : 0;
  }
  // 27a63
  async departWrap() {
    if (!this.fleetShips()) return 0;
    const r = await this.depart();
    if (!r) await this.p.interior(3);
    return r;
  }
  // 清除地圖畫面區域 (欄 12..59, y 8..391)
  wipe() {
    this.c.scr.fillCols(0x0c, 8, 0x30, 0x180, 0);
    this.c.scr.dirty = true;
  }
  // 27802 出航: 艦隊資料表 → 補給天數 → 是/否
  //   積載率 = 5d36 × 100 (imul cx → DX:AX 32 位元) / 船 +14 (cwd) 經 seg0:38ba 無號長整數除法 (2793a..2793e); 不是 16 位元截斷
  async depart() {
    const st = this.st, { con, printf, message, menu, palette, scr, codec } = this.c, anim = st.u8(DS.OPTIONS) & 1;
    const n = this.fleetShips(), L = this.c.persons.slice(0, n);
    let noDriver = 0, crewT = 0, waterT = 0, foodT = 0;
    let wideDepartDraw = null;
    if (scr.wideRenderer && codec) {
      const dec = bts => decodeCleanCstr(codec, bts);
      const hdr = dec(this.WF.departHdr);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const slot = L[i], M = this.crewData(slot), S = this.fleetSlot(slot), ship = this.shipOf(slot);
        const crew = domS16(st.u16(S));
        waterT = (waterT + st.u16(M)) & 0xffff; foodT = (foodT + st.u16(M + 2)) & 0xffff; crewT = (crewT + st.u16(S)) & 0xffff;
        const drv = Math.trunc(crew * st.u8(M + 9) / 100), look = Math.trunc(crew * st.u8(M + 8) / 100);
        const deck = domS16(st.u16(S) - look - drv);
        const loadPct = domS16(Math.floor((Math.imul(domS16(this.cargoUsed(slot)), 100) >>> 0) / (domS16(st.u16(ship + 0x14)) >>> 0 || 1)) & 0xffff);
        const w = Math.trunc(domS16(st.u16(M)) / 10), f = Math.trunc(domS16(st.u16(M + 2)) / 10);
        rows.push({ name: dec(this.dstr(ship)), stat: `${drv}/${look}/${deck}  ${loadPct}%  ${w}  ${f}` });
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
        const slot = L[i], M = this.crewData(slot), S = this.fleetSlot(slot), ship = this.shipOf(slot);
        const crew = domS16(st.u16(S));
        waterT = (waterT + st.u16(M)) & 0xffff; foodT = (foodT + st.u16(M + 2)) & 0xffff; crewT = (crewT + st.u16(S)) & 0xffff;
        const drv = Math.trunc(crew * st.u8(M + 9) / 100), look = Math.trunc(crew * st.u8(M + 8) / 100);
        con.setCursor(0x0f, ((i + 3) * 0x18) & 0xffff);
        printf(this.WF.departRow, this.dstr(ship), drv, look, domS16(st.u16(S) - look - drv),
          domS16(Math.floor((Math.imul(domS16(this.cargoUsed(slot)), 100) >>> 0) / (domS16(st.u16(ship + 0x14)) >>> 0 || 1)) & 0xffff), Math.trunc(domS16(st.u16(M)) / 10), Math.trunc(domS16(st.u16(M + 2)) / 10));
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
    const fail = async m => { message(m); if (!anim && !wideDepartDraw) await palette.fadeToTarget(); await this.wait(); await this.closeTalk(); clearDepartOverlay(); return 0; };
    if (noDriver) return fail(0x39);
    const days = Math.trunc(domUmin16(waterT, foodT) / (crewT || 1));
    if (!days) return fail(0x3b);
    if (days >= 10 && days <= 0xb4) message(0x3d, days); else message(days >= 10 ? 0x3a : 0x3c);
    if (!anim && !wideDepartDraw) await palette.fadeToTarget();
    const ok = await menu.yesNo();
    await this.closeTalk();
    clearDepartOverlay();
    if (!ok) return 0;
    // 27a0c 出港: 0fea:e3e5 記錄 (種類 1, +4 天數, +6 港口) → [2e18] = 0 (出港天數), 方位 = 8 (停船) → 4fe3 清滑鼠移動量 → [1005] &= DF
    //   → 0fea:9348 / 9401 (扣一天的糧食與水) → 851f 進入海上 → [0caf] = FF, 回傳 1 (碼頭選單結束)
    marketTradeLog(st, this.c.rt, 1, days, 0, 0, this.port);
    st.set8(DS.DAYS_AT_SEA, 0);
    const sea = this.p;
    st.set8(sea.fleet + 0x1a, 8);
    this.c.sys.mickeys();
    st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0xdf);
    sea.foodDaily(); sea.waterDaily();
    await sea.enterSea();
    st.set8(DS.LAST_PORT, 0xff);
    return 1;
  }
  // 27e31 補給
  async supply() {
    const st = this.st, { con, menu, scr, codec } = this.c, labels = [this.WF.load, this.WF.unload];
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
          const slot = this.c.persons[i], M = this.crewData(slot);
          const nm = dec(this.dstr(this.shipOf(slot)));
          const vals = [Math.trunc(domS16(st.u16(M)) / 10), Math.trunc(domS16(st.u16(M + 2)) / 10), domS16(st.u16(M + 4)), domS16(st.u16(M + 6))];
          items.push({ label: nm, rightText: vals.join(" / ") });
        }
        const sel = await runWideTableSelect(this.c, { title: hdr, columns: 1, items, toggleLabel: dec(labels[mode]) });
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
  // 27d00 補給表與點擊區 (每船 4 格 + 裝上/卸下切換鈕 4 個相同區域 + 取消區)
  supplyTable() {
    const st = this.st, { con, printf, menu } = this.c, R = menu.rects;
    const n = this.fleetShips();
    con.puts(this.WF.supplyColor);
    for (let i = 0; i < n; i++) {
      const slot = this.c.persons[i], M = this.crewData(slot), y = ((i + 3) * 0x18) & 0xffff;
      con.setCursor(0x12, y);
      printf(this.WF.supplyRow, this.dstr(this.shipOf(slot)), Math.trunc(domS16(st.u16(M)) / 10), Math.trunc(domS16(st.u16(M + 2)) / 10), domS16(st.u16(M + 4)), domS16(st.u16(M + 6)));
      for (let j = 0; j < 4; j++) { const x0 = j * 0x28 + 0x108; R[i * 4 + j] = { x0, x1: x0 + 0x20, y0: y, y1: y + 0x10 }; }
    }
    menu.count = n * 4;
    for (let k = 0; k < 4; k++) R[menu.count++] = { x0: 0x80, x1: 0xc0, y0: 0x30, y1: 0x40 };
    R[menu.count] = { x0: 0x68, x1: 0x1d8, y0: 0x20, y1: n * 0x18 + 0x20 };
  }
  // 27a83 裝上 (0 水 1 食物 2 資材 3 砲彈)
  async load(slot, item) {
    const st = this.st, { message, win, scr } = this.c, M = this.crewData(slot), E = this.eco;
    let space = domS16(st.u16(this.shipOf(slot) + 0x14) - this.cargoUsed(slot)), price = 0;
    if (scr.wideRenderer) {
      if (item === 0) this.greet(0x3e, space);
      else {
        const [cx, off] = [[0x14, 0x10], [0x5a, 0x17], [0x78, 0x10]][item - 1];
        price = Math.trunc(((st.u8(E + off) + 0x32) * cx) / 100);
        let mx = Math.trunc(this.money / price);
        if (mx > space) mx = space;
        space = mx;
        this.greet(0x3e + item, price, space);
      }
    } else {
      win.save(0x15, 0x148, 0x1e, 0x40);
      this.winText(0x15, 0x148, 0x1e, 0x38);
      if (item === 0) message(0x3e, space);
      else {
        const [cx, off] = [[0x14, 0x10], [0x5a, 0x17], [0x78, 0x10]][item - 1];
        price = Math.trunc(((st.u8(E + off) + 0x32) * cx) / 100);
        let mx = Math.trunc(this.money / price);
        if (mx > space) mx = space;
        space = mx;
        message(0x3e + item, price, space);
      }
    }
    const v = await this.numpad.input(0, space);
    const add = (o, d) => st.set16(M + o, st.u16(M + o) + d);
    switch (item) {
      case 0: add(0, 10 * v); break;
      case 1: add(2, 10 * v); break;
      case 2: add(4, v); break;
      case 3: add(6, v); break;
    }
    if (item) this.money = (this.money - Math.imul(v, price)) | 0;
    if (!scr.wideRenderer) await this.closeTalk();
  }
  // 27c16 卸下
  async unload(slot, item) {
    const st = this.st, { printf, win, scr } = this.c, M = this.crewData(slot);
    const off = [0, 2, 4, 6][item], have = item < 2 ? Math.trunc(domS16(st.u16(M + off)) / 10) : domS16(st.u16(M + off));
    if (scr.wideRenderer) {
      this.beginWideTalk(null);
      printf(this.WF.unloadAsk, have);
    } else {
      win.save(0x15, 0x148, 0x1e, 0x40);
      this.winText(0x15, 0x148, 0x1e, 0x38);
      printf(this.WF.unloadAsk, have);
    }
    const v = await this.numpad.input(0, have);
    st.set16(M + off, st.u16(M + off) - (item < 2 ? 10 * v : v));
    await this.closeTalk();
  }
}

export function installWharf(proto) {
  const desc = Object.getOwnPropertyDescriptors(WharfMixin.prototype);
  delete desc.constructor;
  Object.defineProperties(proto, desc);
}
