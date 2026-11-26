// ui/buildings/wharf.ts — 码头一体化工作台
import { GameConst, SeaFlag2, ShipSlotFlag } from "../../model/flags.ts";
import { WorldConst, fleetByAddr, heroOrDockSlot, setDaysAtSea, writePortName } from "../../model/world_helpers.ts";
import { domS16, domUmin16 } from "../../domain/economy.ts";
import { marketTradeLog } from "../../scenes/market.js";
import { decodeCleanCstr } from "../text_util.ts";
import { encodeTextForFont } from "../t2s.ts";
import { createDomModal, getBuildingArtUrl, mountBuildingBanner, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
// ============================================================================
// 2. 码头一体化工作台（合并「补给」+「船坞」双标签 + 购物车差额结算 + 一键按比例全补给 + 出航）
// ============================================================================
export async function runDomWharfWorkbench(b: any): Promise<number> {
  const c = b.c, st = b.st, m = st.model, codec = c.codec;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);
  const wharfTitle = UI_STR.wharfTitle;
  const isSupplyPort = b.port >= 0x64 && b.port < 0x82;
  let portName = dec(m.port(b.port).nameBytes);
  const wharfMenu = [UI_STR.wharfDepart, ...UI_STR.wharfTabs];
  const dockMenu = [...UI_STR.dockActions];
  const supNames = [...UI_STR.supplies];
  const renameTabLabel = isSupplyPort ? dec(c.menuItems(57)?.[2] ?? new Uint8Array()).replace(/\s+/g, "") || "命名" : "";

  const unitPrice = (item: number) => {
    if (item === 0) return 0;
    const [cx, priceIdx] = [[20, 2], [90, 9], [120, 2]][item - 1];
    return Math.trunc(((m.portEconomy(b.port).getPrices(priceIdx) + 50) * cx) / 100);
  };

  const readShipVals = (slot: number): [number, number, number, number] => {
    const cs = m.crewSlot(slot);
    return [
      Math.trunc(domS16(cs.water) / 10),
      Math.trunc(domS16(cs.food) / 10),
      domS16(cs.material),
      domS16(cs.ammo),
    ];
  };

  // 纯补级载重以外的货舱占用（仅商业货物）
  const goodsUsed = (slot: number): number => {
    const cs = m.crewSlot(slot);
    let sum = 0;
    for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
      if (cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT) sum += domS16(cs.getCargoAmts(j));
    }
    return sum;
  };

  for (;;) {
    const action = await new Promise<{ type: "close" | "depart"; days?: number }>(resolve => {
      let activeTab: 0 | 1 = (isSupplyPort && b.fleetShips() === 0) ? 1 : 0; // 0 = 补给, 1 = 船坞 / 命名
      let toastMsg = b.captureMessage(0x38);
      let toastOk = true;
      let selFleetDockIdx = 0;
      let selDockShipIdx = 0;
      let customPortName = portName;

      // 购物车暂存：每艘船的目标 4 项补给数（修改时随时可增可减，不提前扣款，确认时一次性结算）
      const draft = new Map<number, [number, number, number, number]>();
      const resetDraft = () => {
        draft.clear();
        const n = b.fleetShips();
        for (let i = 0; i < n; i++) {
          const slot = c.persons[i] & 0xff;
          draft.set(slot, readShipVals(slot));
        }
      };
      resetDraft();

      const getDraft = (slot: number): [number, number, number, number] => {
        let v = draft.get(slot);
        if (!v) { v = readShipVals(slot); draft.set(slot, v); }
        return v;
      };

      const calcDraftCostAndDirty = () => {
        const n = b.fleetShips();
        let cost = 0, dirty = false;
        for (let i = 0; i < n; i++) {
          const slot = c.persons[i] & 0xff;
          const orig = readShipVals(slot);
          const cur = getDraft(slot);
          for (let k = 0; k < 4; k++) {
            if (cur[k] !== orig[k]) dirty = true;
            if (cur[k] > orig[k]) cost += Math.imul(cur[k] - orig[k], unitPrice(k));
          }
        }
        return { cost, dirty };
      };

      const commitDraft = (): boolean => {
        const { cost, dirty } = calcDraftCostAndDirty();
        if (!dirty) return true;
        if (cost > (b.money >>> 0)) {
          toastOk = false;
          toastMsg = b.captureMessage(0x4c) || "金币不足";
          render();
          return false;
        }
        const n = b.fleetShips();
        for (let i = 0; i < n; i++) {
          const slot = c.persons[i] & 0xff;
          const cs = m.crewSlot(slot);
          const cur = getDraft(slot);
          cs.water = cur[0] * 10;
          cs.food = cur[1] * 10;
          cs.material = cur[2];
          cs.ammo = cur[3];
          b.loadTotal(slot);
        }
        if (cost > 0) b.money = (b.money - cost) | 0;
        b.p.panels();
        resetDraft();
        toastOk = true;
        toastMsg = cost > 0 ? `已补给 (-${cost})` : "已更新补给";
        return true;
      };

      // 全补给：仅按水 1:1 食物均衡补满各船剩余载重（不补资材、不补砲弹），受现有金币上限约束
      const autoFillWaterFood = () => {
        const n = b.fleetShips();
        if (!n) return;
        let budget = b.money >>> 0;
        resetDraft();
        const pFood = unitPrice(1);

        for (let i = 0; i < n; i++) {
          const slot = c.persons[i] & 0xff;
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const maxCargo = domS16(ship.maxCargo);
          const orig = readShipVals(slot);
          const cur: [number, number, number, number] = [...orig];
          const usedGoods = goodsUsed(slot);
          let free = Math.max(0, maxCargo - usedGoods - (cur[0] + cur[1] + cur[2] + cur[3]));

          if (free > 0) {
            if (cur[0] < cur[1]) {
              const addW = Math.min(cur[1] - cur[0], free);
              cur[0] += addW; free -= addW;
            } else if (cur[1] < cur[0]) {
              const needF = cur[0] - cur[1];
              const affordF = pFood > 0 ? Math.floor(budget / pFood) : needF;
              const addF = Math.min(needF, free, affordF);
              cur[1] += addF; free -= addF; budget -= addF * pFood;
            }
            if (free > 0) {
              const maxPairsBySpace = Math.floor(free / 2);
              const maxPairsByMoney = pFood > 0 ? Math.floor(budget / pFood) : maxPairsBySpace;
              const pairs = Math.min(maxPairsBySpace, maxPairsByMoney);
              if (pairs > 0) {
                cur[0] += pairs; cur[1] += pairs;
                free -= pairs * 2;
                budget -= pairs * pFood;
              }
              if (free > 0 && cur[0] <= cur[1]) { cur[0] += 1; free -= 1; }
            }
          }
          draft.set(slot, cur);
        }
        toastOk = true;
        toastMsg = "";
        render();
      };

      const h = createDomModal({
        title: `${portName} · ${wharfTitle}`,
        size: "wide",
        cancelable: true,
        closeLabel: "关闭",
        onCancel: () => resolve({ type: "close" }),
      });

      const daysPill = document.createElement("span");
      daysPill.className = "uw2-pill";
      const moneyPill = document.createElement("span");
      moneyPill.className = "uw2-pill";
      h.headerRight.prepend(daysPill, moneyPill);

      const toolbar = mountBuildingBanner(h.modal, h.body, getBuildingArtUrl(c, 3, b.p));

      const footer = document.createElement("div");
      footer.className = "uw2-modal-footer";
      const leftFoot = document.createElement("div");
      leftFoot.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
      const toastEl = document.createElement("span");
      toastEl.style.cssText = "font-size:13px;font-weight:700;";
      leftFoot.appendChild(toastEl);

      const rightFoot = document.createElement("div");
      rightFoot.style.cssText = "display:flex;align-items:center;gap:10px;";
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "uw2-btn";
      confirmBtn.style.padding = "8px 18px";
      confirmBtn.addEventListener("click", () => { if (commitDraft()) render(); });

      const departBtn = document.createElement("button");
      departBtn.className = "uw2-btn uw2-btn-primary";
      departBtn.style.padding = "8px 24px";
      departBtn.textContent = wharfMenu[0] || "出航";
      rightFoot.append(confirmBtn, departBtn);
      footer.append(leftFoot, rightFoot);
      h.modal.appendChild(footer);

      let curDays = 0, curNoDriver = false, curShips = 0;

      departBtn.addEventListener("click", () => {
        if (curShips === 0) return;
        const { dirty } = calcDraftCostAndDirty();
        if (dirty && !commitDraft()) return;
        if (curNoDriver) { toastOk = false; toastMsg = b.captureMessage(0x39); render(); return; }
        if (curDays <= 0) { toastOk = false; toastMsg = b.captureMessage(0x3b); render(); return; }
        h.close();
        resolve({ type: "depart", days: curDays });
      });

    const render = (keepScroll = true) => {
        const n = b.fleetShips();
        curShips = n;
        let noDriver = false, crewT = 0, waterT = 0, foodT = 0;
        const ships: any[] = [];
        for (let i = 0; i < n; i++) {
          const slot = c.persons[i] & 0xff;
          const cs = m.crewSlot(slot), slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship);
          const crew = domS16(slotView.crew);
          const drv = Math.trunc(crew * cs.lookRatio / 100), look = Math.trunc(crew * cs.navRatio / 100);
          if (!drv) noDriver = true;
          const vals = getDraft(slot);
          waterT = (waterT + vals[0] * 10) & 0xffff;
          foodT = (foodT + vals[1] * 10) & 0xffff;
          crewT = (crewT + slotView.crew) & 0xffff;
          const used = goodsUsed(slot) + vals[0] + vals[1] + vals[2] + vals[3];
          const max = domS16(ship.maxCargo);
          ships.push({
            slot, name: dec(ship.nameBytes), drv, look, deck: Math.max(0, crew - drv - look),
            used, max, free: Math.max(0, max - used), vals,
          });
        }
        curNoDriver = noDriver;
        curDays = crewT > 0 ? Math.trunc(domUmin16(waterT, foodT) / crewT) : 0;
        const { cost, dirty } = calcDraftCostAndDirty();

        daysPill.textContent = `${curDays} 天`;
        daysPill.className = `uw2-pill ${curDays > 0 && !noDriver ? "ok" : "err"}`;
        moneyPill.textContent = `金块 ${Math.trunc(b.money / 10000)}  ·  金币 ${b.money % 10000}`;
        toastEl.style.color = toastOk ? "#247544" : "#b83d3d";
        toastEl.textContent = toastMsg;
        confirmBtn.style.display = activeTab === 0 ? "inline-flex" : "none";
        confirmBtn.disabled = !dirty || cost > (b.money >>> 0);
        confirmBtn.textContent = dirty ? `确认补给 (${cost > 0 ? `-${cost}` : "0"})` : "已同步";
        departBtn.disabled = n === 0;

        toolbar.innerHTML = "";
        const tabs: [string, boolean][] = isSupplyPort
          ? [
              [wharfMenu[1] || "补给", n === 0],
              [renameTabLabel || "命名", false],
            ]
          : [
              [wharfMenu[1] || "补给", n === 0],
              [wharfMenu[2] || "船坞", !b.isCapital()],
            ];
        tabs.forEach(([lb, dis], i) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
          btn.disabled = dis;
          btn.textContent = lb;
          btn.addEventListener("click", () => { activeTab = i as 0 | 1; toastMsg = ""; render(false); });
          toolbar.appendChild(btn);
        });

        if (activeTab === 0 && n > 0) {
          const spacer = document.createElement("div");
          spacer.style.flex = "1";
          const btnFull = document.createElement("button");
          btnFull.className = "uw2-btn uw2-btn-primary";
          btnFull.textContent = "全补给";
          btnFull.addEventListener("click", () => autoFillWaterFood());

          const btnReset = document.createElement("button");
          btnReset.className = "uw2-btn";
          btnReset.disabled = !dirty;
          btnReset.textContent = "重置";
          btnReset.addEventListener("click", () => { resetDraft(); toastMsg = ""; render(); });

          toolbar.append(spacer, btnFull, btnReset);
        }

        preserveScroll(h.body, () => {
          h.body.innerHTML = "";

          if (activeTab === 0) {
            const hdr = document.createElement("div");
            hdr.className = "uw2-wharf-row";
            hdr.style.cssText = "background:transparent;border:none;padding:2px 10px;font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
            hdr.innerHTML = `<span>${wharfMenu[1] || "补给"}</span>` + [0, 1, 2, 3].map(k => {
              const p = unitPrice(k);
              return `<span style="text-align:center;">${supNames[k] || ""}${p > 0 ? ` (${p})` : ""}</span>`;
            }).join("");
            h.body.appendChild(hdr);

            const grid = document.createElement("div");
            grid.className = "uw2-wharf-grid";
            for (const s of ships) {
              const row = document.createElement("div");
              row.className = "uw2-wharf-row";
              const info = document.createElement("div");
              info.innerHTML = `<div class="uw2-slot-title">${s.name}</div><div class="uw2-slot-sub">操帆${s.drv} 瞭望${s.look} 甲板${s.deck} · 装载 ${s.used}/${s.max}</div>`;
              row.appendChild(info);

              for (let k = 0; k < 4; k++) {
                const cell = document.createElement("div");
                cell.className = "uw2-sup-cell";
                const curVal = s.vals[k];
                const maxForThis = curVal + s.free;

                const inp = document.createElement("input");
                inp.type = "number";
                inp.min = "0";
                inp.max = String(maxForThis);
                inp.value = String(curVal);
                inp.style.cssText = "width:64px;padding:4px 6px;font-size:14px;font-weight:700;text-align:center;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);font-variant-numeric:tabular-nums;";
                inp.addEventListener("change", () => {
                  const v = Math.max(0, Math.min(maxForThis, Math.trunc(Number(inp.value) || 0)));
                  const d = getDraft(s.slot);
                  d[k] = v;
                  render();
                });

                const maxBtn = document.createElement("button");
                maxBtn.className = "uw2-step-btn";
                maxBtn.style.padding = "4px 7px";
                maxBtn.textContent = "满";
                maxBtn.disabled = s.free <= 0;
                maxBtn.addEventListener("click", () => {
                  const d = getDraft(s.slot);
                  const orig = readShipVals(s.slot);
                  const price = unitPrice(k);
                  const { cost: curCost } = calcDraftCostAndDirty();
                  const remBudget = Math.max(0, (b.money >>> 0) - curCost);
                  const extraNeed = maxForThis - Math.max(orig[k], d[k]);
                  const affordExtra = price > 0 ? Math.floor(remBudget / price) : extraNeed;
                  d[k] = Math.min(maxForThis, Math.max(d[k], Math.min(orig[k], maxForThis)) + Math.max(0, affordExtra));
                  render();
                });

                cell.append(inp, maxBtn);
                row.appendChild(cell);
              }
              grid.appendChild(row);
            }
            h.body.appendChild(grid);
          } else if (isSupplyPort) {
            const box = document.createElement("div");
            box.className = "uw2-action-box";
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:10px;";
            const inp = document.createElement("input");
            inp.type = "text";
            inp.maxLength = 8;
            inp.value = customPortName;
            inp.style.cssText = "flex:1;padding:8px 12px;font-size:15px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";
            inp.addEventListener("input", () => { customPortName = inp.value; });

            const saveBtn = document.createElement("button");
            saveBtn.type = "button";
            saveBtn.className = "uw2-btn uw2-btn-primary";
            saveBtn.textContent = renameTabLabel || "命名";
            saveBtn.addEventListener("click", () => {
              const trimmed = customPortName.trim();
              if (!trimmed) {
                toastOk = false; toastMsg = b.captureMessage(0x39e) || "请输入名称"; render(false); return;
              }
              const bytes = encodeTextForFont(c.font, trimmed);
              if (!bytes) {
                toastOk = false; toastMsg = "含字库未收录字符"; render(false); return;
              }
              const portRec = m.port(b.port);
              const old = portRec.nameBytes.slice();
              writePortName(portRec, bytes);
              const cur = portRec.nameBytes;
              let dup = false;
              for (let pn = 0; pn < WorldConst.TOTAL_PORTS && !dup; pn++) {
                if (pn === b.port) continue;
                const o = m.port(pn).nameBytes;
                if (o.length === cur.length && o.every((v: number, idx: number) => v === cur[idx])) dup = true;
              }
              if (dup) {
                writePortName(portRec, old);
                toastOk = false; toastMsg = b.captureMessage(0x39f);
                render(false);
                return;
              }
              portName = dec(portRec.nameBytes);
              customPortName = portName;
              h.titleEl.textContent = `${portName} · ${wharfTitle}`;
              b.p.panels();
              toastOk = true; toastMsg = b.captureMessage(0x3a0, portRec.nameBytes);
              render(false);
            });
            row.append(inp, saveBtn);
            box.appendChild(row);
            h.body.appendChild(box);
          } else {
            // ---- 船坞标签页（保管 / 配备 / 交换） ----
            // 先保存舰队槽位再呼 dockScan()（因 dockScan() 内部的 dockList() 会覆写 c.persons）
            const fleetSlots: number[] = [];
            for (let i = 0; i < n; i++) fleetSlots.push(c.persons[i] & 0xff);
            b.dockScan();
            const fleetList: { slot: number; name: string; capName: string; crew: number; isHero: boolean }[] = [];
            for (const slot of fleetSlots) {
              const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot);
              const capId = cs.captain;
              fleetList.push({
                slot,
                name: dec(m.ship(slotView.ship).nameBytes),
                capName: capId < WorldConst.TOTAL_PERSONS ? dec(m.person(capId).givenNameBytes) : "----",
                crew: slotView.crew,
                isHero: capId === m.globals.hero,
              });
            }
            const dockList: { slot: number; name: string; maxCrew: number }[] = [];
            for (let i = 0; i < b.b066; i++) {
              const dSlot = b.b06a[i];
              const dShip = m.ship(heroOrDockSlot(m, dSlot).ship);
              dockList.push({
                slot: dSlot,
                name: dec(dShip.nameBytes),
                maxCrew: domS16(dShip.maxCrew),
              });
            }
            if (selFleetDockIdx >= fleetList.length) selFleetDockIdx = Math.max(0, fleetList.length - 1);
            if (selDockShipIdx >= dockList.length) selDockShipIdx = Math.max(0, dockList.length - 1);

            const split = document.createElement("div");
            split.className = "uw2-split";

            const left = document.createElement("div");
            left.className = "uw2-pane";
            const lt = document.createElement("div");
            lt.className = "uw2-pane-title";
            lt.textContent = `舰队 (${fleetList.length}/10)`;
            const flCol = document.createElement("div");
            flCol.className = "uw2-list-col";
            fleetList.forEach((f, i) => {
              const row = document.createElement("button");
              row.className = `uw2-row-card ${i === selFleetDockIdx ? "selected" : ""}`;
              row.innerHTML = `<span style="font-weight:700;">${f.name}</span><span class="uw2-slot-sub">${f.capName} · 水手 ${f.crew}</span>`;
              row.addEventListener("click", () => { selFleetDockIdx = i; render(); });
              flCol.appendChild(row);
            });
            left.append(lt, flCol);

            const right = document.createElement("div");
            right.className = "uw2-pane";
            const rt = document.createElement("div");
            rt.className = "uw2-pane-title";
            rt.textContent = `${wharfMenu[2] || "船坞"} (${dockList.length}/${b.b068})`;
            const dkCol = document.createElement("div");
            dkCol.className = "uw2-list-col";
            if (!dockList.length) {
              const empty = document.createElement("div");
              empty.className = "uw2-slot-sub";
              empty.style.padding = "12px";
              empty.textContent = "—";
              dkCol.appendChild(empty);
            }
            dockList.forEach((d, i) => {
              const row = document.createElement("button");
              row.className = `uw2-row-card ${i === selDockShipIdx ? "selected" : ""}`;
              row.innerHTML = `<span style="font-weight:700;">${d.name}</span><span class="uw2-slot-sub">最大水手 ${d.maxCrew}</span>`;
              row.addEventListener("click", () => { selDockShipIdx = i; render(); });
              dkCol.appendChild(row);
            });

            const actBar = document.createElement("div");
            actBar.className = "uw2-dialog-actions";
            const selF = fleetList[selFleetDockIdx];
            const selD = dockList[selDockShipIdx];

            // 保管 (舰队 → 船坞)
            const keepBtn = document.createElement("button");
            keepBtn.className = "uw2-btn";
            keepBtn.textContent = dockMenu[0] || "保管";
            keepBtn.disabled = !selF || selF.isHero || b.b066 >= b.b068;
            keepBtn.addEventListener("click", () => {
              if (!selF || selF.isHero || b.b066 >= b.b068) return;
              const d = b.b06a[b.b066];
              b.swapSlots(selF.slot, d);
              const mf = m.crewSlot(selF.slot), md = m.crewSlot(d);
              mf.morale = 0; md.morale = 0;
              heroOrDockSlot(m, selF.slot).crew = 0; heroOrDockSlot(m, d).crew = 0;
              mf.captain = GameConst.EMPTY_SLOT;
              m.person(md.captain).role = 6;
              md.captain = b.port | 0x80;
              b.compactSlots();
              resetDraft();
              toastOk = true; toastMsg = b.captureMessage(0x11a);
              render();
            });

            // 配备 (船坞 → 舰队)
            const takeBtn = document.createElement("button");
            takeBtn.className = "uw2-btn";
            takeBtn.textContent = dockMenu[1] || "配备";
            takeBtn.disabled = !selD || b.b064 <= b.b062;
            takeBtn.addEventListener("click", () => {
              if (!selD || b.b064 <= b.b062) return;
              let f = 0; for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (b.slotState(i) !== ShipSlotFlag.ACTIVE) { f = i; break; }
              b.swapSlots(f, selD.slot);
              const mf = m.crewSlot(f), md = m.crewSlot(selD.slot);
              mf.morale = 0; md.morale = 0;
              heroOrDockSlot(m, f).crew = 0; heroOrDockSlot(m, selD.slot).crew = 0;
              b.crewList();
              mf.captain = c.persons[0];
              m.person(c.persons[0]).role = 2;
              md.captain = b.port | 0x80;
              b.compactSlots();
              resetDraft();
              toastOk = true; toastMsg = b.captureMessage(0x11e);
              render();
            });

            // 交换 (舰队 ↔ 船坞)
            const swapBtn = document.createElement("button");
            swapBtn.className = "uw2-btn uw2-btn-primary";
            swapBtn.textContent = dockMenu[2] || "交换";
            swapBtn.disabled = !selF || !selD;
            swapBtn.addEventListener("click", () => {
              if (!selF || !selD) return;
              const cap = domS16(m.ship(heroOrDockSlot(m, selD.slot).ship).maxCrew);
              b.swapSlots(selF.slot, selD.slot);
              const mf = m.crewSlot(selF.slot), md = m.crewSlot(selD.slot);
              mf.morale = md.morale; md.morale = 0;
              const sfSlot = heroOrDockSlot(m, selF.slot), sdSlot = heroOrDockSlot(m, selD.slot);
              sfSlot.crew = domUmin16(sdSlot.crew, cap);
              sdSlot.crew = 0;
              mf.captain = md.captain;
              md.captain = b.port | 0x80;
              b.compactSlots();
              resetDraft();
              toastOk = true; toastMsg = b.captureMessage(0x11f);
              render();
            });

            actBar.append(keepBtn, takeBtn, swapBtn);
            right.append(rt, dkCol, actBar);
            split.append(left, right);
            h.body.appendChild(split);
          }
        }, keepScroll);
      };

      render(false);
    });

    if (action.type === "depart" && action.days) {
      marketTradeLog(st, c.rt, 1, action.days, 0, 0, b.port);
      setDaysAtSea(m, 0);
      const sea = b.p;
      const heroFl = fleetByAddr(m, sea.fleet);
      const pv = m.port(b.port);
      if (heroFl.x === pv.x && heroFl.y === pv.y && typeof sea.findPortSeaCoord === "function") {
        const [sx, sy] = sea.findPortSeaCoord(pv.x, pv.y);
        heroFl.x = sx;
        heroFl.y = sy;
        heroFl.subX = 0;
        heroFl.subY = 0;
      }
      heroFl.dir = 8;
      heroFl.flags = (heroFl.flags & ~0x10) | 1;
      c.sys.mickeys();
      m.globals.seaFlags2 &= ~SeaFlag2.STOPPED;
      sea.foodDaily();
      sea.waterDaily();
      await sea.enterSea();
      m.globals.lastPort = GameConst.EMPTY_SLOT;
      return 1;
    }
    return 0;
  }
}
