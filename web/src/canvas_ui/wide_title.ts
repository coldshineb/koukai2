// canvas_ui/wide_title.ts — Stage 4: 原生 16:9 (1280×720) 現代 Canvas 2D 標題畫面
// 直接使用原版提取的 GRAPH.DAT #0x3c 標題徽章與 #0x3e 副標 PNG，零杜撰文本。
import { VIEW_W, VIEW_H } from "../core/screen.js";

export function renderWideTitle(ctx: CanvasRenderingContext2D, art: any) {
  ctx.save();
  // 深海星夜漸層背景 + 柔和海平線光暈
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, "#071224");
  bg.addColorStop(0.55, "#102848");
  bg.addColorStop(1, "#060e1c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const glow = ctx.createRadialGradient(VIEW_W / 2, 220, 20, VIEW_W / 2, 220, 420);
  glow.addColorStop(0, "rgba(218, 178, 102, 0.22)");
  glow.addColorStop(1, "rgba(218, 178, 102, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 原版標題徽章 (GRAPH.DAT #0x3c, 208×112 -> 416×224)
  const logoEntry = art?.graphEntry?.("GRAPH.DAT", 0x3c);
  const logoImg = logoEntry ? art.getImage(`${art.baseUrl}/${logoEntry.path}`) : null;
  if (logoImg) {
    ctx.imageSmoothingEnabled = (logoImg.naturalWidth || 208) > 208;
    ctx.drawImage(logoImg, Math.round((VIEW_W - 416) / 2), 68, 416, 224);
  }

  // 原版副標 (GRAPH.DAT #0x3e, 320×40 -> 640×80)
  const subEntry = art?.graphEntry?.("GRAPH.DAT", 0x3e);
  const subImg = subEntry ? art.getImage(`${art.baseUrl}/${subEntry.path}`) : null;
  if (subImg) {
    ctx.imageSmoothingEnabled = (subImg.naturalWidth || 320) > 320;
    ctx.drawImage(subImg, Math.round((VIEW_W - 640) / 2), 308, 640, 80);
  }

  ctx.restore();
}
