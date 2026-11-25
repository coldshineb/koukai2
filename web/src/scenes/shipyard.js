// shipyard.js — 造船厂 (造新船 / 交船 / 买旧船 / 修理 / 卖船 / 改造 / 工业投资 / 折抵剩余货物分配)
import { GameConst, ShipSlotFlag, SkillFlag } from "../model/flags.ts";
import {
  WorldConst,
  getPortEcoExtra,
  heroOrDockSlot,
  heroShipSlot,
  setPortBuildDays,
  writeShipName,
} from "../model/world_helpers.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { createDomModal, hasDom, preserveScroll } from "../ui/modals.ts";
import { runDomShipyardWorkbench } from "../ui/buildings_panel.ts";
import { decodeCleanCstr, toSimp } from "../ui/text_util.ts";

class ShipyardMixin {
  // ================= 2 造船厂 1fd9:cc01 =================
  async shipyard() {
    const m = this.m, g = m.globals, { palette, menu } = this.c;
    if (!hasDom()) { palette.setTarget(palette.table("ships")); await palette.fadeToTarget(); }
    if (g.dailyFlags & 2) { this.greet(0xf9); await this.wait(); return; }
    if (hasDom() && this.c.codec) {
      await runDomShipyardWorkbench(this);
      this.fleetRecalc();
      return;
    }
    this.greet(0x4d);
    let sel;
    do {
      const items = this.c.menuItems(22), cache = m.usedShipCache(0);
      let n = 0; for (let i = 0; i < 5; i++) if (cache.getShipTypes(i) !== GameConst.EMPTY_SLOT) n++;   // seg0:5cc4(0) 中古船表第 1 笔
      if (!n) menu.disabled |= 2;
      this.b2f4 = this.b2f5 = this.b2f6 = this.b2f7 = 0xff; this.b2f8 = 0;
      sel = await this.menu(items);
      if (sel !== 0xff) {
        await [() => this.newShip(), () => this.usedShip(), () => this.repair(), () => this.sellShip(),
          () => this.remodel(), () => this.invest()][sel]();
        this.after();
      }
    } while (sel !== 0xff && !(g.dailyFlags & 2));
    this.fleetRecalc();
    if (!hasDom()) {
      palette.selectTimePalette(this.c.rt.time, false, g.weather);             // 0fea:98ce
      await palette.fadeToTarget();
    }
  }
  sTodo(n) { this.todo(n); }
  // 2bd77 造新船
  async newShip() {
    const m = this.m, E = m.portEconomy(this.port), ecoEx = getPortEcoExtra(E), { sys, win, con } = this.c;
    this.b2f8 = 1; this.b2f5 = this.b2f4 = 0xff;
    if (ecoEx.buildDays !== GameConst.EMPTY_SLOT) {                          // 2b867 有船在造
      if (ecoEx.buildDays) { this.greet(0x105, ecoEx.buildDays); await this.wait(); return; }
      return this.delivery();
    }
    const t0 = this.BT.levels[ecoEx.shipRegion][0];
    if (((10 * m.shipType(t0).shipClass) & 0xffff) > E.industry) { this.greet(0xfb); await this.wait(); return; }
    this.freeSlots();
    if (domS16(this.c.persons[0]) < 10) {                                      // 船坞已满
      sys.mouseHide();
      await win.open(0x15, 0xc0, 0x1e, 0x48, 0);
      con.puts(this.BT.fmt.dockFull);
      await this.wait(); await win.close();
      sys.mouseShow();
      return;
    }
    if (!this.freeSlots()) {
      this.greet(0xa7); await this.wait();
      this.b2f6 = await this.sellSelect(0);
      if (this.b2f6 === 0xff) return;
    } else this.b2f6 = this.c.persons[0];
    this.greet(0xfc); await this.wait();
    await this.buildSelect();
  }
  // 2bb91 选船型 → 材质 → 交涉 → 开工
  async buildSelect() {
    const m = this.m, E = m.portEconomy(this.port), ecoEx = getPortEcoExtra(E), { menu } = this.c, list = this.listSel(), P = this.c.persons;
    const row = this.BT.levels[ecoEx.shipRegion];
    let n = 0;
    for (let i = 0; i < 8; i++) { const t = row[i]; if (t === 0xff) break; if (((10 * m.shipType(t).shipClass) & 0xffff) <= E.industry) P[n++] = t + 0x28; }
    for (;;) {
      const r = await list.select(0x8e, n);
      if (r === -1) return;
      const t = (P[r] - 0x28) & 0xff, T = m.shipType(t);
      this.shipData(t, 2);
      this.greet(this.BT.typeMsg[t]); await this.wait();
      this.greet(0xfd);
      if (!(await menu.yesNo())) continue;
      const mat = await this.material(t);
      const base = domS16(T.price);
      const price = (Math.trunc(base * 4 / 5) + Math.trunc(base * mat / 10)) & 0xffff;
      if (!(await this.negotiate(t, price))) return;
      this.greet(0x101); await this.wait();
      const S = heroOrDockSlot(m, this.b2f6), ship = m.ship(S.ship), M = m.crewSlot(this.b2f6);
      S.flags = ShipSlotFlag.BUILDING;
      ship.flags = (ship.flags & 0xf8) | mat;
      const d = domUmin16(Math.trunc((mat + 8) * T.durability / 10), 100);
      S.maxDurability = d; S.durability = d;
      M.captain = this.port | 0x80;
      this.shipData(t, 2);
      this.durPrint(S.durability);
      await this.design(this.b2f6);
      const q = ((100 - Math.trunc(E.industry / 50)) & 0xffff) * T.durability;
      setPortBuildDays(E, Math.trunc(q / 100) & 0xff);
      this.greet(0x106, getPortEcoExtra(E).buildDays); await this.wait();
      return;
    }
  }
  // 2bad3 材质
  async material(t) {
    const m = this.m, E = m.portEconomy(this.port), { menu } = this.c, list = this.listSel(), P = this.c.persons, T = m.shipType(t);
    const ind = E.industry;
    const n = t === 0x18 ? 6 : Math.trunc((ind - domUmin16(500, ind)) / 200) + 3;
    for (let i = 0; i < n; i++) P[i] = i;
    for (;;) {
      this.greet(0xfe);
      let r; do r = await list.select(0x8f, n); while (r === -1);
      const v = P[r];
      this.durPrint(domUmin16(Math.trunc((v + 8) * T.durability / 10), 100));
      this.greet(0xff);
      if (await menu.yesNo()) return v;
    }
  }
  // 2aebb 耐久度数字
  durPrint(v) {
    const { con, printf } = this.c;
    con.left = 0x1e; con.right = 0x39; con.setCursor(0x27, 0xb8);
    printf(this.BT.fmt.durNum, v);
  }
  // 2aeeb 最大载货 / 水手数 / 武器数
  designPrint(cargo, crew, guns) {
    const { con, printf } = this.c;
    con.lineH = 0x10; con.right = 0x3a; con.left = 0x35; con.setCursor(0x35, 0xd0);
    printf(this.BT.fmt.designNums, domS16(cargo), domS16(crew), guns);
    con.lineH = 0x18; con.left = 0x1f;
  }
  // 2b19d 设计 (水手数与武器数)
  async design(slot) {
    const m = this.m, { menu, printf } = this.c, F = this.BT.fmt;
    const S = heroOrDockSlot(m, slot), ship = m.ship(S.ship), T = m.shipType(ship.type);
    for (;;) {
      let cargo = T.capacity, crew;
      this.designPrint(cargo, 0, 0);
      this.greet(0x102); printf(F.crewRange, T.minCrew, T.maxCrewDiv10);
      do crew = (await this.numpad.input(0, T.maxCrewDiv10 * 10)) & 0xffff; while (T.minCrew > domS16(crew));
      cargo = (cargo - crew) & 0xffff;
      this.designPrint(cargo, crew, 0);
      this.greet(0x103); printf(F.gunRange, T.maxGuns);
      const guns = (await this.numpad.input(0, T.maxGuns)) & 0xff;
      cargo = (cargo - guns) & 0xffff;
      this.designPrint(cargo, crew, guns);
      this.greet(0x104);
      if (!(await menu.yesNo())) continue;
      if (domS16(this.cargoUsed(slot)) > domS16(cargo)) { this.greet(0x14); await this.wait(); return 0; }
      ship.maxCargo = cargo; ship.maxCrew = crew; ship.maxGuns = guns;
      const c12 = domS16(ship.maxCrew), s0 = domS16(S.crew);
      S.crew = c12 > s0 ? s0 : c12;
      S.guns = domUmin16(S.guns, ship.maxGuns);
      return 1;
    }
  }
  // 2b88d 交涉与付款 (造新船 / 买旧船)
  async negotiate(t, price) {
    const m = this.m, g = m.globals, { menu, message, sys } = this.c;
    let k = 5, avail = this.money;
    let cost = Math.imul(Math.trunc(Math.imul(this.priceIndex() + 50, price) / 100), 10) | 0;
    if (this.b2f4 !== 0xff) {
      avail = (avail + Math.trunc(this.shipPrice(this.b2f4) / 2)) | 0;
      this.b2f7 = m.crewSlot(this.b2f4).captain;
    }
    this.greet(this.b2f8 ? 0x100 : 0xc2, cost);
    const floor = Math.trunc(Math.imul(500 - m.heroPerson().getStats(6), cost) / 500) | 0;
    if (!(await menu.yesNo())) {
      const acc = this.roleMember(4);
      if (acc !== 0xff) {
        if (!(m.person(acc).skills & SkillFlag.ACCOUNTING)) k = sys.rng.random(10);
        this.crewSpeaks([4, 3, 5, 2, 6]); message(0xc4, Math.trunc(Math.imul(k + 95, floor) / 100) | 0);
        await this.wait(); await this.closeTalk();
      }
      this.greet(0xc3);
      const offer = (await this.numpad.input(0, avail > cost ? cost : avail)) | 0;
      if (offer < floor) {
        if (!sys.rng.random(5)) { g.dailyFlags |= 2; this.greet(0xc5); }
        else this.greet(0xc6);
        await this.wait();
        return 0;
      }
      this.greet(0x35f, offer); await this.wait();
      cost = offer;
    }
    if (avail < cost) { this.greet(0xef); await this.wait(); return 0; }
    this.money = (avail - cost) | 0;
    this.p.panels();
    const left = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
    if (this.b2f4 !== 0xff) this.transfer(0, left);
    await this.createShip(t);
    if (left.goods[0] !== 0xff) await this.leftovers(left);
    return 1;
  }
  // 0fea:e788 + 0fea:fe57 + 8ebc(2)
  async leftovers(left) {
    if (this.c.scr.wideRenderer && hasDom() && this.c.codec) {
      await this.leftoversDom(left.goods, left.amt);
      return;
    }
    this.fleetTable();
    await this.distribute(left.goods, left.amt);
    await this.p.interior(2);
  }
  async leftoversDom(lg, la) {
    const m = this.m, codec = this.c.codec;
    const dec = bts => toSimp(decodeCleanCstr(codec, bts));
    const supNames = ["水", "食物", "资材", "炮弹"];
    const goodsNames = this.LO?.goods ?? [];
    let selLeft = 0;

    const getLefts = () => {
      const out = [];
      for (let i = 0; i < lg.length; i++) {
        if (lg[i] === 0xff || la[i] <= 0) continue;
        const g = lg[i];
        const name = (g & 0x80) ? (supNames[g & 0x7f] || "补给") : (goodsNames[g] ? dec(goodsNames[g]) : `货物#${g}`);
        out.push({ idx: i, code: g, name, amt: la[i] });
      }
      return out;
    };
    const getShips = () => {
      const out = [];
      for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
        const S = heroShipSlot(m, i);
        if ((S.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
        const ship = m.ship(S.ship);
        const max = ship.maxCargo, used = this.cargoUsed(i);
        out.push({ slot: i, name: dec(ship.nameBytes), used, max, free: Math.max(0, max - used) });
      }
      return out;
    };
    const putIntoShip = (leftItem, shipSlot) => {
      const S = heroOrDockSlot(m, shipSlot), ship = m.ship(S.ship);
      const free = Math.max(0, ship.maxCargo - this.cargoUsed(shipSlot));
      if (free <= 0) return;
      const move = Math.min(leftItem.amt, free);
      const M = m.crewSlot(shipSlot), g = leftItem.code;
      if (g & 0x80) {
        const k = g & 0x7f;
        const mult = k < 2 ? 10 : 1;
        if (k === 0) M.water += move * mult;
        else if (k === 1) M.food += move * mult;
        else if (k === 2) M.material += move * mult;
        else if (k === 3) M.ammo += move * mult;
      } else {
        let j = -1;
        for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
          const cg = M.getCargoGoods(k);
          if (cg === g) { j = k; break; }
          if (cg === GameConst.EMPTY_SLOT && j < 0) j = k;
        }
        if (j < 0) return;
        M.setCargoGoods(j, g);
        M.setCargoAmts(j, M.getCargoAmts(j) + move);
      }
      la[leftItem.idx] -= move;
      if (la[leftItem.idx] <= 0) lg[leftItem.idx] = 0xff;
      this.loadTotal(shipSlot);
    };

    await new Promise(resolve => {
      const h = createDomModal({
        title: "剩余货物分配",
        size: "wide",
        cancelable: true,
        closeLabel: "完成",
        onCancel: () => resolve(),
      });
      const render = () => {
        preserveScroll(h.body, () => {
          h.body.innerHTML = "";
          const lefts = getLefts();
          const ships = getShips();
          if (!lefts.length) { h.close(); resolve(); return; }
          if (selLeft >= lefts.length) selLeft = 0;

          const split = document.createElement("div");
          split.className = "uw2-split";

          const lCol = document.createElement("div");
          lCol.className = "uw2-pane";
          lCol.innerHTML = `<div class="uw2-pane-title">未装载货物</div>`;
          const lList = document.createElement("div");
          lList.className = "uw2-list-col";
          lefts.forEach((it, i) => {
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${i === selLeft ? "selected" : ""}`;
            btn.innerHTML = `<span style="font-weight:700;">${it.name}</span><strong>${it.amt}</strong>`;
            btn.addEventListener("click", () => { selLeft = i; render(); });
            lList.appendChild(btn);
          });
          lCol.appendChild(lList);

          const rCol = document.createElement("div");
          rCol.className = "uw2-pane";
          rCol.innerHTML = `<div class="uw2-pane-title">点击目标舰船装入「${lefts[selLeft].name}」</div>`;
          const rList = document.createElement("div");
          rList.className = "uw2-list-col";
          ships.forEach(s => {
            const btn = document.createElement("button");
            btn.className = "uw2-row-card";
            btn.disabled = s.free <= 0;
            btn.innerHTML = `<span style="font-weight:700;">${s.name}</span><span>空余 ${s.free} (${s.used}/${s.max})</span>`;
            btn.addEventListener("click", () => { putIntoShip(lefts[selLeft], s.slot); render(); });
            rList.appendChild(btn);
          });
          rCol.appendChild(rList);

          split.append(lCol, rCol);
          h.body.appendChild(split);
        }, true);
      };
      render();
    });
  }
  // 1e628 舰队表 (不保存背景)
  fleetTable() {
    const m = this.m, { win, con, printf } = this.c, F = this.LO.fmt;
    let n = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if ((heroShipSlot(m, i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE) n++;
    win.frame(0x0f, 0x20, 0x2b, ((n + 2) * 0x18) & 0xffff, 1);
    con.setCursor(0x20, 0x30); printf(F.fleetHdr);
    let row = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      const S = heroShipSlot(m, i);
      if ((S.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      const ship = m.ship(S.ship), M = m.crewSlot(i);
      con.setCursor(0x11, (row + 3) * 0x18); con.puts(ship.nameBytes);
      con.setCursor(0x20, -1);
      if (M.captain & 0x80) con.puts(F.fleetGone);
      else {
        const T = m.shipType(ship.type), s0 = S.crew;
        const a = Math.floor(((M.navRatio * s0) & 0xffff) / 100), b = Math.floor(((M.lookRatio * s0) & 0xffff) / 100);
        const c = (s0 - b - a) & 0xffff;
        const ld = domS16((this.cargoUsed(i) + S.guns + S.crew) & 0xffff);                          // seg0:5d8b
        const d = Math.floor((Math.imul(ld, 100) >>> 0) / (domS16(T.capacity) >>> 0 || 1)) & 0xffff;   // seg0:38ba 无号长整数除法
        printf(F.fleetRow, a, b, domS16(c), domS16(d), (this.shipSpeed(i) + 1) >> 1);
      }
      row++;
    }
  }
  // 1f555 「未装载的货物」清单 (重新排紧)
  leftList(lg, la) {
    const { scr, con, printf } = this.c, F = this.LO.fmt, names = this.LO.goods;
    scr.fillCols(0x3c, 0x70, 0x10, 0x90, 7);
    con.right = 0x4b; con.left = 0x3c;
    con.setCursor(0x3c, 0x50); con.puts(F.title);
    const g = lg.slice(), a = la.slice();
    lg.fill(0xff); la.fill(0);
    let d = 0;
    for (let i = 0; i < 9; i++) {
      if (g[i] === 0xff) continue;
      con.setCursor(con.left, (d + 7) << 4);
      con.puts(g[i] & 0x80 ? this.LO.supplies[g[i] & 0x7f] : names[g[i]]);
      con.setCursor(con.left + 0x0c, -1);
      printf(F.num, domS16(a[i]));
      lg[d] = g[i]; la[d] = a[i]; d++;
    }
  }
  // 1f64a 一艘船的补给与货物 → 暂存表 sg / sa (水与粮食 /10), 返回笔数
  shipList(slot, sg, sa) {
    const m = this.m, { scr, con, printf } = this.c, F = this.LO.fmt, names = this.LO.goods, SUP = this.LO.supplies;
    scr.fillCols(0x18, 0x70, 0x10, 0x90, 7);
    sg.fill(0xff);
    con.left = 0x18; con.right = 0x27;
    const ship = m.ship(heroOrDockSlot(m, slot).ship), M = m.crewSlot(slot);
    con.setCursor(0x18, 0x50); printf(F.shipName, ship.nameBytes);
    const sup = [Math.trunc(domS16(M.water) / 10), Math.trunc(domS16(M.food) / 10), M.material, M.ammo];
    for (let k = 0; k < 4; k++) {
      con.setCursor(0x18, 0x70 + 0x10 * k); con.puts(SUP[k]);
      con.setCursor(0x18 + 0x0c, -1); printf(F.num, domS16(sup[k] & 0xffff));
      sg[k] = 0x80 + k; sa[k] = sup[k] & 0xffff;
    }
    let d = 4;
    for (let i = 0; i < GameConst.CARGO_SLOTS; i++) {
      const g = M.getCargoGoods(i);
      if (g === GameConst.EMPTY_SLOT) continue;
      const amt = M.getCargoAmts(i);
      con.setCursor(0x18, (d + 7) << 4); con.puts(names[g]);
      con.setCursor(0x18 + 0x0c, -1); printf(F.num, domS16(amt));
      sg[d] = g; sa[d] = amt; d++;
    }
    return d;
  }
  // 1f851 暂存表写回船员配置
  shipWrite(slot, sg, sa) {
    const M = this.m.crewSlot(slot);
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { M.setCargoGoods(k, GameConst.EMPTY_SLOT); M.setCargoAmts(k, 0); }
    let d = 0;
    for (let s = 0; s < 9; s++) {
      const g = sg[s];
      if (g === 0x80) M.water = 10 * sa[s];
      else if (g === 0x81) M.food = 10 * sa[s];
      else if (g === 0x82) M.material = sa[s];
      else if (g === 0x83) M.ammo = sa[s];
      else if (g === GameConst.EMPTY_SLOT || g >= 0x2e) { M.setCargoGoods(d, GameConst.EMPTY_SLOT); M.setCargoAmts(d, 0); d++; }
      else { M.setCargoGoods(d, g); M.setCargoAmts(d, sa[s]); d++; }
    }
    M.loadTotal = this.loadTotal(slot);
  }
  // 1f93d 选中船上第 sel 列: 空列 → 先从剩余货物选一种; 再用计算机决定装在船上的数量
  async loadItem(slot, sel, sg, sa, lg, la) {
    const m = this.m, { menu } = this.c, R = menu.rects, ship = m.ship(heroOrDockSlot(m, slot).ship);
    let total = 0;
    for (let i = 0; i < 9; i++) if (sg[i] !== 0xff) total = (total + sa[i]) & 0xffff;
    let g = sg[sel];
    if (g === 0xff) {
      let k = 0; while (k < 9 && lg[k] !== 0xff) k++;
      if (!k) return;
      for (let i = 0; i < k; i++) R[i] = { x0: 0x1e0, x1: 0x260, y0: (i + 7) << 4, y1: ((i + 7) << 4) + 0x10 };
      R[k] = { x0: 0x1d0, x1: 0x270, y0: 0x40, y1: 0x110 };
      const r = await menu.customMenu(k, 1, 1);
      if (r === 0xff) return;
      sa[sel] = 0;
      for (let j = 0; j < 9; j++) if (sg[j] === lg[r]) { sel = j; break; }
      sg[sel] = g = lg[r];
    }
    let cur = sa[sel], k = 0xff;
    for (let j = 0; j < 9; j++) {
      if (lg[j] === g) { cur = (cur + la[j]) & 0xffff; k = j; break; }
      if (k === 0xff && lg[j] === 0xff) k = j;
    }
    if (k === 0xff) return;
    const room = (sa[sel] + ship.maxCargo - total) & 0xffff;
    const v = (await this.numpad.input(0, domS16(domUmin16(room, cur)))) & 0xffff;
    sa[sel] = v;
    lg[k] = sg[sel]; la[k] = (cur - v) & 0xffff;
    if (!sa[sel] && !(sg[sel] & 0x80)) sg[sel] = 0xff;
    if (!la[k]) lg[k] = 0xff;
  }
  // 1fb6e 一艘船的装卸
  async shipLoad(slot, lg, la) {
    const { win, menu } = this.c, R = menu.rects, sg = new Array(9).fill(0xff), sa = new Array(9).fill(0);
    win.shadowedSaved(0x16, 0x40, 0x14, 0xd0, 1);
    for (;;) {
      const n = this.shipList(slot, sg, sa), m = n < 9 ? n + 1 : n;
      for (let i = 0; i < m; i++) R[i] = { x0: 0xc0, x1: 0x140, y0: (i + 7) << 4, y1: ((i + 7) << 4) + 0x10 };
      R[m] = { x0: 0xb0, x1: 0x150, y0: 0x40, y1: 0x110 };
      const r = await menu.customMenu(m, 1, 1);
      if (r === 0xff) { await win.close(); return; }
      await this.loadItem(slot, r, sg, sa, lg, la);
      this.shipWrite(slot, sg, sa);
      this.leftList(lg, la);
    }
  }
  // 1fcf7 (0fea:fe57) 剩余货物分配: 选舰队的船 → 装卸; Esc → 确认 (还有剩 0xd3 / 全部装完 0xdb)
  async distribute(lg, la) {
    const { win, menu, con, message } = this.c, R = menu.rects;
    win.shadowedSaved(0x3a, 0x40, 0x14, 0xd0, 1);
    this.leftList(lg, la);
    for (;;) {
      const n = this.fleetShips();                                         // 1e8b5
      menu.count = n;
      for (let i = 0; i < n; i++) R[i] = { x0: 0x88, x1: 0x1b8, y0: (i + 3) * 0x18, y1: i * 0x18 + 0x58 };
      R[n] = { x0: 0x78, x1: 0x1d0, y0: 0x20, y1: (0x18 * n + 0x50) & 0xffff };
      con.bg = 0x0f;
      const sel = await menu.customMenu(n, 1, 1);
      if (sel === 0xff) {
        let sum = 0; for (let i = 0; i < 9; i++) sum = (sum + la[i]) & 0xffff;
        win.shadowedSaved(0x1e, 0x120, 0x1c, 0x48, 1);                     // 1edb5
        message(sum ? 0xd3 : 0xdb);
        if (await menu.yesNo()) { await win.close(); await win.close(); return; }
        await win.close();
        continue;
      }
      await this.shipLoad(this.c.persons[sel], lg, la);
      this.fleetTable();
    }
  }
  // 2b326 折抵船 (b2f4) 的砲、水手、补给与货物 (原版目的船位也是 b2f4)
  transfer(flag, left) {
    const m = this.m, src = this.b2f4, dst = this.b2f4;
    const Md = m.crewSlot(dst), Ms = m.crewSlot(src), Sd = heroOrDockSlot(m, dst), Ss = heroOrDockSlot(m, src), shipD = m.ship(Sd.ship);
    left.goods.fill(0xff);
    Sd.guns = domUmin16(Ss.guns, shipD.maxGuns);
    Sd.flags &= 0xf8;
    if (Sd.guns) Sd.flags |= Ss.flags & 7;
    Sd.crew = domUmin16(Ss.crew, shipD.maxCrew);
    if (flag && domS16(this.cargoUsed(src)) <= domS16(shipD.maxCargo)) {
      Md.water = Ms.water; Md.food = Ms.food; Md.material = Ms.material; Md.ammo = Ms.ammo;
      for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { Md.setCargoGoods(k, Ms.getCargoGoods(k)); Md.setCargoAmts(k, Ms.getCargoAmts(k)); }
      return;
    }
    left.goods.fill(0xff);
    let c = 0;
    const add = (g, a) => { left.goods[c] = g; left.amt[c] = a & 0xffff; c++; };
    const w = Math.trunc(domS16(Ms.water) / 10); if (w) add(0x80, w);
    const f = Math.trunc(domS16(Ms.food) / 10); if (f) add(0x81, f);
    if (Ms.material) add(0x82, Ms.material);
    if (Ms.ammo) add(0x83, Ms.ammo);
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { const g = Ms.getCargoGoods(k); if (g !== GameConst.EMPTY_SLOT) add(g, Ms.getCargoAmts(k)); }
  }
  // 2ad12 创建新船记录并命名
  async createShip(t) {
    const m = this.m, { win } = this.c, T = m.shipType(t), tmpl = m.ship(t + 0x28);
    const S = heroOrDockSlot(m, this.b2f6), M = m.crewSlot(this.b2f6), trade = this.b2f4 !== 0xff;
    let n = 0;
    for (let i = 0; i < 0x28; i++) if (m.ship(i).type === GameConst.EMPTY_SLOT) { n = i; break; }
    const si = m.ship(n);
    si.maxGuns = T.maxGuns; si.type = t;
    si.flags = tmpl.flags; si.maxCrew = tmpl.maxCrew;
    si.maxCargo = (T.capacity - si.maxGuns - si.maxCrew) & 0xffff;
    const d = Math.trunc(9 * T.durability / 10) & 0xffff;
    S.maxDurability = (d - Math.trunc((d & 0xff) / 15)) & 0xff; S.durability = S.maxDurability;
    S.turn = T.turn; S.propulsion = T.propulsion;
    S.guns = domUmin16(S.guns, trade ? si.maxGuns : 0);
    S.crew = domUmin16(S.crew, trade ? si.maxCrew : 0);
    S.ship = n;
    if (!trade) S.flags = ShipSlotFlag.ACTIVE;
    M.water = 0; M.food = 0; M.material = 0; M.ammo = 0;
    M.navRatio = 0x19; M.lookRatio = 0x32; M.captain = this.b2f7;
    M.loadTotal = 0; M.figurehead = 0;
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { M.setCargoGoods(k, GameConst.EMPTY_SLOT); M.setCargoAmts(k, 0); }
    this.greet(0xc7);
    const ni = this.nameInput();
    for (;;) {
      ni.prompt(2, 7);
      if ((await ni.run(si.addr, 7)) === 1) break;
      await win.close();
    }
    await win.close();
  }
  // 2b2f2 船员栏第一个职务 ≥ 3 的人 → b2f7
  findMate() {
    const m = this.m;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) { const n = m.partyCrew(i); if (n !== GameConst.EMPTY_SLOT && m.person(n).role >= 3) { this.b2f7 = n; return 1; } }
    return 0;
  }
  // 2b66a 决定新船的船长与船位
  async captainAndSlot() {
    this.b2f5 = this.b2f4 = 0xff;
    let need = 0;
    if (!this.findMate()) { this.greet(0xa6); await this.wait(); need = 1; }
    if (this.fleetShips() === 10) need = 1;
    if (need) {
      this.greet(0xa7); await this.wait();
      this.b2f6 = await this.sellSelect(0);
      return this.b2f6 === 0xff ? 0 : 1;
    }
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) { const f = this.slotState(i); if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) { this.b2f6 = i; break; } }
    return 1;
  }
  // 2b701 交船
  async delivery() {
    const m = this.m, heroId = m.globals.hero, E = m.portEconomy(this.port), { menu } = this.c;
    let slot = 0;
    for (let i = 0; i < 0x28; i++) if (m.crewSlot(i).captain === (this.port | 0x80) && this.slotState(i) === ShipSlotFlag.BUILDING) { slot = i; break; }
    this.b2f6 = 0xff;
    this.greet(0xfa); await this.wait();
    this.greet(0x107); this.freeSlots();
    if (!(await menu.yesNo()) || !(await this.captainAndSlot())) { this.greet(0x109); await this.wait(); return; }
    const S = heroOrDockSlot(m, slot), M = m.crewSlot(slot);
    S.flags = (S.flags & 0xdf) | ShipSlotFlag.ACTIVE;
    M.captain = this.b2f7;
    if (this.b2f7 !== heroId) m.person(this.b2f7).role = 2;
    setPortBuildDays(E, GameConst.EMPTY_SLOT);
    if (this.b2f6 !== 0xff) this.swapSlots(slot, this.b2f6);
    this.compactSlots();
    if (this.b2f4 !== 0xff) {
      this.b2f4 = slot;
      const left = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
      this.transfer(1, left);
      this.sellDone();
      if (left.goods[0] !== 0xff) await this.leftovers(left);
    }
    m.person(this.b2f7).role = this.b2f7 !== heroId ? 2 : 1;
  }
  // 2be49 买旧船
  async usedShip() {
    const m = this.m, heroId = m.globals.hero, { menu } = this.c, list = this.listSel(), P = this.c.persons;
    this.b2f8 = 0;
    if (!(await this.captainAndSlot())) return;
    const cache = m.usedShipCache(0), idx = [];                               // seg0:5cc4(0)
    let n = 0;
    for (let i = 0; i < 5; i++) { const t = cache.getShipTypes(i); if (t !== GameConst.EMPTY_SLOT) { idx[n] = i; P[n++] = t + 0x28; } }
    for (;;) {
      const r = await list.select(0x8e, n);
      if (r === -1) return;
      const t = (P[r] - 0x28) & 0xff;
      this.shipData(t, 1);
      this.greet(this.BT.typeMsg[t]); await this.wait();
      this.greet(0xc1);
      if (!(await menu.yesNo())) continue;
      if (!(await this.negotiate(t, m.shipType(t).price))) return;
      if (this.b2f7 !== heroId) m.person(this.b2f7).role = 2;
      cache.setShipTypes(idx[r], GameConst.EMPTY_SLOT);
      return;
    }
  }
  // 2c664 改造
  async remodel() {
    if (!this.fleetShips()) return;
    let sel;
    do {
      sel = await this.menu(this.c.menuItems(23));
      if (sel !== 0xff) { await [() => this.rmFigure(), () => this.rmGuns(), () => this.rmRatio(), () => this.rmName()][sel](); this.after(); }
    } while (sel !== 0xff);
  }
  // 改造子功能共用: 选舰队的船并显示数据 (清单 0x80 → 2af30(3) + 2b119)
  async rmPick(msg) {
    this.greet(msg);
    const r = await this.listSel().select(0x80, this.fleetShips());
    if (r === -1) return -1;
    const slot = this.c.persons[r];
    this.shipData(heroOrDockSlot(this.m, slot).ship, 3, slot); this.figurehead(slot);
    return slot;
  }
  // 2c371 船首像
  async rmFigure() {
    const m = this.m, E = m.portEconomy(this.port), H = m.heroPerson(), rng = this.c.sys.rng;
    let n = domUmin16(Math.trunc(E.commerce / 100) + 1, 8);
    if (E.industry > 800 && E.commerce > 800 && H.getStats(7) > 80 && !rng.random(20)) {
      n++; if (rng.random(H.getStats(7)) >= 90) n++;
      this.greet(0x10a); await this.wait();
    }
    for (;;) {
      const slot = await this.rmPick(0x10b);
      if (slot === -1) return;
      await this.chooseFigure(slot, n);
      this.p.panels();
    }
  }
  // 2c11d
  async chooseFigure(slot, n) {
    const { menu } = this.c, P = this.c.persons, M = this.m.crewSlot(slot);
    for (let i = 0; i < n; i++) P[i] = i + 1;
    for (;;) {
      this.greet(0x10c);
      const r = await this.listSel().select(0x90, n);
      if (r === -1) return;
      const v = P[r] & 0xff, price = v * v * 500;
      this.greet(0x10d, price);
      if (!(await menu.yesNo())) continue;
      if (this.money < price) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - price) | 0;
      M.figurehead = v;
      this.p.panels();
      return;
    }
  }
  // 2c43d 武装
  async rmGuns() {
    const m = this.m, E = m.portEconomy(this.port), H = m.heroPerson(), rng = this.c.sys.rng;
    let n = domUmin16(Math.trunc(((E.industry + E.commerce) & 0xffff) / 200) + 1, 6);
    if (E.industry > 900 && E.commerce > 900 && H.getStats(7) > 90 && !rng.random(20)) {
      n++; this.greet(0x10a); await this.wait();
    }
    for (;;) {
      const slot = await this.rmPick(0x10e);
      if (slot === -1) return;
      await this.chooseGuns(slot, n);
      this.p.panels();
    }
  }
  // 2c1da
  async chooseGuns(slot, n) {
    const m = this.m, { menu } = this.c, P = this.c.persons, BT = this.BT;
    const S = heroOrDockSlot(m, slot), ship = m.ship(S.ship);
    for (let i = 0; i < n; i++) P[i] = i + 1;
    for (;;) {
      this.greet(0x10c);
      const r = await this.listSel().select(0x91, n);
      if (r === -1) return;
      const v = P[r] & 0xff, kind = r + 1;
      let room = ship.maxGuns;
      if (!room) { this.greet(0x3fd); await this.wait(); continue; }
      const same = (S.flags & 7) === kind;
      if (same) {
        room = (room - S.guns) & 0xffff;
        if (!room) { this.greet(0x3fc); await this.wait(); continue; }
        this.greet(0x14e, BT.cannons[v], S.guns, room);
      } else this.greet(0x10f);
      let q = (await this.numpad.input(0, room)) & 0xff;
      if (!q) continue;
      const price = Math.imul(q, domS16(BT.cannonPrice[v])) | 0;
      this.greet(0x110, BT.cannons[v], q, price);
      if (!(await menu.yesNo())) continue;
      if (price > this.money) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - price) | 0;
      if ((S.flags & 7) === kind) q = (q + S.guns) & 0xff;
      S.guns = q;
      S.flags = (S.flags & 0xf8) | (kind & 0xff);
      this.p.panels();
      return;
    }
  }
  // 2c4f6 积载比例变更
  async rmRatio() {
    const m = this.m, { menu } = this.c;
    for (;;) {
      const slot = await this.rmPick(0x111);
      if (slot === -1) return;
      const cost = domS16(m.shipType(m.ship(heroOrDockSlot(m, slot).ship).type).price);
      this.greet(0x112, cost);
      if (!(await menu.yesNo())) continue;
      if (cost > this.money) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      if (await this.design(slot)) { this.money = (this.money - cost) | 0; this.p.panels(); }
    }
  }
  // 2c5c2 船名变更
  async rmName() {
    const { win } = this.c;
    for (;;) {
      const slot = await this.rmPick(0x111);
      if (slot === -1) return;
      const ship = this.m.ship(heroOrDockSlot(this.m, slot).ship);
      this.greet(0x113);
      const old = ship.nameBytes.slice();
      const ni = this.nameInput();
      ni.prompt(2, 7);
      if ((await ni.run(ship.addr, 7)) !== 1) writeShipName(ship, old);
      await win.close();
      this.p.panels();
    }
  }
  // 2bf40 修理
  async repair() {
    const m = this.m, { menu, message } = this.c, list = this.listSel();
    for (;;) {
      const n = this.fleetShips();
      if (!n) return;
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const S = heroOrDockSlot(m, this.c.persons[r]), T = m.shipType(m.ship(S.ship).type);
      let cost = domS16(S.maxDurability - S.durability - S.turn - S.propulsion + T.turn + T.propulsion);
      if (!cost) { this.greet(0xcc); await this.wait(); continue; }
      cost = domS16(cost * 20);
      this.greet(0xcd, cost);
      if (!(await menu.yesNo())) { this.greet(0xce); await this.wait(); continue; }
      if (cost > this.money) { this.crewSpeaks([4, 3, 5, 2, 6]); message(0xcf); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - cost) | 0;
      S.durability = S.maxDurability; S.turn = T.turn; S.propulsion = T.propulsion;
      this.p.panels();
    }
  }
  // 2b571 选择要卖的船 (flag: 主角是该船船长时另选一艘当主角的船)
  async sellSelect(flag) {
    const m = this.m, heroId = m.globals.hero, { menu, message } = this.c, list = this.listSel();
    for (;;) {
      this.b2f5 = this.b2f4 = 0xff;
      this.greet(0xc8);
      const r = await list.select(0x80, this.fleetShips());
      if (r === -1) return this.b2f4;
      const slot = this.b2f4 = this.c.persons[r];
      this.shipData(heroOrDockSlot(m, slot).ship, 3, slot); this.figurehead(slot);
      this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      const M = m.crewSlot(slot);
      if (M.captain === heroId) {
        this.crewSpeaks(); message(0xd1);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        if (flag) {
          this.talkClear(); message(0xd2);
          const r2 = await list.select(0x80, this.notHeroShips());
          if (r2 === -1) { await this.closeTalk(); continue; }
          this.b2f5 = this.c.persons[r2];
        }
        await this.closeTalk();
      }
      this.b2f7 = M.captain;
      return this.b2f4;
    }
  }
  // 2c043 卖船
  async sellShip() {
    const m = this.m, { menu, message } = this.c;
    for (;;) {
      const n = this.fleetShips();
      if (!n) return;
      if (n === 1) { this.greet(0xd0); await this.wait(); return; }
      if ((await this.sellSelect(1)) === 0xff) return;
      const slot = this.b2f4;
      if (this.cargoUsed(slot)) {
        this.crewSpeaks(); message(0xd3);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        await this.closeTalk();
      }
      if (heroOrDockSlot(m, slot).crew) {
        this.crewSpeaks(); message(0xd4);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        await this.closeTalk();
      }
      this.greet(0xd5, Math.trunc(this.shipPrice(slot) / 2));
      if (!(await menu.yesNo())) { this.greet(0xd6); await this.wait(); continue; }
      this.sellDone();
    }
  }
  // 2b4f2
  sellDone() {
    const m = this.m, M = m.crewSlot(this.b2f4);
    if (this.b2f5 !== 0xff) { const M2 = m.crewSlot(this.b2f5); M.captain = M2.captain; M2.captain = m.globals.hero; }
    m.person(M.captain).role = 6;
    let money = this.money + Math.trunc(this.shipPrice(this.b2f4) / 2);
    if (money > GameConst.MAX_CASH) money = GameConst.MAX_CASH;
    this.money = money;
    this.removeShip(this.b2f4);
    this.p.panels();
  }
  // 2c8d0 工业投资
  async invest() {
    const E = this.m.portEconomy(this.port);
    if (this.isCapital()) { this.greet(2); await this.wait(); return; }
    if (E.industryInvest >= GameConst.MAX_INVEST) { this.greet(7); await this.wait(); return; }
    this.greet(8);
    const di = this.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : this.money & 0xffff;
    const v = await this.numpad.input(0, domUmin16(di, GameConst.MAX_INVEST - E.industryInvest));
    if (!v) { this.greet(0x0d); await this.wait(); return; }
    this.greet(v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10); await this.wait();
    E.industryInvest = (E.industryInvest + v) & 0xffff;
    this.investSupport(v);
    this.investOwner();
    this.money = (this.money - v) | 0;
    this.p.panels();
  }
}

export function installShipyard(proto) {
  const desc = Object.getOwnPropertyDescriptors(ShipyardMixin.prototype);
  delete desc.constructor;
  Object.defineProperties(proto, desc);
}
