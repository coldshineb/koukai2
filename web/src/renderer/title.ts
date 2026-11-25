// renderer/title.ts — 原生 16:9 (1280×720) 标题底图渲染（深海航海渐层 + 经纬底纹，供加载/选角/设置弹窗作为统一背景）
import { VIEW_W, VIEW_H } from "../core/screen.js";

export function renderWideTitle(ctx: CanvasRenderingContext2D, _art?: any, scr?: any) {
  const vw = scr?.viewW || VIEW_W;
  const vh = scr?.viewH || VIEW_H;
  ctx.save();
  const bg = ctx.createRadialGradient(vw / 2, vh * 0.32, 30, vw / 2, vh * 0.45, Math.max(vw, vh) * 0.65);
  bg.addColorStop(0, "#1c3e68");
  bg.addColorStop(0.55, "#0d1f3a");
  bg.addColorStop(1, "#071120");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, vw, vh);

  // 淡金经纬海图线
  ctx.strokeStyle = "rgba(200, 162, 88, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 48; x < vw; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, vh); }
  for (let y = 48; y < vh; y += 48) { ctx.moveTo(0, y); ctx.lineTo(vw, y); }
  ctx.stroke();

  // 中央淡金罗盘圆环
  ctx.strokeStyle = "rgba(214, 174, 96, 0.14)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(vw / 2, vh / 2, 220, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(vw / 2, vh / 2, 165, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
