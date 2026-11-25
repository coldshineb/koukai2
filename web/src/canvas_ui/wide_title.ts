// canvas_ui/wide_title.ts — 原生 16:9 (1280×720) 標題底圖渲染（深海航海漸層 + 經緯底紋，供載入/選角/設定彈窗作為統一背景）
import { VIEW_W, VIEW_H } from "../core/screen.js";

export function renderWideTitle(ctx: CanvasRenderingContext2D, _art?: any) {
  ctx.save();
  const bg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.32, 30, VIEW_W / 2, VIEW_H * 0.45, VIEW_W * 0.65);
  bg.addColorStop(0, "#1c3e68");
  bg.addColorStop(0.55, "#0d1f3a");
  bg.addColorStop(1, "#071120");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 淡金經緯海圖線
  ctx.strokeStyle = "rgba(200, 162, 88, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 48; x < VIEW_W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, VIEW_H); }
  for (let y = 48; y < VIEW_H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(VIEW_W, y); }
  ctx.stroke();

  // 中央淡金羅盤圓環
  ctx.strokeStyle = "rgba(214, 174, 96, 0.14)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(VIEW_W / 2, VIEW_H / 2, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(VIEW_W / 2, VIEW_H / 2, 165, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
