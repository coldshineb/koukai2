// kao.js — 人物头像 (MAIN.EXE seg0:7b0a..7e5f 的移植)
//
// KAO.LZW 由两部分组成:
//   1) LS11 压缩包 (档头 ~ 0x476A2), 256 项:
//        #0..127   具名人物头像 64x80 (0x780 bytes)      seg0:7cdd(ax=栏, dx=y, bx=编号)
//        #128..255 发现物图 48x48 (0x360 bytes)          seg0:7d4c(ax=栏, dx=y, bx=编号), 读第 编号+0x80 项
//                  (动物、遗迹、宝物等; 调用端以 发现物编号+0x55 等方式换算, 见 seg0:293c2 / 347f7)
//   2) 压缩包之后原样附加 7 组「部件」(每组 0x60C0 bytes, 偏移 0x476A2 + 种类*0x60C0), 用来拼合无名人物 (seg0:7bb5):
//        部件  每项大小  项数  放到头像缓冲的位置          选择比特 (部件字 parts)  合成方式
//        A     0x318     8     0x000 (第 0..32 行)        parts & 7                覆写
//        B     0x468     8     0x318 (第 33..79 行)       (parts >> 3) & 7         覆写
//        C     0x1B0     8     0x1F8 (第 21..38 行)       (parts >> 8) & 7         OR
//        D     0x240     4     0x2B8 (第 29..52 行)       (parts >> 6) & 3         OR
//        E     0x1C8     8     0x438 (第 45..63 行)       (parts >> 11) & 7        OR
//      人物数据的部件字 bit14-15 (第 0x1B byte & 0xC0) 不为 0 表示拼合头像, 否则部件字就是具名头像编号 (seg0:7d39)。
//      随机头像: 部件字 = random(0x3FFF) | 0xC000; 种类 = random(7) (seg0:7cb9) 或人物数据 +0x31 & 15 (seg0:7c95)。
// 图像格式: 3 平面, 每 8 像素依序 plane0..2 各 1 byte; 由 seg0:044d 模式 0 绘制, 只写平面 0..2, 平面 3 保留画面原值。
import { lsEntries, lsDecode } from "../core/ls11.js";

export const PARTS_BASE = 0x476a2, PARTS_SET = 0x60c0;
// [大小, 项数, 缓冲位置, 取编号, OR]
export const PARTS = [
  { size: 0x318, n: 8, dest: 0x000, sel: p => p & 7, or: false },
  { size: 0x468, n: 8, dest: 0x318, sel: p => (p >> 3) & 7, or: false },
  { size: 0x1b0, n: 8, dest: 0x1f8, sel: p => (p >> 8) & 7, or: true },
  { size: 0x240, n: 4, dest: 0x2b8, sel: p => (p >> 6) & 3, or: true },
  { size: 0x1c8, n: 8, dest: 0x438, sel: p => (p >> 11) & 7, or: true },
];

export class Kao {
  constructor(source) {
    // 现代模式: 传入 ArtRegistry，直接从标准 PNG 与透明部件图集绘制 (支持任意高清重绘)
    if (source && typeof source.portraitEntry === "function") {
      this.art = source;
      this.file = null;
      this.entries = null;
      this.cache = null;
      // 背景预载 5 张随机头像部件图集
      const parts = ["a", "b", "c", "d", "e"]
        .map(k => source.kaoPartSheet(k))
        .filter(Boolean)
        .map(e => `${source.baseUrl}/${e.path}`);
      void source.preloadUrls(parts);
      return;
    }
    this.art = null;
    this.file = source;
    this.entries = lsEntries(source);
    this.cache = new Map();
  }
  entry(i) { if (!this.cache.has(i)) this.cache.set(i, lsDecode(this.file, this.entries[i])); return this.cache.get(i); }
  // seg0:7bb5 拼合 (返回 0x780 bytes 头像缓冲); 原版按位移读档, 读超出档尾时得到 0
  compose(type, parts) {
    const buf = new Uint8Array(0x780);
    let base = PARTS_BASE + (type & 0xffff) * PARTS_SET;
    for (const P of PARTS) {
      const src = base + P.sel(parts) * P.size;
      for (let i = 0; i < P.size; i++) {
        const v = src + i < this.file.length ? this.file[src + i] : 0;
        if (P.or) buf[P.dest + i] |= v; else buf[P.dest + i] = v;
      }
      base += P.size * P.n;
    }
    return buf;
  }
  // seg0:044d 模式 0: w 栏 x h 行, 只改平面 0..2
  static blit3(scr, col, y, w, h, data) {
    if (!scr.inBounds(col, y, w, h)) return -1;
    scr.clearHdRect?.(col * 8, y, w * 8, h);
    const fb = scr.fb; let s = 0;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++, s += 3) {
      const b0 = data[s], b1 = data[s + 1], b2 = data[s + 2], o = (y + r) * 640 + (col + c) * 8;
      for (let i = 0; i < 8; i++) {
        const sh = 7 - i;
        fb[o + i] = (fb[o + i] & 8) | ((b0 >> sh) & 1) | (((b1 >> sh) & 1) << 1) | (((b2 >> sh) & 1) << 2);
      }
    }
    scr.dirty = true; return 0;
  }
  drawNamed(scr, n, col, y) {
    if (this.art) return this.art.drawEntry(scr, this.art.portraitEntry(n), col * 8, y) ? 0 : -1;
    return Kao.blit3(scr, col, y, 8, 80, this.entry(n));
  }
  drawItem(scr, n, col, y) {
    if (this.art) return this.art.drawEntry(scr, this.art.discoveryEntry(n), col * 8, y) ? 0 : -1;
    return Kao.blit3(scr, col, y, 6, 48, this.entry(n + 0x80));
  }
  drawComposed(scr, type, parts, col, y) {
    if (this.art) {
      const s = Math.max(0, Math.min(6, type & 0xffff));
      const dx = col * 8;
      const layers = [
        ["a", parts & 7, 0, false],
        ["b", (parts >> 3) & 7, 33, false],
        ["c", (parts >> 8) & 7, 21, true],
        ["d", (parts >> 6) & 3, 29, true],
        ["e", (parts >> 11) & 7, 45, true],
      ];
      for (const [key, idx, yOff, transparent] of layers) {
        const meta = this.art.kaoPartSheet(key);
        if (!meta) continue;
        const url = `${this.art.baseUrl}/${meta.path}`;
        const drawLayer = img => {
          const scaleX = (img.naturalWidth || meta.w) / meta.w;
          const scaleY = (img.naturalHeight || meta.h) / meta.h;
          const sx = idx * meta.tileW * scaleX;
          const sy = s * meta.tileH * scaleY;
          scr.drawImage(img, sx, sy, meta.tileW * scaleX, meta.tileH * scaleY, dx, y + yOff, meta.tileW, meta.tileH, { transparent });
        };
        const img = this.art.getImage(url);
        if (img) drawLayer(img);
        else void this.art.loadImage(url).then(im => { if (im) drawLayer(im); });
      }
      return 0;
    }
    return Kao.blit3(scr, col, y, 8, 80, this.compose(type, parts));
  }
  drawRandomType(scr, rng, parts, col, y) { return this.drawComposed(scr, rng.random(7), parts, col, y); }     // 7cb9
  // 7d39: 人物数据 (+0x1A 部件字/头像编号, +0x31 种类)
  drawPerson(scr, rec, col, y) {
    const parts = rec[0x1a] | (rec[0x1b] << 8);
    if (rec[0x1b] & 0xc0) return this.drawComposed(scr, rec[0x31] & 15, parts, col, y);
    return this.drawNamed(scr, parts, col, y);
  }
  // 7e05 / 7e25: 新的随机部件字
  static randomParts(rng) { return rng.random(0x3fff) | 0xc000; }
}
