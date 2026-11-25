// canvas_ui/wide_manage.ts — 原生 16:9 (1280×720) 现代 Canvas 2D 经营/命令/设置浮窗套件
// 涵盖：舰队经营表 (船长变更/水手编组/水手比例/舰船销毁)、人事变更三职位卡、通用滑条/开关浮窗 (水手比例/粮食分配/环境设置)、通用对话提示。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { hasDom, runDomControls, runDomList } from "../modern/dom_ui.ts";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function showWideNotice(ctx: any, text: string, portraitId: number | null = null) {
  const { scr, menu } = ctx;
  const prev = scr.wideDialog;
  scr.wideDialog = { text, portraitId, waiting: false };
  scr.dirty = true;
  try {
    await menu.waitPrompt();
  } finally {
    scr.wideDialog = prev;
    scr.dirty = true;
  }
}

export interface WideFleetRow {
  slot: number;
  name: string;
  captain: string;
  crewText: string;
  loadText: string;
  speedText: string;
  disabled?: boolean;
}

export interface WideFleetTableOpts {
  title: string;
  badgeText?: string;
  columnsHeader?: string;
  rows: WideFleetRow[];
}

export async function runWideFleetTableSelect(ctx: any, opts: WideFleetTableOpts): Promise<number> {
  if (hasDom()) {
    const title = opts.badgeText ? `${opts.title} · ${opts.badgeText}` : opts.title;
    const rows = opts.rows.map(r => `${r.name}  (${r.captain})  水手 ${r.crewText}  装载 ${r.loadText}  速度 ${r.speedText}kt`);
    return runDomList(title, rows);
  }
  const { scr, sys, menu } = ctx;
  const w = 880;
  const rowH = 44;
  const h = Math.min(540, 108 + Math.max(1, opts.rows.length) * rowH);
  const x = Math.round((VIEW_W - w) / 2);
  const y = Math.round((VIEW_H - h) / 2) - 20;

  let selected = Math.max(0, opts.rows.findIndex(r => !r.disabled));
  const rowRect = (i: number) => ({ x: x + 18, y: y + 76 + i * rowH, w: w - 36, h: rowH - 6 });

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    c2d.fillStyle = "rgba(5, 11, 22, 0.52)";
    c2d.fillRect(0, 0, VIEW_W, VIEW_H);

    c2d.shadowColor = "rgba(0, 0, 0, 0.65)";
    c2d.shadowBlur = 28;
    c2d.shadowOffsetY = 8;
    roundRect(c2d, x, y, w, h, 14);
    const bg = c2d.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, "rgba(15, 31, 54, 0.96)");
    bg.addColorStop(1, "rgba(8, 17, 32, 0.98)");
    c2d.fillStyle = bg;
    c2d.fill();
    c2d.shadowColor = "transparent";
    c2d.strokeStyle = "rgba(214, 174, 96, 0.88)";
    c2d.lineWidth = 1.6;
    c2d.stroke();

    c2d.font = '700 18px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    c2d.fillStyle = "#f2d89b";
    c2d.textAlign = "left";
    c2d.textBaseline = "middle";
    c2d.fillText(opts.title, x + 24, y + 28);

    if (opts.badgeText) {
      c2d.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#ffe184";
      c2d.textAlign = "right";
      c2d.fillText(opts.badgeText, x + w - 24, y + 28);
    }

    c2d.strokeStyle = "rgba(214, 174, 96, 0.32)";
    c2d.beginPath();
    c2d.moveTo(x + 18, y + 50);
    c2d.lineTo(x + w - 18, y + 50);
    c2d.stroke();

    if (opts.columnsHeader) {
      c2d.font = '600 13px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#9ab2cc";
      c2d.textAlign = "right";
      c2d.fillText(opts.columnsHeader, x + w - 30, y + 64);
    }

    for (let i = 0; i < opts.rows.length; i++) {
      const row = opts.rows[i];
      const r = rowRect(i);
      const isSel = i === selected && !row.disabled;

      roundRect(c2d, r.x, r.y, r.w, r.h, 8);
      if (isSel) {
        c2d.fillStyle = "rgba(218, 178, 102, 0.34)";
        c2d.fill();
        c2d.strokeStyle = "rgba(240, 206, 132, 0.92)";
        c2d.lineWidth = 1.2;
        c2d.stroke();
      } else {
        c2d.fillStyle = "rgba(255, 255, 255, 0.04)";
        c2d.fill();
      }

      const cy = r.y + r.h / 2 + 1;
      c2d.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = row.disabled ? "rgba(180,174,158,0.4)" : isSel ? "#fff4d6" : "#eadfc8";
      c2d.textAlign = "left";
      c2d.fillText(row.name, r.x + 14, cy, 200);

      c2d.font = '500 14px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = row.disabled ? "rgba(180,174,158,0.4)" : "#c8d6e5";
      c2d.fillText(row.captain, r.x + 225, cy, 170);

      c2d.font = '600 14px "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace';
      c2d.fillStyle = row.disabled ? "rgba(180,174,158,0.4)" : "#f2d89b";
      c2d.textAlign = "right";
      c2d.fillText(`${row.crewText}   ${row.loadText}   ${row.speedText}`, r.x + r.w - 14, cy);
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  let res = -1;
  try {
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      let hov = -1;
      for (let i = 0; i < opts.rows.length; i++) {
        const r = rowRect(i);
        if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) { hov = i; break; }
      }
      if (hov >= 0 && !opts.rows[hov].disabled && hov !== selected) { selected = hov; scr.dirty = true; }

      const ev = menu.readEvent();
      if (ev === 0x1e || ev === 0x38) { selected = (selected - 1 + opts.rows.length) % Math.max(1, opts.rows.length); scr.dirty = true; }
      else if (ev === 0x1f || ev === 0x32) { selected = (selected + 1) % Math.max(1, opts.rows.length); scr.dirty = true; }
      else if (ev === 0x1b || ev === 0x30) { res = -1; break; }
      else if (ev === 0x0d) {
        if (menu.mouseFlag) {
          if (hov >= 0 && !opts.rows[hov].disabled) { res = hov; break; }
          if (vx < x || vx > x + w || vy < y || vy > y + h) { res = -1; break; }
        } else if (opts.rows[selected] && !opts.rows[selected].disabled) {
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

export interface WidePersonnelCard {
  roleLabel: string;
  personName: string;
  portraitUrl: string | null;
}

export async function runWidePersonnelSelect(
  ctx: any,
  title: string,
  cards: WidePersonnelCard[],
): Promise<number> {
  if (hasDom()) {
    return runDomList(title, cards.map(c => `${c.roleLabel}：${c.personName || "----"}`));
  }
  const { scr, sys, menu, art } = ctx;
  await Promise.all(cards.map(c => c.portraitUrl ? art?.loadImage?.(c.portraitUrl).catch(() => {}) : null));

  const w = 780, h = 340;
  const x = Math.round((VIEW_W - w) / 2);
  const y = Math.round((VIEW_H - h) / 2) - 24;
  const cardW = 224, cardH = 236, gap = 22;
  const cardRect = (i: number) => ({ x: x + 32 + i * (cardW + gap), y: y + 74, w: cardW, h: cardH });

  let selected = 0;

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    c2d.fillStyle = "rgba(5, 11, 22, 0.56)";
    c2d.fillRect(0, 0, VIEW_W, VIEW_H);

    c2d.shadowColor = "rgba(0, 0, 0, 0.65)";
    c2d.shadowBlur = 28;
    c2d.shadowOffsetY = 8;
    roundRect(c2d, x, y, w, h, 14);
    const bg = c2d.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, "rgba(15, 31, 54, 0.96)");
    bg.addColorStop(1, "rgba(8, 17, 32, 0.98)");
    c2d.fillStyle = bg;
    c2d.fill();
    c2d.shadowColor = "transparent";
    c2d.strokeStyle = "rgba(214, 174, 96, 0.88)";
    c2d.lineWidth = 1.6;
    c2d.stroke();

    c2d.font = '700 18px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    c2d.fillStyle = "#f2d89b";
    c2d.textAlign = "left";
    c2d.textBaseline = "middle";
    c2d.fillText(title, x + 28, y + 32);

    c2d.strokeStyle = "rgba(214, 174, 96, 0.32)";
    c2d.beginPath();
    c2d.moveTo(x + 20, y + 54);
    c2d.lineTo(x + w - 20, y + 54);
    c2d.stroke();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const r = cardRect(i);
      const isSel = i === selected;

      roundRect(c2d, r.x, r.y, r.w, r.h, 12);
      c2d.fillStyle = isSel ? "rgba(218, 178, 102, 0.24)" : "rgba(255, 255, 255, 0.04)";
      c2d.fill();
      c2d.strokeStyle = isSel ? "#f0cf85" : "rgba(214, 174, 96, 0.45)";
      c2d.lineWidth = isSel ? 2 : 1.2;
      c2d.stroke();

      c2d.font = '700 16px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#f2d89b";
      c2d.textAlign = "center";
      c2d.fillText(card.roleLabel, r.x + r.w / 2, r.y + 24);

      const px = r.x + Math.round((r.w - 104) / 2), py = r.y + 44;
      c2d.fillStyle = "#081220";
      c2d.fillRect(px, py, 104, 130);
      const img = card.portraitUrl ? art?.getImage?.(card.portraitUrl) : null;
      if (img) {
        c2d.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
        c2d.drawImage(img, px, py, 104, 130);
      }
      c2d.strokeStyle = "rgba(214, 174, 96, 0.6)";
      c2d.lineWidth = 1;
      c2d.strokeRect(px, py, 104, 130);

      c2d.font = '700 16px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = isSel ? "#fff4d6" : "#eadfc8";
      c2d.fillText(card.personName || "----", r.x + r.w / 2, r.y + 204, r.w - 18);
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  let res = -1;
  try {
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      let hov = -1;
      for (let i = 0; i < cards.length; i++) {
        const r = cardRect(i);
        if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) { hov = i; break; }
      }
      if (hov >= 0 && hov !== selected) { selected = hov; scr.dirty = true; }

      const ev = menu.readEvent();
      if (ev === 0x1d || ev === 0x34 || ev === 0x1e || ev === 0x38) { selected = (selected - 1 + cards.length) % cards.length; scr.dirty = true; }
      else if (ev === 0x1c || ev === 0x36 || ev === 0x1f || ev === 0x32) { selected = (selected + 1) % cards.length; scr.dirty = true; }
      else if (ev === 0x1b || ev === 0x30) { res = -1; break; }
      else if (ev === 0x0d) {
        if (menu.mouseFlag) {
          if (hov >= 0) { res = hov; break; }
          if (vx < x || vx > x + w || vy < y || vy > y + h) { res = -1; break; }
        } else {
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

export interface WideControlRow {
  label: string;
  kind: "toggle" | "slider";
  getValueText: () => string;
  getRatio?: () => number; // 0..1
  onMinus: () => void | Promise<void>;
  onPlus: () => void | Promise<void>;
}

export async function runWideControlsModal(ctx: any, title: string, rows: WideControlRow[]): Promise<void> {
  if (hasDom()) return runDomControls(title, rows);
  const { scr, sys, menu } = ctx;
  const w = 640;
  const rowH = 58;
  const h = 92 + rows.length * rowH;
  const x = Math.round((VIEW_W - w) / 2);
  const y = Math.round((VIEW_H - h) / 2);

  let selected = 0;

  const rowRects = (i: number) => {
    const ry = y + 70 + i * rowH;
    return {
      row: { x: x + 20, y: ry, w: w - 40, h: rowH - 8 },
      minus: { x: x + 250, y: ry + 8, w: 42, h: 34 },
      bar: { x: x + 302, y: ry + 16, w: 186, h: 18 },
      plus: { x: x + 498, y: ry + 8, w: 42, h: 34 },
      toggle: { x: x + 380, y: ry + 8, w: 160, h: 34 },
    };
  };

  const hit = (r: { x: number; y: number; w: number; h: number }, vx: number, vy: number) =>
    vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h;

  const drawFn = (c2d: CanvasRenderingContext2D) => {
    c2d.save();
    c2d.fillStyle = "rgba(5, 11, 22, 0.54)";
    c2d.fillRect(0, 0, VIEW_W, VIEW_H);

    c2d.shadowColor = "rgba(0, 0, 0, 0.65)";
    c2d.shadowBlur = 28;
    c2d.shadowOffsetY = 8;
    roundRect(c2d, x, y, w, h, 14);
    const bg = c2d.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, "rgba(15, 31, 54, 0.96)");
    bg.addColorStop(1, "rgba(8, 17, 32, 0.98)");
    c2d.fillStyle = bg;
    c2d.fill();
    c2d.shadowColor = "transparent";
    c2d.strokeStyle = "rgba(214, 174, 96, 0.88)";
    c2d.lineWidth = 1.6;
    c2d.stroke();

    c2d.font = '700 18px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
    c2d.fillStyle = "#f2d89b";
    c2d.textAlign = "left";
    c2d.textBaseline = "middle";
    c2d.fillText(title, x + 26, y + 32);

    c2d.strokeStyle = "rgba(214, 174, 96, 0.32)";
    c2d.beginPath();
    c2d.moveTo(x + 20, y + 54);
    c2d.lineTo(x + w - 20, y + 54);
    c2d.stroke();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rr = rowRects(i);
      const isSel = i === selected;

      roundRect(c2d, rr.row.x, rr.row.y, rr.row.w, rr.row.h, 8);
      c2d.fillStyle = isSel ? "rgba(218, 178, 102, 0.16)" : "rgba(255, 255, 255, 0.03)";
      c2d.fill();
      if (isSel) {
        c2d.strokeStyle = "rgba(240, 206, 132, 0.65)";
        c2d.lineWidth = 1;
        c2d.stroke();
      }

      const cy = rr.row.y + rr.row.h / 2;
      c2d.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
      c2d.fillStyle = "#fff4d6";
      c2d.textAlign = "left";
      c2d.fillText(row.label, rr.row.x + 14, cy);

      if (row.kind === "toggle") {
        roundRect(c2d, rr.toggle.x, rr.toggle.y, rr.toggle.w, rr.toggle.h, 8);
        c2d.fillStyle = "rgba(214, 174, 96, 0.25)";
        c2d.fill();
        c2d.strokeStyle = "#e6c67c";
        c2d.lineWidth = 1.2;
        c2d.stroke();
        c2d.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
        c2d.fillStyle = "#fff4d6";
        c2d.textAlign = "center";
        c2d.fillText(row.getValueText(), rr.toggle.x + rr.toggle.w / 2, rr.toggle.y + rr.toggle.h / 2 + 1);
      } else {
        for (const [btn, lbl] of [[rr.minus, "-"], [rr.plus, "+"]] as const) {
          roundRect(c2d, btn.x, btn.y, btn.w, btn.h, 6);
          c2d.fillStyle = "rgba(255, 255, 255, 0.10)";
          c2d.fill();
          c2d.strokeStyle = "rgba(214, 174, 96, 0.7)";
          c2d.lineWidth = 1;
          c2d.stroke();
          c2d.font = '700 18px "Consolas", monospace';
          c2d.fillStyle = "#fff4d6";
          c2d.textAlign = "center";
          c2d.fillText(lbl, btn.x + btn.w / 2, btn.y + btn.h / 2 + 1);
        }

        const ratio = Math.max(0, Math.min(1, row.getRatio?.() ?? 0));
        roundRect(c2d, rr.bar.x, rr.bar.y, rr.bar.w, rr.bar.h, 6);
        c2d.fillStyle = "rgba(255, 255, 255, 0.10)";
        c2d.fill();
        if (ratio > 0) {
          roundRect(c2d, rr.bar.x, rr.bar.y, Math.max(8, rr.bar.w * ratio), rr.bar.h, 6);
          c2d.fillStyle = "#e2bc6b";
          c2d.fill();
        }

        c2d.font = '600 13px "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace';
        c2d.fillStyle = "#f2d89b";
        c2d.textAlign = "right";
        c2d.fillText(row.getValueText(), rr.row.x + rr.row.w - 10, cy);
      }
    }
    c2d.restore();
  };

  await menu.waitRelease();
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  try {
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      for (let i = 0; i < rows.length; i++) {
        if (hit(rowRects(i).row, vx, vy) && i !== selected) { selected = i; scr.dirty = true; }
      }
      const ev = menu.readEvent();
      if (ev === 0x1e || ev === 0x38) { selected = (selected - 1 + rows.length) % rows.length; scr.dirty = true; }
      else if (ev === 0x1f || ev === 0x32) { selected = (selected + 1) % rows.length; scr.dirty = true; }
      else if (ev === 0x1d || ev === 0x34) { await rows[selected].onMinus(); scr.dirty = true; }
      else if (ev === 0x1c || ev === 0x36) { await rows[selected].onPlus(); scr.dirty = true; }
      else if (ev === 0x1b || ev === 0x30) break;
      else if (ev === 0x0d) {
        if (menu.mouseFlag) {
          if (vx < x || vx > x + w || vy < y || vy > y + h) break;
          for (let i = 0; i < rows.length; i++) {
            const rr = rowRects(i);
            if (rows[i].kind === "toggle" && hit(rr.toggle, vx, vy)) { await rows[i].onPlus(); scr.dirty = true; break; }
            if (rows[i].kind === "slider" && hit(rr.minus, vx, vy)) { await rows[i].onMinus(); scr.dirty = true; break; }
            if (rows[i].kind === "slider" && hit(rr.plus, vx, vy)) { await rows[i].onPlus(); scr.dirty = true; break; }
          }
          await menu.waitRelease();
        } else if (rows[selected].kind === "toggle") {
          await rows[selected].onPlus();
          scr.dirty = true;
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
}
