// modern/dom_workbenches.ts — 與「讀取進度 (save_modal.ts)」1:1 同款視覺的三大一體化工作台 + 艦船/人物情報卡
// 涵蓋：交易所一體化工作台、碼頭補給與出航工作台、艦隊經營一體化大面板、人物情報卡（修正拼合頭像）、艦船情報卡。
import { DS, OFF } from "../model/schema_views.ts";
import { GameConst, MenuId } from "../model/flags.ts";
import { domS16, domUmin16, calcBuyPriceShift, calcSellPriceShift, clampPriceIndexUp, clampPriceIndexDown } from "../domain/economy.ts";
import { marketTradeLog } from "../scenes/market.js";
import { decodeCleanCstr } from "../canvas_ui/text_util.ts";
import { createDomModal, getPersonPortraitSrc, preserveScroll } from "./dom_ui.ts";
import { renderUnifiedInvestPane } from "./dom_buildings.ts";
import { UI_STR } from "./ui_strings.ts";

// ============================================================================
// 1. 交易所一體化工作台（買進 / 賣出 / 投資 / 物價）
// ============================================================================
export function runDomMarketWorkbench(market: any): Promise<void> {
  const c = market.c, b = market.b, codec = c.codec;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);
  const tabLabels = [...UI_STR.marketTabs];
  const marketTitle = "交易所";
  const portName = dec(market.port.nameBytes);

  return new Promise(resolve => {
    let activeTab = 0;
    let selGoodIdx = 0;
    let selShipIdx = 0;
    let selCargoIdx = 0;
    let selPriceCat = 0;
    let qty = 0;
    let investAmt = 1000;
    let toastMsg = "";

    const h = createDomModal({
      title: `${portName} · ${marketTitle}`,
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const moneyPill = document.createElement("span");
    moneyPill.className = "uw2-pill";
    h.headerRight.prepend(moneyPill);

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";
    h.modal.insertBefore(toolbar, h.body);

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const toastEl = document.createElement("span");
    toastEl.style.cssText = "font-size:13px;font-weight:600;color:#247544;";
    footer.appendChild(toastEl);
    h.modal.appendChild(footer);

    const getBuyGoods = () => {
      const E = market.eco, R = market.reg;
      const list: { v: number; code: number; name: string; price: number; idx: number; isSpec: boolean }[] = [];
      let g = 0;
      for (; g < 9; g++) {
        const code = R.getBuyGoods(g);
        if (code === GameConst.EMPTY_SLOT) break;
        if (10 * R.getBuyLevels(g) <= E.commerce) {
          list.push({ v: g, code, name: dec(market.goodsName(code)), price: market.price(g), idx: market.sup(code) + 50, isSpec: false });
        }
      }
      if (E.specialtyGood !== GameConst.EMPTY_SLOT && 10 * E.specialtyLevel <= E.commerce && market.sup(E.specialtyGood) < 0x5a) {
        const code = E.specialtyGood;
        list.push({ v: g, code, name: dec(market.goodsName(code)), price: market.price(g), idx: market.sup(code) + 50, isSpec: true });
      }
      return list;
    };

    const getShips = () => {
      const n = b.fleetShips();
      const out: { slot: number; name: string; used: number; max: number; free: number; cargoSlots: { j: number; g: number; name: string; amt: number; sellPrice: number }[] }[] = [];
      for (let i = 0; i < n; i++) {
        const slot = c.persons[i] & 0xff;
        const shipId = market.st.u8(b.fleetSlot(slot) + 7);
        const ship = market.m.ship(shipId);
        const max = domS16(ship.maxCargo);
        const used = domS16(b.cargoUsed(slot));
        const cs = market.m.crewSlot(slot);
        const cargoSlots = [];
        for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
          const g = cs.getCargoGoods(j);
          if (g >= 46) continue;
          cargoSlots.push({ j, g, name: dec(market.goodsName(g)), amt: domS16(cs.getCargoAmts(j)), sellPrice: market.sellPrice(g) });
        }
        out.push({ slot, name: dec(ship.nameBytes), used, max, free: Math.max(0, max - used), cargoSlots });
      }
      return out;
    };

    const computeBuyMax = (good: any, ship: any) => {
      if (!good || !ship || good.price <= 0) return 0;
      const cs = market.m.crewSlot(ship.slot);
      let hasSlot = false;
      for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
        const cg = cs.getCargoGoods(j);
        if (cg === GameConst.EMPTY_SLOT || cg === good.code) { hasSlot = true; break; }
      }
      if (!hasSlot) return 0;
      return Math.max(0, Math.min(ship.free, Math.floor((market.money >>> 0) / good.price)));
    };

    const render = (keepScroll = true) => {
      const money = market.money;
      moneyPill.textContent = `金块 ${Math.trunc(money / 10000)}  ·  金币 ${money % 10000}`;
      toastEl.textContent = toastMsg;

      const goods = getBuyGoods();
      const ships = getShips();
      if (selGoodIdx >= goods.length) selGoodIdx = Math.max(0, goods.length - 1);
      if (selShipIdx >= ships.length) selShipIdx = Math.max(0, ships.length - 1);

      toolbar.innerHTML = "";
      tabLabels.forEach((lb: string, i: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
        btn.disabled = (i === 0 || i === 1) && ships.length === 0;
        btn.textContent = lb;
        btn.addEventListener("click", () => { activeTab = i; qty = 0; selCargoIdx = 0; render(false); });
        toolbar.appendChild(btn);
      });

      preserveScroll(h.body, () => {
      h.body.innerHTML = "";

      if (activeTab === 0) {
        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const lt = document.createElement("div");
        lt.className = "uw2-pane-title";
        lt.textContent = dec(market.T.buyHdr);
        const glist = document.createElement("div");
        glist.className = "uw2-list-col";
        goods.forEach((g, i) => {
          const row = document.createElement("button");
          row.className = `uw2-row-card ${i === selGoodIdx ? "selected" : ""}`;
          row.innerHTML = `<span style="font-weight:700;${g.isSpec ? "color:#9e5a00;" : ""}">${g.name}</span><span style="font-weight:700;font-variant-numeric:tabular-nums;">${g.price} <small style="color:var(--uw2-ink-muted)">(${g.idx}%)</small></span>`;
          row.addEventListener("click", () => { selGoodIdx = i; qty = 0; render(); });
          glist.appendChild(row);
        });
        left.append(lt, glist);

        const right = document.createElement("div");
        right.className = "uw2-pane";
        const slist = document.createElement("div");
        slist.className = "uw2-list-col";
        slist.style.maxHeight = "210px";
        ships.forEach((s, i) => {
          const row = document.createElement("button");
          row.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
          const pct = s.max > 0 ? Math.min(100, Math.round((s.used / s.max) * 100)) : 100;
          row.innerHTML = `<span style="font-weight:700;min-width:110px;">${s.name}</span><div class="uw2-bar-track" style="flex:1;"><div class="uw2-bar-fill ${pct > 85 ? "red" : "green"}" style="width:${pct}%"></div></div><span style="font-size:12px;font-weight:700;min-width:62px;text-align:right;">${s.used}/${s.max}</span>`;
          row.addEventListener("click", () => { selShipIdx = i; qty = 0; render(); });
          slist.appendChild(row);
        });

        const selGood = goods[selGoodIdx];
        const selShip = ships[selShipIdx];
        const maxQty = computeBuyMax(selGood, selShip);
        if (qty > maxQty) qty = maxQty;
        if (qty === 0 && maxQty > 0) qty = Math.min(10, maxQty);

        const dock = document.createElement("div");
        dock.className = "uw2-action-box";
        const dockHead = document.createElement("div");
        dockHead.style.cssText = "display:flex;justify-content:space-between;font-weight:700;font-size:14px;";
        const dockPair = document.createElement("span");
        dockPair.textContent = selGood && selShip ? `${selGood.name} → ${selShip.name}` : "";
        const qtyReadout = document.createElement("span");
        dockHead.append(dockPair, qtyReadout);
        dock.appendChild(dockHead);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(maxQty);
        slider.value = String(qty);
        slider.disabled = maxQty === 0;

        const buyBtn = document.createElement("button");
        buyBtn.className = "uw2-btn uw2-btn-primary";
        buyBtn.style.marginLeft = "auto";
        buyBtn.style.padding = "7px 22px";
        buyBtn.textContent = tabLabels[0];

        const syncQty = (next: number) => {
          qty = Math.max(0, Math.min(maxQty, Math.trunc(next) || 0));
          slider.value = String(qty);
          qtyReadout.textContent = `${qty} / ${maxQty} (${selGood ? qty * selGood.price : 0})`;
          buyBtn.disabled = qty <= 0 || !selGood || !selShip;
        };
        syncQty(qty);
        slider.addEventListener("input", () => syncQty(Number(slider.value)));

        const stepRow = document.createElement("div");
        stepRow.className = "uw2-step-row";
        for (const [lb, fn] of [
          ["-10", () => syncQty(qty - 10)],
          ["-1", () => syncQty(qty - 1)],
          ["+1", () => syncQty(qty + 1)],
          ["+10", () => syncQty(qty + 10)],
          ["MAX", () => syncQty(maxQty)],
        ] as const) {
          const btn = document.createElement("button");
          btn.className = "uw2-step-btn";
          btn.disabled = maxQty === 0;
          btn.textContent = lb;
          btn.addEventListener("click", fn);
          stepRow.appendChild(btn);
        }
        buyBtn.addEventListener("click", () => {
          if (qty <= 0 || !selGood || !selShip) return;
          const E = market.eco, cs = market.m.crewSlot(selShip.slot);
          let j = 0;
          while (j < GameConst.CARGO_SLOTS && cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT && cs.getCargoGoods(j) !== selGood.code) j++;
          if (j >= GameConst.CARGO_SLOTS) return;
          market.tradeLog(0x0c, selGood.code, selGood.price, qty);
          market.money = market.money - qty * selGood.price;
          cs.setCargoGoods(j, selGood.code);
          cs.setCargoAmts(j, cs.getCargoAmts(j) + qty);
          const cat = market.cat(selGood.code);
          const { catDelta: d, allDelta: t } = calcBuyPriceShift(qty * selGood.price, E.commerce);
          E.setPrices(cat, clampPriceIndexUp(E.getPrices(cat), d));
          for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexUp(E.getPrices(i), t));
          b.loadTotal(selShip.slot);
          b.p.panels();
          toastMsg = `${selGood.name} ×${qty} → ${selShip.name}`;
          qty = 0;
          render();
        });
        stepRow.appendChild(buyBtn);
        dock.append(slider, stepRow);

        right.append(slist, dock);
        split.append(left, right);
        h.body.appendChild(split);
      } else if (activeTab === 1) {
        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        ships.forEach((s, i) => {
          const row = document.createElement("button");
          row.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
          row.innerHTML = `<span style="font-weight:700;">${s.name}</span><span style="font-weight:700;">${s.cargoSlots.length}</span>`;
          row.addEventListener("click", () => { selShipIdx = i; selCargoIdx = 0; qty = 0; render(); });
          left.appendChild(row);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        const selShip = ships[selShipIdx];
        const cargos = selShip?.cargoSlots ?? [];
        if (selCargoIdx >= cargos.length) selCargoIdx = Math.max(0, cargos.length - 1);

        const clist = document.createElement("div");
        clist.className = "uw2-list-col";
        clist.style.maxHeight = "210px";
        cargos.forEach((cg, i) => {
          const row = document.createElement("button");
          row.className = `uw2-row-card ${i === selCargoIdx ? "selected" : ""}`;
          row.innerHTML = `<span style="font-weight:700;">${cg.name} ×${cg.amt}</span><span style="font-weight:700;color:#247544;">${cg.sellPrice}</span>`;
          row.addEventListener("click", () => { selCargoIdx = i; qty = cg.amt; render(); });
          clist.appendChild(row);
        });

        const selCargo = cargos[selCargoIdx];
        const maxSell = selCargo?.amt ?? 0;
        if (qty > maxSell) qty = maxSell;
        if (qty === 0 && maxSell > 0) qty = maxSell;

        const dock = document.createElement("div");
        dock.className = "uw2-action-box";
        dock.innerHTML = `<div style="display:flex;justify-content:space-between;font-weight:700;font-size:14px;"><span>${selCargo ? selCargo.name : ""}</span><span style="color:#247544;">${qty} / ${maxSell} (+${selCargo ? qty * selCargo.sellPrice : 0})</span></div>`;
        const stepRow = document.createElement("div");
        stepRow.className = "uw2-step-row";
        for (const [lb, fn] of [
          ["-10", () => { qty = Math.max(0, qty - 10); render(); }],
          ["-1", () => { qty = Math.max(0, qty - 1); render(); }],
          ["+1", () => { qty = Math.min(maxSell, qty + 1); render(); }],
          ["+10", () => { qty = Math.min(maxSell, qty + 10); render(); }],
          ["MAX", () => { qty = maxSell; render(); }],
        ] as const) {
          const btn = document.createElement("button");
          btn.className = "uw2-step-btn";
          btn.disabled = maxSell === 0;
          btn.textContent = lb;
          btn.addEventListener("click", fn);
          stepRow.appendChild(btn);
        }
        const sellBtn = document.createElement("button");
        sellBtn.className = "uw2-btn uw2-btn-primary";
        sellBtn.style.marginLeft = "auto";
        sellBtn.style.padding = "7px 22px";
        sellBtn.disabled = qty <= 0 || !selCargo || !selShip;
        sellBtn.textContent = tabLabels[1];
        sellBtn.addEventListener("click", () => {
          if (qty <= 0 || !selCargo || !selShip) return;
          const E = market.eco, cs = market.m.crewSlot(selShip.slot);
          market.money = market.money + qty * selCargo.sellPrice;
          cs.setCargoAmts(selCargo.j, cs.getCargoAmts(selCargo.j) - qty);
          const cat = market.cat(selCargo.g);
          const { catDelta: d, allDelta: t } = calcSellPriceShift(qty * selCargo.sellPrice, E.commerce);
          E.setPrices(cat, clampPriceIndexDown(E.getPrices(cat), d));
          for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexDown(E.getPrices(i), t));
          if (cs.getCargoAmts(selCargo.j) === 0) cs.setCargoGoods(selCargo.j, GameConst.EMPTY_SLOT);
          b.loadTotal(selShip.slot);
          b.p.panels();
          toastMsg = `${selCargo.name} ×${qty}  +${qty * selCargo.sellPrice}`;
          qty = 0;
          render();
        });
        stepRow.appendChild(sellBtn);
        dock.appendChild(stepRow);
        right.append(clist, dock);
        split.append(left, right);
        h.body.appendChild(split);
      } else if (activeTab === 2) {
        const E = market.eco;
        const di = market.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : market.money & 0xffff;
        const maxInv = b.isCapital() ? 0 : domUmin16(di, Math.max(0, GameConst.MAX_INVEST - E.commerceInvest));
        if (investAmt > maxInv) investAmt = maxInv;
        const blockMsg = b.isCapital() ? b.captureMessage(2) : E.commerceInvest >= GameConst.MAX_INVEST ? b.captureMessage(7) : "";
        renderUnifiedInvestPane({
          container: h.body,
          leftTitle: "港口商业",
          rightTitle: tabLabels[2],
          statLabel: "商业价值",
          statValue: domS16(E.commerce),
          investLabel: "本月商业投资",
          curInvest: E.commerceInvest,
          maxInvest: maxInv,
          amount: investAmt,
          blockMsg,
          promptMsg: b.captureMessage(8),
          confirmLabel: tabLabels[2],
          onAmountChange: v => { investAmt = v; },
          onConfirm: amt => {
            if (amt <= 0) return;
            E.commerceInvest += amt;
            market.money = market.money - amt;
            b.investSupport(amt, E.commerce);
            b.investOwner();
            b.p.panels();
            toastMsg = b.captureMessage(amt < 500 ? 0x0e : amt < 10000 ? 0x0f : 0x10);
            investAmt = 0;
            render();
          },
        });
      } else {
        const E = market.eco, T = market.T;
        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        for (let ci = 0; ci < 10; ci++) {
          const row = document.createElement("button");
          row.className = `uw2-row-card ${ci === selPriceCat ? "selected" : ""}`;
          row.innerHTML = `<span style="font-weight:700;">${dec(T.cats[ci])}</span><span style="font-weight:700;">${E.getPrices(ci) + 50}%</span>`;
          row.addEventListener("click", () => { selPriceCat = ci; render(); });
          left.appendChild(row);
        }
        const right = document.createElement("div");
        right.className = "uw2-slot-list";
        right.style.padding = "0";
        const di = selPriceCat ? T.catEnd[selPriceCat - 1] : 0;
        for (let si = 0; si < T.catEnd[selPriceCat] - di; si++) {
          const g = (di + si) & 0xff;
          const rb = market.regionBuy(g);
          const buyStr = rb ? String(rb) : g === E.specialtyGood ? String(market.price(g)) : dec(T.none);
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          card.innerHTML = `<span class="uw2-slot-title">${dec(market.goodsName(g))}</span><span style="font-weight:700;font-size:13px;">${buyStr} / ${market.sellPrice(g)}</span>`;
          right.appendChild(card);
        }
        split.append(left, right);
        h.body.appendChild(split);
      }
      }, keepScroll);
    };

    render(false);
  });
}

// ============================================================================
// 2. 碼頭一體化工作台（合併「補給」+「船塢」雙標籤 + 購物車差額結算 + 一鍵按比例全補給 + 出航）
// ============================================================================
export async function runDomWharfWorkbench(b: any): Promise<number> {
  const c = b.c, st = b.st, codec = c.codec;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);
  const wharfTitle = UI_STR.wharfTitle;
  const portName = dec(st.model.port(b.port).nameBytes);
  const wharfMenu = [UI_STR.wharfDepart, ...UI_STR.wharfTabs];
  const dockMenu = [...UI_STR.dockActions];
  const supNames = [...UI_STR.supplies];

  const unitPrice = (item: number) => {
    if (item === 0) return 0;
    const [cx, off] = [[0x14, 0x10], [0x5a, 0x17], [0x78, 0x10]][item - 1];
    return Math.trunc(((st.u8(b.eco + off) + 0x32) * cx) / 100);
  };

  const readShipVals = (slot: number): [number, number, number, number] => {
    const M = b.crewData(slot);
    return [
      Math.trunc(domS16(st.u16(M)) / 10),
      Math.trunc(domS16(st.u16(M + 2)) / 10),
      domS16(st.u16(M + 4)),
      domS16(st.u16(M + 6)),
    ];
  };

  // 純補級載重以外的貨艙占用（僅商業貨物）
  const goodsUsed = (slot: number): number => {
    const M = b.crewData(slot);
    let sum = 0;
    for (let j = 0; j < 5; j++) {
      if (st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + j) !== 0xff) sum += domS16(st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * j));
    }
    return sum;
  };

  for (;;) {
    const action = await new Promise<{ type: "close" | "depart"; days?: number }>(resolve => {
      let activeTab: 0 | 1 = 0; // 0 = 補給, 1 = 船塢
      let toastMsg = "";
      let toastOk = false;
      let selFleetDockIdx = 0;
      let selDockShipIdx = 0;

      // 購物車暫存：每艘船的目標 4 項補給數（修改時隨時可增可減，不提前扣款，確認時一次性結算）
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
          const M = b.crewData(slot);
          const cur = getDraft(slot);
          for (let k = 0; k < 4; k++) {
            const mul = k < 2 ? 10 : 1;
            st.set16(M + k * 2, cur[k] * mul);
          }
          b.loadTotal(slot);
        }
        if (cost > 0) b.money = (b.money - cost) | 0;
        b.p.panels();
        resetDraft();
        toastOk = true;
        toastMsg = cost > 0 ? `已补给 (-${cost})` : "已更新补给";
        return true;
      };

      // 全補給：僅按水 1:1 食物均衡補滿各船剩餘載重（不補資材、不補砲彈），受現有金幣上限約束
      const autoFillWaterFood = () => {
        const n = b.fleetShips();
        if (!n) return;
        let budget = b.money >>> 0;
        resetDraft();
        const pFood = unitPrice(1);

        for (let i = 0; i < n; i++) {
          const slot = c.persons[i] & 0xff;
          const ship = b.shipOf(slot);
          const maxCargo = domS16(st.u16(ship + 0x14));
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

      const toolbar = document.createElement("div");
      toolbar.className = "uw2-modal-toolbar";
      h.modal.insertBefore(toolbar, h.body);

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
          const slot = c.persons[i] & 0xff, M = b.crewData(slot), S = b.fleetSlot(slot), ship = b.shipOf(slot);
          const crew = domS16(st.u16(S));
          const drv = Math.trunc(crew * st.u8(M + 9) / 100), look = Math.trunc(crew * st.u8(M + 8) / 100);
          if (!drv) noDriver = true;
          const vals = getDraft(slot);
          waterT = (waterT + vals[0] * 10) & 0xffff;
          foodT = (foodT + vals[1] * 10) & 0xffff;
          crewT = (crewT + st.u16(S)) & 0xffff;
          const used = goodsUsed(slot) + vals[0] + vals[1] + vals[2] + vals[3];
          const max = domS16(st.u16(ship + 0x14));
          ships.push({
            slot, name: dec(b.dstr(ship)), drv, look, deck: Math.max(0, crew - drv - look),
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
        const tabs: [string, boolean][] = [
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
          } else {
            // ---- 船塢標籤頁（保管 / 配备 / 交换） ----
            // 先保存艦隊槽位再呼 dockScan()（因 dockScan() 內部的 dockList() 會覆寫 c.persons）
            const fleetSlots: number[] = [];
            for (let i = 0; i < n; i++) fleetSlots.push(c.persons[i] & 0xff);
            b.dockScan();
            const fleetList: { slot: number; name: string; capName: string; crew: number; isHero: boolean }[] = [];
            for (const slot of fleetSlots) {
              const S = b.fleetSlot(slot), M = b.crewData(slot);
              const capId = st.u8(M + OFF.CREW_SLOT.CAPTAIN);
              fleetList.push({
                slot,
                name: dec(b.dstr(b.shipOf(slot))),
                capName: capId < 0x78 ? dec(st.cstr(st.personRecord(capId))) : "----",
                crew: st.u16(S),
                isHero: capId === st.hero,
              });
            }
            const dockList: { slot: number; name: string; maxCrew: number }[] = [];
            for (let i = 0; i < b.b066; i++) {
              const dSlot = b.b06a[i];
              dockList.push({
                slot: dSlot,
                name: dec(b.dstr(b.shipOf(dSlot))),
                maxCrew: domS16(st.u16(b.shipOf(dSlot) + 0x12)),
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

            // 保管 (艦隊 → 船塢)
            const keepBtn = document.createElement("button");
            keepBtn.className = "uw2-btn";
            keepBtn.textContent = dockMenu[0] || "保管";
            keepBtn.disabled = !selF || selF.isHero || b.b066 >= b.b068;
            keepBtn.addEventListener("click", () => {
              if (!selF || selF.isHero || b.b066 >= b.b068) return;
              const d = b.b06a[b.b066];
              b.swapSlots(selF.slot, d);
              const Mf = b.crewData(selF.slot), Md = b.crewData(d);
              st.set8(Mf + 0x1c, 0); st.set8(Md + 0x1c, 0);
              st.set16(b.fleetSlot(selF.slot), 0); st.set16(b.fleetSlot(d), 0);
              st.set8(Mf + 0x1b, 0xff);
              st.set8(st.personRecord(st.u8(Md + 0x1b)) + 0x2e, 6);
              st.set8(Md + 0x1b, b.port | 0x80);
              b.compactSlots();
              resetDraft();
              toastOk = true; toastMsg = b.captureMessage(0x11a);
              render();
            });

            // 配備 (船塢 → 艦隊)
            const takeBtn = document.createElement("button");
            takeBtn.className = "uw2-btn";
            takeBtn.textContent = dockMenu[1] || "配备";
            takeBtn.disabled = !selD || b.b064 <= b.b062;
            takeBtn.addEventListener("click", () => {
              if (!selD || b.b064 <= b.b062) return;
              let f = 0; for (let i = 0; i < 10; i++) if (b.slotState(i) !== 0x10) { f = i; break; }
              b.swapSlots(f, selD.slot);
              const Mf = b.crewData(f), Md = b.crewData(selD.slot);
              st.set8(Mf + 0x1c, 0); st.set8(Md + 0x1c, 0);
              st.set16(b.fleetSlot(f), 0); st.set16(b.fleetSlot(selD.slot), 0);
              b.crewList();
              st.set8(Mf + 0x1b, c.persons[0]);
              st.set8(st.personRecord(c.persons[0]) + 0x2e, 2);
              st.set8(Md + 0x1b, b.port | 0x80);
              b.compactSlots();
              resetDraft();
              toastOk = true; toastMsg = b.captureMessage(0x11e);
              render();
            });

            // 交換 (艦隊 ↔ 船塢)
            const swapBtn = document.createElement("button");
            swapBtn.className = "uw2-btn uw2-btn-primary";
            swapBtn.textContent = dockMenu[2] || "交换";
            swapBtn.disabled = !selF || !selD;
            swapBtn.addEventListener("click", () => {
              if (!selF || !selD) return;
              const cap = domS16(st.u16(b.shipOf(selD.slot) + 0x12));
              b.swapSlots(selF.slot, selD.slot);
              const Mf = b.crewData(selF.slot), Md = b.crewData(selD.slot);
              st.set8(Mf + 0x1c, st.u8(Md + 0x1c)); st.set8(Md + 0x1c, 0);
              st.set16(b.fleetSlot(selF.slot), domUmin16(st.u16(b.fleetSlot(selD.slot)), cap));
              st.set16(b.fleetSlot(selD.slot), 0);
              st.set8(Mf + 0x1b, st.u8(Md + 0x1b));
              st.set8(Md + 0x1b, b.port | 0x80);
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
      st.set8(DS.DAYS_AT_SEA, 0);
      const sea = b.p;
      st.set8(sea.fleet + 0x1a, 8);
      c.sys.mickeys();
      st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0xdf);
      sea.foodDaily();
      sea.waterDaily();
      await sea.enterSea();
      st.set8(DS.LAST_PORT, 0xff);
      return 1;
    }
    return 0;
  }
}

// ============================================================================
// 3. 艦隊經營一體化大面板（左選船、右切 船長與艦船 / 水手與比例 / 人事變更 / 積載）
// ============================================================================
export function runDomFleetHub(cmd: any): Promise<void> {
  const c = cmd.c, st = cmd.st, b = cmd.b, { codec, art } = c;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);
  const m1b = c.menuItems(0x1b).slice(0, 6).map(dec);
  const tabLabels = [...UI_STR.fleetHubTabs];
  const statLabels = c.menuItems(0x29).slice(0, 7).map(dec);
  const roleLabels = [...UI_STR.crewPosts];

  return new Promise(resolve => {
    let activeTab = 0;
    let selShipIdx = 0;
    let pool = 0;
    let poolMorale = 0;
    let toastMsg = "";

    const tryClose = () => {
      if (b.fleetShips() > 0) {
        let heroCap = false;
        for (let i = 0; i < 10; i++) {
          if ((st.u8(b.fleetSlot(i) + 8) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === st.hero) { heroCap = true; break; }
        }
        if (!heroCap) { toastMsg = cmd.cap(() => c.message(0xe2)); render(); return; }
      }
      h.close();
      resolve();
    };

    const h = createDomModal({
      title: "经营",
      size: "wide",
      cancelable: false,
    });

    const poolPill = document.createElement("span");
    poolPill.className = "uw2-pill";
    const closeBtn = document.createElement("button");
    closeBtn.className = "uw2-btn";
    closeBtn.textContent = "关闭";
    closeBtn.addEventListener("click", tryClose);
    h.headerRight.append(poolPill, closeBtn);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); tryClose(); }
    };
    window.addEventListener("keydown", onEsc);
    const origClose = h.close;
    h.close = () => { window.removeEventListener("keydown", onEsc); origClose(); };

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";
    h.modal.insertBefore(toolbar, h.body);

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const toastEl = document.createElement("span");
    toastEl.style.cssText = "font-size:13px;font-weight:700;color:#b83d3d;";
    footer.appendChild(toastEl);
    h.modal.appendChild(footer);

    const scanPosts = () => {
      const posts = [0xff, 0xff, 0xff];
      for (let i = 0; i < 0x1e; i++) {
        const n = st.u8(DS.PARTY_CREW + i);
        if (n === 0xff) continue;
        const r = st.u8(st.personRecord(n) + 0x2e);
        if (r >= 3 && r <= 5) posts[r - 3] = n;
      }
      return posts;
    };

    const getShips = () => {
      const n = b.fleetShips(), out = [];
      for (let i = 0; i < n; i++) {
        const slot = c.persons[i] & 0xff, S = b.fleetSlot(slot), M = b.crewData(slot);
        const capId = st.u8(M + OFF.CREW_SLOT.CAPTAIN);
        if (capId & 0x80) continue;
        const ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
        out.push({
          slot, name: dec(st.cstr(ship)), typeId: st.u8(ship + 0x0f), capId,
          capName: dec(st.cstr(st.personRecord(capId))),
          crew: st.u16(S), maxCrew: st.u16(ship + 0x12),
          dur: st.u8(S + OFF.DOCK_SLOT.DURABILITY), maxDur: st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY),
          turn: st.u8(S + OFF.DOCK_SLOT.TURN), prop: st.u8(S + OFF.DOCK_SLOT.PROPULSION),
          used: domS16(b.cargoUsed(slot)), maxCargo: domS16(st.u16(ship + 0x14)),
          speed: (b.shipSpeed(slot) + 1) >> 1,
          navR: st.u8(M + OFF.CREW_SLOT.NAV_RATIO), lookR: st.u8(M + OFF.CREW_SLOT.LOOK_RATIO),
        });
      }
      return out;
    };

    const adjustSailors = (slot: number, delta: number) => {
      const M = b.crewData(slot), S = b.fleetSlot(slot);
      const ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
      const cur = st.u16(S), maxCrew = st.u16(ship + 0x12), mor = st.u8(M + OFF.CREW_SLOT.MORALE);
      const next = Math.max(0, Math.min(cur + delta, Math.min(cur + pool, maxCrew)));
      if (next === cur) return;
      st.set16(S, next);
      const prevPool = pool;
      pool = (pool - next + cur) & 0xffff;
      st.set8(M + OFF.CREW_SLOT.MORALE, 0);
      if (next) st.set8(M + OFF.CREW_SLOT.MORALE, cur < next ? Math.trunc((mor * cur + (next - cur) * poolMorale) / next) : mor);
      poolMorale = 0;
      if (pool) poolMorale = (cur < next ? poolMorale : Math.trunc((poolMorale * prevPool + (cur - next) * mor) / pool)) & 0xff;
      render();
    };

    const stepRatio = (slot: number, r: number, times = 1) => {
      const M = b.crewData(slot);
      for (let k = 0; k < times; k++) {
        const a = st.u8(M + OFF.CREW_SLOT.NAV_RATIO), b9 = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO), rest = (100 - a - b9) & 0xff;
        if (r <= 1) { const t = [b9, a, rest]; cmd.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[1]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[0]); }
        else if (r <= 3) { const t = [a, rest, b9]; cmd.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[0]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[2]); }
        else { const t = [rest, b9, a]; cmd.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[2]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[1]); }
      }
      render();
    };

    const render = (keepScroll = true) => {
      poolPill.style.display = pool > 0 ? "inline-flex" : "none";
      poolPill.textContent = `${dec(cmd.S.slRest)}: ${pool}`;
      toastEl.textContent = toastMsg;

      toolbar.innerHTML = "";
      tabLabels.forEach((lb: string, i: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
        btn.textContent = lb;
        btn.addEventListener("click", () => { activeTab = i; render(false); });
        toolbar.appendChild(btn);
      });

      const ships = getShips();
      if (selShipIdx >= ships.length) selShipIdx = Math.max(0, ships.length - 1);
      const curShip = ships[selShipIdx];

      preserveScroll(h.body, () => {
      h.body.innerHTML = "";
      const split = document.createElement("div");
      split.className = "uw2-split narrow-left";

      const left = document.createElement("div");
      left.className = "uw2-list-col";
      ships.forEach((s, i) => {
        const row = document.createElement("button");
        row.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
        row.innerHTML = `<div><div class="uw2-slot-title">${s.name}</div><div class="uw2-slot-sub">${s.capName}</div></div><div style="text-align:right;"><div style="font-weight:700;font-size:13px;">水手 ${s.crew}/${s.maxCrew}</div><div class="uw2-slot-sub">速度 ${s.speed}kt</div></div>`;
        row.addEventListener("click", () => { selShipIdx = i; render(); });
        left.appendChild(row);
      });

      const right = document.createElement("div");
      right.className = "uw2-pane";

      if (activeTab === 0 && curShip) {
        const top = document.createElement("div");
        top.className = "uw2-action-box";
        top.style.flexDirection = "row";
        top.style.alignItems = "center";
        top.style.justifyContent = "space-between";
        const shipUrl = art?.shipUrl?.(curShip.typeId);
        if (shipUrl) {
          const img = document.createElement("img");
          img.src = shipUrl;
          img.style.cssText = "width:144px;height:96px;object-fit:contain;border-radius:6px;background:#0e1b30;border:1px solid var(--uw2-gold);";
          top.appendChild(img);
        }
        const meta = document.createElement("div");
        meta.style.cssText = "flex:1;padding:0 14px;";
        meta.innerHTML = `<div style="font-size:18px;font-weight:700;">${curShip.name}</div><div style="font-size:14px;color:var(--uw2-ink-muted);margin-top:4px;">${curShip.capName}</div>`;
        const btns = document.createElement("div");
        btns.style.cssText = "display:flex;gap:8px;";
        const capBtn = document.createElement("button");
        capBtn.className = "uw2-btn uw2-btn-primary";
        capBtn.textContent = m1b[0];
        capBtn.addEventListener("click", async () => {
          const s = await b.listSel().select(0x89, b.captainPool());
          if (s !== -1) { cmd.setCaptain(curShip.slot, c.persons[s]); render(); }
        });
        const scrapBtn = document.createElement("button");
        scrapBtn.className = "uw2-step-btn";
        scrapBtn.disabled = ships.length <= 1 || curShip.capId === st.hero;
        scrapBtn.textContent = m1b[4];
        scrapBtn.addEventListener("click", async () => {
          await cmd.scrapShip(curShip.slot);
          for (let i = 0; i < 10; i++) {
            const S = b.fleetSlot(i);
            if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === 0xff) st.set8(S + OFF.DOCK_SLOT.FLAGS, 0);
          }
          render();
        });
        btns.append(capBtn, scrapBtn);
        top.append(meta, btns);
        right.appendChild(top);

        const statsBox = document.createElement("div");
        statsBox.className = "uw2-action-box";
        for (const [lb, v, mx] of [
          [statLabels[0], curShip.dur, curShip.maxDur || 100],
          [statLabels[1], curShip.turn, 100],
          [statLabels[2], curShip.prop, 100],
          [statLabels[3], curShip.crew, curShip.maxCrew || 1],
          [statLabels[5], curShip.used, curShip.maxCargo || 1],
        ] as [string, number, number][]) {
          const row = document.createElement("div");
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${lb}</span><span>${v} / ${mx}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${Math.min(100, Math.round((v / (mx || 1)) * 100))}%"></div></div>`;
          statsBox.appendChild(row);
        }
        right.appendChild(statsBox);
      } else if (activeTab === 1 && curShip) {
        const sBox = document.createElement("div");
        sBox.className = "uw2-action-box";
        sBox.innerHTML = `<div style="display:flex;justify-content:space-between;font-weight:700;"><span>${m1b[2]} — ${curShip.name}</span><span>${curShip.crew} / ${curShip.maxCrew}</span></div>`;
        const sRow = document.createElement("div");
        sRow.className = "uw2-step-row";
        for (const [lb, d] of [["-10", -10], ["-1", -1], ["+1", 1], ["+10", 10]] as [string, number][]) {
          const btn = document.createElement("button");
          btn.className = "uw2-step-btn";
          btn.textContent = lb;
          btn.addEventListener("click", () => adjustSailors(curShip.slot, d));
          sRow.appendChild(btn);
        }
        sBox.appendChild(sRow);

        const rBox = document.createElement("div");
        rBox.className = "uw2-action-box";
        const rt = document.createElement("div");
        rt.className = "uw2-pane-title";
        rt.textContent = m1b[3];
        rBox.appendChild(rt);
        for (const [lb, pct, da, ia] of [
          [dec(cmd.S.rDrive), curShip.lookR, 0, 1],
          [dec(cmd.S.rWatch), curShip.navR, 2, 3],
          [dec(cmd.S.rDeck), Math.max(0, 100 - curShip.navR - curShip.lookR), 4, 5],
        ] as [string, number, number, number][]) {
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          const people = Math.trunc((pct * curShip.crew) / 100);
          const lbl = document.createElement("span");
          lbl.className = "uw2-slot-title";
          lbl.style.minWidth = "84px";
          lbl.textContent = lb;
          const ctrl = document.createElement("div");
          ctrl.className = "uw2-step-row";
          const mk = (t: string, fn: () => void) => { const btn = document.createElement("button"); btn.className = "uw2-step-btn"; btn.textContent = t; btn.addEventListener("click", fn); return btn; };
          const val = document.createElement("span");
          val.style.cssText = "min-width:86px;text-align:center;font-weight:700;";
          val.textContent = `${people} (${pct}%)`;
          ctrl.append(mk("-5", () => stepRatio(curShip.slot, da, 5)), mk("-", () => stepRatio(curShip.slot, da, 1)), val, mk("+", () => stepRatio(curShip.slot, ia, 1)), mk("+5", () => stepRatio(curShip.slot, ia, 5)));
          card.append(lbl, ctrl);
          rBox.appendChild(card);
        }
        right.append(sBox, rBox);
      } else if (activeTab === 2) {
        const posts = scanPosts();
        const grid = document.createElement("div");
        grid.className = "uw2-pers-grid";
        for (let k = 0; k < 3; k++) {
          const pid = posts[k];
          const card = document.createElement("button");
          card.className = "uw2-pers-card";
          const roleEl = document.createElement("div");
          roleEl.style.cssText = "font-weight:700;color:#8a5d17;font-size:15px;";
          roleEl.textContent = roleLabels[k];
          const img = document.createElement("img");
          img.className = "uw2-portrait-img";
          img.style.width = "84px";
          img.style.height = "105px";
          const nameEl = document.createElement("div");
          nameEl.style.cssText = "font-weight:700;font-size:15px;color:var(--uw2-ink);";
          if (pid !== 0xff) {
            const P = st.personRecord(pid);
            nameEl.textContent = dec(st.cstr(P));
            void getPersonPortraitSrc(art, st.bytes(P, 0x32)).then(src => { if (src) img.src = src; });
          } else {
            nameEl.textContent = "----";
          }
          card.append(roleEl, img, nameEl);
          card.addEventListener("click", async () => {
            cmd.posts = scanPosts();
            await cmd.setPost(k);
            render();
          });
          grid.appendChild(card);
        }
        right.appendChild(grid);
      } else if (activeTab === 3 && curShip) {
        const M = b.crewData(curShip.slot);
        const supNames = b.LO.supplies.map(dec);
        const supVals = [Math.trunc(domS16(st.u16(M)) / 10), Math.trunc(domS16(st.u16(M + 2)) / 10), domS16(st.u16(M + 4)), domS16(st.u16(M + 6))];
        const supRow = document.createElement("div");
        supRow.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;";
        for (let k = 0; k < 4; k++) {
          const box = document.createElement("div");
          box.className = "uw2-slot-card";
          box.style.flexDirection = "column";
          box.innerHTML = `<span class="uw2-slot-sub">${supNames[k]}</span><span style="font-size:18px;font-weight:700;">${supVals[k]}</span>`;
          supRow.appendChild(box);
        }
        right.appendChild(supRow);

        const clist = document.createElement("div");
        clist.className = "uw2-list-col";
        for (let k = 0; k < 5; k++) {
          const g = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + k);
          const amt = domS16(st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k));
          if (g >= 46 || amt <= 0) continue;
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          card.innerHTML = `<span class="uw2-slot-title">${dec(b.LO.goods[g])}</span><span style="font-weight:700;">×${amt}</span>`;
          clist.appendChild(card);
        }
        right.appendChild(clist);
      }

      split.append(left, right);
      h.body.appendChild(split);
      }, keepScroll);
    };

    render(false);
  });
}

// ============================================================================
// 4. 現代人物情報彈窗（支援具名頭像 + 5 層拼合隨機頭像，徹底修復艾德瓦等夥伴頭像錯誤）
// ============================================================================
export async function runDomPersonInfo(
  art: any,
  personBytes: Uint8Array,
  headerLines: string[],
  stats: { label: string; val: number }[],
  detailLines: string[],
): Promise<void> {
  const portraitSrc = await getPersonPortraitSrc(art, personBytes);
  return new Promise(resolve => {
    const h = createDomModal({
      title: headerLines[0] || "",
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const top = document.createElement("div");
    top.className = "uw2-action-box";
    top.style.flexDirection = "row";
    top.style.alignItems = "center";
    if (portraitSrc) {
      const img = document.createElement("img");
      img.className = "uw2-portrait-img";
      img.style.width = "88px";
      img.style.height = "110px";
      img.src = portraitSrc;
      top.appendChild(img);
    }
    const hCol = document.createElement("div");
    hCol.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    headerLines.forEach((l, i) => {
      const d = document.createElement("div");
      d.style.cssText = i === 0 ? "font-size:20px;font-weight:700;" : "font-size:14px;color:var(--uw2-ink-muted);";
      d.textContent = l;
      hCol.appendChild(d);
    });
    top.appendChild(hCol);

    const split = document.createElement("div");
    split.className = "uw2-split";

    const sBox = document.createElement("div");
    sBox.className = "uw2-action-box";
    for (const s of stats) {
      const row = document.createElement("div");
      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${s.label}</span><span>${s.val}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${s.val >= 80 ? "" : "green"}" style="width:${Math.min(100, s.val)}%"></div></div>`;
      sBox.appendChild(row);
    }

    const dBox = document.createElement("div");
    dBox.className = "uw2-action-box";
    for (const dl of detailLines) {
      const d = document.createElement("div");
      d.style.cssText = "font-size:14px;line-height:1.65;color:var(--uw2-ink);";
      d.textContent = dl;
      dBox.appendChild(d);
    }

    split.append(sBox, dBox);
    h.body.append(top, split);
  });
}

// ============================================================================
// 5. 現代艦船情報彈窗
// ============================================================================
export function runDomShipInfo(
  art: any,
  typeId: number,
  leftLines: string[],
  bars: { label: string; cur: number; max: number }[],
): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({
      title: leftLines[1] || leftLines[0] || "",
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });
    const split = document.createElement("div");
    split.className = "uw2-split";

    const left = document.createElement("div");
    left.className = "uw2-action-box";
    const shipUrl = art?.shipUrl?.(typeId);
    if (shipUrl) {
      const img = document.createElement("img");
      img.src = shipUrl;
      img.style.cssText = "width:100%;max-height:140px;object-fit:contain;border-radius:8px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:8px;";
      left.appendChild(img);
    }
    for (const l of leftLines) {
      const d = document.createElement("div");
      d.style.cssText = "font-size:14px;line-height:1.55;color:var(--uw2-ink);";
      d.textContent = l;
      left.appendChild(d);
    }

    const right = document.createElement("div");
    right.className = "uw2-action-box";
    for (const b of bars) {
      const pct = b.max > 0 ? Math.min(100, Math.round((b.cur / b.max) * 100)) : 0;
      const row = document.createElement("div");
      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${b.label}</span><span>${b.cur} / ${b.max}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${pct}%"></div></div>`;
      right.appendChild(row);
    }

    split.append(left, right);
    h.body.append(split);
  });
}
