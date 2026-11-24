// canvas_ui/wide_dialog.ts — 原生 16:9 (1280×720) 現代底部寬幅對話欄 (零 DOM、100% 原版文本)
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideDialogState {
  text: string;
  portraitId: number | null; // 0..127 具名頭像，null 為無頭像
  waiting: boolean;
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

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const ch of para) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxW && line.length > 0) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line.length > 0 || para.length === 0) out.push(line);
  }
  return out;
}

export function drawWideDialog(ctx: CanvasRenderingContext2D, art: any, d: WideDialogState) {
  if (!d || (!d.text && d.portraitId === null)) return;
  const x = 64, w = VIEW_W - 128, h = 158, y = VIEW_H - h - 22;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.62)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, 12);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "rgba(13, 27, 46, 0.94)");
  g.addColorStop(1, "rgba(7, 15, 28, 0.97)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(218, 178, 102, 0.88)";
  ctx.lineWidth = 2;
  ctx.stroke();

  let textX = x + 32;
  if (d.portraitId !== null && d.portraitId >= 0 && d.portraitId < 128) {
    const px = x + 24, py = y + 19, pw = 96, ph = 120;
    ctx.fillStyle = "#0b1626";
    ctx.fillRect(px, py, pw, ph);
    const url = art?.portraitUrl?.(d.portraitId);
    const img = art?.getImage?.(url);
    if (img) {
      ctx.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
      ctx.drawImage(img, px, py, pw, ph);
    }
    ctx.strokeStyle = "#d4af5a";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);
    textX = px + pw + 26;
  }

  const maxW = x + w - textX - 36;
  ctx.font = '500 18px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.fillStyle = "#f4ead2";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = wrapLines(ctx, d.text, maxW);
  const lineH = 30;
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    ctx.fillText(lines[i], textX, y + 24 + i * lineH, maxW);
  }

  // 等待按鍵動畫指示箭頭
  if (d.waiting) {
    const t = typeof performance !== "undefined" ? performance.now() * 0.006 : 0;
    const bob = Math.sin(t) * 3;
    const ax = x + w - 28, ay = y + h - 22 + bob;
    ctx.fillStyle = "#e6c67c";
    ctx.beginPath();
    ctx.moveTo(ax - 7, ay - 5);
    ctx.lineTo(ax + 7, ay - 5);
    ctx.lineTo(ax, ay + 5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
