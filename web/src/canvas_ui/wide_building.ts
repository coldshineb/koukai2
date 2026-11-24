// canvas_ui/wide_building.ts — 原生 16:9 (1280×720) 現代港內浮動建築視窗
// 直接在港口地圖上彈出建築視窗（不黑屏、不切換全螢幕場景），保留原版建築名/港名/金幣與高清建築插圖。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { renderWidePort } from "./wide_world.ts";

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

export function renderWideBuilding(
  ctx: CanvasRenderingContext2D,
  scr: any,
  portScene: any,
  buildingKind: number,
  bldPicId: number,
) {
  const c = portScene.c;
  const m = c.state.model;
  const art = c.art;

  // 1. 背景保留即時港口地圖，覆蓋柔暗半透明遮罩（零黑屏過場）
  renderWidePort(ctx, scr, portScene);
  ctx.save();
  ctx.fillStyle = "rgba(5, 11, 22, 0.56)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 2. 中央浮動現代建築主視窗 (底部預留空間給 wideDialog)
  const wx = 56, wy = 66, ww = VIEW_W - 112, wh = 468;
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, wx, wy, ww, wh, 14);
  const bg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  bg.addColorStop(0, "rgba(15, 31, 54, 0.96)");
  bg.addColorStop(1, "rgba(8, 17, 32, 0.98)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(214, 174, 96, 0.85)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 3. 頂部標題欄 (100% 原版建築名 + 港名 + 金塊/金幣)
  const bldLabels = c.menuItems?.(0x3a);
  const bldName = bldLabels?.[buildingKind] ? decodeCstr(c.codec, bldLabels[buildingKind]) : "";
  const portName = decodeCstr(c.codec, m.port(portScene.port).nameBytes);
  const money = m.globals.money;
  const bars = Math.trunc(money / 10000);
  const gold = money % 10000;

  ctx.strokeStyle = "rgba(214, 174, 96, 0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(wx + 18, wy + 48);
  ctx.lineTo(wx + ww - 18, wy + 48);
  ctx.stroke();

  ctx.font = '700 18px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#f2d89b";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(bldName ? `${portName} · ${bldName}` : portName, wx + 24, wy + 25);

  ctx.font = '600 14px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.textAlign = "right";
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(`金塊 ${bars}    金幣 ${gold}`, wx + ww - 24, wy + 25);

  // 4. 左側高清建築插圖框 (136×112 -> 384×316)
  const entry = art?.graphEntry?.("GRAPH.DAT", bldPicId);
  const img = entry ? art.getImage(`${art.baseUrl}/${entry.path}`) : null;
  const bw = 384, bh = 316;
  const bx = wx + 28, by = wy + 72;

  roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 10);
  ctx.fillStyle = "#1b140c";
  ctx.fill();
  ctx.strokeStyle = "rgba(214, 174, 96, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (img) {
    ctx.imageSmoothingEnabled = (img.naturalWidth || 136) > 136;
    ctx.drawImage(img, bx, by, bw, bh);
  }

  ctx.restore();
}
