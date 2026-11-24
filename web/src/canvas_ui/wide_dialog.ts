// canvas_ui/wide_dialog.ts — 原生 16:9 (1280×720) 現代精簡底部對話條 (零 DOM、100% 原版文本)
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { UI_FONT } from "./text_util.ts";

export interface WideDialogState {
  text: string;
  portraitId: number | null; // 0..127 具名頭像，null 為無頭像
  portraitComposed?: { type: number; parts: number } | null; // 5 層拼合頭像 (無名人物 / 隨機航海士)
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
  const w = 920;
  const x = Math.round((VIEW_W - w) / 2);
  const h = d.portraitId !== null ? 132 : 112;
  const y = VIEW_H - h - 22;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, 12);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "rgba(15, 30, 52, 0.96)");
  g.addColorStop(1, "rgba(8, 17, 31, 0.98)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(218, 178, 102, 0.86)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  let textX = x + 28;
  if (d.portraitId !== null && d.portraitId >= 0 && d.portraitId < 128) {
    const px = x + 20, py = y + 14, pw = 84, ph = 104;
    ctx.fillStyle = "#0b1626";
    ctx.fillRect(px, py, pw, ph);
    const url = art?.portraitUrl?.(d.portraitId);
    const img = art?.getImage?.(url);
    if (img) {
      ctx.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
      ctx.drawImage(img, px, py, pw, ph);
    }
    ctx.strokeStyle = "#d4af5a";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(px, py, pw, ph);
    textX = px + pw + 22;
  }

  const maxW = x + w - textX - 36;
  ctx.font = `500 17px ${UI_FONT}`;
  ctx.fillStyle = "#f5ecd8";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = wrapLines(ctx, d.text, maxW);
  const lineH = 28;
  const startY = lines.length === 1 ? y + Math.round((h - 22) / 2) : y + 18;
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    ctx.fillText(lines[i], textX, startY + i * lineH, maxW);
  }

  if (d.waiting) {
    const t = typeof performance !== "undefined" ? performance.now() * 0.006 : 0;
    const bob = Math.sin(t) * 3;
    const ax = x + w - 26, ay = y + h - 20 + bob;
    ctx.fillStyle = "#e6c67c";
    ctx.beginPath();
    ctx.moveTo(ax - 6, ay - 4);
    ctx.lineTo(ax + 6, ay - 4);
    ctx.lineTo(ax, ay + 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
