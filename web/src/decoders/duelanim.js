// decoders/duelanim.js — 一骑打的离屏平面画布 (MAIN.EXE seg0:22ca / 23f7 / 2461 / 22f9 / 237c) 与 IAP / IAE 动画档 (docs/RE_NOTES.md 30.17)
// 原版的远程缓冲: 4 个平面各 planeSize bytes 连续排列 (段距 planeSize / 16), 平面 k 的地址 = k × planeSize + (偏移 & 0xffff)。
// 偏移以 16 比特回绕 (原版是段内偏移); 回绕到 4 个平面之外的写入落在多配置的 0x10000 bytes 内 (原版是别的内存, 不影响画面)。
//   主画布 [a02c]: planeSize 0x2a30, 每列 0x5a bytes (720 点) × 0x78 列
//   精灵画布 [a02e] / [a030] / [a032]: planeSize 0x18c0, 每列 0x48 bytes × 0x58 列 (8 格 × 9 栏)
// 交错缓冲 ([0c8a] 合成用、[03ee] 解压用): Uint8Array 0x10000, 每 8 点 4 bytes (平面 0..3), 段内偏移回绕
import { lsEntries, lsDecode } from "../core/ls11.js";

const daCount = n => (n & 0xffff) || 0x10000;                    // loop / dec word: 0 代表 65536 次 (照搬)

export class PlanarBuf {
  constructor(planeSize, stride) { this.ps = planeSize; this.stride = stride; this.m = new Uint8Array(planeSize * 3 + 0x10000); }
  at(k, off) { return k * this.ps + (off & 0xffff); }
  start(x, y) { return (x + Math.imul(y & 0xffff, this.stride)) & 0xffff; }   // di = x + y × [22be] (mul: 低 16 比特)
  // 23f7: 以单色填满 (色的 bit0..3 → 平面 0..3 各写 0x00 / 0xff)
  fill(x, y, w, h, color) {
    const m = this.m, v = [color & 1, color & 2, color & 4, color & 8].map(b => (b ? 0xff : 0));
    let di = this.start(x, y);
    for (let r = daCount(h); r > 0; r--) {
      let d = di;
      for (let c = daCount(w); c > 0; c--, d = (d + 1) & 0xffff) for (let k = 0; k < 4; k++) m[this.at(k, d)] = v[k];
      di = (di + this.stride) & 0xffff;
    }
  }
  // 2461: 交错来源 (每栏 p0 p1 p2 p3) 原样写入
  copyIn(x, y, w, h, src, off) {
    const m = this.m; let di = this.start(x, y), si = off & 0xffff;
    for (let r = daCount(h); r > 0; r--) {
      let d = di;
      for (let c = daCount(w); c > 0; c--, d = (d + 1) & 0xffff) for (let k = 0; k < 4; k++) { m[this.at(k, d)] = src[si]; si = (si + 1) & 0xffff; }
      di = (di + this.stride) & 0xffff;
    }
  }
  // 22f9: 来源每栏第 4 byte = 遮罩 bh; 平面 0..2 = (原值 & bh) | 来源, bl = ~bh | 新平面 0 | 1 | 2, 平面 3 = ~bl
  maskIn(x, y, w, h, src, off, srcCols) {
    const m = this.m, skip = ((srcCols - w) << 2) & 0xffff; let di = this.start(x, y), si = off & 0xffff;
    for (let r = daCount(h); r > 0; r--) {
      let d = di;
      for (let c = daCount(w); c > 0; c--, d = (d + 1) & 0xffff) {
        const bh = src[(si + 3) & 0xffff]; let bl = ~bh & 0xff;
        for (let k = 0; k < 3; k++) { const a = this.at(k, d); m[a] = (m[a] & bh) | src[si]; bl |= m[a]; si = (si + 1) & 0xffff; }
        m[this.at(3, d)] = ~bl & 0xff; si = (si + 1) & 0xffff;
      }
      di = (di + this.stride) & 0xffff; si = (si + skip) & 0xffff;
    }
  }
  // 237c: 画布 → 交错目的 dst; 遮罩 = 平面 3: 目的 p0..p2 = (原值 & 平面 3) | 平面 k, p3 = 0
  compose(x, y, w, h, dst, off, dstCols) {
    const m = this.m, skip = ((dstCols - w) << 2) & 0xffff; let si = this.start(x, y), di = off & 0xffff;
    for (let r = daCount(h); r > 0; r--) {
      let s = si;
      for (let c = daCount(w); c > 0; c--, s = (s + 1) & 0xffff) {
        const bl = m[this.at(3, s)];
        for (let k = 0; k < 3; k++) { dst[di] = (dst[di] & bl) | m[this.at(k, s)]; di = (di + 1) & 0xffff; }
        dst[di] = 0; di = (di + 1) & 0xffff;
      }
      si = (si + this.stride) & 0xffff; di = (di + skip) & 0xffff;
    }
  }
}

// LS10 / LS11 档的第 i 项解到交错缓冲 buf 的 off 起 (2e09:752b / 71f4; max ≠ 0 时以 max 截断, 段内回绕)
export class LsFile {
  constructor(bytes) { this.b = bytes; this.e = lsEntries(bytes); }
  decodeTo(i, buf, off, max = 0) {
    const out = lsDecode(this.b, this.e[i]), n = max && out.length > max ? max : out.length;
    for (let k = 0; k < n; k++) buf[(off + k) & 0xffff] = out[k];
  }
}

// 格头部 (每格 8 bytes: x, y, w, h, big-endian 32 比特偏移): 返回 {x, y, w, h, off (低 16 比特)}
export function frameHeader(buf, p) {
  const b = k => buf[(p + k) & 0xffff];
  return { x: b(0), y: b(1), w: b(2), h: b(3), off: ((b(6) << 8) | b(7)) & 0xffff };
}
