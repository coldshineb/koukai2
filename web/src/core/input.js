// input.js — 把浏览器键盘/鼠标事件送进原版输入模型 (core/sys.js)
import { keyToBios } from "./keymap.js";
import { SCREEN_W, CANVAS_H, Y_OFFSET, VIEW_W, VIEW_H, LEGACY_SCALE, LEGACY_OFF_X } from "./screen.js";

// 浏览器保留键 (刷新 / 强制刷新 / 开发者工具): 不送进游戏、不 preventDefault。
// 原版只看单独的 F5 (numpad.js 0x3f = 填入最大值) 等; DOS 下 Ctrl+F5 是另一个扫描码 (0x62), 原版本来就不当作 F5, 所以放行不影响原版操作。
function browserReserved(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.code === "F5" || e.code === "KeyR")) return true;                 // Ctrl+F5 / Ctrl+R / Ctrl+Shift+R
  if (e.code === "F12") return true;
  if (mod && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ" || e.code === "KeyC")) return true;
  return false;
}

export function bindInput(canvas, sys, scr = null) {
  addEventListener("keydown", e => {
    if (document.body?.dataset.uw2Modal === "open") return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (browserReserved(e)) return;
    const k = keyToBios(e); if (!k) return;
    e.preventDefault();
    sys.pushKey(k[0], k[1]);
  });
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    const vw = scr?.viewW || VIEW_W, vh = scr?.viewH || VIEW_H;
    const vx = Math.max(0, Math.min(vw - 1, Math.floor(((e.clientX - r.left) * vw) / r.width)));
    const vy = Math.max(0, Math.min(vh - 1, Math.floor(((e.clientY - r.top) * vh) / r.height)));
    sys.mouse.vx = vx;
    sys.mouse.vy = vy;
    const bv = sys._battleViewport;
    if (bv) {
      sys.mouse.x = Math.max(0, Math.min(SCREEN_W - 1, Math.floor(((vx - bv.x) * bv.srcW) / bv.w)));
      sys.mouse.y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor(((vy - bv.y) * bv.srcH) / bv.h) + Y_OFFSET));
    } else {
      const lr = scr?.legacyRect;
      const lx = lr ? lr.x : LEGACY_OFF_X, ly = lr ? lr.y : 0, ls = lr ? lr.scale : LEGACY_SCALE;
      sys.mouse.x = Math.max(0, Math.min(SCREEN_W - 1, Math.floor((vx - lx) / ls)));
      sys.mouse.y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor((vy - ly) / ls) + Y_OFFSET));
    }
  };
  // INT 33h 移动量 (mickey): 每 8 像素 = sys.mickeyRatio (seg0:5022 依「鼠标速度」设置, 默认水平 8 / 垂直 16)
  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect(), k = SCREEN_W / r.width, m = sys.mouse;
    m.mdx = (m.mdx | 0) + Math.round(e.movementX * k * (sys.mickeyRatio?.[0] ?? 8) / 8);
    m.mdy = (m.mdy | 0) + Math.round(e.movementY * k * (sys.mickeyRatio?.[1] ?? 16) / 8);
    pos(e);
  });
  canvas.addEventListener("mousedown", e => {
    pos(e);
    sys.mouse.buttons |= e.button === 2 ? 2 : e.button === 0 ? 1 : 0;
    if (e.button === 0 && document.body?.dataset.uw2Modal !== "open") {
      sys.mouse.lastClick = { vx: sys.mouse.vx, vy: sys.mouse.vy, t: performance.now() };
    }
    e.preventDefault();
  });
  addEventListener("mouseup", e => { sys.mouse.buttons &= ~(e.button === 2 ? 2 : e.button === 0 ? 1 : 0); });
  window.addEventListener("contextmenu", e => e.preventDefault());
  window.addEventListener("dragstart", e => e.preventDefault());
  canvas.style.cursor = "default";        // 阶段 4: 使用浏览器原生高精度指针
}
