// ui/buildings/market.ts — 交易所一体化工作台
import { GameConst, SkillFlag } from "../../model/flags.ts";
import { heroOrDockSlot } from "../../model/world_helpers.ts";
import { domS16, domUmin16, domUmax16, calcHaggleBounds, calcBuyPriceShift, calcSellPriceShift, clampPriceIndexUp, clampPriceIndexDown } from "../../domain/economy.ts";
import { decodeCleanCstr, toSimp } from "../text_util.ts";
import { createDomModal, getBuildingArtUrl, mountBuildingBanner, preserveScroll } from "../modals.ts";
import { renderUnifiedInvestPane } from "./shared.ts";
import { UI_STR } from "../strings.ts";
// ============================================================================
// 1. 交易所一体化工作台（买进 / 卖出 / 投资 / 物价）
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
    let investReply = "";
    let haggleOpen = false;
    let haggleOffer = 0;
    let agreedUnit: { code: number; price: number } | null = null;
    const hero = market.m.heroPerson();
    const capMsg = (id: number, ...args: any[]) => toSimp(b.captureMessage(id, ...args).trim());
    let toastMsg = capMsg(market.m.heroInfo().tradeFame >= 1000 ? 1 : 0, hero.givenNameBytes, hero.familyNameBytes);

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

    const toolbar = mountBuildingBanner(h.modal, h.body, getBuildingArtUrl(c, 0, b.p));

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
        const shipId = heroOrDockSlot(market.m, slot).ship;
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

    const computeBuyMax = (good: any, ship: any, unitPrice = good?.price ?? 0) => {
      if (!good || !ship || unitPrice <= 0) return 0;
      const cs = market.m.crewSlot(ship.slot);
      let hasSlot = false;
      for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
        const cg = cs.getCargoGoods(j);
        if (cg === GameConst.EMPTY_SLOT || cg === good.code) { hasSlot = true; break; }
      }
      if (!hasSlot) return 0;
      return Math.max(0, Math.min(ship.free, Math.floor((market.money >>> 0) / unitPrice)));
    };

    const mountMarketQtyDock = (opts: {
      parent: HTMLElement;
      label: string;
      maxQty: number;
      initialQty: number;
      actionLabel: string;
      readoutColor?: string;
      disabled?: boolean;
      formatReadout: (n: number) => string;
      onCommit: (n: number) => void;
    }) => {
      let cur = Math.max(0, Math.min(opts.maxQty, Math.trunc(opts.initialQty) || 0));
      qty = cur;

      const dock = document.createElement("div");
      dock.className = "uw2-action-box";
      const dockHead = document.createElement("div");
      dockHead.style.cssText = "display:flex;justify-content:space-between;font-weight:700;font-size:14px;";
      const dockPair = document.createElement("span");
      dockPair.textContent = opts.label;
      const qtyReadout = document.createElement("span");
      if (opts.readoutColor) qtyReadout.style.color = opts.readoutColor;
      dockHead.append(dockPair, qtyReadout);
      dock.appendChild(dockHead);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = String(opts.maxQty);
      slider.value = String(cur);
      slider.disabled = opts.maxQty === 0;

      const actionBtn = document.createElement("button");
      actionBtn.className = "uw2-btn uw2-btn-primary";
      actionBtn.style.marginLeft = "auto";
      actionBtn.style.padding = "7px 22px";
      actionBtn.textContent = opts.actionLabel;

      const syncQty = (next: number) => {
        cur = Math.max(0, Math.min(opts.maxQty, Math.trunc(next) || 0));
        qty = cur;
        slider.value = String(cur);
        qtyReadout.textContent = opts.formatReadout(cur);
        actionBtn.disabled = cur <= 0 || !!opts.disabled;
      };
      syncQty(cur);
      slider.addEventListener("input", () => syncQty(Number(slider.value)));

      const stepRow = document.createElement("div");
      stepRow.className = "uw2-step-row";
      for (const [lb, fn] of [
        ["-10", () => syncQty(cur - 10)],
        ["-1", () => syncQty(cur - 1)],
        ["+1", () => syncQty(cur + 1)],
        ["+10", () => syncQty(cur + 10)],
        ["MAX", () => syncQty(opts.maxQty)],
      ] as const) {
        const btn = document.createElement("button");
        btn.className = "uw2-step-btn";
        btn.disabled = opts.maxQty === 0;
        btn.textContent = lb;
        btn.addEventListener("click", fn);
        stepRow.appendChild(btn);
      }
      actionBtn.addEventListener("click", () => { if (cur > 0 && !opts.disabled) opts.onCommit(cur); });
      stepRow.appendChild(actionBtn);
      dock.append(slider, stepRow);
      opts.parent.appendChild(dock);
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
        btn.addEventListener("click", () => { activeTab = i; qty = 0; selCargoIdx = 0; haggleOpen = false; agreedUnit = null; render(false); });
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
          row.innerHTML = `<span class="uw2-item-name" style="${g.isSpec ? "color:#9e5a00;" : ""}">${g.name}</span><span class="uw2-item-price">${g.price} <small class="uw2-item-meta">(${g.idx}%)</small></span>`;
          row.addEventListener("click", () => { selGoodIdx = i; qty = 0; haggleOpen = false; agreedUnit = null; render(); });
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
        if (agreedUnit && (!selGood || agreedUnit.code !== selGood.code)) agreedUnit = null;
        const unitPrice = agreedUnit ? agreedUnit.price : (selGood?.price ?? 0);
        const maxQty = computeBuyMax(selGood, selShip, unitPrice);
        if (qty > maxQty) qty = maxQty;
        if (qty === 0 && maxQty > 0) qty = Math.min(10, maxQty);

        right.append(slist);
        if (selGood && selGood.price > 1 && !agreedUnit) {
          const bonus = (((market.port.region & 7) ^ hero.face) & 0x0f) === 0 ? market.m.heroInfo().rank : 0;
          const { lo, mid } = calcHaggleBounds(selGood.price, bonus);
          const hRow = document.createElement("div");
          hRow.className = "uw2-step-row";
          hRow.style.cssText = "padding:6px 10px;border-radius:8px;background:rgba(255,253,246,0.75);border:1px solid rgba(154,119,56,0.28);";
          if (!haggleOpen) {
            const askTxt = document.createElement("span");
            askTxt.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink);";
            askTxt.textContent = capMsg(0x96, market.goodsName(selGood.code), selGood.price);
            const hBtn = document.createElement("button");
            hBtn.className = "uw2-step-btn";
            hBtn.style.marginLeft = "auto";
            hBtn.textContent = "议价";
            hBtn.addEventListener("click", () => {
              haggleOpen = true;
              haggleOffer = Math.max(1, lo);
              render();
            });
            hRow.append(askTxt, hBtn);
          } else {
            if (haggleOffer < 1 || haggleOffer >= selGood.price) haggleOffer = Math.max(1, lo);
            const hSl = document.createElement("input");
            hSl.type = "range";
            hSl.min = "1";
            hSl.max = String(selGood.price - 1);
            hSl.value = String(haggleOffer);
            hSl.style.flex = "1";
            const hVal = document.createElement("span");
            hVal.style.cssText = "font-size:13px;font-weight:700;min-width:56px;text-align:right;font-variant-numeric:tabular-nums;";
            hVal.textContent = String(haggleOffer);
            hSl.addEventListener("input", () => { haggleOffer = Number(hSl.value); hVal.textContent = String(haggleOffer); });
            const bidBtn = document.createElement("button");
            bidBtn.className = "uw2-step-btn";
            bidBtn.textContent = "出价";
            bidBtn.addEventListener("click", () => {
              if (haggleOffer >= mid) {
                agreedUnit = { code: selGood.code, price: haggleOffer };
                haggleOpen = false;
                toastMsg = capMsg(0x0a);
                render();
                return;
              }
              const acc = b.roleMember(4);
              const autoCut = (hero.skills & SkillFlag.NEGOTIATE) || (acc !== GameConst.EMPTY_SLOT && (market.m.person(acc).skills & SkillFlag.ACCOUNTING));
              if (autoCut) {
                agreedUnit = { code: selGood.code, price: lo };
                haggleOpen = false;
                toastMsg = `${capMsg(0x353, lo)} ${capMsg(0x354, lo)}`.trim();
                render();
                return;
              }
              if (!(((mid - lo) & 0xffff) & 0xfffe)) {
                toastMsg = capMsg(0x0b);
                render();
                return;
              }
              toastMsg = capMsg(0x0c, domUmax16(lo, (selGood.price - (((mid - lo) & 0xffff) >>> 1)) & 0xffff));
              render();
            });
            hRow.append(hSl, hVal, bidBtn);
          }
          right.appendChild(hRow);
        }
        mountMarketQtyDock({
          parent: right,
          label: selGood && selShip ? `${selGood.name} → ${selShip.name}` : "",
          maxQty,
          initialQty: qty,
          actionLabel: tabLabels[0],
          disabled: !selGood || !selShip,
          formatReadout: n => `${n} / ${maxQty} (${selGood ? n * unitPrice : 0})`,
          onCommit: committedQty => {
            if (!selGood || !selShip) return;
            const E = market.eco, cs = market.m.crewSlot(selShip.slot);
            let j = 0;
            while (j < GameConst.CARGO_SLOTS && cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT && cs.getCargoGoods(j) !== selGood.code) j++;
            if (j >= GameConst.CARGO_SLOTS) return;
            market.tradeLog(0x0c, selGood.code, unitPrice, committedQty);
            market.money = market.money - committedQty * unitPrice;
            cs.setCargoGoods(j, selGood.code);
            cs.setCargoAmts(j, cs.getCargoAmts(j) + committedQty);
            const cat = market.cat(selGood.code);
            const { catDelta: d, allDelta: t } = calcBuyPriceShift(committedQty * unitPrice, E.commerce);
            E.setPrices(cat, clampPriceIndexUp(E.getPrices(cat), d));
            for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexUp(E.getPrices(i), t));
            b.loadTotal(selShip.slot);
            b.p.panels();
            toastMsg = `${selGood.name} ×${committedQty} → ${selShip.name}`;
            qty = 0;
            agreedUnit = null;
            haggleOpen = false;
            render();
          },
        });
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
          row.innerHTML = `<span class="uw2-item-name">${cg.name} ×${cg.amt}</span><span class="uw2-item-price ok">${cg.sellPrice}</span>`;
          row.addEventListener("click", () => { selCargoIdx = i; qty = cg.amt; render(); });
          clist.appendChild(row);
        });

        const selCargo = cargos[selCargoIdx];
        const maxSell = selCargo?.amt ?? 0;
        if (qty > maxSell) qty = maxSell;
        if (qty === 0 && maxSell > 0) qty = maxSell;

        right.append(clist);
        mountMarketQtyDock({
          parent: right,
          label: selCargo ? selCargo.name : "",
          maxQty: maxSell,
          initialQty: qty,
          actionLabel: tabLabels[1],
          readoutColor: "#247544",
          disabled: !selCargo || !selShip,
          formatReadout: n => `${n} / ${maxSell} (+${selCargo ? n * selCargo.sellPrice : 0})`,
          onCommit: committedQty => {
            if (!selCargo || !selShip) return;
            const E = market.eco, cs = market.m.crewSlot(selShip.slot);
            market.money = market.money + committedQty * selCargo.sellPrice;
            cs.setCargoAmts(selCargo.j, cs.getCargoAmts(selCargo.j) - committedQty);
            const cat = market.cat(selCargo.g);
            const { catDelta: d, allDelta: t } = calcSellPriceShift(committedQty * selCargo.sellPrice, E.commerce);
            E.setPrices(cat, clampPriceIndexDown(E.getPrices(cat), d));
            for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexDown(E.getPrices(i), t));
            if (cs.getCargoAmts(selCargo.j) === 0) cs.setCargoGoods(selCargo.j, GameConst.EMPTY_SLOT);
            b.loadTotal(selShip.slot);
            b.p.panels();
            toastMsg = `${selCargo.name} ×${committedQty}  +${committedQty * selCargo.sellPrice}`;
            qty = 0;
            render();
          },
        });
        split.append(left, right);
        h.body.appendChild(split);
      } else if (activeTab === 2) {
        toastEl.textContent = "";
        const E = market.eco;
        const di = market.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : market.money & 0xffff;
        const maxInv = b.isCapital() ? 0 : domUmin16(di, Math.max(0, GameConst.MAX_INVEST - E.commerceInvest));
        if (investAmt > maxInv) investAmt = maxInv;
        const blockMsg = b.isCapital() ? b.captureMessage(2) : E.commerceInvest >= GameConst.MAX_INVEST ? (investReply || b.captureMessage(7)) : "";
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
          promptMsg: investReply || b.captureMessage(8),
          confirmLabel: tabLabels[2],
          onAmountChange: v => { investAmt = v; },
          onConfirm: amt => {
            if (amt <= 0) return;
            E.commerceInvest += amt;
            market.money = market.money - amt;
            b.investSupport(amt, E.commerce);
            b.investOwner();
            b.p.panels();
            investReply = b.captureMessage(amt < 500 ? 0x0e : amt < 10000 ? 0x0f : 0x10);
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
          row.innerHTML = `<span class="uw2-item-name">${dec(T.cats[ci])}</span><span class="uw2-item-price">${E.getPrices(ci) + 50}%</span>`;
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
          card.innerHTML = `<span class="uw2-item-name">${dec(market.goodsName(g))}</span><span class="uw2-item-price">${buyStr} / ${market.sellPrice(g)}</span>`;
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
