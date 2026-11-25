// ui/info_hub.ts — F1「情报中心」一体化多标签页工作台
// 与「读取进度 (save_modal.ts)」1:1 同套暖羊皮纸视觉，彻底消灭多层嵌套菜单，并完整呈现所有原版插图
// （发现物插图、道具插图、高清船图、船首像、具名与 5 层拼合人物头像）。100% 原版游戏文本。
import { DiscoveryFlag, GameConst, ShipSlotFlag, SkillFlag } from "../model/flags.ts";
import {
  WorldConst,
  fleetShipSlot,
  getTradeLogEntry,
  getWorkState,
  heroFleet,
  heroOrDockSlot,
  personRawBytes,
} from "../model/world_helpers.ts";
import { ListSelect } from "./dos/listsel.js";
import { captureConsoleText, decodeCleanCstr } from "./text_util.ts";
import { createDomModal, getPersonPortraitSrc, preserveScroll } from "./modals.ts";
import { UI_STR } from "./strings.ts";
import { mountDomPortMap, mountDomWorldChart, runDomPortMapModal, runDomWorldChartModal } from "./info_maps.ts";
import { runDomBelongings, runDomFormation } from "./info_modals.ts";

export { mountDomPortMap, mountDomWorldChart, runDomPortMapModal, runDomWorldChartModal, runDomBelongings, runDomFormation };

const s16 = (v: number) => (v << 16) >> 16;
const umin = (a: number, b: number) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);

/** F1 情报中心：10 项原版情报全部平铺为一体化标签页，零嵌套菜单 */
export async function runDomInfoHub(cmd: any): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, p = cmd.p, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const cap = (fn: () => void) => captureConsoleText(c, fn);
  const tabLabels = [...UI_STR.infoTabs];
  const infoTitle = UI_STR.cmdButtons[0];

  const hasShips = () => b.fleetShips() > 0;
  const hasDisc = () => !!cmd.discList(1);
  const hasWorld = () => !!getWorkState(m).exploreTotal;
  const hasLog = () => getTradeLogEntry(m, 0).dateWord !== 0xffff;
  const inPort = () => m.globals.port !== GameConst.EMPTY_SLOT;

  const isDisabled = (idx: number): boolean => {
    if (idx === 0 || idx === 1 || idx === 4 || idx === 5) return !hasShips();
    if (idx === 6) return !hasDisc();
    if (idx === 7) return !hasWorld();
    if (idx === 8) return !hasLog();
    if (idx === 9) return !inPort();
    return false;
  };

  let activeTab = hasShips() ? 0 : 3;
  let selShipIdx = 0;
  let selPersonIdx = 0;
  let selCargoShipIdx = 0;
  let selGoodIdx = 0;
  let selDiscIdx = 0;

  return new Promise(resolve => {
    const h = createDomModal({
      title: infoTitle,
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";
    h.modal.insertBefore(toolbar, h.body);

    const render = (keepScroll = true) => {
      if (isDisabled(activeTab)) activeTab = hasShips() ? 0 : 3;

      toolbar.innerHTML = "";
      tabLabels.forEach((lb, i) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
        btn.disabled = isDisabled(i);
        btn.textContent = lb;
        btn.addEventListener("click", () => {
          activeTab = i;
          render(false);
        });
        toolbar.appendChild(btn);
      });

      preserveScroll(h.body, () => {
        h.body.innerHTML = "";
        if (activeTab === 0) renderFleetTab(h.body);
        else if (activeTab === 1) renderShipTab(h.body);
        else if (activeTab === 2) renderPersonTab(h.body);
        else if (activeTab === 3) renderLordTab(h.body);
        else if (activeTab === 4) renderCargoShipTab(h.body);
        else if (activeTab === 5) renderCargoSummaryTab(h.body);
        else if (activeTab === 6) renderDiscoveryTab(h.body);
        else if (activeTab === 7) mountDomWorldChart(h.body, c, p);
        else if (activeTab === 8) renderLogTab(h.body);
        else if (activeTab === 9) mountDomPortMap(h.body, c, p);
      }, keepScroll);
    };

      // ---- Tab 0: 自舰队情报 ----
      const renderFleetTab = (root: HTMLElement) => {
        const fl = heroFleet(m);
        const admiral = m.person(fl.admiral);
        const T = cmd.T;
        const wind = Math.abs(((m.globals.portFlags & 0x38) >> 3) - fl.dir) & 0xff;
        const WT = T.windSpeed, wbase = wind << 3;
        let best = 10000, slow = fleetShipSlot(fl, 0), sumSail = 0, sumGuns = 0, sumX = 0, minDur = 100;

        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;";

        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          const slot = fleetShipSlot(fl, i);
          if ((slot.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
          const ship = m.ship(slot.ship);
          const t = ship.type, shipType = m.shipType(t);
          const minS = shipType.minCrew, sail = s16(slot.crew);
          sumSail = (sumSail + slot.crew) & 0xffff;
          const cs = m.crewSlot(i);
          const r8 = cs.navRatio;
          const r9 = cs.lookRatio;
          const w = s16(cs.loadTotal);
          const maxw = s16(shipType.capacity), s5 = slot.propulsion;
          const capP = m.person(cs.captain), pc = capP.navLevel, pd = capP.getStats(1);
          sumGuns = (sumGuns + slot.guns) & 0xffff;
          const deck = umin(300, Math.trunc(s16((100 - r9 - r8) * sail) / 100) & 0xffff);
          const k = slot.flags & ShipSlotFlag.CANNON_MASK;
          const g = Math.trunc((umin(slot.guns, deck) * ((2 * T.gunA[k] + T.gunB[k]) & 0xffff)) / 10) & 0xffff;
          sumX = (sumX + 2 * slot.durability + g + deck) & 0xffff;
          const di2 = s16(WT[wbase + t] * s5);
          const q = umin(100, Math.trunc((r9 * sail) / (minS || 1)) & 0xffff);
          const cc = umin(150, (180 - umin(180, Math.trunc(s16(100 * w) / (maxw || 1)) & 0xffff)) & 0xffff);
          const x = Math.trunc(s16(q * di2) / 100) & 0xffff;
          const di3 = Math.trunc(((x * cc) >>> 0) / 100) & 0xffff;
          const v = umin(30, (Math.trunc(s16(di3 * pc) / 10) + di3) & 0xffff);
          const sp = umin(40, Math.trunc(s16(v * pd) / 75) & 0xffff);
          if (sp < best) { best = sp; slow = slot; }
          if (slot.durability < minDur) minDur = slot.durability;

          const card = document.createElement("button");
          card.className = "uw2-pers-card";
          card.style.cssText = "padding:10px;gap:6px;text-align:center;";
          const shipUrl = art?.shipUrl?.(t);
          if (shipUrl) {
            const img = document.createElement("img");
            img.src = shipUrl;
            img.style.cssText = "width:100%;height:74px;object-fit:contain;border-radius:6px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:4px;";
            card.appendChild(img);
          }
          const nm = document.createElement("div");
          nm.style.cssText = "font-weight:700;font-size:14px;color:var(--uw2-ink);";
          nm.textContent = dec(ship.nameBytes);
          const sub = document.createElement("div");
          sub.className = "uw2-slot-sub";
          sub.textContent = `耐久 ${slot.durability}/${slot.maxDurability} · 水手 ${slot.crew} · 炮 ${slot.guns}`;
          card.append(nm, sub);
          const targetIdx = grid.children.length;
          card.addEventListener("click", () => { selShipIdx = targetIdx; activeTab = 1; render(); });
          grid.appendChild(card);
        }

        const summary = document.createElement("div");
        summary.className = "uw2-action-box";
        summary.style.cssText = "flex-direction:row;align-items:center;gap:16px;";
        const pImg = document.createElement("img");
        pImg.className = "uw2-portrait-img";
        void getPersonPortraitSrc(art, personRawBytes(admiral)).then(src => { if (src) pImg.src = src; });
        summary.appendChild(pImg);

        const col1 = document.createElement("div");
        col1.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;";
        for (const l of [
          cap(() => c.message(0x397, admiral.givenNameBytes)),
          cap(() => c.message(0x398, admiral.navLevel)),
          cap(() => c.message(0x399, admiral.battleLevel)),
        ]) {
          const d = document.createElement("div");
          d.textContent = l;
          col1.appendChild(d);
        }
        const col2 = document.createElement("div");
        col2.style.cssText = "flex:1.4;display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;";
        for (const l of [
          cap(() => c.message(0x39a, slow.turn, sumSail)),
          cap(() => c.message(0x39b, slow.propulsion, sumGuns)),
          cap(() => c.message(0x39c, minDur, sumX)),
        ]) {
          const d = document.createElement("div");
          d.textContent = l;
          col2.appendChild(d);
        }
        summary.append(col1, col2);
        root.append(grid, summary);
      };

      // ---- Tab 1: 舰船情报 ----
      const renderShipTab = (root: HTMLElement) => {
        const n = b.fleetShips();
        const slots: number[] = [];
        for (let i = 0; i < n; i++) slots.push(c.persons[i] & 0xff);
        if (selShipIdx >= slots.length) selShipIdx = Math.max(0, slots.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        slots.forEach((slot, i) => {
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
          btn.textContent = dec(ship.nameBytes);
          btn.addEventListener("click", () => { selShipIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        if (slots.length) {
          const slot = slots[selShipIdx];
          const data = cmd.shipInfo(slot, 0x0f);
          if (data) {
            const topRow = document.createElement("div");
            topRow.className = "uw2-action-box";
            topRow.style.cssText = "flex-direction:row;align-items:center;gap:12px;";
            const shipUrl = art?.shipUrl?.(data.typeId);
            if (shipUrl) {
              const img = document.createElement("img");
              img.src = shipUrl;
              img.style.cssText = "width:170px;height:108px;object-fit:contain;border-radius:8px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:6px;flex-shrink:0;";
              topRow.appendChild(img);
            }
            if (data.figureheadId) {
              const fhUrl = art?.figureheadUrl?.(data.figureheadId);
              if (fhUrl) {
                const fImg = document.createElement("img");
                fImg.src = fhUrl;
                fImg.style.cssText = "width:64px;height:80px;object-fit:contain;border-radius:6px;background:#0e1b30;border:1px solid var(--uw2-gold);image-rendering:pixelated;flex-shrink:0;";
                topRow.appendChild(fImg);
              }
            }
            const supNames = UI_STR.supplies;
            const supGrid = document.createElement("div");
            supGrid.style.cssText = "flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:6px;";
            for (let k = 0; k < 4; k++) {
              const box = document.createElement("div");
              box.className = "uw2-slot-card";
              box.style.padding = "6px 10px";
              box.innerHTML = `<span class="uw2-slot-sub">${supNames[k] || ""}</span><span style="font-weight:700;font-size:14px;">${data.supplies?.[k] ?? 0}</span>`;
              supGrid.appendChild(box);
            }
            topRow.appendChild(supGrid);

            const bodySplit = document.createElement("div");
            bodySplit.className = "uw2-split";
            const infoBox = document.createElement("div");
            infoBox.className = "uw2-action-box";
            for (const l of data.leftLines) {
              const d = document.createElement("div");
              d.style.cssText = "font-size:13px;line-height:1.5;color:var(--uw2-ink);";
              d.textContent = l;
              infoBox.appendChild(d);
            }
            const barBox = document.createElement("div");
            barBox.className = "uw2-action-box";
            for (const br of data.bars) {
              const pct = br.max > 0 ? Math.min(100, Math.round((br.cur / br.max) * 100)) : 0;
              const row = document.createElement("div");
              row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${br.label}</span><span>${br.cur} / ${br.max}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${pct}%"></div></div>`;
              barBox.appendChild(row);
            }
            bodySplit.append(infoBox, barBox);
            right.append(topRow, bodySplit);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 2: 人物情报 ----
      const renderPersonTab = (root: HTMLElement) => {
        const n = b.captainPool();
        const pids: number[] = [];
        for (let i = 0; i < n; i++) pids.push(c.persons[i] & 0xff);
        if (selPersonIdx >= pids.length) selPersonIdx = Math.max(0, pids.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        pids.forEach((pid, i) => {
          const pv = m.person(pid);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selPersonIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${dec(pv.givenNameBytes)}</span><span class="uw2-slot-sub">${dec(b.T.crewRoles[pv.role])}</span>`;
          btn.addEventListener("click", () => { selPersonIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        if (pids.length) {
          const data = cmd.personInfo(pids[selPersonIdx], 0x0f, 1);
          if (data) {
            const top = document.createElement("div");
            top.className = "uw2-action-box";
            top.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
            const img = document.createElement("img");
            img.className = "uw2-portrait-img";
            img.style.cssText = "width:80px;height:100px;";
            void getPersonPortraitSrc(art, data.personBytes).then(src => { if (src) img.src = src; });
            top.appendChild(img);
            const hCol = document.createElement("div");
            hCol.style.cssText = "display:flex;flex-direction:column;gap:4px;";
            data.headerLines.forEach((l: string, idx: number) => {
              const d = document.createElement("div");
              d.style.cssText = idx === 0 ? "font-size:18px;font-weight:700;" : "font-size:13px;color:var(--uw2-ink-muted);";
              d.textContent = l;
              hCol.appendChild(d);
            });
            top.appendChild(hCol);

            const bodySplit = document.createElement("div");
            bodySplit.className = "uw2-split";
            const sBox = document.createElement("div");
            sBox.className = "uw2-action-box";
            for (const s of data.stats) {
              const row = document.createElement("div");
              row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:2px;"><span>${s.label}</span><span>${s.val}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${s.val >= 80 ? "" : "green"}" style="width:${Math.min(100, s.val)}%"></div></div>`;
              sBox.appendChild(row);
            }
            const dBox = document.createElement("div");
            dBox.className = "uw2-action-box";
            for (const dl of data.detailLines) {
              const d = document.createElement("div");
              d.style.cssText = "font-size:13px;line-height:1.6;color:var(--uw2-ink);";
              d.textContent = dl;
              dBox.appendChild(d);
            }
            bodySplit.append(sBox, dBox);
            right.append(top, bodySplit);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 3: 主公情报 ----
      const renderLordTab = (root: HTMLElement) => {
        const lab = c.menuItems(0x2a), hd = m.heroInfo();
        const money = m.globals.money;
        const heroP = m.heroPerson();

        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const topCard = document.createElement("div");
        topCard.className = "uw2-action-box";
        topCard.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
        const img = document.createElement("img");
        img.className = "uw2-portrait-img";
        void getPersonPortraitSrc(art, personRawBytes(heroP)).then(src => { if (src) img.src = src; });
        topCard.appendChild(img);
        const mCol = document.createElement("div");
        mCol.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600;";
        for (const ml of [
          cap(() => c.message(0x38e)),
          cap(() => c.message(0x38f, money % 10000)),
          cap(() => c.message(0x390, Math.trunc(money / 10000))),
        ]) {
          const d = document.createElement("div");
          d.textContent = ml;
          mCol.appendChild(d);
        }
        topCard.appendChild(mCol);

        const fameBox = document.createElement("div");
        fameBox.className = "uw2-action-box";
        const fh = document.createElement("div");
        fh.className = "uw2-pane-title";
        fh.textContent = cap(() => c.message(0x391));
        fameBox.appendChild(fh);
        const fameVals = [hd.tradeFame, hd.pirateFame, hd.adventureFame];
        for (let i = 0; i < 3; i++) {
          const val = fameVals[i];
          const row = document.createElement("div");
          row.innerHTML = `<div style="font-size:14px;font-weight:600;margin-bottom:4px;">${cap(() => c.message(0x392, lab[i], val))}</div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${Math.min(100, (val / GameConst.MAX_FAME) * 100)}%"></div></div>`;
          fameBox.appendChild(row);
        }
        left.append(topCard, fameBox);

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) {
          const v = hd.getCountryStanding(i), diff = v - 100;
          const row = document.createElement("div");
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-bottom:4px;"><span>${cap(() => c.message(0x393, p.nations[i]))}</span><span style="color:${v >= 100 ? "#247544" : "#b83d3d"};">${diff < 0 ? `-${Math.abs(diff)}` : String(diff)}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${v >= 100 ? "green" : "red"}" style="width:${Math.min(100, (v / 200) * 100)}%"></div></div>`;
          right.appendChild(row);
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 4: 积载情报 ----
      const renderCargoShipTab = (root: HTMLElement) => {
        const n = b.fleetShips();
        const slots: number[] = [];
        for (let i = 0; i < n; i++) slots.push(c.persons[i] & 0xff);
        if (selCargoShipIdx >= slots.length) selCargoShipIdx = Math.max(0, slots.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        slots.forEach((slot, i) => {
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selCargoShipIdx ? "selected" : ""}`;
          btn.textContent = dec(ship.nameBytes);
          btn.addEventListener("click", () => { selCargoShipIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        if (slots.length) {
          const slot = slots[selCargoShipIdx], cs = m.crewSlot(slot);
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const title = document.createElement("div");
          title.className = "uw2-pane-title";
          title.textContent = cap(() => c.message(0x374, ship.nameBytes));
          right.appendChild(title);
          let count = 0;
          for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
            const g = cs.getCargoGoods(k);
            if (g === GameConst.EMPTY_SLOT) continue;
            count++;
            const card = document.createElement("div");
            card.className = "uw2-slot-card";
            card.textContent = cap(() => c.message(0x395, p.goods[g], cs.getCargoAmts(k)));
            right.appendChild(card);
          }
          if (!count) {
            const empty = document.createElement("div");
            empty.className = "uw2-slot-sub";
            empty.textContent = "—";
            right.appendChild(empty);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 5: 积载一览表 ----
      const renderCargoSummaryTab = (root: HTMLElement) => {
        const totals = new Map<number, number>();
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
          const cs = m.crewSlot(i);
          for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
            const g = cs.getCargoGoods(j);
            if (g === GameConst.EMPTY_SLOT) continue;
            totals.set(g, ((totals.get(g) ?? 0) + cs.getCargoAmts(j)) & 0xffff);
          }
        }
        const goodsList = Array.from(totals.entries());
        if (selGoodIdx >= goodsList.length) selGoodIdx = Math.max(0, goodsList.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        if (!goodsList.length) {
          const empty = document.createElement("div");
          empty.className = "uw2-slot-sub";
          empty.style.padding = "12px";
          empty.textContent = "—";
          left.appendChild(empty);
        }
        goodsList.forEach(([g, amt], i) => {
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selGoodIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${dec(p.goods[g])}</span><span style="font-weight:700;">×${amt}</span>`;
          btn.addEventListener("click", () => { selGoodIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        if (goodsList.length) {
          const [g] = goodsList[selGoodIdx];
          const bestPortName = m.port(cmd.bestPort(g)).nameBytes;
          const hero = m.heroPerson();
          const remarks: { pid: number; text: string }[] = [];
          if (hero.skills & SkillFlag.ACCOUNTING) {
            remarks.push({ pid: m.globals.hero, text: cap(() => c.message(0x350, p.goods[g], bestPortName)) });
          } else {
            for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
              const cid = m.partyCrew(i);
              if (cid === GameConst.EMPTY_SLOT) continue;
              const cp = m.person(cid);
              if (cp.role !== 4) continue;
              const txt = (cp.skills & SkillFlag.ACCOUNTING)
                ? cap(() => c.message(0x351, p.goods[g], bestPortName))
                : cap(() => c.message(0x352, p.goods[g]));
              remarks.push({ pid: cid, text: txt });
            }
          }
          for (const rm of remarks) {
            const box = document.createElement("div");
            box.className = "uw2-action-box";
            box.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
            const img = document.createElement("img");
            img.className = "uw2-portrait-img";
            void getPersonPortraitSrc(art, personRawBytes(m.person(rm.pid))).then(src => { if (src) img.src = src; });
            const txt = document.createElement("div");
            txt.style.cssText = "flex:1;font-size:15px;line-height:1.6;color:var(--uw2-ink);";
            txt.textContent = rm.text;
            box.append(img, txt);
            right.appendChild(box);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 6: 发现物情报 (附高清发现物插图) ----
      const renderDiscoveryTab = (root: HTMLElement) => {
        const n = cmd.discList(0);
        const ids: number[] = [];
        for (let i = 0; i < n; i++) ids.push(c.persons[i] & 0xff);
        if (selDiscIdx >= ids.length) selDiscIdx = Math.max(0, ids.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        ids.forEach((id, i) => {
          const rec = ListSelect.colonyRec(c, id);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selDiscIdx ? "selected" : ""}`;
          btn.textContent = dec(rec);
          btn.addEventListener("click", () => { selDiscIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        if (ids.length) {
          const id = ids[selDiscIdx];
          const disc = m.discovery(id);
          const imp = c.menuItems(0x22);
          const rec = ListSelect.colonyRec(c, id);
          const B = b.BG;

          const head = document.createElement("div");
          head.style.cssText = "display:flex;gap:16px;align-items:center;";
          const imgUrl = art?.discoveryUrl?.(rec[0x0f]);
          if (imgUrl) {
            const img = document.createElement("img");
            img.src = imgUrl;
            img.style.cssText = "width:96px;height:96px;object-fit:contain;border-radius:8px;border:1px solid var(--uw2-gold);background:#141c2b;image-rendering:pixelated;flex-shrink:0;";
            head.appendChild(img);
          }
          const meta = document.createElement("div");
          meta.style.cssText = "display:flex;flex-direction:column;gap:6px;";
          const tEl = document.createElement("div");
          tEl.style.cssText = "font-size:20px;font-weight:700;color:var(--uw2-ink);";
          tEl.textContent = dec(rec);
          const cEl = document.createElement("div");
          cEl.style.cssText = "font-size:14px;color:#8a5d17;font-weight:600;";
          cEl.textContent = cap(() => c.printf(B.cat, B.discCats[disc.flags & DiscoveryFlag.KIND_MASK]));
          const iEl = document.createElement("div");
          iEl.style.cssText = "font-size:14px;color:var(--uw2-ink-muted);";
          iEl.textContent = cap(() => c.printf(B.imp, imp[Math.trunc(disc.importance / 25)] ?? Uint8Array.of(0)));
          meta.append(tEl, cEl, iEl);
          head.appendChild(meta);

          const descEl = document.createElement("div");
          descEl.style.cssText = "font-size:15px;line-height:1.75;color:var(--uw2-ink);margin-top:8px;padding-top:10px;border-top:1px solid rgba(154,119,56,0.28);";
          descEl.textContent = dec(rec.subarray(0x10));

          right.append(head, descEl);
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 8: 航海日志 ----
      const renderLogTab = (root: HTMLElement) => {
        const S = cmd.S;
        const entries: { date: string; text: string }[] = [];
        for (let i = 0; i < GameConst.TRADE_LOG_COUNT; i++) {
          const e = getTradeLogEntry(m, i), w = e.dateWord;
          if (w === 0xffff) break;
          const d = Math.trunc(w / 31), mon = Math.trunc(d / 12);
          const date = cap(() => c.printf(S.logDate, mon + 1501, d % 12 + 1, w % 31 + 1));
          const t = e.type;
          const text = cap(() => {
            if (t === 0 || t === 1) c.message(t ? 0x16f : 0x16e, e.argU16(0), m.port(e.argU8(2)).nameBytes);
            else if (t === 2) {
              const m34 = c.menuItems(0x34), m35 = c.menuItems(0x35), v = e.argU16(0);
              const k = v >= 60 ? 0 : v % 10 === 0 ? 0 : v % 10 < 5 ? 1 : 2;
              c.message(0x345, p.nations[Math.trunc(v / 10)], m34[k], m35[e.argU16(2)]);
            } else if (t === 9) c.message(0x17d, m.port(e.argU8(0)).nameBytes);
            else if (t === 12) c.message(0x180, p.goods[e.argU16(0)], e.argI32HiLo(2), e.argU16(6));
          });
          entries.push({ date, text });
        }
        const list = document.createElement("div");
        list.className = "uw2-list-col";
        list.style.maxHeight = "500px";
        for (const e of [...entries].reverse()) {
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          const d = document.createElement("span");
          d.style.cssText = "font-weight:700;color:#8a5d17;white-space:nowrap;font-size:13px;";
          d.textContent = e.date;
          const tx = document.createElement("span");
          tx.style.cssText = "flex:1;font-size:14px;color:var(--uw2-ink);";
          tx.textContent = e.text;
          card.append(d, tx);
          list.appendChild(card);
        }
        root.appendChild(list);
      };

      render(false);
  });
}
