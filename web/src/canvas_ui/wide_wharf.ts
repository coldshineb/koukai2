// canvas_ui/wide_wharf.ts — 現代一體化 16:9 碼頭工作台（全艦隊行內水/糧/材/彈補給 + 實時航行天數 + 一鍵出航）
// 零套娃彈窗、零 DOM、100% 原版文本與出航/補給公式（直接讀寫 Buildings / GameState）。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { DS } from "../model/schema_views.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { marketTradeLog } from "../scenes/market.js";
import { decodeCleanCstr, UI_FONT, MONO_FONT } from "./text_util.ts";
import { hasDom } from "../modern/dom_ui.ts";
import { runDomWharfWorkbench } from "../modern/dom_workbenches.ts";

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

function drawBtn(ctx: CanvasRenderingContext2D, r: Rect, label: string, { primary = false, disabled = false, hover = false } = {}) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 6);
  if (disabled) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  } else if (primary) {
    ctx.fillStyle = hover ? "#f2d282" : "#e2bc6b";
    ctx.fill();
    ctx.strokeStyle = "#fff1c7";
  } else {
    ctx.fillStyle = hover ? "rgba(218, 178, 102, 0.25)" : "rgba(255, 255, 255, 0.08)";
    ctx.fill();
    ctx.strokeStyle = hover ? "rgba(240, 206, 132, 0.9)" : "rgba(214, 174, 96, 0.4)";
  }
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.font = `700 13px ${UI_FONT}`;
  ctx.fillStyle = disabled ? "rgba(180,174,158,0.35)" : primary ? "#1b1206" : "#fff4d6";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 4);
}

/** 回傳 1 = 已出航（結束碼頭），0 = 留在港口 */
export async function runWideWharfWorkbench(b: any): Promise<number> {
  if (hasDom()) return runDomWharfWorkbench(b);
  const c = b.c;
  const st = b.st;
  const { scr, sys, menu, codec } = c;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);

  const bldLabels = c.menuItems(0x3a);
  const wharfTitle = bldLabels?.[3] ? dec(bldLabels[3]) : "";
  const portName = dec(st.model.port(b.port).nameBytes);
  const wharfMenu = c.menuItems(9).map(dec); // [出航, 補給, 船塢]
  const supHdr = dec(b.WF.supplyHdr);
  const supNames = supHdr.split(/\s+/).filter(Boolean).slice(0, 4);

  const W = 1120, H = 590;
  const X = Math.round((VIEW_W - W) / 2), Y = Math.round((VIEW_H - H) / 2);
  const closeBtn: Rect = { x: X + W - 46, y: Y + 12, w: 32, h: 32 };

  let toastText = "";
  let toastIsErr = false;
  let toastUntil = 0;
  const showToast = (msg: string, isErr = false) => {
    toastText = msg;
    toastIsErr = isErr;
    toastUntil = (typeof performance !== "undefined" ? performance.now() : 0) + 3000;
    scr.dirty = true;
  };

  // 與 wharf.js load() 逐位元組一致的單價公式
  const unitPrice = (item: number) => {
    if (item === 0) return 0; // 水免費
    const [cx, off] = [[0x14, 0x10], [0x5a, 0x17], [0x78, 0x10]][item - 1];
    return Math.trunc(((st.u8(b.eco + off) + 0x32) * cx) / 100);
  };

  const adjustSupply = (slot: number, item: number, delta: number) => {
    const M = b.crewData(slot);
    const off = item * 2;
    const mul = item < 2 ? 10 : 1;
    const cur = item < 2 ? Math.trunc(domS16(st.u16(M + off)) / 10) : domS16(st.u16(M + off));

    if (delta > 0) {
      const maxCargo = domS16(st.u16(b.shipOf(slot) + 0x14));
      const free = Math.max(0, maxCargo - domS16(b.cargoUsed(slot)));
      const price = unitPrice(item);
      const byMoney = price > 0 ? Math.floor((b.money >>> 0) / price) : free;
      const actual = Math.min(delta, free, byMoney);
      if (actual <= 0) return;
      st.set16(M + off, st.u16(M + off) + actual * mul);
      if (price > 0) b.money = (b.money - Math.imul(actual, price)) | 0;
      b.loadTotal(slot);
      b.p.panels();
    } else if (delta < 0) {
      const actual = Math.min(-delta, cur);
      if (actual <= 0) return;
      st.set16(M + off, st.u16(M + off) - actual * mul);
      b.loadTotal(slot);
      b.p.panels();
    }
    scr.dirty = true;
  };

  const getFleetSummary = () => {
    const n = b.fleetShips();
    const ships: {
      slot: number; name: string; crew: number; drv: number; look: number; deck: number;
      used: number; max: number; vals: number[];
    }[] = [];
    let noDriver = false, crewT = 0, waterT = 0, foodT = 0;
    for (let i = 0; i < n; i++) {
      const slot = c.persons[i] & 0xff;
      const M = b.crewData(slot), S = b.fleetSlot(slot), ship = b.shipOf(slot);
      const crew = domS16(st.u16(S));
      const drv = Math.trunc(crew * st.u8(M + 9) / 100);
      const look = Math.trunc(crew * st.u8(M + 8) / 100);
      const deck = Math.max(0, crew - drv - look);
      if (!drv) noDriver = true;
      waterT = (waterT + st.u16(M)) & 0xffff;
      foodT = (foodT + st.u16(M + 2)) & 0xffff;
      crewT = (crewT + st.u16(S)) & 0xffff;
      ships.push({
        slot,
        name: dec(b.dstr(ship)),
        crew, drv, look, deck,
        used: domS16(b.cargoUsed(slot)),
        max: domS16(st.u16(ship + 0x14)),
        vals: [
          Math.trunc(domS16(st.u16(M)) / 10),
          Math.trunc(domS16(st.u16(M + 2)) / 10),
          domS16(st.u16(M + 4)),
          domS16(st.u16(M + 6)),
        ],
      });
    }
    const days = crewT > 0 ? Math.trunc(domUmin16(waterT, foodT) / crewT) : 0;
    return { ships, noDriver, days };
  };

  let shouldClose = false;
  let departed = 0;
  let openDockRequested = false;
  let clickTargets: { rect: Rect; onClick: () => void }[] = [];

  const drawFn = (ctx: CanvasRenderingContext2D) => {
    clickTargets = [];
    const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
    const { ships, noDriver, days } = getFleetSummary();

    ctx.save();
    ctx.fillStyle = "rgba(4, 10, 20, 0.62)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

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

    // 頂欄
    ctx.font = `700 19px ${UI_FONT}`;
    ctx.fillStyle = "#f7dfa4";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${portName} · ${wharfTitle}`, X + 24, Y + 28);

    // 實時航行天數與資金
    const daysTxt = `${days} DAYS`;
    const money = b.money;
    const moneyTxt = `金塊 ${Math.trunc(money / 10000)}   金幣 ${money % 10000}`;
    ctx.font = `700 14px ${MONO_FONT}`;
    ctx.fillStyle = days > 0 && !noDriver ? "#8de8a8" : "#ff8b8b";
    ctx.textAlign = "right";
    ctx.fillText(`${daysTxt}    |    ${moneyTxt}`, X + W - 66, Y + 28);

    drawBtn(ctx, closeBtn, "×", { hover: hit(closeBtn, vx, vy) });
    clickTargets.push({ rect: closeBtn, onClick: () => { shouldClose = true; } });

    // 表頭列（船名 / 載重 / 水 / 食物 / 資材 / 砲彈）
    const colShipX = X + 24;
    const colSupX = [X + 332, X + 524, X + 716, X + 908];
    const colSupW = 180;
    const hdrY = Y + 72;

    ctx.strokeStyle = "rgba(218, 178, 102, 0.28)";
    ctx.beginPath();
    ctx.moveTo(X + 20, Y + 54);
    ctx.lineTo(X + W - 20, Y + 54);
    ctx.stroke();

    ctx.font = `700 13px ${UI_FONT}`;
    ctx.fillStyle = "#9ab2cc";
    ctx.textAlign = "left";
    ctx.fillText(wharfMenu[1] || "", colShipX + 6, hdrY);

    for (let k = 0; k < 4; k++) {
      const p = unitPrice(k);
      const label = `${supNames[k] || ""}${p > 0 ? ` (${p})` : ""}`;
      ctx.textAlign = "center";
      ctx.fillText(label, colSupX[k] + colSupW / 2, hdrY);
    }

    // 各船行內補給控制
    const rowH = 42;
    const startY = Y + 92;
    for (let i = 0; i < Math.min(10, ships.length); i++) {
      const s = ships[i];
      const ry = startY + i * rowH;
      roundRect(ctx, X + 20, ry, W - 40, rowH - 4, 8);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255, 255, 255, 0.045)" : "rgba(255, 255, 255, 0.025)";
      ctx.fill();

      const cy = ry + (rowH - 4) / 2;
      ctx.font = `700 14px ${UI_FONT}`;
      ctx.fillStyle = "#fff4d6";
      ctx.textAlign = "left";
      ctx.fillText(s.name, colShipX + 8, cy - 6, 175);

      ctx.font = `600 11px ${MONO_FONT}`;
      ctx.fillStyle = s.drv > 0 ? "#9ab2cc" : "#ff8b8b";
      ctx.fillText(`${s.drv}/${s.look}/${s.deck}  ${s.used}/${s.max}`, colShipX + 8, cy + 10, 290);

      for (let k = 0; k < 4; k++) {
        const bx = colSupX[k];
        const bM10: Rect = { x: bx, y: ry + 6, w: 32, h: 26 };
        const bM1: Rect = { x: bx + 35, y: ry + 6, w: 26, h: 26 };
        const bP1: Rect = { x: bx + 116, y: ry + 6, w: 26, h: 26 };
        const bP10: Rect = { x: bx + 145, y: ry + 6, w: 32, h: 26 };

        drawBtn(ctx, bM10, "-10", { disabled: s.vals[k] <= 0, hover: hit(bM10, vx, vy) });
        drawBtn(ctx, bM1, "-", { disabled: s.vals[k] <= 0, hover: hit(bM1, vx, vy) });
        drawBtn(ctx, bP1, "+", { hover: hit(bP1, vx, vy) });
        drawBtn(ctx, bP10, "+10", { hover: hit(bP10, vx, vy) });

        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "center";
        ctx.fillText(String(s.vals[k]), bx + 88, cy + 0.5);

        if (s.vals[k] > 0) {
          clickTargets.push({ rect: bM10, onClick: () => adjustSupply(s.slot, k, -10) });
          clickTargets.push({ rect: bM1, onClick: () => adjustSupply(s.slot, k, -1) });
        }
        clickTargets.push({ rect: bP1, onClick: () => adjustSupply(s.slot, k, 1) });
        clickTargets.push({ rect: bP10, onClick: () => adjustSupply(s.slot, k, 10) });
      }
    }

    // 底部操作欄（船塢 + 提示 + 一鍵出航）
    const footY = Y + H - 56;
    ctx.strokeStyle = "rgba(218, 178, 102, 0.25)";
    ctx.beginPath();
    ctx.moveTo(X + 20, footY - 10);
    ctx.lineTo(X + W - 20, footY - 10);
    ctx.stroke();

    if (b.isCapital() && wharfMenu[2]) {
      const dockBtn: Rect = { x: X + 24, y: footY, w: 120, h: 38 };
      drawBtn(ctx, dockBtn, wharfMenu[2], { hover: hit(dockBtn, vx, vy) });
      clickTargets.push({ rect: dockBtn, onClick: () => { openDockRequested = true; shouldClose = true; } });
    }

    if (toastText && (typeof performance === "undefined" || performance.now() < toastUntil)) {
      ctx.font = `600 14px ${UI_FONT}`;
      ctx.fillStyle = toastIsErr ? "#ff8b8b" : "#8de8a8";
      ctx.textAlign = "left";
      ctx.fillText(toastText, X + 168, footY + 19, 640);
    }

    const departBtn: Rect = { x: X + W - 186, y: footY, w: 162, h: 40 };
    drawBtn(ctx, departBtn, wharfMenu[0] || "", { primary: true, disabled: ships.length === 0, hover: hit(departBtn, vx, vy) });
    if (ships.length > 0) {
      clickTargets.push({
        rect: departBtn,
        onClick: () => {
          if (noDriver) { showToast(b.captureMessage(0x39), true); return; }
          if (days <= 0) { showToast(b.captureMessage(0x3b), true); return; }
          departed = days;
          shouldClose = true;
        },
      });
    }

    ctx.restore();
  };

  for (;;) {
    shouldClose = false;
    departed = 0;
    openDockRequested = false;
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

    if (openDockRequested) {
      await b.dock();
      continue;
    }

    if (departed > 0) {
      // 與 wharf.js depart() 逐行一致的出港流程
      marketTradeLog(st, c.rt, 1, departed, 0, 0, b.port);
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
