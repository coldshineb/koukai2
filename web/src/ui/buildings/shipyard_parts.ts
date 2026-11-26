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

export interface CargoEditorOptions {
  b: any;
  lg: number[];
  la: number[];
  shipSlot: number;
  shipName: string;
  container: HTMLElement;
  poolPrefix?: string;
  poolEmptyText?: string;
  autoBtnLabel?: string;
  onAutoFillDone?: (moved: number, remainingCount: number) => boolean | void;
  onMutate?: () => void;
}

/** 共用舰船货舱/补给双向调配编辑器（遵循原版 0fea:fe57 规则，供掠夺余货与「经营→积载分配」共用） */
export function mountCargoShipEditor(opts: CargoEditorOptions): { syncInPlace: () => void } {
  const { b, lg, la, shipSlot, shipName, container } = opts;
  const m = b.m, codec = b.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const supNames = ["水", "粮食", "资材", "炮弹"];
  const goodsNames: Uint8Array[] = b.LO?.goods ?? [];

  const itemName = (code: number): string =>
    (code & 0x80) ? (supNames[code & 0x7f] || "补给") : (goodsNames[code] ? dec(goodsNames[code]) : `货物#${code}`);

  const getLefts = () => {
    const out: { idx: number; code: number; name: string; amt: number }[] = [];
    for (let i = 0; i < lg.length; i++) {
      if (lg[i] === 0xff || la[i] <= 0) continue;
      out.push({ idx: i, code: lg[i], name: itemName(lg[i]), amt: la[i] });
    }
    return out;
  };

  const poolAmt = (code: number): number => {
    let sum = 0;
    for (let i = 0; i < lg.length; i++) if (lg[i] === code && la[i] > 0) sum += la[i];
    return sum;
  };

  const findPoolWriteSlot = (code: number): number => {
    for (let i = 0; i < lg.length; i++) if (lg[i] === code) return i;
    for (let i = 0; i < lg.length; i++) if (lg[i] === 0xff || la[i] <= 0) return i;
    return -1;
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

  const getShipItemQty = (slot: number, code: number): number => {
    const M = m.crewSlot(slot);
    if (code === 0x80) return Math.trunc(((M.water << 16) >> 16) / 10);
    if (code === 0x81) return Math.trunc(((M.food << 16) >> 16) / 10);
    if (code === 0x82) return (M.material << 16) >> 16;
    if (code === 0x83) return (M.ammo << 16) >> 16;
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
      if (M.getCargoGoods(k) === code) return M.getCargoAmts(k);
    }
    return 0;
  };

  const setShipItemQty = (slot: number, code: number, targetRaw: number): boolean => {
    const S = heroOrDockSlot(m, slot), ship = m.ship(S.ship), M = m.crewSlot(slot);
    const cur = getShipItemQty(slot, code);
    const free = Math.max(0, ship.maxCargo - b.cargoUsed(slot));
    const inPool = poolAmt(code);
    const canUnload = findPoolWriteSlot(code) >= 0;

    let cargoKindsUsed = 0, existingCargoSlot = -1, emptyCargoSlot = -1;
    if (!(code & 0x80)) {
      for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
        const cg = M.getCargoGoods(k);
        if (cg === code) existingCargoSlot = k;
        if (cg !== GameConst.EMPTY_SLOT) cargoKindsUsed++;
        else if (emptyCargoSlot < 0) emptyCargoSlot = k;
      }
    }

    const minVal = canUnload ? 0 : cur;
    const blockedNewKind = !(code & 0x80) && existingCargoSlot < 0 && (emptyCargoSlot < 0 || cargoKindsUsed >= GameConst.CARGO_SLOTS);
    const maxVal = blockedNewKind ? cur : Math.min(cur + free, cur + inPool);
    const target = Math.max(minVal, Math.min(maxVal, Math.trunc(targetRaw) || 0));
    const delta = target - cur;
    if (delta === 0) return false;

    if (delta > 0) {
      let rem = delta;
      for (let i = 0; i < lg.length && rem > 0; i++) {
        if (lg[i] !== code || la[i] <= 0) continue;
        const take = Math.min(rem, la[i]);
        la[i] -= take;
        rem -= take;
        if (la[i] <= 0) { la[i] = 0; lg[i] = 0xff; }
      }
      if (rem === delta) return false;
    } else {
      const back = -delta;
      const ws = findPoolWriteSlot(code);
      if (ws < 0) return false;
      lg[ws] = code;
      la[ws] = (la[ws] || 0) + back;
    }

    if (code === 0x80) M.water = target === 0 ? 0 : Math.max(0, M.water + delta * 10);
    else if (code === 0x81) M.food = target === 0 ? 0 : Math.max(0, M.food + delta * 10);
    else if (code === 0x82) M.material = Math.max(0, M.material + delta);
    else if (code === 0x83) M.ammo = Math.max(0, M.ammo + delta);
    else if (existingCargoSlot >= 0) {
      if (target <= 0) {
        M.setCargoGoods(existingCargoSlot, GameConst.EMPTY_SLOT);
        M.setCargoAmts(existingCargoSlot, 0);
      } else {
        M.setCargoAmts(existingCargoSlot, target);
      }
    } else if (emptyCargoSlot >= 0 && target > 0) {
      M.setCargoGoods(emptyCargoSlot, code);
      M.setCargoAmts(emptyCargoSlot, target);
    }

    M.loadTotal = b.loadTotal(slot);
    b.p?.seaPanel?.();
    b.p?.panels?.();
    return true;
  };

  const autoFillAll = (): number => {
    let movedTotal = 0;
    for (const item of getLefts()) {
      for (const sh of getShips()) {
        const rem = poolAmt(item.code);
        if (rem <= 0) break;
        const cur = getShipItemQty(sh.slot, item.code);
        const free = Math.max(0, sh.max - b.cargoUsed(sh.slot));
        const next = cur + Math.min(rem, free);
        if (next > cur && setShipItemQty(sh.slot, item.code, next)) movedTotal += next - cur;
      }
    }
    return movedTotal;
  };

  const codes: number[] = [0x80, 0x81, 0x82, 0x83];
  const curM = m.crewSlot(shipSlot);
  for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
    const g = curM.getCargoGoods(k);
    if (g !== GameConst.EMPTY_SLOT && curM.getCargoAmts(k) > 0 && !codes.includes(g)) codes.push(g);
  }
  for (const it of getLefts()) {
    if (!codes.includes(it.code)) codes.push(it.code);
  }

  const topBar = document.createElement("div");
  topBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:rgba(255,253,246,0.75);border:1px solid rgba(154,119,56,0.28);";
  const poolWrap = document.createElement("div");
  poolWrap.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;";
  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "uw2-btn uw2-btn-primary";
  autoBtn.textContent = opts.autoBtnLabel ?? "一键装入舰队";
  topBar.append(poolWrap, autoBtn);

  const rTitle = document.createElement("div");
  rTitle.className = "uw2-pane-title";

  const rList = document.createElement("div");
  rList.className = "uw2-list-col";

  interface RowSync {
    code: number;
    metaEl: HTMLElement;
    poolTagEl: HTMLElement;
    slider: HTMLInputElement;
    numInp: HTMLInputElement;
    valReadout: HTMLElement;
    dec10: HTMLButtonElement;
    dec1: HTMLButtonElement;
    inc1: HTMLButtonElement;
    inc10: HTMLButtonElement;
    maxBtn: HTMLButtonElement;
  }
  const rowSyncs: RowSync[] = [];

  const syncInPlace = () => {
    const lefts = getLefts();
    const liveShips = getShips();
    const anyFree = liveShips.some(s => s.free > 0);
    autoBtn.disabled = !lefts.length || !anyFree;

    poolWrap.innerHTML = "";
    const lbl = document.createElement("span");
    lbl.style.cssText = "font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
    lbl.textContent = opts.poolPrefix ?? "待分配物资：";
    poolWrap.appendChild(lbl);
    if (!lefts.length) {
      const okPill = document.createElement("span");
      okPill.style.cssText = "font-size:12px;font-weight:700;color:#226b3f;background:rgba(45,138,82,0.14);padding:2px 8px;border-radius:999px;";
      okPill.textContent = opts.poolEmptyText ?? "暂存区为空（减下本船物资可移入此处，切换其他船只即可装入）";
      poolWrap.appendChild(okPill);
    } else {
      for (const it of lefts) {
        const pill = document.createElement("span");
        pill.style.cssText = "font-size:12px;font-weight:700;color:#6e4308;background:rgba(200,162,88,0.28);border:1px solid rgba(154,119,56,0.45);padding:2px 8px;border-radius:999px;";
        pill.textContent = `${it.name} ${it.amt}`;
        poolWrap.appendChild(pill);
      }
    }

    const S = heroOrDockSlot(m, shipSlot);
    const shipObj = m.ship(S.ship);
    const M = m.crewSlot(shipSlot);
    const shipMax = shipObj.maxCargo;
    const shipUsed = b.cargoUsed(shipSlot);
    const shipFree = Math.max(0, shipMax - shipUsed);
    rTitle.textContent = `调配「${shipName}」船舱（空余 ${shipFree} · 已用 ${shipUsed}/${shipMax}，可加装或减回暂存区）`;

    let cargoKinds = 0;
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
      if (M.getCargoGoods(k) !== GameConst.EMPTY_SLOT && M.getCargoAmts(k) > 0) cargoKinds++;
    }

    for (const rs of rowSyncs) {
      const cur = getShipItemQty(shipSlot, rs.code);
      const inPool = poolAmt(rs.code);
      const canUnload = findPoolWriteSlot(rs.code) >= 0;
      const isNewCargoBlocked = !(rs.code & 0x80) && cur === 0 && cargoKinds >= GameConst.CARGO_SLOTS;
      const minVal = canUnload ? 0 : cur;
      const maxVal = isNewCargoBlocked ? cur : Math.min(cur + shipFree, cur + inPool);

      rs.slider.min = String(minVal);
      rs.slider.max = String(maxVal);
      rs.slider.value = String(cur);
      rs.slider.disabled = minVal >= maxVal;

      rs.numInp.min = String(minVal);
      rs.numInp.max = String(maxVal);
      if (document.activeElement !== rs.numInp) rs.numInp.value = String(cur);
      rs.numInp.disabled = minVal >= maxVal;

      rs.valReadout.textContent = `${cur}`;
      rs.metaEl.textContent = isNewCargoBlocked ? "货舱种类已满(5/5)" : `上限 ${maxVal}`;
      rs.poolTagEl.textContent = inPool > 0 ? `暂存 +${inPool}` : "";
      rs.poolTagEl.style.display = inPool > 0 ? "inline-block" : "none";

      rs.dec10.disabled = cur <= minVal;
      rs.dec1.disabled = cur <= minVal;
      rs.inc1.disabled = cur >= maxVal;
      rs.inc10.disabled = cur >= maxVal;
      rs.maxBtn.disabled = cur >= maxVal;
    }

    opts.onMutate?.();
  };

  for (const code of codes) {
    const box = document.createElement("div");
    box.className = "uw2-action-box";
    box.style.cssText = "padding:8px 10px;gap:6px;";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    const leftGrp = document.createElement("div");
    leftGrp.style.cssText = "display:flex;align-items:center;gap:6px;";
    const nameEl = document.createElement("span");
    nameEl.style.cssText = "font-weight:700;font-size:14px;";
    nameEl.textContent = itemName(code);
    const kindTag = document.createElement("span");
    kindTag.style.cssText = "font-size:11px;color:var(--uw2-ink-muted);padding:1px 6px;border-radius:4px;background:rgba(61,40,23,0.08);";
    kindTag.textContent = (code & 0x80) ? "补给" : "货物";
    const poolTagEl = document.createElement("span");
    poolTagEl.style.cssText = "font-size:11px;font-weight:700;color:#6e4308;background:rgba(200,162,88,0.32);padding:1px 6px;border-radius:4px;";
    leftGrp.append(nameEl, kindTag, poolTagEl);

    const rightGrp = document.createElement("div");
    rightGrp.style.cssText = "display:flex;align-items:center;gap:8px;";
    const metaEl = document.createElement("span");
    metaEl.style.cssText = "font-size:12px;color:var(--uw2-ink-muted);font-variant-numeric:tabular-nums;";
    const valReadout = document.createElement("strong");
    valReadout.style.cssText = "font-size:15px;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;";
    rightGrp.append(metaEl, valReadout);
    head.append(leftGrp, rightGrp);

    const ctrlRow = document.createElement("div");
    ctrlRow.className = "uw2-step-row";

    const dec10 = document.createElement("button");
    dec10.type = "button"; dec10.className = "uw2-step-btn"; dec10.textContent = "-10";
    const dec1 = document.createElement("button");
    dec1.type = "button"; dec1.className = "uw2-step-btn"; dec1.textContent = "-1";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.style.cssText = "flex:1;min-width:90px;accent-color:#9e6f1e;";
    const inc1 = document.createElement("button");
    inc1.type = "button"; inc1.className = "uw2-step-btn"; inc1.textContent = "+1";
    const inc10 = document.createElement("button");
    inc10.type = "button"; inc10.className = "uw2-step-btn"; inc10.textContent = "+10";
    const numInp = document.createElement("input");
    numInp.type = "number";
    numInp.style.cssText = "width:56px;padding:3px 6px;border-radius:6px;border:1px solid rgba(61,40,23,0.28);background:#fffdf6;font-size:13px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;";
    const maxBtn = document.createElement("button");
    maxBtn.type = "button"; maxBtn.className = "uw2-step-btn"; maxBtn.textContent = "MAX";

    const applyTarget = (v: number) => {
      if (setShipItemQty(shipSlot, code, v)) syncInPlace();
    };
    dec10.addEventListener("click", () => applyTarget(getShipItemQty(shipSlot, code) - 10));
    dec1.addEventListener("click", () => applyTarget(getShipItemQty(shipSlot, code) - 1));
    inc1.addEventListener("click", () => applyTarget(getShipItemQty(shipSlot, code) + 1));
    inc10.addEventListener("click", () => applyTarget(getShipItemQty(shipSlot, code) + 10));
    maxBtn.addEventListener("click", () => applyTarget(Number(slider.max)));
    slider.addEventListener("input", () => applyTarget(Number(slider.value)));
    numInp.addEventListener("change", () => applyTarget(Number(numInp.value)));

    ctrlRow.append(dec10, dec1, slider, inc1, inc10, numInp, maxBtn);
    box.append(head, ctrlRow);
    rList.appendChild(box);
    rowSyncs.push({ code, metaEl, poolTagEl, slider, numInp, valReadout, dec10, dec1, inc1, inc10, maxBtn });
  }

  autoBtn.addEventListener("click", () => {
    const moved = autoFillAll();
    if (moved > 0) b.c.shell?.showToast?.(`已自动装入 ${moved} 单位物资到舰队`);
    const rem = getLefts().length;
    if (opts.onAutoFillDone?.(moved, rem)) return;
    syncInPlace();
  });

  container.append(topBar, rTitle, rList);
  syncInPlace();
  return { syncInPlace };
}

/** 将待分配的补给或货物按原版双向调配规则装入舰队各船只（供粮食掠夺、战利品分配及折抵余货共用） */
export async function runDomLeftoversModal(b: any, lg: number[], la: number[]): Promise<void> {
  const m = b.m, codec = b.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  let selShipIdx = 0;

  const hasLefts = () => lg.some((g, i) => g !== 0xff && la[i] > 0);
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
          const ships = getShips();
          if (!ships.length) { h.close(); done("done"); return; }
          if (selShipIdx >= ships.length) selShipIdx = 0;

          const split = document.createElement("div");
          split.className = "uw2-split narrow-left";

          const lCol = document.createElement("div");
          lCol.className = "uw2-pane";
          lCol.innerHTML = `<div class="uw2-pane-title">1. 选择舰队船只（可多船分装）</div>`;
          const lList = document.createElement("div");
          lList.className = "uw2-list-col";

          const shipCardRefs: { slot: number; usedSpan: HTMLElement; barFill: HTMLElement }[] = [];
          ships.forEach((s, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `uw2-row-card ${idx === selShipIdx ? "selected" : ""}`;
            btn.style.cssText = "flex-direction:column;align-items:stretch;gap:6px;";
            const row1 = document.createElement("div");
            row1.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:6px;";
            const nameEl = document.createElement("span");
            nameEl.style.fontWeight = "700";
            nameEl.textContent = s.name;
            const usedSpan = document.createElement("span");
            usedSpan.style.cssText = "font-size:12px;color:var(--uw2-ink-muted);font-variant-numeric:tabular-nums;";
            row1.append(nameEl, usedSpan);
            const track = document.createElement("div");
            track.className = "uw2-bar-track";
            const barFill = document.createElement("div");
            barFill.className = "uw2-bar-fill";
            track.appendChild(barFill);
            btn.append(row1, track);
            btn.addEventListener("click", () => { selShipIdx = idx; render(); });
            lList.appendChild(btn);
            shipCardRefs.push({ slot: s.slot, usedSpan, barFill });
          });
          lCol.appendChild(lList);

          const curShip = ships[selShipIdx];
          const rCol = document.createElement("div");
          rCol.className = "uw2-pane";
          mountCargoShipEditor({
            b, lg, la,
            shipSlot: curShip.slot,
            shipName: curShip.name,
            container: rCol,
            poolPrefix: "待分配物资：",
            poolEmptyText: "已全部装船（可继续跨船微调，点「完成」确认）",
            autoBtnLabel: "一键装入舰队",
            onAutoFillDone: (_moved, rem) => {
              if (rem === 0) { h.close(); done("done"); return true; }
              return false;
            },
            onMutate: () => {
              for (const sc of shipCardRefs) {
                const S = heroShipSlot(m, sc.slot);
                const max = m.ship(S.ship).maxCargo;
                const used = b.cargoUsed(sc.slot);
                const free = Math.max(0, max - used);
                const pct = max > 0 ? Math.min(100, Math.round((used * 100) / max)) : 100;
                sc.usedSpan.textContent = `空余 ${free} (${used}/${max})`;
                sc.barFill.style.width = `${pct}%`;
                sc.barFill.className = `uw2-bar-fill ${free <= 0 ? "red" : ""}`;
              }
            },
          });

          split.append(lCol, rCol);
          h.body.appendChild(split);
        }, true);
      };
      render();
    });

    if (exitReason === "done" || !hasLefts()) break;
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
