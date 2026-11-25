// canvas_ui/wide_list.ts — 原生 16:9 (1280×720) 现代 Canvas 2D 滚动清单选择器
// 自动兼容 ListSelect 全部 21 种清单格式，100% 沿用原版标题与列文本，支持滚轮/鼠标悬停/键盘。
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideListState {
  title: string;
  rows: string[];
  selected: number;
  scroll: number;
  visibleRows: number;
  x: number;
  y: number;
  w: number;
  h: number;
  headerH: number;
  rowH: number;
  padY: number;
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

export function createWideListState(title: string, rows: string[]): WideListState {
  const headerH = 44;
  const rowH = 36;
  const padY = 8;
  const visibleRows = Math.min(11, Math.max(4, rows.length));
  const maxChars = Math.max(title.length, 12, ...rows.map(r => r.length));
  const w = Math.max(300, Math.min(540, maxChars * 14 + 72));
  const h = headerH + visibleRows * rowH + padY * 2;
  const x = Math.round((VIEW_W - w) / 2);
  const y = Math.round((VIEW_H - h) / 2);
  return {
    title,
    rows,
    selected: 0,
    scroll: 0,
    visibleRows,
    x, y, w, h,
    headerH, rowH, padY,
  };
}

export function hitWideListRow(s: WideListState, vx: number, vy: number): number {
  const top = s.y + s.headerH + s.padY;
  const bot = top + s.visibleRows * s.rowH;
  if (vx < s.x + 8 || vx > s.x + s.w - 22 || vy < top || vy >= bot) return -1;
  const idx = s.scroll + Math.floor((vy - top) / s.rowH);
  return idx >= 0 && idx < s.rows.length ? idx : -1;
}

export function hitWideListBox(s: WideListState, vx: number, vy: number): boolean {
  return vx >= s.x && vx <= s.x + s.w && vy >= s.y && vy <= s.y + s.h;
}

export function drawWideList(ctx: CanvasRenderingContext2D, s: WideListState) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, s.x, s.y, s.w, s.h, 12);
  const g = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
  g.addColorStop(0, "rgba(15, 31, 54, 0.96)");
  g.addColorStop(1, "rgba(8, 18, 34, 0.98)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(214, 174, 96, 0.88)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 标题列
  ctx.fillStyle = "rgba(214, 174, 96, 0.14)";
  ctx.fillRect(s.x + 1, s.y + 1, s.w - 2, s.headerH - 1);
  ctx.strokeStyle = "rgba(214, 174, 96, 0.4)";
  ctx.beginPath();
  ctx.moveTo(s.x + 12, s.y + s.headerH);
  ctx.lineTo(s.x + s.w - 12, s.y + s.headerH);
  ctx.stroke();

  ctx.font = '700 16px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
  ctx.fillStyle = "#f2d89b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s.title, s.x + s.w / 2, s.y + s.headerH / 2 + 1);

  // 清单列
  const top = s.y + s.headerH + s.padY;
  ctx.font = '500 15px "Noto Serif TC", "Consolas", "Microsoft JhengHei", serif';
  ctx.textAlign = "left";
  for (let i = 0; i < s.visibleRows; i++) {
    const idx = s.scroll + i;
    if (idx >= s.rows.length) break;
    const ry = top + i * s.rowH;
    const sel = idx === s.selected;
    if (sel) {
      roundRect(ctx, s.x + 10, ry + 2, s.w - 28, s.rowH - 4, 6);
      ctx.fillStyle = "rgba(218, 178, 102, 0.34)";
      ctx.fill();
      ctx.strokeStyle = "rgba(240, 206, 132, 0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = sel ? "#fff4d6" : "#eadfc8";
    ctx.fillText(s.rows[idx], s.x + 22, ry + s.rowH / 2 + 1, s.w - 48);
  }

  // 现代极简滚动条
  if (s.rows.length > s.visibleRows) {
    const trackX = s.x + s.w - 12;
    const trackY = top + 4;
    const trackH = s.visibleRows * s.rowH - 8;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    roundRect(ctx, trackX, trackY, 5, trackH, 3);
    ctx.fill();

    const thumbH = Math.max(24, Math.round((s.visibleRows / s.rows.length) * trackH));
    const maxScroll = Math.max(1, s.rows.length - s.visibleRows);
    const thumbY = trackY + Math.round((s.scroll / maxScroll) * (trackH - thumbH));
    ctx.fillStyle = "#d4af5a";
    roundRect(ctx, trackX, thumbY, 5, thumbH, 3);
    ctx.fill();
  }

  ctx.restore();
}
