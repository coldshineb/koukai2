// canvas_ui/wide_world.ts — Stage 1: 16:9 (1280×720) 全屏純 Canvas 2D 港口/海面視口 + 懸浮現代 HUD
// 嚴格遵守: 零 DOM 遊戲介面、100% 原版文本 (所有標籤/名稱/日期均直接取自原版資料表)。
import { DS, OFF } from "../model/schema_views.ts";
import { VIEW_W, VIEW_H } from "../core/screen.js";

const TILE = 32; // 40×23 格 = 1280×736，無黑邊鋪滿整個 16:9 畫面
const COLS = Math.ceil(VIEW_W / TILE) + 1;
const ROWS = Math.ceil(VIEW_H / TILE) + 1;
const P_MAP_W = 0x60;

// 4 枚主指令按鈕 (右下懸浮) — 嚴格使用原版右側 HUD 四字標題
const CMD_LABELS = ["情報", "經營", "命令", "航海術"] as const;
const CMD_BTN_W = 94;
const CMD_BTN_H = 42;
const CMD_GAP = 10;
const CMD_BAR_Y = VIEW_H - CMD_BTN_H - 18;
const CMD_BAR_X = VIEW_W - (CMD_BTN_W * 4 + CMD_GAP * 3) - 18;

export function getCommandButtonRects() {
  return CMD_LABELS.map((label, i) => ({
    index: i,
    label,
    x: CMD_BAR_X + i * (CMD_BTN_W + CMD_GAP),
    y: CMD_BAR_Y,
    w: CMD_BTN_W,
    h: CMD_BTN_H,
  }));
}

export function hitWideCommandButton(vx: number, vy: number): number {
  for (const r of getCommandButtonRects()) {
    if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) return r.index;
  }
  return -1;
}

function decodeCstr(codec: any, bytes: Uint8Array): string {
  if (!codec || !bytes) return "";
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  return codec.decode(bytes.subarray(0, end)).replace(/\{[0-9A-F]{2}\}/g, "").trim();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGlassPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius = 10) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "rgba(13, 27, 46, 0.88)");
  grad.addColorStop(1, "rgba(8, 17, 31, 0.92)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(208, 169, 94, 0.72)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawSheetTileDirect(
  ctx: CanvasRenderingContext2D,
  art: any,
  sheetName: string,
  tileIdx: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const meta = art?.sheet?.(sheetName);
  if (!meta || tileIdx < 0 || tileIdx >= meta.count) return;
  const img = art.getImage(art.sheetUrl(sheetName));
  if (!img) return;
  const col = tileIdx % meta.cols;
  const row = Math.floor(tileIdx / meta.cols);
  const scaleX = (img.naturalWidth || meta.w) / meta.w;
  const scaleY = (img.naturalHeight || meta.h) / meta.h;
  ctx.drawImage(
    img,
    col * meta.tileW * scaleX,
    row * meta.tileH * scaleY,
    meta.tileW * scaleX,
    meta.tileH * scaleY,
    dx,
    dy,
    dw,
    dh,
  );
}

function drawWideAtmosphere(ctx: CanvasRenderingContext2D, scr: any, focusX: number, focusY: number, rtTime?: number) {
  const a = scr.atmosphere;
  const t = typeof performance !== "undefined" ? performance.now() * 0.001 : 0;
  const isStorm = !!(a?.active && a.atSea && (a.weather & 15) === 1);
  const isFog = !!(a?.active && a.atSea && (a.weather & 15) === 3);
  let mode = a?.mode || "day";
  if (typeof rtTime === "number") {
    if (rtTime < 12 || rtTime >= 60) mode = "night";
    else if (rtTime < 18) mode = "dawn";
    else if (rtTime >= 51) mode = "dusk";
    else mode = "day";
  }

  ctx.save();
  if (isStorm) {
    ctx.fillStyle = "rgba(8, 18, 40, 0.52)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.strokeStyle = "rgba(195, 220, 255, 0.42)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 96; i++) {
      const px = (i * 113 + t * 280) % VIEW_W;
      const py = (i * 67 + t * 760) % VIEW_H;
      ctx.moveTo(px, py);
      ctx.lineTo(px - 12, py + 28);
    }
    ctx.stroke();
    const flash = Math.sin(t * 2.3) * Math.sin(t * 7.1);
    if (flash > 0.96) {
      ctx.fillStyle = `rgba(220, 238, 255, ${((flash - 0.96) * 8).toFixed(3)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  } else if (isFog || mode === "overcast") {
    ctx.fillStyle = "rgba(165, 182, 202, 0.28)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else if (mode === "night") {
    // 明顯深藍夜幕 + 主角提燈暖光
    ctx.fillStyle = "rgba(6, 14, 42, 0.62)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const glowR = 240 + Math.sin(t * 3.2) * 10;
    const g = ctx.createRadialGradient(focusX, focusY, 18, focusX, focusY, glowR);
    g.addColorStop(0, "rgba(255, 204, 118, 0.34)");
    g.addColorStop(0.55, "rgba(255, 178, 86, 0.12)");
    g.addColorStop(1, "rgba(255, 178, 86, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else if (mode === "dusk") {
    // 黃昏暖橙暮色
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "rgba(232, 108, 40, 0.34)");
    g.addColorStop(0.6, "rgba(182, 76, 36, 0.26)");
    g.addColorStop(1, "rgba(72, 32, 48, 0.32)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  } else if (mode === "dawn") {
    // 黎明晨曦柔光
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "rgba(255, 176, 118, 0.24)");
    g.addColorStop(1, "rgba(102, 136, 204, 0.18)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // 柔和邊緣暗角
  const vig = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.65);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(5, 10, 18, 0.3)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
}

function drawFloatingHud(ctx: CanvasRenderingContext2D, scene: any, atSea: boolean) {
  const c = scene.c;
  const st = c.state;
  const m = st.model;
  const rt = c.rt;
  const art = c.art;
  const codec = c.codec;

  ctx.save();
  ctx.textBaseline = "middle";

  // ---------------- 1. 左上懸浮狀態欄 (主角頭像 + 日期/時刻 + 聲望/金幣/金塊) ----------------
  drawGlassPanel(ctx, 16, 14, 344, 92, 10);

  const heroP = m.heroPerson();
  const portUrl = art?.portraitUrl?.(heroP.face & 0xff) ?? null;
  const portImg = art?.getImage?.(portUrl);
  ctx.fillStyle = "#102138";
  ctx.fillRect(26, 22, 58, 74);
  if (portImg) {
    ctx.imageSmoothingEnabled = (portImg.naturalWidth || 64) > 64;
    ctx.drawImage(portImg, 26, 22, 58, 74);
  }
  ctx.strokeStyle = "#c8a258";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(26, 22, 58, 74);

  const months = scene.months ?? [];
  const monthStr = months[rt.month] ? decodeCstr(codec, months[rt.month]) : `${rt.month + 1}`;
  const t = rt.time;
  const hh = ((Math.floor(t / 3) + 11) % 12) + 1;
  const mm = String((t % 3) * 20).padStart(2, "0");
  const ap = t >= 0x24 ? "PM" : "AM";
  const dateText = `A.D.${rt.year + 1501} ${monthStr} ${rt.day + 1}  ${hh}:${mm}${ap}`;

  ctx.font = '600 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
  ctx.fillStyle = "#f2d89b";
  ctx.textAlign = "left";
  ctx.fillText(dateText, 96, 36);

  const hd = m.heroInfo();
  const fame = Math.max(hd.tradeFame, hd.pirateFame, hd.adventureFame);
  const money = m.globals.money;
  const bars = Math.trunc(money / 10000);
  const gold = money % 10000;

  ctx.font = '500 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
  ctx.fillStyle = "#d9cdb4";
  ctx.fillText(`聲望`, 96, 60);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(fame), 132, 60);

  ctx.fillStyle = "#d9cdb4";
  ctx.fillText(`金塊`, 206, 60);
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(String(bars), 242, 60);

  ctx.fillStyle = "#d9cdb4";
  ctx.fillText(`金幣`, 96, 84);
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(String(gold), 132, 84);

  // ---------------- 2. 右上懸浮地域/港情 或 航海氣象欄 ----------------
  if (!atSea) {
    const P = scene.port;
    const portName = decodeCstr(codec, m.port(P).nameBytes);
    const E = P < 100 ? m.portEconomy(P) : null;
    const regionName = E ? c.messageText(0x181 + E.priceRegion).trim() : "";

    drawGlassPanel(ctx, VIEW_W - 318, 14, 302, 92, 10);
    ctx.font = '700 17px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#f2d89b";
    ctx.textAlign = "left";
    ctx.fillText(portName, VIEW_W - 302, 36);

    if (regionName) {
      ctx.font = '500 12px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      ctx.fillStyle = "#b8c7dc";
      ctx.textAlign = "right";
      ctx.fillText(regionName, VIEW_W - 30, 36);
    }

    if (E) {
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += E.getPrices(i);
      const avgPrice = Math.trunc(sum / 10) + 50;
      ctx.textAlign = "left";
      ctx.font = '500 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      ctx.fillStyle = "#d9cdb4";
      ctx.fillText(`商業價值`, VIEW_W - 302, 62);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String((E.commerce << 16) >> 16), VIEW_W - 238, 62);

      ctx.fillStyle = "#d9cdb4";
      ctx.fillText(`工業價值`, VIEW_W - 164, 62);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String((E.industry << 16) >> 16), VIEW_W - 100, 62);

      ctx.fillStyle = "#d9cdb4";
      ctx.fillText(`平均物價`, VIEW_W - 302, 86);
      ctx.fillStyle = "#f2d89b";
      ctx.fillText(`${avgPrice}%`, VIEW_W - 238, 86);
    }
  } else {
    drawGlassPanel(ctx, VIEW_W - 318, 14, 302, 92, 10);
    const a = st.u8(DS.PORT_FLAGS);
    const b = st.u8(DS.WIND_CUR);
    const windDir = (a & 0x38) >> 3, windStr = a & 7;
    const curDir = (b & 0x38) >> 3, curStr = b & 7;
    const headDir = st.u8(scene.fleet + 0x1a);
    const spd = (scene.speed + 1) >> 1;
    const days = st.u8(DS.DAYS_AT_SEA);

    ctx.imageSmoothingEnabled = false;
    drawSheetTileDirect(ctx, art, "dials", windStr ? windDir : 8, VIEW_W - 304, 24, 42, 42);
    drawSheetTileDirect(ctx, art, "dials", curStr ? curDir : 8, VIEW_W - 210, 24, 42, 42);
    drawSheetTileDirect(ctx, art, "dials", headDir < 8 ? headDir : 8, VIEW_W - 116, 24, 42, 42);

    ctx.font = '600 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#f2d89b";
    ctx.textAlign = "center";
    ctx.fillText(String(windStr), VIEW_W - 283, 84);
    ctx.fillText(String(curStr), VIEW_W - 189, 84);
    ctx.fillText(`${spd}kt · ${days}`, VIEW_W - 95, 84);
  }

  // ---------------- 3. 左下懸浮羅盤 ----------------
  drawGlassPanel(ctx, 16, VIEW_H - 96, 80, 80, 40);
  ctx.imageSmoothingEnabled = false;
  if (!atSea) {
    const n = scene.needle === 0xff ? 0 : scene.needle;
    drawSheetTileDirect(ctx, art, "compass", n + 4, 36, VIEW_H - 68, 40, 24);
  } else {
    const n = scene.needle === 0xff ? 0 : scene.needle;
    drawSheetTileDirect(ctx, art, "seacompass", n + 9, 40, VIEW_H - 72, 32, 32);
  }

  // ---------------- 4. 右下懸浮 4 枚主指令按鈕 (情報 / 經營 / 命令 / 航海術) ----------------
  const mx = c.sys?.mouse?.vx ?? -1;
  const my = c.sys?.mouse?.vy ?? -1;
  const rects = getCommandButtonRects();
  for (const r of rects) {
    const hovered = mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    if (hovered) {
      g.addColorStop(0, "rgba(218, 178, 102, 0.96)");
      g.addColorStop(1, "rgba(170, 128, 52, 0.96)");
    } else {
      g.addColorStop(0, "rgba(18, 36, 62, 0.9)");
      g.addColorStop(1, "rgba(10, 22, 40, 0.94)");
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = hovered ? "#ffe2a0" : "rgba(208, 169, 94, 0.78)";
    ctx.lineWidth = hovered ? 2 : 1.5;
    ctx.stroke();

    ctx.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = hovered ? "#1a1106" : "#f4ead2";
    ctx.textAlign = "center";
    ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }

  ctx.restore();
}

/** 16:9 全屏港口渲染器 */
export function renderWidePort(ctx: CanvasRenderingContext2D, scr: any, portScene: any) {
  const art = portScene.c.art;
  const M = portScene.map;
  if (!M || !art) return;
  const sheetName = portScene.chipSetName || "portchip_0";

  // 以主角世界座標為中心計算 16:9 相機視窗 (夾限於 96×96 港口地圖內)
  const heroWX = portScene.vx + portScene.hx;
  const heroWY = portScene.vy + portScene.hy;
  const camX = Math.max(0, Math.min(P_MAP_W - Math.floor(VIEW_W / TILE), heroWX - Math.floor(VIEW_W / TILE / 2) + 1));
  const camY = Math.max(0, Math.min(P_MAP_W - Math.floor(VIEW_H / TILE), heroWY - Math.floor(VIEW_H / TILE / 2) + 1));

  ctx.fillStyle = "#081424";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < ROWS; r++) {
    const my = camY + r;
    if (my < 0 || my >= P_MAP_W) continue;
    const rowOff = my * P_MAP_W;
    for (let c = 0; c < COLS; c++) {
      const mx = camX + c;
      if (mx < 0 || mx >= P_MAP_W) continue;
      const t = M[rowOff + mx];
      drawSheetTileDirect(ctx, art, sheetName, t, c * TILE, r * TILE, TILE, TILE);
    }
  }

  // 繪製白天行人與站立 NPC
  if (!portScene.night()) {
    for (let i = 0; i < 8; i++) {
      const n = portScene.npc(i);
      if (n.x === 0xff || n.y === 0xff) continue;
      const sx = (n.x - camX) * TILE;
      const sy = (n.y - camY) * TILE;
      if (sx < -64 || sx > VIEW_W || sy < -64 || sy > VIEW_H) continue;
      const localIdx = i >= 4 ? (n.d + 12) * 2 : ((i & 1) * 4 + n.d + 4) * 2 + (((n.x + n.y) & 1) === 0 ? 1 : 0);
      const globalIdx = 48 + Math.max(0, Math.min(23, localIdx - 8));
      drawSheetTileDirect(ctx, art, "chars", globalIdx, sx, sy, TILE * 2, TILE * 2);
    }
  }

  // 繪製主角
  const hDir = portScene._lastDir ?? 2;
  const hPhase = portScene.phase ? 1 : 0;
  const heroSpriteIdx = portScene.st.hero * 8 + hDir * 2 + hPhase;
  const hxPx = (heroWX - camX) * TILE;
  const hyPx = (heroWY - camY) * TILE;
  drawSheetTileDirect(ctx, art, "chars", heroSpriteIdx, hxPx, hyPx, TILE * 2, TILE * 2);

  // 全屏 16:9 晝夜光影 (提燈微光跟隨主角)
  drawWideAtmosphere(ctx, scr, hxPx + TILE, hyPx + TILE, portScene.c.rt?.time);

  // 懸浮現代 Canvas HUD
  drawFloatingHud(ctx, portScene, false);
}

/** 16:9 全屏海面渲染器 */
export function renderWideSea(ctx: CanvasRenderingContext2D, scr: any, seaScene: any) {
  const art = seaScene.c.art;
  const M = seaScene.map;
  if (!M || !art) return;

  const F = seaScene.fleet;
  const shipLX = seaScene.wx(F) - seaScene.bda6;
  const shipLY = seaScene.wy(F) - seaScene.bdaa;
  const camX = Math.max(0, Math.min(P_MAP_W - Math.floor(VIEW_W / TILE), shipLX - Math.floor(VIEW_W / TILE / 2) + 1));
  const camY = Math.max(0, Math.min(P_MAP_W - Math.floor(VIEW_H / TILE), shipLY - Math.floor(VIEW_H / TILE / 2) + 1));

  ctx.fillStyle = "#082040";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < ROWS; r++) {
    const my = camY + r;
    if (my < 0 || my >= P_MAP_W) continue;
    const rowOff = my * P_MAP_W;
    for (let c = 0; c < COLS; c++) {
      const mx = camX + c;
      if (mx < 0 || mx >= P_MAP_W) continue;
      const t = M[rowOff + mx];
      drawSheetTileDirect(ctx, art, "seachip", t, c * TILE, r * TILE, TILE, TILE);
    }
  }

  // 繪製可見艦隊 (主角 + 海上其他艦隊)
  const st = seaScene.st;
  const w = st.u8(DS.WEATHER) & 15;
  const Tdir = seaScene.SJ.tab.shipDir;
  const drawOneFleet = (Fl: number, k: number, isHero: boolean) => {
    const fx = seaScene.wx(Fl) - seaScene.bda6;
    const fy = seaScene.wy(Fl) - seaScene.bdaa;
    const sx = (fx - camX) * TILE;
    const sy = (fy - camY) * TILE;
    if (sx < -64 || sx > VIEW_W || sy < -64 || sy > VIEW_H) return;
    let si: number;
    if (isHero) {
      let i = 0;
      while (i < 10 && st.u8(seaScene.crewOf(i) + 0x1b) !== st.u8(DS.HERO)) i++;
      si = (st.u8(seaScene.shipRec(st.u8(seaScene.slotOf(i) + 7)) + 0x10) & 0x10) << 8;
    } else {
      si = (((st.u8(seaScene.shipRec(st.u8(Fl + 0x32)) + 0x10) & 0x10) << 8) + 0x2000) & 0xffff;
    }
    const d = Tdir[st.u8(Fl + OFF.FLEET.DIR) & 7] + 0x10;
    si = isHero
      ? (si + (((d * 2 + (seaScene.time & 1)) << 9) & 0xffff)) & 0xffff
      : (si + ((d << 10) & 0xffff) + (((k + seaScene.time) & 1) << 9)) & 0xffff;
    const idx = (si - 0x4000) >> 9;
    drawSheetTileDirect(ctx, art, "sea_ships", idx, sx, sy, TILE * 2, TILE * 2);
  };

  if (w === 0 || w === 2) {
    for (let k = 0; k < 0x46; k++) {
      const Fl = DS.TBL_FLEET + k * 0x85;
      if (st.u8(Fl + OFF.FLEET.FLAGS) & 0x10 || !(st.u8(Fl + OFF.FLEET.FLAGS) & 1)) continue;
      if (seaScene.landAt(seaScene.wx(Fl), seaScene.wy(Fl))) continue;
      drawOneFleet(Fl, k, Fl === F);
    }
  } else {
    drawOneFleet(F, 0, true);
  }

  const shipPxX = (shipLX - camX) * TILE + TILE;
  const shipPxY = (shipLY - camY) * TILE + TILE;
  drawWideAtmosphere(ctx, scr, shipPxX, shipPxY, seaScene.c.rt?.time);
  drawFloatingHud(ctx, seaScene, true);
}
