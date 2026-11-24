// input.js — 把瀏覽器鍵盤/滑鼠事件送進原版輸入模型 (core/sys.js)
import { keyToBios } from "./keymap.js";
import { SCREEN_W, CANVAS_H, Y_OFFSET, VIEW_W, VIEW_H, LEGACY_SCALE, LEGACY_OFF_X } from "./screen.js";

// 瀏覽器保留鍵 (重新整理 / 強制重新整理 / 開發者工具): 不送進遊戲、不 preventDefault。
// 原版只看單獨的 F5 (numpad.js 0x3f = 填入最大值) 等; DOS 下 Ctrl+F5 是另一個掃描碼 (0x62), 原版本來就不當作 F5, 所以放行不影響原版操作。
function browserReserved(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.code === "F5" || e.code === "KeyR")) return true;                 // Ctrl+F5 / Ctrl+R / Ctrl+Shift+R
  if (e.code === "F12") return true;
  if (mod && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ" || e.code === "KeyC")) return true;
  return false;
}

export function bindInput(canvas, sys) {
  // 滑鼠在遊戲畫面 (canvas) 外時, 鍵盤完全交給瀏覽器 (不送進遊戲、不 preventDefault)。
  // 初值為 true: 載入時滑鼠可能已在畫面上而尚未觸發 pointerenter。
  let inside = true;
  canvas.addEventListener("pointerenter", () => { inside = true; });
  canvas.addEventListener("pointerleave", () => { inside = false; });
  addEventListener("keydown", e => {
    if (document.body?.dataset.uw2Modal === "open") return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!inside || browserReserved(e)) return;
    const k = keyToBios(e); if (!k) return;
    e.preventDefault();
    sys.pushKey(k[0], k[1]);
  });
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    const vx = Math.max(0, Math.min(VIEW_W - 1, Math.floor(((e.clientX - r.left) * VIEW_W) / r.width)));
    const vy = Math.max(0, Math.min(VIEW_H - 1, Math.floor(((e.clientY - r.top) * VIEW_H) / r.height)));
    sys.mouse.vx = vx;
    sys.mouse.vy = vy;
    sys.mouse.x = Math.max(0, Math.min(SCREEN_W - 1, Math.floor((vx - LEGACY_OFF_X) / LEGACY_SCALE)));
    sys.mouse.y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor(vy / LEGACY_SCALE) + Y_OFFSET));
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
  canvas.style.cursor = "default";        // 階段 4: 使用瀏覽器原生高精度指標
}
