// canvas_ui/wide_fleet.ts — 原生 16:9 (1280×720) 現代 Canvas 2D 自艦隊情報畫面
// 零 DOM、100% 沿用原版 message.json (0x397..0x39d) 與船隻/提督資料。
import { DS, OFF } from "../model/schema_views.ts";
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideFleetShipCard {
  name: string;
  typeId: number;
  dur: number;
  maxDur: number;
  crew: number;
  guns: number;
}

export interface WideFleetViewData {
  ships: WideFleetShipCard[];
  admiralFace: number;
  lineAdmiral: string;
  lineNav: string;
  lineBat: string;
  lineTurnCrew: string;
  linePropGuns: string;
  lineDurPower: string;
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

export function drawWideFleetView(ctx: CanvasRenderingContext2D, art: any, data: WideFleetViewData) {
  ctx.save();
  // 深海航海背景漸層
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, "#0b1a30");
  bg.addColorStop(0.65, "#102744");
  bg.addColorStop(1, "#081222");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 上方船隊卡片畫廊 (最多 10 艘，2 列 × 5 欄)
  const cols = 5;
  const cardW = 228, cardH = 196, gapX = 18, gapY = 18;
  const totalW = cols * cardW + (cols - 1) * gapX;
  const startX = Math.round((VIEW_W - totalW) / 2);
  const startY = 36;

  data.ships.forEach((s, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    roundRect(ctx, x, y, cardW, cardH, 10);
    const cg = ctx.createLinearGradient(x, y, x, y + cardH);
    cg.addColorStop(0, "rgba(18, 38, 66, 0.9)");
    cg.addColorStop(1, "rgba(10, 22, 40, 0.94)");
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = "rgba(208, 169, 94, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 船型圖
    const shipUrl = art?.shipUrl?.(s.typeId);
    const shipImg = art?.getImage?.(shipUrl);
    if (shipImg) {
      ctx.imageSmoothingEnabled = (shipImg.naturalWidth || 128) > 128;
      ctx.drawImage(shipImg, x + Math.round((cardW - 160) / 2), y + 12, 160, 120);
    }

    // 船名 (原版名)
    ctx.font = '700 15px "Noto Serif TC", "Microsoft JhengHei", serif';
    ctx.fillStyle = "#f2d89b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.name, x + cardW / 2, y + 148, cardW - 18);

    // 耐久條
    const barX = x + 18, barY = y + 166, barW = cardW - 36, barH = 8;
    const ratio = Math.max(0, Math.min(1, s.maxDur ? s.dur / s.maxDur : 1));
    roundRect(ctx, barX, barY, barW, barH, 4);
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.fill();
    if (ratio > 0) {
      roundRect(ctx, barX, barY, Math.max(6, Math.round(barW * ratio)), barH, 4);
      ctx.fillStyle = ratio > 0.5 ? "#43b57d" : ratio > 0.25 ? "#e0a53c" : "#d94b3d";
      ctx.fill();
    }
  });

  // 下方提督與艦隊總覽面板
  const botX = startX, botY = VIEW_H - 188, botW = totalW, botH = 156;
  roundRect(ctx, botX, botY, botW, botH, 12);
  const bg2 = ctx.createLinearGradient(botX, botY, botX, botY + botH);
  bg2.addColorStop(0, "rgba(14, 29, 50, 0.95)");
  bg2.addColorStop(1, "rgba(8, 17, 32, 0.98)");
  ctx.fillStyle = bg2;
  ctx.fill();
  ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 提督頭像
  const pUrl = art?.portraitUrl?.(data.admiralFace & 0xff);
  const pImg = art?.getImage?.(pUrl);
  ctx.fillStyle = "#0a1524";
  ctx.fillRect(botX + 24, botY + 18, 96, 120);
  if (pImg) {
    ctx.imageSmoothingEnabled = (pImg.naturalWidth || 64) > 64;
    ctx.drawImage(pImg, botX + 24, botY + 18, 96, 120);
  }
  ctx.strokeStyle = "#d4af5a";
  ctx.lineWidth = 2;
  ctx.strokeRect(botX + 24, botY + 18, 96, 120);

  // 左側提督資訊 (100% 原版 message 0x397..0x399)
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '700 20px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#f2d89b";
  ctx.fillText(data.lineAdmiral, botX + 144, botY + 42);

  ctx.font = '600 16px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#e6dcc8";
  ctx.fillText(data.lineNav, botX + 144, botY + 84);
  ctx.fillText(data.lineBat, botX + 144, botY + 118);

  // 分隔線
  ctx.strokeStyle = "rgba(208, 169, 94, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(botX + 430, botY + 24);
  ctx.lineTo(botX + 430, botY + botH - 24);
  ctx.stroke();

  // 右側艦隊總計 (100% 原版 message 0x39a..0x39c)
  ctx.font = '600 17px "Noto Serif TC", "Consolas", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#fff4d6";
  ctx.fillText(data.lineTurnCrew, botX + 464, botY + 44);
  ctx.fillText(data.linePropGuns, botX + 464, botY + 82);
  ctx.fillText(data.lineDurPower, botX + 464, botY + 120);

  ctx.restore();
}
