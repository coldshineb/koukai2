// renderer/world.ts — 16:9 (1280×720) 全屏 Canvas 2D 港口/海面视口渲染器
import { FleetFlag, GameConst } from "../model/flags.ts";
import { WorldConst, fleetByAddr, fleetShipSlot } from "../model/world_helpers.ts";
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { syncDomWorldHud } from "../ui/hud.ts";

const TILE = 32; // 40×22.5 格 = 1280×720，无黑边铺满整个 16:9 画面
const P_MAP_W = 0x60;

// 4 枚主指令按钮 (右下悬浮)
const CMD_LABELS = ["情报", "经营", "命令", "航海术"] as const;
const CMD_BTN_W = 94;
const CMD_BTN_H = 42;
const CMD_GAP = 10;

export function getCommandButtonRects(scr?: any) {
  const vw = scr?.viewW || VIEW_W;
  const vh = scr?.viewH || VIEW_H;
  const barX = vw - (CMD_BTN_W * 4 + CMD_GAP * 3) - 18;
  const barY = vh - CMD_BTN_H - 18;
  return CMD_LABELS.map((label, i) => ({
    index: i,
    label,
    x: barX + i * (CMD_BTN_W + CMD_GAP),
    y: barY,
    w: CMD_BTN_W,
    h: CMD_BTN_H,
  }));
}

export function hitWideCommandButton(vx: number, vy: number, scr?: any): number {
  for (const r of getCommandButtonRects(scr)) {
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

let wideStageCanvas: HTMLCanvasElement | null = null;
let wideStageCtx: CanvasRenderingContext2D | null = null;

/** 取得与屏幕 DPR 无关的 1:1 整数像素离屏舞台画布，杜绝 HiDPI 缩放下拼接图块产生 1px 黑线 */
function getWideStageCtx(fallback: CanvasRenderingContext2D, vw: number, vh: number): CanvasRenderingContext2D {
  if (typeof document === "undefined") return fallback;
  if (!wideStageCanvas) {
    wideStageCanvas = document.createElement("canvas");
    wideStageCtx = wideStageCanvas.getContext("2d", { alpha: false });
  }
  if (wideStageCanvas.width !== vw || wideStageCanvas.height !== vh) {
    wideStageCanvas.width = vw;
    wideStageCanvas.height = vh;
  }
  return wideStageCtx || fallback;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrapMod = (v: number, mod: number) => ((v % mod) + mod) % mod;
const wrapSignedDelta = (delta: number, mod: number) => {
  let d = delta % mod;
  if (d < -mod / 2) d += mod;
  else if (d > mod / 2) d -= mod;
  return d;
};
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

interface GridTween {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  prevX: number;
  prevY: number;
  elapsed: number;
  dur: number;
}

/** 更新基于离散网格的 60fps 线性平滑补间（单格/邻格连续匀速滑行，跨格传送或长暂停时瞬切） */
function stepGridTween(
  tw: GridTween | undefined,
  logicX: number,
  logicY: number,
  dt: number,
  dur: number,
  reset: boolean,
): GridTween {
  if (!tw || reset || Math.max(Math.abs(logicX - tw.prevX), Math.abs(logicY - tw.prevY)) > 1) {
    return { fromX: logicX, fromY: logicY, toX: logicX, toY: logicY, prevX: logicX, prevY: logicY, elapsed: dur, dur };
  }
  const prevDone = tw.elapsed >= tw.dur;
  tw.elapsed = Math.min(tw.dur, tw.elapsed + dt);
  const t = tw.dur > 0 ? clamp(tw.elapsed / tw.dur, 0, 1) : 1;
  const curX = tw.fromX + (tw.toX - tw.fromX) * t;
  const curY = tw.fromY + (tw.toY - tw.fromY) * t;
  if (logicX !== tw.prevX || logicY !== tw.prevY) {
    return { fromX: curX, fromY: curY, toX: logicX, toY: logicY, prevX: logicX, prevY: logicY, elapsed: prevDone ? dt : 0, dur };
  }
  return tw;
}

function evalGridTween(tw: GridTween): [number, number] {
  const t = tw.dur > 0 ? clamp(tw.elapsed / tw.dur, 0, 1) : 1;
  return [tw.fromX + (tw.toX - tw.fromX) * t, tw.fromY + (tw.toY - tw.fromY) * t];
}

interface PortSmoothState {
  scene: any;
  portId: number;
  lastMs: number;
  hero?: GridTween;
  npcs: (GridTween | undefined)[];
  camX: number;
  camY: number;
}

let portSmooth: PortSmoothState | null = null;

/** 16:9 全屏港口渲染器（60fps 平滑角色/NPC 移动与平滑相机跟随） */
export function renderWidePort(ctx: CanvasRenderingContext2D, scr: any, portScene: any) {
  const art = portScene.c.art;
  const M = portScene.map;
  if (!M || !art) return;
  const sheetName = portScene.chipSetName || "portchip_0";

  const prefs = portScene.c?.prefs;
  const useSmoothMove = Boolean(prefs?.smoothMove);
  const useSmoothCam = Boolean(prefs?.smoothCamera);

  const vw = scr?.viewW || VIEW_W;
  const vh = scr?.viewH || VIEW_H;
  const heroWX = portScene.vx + portScene.hx;
  const heroWY = portScene.vy + portScene.hy;
  const viewCols = vw / TILE;
  const viewRows = vh / TILE;
  const maxCamX = Math.max(0, P_MAP_W - viewCols);
  const maxCamY = Math.max(0, P_MAP_W - viewRows);

  const tNow = nowMs();
  const portId = portScene.port ?? -1;
  const gapReset = !portSmooth || portSmooth.scene !== portScene || portSmooth.portId !== portId || tNow - portSmooth.lastMs > 220;
  const dt = gapReset ? 16 : Math.min(50, Math.max(0, tNow - portSmooth!.lastMs));

  const baseTicks = (portScene.m?.globals?.options & 1) ? 8 : 4;
  const speedScale = Math.max(0.25, portScene.c?.sys?.timeScale || 1);
  const stepDur = Math.max(24, (baseTicks * 16.581) / speedScale);

  const heroTw = stepGridTween(portSmooth?.hero, heroWX, heroWY, dt, stepDur, gapReset || !useSmoothMove);
  const [visHeroX, visHeroY] = useSmoothMove ? evalGridTween(heroTw) : [heroWX, heroWY];
  const targetCamX = clamp(visHeroX - (viewCols / 2 - 1), 0, maxCamX);
  const targetCamY = clamp(visHeroY - (viewRows / 2 - 1), 0, maxCamY);

  let camX = targetCamX;
  let camY = targetCamY;
  if (useSmoothCam && !gapReset && portSmooth && Math.hypot(targetCamX - portSmooth.camX, targetCamY - portSmooth.camY) < 4) {
    const camAlpha = 1 - Math.exp((-12 * Math.max(1, speedScale) * dt) / 1000);
    camX = clamp(portSmooth.camX + (targetCamX - portSmooth.camX) * camAlpha, 0, maxCamX);
    camY = clamp(portSmooth.camY + (targetCamY - portSmooth.camY) * camAlpha, 0, maxCamY);
  }

  portSmooth = {
    scene: portScene,
    portId,
    lastMs: tNow,
    hero: heroTw,
    npcs: gapReset ? Array(8).fill(undefined) : portSmooth!.npcs,
    camX,
    camY,
  };

  // 以整像素对齐相机，消除平滑卷动时的图块 1px 接缝
  const camPxX = clamp(Math.round(camX * TILE), 0, Math.round(maxCamX * TILE));
  const camPxY = clamp(Math.round(camY * TILE), 0, Math.round(maxCamY * TILE));
  const startCol = Math.max(0, Math.floor(camPxX / TILE));
  const endCol = Math.min(P_MAP_W - 1, Math.floor((camPxX + vw - 1) / TILE));
  const startRow = Math.max(0, Math.floor(camPxY / TILE));
  const endRow = Math.min(P_MAP_W - 1, Math.floor((camPxY + vh - 1) / TILE));

  const wctx = getWideStageCtx(ctx, vw, vh);
  wctx.fillStyle = "#081424";
  wctx.fillRect(0, 0, vw, vh);
  wctx.imageSmoothingEnabled = false;

  for (let my = startRow; my <= endRow; my++) {
    const rowOff = my * P_MAP_W;
    const dy = my * TILE - camPxY;
    for (let mx = startCol; mx <= endCol; mx++) {
      const t = M[rowOff + mx];
      drawSheetTileDirect(wctx, art, sheetName, t, mx * TILE - camPxX, dy, TILE, TILE, scr, true);
    }
  }

  // 绘制白天行人与站立 NPC（行人在格子间同样平滑移动）
  if (!portScene.night()) {
    for (let i = 0; i < 8; i++) {
      const n = portScene.npc(i);
      if (n.x === 0xff || n.y === 0xff) {
        portSmooth.npcs[i] = undefined;
        continue;
      }
      const nTw = stepGridTween(portSmooth.npcs[i], n.x, n.y, dt, stepDur * 1.15, gapReset || !useSmoothMove);
      portSmooth.npcs[i] = nTw;
      const [nx, ny] = useSmoothMove ? evalGridTween(nTw) : [n.x, n.y];
      const sx = Math.round(nx * TILE) - camPxX;
      const sy = Math.round(ny * TILE) - camPxY;
      if (sx < -64 || sx > vw || sy < -64 || sy > vh) continue;
      const anim = i >= 4 ? (portScene._npcFrames?.[i - 4] ?? ((portScene.toggle ^ i) & 1)) : (((n.x + n.y) & 1) === 0 ? 1 : 0);
      const localIdx = i >= 4 ? (n.d + 12) * 2 + anim : ((i & 1) * 4 + n.d + 4) * 2 + anim;
      const globalIdx = 48 + Math.max(0, Math.min(23, localIdx - 8));
      drawSheetTileDirect(wctx, art, "chars", globalIdx, sx, sy, TILE * 2, TILE * 2, scr, false);
    }
  } else {
    portSmooth.npcs.fill(undefined);
  }

  // 绘制主角
  const hDir = portScene._lastDir ?? 2;
  const hPhase = portScene.phase ? 1 : 0;
  const heroSpriteIdx = portScene.m.globals.hero * 8 + hDir * 2 + hPhase;
  const hxPx = Math.round(visHeroX * TILE) - camPxX;
  const hyPx = Math.round(visHeroY * TILE) - camPxY;
  drawSheetTileDirect(wctx, art, "chars", heroSpriteIdx, hxPx, hyPx, TILE * 2, TILE * 2, scr, false);

  if (wideStageCanvas && wctx !== ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wideStageCanvas, 0, 0, vw, vh, 0, 0, vw, vh);
  }

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

interface SeaSmoothTrack {
  visX: number;
  visY: number;
  velX: number;
  velY: number;
  rawX: number;
  rawY: number;
  avgStepMs: number;
  sinceStepMs: number;
}

interface SeaSmoothState {
  scene: any;
  lastMs: number;
  camWX: number;
  camWY: number;
  fleets: Map<number, SeaSmoothTrack>;
}

let seaSmooth: SeaSmoothState | null = null;

function exactFleetPos(seaScene: any, fl: any): [number, number] {
  const s8 = (v: number) => (v << 24) >> 24;
  const subX = clamp(s8(fl.subX) / 60, -0.99, 0.99);
  const subY = clamp(s8(fl.subY) / 60, -0.99, 0.99);
  const wx = wrapMod(seaScene.wx(fl.addr) + subX, SEA_WORLD_W);
  const wy = clamp(seaScene.wy(fl.addr) + subY, 0, SEA_WORLD_H - 1);
  return [wx, wy];
}

/**
 * 海上航行 60fps 恒速前馈 + 半步平滑跟随：
 * 先依据实测逻辑步长估算平滑航速 vel，在相邻逻辑步之间持续匀速推进 vis，
 * 使画面彻底免疫单帧 vsync / seaTick 节拍抖动带来的「一快一慢」现象；停船或阻塞时自动平滑归位。
 */
function stepSeaSmooth(
  tr: SeaSmoothTrack | undefined,
  rawWX: number,
  rawWY: number,
  dt: number,
  fallbackStepMs: number,
  forceStop: boolean,
  reset: boolean,
): SeaSmoothTrack {
  if (!tr || reset) {
    return {
      visX: rawWX,
      visY: rawWY,
      velX: 0,
      velY: 0,
      rawX: rawWX,
      rawY: rawWY,
      avgStepMs: fallbackStepMs,
      sinceStepMs: fallbackStepMs,
    };
  }
  const jumpX = wrapSignedDelta(rawWX - tr.rawX, SEA_WORLD_W);
  const jumpY = rawWY - tr.rawY;
  if (Math.hypot(jumpX, jumpY) > 2.5) {
    return {
      visX: rawWX,
      visY: rawWY,
      velX: 0,
      velY: 0,
      rawX: rawWX,
      rawY: rawWY,
      avgStepMs: tr.avgStepMs,
      sinceStepMs: tr.avgStepMs,
    };
  }

  tr.sinceStepMs += dt;
  if (Math.abs(jumpX) > 1e-4 || Math.abs(jumpY) > 1e-4) {
    if (tr.sinceStepMs >= 12 && tr.sinceStepMs <= 300) {
      tr.avgStepMs = tr.avgStepMs * 0.75 + tr.sinceStepMs * 0.25;
      const stepVx = jumpX / tr.sinceStepMs;
      const stepVy = jumpY / tr.sinceStepMs;
      const blend = Math.hypot(tr.velX, tr.velY) < 1e-7 ? 1 : 0.32;
      tr.velX = tr.velX * (1 - blend) + stepVx * blend;
      tr.velY = tr.velY * (1 - blend) + stepVy * blend;
    }
    tr.rawX = rawWX;
    tr.rawY = rawWY;
    tr.sinceStepMs = 0;
  }

  const stopThreshold = Math.max(tr.avgStepMs * 1.75, 170);
  if (forceStop || tr.sinceStepMs > stopThreshold) {
    tr.velX = 0;
    tr.velY = 0;
    const settleAlpha = 1 - Math.exp((-22 * dt) / 1000);
    tr.visX = wrapMod(tr.visX + wrapSignedDelta(tr.rawX - tr.visX, SEA_WORLD_W) * settleAlpha, SEA_WORLD_W);
    tr.visY = clamp(tr.visY + (tr.rawY - tr.visY) * settleAlpha, 0, SEA_WORLD_H - 1);
    return tr;
  }

  const lagMs = Math.min(tr.avgStepMs * 0.5, 70);
  const aimX = wrapMod(tr.rawX - tr.velX * lagMs, SEA_WORLD_W);
  const aimY = clamp(tr.rawY - tr.velY * lagMs, 0, SEA_WORLD_H - 1);
  const corr = Math.min(1, (8 * dt) / 1000);
  const errX = wrapSignedDelta(aimX - tr.visX, SEA_WORLD_W);
  const errY = aimY - tr.visY;
  tr.visX = wrapMod(tr.visX + tr.velX * dt + errX * corr, SEA_WORLD_W);
  tr.visY = clamp(tr.visY + tr.velY * dt + errY * corr, 0, SEA_WORLD_H - 1);
  return tr;
}

/** 16:9 全球无缝海面渲染器（结合 subX/subY 与 60fps 恒速船只追踪及平滑相机） */
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

  const prefs = seaScene.c?.prefs;
  const useSmoothMove = Boolean(prefs?.smoothMove);
  const useSmoothCam = Boolean(prefs?.smoothCamera);
  const WORLD_W = SEA_WORLD_W;
  const F = seaScene.fleet;
  const heroFl = fleetByAddr(m, F);
  const fleetRawPos = (fl: any): [number, number] =>
    useSmoothMove
      ? exactFleetPos(seaScene, fl)
      : [wrapMod(seaScene.wx(fl.addr), WORLD_W), clamp(seaScene.wy(fl.addr), 0, SEA_WORLD_H - 1)];
  const [heroRawWX, heroRawWY] = fleetRawPos(heroFl);

  const tNow = nowMs();
  const gapReset = !seaSmooth || seaSmooth.scene !== seaScene || tNow - seaSmooth.lastMs > 220;
  const dt = gapReset ? 16 : Math.min(50, Math.max(0, tNow - seaSmooth!.lastMs));
  const speedScale = Math.max(0.25, seaScene.c?.sys?.timeScale || 1);
  const defaultSeaStepMs = clamp(((1 + (m.globals.seaSpeed || 0)) * 16.581) / speedScale, 24, 220);
  const camAlpha = 1 - Math.exp((-12 * Math.max(1, speedScale) * dt) / 1000);
  const paused = (seaScene.c?.sys?.timeScale ?? 1) === 0;
  const heroStopped = paused || !!(m.globals.seaFlags2 & 0x20) || (heroFl.dir & 0xff) === 8;

  const fleetsMap = gapReset ? new Map<number, SeaSmoothTrack>() : seaSmooth!.fleets;
  const heroTr = stepSeaSmooth(fleetsMap.get(F), heroRawWX, heroRawWY, dt, defaultSeaStepMs, heroStopped, gapReset || !useSmoothMove);
  fleetsMap.set(F, heroTr);
  const heroSmooth = { wx: heroTr.visX, wy: heroTr.visY };

  const vw = scr?.viewW || VIEW_W;
  const vh = scr?.viewH || VIEW_H;
  const viewColsF = vw / TILE;
  const viewRowsF = vh / TILE;
  const maxCamWY = Math.max(0, SEA_WORLD_H - viewRowsF);
  const targetCamWX = wrapMod(heroSmooth.wx - (viewColsF / 2 - 1), WORLD_W);
  const targetCamWY = clamp(heroSmooth.wy - (viewRowsF / 2 - 1), 0, maxCamWY);

  let camWX = targetCamWX;
  let camWY = targetCamWY;
  if (useSmoothCam && !gapReset && seaSmooth) {
    const cdx = wrapSignedDelta(targetCamWX - seaSmooth.camWX, WORLD_W);
    const cdy = targetCamWY - seaSmooth.camWY;
    if (Math.hypot(cdx, cdy) < 5) {
      camWX = wrapMod(seaSmooth.camWX + cdx * camAlpha, WORLD_W);
      camWY = clamp(seaSmooth.camWY + cdy * camAlpha, 0, maxCamWY);
    }
  }
  seaSmooth = { scene: seaScene, lastMs: tNow, camWX, camWY, fleets: fleetsMap };

  // 整像素对齐相机，消除平滑海面卷动接缝
  const camPxX = wrapMod(Math.round(camWX * TILE), WORLD_W * TILE);
  const camPxY = clamp(Math.round(camWY * TILE), 0, Math.round(maxCamWY * TILE));
  const baseWX = Math.floor(camPxX / TILE);
  const baseWY = Math.floor(camPxY / TILE);
  const offPxX = camPxX - baseWX * TILE;
  const offPxY = camPxY - baseWY * TILE;
  const viewCols = Math.ceil((vw + offPxX) / TILE);
  const viewRows = Math.ceil((vh + offPxY) / TILE);

  scr._wideSeaCam = {
    camX: offPxX / TILE,
    camY: offPxY / TILE,
    baseWX,
    baseWY,
    tile: TILE,
    viewW: vw,
    viewH: vh,
    vx1006: seaScene.vx1006,
    vy1008: seaScene.vy1008,
    worldW: WORLD_W,
    worldH: SEA_WORLD_H,
    viewCols,
    viewRows,
  };

  const wctx = getWideStageCtx(ctx, vw, vh);
  wctx.fillStyle = "#082040";
  wctx.fillRect(0, 0, vw, vh);
  wctx.imageSmoothingEnabled = false;

  for (let r = 0; r < viewRows; r++) {
    const wy = baseWY + r;
    if (wy < 0 || wy >= SEA_WORLD_H) continue;
    const dy = r * TILE - offPxY;
    for (let c = 0; c < viewCols; c++) {
      const t = getGlobalSeaTile(seaScene, baseWX + c, wy);
      drawSheetTileDirect(wctx, art, "seachip", t, c * TILE - offPxX, dy, TILE, TILE, scr, true);
    }
  }

  // 绘制可见舰队 (主角 + 海上其他舰队，均随 subX/subY 平滑插值)
  const w = m.globals.weather & 15;
  const Tdir = seaScene.SJ.tab.shipDir;
  const heroId = m.globals.hero;
  const drawOneFleet = (fl: any, k: number, isHero: boolean) => {
    let pos: { wx: number; wy: number };
    if (isHero) {
      pos = heroSmooth;
    } else {
      const [rwx, rwy] = fleetRawPos(fl);
      const tr = stepSeaSmooth(fleetsMap.get(fl.addr), rwx, rwy, dt, defaultSeaStepMs, paused, gapReset || !useSmoothMove);
      fleetsMap.set(fl.addr, tr);
      pos = { wx: tr.visX, wy: tr.visY };
    }
    const fx = wrapSignedDelta(pos.wx - baseWX, WORLD_W);
    const fy = pos.wy - baseWY;
    if (fx < -2 || fx > viewCols + 1 || fy < -2 || fy > viewRows + 1) return;
    const sx = Math.round(fx * TILE) - offPxX;
    const sy = Math.round(fy * TILE) - offPxY;
    if (sx < -64 || sx > vw || sy < -64 || sy > vh) return;
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
    drawSheetTileDirect(wctx, art, "sea_ships", idx, sx, sy, TILE * 2, TILE * 2, scr, false);
  };

  if (w === 0 || w === 2) {
    for (let k = 0; k < WorldConst.TOTAL_FLEETS; k++) {
      const fl = m.fleet(k);
      if (fl.flags & FleetFlag.IN_PORT || !(fl.flags & FleetFlag.AT_SEA)) continue;
      if (seaScene.landAt(seaScene.wx(fl.addr), seaScene.wy(fl.addr))) continue;
      drawOneFleet(fl, k, fl.addr === F);
    }
  } else {
    drawOneFleet(heroFl, 0, true);
  }

  if (wideStageCanvas && wctx !== ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wideStageCanvas, 0, 0, vw, vh, 0, 0, vw, vh);
  }

  drawFloatingHud(seaScene, true);
}
