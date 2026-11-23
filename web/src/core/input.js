// input.js — 把瀏覽器鍵盤/滑鼠事件送進原版輸入模型 (core/sys.js)
import { keyToBios } from "./keymap.js";
import { SCREEN_W, CANVAS_H } from "./screen.js";

export function bindInput(canvas, sys) {
  addEventListener("keydown", e => {
    const k = keyToBios(e); if (!k) return;
    e.preventDefault();
    sys.pushKey(k[0], k[1]);              // BIOS 會自動重複, 瀏覽器 keydown 的 repeat 亦同
  });
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    sys.mouse.x = Math.max(0, Math.min(SCREEN_W - 1, Math.floor((e.clientX - r.left) * SCREEN_W / r.width)));
    sys.mouse.y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor((e.clientY - r.top) * CANVAS_H / r.height)));
  };
  // INT 33h 移動量 (mickey): 每 8 像素 = sys.mickeyRatio (seg0:5022 依「滑鼠速度」設定, 預設水平 8 / 垂直 16)
  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect(), k = SCREEN_W / r.width, m = sys.mouse;
    m.mdx = (m.mdx | 0) + Math.round(e.movementX * k * (sys.mickeyRatio?.[0] ?? 8) / 8);
    m.mdy = (m.mdy | 0) + Math.round(e.movementY * k * (sys.mickeyRatio?.[1] ?? 16) / 8);
    pos(e);
  });
  canvas.addEventListener("mousedown", e => { pos(e); sys.mouse.buttons |= e.button === 2 ? 2 : e.button === 0 ? 1 : 0; e.preventDefault(); });
  addEventListener("mouseup", e => { sys.mouse.buttons &= ~(e.button === 2 ? 2 : e.button === 0 ? 1 : 0); });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.style.cursor = "none";           // 改畫原版軟體游標
}
