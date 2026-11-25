// screen.js — 原版显示模型
// 原版: VGA mode 12h (640x480 16色平面), 游戏画面 640x400 置于第 40 行起 (MAIN.EXE seg0:0164 y+0x28)
// 本模块以「索引帧缓冲」fb[640*400] 保存画面, present() 时套调色盘输出到 640x480 画布 (上下各 40 行黑边)。
// 所有绘图原语的座标规则与原版绘图库相同: x 以「字节栏」(8 像素) 为单位, y 以像素为单位。
export const SCREEN_W = 640;
export const SCREEN_H = 400;
export const CANVAS_H = 480;
export const Y_OFFSET = 40;

export function dac8(v4) { const v6 = v4 * 4; return (v6 << 2) | (v6 >> 4); }

// 由 4 个平面字节 (8 像素) 求像素索引
function expand(fb, o, b0, b1, b2, b3) {
  for (let i = 0; i < 8; i++) {
    const s = 7 - i;
    fb[o + i] = ((b0 >> s) & 1) | (((b1 >> s) & 1) << 1) | (((b2 >> s) & 1) << 2) | (((b3 >> s) & 1) << 3);
  }
}

export class Screen {
  constructor(canvas = null) {
    this.fb = new Uint8Array(SCREEN_W * SCREEN_H);
    this.raw = new Uint8Array(48);
    this.lut = new Uint32Array(16);
    this.dirty = true;
    this.full = null;                  // 片头 (OPEN.EXE) 用: 640x480 索引画面 (整个 VRAM 可见范围), 设置时取代 fb + 上下黑边
    this.border = 0;                   // 片头: VGA 外框色 (overscan) 索引 — 在画布 (可见区) 之外, 仅记录
    if (canvas) {
      this.canvas = canvas; canvas.width = SCREEN_W; canvas.height = CANVAS_H;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.img = this.ctx.createImageData(SCREEN_W, CANVAS_H);
      this.out = new Uint32Array(this.img.data.buffer);
    }
  }
  // raw: 48 bytes, 每色 (B,R,G) 0..15 — 与 MAIN.EXE seg0:159b set_palette 相同
  setPaletteRaw(raw, start = 0, count = 16) {
    for (let i = 0; i < count * 3; i++) this.raw[start * 3 + i] = raw[i];
    for (let i = 0; i < 16; i++) {
      const b = dac8(this.raw[i * 3]), r = dac8(this.raw[i * 3 + 1]), g = dac8(this.raw[i * 3 + 2]);
      this.lut[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
    this.dirty = true;
  }
  // 以 6 比特 DAC 值直接设置一个颜色 (片头 OPEN.EXE 以 17f0 逐色写 DAC; 换算与 setPaletteRaw 相同: 4 比特值 ×4 = 6 比特)
  setDac6(i, r, g, b) {
    const c = v => ((v & 63) << 2) | ((v & 63) >> 4);
    this.lut[i & 15] = 0xff000000 | (c(b) << 16) | (c(g) << 8) | c(r);
    this.dirty = true;
  }
  clear(c = 0) { this.fb.fill(c); this.dirty = true; }
  inBounds(col, y, w, h) { return col >= 0 && w > 0 && col + w <= 80 && y >= 0 && h > 0 && y + h <= 400; }

  // seg0:02a7 mode 0 — 平面字节交错图块 (每 8 像素 4 bytes) 直接覆写; dbl=每行重复一次
  putPlanar(col, y, w, h, src, off = 0, dbl = false) {
    if (!this.inBounds(col, y, w, h * (dbl ? 2 : 1))) return -1;
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
  // seg0:08a6 — 以 8 行图样 (每行 4 个平面字节) 平铺, 纵向相位 = y & 7
  tile(col, y, w, h, src, off) {
    if (!this.inBounds(col, y, w, h)) return;
    const fb = this.fb;
    for (let r = 0; r < h; r++) {
      const p = off + ((y + r) & 7) * 4, o = (y + r) * SCREEN_W + col * 8;
      for (let c = 0; c < w; c++) expand(fb, o + c * 8, src[p], src[p + 1], src[p + 2], src[p + 3]);
    }
    this.dirty = true;
  }
  // seg0:0906 — 以单色填满 (栏为单位)
  fillCols(col, y, w, h, color) {
    if (!this.inBounds(col, y, w, h)) return;
    for (let r = 0; r < h; r++) this.fb.fill(color & 15, (y + r) * SCREEN_W + col * 8, (y + r) * SCREEN_W + (col + w) * 8);
    this.dirty = true;
  }
  // seg0:0ad1 画一点 (4 个平面依颜色比特 OR/AND, 等于直接写入颜色)
  pset(x, y, color) {
    if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return;
    this.fb[y * SCREEN_W + x] = color & 15; this.dirty = true;
  }
  // seg0:09aa 以像素座标填满矩形 (含两端点), 单色 (经 7264 调用时已排序)
  fillRectPx(x0, y0, x1, y1, color) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = Math.max(0, y0); y <= Math.min(SCREEN_H - 1, y1); y++)
      this.fb.fill(color & 15, y * SCREEN_W + Math.max(0, x0), y * SCREEN_W + Math.min(SCREEN_W - 1, x1) + 1);
    this.dirty = true;
  }
  // 1fd9:1b63 Bresenham 直线 (逐点调用 seg0:0ad1); 先保证 xa<=xb (1fd9:171e 的交换)
  //   剪裁矩形 DS:aaac..aab0 = (0,0)-(27F,18F) 即全画面; 范围外的点直接略过
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
  // 1fd9:1f9d 矩形外框 (4 条直线)
  rectOutline(x0, y0, x1, y1, color) {
    this.line(x0, y0, x0, y1, color); this.line(x0, y1, x1, y1, color);
    this.line(x1, y0, x1, y1, color); this.line(x0, y0, x1, y0, color);
  }
  // 1fd9:21e90 只写平面 0..planes-1 的像素矩形 (含两端点); 1fd9:2261 = 3 平面 (保留第 3 比特), 1fd9:227c = 4 平面
  fillRectPxPlanes(x0, y0, x1, y1, color, planes) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const keep = ~((1 << planes) - 1) & 15, set = color & ((1 << planes) - 1);
    for (let y = Math.max(0, y0); y <= Math.min(SCREEN_H - 1, y1); y++)
      for (let x = Math.max(0, x0), o = y * SCREEN_W + x; x <= Math.min(SCREEN_W - 1, x1); x++, o++) this.fb[o] = (this.fb[o] & keep) | set;
    this.dirty = true;
  }
  // 1fd9:1fed XOR 矩形外框: 与 1f9d 相同的 4 条线, 逐点 XOR (seg0:0b33) — 四个角各被画两次而抵消
  //   每条线先经 1fd9:171e 以剪裁矩形 DS:aaac (clip = [x0, y0, x1, y1], 默认全画面) 裁切; 水平 / 垂直线的裁切等于夹限端点 (线在矩形外则不画)
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
  // seg0:063e / 0572 — 1bpp 点阵以「模式字」绘制: bit15 每行画两次, 高字节=模式 (0 黑底, 1 XOR, 2 AND, 3 OR, 4 透明), 低字节=颜色
  glyphMode(col, y, w, h, rows, modeWord) {
    if (!this.inBounds(col, y, w, h)) return -1;
    const dbl = (modeWord & 0x8000) !== 0, m = (modeWord >> 8) & 0x7f, color = modeWord & 15, fb = this.fb;
    let yy = y;
    for (let r = 0; r < h; r++) {
      for (let k = 0; k < (dbl ? 2 : 1); k++, yy++) {
        if (yy >= 400) continue;
        for (let c = 0; c < w; c++) {
          const bits = rows[r * w + c], o = yy * 640 + (col + c) * 8;
          for (let i = 0; i < 8; i++) {
            const on = (bits >> (7 - i)) & 1, p = o + i;
            switch (m) {
              case 0: fb[p] = on ? color : 0; break;
              case 1: if (on) fb[p] ^= color; break;
              case 2: if (!on) fb[p] &= ~color; break;
              case 3: if (on) fb[p] |= color; break;
              case 4: if (on) fb[p] = color; break;                 // 纯色: 以颜色取代 (与模拟器比对确认)
            }
          }
        }
      }
    }
    this.dirty = true; return 0;
  }
  // 文字点阵 (1bpp, 每行 w bytes)
  //   bg>0              : seg0:0653 不透明, 1=fg 0=bg
  //   bg==0, mode==0    : seg0:05d0 整格先清成 0 再画 fg
  //   mode 1/2/3/4      : seg0:0186 XOR / AND / OR / 纯色透明
  glyph(col, y, w, h, rows, fg, mode, bg) {
    if (!this.inBounds(col, y, w, h)) return;
    const fb = this.fb; fg &= 15;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const bits = rows[r * w + c], o = (y + r) * SCREEN_W + (col + c) * 8;
      for (let i = 0; i < 8; i++) {
        const on = (bits >> (7 - i)) & 1, p = o + i;
        if (bg) fb[p] = on ? fg : bg & 15;
        else switch (mode) {
          case 0: fb[p] = on ? fg : 0; break;
          case 1: if (on) fb[p] ^= fg; break;
          case 2: if (!on) fb[p] &= ~fg; break;
          case 3: if (on) fb[p] |= fg; break;
          case 4: if (on) fb[p] = fg; break;
        }
      }
    }
    this.dirty = true;
  }
  // 索引图 blit (港口图块等已转成索引像素的资源); key>=0 时该索引透明
  blit(src, sx, sy, w, h, dx, dy, key = -1) {
    const fb = this.fb, sw = src.w, sd = src.data;
    for (let y = 0; y < h; y++) {
      const ty = dy + y; if (ty < 0 || ty >= SCREEN_H) continue;
      let si = (sy + y) * sw + sx, di = ty * SCREEN_W + dx;
      for (let x = 0; x < w; x++, si++, di++) {
        const tx = dx + x; if (tx < 0 || tx >= SCREEN_W) continue;
        const v = sd[si]; if (v !== key) fb[di] = v;
      }
    }
    this.dirty = true;
  }
  present() {
    if (!this.ctx) return;
    const cur = this.cursor, key = cur && cur.visible ? `${cur.x},${cur.y},${cur.shape}` : "";
    if (!this.dirty && key === this.lastCursor) return;
    this.lastCursor = key;
    const fb = this.fb, out = this.out, lut = this.lut, base = Y_OFFSET * SCREEN_W;
    if (this.full) { const f = this.full; for (let i = 0; i < f.length; i++) out[i] = lut[f[i] & 15]; }
    else {
      out.fill(0xff000000, 0, base); out.fill(0xff000000, base + fb.length);
      for (let i = 0; i < fb.length; i++) out[base + i] = lut[fb[i] & 15];
    }
    if (key) this.drawCursor(cur);
    this.ctx.putImageData(this.img, 0, 0);
    this.dirty = false;
  }
  // 原版软件光标 (seg0:31fd): 24 行 x 24 像素; 每个平面 先 AND 遮罩 (gfx+off+0x48) 再 OR 图像 (gfx+off) 于颜色 [2f14]=15 的平面
  // 座标为鼠标驱动座标 (640x480 VRAM 座标, 不含 40 行偏移)
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
