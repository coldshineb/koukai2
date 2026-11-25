// renderer/world.ts — 16:9 (1280×720) 全屏 Canvas 2D 港口/海面视口渲染器
import { FleetFlag, GameConst } from "../model/flags.ts";
import { WorldConst, fleetByAddr, fleetShipSlot } from "../model/world_helpers.ts";
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { syncDomWorldHud } from "../ui/hud.ts";

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

function drawFloatingHud(scene: any, atSea: boolean) {
  syncDomWorldHud(scene, atSea);
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
  drawFloatingHud(portScene, false);
}

// 全球 24×24 海域图块无缝缓存（90×45 格 = 2160×1080 全球经度环绕，彻底消除跨 72×72 / 720 格边界的相机卡顿与跳变）
const SEA_WORLD_W = 0x870; // 2160
const SEA_WORLD_H = 0x438; // 1080
const seaChunkCache = new Map<number, Uint8Array>();
let seaChunkTmp: Uint8Array | null = null;
let seaChunkWmRef: any = null;
let seaChunkDiscSig = -1;

function calcSeaDiscoverySig(m: any): number {
  let sig = 0;
  for (let p = 0; p < WorldConst.TOTAL_PORTS; p++) {
    if (m.port(p).region & WorldConst.PORT_DISCOVERED_BIT) sig++;
  }
  for (let d = 0; d < WorldConst.TOTAL_DISCOVERIES; d++) {
    if (m.discovery(d).flags & WorldConst.DISCOVERY_CHART_BIT) sig += 256;
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
  const m = seaScene.st.model;
  const discSig = calcSeaDiscoverySig(m);
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
  const w = m.globals.weather & 15;
  const Tdir = seaScene.SJ.tab.shipDir;
  const heroId = m.globals.hero;
  const drawOneFleet = (fl: any, k: number, isHero: boolean) => {
    const fx = wrapDeltaX(seaScene.wx(fl.addr));
    const fy = seaScene.wy(fl.addr) - camWY;
    if (fx < -2 || fx > viewCols + 1 || fy < -2 || fy > viewRows + 1) return;
    const sx = fx * TILE;
    const sy = fy * TILE;
    if (sx < -64 || sx > VIEW_W || sy < -64 || sy > VIEW_H) return;
    let si: number;
    if (isHero) {
      let i = 0;
      while (i < GameConst.FLEET_SHIPS && m.crewSlot(i).captain !== heroId) i++;
      const shipId = fleetShipSlot(fl, i).ship;
      si = (m.ship(shipId).flags & WorldConst.SHIP_LARGE_BIT) << 8;
    } else {
      const shipId = fleetShipSlot(fl, 0).ship;
      si = (((m.ship(shipId).flags & WorldConst.SHIP_LARGE_BIT) << 8) + 0x2000) & 0xffff;
    }
    const d = Tdir[fl.dir & 7] + 16;
    si = isHero
      ? (si + (((d * 2 + (seaScene.time & 1)) << 9) & 0xffff)) & 0xffff
      : (si + ((d << 10) & 0xffff) + (((k + seaScene.time) & 1) << 9)) & 0xffff;
    const idx = (si - 0x4000) >> 9;
    drawSheetTileDirect(ctx, art, "sea_ships", idx, sx, sy, TILE * 2, TILE * 2, scr, false);
  };

  if (w === 0 || w === 2) {
    for (let k = 0; k < WorldConst.TOTAL_FLEETS; k++) {
      const fl = m.fleet(k);
      if (fl.flags & FleetFlag.IN_PORT || !(fl.flags & FleetFlag.AT_SEA)) continue;
      if (seaScene.landAt(seaScene.wx(fl.addr), seaScene.wy(fl.addr))) continue;
      drawOneFleet(fl, k, fl.addr === F);
    }
  } else {
    drawOneFleet(fleetByAddr(m, F), 0, true);
  }

  drawFloatingHud(seaScene, true);
}
