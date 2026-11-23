// scenes/sea.js — 海上場景 (MAIN.EXE: 出海 seg0:851f、海上畫面 6b30 / 6cfc / 8067、時間主循環的海上部分 1fd9:13c1 / 1afe8 / 2e09:38ec / 2e09:2f3d、
//   每日 195b6、天候 19a99 / 19f48)
// 與港口共用同一個場景物件 (SeaScene 繼承 PortScene): 原版的地圖視窗 (1fac)、圖塊快取 cs:1b2c、地圖緩衝 [03f6]、羅盤指針 [8c1d] 都是同一份
// 原版變數 (DS, 不在存檔內): [06c8] 區域編號 region   [06ca] WORLDMAP 項 item   [bda6]/[bdaa] 區域左上 (地圖格)   [bdba] 視窗偏移 bdba
//   [bdac] 本時刻船速 speed   [bdca] 瞭望範圍 sight   [a9c8] 輸入旗標 (bit0 暫停, bit1 滑鼠按著)   [bda8] 隨身物旗標 (0x80 望遠鏡 0x18, 0x40 0x19)
// 存檔內: 主角艦隊 [c2d4] = 2e76 + 0x85 × (主角 +2c): +0 x  +2 y (地圖格, 0..2159 / 0..1079)  +4/+6 目的地  +8/+a 中途點  +18/+19 格內位置 (0..0x3b)
//   +1a 方位 (0..7, 8 = 停船)  [1006]/[1008] 地圖視窗左上 (地圖格)  [1005] 航行旗標 (0x80/0x40 委任, 0x20 停船, 0x18 ?)  [2e18] 出港天數  [2e19]/[2e1a] 水/糧食配給 %
// 尚未移植 (主控台警告, 保留原版的呼叫位置): 他艦隊 (6aae / 1afe8 內的艦隊處理 = 艦隊 AI)、委任航行 (316b3 的 0fea:c0d9 / 313b1)、海上特殊事件 (30e9f 的 DS:b796 表)
import { PortScene } from "./port.js";
import { Buildings } from "./buildings.js";
import { Commands } from "./commands.js";
import { marketTradeLog } from "./market.js";
import { WorldMap } from "../gfx/worldmap.js";

const seaHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const seaS16 = v => (v << 16) >> 16;
const seaS8 = v => (v << 24) >> 24;
const seaUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const seaUmax = (a, b) => ((a & 0xffff) < (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d87
const seaSgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);                                    // seg0:4dde
const seaWarned = new Set();
const seaTodo = n => { if (!seaWarned.has(n)) { seaWarned.add(n); console.warn("尚未移植: " + n); } };

export class SeaScene extends PortScene {
  constructor(ctx, P) {
    super(ctx, P);
    const S = P.sea;                                                     // assets/data/sea.json (tools/extract_sea.py)
    this.SJ = S; this.SS = Object.fromEntries(Object.entries(S.str).map(([k, v]) => [k, seaHex(v)]));
    this.seaMonths = S.months.map(seaHex);                              // DS:8af0 月份字串
    this.wm = new WorldMap(P.worldmap, S);
    this.seaBuf = new Uint8Array(0x2400);                                // [03f4]:[03f6]
    this.region = 0xffff; this.item = 0; this.bda6 = 0; this.bdaa = 0;
    this.speed = 0; this.sight = 0; this.a9c8 = 0; this.bda8 = 0; this.btnX = 0; this.btnY = 0;
  }
  get fleet() { return 0x2e76 + ((0x85 * this.st.u8(this.st.personRecord(this.st.hero) + 0x2c)) & 0xffff); }   // [c2d4] (162e3)
  get b() { return (this.buildings ??= new Buildings(this)); }
  slotOf(i) { return i < 10 ? (this.fleet + 0x2b + 9 * i) & 0xffff : 0x572a + 9 * i; }   // seg0:5c58
  crewOf(i) { return 0x52d4 + ((0x1e * i) & 0xffff); }                                    // seg0:5c38
  shipRec(n) { return 0x5892 + ((0x16 * n) & 0xffff); }                                   // seg0:5c7a
  typeOf(t) { return 0x5e28 + ((0x0c * t) & 0xffff); }                                    // seg0:5c8a
  present(i) { return (this.st.u8(this.slotOf(i) + 8) & 0x30) === 0x10; }
  loadSum(i) { const st = this.st, S = this.slotOf(i); return (this.b.cargoUsed(i) + st.u8(S + 6) + st.u16(S)) & 0xffff; }   // seg0:5d8b
  wx(F) { return seaS16(this.st.u16(F)); } wy(F) { return seaS16(this.st.u16(F + 2)); }
  get vx1006() { return seaS16(this.st.u16(0x1006)); } set vx1006(v) { this.st.set16(0x1006, v); }
  get vy1008() { return seaS16(this.st.u16(0x1008)); } set vy1008(v) { this.st.set16(0x1008, v); }

  // ================= 出港 (碼頭 27a07 之後) =================
  // 0fea:9348 = 191e8 糧食 / 0fea:9401 = 192a1 水: 每艘船從自己 (沒有時從第一艘還有的船) 扣一天的量
  //   量 = (配給% × 水手) 的低 16 位元 / ([1005]&0x18 ? 200 : 100) + 1; 士氣扣在「供應的那艘船」上 (原版如此), 降到 20 以下時「本船」的水手逃走 (19016)
  //   全艦隊都沒有時本船士氣 −min(16, 士氣) (191ba)
  dailySupply(off, rate) {
    const st = this.st;
    for (let i = 0; i < 10; i++) {
      if (!this.present(i)) continue;
      let found = 0xff;
      if (st.u16(this.crewOf(i) + off)) found = i;
      else for (let j = 0; j < 10; j++) if (this.present(j) && st.u16(this.crewOf(j) + off)) { found = j; break; }
      if (found !== 0xff) this.consume(found, i, off, rate); else this.starve(i);
    }
  }
  foodDaily() { this.dailySupply(2, 0x2e1a); }                          // 191e8
  waterDaily() { this.dailySupply(0, 0x2e19); }                         // 192a1
  // 19056 / 19109
  consume(found, i, off, rateAddr) {
    const st = this.st, M = this.crewOf(found), P = st.personRecord(st.u8(M + 0x1b)), rate = st.u8(rateAddr);
    const div = (st.u8(0x1005) & 0x18) ? 200 : 100;
    const amt = seaUmin(Math.floor(((rate * st.u16(this.slotOf(i))) & 0xffff) / div) + 1, st.u16(M + off));
    st.set16(M + off, st.u16(M + off) - amt);
    const v = seaS16(100 - Math.floor(st.u8(P + 0x1c) / 5) - rate);
    const d = Math.trunc(v / (v > 0 ? 5 : 10));
    let m = st.u8(M + 0x1c) - d;
    m = m < 0 ? 0 : m > 100 ? 100 : m;
    st.set8(M + 0x1c, m);
    if (m < 0x14) this.desert(i);
  }
  // 191ba
  starve(i) { const st = this.st, M = this.crewOf(i); st.set8(M + 0x1c, st.u8(M + 0x1c) - seaUmin(16, st.u8(M + 0x1c))); if (st.u8(M + 0x1c) < 0x14) this.desert(i); }
  // 19016 士氣 < 20: 水手 −min(⌊(20 − 士氣) × 水手 / 100⌋ + 1, 水手)
  desert(i) {
    const st = this.st, M = this.crewOf(i), S = this.slotOf(i), n = seaS16(st.u16(S));
    const loss = (Math.trunc(Math.imul(20 - st.u8(M + 0x1c), n) / 100) + 1) & 0xffff;
    st.set16(S, st.u16(S) - seaUmin(loss, st.u16(S)));
  }

  // ================= 進入海上 seg0:851f =================
  async enterSea() {
    const { palette, sys, graph, state: st, con } = this.c;
    if (palette.ending) { await palette.fadeBlack(); return; }
    // 地點表 [0c96] (DATA1 #4, [bd7e] = DATA1 #5 筆): DS:1046 位元表中已探索的地點 +1 |= 0x80 (執行期緩衝, 不在存檔內)
    const N = (this.c.nodesRT ??= Uint8Array.from(this.c.mapNodes ?? new Uint8Array(0)));
    for (let i = 0; i < this.SJ.nodeCount; i++) if ((st.u8(0x1046 + (i >> 3)) & (0x80 >> (i & 7))) && N.length > i * 16 + 1) N[i * 16 + 1] |= 0x80;
    this.bda8 = 0;
    for (let i = 0; i < 0x14; i++) { const v = st.u8(0x2e57 + i); if (v === 0x18) this.bda8 |= 0x80; else if (v === 0x19) this.bda8 |= 0x40; }
    st.set8(0x0cae, 0xff);
    this.item = Math.trunc(this.vx1006 / 0x2d0) & 0xff;               // [06ca]
    // 849a: WORLDMAP 第 [06ca] 項 → [06ce]; 84de: DATA1 #11 → [03ee] (海上圖塊與船隻精靈); DATA1 #7 → [0c86]+0x3ea0 (羅盤指針)
    if (this.map && this.map !== this.seaBuf) this.seaBuf.set(this.map.subarray(0, 0x2400));   // [03f6] 原本是出港港口的 PORTMAP
    this.map = this.seaBuf; this.chip = this.P.seachip; this.tileCache.clear();
    await palette.fadeBlack();                                         // 99f2
    this.c.bgm.playSong(st.u8(0x12b5) + 4);                            // 9670 主角的海上曲目
    sys.mouseHide();
    // 9630: [03d5] 恆為 1, 不動作
    con.right = 0x50;                                                  // [8a22]
    const n = st.options & 0x80 ? 2 : 4;                               // GRAPH.DAT #4 航海畫面外框 ([0ca4]&80 時 #2)
    graph.draw8(n, 0, 0); graph.draw8(n, 0, 0);
    this.seaDate();                                                    // 71ad / 71c6 / 71f0
    this.clearCache();                                                 // 2103
    this.region = 0xffff;
    this.seaView();                                                    // 6b30
    palette.selectTimePalette(this.time, true, st.u8(0x0cb3));         // 0fea:98ce = 1976e
    this.seaPanel();                                                   // 8067
    this.needle = 0xff;
    if ((st.u8(0x0cb3) & 15) === 1) this.stormSound();                // 9768(DS:0c5a) + 9804(0x30)
    sys.mouseShow();
    await palette.fadeToTarget();
  }
  // 9768 / 9804 FM 效果音 (暴風雨): 移植版沒有效果音
  stormSound() { this.c.bgm.sfx?.(0x30); }

  // ================= 畫面 =================
  // 7180: (col, 0x10) 印 %2d (v+1); 只在海上
  seaNum(col, v) { const { con, printf } = this.c; con.right = 0x4f; con.setCursor(col, 0x10); printf(this.SS.day2, v + 1); }
  // 71ad 年 / 71c6 月 / 71f0 日 (只在海上; 主迴圈 1623a 在每年 / 每月 / 每天開始時也各呼叫一次)
  seaYear() { if (this.port === 0xff) this.seaNum(0x43, this.c.rt.year + 0x5dc); }
  seaMonth() { if (this.port === 0xff) { const { con, printf, rt } = this.c; con.setCursor(0x48, 0x10); printf(this.SS.month, this.seaMonths[rt.month]); } }
  seaDay() { if (this.port === 0xff) this.seaNum(0x4c, this.c.rt.day); }
  seaDate() { this.seaYear(); this.seaMonth(); this.seaDay(); }
  // 6b30 / 6cfc / 3197c 共用: 主角所在的 3×3 海域格區域 → bda6 / bdaa (地圖格) 與區域編號
  regionOf() {
    const F = this.fleet;
    let cx = (Math.trunc(this.wx(F) / 24) % 30) - 1, cy = (Math.trunc(this.wy(F) / 24) % 45) - 1;
    cx = cx < 0 ? 0 : cx > 0x1b ? 0x1b : cx; cy = cy < 0 ? 0 : cy > 0x2a ? 0x2a : cy;
    this.bda6 = 24 * cx; this.bdaa = 24 * cy;
    return 30 * cy + cx;
  }
  // 1fd9:2fd2 = 22d62 解碼區域
  decodeRegion(si) { this.wm.decode(this.st, this.item, si & 0xffff, this.seaBuf); }
  // 6bce..6caa / 6d9b..6e5a: 主角周圍 3×3 海域格記入探索表 DS:0de8 (45 列 × 12 bytes), 新探索的格 [100e]++ [1010]++
  explore() {
    const st = this.st, F = this.fleet;
    const cx0 = (Math.trunc(this.wx(F) / 24) + 0x59) % 0x5a;
    let ry = Math.trunc(this.wy(F) / 24) - 1;
    for (let k = 0; k < 3; k++, ry++) {
      if (ry < 0 || ry >= 0x2d) continue;
      for (let j = 0, cx = cx0; j < 3; j++, cx = (cx + 1) % 0x5a) {
        const a = 0x0de8 + 12 * ry + (cx >> 3), m = 0x80 >> (cx & 7);
        if (!(st.u8(a) & m)) { st.set16(0x100e, st.u16(0x100e) + 1); st.set16(0x1010, st.u16(0x1010) + 1); }
        st.set8(a, st.u8(a) | m);
      }
    }
  }
  // 6aae 區域改變時處理區域內的他艦隊 (目標位置 0fea:a22a 等) — 屬於艦隊 AI, 尚未移植
  fleetsRegion() { seaTodo("他艦隊進入區域 (6aae, 艦隊 AI)"); }
  viewOffset() {
    this.bdba = ((this.vy1008 - this.bdaa) * 0x60 + (this.vx1006 % 0x2d0) - this.bda6) & 0xffff;
  }
  // 6b30 重新取得區域並畫地圖 (不畫船)
  seaView() {
    const si = this.regionOf();
    if (this.region !== si) { this.region = si; this.decodeRegion(si); this.fleetsRegion(); this.explore(); }
    this.viewOffset();
    this.clearCache();
    this.drawMap();                                                    // 1fac
    this.seaPanel();                                                   // 8067
  }
  // 24bc 32×32 精靈: 每行 2 組 16 像素 × (遮罩, 平面 0, 1, 2); 平面 0..2 = (底 AND 遮罩) OR 圖, 平面 3 = 底 AND 遮罩
  sprite(col, y, off) {
    const fb = this.c.scr.fb, S = this.chip;
    if (col < 0 || col + 4 > 80 || y < 0 || y + 32 > 400) { seaTodo("精靈超出畫面"); return; }
    for (let r = 0; r < 32; r++) for (let h = 0; h < 2; h++) {
      const o = off + r * 16 + h * 8;
      for (let b = 0; b < 2; b++) {
        const m = S[o + b], p0 = S[o + 2 + b], p1 = S[o + 4 + b], p2 = S[o + 6 + b], base = (y + r) * 640 + (col + h * 2 + b) * 8;
        for (let i = 0; i < 8; i++) {
          const sh = 7 - i, keep = (m >> sh) & 1;
          fb[base + i] = (keep ? fb[base + i] : 0) | ((p0 >> sh) & 1) | (((p1 >> sh) & 1) << 1) | (((p2 >> sh) & 1) << 2);
        }
      }
    }
    this.c.scr.dirty = true;
  }
  // 艦隊 k 的精靈 (6f07..6f88 主角單獨 / 7080..7137 全部艦隊)
  drawFleet(F, k, heroOnly) {
    const st = this.st, dx = this.wx(F) - this.vx1006, dy = this.wy(F) - this.vy1008, T = this.SJ.tab.shipDir;
    let si;
    if (F === this.fleet) {
      let i = 0; while (i < 10 && st.u8(this.crewOf(i) + 0x1b) !== st.u8(0x12b5)) i++;   // 旗艦 = 船長是主角的船位
      si = (st.u8(this.shipRec(st.u8(this.slotOf(i) + 7)) + 0x10) & 0x10) << 8;
    } else si = (((st.u8(this.shipRec(st.u8(F + 0x32)) + 0x10) & 0x10) << 8) + 0x2000) & 0xffff;
    const d = T[st.u8(F + 0x1a) & 7] + 0x10;
    si = heroOnly ? (si + (((d * 2 + (this.time & 1)) << 9) & 0xffff)) & 0xffff : (si + ((d << 10) & 0xffff) + (((k + this.time) & 1) << 9)) & 0xffff;
    this.sprite((dx + 6) * 2, dy * 16 + 8, si);
    this.invalidate(24 * dy + dx);                                     // 2119
  }
  // 6cfc 每個時刻的海上畫面: 區域、探索、延遲 ([0ca6] 海上速度)、地圖、艦隊、日期、風向/海流/航向、船速、游標
  async seaTick() {
    const { sys, menu, con, printf } = this.c, st = this.st;
    const si = this.regionOf();
    if (this.region !== si) { this.region = si; this.decodeRegion(si); this.fleetsRegion(); this.explore(); }
    // 507c: 空函式
    this.toggle ^= 1;
    this.viewOffset();
    if (st.u8(0x0ca6)) {
      sys.timer.set(st.u8(0x0ca6));
      while (sys.timer.get()) { if (menu.source()) break; await sys.poll(); }
    }
    sys.mouseHide();
    this.drawMap();
    const w = st.u8(0x0cb3) & 15;
    if (w === 0 || w === 2) {
      for (let row = 0; row < 0x17; row++) for (let k = 0; k < 0x46; k++) {
        const F = 0x2e76 + k * 0x85, dx = this.wx(F) - this.vx1006, dy = this.wy(F) - this.vy1008;
        if (dx < 0 || dx >= 0x17 || row !== dy) continue;
        if (st.u8(F + 0x29) & 0x10 || !(st.u8(F + 0x29) & 1)) continue;
        if (this.landAt(this.wx(F), this.wy(F))) continue;
        this.drawFleet(F, k, false);
      }
    } else this.drawFleet(this.fleet, 0, true);
    this.seaDate();
    this.dials();                                                      // 8fbf
    con.setCursor(0x45, 0xd0); printf(this.SS.speed, (this.speed + 1) >> 1);
    this.seaCursor();
    sys.mouseShow();
    // 507d: 空函式
  }
  // 6fbe..716b 游標: 地圖視窗內依滑鼠所在的 3×3 區塊顯示方向游標 (DS gfx 0x2960 + (列內欄 − 3×列) × 0x90), 否則 0x2b10
  seaCursor() {
    const { sys } = this.c, p = sys.mousePos(), x = p.x - 0x60, y = p.y - 8;
    let si = 0x2b10;
    if (x >= 0 && x < 0x180 && y >= 0 && y < 0x180) si = (0x2960 + ((x >> 7) - 3 * (y >> 7)) * 0x90) & 0xffff;
    if (this.cursor !== si) { this.cursor = si; sys.setCursorShape(si); }
  }
  // 8fbf 風向 (y 0x40)、海流 (0x70)、航向 (0xa0, 不印數字) 的轉盤
  dials() {
    if (this.port !== 0xff) return;
    const st = this.st, a = st.u8(0x0cb1), b = st.u8(0x0cb2);
    this.dial(0x40, (a & 0x38) >> 3, a & 7);
    this.dial(0x70, (b & 0x38) >> 3, b & 7);
    this.dial(0xa0, st.u8(this.fleet + 0x1a), 0xffff);
  }
  // 8f4f(y, 方向, 強度): 強度 ≠ 0 且方向 < 8 → gfx + 0x490 + 方向 × 0x320, 否則 0x1d90 (5 欄 × 0x28 行); 強度 >= 0 (有號) 時於 (0x43, y+0x18) 印出
  dial(y, dir, str) {
    const { scr, con, printf, gfx } = this.c;
    const off = str !== 0 && dir < 8 ? 0x490 + dir * 0x320 : 0x1d90;
    scr.putPlanar(0x47, y, 5, 0x28, gfx, off);
    if (seaS16(str) >= 0) { con.setCursor(0x43, y + 0x18); printf(this.SS.dialNum, str); }
  }
  // 3135c (x, y) 的 2×2 地圖格中有 >= 0x34 的圖塊 (陸地)
  landAt(x, y) {
    const o = ((seaS16(y) - this.bdaa) * 0x60 + (seaS16(x) % 0x2d0) - this.bda6) & 0xffff, B = this.seaBuf, g = i => B[i & 0xffff] ?? 0;
    return g(o) >= 0x34 || g(o + 1) >= 0x34 || g(o + 0x60) >= 0x34 || g(o + 0x61) >= 0x34 ? 1 : 0;
  }

  // 8067 左側面板: 狀態條 (轉向力/推進力/耐久度/吃水量/瞭望範圍/水手/船艦狀態)、貨物 (水/糧食/資材/砲彈)、出港天數; 同時算出瞭望範圍 [bdca]
  //   (各船的 +0a 總載重在這裡重算寫回); 只在海上畫, 畫兩次
  seaPanel() {
    const st = this.st, { con, printf, sys } = this.c;
    if (this.port !== 0xff) return;
    con.right = 0x4f;
    con.puts(this.SS.dateColor);
    const F = this.fleet, T = this.SJ.tab.windSpeed;
    let minSpd = 10000, slowSlot = this.slotOf(0), slowIdx = 0, minDur = 100, maxLook = 0, crewSum = 0, maxCrewSum = 0, morale = 0;
    const sums = [0, 0, 0, 0];
    const row = ((Math.abs(((st.u8(0x0cb1) & 0x38) >> 3) - st.u8(F + 0x1a)) & 0xff) * 8);
    for (let i = 0; i < 10; i++) {
      const S = this.slotOf(i);
      if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
      const ship = this.shipRec(st.u8(S + 7)), t = st.u8(ship + 0x0f), Ty = this.typeOf(t), t5 = st.u8(Ty + 5);
      const crew = seaS16(st.u16(S));
      crewSum = (crewSum + st.u16(S)) & 0xffff; maxCrewSum = (maxCrewSum + st.u16(ship + 0x12)) & 0xffff;
      const M = this.crewOf(i), drv = st.u8(M + 9);
      const load = this.loadSum(i); st.set16(M + 0x0a, load);
      const cap = seaS16(st.u16(Ty + 6));
      const P = st.personRecord(st.u8(M + 0x1b)), nav = st.u8(P + 0x24), sk = st.u8(P + 0x1d);
      morale += crew * st.u8(M + 0x1c);
      const w2 = seaS16(T[row + t] * st.u8(S + 5));
      const q = seaUmin(100, Math.trunc((drv * crew) / t5) & 0xffff);
      const c = seaUmin(0x96, (0xb4 - seaUmin(0xb4, Math.trunc(seaS16(Math.imul(100, seaS16(load))) / cap))) & 0xffff);
      let u = Math.trunc(seaS16(Math.imul(q, w2)) / 100) & 0xffff;
      u = Math.floor(((u * c) & 0xffff) / 100);
      const v1 = seaUmin(30, (Math.trunc(seaS16(Math.imul(u, nav)) / 10) + u) & 0xffff);
      const spd = seaUmin(40, Math.trunc(seaS16(Math.imul(v1, sk)) / 75) & 0xffff);
      if (spd < minSpd) { minSpd = spd; slowSlot = S; slowIdx = i; }
      if (st.u8(S + 2) < minDur) minDur = st.u8(S + 2);
      const lk = (st.u8(M + 8) * st.u16(S)) & 0xffff; if (lk > maxLook) maxLook = lk;
      for (let k = 0; k < 4; k++) sums[k] = (sums[k] + st.u16(M + 2 * k)) & 0xffff;
    }
    const sT = st.u8(this.shipRec(st.u8(slowSlot + 7)) + 0x0f);
    const sLoad = seaS16(st.u16(this.crewOf(slowIdx) + 0x0a)), sCap = seaS16(st.u16(this.typeOf(sT) + 6));
    const loadPct = Math.trunc((sLoad * 100) / sCap);                  // 3722 有號長整數除法
    this.sight = (Math.imul(this.bda8 & 0x80 ? 2 : 1, seaUmin(12, Math.floor(maxLook / 100))) & 0xffff);   // [bdca]
    sys.mouseHide();
    const B = (y, v) => this.commandsObj().bar(2, y, seaS16(v));            // seg0:92f7
    for (let n = 0; n < 2; n++) {
      B(0x48, st.u8(slowSlot + 4)); B(0x60, st.u8(slowSlot + 5)); B(0x78, minDur); B(0x90, loadPct);
      B(0xa8, Math.trunc((100 * this.sight) / 24));
      if (!maxCrewSum) maxCrewSum = 1;
      if (!crewSum) crewSum = 1;
      B(0xc0, Math.trunc((seaS16(crewSum) * 100) / seaS16(maxCrewSum)));
      B(0xd8, Math.trunc(morale / seaS16(crewSum)));
      for (let k = 0; k < 2; k++) { con.setCursor(6, k * 32 + 0x108); printf(this.SS.n5, Math.floor(sums[k] / 10)); }
      for (let k = 2; k < 4; k++) { con.setCursor(6, k * 32 + 0x108); printf(this.SS.n5b, seaS16(sums[k])); }
      con.setCursor(0x45, 0xf0); printf(this.SS.n3, st.u8(0x2e18));
    }
    sys.mouseShow();
  }
  commandsObj() { return (this.commands ??= new Commands(this)); }

  // ================= 海上時刻 1fd9:13c1 = 21151 (輸入) =================
  async seaInput() {
    const { sys, menu } = this.c;
    let key = this.readInput();                                        // 210f1
    if (sys.mouseEvent() === 0x81) {
      this.a9c8 |= 2;
      const p = sys.mousePos(), x = p.x - 0x60, y = p.y - 8;
      if (x >= 0 && x < 0x180 && y >= 0 && y < 0x180) {
        key = ((x >> 7) + 3 * ((0x180 - y) >> 7) + 0x31) & 0xff;      // 數字鍵 1..9 的配置 (y = 0 時算成第 4 列, 原版如此)
        this.a9c8 &= 0xfd;
      }
    }
    if (key === 0x30 || key === 0x1b) this.a9c8 |= 1;
    if (this.a9c8 & 1) { key = 0; this.cursor = 0x2570; sys.setCursorShape(0x2570); await menu.waitRelease(); }
    for (;;) {
      if (this.a9c8 & 1) key = this.readInput();
      if (key || (this.a9c8 & 2)) { await this.seaButton(key); if (this.timeAbort()) return; }
      if (!(this.a9c8 & 1)) return;
      await sys.poll();
    }
  }
  // 21008 海上畫面按鈕 (DS:a9d8, 13 個 × 9 bytes: x, y, w, h, 鍵): 0..7 舵輪方向, 8 中央 (指定目的地), 9..12 情報/經營/命令/航海術
  async seaButton(key) {
    const { sys, con } = this.c, st = this.st, B = this.SJ.tab.buttons;
    const p = sys.mousePos(); this.btnX = p.x; this.btnY = p.y;
    let di = 0;
    for (; di < 13; di++) {
      const o = di * 9, i16 = k => seaS16(B[o + k] | (B[o + k + 1] << 8)), x0 = i16(0), y0 = i16(2), w = i16(4), h = i16(6);
      if (key === B[o + 8]) break;
      if ((this.a9c8 & 3) && x0 <= this.btnX && x0 + w >= this.btnX && y0 <= this.btnY && y0 + h >= this.btnY) break;
    }
    if (di < 13 && !((st.u8(0x1005) & 0x18) && di < 9)) {
      if (di < 8) this.steer(di);                                       // 20fec
      else if (di === 8) await this.chooseDest();                        // 2e09:310b
      else {
        sys.mouseHide();
        const cm = this.commandsObj();
        cm.press(di - 9);                                               // seg0:9396
        await [() => cm.info(), () => cm.manage(), () => cm.order(), () => cm.nav()][di - 9]();   // DS:aa4e 遠程函式表
        cm.release(di - 9);                                             // seg0:937e
        sys.mouseShow();
        if (this.timeAbort()) return;
        con.left = 0; con.right = 0x50;                                 // [8a20] = 0, [8a22] = 0x50
      }
      if (!this.c.palette.ending) this.seaPanel();                      // 8067
    }
    if (this.a9c8 & 1) await this.c.menu.waitRelease();
    this.a9c8 &= 0xfc;
  }
  // 20fec 轉舵: [1005] &= 0x5f, 方位 = d, 95f2(d)
  steer(d) { const st = this.st; st.set8(0x1005, st.u8(0x1005) & 0x5f); st.set8(this.fleet + 0x1a, d); this.helm(d); }
  // 95f2 舵輪指針 [8c1d]
  helm(d) {
    if (this.needle === d) return;
    const { sys, state: st } = this.c;
    sys.mouseHide();
    this.helmDraw(0);
    if (st.options & 1) { this.needle = d; this.helmDraw(9); } else this.needle = 0xff;
    sys.mouseShow();
  }
  // 9537(base): DATA1 #7 第 (指針 + base) 張 (4 欄 × 0x20 行), 畫兩次
  helmDraw(base) {
    const n = this.needle; if (n === 0xff) return;
    const col = n > 4 ? 0x3e : n === 0 || n === 4 ? 0x43 : 0x48, y = n < 2 || n === 7 ? 0x110 : n === 2 || n === 6 ? 0x138 : 0x160;
    const off = ((n + base) << 9) & 0xffff;
    this.c.scr.putPlanar(col, y, 4, 0x20, this.P.seacompass, off);
    this.c.scr.putPlanar(col, y, 4, 0x20, this.P.seacompass, off);
  }
  // 2e09:310b = 3119b 指定目的地 (委任航行) — 尚未移植
  async chooseDest() { seaTodo("指定目的地 (2e09:310b = 3119b)"); }

  // ================= 1afe8 他艦隊的海上移動 (艦隊 AI) =================
  // 每支艦隊先查一次滑鼠右鍵 (按下 → [a9c8] |= 1 暫停); 主角與未出航 (+29 bit0 = 0) 的略過; 其他的移動屬於艦隊 AI, 尚未移植
  async fleetsMove() {
    const { sys, palette } = this.c, st = this.st;
    for (let k = 0; k < 0x46 && !palette.ending; k++) {
      if (sys.mouseEvent() === 0x82) this.a9c8 |= 1;
      const F = 0x2e76 + k * 0x85;
      if (F === this.fleet || !(st.u8(F + 0x29) & 1)) continue;
      if (this.c.noFleets) continue;                                    // 測試: 原版 1b048 改成不處理
      seaTodo("他艦隊的海上移動 (1afe8, 艦隊 AI)");
    }
  }

  // ================= 2e09:38ec = 3197c 主角艦隊移動 =================
  // 316b3 本時刻航向: 委任 ([1005]&0xc0) → 自動; 停船 (0x20) → 8; 否則 +1a
  heading() {
    const st = this.st, F = this.fleet, f = st.u8(0x1005);
    if (f & 0xc0) { seaTodo("委任航行 (316b3: 1fd9:33d4 / 0fea:c0d9 / 313b1)"); st.set8(0x1005, f & 0x7f); return 8; }
    if (f & 0x20) return 8;
    return st.u8(F + 0x1a);
  }
  // 314eb 船速 (各船取最小): 風向差 k = |風向 − 航向| → DS:06d8 表第 k 列的帆種係數 × 推進力 × 風力 (縱帆船 (+10 bit4 = 0) 風力至少 3) / 150
  //   × min(100, 駕駛% × 水手 / 船型 +5) / 100 × min(150, 180 − min(180, 載重%)) / 100 → 加上航海術 (+24) 10%/點 (上限 30) → × 技能 (+1d) / 75 (上限 40)
  //   k = 3..5 (逆風) 時再 × 轉向力 / 100; 結果至少 2; 風力 0 且沒有縱帆船 → 0
  shipSpeedAt(h, wStr, wDir) {
    const st = this.st, T = this.SJ.tab.windSpeed;
    const k = Math.abs(wDir - h) & 0xff, row = k * 8, beat = k >= 3 && k <= 5;
    let best = 0xc8, fore = 0;
    for (let i = 0; i < 10; i++) {
      const S = this.slotOf(i), M = this.crewOf(i);
      if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
      const ship = this.shipRec(st.u8(S + 7)), Ty = this.typeOf(st.u8(ship + 0x0f));
      const P = st.personRecord(st.u8(M + 0x1b));
      let ws;
      if (!(st.u8(ship + 0x10) & 0x10)) { ws = wStr < 3 ? 3 : wStr; fore = (fore - 1) & 0xff; } else ws = wStr;
      let v = Math.trunc(seaS16(Math.imul((T[row + st.u8(Ty + 9)] * st.u8(S + 5)) & 0xffff, ws)) / 0x96) & 0xff;
      const q = Math.trunc(Math.imul(st.u8(M + 9), seaS16(st.u16(S))) / st.u8(Ty + 5));
      v = Math.trunc(((seaUmin(100, q & 0xffff) * v) & 0xffff) / 100) & 0xff;
      const pct = Math.trunc(seaS16(Math.imul(100, seaS16(st.u16(M + 0x0a)))) / seaS16(st.u16(Ty + 6)));
      const c = seaUmin(0x96, (0xb4 - pct) & 0xffff);
      v = Math.floor(((v * c) & 0xffff) / 100) & 0xff;
      const a = seaS16(Math.imul(st.u8(P + 0x24), v));
      const b7 = seaUmin(30, (Math.trunc(a / 10) + v) & 0xffff) & 0xff;
      let sp = seaUmin(40, Math.trunc(((st.u8(P + 0x1d) * b7) & 0xffff) / 75) & 0xffff) & 0xff;
      if (beat) sp = Math.trunc((st.u8(S + 4) * sp) / 100) & 0xff;
      if (sp < best) best = sp;
    }
    if (best < 2) best = 2;
    return !wStr && !fore ? 0 : best;
  }
  // 31728 依航向與海流移動一步: 格內位置 (+18/+19, 每格 0x3c) 累加 (方位向量 × 船速 + 海流向量 × 海流強度, 8 位元);
  //   跨格時檢查陸地 (3135c); 走到 WORLDMAP 項的左右邊界 (x mod 720 < 0 或 >= 719) / 南北邊界時不檢查陸地並設 crossed
  //   回傳 1 = 被陸地擋住 (連斜向也不行)
  stepFleet(h, out) {
    const st = this.st, F = this.fleet, X = this.SJ.tab.dirX, Y = this.SJ.tab.dirY, b = st.u8(0x0cb2);
    const cd = (b & 0x38) >> 3, cs = b & 7;
    out.crossed = 0;
    const ddx = seaS8(Math.imul(X[h], seaS8(this.speed)) + Math.imul(X[cd], cs)), ddy = seaS8(Math.imul(Y[h], seaS8(this.speed)) + Math.imul(Y[cd], cs));
    const fx = seaS8(ddx + st.u8(F + 0x18)), fy = seaS8(ddy + st.u8(F + 0x19));
    let px = this.wx(F) % 0x2d0, py = this.wy(F), ax = 0, ay = 0;
    if (fx >= 0x3c) { px++; ax = -0x3c; } else if (fx < 0) { px--; ax = 0x3c; }
    if (fy >= 0x3c) { py++; ay = -0x3c; } else if (fy < 0) { py--; ay = 0x3c; }
    else if (!ax) { st.set8(F + 0x18, fx); st.set8(F + 0x19, fy); out.x = px; out.y = py; return 0; }
    const base = (this.item * 0x2d0) & 0xffff;
    if (px < 0 || px >= 0x2cf) { px += seaSgn(ddx); py = this.wy(F); out.crossed = 1; }
    if (py < 0 || py >= 0x437) {
      px = this.wx(F) % 0x2d0;
      if (py >= 0 && py < 0x438) { py += seaSgn(ddy); out.crossed = 1; } else py = this.wy(F);
    }
    out.x = px; out.y = py;
    if (!out.crossed && this.landAt(px, py)) {
      out.x = this.wx(F) % 0x2d0; out.y = this.wy(F);
      if (this.landAt(this.wx(F) + seaSgn(ddx), this.wy(F) + seaSgn(ddy))) return 1;
      st.set8(F + 0x18, fx); st.set8(F + 0x19, fy);
      if (ax) st.set8(F + 0x18, ddx > 0 ? 0x3b : 0);
      if (ay) st.set8(F + 0x19, ddy > 0 ? 0x3b : 0);
      return 0;
    }
    st.set16(F, (px + base + 0x870) % 0x870);
    st.set16(F + 2, (py + 0x438) % 0x438);
    st.set8(F + 0x18, ax + fx); st.set8(F + 0x19, ay + fy);
    return 0;
  }
  async heroMove() {
    const st = this.st, F = this.fleet;
    let si = this.heading();
    if (this.port !== 0xff) return;
    if (si !== 8) {
      const a = st.u8(0x0cb1), b = st.u8(0x0cb2);
      this.speed = this.shipSpeedAt(si, a & 7, (a & 0x38) >> 3) & 0xff;   // [bdac] (海流方向/強度是傳入的參數, 但 314eb 沒有用到)
      const ox = st.u16(F), oy = st.u16(F + 2), out = {};
      if (this.stepFleet(si, out)) {
        si = (si + 1) & 7;
        if (this.stepFleet(si, out)) { si = (si - 2) & 7; if (this.stepFleet(si, out)) this.blocked(); }
      }
      if (out.crossed) {
        this.item = Math.trunc(this.wx(F) / 0x2d0) & 0xff;             // 849a 換 WORLDMAP 項
        const r = this.regionOf(); this.region = r; this.decodeRegion(r);
        if (this.landAt(this.wx(F), this.wy(F))) {
          st.set16(F, ox); st.set16(F + 2, oy);
          this.item = Math.trunc(this.wx(F) / 0x2d0) & 0xff;           // 849a (區域緩衝保留新項的內容, [06c8] 之後設為 FFFF)
        } else {
          if (out.x < 0 || out.x >= 0x2cf) this.vx1006 = Math.trunc(this.wx(F) / 24) * 24;
          if (out.y < 0 || out.y >= 0x437) this.vy1008 = Math.trunc(this.wy(F) / 24) * 24;
        }
        this.region = 0xffff;
        st.set16(F + 8, (seaS16(st.u16(F + 8)) + 0x870) % 0x870);
      }
    }
    this.scroll();
  }
  // 1fd9:44d8 = 24268: 三個方向都被擋住 → 23a97(目標 = 艦隊 +8, 艦隊, 0): 以 +8/+a 為目標重求中途點寫回 +8/+a
  blocked() { this.pathStep(this.fleet, this.fleet + 8, 0); }
  // 237fb + 23872 區域距離場 (緩衝 [0c88] = 視窗保存區, 72 × 72 字): 0x800 = 未到, 0x801 = 陸地 (圖塊 >= 0x34); 由目標往外做帶權最短路
  //   (DS:ae18: 8 方向 dx, dy, 成本 2 / 3; 佇列 = 堆疊上 72×72 字的環狀緩衝, 插入排序); 船身 2×2: 該格與 東、南、東南 都不能是陸地
  //   回傳 1 = 由目標擴展到了起點 (起點 = 艦隊 F, 座標以區域左上為原點的 8 位元值); 目標在陸地上或到不了 → 0
  pathField(F, T) {
    const st = this.st, D = this.SJ.tab.path8, N = 72 * 72, Q = new Int32Array(N);
    const buf = (this.pathBuf ??= new Uint16Array(0x8000)); buf.fill(0);
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff, top = this.bdaa & 0xffff;
    const sx = (st.u16(F) - left) & 0xff, sy = (st.u16(F + 2) - top) & 0xff, tx = (st.u16(T) - left) & 0xff, ty = (st.u16(T + 2) - top) & 0xff;
    for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) buf[y * 72 + x] = this.seaBuf[y * 0x60 + x] >= 0x34 ? 0x801 : 0x800;
    const ti = ty * 72 + tx;
    if (buf[ti] > 0x800) return 0;
    buf[ti] = 0;
    let head = 0, tail = 1; Q[0] = ti;
    if (buf[sy * 72 + sx] === 0) return 1;
    buf[sy * 72 + sx] = 0x800;
    while (head !== tail) {
      const cur = Q[head], x = cur % 72, y = Math.floor(cur / 72), d = buf[cur];
      for (let k = 0; k < 8; k++) {
        const nx = (x + D[k * 3]) & 0xff, ny = (y + D[k * 3 + 1]) & 0xff;          // 237c7
        if (nx >= 72 || ny >= 72) continue;
        if (nx === sx && ny === sy) return 1;
        const n = ny * 72 + nx;
        if (buf[n] !== 0x800 || buf[n + 1] === 0x801 || buf[n + 72] === 0x801 || buf[n + 73] === 0x801) continue;
        buf[n] = (d + D[k * 3 + 2]) & 0xffff;
        let slot = tail, bx = tail - 1;
        for (;;) {
          if (bx < 0) bx = N - 1;
          Q[slot] = Q[bx];
          if (buf[Q[bx]] <= buf[n]) break;
          slot = bx; bx--;
        }
        Q[slot] = n;
        if (++tail >= N) tail = 0;
      }
      if (++head >= N) head = 0;
    }
    return 0;
  }
  // 23a97(T, F, mode): 距離場建好後由艦隊沿距離遞減走 (最多 256 步, 每步取 8 鄰格中最小的; 都不更小時往北), 第一步的方向一直延伸到不再同向的位置 → T
  //   艦隊與目標同一格時 T = 區域左上 (原版如此)。mode ≠ 0 的後半 (再嘗試轉向) 只有艦隊 AI 使用, 尚未移植
  pathStep(F, T, mode) {
    const st = this.st, D = this.SJ.tab.path8;
    if (!this.pathField(F, T)) return 0;
    const buf = this.pathBuf;
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff, top = this.bdaa & 0xffff;
    const fx = seaS16(st.u16(F) - left), fy = seaS16(st.u16(F + 2) - top), tx = seaS16(st.u16(T) - left), ty = seaS16(st.u16(T + 2) - top);
    const ti = seaS16(ty * 72 + tx); let cur = seaS16(fy * 72 + fx);
    if (cur === ti) { st.set16(T, left); st.set16(T + 2, top); return 1; }
    const path = []; let x = fx, y = fy;
    while (cur !== ti && path.length < 0x100) {
      let best = buf[cur & 0x7fff], bd = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + D[k * 3], ny = y + D[k * 3 + 1];
        if (nx < 0 || nx >= 72 || ny < 0 || ny >= 72) continue;
        const w = buf[(cur + D[k * 3 + 1] * 72 + D[k * 3]) & 0x7fff];
        if (w < best) { best = w; bd = k; }
      }
      cur = seaS16(cur + D[bd * 3] + 72 * D[bd * 3 + 1]); path.push(cur); x += D[bd * 3]; y += D[bd * 3 + 1];
    }
    let y0 = Math.trunc(path[0] / 72), x0 = path[0] % 72;
    const d = this.SJ.tab.dir3[(y0 - fy) * 3 + (x0 - fx) + 4], X = this.SJ.tab.dirX, Y = this.SJ.tab.dirY;
    for (let si = 1; si < path.length; si++) {
      if (path[si] !== (x0 + X[d]) + (y0 + Y[d]) * 72) break;
      x0 += X[d]; y0 += Y[d];
    }
    if (mode) seaTodo("23a97 轉向嘗試 (艦隊 AI)");
    st.set16(T, x0 + left); st.set16(T + 2, y0 + top);
    return 1;
  }
  // 31b73 地圖視窗捲動: 主角離視窗左上 < 11 − [0ca9] 或 > 11 + [0ca9] 時移動一格 (x 限 項內 0..0x2b8, y 0..0x420)
  scroll() {
    const st = this.st, F = this.fleet, m = st.u8(0x0ca9);
    const rx = this.wx(F) - this.vx1006, si = this.vx1006 % 0x2d0;
    if (11 - m > rx) { if (si > 0) this.vx1006 = this.vx1006 - 1; }
    else if (m + 11 < rx) { if (si < 0x2b8) this.vx1006 = this.vx1006 + 1; }
    const ry = this.wy(F) - this.vy1008, dy = this.vy1008;
    if (11 - m > ry) { if (dy > 0) this.vy1008 = dy - 1; }
    else if (m + 11 < ry) { if (dy < 0x420) this.vy1008 = dy + 1; }
  }

  // ================= 2e09:2f3d = 30fcd 發現 (港口 / 村落) 與海上特殊地點 =================
  async discover() {
    const st = this.st, F = this.fleet, rng = this.c.sys.rng;
    if (this.port !== 0xff) return;
    const sight = seaUmax(this.sight, 2);
    for (let i = 0; i < 10; i++) {
      if (st.u16(0x1012 + 4 * i) !== st.u16(F) || st.u16(0x1014 + 4 * i) !== st.u16(F + 2)) continue;
      st.set16(0x1012 + 4 * i, 0); st.set16(0x1014 + 4 * i, 0);
      await this.seaEvent(st.u8(0x103a + i));                          // 30e9f
      // 之後原版把 (位置, 事件) 寫進 MONSTER.DAT 第 [1044] 筆 (5 bytes) — 移植版不寫檔
      st.set8(0x1044, st.u8(0x1044) + 1);
      return;
    }
    let skill = st.u8(this.b.hero + 0x1f);
    for (let i = 0; i < 0x1e; i++) { const n = st.u8(0x2e1b + i); if (n !== 0xff && st.u8(st.personRecord(n) + 0x1f) > skill) skill = st.u8(st.personRecord(n) + 0x1f); }
    for (let di = 0; di < 0x82; di++) {
      const R = 0x5f54 + di * 0x16;
      if (st.u8(R + 0x15) & 0x30) continue;
      const x = seaS16(st.u16(R)), y = seaS16(st.u16(R + 2));
      if (!this.near(2, x, y)) {
        if (!this.inSight(sight, x, y)) continue;
        if (rng.random(0xc8) >= skill) return;
      }
      marketTradeLog(st, this.c.rt, 9, di, 0, 0);                    // 0fea:e3e5 交易記錄 種類 9 (發現港口)
      st.set8(R + 0x15, st.u8(R + 0x15) | 0x10);
      await this.found(0, di);
      return;
    }
    for (let di = 0; di < 0x64; di++) {
      const R = 0x7f8c + di * 7;
      if (st.u8(R + 6) & 0xc0) continue;
      const x = seaS16(st.u16(R)), y = seaS16(st.u16(R + 2));
      if (!this.near(2, x, y)) {
        if (!this.inSight(sight, x, y)) continue;
        if (rng.random(0xc8) >= skill) return;
      }
      st.set8(R + 6, st.u8(R + 6) | 0x40);
      await this.found(1, 0);
      return;
    }
  }
  // 0fea:30fc = 12f9c: |主角 − (x, y)| 各軸 <= r
  near(r, x, y) {
    const F = this.fleet, fx = this.wx(F), fy = this.wy(F);
    const dx = fx < x ? x - fx : fx - x, dy = fy < y ? y - fy : fy - y;
    return dx <= r && dy <= r;
  }
  // 30f81: 霧 (天候 3) 以外、距離 <= r 且在地圖視窗內
  inSight(r, x, y) {
    if ((this.st.u8(0x0cb3) & 15) === 3) return false;
    if (!this.near(r, x, y)) return false;
    return x >= this.vx1006 && x < this.vx1006 + 0x18 && y >= this.vy1008 && y < this.vy1008 + 0x18;
  }
  // 30b34 發現: 重新解碼區域並畫地圖, 「船長！發現%s港！」/「發現村落！」, 港口 (< 100) 加冒險名聲 25 × 規模 (+1c), 補給港與村落 50
  async found(kind, id) {
    const { sys, con, printf, message, win, menu } = this.c, st = this.st;
    let fame = 0x32;
    this.decodeRegion(this.region);
    sys.mouseHide();
    this.drawMap();
    const l = con.left, r = con.right;
    win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);                      // 30b1e
    con.puts(this.SS.captain);
    if (kind === 0) {
      printf(this.SS.foundPort, st.cstr(0x5f54 + id * 0x16 + 4));
      fame = id >= 0x64 ? 0x32 : (0x19 * st.u8(0x6a80 + id * 0x25 + 0x1c)) & 0xffff;
    } else con.puts(this.SS.foundVillage);
    if (fame) {
      const H = 0x125a + st.u8(0x12b5) * 0x0e;
      st.set16(H + 4, st.u16(H + 4) + seaUmin(50000 - st.u16(H + 4), fame));
      message(0x1dc, fame);
    }
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
    con.left = l; con.right = r;
  }
  // 30e9f 海上特殊地點 (DS:b796 表的 10 個函式) — 尚未移植
  async seaEvent(n) { seaTodo("海上特殊地點事件 (30e9f, DS:b796[" + n + "])"); }

  // ================= 每日 195b6 (只在海上) =================
  async seaDaily() {
    if (this.port !== 0xff) return;
    this.foodDaily(); this.waterDaily();
    await this.rats(); await this.scurvy(); await this.lost();
  }
  // 19427: 鼠患 (0cb3 bit4): 未發生時 19358 判斷發生, 發生中 193dc 每船糧食 −min(10, 糧食)
  async rats() {
    const st = this.st;
    if (!(st.u8(0x0cb3) & 0x10)) await this.ratsStart();
    if (st.u8(0x0cb3) & 0x10) for (let i = 0; i < 10; i++) if (this.present(i)) { const M = this.crewOf(i); st.set16(M + 2, st.u16(M + 2) - seaUmin(10, st.u16(M + 2))); }
  }
  // 19358: 出港 > 30 天、沒有貓 ([bda8]&0x40)、random(主角 +24 / 5 + 2) = 0 且 random(105) > 主角 +23 → GRAPH #0x39、0x1d9
  async ratsStart() {
    const st = this.st, H = this.b.hero, rng = this.c.sys.rng, di = st.u8(H + 0x23), si = st.u8(H + 0x24);
    if (st.u8(0x0cb3) & 0x10 || this.bda8 & 0x40 || st.u8(0x2e18) <= 0x1e) return;
    if (rng.random(Math.trunc(si / 5) + 2)) return;
    if (rng.random(0x69) <= di) return;
    await this.seaNotice(0x39, 0x1d9);
    st.set8(0x0cb3, st.u8(0x0cb3) | 0x10);
  }
  async seaNotice(pic, msg) {
    const { sys, graph, message, menu, win } = this.c;
    sys.mouseHide(); this.clearCache(); graph.draw(pic, 0xa0, 0x10);
    this.b.crewSpeaks(); message(msg); await menu.waitPrompt(); await win.close(); sys.mouseShow();
  }
  // 19511: 壞血病 (0cb3 bit5): 出港 > 60 天且 random(105) > 主角 +23 時發生 (GRAPH #0x3b、0x1da); 發生中每船水手 −min(random(2) + (100 − 船長 +1e) / 5, 水手)
  async scurvy() {
    const st = this.st, rng = this.c.sys.rng;
    if (!(st.u8(0x0cb3) & 0x20)) {
      if (st.u8(0x2e18) > 0x3c && rng.random(0x69) > st.u8(this.b.hero + 0x23)) { await this.seaNotice(0x3b, 0x1da); st.set8(0x0cb3, st.u8(0x0cb3) | 0x20); }
    }
    if (st.u8(0x0cb3) & 0x20) for (let i = 0; i < 10; i++) {
      if (!this.present(i)) continue;
      const S = this.slotOf(i), P = st.personRecord(st.u8(this.crewOf(i) + 0x1b));
      const v = (rng.random(2) + Math.trunc((100 - st.u8(P + 0x1e)) / 5)) & 0xffff;
      st.set16(S, st.u16(S) - seaUmin(v, st.u16(S)));
    }
  }
  // 19528: 全艦隊沒有水手 (或沒有船) → 0x1ba / 0x241 後遊戲結束 ([03ea] = 0x19)
  async lost() {
    const st = this.st, { sys, palette, message, menu, win } = this.c;
    let n = 0, crew = 0;
    for (let i = 0; i < 10; i++) if (this.present(i)) { crew = (crew + st.u16(this.slotOf(i))) & 0xffff; n++; }
    if (crew && n) return;
    if (palette.ending) return;
    sys.mouseHide();
    win.shadowedSaved(0x12, 0x80, 0x22, 0x60, 0);
    message(n ? 0x1ba : 0x1ba + 0x87); await menu.waitPrompt(); await win.close();
    sys.mouseHide();
    await palette.fadeBlack();
    palette.ending = 0x19;
  }

  // ================= 天候 (1a011 的海上部分) =================
  // 19a99 天候開始: 所在海域的風向表 bit7 (天候區) 時, random(155) > 最高的觀測 (航海士/測量士 +23) + 50 且 random(11) > 平均 +1d
  //   → bit6: 1988c (落水); 海流表 bit6..7 = 1 暴風雨 / 2 無風 / 3 霧
  async weatherStart() {
    const st = this.st, rng = this.c.sys.rng, [w, c] = this.clock.windAt(this.fleet);
    if (!(w & 0x80)) return;
    let best = st.u8(this.b.hero + 0x23);
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(0x2e1b + i); if (n === 0xff) continue;
      const P = st.personRecord(n), job = st.u8(P + 0x2e);
      if ((job === 3 || job === 5) && st.u8(P + 0x23) > best) best = st.u8(P + 0x23);
    }
    let sum = 0, cnt = 0;
    for (let i = 0; i < 10; i++) if (this.present(i)) { sum += st.u8(this.crewOf(i) + 0x1d); cnt++; }
    if (rng.random(0x9b) <= best + 0x32) return;
    if (rng.random(0x0b) <= Math.floor(sum / cnt)) return;
    if (w & 0x40) await this.overboard();
    switch (c & 0xc0) {
      case 0x40: if (rng.random(7) + 3 >= (st.u8(0x0cb1) & 7) && !st.u8(0x10a6)) { await this.weatherBegin(0x154, 1); this.stormSound(); } break;
      case 0x80: if (rng.random(6) >= (st.u8(0x0cb1) & 7)) await this.weatherBegin(0x158, 2); break;
      case 0xc0: if (!rng.random(10) && rng.random(6) >= (st.u8(0x0cb1) & 7)) await this.weatherBegin(0x15c, 3); break;
    }
  }
  // 1988c 海難: 非主角當船長、船長 +1b & 0xc0 且 random(100) > 船長 +23 的第一艘船 → 19849 (船長離隊、船 5deb 移除) → 197f7
  async overboard() {
    const st = this.st, rng = this.c.sys.rng;
    for (let i = 0; i < 10; i++) {
      const M = this.crewOf(i);
      if (!this.present(i) || st.u8(M + 0x1b) === st.u8(0x12b5)) continue;
      const P = st.personRecord(st.u8(M + 0x1b));
      if (rng.random(100) <= st.u8(P + 0x23)) continue;
      if (!(st.u8(P + 0x1b) & 0xc0)) continue;
      this.dropShip(i, M);
      await this.shipLostMsg(i);
      return;
    }
  }
  // 19849: 船長從船員名單 (DS:2e1b) 移除 (+2d = FF, +31 &= DF), 再 5deb 移除船位 i
  dropShip(i, M) {
    const st = this.st, c = st.u8(M + 0x1b);
    for (let k = 0; k < 0x1e; k++) if (st.u8(0x2e1b + k) === c) {
      st.set8(0x2e1b + k, 0xff);
      const P = st.personRecord(c); st.set8(P + 0x2d, 0xff); st.set8(P + 0x31, st.u8(P + 0x31) & 0xdf);
      break;
    }
    this.removeShip(i);
  }
  // seg0:5deb 移除船位 i: 船 (+0f = FF, +10/+11/+12/+14 = 0)、船位 (+2..+6 = FF, +0 = 0, +8 = 0)、船員配置清空, 船長 (非主角) 職務 = 6; +08 先寫 0x19 再寫 0x32 (原版如此)
  removeShip(i) {
    const st = this.st, M = this.crewOf(i), S = this.slotOf(i), ship = this.shipRec(st.u8(S + 7));
    st.set8(ship + 0x0f, 0xff); st.set8(ship + 0x11, 0); st.set8(ship + 0x10, 0); st.set16(ship + 0x14, 0); st.set16(ship + 0x12, 0);
    for (const k of [5, 4, 3, 2, 6]) st.set8(S + k, 0xff);
    st.set16(S, 0); st.set8(S + 8, 0);
    st.set16(M + 6, 0); st.set16(M + 4, 0); st.set16(M + 2, 0); st.set16(M, 0);
    for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    st.set16(M + 0x0a, 0);
    if (st.u8(M + 0x1b) !== st.u8(0x12b5)) st.set8(st.personRecord(st.u8(M + 0x1b)) + 0x2e, 6);
    st.set8(M + 0x1b, 0xff); st.set8(M + 0x1c, 0); st.set8(M + 0x1d, 0); st.set8(M + 8, 0x19); st.set8(M + 8, 0x32);
  }
  // 197f7: 0x150 / 0x151「%s 不見了」— 原版以「船位編號」當船編號取船名 (5c7a(i)), 照搬
  async shipLostMsg(i) {
    if (this.port !== 0xff) return;
    const { sys, message, con } = this.c, st = this.st, ship = this.shipRec(i);
    sys.mouseHide();
    const p = this.b.crewSpeaks();
    message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? 0x151 : 0x150, this.b.dstr(ship));
    await this.c.menu.waitPrompt(); await this.c.win.close();
    sys.mouseShow();
    con.right = 0x50;
  }
  // 19909 觀測者: 船員名單中最後一個職務 3 與最後一個職務 5 的人, 取 +1f 較高者 (相同時取職務 5)
  watcher() {
    const st = this.st; let a = 0xffff, b = 0xffff, pa = 0, pb = 0;
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(0x2e1b + i); if (n === 0xff) continue;
      const P = st.personRecord(n), j = st.u8(P + 0x2e);
      if (j === 3) { pa = P; a = n; } else if (j === 5) { pb = P; b = n; }
    }
    if (b === 0xffff && a === 0xffff) return 0xffff;
    if (b === 0xffff) return a;
    if (a !== 0xffff && st.u8(pb + 0x1f) < st.u8(pa + 0x1f)) return a;
    return b;
  }
  // 1999c 天候開始: [0cb3] = (高 4 位元) | 種類 | 0x40; 觀測者 random(100) <= +1f 時發言 (msg + 2 若 +1e < 70; + 1 若 +2f bit3)
  async weatherBegin(msg, kind) {
    const st = this.st, { sys, message, menu, win } = this.c;
    const di = this.watcher();
    st.set8(0x0cb3, (st.u8(0x0cb3) & 0xf0) | kind | 0x40);
    if (di === 0xffff) return;
    const P = st.personRecord(di);
    if ((this.c.sys.rng.random(100) & 0xff) > st.u8(P + 0x1f)) return;
    if (this.port !== 0xff) return;
    sys.mouseHide();
    this.b.talkPerson(di);
    if (st.u8(P + 0x1e) < 0x46) msg += 2;
    message(st.u8(P + 0x2f) & 8 ? msg + 1 : msg);
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
  }
  // 船員發言 0x... (+1 若發言者 +2f bit3) 後等待、關閉
  async crewSay(m0, m1, ...a) {
    const { message, menu, win } = this.c, st = this.st, p = this.b.crewSpeaks();
    message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? m1 : m0, ...a);
    await menu.waitPrompt(); await win.close();
  }
  // 19f48 天候進行中: 剛開始 (bit6) 時船員報告 (暴風雨先 2103 + GRAPH #0x3a), 重畫地圖, bit6 → bit7; 依種類 19bd1 / 19e84 / 19efc; 1976e
  async weatherOngoing() {
    const st = this.st, { sys, graph } = this.c;
    if (st.u8(0x0cb3) & 0x40) {
      sys.mouseHide();
      if ((st.u8(0x0cb3) & 15) === 1) { this.clearCache(); graph.draw(0x3a, 0xa0, 0x10); }
      const si = ((st.u8(0x0cb3) & 15) + 0xaf) * 2;
      await this.crewSay(si, si + 1);
      this.drawMap();
      sys.mouseShow();
      st.set8(0x0cb3, (st.u8(0x0cb3) & 0xbf) | 0x80);
    }
    switch (st.u8(0x0cb3) & 15) {
      case 1: await this.storm(); break;
      case 2: await this.calm(); break;
      case 3: await this.fog(); break;
    }
    this.c.palette.selectTimePalette(this.time, true, st.u8(0x0cb3));   // 1976e
  }
  // 19bd1 暴風雨 (每時刻): 各船損傷 si = min(10, (100 − 船長 +1d) / (+24/5 + 3) + 1) + random(2), 非 +10 bit6 的船 ×5;
  //   耐久度 (+2) −si, 轉向力 (+4)、推進力 (+5) −si/2; 最大耐久 (+3) = max(船型 +1 / 4, +3 − 1), 耐久度 <= 最大耐久;
  //   耐久度 0: 主角的船 → 淡出、[03ea] = 0x18 (遊戲結束); 其他船 → 沉沒訊息 0x166/0x167 (+ 船長 0x329 或 19849), 5deb
  //   [1005]&0x18 時不損傷。之後 18299、風力 = 7; 非當天開始且 (random(8) = 0 或離開天候區) → 結束 0x168/0x169; 8067
  async storm() {
    const st = this.st, { sys, palette, message, menu, win } = this.c, rng = this.c.sys.rng, F = this.fleet;
    if (!(st.u8(0x1005) & 0x18)) {
      for (let i = 0; i < 10; i++) {
        const M = this.crewOf(i), S = this.slotOf(i);
        if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
        const P = st.personRecord(st.u8(M + 0x1b)), ship = this.shipRec(st.u8(S + 7));
        const cx = Math.floor(st.u8(P + 0x24) / 5) + 3;
        let si = seaUmin(10, (Math.trunc((100 - st.u8(P + 0x1d)) / cx) + 1) & 0xffff);
        si = (si + rng.random(2)) & 0xffff;
        if (!(st.u8(ship + 0x10) & 0x40)) si = (5 * si) & 0xffff;
        st.set8(S + 2, st.u8(S + 2) - seaUmin(st.u8(S + 2), si));
        const h = Math.trunc(seaS16(si) / 2);
        st.set8(S + 5, st.u8(S + 5) - seaUmin(st.u8(S + 5), h));
        st.set8(S + 4, st.u8(S + 4) - seaUmin(st.u8(S + 4), h));
        const mx = seaUmax(st.u8(this.typeOf(st.u8(ship + 0x0f)) + 1) >> 2, (st.u8(S + 3) - 1) & 0xffff) & 0xff;
        st.set8(S + 3, mx);
        st.set8(S + 2, seaUmin(mx, st.u8(S + 2)));
        if (st.u8(S + 2)) continue;
        if (st.u8(M + 0x1b) === st.u8(0x12b5)) { await palette.fadeBlack(); palette.ending = 0x18; return; }
        sys.mouseHide();
        const cap = st.u8(M + 0x1b), Pc = st.personRecord(cap);
        if (!(st.u8(Pc + 0x1b) & 0xc0)) {
          let k = 0; while (k < 0x1e && st.u8(0x2e1b + k) !== cap) k++;
          if (k < 0x1e) st.set8(0x2e1b + k, 0xff);
          const p = this.b.crewSpeaks();
          message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? 0x167 : 0x166, this.b.dstr(this.shipRec(st.u8(S + 7))));
          message(0x329, this.b.dstr(Pc));
          st.set8(0x2e1b + k, cap);                                      // 原版把船長放回原位 (找不到時寫到 DS:2e39)
          this.removeShip(i);
        } else {
          this.dropShip(i, M);
          const p = this.b.crewSpeaks();
          message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? 0x167 : 0x166, this.b.dstr(this.shipRec(st.u8(S + 7))));   // 5deb 不清 +7 與船名, 仍是原船名
        }
        await menu.waitPrompt(); await win.close();
        sys.mouseShow();
      }
      this.fleetDurability(F);                                         // 18299
    }
    st.set8(0x0cb1, st.u8(0x0cb1) | 7);
    if (!(st.u8(0x0cb3) & 0x80) && (!rng.random(8) || !(st.u8(0x0cb1) & 0x80))) {
      // 9888 停止效果音
      st.set8(0x0cb3, st.u8(0x0cb3) & 0xf0);
      sys.mouseHide(); await this.crewSay(0x168, 0x169); sys.mouseShow();
    }
    this.seaPanel();                                                   // 8067
  }
  // 18299 艦隊 +28 = (各船耐久度和 + 4) / 5; 和為 0 時 +29 bit0 清除
  fleetDurability(F) {
    const st = this.st; let sum = 0;
    for (let i = 0; i < 10; i++) { const S = F + 0x2b + 9 * i; if ((st.u8(S + 8) & 0x30) === 0x10) sum += st.u8(S + 2); }
    st.set8(F + 0x28, Math.trunc((sum + 4) / 5));
    if (!sum) st.set8(F + 0x29, st.u8(F + 0x29) & 0xfe);
  }
  // 19e84 無風: 非當天開始、random(20) = 0 且所在海域風力 (風向表 &7) ≠ 0 → 結束 0x16a/0x16b; 期間風力 = 0
  async calm() {
    const st = this.st, rng = this.c.sys.rng, [w] = this.clock.windAt(this.fleet), { sys } = this.c;
    if (!(st.u8(0x0cb3) & 0x80) && !rng.random(0x14) && (w & 7)) {
      st.set8(0x0cb3, st.u8(0x0cb3) & 0xf0);
      sys.mouseHide(); await this.crewSay(0x16a, 0x16b); sys.mouseShow();
    }
    st.set8(0x0cb1, st.u8(0x0cb1) & 0xf8);
  }
  // 19efc 霧: 非當天開始且 (random(30) = 0 或離開天候區 (風 bit7 = 0)) → 結束 0x16c
  async fog() {
    const st = this.st, rng = this.c.sys.rng, { sys, message, menu, win } = this.c;
    if (st.u8(0x0cb3) & 0x80) return;
    if (rng.random(0x1e) && (st.u8(0x0cb1) & 0x80)) return;
    st.set8(0x0cb3, st.u8(0x0cb3) & 0xf0);
    sys.mouseHide(); this.b.crewSpeaks(); message(0x16c); await menu.waitPrompt(); await win.close(); sys.mouseShow();
  }
}
