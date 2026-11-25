// decoders/bin_json.ts — 将原版可读化 JSON 数据无损还原为场景所需的紧凑 Uint8Array 视图
// 对应 web/assets/data/{windcur,za_dat,monster,mapnodes,worldmap,portmap}.json

export interface WindCurJson {
  format: "uw2-windcur-v1";
  rows: number;
  cols: number;
  summerWind: number[][];
  winterWind: number[][];
  current: number[][];
}

export interface ZaDatJson {
  format: "uw2-za-v1";
  ports: [number, number][][];
}

export interface MonsterJson {
  format: "uw2-monster-v1";
  encounters: { x: number; y: number; eventId: number }[];
}

export interface MapNodesJson {
  format: "uw2-mapnodes-v1";
  nodes: { x: number; y: number; hiFlag: number; tailHex: string }[];
}

export interface WorldMapJson {
  format: "uw2-worldmap-rle-v1";
  items: number;
  cols: number;
  rows: number;
  sectorW: number;
  sectorH: number;
  sectors: string[];
}

export interface PortMapJson {
  format: "uw2-portmap-rle-v1";
  count: number;
  w: number;
  h: number;
  ports: string[];
}

/** 解码空格分隔的十六进制游程字符串 ("00*12 41") 到目标缓冲 */
export function decodeRleStringInto(rle: string, dst: Uint8Array, startOffset: number, expectedLen: number): number {
  let outPos = startOffset;
  const n = rle.length;
  let i = 0;
  while (i < n) {
    while (i < n && rle.charCodeAt(i) === 32) i++;
    if (i >= n) break;
    let val = 0;
    while (i < n) {
      const ch = rle.charCodeAt(i);
      if (ch === 42 || ch === 32) break; // '*' or ' '
      val = (val << 4) | (ch >= 97 ? ch - 87 : ch >= 65 ? ch - 55 : ch - 48);
      i++;
    }
    let count = 1;
    if (i < n && rle.charCodeAt(i) === 42) {
      i++;
      count = 0;
      while (i < n) {
        const ch = rle.charCodeAt(i);
        if (ch === 32) break;
        count = count * 10 + (ch - 48);
        i++;
      }
    }
    dst.fill(val & 0xff, outPos, outPos + count);
    outPos += count;
  }
  if (outPos - startOffset !== expectedLen) {
    throw new Error(`RLE 解码长度异常: expected ${expectedLen}, got ${outPos - startOffset}`);
  }
  return outPos;
}

export function decodeWindCurJson(j: WindCurJson): Uint8Array {
  const layerSize = j.rows * j.cols;
  const out = new Uint8Array(layerSize * 3);
  const writeLayer = (grid: number[][], base: number) => {
    let p = base;
    for (let r = 0; r < j.rows; r++) {
      const row = grid[r];
      for (let c = 0; c < j.cols; c++) out[p++] = row[c] & 0xff;
    }
  };
  writeLayer(j.summerWind, 0);
  writeLayer(j.winterWind, layerSize);
  writeLayer(j.current, layerSize * 2);
  return out;
}

export function decodeZaDatJson(j: ZaDatJson): Uint8Array {
  const out = new Uint8Array(j.ports.length * 24);
  let p = 0;
  for (const buildings of j.ports) {
    for (let k = 0; k < 12; k++) {
      const pair = buildings[k];
      out[p++] = (pair?.[0] ?? 0) & 0xff;
      out[p++] = (pair?.[1] ?? 0) & 0xff;
    }
  }
  return out;
}

export function decodeMonsterJson(j: MonsterJson): Uint8Array {
  const out = new Uint8Array(j.encounters.length * 5);
  let p = 0;
  for (const e of j.encounters) {
    out[p++] = e.x & 0xff;
    out[p++] = (e.x >> 8) & 0xff;
    out[p++] = e.y & 0xff;
    out[p++] = (e.y >> 8) & 0xff;
    out[p++] = e.eventId & 0xff;
  }
  return out;
}

export function decodeMapNodesJson(j: MapNodesJson): Uint8Array {
  const out = new Uint8Array(j.nodes.length * 16);
  let p = 0;
  for (const node of j.nodes) {
    const w0 = (node.x & 0x7fff) | (node.hiFlag ? 0x8000 : 0);
    const w2 = node.y & 0xffff;
    out[p] = w0 & 0xff;
    out[p + 1] = (w0 >> 8) & 0xff;
    out[p + 2] = w2 & 0xff;
    out[p + 3] = (w2 >> 8) & 0xff;
    for (let k = 0; k < 12; k++) {
      out[p + 4 + k] = parseInt(node.tailHex.slice(k * 2, k * 2 + 2), 16) & 0xff;
    }
    p += 16;
  }
  return out;
}

export function decodeWorldMapJson(j: WorldMapJson): Uint8Array {
  const sectorBytes = j.sectorW * j.sectorH;
  const out = new Uint8Array(j.sectors.length * sectorBytes);
  let p = 0;
  for (const sec of j.sectors) p = decodeRleStringInto(sec, out, p, sectorBytes);
  return out;
}

export function decodePortMapJson(j: PortMapJson): Uint8Array {
  const mapBytes = j.w * j.h;
  const out = new Uint8Array(j.ports.length * mapBytes);
  let p = 0;
  for (const port of j.ports) p = decodeRleStringInto(port, out, p, mapBytes);
  return out;
}
