// canvas_ui/wide_world.ts — Stage 1: 16:9 (1280×720) 全屏純 Canvas 2D 港口/海面視口 + 懸浮現代 HUD
// 嚴格遵守: 零 DOM 遊戲介面、100% 原版文本 (所有標籤/名稱/日期均直接取自原版資料表)。
import { DS, OFF } from "../model/schema_views.ts";
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { decodeCleanCstr, toSimp } from "./text_util.ts";
import { hasDom } from "../modern/dom_ui.ts";
import { syncDomWorldHud } from "../modern/dom_hud.ts";

const TILE = 32; // 40×23 格 = 1280×736，無黑邊鋪滿整個 16:9 畫面
const COLS = Math.ceil(VIEW_W / TILE) + 1;
const ROWS = Math.ceil(VIEW_H / TILE) + 1;
const P_MAP_W = 0x60;

// 4 枚主指令按鈕 (右下懸浮)
const CMD_LABELS = ["情报", "经营", "命令", "航海术"] as const;
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
  return decodeCleanCstr(codec, bytes);
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

// 原版日間 16 色調色盤 (PALETTE_ADDR.day = 0xA50C) 供首次建立圖集色號索引表
const DAY_PAL_RGB: [number, number, number][] = [
  [0, 0, 0], [0, 68, 221], [221, 68, 0], [221, 102, 170],
  [0, 170, 102], [0, 170, 255], [255, 170, 102], [255, 238, 221],
  [119, 119, 153], [0, 68, 204], [170, 102, 0], [238, 187, 85],
  [0, 136, 255], [0, 119, 102], [0, 187, 102], [255, 238, 221],
];

// 地圖圖塊優先對映至原版世界時段色號 8..15 (與 0 黑)，確保清晨/白天/黃昏/夜晚/陰天完全還原原版材質
const MAP_SEARCH_ORDER = [0, 8, 9, 10, 11, 12, 13, 14, 15, 1, 2, 3, 4, 5, 6, 7];
const SPRITE_SEARCH_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

interface PalSheetCache {
  srcImg: HTMLImageElement;
  w: number;
  h: number;
  indices: Uint8Array; // 0..15 或 255(透明)
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imgData: ImageData;
  lastPalKey: string;
}

const palSheetCache = new Map<string, PalSheetCache>();

function getPaletteKey(scr: any): string {
  const raw: Uint8Array | undefined = scr?.raw;
  if (!raw || raw.length < 48) return "";
  let k = "";
  for (let i = 0; i < 48; i++) k += String.fromCharCode(raw[i] + 48);
  return k;
}

function getPaletteRemappedSheet(
  art: any,
  scr: any,
  sheetName: string,
  preferMapSlots: boolean,
): HTMLCanvasElement | HTMLImageElement | null {
  const img = art?.getImage?.(art.sheetUrl(sheetName));
  if (!img) return null;
  const raw: Uint8Array | undefined = scr?.raw;
  if (!raw || raw.length < 48 || typeof document === "undefined") return img;

  let entry = palSheetCache.get(sheetName);
  if (!entry || entry.srcImg !== img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return img;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    const srcData = ctx.getImageData(0, 0, w, h).data;
    const indices = new Uint8Array(w * h);
    const order = preferMapSlots ? MAP_SEARCH_ORDER : SPRITE_SEARCH_ORDER;
    for (let p = 0, q = 0; p < indices.length; p++, q += 4) {
      if (srcData[q + 3] < 128) {
        indices[p] = 255;
        continue;
      }
      const r = srcData[q], g = srcData[q + 1], b = srcData[q + 2];
      let best = 0, bestD = 1e9;
      for (let oi = 0; oi < 16; oi++) {
        const idx = order[oi];
        const [pr, pg, pb] = DAY_PAL_RGB[idx];
        const dr = r - pr, dg = g - pg, db = b - pb;
        const d = dr * dr + dg * dg + db * db;
        if (d === 0) { best = idx; break; }
        if (d < bestD) { bestD = d; best = idx; }
      }
      indices[p] = best;
    }
    entry = {
      srcImg: img,
      w,
      h,
      indices,
      canvas,
      ctx,
      imgData: ctx.createImageData(w, h),
      lastPalKey: "",
    };
    palSheetCache.set(sheetName, entry);
  }

  const palKey = getPaletteKey(scr);
  if (entry.lastPalKey !== palKey) {
    const dst = entry.imgData.data;
    const idxArr = entry.indices;
    const rTab = new Uint8Array(16), gTab = new Uint8Array(16), bTab = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bTab[i] = raw[i * 3] * 17;
      rTab[i] = raw[i * 3 + 1] * 17;
      gTab[i] = raw[i * 3 + 2] * 17;
    }
    for (let p = 0, q = 0; p < idxArr.length; p++, q += 4) {
      const ci = idxArr[p];
      if (ci === 255) {
        dst[q + 3] = 0;
      } else {
        dst[q] = rTab[ci];
        dst[q + 1] = gTab[ci];
        dst[q + 2] = bTab[ci];
        dst[q + 3] = 255;
      }
    }
    entry.ctx.putImageData(entry.imgData, 0, 0);
    entry.lastPalKey = palKey;
  }
  return entry.canvas;
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
  scr?: any,
  preferMapSlots = true,
) {
  const meta = art?.sheet?.(sheetName);
  if (!meta || tileIdx < 0 || tileIdx >= meta.count) return;
  const img = scr
    ? getPaletteRemappedSheet(art, scr, sheetName, preferMapSlots)
    : art.getImage(art.sheetUrl(sheetName));
  if (!img) return;
  const col = tileIdx % meta.cols;
  const row = Math.floor(tileIdx / meta.cols);
  const nw = (img as HTMLImageElement).naturalWidth || img.width || meta.w;
  const nh = (img as HTMLImageElement).naturalHeight || img.height || meta.h;
  const scaleX = nw / meta.w;
  const scaleY = nh / meta.h;
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

/** 僅保留暴風雨雨絲特效；所有日夜時段色調完全交由原版 16 色調色盤 (scr.raw) 呈現 */
function drawStormRainOnly(ctx: CanvasRenderingContext2D, scr: any) {
  const a = scr.atmosphere;
  const isStorm = !!(a?.active && a.atSea && (a.weather & 15) === 1);
  if (!isStorm) return;
  const t = typeof performance !== "undefined" ? performance.now() * 0.001 : 0;
  ctx.save();
  ctx.strokeStyle = "rgba(195, 220, 255, 0.36)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 84; i++) {
    const px = (i * 113 + t * 280) % VIEW_W;
    const py = (i * 67 + t * 760) % VIEW_H;
    ctx.moveTo(px, py);
    ctx.lineTo(px - 12, py + 28);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFloatingHud(ctx: CanvasRenderingContext2D, scene: any, atSea: boolean) {
  if (hasDom()) {
    syncDomWorldHud(scene, atSea);
    return;
  }
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

  const heroFaceId = st.u8(st.personRecord(m.globals.hero) + 0x1a);
  const portUrl = art?.portraitUrl?.(heroFaceId) ?? null;
  const portImg = art?.getImage?.(portUrl);
  if (portUrl && !portImg) void art?.loadImage?.(portUrl);
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

  ctx.font = '500 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';
  ctx.fillStyle = "#d9cdb4";
  ctx.fillText(`声望`, 96, 60);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(fame), 132, 60);

  ctx.fillStyle = "#d9cdb4";
  ctx.fillText(`金块`, 206, 60);
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(String(bars), 242, 60);

  ctx.fillStyle = "#d9cdb4";
  ctx.fillText(`金币`, 96, 84);
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(String(gold), 132, 84);

  // ---------------- 2. 右上懸浮地域/港情 或 航海氣象欄 ----------------
  if (!atSea) {
    const P = scene.port;
    const portName = decodeCstr(codec, m.port(P).nameBytes);
    const E = P < 100 ? m.portEconomy(P) : null;
    const regionName = E ? toSimp(c.messageText(0x181 + E.priceRegion).trim()) : "";

    drawGlassPanel(ctx, VIEW_W - 318, 14, 302, 92, 10);
    ctx.font = '700 17px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#f2d89b";
    ctx.textAlign = "left";
    ctx.fillText(portName, VIEW_W - 302, 36);

    if (regionName) {
      ctx.font = '500 12px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';
      ctx.fillStyle = "#b8c7dc";
      ctx.textAlign = "right";
      ctx.fillText(regionName, VIEW_W - 30, 36);
    }

    if (E) {
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += E.getPrices(i);
      const avgPrice = Math.trunc(sum / 10) + 50;
      ctx.textAlign = "left";
      ctx.font = '500 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';
      ctx.fillStyle = "#d9cdb4";
      ctx.fillText(`商业价值`, VIEW_W - 302, 62);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String((E.commerce << 16) >> 16), VIEW_W - 238, 62);

      ctx.fillStyle = "#d9cdb4";
      ctx.fillText(`工业价值`, VIEW_W - 164, 62);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String((E.industry << 16) >> 16), VIEW_W - 100, 62);

      ctx.fillStyle = "#d9cdb4";
      ctx.fillText(`平均物价`, VIEW_W - 302, 86);
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

  // ---------------- 3. 左下懸浮現代矢量羅盤 ----------------
  const cx = 56, cy = VIEW_H - 56, cr = 36;
  drawGlassPanel(ctx, cx - cr, cy - cr, cr * 2, cr * 2, cr);
  ctx.save();
  ctx.strokeStyle = "rgba(214, 174, 96, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, cr - 6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = '700 10px "Microsoft YaHei UI", "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(232, 206, 148, 0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", cx, cy - cr + 11);
  ctx.fillText("S", cx, cy + cr - 10);
  ctx.fillText("W", cx - cr + 11, cy);
  ctx.fillText("E", cx + cr - 11, cy);

  // 依原版方向角旋轉羅盤指針 (港內 0..3 = N/E/S/W; 海上 0..7 = N/NE/E/SE/S/SW/W/NW)
  const rawNeedle = scene.needle === 0xff ? 0 : scene.needle;
  const angle = atSea
    ? ((rawNeedle & 7) * Math.PI) / 4
    : ((rawNeedle & 3) * Math.PI) / 2;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // 北向金紅箭頭
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(5, 2);
  ctx.lineTo(0, -1);
  ctx.lineTo(-5, 2);
  ctx.closePath();
  ctx.fillStyle = "#e85c4a";
  ctx.fill();
  // 南向銀白尾針
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(4, 1);
  ctx.lineTo(-4, 1);
  ctx.closePath();
  ctx.fillStyle = "#d8e4f2";
  ctx.fill();
  // 中心鉚釘
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#f4d78e";
  ctx.fill();
  ctx.restore();

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
      drawSheetTileDirect(ctx, art, sheetName, t, c * TILE, r * TILE, TILE, TILE, scr, true);
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
      drawSheetTileDirect(ctx, art, "chars", globalIdx, sx, sy, TILE * 2, TILE * 2, scr, false);
    }
  }

  // 繪製主角
  const hDir = portScene._lastDir ?? 2;
  const hPhase = portScene.phase ? 1 : 0;
  const heroSpriteIdx = portScene.st.hero * 8 + hDir * 2 + hPhase;
  const hxPx = (heroWX - camX) * TILE;
  const hyPx = (heroWY - camY) * TILE;
  drawSheetTileDirect(ctx, art, "chars", heroSpriteIdx, hxPx, hyPx, TILE * 2, TILE * 2, scr, false);

  // 懸浮現代 HUD（所有日夜時段色調直接由原版 16 色調色盤呈現，無人工打燈覆層）
  drawFloatingHud(ctx, portScene, false);
}

/** 16:9 全屏海面渲染器 */
export function renderWideSea(ctx: CanvasRenderingContext2D, scr: any, seaScene: any) {
  const art = seaScene.c.art;
  const M = seaScene.map;
  if (!M || !art) return;

  // 海上區域緩衝 seaBuf 步幅為 96 (P_MAP_W)，但 WORLDMAP 解碼只填寫左上 72×72 (3×3 海域格)
  const SEA_VALID = 72;
  const WORLD_W = 0x870; // 2160 格全球經度環繞
  const item = seaScene.item >= 0 && seaScene.item < 3 ? seaScene.item : Math.trunc(seaScene.wx(seaScene.fleet) / 0x2d0);
  const baseWX = item * 0x2d0 + seaScene.bda6;
  const baseWY = seaScene.bdaa;
  const wrapDeltaX = (wx: number) => {
    let dx = wx - baseWX;
    if (dx < -WORLD_W / 2) dx += WORLD_W;
    else if (dx > WORLD_W / 2) dx -= WORLD_W;
    return dx;
  };

  const F = seaScene.fleet;
  const shipLX = wrapDeltaX(seaScene.wx(F));
  const shipLY = seaScene.wy(F) - baseWY;
  const viewCols = Math.ceil(VIEW_W / TILE); // 40
  const viewRows = Math.ceil(VIEW_H / TILE); // 23
  const camX = Math.max(0, Math.min(SEA_VALID - viewCols, shipLX - Math.floor(viewCols / 2) + 1));
  const camY = Math.max(0, Math.min(SEA_VALID - viewRows, shipLY - Math.floor(viewRows / 2) + 1));
  scr._wideSeaCam = {
    camX,
    camY,
    baseWX,
    baseWY,
    tile: TILE,
    vx1006: seaScene.vx1006,
    vy1008: seaScene.vy1008,
    worldW: WORLD_W,
  };

  ctx.fillStyle = "#082040";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < viewRows; r++) {
    const my = camY + r;
    if (my < 0 || my >= SEA_VALID) continue;
    const rowOff = my * P_MAP_W;
    for (let c = 0; c < viewCols; c++) {
      const mx = camX + c;
      if (mx < 0 || mx >= SEA_VALID) continue;
      const t = M[rowOff + mx];
      drawSheetTileDirect(ctx, art, "seachip", t, c * TILE, r * TILE, TILE, TILE, scr, true);
    }
  }

  // 繪製可見艦隊 (主角 + 海上其他艦隊)
  const st = seaScene.st;
  const w = st.u8(DS.WEATHER) & 15;
  const Tdir = seaScene.SJ.tab.shipDir;
  const drawOneFleet = (Fl: number, k: number, isHero: boolean) => {
    const fx = wrapDeltaX(seaScene.wx(Fl));
    const fy = seaScene.wy(Fl) - baseWY;
    if (fx < -2 || fx >= SEA_VALID + 2 || fy < -2 || fy >= SEA_VALID + 2) return;
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
    drawSheetTileDirect(ctx, art, "sea_ships", idx, sx, sy, TILE * 2, TILE * 2, scr, false);
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

  drawStormRainOnly(ctx, scr);
  drawFloatingHud(ctx, seaScene, true);
}
