// canvas_ui/wide_newgame.ts — Stage 4: 原生 16:9 (1280×720) 現代 Canvas 2D 主角選擇畫廊
// 展示全部 6 位主角 HD 頭像、原版姓名、年齡、能力值、技能與介紹文字，零 DOM、100% 原版文本。
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideHeroCard {
  id: number;
  name: string;
  age: number;
  stats: number[];
  skill: string;
  intro: string;
  portraitUrl: string | null;
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

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const ch of para) {
      if (cur && ctx.measureText(cur + ch).width > maxW) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function getHeroCardRect(i: number) {
  const cols = 3;
  const col = i % cols;
  const row = Math.floor(i / cols);
  const w = 188, h = 236, gapX = 20, gapY = 22;
  const startX = 48, startY = 92;
  return { x: startX + col * (w + gapX), y: startY + row * (h + gapY), w, h };
}

export function renderWideNewGame(
  ctx: CanvasRenderingContext2D,
  art: any,
  heroes: WideHeroCard[],
  selected: number,
  statLabels: string[],
) {
  ctx.save();
  // 深海星夜漸層背景
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, "#081428");
  bg.addColorStop(0.5, "#102848");
  bg.addColorStop(1, "#060e1c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 左側 3×2 主角畫廊卡片
  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i];
    const r = getHeroCardRect(i);
    const isSel = i === selected;

    ctx.shadowColor = isSel ? "rgba(232, 194, 114, 0.32)" : "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = isSel ? 22 : 12;
    ctx.shadowOffsetY = 5;
    roundRect(ctx, r.x, r.y, r.w, r.h, 12);
    const cg = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    cg.addColorStop(0, isSel ? "rgba(32, 58, 94, 0.96)" : "rgba(15, 31, 54, 0.90)");
    cg.addColorStop(1, isSel ? "rgba(18, 34, 60, 0.98)" : "rgba(9, 19, 36, 0.94)");
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.shadowColor = "transparent";

    ctx.strokeStyle = isSel ? "#f0cf85" : "rgba(214, 174, 96, 0.45)";
    ctx.lineWidth = isSel ? 2.2 : 1.2;
    ctx.stroke();

    // 頭像 (64×80 -> 128×160)
    const px = r.x + Math.round((r.w - 128) / 2);
    const py = r.y + 16;
    ctx.fillStyle = "#08111e";
    ctx.fillRect(px, py, 128, 160);
    const img = h.portraitUrl ? art?.getImage?.(h.portraitUrl) : null;
    if (img) {
      ctx.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
      ctx.drawImage(img, px, py, 128, 160);
    }
    ctx.strokeStyle = isSel ? "rgba(240, 207, 133, 0.9)" : "rgba(214, 174, 96, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, 128, 160);

    // 姓名
    ctx.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = isSel ? "#fff4d6" : "#eadfc8";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(h.name, r.x + r.w / 2, r.y + 206, r.w - 16);
  }

  // 右側主角詳情面板
  const cur = heroes[selected] || heroes[0];
  if (cur) {
    const dx = 678, dy = 92, dw = VIEW_W - dx - 48, dh = 494;
    ctx.shadowColor = "rgba(0, 0, 0, 0.52)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, dx, dy, dw, dh, 14);
    const dg = ctx.createLinearGradient(dx, dy, dx, dy + dh);
    dg.addColorStop(0, "rgba(15, 31, 54, 0.95)");
    dg.addColorStop(1, "rgba(8, 17, 32, 0.98)");
    ctx.fillStyle = dg;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(214, 174, 96, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 詳情頁大頭像
    const px = dx + 26, py = dy + 26;
    ctx.fillStyle = "#08111e";
    ctx.fillRect(px, py, 112, 140);
    const img = cur.portraitUrl ? art?.getImage?.(cur.portraitUrl) : null;
    if (img) {
      ctx.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
      ctx.drawImage(img, px, py, 112, 140);
    }
    ctx.strokeStyle = "rgba(214, 174, 96, 0.8)";
    ctx.strokeRect(px, py, 112, 140);

    // 姓名 + 年齡 + 技能
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = '700 22px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#fff4d6";
    ctx.fillText(cur.name, dx + 158, dy + 28, dw - 180);

    ctx.font = '600 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#d8c394";
    ctx.fillText(`${cur.age}   ${cur.skill}`, dx + 158, dy + 64, dw - 180);

    // 7 項能力值
    for (let i = 0; i < cur.stats.length; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const sx = dx + 158 + col * 180;
      const sy = dy + 100 + row * 28;
      ctx.font = '500 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      ctx.fillStyle = "#b8c7d9";
      ctx.textAlign = "left";
      ctx.fillText(statLabels[i] || "", sx, sy);
      ctx.font = '700 15px "Consolas", monospace';
      ctx.fillStyle = "#f2d89b";
      ctx.textAlign = "right";
      ctx.fillText(String(cur.stats[i]), sx + 148, sy);
    }

    // 分隔線
    ctx.strokeStyle = "rgba(214, 174, 96, 0.35)";
    ctx.beginPath();
    ctx.moveTo(dx + 24, dy + 226);
    ctx.lineTo(dx + dw - 24, dy + 226);
    ctx.stroke();

    // 原版主角介紹文字
    ctx.font = '500 16px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    ctx.fillStyle = "#f2ead8";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lines = wrapText(ctx, cur.intro, dw - 52);
    for (let i = 0; i < lines.length && i < 8; i++) {
      ctx.fillText(lines[i], dx + 26, dy + 244 + i * 28);
    }
  }

  ctx.restore();
}

export function hitWideHeroCard(vx: number, vy: number, count: number): number {
  for (let i = 0; i < count; i++) {
    const r = getHeroCardRect(i);
    if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) return i;
  }
  return -1;
}
