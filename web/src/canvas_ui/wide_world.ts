// canvas_ui/wide_world.ts — Stage 1: 16:9 (1280×720) 全屏纯 Canvas 2D 港口/海面视口 + 悬浮现代 HUD
// 严格遵守: 零 DOM 游戏界面、100% 原版文本 (所有标签/名称/日期均直接取自原版数据表)。
import { DS, OFF } from "../model/schema_views.ts";
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { decodeCleanCstr, toSimp } from "./text_util.ts";
import { hasDom } from "../modern/dom_ui.ts";
import { syncDomWorldHud } from "../modern/dom_hud.ts";

const TILE = 32; // 40×23 格 = 1280×736，无黑边铺满整个 16:9 画面
const COLS = Math.ceil(VIEW_W / TILE) + 1;
const ROWS = Math.ceil(VIEW_H / TILE) + 1;
const P_MAP_W = 0x60;

// 4 枚主指令按钮 (右下悬浮)
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

// 与 core/screen.js 与 tools/extract_art.py 完全一致的 4-bit -> 6-bit VGA DAC -> 8-bit RGB 转换
const dac8 = (v4: number) => Math.round(((v4 & 15) * 4 * 255) / 63);

// 原版日间 16 色调色盘 (PALETTE_ADDR.day = 0xA50C, 原始 B,R,G 4-bit 顺序)
const DAY_PAL_RAW = [
  0, 0, 0,   13, 0, 4,   0, 13, 4,   10, 13, 6,
  6, 0, 10,  15, 0, 10,  6, 15, 10,  13, 15, 14,
  9, 7, 7,   12, 0, 4,   0, 10, 6,   5, 14, 11,
  15, 0, 8,  6, 0, 7,    6, 0, 11,   13, 15, 14,
];
const DAY_PAL_RGB: [number, number, number][] = Array.from({ length: 16 }, (_, i) => [
  dac8(DAY_PAL_RAW[i * 3 + 1]),
  dac8(DAY_PAL_RAW[i * 3 + 2]),
  dac8(DAY_PAL_RAW[i * 3]),
]);

// 地图图块优先映射至原版世界时段色号 8..15 (与 0 黑)，确保清晨/白天/黄昏/夜晚/阴天完全还原原版材质
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
      bTab[i] = dac8(raw[i * 3]);
      rTab[i] = dac8(raw[i * 3 + 1]);
      gTab[i] = dac8(raw[i * 3 + 2]);
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

  // ---------------- 1. 左上悬浮状态栏 (主角头像 + 日期/时刻 + 声望/金币/金块) ----------------
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

  // ---------------- 2. 右上悬浮地域/港情 或 航海气象栏 ----------------
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

  // ---------------- 3. 左下悬浮现代矢量罗盘 ----------------
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

  // 依原版方向角旋转罗盘指针 (港内 0..3 = N/E/S/W; 海上 0..7 = N/NE/E/SE/S/SW/W/NW)
  const rawNeedle = scene.needle === 0xff ? 0 : scene.needle;
  const angle = atSea
    ? ((rawNeedle & 7) * Math.PI) / 4
    : ((rawNeedle & 3) * Math.PI) / 2;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // 北向金红箭头
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(5, 2);
  ctx.lineTo(0, -1);
  ctx.lineTo(-5, 2);
  ctx.closePath();
  ctx.fillStyle = "#e85c4a";
  ctx.fill();
  // 南向银白尾针
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(4, 1);
  ctx.lineTo(-4, 1);
  ctx.closePath();
  ctx.fillStyle = "#d8e4f2";
  ctx.fill();
  // 中心铆钉
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#f4d78e";
  ctx.fill();
  ctx.restore();

  // ---------------- 4. 右下悬浮 4 枚主指令按钮 (情报 / 经营 / 命令 / 航海术) ----------------
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

  // 以主角世界座标为中心计算 16:9 相机窗口 (夹限于 96×96 港口地图内)
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

  // 绘制白天行人与站立 NPC
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

  // 绘制主角
  const hDir = portScene._lastDir ?? 2;
  const hPhase = portScene.phase ? 1 : 0;
  const heroSpriteIdx = portScene.st.hero * 8 + hDir * 2 + hPhase;
  const hxPx = (heroWX - camX) * TILE;
  const hyPx = (heroWY - camY) * TILE;
  drawSheetTileDirect(ctx, art, "chars", heroSpriteIdx, hxPx, hyPx, TILE * 2, TILE * 2, scr, false);

  // 悬浮现代 HUD（所有日夜时段色调直接由原版 16 色调色盘呈现，无人工打灯覆层）
  drawFloatingHud(ctx, portScene, false);
}

// 全球 24×24 海域图块无缝缓存（90×45 格 = 2160×1080 全球经度环绕，彻底消除跨 72×72 / 720 格边界的相机卡顿与跳变）
const SEA_WORLD_W = 0x870; // 2160
const SEA_WORLD_H = 0x438; // 1080
const seaChunkCache = new Map<number, Uint8Array>();
let seaChunkTmp: Uint8Array | null = null;
let seaChunkWmRef: any = null;
let seaChunkDiscSig = -1;

function calcSeaDiscoverySig(st: any): number {
  let sig = 0;
  for (let p = 0; p < 130; p++) {
    if (st.u8(DS.TBL_PORT + p * 0x16 + OFF.PORT.REGION) & 0x10) sig++;
  }
  for (let d = 0; d < 100; d++) {
    if (st.u8(0x7f8c + d * 7 + 6) & 0x40) sig += 256;
  }
  return sig;
}

function getGlobalSeaTile(seaScene: any, wx: number, wy: number): number {
  if (wy < 0 || wy >= SEA_WORLD_H) return 0;
  const gwx = ((wx % SEA_WORLD_W) + SEA_WORLD_W) % SEA_WORLD_W;
  const wcol = Math.floor(gwx / 24);
  const wrow = Math.floor(wy / 24);
  const wm = seaScene.wm;
  if (!wm?.decode) return 0;
  if (seaChunkWmRef !== wm) {
    seaChunkCache.clear();
    seaChunkWmRef = wm;
  }
  const key = wrow * 90 + wcol;
  let chunk = seaChunkCache.get(key);
  if (!chunk) {
    seaChunkTmp ??= new Uint8Array(0x2400);
    const itIdx = Math.floor(wcol / 30);
    const lc = wcol % 30;
    let c = lc - 1, ox = 24;
    if (c < 0) { c = 0; ox = 0; } else if (c > 27) { c = 27; ox = 48; }
    let r = wrow - 1, oy = 24;
    if (r < 0) { r = 0; oy = 0; } else if (r > 42) { r = 42; oy = 48; }
    wm.decode(seaScene.st, itIdx, 30 * r + c, seaChunkTmp);
    chunk = new Uint8Array(24 * 24);
    for (let rr = 0; rr < 24; rr++) {
      const srcOff = P_MAP_W * (oy + rr) + ox;
      chunk.set(seaChunkTmp.subarray(srcOff, srcOff + 24), rr * 24);
    }
    if (seaChunkCache.size > 400) {
      const firstKey = seaChunkCache.keys().next().value;
      if (firstKey !== undefined) seaChunkCache.delete(firstKey);
    }
    seaChunkCache.set(key, chunk);
  }
  return chunk[(wy % 24) * 24 + (gwx % 24)];
}

/** 16:9 全球无缝海面渲染器 */
export function renderWideSea(ctx: CanvasRenderingContext2D, scr: any, seaScene: any) {
  const art = seaScene.c.art;
  if (!art || !seaScene.wm) return;

  // 若新发现港口或发现物则自动失效海域块缓存，确保海面立即显示新发现的港口与遗迹
  const discSig = calcSeaDiscoverySig(seaScene.st);
  if (discSig !== seaChunkDiscSig) {
    seaChunkCache.clear();
    seaChunkDiscSig = discSig;
  }

  const WORLD_W = SEA_WORLD_W;
  const F = seaScene.fleet;
  const shipWX = ((seaScene.wx(F) % WORLD_W) + WORLD_W) % WORLD_W;
  const shipWY = seaScene.wy(F);
  const viewCols = Math.ceil(VIEW_W / TILE); // 40
  const viewRows = Math.ceil(VIEW_H / TILE); // 23
  const camWX = (((shipWX - Math.floor(viewCols / 2) + 1) % WORLD_W) + WORLD_W) % WORLD_W;
  const camWY = Math.max(0, Math.min(SEA_WORLD_H - viewRows, shipWY - Math.floor(viewRows / 2) + 1));

  const wrapDeltaX = (wx: number) => {
    let dx = wx - camWX;
    if (dx < -WORLD_W / 2) dx += WORLD_W;
    else if (dx > WORLD_W / 2) dx -= WORLD_W;
    return dx;
  };

  scr._wideSeaCam = {
    camX: 0,
    camY: 0,
    baseWX: camWX,
    baseWY: camWY,
    tile: TILE,
    vx1006: seaScene.vx1006,
    vy1008: seaScene.vy1008,
    worldW: WORLD_W,
    worldH: SEA_WORLD_H,
    viewCols,
    viewRows,
  };

  ctx.fillStyle = "#082040";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < viewRows; r++) {
    const wy = camWY + r;
    if (wy < 0 || wy >= SEA_WORLD_H) continue;
    for (let c = 0; c < viewCols; c++) {
      const t = getGlobalSeaTile(seaScene, camWX + c, wy);
      drawSheetTileDirect(ctx, art, "seachip", t, c * TILE, r * TILE, TILE, TILE, scr, true);
    }
  }

  // 绘制可见舰队 (主角 + 海上其他舰队)
  const st = seaScene.st;
  const w = st.u8(DS.WEATHER) & 15;
  const Tdir = seaScene.SJ.tab.shipDir;
  const drawOneFleet = (Fl: number, k: number, isHero: boolean) => {
    const fx = wrapDeltaX(seaScene.wx(Fl));
    const fy = seaScene.wy(Fl) - camWY;
    if (fx < -2 || fx > viewCols + 1 || fy < -2 || fy > viewRows + 1) return;
    const sx = fx * TILE;
    const sy = fy * TILE;
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

  drawFloatingHud(ctx, seaScene, true);
}
