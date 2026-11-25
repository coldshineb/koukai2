// screen.js — 現代 HD 2D Canvas 混合顯示模型 (相容原版 640x400 邏輯座標 + 2x HD RGBA PNG 圖層)
// 邏輯解析度: 640x400 (置於 640x480 畫面第 40 行起)，內部以 HD_SCALE=2 (1280x960) 輸出，
// 讓任何高清重繪 PNG 皆可直接以原生真彩與高解析度繪製於 hdCanvas，並與原版文字/視窗圖層無縫合成。
import { drawWideDialog } from "../canvas_ui/wide_dialog.ts";
import { hasDom, syncDomDialog } from "../modern/dom_ui.ts";
import { hideDomWorldHud } from "../modern/dom_hud.ts";
import { hideDomBattleHud } from "../modern/dom_battle.ts";
import { hideDomDuelHud } from "../modern/dom_duel.ts";
import { toSimp } from "../modern/t2s.ts";

export const SCREEN_W = 640;
export const SCREEN_H = 400;
export const CANVAS_H = 480;
export const Y_OFFSET = 40;
export const HD_SCALE = 2;
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const LEGACY_SCALE = 1.8;   // 640×1.8 = 1152, 400×1.8 = 720 (剛好填滿 720 高，無上下黑邊)
export const LEGACY_OFF_X = 64;    // (1280 - 1152) / 2 = 64

export function dac8(v4) { const v6 = v4 * 4; return (v6 << 2) | (v6 >> 4); }

// 由 4 個平面位元組 (8 像素) 求像素索引
function expand(fb, o, b0, b1, b2, b3) {
  for (let i = 0; i < 8; i++) {
    const s = 7 - i;
    fb[o + i] = ((b0 >> s) & 1) | (((b1 >> s) & 1) << 1) | (((b2 >> s) & 1) << 2) | (((b3 >> s) & 1) << 3);
  }
}

export class Screen {
  constructor(canvas = null) {
    this.fb = new Uint8Array(SCREEN_W * SCREEN_H);
    this.hdMask = new Uint8Array(SCREEN_W * SCREEN_H); // 1 = 此像素由 hdCanvas 真彩圖層顯示, 0 = 由 fb 索引層顯示
    this.raw = new Uint8Array(48);
    this.lut = new Uint32Array(16);
    this.refLut = new Uint32Array(16); // 全亮度目標調色盤 LUT，供 fadeBlack 期間繪製 HD 視窗與文字使用
    this.dirty = true;
    this.full = null;                  // 片頭 (OPEN.EXE) 用: 640x480 索引畫面 (整個 VRAM 可見範圍), 設定時取代 fb + 上下黑邊
    this.border = 0;                   // 片頭: VGA 外框色 (overscan) 索引 — 在畫布 (可見區) 之外, 僅記錄
    this.hdCanvas = null;
    this.hdCtx = null;
    this.fbCanvas = null;
    this.fbCtx = null;
    this.fbImg = null;
    this.fbOut = null;
    this.atmosphere = { active: false, mode: "day", weather: 0, atSea: false };
    this.wideRenderer = null;          // 16:9 (1280x720) 寬螢幕全屏渲染器 (港口/海面/建築/艦隊)
    this.wideDialog = null;            // 16:9 現代底部寬幅對話欄狀態 { text, portraitId, waiting }
    this.wideArt = null;               // ArtRegistry 參考 (供 wideDialog 載入頭像)
    this.wideOverlays = [];            // 16:9 原生現代 Canvas 浮層 (選單/清單/確認框/數字器)
    this.winStackRef = null;           // 連結 WindowSystem.stack，在寬螢幕地圖上僅疊加開啟中的視窗
    if (canvas) {
      this.canvas = canvas;
      this.dpr = typeof window !== "undefined" ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;
      canvas.width = Math.round(VIEW_W * this.dpr);
      canvas.height = Math.round(VIEW_H * this.dpr);
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.fillStyle = "#070f1c";
      this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      // HD RGBA 美術層 (1280x800, 對應邏輯 640x400 遊戲區)
      this.hdCanvas = document.createElement("canvas");
      this.hdCanvas.width = SCREEN_W * HD_SCALE;
      this.hdCanvas.height = SCREEN_H * HD_SCALE;
      this.hdCtx = this.hdCanvas.getContext("2d", { willReadFrequently: true });
      this.hdCtx.imageSmoothingEnabled = false;

      // 索引層合成用離屏畫布 (640x480, 支援完整片頭與透明打洞)
      this.fbCanvas = document.createElement("canvas");
      this.fbCanvas.width = SCREEN_W;
      this.fbCanvas.height = CANVAS_H;
      this.fbCtx = this.fbCanvas.getContext("2d");
      this.img = this.fbCtx.createImageData(SCREEN_W, CANVAS_H);
      this.out = new Uint32Array(this.img.data.buffer);
    }
  }
  clearHdRect(x, y, w, h) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(SCREEN_W, (x + w) | 0), y1 = Math.min(SCREEN_H, (y + h) | 0);
    if (x0 >= x1 || y0 >= y1) return;
    for (let r = y0; r < y1; r++) this.hdMask.fill(0, r * SCREEN_W + x0, r * SCREEN_W + x1);
  }
  setHdRect(x, y, w, h) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(SCREEN_W, (x + w) | 0), y1 = Math.min(SCREEN_H, (y + h) | 0);
    if (x0 >= x1 || y0 >= y1) return;
    for (let r = y0; r < y1; r++) this.hdMask.fill(1, r * SCREEN_W + x0, r * SCREEN_W + x1);
  }
  // 將目前 fb 區塊烘焙至 hdCanvas (供透明 PNG 疊加於原版視窗/底圖上時保持正確背景)
  bakeFbToHd(x, y, w, h) {
    if (!this.hdCtx) return;
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(SCREEN_W, (x + w) | 0), y1 = Math.min(SCREEN_H, (y + h) | 0);
    if (x0 >= x1 || y0 >= y1) return;
    let hasZero = false;
    for (let r = y0; r < y1 && !hasZero; r++) {
      const off = r * SCREEN_W;
      for (let c = x0; c < x1; c++) if (!this.hdMask[off + c]) { hasZero = true; break; }
    }
    if (!hasZero) return;
    const bw = x1 - x0, bh = y1 - y0;
    const img = this.hdCtx.getImageData(x0 * HD_SCALE, y0 * HD_SCALE, bw * HD_SCALE, bh * HD_SCALE);
    const d32 = new Uint32Array(img.data.buffer);
    const fb = this.fb, lut = this.refLut, mask = this.hdMask;
    for (let r = 0; r < bh; r++) {
      const sy = (y0 + r) * SCREEN_W + x0;
      for (let c = 0; c < bw; c++) {
        if (mask[sy + c]) continue;
        const col = lut[fb[sy + c] & 15];
        const rx = c * HD_SCALE, ry = r * HD_SCALE, stride = bw * HD_SCALE;
        for (let dy = 0; dy < HD_SCALE; dy++) {
          const row = (ry + dy) * stride + rx;
          for (let dx = 0; dx < HD_SCALE; dx++) d32[row + dx] = col;
        }
        mask[sy + c] = 1;
      }
    }
    this.hdCtx.putImageData(img, x0 * HD_SCALE, y0 * HD_SCALE);
  }
  // 繪製現代 PNG / 圖集切片至 HD 2D 圖層 (座標與尺寸皆為邏輯 640x400 像素)
  drawImage(img, sx, sy, sw, sh, dx, dy, dw = sw, dh = sh, { transparent = false, smooth = null } = {}) {
    if (!this.hdCtx || !img) return;
    if (transparent) this.bakeFbToHd(dx, dy, dw, dh);
    else this.setHdRect(dx, dy, dw, dh);
    const prevSmooth = this.hdCtx.imageSmoothingEnabled;
    this.hdCtx.imageSmoothingEnabled = smooth !== null ? smooth : (sw > dw || sh > dh);
    this.hdCtx.drawImage(img, sx, sy, sw, sh, dx * HD_SCALE, dy * HD_SCALE, dw * HD_SCALE, dh * HD_SCALE);
    this.hdCtx.imageSmoothingEnabled = prevSmooth;
    this.dirty = true;
  }
  // 依全亮度目標調色盤將索引色 (0..15) 轉為 CSS rgb()，避免 fadeBlack() 期間畫出的 HD 文字/視窗變成全黑
  colorCss(idx) {
    const c = this.refLut[idx & 15] >>> 0;
    const r = c & 0xff, g = (c >>> 8) & 0xff, b = (c >>> 16) & 0xff;
    return `rgb(${r},${g},${b})`;
  }
  setTargetPaletteRaw(raw) {
    if (!raw || raw.length < 48) return;
    let maxV = 0;
    for (let i = 0; i < 48; i++) if (raw[i] > maxV) maxV = raw[i];
    if (maxV < 4) return;
    for (let i = 0; i < 16; i++) {
      const b = dac8(raw[i * 3]), r = dac8(raw[i * 3 + 1]), g = dac8(raw[i * 3 + 2]);
      this.refLut[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }
  // Phase 6: HD 2D Canvas 矢量文字繪製 (座標與欄寬沿用原版 640x400 格線，100% 原版文本零杜撰)
  drawTextHd(col, y, wCols, hPx, ch, fgIdx, bgIdx, mode) {
    if (!this.hdCtx || !this.inBounds(col, y, wCols, hPx)) return false;
    // XOR / AND / OR 特殊混合模式回退原版點陣以保持游標/反白精確一致
    if (!bgIdx && (mode === 1 || mode === 2 || mode === 3)) return false;
    const dx = col * 8, dy = y, dw = wCols * 8, dh = hPx;
    const ctx = this.hdCtx;
    if (bgIdx > 0) {
      ctx.fillStyle = this.colorCss(bgIdx);
      ctx.fillRect(dx * HD_SCALE, dy * HD_SCALE, dw * HD_SCALE, dh * HD_SCALE);
      this.setHdRect(dx, dy, dw, dh);
    } else if (mode === 0) {
      ctx.fillStyle = this.colorCss(0);
      ctx.fillRect(dx * HD_SCALE, dy * HD_SCALE, dw * HD_SCALE, dh * HD_SCALE);
      this.setHdRect(dx, dy, dw, dh);
    } else {
      // mode === 4 (透明文字): 先烘焙底層再疊繪清晰矢量字
      this.bakeFbToHd(dx, dy, dw, dh);
    }
    if (ch && ch !== " ") {
      const isWide = wCols >= 2;
      const fontSize = isWide ? Math.round(13.5 * HD_SCALE) : Math.round(13 * HD_SCALE);
      ctx.font = isWide
        ? `600 ${fontSize}px "Noto Serif TC", "Songti SC", "PMingLiU", "Microsoft JhengHei", serif`
        : `600 ${fontSize}px "Consolas", "Noto Serif TC", monospace`;
      ctx.fillStyle = this.colorCss(fgIdx);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(toSimp(ch), (dx + dw / 2) * HD_SCALE, (dy + dh / 2 + 0.5) * HD_SCALE, dw * HD_SCALE);
    }
    this.dirty = true;
    return true;
  }
  // Phase 6: HD 2D Canvas 現代大航海羊皮紙/古銅金木框窗體繪製 (取代 ui_frame.bin 像素框)
  drawWindowHd(col, y, wCols, hPx, style = 0, { shadow = false } = {}) {
    if (!this.hdCtx || !this.inBounds(col, y, wCols, hPx)) return false;
    const dx = col * 8, dy = y, dw = wCols * 8, dh = hPx;
    const S = HD_SCALE;
    const ctx = this.hdCtx;

    // 柔和陰影 (若啟用，覆蓋右 8px、下 4px，對應 WindowSystem.shadowedSaved 範圍)
    if (shadow) {
      this.bakeFbToHd(dx, dy, Math.min(SCREEN_W - dx, dw + 8), Math.min(SCREEN_H - dy, dh + 4));
      ctx.fillStyle = "rgba(8, 12, 22, 0.42)";
      ctx.fillRect((dx + 5) * S, (dy + 4) * S, dw * S, dh * S);
    }

    this.setHdRect(dx, dy, dw, dh);
    const x0 = dx * S, y0 = dy * S, W = dw * S, H = dh * S;
    const pad = 7 * S;

    // 外框底色 (深胡桃木 / 古銅金依 style 區分)
    const outerWood = style === 1 ? "#2b3b52" : "#3a2514";
    const brassHi = style === 1 ? "#e6c67c" : "#cfa85b";
    const brassLo = style === 1 ? "#8c6d32" : "#785724";

    ctx.fillStyle = outerWood;
    ctx.fillRect(x0, y0, W, H);

    // 內部使用目前調色盤色 7 (羊皮紙底色)，確保所有 bg=7 文字與 fillCols(..., 7) 無縫融合
    ctx.fillStyle = this.colorCss(7);
    if (W > pad * 2 && H > pad * 2) {
      ctx.fillRect(x0 + pad, y0 + pad, W - pad * 2, H - pad * 2);
    }

    // 雙層古銅金細框
    ctx.strokeStyle = brassHi;
    ctx.lineWidth = S;
    ctx.strokeRect(x0 + 1.5 * S, y0 + 1.5 * S, W - 3 * S, H - 3 * S);

    ctx.strokeStyle = brassLo;
    ctx.lineWidth = S;
    if (W > pad * 2 && H > pad * 2) {
      ctx.strokeRect(x0 + pad - 0.5 * S, y0 + pad - 0.5 * S, W - pad * 2 + S, H - pad * 2 + S);
    }

    // 四角古銅鉚釘裝飾
    const rivet = 2 * S;
    ctx.fillStyle = brassHi;
    ctx.fillRect(x0 + 3 * S, y0 + 3 * S, rivet, rivet);
    ctx.fillRect(x0 + W - 5 * S, y0 + 3 * S, rivet, rivet);
    ctx.fillRect(x0 + 3 * S, y0 + H - 5 * S, rivet, rivet);
    ctx.fillRect(x0 + W - 5 * S, y0 + H - 5 * S, rivet, rivet);

    this.dirty = true;
    return true;
  }
  // 保存與還原矩形區域 (同時保存 fb、hdMask 與 hdCanvas 真彩像素，供 WindowSystem 使用)
  saveRegion(x, y, w, h) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(SCREEN_W, (x + w) | 0), y1 = Math.min(SCREEN_H, (y + h) | 0);
    const cw = Math.max(0, x1 - x0), ch = Math.max(0, y1 - y0);
    const fbData = new Uint8Array(w * h);
    const maskData = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      const yy = y + r; if (yy < 0 || yy >= SCREEN_H) continue;
      fbData.set(this.fb.subarray(yy * SCREEN_W + x, yy * SCREEN_W + x + w), r * w);
      maskData.set(this.hdMask.subarray(yy * SCREEN_W + x, yy * SCREEN_W + x + w), r * w);
    }
    const hdImg = (this.hdCtx && cw > 0 && ch > 0)
      ? this.hdCtx.getImageData(x0 * HD_SCALE, y0 * HD_SCALE, cw * HD_SCALE, ch * HD_SCALE)
      : null;
    return { x, y, w, h, x0, y0, cw, ch, fbData, maskData, hdImg };
  }
  restoreRegion(snap, fromRow, toY, rows) {
    const W = snap.w;
    for (let r = 0; r < rows; r++) {
      const yy = toY + r, sr = fromRow + r;
      if (yy < 0 || yy >= SCREEN_H || sr < 0 || sr >= snap.h) continue;
      this.fb.set(snap.fbData.subarray(sr * W, sr * W + W), yy * SCREEN_W + snap.x);
      this.hdMask.set(snap.maskData.subarray(sr * W, sr * W + W), yy * SCREEN_W + snap.x);
    }
    if (this.hdCtx && snap.hdImg && snap.cw > 0) {
      const sr0 = Math.max(0, fromRow - (snap.y0 - snap.y));
      const sr1 = Math.min(snap.ch, sr0 + rows);
      if (sr1 > sr0) {
        const destY = (toY + (sr0 - (fromRow - (snap.y0 - snap.y)))) * HD_SCALE;
        this.hdCtx.putImageData(
          snap.hdImg,
          snap.x0 * HD_SCALE,
          destY - sr0 * HD_SCALE,
          0,
          sr0 * HD_SCALE,
          snap.cw * HD_SCALE,
          (sr1 - sr0) * HD_SCALE,
        );
      }
    }
    this.dirty = true;
  }
  // raw: 48 bytes, 每色 (B,R,G) 0..15 — 與 MAIN.EXE seg0:159b set_palette 相同
  setPaletteRaw(raw, start = 0, count = 16) {
    for (let i = 0; i < count * 3; i++) this.raw[start * 3 + i] = raw[i];
    for (let i = 0; i < 16; i++) {
      const b = dac8(this.raw[i * 3]), r = dac8(this.raw[i * 3 + 1]), g = dac8(this.raw[i * 3 + 2]);
      const col = 0xff000000 | (b << 16) | (g << 8) | r;
      this.lut[i] = col;
      if (!this.refLut[7]) this.refLut[i] = col;
    }
    this.dirty = true;
  }
  // 以 6 位元 DAC 值直接設定一個顏色 (片頭 OPEN.EXE / 結局 END.EXE 以逐色寫 DAC; 同步更新 raw 避免 maxPal 誤判為全黑)
  setDac6(i, r, g, b) {
    const idx = i & 15;
    const c = v => ((v & 63) << 2) | ((v & 63) >> 4);
    this.raw[idx * 3] = (b >> 2) & 15;
    this.raw[idx * 3 + 1] = (r >> 2) & 15;
    this.raw[idx * 3 + 2] = (g >> 2) & 15;
    this.lut[idx] = 0xff000000 | (c(b) << 16) | (c(g) << 8) | c(r);
    this.dirty = true;
  }
  clear(c = 0) {
    this.fb.fill(c);
    this.hdMask.fill(0);
    if (this.hdCtx) this.hdCtx.clearRect(0, 0, SCREEN_W * HD_SCALE, SCREEN_H * HD_SCALE);
    this.dirty = true;
  }
  inBounds(col, y, w, h) { return col >= 0 && w > 0 && col + w <= 80 && y >= 0 && h > 0 && y + h <= 400; }

  // seg0:02a7 mode 0 — 平面位元組交錯圖塊 (每 8 像素 4 bytes) 直接覆寫; dbl=每行重複一次
  putPlanar(col, y, w, h, src, off = 0, dbl = false) {
    if (!this.inBounds(col, y, w, h * (dbl ? 2 : 1))) return -1;
    this.clearHdRect(col * 8, y, w * 8, h * (dbl ? 2 : 1));
    const fb = this.fb; let s = off;
    for (let r = 0; r < h; r++) {
      const rs = s;
      for (let k = 0; k < (dbl ? 2 : 1); k++) {
        s = rs; const yy = y + r * (dbl ? 2 : 1) + k;
        for (let c = 0; c < w; c++, s += 4) expand(fb, yy * SCREEN_W + (col + c) * 8, src[s], src[s + 1], src[s + 2], src[s + 3]);
      }
    }
    this.dirty = true; return 0;
  }
  // seg0:08a6 — 以 8 行圖樣 (每行 4 個平面位元組) 平鋪, 縱向相位 = y & 7
  tile(col, y, w, h, src, off) {
    if (!this.inBounds(col, y, w, h)) return;
    this.clearHdRect(col * 8, y, w * 8, h);
    const fb = this.fb;
    for (let r = 0; r < h; r++) {
      const p = off + ((y + r) & 7) * 4, o = (y + r) * SCREEN_W + col * 8;
      for (let c = 0; c < w; c++) expand(fb, o + c * 8, src[p], src[p + 1], src[p + 2], src[p + 3]);
    }
    this.dirty = true;
  }
  // seg0:0906 — 以單色填滿 (欄為單位)
  fillCols(col, y, w, h, color) {
    if (!this.inBounds(col, y, w, h)) return;
    this.clearHdRect(col * 8, y, w * 8, h);
    for (let r = 0; r < h; r++) this.fb.fill(color & 15, (y + r) * SCREEN_W + col * 8, (y + r) * SCREEN_W + (col + w) * 8);
    this.dirty = true;
  }
  // seg0:0ad1 畫一點 (4 個平面依顏色位元 OR/AND, 等於直接寫入顏色)
  pset(x, y, color) {
    if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return;
    const idx = y * SCREEN_W + x;
    this.fb[idx] = color & 15; this.hdMask[idx] = 0; this.dirty = true;
  }
  // seg0:09aa 以像素座標填滿矩形 (含兩端點), 單色 (經 7264 呼叫時已排序)
  fillRectPx(x0, y0, x1, y1, color) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const cx0 = Math.max(0, x0), cx1 = Math.min(SCREEN_W - 1, x1);
    const cy0 = Math.max(0, y0), cy1 = Math.min(SCREEN_H - 1, y1);
    for (let y = cy0; y <= cy1; y++) {
      this.fb.fill(color & 15, y * SCREEN_W + cx0, y * SCREEN_W + cx1 + 1);
      this.hdMask.fill(0, y * SCREEN_W + cx0, y * SCREEN_W + cx1 + 1);
    }
    this.dirty = true;
  }
  // 1fd9:1b63 Bresenham 直線 (逐點呼叫 seg0:0ad1); 先保證 xa<=xb (1fd9:171e 的交換)
  //   剪裁矩形 DS:aaac..aab0 = (0,0)-(27F,18F) 即全畫面; 範圍外的點直接略過
  line(xa, ya, xb, yb, color) {
    if (xb < xa) { [xa, xb] = [xb, xa]; [ya, yb] = [yb, ya]; }
    const dy = Math.abs(yb - ya), dx = Math.abs(xb - xa);
    const half = v => -((v - (v < 0 ? -1 : 0)) >> 1);    // cwd/sub/sar/neg: -(v/2) 向零取整
    if (dx >= dy) {
      let err = half(dx);
      const st = yb - ya < 0 ? -1 : yb === ya ? 0 : 1;
      while (xa <= xb) {
        this.pset(xa, ya, color);
        err += dy; if (err >= 0) { ya += st; err -= dx; }
        xa++;
      }
    } else {
      if (yb < ya) { [xa, xb] = [xb, xa]; [ya, yb] = [yb, ya]; }
      let err = half(dy);
      const st = xb - xa < 0 ? -1 : xb === xa ? 0 : 1;
      while (ya <= yb) {
        this.pset(xa, ya, color);
        err += dx; if (err >= 0) { xa += st; err -= dy; }
        ya++;
      }
    }
  }
  // 1fd9:1f9d 矩形外框 (4 條直線)
  rectOutline(x0, y0, x1, y1, color) {
    this.line(x0, y0, x0, y1, color); this.line(x0, y1, x1, y1, color);
    this.line(x1, y0, x1, y1, color); this.line(x0, y0, x1, y0, color);
  }
  // 1fd9:21e90 只寫平面 0..planes-1 的像素矩形 (含兩端點); 1fd9:2261 = 3 平面 (保留第 3 位元), 1fd9:227c = 4 平面
  fillRectPxPlanes(x0, y0, x1, y1, color, planes) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const keep = ~((1 << planes) - 1) & 15, set = color & ((1 << planes) - 1);
    for (let y = Math.max(0, y0); y <= Math.min(SCREEN_H - 1, y1); y++)
      for (let x = Math.max(0, x0), o = y * SCREEN_W + x; x <= Math.min(SCREEN_W - 1, x1); x++, o++) this.fb[o] = (this.fb[o] & keep) | set;
    this.dirty = true;
  }
  // 1fd9:1fed XOR 矩形外框: 與 1f9d 相同的 4 條線, 逐點 XOR (seg0:0b33) — 四個角各被畫兩次而抵消
  //   每條線先經 1fd9:171e 以剪裁矩形 DS:aaac (clip = [x0, y0, x1, y1], 預設全畫面) 裁切; 水平 / 垂直線的裁切等於夾限端點 (線在矩形外則不畫)
  xorRect(x0, y0, x1, y1, color, clip = null) {
    const p = (x, y) => { if (x >= 0 && x < SCREEN_W && y >= 0 && y < SCREEN_H) this.fb[y * SCREEN_W + x] ^= color & 15; };
    const save = this.pset; this.pset = p;
    try {
      if (!clip) this.rectOutline(x0, y0, x1, y1, color);
      else {
        const [cx0, cy0, cx1, cy1] = clip;
        const v = (x, ya, yb) => { if (x < cx0 || x > cx1) return; const a = Math.max(Math.min(ya, yb), cy0), b = Math.min(Math.max(ya, yb), cy1); if (a <= b) this.line(x, a, x, b, color); };
        const h = (y, xa, xb) => { if (y < cy0 || y > cy1) return; const a = Math.max(Math.min(xa, xb), cx0), b = Math.min(Math.max(xa, xb), cx1); if (a <= b) this.line(a, y, b, y, color); };
        v(x0, y0, y1); h(y1, x0, x1); v(x1, y0, y1); h(y0, x0, x1);
      }
    } finally { this.pset = save; }
    this.dirty = true;
  }
  // seg0:063e / 0572 — 1bpp 點陣以「模式字」繪製: bit15 每行畫兩次, 高位元組=模式 (0 黑底, 1 XOR, 2 AND, 3 OR, 4 透明), 低位元組=顏色
  glyphMode(col, y, w, h, rows, modeWord) {
    if (!this.inBounds(col, y, w, h)) return -1;
    const dbl = (modeWord & 0x8000) !== 0, m = (modeWord >> 8) & 0x7f, color = modeWord & 15, fb = this.fb, hm = this.hdMask;
    let yy = y;
    for (let r = 0; r < h; r++) {
      for (let k = 0; k < (dbl ? 2 : 1); k++, yy++) {
        if (yy >= 400) continue;
        for (let c = 0; c < w; c++) {
          const bits = rows[r * w + c], o = yy * 640 + (col + c) * 8;
          for (let i = 0; i < 8; i++) {
            const on = (bits >> (7 - i)) & 1, p = o + i;
            switch (m) {
              case 0: fb[p] = on ? color : 0; hm[p] = 0; break;
              case 1: if (on) { fb[p] ^= color; hm[p] = 0; } break;
              case 2: if (!on) { fb[p] &= ~color; hm[p] = 0; } break;
              case 3: if (on) { fb[p] |= color; hm[p] = 0; } break;
              case 4: if (on) { fb[p] = color; hm[p] = 0; } break;                 // 純色: 以顏色取代 (與模擬器比對確認)
            }
          }
        }
      }
    }
    this.dirty = true; return 0;
  }
  // 文字點陣 (1bpp, 每行 w bytes)
  //   bg>0              : seg0:0653 不透明, 1=fg 0=bg
  //   bg==0, mode==0    : seg0:05d0 整格先清成 0 再畫 fg
  //   mode 1/2/3/4      : seg0:0186 XOR / AND / OR / 純色透明
  glyph(col, y, w, h, rows, fg, mode, bg) {
    if (!this.inBounds(col, y, w, h)) return;
    const fb = this.fb, hm = this.hdMask; fg &= 15;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const bits = rows[r * w + c], o = (y + r) * SCREEN_W + (col + c) * 8;
      for (let i = 0; i < 8; i++) {
        const on = (bits >> (7 - i)) & 1, p = o + i;
        if (bg) { fb[p] = on ? fg : bg & 15; hm[p] = 0; }
        else switch (mode) {
          case 0: fb[p] = on ? fg : 0; hm[p] = 0; break;
          case 1: if (on) { fb[p] ^= fg; hm[p] = 0; } break;
          case 2: if (!on) { fb[p] &= ~fg; hm[p] = 0; } break;
          case 3: if (on) { fb[p] |= fg; hm[p] = 0; } break;
          case 4: if (on) { fb[p] = fg; hm[p] = 0; } break;
        }
      }
    }
    this.dirty = true;
  }
  // 索引圖 blit (港口圖塊等已轉成索引像素的資源); key>=0 時該索引透明
  blit(src, sx, sy, w, h, dx, dy, key = -1) {
    const fb = this.fb, hm = this.hdMask, sw = src.w, sd = src.data;
    for (let y = 0; y < h; y++) {
      const ty = dy + y; if (ty < 0 || ty >= SCREEN_H) continue;
      let si = (sy + y) * sw + sx, di = ty * SCREEN_W + dx;
      for (let x = 0; x < w; x++, si++, di++) {
        const tx = dx + x; if (tx < 0 || tx >= SCREEN_W) continue;
        const v = sd[si]; if (v !== key) { fb[di] = v; hm[di] = 0; }
      }
    }
    this.dirty = true;
  }
  setAtmosphere(patch) {
    Object.assign(this.atmosphere, patch);
    this.dirty = true;
  }
  drawAtmosphere(_ctx) {
    // 已改由原版時段調色盤直接渲染地表與精靈材質，不再疊加人工夜幕/打燈濾鏡
  }
  present() {
    if (!this.ctx) return;
    if (this.dpr && this.dpr !== 1) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cur = this.cursor, key = cur && cur.visible ? `${cur.x},${cur.y},${cur.shape}` : "";
    const liveFx = !!this.wideRenderer;
    if (!this.dirty && !liveFx && key === this.lastCursor) return;
    this.lastCursor = key;
    const fb = this.fb, hm = this.hdMask, out = this.out, lut = this.lut, base = Y_OFFSET * SCREEN_W;
    if (this.full) {
      const f = this.full;
      for (let i = 0; i < f.length; i++) out[i] = lut[f[i] & 15];
      if (key) this.drawCursor(cur);
      this.fbCtx.putImageData(this.img, 0, 0);
      this.ctx.fillStyle = "#070f1c";
      this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const scale = VIEW_H / CANVAS_H;
      const dw = Math.round(SCREEN_W * scale), dx = Math.round((VIEW_W - dw) / 2);
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(this.fbCanvas, 0, 0, SCREEN_W, CANVAS_H, dx, 0, dw, VIEW_H);
      this.dirty = false;
      return;
    }

    // 準備索引層 (hdMask===0 的像素)
    out.fill(0, 0, base);
    out.fill(0, base + fb.length);
    for (let i = 0; i < fb.length; i++) out[base + i] = hm[i] ? 0 : lut[fb[i] & 15];
    if (key) this.drawCursor(cur);
    this.fbCtx.putImageData(this.img, 0, 0);

    // 計算目前淡出遮罩強度
    let maxPal = 0;
    for (let i = 0; i < 48; i++) if (this.raw[i] > maxPal) maxPal = this.raw[i];

    if (this.wideRenderer) {
      // 模式 A: 16:9 (1280x720) 全屏現代遊戲佈局
      this.wideRenderer(this.ctx, this);
      // 16:9 現代底部對話欄（瀏覽器使用與讀取進度同款的羊皮紙 DOM 對話卡）
      if (hasDom()) syncDomDialog(this.wideArt, this.wideDialog);
      else if (this.wideDialog) drawWideDialog(this.ctx, this.wideArt, this.wideDialog);
      // 16:9 原生現代 Canvas 浮層 (小地圖 / 世界航海圖等)
      for (const fn of this.wideOverlays) fn(this.ctx, this);
      if (maxPal < 15) {
        this.ctx.fillStyle = `rgba(0,0,0,${(1 - maxPal / 15).toFixed(3)})`;
        this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      this.dirty = false;
      return;
    }
    if (hasDom()) { syncDomDialog(null, null); hideDomWorldHud(); hideDomBattleHud(); hideDomDuelHud(); }

    // 模式 B: 非全屏過渡場景 (標題 / 建築內景 / 海戰 / 一騎打) 居中無黑邊高畫質顯示 (1152x720)
    this.ctx.fillStyle = "#081222";
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const dw = Math.round(SCREEN_W * LEGACY_SCALE);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.hdCanvas, 0, 0, SCREEN_W * HD_SCALE, SCREEN_H * HD_SCALE, LEGACY_OFF_X, 0, dw, VIEW_H);
    if (maxPal < 15) {
      this.ctx.fillStyle = `rgba(0,0,0,${(1 - maxPal / 15).toFixed(3)})`;
      this.ctx.fillRect(LEGACY_OFF_X, 0, dw, VIEW_H);
    }
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.fbCanvas, 0, Y_OFFSET, SCREEN_W, SCREEN_H, LEGACY_OFF_X, 0, dw, VIEW_H);
    this.dirty = false;
  }
  // 原版軟體游標 (seg0:31fd): 24 行 x 24 像素; 每個平面 先 AND 遮罩 (gfx+off+0x48) 再 OR 圖像 (gfx+off) 於顏色 [2f14]=15 的平面
  // 座標為滑鼠驅動座標 (640x480 VRAM 座標, 不含 40 行偏移)
  drawCursor({ x, y, gfx, shape, color = 15 }) {
    const out = this.out, lut = this.lut;
    for (let r = 0; r < 24; r++) {
      const yy = y + r; if (yy < 0 || yy >= CANVAS_H) continue;
      for (let b = 0; b < 3; b++) {
        const img = gfx[shape + r * 3 + b], mask = gfx[shape + 0x48 + r * 3 + b];
        for (let i = 0; i < 8; i++) {
          const xx = x + b * 8 + i; if (xx < 0 || xx >= SCREEN_W) continue;
          const sh = 7 - i, m = (mask >> sh) & 1, im = (img >> sh) & 1;
          const vy = yy - Y_OFFSET, under = vy >= 0 && vy < SCREEN_H ? this.fb[vy * SCREEN_W + xx] : 0;
          const pix = (m ? under : 0) | (im ? color : 0);
          out[yy * SCREEN_W + xx] = lut[pix & 15];
        }
      }
    }
  }
}
