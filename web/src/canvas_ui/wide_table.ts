// canvas_ui/wide_table.ts — Stage 3C: 原生 16:9 (1280×720) 現代 Canvas 2D 表格選擇面板
// 供交易所 (買進/賣出/物價表) 與碼頭 (補給表) 共用，位於建築內景右側、底部對話欄上方，零 DOM、100% 原版文本。
import { VIEW_W } from "../core/screen.js";

export interface WideTableItem {
  label: string;
  rightText?: string;
  accent?: boolean;
}

export interface WideTableOpts {
  title?: string;
  columns?: number; // 1 或 2
  items: WideTableItem[];
  toggleLabel?: string; // 碼頭裝上/卸下切換鈕 (100% 原版 WF.load / WF.unload)
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

export async function runWideTableSelect(
  ctx: any,
  opts: WideTableOpts,
  { interactive = true } = {},
): Promise<number> {
  const { scr, sys, menu } = ctx;
  const cols = opts.columns ?? 1;
  const x = 660, y = 132, w = 420, h = 348;
  const headerH = opts.title || opts.toggleLabel ? 44 : 12;
  const rowH = 38;
  const padX = 16;
  const cellW = Math.floor((w - padX * 2 - (cols - 1) * 12) / cols);

  let selected = 0;
  const toggleRect = opts.toggleLabel ? { x: x + w - 136, y: y + 8, w: 120, h: 28 } : null;

  const cellRect = (i: number) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: x + padX + col * (cellW + 12),
      y: y + headerH + 8 + row * rowH,
      w: cellW,
      h: rowH - 4,
    };
  };

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    c2d.shadowColor = "rgba(0, 0, 0, 0.58)";
    c2d.shadowBlur = 22;
    c2d.shadowOffsetY = 6;
    roundRect(c2d, x, y, w, h, 12);
    const g = c2d.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(14, 30, 52, 0.95)");
    g.addColorStop(1, "rgba(8, 17, 32, 0.98)");
    c2d.fillStyle = g;
    c2d.fill();
    c2d.shadowColor = "transparent";
    c2d.strokeStyle = "rgba(214, 174, 96, 0.85)";
    c2d.lineWidth = 1.5;
    c2d.stroke();

    if (opts.title) {
      c2d.font = '700 16px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#f2d89b";
      c2d.textAlign = "left";
      c2d.textBaseline = "middle";
      c2d.fillText(opts.title, x + 20, y + 22);
    }

    if (toggleRect && opts.toggleLabel) {
      const mx = sys.mouse?.vx ?? -1, my = sys.mouse?.vy ?? -1;
      const hov = mx >= toggleRect.x && mx <= toggleRect.x + toggleRect.w && my >= toggleRect.y && my <= toggleRect.y + toggleRect.h;
      roundRect(c2d, toggleRect.x, toggleRect.y, toggleRect.w, toggleRect.h, 6);
      c2d.fillStyle = hov ? "#e6c67c" : "rgba(214, 174, 96, 0.25)";
      c2d.fill();
      c2d.strokeStyle = "#e6c67c";
      c2d.lineWidth = 1;
      c2d.stroke();
      c2d.font = '700 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = hov ? "#1a1106" : "#fff4d6";
      c2d.textAlign = "center";
      c2d.textBaseline = "middle";
      c2d.fillText(opts.toggleLabel, toggleRect.x + toggleRect.w / 2, toggleRect.y + toggleRect.h / 2 + 1);
    }

    if (opts.title || opts.toggleLabel) {
      c2d.strokeStyle = "rgba(214, 174, 96, 0.35)";
      c2d.beginPath();
      c2d.moveTo(x + 14, y + headerH);
      c2d.lineTo(x + w - 14, y + headerH);
      c2d.stroke();
    }

    c2d.textBaseline = "middle";
    for (let i = 0; i < opts.items.length; i++) {
      const r = cellRect(i);
      if (r.y + r.h > y + h - 8) break;
      const it = opts.items[i];
      const isSel = interactive && i === selected;

      roundRect(c2d, r.x, r.y, r.w, r.h, 6);
      if (isSel) {
        c2d.fillStyle = "rgba(218, 178, 102, 0.34)";
        c2d.fill();
        c2d.strokeStyle = "rgba(240, 206, 132, 0.9)";
        c2d.lineWidth = 1;
        c2d.stroke();
      } else {
        c2d.fillStyle = "rgba(255, 255, 255, 0.04)";
        c2d.fill();
      }

      c2d.font = '600 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = it.accent ? "#ffe184" : isSel ? "#fff4d6" : "#eadfc8";
      c2d.textAlign = "left";
      c2d.fillText(it.label, r.x + 12, r.y + r.h / 2 + 1, it.rightText ? r.w - 92 : r.w - 24);

      if (it.rightText) {
        c2d.font = '600 15px "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace';
        c2d.fillStyle = "#f2d89b";
        c2d.textAlign = "right";
        c2d.fillText(it.rightText, r.x + r.w - 12, r.y + r.h / 2 + 1);
      }
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;

  let res = 0xff;
  try {
    if (!interactive) {
      await menu.waitPress();
      return 0;
    }
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      let hov = -1;
      for (let i = 0; i < opts.items.length; i++) {
        const r = cellRect(i);
        if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) { hov = i; break; }
      }
      if (hov >= 0 && hov !== selected) { selected = hov; scr.dirty = true; }

      const ev = menu.readEvent();
      if (ev === 0x1e || ev === 0x38) { selected = (selected - cols + opts.items.length) % Math.max(1, opts.items.length); scr.dirty = true; }
      else if (ev === 0x1f || ev === 0x32) { selected = (selected + cols) % Math.max(1, opts.items.length); scr.dirty = true; }
      else if (ev === 0x1d || ev === 0x34) { selected = (selected - 1 + opts.items.length) % Math.max(1, opts.items.length); scr.dirty = true; }
      else if (ev === 0x1c || ev === 0x36) { selected = (selected + 1) % Math.max(1, opts.items.length); scr.dirty = true; }
      else if (ev === 0x1b || ev === 0x30) { res = 0xff; break; }
      else if (ev === 0x0d) {
        if (menu.mouseFlag) {
          if (toggleRect && vx >= toggleRect.x && vx <= toggleRect.x + toggleRect.w && vy >= toggleRect.y && vy <= toggleRect.y + toggleRect.h) {
            res = -2; // toggle
            break;
          }
          if (hov >= 0) { res = hov; break; }
          if (vx < x || vx > x + w || vy < y || vy > y + h) { res = 0xff; break; }
        } else if (opts.items.length > 0) {
          res = selected; break;
        }
      }
      await sys.poll();
    }
  } finally {
    const idx = scr.wideOverlays.indexOf(drawFn);
    if (idx >= 0) scr.wideOverlays.splice(idx, 1);
    scr.dirty = true;
    await menu.waitRelease();
  }
  return res;
}
