// shipyard.js — 造船廠 (造新船 / 交船 / 買舊船 / 修理 / 賣船 / 改造 / 工業投資 / 折抵剩餘貨物分配)
import { ListSelect } from "../ui/listsel.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { createDomModal, hasDom, preserveScroll } from "../modern/dom_ui.ts";
import { decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";

class ShipyardMixin {
  // ================= 2 造船廠 1fd9:cc01 =================
  async shipyard() {
    const st = this.st, { palette, menu } = this.c;
    if (!hasDom()) { palette.setTarget(palette.table("ships")); await palette.fadeToTarget(); }
    if (st.u8(DS.DAILY_FLAGS) & 2) { this.greet(0xf9); await this.wait(); return; }
    this.greet(0x4d);
    let sel;
    do {
      const items = this.c.menuItems(22);
      let n = 0; for (let i = 0; i < 5; i++) if (st.u8(DS.TBL_USED_SHIP_CACHE + i) !== 0xff) n++;   // seg0:5cc4(0) 中古船表第 1 筆 (到港 1bd16 把本港移到第 1 筆; 原版各處都傳 al = 0)
      if (!n) menu.disabled |= 2;
      this.b2f4 = this.b2f5 = this.b2f6 = this.b2f7 = 0xff; this.b2f8 = 0;
      sel = await this.menu(items);
      if (sel !== 0xff) {
        await [() => this.newShip(), () => this.usedShip(), () => this.repair(), () => this.sellShip(),
          () => this.remodel(), () => this.invest()][sel]();
        this.after();
      }
    } while (sel !== 0xff && !(st.u8(DS.DAILY_FLAGS) & 2));
    this.fleetRecalc();
    if (!hasDom()) {
      palette.selectTimePalette(this.c.rt.time, false, st.weather);           // 0fea:98ce
      await palette.fadeToTarget();
    }
  }
  sTodo(n) { this.todo(n); }
  // 2bd77 造新船
  async newShip() {
    const st = this.st, E = this.eco, { sys, win, con } = this.c;
    this.b2f8 = 1; this.b2f5 = this.b2f4 = 0xff;
    if (st.u8(E + 0x23) !== 0xff) {                                       // 2b867 有船在造
      if (st.u8(E + 0x23)) { this.greet(0x105, st.u8(E + 0x23)); await this.wait(); return; }
      return this.delivery();
    }
    const t0 = this.BT.levels[st.u8(E + 0x22)][0];
    if (((10 * st.u8(this.typeRec(t0))) & 0xffff) > st.u16(E + 4)) { this.greet(0xfb); await this.wait(); return; }
    this.freeSlots();
    if (domS16(this.c.persons[0]) < 10) {                                   // 船塢已滿
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
  // 2bb91 選船型 → 材質 → 交涉 → 開工
  async buildSelect() {
    const st = this.st, E = this.eco, { menu } = this.c, list = this.listSel(), P = this.c.persons;
    const row = this.BT.levels[st.u8(E + 0x22)];
    let n = 0;
    for (let i = 0; i < 8; i++) { const t = row[i]; if (t === 0xff) break; if (((10 * st.u8(this.typeRec(t))) & 0xffff) <= st.u16(E + 4)) P[n++] = t + 0x28; }
    for (;;) {
      const r = await list.select(0x8e, n);
      if (r === -1) return;
      const t = (P[r] - 0x28) & 0xff, T = this.typeRec(t);
      this.shipData(t, 2);
      this.greet(this.BT.typeMsg[t]); await this.wait();
      this.greet(0xfd);
      if (!(await menu.yesNo())) continue;
      const mat = await this.material(t);
      const base = domS16(st.u16(T + 0x0a));
      const price = (Math.trunc(base * 4 / 5) + Math.trunc(base * mat / 10)) & 0xffff;
      if (!(await this.negotiate(t, price))) return;
      this.greet(0x101); await this.wait();
      const S = this.fleetSlot(this.b2f6), ship = this.shipOf(this.b2f6), M = this.crewData(this.b2f6);
      st.set8(S + OFF.DOCK_SLOT.FLAGS, 0x20);
      st.set8(ship + 0x10, (st.u8(ship + 0x10) & 0xf8) | mat);
      const d = domUmin16(Math.trunc((mat + 8) * st.u8(T + 1) / 10), 100);
      st.set8(S + OFF.DOCK_SLOT.MAX_DURABILITY, d); st.set8(S + OFF.DOCK_SLOT.DURABILITY, d);
      st.set8(M + 0x1b, this.port | 0x80);
      this.shipData(t, 2);
      this.durPrint(st.u8(S + OFF.DOCK_SLOT.DURABILITY));
      await this.design(this.b2f6);
      const q = ((100 - Math.trunc(st.u16(E + 4) / 50)) & 0xffff) * st.u8(T + 1);
      st.set8(E + 0x23, Math.trunc(q / 100) & 0xff);
      this.greet(0x106, st.u8(E + 0x23)); await this.wait();
      return;
    }
  }
  // 2bad3 材質
  async material(t) {
    const st = this.st, E = this.eco, { menu } = this.c, list = this.listSel(), P = this.c.persons, T = this.typeRec(t);
    const ind = st.u16(E + 4);
    const n = t === 0x18 ? 6 : Math.trunc((ind - domUmin16(500, ind)) / 200) + 3;
    for (let i = 0; i < n; i++) P[i] = i;
    for (;;) {
      this.greet(0xfe);
      let r; do r = await list.select(0x8f, n); while (r === -1);
      const v = P[r];
      this.durPrint(domUmin16(Math.trunc((v + 8) * st.u8(T + 1) / 10), 100));
      this.greet(0xff);
      if (await menu.yesNo()) return v;
    }
  }
  // 2aebb 耐久度數字
  durPrint(v) {
    const { con, printf } = this.c;
    con.left = 0x1e; con.right = 0x39; con.setCursor(0x27, 0xb8);
    printf(this.BT.fmt.durNum, v);
  }
  // 2aeeb 最大載貨 / 水手數 / 武器數
  designPrint(cargo, crew, guns) {
    const { con, printf } = this.c;
    con.lineH = 0x10; con.right = 0x3a; con.left = 0x35; con.setCursor(0x35, 0xd0);
    printf(this.BT.fmt.designNums, domS16(cargo), domS16(crew), guns);
    con.lineH = 0x18; con.left = 0x1f;
  }
  // 2b19d 設計 (水手數與武器數)
  async design(slot) {
    const st = this.st, { menu, printf } = this.c, F = this.BT.fmt;
    const S = this.fleetSlot(slot), ship = this.shipOf(slot), T = this.typeRec(st.u8(ship + 0x0f));
    for (;;) {
      let cargo = st.u16(T + 6), crew;
      this.designPrint(cargo, 0, 0);
      this.greet(0x102); printf(F.crewRange, st.u8(T + 5), st.u8(T + 4));
      do crew = (await this.numpad.input(0, st.u8(T + 4) * 10)) & 0xffff; while (st.u8(T + 5) > domS16(crew));
      cargo = (cargo - crew) & 0xffff;
      this.designPrint(cargo, crew, 0);
      this.greet(0x103); printf(F.gunRange, st.u8(T + 8));
      const guns = (await this.numpad.input(0, st.u8(T + 8))) & 0xff;
      cargo = (cargo - guns) & 0xffff;
      this.designPrint(cargo, crew, guns);
      this.greet(0x104);
      if (!(await menu.yesNo())) continue;
      if (domS16(this.cargoUsed(slot)) > domS16(cargo)) { this.greet(0x14); await this.wait(); return 0; }
      st.set16(ship + 0x14, cargo); st.set16(ship + 0x12, crew); st.set8(ship + 0x11, guns);
      const c12 = domS16(st.u16(ship + 0x12)), s0 = domS16(st.u16(S));
      st.set16(S, c12 > s0 ? s0 : c12);
      st.set8(S + OFF.DOCK_SLOT.GUNS, domUmin16(st.u8(S + OFF.DOCK_SLOT.GUNS), st.u8(ship + 0x11)));
      return 1;
    }
  }
  // 2b88d 交涉與付款 (造新船 / 買舊船)
  async negotiate(t, price) {
    const st = this.st, { menu, message, sys } = this.c;
    let k = 5, avail = this.money;
    let cost = Math.imul(Math.trunc(Math.imul(this.priceIndex() + 50, price) / 100), 10) | 0;
    if (this.b2f4 !== 0xff) {
      avail = (avail + Math.trunc(this.shipPrice(this.b2f4) / 2)) | 0;
      this.b2f7 = st.u8(this.crewData(this.b2f4) + 0x1b);
    }
    this.greet(this.b2f8 ? 0x100 : 0xc2, cost);
    const floor = Math.trunc(Math.imul(500 - st.u8(this.hero + 0x22), cost) / 500) | 0;
    if (!(await menu.yesNo())) {
      const acc = this.roleMember(4);
      if (acc !== 0xff) {
        if (!(st.u8(st.personRecord(acc) + 0x30) & 2)) k = sys.rng.random(10);
        this.crewSpeaks([4, 3, 5, 2, 6]); message(0xc4, Math.trunc(Math.imul(k + 95, floor) / 100) | 0);
        await this.wait(); await this.closeTalk();
      }
      this.greet(0xc3);
      const offer = (await this.numpad.input(0, avail > cost ? cost : avail)) | 0;
      if (offer < floor) {
        if (!sys.rng.random(5)) { st.set8(DS.DAILY_FLAGS, st.u8(DS.DAILY_FLAGS) | 2); this.greet(0xc5); }
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
    const st = this.st, codec = this.c.codec;
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
      for (let i = 0; i < 10; i++) {
        const S = this.fleetSlot(i);
        if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
        const ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP));
        const max = st.u16(ship + 0x14), used = this.cargoUsed(i);
        out.push({ slot: i, name: dec(this.dstr(ship)), used, max, free: Math.max(0, max - used) });
      }
      return out;
    };
    const putIntoShip = (leftItem, shipSlot) => {
      const S = this.fleetSlot(shipSlot), ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP));
      const free = Math.max(0, st.u16(ship + 0x14) - this.cargoUsed(shipSlot));
      if (free <= 0) return;
      const move = Math.min(leftItem.amt, free);
      const M = this.crewData(shipSlot), g = leftItem.code;
      if (g & 0x80) {
        const k = g & 0x7f;
        const mult = k < 2 ? 10 : 1;
        st.set16(M + 2 * k, st.u16(M + 2 * k) + move * mult);
      } else {
        let j = -1;
        for (let k = 0; k < 5; k++) {
          const cg = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + k);
          if (cg === g) { j = k; break; }
          if (cg === 0xff && j < 0) j = k;
        }
        if (j < 0) return;
        st.set8(M + OFF.CREW_SLOT.CARGO_GOODS + j, g);
        st.set16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * j, st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * j) + move);
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
  // 1e628 艦隊表 (不保存背景)
  fleetTable() {
    const st = this.st, { win, con, printf } = this.c, F = this.LO.fmt;
    let n = 0;
    for (let i = 0; i < 10; i++) if ((st.u8(this.fleetSlot(i) + 8) & 0x30) === 0x10) n++;
    win.frame(0x0f, 0x20, 0x2b, ((n + 2) * 0x18) & 0xffff, 1);
    con.setCursor(0x20, 0x30); printf(F.fleetHdr);
    let row = 0;
    for (let i = 0; i < 10; i++) {
      const S = this.fleetSlot(i);
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      const ship = ListSelect.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP)), M = this.crewData(i);
      con.setCursor(0x11, (row + 3) * 0x18); con.puts(this.dstr(ship));
      con.setCursor(0x20, -1);
      if (st.u8(M + 0x1b) & 0x80) con.puts(F.fleetGone);
      else {
        const T = this.typeRec(st.u8(ship + 0x0f)), s0 = st.u16(S);
        const a = Math.floor(((st.u8(M + 9) * s0) & 0xffff) / 100), b = Math.floor(((st.u8(M + 8) * s0) & 0xffff) / 100);
        const c = (s0 - b - a) & 0xffff;
        const ld = domS16((this.cargoUsed(i) + st.u8(S + OFF.DOCK_SLOT.GUNS) + st.u16(S)) & 0xffff);          // seg0:5d8b
        const d = Math.floor((Math.imul(ld, 100) >>> 0) / (domS16(st.u16(T + 6)) >>> 0 || 1)) & 0xffff;   // seg0:38ba 無號長整數除法
        printf(F.fleetRow, a, b, domS16(c), domS16(d), (this.shipSpeed(i) + 1) >> 1);
      }
      row++;
    }
  }
  // 1f555 「未裝載的貨物」清單 (重新排緊)
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
  // 1f64a 一艘船的補給與貨物 → 暫存表 sg / sa (水與糧食 /10), 回傳筆數
  shipList(slot, sg, sa) {
    const st = this.st, { scr, con, printf } = this.c, F = this.LO.fmt, names = this.LO.goods, SUP = this.LO.supplies;
    scr.fillCols(0x18, 0x70, 0x10, 0x90, 7);
    sg.fill(0xff);
    con.left = 0x18; con.right = 0x27;
    const ship = this.shipOf(slot), M = this.crewData(slot);
    con.setCursor(0x18, 0x50); printf(F.shipName, this.dstr(ship));
    const sup = [Math.trunc(domS16(st.u16(M)) / 10), Math.trunc(domS16(st.u16(M + 2)) / 10), st.u16(M + 4), st.u16(M + 6)];
    for (let k = 0; k < 4; k++) {
      con.setCursor(0x18, 0x70 + 0x10 * k); con.puts(SUP[k]);
      con.setCursor(0x18 + 0x0c, -1); printf(F.num, domS16(sup[k] & 0xffff));
      sg[k] = 0x80 + k; sa[k] = sup[k] & 0xffff;
    }
    let d = 4;
    for (let i = 0; i < 5; i++) {
      const g = st.u8(M + 0x16 + i);
      if (g === 0xff) continue;
      con.setCursor(0x18, (d + 7) << 4); con.puts(names[g]);
      con.setCursor(0x18 + 0x0c, -1); printf(F.num, domS16(st.u16(M + 0x0c + 2 * i)));
      sg[d] = g; sa[d] = st.u16(M + 0x0c + 2 * i); d++;
    }
    return d;
  }
  // 1f851 暫存表寫回船員配置
  shipWrite(slot, sg, sa) {
    const st = this.st, M = this.crewData(slot);
    for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    let d = 0;
    for (let s = 0; s < 9; s++) {
      const g = sg[s];
      if (g === 0x80) st.set16(M, 10 * sa[s]);
      else if (g === 0x81) st.set16(M + 2, 10 * sa[s]);
      else if (g === 0x82) st.set16(M + 4, sa[s]);
      else if (g === 0x83) st.set16(M + 6, sa[s]);
      else if (g === 0xff || g >= 0x2e) { st.set8(M + 0x16 + d, 0xff); st.set16(M + 0x0c + 2 * d, 0); d++; }
      else { st.set8(M + 0x16 + d, g); st.set16(M + 0x0c + 2 * d, sa[s]); d++; }
    }
    st.set16(M + 0x0a, this.loadTotal(slot));
  }
  // 1f93d 選中船上第 sel 列: 空列 → 先從剩餘貨物選一種; 再用計算機決定裝在船上的數量
  async loadItem(slot, sel, sg, sa, lg, la) {
    const st = this.st, { menu } = this.c, R = menu.rects, ship = this.shipOf(slot);
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
    const room = (sa[sel] + st.u16(ship + 0x14) - total) & 0xffff;
    const v = (await this.numpad.input(0, domS16(domUmin16(room, cur)))) & 0xffff;
    sa[sel] = v;
    lg[k] = sg[sel]; la[k] = (cur - v) & 0xffff;
    if (!sa[sel] && !(sg[sel] & 0x80)) sg[sel] = 0xff;
    if (!la[k]) lg[k] = 0xff;
  }
  // 1fb6e 一艘船的裝卸
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
  // 1fcf7 (0fea:fe57) 剩餘貨物分配: 選艦隊的船 → 裝卸; Esc → 確認 (還有剩 0xd3 / 全部裝完 0xdb)
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
  // 2b326 折抵船 (b2f4) 的砲、水手、補給與貨物 (原版目的船位也是 b2f4)
  transfer(flag, left) {
    const st = this.st, src = this.b2f4, dst = this.b2f4;
    const Md = this.crewData(dst), Ms = this.crewData(src), Sd = this.fleetSlot(dst), Ss = this.fleetSlot(src), shipD = this.shipOf(dst);
    left.goods.fill(0xff);
    st.set8(Sd + 6, domUmin16(st.u8(Ss + 6), st.u8(shipD + 0x11)));
    st.set8(Sd + 8, st.u8(Sd + 8) & 0xf8);
    if (st.u8(Sd + 6)) st.set8(Sd + 8, st.u8(Sd + 8) | (st.u8(Ss + 8) & 7));
    st.set16(Sd, domUmin16(st.u16(Ss), st.u16(shipD + 0x12)));
    if (flag && domS16(this.cargoUsed(src)) <= domS16(st.u16(shipD + 0x14))) {
      for (let k = 0; k < 8; k += 2) st.set16(Md + k, st.u16(Ms + k));
      for (let k = 0; k < 5; k++) { st.set8(Md + 0x16 + k, st.u8(Ms + 0x16 + k)); st.set16(Md + 0x0c + 2 * k, st.u16(Ms + 0x0c + 2 * k)); }
      return;
    }
    left.goods.fill(0xff);
    let c = 0;
    const add = (g, a) => { left.goods[c] = g; left.amt[c] = a & 0xffff; c++; };
    const w = Math.trunc(domS16(st.u16(Ms)) / 10); if (w) add(0x80, w);
    const f = Math.trunc(domS16(st.u16(Ms + 2)) / 10); if (f) add(0x81, f);
    if (st.u16(Ms + 4)) add(0x82, st.u16(Ms + 4));
    if (st.u16(Ms + 6)) add(0x83, st.u16(Ms + 6));
    for (let k = 0; k < 5; k++) { const g = st.u8(Ms + 0x16 + k); if (g !== 0xff) add(g, st.u16(Ms + 0x0c + 2 * k)); }
  }
  // 2ad12 建立新船記錄並命名
  async createShip(t) {
    const st = this.st, { win } = this.c, T = this.typeRec(t), tmpl = ListSelect.shipRec(t + 0x28);
    const S = this.fleetSlot(this.b2f6), M = this.crewData(this.b2f6), trade = this.b2f4 !== 0xff;
    let n = 0;
    for (let i = 0; i < 0x28; i++) if (st.u8(ListSelect.shipRec(i) + 0x0f) === 0xff) { n = i; break; }
    const si = ListSelect.shipRec(n);
    st.set8(si + 0x11, st.u8(T + 8)); st.set8(si + 0x0f, t);
    st.set8(si + 0x10, st.u8(tmpl + 0x10)); st.set16(si + 0x12, st.u16(tmpl + 0x12));
    st.set16(si + 0x14, (st.u16(T + 6) - st.u8(si + 0x11) - st.u16(si + 0x12)) & 0xffff);
    const d = Math.trunc(9 * st.u8(T + 1) / 10) & 0xffff;
    st.set8(S + OFF.DOCK_SLOT.MAX_DURABILITY, (d - Math.trunc((d & 0xff) / 15)) & 0xff); st.set8(S + OFF.DOCK_SLOT.DURABILITY, st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY));
    st.set8(S + OFF.DOCK_SLOT.TURN, st.u8(T + 2)); st.set8(S + OFF.DOCK_SLOT.PROPULSION, st.u8(T + 3));
    st.set8(S + OFF.DOCK_SLOT.GUNS, domUmin16(st.u8(S + OFF.DOCK_SLOT.GUNS), trade ? st.u8(si + 0x11) : 0));
    st.set16(S, domUmin16(st.u16(S), trade ? st.u16(si + 0x12) : 0));
    st.set8(S + OFF.DOCK_SLOT.SHIP, n);
    if (!trade) st.set8(S + OFF.DOCK_SLOT.FLAGS, 0x10);
    for (const k of [0, 2, 4, 6]) st.set16(M + k, 0);
    st.set8(M + 8, 0x19); st.set8(M + 9, 0x32); st.set8(M + 0x1b, this.b2f7);
    st.set16(M + 0x0a, 0); st.set8(M + 0x1d, 0);
    for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    this.greet(0xc7);
    const ni = this.nameInput();
    for (;;) {
      ni.prompt(2, 7);
      if ((await ni.run(si, 7)) === 1) break;
      await win.close();
    }
    await win.close();
  }
  // 2b2f2 船員欄第一個職務 ≥ 3 的人 → b2f7
  findMate() {
    const st = this.st;
    for (let i = 0; i < 0x1e; i++) { const n = st.u8(DS.PARTY_CREW + i); if (n !== 0xff && st.u8(st.personRecord(n) + 0x2e) >= 3) { this.b2f7 = n; return 1; } }
    return 0;
  }
  // 2b66a 決定新船的船長與船位
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
    for (let i = 0; i < 10; i++) { const f = this.slotState(i); if (f !== 0x10 && f !== 0x20) { this.b2f6 = i; break; } }
    return 1;
  }
  // 2b701 交船
  async delivery() {
    const st = this.st, E = this.eco, { menu } = this.c;
    let slot = 0;
    for (let i = 0; i < 0x28; i++) if (st.u8(this.crewData(i) + 0x1b) === (this.port | 0x80) && this.slotState(i) === 0x20) { slot = i; break; }
    this.b2f6 = 0xff;
    this.greet(0xfa); await this.wait();
    this.greet(0x107); this.freeSlots();
    if (!(await menu.yesNo()) || !(await this.captainAndSlot())) { this.greet(0x109); await this.wait(); return; }
    const S = this.fleetSlot(slot), M = this.crewData(slot);
    st.set8(S + OFF.DOCK_SLOT.FLAGS, (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xdf) | 0x10);
    st.set8(M + 0x1b, this.b2f7);
    if (this.b2f7 !== st.hero) st.set8(st.personRecord(this.b2f7) + 0x2e, 2);
    st.set8(E + 0x23, 0xff);
    if (this.b2f6 !== 0xff) this.swapSlots(slot, this.b2f6);
    this.compactSlots();
    if (this.b2f4 !== 0xff) {
      this.b2f4 = slot;
      const left = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
      this.transfer(1, left);
      this.sellDone();
      if (left.goods[0] !== 0xff) await this.leftovers(left);
    }
    st.set8(st.personRecord(this.b2f7) + 0x2e, this.b2f7 !== st.hero ? 2 : 1);
  }
  // 2be49 買舊船
  async usedShip() {
    const st = this.st, { menu } = this.c, list = this.listSel(), P = this.c.persons;
    this.b2f8 = 0;
    if (!(await this.captainAndSlot())) return;
    const base = DS.TBL_USED_SHIP_CACHE, idx = [];                                        // seg0:5cc4(0): 2be62 / 2bf29 都是 sub al, al
    let n = 0;
    for (let i = 0; i < 5; i++) { const t = st.u8(base + i); if (t !== 0xff) { idx[n] = i; P[n++] = t + 0x28; } }
    for (;;) {
      const r = await list.select(0x8e, n);
      if (r === -1) return;
      const t = (P[r] - 0x28) & 0xff;
      this.shipData(t, 1);
      this.greet(this.BT.typeMsg[t]); await this.wait();
      this.greet(0xc1);
      if (!(await menu.yesNo())) continue;
      if (!(await this.negotiate(t, st.u16(this.typeRec(t) + 0x0a)))) return;
      if (this.b2f7 !== st.hero) st.set8(st.personRecord(this.b2f7) + 0x2e, 2);
      st.set8(base + idx[r], 0xff);
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
  // 改造子功能共用: 選艦隊的船並顯示資料 (清單 0x80 → 2af30(3) + 2b119)
  async rmPick(msg) {
    this.greet(msg);
    const r = await this.listSel().select(0x80, this.fleetShips());
    if (r === -1) return -1;
    const slot = this.c.persons[r];
    this.shipData(this.st.u8(this.fleetSlot(slot) + 7), 3, slot); this.figurehead(slot);
    return slot;
  }
  // 2c371 船首像
  async rmFigure() {
    const st = this.st, E = this.eco, H = this.hero, rng = this.c.sys.rng;
    let n = domUmin16(Math.trunc(st.u16(E) / 100) + 1, 8);
    if (st.u16(E + 4) > 800 && st.u16(E) > 800 && st.u8(H + 0x23) > 80 && !rng.random(20)) {
      n++; if (rng.random(st.u8(H + 0x23)) >= 90) n++;
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
    const st = this.st, { menu } = this.c, P = this.c.persons, M = this.crewData(slot);
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
      st.set8(M + 0x1d, v);
      this.p.panels();
      return;
    }
  }
  // 2c43d 武裝
  async rmGuns() {
    const st = this.st, E = this.eco, H = this.hero, rng = this.c.sys.rng;
    let n = domUmin16(Math.trunc(((st.u16(E + 4) + st.u16(E)) & 0xffff) / 200) + 1, 6);
    if (st.u16(E + 4) > 900 && st.u16(E) > 900 && st.u8(H + 0x23) > 90 && !rng.random(20)) {
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
    const st = this.st, { menu } = this.c, P = this.c.persons, BT = this.BT;
    const S = this.fleetSlot(slot), ship = this.shipOf(slot);
    for (let i = 0; i < n; i++) P[i] = i + 1;
    for (;;) {
      this.greet(0x10c);
      const r = await this.listSel().select(0x91, n);
      if (r === -1) return;
      const v = P[r] & 0xff, kind = r + 1;
      let room = st.u8(ship + 0x11);
      if (!room) { this.greet(0x3fd); await this.wait(); continue; }
      const same = (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7) === kind;
      if (same) {
        room = (room - st.u8(S + OFF.DOCK_SLOT.GUNS)) & 0xffff;
        if (!room) { this.greet(0x3fc); await this.wait(); continue; }
        this.greet(0x14e, BT.cannons[v], st.u8(S + OFF.DOCK_SLOT.GUNS), room);
      } else this.greet(0x10f);
      let q = (await this.numpad.input(0, room)) & 0xff;
      if (!q) continue;
      const price = Math.imul(q, domS16(BT.cannonPrice[v])) | 0;
      this.greet(0x110, BT.cannons[v], q, price);
      if (!(await menu.yesNo())) continue;
      if (price > this.money) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - price) | 0;
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7) === kind) q = (q + st.u8(S + OFF.DOCK_SLOT.GUNS)) & 0xff;
      st.set8(S + OFF.DOCK_SLOT.GUNS, q);
      st.set8(S + OFF.DOCK_SLOT.FLAGS, (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xf8) | (kind & 0xff));
      this.p.panels();
      return;
    }
  }
  // 2c4f6 積載比例變更
  async rmRatio() {
    const st = this.st, { menu } = this.c;
    for (;;) {
      const slot = await this.rmPick(0x111);
      if (slot === -1) return;
      const cost = domS16(st.u16(this.typeRec(st.u8(this.shipOf(slot) + 0x0f)) + 0x0a));
      this.greet(0x112, cost);
      if (!(await menu.yesNo())) continue;
      if (cost > this.money) { this.noMoney(); await this.wait(); await this.closeTalk(); continue; }
      if (await this.design(slot)) { this.money = (this.money - cost) | 0; this.p.panels(); }
    }
  }
  // 2c5c2 船名變更
  async rmName() {
    const st = this.st, { win } = this.c;
    for (;;) {
      const slot = await this.rmPick(0x111);
      if (slot === -1) return;
      const ship = this.shipOf(slot);
      this.greet(0x113);
      const old = st.cstr(ship).slice(), n = old.indexOf(0) < 0 ? old.length : old.indexOf(0);
      const ni = this.nameInput();
      ni.prompt(2, 7);
      if ((await ni.run(ship, 7)) !== 1) { for (let i = 0; i < n; i++) st.set8(ship + i, old[i]); st.set8(ship + n, 0); }
      await win.close();
      this.p.panels();
    }
  }
  // 2bf40 修理
  async repair() {
    const st = this.st, { menu, message } = this.c, list = this.listSel();
    for (;;) {
      const n = this.fleetShips();
      if (!n) return;
      const r = await list.select(0x80, n);
      if (r === -1) return;
      const S = this.fleetSlot(this.c.persons[r]), T = this.typeRec(st.u8(this.shipOf(this.c.persons[r]) + 0x0f));
      let cost = domS16(st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY) - st.u8(S + OFF.DOCK_SLOT.DURABILITY) - st.u8(S + OFF.DOCK_SLOT.TURN) - st.u8(S + OFF.DOCK_SLOT.PROPULSION) + st.u8(T + 2) + st.u8(T + 3));
      if (!cost) { this.greet(0xcc); await this.wait(); continue; }
      cost = domS16(cost * 20);
      this.greet(0xcd, cost);
      if (!(await menu.yesNo())) { this.greet(0xce); await this.wait(); continue; }
      if (cost > this.money) { this.crewSpeaks([4, 3, 5, 2, 6]); message(0xcf); await this.wait(); await this.closeTalk(); continue; }
      this.money = (this.money - cost) | 0;
      st.set8(S + OFF.DOCK_SLOT.DURABILITY, st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY)); st.set8(S + OFF.DOCK_SLOT.TURN, st.u8(T + 2)); st.set8(S + OFF.DOCK_SLOT.PROPULSION, st.u8(T + 3));
      this.p.panels();
    }
  }
  // 2b571 選擇要賣的船 (flag: 主角是該船船長時另選一艘當主角的船)
  async sellSelect(flag) {
    const st = this.st, { menu, message } = this.c, list = this.listSel();
    for (;;) {
      this.b2f5 = this.b2f4 = 0xff;
      this.greet(0xc8);
      const r = await list.select(0x80, this.fleetShips());
      if (r === -1) return this.b2f4;
      const slot = this.b2f4 = this.c.persons[r];
      this.shipData(st.u8(this.fleetSlot(slot) + 7), 3, slot); this.figurehead(slot);
      this.greet(0xc9);
      if (!(await menu.yesNo())) continue;
      const M = this.crewData(slot);
      if (st.u8(M + 0x1b) === st.hero) {
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
      this.b2f7 = st.u8(M + 0x1b);
      return this.b2f4;
    }
  }
  // 2c043 賣船
  async sellShip() {
    const st = this.st, { menu, message } = this.c;
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
      if (st.u16(this.fleetSlot(slot))) {
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
    const st = this.st, M = this.crewData(this.b2f4);
    if (this.b2f5 !== 0xff) { const M2 = this.crewData(this.b2f5); st.set8(M + 0x1b, st.u8(M2 + 0x1b)); st.set8(M2 + 0x1b, st.hero); }
    st.set8(st.personRecord(st.u8(M + 0x1b)) + 0x2e, 6);
    let m = this.money + Math.trunc(this.shipPrice(this.b2f4) / 2);
    if (m > 600000000) m = 600000000;
    this.money = m;
    this.removeShip(this.b2f4);
    this.p.panels();
  }
  // 2c8d0 工業投資
  async invest() {
    const st = this.st, E = this.eco;
    if (this.isCapital()) { this.greet(2); await this.wait(); return; }
    if (st.u16(E + 6) >= 50000) { this.greet(7); await this.wait(); return; }
    this.greet(8);
    const di = this.money >= 50000 ? 50000 : this.money & 0xffff;
    const v = await this.numpad.input(0, domUmin16(di, 50000 - st.u16(E + 6)));
    if (!v) { this.greet(0x0d); await this.wait(); return; }
    this.greet(v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10); await this.wait();
    st.set16(E + 6, st.u16(E + 6) + v);
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
