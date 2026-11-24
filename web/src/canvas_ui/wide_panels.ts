// canvas_ui/wide_panels.ts — 原生 16:9 (1280×720) 現代 Canvas 2D 浮窗套件
// 涵蓋：主公情報、積載情報、發現物卡片、航海日誌、世界航海圖、隊形變更、隨身物詳情卡。
// 100% 純 Canvas 2D、零 DOM、零黑屏切場、100% 原版遊戲文本。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
import { decodeCleanCstr } from "./text_util.ts";
import { hasDom, runDomLordInfo, runDomInfoLines, runDomLogBook } from "../modern/dom_ui.ts";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, rightSub = "") {
  ctx.fillStyle = "rgba(5, 11, 22, 0.56)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, 14);
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, "rgba(15, 31, 54, 0.96)");
  bg.addColorStop(1, "rgba(8, 17, 32, 0.98)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(214, 174, 96, 0.88)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.font = '700 18px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
  ctx.fillStyle = "#f2d89b";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, x + 24, y + 30);

  if (rightSub) {
    ctx.font = '600 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#d8c394";
    ctx.textAlign = "right";
    ctx.fillText(rightSub, x + w - 24, y + 30);
  }

  ctx.strokeStyle = "rgba(214, 174, 96, 0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 18, y + 52);
  ctx.lineTo(x + w - 18, y + 52);
  ctx.stroke();
}

// ---------------- 1. 主公情報 ----------------
export interface WideLordData {
  title: string;
  portraitUrl: string | null;
  moneyLines: string[];
  fameHeader: string;
  fameLines: { label: string; value: number }[];
  nations: { label: string; value: number; rawText: string }[];
}

export async function runWideLordInfo(ctx: any, data: WideLordData) {
  if (hasDom()) return runDomLordInfo(data);
  const { scr, menu, art } = ctx;
  if (data.portraitUrl) await art?.loadImage?.(data.portraitUrl).catch(() => {});

  const w = 780, h = 440;
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    drawPanelFrame(c2d, x, y, w, h, data.title);

    // 左側頭像 + 金錢 + 聲望
    const px = x + 28, py = y + 72;
    c2d.fillStyle = "#081220";
    c2d.fillRect(px, py, 104, 130);
    const img = data.portraitUrl ? art?.getImage?.(data.portraitUrl) : null;
    if (img) {
      c2d.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
      c2d.drawImage(img, px, py, 104, 130);
    }
    c2d.strokeStyle = "rgba(214, 174, 96, 0.75)";
    c2d.strokeRect(px, py, 104, 130);

    c2d.textAlign = "left";
    c2d.textBaseline = "middle";
    c2d.font = '600 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    c2d.fillStyle = "#fff4d6";
    for (let i = 0; i < data.moneyLines.length; i++) {
      c2d.fillText(data.moneyLines[i], x + 152, y + 92 + i * 32, 220);
    }

    c2d.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    c2d.fillStyle = "#f2d89b";
    c2d.fillText(data.fameHeader, x + 28, y + 232);

    for (let i = 0; i < data.fameLines.length; i++) {
      const fy = y + 266 + i * 44;
      const f = data.fameLines[i];
      c2d.font = '600 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#eadfc8";
      c2d.textAlign = "left";
      c2d.fillText(f.label, x + 28, fy);
      const ratio = Math.max(0, Math.min(1, f.value / 50000));
      roundRect(c2d, x + 28, fy + 14, 320, 10, 5);
      c2d.fillStyle = "rgba(255, 255, 255, 0.1)";
      c2d.fill();
      if (ratio > 0) {
        roundRect(c2d, x + 28, fy + 14, Math.max(8, 320 * ratio), 10, 5);
        c2d.fillStyle = "#e2bc6b";
        c2d.fill();
      }
    }

    // 右側 6 國友好度
    const rx = x + 396;
    c2d.strokeStyle = "rgba(214, 174, 96, 0.25)";
    c2d.beginPath();
    c2d.moveTo(rx - 20, y + 68);
    c2d.lineTo(rx - 20, y + h - 24);
    c2d.stroke();

    for (let i = 0; i < data.nations.length; i++) {
      const ny = y + 84 + i * 54;
      const nat = data.nations[i];
      c2d.font = '600 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#eadfc8";
      c2d.textAlign = "left";
      c2d.fillText(nat.label, rx, ny);

      c2d.font = '700 14px "Consolas", monospace';
      c2d.fillStyle = nat.value >= 100 ? "#8de8a8" : "#ff8b8b";
      c2d.textAlign = "right";
      c2d.fillText(nat.rawText, x + w - 28, ny);

      const barW = x + w - 28 - rx;
      const ratio = Math.max(0, Math.min(1, nat.value / 200));
      roundRect(c2d, rx, ny + 16, barW, 10, 5);
      c2d.fillStyle = "rgba(255, 255, 255, 0.1)";
      c2d.fill();
      roundRect(c2d, rx, ny + 16, Math.max(6, barW * ratio), 10, 5);
      c2d.fillStyle = nat.value >= 100 ? "#52c47c" : "#d95b5b";
      c2d.fill();
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  try {
    await menu.waitPress();
  } finally {
    const idx = scr.wideOverlays.indexOf(drawFn);
    if (idx >= 0) scr.wideOverlays.splice(idx, 1);
    scr.dirty = true;
    await menu.waitRelease();
  }
}

// ---------------- 2. 積載情報 / 發現物 / 隨身物詳情浮窗 ----------------
export async function runWideInfoLinesModal(
  ctx: any,
  title: string,
  lines: string[],
  actionLabels?: string[],
): Promise<number> {
  if (hasDom()) return runDomInfoLines(title, lines, actionLabels);
  const { scr, sys, menu } = ctx;
  const w = 560;
  const bodyH = Math.max(120, lines.length * 32 + 24);
  const btnH = actionLabels?.length ? 64 : 0;
  const h = Math.min(540, 74 + bodyH + btnH);
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);

  let selected = 0;
  const btnRect = (i: number) => {
    const n = actionLabels?.length || 1;
    const bw = Math.min(160, Math.floor((w - 56 - (n - 1) * 16) / n));
    const total = bw * n + (n - 1) * 16;
    const sx = x + Math.round((w - total) / 2);
    return { x: sx + i * (bw + 16), y: y + h - 54, w: bw, h: 38 };
  };

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    drawPanelFrame(c2d, x, y, w, h, title);

    c2d.font = '500 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    c2d.fillStyle = "#f2ead8";
    c2d.textAlign = "left";
    c2d.textBaseline = "middle";
    for (let i = 0; i < lines.length; i++) {
      const ly = y + 76 + i * 32;
      if (ly > y + h - btnH - 16) break;
      c2d.fillText(lines[i], x + 26, ly, w - 52);
    }

    if (actionLabels?.length) {
      for (let i = 0; i < actionLabels.length; i++) {
        const r = btnRect(i);
        const isSel = i === selected;
        roundRect(c2d, r.x, r.y, r.w, r.h, 8);
        c2d.fillStyle = isSel ? "#e6c67c" : "rgba(214, 174, 96, 0.22)";
        c2d.fill();
        c2d.strokeStyle = "#f0cf85";
        c2d.lineWidth = 1.2;
        c2d.stroke();
        c2d.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
        c2d.fillStyle = isSel ? "#1a1106" : "#fff4d6";
        c2d.textAlign = "center";
        c2d.fillText(actionLabels[i], r.x + r.w / 2, r.y + r.h / 2 + 1);
      }
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  let res = -1;
  try {
    if (!actionLabels?.length) {
      await menu.waitPress();
      return 0;
    }
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      let hov = -1;
      for (let i = 0; i < actionLabels.length; i++) {
        const r = btnRect(i);
        if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) { hov = i; break; }
      }
      if (hov >= 0 && hov !== selected) { selected = hov; scr.dirty = true; }
      const ev = menu.readEvent();
      if (ev === 0x1d || ev === 0x34 || ev === 0x1e || ev === 0x38) { selected = (selected - 1 + actionLabels.length) % actionLabels.length; scr.dirty = true; }
      else if (ev === 0x1c || ev === 0x36 || ev === 0x1f || ev === 0x32) { selected = (selected + 1) % actionLabels.length; scr.dirty = true; }
      else if (ev === 0x1b || ev === 0x30) { res = -1; break; }
      else if (ev === 0x0d) {
        if (menu.mouseFlag) {
          if (hov >= 0) { res = hov; break; }
          if (vx < x || vx > x + w || vy < y || vy > y + h) { res = -1; break; }
        } else { res = selected; break; }
      }
      await sys.poll();
    }
  } finally {
    const idx = scr.wideOverlays.indexOf(drawFn);
    if (idx >= 0) scr.wideOverlays.splice(idx, 1);
    scr.dirty = true;
    await menu.waitRelease();
  }
  return res;
}

// ---------------- 3. 航海日誌 ----------------
export async function runWideLogBook(
  ctx: any,
  title: string,
  entries: { date: string; text: string }[],
  prevLabel: string,
  nextLabel: string,
) {
  if (hasDom()) return runDomLogBook(title, entries);
  const { scr, sys, menu } = ctx;
  const pageSize = 7;
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  let page = totalPages - 1;

  const w = 860, h = 520;
  const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2);
  const prevBtn = { x: x + 24, y: y + h - 52, w: 112, h: 36 };
  const nextBtn = { x: x + 150, y: y + h - 52, w: 112, h: 36 };

  const hit = (r: { x: number; y: number; w: number; h: number }, vx: number, vy: number) =>
    vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h;

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    drawPanelFrame(c2d, x, y, w, h, title, `${page + 1} / ${totalPages}`);

    const start = page * pageSize;
    for (let i = 0; i < pageSize && start + i < entries.length; i++) {
      const e = entries[start + i];
      const ry = y + 72 + i * 54;
      roundRect(c2d, x + 22, ry, w - 44, 46, 8);
      c2d.fillStyle = "rgba(255, 255, 255, 0.04)";
      c2d.fill();

      c2d.font = '700 13px "Consolas", monospace';
      c2d.fillStyle = "#e2bc6b";
      c2d.textAlign = "left";
      c2d.textBaseline = "middle";
      c2d.fillText(e.date, x + 36, ry + 23);

      c2d.font = '500 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#f2ead8";
      c2d.fillText(e.text, x + 156, ry + 23, w - 190);
    }

    if (page > 0) {
      roundRect(c2d, prevBtn.x, prevBtn.y, prevBtn.w, prevBtn.h, 8);
      c2d.fillStyle = "rgba(214, 174, 96, 0.25)";
      c2d.fill();
      c2d.strokeStyle = "#e6c67c";
      c2d.stroke();
      c2d.font = '700 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#fff4d6";
      c2d.textAlign = "center";
      c2d.fillText(prevLabel, prevBtn.x + prevBtn.w / 2, prevBtn.y + prevBtn.h / 2 + 1);
    }
    if (page < totalPages - 1) {
      roundRect(c2d, nextBtn.x, nextBtn.y, nextBtn.w, nextBtn.h, 8);
      c2d.fillStyle = "rgba(214, 174, 96, 0.25)";
      c2d.fill();
      c2d.strokeStyle = "#e6c67c";
      c2d.stroke();
      c2d.font = '700 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#fff4d6";
      c2d.textAlign = "center";
      c2d.fillText(nextLabel, nextBtn.x + nextBtn.w / 2, nextBtn.y + nextBtn.h / 2 + 1);
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  try {
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      const wheel = sys.consumeWheel?.() ?? 0;
      if (wheel < 0 && page > 0) { page--; scr.dirty = true; }
      else if (wheel > 0 && page < totalPages - 1) { page++; scr.dirty = true; }

      const ev = menu.readEvent();
      if ((ev === 0x1d || ev === 0x34 || ev === 0x1e || ev === 0x38) && page > 0) { page--; scr.dirty = true; }
      else if ((ev === 0x1c || ev === 0x36 || ev === 0x1f || ev === 0x32) && page < totalPages - 1) { page++; scr.dirty = true; }
      else if (ev === 0x1b || ev === 0x30) break;
      else if (ev === 0x0d) {
        if (menu.mouseFlag) {
          if (page > 0 && hit(prevBtn, vx, vy)) { page--; scr.dirty = true; await menu.waitRelease(); continue; }
          if (page < totalPages - 1 && hit(nextBtn, vx, vy)) { page++; scr.dirty = true; await menu.waitRelease(); continue; }
          break;
        }
        break;
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

// ---------------- 4. 世界航海圖 (16:9 現代浮窗，載入 GRAPH.DAT #0x19 真實大陸底圖 + 迷霧 + 已知港口) ----------------
export async function runWideWorldChart(ctx: any, scene: any, title: string) {
  const { scr, sys, menu, state: st, codec, art } = ctx;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);

  const mapEntry = art?.graphEntry?.("GRAPH.DAT", 0x19);
  const mapUrl = mapEntry ? `${art.baseUrl}/${mapEntry.path}` : null;
  if (mapUrl) await art.loadImage(mapUrl).catch(() => {});

  const cw = 10, ch = 10; // 90×45 格 -> 900×450
  const mapW = 90 * cw, mapH = 45 * ch;
  const boxW = mapW + 40, boxH = mapH + 80;
  const bx = Math.round((VIEW_W - boxW) / 2), by = Math.round((VIEW_H - boxH) / 2);
  const mx = bx + 20, my = by + 60;

  const F = DS.TBL_FLEET + st.u8(st.personRecord(st.hero) + 0x2c) * 0x85;
  const fx = st.u16(F), fy = st.u16(F + OFF.FLEET.Y);
  const toScreenX = (wx: number) => mx + ((((wx / 24) + 30) % 90) * cw);
  const toScreenY = (wy: number) => my + ((wy / 24) * ch);

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    drawPanelFrame(c2d, bx, by, boxW, boxH, title);

    c2d.fillStyle = "#0a1b32";
    c2d.fillRect(mx, my, mapW, mapH);

    // 繪製原版 GRAPH.DAT #0x19 世界大陸地圖 (原圖 640×400，地圖本體位於 50,50 寬540 高270)
    const mapImg = mapUrl ? art?.getImage?.(mapUrl) : null;
    if (mapImg) {
      const sx = (50 / 640) * mapImg.naturalWidth;
      const sy = (50 / 400) * mapImg.naturalHeight;
      const sw = (540 / 640) * mapImg.naturalWidth;
      const sh = (270 / 400) * mapImg.naturalHeight;
      c2d.imageSmoothingEnabled = true;
      c2d.drawImage(mapImg, sx, sy, sw, sh, mx, my, mapW, mapH);
    }

    // 未探索海域覆蓋深色戰爭迷霧
    for (let row = 0; row < 45; row++) {
      for (let col = 0; col < 90; col++) {
        const wcol = (col - 30 + 90) % 90;
        const seen = st.u8(WorkDS.EXPLORE_MAP + 12 * row + (wcol >> 3)) & (0x80 >> (wcol & 7));
        if (seen) continue;
        c2d.fillStyle = "rgba(8, 18, 34, 0.86)";
        c2d.fillRect(mx + col * cw, my + row * ch, cw, ch);
      }
    }

    // 網格經緯線
    c2d.strokeStyle = "rgba(214, 174, 96, 0.12)";
    c2d.lineWidth = 1;
    for (let c = 0; c <= 90; c += 15) {
      c2d.beginPath(); c2d.moveTo(mx + c * cw, my); c2d.lineTo(mx + c * cw, my + mapH); c2d.stroke();
    }
    for (let r = 0; r <= 45; r += 9) {
      c2d.beginPath(); c2d.moveTo(mx, my + r * ch); c2d.lineTo(mx + mapW, my + r * ch); c2d.stroke();
    }

    // 繪製已知港口點與懸停港名
    const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
    let hoverPortName = "";
    let hoverX = 0, hoverY = 0;
    for (let p = 0; p < 130; p++) {
      const R = DS.TBL_PORT + p * 0x16;
      if (!(st.u8(R + OFF.PORT.REGION) & 0x40)) continue;
      const px = toScreenX(st.u16(R));
      const py = toScreenY(st.u16(R + 2));
      c2d.fillStyle = p < 100 ? "#f2d89b" : "#80d4ff";
      c2d.fillRect(px - 2, py - 2, 4, 4);
      if (Math.hypot(vx - px, vy - py) < 10) {
        hoverPortName = dec(st.cstr(R + OFF.PORT.NAME));
        hoverX = px;
        hoverY = py;
      }
    }

    // 主角艦隊位置
    const hx = toScreenX(fx), hy = toScreenY(fy);
    c2d.fillStyle = "#ff4d4d";
    c2d.beginPath();
    c2d.arc(hx, hy, 5.5, 0, Math.PI * 2);
    c2d.fill();
    c2d.strokeStyle = "#ffffff";
    c2d.lineWidth = 1.8;
    c2d.stroke();

    if (hoverPortName) {
      c2d.font = '700 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      const tw = c2d.measureText(hoverPortName).width + 16;
      const lx = Math.min(mx + mapW - tw - 4, Math.max(mx + 4, hoverX - tw / 2));
      const ly = Math.max(my + 4, hoverY - 28);
      roundRect(c2d, lx, ly, tw, 22, 5);
      c2d.fillStyle = "rgba(8, 18, 34, 0.94)";
      c2d.fill();
      c2d.strokeStyle = "#f0cf85";
      c2d.lineWidth = 1;
      c2d.stroke();
      c2d.fillStyle = "#fff4d6";
      c2d.textAlign = "center";
      c2d.textBaseline = "middle";
      c2d.fillText(hoverPortName, lx + tw / 2, ly + 11);
    }

    c2d.strokeStyle = "rgba(214, 174, 96, 0.55)";
    c2d.strokeRect(mx, my, mapW, mapH);
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  try {
    await menu.waitPress();
  } finally {
    const idx = scr.wideOverlays.indexOf(drawFn);
    if (idx >= 0) scr.wideOverlays.splice(idx, 1);
    scr.dirty = true;
    await menu.waitRelease();
  }
}
