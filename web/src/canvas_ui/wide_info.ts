// canvas_ui/wide_info.ts — Stage 3B: 原生 16:9 (1280×720) 現代 Canvas 2D 艦船情報 & 人物情報詳細頁
// 零 DOM、100% 沿用原版 message.json / menuItems(0x29) / port.json 欄位文字。
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideShipInfoData {
  typeId: number;
  figureheadId: number;
  supplies: number[]; // [水, 糧, 資材, 砲彈]
  leftLines: string[]; // 100% 原版格式化輸出列 (船級 / 船名 / 船長 / 火砲 / 水手配置 / 載重 / 速度)
  bars: Array<{ label: string; cur: number; max: number }>; // 7 項進度條 (來自 MENU #0x29)
}

export interface WidePersonInfoData {
  faceId: number;
  headerLines: string[]; // 所乘船 / 職務 / 姓名 / 年齡
  stats: Array<{ label: string; val: number }>; // 7 項能力
  detailLines: string[]; // 爵位/酬金/經驗/等級/技能等原版列
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

function drawBackdrop(ctx: CanvasRenderingContext2D) {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, "#0b1a30");
  bg.addColorStop(0.55, "#112847");
  bg.addColorStop(1, "#071120");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, 12);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "rgba(15, 31, 54, 0.94)");
  g.addColorStop(1, "rgba(9, 19, 34, 0.97)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(214, 174, 96, 0.82)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawWideShipInfo(ctx: CanvasRenderingContext2D, art: any, d: WideShipInfoData) {
  ctx.save();
  drawBackdrop(ctx);

  const px = 84, py = 48, pw = VIEW_W - 168, ph = VIEW_H - 96;
  drawCard(ctx, px, py, pw, ph);

  // 左上: 大尺寸船型圖 + 船首像
  const shipUrl = art?.shipUrl?.(d.typeId);
  const shipImg = art?.getImage?.(shipUrl);
  ctx.fillStyle = "#0a1728";
  roundRect(ctx, px + 28, py + 26, 256, 192, 8);
  ctx.fill();
  if (shipImg) {
    ctx.imageSmoothingEnabled = (shipImg.naturalWidth || 128) > 128;
    ctx.drawImage(shipImg, px + 28, py + 26, 256, 192);
  }
  ctx.strokeStyle = "#cfa85b";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (d.figureheadId > 0) {
    const fhUrl = art?.figureheadUrl?.(d.figureheadId);
    const fhImg = art?.getImage?.(fhUrl);
    ctx.fillStyle = "#0a1728";
    roundRect(ctx, px + 300, py + 26, 96, 96, 8);
    ctx.fill();
    if (fhImg) {
      ctx.imageSmoothingEnabled = (fhImg.naturalWidth || 48) > 48;
      ctx.drawImage(fhImg, px + 300, py + 26, 96, 96);
    }
    ctx.strokeStyle = "#cfa85b";
    ctx.stroke();
  }

  // 4 項補給小卡 (水/糧/資材/砲彈)
  const supSheet = art?.sheet?.("supply_icons");
  const supImg = supSheet ? art.getImage(art.sheetUrl("supply_icons")) : null;
  for (let i = 0; i < 4; i++) {
    const sx = px + 416 + (i % 2) * 124;
    const sy = py + 26 + Math.floor(i / 2) * 98;
    roundRect(ctx, sx, sy, 114, 88, 8);
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(208, 169, 94, 0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (supImg && supSheet) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(supImg, i * supSheet.tileW, 0, supSheet.tileW, supSheet.tileH, sx + 12, sy + 18, 28, 52);
    }
    ctx.font = '700 18px "Consolas", "Noto Serif TC", monospace';
    ctx.fillStyle = "#ffe5a3";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(d.supplies[i] ?? 0), sx + 102, sy + 45);
  }

  // 左下: 原版船隻詳細文字 (船級 / 船名 / 船長 / 火砲 / 水手 / 載重 / 速度)
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let ly = py + 242;
  d.leftLines.forEach((line, idx) => {
    ctx.font = idx === 0
      ? '700 19px "Noto Serif TC", "Microsoft JhengHei", serif'
      : '500 15px "Noto Serif TC", "Microsoft JhengHei", serif';
    ctx.fillStyle = idx === 0 ? "#f2d89b" : "#eadfc8";
    ctx.fillText(line, px + 32, ly, 580);
    ly += idx === 0 ? 34 : 30;
  });

  // 中央分隔線
  ctx.strokeStyle = "rgba(208, 169, 94, 0.3)";
  ctx.beginPath();
  ctx.moveTo(px + 668, py + 28);
  ctx.lineTo(px + 668, py + ph - 28);
  ctx.stroke();

  // 右側: 7 項現代進度條 (耐久 / 轉向 / 推進 / 水手 / 士氣 / 載貨 / 總載重)
  const bx = px + 698, bw = pw - 730;
  d.bars.forEach((b, i) => {
    const by = py + 44 + i * 76;
    ctx.font = '600 15px "Noto Serif TC", "Microsoft JhengHei", serif';
    ctx.fillStyle = "#f2d89b";
    ctx.textAlign = "left";
    ctx.fillText(b.label, bx, by);

    ctx.font = '600 15px "Consolas", monospace';
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.fillText(`${b.cur} / ${b.max}`, bx + bw, by);

    const ratio = Math.max(0, Math.min(1, b.max > 0 ? b.cur / b.max : 0));
    roundRect(ctx, bx, by + 26, bw, 14, 7);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fill();
    if (ratio > 0) {
      roundRect(ctx, bx, by + 26, Math.max(10, Math.round(bw * ratio)), 14, 7);
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by);
      bg.addColorStop(0, "#b88f42");
      bg.addColorStop(1, "#e6c67c");
      ctx.fillStyle = bg;
      ctx.fill();
    }
  });

  ctx.restore();
}

export function drawWidePersonInfo(ctx: CanvasRenderingContext2D, art: any, d: WidePersonInfoData) {
  ctx.save();
  drawBackdrop(ctx);

  const px = 112, py = 48, pw = VIEW_W - 224, ph = VIEW_H - 96;
  drawCard(ctx, px, py, pw, ph);

  // 左上: 大尺寸人物立繪
  const pUrl = art?.portraitUrl?.(d.faceId & 0xff);
  const pImg = art?.getImage?.(pUrl);
  ctx.fillStyle = "#0a1728";
  ctx.fillRect(px + 32, py + 28, 128, 160);
  if (pImg) {
    ctx.imageSmoothingEnabled = (pImg.naturalWidth || 64) > 64;
    ctx.drawImage(pImg, px + 32, py + 28, 128, 160);
  }
  ctx.strokeStyle = "#d4af5a";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 32, py + 28, 128, 160);

  // 頭像右側基本資料 (原版文字)
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  d.headerLines.forEach((line, i) => {
    ctx.font = i === 0
      ? '700 22px "Noto Serif TC", "Microsoft JhengHei", serif'
      : '500 16px "Noto Serif TC", "Microsoft JhengHei", serif';
    ctx.fillStyle = i === 0 ? "#f2d89b" : "#eadfc8";
    ctx.fillText(line, px + 188, py + 32 + i * 34, pw - 224);
  });

  // 橫向分隔線
  ctx.strokeStyle = "rgba(208, 169, 94, 0.3)";
  ctx.beginPath();
  ctx.moveTo(px + 32, py + 210);
  ctx.lineTo(px + pw - 32, py + 210);
  ctx.stroke();

  // 左下: 7 項能力值進度條
  const sx = px + 32, sw = 420;
  d.stats.forEach((st, i) => {
    const sy = py + 232 + i * 52;
    ctx.font = '600 15px "Noto Serif TC", "Microsoft JhengHei", serif';
    ctx.fillStyle = "#e6dcc8";
    ctx.textAlign = "left";
    ctx.fillText(st.label, sx, sy);

    ctx.font = '700 15px "Consolas", monospace';
    ctx.fillStyle = "#ffe5a3";
    ctx.textAlign = "right";
    ctx.fillText(String(st.val), sx + sw, sy);

    const ratio = Math.max(0, Math.min(1, st.val / 100));
    roundRect(ctx, sx, sy + 24, sw, 10, 5);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fill();
    if (ratio > 0) {
      roundRect(ctx, sx, sy + 24, Math.max(8, Math.round(sw * ratio)), 10, 5);
      ctx.fillStyle = st.val >= 80 ? "#e6c67c" : "#5ca4d8";
      ctx.fill();
    }
  });

  // 右下: 經驗 / 等級 / 爵位 / 技能原版列
  ctx.textAlign = "left";
  ctx.font = '500 16px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#f4ead2";
  d.detailLines.forEach((line, i) => {
    ctx.fillText(line, px + 500, py + 236 + i * 34, pw - 532);
  });

  ctx.restore();
}
