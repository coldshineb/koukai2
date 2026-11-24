// canvas_ui/wide_building.ts — 原生 16:9 (1280×720) 現代 Canvas 2D 建築內景畫布
// 取代 1993 重複磚塊底紋 wallpaper(1)，大尺寸居中展示高清建築內景並保留頂部港名/金幣資訊。
import { VIEW_W, VIEW_H } from "../core/screen.js";

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

export function renderWideBuilding(ctx: CanvasRenderingContext2D, portScene: any, bldPicId: number) {
  const c = portScene.c;
  const m = c.state.model;
  const art = c.art;

  ctx.save();
  // 深海木質溫潤背景漸層
  const bg = ctx.createRadialGradient(VIEW_W * 0.42, VIEW_H * 0.42, 60, VIEW_W * 0.5, VIEW_H * 0.5, VIEW_W * 0.72);
  bg.addColorStop(0, "#19304d");
  bg.addColorStop(0.6, "#0d1b30");
  bg.addColorStop(1, "#060d18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 頂部精簡狀態條 (100% 原版港名/金塊/金幣)
  const portName = decodeCstr(c.codec, m.port(portScene.port).nameBytes);
  const money = m.globals.money;
  const bars = Math.trunc(money / 10000);
  const gold = money % 10000;

  roundRect(ctx, 18, 14, VIEW_W - 36, 46, 8);
  ctx.fillStyle = "rgba(10, 21, 37, 0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(208, 169, 94, 0.65)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = '700 17px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#f2d89b";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(portName, 36, 38);

  ctx.font = '600 14px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.textAlign = "right";
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(`金塊 ${bars}    金幣 ${gold}`, VIEW_W - 36, 38);

  // 中央偏左高清建築內景畫框 (136×112 等比放大至 408×336)
  const entry = art?.graphEntry?.("GRAPH.DAT", bldPicId);
  const img = entry ? art.getImage(`${art.baseUrl}/${entry.path}`) : null;
  const bw = 408, bh = 336;
  const bx = 96, by = 88;

  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, bx - 6, by - 6, bw + 12, bh + 12, 10);
  ctx.fillStyle = "#2b1c0e";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#cfa85b";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (img) {
    ctx.imageSmoothingEnabled = (img.naturalWidth || 136) > 136;
    ctx.drawImage(img, bx, by, bw, bh);
  }

  ctx.restore();
}
