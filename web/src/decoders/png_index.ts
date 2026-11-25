// decoders/png_index.ts — 从标准 Indexed PNG (colorType=3, bitDepth 1/2/4/8) 无损提取 0..15 像素索引，并按原版片头/结局所需的平面排布写入缓冲
import { loadBinary } from "../core/assets.js";

export interface IndexedPng {
  w: number;
  h: number;
  indices: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    void writer.write(copy).then(() => writer.close());
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await (Function('return import("node:zlib")')() as Promise<any>);
  return new Uint8Array(zlib.inflateSync(compressed));
}

export async function parseIndexedPng(bytes: Uint8Array): Promise<IndexedPng> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8; // skip 8-byte PNG signature
  let w = 0;
  let h = 0;
  let bitDepth = 8;
  let colorType = 3;
  const idats: Uint8Array[] = [];

  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const dataStart = pos + 8;
    if (type === "IHDR") {
      w = view.getUint32(dataStart, false);
      h = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
    } else if (type === "IDAT") {
      idats.push(bytes.subarray(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }

  if (colorType !== 3 || !w || !h) {
    throw new Error(`PNG 必须是调色盘索引图 (colorType=${colorType}, ${w}x${h})`);
  }

  const totalLen = idats.reduce((s, a) => s + a.length, 0);
  const joined = new Uint8Array(totalLen);
  let off = 0;
  for (const part of idats) {
    joined.set(part, off);
    off += part.length;
  }

  const raw = await inflateZlib(joined);
  const rowBytes = Math.ceil((w * bitDepth) / 8);
  const stride = rowBytes + 1;
  const unfilt = new Uint8Array(h * rowBytes);

  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    const src = y * stride + 1;
    const dst = y * rowBytes;
    const prev = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const val = raw[src + x];
      const left = x > 0 ? unfilt[dst + x - 1] : 0;
      const up = y > 0 ? unfilt[prev + x] : 0;
      const ul = y > 0 && x > 0 ? unfilt[prev + x - 1] : 0;
      let res = val;
      if (f === 1) res = (val + left) & 0xff;
      else if (f === 2) res = (val + up) & 0xff;
      else if (f === 3) res = (val + ((left + up) >> 1)) & 0xff;
      else if (f === 4) res = (val + paeth(left, up, ul)) & 0xff;
      unfilt[dst + x] = res;
    }
  }

  const indices = new Uint8Array(w * h);
  if (bitDepth === 8) {
    for (let y = 0; y < h; y++) {
      indices.set(unfilt.subarray(y * rowBytes, y * rowBytes + w), y * w);
    }
  } else {
    const mask = (1 << bitDepth) - 1;
    const perByte = 8 / bitDepth;
    for (let y = 0; y < h; y++) {
      const rOff = y * rowBytes;
      const dOff = y * w;
      for (let x = 0; x < w; x++) {
        const b = unfilt[rOff + Math.floor(x / perByte)];
        const shift = (perByte - 1 - (x % perByte)) * bitDepth;
        indices[dOff + x] = (b >> shift) & mask;
      }
    }
  }

  return { w, h, indices };
}

export async function loadIndexedPng(url: string): Promise<IndexedPng> {
  const bytes = await loadBinary(url);
  return parseIndexedPng(bytes);
}

/**
 * 写入片头/结局通用的 nibble-unit 平面交错缓冲 (与 decN / decodeToBuf 排布一致)：
 * 每 4 像素 = 1 单位 u；偶数单位在高半字节，奇数单位在低半字节；按 np (3 或 4) 字节每组存放。
 */
export function encodeNibblePlanar(
  img: IndexedPng,
  np: 3 | 4,
  dst: Uint8Array,
  doff = 0,
): void {
  const { w, h, indices } = img;
  const unitsPerRow = (w + 3) >> 2;
  const maskLen = dst.length >= 0x20000 ? 0x1ffff : 0xffff;
  const totalBytes = Math.ceil((unitsPerRow * h) / 2) * np;
  for (let i = 0; i < totalBytes; i++) {
    const idx = (doff + i) & maskLen;
    if (idx < dst.length) dst[idx] = 0;
  }

  for (let y = 0; y < h; y++) {
    const rowBase = y * unitsPerRow;
    const pixRow = y * w;
    for (let ux = 0; ux < unitsPerRow; ux++) {
      const u = rowBase + ux;
      const grp = doff + (((u >> 1) * np) & 0xffff);
      const isOdd = (u & 1) !== 0;
      let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
      const px0 = ux * 4;
      for (let b = 0; b < 4; b++) {
        const px = px0 + b < w ? indices[pixRow + px0 + b] : 0;
        const bit = 3 - b;
        p0 |= (px & 1) << bit;
        p1 |= ((px >> 1) & 1) << bit;
        p2 |= ((px >> 2) & 1) << bit;
        if (np === 4) p3 |= ((px >> 3) & 1) << bit;
      }
      const vals = np === 4 ? [p0, p1, p2, p3] : [p0, p1, p2];
      for (let p = 0; p < np; p++) {
        const a = (grp + p) & maskLen;
        if (a < dst.length) dst[a] = isOdd ? (dst[a] & 0xf0) | vals[p] : (dst[a] & 0x0f) | (vals[p] << 4);
      }
    }
  }
}

/** 将 IndexedPng 直接绘制到 Screen.fb (替代 decodeGraph) */
export function drawIndexedToFb(fb: Uint8Array, img: IndexedPng, x: number, y: number): void {
  const { w, h, indices } = img;
  for (let row = 0; row < h; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= 400) continue;
    const sOff = row * w;
    const dOff = ty * 640 + x;
    for (let col = 0; col < w; col++) {
      const tx = x + col;
      if (tx >= 0 && tx < 640) fb[dOff + col] = indices[sOff + col] & 15;
    }
  }
}

/** 将 64x80 头像 IndexedPng 编为 3-plane 交错缓冲 (供 Ending.face put3 使用) */
export function encodePlanar3Cols(img: IndexedPng): Uint8Array {
  const cols = img.w >> 3;
  const out = new Uint8Array(cols * img.h * 3);
  for (let r = 0; r < img.h; r++) {
    const pRow = r * img.w;
    for (let c = 0; c < cols; c++) {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < 8; i++) {
        const v = img.indices[pRow + c * 8 + i] & 7;
        const sh = 7 - i;
        b0 |= (v & 1) << sh;
        b1 |= ((v >> 1) & 1) << sh;
        b2 |= ((v >> 2) & 1) << sh;
      }
      const o = (r * cols + c) * 3;
      out[o] = b0;
      out[o + 1] = b1;
      out[o + 2] = b2;
    }
  }
  return out;
}
