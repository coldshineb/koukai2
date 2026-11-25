// graphdec.js — GRAPH.DAT 图像格式解码器 (MAIN.EXE seg0:0bcc..0fb7 的移植)
//
// 格式 (由原版解码器逆向):
//   u16le 宽 (像素, 1..640)   u16le 高 (1..400)
//   [16 色版本] 8 x u16le 图样表 T[0..7]
//   接着逐行解码; 每行宽度 = ceil(宽/4) 个「单位」(1 单位 = 4 像素 x 4 平面 = 16 bits)
//   一个单位的 16 比特图样 P: 比特 0-3 = 平面0 的 4 个像素 (MSB 在左), 4-7 平面1, 8-11 平面2, 12-15 平面3
//   命令字节 c:
//     c & 0x80, !(c & 0x40):  同行回溯拷贝   距离 ((c>>4)&3)+1 单位, 数量 (c&15)+1
//     c & 0x80,  (c & 0x40):  上方行拷贝     距离 (((c>>4)&3)+1) 行,   数量 (c&15)+1
//     !(c & 0x80) 8 色版本 (seg0:0e48):  P = ((c&15)<<8) | 下一字节, 重复 ((c>>4)&7)+1 次
//     !(c & 0x80) 16 色版本 (seg0:0e76): 重复 (c&7)+1 次, 图样依 s = c & 0x78:
//        0x00 → 0            0x08 → b             0x10 → (b>>4)<<8 | (b&15)
//        0x18 → (b&0xF0)<<8 | (b&15)              0x20 → b<<4
//        0x28 → (b&0xF0)<<8 | (b&15)<<4           0x30 → b<<8
//        0x38 → 下两字节 (大端)                  0x40..0x78 → T[(c>>3)&7]
//   一行用完 (剩余数量 <= 本次数量, 无号比较) 即换行; 最后一次可超出行宽, 原版照写。
//   拷贝命令直接读画面 (VRAM) 上已有的像素, 因此本解码器也在画面缓冲上原地解码。
//
// 返回 数据结束位置 (>=0) 表示成功; -1 尺寸/位置越界 (原版此时什么都不画)。

const ROW_UNITS = 160;           // 640 / 4

function unitIndex(n) {          // 单位编号 → fb 像素索引 (n 可能超出 0..160*400, 调用端检查)
  const row = Math.floor(n / ROW_UNITS), col = n - row * ROW_UNITS;
  return row * 640 + col * 4;
}

export function decodeGraph(fb, data, x, y, withTable, offset = 0) {
  let p = offset;
  const rd = () => data[p++];
  const w = rd() | (rd() << 8);
  const h = rd() | (rd() << 8);
  if (((w - 1) & 0xffff) > 0x27f || ((h - 1) & 0xffff) > 0x18f) return -1;
  if (y > 0x18f || h + y > 0x190 || x > 0x27f || x + w > 0x280) return -1;
  const T = new Uint16Array(8);
  if (withTable) for (let i = 0; i < 8; i++) { const lo = rd(); T[i] = lo | (rd() << 8); }
  const units = (w + 3) >> 2;
  const MAXN = ROW_UNITS * 400;
  const put = (n, P) => {
    if (n < 0 || n >= MAXN) return;
    const o = unitIndex(n);
    for (let i = 0; i < 4; i++) {
      const s = 3 - i;
      fb[o + i] = ((P >> s) & 1) | (((P >> (4 + s)) & 1) << 1) | (((P >> (8 + s)) & 1) << 2) | (((P >> (12 + s)) & 1) << 3);
    }
  };
  const copy = (src, dst) => {
    if (dst < 0 || dst >= MAXN) return;
    const od = unitIndex(dst);
    if (src < 0 || src >= MAXN) { fb[od] = fb[od + 1] = fb[od + 2] = fb[od + 3] = 0; return; }   // VRAM 上方黑边
    const os = unitIndex(src);
    fb[od] = fb[os]; fb[od + 1] = fb[os + 1]; fb[od + 2] = fb[os + 2]; fb[od + 3] = fb[os + 3];
  };
  let di = (x >> 2) + ROW_UNITS * y;
  for (let row = 0; row < h; row++) {
    const rowStart = di;
    let rem = units;
    for (;;) {
      const c = rd();
      let count;
      if (c & 0x80) {
        count = (c & 15) + 1;
        const back = (c & 0x40) ? ROW_UNITS * (((c >> 4) & 3) + 1) : ((c >> 4) & 3) + 1;
        for (let k = 0; k < count; k++) copy(di + k - back, di + k);
      } else {
        let P;
        if (!withTable) { count = ((c >> 4) & 7) + 1; P = ((c & 15) << 8) | rd(); }
        else {
          count = (c & 7) + 1;
          const s = c & 0x78;
          if (s === 0) P = 0;
          else if (s & 0x40) P = T[(c >> 3) & 7];
          else if (s === 0x38) { const hi = rd(); P = (hi << 8) | rd(); }
          else {
            const b = rd();
            switch (s) {
              case 0x08: P = b; break;
              case 0x10: P = ((b >> 4) << 8) | (b & 15); break;
              case 0x18: P = ((b & 0xf0) << 8) | (b & 15); break;
              case 0x20: P = b << 4; break;
              case 0x28: P = ((b & 0xf0) << 8) | ((b & 15) << 4); break;
              case 0x30: P = b << 8; break;
            }
          }
        }
        for (let k = 0; k < count; k++) put(di + k, P);
      }
      di += count;
      if (rem <= count) break;
      rem -= count;
    }
    di = rowStart + ROW_UNITS;
  }
  return p;
}

// GRAPH.DAT 容器: 开头为 u32be 偏移表 (首项 = 表长)
export function graphOffsets(dat) {
  const be32 = o => ((dat[o] << 24) | (dat[o + 1] << 16) | (dat[o + 2] << 8) | dat[o + 3]) >>> 0;
  const n = be32(0) / 4, out = [];
  for (let i = 0; i < n; i++) out.push(be32(i * 4));
  return out;
}
export function graphSize(dat, off) { return { w: dat[off] | (dat[off + 1] << 8), h: dat[off + 2] | (dat[off + 3] << 8) }; }

// MAIN.EXE 的两个调用入口
//   seg0:5b5d draw(n, x, y): 16 色版本, 从偏移表取第 n 张
//   seg0:5a91 draw8(n, x, y): 8 色版本, 只接受 n = 0 (表中第 0 张), 2/4 (固定偏移 0x1A67), 3/5 (固定偏移 0x68B3), 0x3E (固定偏移 0x674F9)
export const DRAW8_FIXED = { 2: 0x1a67, 4: 0x1a67, 3: 0x68b3, 5: 0x68b3, 0x3e: 0x674f9 };
export class GraphDat {
  constructor(dat) { this.dat = dat; this.offsets = graphOffsets(dat); }
  draw(fb, n, x, y) { return decodeGraph(fb, this.dat, x, y, true, this.offsets[n]); }
  draw8(fb, n, x, y) {
    const off = n === 0 ? this.offsets[0] : DRAW8_FIXED[n];
    if (off === undefined) return;
    return decodeGraph(fb, this.dat, x, y, false, off);
  }
}
