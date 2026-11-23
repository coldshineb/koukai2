// gfx/worldmap.js — 海上地圖區域解碼 (MAIN.EXE 1fd9:2fd2 = 線性 22d62, 及其呼叫的 22b19 / 22028 / 22a47 / 22a5d / 22aba)
// 世界: 2160 × 1080 地圖格 (每格 16×16 像素), 分成 90 × 45 個「海域格」(24×24 地圖格); WORLDMAP.LZW 3 項各涵蓋 30 欄海域格 (720 地圖格寬)
// 區域緩衝 [03f4]:[03f6]: 96 × 96 bytes (與港口地圖 PORTMAP 共用同一塊記憶體), 海上只用左上 72 × 72 (3 × 3 個海域格)
//   assets/gfx/worldmap.bin (tools/extract_sea.py): 每項 1350 格 × 144 碼; 1 碼 = 2×2 地圖格
// 碼: < 0x10 = 陸/海位元 (8 左上, 4 右上, 2 左下, 1 右下 → 0x41 / 0); 0x10、0x12 = 港口; 0x11 = 發現物; >= 0x13 = 由 [03fc] 表 (DATA1 #18) 取 2×2 圖塊
// 圖塊 >= 0x29 視為陸地 (海岸自動接邊); 0x34 以上為「實心」圖塊 (3135c 判斷不能航行)
const WM_W = 0x60;

export class WorldMap {
  // codes: worldmap.bin; sea: sea.json (autotile [03f8] = DATA1 #10, hash [06d0] = DATA1 #12, codeTiles [03fc] = DATA1 #18)
  constructor(codes, sea) {
    this.codes = codes; this.auto = Uint8Array.from(sea.autotile); this.hash = Uint8Array.from(sea.hash); this.ct = Uint8Array.from(sea.codeTiles);
  }
  // 22b19: 以海域格 idx (列×30+欄, 項內) 為左上的 3×3 格 → 36×36 碼 (原版從第 idx 格的資料起連讀 3 格, 等於第 idx, idx+1, idx+2 格)
  cells(item, idx) {
    const out = new Uint8Array(36 * 36), C = this.codes;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const src = ((item * 1350 + idx + r * 30 + c) * 144) | 0;
      for (let y = 0; y < 12; y++) out.set(C.subarray(src + y * 12, src + y * 12 + 12), (r * 12 + y) * 36 + c * 12);
    }
    return out;
  }
  // 22a47 座標雜湊 (x + y) mod 255 (16 位元無號)
  static hashXY(x, y) { return ((x + y) & 0xffff) % 0xff; }
  // 22a5d 由座標找港口編號 (表 [06d0]+0..0xfe, 每筆碰撞往後 0x13); 找不到回傳 0xffff
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
  // 22aba 由座標找發現物編號 (表 [06d0]+0x100.., 記錄 DS:7f8c + 7×id)
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
  // 22d62: 解碼區域 idx 到 buf (96×96)
  decode(st, item, idx, buf) {
    const codes = this.cells(item, idx), ct = this.ct;
    // 22b19 後半: 碼 → 2×2 圖塊 (表內 < 0x34 的圖塊先寫成 0, 留給海岸接邊)
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
    // 22d62 後半: 港口 / 發現物 / 其他碼直接寫入
    let sea = 0;
    for (let r = 0, si = 0, k = 0; r < 36; r++, si += 0x78) {
      if (r % 12 === 0) { sea = di === 0 || di === 0x2c ? 0x51 : di >= 0x0e && di <= 0x1e ? 0x41 : 0x49; di++; }
      for (let c = 0; c < 36; c++, k++, si += 2) {
        const v = codes[k];
        if (v < 0x10) continue;
        let fill;
        if (v === 0x10 || v === 0x12) {
          const id = this.portAt(st, c * 2 + x0, r * 2 + y0) & 0xff;                  // 5c9a 以 AL 取記錄 (找不到時 = 0xff)
          if (st.u8(0x5f54 + id * 0x16 + 0x15) & 0x10) continue;                     // 已發現的港口: 保留接邊後的圖塊
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
  // 1fd9:3187 = 22f17 隨身物 地圖 (1d710 模式 1) 用的解碼: 與 22d62 相同先寫底圖 (22b19) 與海岸接邊 (22028), 之後
  //   港口碼 (0x10 / 0x12) 一律改成海 (左邊是 0x59 時用 0x59), 發現物碼 0x11 與 >= 0x13 一律寫 [03fc] 的 4 個圖塊 (不看是否已發現)
  //   緯度色只在碼列 0 與 24 時更新 (原版以 mod 24 判斷, 22d62 是 mod 12), 所以第 2 列海域格沿用第 1 列的顏色, 第 3 列用第 2 列的
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
  // 22028 海岸自動接邊: 72×72 的每格依「陸地 (>= 0x29)」的 8 鄰格 (超出範圍時取最近的格) 組成遮罩
  //   N=1 NE=2 E=4 SE=8 S=0x10 SW=0x20 W=0x40 NW=0x80; 表 [03f8] 第 (中心是海 ? 0x100 : 0) + 遮罩 項; 0 → 圖塊 0
  //   否則 + 0x18 (上/左/右/下 有圖塊 0x59; 上與左是本次已改寫的值) 或 + 緯度偏移 (第 0 / 44 列海域 0x10, 第 14..30 列 0, 其他 8)
  //   圖塊 >= 0x59 的格不改。陸地旗標取自改寫前的值 (原版以 3 列環狀緩衝在改寫前先讀下一列)。
  coast(buf, row) {
    const N = 72, L = new Uint8Array(N * N), T = this.auto;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) L[y * N + x] = buf[y * WM_W + x] >= 0x29 ? 1 : 0;
    const lat = r => (r === 0 || r === 0x2c ? 0x10 : r < 0x0e || r > 0x1e ? 8 : 0);
    let off = lat(row);
    const f = (x, y) => L[(y < 0 ? 0 : y >= N ? N - 1 : y) * N + (x < 0 ? 0 : x >= N ? N - 1 : x)];
    for (let y = 0; y < N; y++) {
      if (y && y % 24 === 0) { row++; off = row === 0 || row === 0x2c ? 0x10 : row < 0x0e || row > 0x1e ? 8 : 0; }   // 22721 (列號只遞增)
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
