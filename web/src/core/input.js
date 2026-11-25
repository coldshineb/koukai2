// input.js — 把浏览器键盘/鼠标事件送进原版输入模型 (core/sys.js)
import { keyToBios } from "./keymap.js";
import { SCREEN_W, CANVAS_H } from "./screen.js";

// 浏览器保留键 (刷新 / 强制刷新 / 开发者工具): 不送进游戏、不 preventDefault。
// 原版只看单独的 F5 (numpad.js 0x3f = 填入最大值) 等; DOS 下 Ctrl+F5 是另一个扫描码 (0x62), 原版本来就不当作 F5, 所以放行不影响原版操作。
function browserReserved(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.code === "F5" || e.code === "KeyR")) return true;                 // Ctrl+F5 / Ctrl+R / Ctrl+Shift+R
  if (e.code === "F12") return true;
  if (mod && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ" || e.code === "KeyC")) return true;
  return false;
}

export function bindInput(canvas, sys) {
  // 鼠标在游戏画面 (canvas) 外时, 键盘完全交给浏览器 (不送进游戏、不 preventDefault)。
  // 初值为 true: 加载时鼠标可能已在画面上而尚未触发 pointerenter。
  let inside = true;
  canvas.addEventListener("pointerenter", () => { inside = true; });
  canvas.addEventListener("pointerleave", () => { inside = false; });
  addEventListener("keydown", e => {
    if (!inside || browserReserved(e)) return;
    const k = keyToBios(e); if (!k) return;
    e.preventDefault();
    sys.pushKey(k[0], k[1]);              // BIOS 会自动重复, 浏览器 keydown 的 repeat 亦同
  });
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    sys.mouse.x = Math.max(0, Math.min(SCREEN_W - 1, Math.floor((e.clientX - r.left) * SCREEN_W / r.width)));
    sys.mouse.y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor((e.clientY - r.top) * CANVAS_H / r.height)));
  };
  // INT 33h 移动量 (mickey): 每 8 像素 = sys.mickeyRatio (seg0:5022 依「鼠标速度」设置, 默认水平 8 / 垂直 16)
  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect(), k = SCREEN_W / r.width, m = sys.mouse;
    m.mdx = (m.mdx | 0) + Math.round(e.movementX * k * (sys.mickeyRatio?.[0] ?? 8) / 8);
    m.mdy = (m.mdy | 0) + Math.round(e.movementY * k * (sys.mickeyRatio?.[1] ?? 16) / 8);
    pos(e);
  });
  canvas.addEventListener("mousedown", e => { pos(e); sys.mouse.buttons |= e.button === 2 ? 2 : e.button === 0 ? 1 : 0; e.preventDefault(); });
  addEventListener("mouseup", e => { sys.mouse.buttons &= ~(e.button === 2 ? 2 : e.button === 0 ? 1 : 0); });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.style.cursor = "none";           // 改画原版软件光标
}
