// decoders/worldmap.js — 海上地图区域解码 (MAIN.EXE 1fd9:2fd2 = 线性 22d62, 及其调用的 22b19 / 22028 / 22a47 / 22a5d / 22aba)
// 世界: 2160 × 1080 地图格 (每格 16×16 像素), 分成 90 × 45 个「海域格」(24×24 地图格); WORLDMAP.LZW 3 项各涵盖 30 栏海域格 (720 地图格宽)
// 区域缓冲 [03f4]:[03f6]: 96 × 96 bytes (与港口地图 PORTMAP 共用同一块内存), 海上只用左上 72 × 72 (3 × 3 个海域格)
//   assets/data/worldmap.json (经 decoders/bin_json.ts 解码): 每项 1350 格 × 144 码; 1 码 = 2×2 地图格
// 码: < 0x10 = 陆/海比特 (8 左上, 4 右上, 2 左下, 1 右下 → 0x41 / 0); 0x10、0x12 = 港口; 0x11 = 发现物; >= 0x13 = 由 [03fc] 表 (DATA1 #18) 取 2×2 图块
// 图块 >= 0x29 视为陆地 (海岸自动接边); 0x34 以上为「实心」图块 (3135c 判断不能航行)
const WM_W = 0x60;

export class WorldMap {
  // codes: worldmap 解码缓冲; sea: sea.json (autotile [03f8] = DATA1 #10, hash [06d0] = DATA1 #12, codeTiles [03fc] = DATA1 #18)
  constructor(codes, sea) {
    this.codes = codes; this.auto = Uint8Array.from(sea.autotile); this.hash = Uint8Array.from(sea.hash); this.ct = Uint8Array.from(sea.codeTiles);
  }
  // 22b19: 以海域格 idx (列×30+栏, 项内) 为左上的 3×3 格 → 36×36 码 (原版从第 idx 格的数据起连读 3 格, 等于第 idx, idx+1, idx+2 格)
  cells(item, idx) {
    const out = new Uint8Array(36 * 36), C = this.codes;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const src = ((item * 1350 + idx + r * 30 + c) * 144) | 0;
      for (let y = 0; y < 12; y++) out.set(C.subarray(src + y * 12, src + y * 12 + 12), (r * 12 + y) * 36 + c * 12);
    }
    return out;
  }
  // 22a47 座标哈希 (x + y) mod 255 (16 比特无号)
  static hashXY(x, y) { return ((x + y) & 0xffff) % 0xff; }
  // 22a5d 由座标找港口编号 (表 [06d0]+0..0xfe, 每笔碰撞往后 0x13); 找不到返回 0xffff
  portAt(st, x, y) {
    let si = WorldMap.hashXY(x, y);
    for (;;) {
      const id = this.hash[si];
      if (id === 0xff) return 0xffff;
      const R = 0x5f54 + ((id * 0x16) & 0xffff);
      if (st.u16(R) === (x & 0xffff) && st.u16(R + 2) === (y & 0xffff)) return id;
      si = (si + 0x13) % 0xff;
    }
  }
  // 22aba 由座标找发现物编号 (表 [06d0]+0x100.., 记录 DS:7f8c + 7×id)
  discAt(st, x, y) {
    let si = WorldMap.hashXY(x, y);
    for (;;) {
      const id = this.hash[0x100 + si];
      if (id === 0xff) return 0xffff;
      const R = 0x7f8c + ((id * 7) & 0xffff);
      if (st.u16(R) === (x & 0xffff) && st.u16(R + 2) === (y & 0xffff)) return id;
      si = (si + 0x13) % 0xff;
    }
  }
  // 22d62: 解码区域 idx 到 buf (96×96)
  decode(st, item, idx, buf) {
    const codes = this.cells(item, idx), ct = this.ct;
    // 22b19 后半: 码 → 2×2 图块 (表内 < 0x34 的图块先写成 0, 留给海岸接边)
    for (let r = 0, si = 0, k = 0; r < 36; r++, si += 0x78) for (let c = 0; c < 36; c++, k++, si += 2) {
      const v = codes[k];
      if (v >= 0x10) {
        const t = v * 4, f = a => (a >= 0x34 ? a : 0);
        buf[si] = f(ct[t]); buf[si + 0x60] = f(ct[t + 2]); buf[si + 1] = f(ct[t + 1]); buf[si + 0x61] = f(ct[t + 3]);
      } else {
        buf[si] = v & 8 ? 0x41 : 0; buf[si + 0x60] = v & 2 ? 0x41 : 0; buf[si + 1] = v & 4 ? 0x41 : 0; buf[si + 0x61] = v & 1 ? 0x41 : 0;
      }
    }
    const x0 = ((idx % 30) + 30 * item) * 24, y0 = Math.trunc(idx / 30) * 24;
    let di = Math.trunc(y0 / 24);
    this.coast(buf, di);                                                           // 22028
    // 22d62 后半: 港口 / 发现物 / 其他码直接写入
    let sea = 0;
    for (let r = 0, si = 0, k = 0; r < 36; r++, si += 0x78) {
      if (r % 12 === 0) { sea = di === 0 || di === 0x2c ? 0x51 : di >= 0x0e && di <= 0x1e ? 0x41 : 0x49; di++; }
      for (let c = 0; c < 36; c++, k++, si += 2) {
        const v = codes[k];
        if (v < 0x10) continue;
        let fill;
        if (v === 0x10 || v === 0x12) {
          const id = this.portAt(st, c * 2 + x0, r * 2 + y0) & 0xff;                  // 5c9a 以 AL 取记录 (找不到时 = 0xff)
          if (st.u8(0x5f54 + id * 0x16 + 0x15) & 0x10) continue;                     // 已发现的港口: 保留接边后的图块
          fill = sea;
        } else if (v === 0x11) {
          const id = this.discAt(st, c * 2 + x0, r * 2 + y0) & 0xff;
          if (st.u8(0x7f8c + id * 7 + 6) & 0x40) continue;
          fill = buf[si - 1] === 0x59 ? 0x59 : sea;
        } else {
          const t = v * 4; buf[si] = ct[t]; buf[si + 1] = ct[t + 1]; buf[si + 0x60] = ct[t + 2]; buf[si + 0x61] = ct[t + 3]; continue;
        }
        buf[si] = fill; buf[si + 1] = fill; buf[si + 0x60] = fill; buf[si + 0x61] = fill;
      }
    }
  }
  // 1fd9:3187 = 22f17 随身物 地图 (1d710 模式 1) 用的解码: 与 22d62 相同先写底图 (22b19) 与海岸接边 (22028), 之后
  //   港口码 (0x10 / 0x12) 一律改成海 (左边是 0x59 时用 0x59), 发现物码 0x11 与 >= 0x13 一律写 [03fc] 的 4 个图块 (不看是否已发现)
  //   纬度色只在码列 0 与 24 时更新 (原版以 mod 24 判断, 22d62 是 mod 12), 所以第 2 列海域格沿用第 1 列的颜色, 第 3 列用第 2 列的
  decodeChart(st, item, idx, buf) {
    const codes = this.cells(item, idx), ct = this.ct;
    for (let r = 0, si = 0, k = 0; r < 36; r++, si += 0x78) for (let c = 0; c < 36; c++, k++, si += 2) {
      const v = codes[k];
      if (v >= 0x10) {
        const t = v * 4, f = a => (a >= 0x34 ? a : 0);
        buf[si] = f(ct[t]); buf[si + 0x60] = f(ct[t + 2]); buf[si + 1] = f(ct[t + 1]); buf[si + 0x61] = f(ct[t + 3]);
      } else {
        buf[si] = v & 8 ? 0x41 : 0; buf[si + 0x60] = v & 2 ? 0x41 : 0; buf[si + 1] = v & 4 ? 0x41 : 0; buf[si + 0x61] = v & 1 ? 0x41 : 0;
      }
    }
    let di = Math.trunc(idx / 30);
    this.coast(buf, di);                                                           // 22028
    let sea = 0;
    for (let r = 0, si = 0, k = 0; r < 36; r++, si += 0x78) {
      if (r % 0x18 === 0) { sea = di === 0 || di === 0x2c ? 0x51 : di >= 0x0e && di <= 0x1e ? 0x41 : 0x49; di++; }
      for (let c = 0; c < 36; c++, k++, si += 2) {
        const v = codes[k];
        if (v < 0x10) continue;
        if (v === 0x10 || v === 0x12) { const fill = buf[si - 1] === 0x59 ? 0x59 : sea; buf[si] = fill; buf[si + 1] = fill; buf[si + 0x60] = fill; buf[si + 0x61] = fill; }
        else { const t = v * 4; buf[si] = ct[t]; buf[si + 1] = ct[t + 1]; buf[si + 0x60] = ct[t + 2]; buf[si + 0x61] = ct[t + 3]; }
      }
    }
  }
  // 22028 海岸自动接边: 72×72 的每格依「陆地 (>= 0x29)」的 8 邻格 (超出范围时取最近的格) 组成遮罩
  //   N=1 NE=2 E=4 SE=8 S=0x10 SW=0x20 W=0x40 NW=0x80; 表 [03f8] 第 (中心是海 ? 0x100 : 0) + 遮罩 项; 0 → 图块 0
  //   否则 + 0x18 (上/左/右/下 有图块 0x59; 上与左是本次已改写的值) 或 + 纬度偏移 (第 0 / 44 列海域 0x10, 第 14..30 列 0, 其他 8)
  //   图块 >= 0x59 的格不改。陆地标志取自改写前的值 (原版以 3 列环状缓冲在改写前先读下一列)。
  coast(buf, row) {
    const N = 72, L = new Uint8Array(N * N), T = this.auto;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) L[y * N + x] = buf[y * WM_W + x] >= 0x29 ? 1 : 0;
    const lat = r => (r === 0 || r === 0x2c ? 0x10 : r < 0x0e || r > 0x1e ? 8 : 0);
    let off = lat(row);
    const f = (x, y) => L[(y < 0 ? 0 : y >= N ? N - 1 : y) * N + (x < 0 ? 0 : x >= N ? N - 1 : x)];
    for (let y = 0; y < N; y++) {
      if (y && y % 24 === 0) { row++; off = row === 0 || row === 0x2c ? 0x10 : row < 0x0e || row > 0x1e ? 8 : 0; }   // 22721 (列号只递增)
      for (let x = 0; x < N; x++) {
        const p = y * WM_W + x;
        if (buf[p] >= 0x59) continue;
        const m = f(x, y - 1) | f(x + 1, y - 1) << 1 | f(x + 1, y) << 2 | f(x + 1, y + 1) << 3 | f(x, y + 1) << 4 | f(x - 1, y + 1) << 5 | f(x - 1, y) << 6 | f(x - 1, y - 1) << 7;
        const v = T[(L[y * N + x] ? 0 : 0x100) + m];
        const near59 = (y > 0 && buf[p - WM_W] === 0x59) || (x > 0 && buf[p - 1] === 0x59) || (x < N - 1 && buf[p + 1] === 0x59) || (y < N - 1 && buf[p + WM_W] === 0x59);
        buf[p] = v === 0 ? 0 : (v + (near59 ? 0x18 : off)) & 0xff;
      }
    }
  }
}
