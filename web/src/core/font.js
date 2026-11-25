// font.js — 原版字体
//   全角: 1.pat / 2.pat 14x14 点阵, 每字 28 bytes (字码->字序规则移植自 MAIN.EXE seg0:4554)
//   半角: BIOS ROM 8x8 (F000:FA6E), 每行重复两次成 8x16 (seg0:0b8c, seg0:47ef)
import { loadBitmap, loadJSON } from "./assets.js";

function tidx(T) {
  if (T >= 0x30 && T <= 0x39) return T - 0x30;
  if (T >= 0x41 && T <= 0x5a) return T - 0x41 + 10;
  if (T >= 0x61 && T <= 0x7a) return T - 0x61 + 36;
  if (T >= 0x80 && T <= 0xfd) return T - 0x80 + 62;
  return -1;
}
// 返回 [font, n] 或 null (原版对无效码取字序 0x2228, 超出字库, 读到空白)
export function codeToGlyph(code) {
  const L = code >> 8, T = code & 0xff;
  if (code >= 0x8130 && code <= 0xaf68) {
    if (L === 0x82) return (T >= 0xa0 && T <= 0xf3) ? [1, T - 0xa0 + 0xeb] : null;
    const t = tidx(T); if (t < 0) return null;
    if (L === 0x81) return [1, t + 1];
    if (L === 0x91) return null;
    if (L >= 0x92) return [1, (L - 0x92) * 188 + 591 + t];
    return [1, (L - 0x81) * 188 + 591 + t];
  }
  if (code >= 0xb030 && code <= 0xd8c3) {
    const t = tidx(T); if (t < 0) return null;
    return [2, (L - 0xb0) * 188 + t + 1];
  }
  return null;
}
const EMPTY28 = new Uint8Array(28);

export class Font {
  // 从原版文件字节创建 (测试/工具用)
  static fromRaw(pat1, pat2, rom8x8) {
    const f = new Font();
    const unpack = (pat) => {
      const n = (pat.length >> 9) * 18 + ((pat.length & 511) / 28 | 0), out = new Uint8Array(n * 28);
      for (let g = 0; g < n; g++) { const o = g * 28 + ((g / 18) | 0) * 8; out.set(pat.subarray(o, o + 28), g * 28); }
      return out;
    };
    f.g1 = unpack(pat1); f.g2 = unpack(pat2); f.rom = rom8x8.slice(0, 1024);
    return f;
  }
  // 浏览器: 从提取后的 PNG 图集还原
  async load(base) {
    const [a1, a2, r, cm] = await Promise.all([
      loadBitmap(base + "/font/font1.png"), loadBitmap(base + "/font/font2.png"),
      loadBitmap(base + "/font/rom8x8.png"), loadJSON(base + "/font/charmap.json")]);
    const fromAtlas = (a, n) => {
      const out = new Uint8Array(n * 28);
      for (let g = 0; g < n; g++) {
        const ax = (g % 64) * 16, ay = ((g / 64) | 0) * 14;
        for (let y = 0; y < 14; y++) for (let b = 0; b < 2; b++) {
          let v = 0; for (let x = 0; x < 8; x++) v = (v << 1) | a.data[(ay + y) * a.w + ax + b * 8 + x];
          out[g * 28 + y * 2 + b] = v;
        }
      }
      return out;
    };
    this.g1 = fromAtlas(a1, 6086); this.g2 = fromAtlas(a2, 7650);
    this.rom = new Uint8Array(1024);
    for (let ch = 0; ch < 128; ch++) for (let y = 0; y < 8; y++) {
      let v = 0; for (let x = 0; x < 8; x++) v = (v << 1) | r.data[y * r.w + ch * 8 + x];
      this.rom[ch * 8 + y] = v;
    }
    this.cm = cm; this.u2c = new Map();
    for (const [code, , , u] of cm.table) this.u2c.set(u, code);
    return this;
  }
  // 全角字点阵 (14 行 x 2 bytes)
  kanjiRows(code) {
    const g = codeToGlyph(code); if (!g) return EMPTY28;
    const src = g[0] === 1 ? this.g1 : this.g2, o = (g[1] - 1) * 28;
    return o + 28 <= src.length ? src.subarray(o, o + 28) : EMPTY28;
  }
  // 半角字点阵 (16 行 x 1 byte); ROM 只有 0..127, 128..255 取自 INT 1Fh 表 (游戏未设置, 为 0)
  asciiRows(ch) {
    const out = new Uint8Array(16);
    if (ch < 128) for (let i = 0; i < 8; i++) out[i * 2] = out[i * 2 + 1] = this.rom[ch * 8 + i];
    return out;
  }
  // JSON 字符串 -> 原版字节 (与 tools/extract.py TextCodec.encode 相同规则)
  encode(s) {
    const out = [];
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
      if (ch === "{") {
        const j = s.indexOf("}", i), tok = s.slice(i + 1, j);
        if (tok[0] === "#") { const v = parseInt(tok.slice(1), 16); out.push(v >> 8, v & 0xff); }
        else out.push(parseInt(tok, 16));
        i = j + 1; continue;
      }
      if (ch === "\n") out.push(0x0a);
      else if (cp < 0x80) out.push(cp);
      else { const c = this.u2c.get(ch); if (c === undefined) throw new Error("unmapped " + ch); out.push(c >> 8, c & 0xff); }
      i += ch.length;
    }
    return Uint8Array.from(out);
  }
}
