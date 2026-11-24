// canvas_ui/wide_numpad.ts — 原生 16:9 (1280×720) 現代 Canvas 2D 數值滑桿與步進輸入器 (零 DOM)
import { VIEW_W, VIEW_H } from "../core/screen.js";

export interface WideNumPadState {
  min: number;
  max: number;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
  track: { x: number; y: number; w: number; h: number };
  btns: Array<{ x: number; y: number; w: number; h: number; label: string; act: string }>;
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

export function createWideNumPadState(min: number, max: number): WideNumPadState {
  const w = 420, h = 216;
  const x = Math.round((VIEW_W - w) / 2);
  const y = Math.round((VIEW_H - h) / 2);
  const track = { x: x + 28, y: y + 76, w: w - 56, h: 14 };

  const stepSpecs: Array<[string, string]> = [
    ["0", "min"], ["-10", "-10"], ["-1", "-1"], ["+1", "+1"], ["+10", "+10"], ["MAX", "max"],
  ];
  const bw = 56, gap = 8;
  const rowW = stepSpecs.length * bw + (stepSpecs.length - 1) * gap;
  const rx = x + Math.round((w - rowW) / 2);
  const ry = y + 108;
  const btns = stepSpecs.map(([label, act], i) => ({
    x: rx + i * (bw + gap), y: ry, w: bw, h: 34, label, act,
  }));
  btns.push(
    { x: x + 64, y: y + 158, w: 132, h: 40, label: "OK", act: "ok" },
    { x: x + w - 196, y: y + 158, w: 132, h: 40, label: "×", act: "cancel" },
  );
  return { min, max, value: Math.max(min, Math.min(max, max)), x, y, w, h, track, btns };
}

export function drawWideNumPad(ctx: CanvasRenderingContext2D, s: WideNumPadState, mx: number, my: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, s.x, s.y, s.w, s.h, 12);
  const g = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
  g.addColorStop(0, "rgba(16, 33, 56, 0.97)");
  g.addColorStop(1, "rgba(9, 19, 34, 0.98)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(218, 178, 102, 0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 數值顯示區
  ctx.font = '700 26px "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace';
  ctx.fillStyle = "#ffe5a3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${s.value}  /  ${s.max}`, s.x + s.w / 2, s.y + 40);

  // 滑桿軌道與填滿
  const { track } = s;
  roundRect(ctx, track.x, track.y, track.w, track.h, 7);
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.fill();
  const ratio = s.max > s.min ? (s.value - s.min) / (s.max - s.min) : 0;
  const fillW = Math.max(14, Math.round(track.w * ratio));
  roundRect(ctx, track.x, track.y, fillW, track.h, 7);
  const tg = ctx.createLinearGradient(track.x, track.y, track.x + track.w, track.y);
  tg.addColorStop(0, "#b58d42");
  tg.addColorStop(1, "#e6c67c");
  ctx.fillStyle = tg;
  ctx.fill();

  // 滑桿圓點
  const knobX = track.x + Math.round(track.w * ratio);
  ctx.beginPath();
  ctx.arc(knobX, track.y + track.h / 2, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#fff4d6";
  ctx.fill();
  ctx.strokeStyle = "#8a621c";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 按鈕
  ctx.font = '600 14px "Consolas", "Noto Serif TC", sans-serif';
  for (const b of s.btns) {
    const hov = mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
    const isOk = b.act === "ok";
    roundRect(ctx, b.x, b.y, b.w, b.h, 7);
    if (isOk) {
      ctx.fillStyle = hov ? "#f0d38c" : "#cfa85b";
      ctx.fill();
      ctx.fillStyle = "#1a1106";
    } else {
      ctx.fillStyle = hov ? "rgba(218, 178, 102, 0.34)" : "rgba(255, 255, 255, 0.08)";
      ctx.fill();
      ctx.strokeStyle = hov ? "#e6c67c" : "rgba(208, 169, 94, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#f4ead2";
    }
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }
  ctx.restore();
}

export async function runWideNumPad(ctx: any, min: number, max: number): Promise<number> {
  const { scr, sys, menu } = ctx;
  await menu.waitRelease();
  const s = createWideNumPadState(min, max);
  const drawFn = (c2d: CanvasRenderingContext2D) => drawWideNumPad(c2d, s, sys.mouse?.vx ?? -1, sys.mouse?.vy ?? -1);
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;

  let typing = "";
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const setFromTrack = (vx: number) => {
    const r = Math.max(0, Math.min(1, (vx - s.track.x) / (s.track.w || 1)));
    s.value = clamp(min + r * (max - min));
    typing = "";
    scr.dirty = true;
  };

  let res = 0;
  try {
    for (;;) {
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      // 支援滑桿拖曳
      if (sys.mouseLeft() && vx >= s.track.x - 10 && vx <= s.track.x + s.track.w + 10 && vy >= s.track.y - 12 && vy <= s.track.y + s.track.h + 12) {
        setFromTrack(vx);
        await sys.poll();
        continue;
      }
      if (sys.kbhit()) {
        const k = sys.getKey();
        if (k === 0x0d) { res = s.value; break; }
        if (k === 0x1b) { res = 0; break; }
        if (k === 0x08) {
          typing = typing.slice(0, -1);
          s.value = typing ? clamp(Number(typing)) : min;
          scr.dirty = true;
        } else if (k >= 0x30 && k <= 0x39) {
          typing += String.fromCharCode(k);
          s.value = clamp(Number(typing));
          scr.dirty = true;
        } else if (k === 0x1c) { s.value = clamp(s.value + 1); typing = ""; scr.dirty = true; }
        else if (k === 0x1d) { s.value = clamp(s.value - 1); typing = ""; scr.dirty = true; }
        else if (k === 0x1e) { s.value = clamp(s.value + 10); typing = ""; scr.dirty = true; }
        else if (k === 0x1f) { s.value = clamp(s.value - 10); typing = ""; scr.dirty = true; }
      }
      const ev = sys.mouseEvent();
      if (ev === 0x82) { res = 0; break; }
      if (ev === 0x81) {
        let hit = false;
        for (const b of s.btns) {
          if (vx >= b.x && vx <= b.x + b.w && vy >= b.y && vy <= b.y + b.h) {
            hit = true;
            if (b.act === "ok") { res = s.value; break; }
            if (b.act === "cancel") { res = 0; break; }
            if (b.act === "min") s.value = min;
            else if (b.act === "max") s.value = max;
            else s.value = clamp(s.value + Number(b.act));
            typing = "";
            scr.dirty = true;
            break;
          }
        }
        if (hit && (s.btns.some(b => (b.act === "ok" || b.act === "cancel") && vx >= b.x && vx <= b.x + b.w && vy >= b.y && vy <= b.y + b.h))) {
          break;
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
  return res < 0 ? 0 : res;
}
