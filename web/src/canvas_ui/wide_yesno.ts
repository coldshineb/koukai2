// canvas_ui/wide_yesno.ts — 原生 16:9 (1280×720) 現代 Canvas 2D「是 / 否」確認框
// 零 DOM、100% 原版「是」「否」二字，取代原版 GRAPH.DAT #0 像素確認框。
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideYesNoState {
  selected: 0 | 1; // 0 = 是, 1 = 否
  x: number;
  y: number;
  w: number;
  h: number;
  btns: Array<{ x: number; y: number; w: number; h: number; label: string }>;
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

export function createWideYesNoState(): WideYesNoState {
  const w = 280, h = 92;
  const x = Math.round((VIEW_W - w) / 2);
  const y = Math.round((VIEW_H - h) / 2);
  const bw = 112, bh = 46, gap = 20;
  const bx0 = x + Math.round((w - (bw * 2 + gap)) / 2);
  const by = y + Math.round((h - bh) / 2);
  return {
    selected: 0,
    x, y, w, h,
    btns: [
      { x: bx0, y: by, w: bw, h: bh, label: "是" },
      { x: bx0 + bw + gap, y: by, w: bw, h: bh, label: "否" },
    ],
  };
}

export function hitWideYesNo(s: WideYesNoState, vx: number, vy: number): -1 | 0 | 1 {
  for (let i = 0; i < 2; i++) {
    const b = s.btns[i];
    if (vx >= b.x && vx <= b.x + b.w && vy >= b.y && vy <= b.y + b.h) return i as 0 | 1;
  }
  return -1;
}

export function drawWideYesNo(ctx: CanvasRenderingContext2D, s: WideYesNoState) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, s.x, s.y, s.w, s.h, 12);
  const g = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
  g.addColorStop(0, "rgba(16, 33, 56, 0.96)");
  g.addColorStop(1, "rgba(9, 19, 34, 0.98)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(218, 178, 102, 0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '700 18px "Noto Serif TC", "Microsoft JhengHei", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 2; i++) {
    const b = s.btns[i];
    const sel = s.selected === i;
    roundRect(ctx, b.x, b.y, b.w, b.h, 8);
    if (sel) {
      const bg = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      bg.addColorStop(0, "#e6c67c");
      bg.addColorStop(1, "#b88f42");
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = "#fff1c6";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#1a1106";
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fill();
      ctx.strokeStyle = "rgba(208, 169, 94, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#eadfc8";
    }
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }
  ctx.restore();
}
