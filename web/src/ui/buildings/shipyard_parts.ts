// ui/buildings/shipyard_parts.ts — 造船厂工作台共用子组件与剩余货物分配弹窗（从 shipyard.ts 拆分）
import { GameConst, ShipSlotFlag, SkillFlag } from "../../model/flags.ts";
import { heroOrDockSlot, heroShipSlot } from "../../model/world_helpers.ts";
import { createDomModal, preserveScroll, runDomYesNo } from "../modals.ts";
import { decodeCleanCstr, toSimp } from "../text_util.ts";
import { capMsg } from "./shared.ts";

export interface ShipyardDesignState {
  crew: number;
  guns: number;
}

export interface ShipyardHaggleState {
  customShipName: string;
  lastNameKey: string;
  offerPrice: number;
  lastPriceKey: string;
  haggleOpen: boolean;
  haggleAccRand: number;
}

export function renderShipHeader(art: any, box: HTMLElement, shipType: number, titleText: string, subText: string): void {
  const head = document.createElement("div");
  head.style.cssText = "display:flex;align-items:center;gap:14px;";
  const url = art?.shipUrl?.(shipType);
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = "width:112px;height:84px;object-fit:contain;border-radius:8px;border:1px solid rgba(154,119,56,0.4);background:#1b2a40;";
    head.appendChild(img);
  }
  const meta = document.createElement("div");
  meta.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  meta.innerHTML =
    `<div class="uw2-detail-title">${titleText}</div>` +
    `<div style="font-size:13px;color:var(--uw2-ink-muted);">${subText}</div>`;
  head.appendChild(meta);
  box.appendChild(head);
}

export function mountShipDesignControls(
  box: HTMLElement,
  stype: any,
  state: ShipyardDesignState,
  initCrew?: number,
  initGuns?: number,
): void {
  const maxCrewCap = stype.maxCrewDiv10 * 10;
  if (state.crew < stype.minCrew || state.crew > maxCrewCap) {
    state.crew = Math.max(stype.minCrew, Math.min(maxCrewCap, initCrew ?? stype.minCrew));
  }
  const maxGunsAllow = Math.max(0, Math.min(stype.maxGuns, stype.capacity - state.crew));
  if (state.guns < 0 || state.guns > maxGunsAllow) {
    state.guns = Math.max(0, Math.min(maxGunsAllow, initGuns ?? 0));
  }

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:rgba(255,253,246,0.7);border:1px solid rgba(154,119,56,0.28);";

  const capSummary = document.createElement("div");
  capSummary.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink);";
  wrap.appendChild(capSummary);

  const makeRow = (label: string, min: number, getMax: () => number, getVal: () => number, setVal: (v: number) => void, stepBig = 10) => {
    const row = document.createElement("div");
    row.className = "uw2-step-row";
    const lb = document.createElement("span");
    lb.style.cssText = "min-width:68px;font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
    lb.textContent = label;
    const sl = document.createElement("input");
    sl.type = "range";
    sl.style.flex = "1";
    sl.min = String(min);
    const valEl = document.createElement("span");
    valEl.style.cssText = "min-width:44px;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;";
    const btns: { el: HTMLButtonElement; d: number }[] = [];
    for (const d of [-stepBig, -1, 1, stepBig]) {
      const btn = document.createElement("button");
      btn.className = "uw2-step-btn";
      btn.textContent = d > 0 ? `+${d}` : String(d);
      btn.addEventListener("click", () => { setVal(getVal() + d); syncDesign(); });
      btns.push({ el: btn, d });
    }
    sl.addEventListener("input", () => { setVal(Number(sl.value)); syncDesign(); });
    row.append(lb, sl, ...btns.map(b0 => b0.el), valEl);
    wrap.appendChild(row);
    return () => {
      const mx = getMax();
      const v = Math.max(min, Math.min(mx, getVal()));
      sl.max = String(mx);
      sl.value = String(v);
      sl.disabled = mx <= min;
      valEl.textContent = String(v);
      for (const b0 of btns) b0.el.disabled = b0.d < 0 ? v <= min : v >= mx;
    };
  };

  let syncGunsRow = () => {};
  const syncCrewRow = makeRow(
    "最大水手", stype.minCrew, () => maxCrewCap,
    () => state.crew,
    v => {
      state.crew = Math.max(stype.minCrew, Math.min(maxCrewCap, v));
      const maxG = Math.max(0, Math.min(stype.maxGuns, stype.capacity - state.crew));
      if (state.guns > maxG) state.guns = maxG;
    },
    10,
  );
  syncGunsRow = makeRow(
    "最大火炮", 0, () => Math.max(0, Math.min(stype.maxGuns, stype.capacity - state.crew)),
    () => state.guns,
    v => {
      const maxG = Math.max(0, Math.min(stype.maxGuns, stype.capacity - state.crew));
      state.guns = Math.max(0, Math.min(maxG, v));
    },
    5,
  );

  const syncDesign = () => {
    syncCrewRow();
    syncGunsRow();
    const cargo = Math.max(0, stype.capacity - state.crew - state.guns);
    capSummary.textContent = `载货 ${cargo}/${stype.capacity} · 水手 ${state.crew} · 火炮 ${state.guns}`;
  };
  syncDesign();
  box.appendChild(wrap);
}

export function mountNegotiateAndNameBox(opts: {
  b: any;
  state: ShipyardHaggleState;
  box: HTMLElement;
  priceKey: string;
  defaultName: string;
  listPrice: number;
  tradeInSlot: number;
  submitLabel: string;
  onNotice: (msg: string) => void;
  onKickout: () => void;
  onRender: () => void;
  onCommit: (offer: number, avail: number, nameTxt: string) => void;
}): void {
  const { b, state } = opts;
  const c = b.c, m = b.st.model, hero = m.heroPerson(), rng = c.sys.rng;

  if (state.lastNameKey !== opts.priceKey) {
    state.customShipName = opts.defaultName;
    state.lastNameKey = opts.priceKey;
  }
  const avail = (b.money + (opts.tradeInSlot >= 0 ? Math.trunc(b.shipPrice(opts.tradeInSlot) / 2) : 0)) | 0;
  const maxOffer = Math.max(0, Math.min(avail, opts.listPrice));
  if (state.lastPriceKey !== opts.priceKey) {
    state.offerPrice = maxOffer;
    state.lastPriceKey = opts.priceKey;
    state.haggleOpen = false;
    state.haggleAccRand = rng.random(10);
  } else if (state.offerPrice < 0 || state.offerPrice > maxOffer) {
    state.offerPrice = maxOffer;
  }
  const floor = Math.trunc(Math.imul(500 - hero.getStats(6), opts.listPrice) / 500) | 0;

  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display:flex;align-items:center;gap:8px;";
  const nLbl = document.createElement("span");
  nLbl.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink-muted);white-space:nowrap;";
  nLbl.textContent = "新船名";
  const nameInp = document.createElement("input");
  nameInp.type = "text";
  nameInp.maxLength = 7;
  nameInp.value = state.customShipName;
  nameInp.style.cssText = "flex:1;padding:6px 10px;font-size:14px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";
  nameInp.addEventListener("input", () => { state.customShipName = nameInp.value; });
  nameRow.append(nLbl, nameInp);
  opts.box.appendChild(nameRow);

  const priceWrap = document.createElement("div");
  priceWrap.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:rgba(255,253,246,0.7);border:1px solid rgba(154,119,56,0.28);";
  const origAsk = capMsg(c, opts.priceKey.startsWith("new_") ? 0x100 : 0xc2, opts.listPrice);
  const topLine = document.createElement("div");
  topLine.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;font-weight:700;flex-wrap:wrap;";
  const pInfo = document.createElement("span");
  pInfo.style.color = "var(--uw2-ink)";

  const tryCommit = (offer: number) => {
    if (offer < floor) {
      if (!rng.random(5)) {
        m.globals.dailyFlags |= 2;
        opts.onKickout();
        return;
      }
      opts.onNotice(capMsg(c, 0xc6));
      opts.onRender();
      return;
    }
    if (avail < offer) { opts.onNotice(capMsg(c, 0xef)); opts.onRender(); return; }
    opts.onCommit(offer, avail, nameInp.value);
  };

  if (!state.haggleOpen) {
    pInfo.textContent = origAsk;
    topLine.appendChild(pInfo);

    const btnRow = document.createElement("div");
    btnRow.className = "uw2-step-row";
    const hagBtn = document.createElement("button");
    hagBtn.className = "uw2-step-btn";
    hagBtn.textContent = "议价";
    hagBtn.disabled = opts.listPrice <= 0;
    hagBtn.addEventListener("click", () => {
      state.haggleOpen = true;
      state.haggleAccRand = rng.random(10);
      state.offerPrice = maxOffer;
      opts.onRender();
    });
    const buyFullBtn = document.createElement("button");
    buyFullBtn.className = "uw2-btn uw2-btn-primary";
    buyFullBtn.style.marginLeft = "auto";
    buyFullBtn.textContent = `${opts.submitLabel}（${opts.listPrice.toLocaleString()} 金币）`;
    buyFullBtn.addEventListener("click", () => tryCommit(opts.listPrice));
    btnRow.append(hagBtn, buyFullBtn);
    priceWrap.append(topLine, btnRow);
    opts.box.appendChild(priceWrap);
    return;
  }

  const acc = b.roleMember(4);
  const accK = acc !== GameConst.EMPTY_SLOT && (m.person(acc).skills & SkillFlag.ACCOUNTING) ? 5 : state.haggleAccRand;
  const accHint = acc !== GameConst.EMPTY_SLOT ? (Math.trunc(Math.imul(accK + 95, floor) / 100) | 0) : -1;
  pInfo.textContent = accHint >= 0 ? `${capMsg(c, 0xc3)} ${capMsg(c, 0xc4, accHint)}` : capMsg(c, 0xc3);
  const offerReadout = document.createElement("span");
  offerReadout.style.color = "#7c5216";
  topLine.append(pInfo, offerReadout);

  const sl = document.createElement("input");
  sl.type = "range";
  sl.min = "0";
  sl.max = String(maxOffer);
  sl.value = String(state.offerPrice);
  sl.disabled = maxOffer <= 0;

  const btnRow = document.createElement("div");
  btnRow.className = "uw2-step-row";
  const decBtn = document.createElement("button");
  decBtn.className = "uw2-step-btn";
  decBtn.textContent = "-5%";
  const resetBtn = document.createElement("button");
  resetBtn.className = "uw2-step-btn";
  resetBtn.textContent = "原价";
  const goBtn = document.createElement("button");
  goBtn.className = "uw2-btn uw2-btn-primary";
  goBtn.style.marginLeft = "auto";

  const syncOffer = (val: number) => {
    state.offerPrice = Math.max(0, Math.min(maxOffer, Math.trunc(val) || 0));
    sl.value = String(state.offerPrice);
    offerReadout.textContent = `${state.offerPrice.toLocaleString()} 金币`;
    goBtn.textContent = `${opts.submitLabel}（${state.offerPrice.toLocaleString()} 金币）`;
    goBtn.disabled = avail < opts.listPrice && state.offerPrice <= 0;
  };
  syncOffer(state.offerPrice);
  sl.addEventListener("input", () => syncOffer(Number(sl.value)));
  decBtn.addEventListener("click", () => syncOffer(state.offerPrice - Math.max(100, Math.trunc(opts.listPrice * 0.05))));
  resetBtn.addEventListener("click", () => syncOffer(maxOffer));
  goBtn.addEventListener("click", () => tryCommit(state.offerPrice));

  btnRow.append(decBtn, resetBtn, goBtn);
  priceWrap.append(topLine, sl, btnRow);
  opts.box.appendChild(priceWrap);
}

/** 将待分配的补给或货物装入舰队各船只（供粮食掠夺、战利品分配及折抵余货共用） */
export async function runDomLeftoversModal(b: any, lg: number[], la: number[]): Promise<void> {
  const m = b.m, codec = b.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const supNames = ["水", "粮食", "资材", "炮弹"];
  const goodsNames: Uint8Array[] = b.LO?.goods ?? [];
  let selLeft = 0;

  const getLefts = () => {
    const out: { idx: number; code: number; name: string; amt: number }[] = [];
    for (let i = 0; i < lg.length; i++) {
      if (lg[i] === 0xff || la[i] <= 0) continue;
      const g = lg[i];
      const name = (g & 0x80) ? (supNames[g & 0x7f] || "补给") : (goodsNames[g] ? dec(goodsNames[g]) : `货物#${g}`);
      out.push({ idx: i, code: g, name, amt: la[i] });
    }
    return out;
  };
  const getShips = () => {
    const out: { slot: number; name: string; used: number; max: number; free: number }[] = [];
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      const S = heroShipSlot(m, i);
      if ((S.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      const ship = m.ship(S.ship);
      const max = ship.maxCargo, used = b.cargoUsed(i);
      out.push({ slot: i, name: dec(ship.nameBytes), used, max, free: Math.max(0, max - used) });
    }
    return out;
  };
  const putIntoShip = (leftItem: { idx: number; code: number; name: string; amt: number }, shipSlot: number): number => {
    const S = heroOrDockSlot(m, shipSlot), ship = m.ship(S.ship);
    const free = Math.max(0, ship.maxCargo - b.cargoUsed(shipSlot));
    if (free <= 0 || la[leftItem.idx] <= 0) return 0;
    const move = Math.min(la[leftItem.idx], free);
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
      if (j < 0) return 0;
      M.setCargoGoods(j, g);
      M.setCargoAmts(j, M.getCargoAmts(j) + move);
    }
    la[leftItem.idx] -= move;
    if (la[leftItem.idx] <= 0) lg[leftItem.idx] = 0xff;
    M.loadTotal = b.loadTotal(shipSlot);
    return move;
  };
  const autoFillAll = () => {
    let movedTotal = 0;
    for (const item of getLefts()) {
      for (const sh of getShips()) {
        if (la[item.idx] <= 0) break;
        movedTotal += putIntoShip(item, sh.slot);
      }
    }
    return movedTotal;
  };

  for (;;) {
    const exitReason = await new Promise<"done" | "cancel">(resolve => {
      let settled = false;
      const done = (r: "done" | "cancel") => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const h = createDomModal({
        title: "物资与货物分配",
        size: "wide",
        cancelable: true,
        closeLabel: "完成",
        onCancel: () => done("cancel"),
      });
      const render = () => {
        preserveScroll(h.body, () => {
          h.body.innerHTML = "";
          const lefts = getLefts();
          const ships = getShips();
          if (!lefts.length) { h.close(); done("done"); return; }
          if (selLeft >= lefts.length) selLeft = 0;

          const topBar = document.createElement("div");
          topBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;";
          const hint = document.createElement("div");
          hint.style.cssText = "font-size:13px;color:var(--uw2-muted,#5d4628);";
          const anyFree = ships.some(s => s.free > 0);
          hint.textContent = anyFree
            ? "选择左侧待分配物资，点击右侧船只装入，或点击「一键装入舰队」。"
            : "当前全舰队船舱已满（空余 0），无法继续装载，点击「完成」可放弃剩余物资。";
          const autoBtn = document.createElement("button");
          autoBtn.type = "button";
          autoBtn.className = "uw2-btn uw2-btn-primary";
          autoBtn.textContent = "一键装入舰队";
          autoBtn.disabled = !anyFree;
          autoBtn.addEventListener("click", () => {
            const moved = autoFillAll();
            if (moved > 0) b.c.shell?.showToast?.(`已自动装入 ${moved} 单位物资到舰队`);
            render();
          });
          topBar.append(hint, autoBtn);
          h.body.appendChild(topBar);

          const split = document.createElement("div");
          split.className = "uw2-split";

          const lCol = document.createElement("div");
          lCol.className = "uw2-pane";
          lCol.innerHTML = `<div class="uw2-pane-title">待分配物资</div>`;
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
            btn.addEventListener("click", () => {
              const moved = putIntoShip(lefts[selLeft], s.slot);
              if (moved > 0) b.c.shell?.showToast?.(`${s.name} 已装入 ${lefts[selLeft].name} ×${moved}`);
              render();
            });
            rList.appendChild(btn);
          });
          rCol.appendChild(rList);

          split.append(lCol, rCol);
          h.body.appendChild(split);
        }, true);
      };
      render();
    });

    if (exitReason === "done" || !getLefts().length) break;
    const discard = await runDomYesNo(
      "尚有未装船的物资，未装入部分将被放弃。\n确定放弃剩余物资并继续吗？",
      "放弃剩余",
      "返回分配",
    );
    if (discard) {
      b.c.shell?.showToast?.("已放弃剩余未装载物资");
      break;
    }
  }
}
