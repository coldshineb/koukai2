// canvas_ui/wide_menu.ts — 原生 16:9 (1280×720) 现代浮动 Canvas 2D 菜单 (取代原版 DOS listMenu 窗口)
// 零 DOM、零旧版 640×400 裁切、100% 原版文本。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { getCommandButtonRects } from "./wide_world.ts";
import { BLD_CARD } from "./wide_building.ts";
import { UI_FONT } from "./text_util.ts";

export interface WideMenuState {
  items: string[];
  disabledMask: number;
  selected: number;
  anchorCmd: number; // 0..3 对应右下 4 枚按钮，-1 为屏幕置中
  x: number;
  y: number;
  w: number;
  h: number;
  itemH: number;
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

export function createWideMenuState(items: string[], disabledMask: number, anchorCmd = -1): WideMenuState {
  const isBuildingDocked = anchorCmd === -3;
  const itemH = isBuildingDocked ? 48 : 38;
  const padY = isBuildingDocked ? 14 : 10;
  const maxLen = Math.max(4, ...items.map(s => s.length));
  const w = isBuildingDocked ? 404 : Math.max(176, Math.min(280, maxLen * 18 + 48));
  const h = items.length * itemH + padY * 2;

  let x = Math.round((VIEW_W - w) / 2);
  let y = anchorCmd === -2 ? 430 : Math.round((VIEW_H - h) / 2);

  if (isBuildingDocked) {
    x = BLD_CARD.x + 486;
    y = BLD_CARD.y + 72 + Math.max(0, Math.round((336 - h) / 2));
  } else if (anchorCmd >= 0 && anchorCmd < 4) {
    const btn = getCommandButtonRects()[anchorCmd];
    x = Math.min(VIEW_W - w - 18, Math.max(18, Math.round(btn.x + btn.w / 2 - w / 2)));
    y = Math.max(114, btn.y - h - 10);
  }

  let firstEnabled = 0;
  for (let i = 0; i < items.length; i++) {
    if (!(disabledMask & (1 << i))) { firstEnabled = i; break; }
  }

  return { items, disabledMask, selected: firstEnabled, anchorCmd, x, y, w, h, itemH, padY };
}

export function hitWideMenuItem(m: WideMenuState, vx: number, vy: number): number {
  if (vx < m.x || vx > m.x + m.w || vy < m.y + m.padY || vy > m.y + m.h - m.padY) return -1;
  const idx = Math.floor((vy - (m.y + m.padY)) / m.itemH);
  return idx >= 0 && idx < m.items.length ? idx : -1;
}

export function hitWideMenuBox(m: WideMenuState, vx: number, vy: number): boolean {
  return vx >= m.x && vx <= m.x + m.w && vy >= m.y && vy <= m.y + m.h;
}

export function drawWideMenu(ctx: CanvasRenderingContext2D, m: WideMenuState) {
  ctx.save();
  const isDocked = m.anchorCmd === -3;
  if (!isDocked) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.62)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, m.x, m.y, m.w, m.h, 10);
    const grad = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h);
    grad.addColorStop(0, "rgba(15, 31, 54, 0.96)");
    grad.addColorStop(1, "rgba(8, 18, 34, 0.98)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(214, 174, 96, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.font = isDocked ? `600 17px ${UI_FONT}` : `600 15px ${UI_FONT}`;
  ctx.textAlign = isDocked ? "left" : "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < m.items.length; i++) {
    const iy = m.y + m.padY + i * m.itemH;
    const disabled = !!(m.disabledMask & (1 << i));
    const selected = i === m.selected && !disabled;

    if (selected) {
      roundRect(ctx, m.x + 8, iy + 3, m.w - 16, m.itemH - 6, 8);
      const hg = ctx.createLinearGradient(m.x + 8, iy, m.x + m.w - 8, iy);
      hg.addColorStop(0, "rgba(218, 178, 102, 0.36)");
      hg.addColorStop(1, "rgba(218, 178, 102, 0.16)");
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = "rgba(240, 206, 132, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (isDocked) {
        ctx.fillStyle = "#f2cf7c";
        ctx.fillRect(m.x + 10, iy + 10, 4, m.itemH - 20);
      }
    } else if (isDocked) {
      roundRect(ctx, m.x + 8, iy + 3, m.w - 16, m.itemH - 6, 8);
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fill();
      ctx.strokeStyle = "rgba(214, 174, 96, 0.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = disabled ? "rgba(180, 174, 158, 0.36)" : selected ? "#fff4d6" : "#eadfc8";
    const tx = isDocked ? m.x + 28 : m.x + m.w / 2;
    ctx.fillText(m.items[i], tx, iy + m.itemH / 2 + 1);
  }

  ctx.restore();
}
