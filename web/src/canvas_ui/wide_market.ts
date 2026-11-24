// canvas_ui/wide_market.ts — 現代一體化 16:9 交易所工作台（買進 / 賣出 / 投資 / 物價 同屏操作）
// 零套娃彈窗、零 DOM、100% 原版文本與經濟公式（直接讀寫 Market 實例與 GameState）。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { GameConst, MenuId } from "../model/flags.ts";
import { domS16, domUmin16, calcBuyPriceShift, calcSellPriceShift, clampPriceIndexUp, clampPriceIndexDown } from "../domain/economy.ts";
import { decodeCleanCstr, UI_FONT, MONO_FONT } from "./text_util.ts";
import { hasDom } from "../modern/dom_ui.ts";
import { runDomMarketWorkbench } from "../modern/dom_workbenches.ts";

interface Rect { x: number; y: number; w: number; h: number; }
const hit = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBtn(ctx: CanvasRenderingContext2D, r: Rect, label: string, { primary = false, disabled = false, active = false, hover = false } = {}) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 7);
  if (disabled) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  } else if (primary) {
    ctx.fillStyle = hover ? "#f2d282" : "#e2bc6b";
    ctx.fill();
    ctx.strokeStyle = "#fff1c7";
  } else if (active) {
    ctx.fillStyle = "rgba(218, 178, 102, 0.34)";
    ctx.fill();
    ctx.strokeStyle = "#f0cf85";
  } else {
    ctx.fillStyle = hover ? "rgba(218, 178, 102, 0.22)" : "rgba(255, 255, 255, 0.07)";
    ctx.fill();
    ctx.strokeStyle = hover ? "rgba(240, 206, 132, 0.85)" : "rgba(214, 174, 96, 0.38)";
  }
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.font = `700 14px ${UI_FONT}`;
  ctx.fillStyle = disabled ? "rgba(180,174,158,0.38)" : primary ? "#1b1206" : "#fff4d6";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 10);
}

export async function runWideMarketWorkbench(market: any): Promise<void> {
  if (hasDom()) return runDomMarketWorkbench(market);
  const c = market.c;
  const { scr, sys, menu, codec } = c;
  const b = market.b;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);

  const tabLabels = c.menuItems(MenuId.MARKET).slice(0, 4).map(dec);
  const bldLabels = c.menuItems(0x3a);
  const marketTitle = bldLabels?.[0] ? dec(bldLabels[0]) : "";
  const portName = dec(market.port.nameBytes);
  const buyHdr = dec(market.T.buyHdr);
  const sellHdr = dec(market.T.sellHdr);

  const W = 1080, H = 590;
  const X = Math.round((VIEW_W - W) / 2), Y = Math.round((VIEW_H - H) / 2);
  const closeBtn: Rect = { x: X + W - 46, y: Y + 12, w: 32, h: 32 };

  let activeTab = 0; // 0=買進 1=賣出 2=投資 3=物價
  let selGoodIdx = 0;
  let selShipIdx = 0;
  let selCargoIdx = 0;
  let selPriceCat = 0;
  let qty = 0;
  let investAmt = 1000;
  let toastText = "";
  let toastUntil = 0;

  const showToast = (msg: string) => {
    toastText = msg;
    toastUntil = (typeof performance !== "undefined" ? performance.now() : 0) + 2600;
    scr.dirty = true;
  };

  // 即時讀取可買商品清單
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

  // 即時讀取艦隊船隻列表
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

  const computeBuyMax = (good: { code: number; price: number } | undefined, ship: { slot: number; free: number } | undefined) => {
    if (!good || !ship || good.price <= 0) return 0;
    const cs = market.m.crewSlot(ship.slot);
    let hasSlot = false;
    for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
      const cg = cs.getCargoGoods(j);
      if (cg === GameConst.EMPTY_SLOT || cg === good.code) { hasSlot = true; break; }
    }
    if (!hasSlot) return 0;
    const byMoney = Math.floor((market.money >>> 0) / good.price);
    return Math.max(0, Math.min(ship.free, byMoney));
  };

  const executeBuy = (good: { code: number; name: string; price: number }, ship: { slot: number; name: string }, amount: number) => {
    if (amount <= 0) return;
    const E = market.eco;
    const cs = market.m.crewSlot(ship.slot);
    let j = 0;
    while (j < GameConst.CARGO_SLOTS && cs.getCargoGoods(j) !== GameConst.EMPTY_SLOT && cs.getCargoGoods(j) !== good.code) j++;
    if (j >= GameConst.CARGO_SLOTS) return;
    market.tradeLog(0x0c, good.code, good.price, amount);
    market.money = market.money - amount * good.price;
    cs.setCargoGoods(j, good.code);
    cs.setCargoAmts(j, cs.getCargoAmts(j) + amount);
    const cat = market.cat(good.code);
    const { catDelta: d, allDelta: t } = calcBuyPriceShift(amount * good.price, E.commerce);
    E.setPrices(cat, clampPriceIndexUp(E.getPrices(cat), d));
    for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexUp(E.getPrices(i), t));
    b.loadTotal(ship.slot);
    b.p.panels();
    showToast(`${good.name} ×${amount} → ${ship.name}`);
  };

  const executeSell = (ship: { slot: number; name: string }, cargo: { j: number; g: number; name: string; amt: number; sellPrice: number }, amount: number) => {
    if (amount <= 0 || amount > cargo.amt) return;
    const E = market.eco;
    const cs = market.m.crewSlot(ship.slot);
    market.money = market.money + amount * cargo.sellPrice;
    cs.setCargoAmts(cargo.j, cs.getCargoAmts(cargo.j) - amount);
    const cat = market.cat(cargo.g);
    const { catDelta: d, allDelta: t } = calcSellPriceShift(amount * cargo.sellPrice, E.commerce);
    E.setPrices(cat, clampPriceIndexDown(E.getPrices(cat), d));
    for (let i = 0; i < 10; i++) E.setPrices(i, clampPriceIndexDown(E.getPrices(i), t));
    if (cs.getCargoAmts(cargo.j) === 0) cs.setCargoGoods(cargo.j, GameConst.EMPTY_SLOT);
    b.loadTotal(ship.slot);
    b.p.panels();
    showToast(`${cargo.name} ×${amount}  +${amount * cargo.sellPrice}`);
  };

  const executeInvest = (v: number) => {
    const E = market.eco;
    if (b.isCapital()) { showToast(b.captureMessage(2)); return; }
    if (E.commerceInvest >= GameConst.MAX_INVEST) { showToast(b.captureMessage(7)); return; }
    const di = market.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : market.money & 0xffff;
    const maxV = domUmin16(di, GameConst.MAX_INVEST - E.commerceInvest);
    const amt = Math.min(v, maxV);
    if (amt <= 0) { showToast(b.captureMessage(0x0d)); return; }
    E.commerceInvest += amt;
    market.money = market.money - amt;
    b.investSupport(amt, E.commerce);
    b.investOwner();
    b.p.panels();
    showToast(b.captureMessage(amt < 500 ? 0x0e : amt < 10000 ? 0x0f : 0x10));
  };

  // 互動按鈕註冊表（每次繪製更新，保證點擊座標 1:1 精準對齊）
  let clickTargets: { rect: Rect; onClick: () => void }[] = [];

  const drawFn = (ctx: CanvasRenderingContext2D) => {
    clickTargets = [];
    const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
    const goods = getBuyGoods();
    const ships = getShips();
    if (selGoodIdx >= goods.length) selGoodIdx = Math.max(0, goods.length - 1);
    if (selShipIdx >= ships.length) selShipIdx = Math.max(0, ships.length - 1);

    ctx.save();
    // 背景半透明暗幕
    ctx.fillStyle = "rgba(4, 10, 20, 0.62)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 主工作台外框
    ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, X, Y, W, H, 14);
    const bg = ctx.createLinearGradient(X, Y, X, Y + H);
    bg.addColorStop(0, "rgba(17, 33, 56, 0.98)");
    bg.addColorStop(1, "rgba(9, 19, 34, 0.99)");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 頂欄：港名 · 交易所 + 金塊/金幣 + 關閉鈕
    ctx.font = `700 19px ${UI_FONT}`;
    ctx.fillStyle = "#f7dfa4";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${portName} · ${marketTitle}`, X + 24, Y + 28);

    const money = market.money;
    const moneyText = `金塊 ${Math.trunc(money / 10000)}   金幣 ${money % 10000}`;
    ctx.font = `700 14px ${MONO_FONT}`;
    const mw = ctx.measureText(moneyText).width + 28;
    roundRect(ctx, X + W - mw - 64, Y + 14, mw, 28, 14);
    ctx.fillStyle = "rgba(8, 16, 30, 0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(218, 178, 102, 0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#f4d78e";
    ctx.textAlign = "center";
    ctx.fillText(moneyText, X + W - mw / 2 - 64, Y + 28);

    drawBtn(ctx, closeBtn, "×", { hover: hit(closeBtn, vx, vy) });
    clickTargets.push({ rect: closeBtn, onClick: () => { shouldClose = true; } });

    // 分頁標籤列 (買進 / 賣出 / 投資 / 物價)
    const tabY = Y + 56, tabH = 38, tabW = 140;
    for (let i = 0; i < tabLabels.length; i++) {
      const tr: Rect = { x: X + 24 + i * (tabW + 10), y: tabY, w: tabW, h: tabH };
      const isAct = i === activeTab;
      const dis = (i === 0 || i === 1) && ships.length === 0;
      drawBtn(ctx, tr, tabLabels[i], { active: isAct, disabled: dis, hover: hit(tr, vx, vy) });
      if (!dis) {
        clickTargets.push({
          rect: tr,
          onClick: () => { activeTab = i; qty = 0; selCargoIdx = 0; scr.dirty = true; },
        });
      }
    }

    ctx.strokeStyle = "rgba(218, 178, 102, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X + 20, Y + 104);
    ctx.lineTo(X + W - 20, Y + 104);
    ctx.stroke();

    const bodyY = Y + 116;
    const bodyH = H - 166;

    // =================== TAB 0: 買進 ===================
    if (activeTab === 0) {
      const leftX = X + 24, leftW = 470;
      const rightX = X + 514, rightW = W - 538;

      ctx.font = `700 14px ${UI_FONT}`;
      ctx.fillStyle = "#9ab2cc";
      ctx.textAlign = "left";
      ctx.fillText(buyHdr, leftX + 6, bodyY + 12);

      for (let i = 0; i < goods.length; i++) {
        const g = goods[i];
        const r: Rect = { x: leftX, y: bodyY + 28 + i * 38, w: leftW, h: 34 };
        if (r.y + r.h > bodyY + bodyH) break;
        const isSel = i === selGoodIdx;
        const isHov = hit(r, vx, vy);
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = isSel ? "rgba(218, 178, 102, 0.34)" : isHov ? "rgba(255, 255, 255, 0.09)" : "rgba(255, 255, 255, 0.04)";
        ctx.fill();
        if (isSel) { ctx.strokeStyle = "#f0cf85"; ctx.lineWidth = 1.2; ctx.stroke(); }

        ctx.font = `600 15px ${UI_FONT}`;
        ctx.fillStyle = g.isSpec ? "#ffe184" : "#f2ead8";
        ctx.textAlign = "left";
        ctx.fillText(g.name, r.x + 12, r.y + r.h / 2 + 0.5, 240);

        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`${g.price}  (${g.idx}%)`, r.x + r.w - 12, r.y + r.h / 2 + 0.5);

        clickTargets.push({ rect: r, onClick: () => { selGoodIdx = i; qty = 0; scr.dirty = true; } });
      }

      // 右側上方：艦隊各船艙位條
      const maxShipListH = 228;
      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        const r: Rect = { x: rightX, y: bodyY + 28 + i * 38, w: rightW, h: 34 };
        if (r.y + r.h > bodyY + 28 + maxShipListH) break;
        const isSel = i === selShipIdx;
        const isHov = hit(r, vx, vy);
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = isSel ? "rgba(218, 178, 102, 0.30)" : isHov ? "rgba(255, 255, 255, 0.09)" : "rgba(255, 255, 255, 0.04)";
        ctx.fill();
        if (isSel) { ctx.strokeStyle = "#f0cf85"; ctx.lineWidth = 1.2; ctx.stroke(); }

        ctx.font = `600 14px ${UI_FONT}`;
        ctx.fillStyle = "#fff4d6";
        ctx.textAlign = "left";
        ctx.fillText(s.name, r.x + 12, r.y + r.h / 2 + 0.5, 180);

        // 載重進度條
        const barX = r.x + 210, barW = 180, barY = r.y + 12, barH = 10;
        const ratio = s.max > 0 ? Math.min(1, s.used / s.max) : 1;
        roundRect(ctx, barX, barY, barW, barH, 5);
        ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
        ctx.fill();
        if (ratio > 0) {
          roundRect(ctx, barX, barY, Math.max(6, barW * ratio), barH, 5);
          ctx.fillStyle = ratio > 0.85 ? "#e06c6c" : "#62c48c";
          ctx.fill();
        }

        ctx.font = `600 13px ${MONO_FONT}`;
        ctx.fillStyle = "#d8e4f2";
        ctx.textAlign = "right";
        ctx.fillText(`${s.used}/${s.max}`, r.x + r.w - 12, r.y + r.h / 2 + 0.5);

        clickTargets.push({ rect: r, onClick: () => { selShipIdx = i; qty = 0; scr.dirty = true; } });
      }

      // 右側下方：即時數量調節 + 確認買進操作區
      const dockY = bodyY + 272, dockH = 148;
      roundRect(ctx, rightX, dockY, rightW, dockH, 10);
      ctx.fillStyle = "rgba(8, 16, 30, 0.78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const selGood = goods[selGoodIdx];
      const selShip = ships[selShipIdx];
      const maxQty = computeBuyMax(selGood, selShip);
      if (qty > maxQty) qty = maxQty;
      if (qty === 0 && maxQty > 0) qty = Math.min(10, maxQty);

      ctx.font = `700 15px ${UI_FONT}`;
      ctx.fillStyle = "#f7dfa4";
      ctx.textAlign = "left";
      ctx.fillText(selGood && selShip ? `${selGood.name}  →  ${selShip.name}` : "", rightX + 16, dockY + 24);

      ctx.font = `700 15px ${MONO_FONT}`;
      ctx.fillStyle = "#ffe184";
      ctx.textAlign = "right";
      ctx.fillText(`${qty} / ${maxQty}   (${selGood ? qty * selGood.price : 0})`, rightX + rightW - 16, dockY + 24);

      const stepBtns: [string, () => void][] = [
        ["-10", () => { qty = Math.max(0, qty - 10); scr.dirty = true; }],
        ["-1", () => { qty = Math.max(0, qty - 1); scr.dirty = true; }],
        ["+1", () => { qty = Math.min(maxQty, qty + 1); scr.dirty = true; }],
        ["+10", () => { qty = Math.min(maxQty, qty + 10); scr.dirty = true; }],
        ["MAX", () => { qty = maxQty; scr.dirty = true; }],
      ];
      for (let i = 0; i < stepBtns.length; i++) {
        const br: Rect = { x: rightX + 16 + i * 68, y: dockY + 48, w: 60, h: 34 };
        drawBtn(ctx, br, stepBtns[i][0], { disabled: maxQty === 0, hover: hit(br, vx, vy) });
        if (maxQty > 0) clickTargets.push({ rect: br, onClick: stepBtns[i][1] });
      }

      const buyBtn: Rect = { x: rightX + rightW - 166, y: dockY + 96, w: 150, h: 38 };
      drawBtn(ctx, buyBtn, tabLabels[0], { primary: true, disabled: qty <= 0 || !selGood || !selShip, hover: hit(buyBtn, vx, vy) });
      if (qty > 0 && selGood && selShip) {
        clickTargets.push({ rect: buyBtn, onClick: () => { executeBuy(selGood, selShip, qty); qty = 0; scr.dirty = true; } });
      }
    }

    // =================== TAB 1: 賣出 ===================
    else if (activeTab === 1) {
      const leftX = X + 24, leftW = 380;
      const rightX = X + 424, rightW = W - 448;

      for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        const r: Rect = { x: leftX, y: bodyY + 14 + i * 40, w: leftW, h: 36 };
        const isSel = i === selShipIdx;
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = isSel ? "rgba(218, 178, 102, 0.34)" : hit(r, vx, vy) ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
        ctx.fill();
        if (isSel) { ctx.strokeStyle = "#f0cf85"; ctx.lineWidth = 1.2; ctx.stroke(); }

        ctx.font = `600 15px ${UI_FONT}`;
        ctx.fillStyle = s.cargoSlots.length ? "#fff4d6" : "rgba(180,174,158,0.45)";
        ctx.textAlign = "left";
        ctx.fillText(s.name, r.x + 12, r.y + r.h / 2 + 0.5, 220);

        ctx.font = `600 13px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`${s.cargoSlots.length}`, r.x + r.w - 14, r.y + r.h / 2 + 0.5);

        clickTargets.push({ rect: r, onClick: () => { selShipIdx = i; selCargoIdx = 0; qty = 0; scr.dirty = true; } });
      }

      const selShip = ships[selShipIdx];
      const cargos = selShip?.cargoSlots ?? [];
      if (selCargoIdx >= cargos.length) selCargoIdx = Math.max(0, cargos.length - 1);

      ctx.font = `700 14px ${UI_FONT}`;
      ctx.fillStyle = "#9ab2cc";
      ctx.textAlign = "left";
      ctx.fillText(sellHdr, rightX + 6, bodyY + 12);

      for (let i = 0; i < cargos.length; i++) {
        const cg = cargos[i];
        const r: Rect = { x: rightX, y: bodyY + 28 + i * 42, w: rightW, h: 38 };
        const isSel = i === selCargoIdx;
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = isSel ? "rgba(218, 178, 102, 0.34)" : hit(r, vx, vy) ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
        ctx.fill();
        if (isSel) { ctx.strokeStyle = "#f0cf85"; ctx.lineWidth = 1.2; ctx.stroke(); }

        ctx.font = `600 15px ${UI_FONT}`;
        ctx.fillStyle = "#fff4d6";
        ctx.textAlign = "left";
        ctx.fillText(`${cg.name}   ×${cg.amt}`, r.x + 14, r.y + r.h / 2 + 0.5);

        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = "#8de8a8";
        ctx.textAlign = "right";
        ctx.fillText(`${cg.sellPrice}`, r.x + r.w - 14, r.y + r.h / 2 + 0.5);

        clickTargets.push({ rect: r, onClick: () => { selCargoIdx = i; qty = cg.amt; scr.dirty = true; } });
      }

      const selCargo = cargos[selCargoIdx];
      const maxSell = selCargo?.amt ?? 0;
      if (qty > maxSell) qty = maxSell;
      if (qty === 0 && maxSell > 0) qty = maxSell;

      const dockY = bodyY + 272, dockH = 148;
      roundRect(ctx, rightX, dockY, rightW, dockH, 10);
      ctx.fillStyle = "rgba(8, 16, 30, 0.78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.42)";
      ctx.stroke();

      ctx.font = `700 15px ${UI_FONT}`;
      ctx.fillStyle = "#f7dfa4";
      ctx.textAlign = "left";
      ctx.fillText(selCargo ? `${selCargo.name}` : "", rightX + 16, dockY + 24);

      ctx.font = `700 15px ${MONO_FONT}`;
      ctx.fillStyle = "#8de8a8";
      ctx.textAlign = "right";
      ctx.fillText(`${qty} / ${maxSell}   (+${selCargo ? qty * selCargo.sellPrice : 0})`, rightX + rightW - 16, dockY + 24);

      const stepBtns: [string, () => void][] = [
        ["-10", () => { qty = Math.max(0, qty - 10); scr.dirty = true; }],
        ["-1", () => { qty = Math.max(0, qty - 1); scr.dirty = true; }],
        ["+1", () => { qty = Math.min(maxSell, qty + 1); scr.dirty = true; }],
        ["+10", () => { qty = Math.min(maxSell, qty + 10); scr.dirty = true; }],
        ["MAX", () => { qty = maxSell; scr.dirty = true; }],
      ];
      for (let i = 0; i < stepBtns.length; i++) {
        const br: Rect = { x: rightX + 16 + i * 68, y: dockY + 48, w: 60, h: 34 };
        drawBtn(ctx, br, stepBtns[i][0], { disabled: maxSell === 0, hover: hit(br, vx, vy) });
        if (maxSell > 0) clickTargets.push({ rect: br, onClick: stepBtns[i][1] });
      }

      const sellBtn: Rect = { x: rightX + rightW - 166, y: dockY + 96, w: 150, h: 38 };
      drawBtn(ctx, sellBtn, tabLabels[1], { primary: true, disabled: qty <= 0 || !selCargo || !selShip, hover: hit(sellBtn, vx, vy) });
      if (qty > 0 && selCargo && selShip) {
        clickTargets.push({ rect: sellBtn, onClick: () => { executeSell(selShip, selCargo, qty); qty = 0; scr.dirty = true; } });
      }
    }

    // =================== TAB 2: 投資 ===================
    else if (activeTab === 2) {
      const E = market.eco;
      const di = market.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : market.money & 0xffff;
      const maxInv = b.isCapital() ? 0 : domUmin16(di, Math.max(0, GameConst.MAX_INVEST - E.commerceInvest));
      if (investAmt > maxInv) investAmt = maxInv;

      const cx = X + 220, cw = W - 440, cy = bodyY + 40, ch = 300;
      roundRect(ctx, cx, cy, cw, ch, 12);
      ctx.fillStyle = "rgba(8, 16, 30, 0.78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.45)";
      ctx.stroke();

      ctx.font = `700 18px ${UI_FONT}`;
      ctx.fillStyle = "#f7dfa4";
      ctx.textAlign = "left";
      ctx.fillText(tabLabels[2], cx + 28, cy + 36);

      ctx.font = `600 15px ${MONO_FONT}`;
      ctx.fillStyle = "#d8e4f2";
      ctx.fillText(`${domS16(E.commerce)}   (${E.commerceInvest} / ${GameConst.MAX_INVEST})`, cx + 28, cy + 78);

      ctx.font = `700 28px ${MONO_FONT}`;
      ctx.fillStyle = "#ffe184";
      ctx.textAlign = "center";
      ctx.fillText(String(investAmt), cx + cw / 2, cy + 136);

      const deltas: [string, () => void][] = [
        ["-5000", () => { investAmt = Math.max(0, investAmt - 5000); scr.dirty = true; }],
        ["-1000", () => { investAmt = Math.max(0, investAmt - 1000); scr.dirty = true; }],
        ["+1000", () => { investAmt = Math.min(maxInv, investAmt + 1000); scr.dirty = true; }],
        ["+5000", () => { investAmt = Math.min(maxInv, investAmt + 5000); scr.dirty = true; }],
        ["MAX", () => { investAmt = maxInv; scr.dirty = true; }],
      ];
      for (let i = 0; i < deltas.length; i++) {
        const br: Rect = { x: cx + 36 + i * 116, y: cy + 178, w: 104, h: 36 };
        drawBtn(ctx, br, deltas[i][0], { disabled: maxInv <= 0, hover: hit(br, vx, vy) });
        if (maxInv > 0) clickTargets.push({ rect: br, onClick: deltas[i][1] });
      }

      const invBtn: Rect = { x: cx + Math.round((cw - 180) / 2), y: cy + 236, w: 180, h: 42 };
      drawBtn(ctx, invBtn, tabLabels[2], { primary: true, disabled: maxInv <= 0 || investAmt <= 0, hover: hit(invBtn, vx, vy) });
      if (maxInv > 0 && investAmt > 0) {
        clickTargets.push({ rect: invBtn, onClick: () => { executeInvest(investAmt); scr.dirty = true; } });
      }
    }

    // =================== TAB 3: 物價 ===================
    else if (activeTab === 3) {
      const E = market.eco, T = market.T;
      const leftX = X + 24, leftW = 280;
      const rightX = X + 324, rightW = W - 348;

      for (let cIdx = 0; cIdx < 10; cIdx++) {
        const r: Rect = { x: leftX, y: bodyY + 8 + cIdx * 40, w: leftW, h: 36 };
        const isSel = cIdx === selPriceCat;
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = isSel ? "rgba(218, 178, 102, 0.34)" : hit(r, vx, vy) ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
        ctx.fill();
        if (isSel) { ctx.strokeStyle = "#f0cf85"; ctx.lineWidth = 1.2; ctx.stroke(); }

        ctx.font = `600 14px ${UI_FONT}`;
        ctx.fillStyle = "#fff4d6";
        ctx.textAlign = "left";
        ctx.fillText(dec(T.cats[cIdx]), r.x + 12, r.y + r.h / 2 + 0.5);

        ctx.font = `700 13px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`${E.getPrices(cIdx) + 50}%`, r.x + r.w - 12, r.y + r.h / 2 + 0.5);

        clickTargets.push({ rect: r, onClick: () => { selPriceCat = cIdx; scr.dirty = true; } });
      }

      const di = selPriceCat ? T.catEnd[selPriceCat - 1] : 0;
      const cnt = T.catEnd[selPriceCat] - di;
      const colW = Math.floor((rightW - 14) / 2);
      for (let si = 0; si < cnt; si++) {
        const g = (di + si) & 0xff;
        const col = si % 2, row = Math.floor(si / 2);
        const r: Rect = { x: rightX + col * (colW + 14), y: bodyY + 10 + row * 44, w: colW, h: 38 };
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
        ctx.fill();

        const rb = market.regionBuy(g);
        const buyStr = rb ? String(rb) : g === E.specialtyGood ? String(market.price(g)) : dec(T.none);
        ctx.font = `600 15px ${UI_FONT}`;
        ctx.fillStyle = "#f2ead8";
        ctx.textAlign = "left";
        ctx.fillText(dec(market.goodsName(g)), r.x + 12, r.y + r.h / 2 + 0.5, 170);

        ctx.font = `600 14px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`${buyStr} / ${market.sellPrice(g)}`, r.x + r.w - 12, r.y + r.h / 2 + 0.5);
      }
    }

    // 底部操作回饋條
    if (toastText && (typeof performance === "undefined" || performance.now() < toastUntil)) {
      ctx.font = `600 14px ${UI_FONT}`;
      ctx.fillStyle = "#8de8a8";
      ctx.textAlign = "left";
      ctx.fillText(toastText, X + 26, Y + H - 22);
    }

    ctx.restore();
  };

  let shouldClose = false;
  await menu.waitRelease();
  scr.wideDialog = null;
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  try {
    while (!shouldClose) {
      const ev = menu.readEvent();
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      if (ev === 0x1b || ev === 0x30) break;
      if (ev === 0x0d && menu.mouseFlag) {
        if (vx < X || vx > X + W || vy < Y || vy > Y + H) break;
        for (const t of clickTargets) {
          if (hit(t.rect, vx, vy)) { t.onClick(); break; }
        }
        await menu.waitRelease();
      }
      await sys.poll();
    }
  } finally {
    const idx = scr.wideOverlays.indexOf(drawFn);
    if (idx >= 0) scr.wideOverlays.splice(idx, 1);
    scr.dirty = true;
    await menu.waitRelease();
  }
}
