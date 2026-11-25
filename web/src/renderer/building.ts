// renderer/building.ts — 原生 16:9 (1280×720) 现代港内浮动建筑窗口
// 紧凑平衡的双栏建筑卡片：左侧高清建筑插画、右侧交互菜单/表格区，底部与精简对话条对齐，零黑屏过场。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { renderWidePort } from "./world.ts";
import { decodeCleanCstr, UI_FONT, MONO_FONT } from "../ui/text_util.ts";

export const BLD_CARD = { x: 180, y: 66, w: 920, h: 432 };

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

  const vw = scr?.viewW || VIEW_W;
  const vh = scr?.viewH || VIEW_H;

  // 1. 背景保留实时港口地图 + 柔和暗角遮罩
  renderWidePort(ctx, scr, portScene);
  ctx.save();
  ctx.fillStyle = "rgba(4, 10, 20, 0.62)";
  ctx.fillRect(0, 0, vw, vh);

  // 2. 紧凑双栏建筑主卡片
  const ww = BLD_CARD.w, wh = BLD_CARD.h;
  const wx = Math.round((vw - ww) / 2);
  const wy = Math.max(16, Math.min(vh - wh - 16, Math.round((vh - wh) / 2 - 40)));
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, wx, wy, ww, wh, 14);
  const bg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  bg.addColorStop(0, "rgba(18, 34, 58, 0.97)");
  bg.addColorStop(1, "rgba(10, 20, 36, 0.99)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 顶部标题栏微渐层
  roundRect(ctx, wx + 1, wy + 1, ww - 2, 52, 13);
  const hdrBg = ctx.createLinearGradient(wx, wy, wx + ww, wy);
  hdrBg.addColorStop(0, "rgba(218, 178, 102, 0.14)");
  hdrBg.addColorStop(1, "rgba(218, 178, 102, 0.03)");
  ctx.fillStyle = hdrBg;
  ctx.fill();

  ctx.strokeStyle = "rgba(218, 178, 102, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(wx + 20, wy + 54);
  ctx.lineTo(wx + ww - 20, wy + 54);
  ctx.stroke();

  const bldLabels = c.menuItems?.(0x3a);
  const bldName = bldLabels?.[buildingKind] ? decodeCleanCstr(c.codec, bldLabels[buildingKind]) : "";
  const portName = decodeCleanCstr(c.codec, m.port(portScene.port).nameBytes);
  const money = m.globals.money;
  const bars = Math.trunc(money / 10000);
  const gold = money % 10000;

  ctx.font = `700 18px ${UI_FONT}`;
  ctx.fillStyle = "#f7dfa4";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(bldName ? `${portName} · ${bldName}` : portName, wx + 26, wy + 28);

  // 右上金块/金币胶囊
  const badgeText = `金块 ${bars}   金币 ${gold}`;
  ctx.font = `600 14px ${MONO_FONT}`;
  const bwBadge = ctx.measureText(badgeText).width + 26;
  roundRect(ctx, wx + ww - bwBadge - 22, wy + 13, bwBadge, 28, 14);
  ctx.fillStyle = "rgba(8, 16, 30, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(218, 178, 102, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#f4d78e";
  ctx.textAlign = "center";
  ctx.fillText(badgeText, wx + ww - bwBadge / 2 - 22, wy + 28);

  // 左侧高清建筑插画 (136×112 -> 408×336)
  const entry = art?.graphEntry?.("GRAPH.DAT", bldPicId);
  const img = entry ? art.getImage(`${art.baseUrl}/${entry.path}`) : null;
  const bw = 408, bh = 336;
  const bx = wx + 26, by = wy + 74;

  roundRect(ctx, bx - 3, by - 3, bw + 6, bh + 6, 10);
  ctx.fillStyle = "#140f0a";
  ctx.fill();
  ctx.strokeStyle = "rgba(218, 178, 102, 0.78)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (img) {
    ctx.imageSmoothingEnabled = (img.naturalWidth || 136) > 136;
    ctx.drawImage(img, bx, by, bw, bh);
  }

  // 右侧区块微妙分隔线
  ctx.strokeStyle = "rgba(218, 178, 102, 0.18)";
  ctx.beginPath();
  ctx.moveTo(bx + bw + 24, wy + 72);
  ctx.lineTo(bx + bw + 24, wy + wh - 22);
  ctx.stroke();

  ctx.restore();
}
